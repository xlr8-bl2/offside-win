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

/** The brand bar along the foot: the name, and where to find us. */
function brandBar(x, W, H, { tag = 'LINK IN BIO' } = {}) {
  const { bottom } = margins();
  const h = 120; const y = H - bottom - h;
  x.fillStyle = V.violet;
  x.fillRect(0, y, W, H - y); // to the edge; on a story the app's own buttons sit over the rest
  x.textBaseline = 'middle';
  x.textAlign = 'left';
  x.font = `700 50px 'Offside Wordmark', ${BODY}`;
  x.fillStyle = '#fff';
  x.fillText('offside.win', 60, y + h / 2 + 2);
  x.textAlign = 'right';
  x.font = CAPS(54);
  x.fillText(tag, W - 60, y + h / 2 + 3);
  x.textBaseline = 'alphabetic';
  return y;
}

/** Two clubs' colours split on the diagonal, each crest large and soft behind its side. */
function clubGround(x, X, Y, W, H, hc, ac) {
  const a = crestColour(hc) ?? '#2a2a33';
  const b = crestColour(ac) ?? '#1c1c22';
  x.save();
  x.beginPath(); x.rect(X, Y, W, H); x.clip();
  x.fillStyle = a; x.fillRect(X, Y, W, H);
  x.beginPath(); x.moveTo(X + W * 0.62, Y); x.lineTo(X + W, Y); x.lineTo(X + W, Y + H); x.lineTo(X + W * 0.38, Y + H); x.closePath();
  x.fillStyle = b; x.fill();
  x.globalAlpha = 0.22;
  x.filter = 'blur(3px)';
  const big = H * 0.95;
  if (hc) x.drawImage(hc, X + W * 0.25 - big / 2, Y + H * 0.5 - big / 2, big, big);
  if (ac) x.drawImage(ac, X + W * 0.75 - big / 2, Y + H * 0.5 - big / 2, big, big);
  x.filter = 'none';
  x.globalAlpha = 1;
  const g = x.createLinearGradient(0, Y, 0, Y + H);
  g.addColorStop(0, 'rgba(0,0,0,0.15)'); g.addColorStop(1, 'rgba(0,0,0,0.55)');
  x.fillStyle = g; x.fillRect(X, Y, W, H);
  x.restore();
}

function photoGround(x, X, Y, W, H, photo) {
  cover(x, photo.img, X, Y, W, H, photo.y);
  const g = x.createLinearGradient(0, Y, 0, Y + H);
  g.addColorStop(0, 'rgba(0,0,0,0.35)'); g.addColorStop(0.45, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.75)');
  x.fillStyle = g; x.fillRect(X, Y, W, H);
}

function pill(x, X, Y, text, { bg = '#fff', fg = '#000', size = 30, align = 'left' } = {}) {
  x.font = `800 ${size}px ${BODY}`;
  const w = x.measureText(text).width + size * 1.1;
  const h = size * 1.6;
  const left = align === 'right' ? X - w : X;
  x.fillStyle = bg; x.fillRect(left, Y, w, h);
  x.fillStyle = fg; x.textAlign = 'left'; x.textBaseline = 'middle';
  x.fillText(text, left + size * 0.55, Y + h / 2 + 1);
  x.textBaseline = 'alphabetic';
  return w;
}

/** One side's score row: its colour down the edge, crest, name, goals. */
function scoreRow(x, X, Y, W, h, { name, goals, crest: img, colour, won }) {
  x.fillStyle = V.bar; x.fillRect(X, Y, W, h);
  x.fillStyle = colour ?? '#888'; x.fillRect(X, Y, 14, h);
  const cs = h * 0.66;
  if (img) x.drawImage(img, X + 40, Y + (h - cs) / 2, cs, cs);
  const nameX = X + 40 + cs + 30;
  const boxW = h * 1.05;
  const fs = fitSize(x, name.toUpperCase(), (s) => CAPS(s), h * 0.62, h * 0.36, W - (nameX - X) - boxW - 30);
  x.font = CAPS(fs);
  x.fillStyle = '#fff'; x.textAlign = 'left'; x.textBaseline = 'middle';
  x.fillText(name.toUpperCase(), nameX, Y + h / 2 + 3);
  x.fillStyle = won ? '#fff' : 'rgba(255,255,255,0.12)';
  x.fillRect(X + W - boxW, Y, boxW, h);
  x.fillStyle = won ? '#000' : '#fff';
  x.textAlign = 'center';
  x.font = `800 ${h * 0.72}px 'Offside Figures', ${DISPLAY}`;
  x.fillText(String(goals), X + W - boxW / 2, Y + h / 2 + 4);
  x.textBaseline = 'alphabetic';
}

