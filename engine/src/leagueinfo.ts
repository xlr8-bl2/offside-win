/**
 * Every competition's own page, kept full whether or not it is on the board.
 *
 * A competition's table and top scorers used to be written only when the
 * slate had one of its games in its window, and its games only came through
 * the board, which reaches three days ahead. So during an international break
 * the Premier League's page had no table, no scorers and no games: a link to
 * it, from the footer or anywhere else, opened an empty page.
 *
 * This keeps, for every competition we cover, the table, the top scorers, the
 * next games (up to five weeks out) and the latest results, in kv beside the
 * slate's own (league:<id>:standings, :scorers, :next, :last), refreshed every
 * three hours from inside the slate loop. get_league reads them.
 */

import { bsdList, bsdOrNull, num, str, toEpoch } from './bsd.ts';
import { parseScorers, parseStandings } from './context/gather.ts';
import { kvGetJSON, kvSetJSON, select } from './store.ts';

const EVERY = 3 * 3600;
const DAY = 86400;

export interface LeagueGame {
  id: number;
  kickoff: number;
  home: string;
  away: string;
  home_id: number | null;
  away_id: number | null;
  status: string;
  score: [number, number] | null;
  round: string | null;
}

/** A provider event, compact, as a competition page lists it. */
export function leagueGame(raw: Record<string, unknown>): LeagueGame | null {
  const id = num(raw['id']);
  const kickoff = toEpoch(raw['event_date']);
  const home = str(raw['home_team']);
  const away = str(raw['away_team']);
  if (id === undefined || kickoff === undefined || !home || !away) return null;
  const hs = num(raw['home_score']);
  const as = num(raw['away_score']);
  const status = String(raw['status'] ?? '').toLowerCase();
  return {
    id, kickoff, home, away,
    home_id: num(raw['home_team_id']) ?? null,
    away_id: num(raw['away_team_id']) ?? null,
    status,
    score: /finish|ended|after/.test(status) && hs !== undefined && as !== undefined ? [hs, as] : null,
    round: str(raw['round_label'])?.split(/\s*·\s*/).pop() ?? null,
  };
}

async function one(leagueId: number, now: number): Promise<void> {
  const day = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);
  const [standingsRaw, scorersRaw, ahead, behind] = await Promise.all([
    bsdOrNull(`/api/v2/leagues/${leagueId}/standings/`),
    bsdOrNull(`/api/v2/leagues/${leagueId}/top/scorers/`, { limit: 15 }),
    bsdList<Record<string, unknown>>('/api/v2/events/', { league_id: leagueId, date_from: day(now), date_to: day(now + 35 * DAY) }, { limit: 50, max: 50 }),
    bsdList<Record<string, unknown>>('/api/v2/events/', { league_id: leagueId, date_from: day(now - 21 * DAY), date_to: day(now) }, { limit: 100, max: 100 }),
  ]);
  const standings = parseStandings(standingsRaw);
  if (standings?.length) await kvSetJSON(`league:${leagueId}:standings`, { updated_at: now, rows: standings });
  const scorers = parseScorers(scorersRaw);
  if (scorers?.length) await kvSetJSON(`league:${leagueId}:scorers`, { updated_at: now, rows: scorers });
  // Whole rounds, not the first twelve games: a Champions League matchday is
  // eighteen, and the page was showing two thirds of one.
  const next = ahead.map(leagueGame).filter((g): g is LeagueGame => !!g && g.kickoff > now && !g.score)
    .sort((a, b) => a.kickoff - b.kickoff).slice(0, 40);
  const last = behind.map(leagueGame).filter((g): g is LeagueGame => !!g && !!g.score)
    .sort((a, b) => b.kickoff - a.kickoff).slice(0, 40);
  // A competition that played in the last three weeks and came back with no
  // results says why in the log: how many events, and what they were marked.
  // Shapes only -- the repo is public.
  if (!last.length && behind.length) {
    const marks = [...new Set(behind.map((e) => String(e['status'] ?? '?')))].slice(0, 6).join(', ');
    const scored = behind.filter((e) => num(e['home_score']) !== undefined).length;
    console.log(`  leagueinfo: ${leagueId} had ${behind.length} events in three weeks, none read as a result (status: ${marks}; ${scored} with a home_score)`);
  } else if (!behind.length && standings?.length) {
    console.log(`  leagueinfo: ${leagueId} has a table but no events in the last three weeks`);
  }
  await kvSetJSON(`league:${leagueId}:next`, { updated_at: now, rows: next });
  await kvSetJSON(`league:${leagueId}:last`, { updated_at: now, rows: last });
}

/**
 * Refresh every covered competition, at most once every three hours. Never
 * throws: a competition that fails keeps what it had.
 */
export async function refreshLeagueInfo(now = Math.floor(Date.now() / 1000), force = false): Promise<number> {
  const at = await kvGetJSON<number>('leagueinfo:at');
  if (!force && at && now - at < EVERY) return 0;
  await kvSetJSON('leagueinfo:at', now);
  const leagues = (await select<{ league_id: number }>('SELECT league_id FROM rating_meta')).map((r) => Number(r.league_id));
  let done = 0;
  let next = 0;
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (next < leagues.length) {
      const id = leagues[next++]!;
      try { await one(id, now); done++; } catch { /* keeps what it had */ }
    }
  }));
  console.log(`leagueinfo: ${done} of ${leagues.length} competitions refreshed`);
  return done;
}
