/**
 * How often the site is allowed to get in a reader's way.
 *
 * Three things open over the page by themselves: a big-moment card (El
 * Clásico tomorrow, the Premier League back this weekend), the week's note (an
 * international break) and the offer popup. Each had its own once-only rule
 * and none knew about the others, so one visit could meet all three in a row,
 * and a reader who came back an hour later could meet the next one. The rules
 * live here now, in one place, and every card asks before it opens:
 *
 *   - One per visit. Two cards within half an hour of each other is one visit
 *     too many, whatever they are.
 *   - Two a day at most, across everything.
 *   - The offer waits longest. A card about the football can follow another
 *     the same day; the offer needs twelve hours of quiet since the last card
 *     of any kind, because the football is what the reader came for.
 *   - Each thing is shown once (its own module remembers what), and what a
 *     reader opens themselves (the chip, the offer bar) is never counted: they
 *     asked for it.
 *   - Priority is the order the page asks in: a moment first, then the
 *     week's note, then the offer. The one that loses is not marked as seen,
 *     so it gets its turn on a later visit if it still matters then.
 *
 * Memory is a handful of timestamps in localStorage. Nothing is sent anywhere.
 */

const KEY = 'ow.attention';
const MIN = 60e3;
const HOUR = 60 * MIN;

/** Quiet needed since the last card of any kind before this kind may open. */
export const GAP = { moment: 30 * MIN, season: 30 * MIN, offer: 12 * HOUR };
export const PER_DAY = 2;

const defaultStore = () => {
  try { return globalThis.localStorage ?? null; } catch { return null; }
};

function read(store) {
  try {
    const v = JSON.parse(store?.getItem(KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((e) => e && Number.isFinite(e.at)) : [];
  } catch { return []; }
}

/**
 * Whether a card of this kind may open now. A reader with no storage (private
 * mode, blocked) gets the most conservative answer that still lets the site
 * speak: football yes, offers no.
 */
export function mayInterrupt(kind, { now = Date.now(), store = defaultStore() } = {}) {
  if (!store) return kind !== 'offer';
  const log = read(store);
  const last = log.reduce((m, e) => Math.max(m, e.at), 0);
  if (now - last < (GAP[kind] ?? GAP.offer)) return false;
  return log.filter((e) => now - e.at < 24 * HOUR).length < PER_DAY;
}

/** A card opened by itself. Call it as it opens, not when it closes. */
export function noteInterruption(kind, { now = Date.now(), store = defaultStore() } = {}) {
  if (!store) return;
  const log = read(store).filter((e) => now - e.at < 7 * 24 * HOUR);
  log.push({ kind, at: now });
  try { store.setItem(KEY, JSON.stringify(log.slice(-20))); } catch { /* shown again sooner, no harm */ }
}
