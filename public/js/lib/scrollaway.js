/**
 * A card over the page that never holds the page hostage.
 *
 * The break note and the offer popup both sit over a darkened page. They used
 * to lock it as well (overflow: hidden on <html>), so a reader who tried to
 * scroll found the site frozen behind a card they had not asked for. Now the
 * page underneath stays scrollable, and trying to scroll it is read as "not
 * now": the card gets out of the way (each caller decides how; the break note
 * folds into its chip) and the page carries on moving under the same gesture.
 *
 * What counts as scrolling the page:
 *   - a wheel or a swipe that starts outside the card;
 *   - a wheel or a swipe on the card when the card has nothing left to scroll
 *     that way (a long card on a short phone scrolls itself first, and a
 *     gesture that began scrolling the card stays with the card to its end);
 *   - the page itself moving more than a little, which catches the scrollbar,
 *     Page Down and anything else that scrolls without a wheel or a finger.
 *
 * Returns a function that stops listening.
 */
export function scrollAway(card, onAway, { slack = 48 } = {}) {
  const y0 = scrollY;
  let done = false;
  // The card can still move `dy` that way (positive is down the page).
  const roomIn = (dy) => {
    if (card.scrollHeight <= card.clientHeight + 1) return false;
    return dy > 0 ? card.scrollTop + card.clientHeight < card.scrollHeight - 1 : card.scrollTop > 0;
  };
  const away = () => { if (done) return; stop(); onAway(); };

  // A trackpad sends a stream of wheel events for one flick, inertia
  // included. Whoever took the first of a stream keeps the rest of it, so the
  // tail of a flick that ran the card to its end does not close it.
  let wheelOwner = null;
  let wheelAt = 0;
  const onWheel = (e) => {
    const dy = e.deltaY || e.deltaX;
    if (!dy) return;
    const now = performance.now();
    if (now - wheelAt > 250) wheelOwner = card.contains(e.target) && roomIn(dy) ? 'card' : 'page';
    wheelAt = now;
    if (wheelOwner === 'page') away();
  };

  let touch = null;
  const onStart = (e) => {
    const t = e.touches[0];
    touch = t ? { x: t.clientX, y: t.clientY, inCard: card.contains(e.target), owner: null } : null;
  };
  const onMove = (e) => {
    const t = e.touches[0];
    if (!touch || !t || touch.owner) { if (touch?.owner === 'page') away(); return; }
    const dy = touch.y - t.clientY;
    const dx = touch.x - t.clientX;
    if (Math.abs(dy) < 10 && Math.abs(dx) < 10) return;
    // Sideways is not scrolling the page.
    if (Math.abs(dx) > Math.abs(dy)) { touch.owner = 'none'; return; }
    touch.owner = touch.inCard && roomIn(dy) ? 'card' : 'page';
    if (touch.owner === 'page') away();
  };
  const onEnd = () => { touch = null; };
  const onScroll = () => { if (Math.abs(scrollY - y0) > slack) away(); };

  const opts = { passive: true, capture: true };
  addEventListener('wheel', onWheel, opts);
  addEventListener('touchstart', onStart, opts);
  addEventListener('touchmove', onMove, opts);
  addEventListener('touchend', onEnd, opts);
  addEventListener('touchcancel', onEnd, opts);
  addEventListener('scroll', onScroll, { passive: true });
  function stop() {
    done = true;
    removeEventListener('wheel', onWheel, opts);
    removeEventListener('touchstart', onStart, opts);
    removeEventListener('touchmove', onMove, opts);
    removeEventListener('touchend', onEnd, opts);
    removeEventListener('touchcancel', onEnd, opts);
    removeEventListener('scroll', onScroll, { passive: true });
  }
  return stop;
}

/**
 * Whether the reader is in the middle of moving the page: a scroll, a wheel or
 * a finger on the screen within the last `ms`. A card that appears under a
 * moving thumb is closed by that same thumb before it is read, so the callers
 * wait for a pause instead.
 */
let lastMove = 0;
if (typeof window !== 'undefined') {
  const mark = () => { lastMove = performance.now(); };
  for (const t of ['scroll', 'wheel', 'touchstart', 'touchmove']) addEventListener(t, mark, { passive: true, capture: true });
}
export const moving = (ms = 1200) => performance.now() - lastMove < ms;
