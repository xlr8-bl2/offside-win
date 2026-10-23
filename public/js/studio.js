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
import { findBanned } from './lib/vocabulary.js';

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

/*
 * The look: football social with some noise in it. A photo darkened under
 * grain; one heavy hook line on the cover, skewed, its second half on a
 * green slab; on each call, WHAT WE SAID (the call, its odds, a line from the
 * reasoning the site published before kick-off) against WHAT HAPPENED (the
 * score on tilted bars, the scorers) with a LANDED stamp slapped across the
 * corner. Big Shoulders for shouting, Michroma for labels and figures.
 */
const HOT = { violet: '#7a5af8', green: '#3ddc84', black: '#0a0a0a' };
const SHOUT = (s) => `800 ${s}px ${DISPLAY}`;
const LABEL = (s) => `400 ${s}px 'Michroma', ${BODY}`;

function pitchGround(x, W, H) {
  const g = x.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#16351a'); g.addColorStop(1, '#0a0f0a');
  x.fillStyle = g; x.fillRect(0, 0, W, H);
  x.save(); x.globalAlpha = 0.08; x.strokeStyle = '#fff'; x.lineWidth = 6;
  x.beginPath(); x.arc(W / 2, H * 0.55, W * 0.3, 0, Math.PI * 2); x.stroke();
  x.beginPath(); x.moveTo(0, H * 0.55); x.lineTo(W, H * 0.55); x.stroke();
  x.restore();
}

let grainTile = null;
function grain(x, W, H, alpha = 0.12) {
  if (!grainTile) {
    grainTile = document.createElement('canvas'); grainTile.width = grainTile.height = 256;
    const t = grainTile.getContext('2d'); const d = t.createImageData(256, 256);
    for (let i = 0; i < d.data.length; i += 4) { const v = Math.random() * 255; d.data[i] = d.data[i + 1] = d.data[i + 2] = v; d.data[i + 3] = 255; }
    t.putImageData(d, 0, 0);
  }
  x.save(); x.globalAlpha = alpha; x.globalCompositeOperation = 'overlay';
  x.fillStyle = x.createPattern(grainTile, 'repeat'); x.fillRect(0, 0, W, H); x.restore();
}

/** The photo to the edges, pushed dark so the type can shout over it. */
function background(x, W, H, photo, dark = 0.55) {
  if (photo) cover(x, photo.img, 0, 0, W, H, photo.y); else pitchGround(x, W, H);
  const g = x.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, `rgba(10,10,10,${dark})`); g.addColorStop(0.5, `rgba(10,10,10,${dark * 0.7})`); g.addColorStop(1, 'rgba(10,10,10,0.92)');
  x.fillStyle = g; x.fillRect(0, 0, W, H);
  grain(x, W, H);
}

/** Text in the shouting face, skewed forward. */
function shout(x, text, X, Y, size, { fill = '#fff', skew = -0.14 } = {}) {
  x.save(); x.translate(X, Y); x.transform(1, 0, skew, 1, 0, 0);
  x.font = SHOUT(size); x.fillStyle = fill; x.fillText(text, 0, 0);
  x.restore();
}

/** The site's name as a sticker: violet, tilted, slapped on. */
function sticker(x, X, Y, angle = -0.08) {
  x.save(); x.translate(X, Y); x.rotate(angle);
  x.font = `700 34px 'Offside Wordmark', ${BODY}`;
  const w = x.measureText('offside.win').width + 40;
  x.fillStyle = HOT.violet; x.fillRect(-w / 2, -32, w, 64);
  x.fillStyle = '#fff'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText('offside.win', 0, 2);
  x.restore(); x.textAlign = 'left'; x.textBaseline = 'alphabetic';
}

/** The LANDED stamp: a thick green frame, tilted, the word and a tick. */
function stamp(x, cx, cy, text = 'LANDED', size = 110, angle = -0.2) {
  x.save(); x.translate(cx, cy); x.rotate(angle);
  x.font = SHOUT(size);
  const tw = x.measureText(text).width; const w = tw + size * 1.4; const h = size * 1.15;
  x.fillStyle = 'rgba(10,10,10,0.55)'; x.fillRect(-w / 2, -h / 2, w, h);
  x.strokeStyle = HOT.green; x.lineWidth = 10; x.strokeRect(-w / 2, -h / 2, w, h);
  x.fillStyle = HOT.green; x.textBaseline = 'middle'; x.textAlign = 'left';
  x.fillText(text, -w / 2 + size * 0.3, 4);
  const tx = w / 2 - size * 0.62; const r = size * 0.3;
  x.beginPath(); x.arc(tx, 0, r, 0, Math.PI * 2); x.fill();
  x.strokeStyle = HOT.black; x.lineWidth = size * 0.08; x.beginPath();
  x.moveTo(tx - r * 0.45, 0); x.lineTo(tx - r * 0.1, r * 0.38); x.lineTo(tx + r * 0.5, -r * 0.4); x.stroke();
  x.restore(); x.textAlign = 'left'; x.textBaseline = 'alphabetic';
}

