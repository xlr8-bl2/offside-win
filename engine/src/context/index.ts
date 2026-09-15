import { config } from '../config.ts';
import { clamp, coverageScore, findConflicts, stack, topTierCoverage } from '../ledger.ts';
import { findBookMarket, offeredLines } from '../odds.ts';
import { expectedGoals } from '../ratings/dixoncoles.ts';
import { expectedCornersFrom, expectedRedsFrom } from '../ratings/fit.ts';
import { priceAll } from '../price.ts';
import type { Factor, FixtureAnalysis, ModelMarket } from '../types.ts';
import { availabilityFactors } from './availability.ts';
import { environmentFactors } from './environment.ts';
import { fatigueFactors } from './fatigue.ts';
import { formFactors } from './form.ts';
import { managerFactors } from './manager.ts';
import { marketFactors } from './market.ts';
import { refereeFactors } from './referee.ts';
import { stakesFactors } from './stakes.ts';
import { styleFactors } from './style.ts';
import type { FixtureContext } from './types.ts';

/**
 * Runs the doctrine over a fixture and turns it into prices.
 *
 * Module order follows §12's hierarchy, and the order is not cosmetic — the
 * ledger is rendered in it, so the most dispositive evidence reads first on the
 * page as well as in the model.
 */
const MODULES = [
  availabilityFactors, // tier 1 — §2.4, §3.1, §3.2
  formFactors,         // tier 2 — §2.1, how they have been playing
  stakesFactors,       // tier 2 — §5.1, §5.2, §5.3
  managerFactors,      // tier 3 — §1
  fatigueFactors,      // tier 4 — §2.8, §5.5, §6.4
  styleFactors,        // tier 5 — §4, §1.4
  refereeFactors,      // tier 5
  environmentFactors,  // tier 6 — §6
  marketFactors,       // tier 7 — §7
];

export function runFactors(ctx: FixtureContext): Factor[] {
  const out: Factor[] = [];
  for (const mod of MODULES) {
    try {
      out.push(...mod(ctx));
    } catch (err) {
      // One broken module must not cost the whole fixture its analysis. The
      // failure is recorded as an absence, which is what it is.
      out.push({
        id: `error.${mod.name}`,
        section: '—',
        tier: 7,
        state: 'UNAVAILABLE',
        note: `Factor module ${mod.name} failed: ${err instanceof Error ? err.message : String(err)}`,
        evidence: {},
        adjustments: [],
        claims: [],
        strength: 0,
      });
    }
  }
  return out.sort((a, b) => a.tier - b.tier);
}

/**
 * Model confidence, 0..1.
 *
 * Three things pull it down, each for a reason the doctrine gives:
 * how much of the context we actually read (§13), how well the two teams are
 * known (the rating standard errors), and whether the lineup is confirmed —
 * §12 puts availability first and non-negotiable, so a provisional XI is a
 * genuine discount rather than a caveat in small print.
 */
export function computeConfidence(ctx: FixtureContext, factors: Factor[]): number {
  const coverage = coverageScore(factors);

  const hr = ctx.model.ratings.teams.get(ctx.home.team_id);
  const ar = ctx.model.ratings.teams.get(ctx.away.team_id);
  // A standard error around 0.12 on the log scale is a well-known team; 0.35 is
  // a side we have barely seen.
  const sePenalty = (r: typeof hr): number => {
    if (!r) return 0.45;
    const se = (r.attack_se + r.defence_se) / 2;
    return clamp(1 - (se - 0.10) / 0.30, 0.25, 1);
  };
  const ratingConfidence = (sePenalty(hr) + sePenalty(ar)) / 2;

  const lineupFactor =
    ctx.lineups.status === 'confirmed' ? 1 : ctx.lineups.status === 'predicted' ? 0.82 : 0.65;

  // Conflicting dispositive factors mean we are genuinely unsure, whatever the
  // arithmetic says.
  const conflicts = findConflicts(factors).length;
  const conflictPenalty = clamp(1 - conflicts * 0.2, 0.4, 1);

  return clamp(coverage * ratingConfidence * lineupFactor * conflictPenalty, 0, 1);
}

