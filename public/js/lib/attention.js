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
 *   - Never over the landing page. It is a stranger's first look at the
 *     site, and a card over it hides the one thing it has to say. The week's
 *     note and the big moments wait for the board and the match pages, where
 *     they explain what the reader is looking at.
 *   - Not before the reader has settled: a second page, or twenty seconds on
 *     the site. A card in the first few seconds of a visit is a wall.
 *   - No offer popup on a first visit at all. The bar along the foot carries
 *     the offer; the popup can ask from the second visit, once they have
 *     looked round.
 *
 * Memory is a handful of timestamps in localStorage and one record of the
 * visit in sessionStorage. Nothing is sent anywhere.
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

/* ------------------------------------------------------------- the visit */

const VISIT = 'ow.visit';
const VISITS = 'ow.visits';
const defaultSession = () => {
  try { return globalThis.sessionStorage ?? null; } catch { return null; }
};
function visit(session) {
  try { const v = JSON.parse(session?.getItem(VISIT) ?? 'null'); return v && Number.isFinite(v.start) ? v : null; } catch { return null; }
}

/**
 * A page of this visit has been drawn. The first one of a visit also counts
 * the visit itself (a visit is a browser session: a tab, until it closes).
 */
export function notePage({ now = Date.now(), session = defaultSession(), store = defaultStore() } = {}) {
  if (!session) return;
  const v = visit(session);
  if (!v) {
    try { store?.setItem(VISITS, String(visits(store) + 1)); } catch { /* counted next time */ }
  }
  const next = v ? { ...v, pages: (v.pages ?? 0) + 1 } : { start: now, pages: 1 };
  try { session.setItem(VISIT, JSON.stringify(next)); } catch { /* treated as settled */ }
}

/** How many visits this browser has made, this one included. */
export function visits(store = defaultStore()) {
  try { return Math.max(0, Number(store?.getItem(VISITS)) || 0); } catch { return 0; }
}

/** The reader's first visit: no offer popup, the bar is enough. */
export const firstVisit = (store = defaultStore()) => visits(store) <= 1;

/**
 * Whether the reader has settled into this visit: a second page, or `ms` on
 * the site. Without a record of the visit (no storage) they count as settled,
 * so the site can still speak.
 */
export function settled({ now = Date.now(), session = defaultSession(), ms = 20e3 } = {}) {
  const v = visit(session);
  if (!v) return true;
  return (v.pages ?? 1) >= 2 || now - v.start >= ms;
}
