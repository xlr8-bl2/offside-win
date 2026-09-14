import { bsdList, bsdOrNull, asArray, asRecord, num, pickNum, pickBool, toEpoch, stats as bsdStats } from './bsd.ts';
import { config } from './config.ts';
import { insertMany, select, exec, kvSetJSON } from './store.ts';
import type { MatchRow } from './types.ts';

/**
 * Builds and maintains the fitting set.
 *
 * Everything the ratings, corner and card models learn from comes through here.
 * Two practical realities shape it:
 *
 * - The provider types the stats payload as `any`, so every metric is read
 *   through an alias list rather than a fixed path, and a miss produces `null`
 *   rather than a crash or a zero. A zero would be a lie — "no corners" and "we
 *   could not read the corners" are different facts and the model treats them
 *   differently.
 * - Pulling per-match stats is by far the most expensive part of a backfill, so
 *   matches are marked once fetched and never re-fetched, and the whole thing is
 *   resumable: a run that dies halfway leaves the work it did behind.
 */

// Aliases are deliberately generous. The provider's own naming is not pinned
// down by its schema, and a field that moves should degrade to "unknown", not
// take the parser down with it.
const ALIASES = {
  // xg.actual and expected_goals are both confirmed live: a finished match ships
  // `xg: { actual: number, estimated: boolean }` alongside a flat
  // `expected_goals`. Note that xg.estimated is a *flag*, not a value — it
  // belongs to xgEstimated below and must never be read as a quantity.
  xg: ['xg.actual', 'xg.value', 'xg.total', 'xg', 'expected_goals', 'expectedGoals', 'xg.xg'],
  xgEstimated: ['xg.estimated', 'xg_estimated', 'estimated'],
  corners: ['corners', 'corner_kicks', 'cornerKicks', 'corners.total', 'corners_total'],
  yellows: ['yellow_cards', 'yellowCards', 'yellows', 'cards.yellow', 'yellow'],
  reds: ['red_cards', 'redCards', 'reds', 'cards.red', 'red'],
  possession: ['possession', 'ball_possession', 'possession_pct', 'possession.percent', 'possessionPct'],
  shots: ['shots', 'shots_total', 'total_shots', 'shotsTotal', 'shots.total'],
  sot: ['shots_on_target', 'shotsOnTarget', 'shots_on_goal', 'sot', 'shots.on_target'],
} as const;

/** Find the home/away halves of a stats payload whatever they are called. */
function sides(statsPayload: unknown): { home: unknown; away: unknown } | null {
  const root = asRecord(statsPayload);
  if (!root) return null;

  for (const key of ['stats', 'teams', 'team_stats', 'data']) {
    const inner = asRecord(root[key]);
    if (inner) {
      const h = inner['home'] ?? inner['home_team'] ?? inner['homeTeam'];
      const a = inner['away'] ?? inner['away_team'] ?? inner['awayTeam'];
      if (h !== undefined && a !== undefined) return { home: h, away: a };
    }
    // Some feeds ship an array of two side objects instead of a keyed map.
    const arr = asArray(root[key]);
    if (arr && arr.length === 2) return { home: arr[0], away: arr[1] };
  }

  const h = root['home'] ?? root['home_team'];
  const a = root['away'] ?? root['away_team'];
  if (h !== undefined && a !== undefined) return { home: h, away: a };

  return null;
}

function metric(side: unknown, aliases: readonly string[]): number | null {
  const v = pickNum(side, ...aliases);
  return v === undefined ? null : v;
}

export interface ExtractedStats {
  home_xg: number | null;
  away_xg: number | null;
  xg_estimated: number | null;
  home_corners: number | null;
  away_corners: number | null;
  home_yellows: number | null;
  away_yellows: number | null;
  home_reds: number | null;
  away_reds: number | null;
  home_possession: number | null;
  away_possession: number | null;
  home_shots: number | null;
  away_shots: number | null;
  home_sot: number | null;
  away_sot: number | null;
}

