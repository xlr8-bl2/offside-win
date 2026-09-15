import { config } from '../config.ts';
import { adj, clamp, computed, effect, gate, thin } from '../ledger.ts';
import type { Claim, Factor, MatchRow } from '../types.ts';
import type { FixtureContext, SideContext } from './types.ts';

/**
 * §4 — the opposition, and §1.4's tactical identity.
 *
 * §4.1's opponent adjustment is already structural rather than something to
 * bolt on here: the Dixon-Coles fit estimates every team's attack against every
 * opponent's defence simultaneously, so a side that has spent six weeks playing
 * bottom-half opposition does not get credit for it. Recomputing a schedule
 * adjustment on top would double-count. What this module adds is the part the
 * ratings cannot express — §4.2's matchup read, where two styles interact in a
 * way neither team's aggregate numbers show.
 *
 * The doctrine calls this the most qualitative part of the analysis and the
 * least automatable, which is a warning worth taking literally. So the reads
 * here are restricted to the ones the data genuinely supports:
 *
 * - possession asymmetry, from measured possession shares
 * - shot volume against shot quality, which separates a side that works good
 *   chances from one that shoots from anywhere
 * - corner dependence, which is the wide-play tendency §1.4 ties to crossing
 *
 * Pressing intensity and defensive line height would need per-match PPDA and
 * average-position data the fitting set does not carry, so the press matchup
 * §4.2 describes is reported as unavailable rather than approximated from
 * something that merely correlates with it.
 */

export interface StyleVector {
  matches: number;
  /** Mean possession share, 0–100. */
  possession: number | null;
  /** Shots taken per match. */
  shots: number | null;
  /** xG per shot — chance quality. High means working the ball into good areas. */
  xgPerShot: number | null;
  /** Corners per match won. */
  corners: number | null;
  /** Corners per shot — a wide-play and crossing tendency proxy. */
  cornersPerShot: number | null;
  /** Goals minus xG per match: finishing above or below the chances created. */
  finishing: number | null;
}

