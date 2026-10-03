/**
 * Renders the stadium scene (public/js/lib/stadiumscene.js) with type over it.
 *   node scripts/scene-render.mjs <out.png> [headline]
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const [out, headline = ''] = process.argv.slice(2);
const font = (f) => `url(data:font/woff2;base64,${readFileSync(join(root, 'public/fonts', f)).toString('base64')}) format('woff2')`;
const scene = readFileSync(join(root, 'public/js/lib/stadiumscene.js'), 'utf8').replace(/^export /gm, '');

const html = `<!doctype html><meta charset="utf-8"><style>
@font-face { font-family: W; src: ${font('offside-wordmark.woff2')}; }
@font-face { font-family: D; src: ${font('bigshoulders-latin.woff2')}; font-weight: 100 900; }
* { margin: 0 } body { width: 600px; background: #000 }
.s { position: relative; width: 600px; height: 360px; overflow: hidden }
canvas { width: 600px; height: 360px; display: block }
.mark { position: absolute; left: 0; right: 0; top: 34px; text-align: center; font: 400 44px/1 W; letter-spacing: -1.6px; color: #f6f4ff;
  text-shadow: 0 0 18px rgba(158,134,255,.9), 0 0 42px rgba(122,90,248,.7) }
.mark i { display: inline-block; width: 10px; height: 10px; border-radius: 50%; background: #c9bbff; margin: 0 3px; box-shadow: 0 0 12px #9e86ff }
.mark span { color: #b9b2d6 }
.h { position: absolute; left: 0; right: 0; top: 96px; text-align: center; font: 800 76px/.9 D; color: #fff; letter-spacing: .01em;
  text-shadow: 0 0 22px rgba(158,134,255,.8), 0 0 60px rgba(122,90,248,.6) }
</style><div class="s"><canvas width="1200" height="720"></canvas>
<div class="mark">offside<i></i><span>win</span></div>${headline ? `<div class="h">${headline}</div>` : ''}</div>
<script>${scene}; drawScene(document.querySelector('canvas'), { seed: 11 });</script>`;

const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const p = await b.newPage({ viewport: { width: 600, height: 360 }, deviceScaleFactor: 2 });
await p.setContent(html);
await p.evaluate(() => document.fonts.ready);
await p.waitForTimeout(300);
await (await p.$('.s')).screenshot({ path: out });
await b.close();
console.log('wrote', out);