export const EMPTY_STATS: ExtractedStats = {
  home_xg: null,
  away_xg: null,
  xg_estimated: null,
  home_corners: null,
  away_corners: null,
  home_yellows: null,
  away_yellows: null,
  home_reds: null,
  away_reds: null,
  home_possession: null,
  away_possession: null,
  home_shots: null,
  away_shots: null,
  home_sot: null,
  away_sot: null,
};

export function extractStats(payload: unknown): ExtractedStats {
  const s = sides(payload);
  if (!s) return { ...EMPTY_STATS };

  const rootEstimated = pickBool(payload, 'xg_estimated');
  const homeEstimated = pickBool(s.home, ...ALIASES.xgEstimated);
  const awayEstimated = pickBool(s.away, ...ALIASES.xgEstimated);

  // If any side says estimated, treat the match's xG as estimated. The blend
  // discounts estimated xG, and it is better to under-trust than over-trust it.
  const anyEstimated =
    rootEstimated === true || homeEstimated === true || awayEstimated === true
      ? 1
      : rootEstimated === false || homeEstimated === false || awayEstimated === false
        ? 0
        : null;

  const home_xg = metric(s.home, ALIASES.xg);
  const away_xg = metric(s.away, ALIASES.xg);

  return {
    home_xg,
    away_xg,
    // Only meaningful when there is xG to qualify.
    xg_estimated: home_xg === null && away_xg === null ? null : anyEstimated,
    home_corners: metric(s.home, ALIASES.corners),
    away_corners: metric(s.away, ALIASES.corners),
    home_yellows: metric(s.home, ALIASES.yellows),
    away_yellows: metric(s.away, ALIASES.yellows),
    home_reds: metric(s.home, ALIASES.reds),
    away_reds: metric(s.away, ALIASES.reds),
    home_possession: normalisePossession(metric(s.home, ALIASES.possession)),
    away_possession: normalisePossession(metric(s.away, ALIASES.possession)),
    home_shots: metric(s.home, ALIASES.shots),
    away_shots: metric(s.away, ALIASES.shots),
    home_sot: metric(s.home, ALIASES.sot),
    away_sot: metric(s.away, ALIASES.sot),
  };
}

/** Possession arrives as either 54 or 0.54 depending on the feed. */
function normalisePossession(v: number | null): number | null {
  if (v === null || !Number.isFinite(v) || v <= 0) return null;
  const pct = v <= 1 ? v * 100 : v;
  return pct > 5 && pct < 95 ? pct : null;
}

/**
 * Cards from the incidents feed, used when the stats payload has no card
 * counters. Incidents are a per-event list, so this counts rather than reads.
 */
export function extractCardsFromIncidents(
  payload: unknown,
  homeTeamId: number,
): { home_yellows: number; away_yellows: number; home_reds: number; away_reds: number } | null {
  const rec = asRecord(payload);
  const list = asArray(rec?.['incidents'] ?? rec?.['results'] ?? payload);
  if (!list) return null;

  let hy = 0;
  let ay = 0;
  let hr = 0;
  let ar = 0;
  let sawCard = false;

  for (const raw of list) {
    const inc = asRecord(raw);
    if (!inc) continue;
    const type = String(inc['incident_type'] ?? inc['type'] ?? inc['kind'] ?? '').toLowerCase();
    const detail = String(inc['incident_class'] ?? inc['detail'] ?? inc['card'] ?? inc['class'] ?? '').toLowerCase();
    const blob = `${type} ${detail}`;
    if (!blob.includes('card')) continue;
    sawCard = true;

    const teamId = num(inc['team_id'] ?? inc['teamId']);
    const isHomeFlag = inc['is_home'] ?? inc['isHome'] ?? inc['home'];
    const isHome =
      teamId !== undefined ? teamId === homeTeamId : isHomeFlag === true || isHomeFlag === 'home';

    // A second yellow is a dismissal; count it as red, as the market settles it.
    const isRed = blob.includes('red') || blob.includes('second');
    if (isRed) {
      if (isHome) hr++;
      else ar++;
    } else if (blob.includes('yellow')) {
      if (isHome) hy++;
      else ay++;
    }
  }

  if (!sawCard) return null;
  return { home_yellows: hy, away_yellows: ay, home_reds: hr, away_reds: ar };
}

