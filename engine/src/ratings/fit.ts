import { config } from '../config.ts';
import { loadMatches, trackedLeagues } from '../history.ts';
import { insertMany, kvSetJSON, select } from '../store.ts';
import type { LeagueParams, RatingSet, RefereeRate, TeamRate } from '../types.ts';
import { fitBlended } from './blend.ts';
import { fitRates, fitRefereeRates, type RateModels } from './rates.ts';

/** Fit every tracked league and persist the results. */
export async function fitAllLeagues(): Promise<{ leagues: number; teams: number; referees: number }> {
  const leagues = await trackedLeagues();
  const now = Math.floor(Date.now() / 1000);
  let teamsWritten = 0;
  const allReferees = new Map<number, RefereeRate>();

  for (const league of leagues) {
    const matches = await loadMatches(league.id);
    if (matches.length < config.ratings.minMatches * 4) {
      console.log(`  ${league.name}: ${matches.length} matches — too few to fit, skipping`);
      continue;
    }

    const blended = fitBlended(matches, league.id, now);
    const rates = fitRates(matches, now);

    console.log(
      `  ${league.name}: ${matches.length} matches, ${blended.teams.size} teams, ` +
        `rho ${blended.params.rho.toFixed(3)}, home ${blended.params.home_adv.toFixed(3)}, ` +
        `xG weight ${blended.xgWeightApplied.toFixed(2)} (${(blended.measuredShare * 100).toFixed(0)}% measured)` +
        `${blended.converged ? '' : ' [DID NOT CONVERGE]'}`,
    );

    await persistRatings(league.id, blended, rates, now);
    teamsWritten += blended.teams.size;

    for (const [id, r] of fitRefereeRates(matches)) {
      const prev = allReferees.get(id);
      if (!prev) {
        allReferees.set(id, r);
      } else {
        // A referee can work more than one competition; pool rather than
        // letting the last league fitted overwrite the others.
        const n = prev.matches + r.matches;
        allReferees.set(id, {
          referee_id: id,
          name: prev.name ?? r.name,
          matches: n,
          yellows_per: (prev.yellows_per * prev.matches + r.yellows_per * r.matches) / n,
          reds_per: (prev.reds_per * prev.matches + r.reds_per * r.matches) / n,
        });
      }
    }
  }

  if (allReferees.size > 0) {
    await insertMany(
      'referee_rate',
      ['referee_id', 'name', 'matches', 'yellows_per', 'reds_per', 'fitted_at'],
      [...allReferees.values()].map((r) => ({ ...r, fitted_at: now })),
      { conflictTarget: 'referee_id' },
    );
  }

  await kvSetJSON('ratings:last_fit', {
    at: now,
    leagues: leagues.length,
    teams: teamsWritten,
    referees: allReferees.size,
  });

  return { leagues: leagues.length, teams: teamsWritten, referees: allReferees.size };
}

async function persistRatings(
  leagueId: number,
  set: RatingSet,
  rates: RateModels,
  now: number,
): Promise<void> {
  await insertMany(
    'rating_meta',
    ['league_id', 'home_adv', 'rho', 'xi', 'mean_goals', 'n_matches', 'log_lik', 'fitted_at'],
    [{ ...set.params, fitted_at: now }],
    { conflictTarget: 'league_id' },
  );

  await insertMany(
    'rating',
    ['league_id', 'team_id', 'attack', 'defence', 'attack_se', 'defence_se', 'matches', 'shrunk', 'fitted_at'],
    [...set.teams.values()].map((t) => ({ league_id: leagueId, ...t, fitted_at: now })),
    { conflictTarget: 'league_id, team_id' },
  );

  await insertMany(
    'team_rate',
    [
      'league_id', 'team_id', 'corners_for', 'corners_against', 'corners_disp',
      'yellows_for', 'reds_for', 'matches', 'fitted_at',
    ],
    [...rates.teams.values()].map((t) => ({ league_id: leagueId, ...t, fitted_at: now })),
    { conflictTarget: 'league_id, team_id' },
  );

  // The rate models' league-level constants are needed at pricing time and do
  // not fit the per-team tables.
  await kvSetJSON(`rates:league:${leagueId}`, {
    corners: {
      leagueMean: rates.corners.leagueMean,
      dispersion: rates.corners.dispersion,
      homeShare: rates.corners.homeShare,
    },
    reds: { leagueMean: rates.reds.leagueMean, homeShare: rates.reds.homeShare },
    yellows: { leagueMean: rates.yellows.leagueMean, homeShare: rates.yellows.homeShare },
  });
}

// ------------------------------------------------------------ load side

