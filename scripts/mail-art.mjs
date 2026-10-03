/**
 * The artwork the emails carry, drawn with the site's own fonts and colours
 * and saved as images (public/brand/mail/*.png): a mail app will not load a
 * web font or draw a gradient reliably (Gmail sets every headline in Arial),
 * so the loud parts are pictures and everything a reader needs (dates,
 * prices, reasons, links) stays live text in the email itself.
 *
 * After the four emails the owner pointed at: Hello Klean's products floating
 * at angles round a big centred headline, with a rounded card overlapping the
 * hero; Candy Creams' coloured feature cards with the product breaking out of
 * them; NYCFC's crest-v-crest matchday lockup; Little Crafts' one giant
 * silhouette as the whole stage. Our products are our own: a football
 * (rendered in Blender, scripts/mail/ball.py), a call card, the bet slip, a
 * member's pass.
 *
 *   node scripts/mail-art.mjs            # everything, 2x for sharp phones
 *   node scripts/mail-art.mjs hero-joined
 */
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync, mkdirSync } from 'node:fs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const font = (f) => `url(data:font/woff2;base64,${readFileSync(join(root, 'public/fonts', f)).toString('base64')}) format('woff2')`;
const OUT = join(root, 'public/brand/mail');

// The ball: a real one, rendered in Blender (scripts/mail/ball.py), with a
// transparent background. Run that first.
const BALL = `data:image/png;base64,${readFileSync(join(OUT, 'ball.png')).toString('base64')}`;
// The other things that float, rendered the same way (scripts/mail/objects.py).
const OBJ = (n) => `data:image/png;base64,${readFileSync(join(OUT, `obj-${n}.png`)).toString('base64')}`;

const CSS = `
@font-face { font-family: W; src: ${font('offside-wordmark.woff2')}; }
@font-face { font-family: D; src: ${font('bigshoulders-latin.woff2')}; font-weight: 100 900; }
@font-face { font-family: B; src: ${font('archivo-latin.woff2')}; font-weight: 100 900; }
* { margin: 0; box-sizing: border-box; }
body { background: transparent; }
.art { position: relative; overflow: hidden; }
.wm { font: 700 26px/1 W; letter-spacing: -1.2px; color: #f4f6fa; white-space: nowrap; }
.wm i { display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: #9e86ff; margin: 0 1.5px; }
.wm span { color: #b9b3c9; }
.d { font-family: D; font-weight: 800; color: #f4f6fa; line-height: .86; letter-spacing: .005em; }
.b { font-family: B; }
.float { position: absolute; filter: drop-shadow(0 22px 28px rgba(5, 3, 18, .55)) drop-shadow(0 4px 8px rgba(5, 3, 18, .35)); }
/* A call, as the site shows one: the crest, the call, the odds, the book. */
.call { width: 214px; padding: 16px 16px 14px; border-radius: 16px; background: #202329; border: 1px solid #2c3038; color: #f4f6fa; font-family: B; }
.call .top { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
.crest { width: 34px; height: 34px; border-radius: 50%; display: grid; place-items: center; font: 800 12px/1 B; color: #fff; }
.call .who { font: 600 13px/1.2 B; color: #c3c8d2; }
.call .pick { font: 700 19px/1.15 B; margin-bottom: 12px; }
.call .row { display: flex; align-items: baseline; justify-content: space-between; }
.call .odds { font: 800 34px/1 D; letter-spacing: -.01em; }
.call .book { font: 600 12px/1 B; color: #8d94a3; }
.call .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #9e86ff; box-shadow: 0 0 8px rgba(158, 134, 255, .8); margin-right: 6px; }
/* The slip: legs, and the total. */
.slip { width: 220px; padding: 16px; border-radius: 16px; background: #f4f6fa; color: #16171b; font-family: B; }
.slip h4 { font: 800 24px/1 D; margin-bottom: 10px; }
.slip .leg { display: flex; justify-content: space-between; gap: 8px; padding: 8px 0; border-top: 1px solid #dfe2e8; font: 600 12.5px/1.25 B; }
.slip .leg b { font: 800 17px/1 D; }
.slip .tot { display: flex; justify-content: space-between; align-items: baseline; padding-top: 10px; border-top: 2px solid #16171b; font: 700 13px/1 B; }
.slip .tot b { font: 800 30px/1 D; color: #5b3fe0; }
/* A member's pass. */
.pass { width: 200px; height: 126px; border-radius: 16px; padding: 16px; color: #fff; font-family: B; overflow: hidden;
  background: linear-gradient(135deg, #a58eff 0%, #7a5af8 45%, #4b2fd1 100%); }
.pass::after { content: ''; position: absolute; inset: 0; border-radius: 16px; background: repeating-linear-gradient(115deg, rgba(255,255,255,.07) 0 2px, transparent 2px 12px); }
.pass .wm { font-size: 19px; }
.pass .wm i { background: #fff; }
.pass .wm span { color: rgba(255,255,255,.75); }
.pass .m { position: absolute; left: 16px; bottom: 14px; font: 800 30px/1 D; }
.pass .chip { position: absolute; right: 16px; bottom: 18px; width: 30px; height: 22px; border-radius: 5px; background: linear-gradient(135deg, #ffe1a1, #f5a524); }

`;