const COVER_WORDS = (c) => (c.landed === c.graded ? 'CLEAN SWEEP' : c.landed / c.graded >= 0.75 ? 'CALLS LANDED' : 'CALLS LANDED');

async function drawCover(x, W, H, d, counts, landed) {
  const { top } = margins();
  x.fillStyle = C.pitch; x.fillRect(0, 0, W, H);
  const photo = photos.get('cover');
  const heroH = H * 0.5;
  if (photo) photoGround(x, 0, 0, W, heroH + 120, photo);
  else {
    const g = x.createLinearGradient(0, 0, W, heroH);
    g.addColorStop(0, V.violetDeep); g.addColorStop(1, C.pitch);
    x.fillStyle = g; x.fillRect(0, 0, W, heroH + 120);
  }
  const fade = x.createLinearGradient(0, heroH - 200, 0, heroH + 120);
  fade.addColorStop(0, 'rgba(12,11,9,0)'); fade.addColorStop(1, C.pitch);
  x.fillStyle = fade; x.fillRect(0, heroH - 200, W, 320);

  pill(x, 60, top + 60, `${dayName(d).toUpperCase()}'S RESULTS`, { bg: V.violet, fg: '#fff', size: 30 });
  x.textAlign = 'left';
  x.fillStyle = '#fff';
  x.font = CAPS(330);
  x.fillText(`${counts.landed}/${counts.graded}`, 50, heroH + 10);
  x.fillStyle = V.tick;
  x.font = CAPS(96);
  x.fillText(COVER_WORDS(counts), 60, heroH + 150);

  // The calls that landed, as a results list.
  const barTop = brandBar(x, W, H);
  const rowH = 74;
  const room = Math.floor((barTop - (heroH + 190)) / rowH);
  const list = landed.slice(0, Math.max(1, room - (landed.length > room ? 1 : 0)));
  list.forEach((p, i) => {
    const y = heroH + 190 + i * rowH;
    x.fillStyle = V.tick;
    x.beginPath(); x.arc(84, y + 30, 18, 0, Math.PI * 2); x.fill();
    x.strokeStyle = '#000'; x.lineWidth = 5; x.beginPath(); x.moveTo(75, y + 31); x.lineTo(82, y + 38); x.lineTo(94, y + 23); x.stroke();
    const t = `${p.home_team} ${p.home_goals}–${p.away_goals} ${p.away_team}`.toUpperCase();
    const fs = fitSize(x, t, (s) => CAPS(s), 50, 30, W - 180);
    x.font = CAPS(fs); x.fillStyle = '#fff'; x.textAlign = 'left';
    x.fillText(t, 124, y + 48);
  });
  if (landed.length > list.length) {
    x.font = `700 30px ${BODY}`; x.fillStyle = C.chalk3;
    x.fillText(`+${landed.length - list.length} more, swipe`, 124, heroH + 190 + list.length * rowH + 40);
  }
}

