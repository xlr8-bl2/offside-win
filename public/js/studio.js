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
 * Crests come through the Worker's own address (/media/team/<id>) so the
 * canvas can read them back to save. A slide without a photo of the owner's
 * shows the two clubs' colours; a photo never leaves the browser.
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
 * The look: a broadcaster's results graphic. One picture (the owner's photo,
 * or the two clubs' colours split on the diagonal with their crests), the
 * score set big in condensed capitals on bars in each club's colour, our
 * call underneath with a tick, and the brand bar across the foot of every
 * slide: the site's name and "link in bio". Little text, all of it large.
 */
const V = { violet: '#7a5af8', violetDeep: '#4b2fd6', bar: 'rgba(12,11,9,0.86)', tick: '#3db468' };
const CAPS = (s, w = 800) => `${w} ${s}px ${DISPLAY}`;

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

/** The largest size up to `max` at which `text` fits `maxW` on one line. */
function fitSize(x, text, font, max, min, maxW) {
  for (let s = max; s > min; s -= 2) { x.font = font(s); if (x.measureText(text).width <= maxW) return s; }
  x.font = font(min);
  return min;
}

function cover(x, img, X, Y, W, H, y = 0.5) {
  const s = Math.max(W / img.width, H / img.height);
  const w = img.width * s; const h = img.height * s;
  x.drawImage(img, X + (W - w) / 2, Y + (H - h) * y, w, h);
}

const margins = () => (size === 'story' ? { top: 220, bottom: 300 } : { top: 0, bottom: 0 });

/** A pitch drawn from above, for a slide with no photo: mown stripes, the lines, a goal. */
function pitchGround(x, W, H) {
  const stripe = H / 9;
  for (let i = 0; i < 10; i++) {
    x.fillStyle = i % 2 ? '#3f8a2f' : '#47963a';
    x.save(); x.translate(W / 2, H / 2); x.rotate(-0.38);
    x.fillRect(-W * 1.5, -H + i * stripe * 2 - H * 0.2, W * 3, stripe);
    x.restore();
  }
  x.save();
  x.strokeStyle = 'rgba(255,255,255,0.85)'; x.lineWidth = 10;
  x.translate(W / 2, H / 2); x.rotate(-0.38); x.translate(-W / 2, -H / 2);
  x.beginPath(); x.moveTo(-W, H * 0.08); x.lineTo(W * 2, H * 0.08); x.stroke();
  x.strokeRect(W * 0.2, H * 0.08, W * 0.6, H * 0.2);
  x.strokeRect(W * 0.36, H * 0.08, W * 0.28, H * 0.08);
  x.beginPath(); x.arc(W / 2, H * 0.28, W * 0.12, 0.25, Math.PI - 0.25); x.stroke();
  x.restore();
  const v = x.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.85);
  v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.35)');
  x.fillStyle = v; x.fillRect(0, 0, W, H);
}

/** The background: the owner's photo to the edges, else the pitch. */
function background(x, W, H, photo) {
  if (photo) cover(x, photo.img, 0, 0, W, H, photo.y); else pitchGround(x, W, H);
}

/** Frosted glass: what is under the box, blurred and tinted. */
function frost(x, X, Y, w, h, tint) {
  const snap = document.createElement('canvas');
  snap.width = x.canvas.width; snap.height = x.canvas.height;
  snap.getContext('2d').drawImage(x.canvas, 0, 0);
  x.save();
  x.beginPath(); x.rect(X, Y, w, h); x.clip();
  x.filter = 'blur(18px)';
  x.drawImage(snap, 0, 0);
  x.filter = 'none';
  x.fillStyle = tint; x.fillRect(X, Y, w, h);
  x.restore();
}

const LINE = 'rgba(255,255,255,0.92)';
function cell(x, X, Y, w, h) { x.strokeStyle = LINE; x.lineWidth = 3; x.strokeRect(X, Y, w, h); }

/** The site's name and where to find us, small, at the foot of every slide. */
function footer(x, W, H) {
  const { bottom } = margins();
  const y = H - bottom - 50;
  x.fillStyle = '#fff'; x.textBaseline = 'alphabetic';
  x.shadowColor = 'rgba(0,0,0,0.6)'; x.shadowBlur = 12;
  x.font = `800 26px ${BODY}`; x.textAlign = 'left';
  x.fillText('OFFSIDE.WIN', 56, y);
  x.textAlign = 'right';
  x.fillText('LINK IN BIO', W - 56, y);
  x.shadowBlur = 0;
}

/** The card's frame: left edge, width, and where it starts so it sits centred. */
const WIDE = (s, w = 800) => `${w} ${s}px ${BODY}`;

