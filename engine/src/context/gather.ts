import { asArray, asRecord, bsdOrNull, bsdRaw, bsdList, num, pickNum, pickStr, str, toEpoch } from '../bsd.ts';
import { config } from '../config.ts';
import { buildBookMarkets, fetchQuotes } from '../odds.ts';
import { loadLeagueModel, loadRefereeRate } from '../ratings/fit.ts';
import { kvGetJSON, kvSetJSON, select } from '../store.ts';
import type { MatchRow } from '../types.ts';
import type {
  FixtureContext, LineupInfo, LineupPlayer, ManagerInfo, ManagerTenure,
  ScorerRow, SideContext, SideLineup, SquadPlayer, StandingRow,
} from './types.ts';

/**
 * Assembles everything the doctrine's factors read, for one fixture.
 *
 * Nothing here interprets. It fetches, coerces defensively, and hands over
 * nulls where the provider had nothing — the factor modules turn those nulls
 * into UNAVAILABLE entries, which is how §13's "state it as thin and exclude
 * it" ends up visible on the page rather than silently assumed away.
 */

// ------------------------------------------------------------ entitlement

const ENTITLEMENT_KEY = 'entitlement:odds_comparison';

/**
 * The per-bookmaker grid sits behind the provider's paid tier, and the promise
 * is that buying the tier lifts the restriction on its own with no code change.
 *
 * That only works if a "no" expires quickly. Caching one for a day meant the
 * grid stayed UNAVAILABLE for up to 24 hours after the tier was actually
 * bought — the restriction lifting itself, a day late. So only a "yes" is
 * cached: an entitlement does not get revoked mid-day, while a "no" is exactly
 * the answer that changes when someone upgrades.
 *
 * Re-probing a "no" is close to free. This runs once per slate, not once per
 * fixture, and within a run the client caches the 403 anyway.
 */
export async function checkComparisonEntitlement(sampleEventId: number): Promise<boolean> {
  const cached = await kvGetJSON<{ entitled: boolean }>(ENTITLEMENT_KEY);
  if (cached?.entitled === true) return true;

  const res = await bsdRaw(`/api/v2/events/${sampleEventId}/odds/comparison/`);
  const entitled = res.ok;
  if (entitled) {
    await kvSetJSON(ENTITLEMENT_KEY, { entitled: true }, 86400);
    if (cached?.entitled === false) {
      console.log('  per-bookmaker comparison is now entitled — sharp-reference factor is live');
    }
  } else {
    console.log('  per-bookmaker comparison is not entitled on this tier — sharp-reference factor will read UNAVAILABLE');
  }
  return entitled;
}

// ------------------------------------------------------------- coercion

function parseLineupSide(raw: unknown): SideLineup | null {
  const rec = asRecord(raw);
  if (!rec) return null;
  const list =
    asArray(rec['players']) ?? asArray(rec['starting']) ?? asArray(rec['lineup']) ?? asArray(raw);
  if (!list) return null;

  const players: LineupPlayer[] = [];
  for (const p of list) {
    const pr = asRecord(p);
    const id = num(pr?.['id'] ?? pr?.['player_id']);
    if (id === undefined) continue;
    players.push({
      id,
      name: str(pr?.['name'] ?? pr?.['short_name']) ?? `#${id}`,
      position: str(pr?.['position']) ?? null,
      // Absent "substitute" markers mean a flat XI list; treat those as starters.
      starting:
        pr?.['substitute'] === true || pr?.['is_substitute'] === true || pr?.['starting'] === false
          ? false
          : true,
      ai_score: num(pr?.['ai_score']) ?? null,
    });
  }
  return {
    formation: str(rec['formation']) ?? null,
    players,
    confidence: num(rec['confidence']) ?? null,
  };
}