const callCard = ({ crest = '#c8102e', tag = 'ARS', who = 'Arsenal v Liverpool', pick = 'Arsenal to win', odds = '1.85', book = 'at bet365' } = {}) => `
  <div class="call"><div class="top"><div class="crest" style="background:${crest}">${tag}</div><div class="who">${who}</div></div>
  <div class="pick">${pick}</div><div class="row"><div class="odds"><span class="dot"></span>${odds}</div><div class="book">${book}</div></div></div>`;
const slipCard = () => `
  <div class="slip"><h4>The slip</h4>
  <div class="leg"><span>Arsenal to win</span><b>1.85</b></div>
  <div class="leg"><span>Over 1.5 goals, Inter v Napoli</span><b>1.28</b></div>
  <div class="leg"><span>Bayern to win</span><b>1.30</b></div>
  <div class="tot"><span>Together</span><b>3.08</b></div></div>`;
const passCard = () => `<div class="pass"><div class="wm">offside<i></i><span>win</span></div><div class="m">Member</div><div class="chip"></div></div>`;

/* ----------------------------------------------------------------- art */
/*
 * A hero: the headline big in the middle, a pill under it, our products
 * floating round it at angles, and the top of the card that overlaps it drawn
 * across the foot (so the overlap holds in every mail app).
 */
/*
 * Where floating things go: four corners round the headline, each with its
 * own size and tilt so no two heroes stand the same way. `o` is what goes in
 * the slot: the 3D renders (ball, whistle, stopwatch, cards, key, padlock,
 * gift, envelope, board) or the flat products (pass, call, slip).
 */
const SLOT = {
  tl: (h, sz) => ({ left: 22, top: 70, s: sz ?? 150, r: -12 }),
  tr: (h, sz) => ({ right: 20, top: 62, s: sz ?? 150, r: 10 }),
  bl: (h, sz) => ({ left: 16, top: h - 40 - (sz ?? 170), s: sz ?? 170, r: -8 }),
  br: (h, sz) => ({ right: 18, top: h - 40 - (sz ?? 170), s: sz ?? 170, r: 9 }),
};
const FLAT = { pass: passCard, call: () => callCard(), slip: slipCard };
function place([o, slot, size], h) {
  const p = SLOT[slot](h, size);
  const x = p.left !== undefined ? `left:${p.left}px` : `right:${p.right}px`;
  if (FLAT[o]) {
    // The flat products, scaled to the slot's width from their own ~214px.
    const k = (p.s / 214).toFixed(3);
    const origin = p.left !== undefined ? '0 0' : '100% 0';
    return `<div class="float" style="${x};top:${p.top}px;transform:rotate(${p.r}deg) scale(${k});transform-origin:${origin}">${FLAT[o]()}</div>`;
  }
  const src = o === 'ball' ? BALL : OBJ(o);
  return `<img class="float" src="${src}" style="${x};top:${p.top}px;width:${p.s}px;height:${p.s}px;transform:rotate(${p.r}deg)">`;
}

const BG = 'radial-gradient(70% 55% at 50% 38%, #4a33c8 0%, #2a1a7a 45%, #120c34 80%, #0b0818 100%)';
const cardTop = (h) => `<div style="position:absolute;left:20px;right:20px;top:${h - 32}px;height:80px;border-radius:26px 26px 0 0;background:#16171b;border:1px solid #2a2d34;border-bottom:0;box-shadow:0 -10px 30px rgba(5,3,18,.45);z-index:5"></div>`;
function hero({ head, pill, size = 128, h = 560, top, objects = [], right = 40 }) {
  const t = top ?? Math.round(h * 0.35);
  return { w: 600, h, over: cardTop(h), html: `
    <div class="art" style="width:600px;height:${h}px;background:${BG}">
      <div class="wm" style="position:absolute;left:0;right:0;top:34px;text-align:center">offside<i></i><span>win</span></div>
      ${objects.map((o) => place(o, h)).join('')}
      <div style="position:absolute;left:40px;right:${right}px;top:${t}px;text-align:center">
        <div class="d" style="font-size:${size}px">${head}</div>
        ${pill ? `<div style="display:inline-block;margin-top:20px;padding:11px 22px;border:2.5px solid #f4f6fa;border-radius:999px;font:600 21px/1 B;color:#f4f6fa;background:rgba(11,8,24,.25)">${pill}</div>` : ''}
      </div>
    </div>` };
}