async function drawCall(x, W, H, p, i, n) {
  const { top } = margins();
  const [hc, ac] = await Promise.all([crest(p.home_team_id), crest(p.away_team_id)]);
  x.fillStyle = C.pitch; x.fillRect(0, 0, W, H);
  const barTop = brandBar(x, W, H);
  const picH = Math.round((barTop - top) * 0.52);
  const photo = photos.get(`p${p.id}`);
  // To the top edge; the words keep inside the story's safe area.
  if (photo) photoGround(x, 0, 0, W, top + picH, photo); else clubGround(x, 0, 0, W, top + picH, hc, ac);

  const lg = (leagues.get(Number(p.league_id)) ?? '').toUpperCase();
  if (lg) pill(x, 60, top + 50, lg, { bg: '#fff', fg: '#000', size: 28 });
  pill(x, W - 60, top + 50, `${i} OF ${n}`, { bg: 'rgba(0,0,0,0.6)', fg: '#fff', size: 28, align: 'right' });

  // The score, over the foot of the picture.
  const rowH = 128;
  const y0 = top + picH - rowH - 30;
  pill(x, 60, y0 - 62, 'FULL TIME', { bg: '#fff', fg: '#000', size: 26 });
  const hw = p.home_goals > p.away_goals; const aw = p.away_goals > p.home_goals;
  scoreRow(x, 60, y0, W - 120, rowH, { name: p.home_team, goals: p.home_goals, crest: hc, colour: crestColour(hc), won: hw });
  scoreRow(x, 60, y0 + rowH + 8, W - 120, rowH, { name: p.away_team, goals: p.away_goals, crest: ac, colour: crestColour(ac), won: aw });

  // Our call.
  const cy = y0 + rowH * 2 + 8 + 90;
  x.fillStyle = V.tick;
  x.beginPath(); x.arc(84, cy - 12, 24, 0, Math.PI * 2); x.fill();
  x.strokeStyle = '#000'; x.lineWidth = 6; x.beginPath(); x.moveTo(72, cy - 11); x.lineTo(81, cy - 2); x.lineTo(97, cy - 22); x.stroke();
  x.textAlign = 'left'; x.fillStyle = V.tick; x.font = CAPS(44);
  x.fillText('OUR CALL LANDED', 128, cy);
  const call = callOf(p);
  const fs = fitSize(x, call.name.toUpperCase(), (s) => CAPS(s), 104, 56, W - 120);
  x.font = CAPS(fs); x.fillStyle = '#fff';
  x.fillText(call.name.toUpperCase(), 60, cy + fs + 10);
  x.font = `600 34px ${BODY}`; x.fillStyle = C.chalk2;
  x.fillText(`${call.market ? `${call.market}, ` : ''}odds of ${odds(p.odds)}${p.bookmaker ? ` at ${p.bookmaker.charAt(0).toUpperCase()}${p.bookmaker.slice(1)}` : ''}`, 60, cy + fs + 64);
  const sc = scorers(p);
  const who = [...sc.home, ...sc.away].join(', ');
  if (who && cy + fs + 120 < barTop - 20) {
    x.font = `500 28px ${BODY}`; x.fillStyle = C.chalk3;
    x.fillText(lines(x, who, W - 120)[0], 60, cy + fs + 112);
  }
}

async function drawEnd(x, W, H) {
  const { top, bottom } = margins();
  const photo = photos.get('end');
  x.fillStyle = V.violet; x.fillRect(0, 0, W, H);
  if (photo) {
    photoGround(x, 0, 0, W, H, photo);
    x.fillStyle = 'rgba(75,47,214,0.55)'; x.fillRect(0, 0, W, H);
  }
  x.textAlign = 'left'; x.fillStyle = '#fff';
  const lines4 = ["TOMORROW'S", 'CALLS ARE', 'ALREADY UP.'];
  lines4.forEach((l, k) => { x.font = CAPS(170); x.fillText(l, 56, top + 300 + k * 165); });
  const by = top + 300 + lines4.length * 165 + 30;
  x.font = CAPS(96);
  const lw = x.measureText('LINK IN BIO').width + 60;
  x.fillStyle = '#fff'; x.fillRect(60, by, lw, 130);
  x.fillStyle = V.violetDeep; x.textBaseline = 'middle';
  x.fillText('LINK IN BIO', 90, by + 68);
  x.textBaseline = 'alphabetic';
  x.fillStyle = '#fff'; x.font = `700 64px 'Offside Wordmark', ${BODY}`;
  x.fillText('offside.win', 60, by + 240);
  x.font = `500 26px ${BODY}`; x.fillStyle = 'rgba(255,255,255,0.75)';
  x.fillText('18+. Gamble responsibly. BeGambleAware.org', 60, H - bottom - 60);
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
