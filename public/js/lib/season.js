/**
 * What kind of week it is, and a note saying so.
 *
 * Some weeks are thin and it is nobody's fault. An international break takes
 * the big leagues away for a fortnight and leaves qualifiers and friendlies,
 * where squads are rotated and form tells you next to nothing, so the board
 * carries fewer calls. The close season is the same, for longer. A reader who
 * arrives then and finds a dozen calls where there were sixty thinks the site
 * is broken, unless something tells them it is the calendar.
 *
 * Other weeks are the opposite. A World Cup or a Euros is nothing but national
 * teams, and there is more to say about those games than about anything else
 * all year. Same national-team football, the reverse message.
 *
 * So the board itself decides, every time it is read, with nothing to switch
 * on or off:
 *   - a tournament is being played: show it off, the next games and a link;
 *   - no big-five or Champions League games and national teams playing: an
 *     international break, and how many days until the club game is back;
 *   - no big-five games, no national teams, and the Premier League more than
 *     ten days away: the close season.
 * Anything else is an ordinary week and says nothing.
 *
 * A reader sees each one once: a break once per break, the close season once
 * per close season, a tournament once a day (its games change daily).
 */

/** Champions League and the big five: when none of them plays, the club game is off. */
export const TOP_CLUB = new Set([7, 1, 3, 4, 5, 6]);

// The finals of national-team tournaments, not their qualifiers. The Club
// World Cup counts: it is a tournament with as much to say about it.
const TOURNAMENT = /\b(world cup|european championship|euro 20\d\d|copa am[eé]rica|africa cup of nations|afcon|asian cup|gold cup)\b/i;
const QUALIFIER = /qualif/i;
const NATIONAL = /nations league|international|world cup|european championship|euro 20\d\d|copa am[eé]rica|africa cup|asian cup|gold cup|qualif/i;
const CLUB_FRIENDLY = (f) => f.league_id === 79 || /club friendl/i.test(f.league ?? '');
const OVER = new Set(['finished', 'ended', 'aet', 'ap', 'postponed', 'canceled', 'cancelled', 'abandoned', 'unresolved']);
const isCall = (f) => Boolean(f.top_pick || f.locked);

const DAY = 86400;
/** Midnight, local, of the day an epoch falls on. */
const dayStart = (epoch) => { const d = new Date(epoch * 1000); d.setHours(0, 0, 0, 0); return d.getTime() / 1000; };
const dayKey = (epoch) => { const d = new Date(epoch * 1000); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };
/** Whole calendar days from one epoch's day to another's. */
export const daysBetween = (from, to) => Math.round((dayStart(to) - dayStart(from)) / DAY);

/** The competitions in a list of games, busiest first. */
function busiest(games) {
  const n = new Map();
  for (const f of games) {
    const k = f.league ?? '';
    if (!k) continue;
    const e = n.get(k) ?? { name: k, id: f.league_id ?? null, n: 0 };
    e.n++;
    n.set(k, e);
  }
  return [...n.values()].sort((a, b) => b.n - a.n);
}

/**
 * Read the week from the board.
 *
 * `nextTop` is asked only when the big leagues are absent: when the Premier
 * League plays next, as an epoch, or null. It is a callback so an ordinary
 * week costs no extra request.
 */