/*
 * Little Crafts' one giant silhouette as the whole stage: the Premier League
 * trophy (public/brand/pl-trophy.svg) in black against one hard disc of
 * light, the words set over its body. `bright` is the light back on.
 */
const TROPHY = `data:image/svg+xml;base64,${readFileSync(join(root, 'public/brand/pl-trophy.svg')).toString('base64')}`;
function stage({ head, pill, bright = false, h = 620 }) {
  const disc = bright ? 470 : 330;
  return { w: 600, h, over: cardTop(h), html: `
    <div class="art" style="width:600px;height:${h}px;background:
      radial-gradient(60% 70% at 50% 46%, #2c1f66 0%, #1a1240 42%, rgba(12,9,28,0) 100%), radial-gradient(140% 110% at 50% 40%, #120e26, #06050b 72%)">
      <div style="position:absolute;left:300px;top:205px;width:${disc}px;height:${disc}px;margin:${-disc / 2}px 0 0 ${-disc / 2}px;border-radius:50%;
        background:radial-gradient(circle, #ffffff 0, #f1ecff 38%, #c9baff 62%, #9a80ff calc(70% - 1px), rgba(122,90,248,.22) 70.5%, rgba(122,90,248,.06) 82%, rgba(122,90,248,0) 100%)"></div>
      <div style="position:absolute;left:50%;top:40px;width:372px;height:706px;margin-left:-186px;background:#040308;
        -webkit-mask:url('${TROPHY}') center top / contain no-repeat;mask:url('${TROPHY}') center top / contain no-repeat"></div>
      <div class="wm" style="position:absolute;left:30px;top:30px">offside<i></i><span>win</span></div>
      <div style="position:absolute;left:0;right:0;top:${Math.round(h * 0.53)}px;text-align:center">
        <div class="d" style="font-size:78px">${head}</div>
        ${pill ? `<div style="display:inline-block;margin-top:16px;padding:10px 20px;border:2px solid #f4f6fa;border-radius:999px;font:600 18px/1 B;color:#f4f6fa">${pill}</div>` : ''}
      </div>
    </div>` };
}

// Each email has its own things round it, picked for what it says.
const ART = {
  'hero-joined': hero({ head: 'You’re in.', pill: 'Every call. Every reason.', objects: [['pass', 'tl', 170], ['call', 'tr', 170], ['ball', 'bl'], ['slip', 'br', 150]] }),
  'hero-receipt': hero({ head: 'Paid.', pill: 'Your receipt, from us.', size: 168, objects: [['pass', 'tl', 170], ['envelope', 'tr', 140], ['ball', 'br', 150]] }),
  'hero-renewed': hero({ head: 'Still in.', pill: 'Same price. Same calls.', size: 140, objects: [['stopwatch', 'tl', 140], ['call', 'tr', 170], ['ball', 'br', 160]] }),
  'hero-free': hero({ head: 'On us.', pill: 'Free days. No card.', size: 156, top: 214, objects: [['gift', 'tl', 140], ['ball', 'tr', 120], ['ball', 'bl', 110], ['gift', 'br', 120]] }),
  'hero-stopped': hero({ head: 'Renewal<br>stopped.', pill: 'Nothing more to pay.', size: 100, top: 186, objects: [['stopwatch', 'tr', 150], ['pass', 'tl', 160]] }),
  'hero-ended': hero({ head: 'Membership<br>ended.', pill: 'The free view stays open.', size: 96, top: 232, objects: [['cards', 'tl', 150], ['whistle', 'tr', 150]] }),
  'hero-deleted': hero({ head: 'Account<br>deleted.', pill: 'Your details are gone.', size: 104, h: 440, top: 132, objects: [['envelope', 'tr', 110]] }),
  'hero-pulled': hero({ head: 'Call<br>pulled.', pill: 'Late news changed it.', size: 120, top: 150, right: 230, objects: [['board', 'br', 240], ['whistle', 'tr', 120]] }),
  // The sign-in ones are short, so the button stays near the top.
  'hero-signin': hero({ head: 'Tap to sign in.', size: 92, h: 400, top: 214, objects: [['key', 'tl', 120], ['padlock', 'tr', 100]] }),
  'hero-confirm': hero({ head: 'One tap and<br>you’re set.', size: 84, h: 420, top: 196, objects: [['envelope', 'tl', 116], ['key', 'tr', 104]] }),
  'hero-invite': hero({ head: 'You’re invited.', size: 92, h: 400, top: 214, objects: [['envelope', 'tl', 116], ['gift', 'tr', 104]] }),
  'hero-code': hero({ head: 'Your code.', size: 104, h: 400, top: 206, objects: [['padlock', 'tl', 110], ['key', 'tr', 110]] }),
  'hero-account': hero({ head: 'Your account<br>changed.', size: 84, h: 420, top: 196, objects: [['padlock', 'tl', 110], ['envelope', 'tr', 104]] }),
  // The quiet days: the trophy waiting in the dark, then the light back on.
  'hero-quiet': stage({ head: 'On pause too.', pill: 'A day added for every quiet day.' }),
  'hero-back': stage({ head: 'Days added.', pill: 'One for every quiet day.', bright: true }),

  /* Candy Creams' feature cards: the colour, the object breaking out, the words. */
  'feature-calls': { w: 560, h: 200, html: feature('linear-gradient(120deg,#8f74ff 0%,#6a48ff 55%,#4b2fd1 100%)', 'Every call, and why',
    'The pick, the odds, the bookmaker, and why.', `<div class="float" style="left:18px;top:-8px;transform:rotate(-8deg) scale(.86);transform-origin:0 0">${callCard({ crest: '#034694', tag: 'CHE', who: 'Chelsea v Brighton', pick: 'Over 2.5 goals', odds: '1.72', book: 'at William Hill' })}</div>`) },
  'feature-slip': { w: 560, h: 200, html: feature('linear-gradient(120deg,#ffcf6b 0%,#f5a524 55%,#d9820f 100%)', 'The slip, built for you',
    'Our surest calls of the day, put together.', `<div class="float" style="left:20px;top:-14px;transform:rotate(6deg) scale(.82);transform-origin:0 0">${slipCard()}</div>`, '#1b1305') },
  'feature-alerts': { w: 560, h: 200, html: feature('linear-gradient(120deg,#2c3038 0%,#202329 60%,#16171b 100%)', 'Told the minute it changes',
    'Team news turns a call, we pull it and email you.', `<img class="float" src="${OBJ('board')}" style="left:16px;top:-34px;width:220px;height:220px;transform:rotate(-6deg)">`) },
};

