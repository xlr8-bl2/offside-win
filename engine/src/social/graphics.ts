/**
 * The pictures that go with the channel's posts, drawn in Chromium at
 * 1080x1350 (the portrait size Telegram, Instagram and X all show whole).
 *
 *   freeCallHTML  the morning post: both crests big in their clubs' colours,
 *                 a one-line take in capitals, the call and its odds.
 *   resultsHTML   the night post: the day's true count as the headline, and
 *                 every graded call underneath it, misses included.
 *
 * Fonts are the site's own (public/fonts), inlined so the page needs nothing
 * from the network. Club colours come from the crests, sampled in the page the
 * same way the matchday posters do it (poster/palette.ts).
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { choosePalette, hex, pairPalettes, type Sample } from '../poster/palette.ts';

export const W = 1080;
export const H = 1350;

const FONTS = fileURLToPath(new URL('../../../public/fonts/', import.meta.url));
const font = (f: string) => `data:font/woff2;base64,${readFileSync(FONTS + f).toString('base64')}`;
let faces: string | null = null;
function fontFaces(): string {
  faces ??= `
@font-face { font-family: 'BS'; font-weight: 400 800; src: url(${font('bigshoulders-latin.woff2')}) format('woff2'); }
@font-face { font-family: 'BS'; font-weight: 400 800; src: url(${font('bigshoulders-latin-ext.woff2')}) format('woff2'); unicode-range: U+0100-02BA, U+1E00-1EFF; }
@font-face { font-family: 'AR'; font-weight: 400 800; src: url(${font('archivo-latin.woff2')}) format('woff2'); }
@font-face { font-family: 'AR'; font-weight: 400 800; src: url(${font('archivo-latin-ext.woff2')}) format('woff2'); unicode-range: U+0100-02BA, U+1E00-1EFF; }
@font-face { font-family: 'FIG'; font-weight: 700 800; src: url(${font('offside-figures-800.woff2')}) format('woff2'); unicode-range: U+0030-0039, U+002B-002E, U+003A, U+2013; }
@font-face { font-family: 'WM'; font-weight: 400 700; src: url(${font('offside-wordmark.woff2')}) format('woff2'); }`;
  return faces;
}

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

const BASE = `
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:${W}px;height:${H}px;overflow:hidden}
body{background:#0c0b09;color:#f7f4ed;font-family:'AR',sans-serif;position:relative;
  --home:#7a5af8;--away:#7a5af8;--violet:#7a5af8;--won:#3db468;--lost:#cb3131;--quiet:#a39e93}
.grain{position:absolute;inset:0;opacity:.09;mix-blend-mode:overlay;pointer-events:none;
  background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='240' height='240'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")}
.top{position:absolute;left:72px;right:72px;top:64px;display:flex;justify-content:space-between;align-items:center;z-index:3}
.wm{font-family:'WM','AR',sans-serif;font-weight:700;font-size:44px;letter-spacing:-.01em;display:flex;align-items:center;gap:6px}
.wm i{display:inline-block;width:4px;height:52px;background:var(--violet);transform:skewX(-8deg)}
.wm em{font-style:normal;color:var(--quiet)}
.tag{font-family:'BS';font-weight:800;font-size:40px;letter-spacing:.06em;text-transform:uppercase;
  background:var(--violet);color:#fff;padding:10px 22px 8px;transform:rotate(-3deg);box-shadow:8px 8px 0 #000}
.foot{position:absolute;left:72px;right:72px;bottom:56px;display:flex;justify-content:space-between;
  font-size:24px;color:var(--quiet);letter-spacing:.02em;z-index:3}
.foot b{color:#f7f4ed;font-weight:600}
`;

/* ------------------------------------------------------------ free call */

export interface FreeCallArt {
  home: string; away: string; homeCrest: string | null; awayCrest: string | null;
  competition: string; kickoff: string; day: string;
  hook: string; call: string; market: string; odds: string; loses: string | null;
}

function crest(src: string | null, name: string, id: string): string {
  if (src) return `<img id="${id}" class="crest" src="${src}" alt="">`;
  const ini = name.split(/\s+/).filter((w) => !/^(fc|cf|cd|ud|ac|sc|club|de|1\.)$/i.test(w)).map((w) => w[0]).join('').slice(0, 3).toUpperCase();
  return `<div class="crest mono">${esc(ini)}</div>`;
}