export async function readSeason({ fixtures = [], now = Date.now() / 1000, nextTop = async () => null } = {}) {
  const ahead = fixtures.filter((f) => f && f.kickoff >= now - 2.5 * 3600 && !OVER.has(String(f.status ?? '').toLowerCase()));
  const real = ahead.filter((f) => !CLUB_FRIENDLY(f));
  const tournament = real.filter((f) => TOURNAMENT.test(f.league ?? '') && !QUALIFIER.test(f.league ?? ''));

  if (tournament.length) {
    const lead = busiest(tournament)[0];
    const games = tournament.filter((f) => f.league === lead.name).sort((a, b) => a.kickoff - b.kickoff);
    return {
      kind: 'tournament',
      key: `t:${lead.id ?? lead.name}:${dayKey(now)}`,
      name: lead.name,
      leagueId: lead.id,
      count: games.length,
      calls: games.filter(isCall).length,
      games: games.slice(0, 3).map((f) => ({
        id: f.id, home: f.home, away: f.away, home_id: f.home_id, away_id: f.away_id,
        kickoff: f.kickoff, call: isCall(f), live: f.kickoff <= now,
      })),
    };
  }

  if (real.some((f) => TOP_CLUB.has(Number(f.league_id)))) return null;

  const national = real.filter((f) => NATIONAL.test(f.league ?? ''));
  const club = real.filter((f) => !NATIONAL.test(f.league ?? ''));
  const back = await nextTop().catch(() => null);
  const days = back ? daysBetween(now, back) : null;
  const base = {
    calls: real.filter(isCall).length,
    still: busiest(club).slice(0, 2).map((c) => c.name),
    back,
    days,
  };

  if (national.length >= 4) {
    return { kind: 'break', key: `b:${back ? dayKey(back) : weekKey(now)}`, national: busiest(national).slice(0, 2).map((c) => c.name), ...base };
  }
  if (days !== null && days > 10) {
    return { kind: 'offseason', key: `o:${dayKey(back)}`, ...base };
  }
  return null;
}

function weekKey(epoch) {
  const d = new Date(epoch * 1000);
  const jan1 = new Date(d.getFullYear(), 0, 1);
  return `${d.getFullYear()}w${Math.ceil(((d - jan1) / 864e5 + jan1.getDay() + 1) / 7)}`;
}

/* ---------------------------------------------------------------- words */

/** "League One, League Two and the FA Cup". */
export function listOf(names) {
  const the = (n) => (/^(fa|efl|copa)\b|\b(cup|league|championship|trophy)$/i.test(n) && !/^the /i.test(n) ? `the ${n}` : n);
  const xs = names.map(the);
  if (xs.length <= 1) return xs.join('');
  return `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;
}

/** The promise, said where the quiet is (worker/src/goodwill.ts keeps it). */
const GIVEN_BACK = 'Members lose nothing: a free day is added for every quiet day, automatically.';

const plural = (n, one, many) => `${n === 0 ? 'No' : n} ${n === 1 ? one : many}`;

/** What the note says, separate from how it looks, so it can be tested. */
export function wordsFor(r) {
  if (r.kind === 'tournament') {
    const short = r.name.replace(/^(fifa|uefa|conmebol|caf|afc|concacaf)\s+/i, '');
    return {
      label: short,
      chip: `${short} on now`,
      title: `The ${short} is on.`,
      lead: `${plural(r.count, 'game', 'games')} in the next three days, every one read like a club game.`,
      text: [
        'Who is fit, who is being rested, who needs the result: the same look a league match gets.',
        r.calls ? `${plural(r.calls, 'call', 'calls')} on them so far.` : 'Calls go up as the line-ups firm up.',
      ],
      cta: { label: `All ${short} games`, href: r.leagueId ? `#/league/${encodeURIComponent(r.leagueId)}` : '#/board' },
    };
  }
  const still = r.still.length ? cap(`${listOf(r.still)} ${r.still.length === 1 ? 'carries' : 'carry'} on as normal.`) : '';
  const board = `${plural(r.calls, 'call', 'calls')} on the board.`;
  /*
   * The reason first. The headline used to be "Club football is on hold" and
   * the why ("so we call fewer games") was the last words of the second
   * paragraph, so a reader who read the headline and left (most of them)
   * never learned why the board was thin. Now the headline names the break
   * and the line under it, in bold, says what that means for the calls.
   */
  if (r.kind === 'break') {
    return {
      label: 'International break',
      chip: 'International break',
      title: 'It’s an international break.',
      lead: 'That’s why there are fewer calls this week.',
      text: [
        'Qualifiers and friendlies mean rotated squads and form that tells you next to nothing, so we only call the games we trust.',
        [board, still].filter(Boolean).join(' '),
        GIVEN_BACK,
      ],
      cta: { label: 'See what’s on', href: '#/board' },
    };
  }
  return {
    label: 'Close season',
    chip: 'Close season',
    title: 'It’s the close season.',
    lead: 'That’s why there are fewer calls right now.',
    text: [
      'Pre-season friendlies tell you less than they look like they do, so most of them get no call.',
      [board, still].filter(Boolean).join(' '),
      GIVEN_BACK,
    ],
    cta: { label: 'See what’s on', href: '#/board' },
  };
}

