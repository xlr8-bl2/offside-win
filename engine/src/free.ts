import { kvGetJSON, kvSetJSON, select } from './store.ts';

/**
 * The free call: the strongest call of the day, whoever is playing.
 *
 * It used to be the headline fixture's call, which tied the free tier to the
 * biggest game rather than to the best call. The owner's brief is the other
 * way round: the one call a day that everyone can read should be the one we
 * are surest of, so that a reader who watches it land knows what the rest
 * look like.
 *
 * "The day" is the UK calendar day, because that is the day the site's
 * readers are living in. Until the free call kicks off it follows the board:
 * a stronger call published later takes over. Once it has kicked off it is
 * fixed for the rest of that day, and the front page shows how it went,
 * which is the best advert the product has. Late in the evening, with
 * nothing left to play today, tomorrow's strongest call goes up, so the
 * front page is never offering a call nobody can still use.
 *
 * The first version held a call for twenty hours from kick-off, measured
 * from whenever it was chosen, so a Caribbean match kicking off at midnight
 * became "today's free call" for the whole of the following UK day and sat
 * on the masthead at three in the afternoon, long finished, as if it were
 * still to come.
 */
export interface FreeCall {
  fixture_id: number;
  kickoff: number;
  model_prob: number;
  chosen_at: number;
}

const LONDON = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' });
/** The UK calendar day an instant falls on, as YYYY-MM-DD. */
export function ukDay(epochSeconds: number): string {
  const parts = Object.fromEntries(LONDON.formatToParts(new Date(epochSeconds * 1000)).map((p) => [p.type, p.value]));
  return `${parts['year']}-${parts['month']}-${parts['day']}`;
}

export async function chooseFreeCall(now = Math.floor(Date.now() / 1000)): Promise<FreeCall | null> {
  const today = ukDay(now);
  const current = await kvGetJSON<FreeCall>('free:today');
  // Today's free call has started: it stays today's free call.
  if (current && current.kickoff <= now && ukDay(current.kickoff) === today) return current;

  // The strongest call still to kick off today; failing that, tomorrow's.
  const open = await select<{ fixture_id: number; kickoff: number; model_prob: number }>(
    `SELECT p.fixture_id, p.kickoff, p.model_prob
     FROM pick p
     WHERE p.kind = 'CONFIDENT' AND p.settled_at IS NULL
       AND p.kickoff > ? AND p.kickoff < ?
     ORDER BY p.model_prob DESC, p.kickoff ASC`,
    [now, now + 48 * 3600],
  );
  const todays = open.filter((r) => ukDay(Number(r.kickoff)) === today);
  const tomorrow = ukDay(now + 86400);
  const pool = todays.length ? todays : open.filter((r) => ukDay(Number(r.kickoff)) === tomorrow);
  const best = pool[0];
  if (!best) {
    if (current) await kvSetJSON('free:today', null);
    return null;
  }
  const next: FreeCall = {
    fixture_id: Number(best.fixture_id),
    kickoff: Number(best.kickoff),
    model_prob: Number(best.model_prob),
    chosen_at: now,
  };
  if (current && current.fixture_id === next.fixture_id) return current;
  await kvSetJSON('free:today', next);
  return next;
}