// ------------------------------------------------------------- discovery

export interface LeagueInfo {
  id: number;
  name: string;
  country: string | null;
  season_id: number | null;
}

export async function discoverLeagues(): Promise<LeagueInfo[]> {
  const raw = await bsdList<Record<string, unknown>>('/api/v2/leagues/', {}, { limit: 200, max: 1000 });
  const all: LeagueInfo[] = [];
  for (const l of raw) {
    const id = num(l['id']);
    if (id === undefined) continue;
    all.push({
      id,
      name: String(l['name'] ?? `league ${id}`),
      country: (l['country'] as string | null) ?? null,
      season_id:
        num(l['season_id'] ?? l['current_season_id'] ?? pickNum(l, 'season.id', 'current_season.id')) ??
        null,
    });
  }

  if (config.leagues.length > 0) {
    const wanted = new Set(config.leagues);
    return all.filter((l) => wanted.has(l.id));
  }
  return all;
}

async function currentSeasonIds(leagueId: number, want: number): Promise<number[]> {
  const seasons = await bsdOrNull<unknown>(`/api/v2/leagues/${leagueId}/seasons/`);
  const list = asArray(asRecord(seasons)?.['results'] ?? asRecord(seasons)?.['seasons'] ?? seasons);
  if (!list) return [];
  const ids: Array<{ id: number; year: number }> = [];
  for (const raw of list) {
    const s = asRecord(raw);
    const id = num(s?.['id']);
    if (id === undefined) continue;
    const year =
      num(s?.['year']) ??
      num(String(s?.['name'] ?? '').slice(0, 4)) ??
      toEpoch(s?.['start_date']) ??
      id;
    ids.push({ id, year });
  }
  ids.sort((a, b) => b.year - a.year);
  return ids.slice(0, want).map((s) => s.id);
}

// ------------------------------------------------------------- backfill

export interface BackfillReport {
  leagues: number;
  eventsSeen: number;
  matchesWritten: number;
  statsFetched: number;
  statsFailed: number;
  requests: number;
}

export interface BackfillOptions {
  full?: boolean;
  /**
   * Overrides for a cold start, which wants a shallow first pass it can finish
   * inside one scheduled run. These are parameters rather than environment
   * writes because `config` reads the environment once at module load — setting
   * process.env at call time looks like it works and silently does nothing.
   */
  seasons?: number;
  statsWindowDays?: number;
  statsLimit?: number;
}