/** "9 days until the Premier League is back", or "back tomorrow". */
export function countdownWords(days, league = 'the Premier League') {
  if (days === null || days === undefined) return null;
  if (days <= 0) return { n: null, text: `${cap(league)} is back today` };
  if (days === 1) return { n: null, text: `${cap(league)} is back tomorrow` };
  return { n: days, text: `days until ${league} is back` };
}
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/* ------------------------------------------------------------- the note */

import { scrollAway, moving } from './scrollaway.js';

const KEY = 'ow.season';
const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
function seen() { try { return JSON.parse(localStorage.getItem(KEY) ?? '[]') ?? []; } catch { return []; } }
function remember(key) {
  try { localStorage.setItem(KEY, JSON.stringify([...new Set([...seen(), key])].slice(-20))); } catch { /* shown again next visit */ }
}
export const dismissed = (key) => seen().includes(key) || off();
/* '*' in the list turns the notes off altogether, chip included. Nothing on
   the site writes it; the ui-verify checks do, so a note does not sit over
   whatever they are measuring (the note has a check of its own). */
const off = () => seen().includes('*');

/**
 * The days between now and the club game's return, one cell each, the last
 * one lit. More than a fortnight folds the middle into a gap.
 */
function daysStrip(now, back, days) {
  if (!back || days === null || days < 2) return '';
  const cells = [];
  const at = (i) => dayStart(now) + i * DAY + 12 * 3600;
  const cell = (i, cls = '') => {
    const d = new Date(at(i) * 1000);
    const label = i === days ? d.toLocaleDateString([], { day: 'numeric' }) : d.toLocaleDateString([], { weekday: 'narrow' });
    return `<li class="${cls}" title="${d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })}"><i>${label}</i></li>`;
  };
  if (days <= 14) {
    for (let i = 0; i <= days; i++) cells.push(cell(i, i === 0 ? 'is-today' : i === days ? 'is-back' : ''));
  } else {
    for (let i = 0; i <= 10; i++) cells.push(cell(i, i === 0 ? 'is-today' : ''));
    cells.push('<li class="is-gap" aria-hidden="true"><i>…</i></li>');
    cells.push(cell(days, 'is-back'));
  }
  return `<ol class="sn-days" aria-hidden="true">${cells.join('')}</ol>`;
}

/* The centre circle and halfway line, drawn behind the countdown. */
const PITCH = `<svg class="sn-pitch" viewBox="0 0 120 120" aria-hidden="true"><path class="sn-line" d="M60 8V112"/><circle class="sn-line" cx="60" cy="60" r="40"/><circle class="sn-spot" cx="60" cy="60" r="2.5"/></svg>`;

const words = (t) => t.split(/\s+/).map((w, i) => `<span class="sn-w"><span style="--i:${i}">${w}</span></span>`).join(' ');

