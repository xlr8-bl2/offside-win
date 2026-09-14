import { config } from '../config.ts';
import type { MatchRow, RefereeRate, TeamRate } from '../types.ts';

/**
 * Corner and card rates, fitted separately from goals.
 *
 * Goals come off one well-understood distribution. Corners and cards do not,
 * and pretending otherwise is how a model ends up confidently wrong on the
 * markets it understands least:
 *
 * - **Corners are over-dispersed.** A Poisson with mean 10 says the variance is
 *   10; real corner counts run appreciably wider, because corners arrive in
 *   clusters — one scramble yields three. A negative binomial adds the
 *   dispersion parameter that captures it, and getting this wrong systematically
 *   misprices the tails, which is exactly where the over/under lines sit.
 * - **Red cards are rare.** Roughly 0.1–0.25 per match, so a single season gives
 *   a team a handful of events. Heavy shrinkage toward the league rate is not
 *   conservatism, it is the only defensible reading of that sample.
 *
 * Both are fitted as multiplicative team effects by iterative proportional
 * fitting, which is the Poisson GLM's IRLS in a form short enough to read:
 *
 *   expected_for(i vs j) = league_mean × for_i × against_j
 */

interface Tally {
  forSum: number;
  againstSum: number;
  weight: number;
  /** Opponent effects encountered, used to normalise for schedule strength. */
  expForBase: number;
  expAgainstBase: number;
}

interface RateFitInput {
  matches: MatchRow[];
  asOf: number;
  xi: number;
  homeFor: (m: MatchRow) => number | null;
  awayFor: (m: MatchRow) => number | null;
  /** Shrinkage strength toward 1.0, in effective matches. */
  priorMatches: number;
}

interface RateFitOutput {
  leagueMean: number;
  /** Team -> { for, against } multiplicative effects, 1.0 = league average. */
  effects: Map<number, { for_: number; against: number; matches: number }>;
  /** Variance/mean ratio of residuals; >1 means over-dispersed. */
  dispersion: number;
  /** Home share of the total, so home/away can be split without a second fit. */
  homeShare: number;
}

