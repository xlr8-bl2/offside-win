/**
 * The studio (#/admin/studio): the day's results as a carousel to post.
 *
 * The owner posts from a phone, so everything happens here: pick a day, add
 * a photo to any slide, save the slides, copy a caption. The slides are drawn
 * on a canvas at the size each app wants (1080 by 1350 for a feed post, 1080
 * by 1920 for a story) and saved as PNGs; on a phone "Save all" opens the
 * share sheet, which is how a picture gets into the camera roll.
 *
 * What a carousel says: the cover gives the day's real count ("12 of 13
 * landed"), and the slides after it are the calls that landed. A void or a
 * push is left out of both numbers, the way the results page counts them.
 * Nothing claims a profit, and the last slide carries 18+ and
 * BeGambleAware.
 *
 * Crests and each ground's photograph come through the Worker's own address
 * (/media/<kind>/<id>) so the canvas can read them back to save. Every call's
 * slide shows its ground until the owner adds a photo of their own, which
 * never leaves the browser.
 */

import { describe } from './lib/markets.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const C = {
  pitch: '#0c0b09',
  stand: '#15130f',
  chalk: '#f7f4ed',
  chalk2: '#c9c3b6',
  chalk3: '#8f897d',
  violet: '#7a5af8',
  violetHi: '#a58bff',
  won: '#3db468',
};
const DISPLAY = "'Big Shoulders Display', 'Arial Narrow', sans-serif";
const BODY = "'Archivo', system-ui, sans-serif";
const SIZES = { feed: [1080, 1350], story: [1080, 1920] };
const LANDED = new Set(['WON', 'HALF_WON']);
const GRADED = new Set(['WON', 'HALF_WON', 'LOST', 'HALF_LOST']);
const ukDay = (t) => new Date(t * 1000).toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
const dayName = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' });
const dayLong = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
const odds = (v) => Number(v).toFixed(2);

/* --------------------------------------------------------------- state */

let picks = [];
let leagues = new Map();
let day = null;
let size = 'feed';
/** Photos the owner added, by slide key: { img, y } (y: 0 top to 1 bottom). */
const photos = new Map();
const mediaCache = new Map();
/** A fixture's ground, looked up once. */
const venueOf = new Map();

/* -------------------------------------------------------------- loading */

async function load() {
  const [p, l] = await Promise.all([
    fetch('/api/picks?limit=200&settled=true', { cache: 'no-store' }).then((r) => r.json()),
    fetch('/api/leagues').then((r) => r.json()).catch(() => null),
  ]);
  picks = (p?.picks ?? []).filter((x) => x.home_team && x.away_team && x.home_goals !== null);
  const list = Array.isArray(l) ? l : (l?.leagues ?? []);
  leagues = new Map(list.map((x) => [Number(x.id), x.name]));
}

function days() {
  const by = new Map();
  for (const p of picks) {
    const d = ukDay(p.kickoff);
    const e = by.get(d) ?? { day: d, landed: 0, graded: 0 };
    if (GRADED.has(p.result)) e.graded++;
    if (LANDED.has(p.result)) e.landed++;
    by.set(d, e);
  }
  return [...by.values()].filter((e) => e.graded).sort((a, b) => (a.day < b.day ? 1 : -1)).slice(0, 10);
}

const landedOn = (d) => picks.filter((p) => ukDay(p.kickoff) === d && LANDED.has(p.result)).sort((a, b) => a.kickoff - b.kickoff);

function callOf(p) {
  const d = describe({ market: p.market, outcome: p.outcome, line: p.line, home: p.home_team, away: p.away_team, odds: p.odds });
  return { name: d.name, market: d.bet?.market ?? '' };
}

function scorers(p) {
  const goals = Array.isArray(p.goals) ? p.goals.filter((g) => g.t === 'goal' || g.player) : [];
  // One name per scorer, with every minute: "Holse 2' 7' 21'".
  const side = (s) => {
    const by = new Map();
    for (const g of goals.filter((x) => x.side === s)) {
      const who = String(g.player ?? '').replace(/^[A-Z]\. /, '');
      by.set(who, [...(by.get(who) ?? []), `${g.minute}'${g.kind === 'penalty' ? ' pen' : g.kind === 'own' ? ' og' : ''}`]);
    }
    return [...by].map(([who, mins]) => `${who} ${mins.join(' ')}`);
  };
  return { home: side('home'), away: side('away') };
}