function feature(bg, title, text, object, ink = '#ffffff') {
  return `<div class="art" style="width:560px;height:200px;overflow:visible">
    <div style="position:absolute;left:0;right:0;top:26px;bottom:0;border-radius:22px;background:${bg}"></div>
    ${object}
    <div style="position:absolute;left:244px;right:20px;top:44px;color:${ink}">
      <div class="d" style="font-size:46px;color:${ink};margin-bottom:10px">${title}</div>
      <div style="font:600 20px/1.3 B;opacity:.95">${text}</div>
    </div></div>`;
}

// The fourth official's board, held up, two numbers lit.
function board() {
  return `<svg viewBox="0 0 170 200" style="width:100%;height:100%"><g>
    <rect x="70" y="118" width="26" height="90" rx="5" fill="#0b0a12"/>
    <rect x="4" y="22" width="162" height="104" rx="12" fill="#0b0a12"/>
    <rect x="14" y="32" width="142" height="84" rx="6" fill="#141320"/>
    <g font-family="D" font-weight="800" font-size="70" text-anchor="middle">
      <text x="50" y="100" fill="#ff5a4e">4</text><text x="120" y="100" fill="#5dde8b">9</text></g>
    <path d="M85 40 V110" stroke="#2c2b3c" stroke-width="3"/></g></svg>`;
}

/* ------------------------------------------------------------- render */
const only = process.argv.slice(2);
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
for (const [name, a] of Object.entries(ART)) {
  if (only.length && !only.includes(name)) continue;
  const tab = await browser.newPage({ viewport: { width: a.w, height: a.h }, deviceScaleFactor: 2 });
  await tab.setContent(`<!doctype html><html><head><style>${CSS}</style></head><body>
    <div style="position:relative;width:${a.w}px;height:${a.h}px;overflow:hidden">${a.html}${a.over ?? ''}</div>
    <script type="module">
      await document.fonts.ready;
      await Promise.all([...document.images].map((i) => i.decode().catch(() => {})));
      window.__done = true;
    </script></body></html>`);
  const errs = [];
  tab.on('pageerror', (e) => errs.push(e.message));
  tab.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await tab.waitForFunction(() => window.__done === true, null, { timeout: 60000 }).catch(() => {});
  if (errs.length) console.log(name, errs.slice(0, 3));
  await tab.waitForTimeout(200);
  // The heroes are solid pictures, so JPEG: a sixth of the PNG's weight, which
  // matters in an inbox. The feature cards keep PNG for their see-through
  // corners, where the object breaks out of the card.
  const clip = { x: 0, y: 0, width: a.w, height: a.h };
  if (name.startsWith('hero-')) await tab.screenshot({ path: join(OUT, `${name}.jpg`), clip, type: 'jpeg', quality: 86 });
  else await tab.screenshot({ path: join(OUT, `${name}.png`), clip, omitBackground: true });
  console.log('art', name);
  await tab.close();
}
await browser.close();