function fitMultiplicative(input: RateFitInput): RateFitOutput {
  const rows: Array<{ h: number; a: number; hv: number; av: number; w: number }> = [];
  let totalW = 0;
  let totalVal = 0;
  let homeVal = 0;

  for (const m of input.matches) {
    const hv = input.homeFor(m);
    const av = input.awayFor(m);
    if (hv === null || av === null || !Number.isFinite(hv) || !Number.isFinite(av)) continue;
    const ageDays = Math.max(0, (input.asOf - m.kickoff) / 86400);
    const w = Math.exp(-input.xi * ageDays);
    if (w < 1e-4) continue;
    rows.push({ h: m.home_team_id, a: m.away_team_id, hv, av, w });
    totalW += w;
    totalVal += w * (hv + av);
    homeVal += w * hv;
  }

  const leagueMean = rows.length ? totalVal / (2 * totalW) : 0;
  const homeShare = totalVal > 0 ? homeVal / totalVal : 0.5;

  const effects = new Map<number, { for_: number; against: number; matches: number }>();
  if (rows.length === 0 || leagueMean <= 0) {
    return { leagueMean, effects, dispersion: 1, homeShare };
  }

  const ids = new Set<number>();
  for (const r of rows) {
    ids.add(r.h);
    ids.add(r.a);
  }
  for (const id of ids) effects.set(id, { for_: 1, against: 1, matches: 0 });

  for (const r of rows) {
    effects.get(r.h)!.matches += r.w;
    effects.get(r.a)!.matches += r.w;
  }

  // Iterative proportional fitting. Alternately solve the "for" effects holding
  // "against" fixed and vice versa; converges in a handful of passes for a
  // schedule this dense.
  const prior = input.priorMatches;
  for (let pass = 0; pass < 25; pass++) {
    const tally = new Map<number, Tally>();
    for (const id of ids) {
      tally.set(id, { forSum: 0, againstSum: 0, weight: 0, expForBase: 0, expAgainstBase: 0 });
    }
    for (const r of rows) {
      const eh = effects.get(r.h)!;
      const ea = effects.get(r.a)!;
      const th = tally.get(r.h)!;
      const ta = tally.get(r.a)!;
      th.forSum += r.w * r.hv;
      th.expForBase += r.w * leagueMean * ea.against;
      th.againstSum += r.w * r.av;
      th.expAgainstBase += r.w * leagueMean * ea.for_;
      ta.forSum += r.w * r.av;
      ta.expForBase += r.w * leagueMean * eh.against;
      ta.againstSum += r.w * r.hv;
      ta.expAgainstBase += r.w * leagueMean * eh.for_;
      th.weight += r.w;
      ta.weight += r.w;
    }

    let maxDelta = 0;
    for (const id of ids) {
      const t = tally.get(id)!;
      const e = effects.get(id)!;
      // Shrink toward 1.0 by adding `prior` pseudo-matches at the league rate.
      const pseudo = prior * leagueMean;
      const nf = (t.forSum + pseudo) / Math.max(1e-9, t.expForBase + pseudo);
      const na = (t.againstSum + pseudo) / Math.max(1e-9, t.expAgainstBase + pseudo);
      maxDelta = Math.max(maxDelta, Math.abs(nf - e.for_), Math.abs(na - e.against));
      e.for_ = nf;
      e.against = na;
    }
    if (maxDelta < 1e-5) break;
  }

  // Renormalise so the mean effect is 1 and `leagueMean` keeps its meaning.
  let mf = 0;
  let ma = 0;
  for (const e of effects.values()) {
    mf += e.for_;
    ma += e.against;
  }
  mf /= effects.size;
  ma /= effects.size;
  for (const e of effects.values()) {
    e.for_ /= mf;
    e.against /= ma;
  }

  // Dispersion from Pearson residuals: variance/mean of the observed counts
  // against their fitted expectations. 1.0 is Poisson; football corners sit
  // meaningfully above it.
  let chi2 = 0;
  let dof = 0;
  for (const r of rows) {
    const eh = effects.get(r.h)!;
    const ea = effects.get(r.a)!;
    const expH = leagueMean * eh.for_ * ea.against * 2 * homeShare;
    const expA = leagueMean * ea.for_ * eh.against * 2 * (1 - homeShare);
    if (expH > 0) {
      chi2 += (r.w * (r.hv - expH) ** 2) / expH;
      dof += r.w;
    }
    if (expA > 0) {
      chi2 += (r.w * (r.av - expA) ** 2) / expA;
      dof += r.w;
    }
  }
  const dispersion = dof > 1 ? Math.max(1, chi2 / dof) : 1;

  return { leagueMean, effects, dispersion, homeShare };
}

export interface RateModels {
  corners: RateFitOutput;
  reds: RateFitOutput;
  yellows: RateFitOutput;
  teams: Map<number, TeamRate>;
}

