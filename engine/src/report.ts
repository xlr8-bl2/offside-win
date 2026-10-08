import { bsdOrNull } from './bsd.ts';
import { exec, select } from './store.ts';

/**
 * The match report: what happened, once it has.
 *
 * Who scored and when, from whose pass, who was booked and why, who came on
 * for whom, how each player was rated, and the team numbers a fan looks at
 * after the whistle. All of it is on the provider after full time, spread
 * over four feeds, and none of it reached a page: the fixture's write-up is
 * frozen at kick-off, so anything that happens during the match has to live
 * in its own column. This module reads the four feeds into one compact
 * record, `fixture.report_json`, written once per finished match.
 *
 * Shapes are from the probe (`npm run probe:report`, September 2026):
 *
 *   incidents: { type: 'goal', minute, added_time, is_home, player, player_id,
 *                assist, goal_type, home_score, away_score }
 *              { type: 'card', minute, added_time, is_home, player, player_id,
 *                card_type: 'yellow' | 'yellowRed' | 'red', reason }
 *              { type: 'substitution', minute, added_time, is_home,
 *                player_in, player_in_id, player_out, player_out_id }
 *              { type: 'period', text: 'HT' | 'FT', minute, home_score, away_score }
 *   player-stats: rows of { player_id, team_id, minutes_played, rating, goals,
 *                goal_assist, yellow_card, red_card, saves, total_shots,
 *                shots_on_target, key_pass, ... }
 *   stats: { home: { ball_possession, total_shots, shots_on_target,
 *                corner_kicks, fouls, yellow_cards, red_cards, big_chances,
 *                passes, pass_accuracy_pct, offsides, goalkeeper_saves, ... },
 *            away: { ... } }
 *   lineups: { lineups: { home: { formation, players[], substitutes[] } } }
 *
 * Everything is read defensively and an absent field is absent in the
 * record, never guessed.
 */

export * from './report-parse.ts';
import {
  num, str, parseIncidents, parsePlayerStats, parseReportLineups, parseTeamStats,
  type MatchReport,
} from './report-parse.ts';

const rec = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const arr = (v: unknown): unknown[] | null => (Array.isArray(v) ? v : null);
const n = (v: unknown): number | null => num(v) ?? null;
const s = (v: unknown): string | null => str(v) ?? null;

/** Read the four feeds for one finished match. Null when none answered. */
export async function fetchReport(fixtureId: number, now = Math.floor(Date.now() / 1000)): Promise<MatchReport | null> {
  const [event, incidents, playerStats, stats, lineups] = await Promise.all([
    bsdOrNull<Record<string, unknown>>(`/api/v2/events/${fixtureId}/`),
    bsdOrNull(`/api/v2/events/${fixtureId}/incidents/`),
    bsdOrNull(`/api/v2/events/${fixtureId}/player-stats/`),
    bsdOrNull(`/api/v2/events/${fixtureId}/stats/`),
    bsdOrNull(`/api/v2/events/${fixtureId}/lineups/`),
  ]);
  if (!event && !incidents && !playerStats && !stats) return null;

  const inc = parseIncidents(incidents);
  const hth = num(event?.['home_score_ht']);
  const ath = num(event?.['away_score_ht']);
  const highlights = (arr(event?.['highlights']) ?? []).flatMap((h) => {
    const r = rec(h);
    const url = str(r?.['url']);
    return r && url ? [{ kind: s(r['kind']), title: s(r['title']), url, thumbnail: s(r['thumbnail']) }] : [];
  });

  return {
    fetched_at: now,
    ht: inc.ht ?? (hth !== undefined && ath !== undefined ? [hth, ath] : null),
    attendance: n(event?.['attendance']),
    highlights,
    events: inc.events,
    players: parsePlayerStats(playerStats),
    stats: parseTeamStats(stats),
    lineups: parseReportLineups(lineups),
  };
}

/**
 * Write reports for the finished fixtures that have none.
 *
 * `ids` narrows it to fixtures a caller already knows are over (the slate's
 * window); without it the recent past is swept, which is how the settle pass
 * catches anything the slate did not see finish. Bounded per call so one run
 * cannot spend its whole budget on the provider.
 */
export async function writeMissingReports(opts: { ids?: number[]; sinceDays?: number; limit?: number } = {}): Promise<number> {
  const limit = opts.limit ?? 40;
  const now = Math.floor(Date.now() / 1000);
  let rows: Array<{ id: number }>;
  if (opts.ids) {
    if (!opts.ids.length) return 0;
    // In pieces: D1 takes at most a hundred values in one statement.
    rows = [];
    for (let i = 0; i < opts.ids.length && rows.length < limit; i += 90) {
      const part = opts.ids.slice(i, i + 90);
      rows.push(...await select<{ id: number }>(
        `SELECT id FROM fixture WHERE report_json IS NULL AND home_goals IS NOT NULL
           AND id IN (${part.map(() => '?').join(',')}) LIMIT ?`,
        [...part, limit - rows.length],
      ));
    }
  } else {
    rows = await select<{ id: number }>(
      `SELECT id FROM fixture WHERE report_json IS NULL AND home_goals IS NOT NULL
         AND kickoff > ? ORDER BY kickoff DESC LIMIT ?`,
      [now - (opts.sinceDays ?? 7) * 86400, limit],
    );
  }
  let written = 0;
  for (const r of rows) {
    const id = Number(r.id);
    const report = await fetchReport(id, now);
    // A match with nothing on any feed gets an empty record rather than
    // being asked for again every run; the feeds are re-read only if the
    // record is cleared by hand.
    await exec('UPDATE fixture SET report_json = ? WHERE id = ?', [
      JSON.stringify(report ?? { fetched_at: now, ht: null, attendance: null, highlights: [], events: [], players: [], stats: null, lineups: null }),
      id,
    ]);
    if (report) written++;
  }
  return written;
}
