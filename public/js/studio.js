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
 * Crests come through the Worker's own address (/crest/team/<id>.png) so the
 * canvas can read them back to save. A photo is whatever the owner picks from
 * their phone; it never leaves the browser.
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
const crestCache = new Map();

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

async function crest(id) {
  if (!id) return null;
  if (!crestCache.has(id)) crestCache.set(id, image(`/crest/team/${Number(id)}.png`));
  return crestCache.get(id);
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
    if (max - min < 40 || max < 50) continue; // greys, whites and blacks say nothing
    const k = `${r >> 5},${g >> 5},${b >> 5}`;
    const e = bins.get(k) ?? { n: 0, r: 0, g: 0, b: 0 };
    e.n++; e.r += r; e.g += g; e.b += b;
    bins.set(k, e);
  }
  const best = [...bins.values()].sort((a, b) => b.n - a.n)[0];
  return best ? `rgb(${Math.round(best.r / best.n)}, ${Math.round(best.g / best.n)}, ${Math.round(best.b / best.n)})` : null;
}

/* -------------------------------------------------------------- drawing */

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

/** Text at the largest size up to `max` that fits `maxW` on at most `rows` lines. */
function fit(x, text, { font, max, min = 40, maxW, rows = 2 }) {
  for (let s = max; s >= min; s -= 4) {
    x.font = font(s);
    const ls = lines(x, text, maxW);
    if (ls.length <= rows && ls.every((l) => x.measureText(l).width <= maxW)) return { size: s, lines: ls };
  }
  x.font = font(min);
  return { size: min, lines: lines(x, text, maxW).slice(0, rows) };
}

function cover(x, img, W, H, y = 0.5) {
  const s = Math.max(W / img.width, H / img.height);
  const w = img.width * s; const h = img.height * s;
  x.drawImage(img, (W - w) / 2, (H - h) * y, w, h);
}

/** The ground: a photo if there is one, else the club's colour falling into the dark; the offside line over both. */
function ground(x, W, H, { photo, colour }) {
  x.fillStyle = C.pitch;
  x.fillRect(0, 0, W, H);
  if (photo) {
    cover(x, photo.img, W, H, photo.y);
    const g = x.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, 'rgba(12,11,9,0.55)');
    g.addColorStop(0.35, 'rgba(12,11,9,0.1)');
    g.addColorStop(0.6, 'rgba(12,11,9,0.55)');
    g.addColorStop(1, 'rgba(12,11,9,0.96)');
    x.fillStyle = g;
    x.fillRect(0, 0, W, H);
  } else {
    const g = x.createRadialGradient(W * 0.8, H * 0.05, 0, W * 0.8, H * 0.05, H * 0.9);
    g.addColorStop(0, colour ?? 'rgba(122,90,248,0.55)');
    g.addColorStop(1, 'rgba(12,11,9,0)');
    x.globalAlpha = 0.65;
    x.fillStyle = g;
    x.fillRect(0, 0, W, H);
    x.globalAlpha = 1;
  }
  // The line, and the side past it washed violet.
  x.save();
  x.translate(W * 0.74, H / 2);
  x.rotate((9 * Math.PI) / 180);
  const wash = x.createLinearGradient(0, 0, W * 0.5, 0);
  wash.addColorStop(0, 'rgba(122,90,248,0.22)');
  wash.addColorStop(1, 'rgba(122,90,248,0)');
  x.fillStyle = wash;
  x.fillRect(0, -H, W, H * 2);
  x.shadowColor = C.violet;
  x.shadowBlur = 24;
  x.fillStyle = C.violetHi;
  x.fillRect(-2, -H, 4, H * 2);
  x.restore();
}

function wordmark(x, X, Y, s = 44) {
  x.textBaseline = 'alphabetic';
  x.textAlign = 'left';
  x.font = `700 ${s}px 'Offside Wordmark', ${BODY}`;
  x.fillStyle = C.chalk;
  x.fillText('offside', X, Y);
  const w = x.measureText('offside').width;
  x.fillStyle = C.violet;
  x.beginPath();
  x.arc(X + w + s * 0.16, Y - s * 0.1, s * 0.11, 0, Math.PI * 2);
  x.fill();
  x.fillStyle = C.chalk3;
  x.fillText('win', X + w + s * 0.32, Y);
}

function drawCover(x, W, H, d, counts) {
  ground(x, W, H, { photo: photos.get('cover') });
  const pad = 88;
  wordmark(x, pad, pad + 36);
  const base = H - pad - (size === 'story' ? 260 : 120);
  x.textAlign = 'left';
  x.fillStyle = C.chalk2;
  x.font = `500 44px ${BODY}`;
  x.fillText(`${dayName(d)}'s calls`, pad, base - 470);
  x.fillStyle = C.chalk;
  x.font = `800 300px ${DISPLAY}`;
  x.fillText(`${counts.landed} of ${counts.graded}`, pad - 6, base - 170);
  x.fillStyle = C.won;
  x.font = `800 210px ${DISPLAY}`;
  x.fillText('landed', pad - 4, base + 10);
  x.fillStyle = C.chalk2;
  x.font = `500 38px ${BODY}`;
  x.fillText(dayLong(d), pad, base + 90);
}

