/**
 * The artwork the emails carry, drawn with the site's own fonts and colours
 * and saved as images (public/brand/mail/*.png), because a mail app shows
 * images where it will not load a font or run a gradient: Gmail draws the
 * headline in Arial, never in Big Shoulders.
 *
 *   node scripts/mail-art.mjs        # writes the PNGs, 2x for sharp phones
 *
 * Every image is 600 CSS px wide, the width of the email. Words a reader
 * needs (dates, prices, reasons) stay as live text in the email itself; the
 * art only carries the brand and the mood.
 */
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
// Embedded: a page set from a string cannot read local files.
const font = (f) => `url(data:font/woff2;base64,${readFileSync(join(root, 'public/fonts', f)).toString('base64')}) format('woff2')`;
const OUT = join(root, 'public/brand/mail');

const BASE = `
@font-face { font-family: W; src: ${font('offside-wordmark.woff2')}; }
@font-face { font-family: D; src: ${font('bigshoulders-latin.woff2')}; font-weight: 100 900; }
@font-face { font-family: B; src: ${font('archivo-latin.woff2')}; font-weight: 100 900; }
* { margin: 0; box-sizing: border-box; }
body { width: 600px; background: #0a0a0c; }
.art { position: relative; width: 600px; overflow: hidden; background: #0a0a0c; }
/* Two floodlights over the ground, the violet one on the left. */
.beam { position: absolute; top: -120px; width: 520px; height: 520px; pointer-events: none; }
.beam.l { left: -210px; background: radial-gradient(closest-side, rgba(122,90,248,.55), rgba(122,90,248,.12) 55%, transparent 75%); }
.beam.r { right: -260px; background: radial-gradient(closest-side, rgba(244,246,250,.16), rgba(244,246,250,.04) 55%, transparent 75%); }
/* The pitch: halfway line and centre circle, in chalk, barely there. */
.pitch { position: absolute; inset: 0; opacity: .09; }
.pitch::before { content: ''; position: absolute; left: 50%; top: 0; bottom: 0; border-left: 2px solid #f4f6fa; }
.pitch::after { content: ''; position: absolute; left: 50%; top: 100%; width: 300px; height: 300px; margin: -150px 0 0 -150px; border: 2px solid #f4f6fa; border-radius: 50%; }
.mark { position: absolute; left: 32px; top: 26px; font: 400 30px/1 W; letter-spacing: -1.2px; color: #f4f6fa; }
.mark i { display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: #9e86ff; margin: 0 2px; font-style: normal; }
.mark span { color: #8d94a3; }
.d { font-family: D; font-weight: 800; color: #f4f6fa; letter-spacing: .01em; line-height: .9; }
.b { font-family: B; }
`;

const mark = '<div class="mark">offside<i></i><span>win</span></div>';
const ground = '<div class="beam l"></div><div class="beam r"></div><div class="pitch"></div>';