/* --------------------------------------------------------------- images */

function image(src) {
  return new Promise((resolve) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => resolve(null);
    i.src = src;
  });
}

const media = (kind, id) => {
  if (!id) return Promise.resolve(null);
  const k = `${kind}/${Number(id)}`;
  if (!mediaCache.has(k)) mediaCache.set(k, image(`/media/${k}`));
  return mediaCache.get(k);
};
const crest = (id) => media('team', id);

/** The ground a call was played at, for its slide: the match's own page knows it. */
async function groundOf(p) {
  if (!venueOf.has(p.fixture_id)) {
    venueOf.set(p.fixture_id, fetch(`/api/fixture/${Number(p.fixture_id)}`).then((r) => r.json())
      .then((f) => Number(f?.venue_id) || null).catch(() => null));
  }
  return media('venue', await venueOf.get(p.fixture_id));
}

/** The photo a slide shows: the owner's if they added one, else the ground. */
async function photoFor(key, p) {
  if (photos.has(key)) return photos.get(key);
  const img = p ? await groundOf(p) : null;
  return img ? { img, y: 0.5 } : null;
}

/** A club's colour from its crest: the most common strong colour in it. */
function crestColour(img) {
  if (!img) return null;
  const c = document.createElement('canvas');
  c.width = 40; c.height = 40;
  const x = c.getContext('2d', { willReadFrequently: true });
  x.drawImage(img, 0, 0, 40, 40);
  let data;
  try { data = x.getImageData(0, 0, 40, 40).data; } catch { return null; }
  const bins = new Map();
  for (let i = 0; i < data.length; i += 4) {
    const [r, g, b, a] = [data[i], data[i + 1], data[i + 2], data[i + 3]];
    if (a < 200) continue;
    const max = Math.max(r, g, b); const min = Math.min(r, g, b);
    if (max - min < 40 || max < 50) continue;
    const k = `${r >> 5},${g >> 5},${b >> 5}`;
    const e = bins.get(k) ?? { n: 0, r: 0, g: 0, b: 0 };
    e.n++; e.r += r; e.g += g; e.b += b;
    bins.set(k, e);
  }
  const best = [...bins.values()].sort((a, b) => b.n - a.n)[0];
  return best ? `rgb(${Math.round(best.r / best.n)}, ${Math.round(best.g / best.n)}, ${Math.round(best.b / best.n)})` : null;
}

/* -------------------------------------------------------------- drawing */

/*
 * Two looks, from the owner's references.
 *
 * The cover and the last slide are the sportswear advert: a photograph to
 * the edges, a heavy two-line headline across the top, a big figure in the
 * bottom-left with a few small lines beside it, a barcode bottom-right.
 * Every call that landed is the film poster: cream paper with its folds, the
 * title in orange, laurels either side, the ground in a window, a line in
 * script, and the stacked billing block along the bottom. "Link in bio" and
 * the site's name are on every slide.
 */
const P = { cream: '#efe5cf', paper: '#e4d8bd', ink: '#1e1a15', orange: '#d8622a', teal: '#2a6b74', hype: '#ff5a36' };

function lines(x, text, maxW) {
  const out = [];
  let cur = '';
  for (const w of String(text).split(/\s+/)) {
    const next = cur ? `${cur} ${w}` : w;
    if (x.measureText(next).width > maxW && cur) { out.push(cur); cur = w; } else cur = next;
  }
  if (cur) out.push(cur);
  return out;
}

/** The largest size up to `max` at which `text` fits `maxW` on at most `rows` lines. */
function fit(x, text, { font, max, min = 30, maxW, rows = 1 }) {
  for (let s = max; s >= min; s -= 2) {
    x.font = font(s);
    const ls = lines(x, text, maxW);
    if (ls.length <= rows && ls.every((l) => x.measureText(l).width <= maxW)) return { size: s, lines: ls };
  }
  x.font = font(min);
  return { size: min, lines: lines(x, text, maxW).slice(0, rows) };
}

function cover(x, img, X, Y, W, H, y = 0.5) {
  const s = Math.max(W / img.width, H / img.height);
  const w = img.width * s; const h = img.height * s;
  x.drawImage(img, X + (W - w) / 2, Y + (H - h) * y, w, h);
}