export function parseLineups(raw: unknown): LineupInfo {
  const rec = asRecord(raw);
  const statusRaw = str(rec?.['lineup_status']);
  const status: LineupInfo['status'] =
    statusRaw === 'confirmed' ? 'confirmed' : statusRaw === 'predicted' ? 'predicted' : 'unavailable';

  const lineupsRec = asRecord(rec?.['lineups']);
  const home = parseLineupSide(lineupsRec?.['home']);
  const away = parseLineupSide(lineupsRec?.['away']);

  const unavailable: LineupInfo['unavailable'] = [];
  const un = rec?.['unavailable_players'];
  // Shipped either as a flat list or split by side; accept both.
  const lists: unknown[] = [];
  const unRec = asRecord(un);
  if (unRec) {
    for (const key of ['home', 'away', 'players', 'results']) {
      const l = asArray(unRec[key]);
      if (l) lists.push(...l);
    }
  }
  const flat = asArray(un);
  if (flat) lists.push(...flat);

  for (const raw2 of lists) {
    const p = asRecord(raw2);
    const id = num(p?.['id'] ?? p?.['player_id']);
    if (id === undefined) continue;
    unavailable.push({
      id,
      name: str(p?.['name'] ?? p?.['short_name']) ?? `#${id}`,
      team_id: num(p?.['team_id']) ?? null,
      reason:
        str(p?.['reason'] ?? p?.['injury_type'] ?? p?.['type'] ?? p?.['status'] ?? p?.['availability']) ??
        null,
    });
  }

  // The provider carries confidence *per side*, inside lineups.home and
  // lineups.away — not at the root, which is where this used to look. Reading
  // the root always produced undefined, so §3.1 rotation risk went THIN on every
  // fixture ever priced: a tier-1 factor, the heaviest weight in the coverage
  // score, permanently dark because of a one-level path error.
  //
  // Take the lower of the two sides. Rotation risk is about how sure we are of
  // the selection, and a fixture is only as settled as its less settled team —
  // averaging would let a confident home XI paper over a rotating away one.
  const sideConfidences = [home?.confidence, away?.confidence].filter(
    (c): c is number => typeof c === 'number',
  );
  const confidence = sideConfidences.length ? Math.min(...sideConfidences) : null;

  return {
    status,
    confidence,
    home,
    away,
    unavailable,
  };
}

export function parseSquad(raw: unknown): SquadPlayer[] | null {
  const rec = asRecord(raw);
  const list = asArray(rec?.['players'] ?? rec?.['results'] ?? raw);
  if (!list) return null;
  const out: SquadPlayer[] = [];
  for (const p of list) {
    const pr = asRecord(p);
    const id = num(pr?.['id']);
    if (id === undefined) continue;
    out.push({
      id,
      name: str(pr?.['name'] ?? pr?.['short_name']) ?? `#${id}`,
      position: str(pr?.['position']) ?? null,
      availability: str(pr?.['availability']) ?? null,
      injury_type: str(pr?.['injury_type']) ?? null,
      injury_expected_return: str(pr?.['injury_expected_return']) ?? null,
    });
  }
  return out;
}

export function parseStandings(raw: unknown): StandingRow[] | null {
  const rec = asRecord(raw);
  // League competitions return a flat array; cups return a groups map.
  let list = asArray(rec?.['standings'] ?? rec?.['results'] ?? raw);
  if (!list) {
    const groups = asRecord(rec?.['groups']);
    if (groups) {
      list = [];
      for (const g of Object.values(groups)) {
        const rows = asArray(asRecord(g)?.['standings'] ?? g);
        if (rows) list.push(...rows);
      }
    }
  }
  if (!list) return null;

  const out: StandingRow[] = [];
  for (const r of list) {
    const row = asRecord(r);
    const teamId = num(row?.['team_id'] ?? pickNum(row, 'team.id'));
    if (teamId === undefined) continue;
    out.push({
      team_id: teamId,
      position: num(row?.['position'] ?? row?.['rank']) ?? 0,
      played: num(row?.['played'] ?? row?.['matches']) ?? 0,
      // The provider abbreviates: pts, gd, gf, ga. Reading only the spelled-out
      // names returned undefined and fell through to 0, so every table row
      // arrived on nil points with no goal difference — which does not fail, it
      // just quietly tells §5.1 that every side is level on nothing and makes a
      // run-in indistinguishable from a dead rubber.
      points: num(row?.['points'] ?? row?.['pts']) ?? 0,
      goal_diff:
        num(row?.['goal_diff'] ?? row?.['goal_difference'] ?? row?.['gd']) ??
        (num(row?.['goals_for'] ?? row?.['gf']) ?? 0) -
          (num(row?.['goals_against'] ?? row?.['ga']) ?? 0),
    });
  }
  return out.length ? out.sort((a, b) => a.position - b.position) : null;
}