export async function backfillHistory(opts: BackfillOptions = {}): Promise<BackfillReport> {
  const leagues = await discoverLeagues();
  const now = Math.floor(Date.now() / 1000);
  const report: BackfillReport = {
    leagues: leagues.length,
    eventsSeen: 0,
    matchesWritten: 0,
    statsFetched: 0,
    statsFailed: 0,
    requests: 0,
  };

  console.log(`Backfilling ${leagues.length} leagues (${opts.full ? 'full' : 'incremental'})`);

  await insertMany(
    'league',
    ['id', 'name', 'country', 'season_id', 'tracked', 'updated_at'],
    leagues.map((l) => ({
      id: l.id,
      name: l.name,
      country: l.country,
      season_id: l.season_id,
      tracked: 1,
      updated_at: now,
    })),
    { conflictTarget: 'id' },
  );

  for (const league of leagues) {
    const seasonIds = await currentSeasonIds(league.id, opts.seasons ?? config.history.seasons);
    const seasons = seasonIds.length ? seasonIds : [league.season_id].filter((s): s is number => s !== null);

    // Incremental runs only need matches since the newest one already stored.
    let since: number | null = null;
    if (!opts.full) {
      const row = await select<{ mx: number | null }>(
        'SELECT MAX(kickoff) AS mx FROM match WHERE league_id = ?',
        [league.id],
      );
      since = row[0]?.mx ?? null;
    }

    const rows: MatchRow[] = [];
    for (const seasonId of seasons) {
      const events = await bsdList<Record<string, unknown>>(
        '/api/v2/events/',
        {
          league_id: league.id,
          season_id: seasonId,
          status: 'finished',
          ...(since ? { date_from: new Date((since - 86400) * 1000).toISOString() } : {}),
        },
        { limit: 200, max: 5000 },
      );
      report.eventsSeen += events.length;

      for (const e of events) {
        const id = num(e['id']);
        const hs = num(e['home_score']);
        const as_ = num(e['away_score']);
        const kickoff = toEpoch(e['event_date']);
        const homeId = num(e['home_team_id']);
        const awayId = num(e['away_team_id']);
        if (id === undefined || kickoff === undefined || homeId === undefined || awayId === undefined) continue;
        // Unplayed or abandoned: no result to learn from.
        if (hs === undefined || as_ === undefined) continue;

        rows.push({
          id,
          league_id: league.id,
          season_id: seasonId ?? null,
          kickoff,
          home_team_id: homeId,
          away_team_id: awayId,
          home_goals: hs,
          away_goals: as_,
          ...EMPTY_STATS,
          referee_id: num(e['referee_id']) ?? null,
        } as MatchRow);
      }
    }

    if (rows.length === 0) {
      console.log(`  ${league.name}: nothing new`);
      continue;
    }

    // Insert results first without stats; stats are filled in a second pass so
    // an interrupted run still leaves usable goal data behind.
    const written = await insertMany(
      'match',
      [
        'id', 'league_id', 'season_id', 'kickoff', 'home_team_id', 'away_team_id',
        'home_goals', 'away_goals', 'referee_id', 'updated_at',
      ],
      rows.map((r) => ({ ...r, updated_at: now })),
      {
        onConflict:
          'ON CONFLICT(id) DO UPDATE SET home_goals = excluded.home_goals, ' +
          'away_goals = excluded.away_goals, referee_id = excluded.referee_id, ' +
          'updated_at = excluded.updated_at',
      },
    );
    report.matchesWritten += written;
    console.log(`  ${league.name}: ${written} matches`);
  }

  const statsReport = await fetchMissingStats(opts.statsLimit, opts.statsWindowDays);
  report.statsFetched = statsReport.fetched;
  report.statsFailed = statsReport.failed;
  report.requests = bsdStats.requests;

  await kvSetJSON('history:last_run', { at: now, ...report });
  return report;
}

/**
 * Second pass: pull per-match stats for matches that do not have them yet.
 * Bounded by a window because a five-year-old match's corner count adds
 * nothing a decayed fit will notice.
 */