let grainTile = null;
function grain(x, W, H, alpha) {
  if (!grainTile) {
    grainTile = document.createElement('canvas');
    grainTile.width = grainTile.height = 256;
    const g = grainTile.getContext('2d');
    const d = g.createImageData(256, 256);
    for (let i = 0; i < d.data.length; i += 4) {
      const v = Math.random() * 255;
      d.data[i] = d.data[i + 1] = d.data[i + 2] = v;
      d.data[i + 3] = 255;
    }
    g.putImageData(d, 0, 0);
  }
  x.save();
  x.globalAlpha = alpha;
  x.globalCompositeOperation = 'overlay';
  x.fillStyle = x.createPattern(grainTile, 'repeat');
  x.fillRect(0, 0, W, H);
  x.restore();
}

/** Old paper: cream, its folds, darker at the edges, grain. */
function paper(x, W, H) {
  x.fillStyle = P.cream;
  x.fillRect(0, 0, W, H);
  const v = x.createRadialGradient(W / 2, H / 2, H * 0.25, W / 2, H / 2, H * 0.8);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, 'rgba(90,70,40,0.28)');
  x.fillStyle = v;
  x.fillRect(0, 0, W, H);
  // Folded in four, then once more across.
  const fold = (x0, y0, x1, y1) => {
    x.strokeStyle = 'rgba(255,255,255,0.35)'; x.lineWidth = 3;
    x.beginPath(); x.moveTo(x0, y0); x.lineTo(x1, y1); x.stroke();
    x.strokeStyle = 'rgba(80,60,30,0.16)'; x.lineWidth = 2;
    x.beginPath(); x.moveTo(x0 + 3, y0 + 3); x.lineTo(x1 + 3, y1 + 3); x.stroke();
  };
  fold(W / 2, 0, W / 2, H);
  fold(0, H / 3, W, H / 3);
  fold(0, (H * 2) / 3, W, (H * 2) / 3);
  grain(x, W, H, 0.16);
}

/** A photograph to the edges, darkened top and bottom for the type. */
function photoGround(x, W, H, photo) {
  x.fillStyle = C.pitch;
  x.fillRect(0, 0, W, H);
  if (photo) cover(x, photo.img, 0, 0, W, H, photo.y);
  else {
    const g = x.createRadialGradient(W * 0.7, H * 0.2, 0, W * 0.7, H * 0.2, H);
    g.addColorStop(0, '#3a2a7a'); g.addColorStop(1, C.pitch);
    x.fillStyle = g; x.fillRect(0, 0, W, H);
  }
  const g = x.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, 'rgba(10,9,8,0.72)');
  g.addColorStop(0.3, 'rgba(10,9,8,0.05)');
  g.addColorStop(0.62, 'rgba(10,9,8,0.1)');
  g.addColorStop(1, 'rgba(10,9,8,0.92)');
  x.fillStyle = g;
  x.fillRect(0, 0, W, H);
  grain(x, W, H, 0.1);
}

/** The mark: a ball, the line through it, the side past the line in violet. */
function mark(x, cx, cy, r, ink = C.chalk) {
  x.save();
  x.lineWidth = r * 0.22;
  x.strokeStyle = ink;
  x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.stroke();
  x.beginPath(); x.arc(cx, cy, r, -Math.PI / 2.6, Math.PI / 2.6); x.strokeStyle = C.violet; x.stroke();
  x.fillStyle = C.violet;
  x.fillRect(cx + r * 0.25, cy - r * 1.35, r * 0.16, r * 2.7);
  x.restore();
}

function barcode(x, X, Y, w, h, label, ink) {
  let seed = [...label].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
  const rnd = () => { seed = (seed * 1103515245 + 12345) >>> 0; return seed / 2 ** 32; };
  x.fillStyle = ink;
  let at = X;
  while (at < X + w) {
    const bar = 2 + Math.floor(rnd() * 5);
    if (rnd() > 0.4) x.fillRect(at, Y, Math.min(bar, X + w - at), h);
    at += bar + 1 + Math.floor(rnd() * 3);
  }
  x.font = `600 22px ${BODY}`;
  x.textAlign = 'center';
  x.letterSpacing = '4px';
  x.fillText(label, X + w / 2, Y + h + 28);
  x.letterSpacing = '0px';
}

