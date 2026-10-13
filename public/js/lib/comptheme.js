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
 * The star ball is a still, public/brand/starball.webp (and a small one,
 * starball-480.webp, for phones).
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
 * The art for a theme, as markup to sit behind the masthead's words.
 *
 * The star ball is a picture. It was a live shader (now scripts/hero/starball.js, kept to render stills) that turned
 * slowly, and on phones it stuttered however it was tuned (October 2026, the
 * owner: "lagging"); a still costs nothing to show and looks the same at a
 * glance. The small one is enough for a phone; the big one for a wide screen.
 */
export function themeArt(theme) {
  if (theme === 'ucl') {
    return `<div class="comp-art comp-art-ucl" aria-hidden="true"><div class="starball">
      <img class="starball-still" src="/brand/starball.webp" srcset="/brand/starball-480.webp 480w, /brand/starball.webp 900w"
        sizes="(max-width: 760px) 150vw, 64vw" alt="" decoding="async" fetchpriority="high" width="900" height="900">
      </div></div>`;
  }
  return '';
}

/** Kept for the router, which calls it once: there is nothing to start now. */
export function wakeArt() {}