export interface AnalysisResult {
  analysis: Omit<FixtureAnalysis, 'candidates' | 'verdicts' | 'pass_reason'>;
  factors: Factor[];
  confidence: number;
}

export function analyseFixture(ctx: FixtureContext): AnalysisResult {
  const factors = runFactors(ctx);
  const { multipliers, capped } = stack(factors);

  // ---- base rates from the fitted model -------------------------------
  const base = expectedGoals(ctx.model.ratings, ctx.home.team_id, ctx.away.team_id);
  let lambdaHome = base.home;
  let lambdaAway = base.away;

  // Neutral ground removes the fitted home advantage. This is arithmetic on the
  // model, not a judgement call, so it is applied here rather than through the
  // capped factor stack — a 20% structural correction would be clipped to
  // nonsense by a cap that exists to restrain doctrine factors.
  if (ctx.event['is_neutral_ground'] === true) {
    lambdaHome *= Math.exp(-ctx.model.params.home_adv);
  }

  lambdaHome *= multipliers.goals.home;
  lambdaAway *= multipliers.goals.away;

  const corners = expectedCornersFrom(ctx.model, ctx.home.team_id, ctx.away.team_id);
  const cornersHome = corners.home * multipliers.corners.home;
  const cornersAway = corners.away * multipliers.corners.away;

  const redsBase = expectedRedsFrom(ctx.model, ctx.home.team_id, ctx.away.team_id, ctx.referee);
  // Card adjustments are emitted symmetrically, so either side's multiplier is
  // the fixture-level one.
  const reds = redsBase.total * multipliers.cards.home;

  const confidence = computeConfidence(ctx, factors);

  // ---- price only what the book is actually offering --------------------
  const model: ModelMarket[] = priceAll({
    lambdaHome,
    lambdaAway,
    rho: ctx.model.params.rho,
    cornersHome,
    cornersAway,
    cornersDispersion: corners.dispersion,
    reds,
    cornerLines: offeredLines(ctx.quotes, 'total_corners'),
    redLines: offeredLines(ctx.quotes, 'total_red_cards'),
    handicapLines: {
      european: offeredLines(ctx.quotes, 'european_handicap'),
      asian: offeredLines(ctx.quotes, 'asian_handicap'),
    },
    confidence,
  });

  if (capped.length > 0) {
    factors.push({
      id: 'model.stack_capped',
      section: '§8',
      tier: 7,
      state: 'COMPUTED',
      note:
        'The combined context adjustments hit the cap and were clipped, so the model is holding back ' +
        'from the full implied move.',
      evidence: { capped },
      adjustments: [],
      claims: [],
      strength: 0.1,
    });
  }

  return {
    analysis: {
      fixture_id: ctx.fixture_id,
      league_id: ctx.league_id,
      kickoff: ctx.kickoff,
      home_team: ctx.home.team_name,
      away_team: ctx.away.team_name,
      home_team_id: ctx.home.team_id,
      away_team_id: ctx.away.team_id,
      status: String(ctx.event['status'] ?? 'scheduled'),
      provisional: ctx.lineups.status !== 'confirmed',
      lineup_status: ctx.lineups.status,
      lambda_home: lambdaHome,
      lambda_away: lambdaAway,
      corner_rate: cornersHome + cornersAway,
      card_rate: reds,
      factors,
      book: ctx.book,
      model,
      external: {
        ...(ctx.prediction ? { bsd_prediction: ctx.prediction as Record<string, unknown> } : {}),
        ...(ctx.polymarket ? { polymarket: ctx.polymarket as Record<string, unknown> } : {}),
      },
      computed_at: Math.floor(Date.now() / 1000),
    },
    factors,
    confidence,
  };
}

export { topTierCoverage, coverageScore, findConflicts };
