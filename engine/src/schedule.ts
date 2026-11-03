/**
 * What is coming up, beyond what the slate analyses.
 *
 * The slate reads matches three days ahead, because that is when line-ups,
 * prices and team news start to mean something. Search has to know about the
 * matches after that too: a reader looking for next week's derby should be
 * told when it will be analysed, not that it does not exist. So each slate
 * also lists the next two weeks of matches in the competitions we cover --
 * names, ids and kick-off, nothing else -- into `schedule`.
 */

import { bsdList, num, str, toEpoch } from './bsd.ts';
import { exec, insertMany, kvGet, kvSet } from './store.ts';

export const SCHEDULE_DAYS = 14;

/**
 * How often the list is read again. Every slate pass (hourly) cost up to
 * twenty provider requests and rewrote every row, about 40,000 rows written a
 * day of D1's free 100,000. A fortnight's fixture list barely moves, and the
 * slate reads the next day and a half itself.
 */
export const SCHEDULE_EVERY_S = 4 * 3600;
/** A row is rewritten when it changed, or to keep it from the day-old sweep below. */
const TOUCH_AFTER_S = 12 * 3600;
const COLUMNS = ['id', 'league_id', 'kickoff', 'home_team', 'away_team', 'home_team_id', 'away_team_id', 'updated_at'];

/** The upsert's conflict clause: unchanged rows are left alone, so they cost no writes. */
export function scheduleConflict(touchAfter = TOUCH_AFTER_S): string {
  const changed = COLUMNS.filter((c) => c !== 'id' && c !== 'updated_at')
    .map((c) => `schedule."${c}" IS DISTINCT FROM excluded."${c}"`);
  return `ON CONFLICT(id) DO UPDATE SET ${COLUMNS.filter((c) => c !== 'id').map((c) => `"${c}" = excluded."${c}"`).join(', ')}
    WHERE ${changed.join(' OR ')} OR schedule."updated_at" < excluded."updated_at" - ${Math.floor(touchAfter)}`;
}

export interface ScheduleRow {
  id: number; league_id: number; kickoff: number;
  home_team: string; away_team: string;
  home_team_id: number | null; away_team_id: number | null;
  updated_at: number;
}

/** One provider event as a schedule row, or null if it is not a future match in a covered competition. */
export function scheduleRow(e: Record<string, unknown>, covered: Set<number>, now: number): ScheduleRow | null {
  const id = num(e['id']);
  const league = num(e['league_id']);
  const kickoff = toEpoch(e['event_date']);
  const home = str(e['home_team']);
  const away = str(e['away_team']);
  if (!id || league === undefined || !covered.has(league) || !kickoff || !home || !away) return null;
  if (kickoff <= now) return null;
  if (/cancel|postpon|abandon|finish|ended/i.test(String(e['status'] ?? ''))) return null;
  return {
    id, league_id: league, kickoff, home_team: home, away_team: away,
    home_team_id: num(e['home_team_id']) ?? null, away_team_id: num(e['away_team_id']) ?? null,
    updated_at: now,
  };
}

export async function refreshSchedule(covered: Set<number>, now = Math.floor(Date.now() / 1000)): Promise<number | null> {
  const last = Number(await kvGet('schedule:listed_at').catch(() => null));
  if (Number.isFinite(last) && last > 0 && now - last < SCHEDULE_EVERY_S) return null;
  const events = await bsdList<Record<string, unknown>>(
    '/api/v2/events/',
    { date_from: new Date(now * 1000).toISOString(), date_to: new Date((now + SCHEDULE_DAYS * 86400) * 1000).toISOString() },
    { limit: 200, max: 4000 },
  );
  const rows = events.map((e) => scheduleRow(e, covered, now)).filter((r): r is ScheduleRow => r !== null);
  if (rows.length) {
    await insertMany('schedule', COLUMNS, rows as unknown as Array<Record<string, unknown>>, { onConflict: scheduleConflict() });
  }
  // Played, or moved out of the window and not seen again for a day.
  await exec('DELETE FROM schedule WHERE kickoff < ? OR updated_at < ?', [now - 86400, now - 86400]);
  // Only a read that found something counts: an empty answer (the allowance
  // spent, a provider fault) is tried again next pass.
  if (rows.length) await kvSet('schedule:listed_at', String(now));
  return rows.length;
}