const ART = {
  // Every email: the floodlit ground and the wordmark.
  top: { h: 96, html: `${ground}${mark}` },

  // Joining, renewing: a member's pass, torn along the perforation.
  pass: { h: 230, html: `${ground}${mark}
    <div style="position:absolute;right:30px;top:40px;width:330px;height:160px;border-radius:14px;
      background:linear-gradient(125deg,#9e86ff 0%,#7a5af8 45%,#4b2fd1 100%);box-shadow:0 18px 50px rgba(122,90,248,.45);overflow:hidden;transform:rotate(-4deg)">
      <div style="position:absolute;inset:0;background:repeating-linear-gradient(115deg,rgba(255,255,255,.06) 0 2px,transparent 2px 14px)"></div>
      <div style="position:absolute;right:92px;top:0;bottom:0;border-left:2px dashed rgba(10,10,12,.45)"></div>
      <div style="position:absolute;right:83px;top:-10px;width:20px;height:20px;border-radius:50%;background:#0a0a0c"></div>
      <div style="position:absolute;right:83px;bottom:-10px;width:20px;height:20px;border-radius:50%;background:#0a0a0c"></div>
      <div style="position:absolute;left:22px;top:20px" class="b"><div style="font:600 12px/1 B;color:rgba(10,10,12,.7)">offside.win</div></div>
      <div style="position:absolute;left:20px;bottom:22px" class="d"><div style="font-size:64px;color:#0a0a0c">Member</div>
        <div class="b" style="font:600 13px/1.2 B;color:rgba(10,10,12,.75);margin-top:6px">Every call. Every slip.</div></div>
      <div style="position:absolute;right:22px;top:24px;bottom:24px;width:46px;display:flex;flex-direction:column;justify-content:space-between">
        ${Array.from({ length: 13 }, (_, i) => `<div style="height:${i % 3 ? 3 : 6}px;background:rgba(10,10,12,.7)"></div>`).join('')}
      </div>
    </div>` },

  // Free time and goodwill days: the same pass, stamped.
  onus: { h: 230, html: `${ground}${mark}
    <div style="position:absolute;right:30px;top:40px;width:330px;height:160px;border-radius:14px;
      background:linear-gradient(125deg,#9e86ff 0%,#7a5af8 45%,#4b2fd1 100%);box-shadow:0 18px 50px rgba(122,90,248,.45);overflow:hidden;transform:rotate(-4deg)">
      <div style="position:absolute;inset:0;background:repeating-linear-gradient(115deg,rgba(255,255,255,.06) 0 2px,transparent 2px 14px)"></div>
      <div style="position:absolute;left:20px;bottom:22px" class="d"><div style="font-size:64px;color:#0a0a0c">Member</div></div>
      <div style="position:absolute;right:18px;top:26px;transform:rotate(12deg);border:4px solid #f4f6fa;border-radius:10px;padding:8px 14px" class="d">
        <div style="font-size:44px;color:#f4f6fa">On us</div></div>
    </div>` },

  // Sign-in: tap in at the turnstile.
  gate: { h: 230, html: `${ground}${mark}
    ${[150, 110, 72].map((d, i) => `<div style="position:absolute;right:${155 - d / 2}px;top:${115 - d / 2}px;width:${d}px;height:${d}px;border-radius:50%;
      border:2px solid rgba(158,134,255,${[0.25, 0.5, 0.9][i]});box-shadow:0 0 ${[40, 26, 18][i]}px rgba(122,90,248,${[0.25, 0.35, 0.6][i]})"></div>`).join('')}
    <div style="position:absolute;right:136px;top:96px;width:38px;height:38px;border-radius:50%;background:#f4f6fa;box-shadow:0 0 30px #9e86ff"></div>
    <div class="d" style="position:absolute;left:32px;bottom:34px;font-size:84px">Tap in.</div>` },

  // A call pulled before kick-off: the decision on the big screen.
  var: { h: 230, html: `${ground}${mark}
    <div style="position:absolute;right:30px;top:36px;width:320px;height:164px;border-radius:12px;background:#16171b;
      border:3px solid #2a2d34;box-shadow:0 16px 46px rgba(0,0,0,.6),inset 0 0 0 2px #0a0a0c;overflow:hidden">
      <div style="position:absolute;inset:0;background:repeating-linear-gradient(0deg,rgba(244,246,250,.035) 0 2px,transparent 2px 4px)"></div>
      <div style="position:absolute;left:20px;top:14px;display:flex;align-items:center;gap:8px" class="b">
        <span style="width:9px;height:9px;border-radius:50%;background:#f0435a;box-shadow:0 0 10px #f0435a"></span>
        <span style="font:600 12px/1 B;color:#c3c8d2">Check complete</span></div>
      <div class="d" style="position:absolute;left:20px;bottom:18px;font-size:54px">Call<br><span style="color:#f0435a">pulled</span></div>
    </div>` },
};

const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const p = await b.newPage({ viewport: { width: 600, height: 400 }, deviceScaleFactor: 2 });
for (const [name, a] of Object.entries(ART)) {
  await p.setContent(`<!doctype html><style>${BASE}</style><div class="art" style="height:${a.h}px">${a.html}</div>`);
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(150);
  await (await p.$('.art')).screenshot({ path: join(OUT, `${name}.png`) });
  console.log(`  ${name}.png  600x${a.h}`);
}
await b.close();
