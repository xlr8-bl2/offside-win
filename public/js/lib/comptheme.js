/**
 * A competition's look, for the pages where its games lead.
 *
 * Some competitions are a feeling before they are a fixture list: a Champions
 * League night is royal blue and a ball made of stars. A match from one of
 * them gets that behind its masthead (the match page, the front page, the
 * landing page when it is the free call, the big-moment card) instead of the
 * stadium photograph and the clubs' colours. Everything else keeps the
 * photograph.
 *
 * The art is drawn here, by us, not taken from the competition: it evokes the
 * night without reproducing anyone's artwork. The competition's own logo,
 * where it appears, is the provider's, used to say which competition it is.
 *
 * The star ball itself is public/js/lib/starball.js (a shader), with a still
 * of it at public/brand/starball.webp for the first paint and for browsers
 * without WebGL.
 *
 * Adding a competition is a line in THEMES, its art here, and a block of
 * CSS keyed on .theme-<name> in components.css.
 */

/** Competition id to theme. */
export const THEMES = new Map([
  [7, 'ucl'], // Champions League
]);

export const themeOf = (leagueId) => THEMES.get(Number(leagueId)) ?? null;

/**
 * The art for a theme, as markup to sit behind the masthead's words. The
 * star ball paints a still frame at once and comes alive when its canvas
 * starts (wakeArt).
 */
export function themeArt(theme) {
  if (theme === 'ucl') {
    return `<div class="comp-art comp-art-ucl" aria-hidden="true"><div class="starball">
      <img class="starball-still" src="/brand/starball.webp" alt="" decoding="async">
      <canvas class="starball-live"></canvas></div></div>`;
  }
  return '';
}

/*
 * Every star ball on the page is started as it arrives and stopped as it
 * leaves, wherever it was put (a masthead, the landing hero, a card), so no
 * view has to remember to do it. A reader who asked for less motion gets
 * one frame, the same as the still.
 */
const running = new Map();
function start(canvas) {
  if (running.has(canvas)) return;
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  import('./starball.js').then(({ startBall }) => {
    if (!canvas.isConnected || running.has(canvas)) return;
    running.set(canvas, startBall(canvas, { still }) ?? (() => {}));
  }).catch(() => {});
}
function sweep() {
  for (const c of document.querySelectorAll('canvas.starball-live')) start(c);
  for (const [c, stop] of running) if (!c.isConnected) { stop(); running.delete(c); }
}
export function wakeArt() {
  if (typeof document === 'undefined' || wakeArt.on) return;
  wakeArt.on = true;
  new MutationObserver(sweep).observe(document.body, { childList: true, subtree: true });
  sweep();
}
