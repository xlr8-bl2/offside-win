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

/*
 * Photographs found for the owner: Openverse searches Flickr and Wikimedia
 * for pictures whose licence allows commercial use (CC0, CC BY, CC BY-SA),
 * best match first ("Home Away", then each club). The licence asks for the
 * photographer's credit, which goes on the slide in small print. They come
 * through the Worker (/media/cc) so the slide can be saved. "Next photo"
 * steps through the rest; a photo of the owner's own always wins.
 */
const found = new Map(); // slide key -> { list, i }
// Openverse can take seconds a search: each is asked once, all at the same time.
const searches = new Map();
const search = (q) => {
  if (!searches.has(q)) {
    searches.set(q, fetch(`https://api.openverse.org/v1/images/?q=${encodeURIComponent(q)}&license_type=commercial&page_size=12`)
      .then((r) => r.json()).catch(() => null));
  }
  return searches.get(q);
};
async function searchPhotos(queries) {
  const seen = new Set(); const out = [];
  const pages = await Promise.all(queries.map(search));
  for (const d of pages) {
    try {
      for (const it of d?.results ?? []) {
        if (seen.has(it.id) || !it.url || Number(it.width) < 700) continue;
        if (!/^https:\/\/(live\.staticflickr\.com|upload\.wikimedia\.org)\//.test(it.url)) continue;
        seen.add(it.id);
        const lic = `CC ${String(it.license ?? '').toUpperCase()} ${it.license_version ?? ''}`.trim();
        out.push({ src: `/media/cc?u=${encodeURIComponent(it.url)}`, credit: `Photo: ${String(it.creator ?? 'unknown').slice(0, 40)}, ${lic}` });
      }
    } catch { /* no photos is fine */ }
  }
  return out.slice(0, 10);
}
async function foundPhoto(key, queries) {
  if (!found.has(key)) found.set(key, { list: await searchPhotos(queries), i: 0 });
  const f = found.get(key);
  for (let tries = 0; tries < f.list.length; tries++) {
    const pick = f.list[f.i % f.list.length];
    const img = await image(pick.src);
    if (img) return { img, y: 0.4, credit: pick.credit };
    f.i++;
  }
  return null;
}
const queriesFor = (p) => [`${p.home_team} ${p.away_team}`, `${p.home_team} football`, `${p.away_team} football`];
/** For the cover and the last slide: the first of the day's matches with a photo found. */
async function dayPhoto(key, landed, from = 0) {
  if (photos.has(key)) return photos.get(key);
  for (let k = 0; k < landed.length; k++) {
    const p = landed[(from + k) % landed.length];
    const ph = await foundPhoto(`${key}:${p.id}`, queriesFor(p));
    if (ph) return ph;
  }
  return null;
}

/** The photo a slide shows: the owner's, else one found for it. */
async function photoOf(key, p) {
  if (photos.has(key)) return photos.get(key);
  return p ? foundPhoto(key, queriesFor(p)) : null;
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
    x.fillStyle = i % 2 ? '#2f6b26' : '#33722a';
    x.save(); x.translate(W / 2, H / 2); x.rotate(-0.38);
    x.fillRect(-W * 1.5, -H + i * stripe * 2 - H * 0.2, W * 3, stripe);
    x.restore();
  }
  x.save();
  x.strokeStyle = 'rgba(255,255,255,0.55)'; x.lineWidth = 8;
  x.translate(W / 2, H / 2); x.rotate(-0.38); x.translate(-W / 2, -H / 2);
  x.beginPath(); x.moveTo(-W, H * 0.08); x.lineTo(W * 2, H * 0.08); x.stroke();
  x.strokeRect(W * 0.2, H * 0.08, W * 0.6, H * 0.2);
  x.restore();
}

function background(x, W, H, photo) {
  if (photo) cover(x, photo.img, 0, 0, W, H, photo.y); else pitchGround(x, W, H);
}

/*
 * The card, measured off the owner's reference (a 736 x 920 post, scaled):
 * half the width, centred, a quarter of the way down. Rows, top to bottom:
 * the competition's badge in a square cell beside its name on a white strip
 * and the two crests on a light one; the score on a band tinted with the
 * photo's own colour; an open window the photo shows through; a white foot
 * with the scorers either side and a grey pill between. Thin white lines
 * round every cell, a faint glass streak across it all, and the name of the
 * site, small, bottom-left. One face for the score and names (Michroma, the
 * free cut of that squared, extended look), a plain one for the rest.
 */
const FACE = "'Michroma', 'Archivo', sans-serif";
const PLAIN = "'Archivo', system-ui, sans-serif";
const K = 1080 / 736; // the reference's pixels to ours
const LINE = 'rgba(255,255,255,0.95)';