export function parseManagerCareer(
  raw: unknown,
  teamId: number,
  asOf: number,
): ManagerInfo | null {
  const rec = asRecord(raw);
  const id = num(rec?.['manager_id']);
  const tenures = asArray(rec?.['tenures']);
  if (!tenures) return null;

  let current: ManagerTenure | null = null;
  for (const t of tenures) {
    const tr = asRecord(t);
    if (num(tr?.['team_id']) !== teamId) continue;
    const from = toEpoch(tr?.['date_from']) ?? null;
    const to = toEpoch(tr?.['date_to']) ?? null;
    // The spell covering this fixture: started before it, and either ongoing or
    // ended after it.
    if (from !== null && from <= asOf && (to === null || to >= asOf)) {
      const ae = asRecord(tr?.['appointment_effect']);
      current = {
        team_id: teamId,
        team_name: str(tr?.['team_name']) ?? null,
        date_from: from,
        date_to: to,
        matches: num(tr?.['matches']) ?? 0,
        ppm: num(tr?.['ppm']) ?? null,
        appointment_effect: ae
          ? {
              before_ppm: pickNum(ae, 'before_ppm', 'before.ppm', 'ppm_before', 'before') ?? null,
              after_ppm: pickNum(ae, 'after_ppm', 'after.ppm', 'ppm_after', 'after') ?? null,
              delta: pickNum(ae, 'delta', 'difference', 'change') ?? null,
            }
          : null,
      };
      break;
    }
  }

  if (!current) return id === undefined ? null : { id, name: null, current: null, matchesInCharge: null, tenureDays: null };

  const tenureDays = current.date_from !== null ? (asOf - current.date_from) / 86400 : null;
  return {
    id: id ?? 0,
    name: str(rec?.['name']) ?? null,
    current,
    matchesInCharge: current.matches,
    tenureDays,
  };
}

export function parseScorers(raw: unknown): ScorerRow[] | null {
  const rec = asRecord(raw);
  const list = asArray(rec?.['results'] ?? rec?.['players'] ?? rec?.['top'] ?? raw);
  if (!list) return null;
  const out: ScorerRow[] = [];
  for (const r of list) {
    const row = asRecord(r);
    const id = num(row?.['player_id'] ?? pickNum(row, 'player.id') ?? row?.['id']);
    if (id === undefined) continue;
    out.push({
      player_id: id,
      name: str(row?.['name'] ?? pickStr(row, 'player.name')) ?? `#${id}`,
      goals: num(row?.['goals'] ?? row?.['value'] ?? row?.['total']) ?? 0,
      assists: num(row?.['assists']) ?? 0,
    });
  }
  return out.length ? out : null;
}

// --------------------------------------------------------------- gather

async function sideContext(
  teamId: number,
  teamName: string,
  leagueId: number,
  coachId: number | null,
  kickoff: number,
  standings: StandingRow[] | null,
): Promise<SideContext> {
  const [squadRaw, scorersRaw, careerRaw, recent, schedule] = await Promise.all([
    bsdOrNull(`/api/v2/teams/${teamId}/squad/`),
    bsdOrNull(`/api/v2/leagues/${leagueId}/top/scorers/`, { team_id: teamId, limit: 50 }),
    coachId ? bsdOrNull(`/api/v2/managers/${coachId}/career/`) : Promise.resolve(null),
    loadRecentMatches(teamId, kickoff),
    loadSchedule(teamId, kickoff),
  ]);

  return {
    team_id: teamId,
    team_name: teamName,
    squad: parseSquad(squadRaw),
    scorers: parseScorers(scorersRaw),
    manager: careerRaw ? parseManagerCareer(careerRaw, teamId, kickoff) : null,
    standing: standings?.find((s) => s.team_id === teamId) ?? null,
    recent,
    lastLineupIds: null,
    schedule: schedule.length ? schedule : null,
  };
}

/**
 * Recent matches from our own history table rather than the provider — it is
 * already populated by the backfill, and reading locally keeps a slate of
 * eighty fixtures from turning into hundreds of extra calls.
 */
async function loadRecentMatches(teamId: number, before: number, limit = 12): Promise<MatchRow[]> {
  return select<MatchRow>(
    `SELECT id, league_id, season_id, kickoff, home_team_id, away_team_id,
            home_goals, away_goals, home_xg, away_xg, xg_estimated,
            home_corners, away_corners, home_yellows, away_yellows,
            home_reds, away_reds, home_possession, away_possession,
            home_shots, away_shots, home_sot, away_sot, referee_id
     FROM match
     WHERE (home_team_id = ? OR away_team_id = ?) AND kickoff < ?
     ORDER BY kickoff DESC LIMIT ?`,
    [teamId, teamId, before, limit],
  );
}

/**
 * Fixtures either side of this one, including ones not yet played. Congestion
 * is about the schedule, not only about history, so this asks the provider
 * rather than reading our finished-matches table.
 */
export async function loadSchedule(teamId: number, around: number): Promise<number[]> {
  const from = new Date((around - 21 * 86400) * 1000).toISOString();
  const to = new Date((around + 14 * 86400) * 1000).toISOString();
  const rows = await bsdList<Record<string, unknown>>(
    `/api/v2/teams/${teamId}/fixtures/`,
    { date_from: from, date_to: to },
    { limit: 100, max: 100 },
  );
  return rows
    .map((r) => toEpoch(r['event_date']))
    .filter((t): t is number => t !== undefined)
    .sort((a, b) => a - b);
}