function cardHTML(r, { crest, esc, kickoff, now }) {
  const w = wordsFor(r);
  let feature = '';
  if (r.kind === 'tournament') {
    feature = `<ul class="sn-games">${r.games.map((g) => `
      <li><a href="#/fixture/${encodeURIComponent(g.id)}">
        <span class="sn-teams">${crest(g.home, 'xs', g.home_id)}<b>${esc(g.home)}</b><em>v</em>${crest(g.away, 'xs', g.away_id)}<b>${esc(g.away)}</b></span>
        <span class="sn-when">${g.live ? '<span class="live-badge"><i></i>Live</span>' : esc(kickoff(g.kickoff))}${g.call ? '<span class="sn-called" title="We have a call on this one"><span class="visually-hidden">We have a call on this one</span></span>' : ''}</span>
      </a></li>`).join('')}</ul>`;
  } else {
    const c = countdownWords(r.days);
    if (c) {
      feature = `<div class="sn-gap">
        <div class="sn-count">${c.n !== null ? `<span class="sn-num">${PITCH}<b data-to="${c.n}">${c.n}</b></span>` : ''}<span>${esc(c.text)}</span></div>
        ${daysStrip(now, r.back, r.days)}
      </div>`;
    }
  }
  return `
    <div class="sn-scrim" data-season-close></div>
    <div class="sn-card" role="dialog" aria-modal="true" aria-labelledby="sn-title" tabindex="-1" data-kind="${esc(r.kind)}">
      <div class="sn-glow" aria-hidden="true"><div class="sn-sweep"></div></div>
      <button class="sn-x" type="button" data-season-close aria-label="Close"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
      <h2 class="sn-title" id="sn-title">${words(esc(w.title))}</h2>
      <p class="sn-lead">${esc(w.lead)}</p>
      ${feature}
      <div class="sn-text">${w.text.filter(Boolean).map((t) => `<p>${esc(t)}</p>`).join('')}</div>
      <div class="sn-actions">
        <a class="btn btn-primary" href="${w.cta.href}" data-season-go>${esc(w.cta.label)}</a>
        <button class="btn btn-ghost" type="button" data-season-close>Got it</button>
      </div>
    </div>`;
}

function chipHTML(r, esc) {
  const w = wordsFor(r);
  const tail = r.kind === 'tournament' ? `${r.count} games` : r.days > 1 ? `${r.days} days to go` : r.days === 1 ? 'back tomorrow' : '';
  return `<button class="sn-chip-open" type="button" aria-haspopup="dialog">
      <i class="sn-chip-dot" aria-hidden="true"></i><b>${esc(w.chip)}</b>${tail ? `<span>${esc(tail)}</span>` : ''}
    </button>
    <button class="sn-chip-x" type="button" aria-label="Hide this for now"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>`;
}

let current = null;
let helpersNow = null;
let stopAway = null;

const EXPO = 'cubic-bezier(0.16, 1, 0.3, 1)';
const QUART_IN = 'cubic-bezier(0.5, 0, 0.75, 0)';

/** Hidden for this visit from the chip's own cross. */
const HIDE_KEY = 'ow.season.chip';
const chipHidden = (key) => { try { return sessionStorage.getItem(HIDE_KEY) === key; } catch { return false; } };

/** The small reminder left behind once the note is closed: tap it and the note comes back. */
export function showChip(r, helpers) {
  const old = document.getElementById('season-chip');
  if (!r || chipHidden(r.key) || off()) { old?.remove(); return; }
  helpersNow = helpers;
  const el = old ?? document.createElement('div');
  el.id = 'season-chip';
  el.className = 'sn-chip';
  el.dataset.kind = r.kind;
  el.innerHTML = chipHTML(r, helpers.esc);
  el.querySelector('.sn-chip-open').onclick = () => openSeason(r, helpers, { fromChip: true });
  el.querySelector('.sn-chip-x').onclick = () => {
    try { sessionStorage.setItem(HIDE_KEY, r.key); } catch { /* private mode */ }
    if (reduced()) { el.remove(); return; }
    el.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(8px) scale(0.96)' }], { duration: 200, easing: QUART_IN, fill: 'forwards' })
      .finished.then(() => el.remove(), () => el.remove());
  };
  if (!old) {
    document.body.append(el);
    if (!reduced()) el.animate([{ opacity: 0, transform: 'translateY(12px) scale(0.9)' }, { opacity: 1, transform: 'none' }], { duration: 520, easing: EXPO });
  }
}