/** The heavy two-line headline of the advert. */
function headline(x, W, top, one, two) {
  x.textAlign = 'center';
  x.textBaseline = 'alphabetic';
  x.letterSpacing = '-4px';
  const a = fit(x, one, { font: (s) => `800 ${s}px ${BODY}`, max: 150, min: 70, maxW: W - 140 });
  x.font = `800 ${a.size}px ${BODY}`;
  x.fillStyle = C.chalk;
  x.shadowColor = 'rgba(0,0,0,0.45)'; x.shadowBlur = 30;
  x.fillText(a.lines[0], W / 2, top + a.size);
  const b = fit(x, two, { font: (s) => `800 ${s}px ${BODY}`, max: a.size * 1.08, min: 70, maxW: W - 140 });
  x.font = `800 ${b.size}px ${BODY}`;
  x.fillStyle = P.hype;
  x.fillText(b.lines[0], W / 2, top + a.size + b.size * 0.98);
  x.shadowBlur = 0;
  x.letterSpacing = '0px';
  return top + a.size + b.size;
}

const COVER_LINES = (c) => (c.landed === c.graded ? ['CLEAN', 'SWEEP.'] : c.landed / c.graded >= 0.75 ? ['WE ATE', 'THAT.'] : ['STILL', 'COOKING.']);

function margins(H) { return size === 'story' ? { top: 230, bottom: 330 } : { top: 80, bottom: 70 }; }

async function drawCover(x, W, H, d, counts, first) {
  const { top, bottom } = margins(H);
  photoGround(x, W, H, await photoFor('cover', first));
  mark(x, W / 2, top + 40, 26);
  const [one, two] = COVER_LINES(counts);
  headline(x, W, top + 90, one, two);

  const base = H - bottom;
  x.textAlign = 'left';
  x.fillStyle = C.chalk2;
  x.font = `700 28px ${BODY}`;
  x.letterSpacing = '3px';
  x.fillText(dayLong(d).toUpperCase(), 70, base - 300);
  x.letterSpacing = '0px';
  x.fillStyle = C.chalk;
  x.font = `800 220px ${DISPLAY}`;
  const fig = `${counts.landed}/${counts.graded}`;
  x.fillText(fig, 62, base - 20);
  const fw = x.measureText(fig).width;
  x.font = `600 25px ${BODY}`;
  const said = ['Every call came with the reason.', 'Every result is on the site.', 'Tomorrow\'s are already up.', 'Link in bio. Don\'t be late.'];
  said.forEach((l, i) => x.fillText(l, 62 + fw + 28, base - 160 + i * 38));
  barcode(x, W - 70 - 200, base - 110, 200, 64, 'LINK IN BIO', C.chalk);
  x.fillStyle = C.chalk2;
  x.font = `700 24px ${BODY}`;
  x.textAlign = 'right';
  x.fillText('OFFSIDE.WIN', W - 70, base - 130);
}

const SCRIPT = ['Cooked it.', 'Called it.', 'Light work.', 'Never in doubt.', 'Told you.', 'Bang on.'];

/** Small words stacked in two before a big one, the way a film's credits are set. */
function billing(x, X, Y, maxW, tokens, big = 64) {
  let at = X; let y = Y;
  const small = Math.round(big * 0.3);
  for (const t of tokens) {
    x.font = `800 ${big}px ${DISPLAY}`;
    const bw = x.measureText(t.big).width;
    x.font = `800 ${small}px ${DISPLAY}`;
    const sw = t.small ? Math.max(...t.small.map((s) => x.measureText(s).width)) : 0;
    const w = sw + (sw ? 6 : 0) + bw;
    if (at > X && at + w > X + maxW) { at = X; y += big * 1.02; }
    if (t.small) {
      x.textAlign = 'right';
      x.fillText(t.small[0], at + sw, y - big * 0.42);
      if (t.small[1]) x.fillText(t.small[1], at + sw, y - big * 0.1);
      at += sw + 6;
    }
    x.textAlign = 'left';
    x.font = `800 ${big}px ${DISPLAY}`;
    x.fillText(t.big, at, y);
    at += bw + big * 0.22;
  }
  return y;
}