export function freeCallHTML(a: FreeCallArt): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>${fontFaces()}${BASE}
.bloom{position:absolute;width:1300px;height:1300px;border-radius:50%;filter:blur(120px);opacity:.55}
.b1{left:-560px;top:-380px;background:var(--home)}
.b2{right:-600px;top:120px;background:var(--away)}
.shade{position:absolute;inset:0;background:linear-gradient(180deg,rgba(12,11,9,.1) 0%,rgba(12,11,9,.35) 45%,#0c0b09 72%)}
.line{position:absolute;left:50%;top:-60px;width:6px;height:700px;background:var(--violet);transform:rotate(14deg);
  box-shadow:0 0 40px var(--violet);opacity:.9}
.vs{position:absolute;left:0;right:0;top:190px;display:grid;grid-template-columns:1fr 1fr;z-index:2}
.side{display:flex;flex-direction:column;align-items:center;gap:26px}
.crest{width:300px;height:300px;object-fit:contain;filter:drop-shadow(0 24px 40px rgba(0,0,0,.6))}
.mono{display:flex;align-items:center;justify-content:center;border-radius:50%;background:rgba(255,255,255,.08);
  font-family:'BS';font-weight:800;font-size:120px}
.name{font-family:'BS';font-weight:800;font-size:64px;line-height:.95;text-transform:uppercase;text-align:center;
  max-width:440px;text-wrap:balance;text-shadow:0 4px 30px rgba(0,0,0,.5)}
.v{position:absolute;left:50%;top:330px;transform:translate(-50%,0);z-index:3;font-family:'BS';font-weight:800;font-size:56px;
  color:#0c0b09;background:#f7f4ed;width:92px;height:92px;border-radius:50%;display:flex;align-items:center;justify-content:center}
.when{position:absolute;left:0;right:0;top:700px;text-align:center;font-size:30px;color:#d8d3c8;letter-spacing:.04em;z-index:2}
.when b{font-family:'FIG','BS';font-weight:800;color:#fff}
.hook{position:absolute;left:72px;right:72px;top:770px;font-family:'BS';font-weight:800;font-size:112px;line-height:.88;
  text-transform:uppercase;text-wrap:balance;z-index:2}
.hook span{color:var(--violet)}
.call{position:absolute;left:72px;right:72px;bottom:150px;z-index:2;display:flex;align-items:stretch;
  background:rgba(32,28,23,.92);border:2px solid rgba(247,244,237,.12);border-left:10px solid var(--violet)}
.call .what{flex:1;padding:26px 30px}
.call small{display:block;font-size:22px;letter-spacing:.14em;text-transform:uppercase;color:var(--quiet);margin-bottom:8px}
.call strong{display:block;font-family:'BS';font-weight:800;font-size:64px;line-height:1;text-transform:uppercase}
.call p{font-size:24px;color:#d8d3c8;margin-top:10px}
.call .odds{background:var(--violet);color:#fff;padding:26px 34px;display:flex;flex-direction:column;justify-content:center;align-items:center}
.call .odds small{color:rgba(255,255,255,.8);margin:0 0 4px}
.call .odds b{font-family:'FIG','BS';font-weight:800;font-size:84px;line-height:1}
</style></head><body>
<div class="bloom b1"></div><div class="bloom b2"></div><div class="line"></div><div class="shade"></div>
<div class="top"><div class="wm">off<i></i>side<em>.win</em></div><div class="tag">Free call</div></div>
<div class="vs">
  <div class="side">${crest(a.homeCrest, a.home, 'crest-home')}<div class="name" data-fit>${esc(a.home)}</div></div>
  <div class="side">${crest(a.awayCrest, a.away, 'crest-away')}<div class="name" data-fit>${esc(a.away)}</div></div>
</div>
<div class="v">v</div>
<div class="when">${esc(a.day)} · <b>${esc(a.kickoff)}</b> UK · ${esc(a.competition)}</div>
<div class="hook" data-fit-hook>${a.hook}</div>
<div class="call">
  <div class="what"><small>The call · ${esc(a.market)}</small><strong data-fit-call>${esc(a.call)}</strong>${a.loses ? `<p>Only loses if ${esc(a.loses)}</p>` : ''}</div>
  <div class="odds"><small>odds of</small><b>${esc(a.odds)}</b></div>
</div>
<div class="foot"><span><b>Full case free</b> at offside.win</span><span>18+ · BeGambleAware.org</span></div>
<div class="grain"></div>
<script>${SAMPLER}</script>
</body></html>`;
}

/* -------------------------------------------------------------- results */

export interface ResultRow { mark: 'won' | 'lost' | 'back'; home: string; away: string; score: string; call: string; odds: string }
export interface ResultsArt { day: string; landed: number; graded: number; hook: string; rows: ResultRow[] }

export function resultsHTML(a: ResultsArt): string {
  const good = a.landed / a.graded >= 0.7;
  const MAX = 9;
  const rows = a.rows.slice(0, MAX);
  const more = a.rows.length - rows.length;
  const tone = good ? 'var(--won)' : a.landed / a.graded >= 0.5 ? 'var(--violet)' : 'var(--lost)';
  const icon = (m: ResultRow['mark']) => m === 'won' ? '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="#fff" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/></svg>'
    : m === 'lost' ? '<svg viewBox="0 0 24 24"><path d="M7 7l10 10M17 7L7 17" fill="none" stroke="#fff" stroke-width="3.4" stroke-linecap="round"/></svg>'
    : '<svg viewBox="0 0 24 24"><path d="M8 7l-4 4 4 4M4 11h11a5 5 0 010 10h-3" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  return `<!doctype html><html><head><meta charset="utf-8"><style>${fontFaces()}${BASE}
body{--tone:${tone}}
.bloom{position:absolute;width:1400px;height:1100px;border-radius:50%;filter:blur(140px);opacity:.42;left:-200px;top:-640px;background:var(--tone)}
.day{position:absolute;left:72px;top:160px;font-size:30px;letter-spacing:.16em;text-transform:uppercase;color:#d8d3c8}
.count{position:absolute;left:62px;top:190px;font-family:'FIG','BS';font-weight:800;font-size:230px;line-height:.9;letter-spacing:-.02em}
.count span{color:var(--quiet)}
.stamp{position:absolute;right:78px;top:215px;font-family:'BS';font-weight:800;font-size:78px;letter-spacing:.05em;color:var(--tone);
  border:9px solid var(--tone);padding:6px 26px 2px;transform:rotate(-9deg);text-transform:uppercase;background:rgba(12,11,9,.6)}
.hook{position:absolute;left:72px;right:72px;top:420px;font-family:'BS';font-weight:800;font-size:84px;white-space:nowrap;line-height:.9;text-transform:uppercase;text-wrap:balance}
.list{position:absolute;left:72px;right:72px;top:${a.hook ? 524 : 440}px;display:flex;flex-direction:column;gap:8px}
.row{display:grid;grid-template-columns:52px 1fr auto;gap:22px;align-items:center;background:rgba(32,28,23,.88);
  border:1px solid rgba(247,244,237,.08);padding:0 22px;height:70px;flex:none}
.ic{width:46px;height:46px;border-radius:50%;display:flex;align-items:center;justify-content:center}
.ic svg{width:32px;height:32px}
.won .ic{background:var(--won)} .lost .ic{background:var(--lost)} .back .ic{background:#5d574d}
.m{font-size:26px;line-height:1.15;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.m b{font-family:'FIG','AR';font-weight:800;margin:0 6px}
.c{font-size:20px;line-height:1.2;color:var(--quiet);margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.o{font-family:'FIG','BS';font-weight:800;font-size:36px}
.lost .m,.lost .o{opacity:.75}
.more{font-size:24px;color:var(--quiet);padding-left:4px}
</style></head><body>
<div class="bloom"></div>
<div class="top"><div class="wm">off<i></i>side<em>.win</em></div><div class="tag">Results</div></div>
<div class="day">${esc(a.day)}'s calls</div>
<div class="count">${a.landed}<span>/${a.graded}</span></div>
<div class="stamp">Landed</div>
${a.hook ? `<div class="hook" data-fit-call>${a.hook}</div>` : ''}
<div class="list">
${rows.map((r) => `<div class="row ${r.mark}"><div class="ic">${icon(r.mark)}</div><div style="min-width:0"><div class="m">${esc(r.home)}<b>${esc(r.score)}</b>${esc(r.away)}</div><div class="c">${esc(r.call)}</div></div><div class="o">${esc(r.odds)}</div></div>`).join('\n')}
${more > 0 ? `<div class="more">+ ${more} more on the results page</div>` : ''}
</div>
<div class="foot"><span><b>Every call, every result</b> at offside.win/results</span><span>18+ · BeGambleAware.org</span></div>
<div class="grain"></div>
<script>${SAMPLER}</script>
</body></html>`;
}

/* -------------------------------------------------------------- render */

const SAMPLER = `
(async () => {
  function sample(img) {
    const c = document.createElement('canvas'); const n = 64; c.width = n; c.height = n;
    const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0, n, n);
    const { data } = g.getImageData(0, 0, n, n); const bins = new Map();
    for (let i = 0; i < data.length; i += 16) {
      if (data[i + 3] < 160) continue;
      const r = data[i], gg = data[i + 1], b = data[i + 2];
      const key = (r >> 4) + ',' + (gg >> 4) + ',' + (b >> 4);
      const e = bins.get(key) || { r: 0, g: 0, b: 0, n: 0 }; e.r += r; e.g += gg; e.b += b; e.n++; bins.set(key, e);
    }
    return [...bins.values()].map((e) => ({ colour: { r: e.r / e.n, g: e.g / e.n, b: e.b / e.n }, weight: e.n }));
  }
  const out = {};
  for (const which of ['home', 'away']) {
    const img = document.getElementById('crest-' + which);
    try { if (img && !img.complete) await img.decode(); out[which] = img && img.naturalWidth > 8 ? sample(img) : []; } catch { out[which] = []; }
  }
  window.__samples = out;
  await document.fonts.ready;
  const fit = (el, min) => { let s = parseFloat(getComputedStyle(el).fontSize); while ((el.scrollWidth > el.clientWidth + 1 || el.getBoundingClientRect().height > (el.dataset.maxh || 1e9)) && s > min) { s -= 2; el.style.fontSize = s + 'px'; } };
  for (const el of document.querySelectorAll('[data-fit]')) { el.style.overflowWrap = 'normal'; el.dataset.maxh = 130; fit(el, 34); }
  for (const el of document.querySelectorAll('[data-fit-hook]')) { el.dataset.maxh = 215; fit(el, 56); }
  for (const el of document.querySelectorAll('[data-fit-call]')) { el.style.whiteSpace = 'nowrap'; el.style.overflow = 'hidden'; fit(el, 34); }
  window.__fitted = true;
})();`;

interface Page {
  setContent(html: string, o?: unknown): Promise<void>;
  waitForFunction(fn: string, arg?: unknown, o?: unknown): Promise<unknown>;
  evaluate<T>(fn: string): Promise<T>;
  screenshot(o?: unknown): Promise<Buffer>;
  close(): Promise<void>;
}
export interface Browserish { newPage(o?: unknown): Promise<Page> }

/** Draw one page to a JPEG, with the club colours applied from its crests. */
export async function render(browser: Browserish, html: string): Promise<Buffer> {
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  try {
    await page.setContent(html, { waitUntil: 'load' });
    await page.waitForFunction('window.__fitted === true', undefined, { timeout: 15_000 });
    const s = await page.evaluate<{ home: Sample[]; away: Sample[] }>('window.__samples');
    if (s.home?.length || s.away?.length) {
      const [h, a] = pairPalettes(choosePalette(s.home ?? []), choosePalette(s.away ?? []));
      await page.evaluate<void>(`(() => { const b = document.body.style; b.setProperty('--home', ${JSON.stringify(hex(h.primary))}); b.setProperty('--away', ${JSON.stringify(hex(a.primary))}); })()`);
    }
    return await page.screenshot({ type: 'jpeg', quality: 90 });
  } finally {
    await page.close();
  }
}