export interface LoadedLeagueModel {
  params: LeagueParams;
  ratings: RatingSet;
  rates: {
    corners: { leagueMean: number; dispersion: number; homeShare: number };
    reds: { leagueMean: number; homeShare: number };
    yellows: { leagueMean: number; homeShare: number };
    teams: Map<number, TeamRate>;
  };
}

export async function loadLeagueModel(leagueId: number): Promise<LoadedLeagueModel | null> {
  const meta = await select<LeagueParams & { fitted_at: number }>(
    'SELECT league_id, home_adv, rho, xi, mean_goals, n_matches, log_lik FROM rating_meta WHERE league_id = ?',
    [leagueId],
  );
  if (meta.length === 0) return null;

  const ratingRows = await select<{
    team_id: number;
    attack: number;
    defence: number;
    attack_se: number;
    defence_se: number;
    matches: number;
    shrunk: number;
  }>(
    'SELECT team_id, attack, defence, attack_se, defence_se, matches, shrunk FROM rating WHERE league_id = ?',
    [leagueId],
  );

  const rateRows = await select<TeamRate & { league_id: number }>(
    `SELECT team_id, corners_for, corners_against, corners_disp, yellows_for, reds_for, matches
     FROM team_rate WHERE league_id = ?`,
    [leagueId],
  );

  const kv = await select<{ v: string }>('SELECT v FROM kv WHERE k = ?', [`rates:league:${leagueId}`]);
  const leagueRates = kv[0]
    ? (JSON.parse(kv[0].v) as LoadedLeagueModel['rates'])
    : {
        corners: { leagueMean: 5.2, dispersion: 1.2, homeShare: 0.55 },
        reds: { leagueMean: 0.06, homeShare: 0.45 },
        yellows: { leagueMean: 1.9, homeShare: 0.47 },
      };

  return {
    params: meta[0]!,
    ratings: { params: meta[0]!, teams: new Map(ratingRows.map((r) => [r.team_id, r])) },
    rates: { ...leagueRates, teams: new Map(rateRows.map((r) => [r.team_id, r])) },
  };
}

/**
 * Expected corners for a fixture from a model loaded out of D1.
 *
 * The fitting path and the serving path need the same arithmetic from different
 * shapes, and reconstructing a fitted-model object at serving time just to reuse
 * one function is the kind of indirection that hides bugs. These take the loaded
 * shape directly.
 */
export function expectedCornersFrom(
  model: LoadedLeagueModel,
  homeTeamId: number,
  awayTeamId: number,
): { home: number; away: number; dispersion: number } {
  const base = model.rates.corners.leagueMean;
  const h = model.rates.teams.get(homeTeamId);
  const a = model.rates.teams.get(awayTeamId);

  // Effects are stored as absolute rates; convert back to multipliers against
  // the league mean so an unseen team lands on average rather than on zero.
  const hFor = h && base > 0 ? h.corners_for / base : 1;
  const hAgainst = h && base > 0 ? h.corners_against / base : 1;
  const aFor = a && base > 0 ? a.corners_for / base : 1;
  const aAgainst = a && base > 0 ? a.corners_against / base : 1;

  const share = model.rates.corners.homeShare;
  return {
    home: base * hFor * aAgainst * 2 * share,
    away: base * aFor * hAgainst * 2 * (1 - share),
    dispersion: model.rates.corners.dispersion,
  };
}

/**
 * Expected red cards. The referee multiplier only applies once the sample gate
 * is cleared — §13's worked example is a referee with eleven games getting no
 * tendency assessment — and is bounded, because an unbounded multiplier on an
 * event this rare is a liability rather than a signal.
 */
export function expectedRedsFrom(
  model: LoadedLeagueModel,
  homeTeamId: number,
  awayTeamId: number,
  referee: RefereeRate | null,
): { total: number; refereeApplied: boolean } {
  const base = model.rates.reds.leagueMean;
  const h = model.rates.teams.get(homeTeamId);
  const a = model.rates.teams.get(awayTeamId);
  const hFor = h && base > 0 ? h.reds_for / base : 1;
  const aFor = a && base > 0 ? a.reds_for / base : 1;

  let total = base * hFor + base * aFor;
  let refereeApplied = false;

  if (referee && referee.matches >= config.gates.refereeMatches && base > 0) {
    const mult = referee.reds_per / (2 * base);
    if (Number.isFinite(mult) && mult > 0) {
      total *= Math.max(0.6, Math.min(1.8, mult));
      refereeApplied = true;
    }
  }
  return { total: Math.max(0, total), refereeApplied };
}

export async function loadRefereeRate(refereeId: number | null): Promise<RefereeRate | null> {
  if (refereeId === null) return null;
  const rows = await select<RefereeRate>(
    'SELECT referee_id, name, matches, yellows_per, reds_per FROM referee_rate WHERE referee_id = ?',
    [refereeId],
  );
  return rows[0] ?? null;
}