async function drawCall(x, W, H, p, i, n) {
  const [hc, ac] = await Promise.all([crest(p.home_team_id), crest(p.away_team_id)]);
  ground(x, W, H, { photo: photos.get(`p${p.id}`), colour: crestColour(hc) });
  const pad = 88;
  wordmark(x, pad, pad + 36, 40);
  x.textAlign = 'right';
  x.fillStyle = C.chalk3;
  x.font = `500 34px ${BODY}`;
  x.fillText(`${i} of ${n}`, W - pad, pad + 32);

  const story = size === 'story';
  const bottom = H - pad - (story ? 220 : 0);
  // The score, crests over it.
  const crestY = bottom - 820;
  const cs = 150;
  if (hc) x.drawImage(hc, pad, crestY, cs, cs);
  if (ac) x.drawImage(ac, pad + cs + 36, crestY, cs, cs);
  x.textAlign = 'left';
  x.fillStyle = C.chalk2;
  x.font = `500 36px ${BODY}`;
  const lg = leagues.get(Number(p.league_id));
  x.fillText(lg ? `${lg}, full time` : 'Full time', pad, crestY + cs + 70);

  const sideLine = (team, goals, y) => {
    const t = fit(x, team, { font: (s) => `800 ${s}px ${DISPLAY}`, max: 120, min: 64, maxW: W - pad * 2 - 150, rows: 1 });
    x.font = `800 ${t.size}px ${DISPLAY}`;
    x.fillStyle = C.chalk;
    x.textAlign = 'left';
    x.fillText(t.lines[0], pad, y);
    x.font = `800 ${Math.max(t.size, 110)}px 'Offside Figures', ${DISPLAY}`;
    x.textAlign = 'right';
    x.fillText(String(goals), W - pad, y);
  };
  sideLine(p.home_team, p.home_goals, crestY + cs + 200);
  sideLine(p.away_team, p.away_goals, crestY + cs + 330);

  const sc = scorers(p);
  const who = [...sc.home, ...sc.away].slice(0, 4).join(', ');
  if (who) {
    x.textAlign = 'left';
    x.fillStyle = C.chalk3;
    x.font = `400 32px ${BODY}`;
    x.fillText(lines(x, who, W - pad * 2)[0], pad, crestY + cs + 390);
  }

  // The call, on a band.
  const call = callOf(p);
  const bandY = bottom - 250;
  x.fillStyle = 'rgba(21,19,15,0.88)';
  x.fillRect(pad - 24, bandY, W - (pad - 24) * 2, 250);
  x.fillStyle = C.won;
  x.fillRect(pad - 24, bandY, 10, 250);
  x.textAlign = 'left';
  x.fillStyle = C.won;
  x.font = `700 34px ${BODY}`;
  x.fillText('Our call landed', pad + 16, bandY + 62);
  const t = fit(x, call.name, { font: (s) => `800 ${s}px ${DISPLAY}`, max: 84, min: 52, maxW: W - pad * 2 - 40, rows: 1 });
  x.fillStyle = C.chalk;
  x.font = `800 ${t.size}px ${DISPLAY}`;
  x.fillText(t.lines[0], pad + 16, bandY + 150);
  x.fillStyle = C.chalk2;
  x.font = `500 36px ${BODY}`;
  x.fillText(`${call.market ? `${call.market}, ` : ''}odds of ${odds(p.odds)}${p.bookmaker ? ` at ${p.bookmaker}` : ''}`, pad + 16, bandY + 212);
}

function drawEnd(x, W, H) {
  ground(x, W, H, { photo: photos.get('end') });
  const pad = 88;
  const mid = H / 2;
  x.textAlign = 'left';
  x.fillStyle = C.chalk;
  x.font = `800 150px ${DISPLAY}`;
  x.fillText('Every call,', pad, mid - 120);
  x.fillText('with the reason.', pad, mid + 20);
  x.fillStyle = C.chalk2;
  x.font = `500 44px ${BODY}`;
  x.fillText('The next ones are up now, and every', pad, mid + 130);
  x.fillText('result is on the site.', pad, mid + 186);
  wordmark(x, pad, mid + 330, 76);
  x.fillStyle = C.chalk3;
  x.font = `400 32px ${BODY}`;
  x.fillText('18+. Gamble responsibly. BeGambleAware.org', pad, H - pad - (size === 'story' ? 200 : 0));
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
  await make('cover', 'Cover', (x) => drawCover(x, W, H, d, counts));
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
  ].map((x) => Promise.resolve(x).catch(() => null)));
  await render(main);
}
