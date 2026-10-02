/**
 * The share card: 1200 by 630, the size every platform's link preview is
 * built around, drawn in the site's own faces and colours.
 *
 * The two clubs' colours (read from their crests at slate time, the same
 * colours the match page's header uses) wash in from either side; the crests
 * and names sit over them; between them is the kick-off, or the final score
 * once there is one. Along the foot is one line of what is public: the free
 * call, that a call exists, or how a settled call went.
 *
 * Rendered by Chromium, which the engine already carries for the posters, as a
 * JPEG: link previews are photographs to every platform, and a PNG of this is
 * several times the size for nothing a phone screen can show.
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchCrest } from '../poster/render.ts';
import { initials } from '../poster/template.ts';
// @ts-expect-error -- plain JS modules shared with the site
import { describe } from '../../../public/js/lib/markets.js';
// @ts-expect-error -- plain JS modules shared with the site
import { cardLine, cardState } from '../../../public/js/lib/cards.js';

export interface CardFixture {
  id: number;
  home: string;
  away: string;
  home_id?: number | null;
  away_id?: number | null;
  league?: string | null;
  kickoff: number;
  score?: number[] | null;
  colors?: { home?: string | null; away?: string | null } | null;
  free_call?: boolean;
  locked?: boolean;
  top_pick?: Record<string, unknown> | null;
  called?: Record<string, unknown> | null;
}

const FONTS = join(dirname(fileURLToPath(import.meta.url)), '../../../public/fonts');
const font = (file: string) => `url(data:font/woff2;base64,${readFileSync(join(FONTS, file)).toString('base64')}) format('woff2')`;
let faces: string | null = null;
function fontFaces(): string {
  faces ??= `
    @font-face { font-family: 'BS'; font-weight: 400 800; src: ${font('bigshoulders-latin.woff2')}; unicode-range: U+0000-00FF, U+2013, U+2019; }
    @font-face { font-family: 'BS'; font-weight: 400 800; src: ${font('bigshoulders-latin-ext.woff2')}; unicode-range: U+0100-02FF, U+1E00-1EFF; }
    @font-face { font-family: 'Archivo'; font-weight: 400 800; src: ${font('archivo-latin.woff2')}; unicode-range: U+0000-00FF, U+2013, U+2019; }
    @font-face { font-family: 'Archivo'; font-weight: 400 800; src: ${font('archivo-latin-ext.woff2')}; unicode-range: U+0100-02FF, U+1E00-1EFF; }
    @font-face { font-family: 'Fig'; font-weight: 800; src: ${font('offside-figures-800.woff2')}; unicode-range: U+0030-0039, U+003A, U+2013; }
    @font-face { font-family: 'Hand'; font-weight: 500 700; src: ${font('caveat-latin.woff2')}; }`;
  return faces;
}

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const HEX = /^#[0-9a-f]{6}$/i;
const colour = (c: unknown, fallback: string) => (typeof c === 'string' && HEX.test(c) ? c : fallback);

function ukWhen(epoch: number) {
  const d = new Date(epoch * 1000);
  return {
    day: new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', weekday: 'short', day: 'numeric', month: 'short' }).format(d),
    time: new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit' }).format(d),
  };
}

export function cardHTML(f: CardFixture, crests: { home: string | null; away: string | null }): string {
  const home = colour(f.colors?.home, '#7a5af8');
  const away = colour(f.colors?.away, '#3a3f4b');
  const state = cardState(f) as string;
  const line = cardLine(f, describe) as { tag: string; main: string; side: string; tone: string };
  const when = ukWhen(f.kickoff);
  const team = (side: 'home' | 'away', name: string, crest: string | null, c: string) => `
    <div class="team ${side}">
      <div class="crest">${crest
        ? `<img src="${crest}" alt="">`
        : `<span class="mono" style="background:${c}">${esc(initials(name))}</span>`}</div>
      <div class="name" data-fit>${esc(name)}</div>
    </div>`;
  const mid = state === 'pre'
    ? `<div class="day">${esc(when.day)}</div><div class="time">${esc(when.time)}</div><div class="tz">UK time</div>`
    : `<div class="score">${esc(state.split('-')[1])}–${esc(state.split('-')[2])}</div><div class="ft">Full time</div>`;

  return `<!doctype html><html><head><meta charset="utf-8"><style>
  ${fontFaces()}
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { width: 1200px; height: 630px; overflow: hidden; }
  body { position: relative; background: #0a0a0c; color: #f4f6fa; font-family: Archivo, sans-serif; }
  .wash { position: absolute; top: -40%; width: 70%; height: 180%; filter: blur(60px); opacity: .55; }
  .wash.home { left: -28%; background: radial-gradient(closest-side, ${home}, transparent); }
  .wash.away { right: -28%; background: radial-gradient(closest-side, ${away}, transparent); }
  .grain { position: absolute; inset: 0; background: linear-gradient(180deg, rgba(10,10,12,0) 40%, rgba(10,10,12,.85) 100%); }
  header { position: absolute; top: 44px; left: 56px; right: 56px; display: flex; justify-content: space-between; align-items: center; }
  .mark { font-family: BS, sans-serif; font-weight: 700; font-size: 44px; letter-spacing: .005em; line-height: 1; }
  .mark i { display: inline-block; width: 3px; height: .86em; margin: 0 5px; background: #7a5af8; vertical-align: -3px; }
  .mark span { color: #8d94a3; }
  .comp { font-size: 22px; color: #c3c8d2; font-weight: 500; max-width: 620px; text-align: right; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  main { position: absolute; top: 118px; left: 56px; right: 56px; height: 340px; display: grid; grid-template-columns: 1fr 300px 1fr; align-items: center; }
  .team { display: flex; flex-direction: column; align-items: center; gap: 22px; min-width: 0; }
  .crest { width: 150px; height: 150px; display: grid; place-items: center; }
  .crest img { max-width: 150px; max-height: 150px; object-fit: contain; filter: drop-shadow(0 10px 30px rgba(0,0,0,.45)); }
  .mono { width: 132px; height: 132px; border-radius: 50%; display: grid; place-items: center; font-family: BS, sans-serif; font-weight: 700; font-size: 56px; }
  .name { width: 100%; max-width: 380px; text-align: center; font-family: BS, sans-serif; font-weight: 700; font-size: 64px; line-height: .92; word-break: keep-all; overflow-wrap: normal; }
  .mid { text-align: center; }
  .day { font-size: 26px; color: #c3c8d2; font-weight: 500; }
  .time { font-family: Fig, BS, sans-serif; font-weight: 800; font-size: 118px; line-height: 1; margin: 6px 0 4px; font-variant-numeric: tabular-nums; }
  .tz { font-size: 18px; color: #8d94a3; }
  .score { font-family: Fig, BS, sans-serif; font-weight: 800; font-size: 150px; line-height: 1; }
  .ft { display: inline-block; margin-top: 10px; padding: 6px 14px; border: 1px solid rgba(244,246,250,.24); border-radius: 999px; font-size: 18px; color: #c3c8d2; }
  footer { position: absolute; left: 0; right: 0; bottom: 0; height: 118px; padding: 0 56px; display: flex; align-items: center; gap: 22px; background: rgba(22,23,27,.92); border-top: 1px solid rgba(244,246,250,.12); }
  footer::before { content: ''; position: absolute; left: 0; top: -1px; width: 100%; height: 3px; background: linear-gradient(90deg, ${home}, #7a5af8 50%, ${away}); opacity: .9; }
  .tag { font-family: Hand, cursive; font-weight: 700; font-size: 34px; color: #9e86ff; white-space: nowrap; }
  .main { flex: 1; min-width: 0; font-size: 32px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .side { font-size: 26px; font-weight: 600; white-space: nowrap; padding: 8px 18px; border-radius: 999px; background: rgba(244,246,250,.08); }
  .tone-won .side { background: rgba(47,191,113,.18); color: #5fe39a; }
  .tone-lost .side { background: rgba(240,67,90,.18); color: #ff7d8f; }
  .tone-accent .side { background: rgba(122,90,248,.22); color: #c9bbff; }
  </style></head><body class="tone-${esc(line.tone)}">
  <div class="wash home"></div><div class="wash away"></div><div class="grain"></div>
  <header><div class="mark">off<i></i>side<span>.win</span></div><div class="comp">${esc(f.league ?? '')}</div></header>
  <main>
    ${team('home', f.home, crests.home, home)}
    <div class="mid">${mid}</div>
    ${team('away', f.away, crests.away, away)}
  </main>
  <footer><span class="tag">${esc(line.tag)}</span><span class="main">${esc(line.main)}</span>${line.side ? `<span class="side">${esc(line.side)}</span>` : ''}</footer>
  <script>
  (async () => {
    await document.fonts.ready;
    for (const img of document.images) { try { if (!img.complete) await img.decode(); } catch {} }
    // Long names shrink to fit their column in at most two lines.
    for (const el of document.querySelectorAll('[data-fit]')) {
      let size = parseFloat(getComputedStyle(el).fontSize);
      const lines = () => Math.round(el.scrollHeight / (size * 0.92));
      let guard = 0;
      while ((el.scrollWidth > el.clientWidth + 1 || lines() > 2) && size > 26 && guard++ < 60) { size -= 2; el.style.fontSize = size + 'px'; }
    }
    window.__ready = true;
  })();
  </script></body></html>`;
}

interface CardPage {
  setContent: (html: string, o?: unknown) => Promise<void>;
  waitForFunction: (fn: string, arg?: unknown, o?: unknown) => Promise<unknown>;
  screenshot: (o?: unknown) => Promise<Buffer>;
  close: () => Promise<void>;
}

/** Draw one card. The browser is passed in so one serves a whole run. */
export async function renderCard(f: CardFixture, browser: { newPage: (o?: unknown) => Promise<CardPage> }): Promise<Buffer> {
  const [home, away] = await Promise.all([fetchCrest(f.home_id), fetchCrest(f.away_id)]);
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  try {
    await page.setContent(cardHTML(f, { home, away }), { waitUntil: 'load' });
    await page.waitForFunction('window.__ready === true', undefined, { timeout: 15_000 });
    return await page.screenshot({ type: 'jpeg', quality: 86 });
  } finally {
    await page.close();
  }
}