export function fitRates(matches: MatchRow[], asOf: number): RateModels {
  const xi = config.ratings.xi;

  const corners = fitMultiplicative({
    matches,
    asOf,
    xi,
    homeFor: (m) => m.home_corners,
    awayFor: (m) => m.away_corners,
    priorMatches: 6,
  });

  // Red cards are rare enough that a team's own record is mostly noise; the
  // prior does most of the work, and that is the honest answer.
  const reds = fitMultiplicative({
    matches,
    asOf,
    xi,
    homeFor: (m) => m.home_reds,
    awayFor: (m) => m.away_reds,
    priorMatches: 40,
  });

  const yellows = fitMultiplicative({
    matches,
    asOf,
    xi,
    homeFor: (m) => m.home_yellows,
    awayFor: (m) => m.away_yellows,
    priorMatches: 10,
  });

  const ids = new Set<number>([
    ...corners.effects.keys(),
    ...reds.effects.keys(),
    ...yellows.effects.keys(),
  ]);

  const teams = new Map<number, TeamRate>();
  for (const id of ids) {
    const c = corners.effects.get(id);
    const r = reds.effects.get(id);
    const y = yellows.effects.get(id);
    teams.set(id, {
      team_id: id,
      corners_for: c ? corners.leagueMean * c.for_ : corners.leagueMean,
      corners_against: c ? corners.leagueMean * c.against : corners.leagueMean,
      corners_disp: corners.dispersion,
      yellows_for: y ? yellows.leagueMean * y.for_ : yellows.leagueMean,
      reds_for: r ? reds.leagueMean * r.for_ : reds.leagueMean,
      matches: c?.matches ?? 0,
    });
  }

  return { corners, reds, yellows, teams };
}

/** Expected corners for a fixture, split home/away, before context adjustment. */
export function expectedCorners(
  models: RateModels,
  homeTeamId: number,
  awayTeamId: number,
): { home: number; away: number; dispersion: number } {
  const { corners } = models;
  const h = corners.effects.get(homeTeamId) ?? { for_: 1, against: 1, matches: 0 };
  const a = corners.effects.get(awayTeamId) ?? { for_: 1, against: 1, matches: 0 };
  const base = corners.leagueMean;
  return {
    home: base * h.for_ * a.against * 2 * corners.homeShare,
    away: base * a.for_ * h.against * 2 * (1 - corners.homeShare),
    dispersion: corners.dispersion,
  };
}

/**
 * Expected red cards for a fixture. The referee multiplier only applies once
 * the referee clears the sample gate — §13 is explicit that a referee with
 * eleven games gets no tendency assessment.
 */
export function expectedReds(
  models: RateModels,
  homeTeamId: number,
  awayTeamId: number,
  referee: RefereeRate | null,
): { total: number; refereeApplied: boolean } {
  const { reds } = models;
  const h = reds.effects.get(homeTeamId) ?? { for_: 1, against: 1, matches: 0 };
  const a = reds.effects.get(awayTeamId) ?? { for_: 1, against: 1, matches: 0 };
  const base = reds.leagueMean;
  let total = base * h.for_ * a.against + base * a.for_ * h.against;

  let refereeApplied = false;
  if (referee && referee.matches >= config.gates.refereeMatches && reds.leagueMean > 0) {
    const mult = referee.reds_per / (2 * reds.leagueMean);
    if (Number.isFinite(mult) && mult > 0) {
      // Bound it: even a genuinely card-happy referee does not triple the rate,
      // and an unbounded multiplier on a rare event is a liability.
      total *= Math.max(0.6, Math.min(1.8, mult));
      refereeApplied = true;
    }
  }
  return { total, refereeApplied };
}

export function fitRefereeRates(matches: MatchRow[]): Map<number, RefereeRate> {
  const agg = new Map<number, { n: number; y: number; r: number }>();
  for (const m of matches) {
    if (m.referee_id === null) continue;
    if (m.home_yellows === null && m.home_reds === null) continue;
    const cur = agg.get(m.referee_id) ?? { n: 0, y: 0, r: 0 };
    cur.n += 1;
    cur.y += (m.home_yellows ?? 0) + (m.away_yellows ?? 0);
    cur.r += (m.home_reds ?? 0) + (m.away_reds ?? 0);
    agg.set(m.referee_id, cur);
  }

  const out = new Map<number, RefereeRate>();
  for (const [id, a] of agg) {
    // Stored regardless of sample size so the ledger can show the count and say
    // "eleven games, excluded" — but consumers must check the gate themselves.
    out.set(id, {
      referee_id: id,
      name: null,
      matches: a.n,
      yellows_per: a.n ? a.y / a.n : 0,
      reds_per: a.n ? a.r / a.n : 0,
    });
  }
  return out;
}
