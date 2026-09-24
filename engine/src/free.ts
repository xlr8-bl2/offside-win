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
 * "The day" is enforced by the lock, not by the calendar. Until its match
 * kicks off the free call follows the board, so a stronger call published
 * later in the day takes over. From kick-off it is fixed, and it stays up as
 * the day's free call through the match and for most of a day afterwards,
 * so the front page is never handing out a second free call an hour after
 * the first was played. After that window the next strongest open call takes
 * its place.
 */
export interface FreeCall {
  fixture_id: number;
  kickoff: number;
  model_prob: number;
  chosen_at: number;
}

/** How long a played free call stays the free call. */
const HOLD_SECONDS = 20 * 3600;
/** How far ahead a call may be and still count as today's. */
const AHEAD_SECONDS = 30 * 3600;

export async function chooseFreeCall(now = Math.floor(Date.now() / 1000)): Promise<FreeCall | null> {
  const current = await kvGetJSON<FreeCall>('free:today');
  if (current && current.kickoff <= now && now - current.kickoff < HOLD_SECONDS) return current;

  const [best] = await select<{ fixture_id: number; kickoff: number; model_prob: number }>(
    `SELECT p.fixture_id, p.kickoff, p.model_prob
     FROM pick p
     WHERE p.kind = 'CONFIDENT' AND p.settled_at IS NULL
       AND p.kickoff > ? AND p.kickoff < ?
     ORDER BY p.model_prob DESC, p.kickoff ASC
     LIMIT 1`,
    [now, now + AHEAD_SECONDS],
  );
  if (!best) {
    // Nothing open. A free call whose match kicked off inside the hold is
    // returned above; anything older is cleared rather than left up.
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
