/**
 * The channel's own win and loss reactions: short loops in the site's look,
 * sent after a results post instead of borrowed GIFs (a footballer or a
 * creator in a betting post breaks the UK ad rules, and the clips belong to
 * someone else).
 *
 *   win   a green LANDED stamp slams onto the pitch, the screen shakes, confetti.
 *   loss  a red ROUGH ONE glitches in, then settles on WE GO AGAIN.
 *
 * Drawn in Chromium frame by frame (every animation paused and stepped), then
 * joined into an MP4 by ffmpeg, which Telegram plays as a looping GIF.
 * Rendered once with `npm run reactions -w engine` and kept in engine/assets.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const S = 720;
const FPS = 30;
const SECONDS = 3;

const FONTS = fileURLToPath(new URL('../../../public/fonts/', import.meta.url));
const font = (f: string) => `data:font/woff2;base64,${readFileSync(FONTS + f).toString('base64')}`;

function page(kind: 'win' | 'loss'): string {
  const win = kind === 'win';
  // Confetti, from a fixed seed so every render is the same loop.
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const bits = win ? Array.from({ length: 70 }, (_, i) => {
    const a = rnd() * Math.PI * 2, d = 220 + rnd() * 420, c = ['#3db468', '#7a5af8', '#f7f4ed', '#3db468'][i % 4];
    const x = Math.cos(a) * d, y = Math.sin(a) * d - 120, r = Math.round(rnd() * 900 - 450), w = 8 + rnd() * 10;
    return `<i style="background:${c};width:${w}px;height:${w * 2.2}px;--x:${x.toFixed(0)}px;--y:${y.toFixed(0)}px;--r:${r}deg;animation-delay:${(0.42 + rnd() * 0.12).toFixed(2)}s"></i>`;
  }).join('') : '';
  return `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{font-family:'BS';font-weight:400 800;src:url(${font('bigshoulders-latin.woff2')}) format('woff2')}
@font-face{font-family:'WM';font-weight:400 700;src:url(${font('offside-wordmark.woff2')}) format('woff2')}
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:${S}px;height:${S}px;overflow:hidden;background:#0c0b09;color:#f7f4ed}
.stage{position:absolute;inset:0;animation:shake .5s .38s both}
.glow{position:absolute;inset:-20%;background:radial-gradient(circle at 50% 50%,${win ? '#3db468' : '#cb3131'} 0%,transparent 55%);opacity:0;
  animation:glow ${win ? '1.6s .36s' : '.9s .1s'} both}
.line{position:absolute;top:-10%;height:120%;width:10px;left:50%;background:#7a5af8;box-shadow:0 0 40px #7a5af8;transform:translateX(-${S}px) rotate(14deg);
  animation:sweep .45s ease-in both}
.stamp{position:absolute;left:50%;top:46%;font-family:'BS';font-weight:800;font-size:${win ? 150 : 112}px;letter-spacing:.04em;line-height:1;white-space:nowrap;
  color:${win ? '#3db468' : '#cb3131'};border:16px solid currentColor;padding:14px 40px 4px;background:rgba(12,11,9,.75);
  transform:translate(-50%,-50%) rotate(-9deg) scale(1);animation:slam .42s .2s cubic-bezier(.2,1.6,.4,1) both}
.sub{position:absolute;left:0;right:0;top:72%;text-align:center;font-family:'BS';font-weight:800;font-size:64px;letter-spacing:.06em;opacity:0;
  animation:up .4s ${win ? '.9s' : '1.5s'} both}
.wm{position:absolute;left:0;right:0;bottom:44px;text-align:center;font-family:'WM';font-weight:700;font-size:34px;opacity:.85}
.wm b{display:inline-block;width:3px;height:40px;background:#7a5af8;vertical-align:middle;margin:0 4px;transform:skewX(-8deg)}
.wm em{font-style:normal;color:#a39e93}
.bits i{position:absolute;left:50%;top:46%;opacity:0;animation:burst 1.8s cubic-bezier(.1,.7,.3,1) both}
.glitch{animation:glitch 1.3s .2s steps(1) both}
@keyframes sweep{to{transform:translateX(${S}px) rotate(14deg)}}
@keyframes slam{0%{transform:translate(-50%,-50%) rotate(-24deg) scale(3.4);opacity:0}100%{transform:translate(-50%,-50%) rotate(-9deg) scale(1);opacity:1}}
@keyframes shake{0%,100%{transform:none}15%{transform:translate(-14px,10px)}30%{transform:translate(12px,-8px)}45%{transform:translate(-8px,6px)}60%{transform:translate(6px,-4px)}80%{transform:translate(-2px,2px)}}
@keyframes glow{0%{opacity:0}25%{opacity:.6}100%{opacity:.18}}
@keyframes up{from{opacity:0;transform:translateY(24px)}to{opacity:1;transform:none}}
@keyframes burst{0%{opacity:1;transform:translate(-50%,-50%) rotate(0)}85%{opacity:1}100%{opacity:0;transform:translate(calc(-50% + var(--x)),calc(-50% + var(--y) + 260px)) rotate(var(--r))}}
@keyframes glitch{
  0%{text-shadow:-14px 0 #7a5af8,14px 0 #00e5ff;clip-path:inset(0 0 55% 0);transform:translate(-50%,-50%) rotate(-9deg) translateX(-30px)}
  8%{text-shadow:10px 0 #7a5af8,-10px 0 #00e5ff;clip-path:inset(40% 0 0 0);transform:translate(-50%,-50%) rotate(-9deg) translateX(26px)}
  16%{text-shadow:-6px 0 #7a5af8,6px 0 #00e5ff;clip-path:inset(10% 0 30% 0);transform:translate(-50%,-50%) rotate(-9deg) translateX(-12px)}
  24%{text-shadow:none;clip-path:none;transform:translate(-50%,-50%) rotate(-9deg)}
  48%{text-shadow:-8px 0 #7a5af8,8px 0 #00e5ff;clip-path:inset(0 0 70% 0);transform:translate(-50%,-50%) rotate(-9deg) translateX(18px)}
  54%,100%{text-shadow:none;clip-path:none;transform:translate(-50%,-50%) rotate(-9deg)}}
</style></head><body>
<div class="stage">
  <div class="glow"></div><div class="line"></div>
  <div class="bits">${bits}</div>
  <div class="stamp${win ? '' : ' glitch'}">${win ? 'LANDED' : 'ROUGH ONE'}</div>
  <div class="sub">${win ? 'TOLD YOU.' : 'WE GO AGAIN.'}</div>
  <div class="wm">off<b></b>side<em>.win</em></div>
</div>
<script>document.fonts.ready.then(() => { document.getAnimations().forEach((a) => a.pause()); window.__ready = true; });</script>
</body></html>`;
}

interface Pageish {
  setContent(html: string, o?: unknown): Promise<void>;
  waitForFunction(fn: string, arg?: unknown, o?: unknown): Promise<unknown>;
  evaluate<T>(fn: string): Promise<T>;
  screenshot(o?: unknown): Promise<Buffer>;
  close(): Promise<void>;
}

/** Render one reaction to an MP4 and return its bytes. Needs ffmpeg on the PATH. */
export async function renderReaction(browser: { newPage(o?: unknown): Promise<Pageish> }, kind: 'win' | 'loss'): Promise<Buffer> {
  const dir = mkdtempSync(join(tmpdir(), `react-${kind}-`));
  const p = await browser.newPage({ viewport: { width: S, height: S }, deviceScaleFactor: 1 });
  try {
    await p.setContent(page(kind), { waitUntil: 'load' });
    await p.waitForFunction('window.__ready === true', undefined, { timeout: 15_000 });
    const frames = FPS * SECONDS;
    for (let f = 0; f < frames; f++) {
      const ms = (f * 1000) / FPS;
      await p.evaluate<void>(`document.getAnimations().forEach((a) => { a.currentTime = ${ms}; })`);
      writeFileSync(join(dir, `f${String(f).padStart(4, '0')}.png`), await p.screenshot({ type: 'png' }));
    }
    const out = join(dir, 'out.mp4');
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', join(dir, 'f%04d.png'),
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', '-crf', '22', out]);
    return readFileSync(out);
  } finally {
    await p.close();
    rmSync(dir, { recursive: true, force: true });
  }
}