/** Take the note down. `keep` remembers it as seen and leaves the chip. */
export function closeSeason({ keep = false, quick = false } = {}) {
  const root = document.getElementById('season-note');
  const r = current;
  if (!root) return;
  if (keep && r) remember(r.key);
  current = null;
  stopAway?.();
  stopAway = null;
  removeEventListener('keydown', onKey, true);
  const after = () => {
    root.remove();
    if (keep && r && helpersNow) showChip(r, helpersNow);
  };
  if (quick || reduced()) { after(); return; }
  const card = root.querySelector('.sn-card');
  // It folds away towards the corner where the chip will be.
  card.style.transformOrigin = 'left bottom';
  card.animate([{ transform: 'none', opacity: 1 }, { transform: 'translate(-12%, 18%) scale(0.35)', opacity: 0 }], { duration: 380, easing: QUART_IN, fill: 'forwards' });
  root.querySelector('.sn-scrim').animate([{ opacity: 1 }, { opacity: 0 }], { duration: 360, delay: 60, easing: 'ease-in', fill: 'forwards' })
    .finished.then(after, after);
}
/** Kept for callers that only want it gone (another page). */
export function removeSeason() {
  closeSeason({ quick: true });
  document.getElementById('season-chip')?.remove();
}

function onKey(e) {
  const root = document.getElementById('season-note');
  if (!root) return;
  if (e.key === 'Escape') { e.preventDefault(); closeSeason({ keep: true }); return; }
  if (e.key !== 'Tab') return;
  const f = [...root.querySelectorAll('a[href], button')];
  if (!f.length) return;
  const first = f[0], last = f[f.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

/** Open the note, with its entrance. */
export function openSeason(r, helpers, { fromChip = false } = {}) {
  if (!r) return;
  helpersNow = helpers;
  document.getElementById('season-note')?.remove();
  const chip = document.getElementById('season-chip');
  current = r;
  const root = document.createElement('div');
  root.id = 'season-note';
  root.className = 'sn-root';
  root.innerHTML = cardHTML(r, { ...helpers, now: helpers.now ?? Date.now() / 1000 });
  document.body.append(root);
  addEventListener('keydown', onKey, true);
  root.addEventListener('click', (e) => {
    const t = e.target.closest?.('[data-season-close], [data-season-go], .sn-games a');
    if (t) closeSeason({ keep: true, quick: !t.hasAttribute('data-season-close') });
  });
  chip?.remove();
  const card = root.querySelector('.sn-card');
  card.focus({ preventScroll: true });
  // The page behind is never locked. Scrolling it means "not now": the note
  // folds into its chip and the page moves under the same gesture.
  stopAway?.();
  stopAway = scrollAway(card, () => closeSeason({ keep: true }));
  if (reduced()) return;

  const go = (el, frames, opts) => el?.animate(frames, { fill: 'both', ...opts });
  // The dark falls and the page behind goes soft.
  go(root.querySelector('.sn-scrim'), [{ opacity: 0, backdropFilter: 'blur(0px)' }, { opacity: 1, backdropFilter: 'blur(8px)' }], { duration: 520, easing: EXPO });
  // The card opens out of a slit (or out of the chip, when that is what was tapped).
  go(card, fromChip
    ? [{ transform: 'translate(-30%, 40%) scale(0.3)', opacity: 0 }, { opacity: 1, offset: 0.3 }, { transform: 'none', opacity: 1 }]
    : [{ transform: 'translateY(56px) scale(0.94) rotateX(10deg)', clipPath: 'inset(46% 8% 46% 8% round 20px)', opacity: 0 },
      { opacity: 1, offset: 0.25 },
      { transform: 'translateY(-4px) scale(1.005)', clipPath: 'inset(0% 0% 0% 0% round 20px)', offset: 0.7 },
      { transform: 'none', clipPath: 'inset(0% 0% 0% 0% round 20px)', opacity: 1 }],
    { duration: 900, delay: 100, easing: EXPO });
  // A floodlight sweeps across it once.
  go(root.querySelector('.sn-sweep'), [{ transform: 'translateX(-120%) skewX(-18deg)', opacity: 0 }, { opacity: 1, offset: 0.2 }, { transform: 'translateX(220%) skewX(-18deg)', opacity: 0 }], { duration: 1400, delay: 520, easing: 'cubic-bezier(0.65, 0, 0.35, 1)' });
  // The headline, a word at a time, up through its mask.
  const ws = root.querySelectorAll('.sn-w > span');
  ws.forEach((w, i) => go(w, [{ transform: 'translateY(105%) rotate(4deg)' }, { transform: 'none' }], { duration: 900, delay: 360 + i * 60, easing: EXPO }));
  const tail = 420 + ws.length * 60;
  // The reason, then everything under it.
  for (const [sel, extra] of [['.sn-lead', 0], ['.sn-gap, .sn-games', 120], ['.sn-text', 260], ['.sn-actions', 360]]) {
    go(root.querySelector(sel), [{ opacity: 0, transform: 'translateY(14px)', filter: 'blur(4px)' }, { opacity: 1, transform: 'none', filter: 'blur(0)' }], { duration: 800, delay: tail + extra, easing: EXPO });
  }
  // The halfway line and the centre circle draw themselves.
  root.querySelectorAll('.sn-line').forEach((l, i) => {
    const len = l.getTotalLength?.() ?? 220;
    l.style.strokeDasharray = String(len);
    go(l, [{ strokeDashoffset: len }, { strokeDashoffset: 0 }], { duration: 1100, delay: tail + 120 + i * 160, easing: EXPO });
  });
  // The count rolls up to its number.
  const b = root.querySelector('.sn-count b[data-to]');
  if (b) {
    const to = Number(b.dataset.to);
    const start = performance.now() + tail + 160;
    const tick = (t) => {
      if (!b.isConnected) return;
      const p = Math.min(1, Math.max(0, (t - start) / 900));
      b.textContent = String(Math.round(to * (1 - Math.pow(1 - p, 3))));
      if (p < 1) requestAnimationFrame(tick);
    };
    b.textContent = '0';
    requestAnimationFrame(tick);
  }
  // The days light up one by one to the day the club game is back, like
  // floodlights coming on down a stand.
  root.querySelectorAll('.sn-days li, .sn-games li').forEach((li, i) => {
    go(li, [{ opacity: 0, transform: 'translateY(6px) scale(0.9)' }, { opacity: 1, transform: 'none' }], { duration: 420, delay: tail + 240 + i * 55, easing: EXPO });
  });
  const back = root.querySelector('.sn-days .is-back');
  if (back) go(back, [{ boxShadow: '0 0 0 0 rgba(158, 134, 255, 0.7)' }, { boxShadow: '0 0 0 10px rgba(158, 134, 255, 0)' }], { duration: 1200, delay: tail + 300 + root.querySelectorAll('.sn-days li').length * 55, iterations: 2, easing: 'ease-out' });
}

/**
 * The note for this reading: opened when it has not been seen, the chip when
 * it has, an open one brought up to date in place.
 */
export function showSeason(r, helpers) {
  const open = document.getElementById('season-note');
  if (!r) { removeSeason(); return; }
  if (open && current?.key === r.key) return;
  if (open) { closeSeason({ quick: true }); }
  if (dismissed(r.key)) { showChip(r, helpers); return; }
  openSeason(r, helpers);
}

/** Whether now is a bad moment to open it: the reader is moving the page. */
export function readerMoving() {
  return moving();
}
