/**
 * The matchday poster.
 *
 * One layout, driven by the two clubs' own colours, because "always looks good
 * no matter what" rules out anything that depends on an asset we might not
 * have. Stadium photographs cover about a third of grounds and fail by
 * returning a blank 1x1 with HTTP 200; player art is 100px headshots that fall
 * apart at this scale. Crests are the one thing that is nearly always there,
 * and when even that is missing a monogram carries the same colour.
 *
 * The failure modes this is built against, in the order they bite:
 *
 *   long club names      auto-fit shrinks the type rather than wrapping to four
 *                        lines or overflowing the plate
 *   missing crest        monogram in the club's colour, same size and position
 *   single-colour crest  the companion colour is derived, not invented
 *   two clubs in red     the away side moves to its second colour (palette.ts)
 *   no occasion          the competition name takes the kicker slot
 *
 * Rendered by Chromium rather than Satori: Satori supports a subset of CSS and
 * the type here — optical sizing, tight tracking, the diagonal — is exactly the
 * part it would fight.
 */

export interface PosterTeam {
  name: string;
  /** Data URI. Null when the crest could not be fetched. */
  crest: string | null;
}

export interface PosterInput {
  home: PosterTeam;
  away: PosterTeam;
  /** "EL CLÁSICO", "CHAMPIONS LEAGUE NIGHT" — empty for an ordinary fixture. */
  kicker: string;
  competition: string;
  /** Already formatted for a reader: "Tonight, 8:00 PM". */
  when: string;
  width?: number;
  height?: number;
}

const esc = (s: string) =>
  String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

/** Initials for the monogram, with the club-name noise words dropped. */
export function initials(name: string): string {
  const noise = /^(fc|cf|afc|ac|as|ss|sv|sc|rc|cd|ud|club|de|the|real|olympique)$/i;
  const words = String(name).split(/\s+/).filter((w) => w && !noise.test(w));
  const use = words.length ? words : String(name).split(/\s+/).filter(Boolean);
  return use.slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || '?';
}

export function posterHTML(input: PosterInput): string {
  const w = input.width ?? 1200;
  const h = input.height ?? 630;
  const { home, away } = input;

  const side = (t: PosterTeam, which: 'home' | 'away') => `
    <div class="side ${which}">
      <div class="badge" id="badge-${which}">
        ${t.crest
          ? `<img id="crest-${which}" src="${t.crest}" alt="">`
          : `<span class="mono">${esc(initials(t.name))}</span>`}
      </div>
      <div class="club" data-fit>${esc(t.name)}</div>
    </div>`;

  return `<!doctype html>
<html><head><meta charset="utf-8">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@100,400;100,700;100,900;112,800;112,900&display=swap">
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{width:${w}px;height:${h}px;overflow:hidden}
  body{
    background:#06070a;
    color:#f4eee2;
    font-family:'Archivo',system-ui,sans-serif;
    position:relative;
    /* Set from the crests once they are sampled. */
    --home:#e2b979; --away:#5b6478; --home-ink:#0a0b0e; --away-ink:#0a0b0e;
  }

  /* The ground: each club's colour bleeding in from its own corner, meeting on
     a diagonal. The diagonal is what stops two similar palettes reading as one
     flat field even after the clash rules have run. */
  .field{position:absolute;inset:0;overflow:hidden}
  .field::before,.field::after{content:'';position:absolute;inset:0}
  .field::before{
    background:
      radial-gradient(76% 120% at -4% 104%, var(--home) 0%, transparent 66%),
      radial-gradient(76% 120% at 104% -4%, var(--away) 0%, transparent 66%);
    opacity:1;
  }
  .field::after{
    background:linear-gradient(112deg, rgba(6,7,10,.20) 0%, rgba(6,7,10,.74) 48%, rgba(6,7,10,.20) 100%);
  }
  .seam{
    position:absolute;top:-20%;left:50%;width:2px;height:140%;
    background:linear-gradient(to bottom, transparent, rgba(244,238,226,.5), transparent);
    transform:translateX(-50%) rotate(12deg);
  }

  .plate{position:relative;height:100%;display:flex;flex-direction:column;justify-content:space-between;
         padding:${Math.round(h * 0.085)}px ${Math.round(w * 0.055)}px}

  .kicker{
    display:inline-flex;align-self:flex-start;align-items:center;gap:10px;
    border:1px solid rgba(244,238,226,.34);border-radius:999px;
    padding:9px 20px;font-size:${Math.round(h * 0.032)}px;font-weight:900;
    letter-spacing:.16em;text-transform:uppercase;
    background:rgba(6,7,10,.45);backdrop-filter:blur(2px);
  }
  .kicker i{width:7px;height:7px;border-radius:50%;background:var(--home);display:block}

  .teams{display:flex;align-items:center;justify-content:center;gap:${Math.round(w * 0.045)}px;flex:1}
  .side{display:flex;flex-direction:column;align-items:center;gap:${Math.round(h * 0.035)}px;
        width:${Math.round(w * 0.36)}px;min-width:0}
  .badge{
    width:${Math.round(h * 0.30)}px;height:${Math.round(h * 0.30)}px;border-radius:50%;
    display:grid;place-items:center;
    background:rgba(244,238,226,.06);
    border:2px solid rgba(244,238,226,.14);
    box-shadow:0 18px 44px rgba(0,0,0,.5);
    overflow:hidden;
  }
  .badge img{width:78%;height:78%;object-fit:contain;display:block}
  .home .badge{border-color:color-mix(in srgb, var(--home) 60%, transparent)}
  .away .badge{border-color:color-mix(in srgb, var(--away) 60%, transparent)}
  .mono{font-size:${Math.round(h * 0.11)}px;font-weight:900;font-stretch:112%;letter-spacing:-.02em}
  .home .mono{color:var(--home)} .away .mono{color:var(--away)}

  .club{
    font-weight:900;font-stretch:112%;text-align:center;line-height:1.02;
    letter-spacing:-.025em;font-size:${Math.round(h * 0.082)}px;max-width:100%;
    text-wrap:balance;
    text-shadow:0 2px 18px rgba(0,0,0,.6);
  }

  .versus{
    font-size:${Math.round(h * 0.055)}px;font-weight:900;font-stretch:112%;
    opacity:.5;letter-spacing:.05em;align-self:center;margin-top:-${Math.round(h * 0.05)}px;
  }

  .foot{display:flex;align-items:flex-end;justify-content:space-between;gap:24px}
  .when{font-size:${Math.round(h * 0.042)}px;font-weight:800;letter-spacing:-.01em}
  .comp{font-size:${Math.round(h * 0.030)}px;color:rgba(244,238,226,.62);margin-top:6px;
        letter-spacing:.06em;text-transform:uppercase;font-weight:700}
  .brand{display:flex;align-items:center;gap:11px;opacity:.92}
  .brand svg{width:${Math.round(h * 0.045)}px;height:${Math.round(h * 0.045)}px}
  .brand span{font-size:${Math.round(h * 0.036)}px;font-weight:900;letter-spacing:.05em;font-stretch:112%}
  .brand i{font-style:normal;color:var(--home)}
</style></head>
<body>
  <div class="field"><div class="seam"></div></div>
  <div class="plate">
    <span class="kicker"><i></i>${esc(input.kicker || input.competition)}</span>

    <div class="teams">
      ${side(home, 'home')}
      <span class="versus">V</span>
      ${side(away, 'away')}
    </div>

    <div class="foot">
      <div>
        <div class="when">${esc(input.when)}</div>
        <div class="comp">${esc(input.competition)}</div>
      </div>
      <div class="brand">
        <svg viewBox="0 0 100 100"><path d="M22 72 L44 28 M40 72 L62 28 M58 72 L80 28"
          stroke="currentColor" stroke-width="11" stroke-linecap="round" fill="none"/></svg>
        <span>OFFSIDE<i>.WIN</i></span>
      </div>
    </div>
  </div>

<script>
${SAMPLER}
</script>
</body></html>`;
}