function mean(values: Array<number | null | undefined>): number | null {
  const xs = values.filter((v): v is number => v !== null && v !== undefined && Number.isFinite(v));
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

export function styleVector(matches: MatchRow[], teamId: number): StyleVector {
  const own = <T>(m: MatchRow, home: T, away: T): T => (m.home_team_id === teamId ? home : away);

  const possession = mean(matches.map((m) => own(m, m.home_possession, m.away_possession)));
  const shots = mean(matches.map((m) => own(m, m.home_shots, m.away_shots)));
  const corners = mean(matches.map((m) => own(m, m.home_corners, m.away_corners)));
  const xg = mean(matches.map((m) => own(m, m.home_xg, m.away_xg)));
  const goals = mean(matches.map((m) => own(m, m.home_goals, m.away_goals)));

  return {
    matches: matches.length,
    possession,
    shots,
    xgPerShot: xg !== null && shots !== null && shots > 0 ? xg / shots : null,
    corners,
    cornersPerShot: corners !== null && shots !== null && shots > 0 ? corners / shots : null,
    finishing: goals !== null && xg !== null ? goals - xg : null,
  };
}

export function styleFactors(ctx: FixtureContext): Factor[] {
  const home = styleVector(ctx.styleMatches.home, ctx.home.team_id);
  const away = styleVector(ctx.styleMatches.away, ctx.away.team_id);
  const n = Math.min(home.matches, away.matches);

  return [
    opponentAdjustmentFactor(ctx),
    matchupFactor(ctx, home, away, n),
    pressMatchupFactor(),
    finishingFactor(ctx, 'home', ctx.home, home, n),
    finishingFactor(ctx, 'away', ctx.away, away, n),
  ];
}

/**
 * §4.1. Recorded rather than computed, because the ratings already do it — and
 * saying so is more useful than a second adjustment that would double-count.
 */
function opponentAdjustmentFactor(ctx: FixtureContext): Factor {
  const homeRating = ctx.model.ratings.teams.get(ctx.home.team_id);
  const awayRating = ctx.model.ratings.teams.get(ctx.away.team_id);

  if (!homeRating || !awayRating) {
    return thin({
      id: 'style.opponent_adjustment',
      section: '§4.1',
      tier: 5,
      note: 'One side has no fitted rating, so opponent-adjusted strength is unavailable for this fixture.',
      evidence: {
        home_rated: !!homeRating,
        away_rated: !!awayRating,
      },
    });
  }

  const effective = Math.min(homeRating.matches, awayRating.matches);
  return gate(effective, config.gates.opponentAdjustFixtures, {
    id: 'style.opponent_adjustment',
    section: '§4.1',
    tier: 5,
    note:
      'Team strength is estimated against the actual quality of opponents faced, so a soft run of ' +
      'fixtures does not read as form.',
    evidence: {
      home: {
        attack: Number(homeRating.attack.toFixed(3)),
        defence: Number(homeRating.defence.toFixed(3)),
        effective_matches: Number(homeRating.matches.toFixed(1)),
        shrunk: Number(homeRating.shrunk.toFixed(2)),
      },
      away: {
        attack: Number(awayRating.attack.toFixed(3)),
        defence: Number(awayRating.defence.toFixed(3)),
        effective_matches: Number(awayRating.matches.toFixed(1)),
        shrunk: Number(awayRating.shrunk.toFixed(2)),
      },
    },
    strength: 0.2,
  });
}

/**
 * §4.2. The reads the data supports: a possession mismatch, and a crossing-heavy
 * side meeting one that is not. Both are stated as interactions rather than as
 * properties of either team alone, which is the whole point of the section.
 */
function matchupFactor(
  ctx: FixtureContext,
  home: StyleVector,
  away: StyleVector,
  n: number,
): Factor {
  if (home.possession === null || away.possession === null) {
    return thin({
      id: 'style.matchup',
      section: '§4.2',
      tier: 5,
      note: 'Possession data is missing for at least one side, so the style matchup cannot be read.',
      evidence: { home_matches: home.matches, away_matches: away.matches },
    });
  }

  return gate(n, config.gates.opponentAdjustFixtures, {
    id: 'style.matchup',
    section: '§4.2',
    tier: 5,
    note: buildMatchupNote(ctx, home, away),
    evidence: {
      home: styleEvidence(home),
      away: styleEvidence(away),
      possession_gap: Number((home.possession - away.possession).toFixed(1)),
    },
    adjustments: matchupAdjustments(home, away),
    claims: matchupClaims(ctx, home, away),
    strength: clamp(Math.abs(home.possession - away.possession) / 25, 0.1, 0.6),
  });
}

function styleEvidence(s: StyleVector): Record<string, unknown> {
  return {
    matches: s.matches,
    possession: s.possession === null ? null : Number(s.possession.toFixed(1)),
    shots: s.shots === null ? null : Number(s.shots.toFixed(1)),
    xg_per_shot: s.xgPerShot === null ? null : Number(s.xgPerShot.toFixed(3)),
    corners: s.corners === null ? null : Number(s.corners.toFixed(1)),
    corners_per_shot: s.cornersPerShot === null ? null : Number(s.cornersPerShot.toFixed(3)),
    finishing_vs_xg: s.finishing === null ? null : Number(s.finishing.toFixed(2)),
  };
}

function buildMatchupNote(ctx: FixtureContext, home: StyleVector, away: StyleVector): string {
  const gap = (home.possession ?? 50) - (away.possession ?? 50);
  const parts: string[] = [];

  if (Math.abs(gap) >= 8) {
    const dominant = gap > 0 ? ctx.home : ctx.away;
    const other = gap > 0 ? ctx.away : ctx.home;
    parts.push(
      `${dominant.team_name} average ${Math.abs(gap).toFixed(0)} points more possession than ${other.team_name}, ` +
        `so this should be one side with the ball and one without it`,
    );
  } else {
    parts.push('Neither side holds a clear possession edge on recent evidence');
  }

  if (home.cornersPerShot !== null && away.cornersPerShot !== null) {
    const wider = home.cornersPerShot > away.cornersPerShot ? ctx.home : ctx.away;
    const ratio = Math.max(home.cornersPerShot, away.cornersPerShot) /
      Math.max(1e-6, Math.min(home.cornersPerShot, away.cornersPerShot));
    if (ratio > 1.3) {
      parts.push(`${wider.team_name} work noticeably more of their attacks into wide areas`);
    }
  }

  return `${parts.join('; ')}.`;
}

function matchupAdjustments(home: StyleVector, away: StyleVector) {
  const out = [];
  const gap = (home.possession ?? 50) - (away.possession ?? 50);

  // A lopsided possession game concentrates corners on the side with the ball.
  if (Math.abs(gap) >= 8) {
    const k = clamp(Math.abs(gap) / 25, 0.2, 1);
    out.push(adj('corners', gap > 0 ? 'home' : 'away', effect(0.35 * k)));
    out.push(adj('corners', gap > 0 ? 'away' : 'home', effect(-0.35 * k)));
  }

  // Chance quality: a side that works the ball into good areas converts its
  // volume better than one shooting from distance.
  if (home.xgPerShot !== null && away.xgPerShot !== null) {
    for (const [side, s] of [['home', home], ['away', away]] as const) {
      if (s.xgPerShot! > 0.13) out.push(adj('goals', side, effect(0.2)));
      else if (s.xgPerShot! < 0.08) out.push(adj('goals', side, effect(-0.2)));
    }
  }

  return out;
}

function matchupClaims(ctx: FixtureContext, home: StyleVector, away: StyleVector): Claim[] {
  const gap = (home.possession ?? 50) - (away.possession ?? 50);
  if (Math.abs(gap) < 8) return [];
  const dominant = gap > 0 ? ctx.home : ctx.away;
  const other = gap > 0 ? ctx.away : ctx.home;
  return [
    {
      subject: dominant.team_name,
      predicate: 'style_clash',
      polarity: 1,
      magnitude: clamp(Math.abs(gap) / 25, 0.2, 1),
      evidence: {
        possession_gap: Math.round(Math.abs(gap)),
        opponent: other.team_name,
        possession: Math.round(gap > 0 ? home.possession! : away.possession!),
      },
      section: '§4.2',
      tier: 5,
    },
  ];
}

/**
 * §4.2's press matchup, stated as unavailable rather than faked.
 *
 * Reading whether a high press will be played through needs PPDA and defensive
 * line height per match. The fitting set has neither, and substituting
 * possession — which correlates with pressing but is not it — would produce a
 * confident sentence about something we did not measure. §13 is explicit that
 * this is the error to avoid.
 */
function pressMatchupFactor(): Factor {
  return {
    id: 'style.press_matchup',
    section: '§4.2',
    tier: 5,
    state: 'UNAVAILABLE',
    note:
      'Pressing intensity and defensive line height are not in the ingested stats, so the press ' +
      'matchup is not assessed. Possession is not a substitute for PPDA and is not used as one.',
    evidence: { requires: ['ppda', 'defensive_line_height'] },
    adjustments: [],
    claims: [],
    strength: 0,
  };
}

/**
 * Finishing against xG. §13 warns specifically against reading a pattern as a
 * skill without an explanation, so this is framed as what it is — a gap that
 * historically regresses — rather than as "clinical" or "wasteful".
 */
function finishingFactor(
  ctx: FixtureContext,
  which: 'home' | 'away',
  side: SideContext,
  style: StyleVector,
  n: number,
): Factor {
  if (style.finishing === null) {
    return thin({
      id: `style.finishing.${which}`,
      section: '§2.1',
      tier: 5,
      note: `No xG on record for ${side.team_name}'s recent matches, so finishing cannot be compared to chances.`,
      evidence: { matches: style.matches },
    });
  }

  const gap = style.finishing;
  if (Math.abs(gap) < 0.25) {
    return computed({
      id: `style.finishing.${which}`,
      section: '§2.1',
      tier: 5,
      note: `${side.team_name} are scoring about what their chances are worth.`,
      evidence: { goals_minus_xg_per_match: Number(gap.toFixed(2)), matches: style.matches },
      strength: 0.1,
    });
  }

  return gate(n, config.gates.opponentAdjustFixtures, {
    id: `style.finishing.${which}`,
    section: '§2.1',
    tier: 5,
    note:
      `${side.team_name} have been ${gap > 0 ? 'outscoring' : 'underscoring'} their expected goals by ` +
      `${Math.abs(gap).toFixed(2)} per match over ${style.matches} games — a gap that historically ` +
      `closes rather than holds.`,
    evidence: {
      goals_minus_xg_per_match: Number(gap.toFixed(2)),
      matches: style.matches,
    },
    // Deliberately no rate adjustment. The ratings already blend goals and xG;
    // adding a finishing term here would apply the same information twice, in
    // the direction the doctrine says reverts.
    claims: [
      {
        subject: side.team_name,
        predicate: 'form',
        polarity: gap > 0 ? 1 : -1,
        magnitude: clamp(Math.abs(gap) / 0.8, 0.2, 1),
        evidence: {
          goals_minus_xg: Number(gap.toFixed(2)),
          matches: style.matches,
        },
        section: '§2.1',
        tier: 5,
      },
    ],
    strength: 0.25,
  });
}

export const _internals = { styleVector, mean };