function laurel(x, cx, cy, lines3, ink) {
  x.save();
  x.strokeStyle = ink; x.fillStyle = ink;
  for (const side of [-1, 1]) {
    for (let i = 0; i < 7; i++) {
      const a = Math.PI / 2 + side * (0.42 + i * 0.27);
      const r = 92;
      const lx = cx + Math.cos(a) * r; const ly = cy + Math.sin(a) * r * 0.9 - 6;
      x.save();
      x.translate(lx, ly);
      x.rotate(a + side * Math.PI / 2.4);
      x.beginPath(); x.ellipse(0, 0, 13, 5.5, 0, 0, Math.PI * 2); x.fill();
      x.restore();
    }
  }
  x.textAlign = 'center';
  x.font = `800 26px ${BODY}`;
  x.fillText(lines3[0], cx, cy - 8);
  lines3.slice(1).forEach((l, i) => {
    let s = 17;
    x.font = `700 ${s}px ${BODY}`;
    while (s > 11 && x.measureText(l).width > 140) { s--; x.font = `700 ${s}px ${BODY}`; }
    x.fillText(l, cx, cy + 18 + i * 21);
  });
  x.restore();
}

/** The window the ground shows through: square at two corners, round at two. */
function windowPath(x, X, Y, W, H) {
  const r = Math.min(W, H) * 0.42;
  x.beginPath();
  x.moveTo(X + r, Y);
  x.lineTo(X + W, Y);
  x.lineTo(X + W, Y + H - r);
  x.quadraticCurveTo(X + W, Y + H, X + W - r, Y + H);
  x.lineTo(X, Y + H);
  x.lineTo(X, Y + r);
  x.quadraticCurveTo(X, Y, X + r, Y);
  x.closePath();
}