export interface GatherOptions {
  /** Skip network-heavy extras when pricing a large slate. */
  light?: boolean;
}

export async function gatherFixture(
  event: Record<string, unknown>,
  opts: GatherOptions = {},
): Promise<FixtureContext | null> {
  const fixtureId = num(event['id']);
  const leagueId = num(event['league_id']);
  const kickoff = toEpoch(event['event_date']);
  const homeId = num(event['home_team_id']);
  const awayId = num(event['away_team_id']);
  if (fixtureId === undefined || leagueId === undefined || kickoff === undefined) return null;
  if (homeId === undefined || awayId === undefined) return null;

  const model = await loadLeagueModel(leagueId);
  // No fitted ratings means no opinion of our own, and an opinion is the whole
  // product. Skip rather than fall back to the bookmaker's number dressed up.
  if (!model) return null;

  const [standingsRaw, lineupsRaw, quotes, polymarket, prediction, h2h, referee] = await Promise.all([
    bsdOrNull(`/api/v2/leagues/${leagueId}/standings/`),
    bsdOrNull(`/api/v2/events/${fixtureId}/lineups/`),
    fetchQuotes(fixtureId),
    opts.light ? Promise.resolve(null) : bsdOrNull(`/api/v2/events/${fixtureId}/polymarket/`),
    opts.light ? Promise.resolve(null) : bsdOrNull(`/api/v2/events/${fixtureId}/prediction/`),
    opts.light ? Promise.resolve(null) : bsdOrNull(`/api/v2/events/${fixtureId}/h2h/`),
    loadRefereeRate(num(event['referee_id']) ?? null),
  ]);

  const standings = parseStandings(standingsRaw);

  const [home, away] = await Promise.all([
    sideContext(
      homeId,
      str(event['home_team']) ?? `team ${homeId}`,
      leagueId,
      num(event['home_coach_id']) ?? null,
      kickoff,
      standings,
    ),
    sideContext(
      awayId,
      str(event['away_team']) ?? `team ${awayId}`,
      leagueId,
      num(event['away_coach_id']) ?? null,
      kickoff,
      standings,
    ),
  ]);

  const leagueRow = await select<{ name: string }>('SELECT name FROM league WHERE id = ?', [leagueId]);

  return {
    fixture_id: fixtureId,
    league_id: leagueId,
    league_name: leagueRow[0]?.name ?? `league ${leagueId}`,
    kickoff,
    now: Math.floor(Date.now() / 1000),
    home,
    away,
    event,
    lineups: parseLineups(lineupsRaw),
    referee,
    standings,
    seasonRounds: standings ? estimateRounds(standings) : null,
    round: num(event['round_number']) ?? null,
    h2h,
    reverseFixture: await loadReverseFixture(homeId, awayId, kickoff),
    styleMatches: { home: home.recent, away: away.recent },
    model,
    quotes,
    book: buildBookMarkets(quotes),
    polymarket,
    prediction,
    comparisonEntitled: false,
  };
}

/**
 * The most recent meeting with the sides reversed — the fixture §5.3's revenge
 * read is about. Looked up directly rather than hoped for in the recent-form
 * window, where a first-half-of-season meeting will usually have fallen out.
 */
async function loadReverseFixture(
  homeId: number,
  awayId: number,
  before: number,
): Promise<MatchRow | null> {
  const rows = await select<MatchRow>(
    `SELECT id, league_id, season_id, kickoff, home_team_id, away_team_id,
            home_goals, away_goals, home_xg, away_xg, xg_estimated,
            home_corners, away_corners, home_yellows, away_yellows,
            home_reds, away_reds, home_possession, away_possession,
            home_shots, away_shots, home_sot, away_sot, referee_id
     FROM match
     WHERE home_team_id = ? AND away_team_id = ? AND kickoff < ? AND home_goals IS NOT NULL
     ORDER BY kickoff DESC LIMIT 1`,
    [awayId, homeId, before],
  );
  return rows[0] ?? null;
}

/**
 * Total rounds in the season, inferred from the table size. Needed to tell a
 * relegation six-pointer in April from the same fixture in September — §5.1
 * turns entirely on how many games are left.
 */
function estimateRounds(standings: StandingRow[]): number | null {
  const n = standings.length;
  return n >= 4 ? (n - 1) * 2 : null;
}

export const _internals = { estimateRounds, loadRecentMatches };