function cardGeom(W, H) {
  const cw = Math.round(W * 0.5); const X = Math.round((W - cw) / 2);
  const rows = { title: 36 * K, crests: 75 * K, band: 127 * K, win: 192 * K, foot: 45 * K };
  const total = rows.title + rows.crests + rows.band + rows.win + rows.foot;
  const Y = Math.round(size === 'story' ? (H - total) / 2 - 40 : H * 0.241);
  return { X, Y, cw, logoW: Math.round(cw * 0.266), rows, total };
}

/** The photo's own colour under a box, darkened, for the band's tint. */
function tintUnder(x, X, Y, w, h) {
  try {
    const d = x.getImageData(X, Y, w, h).data;
    let r = 0; let g = 0; let b = 0; let n = 0;
    for (let i = 0; i < d.length; i += 64) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
    return `rgba(${Math.round(r / n * 0.7)}, ${Math.round(g / n * 0.78)}, ${Math.round(b / n * 0.6)}, 0.78)`;
  } catch { return 'rgba(60,110,40,0.62)'; }
}

function stroke(x, X, Y, w, h) { x.strokeStyle = LINE; x.lineWidth = 2; x.strokeRect(X + 1, Y + 1, w - 2, h - 2); }

/** The glass streak: a soft band of light across the card on the diagonal. */
function gloss(x, X, Y, w, h) {
  x.save();
  x.beginPath(); x.rect(X, Y, w, h); x.clip();
  const g = x.createLinearGradient(X, Y + h * 0.55, X + w, Y + h * 0.15);
  g.addColorStop(0.35, 'rgba(255,255,255,0)'); g.addColorStop(0.5, 'rgba(255,255,255,0.16)'); g.addColorStop(0.65, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(X, Y, w, h);
  x.restore();
}

/** Score-face text, its weight thickened by a stroke of its own colour (Michroma has one weight). */
function faceText(x, text, X, Y, size, bold = false) {
  x.font = `400 ${size}px ${FACE}`;
  x.fillText(text, X, Y);
  if (bold) { x.lineWidth = size * 0.05; x.strokeStyle = x.fillStyle; x.strokeText(text, X, Y); }
}
function faceWidth(x, text, size) { x.font = `400 ${size}px ${FACE}`; return x.measureText(text).width; }

function brand(x, W, H) {
  const { bottom } = margins();
  x.font = `600 ${Math.round(11 * K)}px ${PLAIN}`; x.fillStyle = '#fff'; x.textAlign = 'left'; x.textBaseline = 'alphabetic';
  x.shadowColor = 'rgba(0,0,0,0.45)'; x.shadowBlur = 6;
  x.fillText('OFFSIDE.WIN', Math.round(36 * K), H - bottom - Math.round(30 * K));
  x.shadowBlur = 0;
}

function credit(x, W, H, photo) {
  if (!photo?.credit) return;
  const { bottom } = margins();
  x.font = `400 ${Math.round(8 * K)}px ${PLAIN}`; x.textAlign = 'right'; x.fillStyle = 'rgba(255,255,255,0.7)';
  x.fillText(photo.credit, W - Math.round(36 * K), H - bottom - Math.round(30 * K));
}

/** The card's shared top: badge cell, title strip, the middle row (crests or anything). */
function cardTop(x, g, { badge, title, middle }) {
  const { X, Y, cw, logoW, rows } = g;
  const topH = rows.title + rows.crests;
  x.fillStyle = 'rgba(255,255,255,0.96)'; x.fillRect(X, Y, logoW, topH);
  if (badge) { const s = Math.min(logoW, topH) * 0.66; x.drawImage(badge, X + (logoW - s) / 2, Y + (topH - s) / 2, s, s); }
  x.fillStyle = 'rgba(255,255,255,0.96)'; x.fillRect(X + logoW, Y, cw - logoW, rows.title);
  x.fillStyle = '#1b1b1b'; x.textAlign = 'left'; x.textBaseline = 'middle';
  let fs = Math.round(16 * K);
  x.font = `500 ${fs}px ${PLAIN}`;
  while (fs > 12 && x.measureText(title).width > cw - logoW - 36) { fs--; x.font = `500 ${fs}px ${PLAIN}`; }
  x.fillText(title, X + logoW + Math.round(13 * K), Y + rows.title / 2 + 1);
  x.fillStyle = 'rgba(255,255,255,0.72)'; x.fillRect(X + logoW, Y + rows.title, cw - logoW, rows.crests);
  middle?.(X + logoW, Y + rows.title, cw - logoW, rows.crests);
  x.textBaseline = 'alphabetic';
  stroke(x, X, Y, logoW, topH); stroke(x, X + logoW, Y, cw - logoW, rows.title); stroke(x, X + logoW, Y + rows.title, cw - logoW, rows.crests);
  return Y + topH;
}

/** The score band: two lines in the score face, left-aligned, on the photo's own colour. */
function band(x, g, y, line1, line2Bold, line2Rest) {
  const { X, cw, rows } = g;
  const tint = tintUnder(x, X, y, cw, rows.band);
  x.fillStyle = tint; x.fillRect(X, y, cw, rows.band);
  const pad = Math.round(14 * K);
  let fs = Math.round(36 * K);
  const widest = () => Math.max(faceWidth(x, line1, fs), faceWidth(x, `${line2Bold} ${line2Rest}`, fs));
  while (fs > 16 && widest() > cw - pad * 2) fs--;
  x.fillStyle = '#fff'; x.textAlign = 'left'; x.textBaseline = 'alphabetic';
  const mid = y + rows.band / 2;
  faceText(x, line1, X + pad, mid - fs * 0.18, fs);
  faceText(x, line2Bold, X + pad, mid + fs * 1.02, fs, true);
  const bw = faceWidth(x, `${line2Bold} `, fs);
  faceText(x, line2Rest, X + pad + bw, mid + fs * 1.02, fs);
  stroke(x, X, y, cw, rows.band);
  return y + rows.band;
}

function pillAt(x, cx, cy, text, { bg = 'rgba(150,150,150,0.85)', fg = '#fff' } = {}) {
  x.font = `500 ${Math.round(12 * K)}px ${PLAIN}`;
  const w = x.measureText(text).width + 28 * K; const h = 22 * K;
  x.fillStyle = bg; x.beginPath(); x.roundRect(cx - w / 2, cy - h / 2, w, h, h / 2); x.fill();
  x.fillStyle = fg; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(text, cx, cy + 1);
}

async function drawCall(x, W, H, p, i, n) {
  const [hc, ac, lgImg] = await Promise.all([crest(p.home_team_id), crest(p.away_team_id), media('league', p.league_id)]);
  const photo = await photoOf(`p${p.id}`, p);
  background(x, W, H, photo);
  const g = cardGeom(W, H);
  const lg = leagues.get(Number(p.league_id)) ?? 'Full time';
  let y = cardTop(x, g, {
    badge: lgImg, title: lg,
    middle: (mx, my, mw, mh) => {
      const s = mh * 0.62; const cx = mx + mw / 2; const cy = my + mh / 2;
      if (hc) x.drawImage(hc, cx - s - 38 * K, cy - s / 2, s, s);
      if (ac) x.drawImage(ac, cx + 38 * K, cy - s / 2, s, s);
      x.fillStyle = '#444'; x.font = `400 ${Math.round(14 * K)}px ${PLAIN}`; x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillText('VS', cx, cy + 1);
    },
  });
  y = band(x, g, y, String(p.home_team).toUpperCase(), `${p.home_goals}-${p.away_goals}`, String(p.away_team).toUpperCase());
  stroke(x, g.X, y, g.cw, g.rows.win);
  y += g.rows.win;
  // The foot: who scored, each side; our call between.
  x.fillStyle = 'rgba(255,255,255,0.96)'; x.fillRect(g.X, y, g.cw, g.rows.foot);
  const sc = scorers(p);
  x.fillStyle = '#1b1b1b'; x.font = `400 ${Math.round(12 * K)}px ${PLAIN}`; x.textBaseline = 'top';
  const lh = 14 * K;
  x.textAlign = 'left'; sc.home.slice(0, 2).forEach((t, k) => x.fillText(t, g.X + 10 * K, y + 6 * K + k * lh));
  x.textAlign = 'right'; sc.away.slice(0, 2).forEach((t, k) => x.fillText(t, g.X + g.cw - 10 * K, y + 6 * K + k * lh));
  pillAt(x, g.X + g.cw / 2, y + g.rows.foot / 2, 'Called it', { bg: 'rgba(61,180,104,0.9)' });
  stroke(x, g.X, y, g.cw, g.rows.foot);
  gloss(x, g.X, g.Y, g.cw, g.total);
  x.textBaseline = 'alphabetic';
  brand(x, W, H);
  credit(x, W, H, photo);
}

async function drawCover(x, W, H, d, counts, landed) {
  const photo = await dayPhoto('cover', landed, 0);
  background(x, W, H, photo);
  const g = cardGeom(W, H);
  let y = cardTop(x, g, {
    badge: null, title: 'offside.win results',
    middle: (mx, my, mw, mh) => {
      x.fillStyle = '#1b1b1b'; x.font = `500 ${Math.round(15 * K)}px ${PLAIN}`; x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillText(dayLong(d), mx + mw / 2, my + mh / 2);
    },
  });
  // The offside mark in the badge cell: a ball, the line through it.
  const cx = g.X + g.logoW / 2; const cy = g.Y + (g.rows.title + g.rows.crests) / 2; const r = g.logoW * 0.24;
  x.lineWidth = r * 0.22; x.strokeStyle = '#1b1b1b'; x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.stroke();
  x.fillStyle = C.violet; x.fillRect(cx + r * 0.25, cy - r * 1.35, r * 0.16, r * 2.7);
  y = band(x, g, y, 'CALLS LANDED', `${counts.landed}/${counts.graded}`, '');
  stroke(x, g.X, y, g.cw, g.rows.win);
  y += g.rows.win;
  x.fillStyle = 'rgba(255,255,255,0.96)'; x.fillRect(g.X, y, g.cw, g.rows.foot);
  pillAt(x, g.X + g.cw / 2, y + g.rows.foot / 2, `${landed.length} on the next slides`);
  stroke(x, g.X, y, g.cw, g.rows.foot);
  gloss(x, g.X, g.Y, g.cw, g.total);
  brand(x, W, H);
  credit(x, W, H, photo);
}

async function drawEnd(x, W, H, landed) {
  const photo = await dayPhoto('end', landed, 1);
  background(x, W, H, photo);
  const g = cardGeom(W, H);
  let y = cardTop(x, g, {
    badge: null, title: 'offside.win',
    middle: (mx, my, mw, mh) => {
      x.fillStyle = '#1b1b1b'; x.font = `500 ${Math.round(15 * K)}px ${PLAIN}`; x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillText('Every call, with the reason', mx + mw / 2, my + mh / 2);
    },
  });
  const cx = g.X + g.logoW / 2; const cy = g.Y + (g.rows.title + g.rows.crests) / 2; const r = g.logoW * 0.24;
  x.lineWidth = r * 0.22; x.strokeStyle = '#1b1b1b'; x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.stroke();
  x.fillStyle = C.violet; x.fillRect(cx + r * 0.25, cy - r * 1.35, r * 0.16, r * 2.7);
  y = band(x, g, y, "TOMORROW'S", 'CALLS', 'ARE UP');
  stroke(x, g.X, y, g.cw, g.rows.win);
  y += g.rows.win;
  x.fillStyle = 'rgba(255,255,255,0.96)'; x.fillRect(g.X, y, g.cw, g.rows.foot);
  pillAt(x, g.X + g.cw / 2, y + g.rows.foot / 2, 'Link in bio', { bg: 'rgba(122,90,248,0.95)' });
  x.fillStyle = '#555'; x.font = `400 ${Math.round(9 * K)}px ${PLAIN}`; x.textAlign = 'left'; x.textBaseline = 'middle';
  x.fillText('18+ BeGambleAware.org', g.X + 10 * K, y + g.rows.foot / 2);
  stroke(x, g.X, y, g.cw, g.rows.foot);
  gloss(x, g.X, g.Y, g.cw, g.total);
  x.textBaseline = 'alphabetic';
  brand(x, W, H);
  credit(x, W, H, photo);
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
  // Every match's photo search at once, before anything is drawn.
  await Promise.all(landed.flatMap((p) => queriesFor(p).map(search)));
  await make('cover', 'Cover', (x) => drawCover(x, W, H, d, counts, landed));
  let i = 0;
  for (const p of landed) {
    i++;
    await make(`p${p.id}`, `${p.home_team} v ${p.away_team}`, (x) => drawCall(x, W, H, p, i, landed.length));
  }
  await make('end', 'Last slide', (x) => drawEnd(x, W, H, landed));
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
        ${!photos.has(s.key) && found.get(s.key)?.list.length > 1 ? `<button type="button" class="btn btn-quiet btn-sm" data-next="${s.key}">Next photo</button>` : ''}
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
  for (const b of box.querySelectorAll('[data-next]')) b.onclick = () => { found.get(b.dataset.next).i++; render(main); };
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
    // The score face, used only on the slides: loaded here rather than by every page.
    (async () => { const f = new FontFace('Michroma', 'url(/fonts/michroma-latin.woff2)'); document.fonts.add(await f.load()); })(),
  ].map((x) => Promise.resolve(x).catch(() => null)));
  await render(main);
}