async function drawCall(x, W, H, p, i, n) {
  const { top, bottom } = margins(H);
  const [hc, ac, photo] = await Promise.all([crest(p.home_team_id), crest(p.away_team_id), photoFor(`p${p.id}`, p)]);
  paper(x, W, H);
  const call = callOf(p);
  const lg = leagues.get(Number(p.league_id)) ?? '';

  // Title.
  x.textAlign = 'center';
  x.fillStyle = P.orange;
  x.letterSpacing = '-1px';
  // On one line when it fits big; else the home side and the score, then the away side.
  const title = `${p.home_team} ${p.home_goals}–${p.away_goals} ${p.away_team}`.toUpperCase();
  let t = fit(x, title, { font: (s) => `800 ${s}px ${BODY}`, max: 78, min: 64, maxW: W - 120, rows: 1 });
  x.font = `800 ${t.size}px ${BODY}`;
  if (x.measureText(title).width > W - 120) {
    const pair = [`${p.home_team} ${p.home_goals}–${p.away_goals}`.toUpperCase(), String(p.away_team).toUpperCase()];
    let sz = 78;
    x.font = `800 ${sz}px ${BODY}`;
    while (sz > 44 && Math.max(...pair.map((l) => x.measureText(l).width)) > W - 120) { sz -= 2; x.font = `800 ${sz}px ${BODY}`; }
    t = { size: sz, lines: pair };
  }
  x.font = `800 ${t.size}px ${BODY}`;
  t.lines.forEach((l, k) => x.fillText(l, W / 2, top + t.size + k * t.size * 1.02));
  x.letterSpacing = '0px';
  const below = top + t.size * (t.lines.length + 0.2);

  // Laurels.
  const ly = below + 95;
  laurel(x, 200, ly, ['LANDED', lg.length > 22 ? `${lg.slice(0, 21)}…` : lg, dayLong(ukDay(p.kickoff)).split(' ').slice(1).join(' ')], P.teal);
  laurel(x, W - 200, ly, ['ODDS OF', odds(p.odds), p.bookmaker ? `at ${p.bookmaker}` : ''], P.teal);

  // The ground, in its window.
  const wy = ly + 120;
  const wh = H - bottom - 330 - wy;
  const wx = 90; const ww = W - 180;
  x.save();
  windowPath(x, wx, wy, ww, wh);
  x.clip();
  if (photo) {
    x.filter = 'sepia(0.25) saturate(1.15) contrast(1.06)';
    cover(x, photo.img, wx, wy, ww, wh, photo.y);
    x.filter = 'none';
  } else {
    // No photograph of the ground: the two clubs, big, on their colours.
    const g = x.createLinearGradient(wx, wy, wx + ww, wy + wh);
    g.addColorStop(0, crestColour(hc) ?? P.teal);
    g.addColorStop(1, crestColour(ac) ?? P.ink);
    x.fillStyle = g; x.fillRect(wx, wy, ww, wh);
    const big = Math.min(ww * 0.36, wh * 0.55);
    x.globalAlpha = 0.95;
    if (hc) x.drawImage(hc, wx + ww * 0.25 - big / 2, wy + wh * 0.42 - big / 2, big, big);
    if (ac) x.drawImage(ac, wx + ww * 0.75 - big / 2, wy + wh * 0.42 - big / 2, big, big);
    x.globalAlpha = 1;
  }
  grain(x, W, H, 0.12);
  x.restore();
  // Crests as stickers on the window's foot.
  const cs = 128;
  for (const [img, cx] of [[hc, wx + ww - cs * 2 - 50], [ac, wx + ww - cs - 30]]) {
    if (!img) continue;
    x.save();
    x.shadowColor = 'rgba(0,0,0,0.35)'; x.shadowBlur = 18;
    x.drawImage(img, cx, wy + wh - cs * 0.7, cs, cs);
    x.restore();
  }
  // The line in script, over the window's corner.
  x.save();
  x.textAlign = 'left';
  x.font = `700 132px 'Caveat', cursive`;
  x.lineWidth = 16; x.strokeStyle = P.cream; x.lineJoin = 'round';
  const sc = SCRIPT[(i - 1) % SCRIPT.length];
  const sx = 70; const sy = wy + wh - 40;
  x.rotate(-0.05);
  x.strokeText(sc, sx, sy + 40);
  x.fillStyle = P.ink;
  x.fillText(sc, sx, sy + 40);
  x.restore();
  x.textAlign = 'left';
  x.fillStyle = P.ink;
  x.font = `800 26px ${BODY}`;
  x.fillText('...and the next one\'s already up', 78, wy + wh + 46);

  // Billing.
  x.fillStyle = P.teal;
  const sco = scorers(p);
  const goals = [...sco.home, ...sco.away].slice(0, 3).map((g) => g.split(' ')[0].toUpperCase());
  const by = billing(x, 70, wy + wh + 140, W - 140, [
    { small: ['OUR', 'CALL'], big: call.name.toUpperCase() },
    { small: ['AT ODDS', 'OF'], big: odds(p.odds) },
    { small: ['FULL', 'TIME'], big: `${p.home_goals}–${p.away_goals}` },
    ...(goals.length ? [{ small: ['GOALS', 'FROM'], big: goals.join(', ') }] : []),
  ], 62);

  // The badge row.
  const ry = Math.max(by + 60, H - bottom - 30);
  x.strokeStyle = P.ink; x.fillStyle = P.ink; x.lineWidth = 2.5;
  x.textAlign = 'left';
  x.font = `800 21px ${BODY}`;
  x.fillText('OFFSIDE.WIN PRESENTS', 70, ry);
  const box = (label, bx, w) => {
    x.strokeRect(bx, ry - 30, w, 42);
    x.textAlign = 'center';
    x.font = `800 21px ${BODY}`;
    x.fillText(label, bx + w / 2, ry);
  };
  box('LINK IN BIO', 380, 200);
  box(`${i} OF ${n} LANDED`, 600, 210);
  box('18+', W - 70 - 80, 80);
}

async function drawEnd(x, W, H, last) {
  const { top, bottom } = margins(H);
  photoGround(x, W, H, await photoFor('end', last));
  mark(x, W / 2, top + 40, 26);
  headline(x, W, top + 90, 'YOU\'RE', 'LATE.');
  const base = H - bottom;
  x.textAlign = 'left';
  x.fillStyle = C.chalk2;
  x.font = `700 28px ${BODY}`;
  x.letterSpacing = '3px';
  x.fillText('TOMORROW\'S CALLS ARE ALREADY UP', 70, base - 250);
  x.letterSpacing = '0px';
  x.fillStyle = C.chalk;
  x.font = `800 150px ${DISPLAY}`;
  x.fillText('LINK IN BIO', 62, base - 70);
  x.font = `600 27px ${BODY}`;
  x.fillText('offside.win: every call, with the reason.', 66, base - 22);
  barcode(x, W - 70 - 200, base - 180, 200, 64, 'OFFSIDE.WIN', C.chalk);
  x.fillStyle = C.chalk3;
  x.font = `500 21px ${BODY}`;
  x.fillText('18+. Gamble responsibly. BeGambleAware.org', 66, base + 16);
}

/* ------------------------------------------------------------- captions */

