/**
 * The matchday poster.
 *
 * Built to the broadcast-graphic shape: competition mark and occasion across
 * the top, two crests on shields meeting at a VS, names under them on coloured
 * rules, kickoff details on one row, and a stats strip along the bottom. Dense
 * on purpose — a poster with four elements and a lot of air reads as a
 * placeholder, which is exactly what the first two attempts at this were.
 *
 * Colour comes from the crests themselves (palette.ts), because that is the
 * only asset reliably present: stadium photographs cover about a third of
 * grounds and fail by returning a blank 1x1 with HTTP 200.
 *
 * What the reference for this has and we cannot: full-body player cut-outs.
 * The provider's player art is 150x150 — measured, not assumed — so a figure at
 * that scale is a 4x upscale and looks it. Portraits appear where they exist,
 * at a size the source can carry and treated hard enough that the softness
 * reads as styling, and the layout stands up without them.
 *
 * The failure modes this is built against, each rendered and looked at:
 *
 *   long club names      type shrinks to fit rather than wrapping or bleeding
 *   missing crest        monogram on the same shield, in the same colour
 *   single-colour crest  the companion colour is derived, not invented
 *   two clubs in red     the away side moves to its second colour (palette.ts)
 *   no stats at all      the strip collapses rather than showing empty cells
 */

export interface PosterTeam {
  name: string;
  /** Data URI. Null when the crest could not be fetched. */
  crest: string | null;
  /** Last results, newest last: "WWDLW". */
  form?: string | null;
}

export interface PosterStats {
  h2h?: { home: number; draws: number; away: number } | null;
  weather?: { temperature_c?: number | null; wind_kph?: number | null } | null;
}

export interface PosterInput {
  home: PosterTeam;
  away: PosterTeam;
  /** "EL CLÁSICO", "CHAMPIONS LEAGUE NIGHT" — empty for an ordinary fixture. */
  kicker: string;
  competition: string;
  /** Data URI for the competition mark. */
  competitionCrest?: string | null;
  /** "Sat, 15 Nov" */
  date: string;
  /** "16:00" */
  time: string;
  /** "Matchday 7" — from the provider's round label. */
  round?: string | null;
  stats?: PosterStats;
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

const ICON = {
  cal: '<path d="M7 2v3M17 2v3M3 9h18M5 4h14a2 2 0 012 2v13a2 2 0 01-2 2H5a2 2 0 01-2-2V6a2 2 0 012-2z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  swap: '<path d="M4 8h13l-3-3M20 16H7l3 3"/>',
  cloud: '<path d="M7 18a4 4 0 010-8 5 5 0 019.6-1.3A3.5 3.5 0 1117.5 18z"/>',
};

const icon = (d: string, size: number) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="${size}" height="${size}">${d}</svg>`;

/** W/D/L as dots, the way every broadcast graphic draws recent form. */
function formDots(seq: string | null | undefined, size: number): string {
  const s = String(seq ?? '').slice(-5);
  if (!s) return '';
  return `<span class="dots">${[...s]
    .map((r) => `<i class="d-${r.toLowerCase()}" style="width:${size}px;height:${size}px"></i>`)
    .join('')}</span>`;
}

export function posterHTML(input: PosterInput): string {
  const w = input.width ?? 1600;
  const h = input.height ?? 900;
  const { home, away } = input;
  const st = input.stats ?? {};
  const u = (n: number) => Math.round(h * n);

  const shield = (t: PosterTeam, which: 'home' | 'away') => `
    <div class="shield ${which}">
      <div class="shield-in">
        ${t.crest
          ? `<img id="crest-${which}" src="${t.crest}" alt="">`
          : `<span class="mono">${esc(initials(t.name))}</span>`}
      </div>
    </div>`;

  // Cells are built only where the data exists. A labelled cell with a dash in
  // it is worse than a narrower strip.
  const cells: string[] = [];
  if (home.form || away.form) {
    cells.push(`
      <div class="cell">
        ${icon(ICON.chart, u(0.028))}
        <div>
          <span class="cl">Last 5</span>
          <div class="cv form-rows">
            <span>${formDots(home.form, u(0.014))}</span>
            <span>${formDots(away.form, u(0.014))}</span>
          </div>
        </div>
      </div>`);
  }
  if (st.h2h && (st.h2h.home + st.h2h.draws + st.h2h.away) > 0) {
    cells.push(`
      <div class="cell">
        ${icon(ICON.swap, u(0.028))}
        <div>
          <span class="cl">Head to head</span>
          <div class="cv h2h">
            <b>${st.h2h.home}</b><span>W</span>
            <b>${st.h2h.draws}</b><span>D</span>
            <b>${st.h2h.away}</b><span>L</span>
          </div>
        </div>
      </div>`);
  }
  if (st.weather && typeof st.weather.temperature_c === 'number') {
    const wind = typeof st.weather.wind_kph === 'number'
      ? `<span class="sub">${Math.round(st.weather.wind_kph)} km/h wind</span>` : '';
    cells.push(`
      <div class="cell">
        ${icon(ICON.cloud, u(0.028))}
        <div>
          <span class="cl">At kick-off</span>
          <div class="cv"><b>${Math.round(st.weather.temperature_c)}&deg;C</b>${wind}</div>
        </div>
      </div>`);
  }

  return `<!doctype html>
<html><head><meta charset="utf-8">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62.5,700;62.5,900;75,800;75,900;100,400;100,600;100,700;100,900&display=swap">
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{width:${w}px;height:${h}px;overflow:hidden}
  body{
    background:#070910;color:#f4eee2;
    font-family:'Archivo',system-ui,sans-serif;position:relative;
    --home:#e2b979; --away:#5b6478; --home-ink:#f4eee2; --away-ink:#f4eee2;
  }

