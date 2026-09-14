import { config } from '../config.ts';
import type { MatchRow, RatingSet, TeamRating } from '../types.ts';
import { fitDixonColes, defaultFitOptions, type FitResult } from './dixoncoles.ts';

/**
 * Goals and xG are two readings of the same underlying strength, and neither is
 * sufficient alone.
 *
 * Goals are what settles bets but are a noisy realisation — a season's worth of
 * finishing variance sits on top of the process we actually want to estimate.
 * xG is closer to that process but is itself a model, and the provider is
 * explicit that some of its xG is estimated rather than measured (whole
 * competitions are priced end to end by their own estimator).
 *
 * So: fit both, and blend with a weight that respects provenance. Where xG is
 * measured it gets its full configured weight; where the provider flags it as
 * estimated, that weight is halved, because an estimate of an estimate deserves
 * less say than a fact about goals.
 */

export interface BlendedRatings extends RatingSet {
  goalsFit: FitResult;
  xgFit: FitResult | null;
  /** Weight actually given to the xG fit after the provenance discount. */
  xgWeightApplied: number;
  /** Share of fitted matches whose xG the provider reported as measured. */
  measuredShare: number;
  converged: boolean;
}

export function fitBlended(matches: MatchRow[], leagueId: number, asOf: number): BlendedRatings {
  const goalsOpts = defaultFitOptions(asOf);
  const goalsFit = fitDixonColes(matches, leagueId, goalsOpts);

  const withXg = matches.filter(
    (m) => m.home_xg !== null && m.away_xg !== null && Number.isFinite(m.home_xg) && Number.isFinite(m.away_xg),
  );

  // Not enough xG to be worth fitting: say so and use goals alone rather than
  // blending toward a rating built on a handful of matches.
  if (withXg.length < Math.max(config.ratings.minMatches * 4, 40)) {
    return {
      params: goalsFit.params,
      teams: goalsFit.teams,
      goalsFit,
      xgFit: null,
      xgWeightApplied: 0,
      measuredShare: 0,
      converged: goalsFit.converged,
    };
  }

  const measured = withXg.filter((m) => m.xg_estimated === 0).length;
  const measuredShare = measured / withXg.length;

  const xgOpts = defaultFitOptions(asOf);
  xgOpts.useXg = true;
  // The low-score correction is a statement about discrete scorelines. A
  // continuous rate has no 1-1, so applying it would be meaningless.
  xgOpts.fitRho = false;
  xgOpts.rho = 0;
  const xgFit = fitDixonColes(withXg, leagueId, xgOpts);

  // Full weight where xG is measured, half where the provider estimated it.
  const w = config.ratings.xgWeight * (measuredShare + 0.5 * (1 - measuredShare));

  const teams = new Map<number, TeamRating>();
  for (const [id, g] of goalsFit.teams) {
    const x = xgFit.teams.get(id);
    if (!x) {
      teams.set(id, g);
      continue;
    }
    // Blend on the log scale, which is where the parameters live. Standard
    // errors combine as independent estimates: blending two readings should
    // leave us more certain than either, not less.
    const attack = (1 - w) * g.attack + w * x.attack;
    const defence = (1 - w) * g.defence + w * x.defence;
    const attack_se = Math.sqrt(
      (1 - w) ** 2 * g.attack_se ** 2 + w ** 2 * x.attack_se ** 2,
    );
    const defence_se = Math.sqrt(
      (1 - w) ** 2 * g.defence_se ** 2 + w ** 2 * x.defence_se ** 2,
    );
    teams.set(id, {
      team_id: id,
      attack,
      defence,
      attack_se,
      defence_se,
      matches: g.matches,
      shrunk: g.shrunk,
    });
  }

  // Keep the goals fit's scale: bets settle on goals, so the league's scoring
  // level and home advantage must be the ones observed in goals, with xG only
  // informing the relative standing of teams within that level.
  return {
    params: goalsFit.params,
    teams,
    goalsFit,
    xgFit,
    xgWeightApplied: w,
    measuredShare,
    converged: goalsFit.converged && xgFit.converged,
  };
}