export async function fetchMissingStats(
  limit = 4000,
  windowDays?: number,
): Promise<{ fetched: number; failed: number }> {
  const cutoff =
    Math.floor(Date.now() / 1000) - (windowDays ?? config.history.statsWindowDays) * 86400;
  const pending = await select<{ id: number; home_team_id: number }>(
    `SELECT id, home_team_id FROM match
     WHERE stats_fetched = 0 AND kickoff >= ?
     ORDER BY kickoff DESC LIMIT ?`,
    [cutoff, limit],
  );

  if (pending.length === 0) return { fetched: 0, failed: 0 };
  console.log(`Fetching stats for ${pending.length} matches`);

  let fetched = 0;
  let failed = 0;
  const batch: Array<Record<string, unknown>> = [];
  const now = Math.floor(Date.now() / 1000);

  const flush = async () => {
    if (batch.length === 0) return;
    await insertMany(
      'match',
      [
        'id', 'home_xg', 'away_xg', 'xg_estimated', 'home_corners', 'away_corners',
        'home_yellows', 'away_yellows', 'home_reds', 'away_reds',
        'home_possession', 'away_possession', 'home_shots', 'away_shots',
        'home_sot', 'away_sot', 'stats_fetched', 'updated_at',
      ],
      batch.splice(0),
      {
        onConflict:
          'ON CONFLICT(id) DO UPDATE SET home_xg = excluded.home_xg, away_xg = excluded.away_xg, ' +
          'xg_estimated = excluded.xg_estimated, home_corners = excluded.home_corners, ' +
          'away_corners = excluded.away_corners, home_yellows = excluded.home_yellows, ' +
          'away_yellows = excluded.away_yellows, home_reds = excluded.home_reds, ' +
          'away_reds = excluded.away_reds, home_possession = excluded.home_possession, ' +
          'away_possession = excluded.away_possession, home_shots = excluded.home_shots, ' +
          'away_shots = excluded.away_shots, home_sot = excluded.home_sot, ' +
          'away_sot = excluded.away_sot, stats_fetched = 1, updated_at = excluded.updated_at',
      },
    );
  };

  // Modest parallelism; the client caps concurrency globally anyway.
  const queue = [...pending];
  const workers = Array.from({ length: config.bsd.concurrency }, async () => {
    for (;;) {
      const m = queue.shift();
      if (!m) break;
      const payload = await bsdOrNull(`/api/v2/events/${m.id}/stats/`);
      if (payload === null) {
        failed++;
        // Mark as attempted so a permanently statless match is not retried
        // every night for the rest of its life.
        batch.push({ id: m.id, ...EMPTY_STATS, stats_fetched: 1, updated_at: now });
        continue;
      }
      const extracted = extractStats(payload);

      // Cards often live in the incidents feed rather than the stats one.
      if (extracted.home_reds === null && extracted.home_yellows === null) {
        const inc = await bsdOrNull(`/api/v2/events/${m.id}/incidents/`);
        const cards = inc ? extractCardsFromIncidents(inc, m.home_team_id) : null;
        if (cards) Object.assign(extracted, cards);
      }

      batch.push({ id: m.id, ...extracted, stats_fetched: 1, updated_at: now });
      fetched++;
      if (batch.length >= 200) await flush();
    }
  });

  await Promise.all(workers);
  await flush();
  console.log(`  stats: ${fetched} fetched, ${failed} unavailable`);
  return { fetched, failed };
}

/** Load the fitting set for a league. */
export async function loadMatches(leagueId: number, sinceEpoch?: number): Promise<MatchRow[]> {
  return select<MatchRow>(
    `SELECT id, league_id, season_id, kickoff, home_team_id, away_team_id,
            home_goals, away_goals, home_xg, away_xg, xg_estimated,
            home_corners, away_corners, home_yellows, away_yellows,
            home_reds, away_reds, home_possession, away_possession,
            home_shots, away_shots, home_sot, away_sot, referee_id
     FROM match
     WHERE league_id = ? AND home_goals IS NOT NULL ${sinceEpoch ? 'AND kickoff >= ?' : ''}
     ORDER BY kickoff ASC`,
    sinceEpoch ? [leagueId, sinceEpoch] : [leagueId],
  );
}

export async function trackedLeagues(): Promise<Array<{ id: number; name: string; season_id: number | null }>> {
  return select('SELECT id, name, season_id FROM league WHERE tracked = 1 ORDER BY id');
}

export async function markUntracked(leagueIds: number[]): Promise<void> {
  if (leagueIds.length === 0) return;
  await exec(
    `UPDATE league SET tracked = 0 WHERE id IN (${leagueIds.map(() => '?').join(',')})`,
    leagueIds,
  );
}