  /* Angular shards driven in from the top corners in each club's colour. The
     shape carries the energy at this size; a gradient alone reads as a tinted
     background rather than as artwork. */
  .shard{position:absolute;top:0;height:${u(0.72)}px;opacity:.9}
  .s-home{left:0;width:${Math.round(w * 0.42)}px;
    background:linear-gradient(130deg, var(--home) 0%, transparent 72%);
    clip-path:polygon(0 0, 46% 0, 16% 100%, 0 100%);}
  .s-home2{left:${Math.round(w * 0.055)}px;width:${Math.round(w * 0.34)}px;opacity:.45;
    background:linear-gradient(130deg, var(--home) 0%, transparent 60%);
    clip-path:polygon(10% 0, 34% 0, 6% 100%, 0 78%);}
  .s-away{right:0;width:${Math.round(w * 0.42)}px;
    background:linear-gradient(230deg, var(--away) 0%, transparent 72%);
    clip-path:polygon(54% 0, 100% 0, 100% 100%, 84% 100%);}
  .s-away2{right:${Math.round(w * 0.055)}px;width:${Math.round(w * 0.34)}px;opacity:.45;
    background:linear-gradient(230deg, var(--away) 0%, transparent 60%);
    clip-path:polygon(66% 0, 90% 0, 100% 78%, 94% 100%);}

  /* The centre circle, barely there. Enough to say football without becoming a
     picture of a pitch. */
  .pitch{position:absolute;left:50%;top:${u(0.42)}px;transform:translate(-50%,-50%);
    width:${u(0.66)}px;height:${u(0.66)}px;border:2px solid rgba(244,238,226,.055);border-radius:50%}
  .pitch::after{content:'';position:absolute;inset:${u(0.14)}px;
    border:2px solid rgba(244,238,226,.04);border-radius:50%}