function captions(d, counts, landed) {
  const line = (p) => `✅ ${p.home_team} ${p.home_goals}–${p.away_goals} ${p.away_team}: ${callOf(p).name}, odds of ${odds(p.odds)}`;
  const head = `${dayName(d)}'s calls: ${counts.landed} of ${counts.graded} landed.`;
  const tail = 'Every call and every result: offside.win/results\n18+ BeGambleAware.org';
  // X: as many as fit in 280, a link counting as 23.
  const xLen = (s) => s.replace(/offside\.win\/results/g, 'x'.repeat(23)).length;
  let xs = [];
  for (const p of landed) {
    const next = [head, '', ...xs, line(p), '', tail].join('\n');
    if (xLen(next) > 280) break;
    xs.push(line(p));
  }
  const x = [head, '', ...xs, ...(xs.length < landed.length ? [`+${landed.length - xs.length} more in the carousel`] : []), '', tail].join('\n');
  const comps = [...new Set(landed.map((p) => leagues.get(Number(p.league_id))).filter(Boolean))].slice(0, 4);
  const tags = ['#football', '#footballpredictions', '#matchday', ...comps.map((c) => `#${c.replace(/[^A-Za-z0-9]/g, '')}`)].join(' ');
  const ig = [head, '', ...landed.map(line), '', 'Every call comes with the reason behind it, and every result stays on the site. Link in bio.', '', '18+. Gamble responsibly. BeGambleAware.org', '', tags].join('\n');
  const tg = [`*${head}*`, '', ...landed.map(line), '', 'Every call and every result: https://offside.win/results', '18+ BeGambleAware.org'].join('\n');
  return [['X', x], ['Instagram and TikTok', ig], ['Telegram', tg]];
}

/* ----------------------------------------------------------------- page */

async function slidesFor(d) {
  const landed = landedOn(d);
  const counts = days().find((e) => e.day === d) ?? { landed: landed.length, graded: landed.length };
  const [W, H] = SIZES[size];
  const out = [];
  const make = async (key, label, draw) => {
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    await draw(c.getContext('2d'));
    out.push({ key, label, canvas: c });
  };
  await make('cover', 'Cover', (x) => drawCover(x, W, H, d, counts, landed[0]));
  let i = 0;
  for (const p of landed) {
    i++;
    await make(`p${p.id}`, `${p.home_team} v ${p.away_team}`, (x) => drawCall(x, W, H, p, i, landed.length));
  }
  await make('end', 'Last slide', (x) => drawEnd(x, W, H, landed[landed.length - 1]));
  return { slides: out, counts, landed };
}

const blobOf = (canvas) => new Promise((r) => canvas.toBlob(r, 'image/png'));
const fileName = (d, i) => `offside-${d}-${String(i + 1).padStart(2, '0')}.png`;

