import { asArray, asRecord, bsdRaw, num, str } from './bsd.ts';
import { insertMany, select } from './store.ts';

/**
 * The match underneath the score, kept for every finished match we hold.
 *
 * The analysis could only say *that* a side makes chances (goals, shots and
 * expected goals per match). The provider also has, on the free plan, who
 * started and who was missing, and each player's numbers: his chances and
 * the chances he made for others, key passes, big chances created, how far
 * he carried the ball forward. That is what answers who makes a side tick,
 * how they get the ball forward, and what changes when he is not there.
 *
 * Two requests a match (`/lineups/`, `/player-stats/`), once, after full
 * time: a finished match never changes. Most recent first, a capped number a
 * run, inside the day's allowance (bsd.ts, quota), so a backfill of the past
 * months is spread over days.
 */

/** One player's match, compact: the numbers the analysis reads. */
export type DeepPlayer = [
  id: number, side: 0 | 1, starter: 0 | 1, minutes: number,
  xg: number, xa: number, shots: number, onTarget: number,
  keyPasses: number, bigChancesCreated: number, progressiveCarries: number,
  crossesWon: number, touches: number, oppHalfPasses: number, rating: number | null,
];

const n = (v: unknown) => num(v) ?? 0;
const round = (v: number, d = 2) => Number(v.toFixed(d));

/** The player rows of `/player-stats/`, compact, sided by the match's team ids. */
export function compactPlayers(raw: unknown, homeTeamId: number, starters: Set<number>): DeepPlayer[] {
  const rows = asArray(asRecord(raw)?.['player_stats']) ?? [];
  const out: DeepPlayer[] = [];
  for (const r of rows) {
    const p = asRecord(r);
    if (!p) continue;
    const id = num(p['player_id']);
    const minutes = n(p['minutes_played']);
    if (id === undefined || minutes <= 0) continue;
    out.push([
      id, num(p['team_id']) === homeTeamId ? 0 : 1, starters.has(id) ? 1 : 0, minutes,
      round(n(p['expected_goals'])), round(n(p['expected_assists'])), n(p['total_shots']), n(p['shots_on_target']),
      n(p['key_pass']), n(p['big_chance_created']), n(p['progressive_ball_carries_count']),
      n(p['accurate_cross']), n(p['touches']), n(p['accurate_opposition_half_passes']),
      num(p['rating']) ?? null,
    ]);
  }
  return out;
}

/** A side's starting eleven (player ids) and formation from `/lineups/`. */
export function sideLineup(raw: unknown, which: 'home' | 'away'): { formation: string | null; xi: number[]; out: Array<{ id: number; name: string; reason: string | null }> } {
  const r = asRecord(raw);
  const side = asRecord(asRecord(r?.['lineups'])?.[which]);
  const xi = (asArray(side?.['players']) ?? [])
    .map((p) => asRecord(p))
    .filter((p) => p && p['starting'] !== false)
    .map((p) => num(p!['id']))
    .filter((id): id is number => id !== undefined);
  const out = (asArray(asRecord(r?.['unavailable_players'])?.[which]) ?? [])
    .map((p) => asRecord(p))
    .filter(Boolean)
    .map((p) => ({ id: num(p!['id']) ?? 0, name: str(p!['name']) ?? '', reason: str(p!['reason']) ?? str(p!['status']) ?? null }))
    .filter((p) => p.id);
  return { formation: str(side?.['formation']) ?? null, xi, out };
}

export async function fetchDeep(limit = Number(process.env['DEEP_LIMIT'] || process.env['ARG'] || 300), windowDays = Number(process.env['DEEP_WINDOW_DAYS'] || 200)): Promise<{ fetched: number; missing: number; stopped: boolean }> {
  const since = Math.floor(Date.now() / 1000) - windowDays * 86400;
  const pending = await select<{ id: number; home_team_id: number }>(
    `SELECT m.id, m.home_team_id FROM match m
       LEFT JOIN match_deep d ON d.match_id = m.id
      WHERE d.match_id IS NULL AND m.home_goals IS NOT NULL AND m.kickoff >= ? AND m.kickoff < ?
      ORDER BY m.kickoff DESC LIMIT ?`,
    [since, Math.floor(Date.now() / 1000) - 3 * 3600, limit],
  );
  console.log(`deep: ${pending.length} finished matches to read`);
  const rows: Array<Record<string, unknown>> = [];
  let fetched = 0; let missing = 0; let stopped = false;
  const flush = async () => {
    if (!rows.length) return;
    await insertMany('match_deep',
      ['match_id', 'home_formation', 'away_formation', 'home_xi', 'away_xi', 'home_out', 'away_out', 'players', 'fetched_at'],
      rows.splice(0), { onConflict: 'ON CONFLICT(match_id) DO NOTHING' });
  };
  for (const m of pending) {
    const [lu, ps] = await Promise.all([bsdRaw(`/api/v2/events/${m.id}/lineups/`), bsdRaw(`/api/v2/events/${m.id}/player-stats/`)]);
    // The day's allowance is spent: stop, and pick up here next run.
    if ((!lu.ok && lu.status === 429) || (!ps.ok && ps.status === 429)) { stopped = true; break; }
    const home = sideLineup(lu.ok ? lu.data : null, 'home');
    const away = sideLineup(lu.ok ? lu.data : null, 'away');
    const starters = new Set([...home.xi, ...away.xi]);
    const players = compactPlayers(ps.ok ? ps.data : null, Number(m.home_team_id), starters);
    if (!players.length && !home.xi.length) missing++; else fetched++;
    // Kept even when empty, so a match the provider has nothing for is not asked again.
    rows.push({
      match_id: m.id, home_formation: home.formation, away_formation: away.formation,
      home_xi: JSON.stringify(home.xi), away_xi: JSON.stringify(away.xi),
      home_out: JSON.stringify(home.out), away_out: JSON.stringify(away.out),
      players: JSON.stringify(players), fetched_at: Math.floor(Date.now() / 1000),
    });
    if (rows.length >= 25) await flush();
  }
  await flush();
  console.log(`deep: ${fetched} read, ${missing} with nothing published${stopped ? '; stopped, the day\'s allowance is spent' : ''}`);
  return { fetched, missing, stopped };
}