function tiny(x, W, H) {
  const { bottom } = margins();
  x.font = LABEL(20); x.fillStyle = 'rgba(255,255,255,0.85)'; x.textBaseline = 'alphabetic';
  x.textAlign = 'left'; x.fillText('OFFSIDE.WIN', 60, H - bottom - 50);
  x.textAlign = 'right'; x.fillText('LINK IN BIO', W - 60, H - bottom - 50);
  x.textAlign = 'left';
}
function credit(x, W, H, photo) {
  if (!photo?.credit) return;
  const { bottom } = margins();
  x.font = `400 15px ${BODY}`; x.textAlign = 'right'; x.fillStyle = 'rgba(255,255,255,0.55)';
  x.fillText(photo.credit, W - 60, H - bottom - 22); x.textAlign = 'left';
}

/** The sharpest line of what we wrote before kick-off: short, plain, safe to show. */
function quoteOf(p) {
  const all = `${p.narrative ?? ''} ${p.why ?? ''}`.split(/(?<=[.!?])\s+/).map((t) => t.trim());
  const ok = all.filter((t) => {
    const n = t.split(/\s+/).length;
    return n >= 6 && n <= 20 && !/odds|call to fail|at \d/i.test(t) && !findBanned(t) && !/\d+\.\d/.test(t);
  });
  ok.sort((a, b) => a.length - b.length);
  return ok.find((t) => t.includes(p.home_team) || t.includes(p.away_team)) ?? ok[0] ?? null;
}

const HOOK = (c, landed) => {
  if (landed.some((p) => Number(p.odds) >= 2)) return ['NOBODY SAW IT.', 'WE DID.'];
  if (c.landed === c.graded) return ["WE DON'T", 'MISS.'];
  if (c.landed / c.graded >= 0.7) return ['TOLD', 'YOU.'];
  return ['STILL', 'COOKING.'];
};

async function drawCover(x, W, H, d, counts, landed) {
  const { top, bottom } = margins();
  const photo = await dayPhoto('cover', landed, 0);
  background(x, W, H, photo, 0.45);
  sticker(x, W - 190, top + 90);
  x.font = LABEL(24); x.fillStyle = 'rgba(255,255,255,0.8)';
  x.fillText(dayLong(d).toUpperCase(), 64, top + 100);
  const [one, two] = HOOK(counts, landed);
  const base = H * 0.52;
  let s1 = 230; x.font = SHOUT(s1); while (x.measureText(one).width > W - 140 && s1 > 120) { s1 -= 6; x.font = SHOUT(s1); }
  shout(x, one, 64, base, s1);
  let s2 = s1; x.font = SHOUT(s2); while (x.measureText(two).width > W - 200 && s2 > 120) { s2 -= 6; x.font = SHOUT(s2); }
  const w2 = x.measureText(two).width;
  x.save(); x.translate(56, base + 30); x.transform(1, 0, -0.14, 1, 0, 0);
  x.fillStyle = HOT.green; x.fillRect(0, 0, w2 + 50, s2 * 0.95); x.restore();
  shout(x, two, 80, base + 30 + s2 * 0.82, s2, { fill: HOT.black });
  stamp(x, W * 0.68, H - bottom - 260, `${counts.landed}/${counts.graded} LANDED`, 74, -0.1);
  x.font = LABEL(26); x.fillStyle = '#fff'; x.textAlign = 'right';
  x.fillText('SWIPE →', W - 64, H - bottom - 110); x.textAlign = 'left';
  tiny(x, W, H); credit(x, W, H, photo);
}