async function render(main) {
  const list = days();
  if (!list.length) { main.innerHTML = '<header class="adm-head"><h1>Studio</h1><p>No settled calls in the last few days yet.</p></header>'; return; }
  if (!day || !list.some((e) => e.day === day)) day = list[0].day;
  main.innerHTML = `
    <header class="adm-head"><h1>Studio</h1><p>A day's results as a carousel. Add a photo to any slide, save them all, copy a caption.</p></header>
    <div class="adm-chips st-days">
      ${list.map((e) => `<button type="button" class="adm-chip" data-day="${e.day}"${e.day === day ? ' aria-current="page"' : ''}>${esc(dayName(e.day).slice(0, 3))} ${Number(e.day.slice(8))} <b>${e.landed} of ${e.graded}</b></button>`).join('')}
    </div>
    <div class="st-bar">
      <div class="seg" role="radiogroup" aria-label="Size">
        ${[['feed', 'Post'], ['story', 'Story']].map(([k, l]) => `<label class="seg-opt"><input type="radio" name="st-size" value="${k}"${k === size ? ' checked' : ''}><span><b>${l}</b></span></label>`).join('')}
      </div>
      <button type="button" class="btn btn-primary" id="st-save">Save all slides</button>
    </div>
    <p class="adm-quiet" id="st-note" role="status"></p>
    <div class="st-slides" id="st-slides"><div class="adm-loading" aria-busy="true"><span></span><span></span><span></span></div></div>
    <p class="adm-label st-caps-h">Captions</p>
    <div class="st-caps" id="st-caps"></div>`;

  for (const b of main.querySelectorAll('[data-day]')) b.onclick = () => { day = b.dataset.day; render(main); };
  for (const r of main.querySelectorAll('input[name="st-size"]')) r.onchange = () => { size = r.value; render(main); };

  const { slides, counts, landed } = await slidesFor(day);
  const box = main.querySelector('#st-slides');
  box.innerHTML = slides.map((s, i) => `
    <figure class="st-slide" data-key="${s.key}">
      <div class="st-canvas" data-i="${i}"></div>
      <figcaption>
        <span>${esc(s.label)}</span>
        <label class="btn btn-quiet btn-sm">${photos.has(s.key) ? 'Change photo' : 'Add photo'}<input type="file" accept="image/*" hidden data-photo="${s.key}"></label>
        ${photos.has(s.key) ? `<input type="range" min="0" max="100" value="${Math.round(photos.get(s.key).y * 100)}" aria-label="Move the photo" data-y="${s.key}">
          <button type="button" class="btn btn-quiet btn-sm" data-clear="${s.key}">Remove</button>` : ''}
        <button type="button" class="btn btn-quiet btn-sm" data-one="${i}">Save</button>
      </figcaption>
    </figure>`).join('');
  slides.forEach((s, i) => box.querySelector(`[data-i="${i}"]`).append(s.canvas));

  for (const inp of box.querySelectorAll('[data-photo]')) {
    inp.onchange = async () => {
      const f = inp.files?.[0];
      if (!f) return;
      const img = await image(URL.createObjectURL(f));
      if (img) photos.set(inp.dataset.photo, { img, y: 0.5 });
      render(main);
    };
  }
  for (const r of box.querySelectorAll('[data-y]')) r.onchange = () => { photos.get(r.dataset.y).y = Number(r.value) / 100; render(main); };
  for (const b of box.querySelectorAll('[data-clear]')) b.onclick = () => { photos.delete(b.dataset.clear); render(main); };
  for (const b of box.querySelectorAll('[data-one]')) {
    b.onclick = async () => {
      const i = Number(b.dataset.one);
      await save([new File([await blobOf(slides[i].canvas)], fileName(day, i), { type: 'image/png' })]);
    };
  }
  main.querySelector('#st-save').onclick = async () => {
    const files = await Promise.all(slides.map(async (s, i) => new File([await blobOf(s.canvas)], fileName(day, i), { type: 'image/png' })));
    await save(files);
  };

  const caps = main.querySelector('#st-caps');
  caps.innerHTML = captions(day, counts, landed).map(([k, text], i) => `
    <div class="st-cap">
      <p class="st-cap-h"><b>${esc(k)}</b> <button type="button" class="btn btn-quiet btn-sm" data-copy="${i}">Copy</button></p>
      <textarea rows="${Math.min(14, text.split('\n').length + 1)}" data-cap="${i}">${esc(text)}</textarea>
    </div>`).join('');
  for (const b of caps.querySelectorAll('[data-copy]')) {
    b.onclick = async () => {
      const t = caps.querySelector(`[data-cap="${b.dataset.copy}"]`).value;
      try { await navigator.clipboard.writeText(t); b.textContent = 'Copied'; } catch { b.textContent = 'Select and copy'; }
      setTimeout(() => { b.textContent = 'Copy'; }, 2000);
    };
  }
}

/** On a phone, the share sheet ("Save images" puts them in Photos); elsewhere, downloads. */
async function save(files) {
  const note = document.getElementById('st-note');
  if (navigator.canShare?.({ files })) {
    try { await navigator.share({ files }); return; } catch (err) { if (err?.name === 'AbortError') return; }
  }
  for (const f of files) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(f);
    a.download = f.name;
    document.body.append(a);
    a.click();
    a.remove();
    await new Promise((r) => setTimeout(r, 250));
  }
  if (note) note.textContent = `${files.length === 1 ? 'Saved' : `Saved ${files.length} slides`}.`;
}

export async function studio(main) {
  await Promise.all([
    load(),
    document.fonts?.load(`800 100px ${DISPLAY}`),
    document.fonts?.load(`500 40px ${BODY}`),
    document.fonts?.load(`700 40px 'Offside Wordmark'`),
    document.fonts?.load(`800 100px 'Offside Figures'`),
    document.fonts?.load(`700 100px 'Caveat'`),
  ].map((x) => Promise.resolve(x).catch(() => null)));
  await render(main);
}