async function drawCall(x, W, H, p, i, n) {
  const [hc, ac, lgImg] = await Promise.all([crest(p.home_team_id), crest(p.away_team_id), media('league', p.league_id)]);
  background(x, W, H, photos.get(`p${p.id}`));
  const cw = Math.round(W * 0.56); const X = Math.round((W - cw) / 2);
  const headH = 230; const nameH = 70; const bandH = 250; const winH = size === 'story' ? 520 : 330; const footH = 120; const callH = 92;
  const total = headH + bandH + winH + footH + callH;
  const Y = Math.round((H - total) / 2);
  const logoW = headH;

  // Head: the competition's badge, its name, the two crests.
  frost(x, X, Y, cw, headH, 'rgba(255,255,255,0.86)');
  if (lgImg) { const s = logoW * 0.62; x.drawImage(lgImg, X + (logoW - s) / 2, Y + (headH - s) / 2, s, s); }
  const lg = leagues.get(Number(p.league_id)) ?? 'Full time';
  x.fillStyle = '#111'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.font = `600 ${fitSize(x, lg, (s) => `600 ${s}px ${BODY}`, 36, 20, cw - logoW - 30)}px ${BODY}`;
  x.fillText(lg, X + logoW + (cw - logoW) / 2, Y + nameH / 2 + 2);
  const cs = 104; const midX = X + logoW + (cw - logoW) / 2; const cy = Y + nameH + (headH - nameH) / 2;
  if (hc) x.drawImage(hc, midX - cs - 50, cy - cs / 2, cs, cs);
  if (ac) x.drawImage(ac, midX + 50, cy - cs / 2, cs, cs);
  x.fillStyle = '#333'; x.font = `500 30px ${BODY}`;
  x.fillText('vs', midX, cy + 2);
  cell(x, X, Y, logoW, headH); cell(x, X + logoW, Y, cw - logoW, nameH); cell(x, X + logoW, Y + nameH, cw - logoW, headH - nameH);

  // The score, on a band of the pitch's own green.
  const by = Y + headH;
  frost(x, X, by, cw, bandH, 'rgba(70,120,40,0.55)');
  cell(x, X, by, cw, bandH);
  const l1 = String(p.home_team).toUpperCase();
  const l2 = `${p.home_goals}-${p.away_goals} ${String(p.away_team).toUpperCase()}`;
  const fs = Math.min(fitSize(x, l1, (s) => WIDE(s, 500), 92, 40, cw - 60), fitSize(x, l2, (s) => WIDE(s, 500), 92, 40, cw - 60));
  x.textAlign = 'left'; x.fillStyle = '#fff'; x.textBaseline = 'alphabetic';
  x.font = WIDE(fs, 500);
  x.fillText(l1, X + 30, by + bandH / 2 - 8);
  const score = `${p.home_goals}-${p.away_goals} `;
  x.font = WIDE(fs, 800); x.fillText(score, X + 30, by + bandH / 2 + fs - 4);
  const sw = x.measureText(score).width;
  x.font = WIDE(fs, 500); x.fillText(String(p.away_team).toUpperCase(), X + 30 + sw, by + bandH / 2 + fs - 4);

  // The photo shows through; then the scorers and the competition stage.
  const wy = by + bandH;
  cell(x, X, wy, cw, winH);
  const fy = wy + winH;
  frost(x, X, fy, cw, footH, 'rgba(255,255,255,0.9)');
  cell(x, X, fy, cw, footH);
  const sc = scorers(p);
  x.fillStyle = '#111'; x.font = `500 26px ${BODY}`; x.textBaseline = 'top';
  x.textAlign = 'left'; sc.home.slice(0, 3).forEach((g, k) => x.fillText(g, X + 22, fy + 16 + k * 32));
  x.textAlign = 'right'; sc.away.slice(0, 3).forEach((g, k) => x.fillText(g, X + cw - 22, fy + 16 + k * 32));
  x.font = `600 24px ${BODY}`;
  const tag = `${i} of ${n}`;
  const tw = x.measureText(tag).width + 40;
  x.fillStyle = '#9a9a9a'; x.beginPath(); x.roundRect(X + cw / 2 - tw / 2, fy + footH / 2 - 22, tw, 44, 22); x.fill();
  x.fillStyle = '#fff'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(tag, X + cw / 2, fy + footH / 2 + 1);

  // Our call, landed.
  const ky = fy + footH;
  frost(x, X, ky, cw, callH, 'rgba(17,17,17,0.88)');
  cell(x, X, ky, cw, callH);
  x.fillStyle = V.tick; x.beginPath(); x.arc(X + 44, ky + callH / 2, 20, 0, Math.PI * 2); x.fill();
  x.strokeStyle = '#000'; x.lineWidth = 5; x.beginPath();
  x.moveTo(X + 35, ky + callH / 2 + 1); x.lineTo(X + 42, ky + callH / 2 + 8); x.lineTo(X + 54, ky + callH / 2 - 8); x.stroke();
  const call = callOf(p);
  x.textAlign = 'left'; x.textBaseline = 'middle'; x.fillStyle = '#fff';
  const oddsTxt = `odds of ${odds(p.odds)}`;
  x.font = `700 26px ${BODY}`;
  const ow = x.measureText(oddsTxt).width;
  x.font = `800 ${fitSize(x, call.name, (s) => `800 ${s}px ${BODY}`, 32, 18, cw - 100 - ow - 30)}px ${BODY}`;
  x.fillText(call.name, X + 80, ky + callH / 2 + 1);
  x.textAlign = 'right'; x.font = `700 26px ${BODY}`; x.fillStyle = V.tick;
  x.fillText(oddsTxt, X + cw - 22, ky + callH / 2 + 1);
  x.textBaseline = 'alphabetic';

  footer(x, W, H);
}