async function drawCall(x, W, H, p, i, n) {
  const { top, bottom } = margins();
  const [hc, ac] = await Promise.all([crest(p.home_team_id), crest(p.away_team_id)]);
  const photo = await photoOf(`p${p.id}`, p);
  background(x, W, H, photo, 0.62);
  const lg = (leagues.get(Number(p.league_id)) ?? '').toUpperCase();
  x.font = LABEL(20); x.fillStyle = 'rgba(255,255,255,0.75)';
  x.fillText(`${lg}${lg ? '   ' : ''}${i}/${n}`, 64, top + 80);
  sticker(x, W - 170, top + 70, -0.06);

  // WHAT WE SAID.
  let y = top + 200;
  x.font = LABEL(26); x.fillStyle = HOT.violet; x.fillText('WHAT WE SAID', 64, y);
  const call = callOf(p).name.toUpperCase();
  let cs = 132; x.font = SHOUT(cs); while (x.measureText(call).width > W - 150 && cs > 70) { cs -= 4; x.font = SHOUT(cs); }
  y += cs + 6; shout(x, call, 64, y, cs);
  y += 74; x.font = LABEL(48); x.fillStyle = HOT.green; x.fillText(`ODDS OF ${odds(p.odds)}`, 64, y);
  const q = quoteOf(p);
  if (q) {
    x.font = `600 italic 34px ${BODY}`;
    const ls = lines(x, `“${q}”`, W - 170).slice(0, 3);
    y += 40;
    x.fillStyle = HOT.violet; x.fillRect(64, y, 8, ls.length * 46 + 6);
    x.fillStyle = 'rgba(255,255,255,0.92)';
    ls.forEach((l, k) => x.fillText(l, 92, y + 36 + k * 46));
    y += ls.length * 46 + 6;
  }

  // The hinge: WE SAID. THEY DID.
  y += 40;
  x.save(); x.translate(0, y); x.rotate(-0.035);
  x.fillStyle = HOT.violet; x.fillRect(-20, 0, W + 40, 70);
  x.fillStyle = '#fff'; x.font = LABEL(30); x.textBaseline = 'middle';
  x.fillText('WE SAID IT.  THEY DID IT.  WE SAID IT.  THEY DID IT.', 40, 37);
  x.restore(); x.textBaseline = 'alphabetic';

  // WHAT HAPPENED.
  y += 140;
  x.font = LABEL(26); x.fillStyle = HOT.green; x.fillText('WHAT HAPPENED', 64, y);
  y += 26;
  const rowH = 104;
  const row = (team, goals, img, yy, won) => {
    x.save(); x.translate(64, yy); x.transform(1, 0, -0.06, 1, 0, 0);
    x.fillStyle = 'rgba(10,10,10,0.82)'; x.fillRect(0, 0, W - 128, rowH);
    x.fillStyle = won ? HOT.green : 'rgba(255,255,255,0.14)'; x.fillRect(W - 128 - rowH, 0, rowH, rowH);
    x.restore();
    if (img) x.drawImage(img, 86, yy + 17, 70, 70);
    let ns = 72; x.font = SHOUT(ns); const nm = String(team).toUpperCase();
    while (x.measureText(nm).width > W - 128 - rowH - 150 && ns > 40) { ns -= 2; x.font = SHOUT(ns); }
    x.fillStyle = '#fff'; x.textBaseline = 'middle'; x.fillText(nm, 176, yy + rowH / 2 + 4);
    x.font = SHOUT(84); x.textAlign = 'center'; x.fillStyle = won ? HOT.black : '#fff';
    x.fillText(String(goals), 64 + W - 128 - rowH / 2 - 4, yy + rowH / 2 + 5);
    x.textAlign = 'left'; x.textBaseline = 'alphabetic';
  };
  row(p.home_team, p.home_goals, hc, y, p.home_goals > p.away_goals);
  row(p.away_team, p.away_goals, ac, y + rowH + 8, p.away_goals > p.home_goals);
  y += rowH * 2 + 8;
  const sc = scorers(p); const who = [...sc.home, ...sc.away].join(', ');
  if (who) { x.font = `500 28px ${BODY}`; x.fillStyle = 'rgba(255,255,255,0.75)'; x.fillText(lines(x, who, W - 128)[0], 64, y + 44); }
  stamp(x, W - 290, Math.min(y + 170, H - margins().bottom - 170), 'LANDED', 104, -0.16);
  tiny(x, W, H); credit(x, W, H, photo);
}

async function drawEnd(x, W, H, landed) {
  const { top, bottom } = margins();
  const photo = await dayPhoto('end', landed, 1);
  background(x, W, H, photo, 0.6);
  sticker(x, W - 190, top + 90);
  const base = H * 0.36;
  ['TOMORROW\'S', 'CALLS ARE', 'ALREADY UP.'].forEach((l, k) => shout(x, l, 64, base + k * 175, 180, { fill: k === 2 ? HOT.green : '#fff' }));
  const by = base + 2 * 175 + 90;
  x.save(); x.translate(64, by); x.rotate(-0.03);
  x.font = SHOUT(96); const lw = x.measureText('LINK IN BIO').width + 80;
  x.fillStyle = '#fff'; x.fillRect(0, 0, lw, 130);
  x.fillStyle = HOT.black; x.textBaseline = 'middle'; x.fillText('LINK IN BIO', 40, 70);
  x.restore(); x.textBaseline = 'alphabetic';
  x.font = `500 24px ${BODY}`; x.fillStyle = 'rgba(255,255,255,0.7)';
  x.fillText('18+. Gamble responsibly. BeGambleAware.org', 64, H - bottom - 110);
  tiny(x, W, H); credit(x, W, H, photo);
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