/**
 * Runs inside the page, before the screenshot.
 *
 * Sampling happens here rather than in Node because decoding a PNG in Node
 * means a dependency and a licence question, and Chromium is already running.
 * The crests arrive as data URIs, so the canvas is same-origin and never
 * tainted — which it would be if we pointed it at the provider's host and
 * hoped for a CORS header.
 */
const SAMPLER = `
(async () => {
  const STEP = 4;

  function sample(img) {
    const c = document.createElement('canvas');
    const n = 64;
    c.width = n; c.height = n;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0, n, n);
    const { data } = g.getImageData(0, 0, n, n);

    // Bucket to a coarse grid so a gradient does not shatter into 400 colours.
    const bins = new Map();
    for (let i = 0; i < data.length; i += 4 * STEP) {
      const a = data[i + 3];
      if (a < 160) continue;                       // transparent surround
      const r = data[i], gg = data[i + 1], b = data[i + 2];
      const key = (r >> 4) + ',' + (gg >> 4) + ',' + (b >> 4);
      const e = bins.get(key) || { r: 0, g: 0, b: 0, n: 0 };
      e.r += r; e.g += gg; e.b += b; e.n++;
      bins.set(key, e);
    }
    return [...bins.values()].map((e) => ({
      colour: { r: e.r / e.n, g: e.g / e.n, b: e.b / e.n },
      weight: e.n,
    }));
  }

  const out = {};
  for (const which of ['home', 'away']) {
    const img = document.getElementById('crest-' + which);
    if (!img) { out[which] = []; continue; }
    try {
      if (!img.complete) await img.decode();
      out[which] = img.naturalWidth > 8 ? sample(img) : [];
    } catch { out[which] = []; }
  }
  window.__samples = out;

  // Shrink any club name that would otherwise overflow its column. Two lines is
  // fine, three is a wall, and an overflowing plate is the thing that makes a
  // generated poster look generated.
  for (const el of document.querySelectorAll('[data-fit]')) {
    let size = parseFloat(getComputedStyle(el).fontSize);
    const room = el.parentElement.clientWidth;
    let guard = 0;
    while ((el.scrollWidth > room || el.getClientRects().length > 2) && size > 18 && guard++ < 40) {
      size -= 2;
      el.style.fontSize = size + 'px';
    }
  }
  window.__fitted = true;
})();
`;