async function drawCover(x, W, H, d, counts, landed) {
  background(x, W, H, photos.get('cover'));
  const cw = Math.round(W * 0.62); const X = Math.round((W - cw) / 2);
  const rows = landed.slice(0, 6);
  const headH = 90; const bigH = 300; const rowH = 66; const listH = rows.length * rowH + (landed.length > rows.length ? 50 : 0) + 30;
  const Y = Math.round((H - headH - bigH - listH) / 2);
  frost(x, X, Y, cw, headH, 'rgba(255,255,255,0.88)'); cell(x, X, Y, cw, headH);
  x.fillStyle = '#111'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.font = `700 34px ${BODY}`;
  x.fillText(`${dayLong(d)}`, X + cw / 2, Y + headH / 2 + 2);
  const by = Y + headH;
  frost(x, X, by, cw, bigH, 'rgba(70,120,40,0.55)'); cell(x, X, by, cw, bigH);
  x.fillStyle = '#fff'; x.textAlign = 'left'; x.textBaseline = 'alphabetic';
  x.font = WIDE(150, 800); x.fillText(`${counts.landed}/${counts.graded}`, X + 34, by + 170);
  x.font = WIDE(56, 500); x.fillText('CALLS LANDED', X + 34, by + 250);
  const ly = by + bigH;
  frost(x, X, ly, cw, listH, 'rgba(17,17,17,0.86)'); cell(x, X, ly, cw, listH);
  rows.forEach((p, k) => {
    const y = ly + 20 + k * rowH + rowH / 2;
    x.fillStyle = V.tick; x.beginPath(); x.arc(X + 40, y, 15, 0, Math.PI * 2); x.fill();
    x.strokeStyle = '#000'; x.lineWidth = 4; x.beginPath(); x.moveTo(X + 33, y); x.lineTo(X + 38, y + 6); x.lineTo(X + 48, y - 6); x.stroke();
    const t = `${p.home_team} ${p.home_goals}-${p.away_goals} ${p.away_team}`;
    x.fillStyle = '#fff'; x.textBaseline = 'middle';
    x.font = `700 ${fitSize(x, t, (s) => `700 ${s}px ${BODY}`, 30, 18, cw - 100)}px ${BODY}`;
    x.fillText(t, X + 72, y + 1);
  });
  if (landed.length > rows.length) {
    x.fillStyle = C.chalk3; x.font = `600 24px ${BODY}`;
    x.fillText(`+${landed.length - rows.length} more, swipe`, X + 72, ly + 20 + rows.length * rowH + 20);
  }
  x.textBaseline = 'alphabetic';
  footer(x, W, H);
}

async function drawEnd(x, W, H) {
  background(x, W, H, photos.get('end'));
  const cw = Math.round(W * 0.62); const X = Math.round((W - cw) / 2);
  const Y = Math.round(H / 2 - 260);
  frost(x, X, Y, cw, 330, 'rgba(70,120,40,0.55)'); cell(x, X, Y, cw, 330);
  x.fillStyle = '#fff'; x.textAlign = 'left';
  x.font = WIDE(64, 500); x.fillText("TOMORROW'S", X + 34, Y + 110);
  x.font = WIDE(64, 800); x.fillText('CALLS ARE UP', X + 34, Y + 190);
  x.font = `500 28px ${BODY}`; x.fillText('Every one with the reason.', X + 34, Y + 270);
  frost(x, X, Y + 330, cw, 120, 'rgba(255,255,255,0.92)'); cell(x, X, Y + 330, cw, 120);
  x.fillStyle = '#111'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.font = WIDE(52, 800); x.fillText('LINK IN BIO', X + cw / 2, Y + 392);
  x.textBaseline = 'alphabetic';
  x.fillStyle = '#fff'; x.font = `500 22px ${BODY}`; x.textAlign = 'center';
  x.shadowColor = 'rgba(0,0,0,0.6)'; x.shadowBlur = 10;
  x.fillText('18+. Gamble responsibly. BeGambleAware.org', W / 2, Y + 500);
  x.shadowBlur = 0;
  footer(x, W, H);
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
  await make('cover', 'Cover', (x) => drawCover(x, W, H, d, counts, landed));
  let i = 0;
  for (const p of landed) {
    i++;
    await make(`p${p.id}`, `${p.home_team} v ${p.away_team}`, (x) => drawCall(x, W, H, p, i, landed.length));
  }
  await make('end', 'Last slide', (x) => drawEnd(x, W, H));
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