  .grain{position:absolute;inset:-50%;opacity:.13;mix-blend-mode:overlay;
    background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='180' height='180'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3'/></filter><rect width='180' height='180' filter='url(%23n)'/></svg>");}
  .vig{position:absolute;inset:0;
    background:radial-gradient(130% 100% at 50% 40%, transparent 42%, rgba(7,9,16,.82) 100%)}


  .plate{position:relative;height:100%;display:flex;flex-direction:column;align-items:center;
         padding:${u(0.045)}px ${Math.round(w * 0.04)}px ${u(0.04)}px}

  .comp-mark{width:${u(0.075)}px;height:${u(0.075)}px;object-fit:contain;
             filter:drop-shadow(0 4px 14px rgba(0,0,0,.6))}
  .comp-fallback{font-size:${u(0.03)}px;font-weight:900;letter-spacing:.1em;color:var(--home)}

  .occasion{display:flex;align-items:center;gap:${u(0.028)}px;margin-top:${u(0.022)}px}
  .occasion span{font-size:${u(0.032)}px;font-weight:900;letter-spacing:.34em;
                 text-transform:uppercase;white-space:nowrap}
  .occasion i{display:block;width:${u(0.075)}px;height:1px;background:rgba(244,238,226,.42)}

  .tie{display:flex;align-items:center;justify-content:center;
       gap:${Math.round(w * 0.028)}px;margin-top:${u(0.045)}px}
  .col{display:flex;flex-direction:column;align-items:center;gap:${u(0.028)}px;
       width:${Math.round(w * 0.235)}px}

  .shield{width:${u(0.235)}px;height:${u(0.255)}px;padding:3px;
    clip-path:polygon(50% 0%, 100% 0%, 100% 58%, 50% 100%, 0% 58%, 0% 0%);
    display:grid;place-items:center}
  .shield.home{background:linear-gradient(160deg, color-mix(in srgb, var(--home) 85%, #fff) 0%, var(--home) 55%, color-mix(in srgb, var(--home) 45%, #070910) 100%)}
  .shield.away{background:linear-gradient(160deg, color-mix(in srgb, var(--away) 85%, #fff) 0%, var(--away) 55%, color-mix(in srgb, var(--away) 45%, #070910) 100%)}
  .shield-in{width:100%;height:100%;background:#0b0e16;
    clip-path:polygon(50% 0%, 100% 0%, 100% 58%, 50% 100%, 0% 58%, 0% 0%);
    display:grid;place-items:center}
  .shield-in img{width:62%;height:62%;object-fit:contain;margin-top:-6%}
  .mono{font-size:${u(0.085)}px;font-weight:900;font-stretch:75%;margin-top:-6%}
  .home .mono{color:var(--home)} .away .mono{color:var(--away)}

  .club{font-weight:900;font-stretch:75%;text-transform:uppercase;text-align:center;
        font-size:${u(0.052)}px;line-height:1;letter-spacing:-.005em;max-width:100%}
  .rule{width:${u(0.19)}px;height:3px;border-radius:2px}
  .home-rule{background:linear-gradient(90deg, var(--home), transparent)}
  .away-rule{background:linear-gradient(90deg, transparent, var(--away))}

  .vs{font-size:${u(0.085)}px;font-weight:900;font-stretch:62.5%;font-style:italic;
      letter-spacing:-.03em;margin-top:-${u(0.05)}px;
      text-shadow:0 0 ${u(0.05)}px rgba(244,238,226,.25)}

  .meta{display:flex;align-items:center;gap:${Math.round(w * 0.022)}px;margin-top:${u(0.05)}px;
        font-size:${u(0.028)}px;font-weight:700;color:rgba(244,238,226,.9)}
  .meta div{display:flex;align-items:center;gap:9px}
  .meta svg{color:rgba(244,238,226,.5);flex:none}
  .meta .sep{width:1px;height:${u(0.03)}px;background:rgba(244,238,226,.2)}
  .meta b{font-weight:900;letter-spacing:.04em;text-transform:uppercase}

  /* The strip. This is the density the design is for, and it is real data
     rather than a decorative panel with numbers in it. */
  .strip{margin-top:auto;width:100%;display:flex;align-items:stretch;
         border:1px solid rgba(244,238,226,.11);border-radius:${u(0.016)}px;
         background:linear-gradient(180deg, rgba(244,238,226,.045), rgba(244,238,226,.015))}
  .cell{flex:1;display:flex;align-items:center;gap:${u(0.022)}px;
        padding:${u(0.026)}px ${Math.round(w * 0.024)}px}
  .cell + .cell{border-left:1px solid rgba(244,238,226,.11)}
  .cell svg{color:var(--home);flex:none}
  .cell + .cell + .cell svg{color:var(--away)}
  .cl{display:block;font-size:${u(0.021)}px;font-weight:800;letter-spacing:.2em;
      text-transform:uppercase;color:rgba(244,238,226,.55)}
  .cv{display:flex;align-items:center;gap:8px;margin-top:5px;font-size:${u(0.033)}px;font-weight:900}
  .cv .sub{font-size:${u(0.022)}px;font-weight:700;color:rgba(244,238,226,.55)}
  .form-rows{flex-direction:column;align-items:flex-start;gap:5px}
  .dots{display:flex;gap:5px}
  .dots i{display:block;border-radius:50%}
  .d-w{background:#4fd39a} .d-d{background:#8a8f9c} .d-l{background:#e8735f}
  .h2h b{font-size:${u(0.033)}px}
  .h2h span{font-size:${u(0.021)}px;color:rgba(244,238,226,.5);margin-right:6px}

  .brand{position:absolute;right:${Math.round(w * 0.04)}px;top:${u(0.05)}px;
         display:flex;align-items:center;gap:8px;opacity:.75}
  .brand svg{width:${u(0.03)}px;height:${u(0.03)}px}
  .brand span{font-size:${u(0.024)}px;font-weight:900;letter-spacing:.06em}
</style></head>
<body>
  <div class="shard s-home"></div><div class="shard s-home2"></div>
  <div class="shard s-away"></div><div class="shard s-away2"></div>
  <div class="pitch"></div>
  <div class="vig"></div><div class="grain"></div>

  <div class="plate">
    ${input.competitionCrest
      ? `<img class="comp-mark" src="${input.competitionCrest}" alt="">`
      : `<span class="comp-fallback">${esc(input.competition.slice(0, 3).toUpperCase())}</span>`}

    <div class="occasion"><i></i><span>${esc(input.kicker || 'Matchday')}</span><i></i></div>

    <div class="tie">
      <div class="col">
        ${shield(home, 'home')}
        <span class="club" data-fit>${esc(home.name)}</span>
        <span class="rule home-rule"></span>
      </div>
      <span class="vs">VS</span>
      <div class="col">
        ${shield(away, 'away')}
        <span class="club" data-fit>${esc(away.name)}</span>
        <span class="rule away-rule"></span>
      </div>
    </div>

    <div class="meta">
      <div>${icon(ICON.cal, u(0.03))}<b>${esc(input.date)}</b></div>
      <span class="sep"></span>
      <div>${icon(ICON.clock, u(0.03))}<b>${esc(input.time)}</b></div>
      ${input.round && input.round.toUpperCase() !== input.kicker.toUpperCase().replace(/-/g, '') ? `<span class="sep"></span><div>${icon(ICON.flag, u(0.03))}<b>${esc(input.round)}</b></div>` : ''}
    </div>

    ${cells.length ? `<div class="strip">${cells.join('')}</div>` : ''}
  </div>

  <span class="brand">
    <svg viewBox="0 0 100 100"><path d="M22 72 L44 28 M40 72 L62 28 M58 72 L80 28"
      stroke="currentColor" stroke-width="11" stroke-linecap="round" fill="none"/></svg>
    <span>OFFSIDE.WIN</span>
  </span>

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

  // Shrink any club name until it fits its own box in at most two lines.
  //
  // Two earlier versions of this got it wrong in opposite directions. The first
  // measured against the parent element, which is wider than the name's own
  // max-width, so a single long word sailed off the canvas. The second added
  // overflow-wrap:anywhere so it would always fit -- which broke MANCHESTER
  // across two lines mid-word and, because the text could now always fit,
  // stopped the loop firing at all.
  //
  // Words must be unbreakable for the overflow test to mean anything.
  for (const el of document.querySelectorAll('[data-fit]')) {
    let size = parseFloat(getComputedStyle(el).fontSize);
    const lineCount = () => Math.round(el.scrollHeight / (size * 0.88));
    let guard = 0;
    while ((el.scrollWidth > el.clientWidth + 1 || lineCount() > 2) && size > 22 && guard++ < 70) {
      size -= 3;
      el.style.fontSize = size + 'px';
    }
  }

  window.__fitted = true;
})();
`;
