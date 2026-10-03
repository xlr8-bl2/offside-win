/**
 * offside.win — the front end.
 *
 * Everything here is fetched from /api/*, which serves finished JSON computed
 * ahead of time. This file renders; it works nothing out about football.
 *
 * The rule that shapes most of the code below: nothing user-facing describes how
 * the thing is built. No doctrine sections, no evidence states, no log loss, no
 * staking fractions. Factor ids become plain English or they do not appear. The
 * reasoning is the product and it ships in full; the machinery does not.
 */

import { describe as market, didItLand, recap } from './js/lib/markets.js';
import { COUNTRY_NAMES, bookName, cash, country, localPrice, purse } from './js/lib/books.js';
import { cleanProse } from './js/lib/vocabulary.js';
import { LEGAL, SUPPORT_EMAIL, TERMS_VERSION, UPDATED as TERMS_DATE, legalHTML } from './js/lib/legal.js';
import { mountPayment, openCheckout } from './js/lib/whop.js';
import { absenceReason } from './js/lib/absence.js';
import { enhanceSelects } from './js/lib/dropdown.js';
import { LANDING_FAQ, LANDING_GETS, LANDING_HEADLINE, LANDING_LEDE } from './js/lib/front.js';
import { themeArt, themeOf, wakeArt } from './js/lib/comptheme.js';
import { sweat } from './js/lib/sweat.js';
import * as attention from './js/lib/attention.js';
import { anchorClock, clockText, diffEvents, eachFixture, eventKey, fixtureIdOf, ingest, inPlayWindow, overlay, signature } from './js/lib/live.js';
import { TITLES, fullTitle, leagueTitle, matchTitle, slipTitle, todayTitle, ukDay } from './js/lib/titles.js';
import { accountRpc, authHeaders, completeSignIn, currentUser, renderGoogleButton, setViewAs, warmSignIn, googleRedirectReady, prepareGoogleRedirect, signInWithGoogleRedirect, isGoogleReturn, signInWithEmail, signInWithGoogle, signOut, siteConfig, viewingAsFree, hasStoredSession } from './js/lib/auth.js';

const app = document.getElementById('app');

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = (v, dp = 0) => (typeof v === 'number' && isFinite(v) ? `${(v * 100).toFixed(dp)}%` : '—');
const dec = (v) => (typeof v === 'number' && isFinite(v) ? v.toFixed(2) : '—');
/*
 * Odds, said as odds. The owner's rule: when mentioning odds, say the specific
 * number and attach the word odds to it. A bare "at 1.29" reads as a price tag
 * or a kick-off time; every price on the site goes through one of these two.
 */
/*
 * Odds in the reader's own format: decimal (2.50), fractional (6/4) or
 * American (+150), set on the account page. Decimal is what the books send
 * and what the written analysis quotes, so `dec` stays the raw form for
 * anything that has to match the prose; `showOdds` is only for display.
 */
const ODDS_KEY = 'ow.odds';
let oddsFormat = (() => { try { return localStorage.getItem(ODDS_KEY) || 'decimal'; } catch { return 'decimal'; } })();
function setOddsFormat(f) {
  oddsFormat = ['fractional', 'american'].includes(f) ? f : 'decimal';
  try { if (oddsFormat === 'decimal') localStorage.removeItem(ODDS_KEY); else localStorage.setItem(ODDS_KEY, oddsFormat); } catch { /* private mode */ }
}
// The fractions a UK bookmaker actually prints, nearest one wins.
const FRACTIONS = ['1/20', '1/16', '1/12', '1/10', '1/8', '1/7', '1/6', '1/5', '2/9', '1/4', '2/7', '3/10', '1/3', '4/11',
  '2/5', '4/9', '1/2', '8/15', '4/7', '8/13', '4/6', '8/11', '4/5', '5/6', '10/11', '1/1', '11/10', '6/5', '5/4', '11/8',
  '6/4', '13/8', '7/4', '15/8', '2/1', '9/4', '5/2', '11/4', '3/1', '10/3', '7/2', '4/1', '9/2', '5/1', '11/2', '6/1',
  '13/2', '7/1', '15/2', '8/1', '9/1', '10/1', '11/1', '12/1', '14/1', '16/1', '20/1', '25/1', '33/1', '40/1', '50/1', '66/1', '100/1']
  .map((f) => { const [a, b] = f.split('/').map(Number); return [f, a / b]; });
function showOdds(v) {
  if (typeof v !== 'number' || !isFinite(v) || v <= 1 || oddsFormat === 'decimal') return dec(v);
  if (oddsFormat === 'american') return v >= 2 ? `+${Math.round((v - 1) * 100)}` : `−${Math.round(100 / (v - 1))}`;
  const [f] = FRACTIONS.reduce((best, c) => (Math.abs(c[1] - (v - 1)) < Math.abs(best[1] - (v - 1)) ? c : best));
  return f === '1/1' ? 'evens' : f;
}
const oddsOf = (v) => (showOdds(v) === 'evens' ? 'evens' : `odds of ${showOdds(v)}`);

/*
 * The clock kick-off times are written in: 24-hour ("20:45", the default, the
 * way a fixture list is printed) or 12-hour ("8:45pm"). A reader's own
 * setting, kept on the account and mirrored here so the page draws right
 * before the account has loaded.
 */
const CLOCK_KEY = 'ow.clock';
let clockFormat = (() => { try { return localStorage.getItem(CLOCK_KEY) === '12' ? '12' : '24'; } catch { return '24'; } })();
function setClock(c) {
  clockFormat = c === '12' ? '12' : '24';
  try { if (clockFormat === '24') localStorage.removeItem(CLOCK_KEY); else localStorage.setItem(CLOCK_KEY, '12'); } catch { /* private mode */ }
}
function clockTime(d) {
  if (clockFormat === '12') {
    const h = d.getHours(); const m = String(d.getMinutes()).padStart(2, '0');
    return `${h % 12 || 12}:${m}${h < 12 ? 'am' : 'pm'}`;
  }
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
}
const oddsTag = (v) => (showOdds(v) === 'evens' ? 'evens' : `${showOdds(v)} odds`);

/**
 * Every read goes through here, which is why the token goes on here.
 *
 * authHeaders() returns an empty object for a signed-out reader without
 * loading anything, so this costs nothing on the page most people see. It also
 * never throws: a failure to attach a token produces an anonymous request,
 * which is a page that loads rather than a page that does not.
 */
/*
 * The last copy of every read, so a page opens on what the reader saw last
 * time rather than on "Loading…".
 *
 * Stale-while-revalidate, by hand. A copy younger than half a minute is
 * served as it is. An older one (up to a day) is served at once and fetched
 * again behind it; when the fresh copy differs, the page redraws in place,
 * at the same scroll position (see softRefresh). A cold cache is the only
 * time a reader waits on the network, and then they see a skeleton of the
 * page rather than a word.
 *
 * Keyed by whether the request carried a token, so a member's copy is never
 * handed to the signed-out view of the same browser and the other way
 * round. Stored in localStorage as well as memory so the second visit is as
 * quick as the second page; every access is wrapped, because private modes
 * throw on it and the site has to work without it.
 */
const CACHEABLE = /^\/api\/(board|hero|picks|slip|plans|fixture\/|league\/|player\/|health)/;
const FRESH_MS = 30_000;
const KEEP_MS = 24 * 3600_000;
const memo = new Map();
const cacheKey = (scope, path) => `ow.c1:${scope}:${path}`;
function cacheRead(key) {
  if (memo.has(key)) return memo.get(key);
  if (!canSave()) return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const hit = JSON.parse(raw);
    memo.set(key, hit);
    return hit;
  } catch { return null; }
}
function cacheWrite(key, text) {
  const hit = { at: Date.now(), text };
  memo.set(key, hit);
  // On the device only with the reader's yes; in memory for this visit either way.
  if (!canSave()) return;
  try { localStorage.setItem(key, JSON.stringify(hit)); }
  catch {
    // Full. Drop every stored copy and try once more; a cache is disposable.
    try {
      for (const k of Object.keys(localStorage)) if (k.startsWith('ow.c1:')) localStorage.removeItem(k);
      localStorage.setItem(key, JSON.stringify(hit));
    } catch { /* memory only, then */ }
  }
}
/** Forget every cached read: on sign-out, and the stored copies on a no. */
function cacheClear({ keepMemory = false } = {}) {
  if (!keepMemory) memo.clear();
  try { for (const k of Object.keys(localStorage)) if (k.startsWith('ow.c1:')) localStorage.removeItem(k); } catch { /* nothing to clear */ }
}

async function fetchText(path, headers) {
  // A signed-in read never takes a preloaded (anonymous) response: Chrome
  // matches a preload on the address and credentials mode, not the headers,
  // and the token is a header. We use no cookies, so omitting them is free.
  const res = await fetch(path, headers.authorization ? { headers, credentials: 'omit' } : { headers });
  const text = await res.text();
  if (!res.ok) {
    let msg = 'Something went wrong loading this.';
    try { msg = JSON.parse(text).error ?? msg; } catch { /* body was not json */ }
    throw new Error(msg);
  }
  return text;
}

/*
 * One request per address at a time. A prefetch that is still on its way when
 * the reader taps is joined, not repeated, so the tap is served the moment the
 * prefetch lands.
 */
const inflight = new Map();
function fetchOnce(key, path, headers) {
  if (inflight.has(key)) return inflight.get(key);
  const p = fetchText(path, headers).finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

async function getJSON(path, { fresh = false, quiet = false } = {}) {
  const headers = await authHeaders();
  if (!CACHEABLE.test(path)) return withLive(JSON.parse(await fetchText(path, headers)));

  const key = cacheKey(headers.authorization ? 'auth' : 'anon', path);
  const hit = fresh ? null : cacheRead(key);
  const age = hit ? Date.now() - hit.at : Infinity;
  if (hit && age < FRESH_MS) return withLive(JSON.parse(hit.text));
  if (hit && age < KEEP_MS) {
    // Serve the old copy now; fetch the new one behind it. A prefetch for
    // another page never redraws this one.
    fetchOnce(key, path, headers).then((text) => {
      cacheWrite(key, text);
      if (text !== hit.text && !quiet) softRefresh();
    }).catch(() => { /* the old copy stays up */ });
    return withLive(JSON.parse(hit.text));
  }
  const text = await fetchOnce(key, path, headers);
  cacheWrite(key, text);
  return withLive(JSON.parse(text));
}

/*
 * Reading ahead.
 *
 * A page change used to start its reads when the new page began to draw, so
 * every tap waited on the network. Now the reads start earlier: the main
 * pages' data is fetched as soon as the browser is idle after the first page,
 * a page's data is fetched the moment a finger lands on (or a pointer rests
 * on) a link to it, and the matches in view on a list are read ahead too. By
 * the time the tap completes, the page is usually already in memory and
 * draws at once. Nothing here is shown; it only fills the cache that getJSON
 * reads.
 */
function apiReadsFor(hash) {
  const raw = String(hash || '').replace(/^[^#]*#?\/?/, '');
  const cut = raw.indexOf('?');
  const parts = (cut === -1 ? raw : raw.slice(0, cut)).split('/').filter(Boolean);
  const q = new URLSearchParams(cut === -1 ? '' : raw.slice(cut + 1));
  const hours = [24, 48, 72, 120, 240].includes(Number(q.get('hours'))) ? Number(q.get('hours')) : 72;
  const id = parts[1] && /^\d+$/.test(parts[1]) ? parts[1] : null;
  switch (parts[0] || 'home') {
    case 'home': return ['/api/board?hours=72', '/api/hero', '/api/picks?limit=40&settled=true', '/api/slip'];
    case 'board': return [`/api/board?hours=${hours}`];
    case 'leagues': return ['/api/board?hours=72'];
    case 'league': return id ? [`/api/league/${id}`] : [];
    case 'fixture': return id ? [`/api/fixture/${id}`] : [];
    case 'results': return ['/api/picks?limit=120&settled=true', '/api/picks?limit=20&settled=false'];
    case 'slip': return ['/api/slip'];
    case 'how-sure': return ['/api/how-sure'];
    case 'pricing': return ['/api/plans', '/api/hero'];
    default: return [];
  }
}
const warmed = new Map();
function warm(hash) {
  if (navigator.connection?.saveData) return;
  for (const path of apiReadsFor(hash)) {
    // Once a minute per address is plenty: getJSON keeps it fresh after that.
    if (Date.now() - (warmed.get(path) ?? 0) < 60_000) continue;
    warmed.set(path, Date.now());
    getJSON(path, { quiet: true }).catch(() => { warmed.delete(path); });
  }
}
const linkHash = (a) => a.dataset?.hash ?? a.getAttribute('href');
document.addEventListener('pointerdown', (e) => {
  const a = e.target.closest?.('a[href^="#/"], a[data-hash]');
  if (a) warm(linkHash(a));
}, { passive: true, capture: true });
let hoverTimer = null;
document.addEventListener('pointerover', (e) => {
  if (e.pointerType !== 'mouse') return;
  const a = e.target.closest?.('a[href^="#/"], a[data-hash]');
  clearTimeout(hoverTimer);
  if (a) hoverTimer = setTimeout(() => warm(linkHash(a)), 70);
}, { passive: true });
document.addEventListener('focusin', (e) => {
  const a = e.target.closest?.('a[href^="#/"], a[data-hash]');
  if (a) warm(linkHash(a));
});
const whenIdle = (fn) => (window.requestIdleCallback ? requestIdleCallback(fn, { timeout: 2500 }) : setTimeout(fn, 600));
let warmedMain = false;
/** After a page has drawn: the main pages, then the matches in view. */
function readAhead() {
  whenIdle(() => {
    if (!warmedMain) {
      warmedMain = true;
      for (const h of ['#/home', '#/board', '#/results', '#/slip', '#/leagues']) warm(h);
    }
    const inView = [...app.querySelectorAll('a[href^="#/fixture/"], a[data-hash^="#/fixture/"], a[href^="#/league/"], a[data-hash^="#/league/"]')]
      .filter((a) => { const r = a.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight * 1.5; })
      .slice(0, 8);
    for (const a of inView) warm(linkHash(a));
  });
}

/*
 * Live: scores, minutes, postponements and moved kick-offs, thirty seconds
 * old at most.
 *
 * Everything above is what the slate wrote, which is up to fifteen minutes
 * behind a match in play. /api/live is the Worker asking the provider
 * directly (worker/src/live.ts), and every read above passes through
 * withLive() on its way to a view, so the board, the front page, the results
 * and the match page all show the same minute without any of them knowing
 * where it came from. The rules are in js/lib/live.js.
 *
 * It only polls while the page on screen has a match being played or about
 * to be; otherwise it looks every five minutes, for fixture changes. A goal,
 * a whistle or a postponement redraws the page where it stands; a minute
 * ticking over is patched in place.
 */
const LIVE_EVERY = 30_000;
const QUIET_EVERY = 5 * 60_000;
const live = {
  enabled: true,
  byId: new Map(),
  changes: new Map(),
  fetchedAt: 0,
  /** Fixture ids on the page now, and whether any is in play. */
  seen: new Set(),
  watching: false,
  /** The match page's fixture, whose timeline and numbers are polled too. */
  focus: null,
  detail: new Map(),
  busy: false,
  /** Each match's clock, ticking between polls (js/lib/live.js, anchorClock). */
  clock: new Map(),
  /** Events waiting to be played on the page once it has redrawn. */
  flash: [],
  /** Timeline events already on screen, per match, so a new one can be marked. */
  evSeen: new Map(),
};

function withLive(data) {
  const now = Date.now() / 1000;
  eachFixture(data, (f) => {
    overlay(f, live);
    live.seen.add(fixtureIdOf(f));
    if (inPlayWindow(f, now)) live.watching = true;
  });
  return data;
}

/**
 * The clock beside a match in play: minutes and seconds, ticking every second
 * (tickClocks) from the provider's last minute, so a live page never sits
 * still between polls. Without the live feed it is the slate's minute, as
 * before.
 */
function minuteHTML(f) {
  const id = fixtureIdOf(f);
  const a = live.clock.get(id);
  if (!a && f?.live_minute == null) return '';
  return `<span class="minute${a ? ' ticking' : ''}" data-lm="${esc(id)}">${esc(a ? clockText(a) : `${f.live_minute}'`)}</span>`;
}

function tickClocks() {
  if (document.hidden) return;
  const now = Date.now();
  for (const el of document.querySelectorAll('[data-lm]')) {
    const a = live.clock.get(Number(el.dataset.lm));
    if (!a) continue;
    const t = clockText(a, now);
    if (el.textContent !== t) el.textContent = t;
    if (!el.classList.contains('ticking')) el.classList.add('ticking');
  }
}

/*
 * Something happened: play it where it is on the page. The score that changed
 * pops, the row or the match header flashes, a whistle pulses the badge. Run
 * once the page has redrawn with the new score, and then forgotten, so a
 * later redraw does not play it again.
 */
function restartClass(el, cls) {
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
  const done = (ev) => { if (ev.target === el) { el.classList.remove(cls); el.removeEventListener('animationend', done); } };
  el.addEventListener('animationend', done);
}

function playFlashes() {
  if (!live.flash.length) return;
  const now = Date.now();
  const due = live.flash.filter((e) => now - e.at < 15000);
  live.flash = [];
  for (const e of due) {
    // Links are rewritten to real addresses after drawing (crawlable), and
    // keep the route in data-hash; either form finds the match.
    const h = `#/fixture/${e.id}`;
    const sel = `a.row[href="${h}"], a.row[data-hash="${h}"], a.side-item[href="${h}"], a.side-item[data-hash="${h}"], [data-fx="${e.id}"]`;
    for (const el of document.querySelectorAll(sel)) {
      restartClass(el, e.kind === 'goal' ? 'flash-goal' : e.kind === 'disallowed' ? 'flash-var' : 'flash-whistle');
      if (e.kind === 'goal') {
        const nums = el.querySelectorAll('.row-goals, .gf');
        const num = nums.length === 2 ? nums[e.side === 'away' ? 1 : 0] : el.querySelector('[data-score]');
        if (num) restartClass(num, 'goal-pop');
      } else {
        const badge = el.querySelector('.live-badge');
        if (badge) restartClass(badge, 'badge-pop');
      }
    }
  }
}

/*
 * The alert for a moment worth interrupting for: a goal, a goal ruled out, a
 * red card, half and full time. Only for matches a reader has a reason to
 * care about (one we have a call on, their club, the match they have open),
 * one at a time, five seconds each, and a tap goes to the match. Announced
 * politely to screen readers.
 */
const toasts = [];
let toastOn = false;
function announceable(id) {
  if (Number(state.liveFixture?.id) === id) return true;
  const f = (state.board?.fixtures ?? []).find((x) => Number(x.id) === id);
  const club = myClubId();
  return Boolean(f && (hasCall(f) || (club && (Number(f.home_id) === club || Number(f.away_id) === club))));
}
function toast(e) {
  if (document.hidden || !announceable(e.id)) return;
  const f = (state.board?.fixtures ?? []).find((x) => Number(x.id) === e.id) ?? state.liveFixture;
  const home = f?.home ?? e.m?.home ?? 'Home';
  const away = f?.away ?? e.m?.away ?? 'Away';
  const sc = Array.isArray(e.score) ? e.score : null;
  const line = sc
    ? `${e.kind === 'goal' && e.side === 'home' ? `<b>${esc(home)}</b>` : esc(home)} ${sc[0]}–${sc[1]} ${e.kind === 'goal' && e.side === 'away' ? `<b>${esc(away)}</b>` : esc(away)}`
    : `${esc(home)} v ${esc(away)}`;
  const kind = { goal: 'Goal', disallowed: 'Goal ruled out', halftime: 'Half time', fulltime: 'Full time', red: 'Red card' }[e.kind];
  if (!kind) return;
  const icon = e.kind === 'goal' ? EV_ICON.goal : e.kind === 'red' ? EV_ICON.red : '<i class="toast-whistle" aria-hidden="true"></i>';
  const minute = e.kind === 'goal' || e.kind === 'red' ? (live.clock.get(e.id) ? clockText(live.clock.get(e.id)).split(':')[0] : e.minute) : null;
  toasts.push({
    id: e.id,
    html: `${icon}<span class="toast-kind">${kind}${minute ? ` <em>${esc(minute)}'</em>` : ''}</span>
      <span class="toast-line">${e.kind === 'red' && e.player ? `${esc(e.player)}, ${esc(e.side === 'away' ? away : home)}` : line}</span>`,
    kind: e.kind,
  });
  while (toasts.length > 3) toasts.shift();
  if (!toastOn) nextToast();
}
function nextToast() {
  const t = toasts.shift();
  if (!t) { toastOn = false; return; }
  toastOn = true;
  let rack = document.getElementById('toast-rack');
  if (!rack) {
    rack = document.createElement('div');
    rack.id = 'toast-rack';
    rack.className = 'toast-rack';
    rack.setAttribute('aria-live', 'polite');
    document.body.appendChild(rack);
  }
  const a = document.createElement('a');
  a.className = `live-toast is-${t.kind}`;
  a.href = `#/fixture/${t.id}`;
  a.innerHTML = t.html;
  rack.replaceChildren(a);
  setTimeout(() => {
    a.classList.add('out');
    setTimeout(() => { a.remove(); nextToast(); }, 260);
  }, 5000);
}

/*
 * The open match's timeline: a goal, card or change that was not on screen
 * last time slides in and glows, and a red card gets the alert.
 */
function markLiveEvents(id, box) {
  const events = live.detail.get(id)?.body?.report?.events;
  // Nothing loaded yet: no first view to compare against.
  if (!events) return;
  const keys = new Set(events.map(eventKey));
  const seen = live.evSeen.get(id);
  live.evSeen.set(id, keys);
  // The first view of this match's timeline: everything on it is old news.
  if (!seen) return;
  for (const e of events) {
    if (e.t === 'card' && (e.card === 'red' || e.card === 'second_yellow') && !seen.has(eventKey(e))) {
      toast({ id, kind: 'red', player: e.player, side: e.side, minute: e.minute });
    }
  }
  if (box) for (const el of box.querySelectorAll('[data-ev]')) if (!seen.has(el.dataset.ev)) restartClass(el, 'ev-new');
}

async function liveTick({ force = false } = {}) {
  if (!live.enabled || document.hidden || live.busy) return;
  const now = Date.now();
  const listDue = force || now - live.fetchedAt >= (live.watching ? LIVE_EVERY : QUIET_EVERY) - 1000;
  const focus = live.focus;
  const had = focus ? live.detail.get(focus) : null;
  // The open match's timeline is read with the scores, so a goal and its
  // scorer arrive together.
  const detailDue = focus && (!had || listDue || now - had.at >= LIVE_EVERY - 1000);
  if (!listDue && !detailDue) return;
  live.busy = true;
  let redraw = false;
  try {
    if (listDue) {
      const before = new Map([...live.seen].map((id) => [id, signature(id, live)]));
      const body = await fetch('/api/live').then((r) => (r.ok ? r.json() : null));
      live.fetchedAt = Date.now();
      if (body && body.enabled === false) { live.enabled = false; return; }
      if (body) {
        const prevById = live.byId;
        Object.assign(live, ingest(body, live.byId));
        const now = Date.now();
        for (const [id, m] of live.byId) {
          const a = anchorClock(live.clock.get(id) ?? null, m.minute, m.status, now);
          if (a) live.clock.set(id, a); else live.clock.delete(id);
        }
        for (const e of diffEvents(prevById, live.byId)) {
          if (!live.seen.has(e.id)) continue;
          live.flash.push({ ...e, at: now });
          toast(e);
        }
        for (const [id, sig] of before) if (signature(id, live) !== sig) redraw = true;
        // Views that keep a read between routes get the new state too.
        for (const o of [state.board, state.hero, state.heroDetail]) if (o) withLive(o);
        paintNavLive(state.board);
      }
    }
    if (detailDue && live.focus === focus) {
      const res = await fetch(`/api/live/${encodeURIComponent(focus)}`);
      const text = res.ok ? await res.text() : null;
      if (text && text !== had?.text) {
        live.detail.set(focus, { at: Date.now(), text, body: JSON.parse(text) });
        if (!patchLiveCentre(focus)) { markLiveEvents(focus, null); redraw = true; }
      } else if (had) had.at = Date.now();
    }
  } catch { /* the last good frame stays up */ } finally {
    live.busy = false;
  }
  if (redraw) softRefresh();
  else { tickClocks(); playFlashes(); }
}

/*
 * Redraw the current page with the data that has just arrived, without
 * moving the reader. Debounced, because a page's reads come back one after
 * another. Only on the pages that are pure reads: a form half filled in is
 * not something to redraw under somebody.
 */
const SOFT_ROUTES = new Set(['home', 'board', 'fixture', 'league', 'leagues', 'results', 'slip', 'player']);
let softTimer = null;
function softRefresh() {
  clearTimeout(softTimer);
  softTimer = setTimeout(() => {
    const name = parseHash().parts[0] || 'home';
    if (!SOFT_ROUTES.has(name) || document.hidden) return;
    route({ soft: true });
  }, 250);
}

function kickoffLabel(epoch) {
  if (!epoch) return '';
  const d = new Date(epoch * 1000);
  const now = new Date();
  const time = clockTime(d);
  if (d.toDateString() === now.toDateString()) return `Today ${time}`;
  if (new Date(now.getTime() + 864e5).toDateString() === d.toDateString()) return `Tomorrow ${time}`;
  return `${d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })} ${time}`;
}
// Kick-off is within six hours and has not happened yet. The second half of
// that was missing, so every match already played counted as "soon" -- a
// game from last Tuesday wore the same urgent chip as one kicking off at
// eight tonight.
const isSoon = (epoch) => {
  if (!epoch) return false;
  const ms = epoch * 1000 - Date.now();
  return ms > 0 && ms < 6 * 3600e3;
};

/**
 * What state a match is actually in.
 *
 * The board runs from six hours ago so that today's games stay on it, which
 * means a third of it has already kicked off and a chunk of it has finished —
 * and every one of them was rendered as though it were still to come, with a
 * kick-off time and nothing else. A hundred and seventy-seven matches on a
 * three-hundred-match board were lying about their state.
 *
 * The provider's status is authoritative where it has one. Where it says
 * `notstarted` about a game that kicked off ninety minutes ago — which happens,
 * because the feed lags — the clock is trusted over the flag, but only far
 * enough to stop claiming the match is upcoming.
 */
const LIVE_STATES = new Set(['1st_half', '2nd_half', 'extra_time', 'penalties', 'live', 'inprogress']);
const OFF_LABEL = { postponed: 'Postponed', cancelled: 'Cancelled', canceled: 'Cancelled', abandoned: 'Abandoned', suspended: 'Suspended' };
// Of those, the ones a bookmaker settles as void. A suspended match may yet
// be finished.
const VOIDED = new Set(['postponed', 'cancelled', 'canceled', 'abandoned']);

function matchState(f) {
  const status = String(f?.status ?? '').toLowerCase();
  if (status === 'finished' || status === 'ended' || status === 'aet' || status === 'ap') {
    return { kind: 'ft', label: 'Full time', short: 'FT' };
  }
  if (status === 'halftime' || status === 'ht') {
    return { kind: 'live', label: 'Half time', short: 'HT' };
  }
  if (LIVE_STATES.has(status)) return { kind: 'live', label: 'Live', short: 'LIVE' };
  // Called off, or stopped. Said in full: "OFF" beside a kick-off time does
  // not tell a reader whether the game is on another day or not at all.
  if (OFF_LABEL[status]) return { kind: 'off', label: OFF_LABEL[status], short: OFF_LABEL[status] };
  const since = f?.kickoff ? Date.now() / 1000 - f.kickoff : -1;
  /*
   * The feed says not started and the clock disagrees.
   *
   * Inside a few hours that means the match is on and the status has not
   * caught up, so it reads as under way. Past that it means the card is stale
   * -- the board reaches a day back and the slate only rewrites the last six
   * hours -- and no football match lasts three hours. Without the second case
   * a game that finished yesterday afternoon sat on the board flashing LIVE
   * indefinitely, which is the most confident a page can be while being
   * completely wrong.
   */
  if (since > 3 * 3600) return { kind: 'ft', label: 'Full time', short: 'FT' };
  if (since > 0) return { kind: 'live', label: 'Under way', short: 'LIVE' };
  return { kind: 'upcoming', label: '', short: '' };
}

/** The red dot and the word, for anything that is happening now. */
function liveBadge(state) {
  if (state.kind === 'upcoming') return '';
  const cls = state.kind === 'live' ? 'live-badge' : 'live-badge done';
  return `<span class="${cls}">${state.kind === 'live' ? '<i></i>' : ''}${esc(state.short)}</span>`;
}

const MINOR = new Set(['the', 'of', 'a', 'an', 'and', 'in', 'on', 'at', 'de', 'del', 'da', 'do']);

function unshout(text) {
  const t = String(text ?? '').trim();
  if (!t || t !== t.toUpperCase() || !/[A-Z]{4}/.test(t)) return t;
  // Title case rather than sentence case: these are names. Flattening
  // "THE MADRID DERBY" to "The madrid derby" trades one wrong reading for
  // another, and a proper noun in lower case looks like a typo.
  return t.toLowerCase().replace(/[^\s-]+/g, (w, i) => (
    i > 0 && MINOR.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)
  ));
}

// ---------------------------------------------------------- team identity

const IMG_BASE = 'https://sports.bzzoiro.com/img';
const PALETTE = [
  ['#1e3a8a', '#3b82f6'], ['#7f1d1d', '#ef4444'], ['#14532d', '#22c55e'],
  ['#3b0764', '#a855f7'], ['#7c2d12', '#f97316'], ['#134e4a', '#14b8a6'],
  ['#1e1b4b', '#6366f1'], ['#831843', '#ec4899'], ['#365314', '#84cc16'],
  ['#422006', '#d4a574'], ['#0c4a6e', '#0ea5e9'], ['#4c0519', '#f43f5e'],
];

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return Math.abs(h);
}

function initials(name) {
  const skip = /^(fc|afc|ac|as|sv|sc|cf|cd|ud|rc|us|ss|ssc|bk|if|ik|fk|nk|hk|gks|kv|rkc|vfl|vfb|tsg|tsv|spvgg|1|de|do|la|le|el|al|club|the)$/i;
  const words = String(name || '').replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
  const core = words.filter((w) => !skip.test(w));
  return ((core.length ? core : words).slice(0, 3).map((w) => w[0].toUpperCase()).join('')) || '?';
}

/** Real crest where the provider has one; a generated monogram when it does not. */
function crest(name, size = 'md', id = null, type = 'team') {
  const [dark, light] = PALETTE[hash(String(name || '')) % PALETTE.length];
  const text = initials(name);
  const vars = `--c1:${dark};--c2:${light};${text.length >= 3 ? 'font-size:0.72em' : ''}`;
  if (id === null || id === undefined || !Number.isFinite(Number(id))) {
    return `<span class="crest crest-${size} noimg" style="${vars}" aria-hidden="true"><i>${esc(text)}</i></span>`;
  }
  return `<span class="crest crest-${size}${type === 'player' ? ' crest-player' : type === 'league' ? ' crest-league' : ''}" style="${vars}" aria-hidden="true"
    ><img src="${IMG_BASE}/${esc(type)}/${encodeURIComponent(id)}/" alt="" loading="lazy" decoding="async"
      onerror="this.closest('.crest').classList.add('noimg');this.remove()"
    ><i>${esc(text)}</i></span>`;
}



/**
 * Factor ids to plain English. Anything not listed here is not shown — an id
 * like `style.opponent_adjustment` is a note to ourselves, not a heading for a
 * reader, and a page that leaks them reads like a debug view.
 */
/*
 * What a factor is called when a reader sees it.
 *
 * An id that is not in here never reaches the page. That is the point of the
 * map: the ledger carries everything the engine weighed, including several
 * things that exist only so the engine can weigh them, and the page is not a
 * dump of the ledger.
 *
 * `availability.rotation_risk` used to be in here as "Selection" and printed
 * "Lineup is predicted rather than confirmed, at 65% confidence" -- three
 * pieces of private vocabulary in one sentence, about a fact the page already
 * states as "line-ups not final". Gone.
 */
/** The board's three states, in the order a matchday happens in. */
const WHEN = [
  { id: 'upcoming', label: 'To play' },
  { id: 'live', label: 'Live' },
  { id: 'played', label: 'Played' },
];

const READ_LABEL = {
  'availability.home.absences': 'Team news',
  'availability.away.absences': 'Team news',
  'availability.home.full_strength': 'Squad',
  'availability.away.full_strength': 'Squad',
  'availability.lineup_confirmed': 'Line-ups',
  'stakes.season': "What's at stake",
  'stakes.table': "What's at stake",
  'fixture.derby': 'Derby',
  'fixture.revenge': 'The reverse fixture',
  'manager.home.bounce': 'New manager',
  'manager.away.bounce': 'New manager',
  'manager.home.established': 'In the dugout',
  'manager.away.established': 'In the dugout',
  'manager.home.settling': 'In the dugout',
  'manager.away.settling': 'In the dugout',
  'manager.home.settled': 'In the dugout',
  'manager.away.settled': 'In the dugout',
  'fatigue.home': 'Rest and schedule',
  'fatigue.away': 'Rest and schedule',
  'fatigue.travel': 'Travel',
  'style.matchup': 'How they match up',
  'style.finishing.home': 'Finishing',
  'style.finishing.away': 'Finishing',
  'environment.weather': 'Conditions',
  'environment.pitch': 'The pitch',
  'referee.tendency': 'The referee',
  'market.movement': 'How the price has moved',
  'market.sharp_reference': 'Where the sharp money is',
  'market.overround': 'The margin',
};

// ------------------------------------------------------------------ state

const state = {
  board: null, hours: 72, leagueName: '', heroVenue: [], hero: null,
  user: null, account: null, authError: null, tick: null, poll: null, onVisible: null,
  /*
   * The board opens on the games we have a call on.
   *
   * Forty-four per cent of it has no call, and by kick-off order that meant the
   * first four rows of the product all read "No call — the price looks about
   * right to us." That is an honest sentence and a terrible opening: a reader
   * arriving on the picks page should land on picks. Everything is one tap
   * away and the count is stated, so nothing is hidden by it.
   */
  show: 'calls',
  /*
   * Which part of the board: still to play, being played, already played.
   * Kept out of `show` because they are different questions -- a reader can
   * want every finished game, or only the finished ones we called.
   */
  when: 'upcoming',
  /*
   * Whether the reader got here by navigating inside the app, rather than by
   * landing on a deep link. It is what a Back button needs and what
   * `history.length` cannot tell you: a tab that has been anywhere at all has
   * a history length above one, so Back walked people off the site.
   */
  cameFromInApp: false,
  /*
   * Whether the signed-in reader has a live membership. null means not asked
   * yet -- which is different from false, and the difference is what stops the
   * header claiming the free tier before it knows.
   */
  member: null,
};

/**
 * The hash, split into a path and a query.
 *
 * `location.hash.slice(2).split('/')` was fine while every route was a bare
 * path, and wrong the moment one carried state: `#/board?league=La%20Liga`
 * came back as a single part named `board?league=La%20Liga`, so the router
 * fell through to home. Splitting the query off first is the whole fix.
 */
/*
 * Real addresses.
 *
 * Every page lives after a `#`, which a search engine reads as one page. The
 * Worker (worker/src/seo.ts) serves real addresses for the pages worth
 * finding -- /match/<id>/<teams>, /league/<id>/<name>, /today, /results,
 * /leagues, /pricing -- and the app reads them as the matching route. Links
 * are drawn with those addresses too (see crawlable()), so a crawler reading
 * the rendered page can follow them, and a tap still moves within the app.
 */
function pathRoute(pathname = location.pathname) {
  let m = pathname.match(/^\/match\/(\d+)/);
  if (m) return `/fixture/${m[1]}`;
  m = pathname.match(/^\/league\/(\d+)/);
  if (m) return `/league/${m[1]}`;
  const p = pathname.replace(/\/+$/, '');
  // The pages written by the Worker (worker/src/landing.ts), shown as written.
  if (/^\/(?:tomorrow|weekend|free-prediction|predictions(?:\/[a-z0-9-]+)?|team\/\d+(?:\/[^/]*)?)$/.test(p)) return `/page${p}`;
  if (p === '/search') return `/search${location.pathname === '/search' ? location.search : ''}`;
  return {
    '/today': '/board', '/results': '/results', '/leagues': '/leagues', '/pricing': '/pricing', '/slip': '/slip',
    '/cookies': '/legal/cookies', '/refunds': '/legal/refunds', '/contact': '/legal/contact', '/responsible-gambling': '/legal/responsible',
  }[p] ?? null;
}
const slugOf = (s) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
function hashPath(hash) {
  let m = hash.match(/^#\/fixture\/(\d+)$/);
  if (m) return `/match/${m[1]}`;
  m = hash.match(/^#\/league\/(\d+)$/);
  if (m) return `/league/${m[1]}`;
  if (/^#\/page\/[a-z0-9/-]+$/.test(hash)) return hash.slice('#/page'.length);
  return {
    '#/board': '/today', '#/results': '/results', '#/leagues': '/leagues', '#/pricing': '/pricing', '#/slip': '/slip', '#/home': '/',
    '#/search': '/search', '#/legal/cookies': '/cookies', '#/legal/refunds': '/refunds', '#/legal/contact': '/contact', '#/legal/responsible': '/responsible-gambling',
  }[hash] ?? null;
}

/*
 * The other way: a link written as a real address (the Worker's pages are
 * nothing but) moves within the app on a tap, like every other link, rather
 * than loading the whole site again.
 */
function appLinks(root = document) {
  for (const a of root.querySelectorAll('a[href^="/"]:not([data-hash])')) {
    const href = a.getAttribute('href');
    if (href.startsWith('//') || /^\/(api|og|fonts)\//.test(href) || /\.(xml|txt|json|png|svg)$/.test(href)) continue;
    const url = new URL(href, location.origin);
    if (url.pathname === '/') { a.dataset.hash = '#/home'; continue; }
    if (url.pathname === '/search') continue;
    const r = pathRoute(url.pathname);
    if (r) a.dataset.hash = `#${r}`;
  }
}
/*
 * The tab's title, per page, from the same functions the Worker uses for a
 * search engine (js/lib/titles.js). Google renders the app, so whatever this
 * writes is the title it may list: they have to agree, down to the count of
 * calls on today's board, which is counted over the Worker's window.
 */
function pageTitle(name) {
  // A page the Worker wrote carries the title it was written with.
  if (name === 'page' && state.serverTitle) { document.title = state.serverTitle; return; }
  let t = TITLES[name] ?? null;
  if (name === 'fixture' && state.titleFor?.home) {
    const f = state.titleFor;
    t = matchTitle({ home: f.home, away: f.away, state: matchState(f).kind, score: f.score, live: f.live_score });
  } else if (name === 'board') {
    const now = Date.now() / 1000;
    const calls = (state.board?.fixtures ?? []).filter((f) => f.kickoff >= now - 12 * 3600 && f.kickoff <= now + 48 * 3600
      && (f.top_pick || f.locked || f.called)).length;
    t = state.board ? todayTitle(ukDay(now), calls) : "Today's board";
  } else if (name === 'slip') {
    t = slipTitle(state.slipNow);
  } else if (name === 'league') {
    const h = app.querySelector('h1')?.textContent.replace(/\s+/g, ' ').trim();
    t = h ? leagueTitle(h) : null;
  } else if (name === 'player' || name === 'legal') {
    // The privacy policy, the terms and the cookie policy were all "Legal" in
    // the tab and the history list.
    t = app.querySelector('h1')?.textContent.replace(/\s+/g, ' ').trim() || t;
  }
  // A page with no title of its own (an address we do not have, a page that
  // could not load) is named by its heading, not given the front page's.
  if (!t && name !== 'home') t = app.querySelector('h1')?.textContent.replace(/\s+/g, ' ').trim() || null;
  document.title = name === 'home' ? fullTitle(null) : fullTitle(t);
}

/** Give the app's own links real addresses, keeping the route for the tap. */
function crawlable(root = document) {
  for (const a of root.querySelectorAll('a[href^="#/"]')) {
    const hash = a.getAttribute('href');
    const path = hashPath(hash);
    if (!path) continue;
    a.dataset.hash = hash;
    a.setAttribute('href', path);
  }
}

function parseHash() {
  const raw = (location.hash || (pathRoute() ? `#${pathRoute()}` : '#/home')).slice(1);
  const cut = raw.indexOf('?');
  const path = cut === -1 ? raw : raw.slice(0, cut);
  const query = cut === -1 ? '' : raw.slice(cut + 1);
  return {
    parts: path.replace(/^\//, '').split('/').filter(Boolean),
    params: new URLSearchParams(query),
  };
}

/** The board's own address, so a filtered board can be sent to someone. */
function boardHash(hours = state.hours, league = state.leagueName) {
  const q = new URLSearchParams();
  if (Number(hours) !== 72) q.set('hours', String(hours));
  if (league) q.set('league', league);
  if (state.when !== 'upcoming') q.set('when', state.when);
  const s = q.toString();
  return s ? `#/board?${s}` : '#/board';
}

/**
 * Whether a card carries a call. The one definition every page uses.
 *
 * The board is a list of calls. A match we have nothing to say about is not
 * on it -- it was, as a one-line "Passed", two hundred times down a page about
 * picks -- and it is still reachable from its league and from search engines,
 * just not presented as though it were part of the product.
 */
const hasCall = (f) => Boolean(f?.top_pick || f?.locked);

/*
 * The shape of a page before its data arrives: a title bar and rows, in the
 * page's own surfaces. A cold first visit is the only time anyone sees it.
 */
function skeletonHTML(kind = 'page') {
  const rows = '<div class="skeleton skeleton-row"></div>'.repeat(kind === 'rows' ? 6 : 4);
  return `<div class="wrap section dense" aria-busy="true" aria-label="Loading">
    ${kind === 'rows' ? '' : '<div class="skeleton skeleton-title"></div><div class="skeleton skeleton-line"></div>'}
    <div class="rows skeleton-rows">${rows}</div>
  </div>`;
}

/**
 * How a call is doing while the match is on: the sweat (js/lib/sweat.js).
 *
 * What has to happen now, in the words you'd use watching it -- already in,
 * needs a goal, one goal against and it's gone -- and how it looks from here,
 * from the score, the clock and our expected goals. Never a number. Markets
 * the score cannot grade (corners, cards) get nothing.
 */
function liveTrack(pick, f) {
  if (!pick || !f || matchState(f).kind !== 'live') return null;
  const ls = Array.isArray(f.live_score) && f.live_score.length === 2 ? f.live_score : null;
  if (!ls) return null;
  const rates = Array.isArray(f.lambda) ? f.lambda
    : Number.isFinite(Number(f.lambda_home)) ? [f.lambda_home, f.lambda_away] : null;
  return sweat({
    market: pick.market, outcome: pick.outcome, line: pick.line, score: ls,
    minute: f.live_minute ?? null, status: f.status, rates, who: { home: f.home, away: f.away },
  });
}
const trackHTML = (t) => (t ? `<span class="track ${t.tone}" title="${esc(t.need)}"><i></i>${esc(t.headline)}</span>` : '');

async function loadBoard({ fresh = false } = {}) {
  state.board = await getJSON(`/api/board?hours=${state.hours}`, { fresh });
  /*
   * A played match's call is whatever the record says it was.
   *
   * The card's own `top_pick` is from the write-up, which for a stretch of
   * fixtures was rewritten after the match; `called` is the pick table, the
   * same row the results page and the fixture page read. Where they differ the
   * record wins, including when the record says no call was made -- that is
   * how a match came to show "Landed" on one page and "no call" on the next.
   */
  /*
   * One row per match.
   *
   * The feed lists some matches twice under two ids -- Stuttgart v Heidenheim,
   * Lustenau v Bregenz, and Thame v Exmouth once each way round -- and the
   * board printed both. Same two clubs, kicking off within a few hours of each
   * other, is the same match; the copy carrying a call is kept, otherwise the
   * first.
   */
  const norm = (t) => String(t ?? '').toLowerCase().normalize('NFD').replace(/[^a-z0-9]/g, '');
  const kept = [];
  for (const f of state.board.fixtures ?? []) {
    const pair = [norm(f.home), norm(f.away)].sort().join('|');
    const twin = kept.find((k) => k._pair === pair && Math.abs((k.kickoff ?? 0) - (f.kickoff ?? 0)) < 4 * 3600);
    if (!twin) { f._pair = pair; kept.push(f); continue; }
    const score = (x) => (x.top_pick || x.locked || x.called ? 2 : 0) + (Array.isArray(x.score) ? 1 : 0);
    if (score(f) > score(twin)) { f._pair = pair; kept[kept.indexOf(twin)] = f; }
  }
  state.board.fixtures = kept;

  for (const f of state.board.fixtures ?? []) {
    if (!Array.isArray(f.score)) continue;
    f.locked = false;
    f.top_pick = f.called
      ? { ...f.called, prices: [{ slug: '', book: f.called.bookmaker, odds: f.called.odds }] }
      : null;
  }
  return state.board;
}

// ------------------------------------------------------------------- home

/**
 * Matchday imagery, from the provider rather than from a stock library.
 *
 * /img/venue/{id}/ returns a real photograph of the ground a fixture is played
 * at, so the hero is the stadium hosting the biggest game on today's board and
 * a fixture page shows its own ground. Stock photography of an anonymous pitch
 * says nothing; Craven Cottage from the air says the site knows what it is
 * looking at.
 *
 * Two quirks of the endpoint, both handled by `venueShot`. Some ids have no
 * photograph and answer with a 1x1 transparent PNG rather than a 404, so an
 * onerror handler never fires — the size has to be checked on load instead.
 * And a missing shot must degrade to something deliberate rather than to a
 * blank rectangle.
 */
/**
 * Only about a third of grounds have a photograph — the board is mostly lower
 * divisions the provider has no stadium art for — so the masthead is given a
 * queue of candidates rather than one id. A miss advances to the next ground
 * instead of collapsing the hero, and only an exhausted queue falls back to the
 * gradient.
 */
window.__shotMissing = (img) => {
  const next = (img.dataset.rest ?? '').split(',').filter(Boolean);
  if (next.length) {
    img.dataset.rest = next.slice(1).join(',');
    img.src = `${IMG_BASE}/venue/${encodeURIComponent(next[0])}/`;
    return;
  }
  img.closest('[data-shot]')?.setAttribute('data-shot', 'none');
  img.remove();
};
// A ground with no photograph answers 200 with a 1x1 transparent PNG rather
// than a 404, so the load handler has to measure it.
window.__shotCheck = (img) => {
  if (img.naturalWidth < 40) window.__shotMissing(img);
};

function venueShot(venueIds, className, eager = false) {
  const queue = (Array.isArray(venueIds) ? venueIds : [venueIds])
    .map(Number)
    .filter((v) => Number.isFinite(v));
  if (!queue.length) return '';
  return `<img src="${IMG_BASE}/venue/${encodeURIComponent(queue[0])}/" alt="" class="${className}"
    data-rest="${queue.slice(1, 14).join(',')}"
    ${eager ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async"
    onload="window.__shotCheck(this)" onerror="window.__shotMissing(this)">`;
}

/**
 * The masthead.
 *
 * One photograph, edge to edge, with the fixture in the bottom-left of it.
 *
 * The version before this put the picture in a bounded plate beside the type,
 * to keep the type off a bright photograph. That solved the problem by giving
 * up the thing photography is for. The answer is a scrim shaped to the layout
 * -- heaviest where the words are, clear where the subject is -- which is what
 * every club site and every broadcaster does, and it is the single change that
 * makes a page look like football rather than like a fixture list.
 *
 * The fixture is two rows, crest then name, rather than "A vs B" across one
 * line. Stacked, the crests can be big enough to recognise.
 */
/**
 * The match centre that sits on the photograph.
 *
 * The masthead was a tie, a line and two buttons on top of a picture, and the
 * right two thirds of it were empty. Everything here is already in the fixture
 * bundle and none of it is behind the wall: where the two sides sit in the
 * table, how they have been going, and what has happened the other 128 times
 * they have met. No price, because the front door carries none.
 *
 * The countdown is the only thing on this site that moves. A board of football
 * about to kick off should feel like it is about to kick off.
 */
function ordinal(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '';
  const s = ['th', 'st', 'nd', 'rd'];
  const m = v % 100;
  return v + (s[(m - 20) % 10] ?? s[m] ?? s[0]);
}

/*
 * Whether a fixture's table is a real league table. A cup or a group stage
 * the provider sends merged (the Nations League comes as one ranking of
 * fifty-odd countries) has no position worth printing; the same bounds as
 * storyFor's isLeague.
 */
const realTable = (st) => Boolean(st && (!st.size || (st.size >= 3 && st.size <= 30)));

function matchCentreHTML(hero, d) {
  if (!d) return '';
  const st = realTable(d.standings) ? (d.standings ?? {}) : {};
  const h2h = d.h2h ?? {};

  const side = (name, id, table, form) => `
    <div class="mc-side">
      ${crest(name, 'sm', id)}
      <span class="mc-name">${esc(name)}</span>
      ${table?.position ? `<span class="mc-pos">${esc(ordinal(table.position))}</span>` : ''}
      ${formChips(form)}
    </div>`;

  const meetings = Number(h2h.total_matches) || 0;
  return `
  <aside class="matchcentre">
    <div class="mc-block mc-clock">
      <span class="mc-label">Kicks off in</span>
      <span class="mc-count" data-countdown="${Number(hero.kickoff) || 0}">—</span>
    </div>

    ${(st.home?.position || st.away?.position) ? `
      <div class="mc-block">
        <span class="mc-label">In the table</span>
        ${side(hero.home, hero.home_id, st.home, d.form?.home)}
        ${side(hero.away, hero.away_id, st.away, d.form?.away)}
      </div>` : ''}

    ${meetings ? `
      <div class="mc-block">
        <span class="mc-label">${meetings === 1 ? 'One meeting' : `${meetings} meetings`}</span>
        ${formBarHTML(
          Number(h2h.home_wins) || 0,
          Number(h2h.draws) || 0,
          Number(h2h.away_wins) || 0,
          [`${hero.home}`, 'drawn', `${hero.away}`],
          '',
          'neutral',
        )}
      </div>` : ''}
  </aside>`;
}

/**
 * Today's free call, on the front page, for everyone.
 *
 * The headline fixture's call is the one call a day that is not behind the
 * wall (free_fixture_id() in the schema). It goes on the masthead in the
 * scoreboard face, with its odds and its book, because the free call is the
 * product's best argument for itself: a reader watches it land and knows what
 * the other forty look like. When the bundle has not caught up yet the block
 * says what is coming rather than showing nothing.
 */
/*
 * The free call is the strongest open call of the day (engine/src/free.ts),
 * which is not always the headline match. `free` is that fixture's board row,
 * unwalled by free_fixture_id() so its call is on it for everyone; when it is
 * a different match from the masthead the tie and the kick-off are named and
 * the block links to it. `detail` is the masthead's own bundle, the fallback
 * for a board that has not caught up.
 */
function freeCallHTML(hero, detail, free = null) {
  const isHero = free && hero && Number(free.id) === Number(hero.fixture_id);
  let v = free?.top_pick ?? null;
  let tie = free;
  if (!v && (!free || isHero) && hero) {
    v = (detail?.published ?? []).find((x) => x?.market)
      ?? (detail?.verdicts ?? []).find((x) => x?.candidate)?.candidate
      ?? null;
    tie = hero ? { id: hero.fixture_id, home: hero.home, away: hero.away, kickoff: hero.kickoff } : null;
  }
  if (!v || !tie) {
    return hero
      ? `<p class="hero-blurb">${esc(hero.league ?? '')}${hero.league ? '. ' : ''}Today's free call goes
      up once the calls are in.</p>`
      : '';
  }
  const d = market({ market: v.market, outcome: v.outcome, line: v.line, home: tie.home, away: tie.away, odds: v.odds });
  const elsewhere = !hero || Number(tie.id) !== Number(hero.fixture_id);

  /*
   * Once its match has started, the free call stops being an offer and
   * becomes a result: the score, and whether it landed. A free call that
   * landed is the best thing the front page can show a stranger, and one
   * that missed is shown the same way, because the record does not choose.
   */
  const st = free ? matchState(free) : { kind: 'upcoming' };
  const score = Array.isArray(free?.score) ? free.score : null;
  if (free && st.kind !== 'upcoming') {
    const GRADE = { WON: 'won', LOST: 'lost', HALF_WON: 'part', HALF_LOST: 'part', PUSH: 'back', VOID: 'back' };
    const landed = score
      ? (GRADE[free.called?.result] ?? didItLand({ market: v.market, outcome: v.outcome, line: v.line, homeGoals: score[0], awayGoals: score[1] }))
      : null;
    const WORD = { won: 'Landed', lost: 'Missed', part: 'Half back', back: 'Stake back' };
    const shown = score ?? (Array.isArray(free.live_score) ? free.live_score : null);
    return `
  <div class="freecall">
    <span class="freecall-tag">Today's free call</span>
    <a class="freecall-tie" href="#/fixture/${encodeURIComponent(tie.id)}">${crest(tie.home, 'xs', tie.home_id)}${esc(tie.home)}
      ${shown ? `<b>${esc(shown[0])}–${esc(shown[1])}</b>` : 'v'} ${crest(tie.away, 'xs', tie.away_id)}${esc(tie.away)}
      ${st.kind === 'live' ? liveBadge(st) : ''}</a>
    <p class="freecall-sel">${esc(d.name)}</p>
    <p class="freecall-meta" data-public-price>${landed
      ? `<span class="mark ${landed}">${WORD[landed] ?? ''}</span>`
      : trackHTML(liveTrack(v, free))} <b>${oddsTag(v.odds)}</b>${v.bookmaker ? ` at ${esc(bookName(v.bookmaker))}` : ''}
      ${shareButtonHTML({
        text: landed && shown
          ? `Today's free call ${landed === 'won' ? 'landed' : 'is in'}: ${d.name}, at odds of ${Number(v.odds).toFixed(2)}. ${tie.home} ${shown[0]}–${shown[1]} ${tie.away}.`
          : `Today's free call on ${tie.home} v ${tie.away}: ${d.name}, at odds of ${Number(v.odds).toFixed(2)}.`,
        url: matchUrl(tie.id, tie.home, tie.away), title: `${tie.home} v ${tie.away}` })}</p>
    <p class="hero-blurb">${landed
      ? `Free for everyone, as one call is every day.${isMember() ? '' : ' Members had every other call on the board.'}`
      : `Free for everyone, and under way.${isMember() ? '' : ' Members get every other call the moment it goes up.'}`}</p>
  </div>`;
  }

  return `
  <div class="freecall">
    <span class="freecall-tag">Today's free call</span>
    ${elsewhere ? `<a class="freecall-tie" href="#/fixture/${encodeURIComponent(tie.id)}">${crest(tie.home, 'xs', tie.home_id)}${esc(tie.home)} v ${crest(tie.away, 'xs', tie.away_id)}${esc(tie.away)}<span>${esc(kickoffLabel(tie.kickoff))}</span></a>` : ''}
    <p class="freecall-sel">${elsewhere ? `<a href="#/fixture/${encodeURIComponent(tie.id)}">${esc(d.name)}</a>` : esc(d.name)}</p>
    <p class="freecall-meta" data-public-price><b>${oddsTag(v.odds)}</b>${v.bookmaker ? ` at ${esc(bookName(v.bookmaker))}` : ''}
      ${shareButtonHTML({ text: `Today's free call on ${tie.home} v ${tie.away}: ${d.name}, at odds of ${Number(v.odds).toFixed(2)}.`,
        url: matchUrl(tie.id, tie.home, tie.away), title: `${tie.home} v ${tie.away}` })}</p>
    <p class="hero-blurb">The call we are surest of today, free for everyone.${isMember() ? '' : ' Members get every other call the moment it goes up.'}</p>
  </div>`;
}

/**
 * The headline match's own call, under its name.
 *
 * The masthead is always a match we have a call on (see chooseHero), so this
 * says what that call is: open for a member or when it is today's free call,
 * a lock for everyone else. Once the match is under way the call is no
 * longer on sale, so the lock gives way to a line saying it closed at
 * kick-off; the full-time result is the fixture page's to tell.
 */
/*
 * How calls move, in one place so every page says it the same way. The slate
 * looks at every match again every fifteen minutes until kick-off; a call can
 * change or be taken down in that time, and kick-off closes it.
 */
const CALLS_NOTE = `<p class="calls-note"><b>Calls move until kick-off.</b> We look at every match again every
  fifteen minutes as team news and prices come in, so a call can change, or come down if we stop backing
  it. At kick-off it closes: nothing is sold once a match is on, and it is graded at full time. The bet
  slip is the exception: once it is posted, it stays exactly as it is.</p>`;

/*
 * Sharing.
 *
 * One button, on a call, on the free call and on the slip. On a phone it is
 * the phone's own share sheet; anywhere else it copies the link. The link is
 * the match's own address (/match/<id>/<teams>), whose preview says what
 * state the match is in. What is shared never gives away a members' call:
 * an open call that is not the free one is shared as the match and the fact
 * that we have a call on it. Free calls and results are shared in full.
 */
const SHARE_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12M7 8l5-5 5 5"/><path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/></svg>';
const matchUrl = (id, home, away) => `${location.origin}/match/${Number(id)}/${slugOf(home) || 'home'}-v-${slugOf(away) || 'away'}`;
function shareButtonHTML({ text, url, title = 'offside.win', label = 'Share' }) {
  return `<button class="btn btn-quiet btn-sm share-btn" type="button" data-share
    data-share-text="${esc(text)}" data-share-url="${esc(url)}" data-share-title="${esc(title)}">${SHARE_SVG}<span>${esc(label)}</span></button>`;
}
/** Is this match today's free call? Then its call can be shared by anyone. */
const isFreeFixture = (id) => Boolean(state.board?.fixtures?.some((f) => Number(f.id) === Number(id) && f.free_call));
document.addEventListener('click', async (e) => {
  const b = e.target.closest?.('[data-share]');
  if (!b) return;
  e.preventDefault();
  const { shareText: text, shareUrl: url, shareTitle: title } = b.dataset;
  if (navigator.share) {
    try { await navigator.share({ title, text, url }); } catch { /* closed the sheet */ }
    return;
  }
  const label = b.querySelector('span');
  try {
    await navigator.clipboard.writeText(`${text} ${url}`);
    if (label) { label.textContent = 'Link copied'; setTimeout(() => { label.textContent = 'Share'; }, 2000); }
  } catch {
    window.prompt('Copy this link', url);
  }
});

/*
 * Leaks.
 *
 * A member can see every call; that is what they pay for, and nothing stops
 * one being retyped. What stops a member's calls being resold is that a leak
 * says whose it was:
 *   - a faint "for @name" across every members' call and the slip, which is
 *     what a screenshot posted in a group carries;
 *   - an invisible code, the first eight characters of the account's id in
 *     zero-width characters, written into any call text a member copies,
 *     which survives a paste into most apps. #/trace reads it back.
 * Neither touches the free call or anything a free reader sees.
 */
const ZW = ['\u200b', '\u200c', '\u200d', '\u2060'];
const ZW_MARK = '\u2063';
const memberCode = () => String(state.user?.id ?? '').replace(/-/g, '').slice(0, 8);
function zwEncode(hex) {
  return ZW_MARK + [...hex].map((h) => { const n = parseInt(h, 16) || 0; return ZW[n >> 2] + ZW[n & 3]; }).join('') + ZW_MARK;
}
function zwDecode(text) {
  const m = String(text).match(/\u2063([\u200b\u200c\u200d\u2060]{2,})\u2063/);
  if (!m) return null;
  const c = [...m[1]];
  let out = '';
  for (let i = 0; i + 1 < c.length; i += 2) out += ((ZW.indexOf(c[i]) << 2) | ZW.indexOf(c[i + 1])).toString(16);
  return out;
}
const markLabel = () => (state.account?.profile?.username ? `@${state.account.profile.username}` : `member ${memberCode()}`);
/** The faint repeated "for @name", as a tile the members' boxes lay over themselves. */
function paintMemberMark() {
  const root = document.documentElement;
  if (!isMember() || !state.user) { root.style.removeProperty('--member-mark'); return; }
  const label = `for ${markLabel()}`.replace(/[<&>"']/g, '');
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='240' height='120'><text x='12' y='70' transform='rotate(-16 120 60)' font-family='sans-serif' font-size='12' fill='white' fill-opacity='0.07'>${label}</text></svg>`;
  root.style.setProperty('--member-mark', `url("data:image/svg+xml,${encodeURIComponent(svg)}")`);
}
document.addEventListener('copy', (e) => {
  if (!isMember() || !state.user) return;
  const sel = document.getSelection();
  if (!sel || sel.isCollapsed) return;
  const at = sel.anchorNode?.nodeType === 1 ? sel.anchorNode : sel.anchorNode?.parentElement;
  if (!at?.closest?.('.is-members')) return;
  const text = sel.toString();
  const code = zwEncode(memberCode());
  // After the first word, so trimming either end of the paste keeps it.
  const i = text.indexOf(' ');
  e.clipboardData?.setData('text/plain', i > 0 ? text.slice(0, i) + code + text.slice(i) : text + code);
  e.preventDefault();
});

const LOCK_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10V7a5 5 0 0 1 10 0v3"/><rect x="4" y="10" width="16" height="10" rx="2"/></svg>';
function heroCallHTML(hero, row) {
  if (!row) return '';
  const st = matchState(row);
  const v = row.top_pick ?? null;
  if (v) {
    const d = market({ market: v.market, outcome: v.outcome, line: v.line, home: hero.home, away: hero.away, odds: v.odds });
    return `
    <div class="freecall hero-call">
      <span class="freecall-tag${row.free_call ? '' : ' is-ours'}">${row.free_call ? 'Our call, free today' : 'Our call'}</span>
      <p class="freecall-sel">${esc(d.name)}</p>
      <p class="freecall-meta" data-public-price>${st.kind === 'live' ? `${trackHTML(liveTrack(v, row))} ` : ''}<b>${oddsTag(v.odds)}</b>${v.bookmaker ? ` at ${esc(bookName(v.bookmaker))}` : ''}</p>
    </div>`;
  }
  if (!row.locked) return '';
  if (st.kind !== 'upcoming') {
    return `<p class="hero-closed">${liveBadge(st)} Our call closed at kick-off. It is not sold once a match is on;
      it goes up here with how it went at full time.</p>`;
  }
  return `
    <div class="hero-lock">
      ${LOCK_SVG}
      <p><b>We have a call on this one.</b> Which market, the odds and the book are for members.</p>
      <a class="btn btn-accent btn-sm" href="#/pricing" data-public-price>From £3.49</a>
    </div>`;
}

/**
 * Today's free call, when it is a different match from the headline: in its
 * own box under the masthead, named as its own match, so it can never be read
 * as the call on the headline.
 */
function freeBandHTML(free, hero) {
  if (!free?.top_pick || !hero?.fixture_id || Number(free.id) === Number(hero.fixture_id)) return '';
  return `<div class="wrap free-band">${freeCallHTML(null, null, free)}</div>`;
}

function heroHTML(hero = null, venueIds = [], detail = null, free = null, row = null) {
  // The ground the engine found a photograph for goes first (shot_venue_id,
  // engine/src/slate.ts), so the page does not walk the list to find one.
  const queue = hero?.shot_venue_id ? [hero.shot_venue_id, hero.venue_id, ...venueIds].filter(Boolean)
    : hero?.venue_id ? [hero.venue_id, ...venueIds] : [].concat(venueIds).filter(Boolean);

  // A hero answer without a fixture is the day with no headline; the free
  // call, if there is one, still goes on the masthead.
  if (!hero?.fixture_id) {
    return `
    <section class="hero" data-shot="${queue.length ? 'yes' : 'none'}">
      <div class="hero-media">${venueShot(queue, '', true)}</div>
      <div class="wrap hero-inner">
        <div class="hero-copy">
          <h1 class="display">The picks for the biggest games.</h1>
          <p class="hero-blurb">Every call comes with the reason behind it. And the reason
             not to like it. Eighty-eight competitions, updated through the day.</p>
          ${freeCallHTML(null, null, free)}
          <div class="hero-cta">
            <a class="btn btn-primary" href="#/board">Today's picks</a>
            <a class="btn btn-ghost" href="#/results">See the results</a>
          </div>
        </div>
      </div>
    </section>`;
  }

  const when = kickoffLabel(hero.kickoff);
  // The competition sits above the tie as a link to its page, in the same
  // face as everything else: a handwritten league name read as a
  // decoration rather than a fact, and could not be tapped. An occasion
  // ("the Madrid derby") follows it when there is one worth saying.
  const occasion = unshout(hero.kicker);
  const compHTML = hero.league || occasion ? `
        <p class="comp-line">${hero.league_id && hero.league
          ? `<a class="comp-link" href="#/league/${encodeURIComponent(hero.league_id)}">${crest(hero.league, 'xs', hero.league_id, 'league')}<span>${esc(hero.league)}</span></a>`
          : hero.league ? `<span class="comp-link">${esc(hero.league)}</span>` : ''}${
          occasion && occasion.toLowerCase() !== String(hero.league ?? '').toLowerCase()
            ? `<span class="comp-occasion">${esc(occasion)}</span>` : ''}</p>` : '';

  // A Champions League game gets the competition's night instead of the
  // ground (comptheme.js).
  const theme = themeOf(hero.league_id);
  return `
  <section class="hero${theme ? ` theme-${theme}` : ''}" data-shot="${queue.length ? 'yes' : 'none'}">
    ${theme ? themeArt(theme) : `<div class="hero-media">${venueShot(queue, '', true)}</div>`}
    <div class="wrap hero-inner">
      <div class="hero-copy">
        <span class="timechip${isSoon(hero.kickoff) ? ' soon' : ''}">${esc(when)}</span>
        ${compHTML}
        <!-- The tie is the page's heading. Without this the home page had no
             h1 at all whenever a hero fixture was set, which is the one case
             it always is. -->
        <!-- The heading is words only; the stacked lines are its picture.
             With the crests' initials inside it, the page's heading read
             "G Germany G Greece" to anything that reads text. -->
        <h1 class="visually-hidden">The biggest game we have a call on: ${esc(hero.home)} v ${esc(hero.away)}</h1>
        <div class="fx-stack" aria-hidden="true">
          <span class="fx-line">${crest(hero.home, 'md', hero.home_id)}<span class="name">${esc(hero.home)}</span></span>
          <span class="fx-line">${crest(hero.away, 'md', hero.away_id)}<span class="name">${esc(hero.away)}</span></span>
        </div>
        ${heroCallHTML(hero, row)}
        <div class="hero-cta">
          <a class="btn btn-primary" href="#/fixture/${encodeURIComponent(hero.fixture_id)}">Read why</a>
          <a class="btn btn-ghost" href="#/board">Today's calls</a>
        </div>
      </div>
      ${detail ? matchCentreHTML(hero, detail) : '<aside class="matchcentre mc-wait" aria-hidden="true"></aside>'}
    </div>
  </section>`;
}

/**
 * What is on after the headline fixture.
 *
 * Six compact cards, each the board row stripped to two clubs and a kick-off.
 * A call is marked on the club it is about rather than spelled out, because at
 * this size there is room for a mark and not for a sentence.
 */
/**
 * What is on next, under a heading that is true.
 *
 * It used to be the first eight fixtures the board returned, in board order --
 * which starts a day in the past, so "Next up" was eight matches that had all
 * finished. The board reaches backwards on purpose; this rail does not, and
 * the two had been sharing an order.
 *
 * Live first, because a game being played now beats one kicking off in six
 * hours. Then soonest. And when there is genuinely nothing to come -- late on
 * a Sunday, between windows -- it says what it is showing instead of claiming
 * those games are still ahead.
 */
function nextRailHTML(fixtures) {
  const rank = (f) => {
    const k = matchState(f).kind;
    return k === 'live' ? 0 : k === 'upcoming' ? 1 : 2;
  };
  const ahead = fixtures
    .filter((f) => rank(f) < 2)
    .sort((a, b) => rank(a) - rank(b) || (a.kickoff ?? 0) - (b.kickoff ?? 0));
  const back = fixtures
    .filter((f) => rank(f) === 2)
    .sort((a, b) => (b.kickoff ?? 0) - (a.kickoff ?? 0));

  const soon = (ahead.length ? ahead : back).slice(0, 8);
  const heading = ahead.length
    ? (ahead.every((f) => matchState(f).kind === 'live') ? 'On right now' : 'Next up')
    : 'Just finished';
  if (!soon.length) return '';
  // A fixture list, the way every football page prints one: home, the
  // kick-off between, away. One match to a line, read top to bottom.
  return `
  <div class="wrap section dense">
    <div class="section-head"><div><h2 class="display">${esc(heading)}</h2></div>
      <a class="btn btn-ghost btn-sm" href="#/board${heading === 'Just finished' ? '?when=played' : ''}">The full board</a></div>
    <ol class="next-list">
      ${soon.map(nextRowHTML).join('')}
    </ol>
  </div>`;
}

/**
 * The reader's own games: every match on the board involving a team they
 * follow or in a competition they follow, live first then soonest. Drawn
 * only for a signed-in reader who follows something, and above everything
 * else below the headline, because it is the reason they made an account.
 */
function yourGamesHTML(fixtures) {
  const follows = state.account?.follows ?? [];
  if (!state.user || !follows.length) return '';
  const teams = new Set(follows.filter((f) => f.kind === 'team').map((f) => Number(f.id)));
  const comps = new Set(follows.filter((f) => f.kind === 'league').map((f) => Number(f.id)));
  const rank = (f) => ({ live: 0, upcoming: 1 })[matchState(f).kind] ?? 2;
  const mine = fixtures
    .filter((f) => teams.has(Number(f.home_id)) || teams.has(Number(f.away_id)) || comps.has(Number(f.league_id)))
    .filter((f) => rank(f) < 2)
    .sort((a, b) => rank(a) - rank(b) || (a.kickoff ?? 0) - (b.kickoff ?? 0))
    .slice(0, 8);
  const name = accountName(state.user, state.account?.profile).split(' ')[0];
  return `
  <div class="wrap section dense">
    <div class="section-head"><div><h2 class="display">Your games</h2>
      <p>${esc(name)}, the teams and competitions you follow.</p></div>
      <a class="btn btn-ghost btn-sm" href="#/account?tab=following">Edit</a></div>
    ${mine.length
      ? `<ol class="next-list">${mine.map(nextRowHTML).join('')}</ol>`
      : `<div class="empty-state"><b>Nothing from them in the next few days</b>
           <span>Their next games show here as soon as they are on the board.</span></div>`}
  </div>`;
}

/** One match in a fixture list: home, the kick-off (or the score), away. */
function nextRowHTML(f) {
  const k = new Date(f.kickoff * 1000);
  const time = clockTime(k);
  const st = matchState(f);
  const score = st.kind === 'live'
    ? (Array.isArray(f.live_score) && f.live_score.length === 2 ? f.live_score : null)
    : (Array.isArray(f.score) && f.score.length === 2 ? f.score : null);
  const middle = st.kind === 'upcoming'
    ? `<b class="next-time">${esc(time)}</b><small>${esc(dayLabel(f.kickoff))}</small>`
    : `<b class="next-time">${score ? `${esc(score[0])}–${esc(score[1])}` : esc(time)}</b><small>${liveBadge(st)}</small>`;
  // Whether we made a pick, as a word under the kick-off: "Pick" in the
  // accent, with a lock where it is for members.
  const lock = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10V7a5 5 0 0 1 10 0v3"/><rect x="4" y="10" width="16" height="10" rx="2"/></svg>';
  const mark = f.top_pick ? '<small class="next-pick">Pick</small>'
    : f.locked && st.kind === 'live' ? '<small class="next-pick is-closed" title="Calls close at kick-off">Closed</small>'
    : f.locked ? `<small class="next-pick" title="A pick for members">${lock}Pick</small>` : '';
  return `
  <li><a class="next-row" href="#/fixture/${encodeURIComponent(f.id)}">
    <span class="next-side home"><span class="next-name">${esc(f.home)}</span>${crest(f.home, 'sm', f.home_id)}</span>
    <span class="next-mid">${middle}${mark}</span>
    <span class="next-side away">${crest(f.away, 'sm', f.away_id)}<span class="next-name">${esc(f.away)}</span></span>
  </a></li>`;
}

/** Is the reader a member? The account says so once it has loaded; the board's own answer until then. */
const isMember = () => Boolean(state.member ?? state.board?.member);

/**
 * The membership, offered once on the front page, as a ticket: what it adds
 * on the left, what it costs on the stub. The same shape as the ticket a
 * member holds on their account page, so buying one looks like getting one.
 * It used to be a purple gradient with a chevron flight across it, the only
 * block of solid colour on the site, and it was shown to members too.
 * A member is never sold what they have: for them this is nothing.
 */
function promoHTML(user) {
  if (isMember()) return '';
  return `
  <section class="promo" aria-labelledby="promo-h">
    <div class="promo-main">
      <h2 id="promo-h">Every call, the moment it goes up.</h2>
      <ul class="ticks promo-points">
        <li><b>The call on every match we cover:</b> the market, the side, the odds and the bookmaker</li>
        <li><b>The bet slip's legs</b> before the first one kicks off</li>
        <li><b>Why we're making each one</b>, in a paragraph on every match</li>
      </ul>
      <p class="promo-note">The previews and the full record, the losses included, stay free.</p>
    </div>
    <div class="promo-stub">
      <span class="promo-from">From</span>
      <b class="promo-price" data-public-price>£3.49</b>
      <span class="promo-per">for the weekend</span>
      <a class="btn btn-accent" href="#/pricing">See the plans</a>
    </div>
  </section>`;
}

/**
 * The right-hand rail: the calls that are live now.
 *
 * The reference runs its newsroom down this side of every page and the layout
 * depends on it being there. We have no newsroom, so this carries the thing a
 * reader came for instead — which is a better use of the column anyway.
 */
/** How often, in words. Mirrors engine/src/slip.ts; a percentage is not said here. */
function chanceInWords(chance) {
  const tenths = Math.round(Number(chance) * 10);
  if (!(tenths > 0)) return 'less than once in ten';
  if (tenths >= 10) return 'almost every time';
  return `about ${['', 'once', 'twice', 'three times', 'four times', 'five times', 'six times',
    'seven times', 'eight times', 'nine times'][tenths]} in ten`;
}

/**
 * Today's bet slip.
 *
 * Our most likely calls, combined to total odds between 2.00 and 3.00 -- the
 * combination with the best chance of every leg landing (engine/src/slip.ts).
 * A free reader sees the offer: how many legs, the total odds, how often a
 * slip like it comes in, and the slip record. A member sees the legs.
 *
 * The chance sits next to the odds on purpose. Multiplying legs multiplies the
 * risk, and a slip that hid that would be selling the odds rather than the
 * reading.
 */
function slipHTML(data, fixtures = []) {
  const cur = data?.current;
  const rec = data?.record;
  const record = rec?.n ? `<p class="slip-record">Slips so far: <b>${rec.won} of ${rec.n}</b> landed.</p>` : '';
  if (!cur) {
    return `
    <section class="panel slip">
      <p class="panel-head">Today's bet slip</p>
      <p class="slip-empty">No slip up yet. It goes up once there are enough strong calls on the
        board to reach total odds of two without reaching for weaker ones.</p>
      ${record}
    </section>`;
  }
  const legs = Array.isArray(cur.legs) ? cur.legs : null;
  /*
   * A posted slip is fixed (engine/src/slip.ts): the legs it went up with are
   * the legs it is graded on. The countdown is to its first kick-off, and
   * the words say it will not change, which is the point of a slip. Was: it
   * followed the board until its first leg kicked off, then it is a
   * record. Saying when that is, and counting down to it, is the difference
   * between "a slip" and "the slip, and you have forty minutes".
   */
  const first = Number(cur.first_kickoff) || 0;
  const lock = !first ? ''
    : first <= Date.now() / 1000
      ? `<p class="slip-lock live"><i></i>Under way. These legs stand as posted.</p>`
      : `<p class="slip-lock">Fixed as posted. First kick-off in <b data-countdown="${first}" data-done="a moment">—</b></p>`;
  /*
   * Each leg, as it stands. The board rows carry the running score and, once
   * a match is over, the record's grade, so a member watching the slip sees
   * every leg move: on track, not yet, landed, missed.
   */
  const byId = new Map(fixtures.map((f) => [Number(f.id), f]));
  const GRADE = { WON: 'won', LOST: 'lost', HALF_WON: 'part', HALF_LOST: 'part', PUSH: 'back', VOID: 'back' };
  const MARK = { won: 'Landed', lost: 'Missed', back: 'Void', part: 'Half' };
  const legState = (l) => {
    // A call taken down before its match drops out of the slip, as a void leg.
    if (l.withdrawn) return `<span class="mark back" title="The call was taken down before kick-off">Void</span>`;
    // The slip carries each leg's own state now (slip_legs); the board is the
    // fallback, and it only reaches back a day.
    const f = 'status' in l
      ? { id: l.fixture_id, kickoff: l.kickoff, status: l.status, score: l.score, live_score: l.live_score, live_minute: l.live_minute,
          called: l.result ? { market: l.market, outcome: l.outcome, result: l.result } : null }
      : byId.get(Number(l.fixture_id));
    if (!f) return '';
    const st = matchState(f);
    const score = Array.isArray(f.score) && f.score.length === 2 ? f.score : null;
    if (st.kind === 'ft' && score) {
      const same = f.called && f.called.market === l.market && String(f.called.outcome) === String(l.outcome);
      const r = (same && GRADE[f.called.result])
        ?? didItLand({ market: l.market, outcome: l.outcome, line: l.line, homeGoals: score[0], awayGoals: score[1] });
      return r ? `<span class="mark ${r}">${MARK[r]}</span>` : liveBadge(st);
    }
    if (st.kind === 'live') return trackHTML(liveTrack(l, f)) || liveBadge(st);
    return '';
  };
  return `
  <section class="panel slip${legs ? ' is-members' : ''}">
    <p class="panel-head">Today's bet slip <a href="#/slip">Every slip</a></p>
    <div class="slip-share">${shareButtonHTML({
      // The slip's size and odds only: its legs are the members' own.
      text: `Today's bet slip on offside.win: ${cur.legs_count} legs at total odds of ${Number(cur.odds).toFixed(2)}.`,
      url: `${location.origin}/#/slip`, title: 'Today\'s bet slip' })}</div>
    <div class="slip-total">
      <span class="slip-odds">${showOdds(cur.odds)}<small>total odds</small></span>
      <span class="slip-legs">${cur.legs_count} legs</span>
    </div>
    <p class="slip-chance">Our most likely calls, combined. A slip like this comes in
      <b>${esc(chanceInWords(cur.chance))}</b>.</p>
    ${lock}
    ${legs ? `<ol class="slip-list">${legs.map((l) => {
      const d = market({ market: l.market, outcome: l.outcome, line: l.line, home: l.home, away: l.away, odds: l.odds });
      return `
        <li><a href="#/fixture/${encodeURIComponent(l.fixture_id)}">
          <span class="slip-tie">${esc(l.home)} v ${esc(l.away)}</span>
          <span class="slip-sel">${esc(d.name)}</span>
          <span class="slip-meta">${esc(kickoffLabel(l.kickoff))}<span class="slip-state">${legState(l)}<b>${oddsTag(l.odds)}</b></span></span>
        </a></li>`;
    }).join('')}</ol>`
    : `<div class="slip-locked">
        <p>The ${cur.legs_count} matches and the calls on them are for members.</p>
        <a class="btn btn-accent" href="#/pricing">See what membership costs</a>
      </div>`}
    ${record}
  </section>`;
}

/**
 * The ticker: what is happening right now, in one line that moves.
 *
 * The thing every football site has and this one did not. Live scores on
 * called matches, what landed and what missed today, and the next kick-offs.
 * It scrolls because a ticker scrolls -- it is the one piece of motion on the
 * page that is not answering a tap -- and it holds still for anyone who has
 * asked the system for less motion, where it becomes a row that scrolls
 * sideways by hand.
 */
function tickerHTML(fixtures, recent) {
  const now = Date.now() / 1000;
  const items = [];
  const live = fixtures.filter((f) => hasCall(f) && matchState(f).kind === 'live');
  for (const f of live.slice(0, 8)) {
    const sc = Array.isArray(f.live_score) ? f.live_score : null;
    const t = liveTrack(f.top_pick, f);
    items.push({ tone: 'live', href: `#/fixture/${f.id}`,
      text: `${t ? `${t.headline}: ` : ''}${f.home} ${sc ? `${sc[0]}–${sc[1]}` : 'v'} ${f.away}` });
  }
  const today = new Date().toDateString();
  for (const x of (recent ?? []).filter((r) => new Date(r.kickoff * 1000).toDateString() === today).slice(0, 8)) {
    const won = x.result === 'WON' || x.result === 'HALF_WON';
    const lost = x.result === 'LOST' || x.result === 'HALF_LOST';
    if (!won && !lost) continue;
    const sc = Number.isInteger(x.home_goals) ? `${x.home_goals}–${x.away_goals}` : 'FT';
    items.push({ tone: won ? 'won' : 'lost', href: `#/fixture/${x.fixture_id}`, text: `${won ? 'Landed' : 'Missed'}: ${x.home_team} ${sc} ${x.away_team}` });
  }
  const next = fixtures.filter((f) => hasCall(f) && f.kickoff > now).sort((a, b) => a.kickoff - b.kickoff).slice(0, 8);
  for (const f of next) {
    const t = clockTime(new Date(f.kickoff * 1000));
    items.push({ tone: 'next', href: `#/fixture/${f.id}`, text: `${esc(dayLabel(f.kickoff)) === 'Today' ? t : `${dayLabel(f.kickoff)} ${t}`} ${f.home} v ${f.away}` });
  }
  if (!items.length) return '';
  const cell = (it) => `<a class="tick ${it.tone}" href="${it.href}"><i></i>${esc(it.text)}</a>`;
  const track = items.map(cell).join('');
  // Twice over, so the loop has no seam; the copy is hidden from readers.
  return `
  <div class="ticker" style="--tick-n:${items.length}">
    <div class="ticker-track">${track}<span aria-hidden="true">${track}</span></div>
  </div>`;
}

/**
 * The front page's two columns end together.
 *
 * The record beside the side column used to be a fixed eight matches, and the
 * side column's height depends on the day (a slip or none, games on now or
 * not, the promo gone for members), so one column always ran on past the other
 * with a blank space above the footer. The record is the column that can give:
 * it shows as many matches as fit beside the side column, at least three, and
 * "The full record" has the rest. Watched, because the slip and the live block
 * redraw in place during a match.
 */
function balanceRecord() {
  const grid = app.querySelector('.with-side');
  const main = grid?.querySelector(':scope > .stack');
  const side = grid?.querySelector(':scope > .home-side');
  const rows = [...(main?.querySelectorAll('.played > .played-row') ?? [])];
  if (!main || !side || !rows.length) return;
  const fit = () => {
    if (!main.isConnected) return;
    grid.classList.remove('is-balanced');
    rows.forEach((r) => { r.hidden = false; });
    // Stacked (a phone): no column to line up with, so a steady eight.
    if (getComputedStyle(grid).gridTemplateColumns.trim().split(/\s+/).length < 2) {
      rows.forEach((r, i) => { r.hidden = i >= 8; });
      return;
    }
    // Heights, not positions: the side column is sticky, so where it sits
    // depends on the scroll. Both columns start at the top of the grid.
    const room = side.getBoundingClientRect().height;
    const tall = () => main.getBoundingClientRect().height;
    let n = rows.length;
    while (n > 3 && tall() > room + 4) rows[(n -= 1)].hidden = true;
    // One row short of the side column leaves a gap under the record, so put
    // that row back and let the side column's last block stretch to meet it.
    if (n < rows.length && tall() < room - 4) rows[n].hidden = false;
    grid.classList.add('is-balanced');
  };
  fit();
  if ('ResizeObserver' in window) {
    let raf = 0;
    const ro = new ResizeObserver(() => {
      if (!main.isConnected) { ro.disconnect(); return; }
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(fit);
    });
    ro.observe(side);
    ro.observe(grid);
  }
}

/** The slip, and every settled slip before it. */
async function viewSlip() {
  // Which navigation this page belongs to: a newer one makes it stand down (see route).
  const nav = navTicket;
  placeholder(skeletonHTML());
  let data;
  let board = null;
  // The board rides along so each leg can show how its match stands.
  try { [data, board] = await Promise.all([getJSON('/api/slip'), loadBoard().catch(() => null)]); }
  catch (err) { return errorState(err, nav); }
  state.slipNow = data?.current ?? null;
  const tone = (r) => (r === 'WON' ? 'won' : r === 'LOST' ? 'lost' : 'back');
  const recent = data?.recent ?? [];
  if (nav !== navTicket) return;
  app.innerHTML = `
  <div class="wrap section narrow">
    <div class="page-head">
      <h1 class="display">The bet slip</h1>
      <p class="page-sub">Our most likely calls, combined to total odds of between two and three:
        the combination with the best chance of every leg landing. Every slip is graded,
        and every one stays on this page afterwards, won or lost.</p>
    </div>
    ${slipHTML(data, board?.fixtures ?? [])}
    ${recent.length ? `
    <section class="panel side-block">
      <p class="panel-head">Settled slips</p>
      <div class="played">
        ${recent.map((r) => `
        <div class="played-row">
          <div class="played-meta">
            <span>${esc(kickoffLabel(r.first_kickoff))}, ${(r.legs ?? []).length} legs at ${oddsOf(r.odds)}</span>
            <span class="mark ${tone(r.result)}">${esc(({ won: 'Landed', lost: 'Missed', back: 'Void' })[tone(r.result)])}</span>
          </div>
          <ul class="played-calls">${(r.legs ?? []).map((l) => {
            const d = market({ market: l.market, outcome: l.outcome, line: l.line, home: l.home, away: l.away, odds: l.odds });
            return `<li><span>${esc(l.home)} v ${esc(l.away)}: ${esc(d.name)}</span><span>${oddsTag(l.odds)}</span></li>`;
          }).join('')}</ul>
        </div>`).join('')}
      </div>
    </section>` : ''}
  </div>`;
  tickCountdowns();
}

/** Called matches being played now, with the running score. */
function liveNowHTML(fixtures) {
  const live = fixtures.filter((f) => hasCall(f) && matchState(f).kind === 'live').slice(0, 6);
  if (!live.length) return '';
  return `
  <section class="panel side-block">
    <p class="panel-head"><span class="live-badge"><i></i>LIVE</span> On now</p>
    <div class="side-list">
      ${live.map((f) => {
        const sc = Array.isArray(f.live_score) ? f.live_score : null;
        return `
        <a class="side-item" href="#/fixture/${encodeURIComponent(f.id)}">
          <span class="side-thumb">${crest(f.home, 'sm', f.home_id)}${crest(f.away, 'sm', f.away_id)}</span>
          <span class="side-body">
            <span class="side-sel">${esc(f.home)} v ${esc(f.away)}</span>
            <span class="side-meta"><span class="side-league">${esc(f.league ?? '')}</span><b data-score>${sc ? `${sc[0]}–${sc[1]}` : 'under way'}</b>${
              minuteHTML(f)}${trackHTML(liveTrack(f.top_pick, f))}</span>
          </span>
        </a>`;
      }).join('')}
    </div>
  </section>`;
}

/** Where today's calls are: each league with a count, one tap to its board. */
function leaguesTodayHTML(fixtures) {
  const ahead = fixtures.filter((f) => hasCall(f) && matchState(f).kind === 'upcoming');
  if (!ahead.length) return '';
  const by = new Map();
  for (const f of ahead) {
    const k = f.league ?? 'Other';
    by.set(k, { n: (by.get(k)?.n ?? 0) + 1, id: f.league_id });
  }
  const rows = [...by.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 10);
  return `
  <section class="panel side-block">
    <p class="panel-head">Where the calls are</p>
    <div class="league-chips">
      ${rows.map(([name, v]) => `
        <a class="league-chip" href="${v.id ? `#/league/${encodeURIComponent(v.id)}` : `#/board?league=${encodeURIComponent(name)}`}">
          ${crest(name, 'xs', v.id, 'league')}<span>${esc(name)}</span><b>${v.n}</b>
        </a>`).join('')}
    </div>
  </section>`;
}

/**
 * The column beside the record. It used to render only when a reader could
 * see calls, so for everyone not signed in it was a blank half of the page.
 */
function sideHTML(fixtures, slip) {
  const withCall = fixtures.filter((f) => f.top_pick && matchState(f).kind === 'upcoming').slice(0, 8);
  // The blocks that move while a match is on sit in named slots, so the
  // front page's refresh can redraw them in place without touching the rest.
  return `
  <aside class="home-side">
    <div data-live="slip">${slipHTML(slip, fixtures)}</div>
    <div data-live="live">${liveNowHTML(fixtures)}</div>
    ${leaguesTodayHTML(fixtures)}
    ${withCall.length ? `
    <section class="panel side-block">
      <p class="panel-head">Open calls <a href="#/board">All</a></p>
      <div class="side-list">
        ${withCall.map((f) => {
          const d = market({
            market: f.top_pick.market, outcome: f.top_pick.outcome, line: f.top_pick.line,
            home: f.home, away: f.away, odds: f.top_pick.odds,
          });
          // The free call is public by design, and says so.
          return `
          <a class="side-item" href="#/fixture/${encodeURIComponent(f.id)}"${f.free_call ? ' data-public-price' : ''}>
            <span class="side-thumb">${crest(f.home, 'sm', f.home_id)}${crest(f.away, 'sm', f.away_id)}</span>
            <span class="side-body">
              <span class="side-sel">${esc(d.name)}${f.free_call ? ' <span class="freecall-tag">Free</span>' : ''}</span>
              <span class="side-meta">${esc(kickoffLabel(f.kickoff))} <b>${oddsTag(f.top_pick.odds)}</b></span>
            </span>
          </a>`;
        }).join('')}
      </div>
    </section>` : ''}
  </aside>`;
}

/**
 * Won, drawn, lost as one bar — in counts, with its scope stated.
 *
 * The keys used to be percentages, which put "77% won" six lines under a
 * headline reading "a 83% strike rate". Both were true and they had different
 * denominators: the headline covers the whole settled record, the bar covers
 * only the picks this page fetched. Two rates that close together read as the
 * page contradicting itself, which is exactly what it was accused of.
 *
 * Counts do not compete with a rate the way a second rate does, and the scope
 * line says what is being counted, so the bar can keep its detail.
 */
function formBarHTML(w, d, l, labels = ['won', 'drawn', 'lost'], scope = '', tone = '') {
  const total = w + d + l;
  if (!total) return '';
  const pc = (n) => (n / total) * 100;
  return `
  <div class="formbar${tone ? ` ${tone}` : ''}">
    <div class="formbar-track">
      ${w ? `<i class="w" style="width:${pc(w)}%"></i>` : ''}
      ${d ? `<i class="d" style="width:${pc(d)}%"></i>` : ''}
      ${l ? `<i class="l" style="width:${pc(l)}%"></i>` : ''}
    </div>
    <div class="formbar-keys">
      <span class="w"><b>${w}</b> ${esc(labels[0])}</span>
      ${d ? `<span class="d"><b>${d}</b> ${esc(labels[1])}</span>` : ''}
      <span class="l"><b>${l}</b> ${esc(labels[2])}</span>
    </div>
    ${scope ? `<p class="formbar-scope">${esc(scope)}</p>` : ''}
  </div>`;
}

/**
 * Settled picks as rows.
 *
 * The competition and the kick-off sit on their own muted line above the two
 * clubs, which is what keeps the row itself down to a tie and one number. The
 * price shows only where it is history a reader has gone looking for — never on
 * the front door, which carries no odds at all.
 */
function playedHTML(picks, { showOdds = false } = {}) {
  if (!picks.length) return '';
  /*
   * One card per match, however many calls it carried.
   *
   * A match with two calls used to appear twice, one card saying "Landed" and
   * the next "Missed" over the identical scoreline -- Criciuma 0-2 Operario,
   * side by side. Each card was true and together they read as the page
   * contradicting itself. The match is the unit a reader thinks in; the calls
   * are listed inside it, each with its own mark.
   */
  const groups = new Map();
  for (const x of picks) {
    if (!groups.has(x.fixture_id)) groups.set(x.fixture_id, []);
    groups.get(x.fixture_id).push(x);
  }
  const tone = (r) => (r === 'WON' || r === 'HALF_WON' ? 'won' : r === 'LOST' || r === 'HALF_LOST' ? 'lost' : 'back');
  return `
  <div class="played">
    ${[...groups.values()].map((calls) => {
      const x = calls[0];
      const tones = calls.map((c) => tone(c.result));
      const wins = tones.filter((t) => t === 'won').length;
      const losses = tones.filter((t) => t === 'lost').length;
      const overall = calls.length === 1 ? tones[0] : losses === 0 ? 'won' : wins === 0 ? 'lost' : 'back';
      const mark = calls.length === 1
        ? ({ won: 'Landed', lost: 'Missed', back: 'Void' })[tones[0]]
        : `${wins} of ${calls.length} landed`;
      const hasScore = Number.isInteger(x.home_goals) && Number.isInteger(x.away_goals);
      return `
      <a class="played-row" href="#/fixture/${encodeURIComponent(x.fixture_id)}">
        <div class="played-meta">
          <span>${esc(kickoffLabel(x.kickoff))}</span>
          <span class="mark ${overall}">${esc(showOdds && calls.length === 1 ? oddsTag(x.odds) : mark)}</span>
        </div>
        <div class="played-tie">
          <span class="played-side">${crest(x.home_team ?? '', 'sm', x.home_team_id)}<span>${esc(x.home_team ?? '')}</span></span>
          <span class="played-score ${overall === 'won' ? 'w' : overall === 'lost' ? 'l' : ''}">${
            hasScore ? `${esc(x.home_goals)}–${esc(x.away_goals)}` : 'FT'}</span>
          <span class="played-side away">${crest(x.away_team ?? '', 'sm', x.away_team_id)}<span>${esc(x.away_team ?? '')}</span></span>
        </div>
        ${scorersHTML(x.goals, 'scorers played-scorers')}
        ${calls.length > 1 ? `<ul class="played-calls">${calls.map((c, i) => {
          const d = market({ market: c.market, outcome: c.outcome, line: c.line, home: c.home_team, away: c.away_team, odds: c.odds });
          return `<li><span>${esc(d.name)}</span><span class="mark ${tones[i]}">${esc(({ won: 'Landed', lost: 'Missed', back: 'Void' })[tones[i]])}</span></li>`;
        }).join('')}</ul>` : ''}
      </a>`;
    }).join('')}
  </div>`;
}

/**
 * One fixture, one line.
 *
 * The board used a four-across card grid, which showed four games on a laptop
 * screen. This shows a dozen. A reader arrives looking for their fixture, not
 * browsing, so the scan matters more than the presentation — and the density is
 * what makes the page feel like a board rather than a brochure.
 *
 * Column order is deliberate: when, who, what we think, what it pays. The eye
 * runs down the left edge to find the game and the right edge to find the
 * price; the reasoning sits between them, read once the fixture is found.
 */
/** The signed-in reader's club, or 0. */
function myClubId() { return Number(state.account?.profile?.club_id) || 0; }

function rowHTML(f) {
  const pick = f.top_pick;
  // The price a reader here can actually get on, which is rarely the best
  // price in the world — see js/lib/books.js.
  const p = pick && localPrice(pick.prices ?? [{ slug: '', book: pick.bookmaker, odds: pick.odds }]);
  const d = pick && market({
    market: pick.market, outcome: pick.outcome, line: pick.line,
    home: f.home, away: f.away, odds: p ? p.odds : pick.odds,
  });
  const k = new Date(f.kickoff * 1000);
  // 24-hour: "11:00 PM" wraps in the column, and a board is read the way a
  // fixture list is printed.
  const time = clockTime(k);
  const state = matchState(f);
  const day = dayLabel(f.kickoff);

  /*
   * A played match has to read as played.
   *
   * The board reaches six hours back, so on any evening a third of it is
   * matches that are over. They were drawn identically to the ones still to
   * come: a kick-off time, a call, and a price presented as if it could still
   * be taken. The only thing separating them was a small FT.
   *
   * Three things change instead. The score goes where the crest and the name
   * are, the way a fixture list prints it. The price column becomes the mark —
   * whether the call landed. And the row gets its own surface, so the eye sorts
   * the board into over and not-over before reading a word of it.
   */
  const score = Array.isArray(f.score) && f.score.length === 2 ? f.score : null;
  const played = state.kind === 'ft' && score;
  // A match in progress shows its running score and no mark. `live_score` is a
  // separate field from `score` on purpose: one is what it is at this minute,
  // the other is how it finished, and printing the first as the second is how
  // a goalless first half became a result.
  const running = !played && Array.isArray(f.live_score) && f.live_score.length === 2 ? f.live_score : null;
  const shown = score ?? running;
  // And while it is on, how the call is doing against that score.
  const track = liveTrack(pick, f);
  // The stored grade where the record has one -- it is what the results page
  // prints -- and the scoreline only for a call not graded yet.
  const GRADE = { WON: 'won', LOST: 'lost', HALF_WON: 'part', HALF_LOST: 'part', PUSH: 'back', VOID: 'back' };
  const landed = played && pick
    ? (GRADE[pick.result] ?? didItLand({ market: pick.market, outcome: pick.outcome, line: pick.line,
                                          homeGoals: score[0], awayGoals: score[1] }))
    : null;
  const MARK = { won: 'Landed', lost: 'Missed', back: 'Refunded', part: 'Half back' };

  /*
   * A game we passed on is one line, not four.
   *
   * It used to render the full card with "No call -- the price looks about
   * right to us." underneath, which is an honest sentence that costs the same
   * vertical space as an actual call and says it two hundred times down one
   * board. The pass is still on the board, still reachable, and the reasoning
   * is still on the fixture page. It just stops being the tallest thing on a
   * page about picks.
   */
  const pass = !pick && !f.locked && !played;
  // A locked row is the same shape as a pass: two lines, with the offer in the
  // column the price would be in. The sentence it used to carry -- "We have a
  // call on this one." -- was three lines of card spent saying nothing a lock
  // does not already say, on the rows a reader is least able to act on.
  const terse = pass || (f.locked && !played);

  // The reader's own club, marked so it can be found at a glance. (Read
  // through a helper: `state` in this function is the match's state.)
  const clubId = myClubId();
  const isClub = clubId && (Number(f.home_id) === clubId || Number(f.away_id) === clubId);

  /*
   * Which kind of call this is, at a glance: the one free call of the day, or
   * a members' call. A member sees every call, and they all looked the same,
   * so nothing said which one everybody else could see; a free reader saw the
   * free call drawn exactly like a member's. Amber for free (the colour the
   * free call wears on the front page), the accent for members (the colour of
   * the lock), and only on calls still to be settled.
   */
  const kind = played ? null : f.free_call && pick ? 'free' : pick || f.locked ? 'members' : null;
  const kindTag = kind === 'free'
    ? '<span class="row-kind is-free">Free today</span>'
    : kind === 'members' && pick
      ? `<span class="row-kind is-members"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10V7a5 5 0 0 1 10 0v3"/><rect x="4" y="10" width="16" height="10" rx="2"/></svg>Members</span>`
      : '';

  return `
  <a class="row is-${state.kind}${played ? ' is-played' : ''}${terse ? ' is-terse' : ''}${isClub ? ' is-club' : ''}${kind ? ` is-${kind}` : ''}" href="#/fixture/${encodeURIComponent(f.id)}"
     aria-label="${esc(f.home)} versus ${esc(f.away)}">
    <div class="row-when">
      ${state.kind === 'upcoming'
        // A kick-off the provider has moved since the slate wrote the row: the
        // new time, and a word saying it is new, so a reader who remembered
        // three o'clock is not left wondering which is right.
        ? `<span class="row-time">${esc(time)}</span><span class="row-day">${esc(day)}</span>${
            f.moved_from ? `<span class="row-moved" title="Was ${esc(kickoffLabel(f.moved_from))}">New time</span>` : ''}`
        // On a match in progress the bare time reads as the clock -- "LIVE
        // 12:00" looks like the twelfth minute of the second half. It is the
        // kick-off, so it says so, in the shorthand every football page uses.
        // The day matters here too: the board reaches back past midnight, so
        // "ko 16:30" alone cannot tell yesterday's game from this
        // afternoon's.
        : `<span class="row-time">${liveBadge(state)}</span><span class="row-day">${
            state.kind === 'live' && f.live_minute != null
              ? minuteHTML(f)
              : `${day === 'Today' ? '' : `${esc(day)} · `}ko ${esc(time)}`}</span>`}
    </div>

    <div class="row-teams">
      <span class="row-side">${crest(f.home, 'sm', f.home_id)}<span>${esc(f.home)}</span>${
        shown ? `<b class="row-goals${shown[0] > shown[1] ? ' won' : ''}">${esc(shown[0])}</b>` : ''}</span>
      <span class="row-side">${crest(f.away, 'sm', f.away_id)}<span>${esc(f.away)}</span>${
        shown ? `<b class="row-goals${shown[1] > shown[0] ? ' won' : ''}">${esc(shown[1])}</b>` : ''}</span>
      ${isClub ? '<span class="row-club">Your club</span>' : ''}
    </div>

    ${d ? `<div class="row-call">
      ${kindTag}
      <div class="row-sel">${esc(d.name)}</div>
      <p class="row-wins">${
        played
          ? esc(recap({ market: pick.market, outcome: pick.outcome, line: pick.line,
                        result: landed === 'won' ? 'WON' : landed === 'lost' ? 'LOST' : 'VOID',
                        homeGoals: score[0], awayGoals: score[1], home: f.home, away: f.away }) ?? d.wins)
          : esc(d.wins)}</p>
    </div>` : ''}

    <div class="row-price">
      ${played
        ? (landed
            ? `<span class="mark ${esc(landed)}">${esc(MARK[landed])}</span>${
                pick ? `<span class="odds-book">at ${oddsOf(p ? p.odds : pick.odds)}</span>` : ''}`
            /*
             * Not "Full time" twice. The badge on the left of the row already
             * says the match is over; this column is for what the call did,
             * and when there was no call the honest answer is the same one an
             * unplayed row gives. A pick the score cannot grade -- corners,
             * cards -- says what we took it at and leaves the verdict to the
             * fixture page, which has the numbers.
             */
            : pick
              ? `<span class="odds-book">called at ${oddsOf(p ? p.odds : pick.odds)}</span>`
              : f.locked
                ? `<span class="row-locked-mark">
                     <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10V7a5 5 0 0 1 10 0v3"/><rect x="4" y="10" width="16" height="10" rx="2"/></svg>
                     Members</span>`
                : `<span class="row-pass">No pick</span>`)
        // Called off: a bet on a match that is not played is void, which is
        // how the record will settle it too. Said now rather than leaving a
        // price up as though it could still be taken.
        : state.kind === 'off' && VOIDED.has(String(f.status).toLowerCase()) && (pick || f.locked)
          ? `<span class="mark back">Void</span>${pick ? `<span class="odds-book">called at ${oddsOf(p ? p.odds : pick.odds)}</span>` : ''}`
        : pick && p && track ? `
        ${trackHTML(track)}<span class="odds-book">at ${oddsOf(p.odds)}</span>`
        : pick && p ? `
        <span class="odds-tile${p.local ? '' : ' away'}"><span class="odds">${showOdds(p.odds)}</span><span class="odds-unit">odds</span></span>
        <span class="odds-book">${pick.lean ? 'lean, ' : ''}${esc(p.book)}</span>`
        : f.locked && state.kind === 'live' ? `<span class="row-closed" title="Calls close at kick-off and are shown at full time">Closed at kick-off</span>`
        : f.locked ? `<span class="row-locked-mark">
                        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10V7a5 5 0 0 1 10 0v3"/><rect x="4" y="10" width="16" height="10" rx="2"/></svg>
                        Members</span>`
        // No call: our read instead, in words, with no price (engine/src/read.ts).
        : f.read?.text
          ? `<span class="row-read"><small>Our read</small><b>${esc(f.read.text)}</b></span>`
          : '<span class="row-pass">No pick</span>'}
    </div>
  </a>`;
}

/* ---------------------------------------------------------------- search */

/*
 * Find a game.
 *
 * The question behind a search is "is there a call on this one?", and there
 * are three honest answers, so every result says which:
 *   - a call: the price and the book for a member, the lock for anyone else;
 *   - no pick: we looked, and nothing was worth backing;
 *   - not yet: too far off. Games are analysed in the three days before
 *     kick-off, when line-ups, team news and prices mean something, so the
 *     result says the day it opens instead of pretending the game is missing.
 * Played games from the last three days come after, with how the call went.
 */
const ANALYSIS_LEAD = 72 * 3600;

function laterRowHTML(g) {
  const k = new Date(g.kickoff * 1000);
  const time = clockTime(k);
  const opens = g.kickoff - ANALYSIS_LEAD;
  const when = opens * 1000 <= Date.now() ? 'Analysis due any time' : `Analysed from ${dayLabel(opens)}`;
  return `
  <div class="row is-upcoming is-terse is-later">
    <div class="row-when"><span class="row-time">${esc(time)}</span><span class="row-day">${esc(dayLabel(g.kickoff))}</span></div>
    <div class="row-teams">
      <span class="row-side">${crest(g.home, 'sm', g.home_id)}<span>${esc(g.home)}</span></span>
      <span class="row-side">${crest(g.away, 'sm', g.away_id)}<span>${esc(g.away)}</span></span>
    </div>
    <div class="row-price"><span class="row-later">${esc(when)}</span></div>
  </div>`;
}

// A played game's call comes back as `called`, from the record.
const searchHasCall = (f) => hasCall(f) || Boolean(f.called);

async function viewSearch(params = new URLSearchParams()) {
  const initial = (params.get('q') ?? '').slice(0, 60);
  let only = params.get('only') === 'calls';
  app.innerHTML = `
  <div class="wrap section narrow search-page">
    <div class="page-head">
      <h1 class="display xl">Find a game</h1>
      <p class="page-sub">Any team or competition we cover, two weeks ahead.</p>
    </div>
    <form class="search-box" id="search-form" role="search">
      <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></svg>
      <input id="search-q" type="search" name="q" autocomplete="off" autocapitalize="off" spellcheck="false"
             enterkeyhint="search" maxlength="60" placeholder="Arsenal, Serie A, Boca…" aria-label="Team or competition"
             value="${esc(initial)}">
    </form>
    <p class="visually-hidden" id="search-status" role="status"></p>
    <div class="search-out" id="search-out"></div>
  </div>`;

  const input = document.getElementById('search-q');
  const out = document.getElementById('search-out');
  // What a screen reader hears after each search: one line, not the whole
  // list read out again on every keystroke, which is what making the list
  // itself the live region did.
  const status = document.getElementById('search-status');
  const say = (text) => { if (status.textContent !== text) status.textContent = text; };
  let seq = 0;
  let timer = null;

  const intro = () => `
    <div class="search-key">
      <p>What each result tells you:</p>
      <ul>
        <li><span class="k-call">A price</span> or <span class="k-lock">Members</span>: we have a call on it.</li>
        <li><span class="k-pass">No pick</span>: we looked and nothing was worth backing. The reasons are on the game's page.</li>
        <li><span class="k-later">Analysed from Thu</span>: too far off yet. We read each game in the three days before kick-off.</li>
      </ul>
    </div>`;

  const paint = (data) => {
    const q = data.q;
    const analysed = data.analysed ?? [];
    const later = data.later ?? [];
    const leagues = data.leagues ?? [];
    const upcoming = analysed.filter((f) => matchState(f).kind !== 'ft');
    const played = analysed.filter((f) => matchState(f).kind === 'ft').reverse();
    const calls = upcoming.filter(searchHasCall).length;
    const passes = upcoming.length - calls;
    const total = analysed.length + later.length;

    if (!total && !leagues.length) {
      say(`Nothing for ${q} in the next two weeks.`);
      out.innerHTML = `
        <div class="search-empty">
          <p class="search-empty-head">Nothing for “${esc(q)}” in the next two weeks.</p>
          <p>We only list competitions we analyse, and only two weeks ahead. Try the club’s short name, or look through <a href="#/leagues">the competitions we cover</a>.</p>
        </div>`;
      return;
    }

    // The sentence that answers the question before the list does.
    const bits = [];
    if (calls) bits.push(`${calls} with a call`);
    if (passes) bits.push(`${passes} with no pick`);
    if (later.length) bits.push(`${later.length} still to be analysed`);
    if (played.length) bits.push(`${played.length} played in the last few days`);
    const summary = bits.length ? `${bits.slice(0, -1).join(', ')}${bits.length > 1 ? ' and ' : ''}${bits[bits.length - 1]}.` : '';
    say(summary || `${leagues.length} ${leagues.length === 1 ? 'competition' : 'competitions'} found.`);

    const shownUp = only ? upcoming.filter(searchHasCall) : upcoming;
    const shownPlayed = only ? played.filter(searchHasCall) : played;
    const shownLater = only ? [] : later;
    const item = (f) => `<li class="sr-item"><span class="sr-league">${esc(f.league ?? '')}</span>${rowHTML(f)}</li>`;
    const laterItem = (g) => `<li class="sr-item"><span class="sr-league">${esc(g.league ?? '')}</span>${laterRowHTML(g)}</li>`;

    out.innerHTML = `
      ${leagues.length ? `<div class="sr-leagues">${leagues.map((l) =>
        `<a class="sr-comp" href="#/league/${encodeURIComponent(l.id)}">${crest(l.name, 'sm', l.id, 'league')}<span>${esc(l.name)}</span></a>`).join('')}</div>` : ''}
      ${summary ? `<p class="sr-summary">${esc(summary)}</p>` : ''}
      ${total ? `<div class="sr-filter" role="group" aria-label="Show">
        <button type="button" data-only="" aria-pressed="${!only}">All games</button>
        <button type="button" data-only="calls" aria-pressed="${only}">Only with a call</button>
      </div>` : ''}
      ${shownUp.length || shownLater.length ? `<h2 class="sr-head">Coming up</h2>
        <ul class="sr-list">${shownUp.map(item).join('')}${shownLater.map(laterItem).join('')}</ul>` : ''}
      ${only && !shownUp.length && total ? `<p class="sr-none">No calls on these yet. ${later.length ? 'Some are still to be analysed; ' : ''}a call only goes up when we think one is worth making.</p>` : ''}
      ${shownPlayed.length ? `<h2 class="sr-head">Played</h2><ul class="sr-list">${shownPlayed.map(item).join('')}</ul>` : ''}`;

    for (const b of out.querySelectorAll('[data-only]')) {
      b.onclick = () => { only = b.dataset.only === 'calls'; remember(input.value); paint(data); };
    }
  };

  const remember = (q) => {
    const sp = new URLSearchParams();
    if (q.trim()) sp.set('q', q.trim());
    if (only) sp.set('only', 'calls');
    const tail = sp.toString();
    history.replaceState(null, '', `${location.pathname}${location.search}#/search${tail ? `?${tail}` : ''}`);
  };

  const run = async (q) => {
    const mine = ++seq;
    remember(q);
    if (q.trim().length < 2) { say(''); out.innerHTML = intro(); return; }
    out.classList.add('busy');
    try {
      const data = await getJSON(`/api/search?q=${encodeURIComponent(q.trim())}`);
      if (mine !== seq) return;
      paint(data);
    } catch {
      if (mine !== seq) return;
      say('Search is not answering just now.');
      out.innerHTML = '<p class="sr-none">Search is not answering just now. Try again in a moment.</p>';
    } finally {
      if (mine === seq) out.classList.remove('busy');
    }
  };

  input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => run(input.value), 250); });
  document.getElementById('search-form').onsubmit = (e) => { e.preventDefault(); clearTimeout(timer); input.blur(); run(input.value); };
  run(initial);
  // Straight into the box, except on a phone arriving from a shared link,
  // where a keyboard over the results is the wrong welcome.
  if (!initial || matchMedia('(min-width: 700px)').matches) input.focus();
}

/** "Today", "Tomorrow", or the weekday — nobody reads a date they can infer. */
function dayLabel(epoch) {
  const k = new Date(epoch * 1000);
  const today = new Date();
  const days = Math.round((k.setHours(0, 0, 0, 0) - today.setHours(0, 0, 0, 0)) / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days === -1) return 'Yesterday';
  return new Date(epoch * 1000).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
}

/**
 * The front row: prominence first, then variety, then confidence.
 *
 * Two things were wrong with ranking on confidence alone. It showed the same two
 * markets eight times, and it had no idea which competition anybody cares about —
 * a Polish cup tie led the page on a Premier League Saturday because it kicked
 * off first and the model happened to like it. `rank` comes off the board card
 * (lower is more prominent) and leads the sort; the one-market-per-pass rule then
 * keeps the row from repeating itself inside each band.
 */
function spread(fixtures, limit) {
  const ranked = [...fixtures].sort(
    (a, b) => (a.rank ?? 6) - (b.rank ?? 6) || (b.confidence ?? 0) - (a.confidence ?? 0),
  );
  const out = [];
  const used = new Set();
  for (let pass = 0; pass < 6 && out.length < limit; pass++) {
    const seen = new Set();
    for (const f of ranked) {
      if (out.length >= limit) break;
      if (used.has(f.id)) continue;
      const key = `${f.top_pick?.market}:${f.top_pick?.outcome}`;
      if (seen.has(key)) continue;
      seen.add(key);
      used.add(f.id);
      out.push(f);
    }
  }
  return out;
}

/*
 * The front door.
 *
 * The front page was a dashboard: a match masthead, a fixture list, the
 * record. Everything a member wants every morning, and nothing that tells a
 * stranger what the site is, why to trust it or what it costs. So "/" is now
 * two pages. A member gets the dashboard (viewDashboard). Everyone else gets
 * the landing page: what this is in one line, today's free call with its
 * actual write-up, how it works, the record in public, the big games coming,
 * the plans, and the questions people actually ask.
 *
 * No odds on it. The pages traffic arrives on are analysis-led (offside-ui,
 * "Two registers"), and a pick is never shown without its price, so the free
 * call appears as its reasoning and a link, not as a pick.
 *
 * Telling them apart costs nothing for a visitor with no stored session: the
 * landing page draws at once. With a session, the board says whether it
 * belongs to a member, and the board is the first thing either page needs.
 */
async function viewHome() {
  if (!hasStoredSession()) return viewLanding();
  const board = await loadBoard().catch(() => null);
  return isMember() || board?.member ? viewDashboard() : viewLanding();
}


/*
 * The trap of the day (engine/src/trap.ts): a favourite everyone is on and we
 * wouldn't touch, with the reasons. Free, on the front page and the members'
 * home, and priceless on purpose: it is a warning, not a call, and the pages
 * it sits on carry no odds. The slate leaves it off any match where we have a
 * members' call on the result.
 */
function trapHTML(t, { on = 'landing' } = {}) {
  if (!t || !t.fixture_id || !(Number(t.kickoff) > Date.now() / 1000)) return '';
  const reasons = (Array.isArray(t.reasons) ? t.reasons : []).map((r) => cleanProse(r)).filter(Boolean).slice(0, 3);
  if (!reasons.length) return '';
  const where = t.side === 'home' ? `at home to ${t.against}` : `away at ${t.against}`;
  const teamId = t.side === 'home' ? t.home_id : t.away_id;
  return `
    ${on === 'landing' ? `<div class="ld-sec-head"><h2 class="ld-h2">One to leave alone</h2></div>
    <p class="ld-sub">The trap of the day: a favourite everyone’s on that we wouldn’t touch. Free, every day.</p>`
      : '<div class="section-head"><div><h2 class="display">One to leave alone</h2></div></div>'}
    <article class="trap">
      <div class="trap-tape" aria-hidden="true"></div>
      <div class="trap-who">
        ${crest(t.team, 'xl', teamId)}
        <div>
          <p class="trap-label">Trap of the day</p>
          <p class="trap-team">${esc(t.team)}</p>
          <p class="trap-tie"><span>${esc(where)}</span>${t.league ? `<span>${esc(t.league)}</span>` : ''}<span>${esc(kickoffLabel(t.kickoff))}</span></p>
        </div>
      </div>
      <div class="trap-body">
        <p class="trap-head">Everyone’s on ${esc(t.team)}. We wouldn’t be.</p>
        <ul class="trap-why">${reasons.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>
        <p class="trap-foot"><a href="#/fixture/${encodeURIComponent(t.fixture_id)}">Read the match</a><span>A warning, not a call.</span></p>
      </div>
    </article>`;
}

/** The shout over the headline, for the day it is. */
function landingShout(now = new Date()) {
  const d = now.getDay();
  if (d === 5 || d === 6 || d === 0) return 'Weekend’s here. Let’s gooo.';
  if (d === 2 || d === 3) return 'Midweek football. Let’s go.';
  return 'Football’s on. Let’s gooo.';
}

/*
 * The landing page, built to what a landing page is for: one job (get a
 * visitor to read today's free call; membership is the second step, never a
 * competing first one), in the order that earns it. Say what it is, plainly,
 * above the fold, with the proof beside the button; show the product; show
 * what you get; show the receipts, misses included; price it; answer the
 * doubts; ask again. Everything shown is real data from the board.
 */
const LANDING_COMPS = [[1, 'Premier League'], [7, 'Champions League'], [3, 'La Liga'], [4, 'Serie A'], [5, 'Bundesliga'], [6, 'Ligue 1']];

function landingHTML() {
  return `
  <section class="ld-hero">
    <div class="ld-bg" aria-hidden="true">
      <div class="ld-shot" data-ld="shot"></div>
      <div class="ld-scrim"></div>
    </div>
    <div class="wrap ld-hero-in">
      <div class="ld-copy">
        <p class="ld-shout">${esc(landingShout())}</p>
        <h1 class="ld-h1"><span class="ld-l">${esc(LANDING_HEADLINE[0])}</span> <span class="ld-l ld-lit">${esc(LANDING_HEADLINE[1])}</span></h1>
        <p class="ld-lede">${esc(LANDING_LEDE)}</p>
        <div class="ld-actions">
          <a class="btn btn-primary btn-lg ld-go" href="#/board" data-ld="free">Get today’s free call</a>
          <a class="ld-alt" href="#/pricing">or see membership, from £3.49</a>
        </div>
        <p class="ld-assure">Free. No sign-up, no card.</p>
        <div class="ld-proof" data-ld="proof"></div>
        <p class="ld-small">18+. No guaranteed winners, because there’s no such thing.</p>
      </div>
      <aside class="ld-call" data-ld="call" aria-label="Today’s free call"><div class="ld-call-wait"></div></aside>
    </div>
  </section>

  <section class="ld-comps" aria-label="Competitions we cover">
    <div class="wrap ld-comps-in">
      <p>Every big league, and eighty-odd more</p>
      <ul>${LANDING_COMPS.map(([id, name]) => `<li><a href="#/league/${id}">${crest(name, 'sm', id, 'league')}<span>${esc(name)}</span></a></li>`).join('')}
        <li><a class="ld-comps-all" href="#/leagues">All of them</a></li></ul>
    </div>
  </section>

  <section class="wrap ld-sec" data-ld="trap"></section>

  <section class="wrap ld-sec">
    <h2 class="ld-h2">What’s on every match page</h2>
    <p class="ld-sub">Free for every game we cover. Shown here on today’s free call.</p>
    <ol class="ld-gets">${LANDING_GETS.map(([h, p], i) => `
      <li><div class="ld-get-text"><h3>${esc(h)}</h3><p>${esc(p)}</p></div><div class="ld-get-show" data-ld="get-${i}"></div></li>`).join('')}</ol>
  </section>

  <section class="wrap ld-sec" data-ld="record"></section>
  <section class="wrap ld-sec" data-ld="plans"></section>

  <section class="wrap ld-sec ld-faq-sec">
    <h2 class="ld-h2">Straight answers</h2>
    <div class="ld-faq">${LANDING_FAQ.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('')}</div>
  </section>

  <section class="ld-end">
    <div class="wrap ld-end-in">
      <h2 class="ld-h2" data-ld="end-title">Your game’s probably on the board already.</h2>
      <div class="ld-actions">
        <a class="btn btn-primary btn-lg" href="#/board" data-ld="end-go">Get today’s free call</a>
        <a class="ld-alt" href="#/pricing">or see membership, from £3.49</a>
      </div>
    </div>
  </section>`;
}

/**
 * The football in a write-up, without the call: whole sentences, up to about
 * two hundred and fifty characters. A write-up closes on the call and its
 * price ("Back under 3.5 goals, at odds of 1.17"), which the landing page
 * does not carry, so any sentence with a price, a line or the word "odds" in
 * it is left out, and what is left still has to pass the vocabulary rule.
 */
function excerpt(text, max = 260) {
  // A decimal point is not a full stop: hold it while splitting, so "at
  // 1.14. This reads..." does not come out as "14. This reads...", and the
  // sentence holding it is dropped below like any other price.
  const held = String(text ?? '').replace(/(\d)\.(\d)/g, '$1\u2024$2');
  const sentences = held.match(/[^.!?]+[.!?]+(\s|$)/g) ?? [];
  let out = '';
  for (const s of sentences) {
    if (/\d\u2024\d|\bodds\b|\bback(ing)?\b/i.test(s)) continue;
    if ((out + s).length > max && out) break;
    out += s;
  }
  return cleanProse(out.trim()) ?? '';
}

async function viewLanding() {
  const nav = navTicket;
  document.body.dataset.page = 'landing';
  /*
   * Drawn once. A page opened from the saved copy is fetched again behind it
   * and, when anything has changed, routed again (softRefresh); that used to
   * rebuild the landing page from nothing and play the intro a second time,
   * so it looked as if it had loaded twice. When the landing page is already
   * on screen, the sections below are filled in again in place and nothing
   * animates.
   */
  const again = !!app.querySelector('.ld-hero');
  if (!again) app.innerHTML = landingHTML();
  if (!again && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    /*
     * One entrance, at the top: the shout slams on, the headline rises and
     * the second line fills with light from left to right. Nothing below the
     * hero moves.
     */
    const EXPO = 'cubic-bezier(0.16, 1, 0.3, 1)';
    // Quick and light on a phone: transform and opacity only, every delay
    // short, and nothing held once it has played ('backwards' rather than
    // 'both'), so no layer is kept alive after the intro. The blur on the
    // shout, the four floodlight beams and the lamps were the heaviest things
    // on the page to draw and are gone.
    app.querySelector('.ld-shout')?.animate([
      { transform: 'scale(1.6) rotate(-4deg)', opacity: 0 },
      { transform: 'none', opacity: 1 }], { duration: 420, delay: 120, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)', fill: 'backwards' });
    app.querySelectorAll('.ld-l').forEach((l, i) => l.animate([{ transform: 'translateY(30%)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 600, delay: 220 + i * 110, easing: EXPO, fill: 'backwards' }));
    const lit = app.querySelector('.ld-lit');
    if (lit) {
      lit.style.setProperty('background-position', '0% 0');
      lit.animate([{ backgroundPosition: '100% 0' }, { backgroundPosition: '0% 0' }], { duration: 800, delay: 500, easing: 'cubic-bezier(0.65, 0, 0.35, 1)', fill: 'backwards' });
    }
    for (const [sel, d] of [['.ld-lede', 420], ['.ld-actions', 480], ['.ld-proof', 540], ['.ld-small', 580]]) {
      app.querySelector(`.ld-hero ${sel}`)?.animate([{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: 500, delay: d, easing: EXPO, fill: 'backwards' });
    }
  } else {
    app.querySelector('.ld-lit')?.style.setProperty('background-position', '0% 0');
  }

  const [board, hero, picks, plans, sure] = await Promise.all([
    loadBoard().catch(() => null),
    getJSON('/api/hero').catch(() => null),
    getJSON('/api/picks?limit=60&settled=true').then((r) => r.picks ?? []).catch(() => []),
    getJSON('/api/plans').catch(() => []),
    getJSON('/api/how-sure').catch(() => null),
  ]);
  /*
   * The record is the calls we published, and nothing else.
   *
   * It used to splice in the newest engine's replay (lab/record.ts): what it
   * would have called on games played before it went live. Those rows showed
   * "Landed" on matches whose own page, rightly, said "We did not call this
   * one" -- Athletic Club v Sport Recife was one -- and a backtest shown as a
   * track record is a misleading claim. Every number and card here now comes
   * from the pick table, the same rows the results page and the match pages
   * read, so a reader who taps through always finds the call.
   */
  if (nav !== navTicket) return;
  const fixtures = board?.fixtures ?? [];
  const called = fixtures.filter(hasCall).length;
  const put = (key, html) => { const el = app.querySelector(`[data-ld="${key}"]`); if (el) { el.innerHTML = html; smartQuotes(el); } return el; };

  // The trap of the day, where there is one.
  const trap = trapHTML(hero?.trap);
  if (trap) put('trap', trap);
  else app.querySelector('[data-ld="trap"]')?.remove();

  // Today's free call: the match and the reasoning, linked. No pick, no price.
  const freeId = hero?.free_fixture_id ?? fixtures.find((f) => f.free_call)?.id ?? null;
  const freeRow = freeId ? fixtures.find((f) => Number(f.id) === Number(freeId)) : null;
  const detail = freeId ? await getJSON(`/api/fixture/${freeId}`).catch(() => null) : null;
  if (nav !== navTicket) return;
  const fx = detail?.fixture ?? detail ?? freeRow;
  const why = excerpt((fx?.verdicts ?? []).map((v) => v.why ?? v.narrative).find(Boolean));
  const cta = app.querySelector('[data-ld="free"]');
  if (fx && why) {
    for (const a of app.querySelectorAll('[data-ld="free"], [data-ld="end-go"]')) a.setAttribute('href', `#/fixture/${encodeURIComponent(fx.id)}`);
    const endTitle = app.querySelector('[data-ld="end-title"]');
    if (endTitle) endTitle.textContent = `Today’s free call is ${fx.home} v ${fx.away}.`;
    const hex = (c) => (typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c) ? c : null);
    const hc = hex(fx.colors?.home) ?? '#5b4ad6';
    const ac = hex(fx.colors?.away) ?? '#c9334a';
    put('call', `
      <div class="ld-tk-band" style="--home-c:${hc};--away-c:${ac}" aria-hidden="true">
        <div class="ld-tk-h"></div><div class="ld-tk-a"></div><div class="ld-tk-seam"></div>
        <span class="ld-tk-crest ld-tk-ch">${crest(fx.home, 'xl', fx.home_id)}</span>
        <span class="ld-tk-crest ld-tk-ca">${crest(fx.away, 'xl', fx.away_id)}</span>
      </div>
      <div class="ld-tk-perf" aria-hidden="true"></div>
      <div class="ld-tk-body">
        <p class="ld-call-tag">Today’s free call</p>
        <p class="ld-tk-teams"><b>${esc(fx.home)}</b> <em>v</em> <b>${esc(fx.away)}</b></p>
        <p class="ld-tk-meta">${fx.league ? `<span class="ld-tk-comp">${crest(fx.league, 'xs', fx.league_id, 'league')}${esc(fx.league)}</span>` : ''}<span>${esc(kickoffLabel(fx.kickoff))}</span>${fx.kickoff > Date.now() / 1000 ? `<span class="ld-tk-count">Kick-off in <b data-countdown="${Number(fx.kickoff)}" data-done="now">—</b></span>` : ''}</p>
        <blockquote class="ld-call-why">${esc(why)}</blockquote>
        <a class="ld-call-go" href="#/fixture/${encodeURIComponent(fx.id)}">Read the whole call, free</a>
      </div>`);
    const card = app.querySelector('.ld-call');
    if (card && !again && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      // The ticket is handed over: in on a tilt, and the two sides of the
      // band slam together behind the crests.
      card.animate([{ opacity: 0, transform: 'translateY(30px) rotate(3deg) scale(0.96)' }, { opacity: 1, transform: 'rotate(-1deg)', offset: 0.7 }, { opacity: 1, transform: 'none' }], { duration: 1000, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' });
      card.querySelector('.ld-tk-h')?.animate([{ transform: 'translateX(-105%)' }, { transform: 'none' }], { duration: 560, delay: 200, easing: 'cubic-bezier(0.7, 0, 0.84, 0)', fill: 'backwards' });
      card.querySelector('.ld-tk-a')?.animate([{ transform: 'translateX(105%)' }, { transform: 'none' }], { duration: 560, delay: 200, easing: 'cubic-bezier(0.7, 0, 0.84, 0)', fill: 'backwards' });
      card.querySelectorAll('.ld-tk-crest').forEach((c, i) => c.animate([{ transform: `translateX(${i ? '' : '-'}160%) scale(1.4)`, opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 700, delay: 520, easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)', fill: 'backwards' }));
      card.querySelector('.ld-tk-seam')?.animate([{ opacity: 0 }, { opacity: 1, offset: 0.15 }, { opacity: 0.6 }], { duration: 900, delay: 760, fill: 'both' });
    }
    // A Champions League free call brings the competition's night with it,
    // in place of the ground.
    const theme = themeOf(fx.league_id);
    const ldHero = app.querySelector('.ld-hero');
    if (theme && ldHero && !ldHero.classList.contains(`theme-${theme}`)) {
      ldHero.classList.add(`theme-${theme}`);
      app.querySelector('.ld-bg')?.insertAdjacentHTML('afterbegin', themeArt(theme));
    }
    // The ground it is played at, behind the whole hero.
    const shot = theme ? null : app.querySelector('[data-ld="shot"]');
    // The engine names a ground it found a photograph for (shot_venue_id);
    // then the match's own, then the rest of the board's. The browser works
    // down the list until one is a real photograph (venueShot).
    const venues = [...new Set([hero?.shot_venue_id, fx.venue_id, ...fixtures.filter(hasCall).map((f) => f.venue_id), ...fixtures.map((f) => f.venue_id)].filter(Boolean))];
    // Not on a phone: a 200KB photograph shown at under half strength behind
    // a dark scrim, with up to a dozen fallbacks tried in turn, was most of
    // what the landing page downloaded and drew there.
    if (shot && !shot.querySelector('img') && venues.length && matchMedia('(min-width: 900px)').matches) {
      shot.innerHTML = venueShot(venues.slice(0, 4), 'ld-shot-img', true);
      const img = shot.querySelector('img');
      img?.addEventListener('load', () => img.classList.add('is-in'), { once: true });
    }
  } else {
    app.querySelector('.ld-call')?.remove();
    app.querySelector('.ld-hero')?.classList.add('ld-solo');
  }

  // Three numbers, all of them real and all of them pub numbers.
  // The record: the last forty settled calls, oldest first.
  const all = picks.filter((x) => x.result).slice(0, 40).reverse();
  const isW = (x) => x.result === 'WON' || x.result === 'HALF_WON';
  const isL = (x) => x.result === 'LOST' || x.result === 'HALF_LOST';
  const fw = all.filter(isW).length;
  const fl = all.filter(isL).length;
  const chip = (x) => { const k = isW(x) ? 'w' : isL(x) ? 'l' : 'v'; return `<li class="ld-chip is-${k}" title="${esc(`${x.home_team ?? ''} v ${x.away_team ?? ''}`)}">${k.toUpperCase()}</li>`; };

  // Proof beside the button: the record in one line and the last ten.
  if (fw + fl) {
    // Two kinds of proof, both checkable: the record, and that our confidence
    // means something (how-sure). Specific numbers beat adjectives.
    const tenths = sure?.n >= 50 ? Math.round(Number(sure.said) * 10) : 0;
    const honest = tenths && Math.abs(Number(sure.landed) / Number(sure.n) - Number(sure.said)) <= 0.04;
    put('proof', `<ol class="ld-form ld-form-sm" aria-hidden="true">${all.slice(-10).map(chip).join('')}</ol>
      <p><b>${fw} of our last ${fw + fl}</b> calls landed, misses counted. <a href="#/results">See the results</a></p>
      ${honest ? `<p>When we say ${esc(TENTHS[tenths])} in ten, ${esc(TENTHS[tenths])} in ten land. <a href="#/how-sure">How we check</a></p>` : ''}`);
  } else app.querySelector('[data-ld="proof"]')?.remove();

  // What's on every match page, shown on today's free call.
  const side = (k) => (k === 'home' ? fx?.home : fx?.away);
  const out = (fx?.players ?? []).filter((p) => p.status && p.status !== 'fit').slice(0, 3);
  put('get-0', out.length
    ? `<ul class="ld-news">${out.map((p) => `<li><b>${esc(p.name)}</b><span>${esc(p.team ?? side(p.side) ?? '')}</span><em>${esc(p.status === 'doubtful' ? 'Doubt' : 'Out')}</em></li>`).join('')}</ul>`
    : `<p class="ld-show-note">${fx ? `Both squads checked for ${esc(fx.home)} v ${esc(fx.away)}: nobody important missing.` : 'Checked for every game we cover.'}</p>`);
  const seq = (k) => String(fx?.form?.[k]?.sequence ?? '').slice(-6).split('').filter((c) => 'WDL'.includes(c));
  put('get-1', fx && (seq('home').length || seq('away').length)
    ? `<div class="ld-formrows">${['home', 'away'].map((k) => `<div>${crest(side(k), 'xs', fx[`${k}_id`])}<b>${esc(side(k))}</b>
        <ol class="ld-form ld-form-sm" aria-label="${esc(`${side(k)}, last six, oldest first`)}">${seq(k).map((c) => `<li class="ld-chip is-${c === 'W' ? 'w' : c === 'L' ? 'l' : 'v'}">${c}</li>`).join('')}</ol></div>`).join('')}</div>`
    : '<p class="ld-show-note">The last six for both sides, on every match page.</p>');
  put('get-2', fixtures.length
    ? `<p class="ld-bignum"><b>${called}</b><span>of the ${fixtures.length} games on the board have a call right now. The rest get the reasons we passed.</span></p>`
    : '');
  const ago = fx?.computed_at ? Math.max(1, Math.round((Date.now() / 1000 - Number(fx.computed_at)) / 60)) : null;
  put('get-3', ago && ago < 24 * 60
    ? `<p class="ld-bignum"><b>${ago < 60 ? `${ago} min` : `${Math.round(ago / 60)} hr`}</b><span>since we last read ${esc(fx.home)} v ${esc(fx.away)}. Next look within fifteen minutes.</span></p>`
    : '<p class="ld-show-note">Every fifteen minutes, right up to kick-off.</p>');
  app.querySelectorAll('.ld-get-show').forEach((el) => { if (!el.innerHTML.trim()) el.remove(); });

  // The receipts: the call, and how it finished. The latest three, and if
  // none of them missed, the latest miss in place of the third, because a
  // record that only shows wins is an advert. The write-up where the call
  // has one, the call in words where it does not.
  const said = picks.filter((x) => x.result && (isW(x) || isL(x)));
  const shown = said.slice(0, 3);
  if (shown.length === 3 && !shown.some(isL)) { const miss = said.find(isL); if (miss) shown[2] = miss; }
  if (all.length) {
    put('record', `
      <div class="ld-sec-head"><h2 class="ld-h2">The call, then the score.</h2>
        <a class="btn btn-ghost btn-sm" href="#/results">Every result</a></div>
      <p class="ld-sub">Our last ${all.length} calls: ${fw} landed, ${fl} missed. The misses stay in.</p>
      <ol class="ld-form" aria-label="The last ${all.length} calls, oldest first">${all.map(chip).join('')}</ol>
      ${shown.length ? `<ul class="ld-receipts">${shown.map((x) => `
        <li class="${isW(x) ? 'is-w' : 'is-l'}">
          <p class="ld-rc-top"><span class="ld-rc-tag">${isW(x) ? 'Landed' : 'Missed'}</span><span>${esc(new Date(Number(x.kickoff) * 1000).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }))}</span></p>
          <p class="ld-rc-score">${crest(x.home_team, 'xs', x.home_team_id)}<b>${esc(x.home_team)}</b><span class="ld-rc-goals">${Number(x.home_goals)}–${Number(x.away_goals)}</span><b>${esc(x.away_team)}</b>${crest(x.away_team, 'xs', x.away_team_id)}</p>
          ${(() => {
            const text = excerpt(x.narrative ?? x.why, 200);
            return text
              ? `<p class="ld-rc-said"><span>What we said</span>${esc(text)}</p>`
              : `<p class="ld-rc-said"><span>The call</span>${esc(market({ market: x.market, outcome: x.outcome, line: x.line, home: x.home_team, away: x.away_team }).name)}</p>`;
          })()}
          ${(() => {
            const went = wentLine(x);
            return went ? `<p class="ld-rc-went"><span>How it went</span>${esc(went)}</p>` : '';
          })()}
          <a href="#/fixture/${encodeURIComponent(x.fixture_id)}">The match</a>
        </li>`).join('')}</ul>` : ''}`);
  } else app.querySelector('[data-ld="record"]')?.remove();

  // The price per week, which is how a subscription is easiest to weigh
  // against a pint. Only for the plans that run longer than a week.
  const perWeek = (p) => (p.days > 7 ? `About ${money(Math.round(p.amount_minor / (p.days / 7)), p.currency)} a week` : null);
  // The plans, each with its own button. The matchday pass is one payment
  // and stops by itself, which is worth saying where people decide.
  const PLAN = {
    matchday: ['One payment, seven days, and it stops by itself.', 'Get the matchday pass'],
    monthly: ['Thirty days of every call, every big night.', 'Go monthly'],
    quarter: ['Three months, the cheapest way in.', 'Get three months'],
  };
  const list = (Array.isArray(plans) ? plans : []).filter((p) => p && p.amount_minor).sort((a, b) => a.amount_minor - b.amount_minor);
  if (list.length) {
    // What is waiting behind the wall today, counted from the board: a real
    // number, said once, right where the decision is made.
    const behind = Math.max(0, called - 1);
    put('plans', `
      <h2 class="ld-h2">Every call, from ${esc(money(list[0].amount_minor, list[0].currency))}</h2>
      <p class="ld-sub">${behind > 1 ? `${called} calls are up on today’s board. One is free. Members see the other ${behind}, with the odds and the reason, the moment each goes up. ` : ''}The match pages, the free call and the record stay free whatever you do.</p>
      <ul class="ld-plans">${list.map((p) => `
        <li${p.id === 'monthly' ? ' class="is-pick"' : ''}>
          <b>${esc(p.name)}</b>
          <span class="ld-price">${esc(money(p.amount_minor, p.currency))}</span>
          ${perWeek(p) ? `<span class="ld-week">${esc(perWeek(p))}</span>` : ''}
          <span class="ld-blurb">${esc(PLAN[p.id]?.[0] ?? `${p.days} days of every call.`)}</span>
          <a class="btn ${p.id === 'monthly' ? 'btn-primary' : 'btn-ghost'}" href="#/checkout?plan=${encodeURIComponent(p.id)}">${esc(PLAN[p.id]?.[1] ?? `Get ${p.name}`)}</a>
        </li>`).join('')}</ul>`);
  } else app.querySelector('[data-ld="plans"]')?.remove();
  tickCountdowns();
}

async function viewDashboard() {
  // Which navigation this page belongs to: a newer one makes it stand down (see route).
  const nav = navTicket;
  placeholder(heroHTML(state.hero, state.heroVenue) + skeletonHTML('rows'));
  // Everything the page needs, asked for at once. They used to go in three
  // rounds -- board and masthead, then the masthead's bundle, then the record
  // and the slip -- so a cold visit waited on three trips instead of one.
  const picksReq = getJSON('/api/picks?limit=40&settled=true').then((r) => r.picks ?? []).catch(() => []);
  const slipReq = getJSON('/api/slip').catch(() => null);
  let board;
  // The hero endpoint carries the fixture id and little else. The bundle
  // behind it has the table, the form and the head-to-head, none of which is
  // behind the wall. It is asked for the moment the id is known, and the page
  // no longer waits for it: a third round trip before anything drew was most
  // of a cold front page's wait on a phone. It is slotted in when it lands.
  const heroReq = getJSON('/api/hero').catch(() => null);
  const detailReq = heroReq.then((h) => (h?.fixture_id
    ? getJSON(`/api/fixture/${h.fixture_id}`).catch(() => null) : null));
  try {
    [board, state.hero] = await Promise.all([loadBoard(), heroReq]);
    // Already here (a cached read, usually): draw with it. Otherwise without.
    state.heroDetail = await Promise.race([detailReq, new Promise((r) => setTimeout(() => r(null), 60))]);
  } catch (err) {
    return errorState(err, nav);
    return;
  }
  const fixtures = board.fixtures ?? [];
  const withPicks = fixtures.filter((f) => f.top_pick);
  const top = spread(withPicks, 8);

  let recent = [];
  let slip = null;
  // Both optional: a page with no slip and no record still has a board on it.
  [recent, slip] = await Promise.all([picksReq, slipReq]);
  const settled = recent.filter((x) => x.result && x.result !== 'VOID');
  const won = settled.filter((x) => x.result === 'WON' || x.result === 'HALF_WON').length;
  const lost = settled.filter((x) => x.result === 'LOST' || x.result === 'HALF_LOST').length;

  // Grounds hosting today's games, strongest call first. The browser works down
  // the list until one has a photograph, so the masthead is always a real
  // stadium with a real fixture in it tonight.
  state.heroVenue = [...top, ...fixtures].map((f) => f.venue_id).filter(Boolean);

  // What is on next: our calls, then the biggest of the other matches coming
  // up, eight in all. It was calls only, which on a quiet day was one row.
  const rail = () => {
    const pool = fixtures.filter((f) => f.id !== state.hero?.fixture_id);
    const on = (f) => ['live', 'upcoming'].includes(matchState(f).kind);
    const calls = pool.filter((f) => hasCall(f) && on(f));
    const others = pool.filter((f) => !hasCall(f) && on(f))
      .sort((a, b) => (a.rank ?? 9) - (b.rank ?? 9) || (a.kickoff ?? 0) - (b.kickoff ?? 0));
    const next = [...calls, ...others].slice(0, 8);
    return next.length ? next : pool.filter(hasCall);
  };
  // The free call's row, flagged by the board itself.
  const freeFx = fixtures.find((f) => f.free_call && f.top_pick) ?? null;
  let heroRow = state.hero?.fixture_id ? fixtures.find((f) => Number(f.id) === Number(state.hero.fixture_id)) ?? null : null;
  // A headline whose call was withdrawn since the slate chose it (calls are
  // looked at again every fifteen minutes) stands down for the plain
  // masthead rather than lead with a match we no longer have a call on.
  if (heroRow && !hasCall(heroRow) && !heroRow.called && matchState(heroRow).kind === 'upcoming') {
    state.hero = null;
    state.heroDetail = null;
    heroRow = null;
  }
  if (nav !== navTicket) return;
  app.innerHTML =
    `<div data-live="ticker">${tickerHTML(fixtures, recent)}</div>` +
    heroHTML(state.hero, state.heroVenue, state.heroDetail, freeFx, heroRow) +
    freeBandHTML(freeFx, state.hero) +
    `<div data-live="today">${todayStripHTML(fixtures, recent)}</div>` +
    `<div data-live="mine">${yourGamesHTML(fixtures)}</div>` +
    `<div data-live="rail">${nextRailHTML(rail())}</div>` +
    ((t) => (t ? `<div class="wrap section dense">${t}</div>` : ''))(trapHTML(state.hero?.trap, { on: 'home' })) +
    `<div class="wrap section dense">
       <div class="with-side">
         <div class="stack" style="gap:var(--space-9)">
           ${promoHTML(state.user)}
           <div>
             <div class="section-head">
               <div><h2 class="display">How the last ${settled.length} went</h2></div>
               <a class="btn btn-ghost btn-sm" href="#/results">The full record</a>
             </div>
             ${formBarHTML(won, settled.length - won - lost, lost, ['won', 'void', 'lost'],
               `The last ${settled.length} to finish.`)}
             ${playedHTML(settled.slice(0, 16))}
           </div>
         </div>
         ${sideHTML(fixtures, slip)}
       </div>
     </div>`;

  paintTally(fixtures, recent);
  tickCountdowns();
  balanceRecord();

  if (!state.heroDetail && state.hero?.fixture_id) {
    const heroId = state.hero.fixture_id;
    detailReq.then((d) => {
      const inner = app.querySelector('.hero .hero-inner');
      // The space was kept for it (the mc-wait box, its usual height): put in
      // after the first paint, it pushed everything under the masthead down
      // by four hundred pixels on a phone, a layout shift of 0.165.
      const wait = inner?.querySelector('.mc-wait');
      if (!inner || state.hero?.fixture_id !== heroId || (inner.querySelector('.matchcentre') && !wait)) return;
      if (!d) { wait?.remove(); return; }
      state.heroDetail = d;
      if (wait) wait.outerHTML = matchCentreHTML(state.hero, d);
      else inner.insertAdjacentHTML('beforeend', matchCentreHTML(state.hero, d));
      tickCountdowns();
    });
  }

  /*
   * The front page, kept alive while there is something to keep up with.
   *
   * A called match being played, or one kicking off inside the hour, means
   * the ticker, the strip, the rail, the slip and the live block are all about
   * to change. They are redrawn in place once a minute -- the edge caches the
   * board for that long, so anything faster gets the same bytes -- and only
   * while the tab is being looked at. The hero and the record stay as they
   * are; nothing about them moves during a match.
   */
  const busy = () => {
    const now = Date.now() / 1000;
    return fixtures.some((f) => hasCall(f)
      && (matchState(f).kind === 'live' || (f.kickoff > now && f.kickoff - now < 3600)));
  };
  const refresh = async () => {
    if (document.hidden || !busy()) return;
    try {
      const [fresh, picks, slipNow] = await Promise.all([
        loadBoard({ fresh: true }),
        getJSON('/api/picks?limit=40&settled=true', { fresh: true }).then((r) => r.picks ?? []).catch(() => recent),
        getJSON('/api/slip', { fresh: true }).catch(() => slip),
      ]);
      fixtures.length = 0;
      fixtures.push(...(fresh.fixtures ?? []));
      recent = picks;
      slip = slipNow;
      const put = (key, html) => { const el = app.querySelector(`[data-live="${key}"]`); if (el) { el.innerHTML = html; smartQuotes(el); } };
      put('ticker', tickerHTML(fixtures, recent));
      put('today', todayStripHTML(fixtures, recent));
      put('mine', yourGamesHTML(fixtures));
      put('rail', nextRailHTML(rail()));
      put('live', liveNowHTML(fixtures));
      put('slip', slipHTML(slip, fixtures));
      paintTally(fixtures, recent);
      tickCountdowns();
    } catch { /* the last good frame stays up */ }
  };
  state.poll = setInterval(refresh, 60000);
  state.onVisible = () => { if (!document.hidden) refresh(); };
  addEventListener('visibilitychange', state.onVisible);
}

/**
 * Today, counted.
 *
 * Every called match with today's date on it, keyed by fixture: the board's
 * rows first, because they carry the running score and the record's grade
 * once there is one, then the settled record for anything that has already
 * dropped off the back of the board. One count feeds the strip on the front
 * page and the tally in the header, so the two cannot disagree.
 */
function todayTally(fixtures, recent) {
  const today = new Date().toDateString();
  const isToday = (epoch) => new Date(epoch * 1000).toDateString() === today;
  const GRADE = { WON: 'won', HALF_WON: 'won', LOST: 'lost', HALF_LOST: 'lost' };
  const seen = new Set();
  const t = { calls: 0, live: 0, onTrack: 0, landed: 0, missed: 0, run: 0, recentWon: 0, recentN: 0 };
  for (const f of fixtures ?? []) {
    if (!hasCall(f) || !isToday(f.kickoff)) continue;
    seen.add(Number(f.id));
    t.calls++;
    const st = matchState(f);
    const pick = f.top_pick;
    if (st.kind === 'live') {
      t.live++;
      if (liveTrack(pick, f)?.on) t.onTrack++;
    } else if (st.kind === 'ft' && pick && Array.isArray(f.score)) {
      const r = GRADE[pick.result] ?? didItLand({ market: pick.market, outcome: pick.outcome, line: pick.line,
                                                   homeGoals: f.score[0], awayGoals: f.score[1] });
      if (r === 'won') t.landed++;
      else if (r === 'lost') t.missed++;
    }
  }
  for (const x of recent ?? []) {
    if (!isToday(x.kickoff) || seen.has(Number(x.fixture_id))) continue;
    const r = GRADE[x.result];
    if (!r) continue;
    seen.add(Number(x.fixture_id));
    t.calls++;
    if (r === 'won') t.landed++; else t.missed++;
  }
  // The run: how many of the most recent settled calls landed in a row. A
  // stake returned sits out; the count stops at the first miss.
  const settled = [...(recent ?? [])]
    .filter((x) => GRADE[x.result])
    .sort((a, b) => (b.kickoff ?? 0) - (a.kickoff ?? 0));
  for (const x of settled) { if (GRADE[x.result] === 'won') t.run++; else break; }
  t.recentN = settled.length;
  t.recentWon = settled.filter((x) => GRADE[x.result] === 'won').length;
  return t;
}

/**
 * Today so far, in figures, under the masthead.
 *
 * Calls up, on now, landed, missed, and the run -- the numbers a reader
 * checking in on a match day wants before anything else. Every one is a
 * count, every one is a link to the rows it counts, and it is not drawn at all
 * on a day with nothing to count.
 */
function todayStripHTML(fixtures, recent) {
  const t = todayTally(fixtures, recent);
  if (!t.calls && !t.live && !t.landed && !t.missed && !t.recentN) return '';
  const fig = (n, cls = '') => `<b class="fig${cls ? ` ${cls}` : ''}">${esc(n)}</b>`;
  const link = (href, html) => `<a href="${href}">${html}</a>`;
  const sentences = [];
  const since = [];
  if (t.landed) since.push(link('#/board?when=played', `${fig(t.landed, 'won')} landed`));
  if (t.missed) since.push(link('#/board?when=played', `${fig(t.missed, 'lost')} missed`));
  if (t.live) since.push(link('#/board?when=live', `${fig(t.live, 'now')} ${t.live === 1 ? 'is' : 'are'} being played${t.onTrack ? `, ${t.onTrack} on track` : ''}`));
  if (t.calls) {
    sentences.push(`${link('#/board', `${fig(t.calls)} ${t.calls === 1 ? 'call' : 'calls'} today`)}${since.length ? `: ${andList(since)}.` : '.'}`);
  } else if (since.length) {
    sentences.push(`Today, ${andList(since)}.`);
  }
  if (t.run >= 2) sentences.push(link('#/results', `The last ${fig(t.run, 'run')} in a row landed.`));
  else if (t.recentN) sentences.push(link('#/results', `${fig(t.recentWon, 'won')} of the last ${t.recentN} landed.`));
  return `<div class="wrap"><p class="figure-line" aria-label="Today so far">${sentences.join(' ')}</p></div>`;
}

/** The header's version of the same count: landed and missed today. */
function paintTally(fixtures, recent) {
  const el = document.getElementById('tally');
  if (!el) return;
  const t = todayTally(fixtures, recent);
  const parts = [];
  if (t.landed) parts.push(`<b class="won">${t.landed}</b> landed`);
  if (t.missed) parts.push(`<b>${t.missed}</b> missed`);
  if (!parts.length && t.live) parts.push(`<b class="live">${t.live}</b> on now`);
  el.hidden = !parts.length;
  el.innerHTML = parts.length ? `${parts.join(', ')} today` : '';
}

/**
 * A back link.
 *
 * It used to be the character `←` typed into the label, which is the same
 * mistake as `→` on a call to action: a glyph doing an icon's job, at whatever
 * size and weight the text around it happens to be, with a screen reader
 * announcing "left arrow back to the board".
 */
/**
 * The countdown, ticking.
 *
 * One interval for the page rather than one per element, cleared by the router
 * before it renders anything else — a timer left running after a route change
 * writes into a node that is no longer in the document, and the leak only shows
 * up after a reader has moved around for a while.
 */
function tickCountdowns() {
  clearInterval(state.tick);
  const paint = () => {
    const nodes = app.querySelectorAll('[data-countdown]');
    if (!nodes.length) { clearInterval(state.tick); return; }
    for (const el of nodes) {
      const left = Number(el.dataset.countdown) * 1000 - Date.now();
      if (left <= 0) { el.textContent = el.dataset.done ?? 'Under way'; el.classList.add('live'); continue; }
      const s = Math.floor(left / 1000);
      const d = Math.floor(s / 86400);
      const h = Math.floor((s % 86400) / 3600);
      const m = Math.floor((s % 3600) / 60);
      el.textContent = d > 0
        ? `${d}d ${String(h).padStart(2, '0')}h`
        : `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
    }
  };
  paint();
  state.tick = setInterval(paint, 1000);
}

function backHTML(label) {
  return `<button class="back" type="button">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>
    ${esc(label)}
  </button>`;
}

// ------------------------------------------------------------------ board

async function viewBoard(params = new URLSearchParams()) {
  // Which navigation this page belongs to: a newer one makes it stand down (see route).
  const nav = navTicket;
  // The filters live in the URL, so a filtered board survives a reload and can
  // be sent to someone. They used to live only in `state`, which meant the one
  // thing a reader would want to share -- "the La Liga card for the next two
  // days" -- was the one thing they could not.
  const hours = Number(params.get('hours'));
  state.hours = [24, 48, 72, 120, 240].includes(hours) ? hours : 72;
  // The address is the whole filter. A competition chosen earlier used to
  // stay on invisibly, so "Picks" from the menu opened on one league's
  // games with nothing on screen saying so.
  state.leagueName = params.get('league') ?? '';
  if (params.has('when')) {
    const w = params.get('when');
    state.when = WHEN.some((x) => x.id === w) ? w : 'upcoming';
  }

  placeholder(`<div class="wrap section dense">
    <div class="rows">${'<div class="skeleton skeleton-row"></div>'.repeat(8)}</div>
  </div>`);
  let board;
  try { board = await loadBoard(); } catch (err) {
    return errorState(err, nav);
    return;
  }
  /*
   * Every match we read, not only the ones we called.
   *
   * The board was calls only, which on a strict day (and on an international
   * break) meant one row under "To play" on a board that had read a hundred
   * and sixty matches, and a red "Live 3" in the header that opened onto one
   * live match or none. Now the calls lead, and every other match follows
   * under them as a single line that opens its preview, team news and form.
   */
  const fixtures = board.fixtures ?? [];
  const leagues = [...new Set(fixtures.map((f) => f.league).filter(Boolean))].sort();

  /*
   * How far the board actually reaches, which is not the same as the window
   * asked for.
   *
   * `get_board` takes the first 300 rows and counts them afterwards, so on a
   * busy weekend "next 240 hours" and "next 48 hours" return the same three
   * hundred games and the API's own `count` says 300 either way. The filter
   * then looks broken, because from the reader's side it is. Naming the last
   * kick-off says what they are really looking at, and it reads correctly on a
   * quiet Tuesday when the window is the thing doing the limiting.
   */
  /*
   * Three states, counted, so the control can say how much is behind each one
   * and grey out the one with nothing in it. A tab that leads to an empty page
   * is worse than no tab.
   */
  const whenOf = (f) => {
    const k = matchState(f).kind;
    if (k === 'live') return 'live';
    // A postponed or abandoned match has not been played, so it does not
    // belong under "already played" -- it was being counted there, and the
    // lede counted it too. It sits with the games still to come, where the
    // card's own "Postponed" badge says the rest.
    if (k === 'upcoming' || k === 'off') return 'upcoming';
    return 'played';
  };
  /*
   * The counts on the tabs are for what the reader has chosen. They were
   * for the whole board whatever the competition filter said, so "To play 1"
   * sat over an empty page with one league picked, and the obvious reading
   * was that the filters were broken.
   */
  const inLeague = (f) => !state.leagueName || f.league === state.leagueName;
  const counts = { upcoming: 0, live: 0, played: 0 };
  const recount = () => {
    for (const k of Object.keys(counts)) counts[k] = 0;
    for (const f of fixtures) if (inLeague(f)) counts[whenOf(f)]++;
  };
  recount();

  /*
   * Land on a page with something on it.
   *
   * The rule used to be "a tab with fixtures in it", which is not the same
   * question the board is being asked. The board opens on games we have a call
   * on, so late in the evening -- when everything still to play is tomorrow and
   * we have called none of it yet -- it opened on "To play", filtered to calls,
   * and rendered nothing at all under the line "0 calls across 51 games". The
   * front page of the product, empty, while thirty-eight called games sat one
   * tap away under "Played".
   *
   * The same thing happened coming in from the leagues page: a link to Serie A
   * landed on "To play", where Serie A had nothing, having just been told on
   * the previous page that Serie A had calls.
   *
   * So the landing tab is chosen against what the reader will actually be
   * shown -- the when filter and the league filter and the calls filter
   * together -- and only falls back to bare fixture counts if nothing anywhere
   * satisfies all three. An address that names a tab is still obeyed; this
   * only decides where an unspecified board opens.
   */
  // An address that names a tab is obeyed even when the tab is empty: the
  // empty page then says why and offers the way out, rather than the board
  // quietly moving the reader somewhere they did not ask to go.
  const ORDER = ['upcoming', 'live', 'played'];
  if (!params.has('when')) state.when = ORDER.find((w) => counts[w]) ?? 'upcoming';

  /*
   * The competition list, for the tab being looked at: the ones with calls
   * in it first, most first, each with its number; the rest after them,
   * greyed, so a reader can see before choosing that a league has nothing
   * here right now.
   */
  const leagueOptions = () => {
    const n = new Map();
    for (const f of fixtures) if (whenOf(f) === state.when) n.set(f.league, (n.get(f.league) ?? 0) + 1);
    const names = [...new Set([...leagues, ...(state.leagueName ? [state.leagueName] : [])])]
      .sort((a, b) => (n.get(b) ?? 0) - (n.get(a) ?? 0) || a.localeCompare(b));
    const all = [...n.values()].reduce((a, b) => a + b, 0);
    return `<option value="" data-meta="${all}"${state.leagueName ? '' : ' selected'}>All competitions</option>`
      + names.map((l) => {
        const c = n.get(l) ?? 0;
        return `<option value="${esc(l)}"${l === state.leagueName ? ' selected' : ''} data-meta="${c}"${c ? '' : ' data-dim'}>${esc(l)}</option>`;
      }).join('');
  };
  const WHEN_WORDS = { upcoming: 'still to play', live: 'being played', played: 'already played' };
  const windowWords = () => (state.hours <= 48 ? `next ${state.hours} hours` : `next ${state.hours / 24} days`);
  // Said once, under the bar, when the board moved the reader or a filter is on.
  let moved = null;
  // Competitions opened in full with "Show all", kept open across repaints.
  const openGroups = new Set();

  const kickoffs = fixtures.map((f) => f.kickoff).filter(Boolean);
  const furthest = kickoffs.length ? Math.max(...kickoffs) : null;
  const capped = furthest !== null && furthest < Date.now() / 1000 + (state.hours - 6) * 3600;

  if (nav !== navTicket) return;
  app.innerHTML = `
  <div class="wrap section dense">
    <div class="section-head">
      <div>
        <h1 class="display">The board</h1>
        <!-- Written by paint(), from what is actually on screen. See ledeFor. -->
        <p id="board-lede"></p>
        ${CALLS_NOTE}
      </div>
    </div>
    <!--
      The board's primary axis is time, not whether we fancied it.
      "With a call / Everything" was in this slot and it answered a
      question nobody arrives with; what a reader wants first is today's
      games, what is on right now, and what has already finished. That was
      the one thing the board could not do: everything played dropped off
      after six hours, so by the evening the page could say what was coming
      and not what had happened.

      Tabs on a rule, the current one underlined in violet: the same mark the
      header uses for the page you are on, so the two read as one system. It
      was a white pill in a grey trough, the header's old look.
    -->
    <div class="board-bar">
      <div class="when-tabs" role="tablist" aria-label="When">
        ${WHEN.map((w) => `
          <button type="button" role="tab" data-when="${w.id}" aria-selected="${state.when === w.id}"${state.when === w.id ? ' class="on"' : ''}
            ${counts[w.id] ? '' : 'disabled'}>${w.id === 'live' ? '<span class="wt-dot" aria-hidden="true"></span>' : ''}${esc(w.label)} <i>${counts[w.id]}</i></button>`).join('')}
      </div>
      <div class="board-picks">
        <select id="hours-filter" aria-label="Time window" data-icon="clock" data-title="How far ahead">
          ${[24, 48, 72, 120, 240].map((h) => `<option value="${h}"${h === state.hours ? ' selected' : ''}>${h <= 48 ? `Next ${h} hours` : `Next ${h / 24} days`}</option>`).join('')}
        </select>
        <select id="league-filter" aria-label="Competition" data-icon="cup" data-title="Competition">
          ${leagueOptions()}
        </select>
      </div>
    </div>
    <p class="board-note" id="board-note" hidden></p>
    <div class="rows" id="grid"></div>
    ${capped ? `<p class="board-foot">That is everything the board carries today.
      A longer window will not add to it until more fixtures are published.</p>` : ''}
  </div>`;

  /*
   * Grouped by competition, which is how every board a reader has ever used is
   * laid out. Ungrouped, three hundred fixtures across forty-four leagues is a
   * list with no landmarks in it — and it meant every row had to carry its own
   * competition badge to say where it was.
   */
  /*
   * A sentence about the page you are looking at.
   *
   * It used to be computed once, over every fixture the API returned, and then
   * never touched again -- so a reader on "Played", filtered to La Liga, with
   * only called games showing, was told "43 calls across 250 games, the last of
   * them kicks off Wednesday" about thirty-nine matches that had all finished.
   * Every clause of that was wrong: the count, the total, and the tense.
   *
   * So it is written by paint(), from the same list the rows are built from,
   * and the tense follows the tab.
   */
  const ledeFor = (inTab) => {
    const n = inTab.length;
    if (!n) return '';
    const called = inTab.filter(hasCall);
    const c = called.length;
    const where = state.leagueName ? ` in ${state.leagueName}` : '';
    const games = (w) => `${n === 1 ? 'the one match' : `the ${n} matches`}${where} ${w}`;
    const calls = c === 0 ? 'No call yet' : c === 1 ? 'One call' : `${c} calls`;

    if (state.when === 'live') return `${calls} on ${games('being played')} right now.`;

    if (state.when === 'played') {
      // Counted from the record's grade, the same one the results page prints.
      const GRADE = { WON: 'won', HALF_WON: 'won', LOST: 'lost', HALF_LOST: 'lost' };
      let landed = 0;
      let judged = 0;
      for (const f of called) {
        const pk = f.top_pick;
        if (!pk) continue;
        const r = GRADE[pk.result] ?? (Array.isArray(f.score)
          ? didItLand({ market: pk.market, outcome: pk.outcome, line: pk.line,
                        homeGoals: f.score[0], awayGoals: f.score[1] })
          : null);
        if (r !== 'won' && r !== 'lost') continue;
        judged++;
        if (r === 'won') landed++;
      }
      return `${c ? calls : 'No call'} on ${games('already played')}.${judged ? ` ${landed} of ${judged} landed.` : ''}`;
    }

    const next = called.map((f) => f.kickoff).filter(Boolean);
    const last = next.length ? Math.max(...next) : null;
    return `${calls} on ${games('still to play')}.${
      last ? ` The last call kicks off ${/^(Today|Tomorrow)$/.test(dayLabel(last)) ? dayLabel(last).toLowerCase() : `on ${dayLabel(last)}`}.` : ''}`;
  };

  const paint = () => {
    let inTab = fixtures.filter((f) => whenOf(f) === state.when);
    if (state.leagueName) inTab = inTab.filter((f) => f.league === state.leagueName);
    document.getElementById('board-lede').textContent = ledeFor(inTab);

    const shown = inTab;

    /*
     * Live, then to come, then done.
     *
     * Kick-off order alone put a finished match at the top of every league
     * block, because a finished match is the one that kicked off first. On a
     * board headed "Next 72h" the first thing in every group was a game that
     * had already been played.
     */
    const rank = (f) => {
      const k = matchState(f).kind;
      return k === 'live' ? 0 : k === 'upcoming' ? 1 : 2;
    };
    const order = (a, b) => {
      const d = rank(a) - rank(b);
      if (d) return d;
      // Finished games read newest first; everything else soonest first.
      return rank(a) === 2 ? (b.kickoff ?? 0) - (a.kickoff ?? 0) : (a.kickoff ?? 0) - (b.kickoff ?? 0);
    };

    const groupBy = (list) => {
      const groups = new Map();
      for (const f of list) {
        const key = f.league ?? 'Other';
        if (!groups.has(key)) groups.set(key, { id: f.league_id, rank: f.rank ?? 9, list: [] });
        const g = groups.get(key);
        g.rank = Math.min(g.rank, f.rank ?? 9);
        g.list.push(f);
      }
      for (const g of groups.values()) g.list.sort(order);
      return [...groups.entries()];
    };
    // The calls: the competitions lead with whoever is on next.
    const called = shown.filter(hasCall);
    const callGroups = groupBy(called).sort((a, b) => order(a[1].list[0], b[1].list[0]));
    // The rest: the bigger competitions first, then whoever is on next.
    const rest = shown.filter((f) => !hasCall(f));
    const restGroups = groupBy(rest).sort((a, b) => a[1].rank - b[1].rank || order(a[1].list[0], b[1].list[0]));
    // Calls are shown in full. Every other competition shows its first five,
    // then a button for the rest, so fifty-six club friendlies do not push
    // the rest of the board off the bottom of a phone.
    const FIRST = 5;
    const block = ([name, g], unit) => {
      const cut = unit === 'game' && g.list.length > FIRST + 1 && !openGroups.has(name);
      return `
            <section class="league-block">
              <h3 class="league-head">
                ${g.id ? `<a href="#/league/${encodeURIComponent(g.id)}">${crest(name, 'xs', g.id, 'league')}${esc(name)}</a>`
                       : `${crest(name, 'xs', g.id, 'league')}${esc(name)}`}
                <span class="count">${g.list.length} ${g.list.length === 1 ? unit : `${unit}s`}</span>
              </h3>
              ${(cut ? g.list.slice(0, FIRST) : g.list).map(rowHTML).join('')}
              ${cut ? `<button type="button" class="league-more" data-more="${esc(name)}">Show all ${g.list.length} ${esc(name)} games</button>` : ''}
            </section>`;
    };

    const note = document.getElementById('board-note');
    if (state.leagueName) {
      note.innerHTML = `${moved ? `${esc(state.leagueName)} has nothing ${esc(WHEN_WORDS[moved])}, so this is what it has ${esc(WHEN_WORDS[state.when])}. ` : `Only ${esc(state.leagueName)}. `}<button type="button" data-clear-league>Show every competition</button>`;
      note.hidden = false;
    } else {
      note.hidden = true;
    }

    // Where else there is something, for the empty page's buttons.
    const elsewhere = ORDER.filter((w) => w !== state.when && counts[w]);
    document.getElementById('grid').innerHTML =
      !shown.length && fixtures.length
        ? `<div class="empty-state"><b>Nothing ${esc(WHEN_WORDS[state.when])}${state.leagueName ? ` from ${esc(state.leagueName)}` : ''} in the ${esc(windowWords())}</b>
             <span>${state.leagueName ? 'Other competitions may have games, or this one may have some in another tab.' : 'Nothing in this window yet. Games go up as the fixtures are confirmed.'}</span>
             <p class="member-actions co-center">
               ${elsewhere.map((w) => `<button type="button" class="btn btn-primary" data-go-when="${w}">${esc(WHEN.find((x) => x.id === w).label)} (${counts[w]})</button>`).join('')}
               ${state.leagueName ? '<button type="button" class="btn btn-ghost" data-clear-league>Every competition</button>' : ''}
               ${!elsewhere.length && state.hours < 240 ? '<button type="button" class="btn btn-ghost" data-hours="240">Look ten days ahead</button>' : ''}
             </p></div>`
      : shown.length
        ? `${callGroups.map((g) => block(g, 'call')).join('')}${
            !called.length ? `<p class="board-none">No call on any of these${state.when === 'played' ? '' : ' yet'}.${
              state.when === 'upcoming' ? ' Calls go up through the day as team news lands and prices settle, right up to kick-off.' : ''}</p>` : ''}${
            rest.length ? `
            <div class="board-rest">
              <h2 class="board-sub">${called.length ? 'Every other game we looked at' : 'Every game we looked at'}</h2>
              <p class="board-sub-note">${state.when === 'played' ? 'We passed on these.' : 'Nothing here was strong enough to back, so each carries our read instead: what we think happens, free, with no price, because we would not bet it.'} The preview, team news and form are on each match's page.</p>
              ${restGroups.map((g) => block(g, 'game')).join('')}
            </div>` : ''}`
        : fixtures.length
          ? `<div class="empty-state"><b>No calls here yet</b>
               <span>We only put a match on the board when we have something to say
               about it. Try another tab or league above.</span></div>`
          // Nothing called anywhere. Say so once, and point at the record
          // rather than at three greyed-out tabs.
          : `<div class="empty-state"><b>No open calls right now</b>
               <span>Calls go up through the day as team news lands and prices
               settle. Every call we have made so far, and how it went, is on the
               results page.</span>
               <a class="btn btn-primary" href="#/results">See the results</a></div>`;
  };

  const tabs = () => app.querySelectorAll('.when-tabs button');
  const leagueSel = document.getElementById('league-filter');
  const syncTabs = () => {
    for (const b of tabs()) {
      const on = b.dataset.when === state.when;
      b.classList.toggle('on', on);
      b.setAttribute('aria-selected', String(on));
      b.querySelector('i').textContent = counts[b.dataset.when] ?? 0;
      b.disabled = !counts[b.dataset.when] && !on;
    }
    // The competition list is counted for this tab, so it follows it.
    leagueSel.innerHTML = leagueOptions();
    leagueSel.dispatchEvent(new Event('sync'));
  };
  const setWhen = (w) => {
    state.when = w;
    moved = null;
    history.replaceState(null, '', boardHash());
    syncTabs();
    paint();
  };
  for (const b of tabs()) b.onclick = () => setWhen(b.dataset.when);

  // A longer window needs the board fetched again, so it goes through the
  // router, and it keeps the tab and the competition exactly as they were:
  // it used to drop the tab, and the board reopened wherever the first
  // game happened to be, which was usually "Played".
  const reopen = (h) => {
    const q = new URLSearchParams();
    if (h !== 72) q.set('hours', String(h));
    if (state.leagueName) q.set('league', state.leagueName);
    q.set('when', state.when);
    location.hash = `#/board?${q}`;
  };
  document.getElementById('hours-filter').onchange = (e) => reopen(Number(e.target.value));

  // A competition is a filter over what is already here, so it repaints in
  // place. If it has nothing in the tab being looked at, the board goes to
  // the tab where it does, and the note under the bar says so.
  const setLeague = (name) => {
    state.leagueName = name;
    recount();
    moved = null;
    if (!counts[state.when]) {
      const to = ORDER.find((w) => counts[w]);
      if (to) { moved = state.when; state.when = to; }
    }
    history.replaceState(null, '', boardHash());
    syncTabs();
    paint();
  };
  leagueSel.onchange = (e) => setLeague(e.target.value);

  app.querySelector('.section.dense').addEventListener('click', (e) => {
    if (e.target.closest('[data-clear-league]')) setLeague('');
    const w = e.target.closest('[data-go-when]');
    if (w) setWhen(w.dataset.goWhen);
    const h = e.target.closest('[data-hours]');
    if (h) reopen(Number(h.dataset.hours));
    const more = e.target.closest('[data-more]');
    if (more) { openGroups.add(more.dataset.more); paint(); }
  });
  syncTabs();
  paint();

  /*
   * The live tab, kept alive.
   *
   * The board was fetched once when the page rendered and never again, so a
   * reader who opened "Live" and watched it watched a still photograph: the
   * scores never moved, matches that finished stayed under way, and one that
   * kicked off never appeared. A page with a red dot on it that does not
   * change is worse than one without.
   *
   * A minute, because that is what the response is cached for at the edge --
   * anything faster is served the same bytes -- and only while this tab is the
   * one being looked at. The router clears it on the way out, and a backgrounded
   * tab stops asking, because nobody is reading it.
   */
  const refresh = async () => {
    if (document.hidden || state.when !== 'live') return;
    try {
      const fresh = await loadBoard({ fresh: true });
      fixtures.length = 0;
      fixtures.push(...(fresh.fixtures ?? []));
      recount();
      syncTabs();
      paint();
    } catch { /* a failed refresh leaves the last good board on screen */ }
  };
  state.poll = setInterval(refresh, 60000);
  // Coming back to a backgrounded tab should not mean waiting up to a minute
  // for the first honest frame. Stored on `state` so the router can take it
  // off again -- an anonymous listener here would leave one behind per visit
  // to the board, all of them firing.
  state.onVisible = () => { if (!document.hidden) refresh(); };
  addEventListener('visibilitychange', state.onVisible);
}

// ---------------------------------------------------------------- fixture

/**
 * The call, on the fixture page.
 *
 * What this used to show, and no longer does: the class we file it under, our
 * own probability, the bookmaker's implied one, what it returns "in the pound",
 * and a paragraph explaining that the call agrees with the bookmakers and is
 * therefore not worth much. That last one was actively talking the reader out
 * of it. All of it was our vocabulary, none of it was theirs.
 *
 * What it shows instead: the call, what has to happen for it to land, the price
 * and who is offering it, the reasoning, and — where the market has one — the
 * table of what each result does, because a quarter-line handicap cannot be
 * explained in a sentence.
 */
/**
 * The wall.
 *
 * Placed where the call would have been, directly under the reasoning, because
 * that is the moment it is worth anything: a reader who has just been argued
 * into caring about a match is in a different position from one shown a price
 * before they have read a word. It states what is behind it and what it costs,
 * and it does not nag.
 */
function lockedHTML(fixture = null) {
  // Kick-off closes the call. Nothing is sold once a match is on, so the offer
  // gives way to what happens next: it is graded, and shown, at full time.
  if (fixture?.kickoff && matchState(fixture).kind === 'live') {
    return `
  <div class="locked is-closed">
    <div class="locked-body">
      <b>Closed at kick-off.</b>
      <p>Calls are not sold once a match is on. This one goes up here at full time, with whether it landed.</p>
    </div>
  </div>`;
  }
  const n = Number(fixture?.locked_calls) || 0;
  const tie = fixture?.home && fixture?.away
    ? `${fixture.home} v ${fixture.away}`
    : 'this match';
  // Name the match and say how many calls are on it. A wall that states what
  // it is holding is a different proposition from one that states only that it
  // is shut, and the count gives nothing away: no market, no side, no price.
  const head = n > 1
    ? `${n} calls on ${tie} are in.`
    : `Our call on ${tie} is in.`;
  // The deadline is real: a call closes at kick-off and is never sold after,
  // so saying when is information, not pressure.
  const ko = Number(fixture?.kickoff) || 0;
  const soon = ko > Date.now() / 1000 && ko - Date.now() / 1000 < 2 * 86400;

  return `
  <div class="locked">
    <div class="locked-body">
      <b>${esc(head)}</b>
      <p>Which market, which side, the odds and the book offering it, with why we back it.
         The reading above is free, and so is one call a day on the front page.</p>
      ${soon ? `<p class="locked-when">Closes at kick-off, in <span data-countdown="${ko}" data-done="now">—</span>.</p>` : ''}
    </div>
    <a class="btn btn-accent" href="#/pricing" data-public-price>See it: from £3.49 for the week</a>
  </div>`;
}

/**
 * One published call.
 *
 * `when` carries whether the match has been played and the scoreline if it
 * has. That is the difference between a page offering something and a page
 * reporting something, and almost every line below turns on it: a price that
 * can no longer be taken is history, not an offer; "backing this returns" is
 * a promise about a game that is over; and the one thing a reader wants from
 * a finished match -- did it come in -- was nowhere on the page at all.
 */
function verdictHTML(v, home, away, fixture = null, when = {}) {
  const played = !!when.played;
  const hg = when.hg ?? null;
  const ag = when.ag ?? null;

  // A free copy keeps the narrative and drops the selection, so a verdict can
  // arrive with everything except the thing being sold. The wall itself is
  // rendered once by the caller, however many of these there are.
  if (!v.candidate) {
    return v.narrative
      ? `<div class="verdict"><p class="narrative">${(fixture?._link ?? ((h) => h))(esc(v.narrative))}</p></div>`
      : '';
  }

  const c = v.candidate;
  /*
   * The same gate the results page uses. Older write-ups were assembled from
   * templates and read "The model reads this as a 2.63-goal match ... We make
   * it 80% at 1.18" -- every banned term in one paragraph. The results page
   * already withheld them; this page printed them raw. The call's own odds
   * and line are the only figures a paragraph may carry.
   */
  const allowedFigures = [dec(c.odds), String(c.odds), c.line, String(c.line ?? '')];
  // A paragraph that states the call's price is a template write-up: they all
  // open "Double chance X2 at 1.31." and go on in the engine's voice ("the
  // market has read it the same way"). The written preview never mentions
  // odds -- that is what lets it be free -- so a bare price is the tell.
  const templated = new RegExp(`\\b(?:at|priced)\\s+${dec(c.odds).replace('.', '\\.')}\\b`).test(String(v.narrative ?? ''));
  const prose = templated ? null : cleanProse(v.narrative, allowedFigures);
  const why = cleanProse(v.why ?? v.record?.why, allowedFigures);
  const link = fixture?._link ?? ((h) => h);
  const p = localPrice(c.prices ?? [{ slug: '', book: c.bookmaker, odds: c.odds }]);
  const odds = p ? p.odds : c.odds;
  const d = market({
    market: c.market, outcome: c.outcome, line: c.line,
    home, away, odds,
  });

  // Derived here rather than stored: the bundle is written before kick-off, so
  // it cannot carry a result. The scoreline can, and `didItLand` is the same
  // reading the results page uses. Corners and cards return null -- they settle
  // from numbers this page never receives -- and a null says nothing rather
  // than guessing.
  // The stored grade first, because it is the one the results page prints;
  // the scoreline only where the record has not graded it yet.
  const GRADE = { WON: 'won', LOST: 'lost', HALF_WON: 'part', HALF_LOST: 'part', PUSH: 'back', VOID: 'back' };
  const stored = v.record?.result ? GRADE[v.record.result] ?? null : null;
  const landed = stored ?? (played && hg !== null && ag !== null
    ? didItLand({ market: c.market, outcome: c.outcome, line: c.line, homeGoals: hg, awayGoals: ag })
    : null);
  const VERDICT_WORD = { won: 'Landed', lost: 'Did not land', part: 'Half back', back: 'Stake back' };
  // While the match is on: where the call stands against the running score.
  const track = landed ? null : liveTrack(c, fixture);
  const story = landed
    ? recap({ market: c.market, outcome: c.outcome, line: c.line, home, away,
              homeGoals: hg, awayGoals: ag,
              result: landed === 'won' ? 'WON' : landed === 'lost' ? 'LOST'
                : landed === 'part' ? 'HALF_WON' : 'PUSH' })
    : null;

  return `
  <div class="verdict${landed ? ` settled ${landed}` : ''}${!played && isMember() && !isFreeFixture(fixture?.id) ? ' is-members' : ''}">
    ${played || landed ? '' : isFreeFixture(fixture?.id) || fixture?.free_call
      ? '<span class="row-kind is-free">Free call today: open to everyone</span>'
      : `<span class="row-kind is-members"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10V7a5 5 0 0 1 10 0v3"/><rect x="4" y="10" width="16" height="10" rx="2"/></svg>Members' call</span>`}
    <div class="verdict-head">
      <span class="sel">${esc(d.name)}</span>
      ${landed
        ? `<span class="mark ${landed}">${esc(VERDICT_WORD[landed] ?? '')}</span>`
        : `<span class="price">${showOdds(odds)}<small>odds</small></span>`}
    </div>
    ${landed
      ? `<p class="wins">${esc(story ?? d.wins)}</p>`
      : `<p class="wins">${esc(d.wins)}</p>`}
    ${landed && v.record?.postmortem ? postMortemHTML({ postmortem_json: v.record.postmortem }) : ''}
    ${track ? `<p class="track-line">${trackHTML(track)}<span>${esc(track.need)} It’s ${esc(track.score)}. ${esc(track.time)}</span></p>` : ''}
    ${prose ? `<p class="narrative">${link(esc(prose))}</p>` : ''}
    ${why ? `<div class="why"><p class="why-head">Why this call</p><p>${link(esc(why))}</p></div>` : ''}
    ${played && (prose || why) ? `<p class="aside">Written before kick-off, and left as it was.</p>` : ''}
    <div class="verdict-meta">
      ${fixture?.id ? (() => {
        const url = matchUrl(fixture.id, home, away);
        const tie = `${home} v ${away}`;
        const text = landed
          ? `${VERDICT_WORD[landed] ?? 'Settled'}: ${d.name}, at odds of ${Number(c.odds).toFixed(2)}. ${home} ${hg}–${ag} ${away}.`
          : isFreeFixture(fixture.id) || !isMember()
            ? `Today's free call on ${tie}: ${d.name}, at odds of ${Number(odds).toFixed(2)}.`
            : `${tie}: we have a call on this one.`;
        return shareButtonHTML({ text, url, title: tie });
      })() : ''}
      ${played
        ? `<span>We put it up at ${oddsOf(c.odds)}${c.bookmaker ? ` with ${esc(bookName(c.bookmaker))}` : ''}.</span>`
        : `${p ? (p.local
            ? `<span>Best price at <b>${esc(p.book)}</b> in ${esc(COUNTRY_NAMES[country()] ?? 'your country')}</span>`
            : `<span>Quoted at ${oddsOf(p.odds)} with <b>${esc(p.book)}</b>. The books where you are may price it differently.</span>`) : ''}
           <span>${esc(d.returns)}</span>`}
    </div>
    ${!played && p && p.local && p.count > 1 ? `
      <details class="settles">
        <summary>${p.count} book${p.count === 1 ? '' : 's'} where you are</summary>
        <table class="tbl settle-tbl"><thead><tr><th>Bookmaker</th><th class="num">Odds</th></tr></thead><tbody>
          ${(c.prices ?? []).filter((q) => localPrice([q]).local).sort((a, b) => b.odds - a.odds)
            .map((q) => `<tr><td>${esc(bookName(q.book, q.slug))}</td><td class="num">${showOdds(q.odds)}</td></tr>`).join('')}
        </tbody></table>
      </details>` : ''}
    ${d.outcomes?.length ? `
      <details class="settles">
        <summary>${played ? 'How it would have settled' : 'How this settles'}</summary>
        <table class="tbl settle-tbl"><tbody>
          ${d.outcomes.map((r) => `<tr><td>${esc(r.label)}</td><td class="num ${r.result.startsWith('half') ? 'part' : r.result}">${esc(r.effect)}</td></tr>`).join('')}
        </tbody></table>
      </details>` : ''}
  </div>`;
}

/**
 * A team sheet laid out on a pitch.
 *
 * The formation string — "4-2-3-1" — is the whole layout: keeper, then one row
 * per number, defence nearest our own goal. Players arrive in selection order,
 * which is the order the provider lists them, so filling rows front to back from
 * that list puts everyone roughly where they play without needing coordinates.
 *
 * Faces come from /img/player/{id}/ and are small headshots, which is exactly
 * the size this needs — the same art would fall apart blown up in a masthead.
 */
const POSITION = { G: 'Goalkeeper', D: 'Defender', M: 'Midfielder', F: 'Forward' };
const POS_SHORT = { G: 'GK', D: 'DF', M: 'MF', F: 'FW' };

/*
 * The team lists, beside or under the pitch.
 *
 * They used to be every name on both squads in one long column each, with a
 * rating, a position, cards, goals and a minute on every row -- forty-odd
 * rows of equal weight, twice. Now each team reads in the order a fan asks
 * the questions: who started, who came on and when, who sat out (one line),
 * who was missing and why. On a phone a switch shows one team at a time;
 * on a desktop the two sit side by side.
 */
function squadHTML(lineups, home, away, report = null, league = null, ids = {}) {
  const out = (lineups?.unavailable ?? []).filter((u) => u?.name);
  const side = (key, label, teamId) => {
    const s = lineups?.[key];
    const players = (s?.players ?? []).filter((x) => x?.name);
    if (!players.length) return '';
    const starters = players.filter((x) => x.starting !== false);
    const bench = players.filter((x) => x.starting === false);
    const row = (x, { sub = false } = {}) => {
      const m = playerMarks(report, x.id);
      const events = [
        ...Array.from({ length: m.goals }, () => EV_ICON.goal),
        ...Array.from({ length: m.own }, () => EV_ICON.own),
        m.assists ? `<i class="tl-assist" role="img" aria-label="${m.assists} assist${m.assists === 1 ? '' : 's'}" title="${m.assists} assist${m.assists === 1 ? '' : 's'}">${m.assists > 1 ? m.assists : ''}</i>` : '',
        m.card ? EV_ICON[m.card] : '',
        m.off ? `<span class="tl-sub off" title="Went off">${EV_ICON.subOff}${esc(minuteOf(m.off))}</span>` : '',
        sub && m.on ? `<span class="tl-sub on" title="Came on">${EV_ICON.subOn}${esc(minuteOf(m.on))}</span>` : '',
      ].join('');
      return `
        <li class="tl-row">
          ${crest(x.name, 'sm', x.id, 'player')}
          <span class="tl-name">${playerLink(x.id, x.name, league)}${x.captain ? ' <small>(c)</small>' : ''}</span>
          <span class="tl-pos" title="${esc(POSITION[x.position] ?? '')}">${esc(POS_SHORT[x.position] ?? '')}</span>
          <span class="tl-ev">${events}</span>
          ${m.rating != null ? `<b class="rating ${ratingClass(m.rating)}">${Number(m.rating).toFixed(1)}</b>` : report ? '<span class="rating none"></span>' : ''}
        </li>`;
    };
    // After the match the bench splits in two: who came on (with the minute)
    // and who did not, as one line. Before it, the bench is one line of names.
    const cameOn = report ? bench.filter((x) => playerMarks(report, x.id).on) : [];
    const unused = report ? bench.filter((x) => !playerMarks(report, x.id).on) : bench;
    const mine = out.filter((u) => u.side === key);
    return `
      <section class="tl" data-side="${key}">
        <header class="tl-head">${crest(label, 'sm', teamId)}<b>${esc(label)}</b>${s.formation ? `<span class="formation">${esc(s.formation)}</span>` : ''}</header>
        <p class="tl-sub-head">Starting XI</p>
        <ol class="tl-list">${starters.map((x) => row(x)).join('')}</ol>
        ${cameOn.length ? `<p class="tl-sub-head">Came on</p><ol class="tl-list">${cameOn.map((x) => row(x, { sub: true })).join('')}</ol>` : ''}
        ${unused.length ? `<p class="tl-line"><span>${report ? 'Unused' : 'Bench'}</span> ${unused.map((x) => esc(x.name)).join(', ')}</p>` : ''}
        ${mine.length ? `<p class="tl-sub-head">Out</p><ul class="tl-out">${mine.map((u) => {
          const why = absenceReason(u.reason);
          return `<li>${playerLink(u.id, u.name, league)}${why ? `<small>${esc(why)}</small>` : ''}</li>`;
        }).join('')}</ul>` : ''}
      </section>`;
  };
  const h = side('home', home, ids.home);
  const a = side('away', away, ids.away);
  if (!h && !a) return '';
  // Absences the feed could not place on a side.
  const loose = out.filter((u) => u.side !== 'home' && u.side !== 'away');
  return `
  <div class="teamlists">
    <div class="tl-switch" role="tablist" aria-label="Team">
      <button type="button" role="tab" data-show="home" aria-selected="true">${esc(home)}</button>
      <button type="button" role="tab" data-show="away" aria-selected="false">${esc(away)}</button>
    </div>
    <div class="tl-pair" data-showing="home">${h}${a}</div>
    ${loose.length ? `<p class="tl-line tl-loose"><span>Also out</span> ${loose.map((u) => {
      const why = absenceReason(u.reason);
      return `${esc(u.name)}${why ? ` (${esc(why.toLowerCase())})` : ''}`;
    }).join(', ')}</p>` : ''}
  </div>`;
}

/* The surname, which is not always the last word.
 *
 * "David De Gea" is not "Gea" and "Kevin De Bruyne" is not "Bruyne", which is
 * what taking the final word gave us on a team sheet full of them. Spanish,
 * Dutch, Portuguese and Arabic naming all put a particle in front of the name
 * people actually use, so the particle comes with it.
 */
const PARTICLES = new Set([
  'de', 'del', 'della', 'der', 'den', 'di', 'da', 'das', 'dos', 'do', 'du',
  'van', 'von', 'la', 'le', 'lo', 'el', 'al', 'bin', 'ibn', 'mac', 'mc',
  'ten', 'ter', 'st', 'san', 'santa', "o'",
]);

function surname(full) {
  const parts = String(full ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return parts[0] ?? '';
  let i = parts.length - 1;
  // Walk back over particles, but never consume the whole name.
  while (i > 1 && PARTICLES.has(parts[i - 1].toLowerCase().replace(/\.$/, ''))) i--;
  return parts.slice(i).join(' ');
}

/*
 * The team sheet, on one pitch.
 *
 * One pitch with the two sides facing each other, the markings drawn. Upright
 * on a phone (away attacking down from the top, home up from the bottom) and
 * on its side on a wider screen (home from the left), because an upright
 * pitch at desktop width was fifteen hundred pixels tall.
 *
 * Each player is a face and a surname. After the match, one rating on the
 * face and at most three small marks (goals, a card, went off); the minutes
 * and the rest live in the team lists, where there is room to read them. The
 * pitch used to carry all of it and was the hardest thing on the page to
 * read.
 */
function pitchHTML(lineups, home, away, homeId, awayId, report = null, league = null) {
  if (!lineups?.home?.players?.length || !lineups?.away?.players?.length) return '';

  const rowsFor = (side) => {
    const starters = side.players.filter((p) => p.starting !== false).slice(0, 11);
    const shape = String(side.formation ?? '')
      .split(/[-–]/)
      .map((n) => parseInt(n, 10))
      .filter((n) => Number.isFinite(n) && n > 0);
    const bands = shape.length ? shape : [4, 4, 2];
    const out = [[starters[0]].filter(Boolean)];
    let i = 1;
    for (const n of bands) { out.push(starters.slice(i, i + n)); i += n; }
    if (i < starters.length) out.push(starters.slice(i));
    return out.filter((r) => r.length);
  };

  // Before the match: the provider's pick of each side's key player, ringed.
  const keyManOf = (side) => {
    if (report) return null;
    const rated = (side.players ?? []).filter((p) => p.starting !== false && typeof p.ai_score === 'number');
    return rated.length ? rated.reduce((a, b) => (b.ai_score > a.ai_score ? b : a)).id : null;
  };

  const player = (p, keyMan) => {
    const m = playerMarks(report, p.id);
    const tag = isNotable(p.id) && league ? 'a' : 'div';
    // Two marks at most, and only the ones that change a match: goals and a
    // red card. Bookings and substitutions are in the lists under the pitch;
    // on it they were the clutter.
    const goals = m.goals + m.own;
    const sentOff = m.card === 'red' || m.card === 'second_yellow';
    const marks = [
      goals ? `<i class="pp-goal" title="${goals} goal${goals === 1 ? '' : 's'}">${goals > 1 ? `<b>${goals}</b>` : ''}</i>` : '',
      sentOff ? '<i class="pp-card red" title="Sent off"></i>' : '',
    ].join('');
    return `
    <${tag}${tag === 'a' ? ` href="${esc(playerHref(p.id, league))}"` : ''} class="pp${p.id === keyMan ? ' key' : ''}" title="${esc(p.name)}">
      <span class="pp-face">${crest(p.name, 'md', p.id, 'player')}${marks ? `<span class="pp-marks">${marks}</span>` : ''}${
        m.rating != null ? `<b class="pp-rating ${ratingClass(m.rating)}">${Number(m.rating).toFixed(1)}</b>` : ''}</span>
      <span class="pp-name">${esc(surname(p.name))}</span>
    </${tag}>`;
  };

  const sideHTML = (side, key) => {
    const keyMan = keyManOf(side);
    const rows = rowsFor(side);
    const ordered = key === 'away' ? rows : [...rows].reverse();
    return `<div class="pitch-side ${key}">${ordered.map((row) => `<div class="pitch-row">${row.map((x) => player(x, keyMan)).join('')}</div>`).join('')}</div>`;
  };

  const head = (teamName, teamId, side, cls) => `
    <div class="sheet-team ${cls}">
      ${crest(teamName, 'sm', teamId)}<b>${esc(teamName)}</b>
      ${side?.formation ? `<span class="formation">${esc(side.formation)}</span>` : ''}
    </div>`;

  return `
  <div class="panel lineup">
    <div class="lineup-top">
      <p class="panel-head">Team sheet</p>
      ${lineups.status === 'confirmed' ? '<span class="tag ok">Confirmed</span>' : '<span class="tag prov">Predicted</span>'}
    </div>
    <div class="sheet-heads">${head(home, homeId, lineups.home, 'home')}${head(away, awayId, lineups.away, 'away')}</div>
    <div class="pitch">
      <!-- Markings to a real 68x105 pitch, upright and on its side; CSS shows the one that fits. -->
      <svg class="pitch-lines upright" viewBox="0 0 68 105" preserveAspectRatio="none" aria-hidden="true">
        <rect x="1" y="1" width="66" height="103"/><line x1="1" y1="52.5" x2="67" y2="52.5"/>
        <circle cx="34" cy="52.5" r="9.15"/><rect x="13.85" y="1" width="40.3" height="16.5"/>
        <rect x="24.85" y="1" width="18.3" height="5.5"/><rect x="13.85" y="87.5" width="40.3" height="16.5"/>
        <rect x="24.85" y="98.5" width="18.3" height="5.5"/></svg>
      <svg class="pitch-lines sideways" viewBox="0 0 105 68" preserveAspectRatio="none" aria-hidden="true">
        <rect x="1" y="1" width="103" height="66"/><line x1="52.5" y1="1" x2="52.5" y2="67"/>
        <circle cx="52.5" cy="34" r="9.15"/><rect x="1" y="13.85" width="16.5" height="40.3"/>
        <rect x="1" y="24.85" width="5.5" height="18.3"/><rect x="87.5" y="13.85" width="16.5" height="40.3"/>
        <rect x="98.5" y="24.85" width="5.5" height="18.3"/></svg>
      ${sideHTML(lineups.away, 'away')}
      ${sideHTML(lineups.home, 'home')}
    </div>
    ${report ? `<p class="lineup-key"><span><b class="pp-rating r-good">7.2</b> match rating</span><span><i class="pp-goal"></i> scored</span><span><i class="pp-card red"></i> sent off</span><span>Cards and subs are in the lists below</span></p>` : ''}
  </div>`;
}

// ---------------------------------------------------------- player links

/*
 * Only players worth a click get a link: the ones in the scoring chart of the
 * competition the match is in (`notable` on the bundle, set per page in
 * state.notable). The link opens that chart with their name highlighted and
 * scrolled into view, so following "Haaland" lands on Haaland at the top of
 * the Nations League scorers, not on a page about a squad player with
 * nothing to show.
 */
function playerHref(id, league = null) {
  return league
    ? `#/league/${encodeURIComponent(league)}?tab=scorers&p=${encodeURIComponent(id)}`
    : `#/player/${encodeURIComponent(id)}`;
}
const isNotable = (id) => Boolean(id && state.notable?.has(Number(id)));
/*
 * Who counts as remarkable: the top of the chart, not all of it. Two goals or
 * more and a top-ten place, with level scorers sharing a rank. Early in a
 * competition that is one or two names; a scorer of one in fifteenth is not
 * someone a reader is looking for.
 */
function remarkable(scorers) {
  const rows = (scorers ?? []).map((sc) => ({ id: Number(sc.id ?? sc.player_id), name: sc.name, goals: Number(sc.goals) || 0 }));
  return rows
    .map((r) => ({ ...r, rank: 1 + rows.filter((o) => o.goals > r.goals).length }))
    .filter((r) => r.id && r.goals >= 2 && r.rank <= 10);
}
// The rank printed beside a chart row: shared between level scorers, and
// only on the first of them, the way a league table prints it.
const chartRank = (rows, i) => {
  const g = Number(rows[i]?.goals) || 0;
  if (i > 0 && (Number(rows[i - 1]?.goals) || 0) === g) return '';
  return String(1 + rows.filter((o) => (Number(o.goals) || 0) > g).length);
};
const chartLine = (n) => `${n.goals} goal${n.goals === 1 ? '' : 's'}, ${n.rank === 1 ? 'top of' : `${ordinal(n.rank)} in`} the scoring chart`;
const playerLink = (id, name, league, cls = 'plink') => (isNotable(id) && league
  ? `<a class="${cls}" href="${esc(playerHref(id, league))}" title="${esc(name)}: ${esc(chartLine(state.notable.get(Number(id))))}">${esc(name)}</a>`
  : esc(name));

/*
 * Names in the analysis, as links.
 *
 * The write-up names players ("Haaland has been dangerous"), and every one
 * of them is somebody the fixture knows: the team sheets, the squads, the
 * absentees and the league's scorers travel with the bundle as `people`.
 * This builds one pass that finds those names in already-escaped text and
 * wraps the first mention of each in a link to the player's page. It
 * matches full names, and surnames where only one player on the page has
 * that surname, so "Haaland" links and a surname two players share does not.
 * A name that is also part of a team's name is left alone. Anything it does
 * not recognise stays plain text: a missing link is better than a wrong one.
 */
function playerLinker(f) {
  const people = [];
  const add = (id, name) => { if (Number.isFinite(Number(id)) && name && !String(name).startsWith('#')) people.push({ id: Number(id), name: String(name) }); };
  for (const p of f?.people ?? []) add(p.id, p.name);
  for (const side of ['home', 'away']) {
    for (const p of f?.lineups?.[side]?.players ?? []) add(p.id, p.name);
    for (const p of f?.report?.lineups?.[side]?.players ?? []) add(p.id, p.name);
  }
  for (const u of f?.lineups?.unavailable ?? []) add(u.id, u.name);
  const teamWords = new Set([f?.home, f?.away].filter(Boolean)
    .flatMap((t) => [t.toLowerCase(), ...t.toLowerCase().split(/\s+/)]));
  // Only the competition's scorers; everyone else stays plain text.
  const notable = state.notable ?? new Map();
  const full = new Map();
  const sur = new Map();
  for (const p of people.filter((x) => notable.has(x.id))) {
    if (!full.has(p.name)) full.set(p.name, p.id);
    const sn = surname(p.name.replace(/^\p{L}\.\s+/u, ''));
    if (sn.length < 4 || sn === p.name) continue;
    const prev = sur.get(sn);
    sur.set(sn, prev === undefined || prev === p.id ? p.id : null);
  }
  const aliases = [...full.entries(), ...[...sur.entries()].filter(([n, id]) => id !== null && !full.has(n))]
    .filter(([n]) => n.length >= 4 && !teamWords.has(n.toLowerCase()));
  if (!aliases.length) return (html) => html;
  aliases.sort((a, b) => b[0].length - a[0].length);
  const byEsc = new Map(aliases.map(([n, id]) => [esc(n), id]));
  const pattern = [...byEsc.keys()].map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const re = new RegExp(`(?<![\\p{L}\\p{M}])(${pattern})(?![\\p{L}\\p{M}])`, 'gu');
  const league = f?.league_id ?? null;
  const done = new Set();
  return (html) => html.replace(re, (m) => {
    const id = byEsc.get(m);
    if (done.has(id)) return m;
    done.add(id);
    return `<a class="plink" href="${esc(playerHref(id, league))}">${m}</a>`;
  });
}

// ---------------------------------------------------------- match report

/** "45+2'" from an event's minute and added time. */
const minuteOf = (e) => (e?.minute == null ? '' : `${e.minute}${e.added ? `+${e.added}` : ''}'`);

/** One side's scorers and minutes: "Barrenetxea 12', Soler 45+2' (pen)". */
function scorersText(goals, side) {
  const own = (goals ?? []).filter((g) => g && g.side === side);
  if (!own.length) return '';
  return own.map((g) => {
    const tag = /own/i.test(g.kind ?? '') ? ' (og)' : /pen/i.test(g.kind ?? '') ? ' (pen)' : '';
    return `${surname(g.player ?? '')} ${minuteOf(g)}${tag}`.trim();
  }).join(', ');
}

/** Two lines of scorers, home then away, for a compact row. Empty when none. */
function scorersHTML(goals, cls = 'scorers') {
  const h = scorersText(goals, 'home');
  const a = scorersText(goals, 'away');
  if (!h && !a) return '';
  return `<div class="${cls}"><span>${esc(h)}</span><span>${esc(a)}</span></div>`;
}

const EV_ICON = {
  goal: '<i class="ev-ico ico-goal" aria-hidden="true"></i>',
  own: '<i class="ev-ico ico-goal ico-own" aria-hidden="true"></i>',
  yellow: '<i class="ev-ico ico-card c-yellow" aria-hidden="true"></i>',
  second_yellow: '<i class="ev-ico ico-card c-second" aria-hidden="true"></i>',
  red: '<i class="ev-ico ico-card c-red" aria-hidden="true"></i>',
  sub: '<i class="ev-ico ico-sub" aria-hidden="true"></i>',
  subOn: '<i class="ev-ico ico-arrow up" aria-hidden="true"></i>',
  subOff: '<i class="ev-ico ico-arrow down" aria-hidden="true"></i>',
  assist: '<i class="ev-ico ico-boot" role="img" aria-label="assist" title="Assist"></i>',
};

/** How a rating reads: the colour says it before the number does. */
// Prefixed: a bare `top` is the site header's class, and a rating of 8 or more
// picked up the whole header's styling with it.
const ratingClass = (r) => (r >= 8 ? 'r-top' : r >= 7 ? 'r-good' : r < 6 ? 'r-poor' : '');

/**
 * What one player did, from the report: goals, assists, cards, when they
 * came on or off, and the rating. Drawn on the pitch chip and the squad row.
 */
function playerMarks(report, id) {
  const none = { goals: 0, own: 0, assists: 0, card: null, on: null, off: null, rating: null, line: null };
  if (!report) return none;
  const pid = Number(id);
  const line = (report.players ?? []).find((p) => Number(p.id) === pid) ?? null;
  const evs = report.events ?? [];
  const mine = (e) => Number(e.player_id) === pid;
  const goals = Math.max(evs.filter((e) => e.t === 'goal' && mine(e) && !/own/i.test(e.kind ?? '')).length, line?.goals ?? 0);
  const own = evs.filter((e) => e.t === 'goal' && mine(e) && /own/i.test(e.kind ?? '')).length;
  const cards = evs.filter((e) => e.t === 'card' && mine(e)).map((e) => e.card);
  const card = cards.includes('red') ? 'red' : cards.includes('second_yellow') ? 'second_yellow' : cards.includes('yellow') ? 'yellow' : null;
  return {
    goals, own, assists: line?.assists ?? 0, card,
    off: evs.find((e) => e.t === 'sub' && Number(e.out_id) === pid) ?? null,
    on: evs.find((e) => e.t === 'sub' && Number(e.in_id) === pid) ?? null,
    rating: typeof line?.rating === 'number' ? line.rating : null,
    line,
  };
}

/**
 * The match report: what happened, in the order it happened.
 *
 * Goals with the scorer, the minute and the assist, cards with the reason,
 * substitutions, then the team numbers a fan looks at after the whistle and
 * the highlights where the provider has them. Home events sit left, away
 * events right, the way a timeline is drawn everywhere. Nothing here is
 * ours: every line is a fact from the match, which is why the page can carry
 * it for everyone.
 */
/*
 * The highlights, where the provider has them. They were a small grey strip
 * at the foot of the report, under the stats, which is the last place anyone
 * looks: now a picture with a play button at the top of it, and a button in
 * the masthead.
 */
function highlightsOf(f) {
  return (f.report?.highlights ?? []).find((h) => h?.url && /^https?:\/\//.test(h.url)) ?? null;
}
function highlightsCard(hl) {
  const title = hl.title && !/^highlights?$/i.test(hl.title.trim()) ? hl.title.trim() : 'Every goal and the big moments';
  return `
    <a class="hl-card" href="${esc(hl.url)}" target="_blank" rel="noopener noreferrer">
      <span class="hl-thumb">${hl.thumbnail ? `<img src="${esc(hl.thumbnail)}" alt="" loading="lazy" decoding="async">` : ''}<i class="hl-play" aria-hidden="true"></i></span>
      <span class="hl-text"><b>Watch the highlights</b><small>${esc(title)}</small></span>
    </a>`;
}

function reportHTML(f, { title = 'Match report', inPlay = false } = {}) {
  const r = f?.report;
  if (!r) return '';
  const events = (r.events ?? []).filter((e) => e && (e.t === 'goal' || e.t === 'card' || e.t === 'sub'));
  const st = r.stats;
  const hl = highlightsOf(f);
  if (!events.length && !st && !hl) return '';

  const line = (e) => {
    if (e.t === 'goal') {
      const kind = /own/i.test(e.kind ?? '') ? '<small>own goal</small>' : /pen/i.test(e.kind ?? '') ? '<small>penalty</small>' : '';
      return `${/own/i.test(e.kind ?? '') ? EV_ICON.own : EV_ICON.goal}<b>${playerLink(e.player_id, e.player ?? 'Goal', f.league_id)}</b>${kind}${
        e.assist ? `<small class="ev-assist">${EV_ICON.assist}${(f._link ?? ((h) => h))(esc(e.assist))}</small>` : ''}${
        e.score ? `<em>${esc(e.score[0])}–${esc(e.score[1])}</em>` : ''}`;
    }
    if (e.t === 'card') {
      return `${EV_ICON[e.card] ?? EV_ICON.yellow}<b>${playerLink(e.player_id, e.player ?? '', f.league_id)}</b>${
        e.reason ? `<small>${esc(unshout(e.reason).toLowerCase())}</small>` : ''}`;
    }
    return `${EV_ICON.sub}<b>${playerLink(e.in_id, e.in ?? '', f.league_id)}</b><small>for ${playerLink(e.out_id, e.out ?? '', f.league_id)}</small>`;
  };
  // What a reader wants first after the whistle: the goals, big, with the
  // minute, the scorer, the assist and the score they made. Then the cards,
  // one line a team. Everything else (every substitution, every booking in
  // order) is one tap away rather than in the way.
  const goals = events.filter((e) => e.t === 'goal');
  const goalsHTML = goals.length ? `
    <ol class="rep-goals">${goals.map((e) => {
      const kind = /own/i.test(e.kind ?? '') ? ' <small>own goal</small>' : /pen/i.test(e.kind ?? '') ? ' <small>pen</small>' : '';
      const who = `<b>${playerLink(e.player_id, e.player ?? 'Goal', f.league_id)}</b>${kind}${
        e.assist ? `<small class="rep-assist">${EV_ICON.assist}${(f._link ?? ((h) => h))(esc(e.assist))}</small>` : ''}`;
      return `<li class="rep-goal ${e.side === 'away' ? 'away' : 'home'}" data-ev="${esc(eventKey(e))}">
        <span class="rg-who">${who}</span>
        <span class="rg-mid"><em>${/own/i.test(e.kind ?? '') ? EV_ICON.own : EV_ICON.goal}${esc(minuteOf(e))}</em>${e.score ? `<b>${esc(e.score[0])}–${esc(e.score[1])}</b>` : ''}</span>
      </li>`;
    }).join('')}</ol>`
    // In play, the goal can reach the score a minute before it reaches the
    // timeline. "No goals yet" under a 1-0 is worse than saying nothing.
    : inPlay && Array.isArray(f.live_score) && f.live_score[0] + f.live_score[1] > 0 ? ''
    : `<p class="rep-none">${inPlay ? 'No goals yet.' : 'No goals.'}</p>`;
  const cardsFor = (side) => events.filter((e) => e.t === 'card' && (e.side === 'away' ? 'away' : 'home') === side)
    .map((e) => `<span class="rep-card" data-ev="${esc(eventKey(e))}">${EV_ICON[e.card] ?? EV_ICON.yellow}${esc(surname(e.player ?? ''))} ${esc(minuteOf(e))}</span>`).join('');
  const hc = cardsFor('home'), ac = cardsFor('away');
  const cardsHTML = hc || ac ? `
    <div class="rep-cards">
      <div><span class="rep-team">${esc(f.home)}</span>${hc || '<span class="rep-card none">none</span>'}</div>
      <div><span class="rep-team">${esc(f.away)}</span>${ac || '<span class="rep-card none">none</span>'}</div>
    </div>` : '';
  const timeline = events.length ? `
    <details class="rep-all">
      <summary>Every event <span>${events.length}</span></summary>
      <div class="rep-heads"><span>${esc(f.home)}</span><span>${esc(f.away)}</span></div>
      <div class="timeline">
        ${events.map((e) => `<div class="ev ${e.side === 'away' ? 'away' : 'home'} is-${e.t}" data-ev="${esc(eventKey(e))}">
            <span class="ev-min">${esc(minuteOf(e))}</span><span class="ev-body">${line(e)}</span></div>`).join('')}
      </div>
    </details>` : '';

  const pct = (v) => `${Math.round(v)}%`;
  const rows = st ? [
    ['Possession', st.home?.possession, st.away?.possession, pct],
    ['Shots', st.home?.shots, st.away?.shots],
    ['On target', st.home?.on_target, st.away?.on_target],
    ['Big chances', st.home?.big_chances, st.away?.big_chances],
    ['Corners', st.home?.corners, st.away?.corners],
    ['Fouls', st.home?.fouls, st.away?.fouls],
    ['Yellow cards', st.home?.yellow, st.away?.yellow],
    ['Offsides', st.home?.offsides, st.away?.offsides],
    ['Saves', st.home?.saves, st.away?.saves],
  ].filter(([, h, a]) => h != null && a != null) : [];
  const numbers = rows.length ? `
    <div class="rep-numbers">
      <div class="rep-heads"><span>${esc(f.home)}</span><span>${esc(f.away)}</span></div>
      ${rows.map(([l, h, a, fmt]) => statBar(l, h, a, fmt)).join('')}
    </div>` : '';

  return `
  <div class="panel report">
    <p class="panel-head">${esc(title)}${r.ht ? ` <span>Half time ${esc(r.ht[0])}–${esc(r.ht[1])}</span>` : ''}</p>
    ${hl ? highlightsCard(hl) : ''}
    ${events.length ? goalsHTML : ''}
    ${cardsHTML}
    ${timeline}
    ${numbers}
    ${r.attendance ? `<p class="rep-att">Attendance ${Number(r.attendance).toLocaleString()}</p>` : ''}
  </div>`;
}

/** W/D/L chips, oldest to newest, the way every football site draws form. */
function formChips(ev) {
  const seq = String(ev?.sequence ?? '');
  if (!seq) return '';
  return `<span class="chips">${[...seq].map((r) => `<i class="chip ${r.toLowerCase()}">${r}</i>`).join('')}</span>`;
}

function statBar(label, home, away, fmt = (v) => String(Math.round(v))) {
  const h = Number(home) || 0;
  const a = Number(away) || 0;
  const total = h + a;
  const hp = total > 0 ? (h / total) * 100 : 50;
  return `
  <div class="sbar">
    <div class="sbar-top"><b>${fmt(h)}</b><span>${esc(label)}</span><b>${fmt(a)}</b></div>
    <div class="sbar-track"><i class="h" style="width:${hp}%"></i><i class="a" style="width:${100 - hp}%"></i></div>
  </div>`;
}

/**
 * Form, side by side.
 *
 * This is the panel that carries a cup tie. A Coppa Italia round of 32 has no
 * league table and often no meetings on record, so without this the page is a
 * verdict and three probability bars. Every figure here is already computed by
 * engine/src/context/form.ts for the narrative — it was simply never drawn.
 *
 * The venue split at the bottom is the interesting one: it is the difference
 * between "they are in poor form" and "they are in poor form away from home".
 */
function formPanel(form, home, away) {
  const h = form?.home;
  const a = form?.away;
  if (!h && !a) return '';

  const one = (d) => Number(d ?? 0).toFixed(1);
  const int = (d) => String(Math.round(Number(d ?? 0)));

  // "4-1-1" is how the record arrives. A supporter says "won four of six"; they
  // do not say "1.83 points a game", which is the number this row used to show
  // and exactly the kind the vocabulary rule exists to keep off the page.
  const won = (ev) => {
    const m = /^(\d+)-(\d+)-(\d+)$/.exec(String(ev?.record ?? ''));
    return m ? Number(m[1]) : null;
  };

  const rows = [
    ['won', won(h), won(a), int],
    ['goals scored', h?.goals_for, a?.goals_for, one],
    ['goals conceded', h?.goals_against, a?.goals_against, one],
    ['clean sheets', h?.clean_sheets, a?.clean_sheets, int],
  ].filter(([, hv, av]) => typeof hv === 'number' || typeof av === 'number');

  /**
   * The travel read, said rather than scored.
   *
   * The interesting thing here was never the figure, it was the gap: whether a
   * side is a different proposition away from home. So compare the two and
   * print the comparison. "They travel badly" is what a fan would say; "0.90 a
   * game on the road" is what a spreadsheet would.
   */
  const split = (ev, name, better, worse) => {
    if (typeof ev?.venue_ppg !== 'number' || typeof ev?.ppg !== 'number' || (ev.venue_matches ?? 0) < 2) return null;
    if (ev.venue_ppg > ev.ppg * 1.2) return `${esc(name)} ${better}`;
    if (ev.venue_ppg < ev.ppg * 0.8) return `${esc(name)} ${worse}`;
    return null;
  };

  const splits = [
    split(h, home, 'are a different side at home', 'have been worse at home than on their travels'),
    split(a, away, 'travel well', 'travel badly'),
  ].filter(Boolean);

  const runOf = (ev) => {
    if (!ev || !ev.streak_kind || ev.streak_kind === 'none' || !ev.streak_length) return '';
    const word = { won: 'won', unbeaten: 'unbeaten in', lost: 'lost', winless: 'winless in' }[ev.streak_kind];
    return word ? `<span class="run">${esc(word)} ${ev.streak_length}</span>` : '';
  };

  return `
  <div class="panel">
    <p class="panel-head">Form <span>last ${Math.max(h?.matches ?? 0, a?.matches ?? 0)}</span></p>
    <div class="form-top">
      <div class="form-side">${formChips(h)}${runOf(h)}</div>
      <div class="form-side right">${runOf(a)}${formChips(a)}</div>
    </div>
    ${rows.map(([label, hv, av, fmt]) => statBar(label, hv ?? 0, av ?? 0, fmt)).join('')}
    ${splits.length ? `<p class="form-split">${splits.join('. ')}.</p>` : ''}
  </div>`;
}

function h2hHTML(h2h, home, away) {
  if (!h2h || !h2h.total_matches) return '';
  const recent = (h2h.recent_matches ?? []).slice(0, 6);
  return `
  <div class="panel">
    <p class="panel-head">Head to head <span>${h2h.total_matches} meetings</span></p>
    ${statBar('wins', h2h.home_wins ?? 0, h2h.away_wins ?? 0)}
    <div class="numbers">
      <span>${esc(home)} <b>${h2h.home_wins ?? 0}</b></span>
      <span>drawn <b>${h2h.draws ?? 0}</b></span>
      <span>${esc(away)} <b>${h2h.away_wins ?? 0}</b></span>
      ${typeof h2h.avg_total_goals === 'number'
        // Same rule as everywhere else: a supporter says "there are always
        // goals in this one", not "3.33 goals a game".
        ? `<span>${h2h.avg_total_goals >= 3.1 ? 'there are usually goals in this one'
            : h2h.avg_total_goals <= 2.1 ? 'these two are usually tight'
            : 'nothing one-sided about the goals'}</span>`
        : ''}
    </div>
    ${recent.length ? `<div class="h2h-list">${recent.map((m) => `
      <div class="h2h-row">
        <span class="h2h-date">${m.date ? new Date(m.date).toLocaleDateString([], { month: 'short', year: '2-digit' }) : ''}</span>
        <span class="h2h-teams">${esc(m.home ?? '')} <b>${esc(m.score ?? '')}</b> ${esc(m.away ?? '')}</span>
      </div>`).join('')}</div>` : ''}
  </div>`;
}

function standingsHTML(st, home, away, homeId, awayId) {
  if (!st || (!st.home && !st.away) || !realTable(st)) return '';
  const row = (r, name, id) => r
    ? `<tr>
         <td class="num">${r.position}</td>
         <td>${crest(name, 'sm', id)} ${esc(name)}</td>
         <td class="num">${r.played}</td>
         <td class="num">${r.goal_diff > 0 ? '+' : ''}${r.goal_diff}</td>
         <td class="num"><b>${r.points}</b></td>
       </tr>`
    : '';
  return `
  <div class="panel">
    <p class="panel-head">In the table${st.size ? ` <span>${st.size} teams</span>` : ''}</p>
    <div class="scroll-x"><table class="tbl">
      <thead><tr><th>#</th><th>Team</th><th class="num">P</th><th class="num">GD</th><th class="num">Pts</th></tr></thead>
      <tbody>${row(st.home, home, homeId)}${row(st.away, away, awayId)}</tbody>
    </table></div>
  </div>`;
}


/*
 * Which of the things we weighed a reader actually sees.
 *
 * The panel used to print the whole ledger, filtered by a regular expression
 * over the prose. That is backwards twice over. It let through every factor
 * that looked and found nothing -- "the reverse fixture finished 3-2, too
 * close to carry a revenge motive", "safely mid-table, with 31 games
 * remaining", "the manager has 25 matches in charge" -- which is a page of
 * sentences that change nobody's mind, in front of the one or two that do. And
 * it decided on wording, so every rephrasing silently changed what shipped.
 *
 * The ledger already knows the answer. A factor carries `moves`, the rates it
 * actually shifted, and `strength`, how hard it argued. A factor that moved
 * nothing and argued weakly did not contribute to the call, whatever its
 * sentence reads like.
 *
 * Better still, when there is a call the engine has already ranked the factors
 * that drove it -- `verdict.drivers`, most dispositive first. That is the real
 * answer to "why this call", so it leads, and everything else folds away.
 */
/*
 * The case, built from the match rather than from the engine's notes.
 *
 * This section printed the ledger's own notes, and the owner's complaint about
 * them was exact: "just a bunch of sentences", no player names, jargon. They
 * were a headcount ("without 5 players, none of whom register in the league's
 * scoring records" -- false, as it turned out, about lists with Hakimi on
 * them), trading-desk labels ("Where the sharp money is", "The margin") and
 * internal ideas ("the new-manager bounce window is live").
 *
 * Everything here is assembled from data the bundle already carries: who is
 * out and where they play, who starts, where the sides sit, how they are
 * going, who is likeliest to score, how the last meeting went. Names first.
 * The engine's notes survive only where they say something specific and pass
 * the same vocabulary gate as the prose.
 */
const WORD_N = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const saidN = (n) => WORD_N[n] ?? String(n);
const andList = (a) => (a.length <= 1 ? (a[0] ?? '') : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`);
const LINE_OF = { ATT: 'up front', MID: 'in midfield', DEF: 'at the back', GK: 'in goal' };
const LINE_ORDER = ['up front', 'in midfield', 'at the back', 'in goal', ''];
const injury = (r) => {
  const t = absenceReason(r);
  return t ? t.toLowerCase().replace(/\s*injury$/, '').trim() : null;
};

function storyFor(f) {
  const team = { home: f.home, away: f.away };
  const items = [];
  const ledger = f.ledger ?? [];

  // Team news, by name and by line.
  for (const side of ['home', 'away']) {
    const e = ledger.find((x) => x.id === `availability.${side}.absences`);
    const players = (e?.evidence?.players ?? []).filter((p) => p?.player);
    if (players.length) {
      const byLine = new Map();
      for (const p of players) {
        const where = LINE_OF[p.role] ?? '';
        const why = injury(p.reason);
        byLine.set(where, [...(byLine.get(where) ?? []), why ? `${p.player} (${why})` : p.player]);
      }
      const parts = [...byLine.entries()]
        .sort((a, b) => LINE_ORDER.indexOf(a[0]) - LINE_ORDER.indexOf(b[0]))
        .map(([where, names]) => `${andList(names.slice(0, 4))}${where ? ` ${where}` : ''}`);
      items.push({ label: `Team news: ${team[side]}`, note: `Without ${andList(parts)}.`, weight: 100 });
    } else if (ledger.some((x) => x.id === `availability.${side}.full_strength` && x.state === 'COMPUTED')) {
      items.push({ label: `Team news: ${team[side]}`, note: 'Nobody reported missing.', weight: 40 });
    }
  }

  // Who starts. Forwards and the keeper, because they are who a goals call or
  // a clean-sheet call is really about.
  const confirmed = f.lineups?.status === 'confirmed';
  for (const side of ['home', 'away']) {
    const xi = (f.lineups?.[side]?.players ?? []).filter((p) => p.starting && p.name);
    if (xi.length < 9) continue;
    const fwd = xi.filter((p) => p.position === 'F').map((p) => p.name);
    const gk = xi.find((p) => p.position === 'G')?.name;
    const shape = f.lineups?.[side]?.formation;
    const bits = [];
    if (fwd.length) bits.push(`${andList(fwd.slice(0, 3))} up front`);
    if (gk) bits.push(`${gk} in goal`);
    if (!bits.length) continue;
    items.push({
      label: `${confirmed ? 'Starting' : 'Expected to start'}: ${team[side]}`,
      note: `${andList(bits)}${shape && /^\d(-\d){2,4}$/.test(shape) ? `, set up ${shape}` : ''}.`,
      weight: 90,
    });
  }

  // Where they sit and how they are going.
  //
  // A table position only from a table that is one: a cup or a group stage
  // comes back as one flat list (the Nations League as fifty-four rows on nil
  // points), and "12th in the table" off that means nothing.
  const size = f.standings?.size;
  const isLeague = size >= 6 && size <= 30
    && ['home', 'away'].some((k) => (f.standings?.[k]?.played ?? 0) > 0 || (f.standings?.[k]?.points ?? 0) > 0);
  for (const side of ['home', 'away']) {
    const pos = isLeague ? f.standings?.[side]?.position : null;
    const form = f.form?.[side];
    const bits = [];
    if (pos) {
      bits.push(size && pos === size ? 'bottom of the table'
        : pos === 1 ? 'top of the table'
        : size && pos > size - 3 ? `${ordinal(pos)}, in the bottom three`
        : `${ordinal(pos)} in the table`);
    }
    if (form?.record && form?.matches) {
      const [w = 0, d = 0, l = 0] = String(form.record).split('-').map((x) => parseInt(x, 10) || 0);
      const m = saidN(form.matches);
      const streak = String(form.streak ?? '');
      const run = /(\d+)/.exec(streak)?.[1];
      if (/^winless/.test(streak) && run >= 3) bits.push(`without a win in ${saidN(Number(run))}`);
      else if (/^unbeaten/.test(streak) && run >= 3) bits.push(`unbeaten in ${saidN(Number(run))}`);
      else if (/^won/.test(streak) && run >= 3) bits.push(`${saidN(Number(run))} wins in a row`);
      else if (/^lost/.test(streak) && run >= 3) bits.push(`${saidN(Number(run))} defeats in a row`);
      else bits.push(`won ${saidN(w)}, drawn ${saidN(d)}, lost ${saidN(l)} of the last ${m}`);
      if (form.clean_sheets >= 3) bits.push(`${saidN(form.clean_sheets)} clean sheets in ${m}`);
    }
    if (bits.length) items.push({ label: `Form: ${team[side]}`, note: `${bits.join(', ').replace(/^./, (c) => c.toUpperCase())}.`, weight: 80 });
  }

  // Who is likeliest to score, as names. The market behind it stays ours.
  const gs = (f.external?.polymarket?.goalscorers ?? []).filter((g) => g?.player);
  if (gs.length) {
    const sorted = gs.every((g) => typeof g.price === 'number') ? [...gs].sort((a, b) => b.price - a.price) : gs;
    const names = [...new Set(sorted.map((g) => g.player))].slice(0, 3);
    items.push({ label: 'Most likely to score', note: `${andList(names)}.`, weight: 85 });
  }

  // The last meeting, said the way a supporter remembers it: who won, where.
  const last = (f.h2h?.recent_matches ?? [])[0];
  if (last?.score) {
    const when = last.date ? new Date(last.date).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }) : null;
    const hs = Number(last.home_score);
    const as = Number(last.away_score);
    const named = last.home && last.away && Number.isInteger(hs) && Number.isInteger(as);
    const said = !named ? `Finished ${last.score}`
      : hs === as ? `${last.home} and ${last.away} drew ${last.score}`
      : hs > as ? `${last.home} won ${last.score} at home`
      : `${last.away} won ${as}-${hs} away`;
    items.push({ label: 'Last time', note: `${said}${when ? `, ${when}` : ''}.`, weight: 50 });
  }

  // The manager, by name, when the feed has one.
  for (const side of ['home', 'away']) {
    const e = ledger.find((x) => x.id.startsWith(`manager.${side}.`) && x.state === 'COMPUTED');
    const name = e?.evidence?.manager;
    const games = e?.evidence?.matches_in_charge;
    if (name && name !== 'the manager' && typeof games === 'number' && games <= 10) {
      const n = Math.max(0, Math.round(games));
      items.push({
        label: `In the dugout: ${team[side]}`,
        note: n === 0 ? `${name} takes charge for the first time.` : `${name} has had ${saidN(n)} game${n === 1 ? '' : 's'} in charge.`,
        weight: 60,
      });
    }
  }

  // The referee, as a tendency. The engine's note carries the counts ("81
  // yellow cards in his last 20 games, where 79 would be usual"); a fan says
  // he is card-happy or lets it go, and says nothing when he is neither.
  const ref = ledger.find((x) => x.id === 'referee.tendency' && x.state === 'COMPUTED');
  const ratio = Number(ref?.evidence?.yellow_ratio);
  const refGames = Number(ref?.evidence?.matches);
  if (Number.isFinite(ratio) && refGames >= 30) {
    if (ratio >= 1.2) items.push({ label: 'The referee', note: 'Books more players than most.', weight: 48 });
    else if (ratio <= 0.8) items.push({ label: 'The referee', note: 'Lets a lot go.', weight: 45 });
  }

  /*
   * The engine's own notes, only where something is actually going on.
   *
   * A factor that looked and found nothing -- not a derby, nothing in the
   * forecast, a routine trip, a normal week's rest -- records that at strength
   * zero, and it used to be printed anyway: "Not a local derby." is a sentence
   * about the absence of a fact. Anything under a fifth of full strength is
   * the engine saying "nothing here", and nothing here is not shown.
   */
  const KEEP = /^(fatigue\.|fixture\.derby|fixture\.revenge|environment\.weather|stakes\.)/;
  for (const x of ledger) {
    if (x.state !== 'COMPUTED' || !KEEP.test(x.id) || !READ_LABEL[x.id]) continue;
    if (!((x.strength ?? 0) > 0.2)) continue;
    // A bundle written before the group-stage fix carries "105 games
    // remaining" and is frozen if its match has been played; no side in any
    // competition has more than 46 games left.
    if (Number(x.evidence?.games_left) > 46) continue;
    const note = cleanProse(x.note);
    if (note) items.push({ label: READ_LABEL[x.id], note, weight: 45 + Math.round((x.strength ?? 0) * 20) });
  }

  return items.sort((a, b) => b.weight - a.weight);
}

function readsFor(f, verdicts) {
  const named = (x) =>
    x && x.state === 'COMPUTED' && READ_LABEL[x.id] && x.note
      ? { id: x.id, label: READ_LABEL[x.id], note: x.note, strength: x.strength ?? 0, moves: (x.moves ?? []).length }
      : null;

  const dedupe = (list) => {
    const seen = new Set();
    return list.filter((r) => {
      if (!r || seen.has(r.note)) return false;
      seen.add(r.note);
      return true;
    });
  };

  // The call's own drivers, in the engine's order. Free copy has no verdicts,
  // so this is empty there and the ledger has to answer on its own.
  const drivers = dedupe((verdicts[0]?.drivers ?? []).map(named)).slice(0, 4);

  const ledger = dedupe((f.ledger ?? []).map(named));
  const driverIds = new Set(drivers.map((r) => r.id));
  const others = ledger.filter((r) => !driverIds.has(r.id));

  // Did it change anything, or argue hard enough to be worth a reader's time?
  const carried = (r) => r.moves > 0 || r.strength >= 0.45;

  const reads = drivers.length ? drivers : others.filter(carried).slice(0, 5);
  const shown = new Set(reads.map((r) => r.id));
  return { reads, rest: others.filter((r) => !shown.has(r.id)) };
}

/*
 * The match page while the match is on: goals, cards, substitutions and the
 * team numbers so far, from /api/live/:id, redrawn in place every thirty
 * seconds (liveTick) with the timeline left open if it was open. After the
 * whistle the same timeline stands in for the report until the slate has
 * written the full one, which can take a quarter of an hour.
 */
function liveCentreHTML(f, st) {
  const body = live.detail.get(Number(f.id))?.body;
  const rep = body?.report && ((body.report.events ?? []).length || body.report.stats) ? body.report : null;
  if (st.kind === 'live') {
    return `<div id="live-centre" data-fixture="${esc(f.id)}">${
      rep ? reportHTML({ ...f, report: rep }, { title: 'So far', inPlay: true }) : ''}</div>`;
  }
  if (st.kind === 'ft' && !f.report && rep) return reportHTML({ ...f, report: rep });
  return reportHTML(f);
}

function patchLiveCentre(id) {
  const box = document.getElementById('live-centre');
  const f = state.liveFixture;
  if (!box || !f || Number(box.dataset.fixture) !== id || Number(f.id) !== id) return false;
  const rep = live.detail.get(id)?.body?.report;
  if (!rep) return true;
  const open = box.querySelector('details.rep-all')?.open;
  box.innerHTML = reportHTML({ ...f, report: rep }, { title: 'So far', inPlay: true });
  if (open) box.querySelector('details.rep-all')?.setAttribute('open', '');
  smartQuotes(box);
  markLiveEvents(id, box);
  return true;
}

/*
 * Who's who: what a supporter knows about a match that is not about the
 * price. Each manager against this opponent over a whole career, the league's
 * team of the season from these two sides, the money paid for a player, their
 * goals for their country, and the referee. Written by the slate for the next
 * two days' games (engine/src/context/extras.ts). Counts said as a supporter
 * says them; no rates, and a panel with nothing in it is not drawn.
 */
const SMALL = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
const say = (v) => (Number.isInteger(v) && v >= 0 && v < SMALL.length ? SMALL[v] : String(v));
const feeSaid = (eur) => (eur >= 1e6 ? `€${Math.round(eur / 1e6)}m` : `€${Math.round(eur / 1e3)}k`);
const MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function windowSaid(at) {
  const d = new Date(at * 1000);
  const m = d.getUTCMonth();
  const when = m >= 5 && m <= 8 ? 'the summer' : m <= 1 ? 'January' : MONTH[m];
  return d.getUTCFullYear() === new Date().getUTCFullYear() ? `in ${when}` : `in ${when}${when === 'the summer' ? ' of' : ''} ${d.getUTCFullYear()}`;
}
const XI_ROLE = { G: 'goalkeeper', D: 'defender', M: 'midfielder', F: 'forward' };

function whosWhoHTML(f) {
  const x = f?.extras;
  if (!x) return '';
  const rows = [];
  for (const side of ['home', 'away']) {
    const m = x.managers?.[side];
    const v = m?.vs;
    if (!m?.name || !v) continue;
    const opp = side === 'home' ? f.away : f.home;
    const n = v.w + v.d + v.l;
    const last = v.last
      ? ` Last time: ${v.last.result === 'W' ? 'won' : v.last.result === 'L' ? 'lost' : 'drew'} ${esc(v.last.score.replace('-', '–'))} in ${MONTH[new Date(v.last.kickoff * 1000).getUTCMonth()]} ${new Date(v.last.kickoff * 1000).getUTCFullYear()}.`
      : '';
    const games = say(n);
    rows.push({ label: esc(m.name), note: `Manages ${esc(side === 'home' ? f.home : f.away)}. ${games[0].toUpperCase()}${games.slice(1)} ${n === 1 ? 'game' : 'games'} against ${esc(opp)} in every job so far: won ${v.w}, drawn ${v.d}, lost ${v.l}.${last}` });
  }
  // How each side does against teams above and below them in the table.
  for (const side of ['home', 'away']) {
    const sp = x.split?.[side];
    const bits = [['above', sp?.above], ['below', sp?.below]]
      .filter(([, r]) => r && r.w + r.d + r.l >= 2)
      .map(([k, r]) => `Against sides ${k} them in the table, their last ${say(r.w + r.d + r.l)}: won ${r.w}, drawn ${r.d}, lost ${r.l}.`);
    if (bits.length) rows.push({ label: esc(side === 'home' ? f.home : f.away), note: bits.join(' ') });
  }
  // One row per player, whatever there is to say about them.
  const people = new Map();
  const teamOf = (teamId) => (teamId === x.teams?.away ? f.away : f.home);
  for (const b of x.best_xi ?? []) {
    const goals = b.goals ? `${say(b.goals)} goal${b.goals === 1 ? '' : 's'}` : null;
    const assists = b.assists ? `${say(b.assists)} assist${b.assists === 1 ? '' : 's'}` : null;
    const did = [goals, assists].filter(Boolean).join(' and ');
    people.set(String(b.id), { name: b.name, notes: [`In the league's team of the season so far, as a ${XI_ROLE[b.position] ?? 'player'}${did ? `: ${did} in ${say(b.matches)} games` : ''}.`], team: teamOf(b.team_id) });
  }
  const profiled = new Map((f.players ?? []).map((p) => [String(p.id), p]));
  for (const [id, e] of Object.entries(x.players ?? {})) {
    const p = profiled.get(id);
    const row = people.get(id) ?? { name: p?.name, notes: [], team: p?.side === 'away' ? f.away : f.home };
    if (!row.name) continue;
    // A transfer is a club's business: never shown against a national side.
    const nationalSide = e.country === row.team || !!p?.club;
    if (e.signed?.fee >= 5e6 && !nationalSide) row.notes.push(`Cost ${esc(row.team)} ${feeSaid(e.signed.fee)} from ${esc(e.signed.from)} ${windowSaid(e.signed.at)}.`);
    if (e.goals >= 3 && e.country) row.notes.push(`${say(e.goals)[0].toUpperCase()}${say(e.goals).slice(1)} goals${e.caps ? ` in ${say(e.caps)} games` : ''} for ${esc(e.country)}.`);
    if (row.notes.length) people.set(id, row);
  }
  // Club and country: a player's form is not one team's. In a country's match
  // the club season comes first; in a club's, the break just gone. And a
  // finals tournament in the last few months, and a heavy fortnight.
  const count = (v, one, many) => `${say(v)} ${v === 1 ? one : many}`;
  const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);
  for (const p of f.players ?? []) {
    if (!p?.id || !p.name) continue;
    const c = p.country;
    const notes = [];
    const team = p.side === 'away' ? f.away : f.home;
    if (p.club && p.season?.apps >= 2) {
      notes.push(cap(`${count(p.season.goals ?? 0, 'goal', 'goals')} in ${count(p.season.apps, 'game', 'games')} for ${esc(p.club)} this season.`));
    }
    if (c?.team && p.club && c.apps >= 1) {
      notes.push(cap(`${count(c.goals ?? 0, 'goal', 'goals')} in the last ${count(c.apps, 'game', 'games')} for ${esc(c.team)}.`));
    }
    if (c?.team && !p.club && c.lately?.apps) {
      const l = c.lately;
      notes.push(l.goals
        ? cap(`${count(l.goals, 'goal', 'goals')} for ${esc(c.team)} in the international break.`)
        : `Played ${l.apps === 1 ? 'once' : l.apps === 2 ? 'twice' : `${say(l.apps)} times`} for ${esc(c.team)} in the break.`);
    }
    const t = c?.tournament;
    if (t?.name && t.apps >= 2 && Date.now() / 1000 - t.ended <= 120 * 86400) {
      const name = t.name.replace(/^(FIFA|UEFA|CONMEBOL|CAF|AFC|CONCACAF|OFC)\s+/i, '').replace(/\s*20\d\d(\/\d\d)?$/, '');
      notes.push(`Played ${say(t.apps)} games at the ${esc(name)}${t.goals ? `, with ${count(t.goals, 'goal', 'goals')}` : ''}.`);
    }
    if (p.status === 'fit' && p.load?.country > 0 && p.load.games >= 3) {
      notes.push(cap(`${say(p.load.games)} games in the last fortnight for club and country.`));
    }
    if (!notes.length) continue;
    const row = people.get(String(p.id)) ?? { name: p.name, notes: [], team };
    row.notes.push(...notes);
    people.set(String(p.id), row);
  }
  for (const [id, r] of people) rows.push({ label: playerLink(Number(id), r.name, f.league_id), note: r.notes.join(' ') });
  const ref = x.referee;
  if (ref?.name) {
    const cards = ref.matches >= 5
      ? ` ${ref.yellows} yellow card${ref.yellows === 1 ? '' : 's'} in ${say(ref.matches)} games${ref.usual ? `, where ${ref.usual} would be usual in this league` : ''}, and ${ref.reds ? `${say(ref.reds)} red${ref.reds === 1 ? '' : 's'}` : 'nobody sent off'}.`
      : '';
    rows.push({ label: 'The referee', note: `${esc(ref.name)}.${cards}` });
  }
  if (!rows.length) return '';
  return `
    <div class="panel whos-who">
      <p class="panel-head">Who's who</p>
      <div class="reads">${rows.map((r) => `<div class="read"><b>${r.label}</b><p>${r.note}</p></div>`).join('')}</div>
    </div>`;
}

/*
 * A fixture that has changed since it was written: a kick-off moved, or a
 * match called off. Said at the top of the match page, in plain words, and
 * what it means for a bet on it.
 */
function changeNoteHTML(f, st) {
  if (st.kind === 'off') {
    const say = {
      postponed: 'Postponed. A bet on a match that is not played is void.',
      cancelled: 'Cancelled. A bet on a match that is not played is void.',
      canceled: 'Cancelled. A bet on a match that is not played is void.',
      abandoned: 'Abandoned. Bookmakers usually void bets on a match that was not finished.',
      suspended: 'Play is suspended. The score stands where it stopped until it restarts.',
    }[String(f.status).toLowerCase()];
    return say ? `<p class="fx-change off">${esc(say)}</p>` : '';
  }
  if (st.kind === 'upcoming' && f.moved_from) {
    const was = kickoffLabel(f.moved_from).replace(/^(Today|Tomorrow)/, (w) => w.toLowerCase());
    return `<p class="fx-change">Kick-off moved from ${esc(was)}.</p>`;
  }
  return '';
}

async function viewFixture(id, params = new URLSearchParams()) {
  // Which navigation this page belongs to: a newer one makes it stand down (see route).
  const nav = navTicket;
  placeholder(skeletonHTML());
  let f;
  try { f = await getJSON(`/api/fixture/${id}`); state.titleFor = f?.home && f?.away ? f : null; } catch {
    /*
     * A fixture we cannot show. The provider's message was printed raw --
     * "fixture not found or not yet analysed" -- under a Back button and
     * nothing else, which tells a reader what our database thinks rather than
     * what to do next. Both of those are true and only one is useful.
     */
    if (nav !== navTicket) return;
    app.innerHTML = `
    <div class="wrap section">
      <div class="page-head">
        <h1 class="display xl">Not on the board</h1>
        <p class="page-sub">We have no write-up for this match. Either it is outside
          the leagues we have fitted, or it has dropped off the back of the board.</p>
      </div>
      <div class="cta-row">
        <a class="btn btn-primary" href="#/board">Today's board</a>
        <a class="btn btn-ghost" href="#/leagues">What we cover</a>
      </div>
    </div>`;
    return;
  }

  /*
   * Whose numbers these are.
   *
   * `odds_1x2` is the bookmakers' fair price with their margin taken out, and
   * the panel printed it under "How we see it" -- so a match we had at 62%
   * was shown at the market's 73%, beside a line saying we had it even. Ours
   * come from `markets`; the market's are still worth showing, but labelled as
   * theirs.
   */
  const ours = (f.markets ?? []).find((m) => m.market === '1x2' && m.model && Object.keys(m.model).length)?.model;
  const p = ours ?? f.odds_1x2 ?? {};
  const whose = ours ? 'ours' : 'market';
  /*
   * The calls on this page are the calls in the record.
   *
   * The results page and the board read the pick table; this page used to read
   * only the write-up, which older slate runs rewrote after the match had been
   * played. So a reader could tap a "Landed" on the results page and arrive at
   * "We did not call this one". `published` is the pick table's view of this
   * fixture, and whenever it has anything in it, it decides what is shown --
   * the write-up only supplies the argument for a call it agrees with.
   */
  const recorded = Array.isArray(f.published) ? f.published : [];
  const same = (a, b) => a.market === b.market && String(a.outcome) === String(b.outcome)
    && (a.line ?? null) === (b.line ?? null);
  const written = (f.verdicts ?? []).filter((v) => v.candidate);
  const verdicts = recorded.length
    ? recorded.map((pk) => {
        const v = written.find((w) => same(w.candidate, pk));
        return v
          ? { ...v, record: pk }
          : {
              candidate: {
                market: pk.market, outcome: pk.outcome, line: pk.line,
                odds: pk.odds, bookmaker: pk.bookmaker, model_prob: pk.model_prob,
                prices: [{ slug: '', book: pk.bookmaker, odds: pk.odds }],
              },
              narrative: pk.narrative,
              record: pk,
            };
      })
    // Nothing recorded. On a played match that means nothing was called, and
    // the page must agree with the results page even if an old write-up says
    // otherwise. Before kick-off it may just mean the reader is not a member,
    // so the write-up's locked verdicts stand.
    : (Number.isInteger(f.score?.[0]) || String(f.status) === 'finished')
      ? []
      : (f.verdicts ?? []);
  // Player names in everything below become links, for the competition's
  // scorers only. Bundles written before the chart travelled with them fetch
  // it from the league (usually already in the cache).
  let notable = Array.isArray(f.notable) ? remarkable(f.notable) : null;
  if (!notable && f.league_id) {
    try {
      const lg = await getJSON(`/api/league/${encodeURIComponent(f.league_id)}`);
      notable = remarkable(lg?.scorers);
    } catch { notable = []; }
  }
  state.notable = new Map((notable ?? []).map((n) => [Number(n.id), n]));
  // A chart player's own name, so a name the sheet spells in full still matches.
  f.people = [...(f.people ?? []), ...(notable ?? []).map((n) => ({ id: n.id, name: n.name }))];
  f._link = playerLinker(f);
  // What the page argues with: built from the match, names first. See storyFor.
  const story = storyFor(f);
  const reads = story.slice(0, 6);
  const rest = story.slice(6);

  /*
   * Whether this match has been played, and by how much.
   *
   * Everything below reads off these three. Without them the page had one
   * voice for every fixture: a kick-off time in the future tense, a price
   * described as available, a call described as a call. On a match that
   * finished two days ago all three were false, and the page had no way of
   * knowing -- the bundle was written before kick-off, so it said the game was
   * to come and carried no score. `get_fixture` now overlays the score column
   * the way the board already did, which is what makes this possible at all.
   */
  const st = matchState(f);
  const played = st.kind === 'ft';
  // Being played, or just over with no report written yet: the timeline and
  // the numbers are asked for every thirty seconds (liveTick).
  if (st.kind === 'live' || (played && !f.report && Date.now() / 1000 - f.kickoff < 4 * 3600)) {
    live.focus = Number(f.id);
    state.liveFixture = f;
  }
  const sc = Array.isArray(f.score) && f.score.length === 2
    && f.score[0] !== null && f.score[1] !== null ? f.score : null;
  const hg = sc ? Number(sc[0]) : null;
  const ag = sc ? Number(sc[1]) : null;
  // The running score while it is on -- shown where the final score goes,
  // with the live badge beside it saying which kind it is.
  const ls = !sc && st.kind === 'live' && Array.isArray(f.live_score) && f.live_score.length === 2 ? f.live_score : null;
  const shown = sc ?? ls;

  // The provider hands back round labels already joined with a middle dot
  // ("Regular season · Matchday 4"), which is the meta-string tell arriving
  // from outside. Split it back into its parts and let the one join rule below
  // decide how they are set.
  const meta = [
    kickoffLabel(f.kickoff),
    ...String(f.round_label || f.league || '').split(/\s*·\s*/).filter(Boolean),
    f.venue?.name ? (f.neutral ? `${f.venue.name} (neutral)` : f.venue.name) : f.neutral ? 'neutral ground' : null,
  ].filter(Boolean);

  /*
   * A locked verdict says nothing about itself, so two of them say the same
   * nothing twice. The wall was rendering once per call -- the same paragraph
   * and the same button, stacked -- on every fixture carrying more than one.
   * One wall, and it already names the count.
   */
  const anyLocked = verdicts.some((v) => !v.candidate);

  const callHead = verdicts.length
    ? (played ? 'What we called' : verdicts.length > 1 ? 'The calls' : 'The call')
    : (played ? 'We did not call this one' : 'No pick');

  /*
   * After the match the confirmed sheets in the report, with the bench and
   * the shirt numbers, replace a predicted line-up written before kick-off.
   * The absences stay: they are still who was missing.
   */
  const sheet = played && f.report?.lineups?.home?.players?.length && f.report?.lineups?.away?.players?.length
    ? { status: 'confirmed', home: f.report.lineups.home, away: f.report.lineups.away, unavailable: f.lineups?.unavailable ?? [] }
    : f.lineups;
  const report = played ? f.report ?? null : null;

  const overview = `
    <div class="grid-2">
      <div>
        ${liveCentreHTML(f, st)}
        <div class="panel">
          <p class="panel-head">${callHead}</p>
          ${pulledHTML(f)}
          ${verdicts.length
            ? verdicts.map((v) => verdictHTML(v, f.home, f.away, f, { played, hg, ag })).join('')
              + (anyLocked ? lockedHTML(f) : '')
              + (played ? '' : CALLS_NOTE)
            // Older pass notes were written for us ("the 58.1 needed against a
            // 109.1% margin"); the gate withholds those and the plain line
            // stands in.
            // A match with no call can still carry a written preview (the
            // slate writes one with the day's spare allowance): the football
            // first, then why there is no call.
            : `${!played && cleanProse(f.preview) ? `<p class="narrative">${f._link(esc(cleanProse(f.preview)))}</p>` : ''}<p class="narrative${!played && cleanProse(f.preview) ? ' narrative-pass' : ''}">${esc(cleanProse(f.pass) ?? 'Nothing here is worth a call. The bookmakers have it about right.')}</p>${
              !played && f.read?.text ? `<div class="read-line"><small>Our read</small><b>${esc(f.read.text)}</b>
                  <p>What we think happens. It is a read, not a call: we would not bet it, so it has no price and it is not in our record.</p></div>` : ''}`}
        </div>
        ${reads.length ? `<div class="panel">
          <p class="panel-head">${verdicts.length ? (played ? 'What made us call it' : 'What made the call') : 'What stood out'}</p>
          <div class="reads">${reads.map((r) => `<div class="read"><b>${esc(r.label)}</b><p>${f._link(esc(r.note))}</p></div>`).join('')}</div>
          ${rest.length ? `
            <details class="more-reads">
              <summary>${rest.length} other thing${rest.length === 1 ? '' : 's'} we checked</summary>
              <div class="reads">${rest.map((r) => `<div class="read"><b>${esc(r.label)}</b><p>${f._link(esc(r.note))}</p></div>`).join('')}</div>
            </details>` : ''}
        </div>` : ''}
      </div>
      <div>
        ${[p.HOME, p.DRAW, p.AWAY].some((x) => typeof x === 'number') ? `<div class="panel">
          <p class="panel-head">${whose === 'ours'
            ? `How we ${played ? 'saw' : 'see'} it`
            : `What the bookmakers ${played ? 'made' : 'make'} of it`}</p>
          <div class="bars">${bar(f.home, p.HOME)}${bar('Draw', p.DRAW)}${bar(f.away, p.AWAY)}</div>
          <div class="numbers">
            <!-- "goals expected 3.33" was expected goals with the label filed
                 off: a banned term, a number no supporter says out loud, and on
                 the page a reader lands on from an advert. What the total is
                 actually being used to say is whether the game looks open. -->
            <span>${((f.lambda?.[0] ?? 0) + (f.lambda?.[1] ?? 0)) >= 3.1 ? (played ? 'we had goals in it' : 'goals look likely')
                   : ((f.lambda?.[0] ?? 0) + (f.lambda?.[1] ?? 0)) <= 2.1 ? (played ? 'we had it tight' : 'this one looks tight')
                   : (played ? 'we had it even on paper' : 'an even game on paper')}</span>
            ${f.provisional && !played ? `<span class="tag prov">line-ups not final</span>` : ''}
          </div>
        </div>` : ''}
        ${formPanel(f.form, f.home, f.away)}
        ${whosWhoHTML(f)}
        ${f.venue_id ? `<div class="panel venue" data-shot="yes">
          <p class="panel-head">${esc(f.venue?.name || 'The ground')}</p>
          ${f.venue?.city || f.venue?.capacity ? `<p class="venue-meta">${esc([f.venue.city ? `In ${f.venue.city}` : '', f.venue.capacity ? `holds ${Number(f.venue.capacity).toLocaleString('en-GB')}` : ''].filter(Boolean).join(', ').replace(/^h/, 'H'))}.</p>` : ''}
          <div class="venue-shot">${venueShot(f.venue_id, '')}</div>
        </div>` : ''}
      </div>
    </div>`;

  // A tab with nothing behind it is worse than no tab: it reads as a broken page.
  // Cup ties routinely have no table and no meetings on record, so the strip is
  // built from what actually rendered rather than from a fixed list.
  const TABS = [
    ['overview', 'Overview', overview],
    ['lineups', 'Line-ups',
      pitchHTML(sheet, f.home, f.away, f.home_id, f.away_id, report, f.league_id)
      + squadHTML(sheet, f.home, f.away, report, f.league_id, { home: f.home_id, away: f.away_id })],
    ['h2h', 'Head to head', h2hHTML(f.h2h, f.home, f.away)],
    ['table', 'Table', standingsHTML(f.standings, f.home, f.away, f.home_id, f.away_id)],
  ].filter(([, , html]) => html);

  /*
   * Which tab is open, from the address.
   *
   * It was always the first one, which meant the line-ups a reader had just
   * scrolled through were gone the moment they hit reload, and a tab they
   * wanted to send somebody arrived as the overview. The tab is a place on
   * this page, so it belongs in the address like any other.
   */
  const asked = params.get('tab');
  const open = TABS.some(([k]) => k === asked) ? asked : TABS[0]?.[0];

  // The two clubs' colours, read off their crests by the slate. Checked as
  // hex before they go anywhere near a style attribute.
  const hexOk = (c) => (typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c) ? c : null);
  const homeC = hexOk(f.colors?.home);
  const awayC = hexOk(f.colors?.away);
  // A competition with its own look (a Champions League night) takes the
  // masthead instead of the ground and the clubs' colours.
  const theme = themeOf(f.league_id);
  const wash = !theme && (homeC || awayC)
    ? ` has-colors" style="--home-c:${homeC ?? 'transparent'};--away-c:${awayC ?? 'transparent'}`
    : '';

  if (nav !== navTicket) return;
  app.innerHTML = `
  <section class="hero fx-top${theme ? ` theme-${theme}` : ''}${wash}" data-shot="${f.venue_id ? 'yes' : 'none'}" data-fx="${esc(f.id)}">
    ${theme ? themeArt(theme) : `<div class="hero-media">${venueShot(f.venue_id, '', true)}</div>`}
    ${wash ? '<div class="fx-wash" aria-hidden="true"></div>' : ''}
    <div class="wrap hero-inner">
      ${backHTML('Back to the board')}
      <div class="hero-copy">
        <span class="timechip${isSoon(f.kickoff) ? ' soon' : ''}">${esc(kickoffLabel(f.kickoff))}</span>
        ${st.kind === 'upcoming' ? '' : liveBadge(st)}${st.kind === 'live' ? minuteHTML(f) : ''}
        ${changeNoteHTML(f, st)}
        <h1 class="visually-hidden">${esc(shown ? `${f.home} ${shown[0]}–${shown[1]} ${f.away}` : `${f.home} v ${f.away}`)}</h1>
        <div class="fx-stack${shown ? ' scored' : ''}" aria-hidden="true">
          <span class="fx-line">
            ${crest(f.home, 'md', f.home_id)}
            <span class="name">${esc(f.home)}</span>
            ${shown ? `<span class="gf${shown[0] > shown[1] ? ' win' : ''}">${esc(shown[0])}</span>` : formChips(f.form?.home)}
          </span>
          <span class="fx-line">
            ${crest(f.away, 'md', f.away_id)}
            <span class="name">${esc(f.away)}</span>
            ${shown ? `<span class="gf${shown[1] > shown[0] ? ' win' : ''}">${esc(shown[1])}</span>` : formChips(f.form?.away)}
          </span>
        </div>
        <p class="hero-blurb">${f.league && f.league_id
          ? `<a class="league-link" href="#/league/${encodeURIComponent(f.league_id)}">${esc(f.league)}</a>${meta.slice(1).length ? `, ${esc(meta.slice(1).join(', '))}` : ''}`
          : esc([f.league, ...meta.slice(1)].filter(Boolean).join(', '))}</p>
        ${highlightsOf(f) ? `<a class="btn btn-primary hl-btn" href="${esc(highlightsOf(f).url)}" target="_blank" rel="noopener noreferrer"><i class="hl-play" aria-hidden="true"></i>Watch the highlights</a>` : ''}
        <div class="fx-follow">${followButtonHTML('team', f.home_id, f.home, { named: true })}${followButtonHTML('team', f.away_id, f.away, { named: true })}</div>
      </div>
    </div>
  </section>

  <div class="wrap section dense">

    ${TABS.length > 1 ? `<div class="tabs" role="tablist">
      ${TABS.map(([k, label]) => `<button class="tab${k === open ? ' on' : ''}" data-tab="${k}" role="tab"
        aria-selected="${k === open}">${esc(label)}</button>`).join('')}
    </div>` : ''}
    ${TABS.map(([k, , html]) => `<div class="tabpane" data-pane="${k}"${k === open ? '' : ' hidden'}>${html}</div>`).join('')}
  </div>`;
  // The locked call says when it closes; keep that count running.
  tickCountdowns();

  /*
   * `history.length > 1` is true of a tab that has been anywhere at all, so on
   * a fixture opened straight from a link -- which is how a shared call
   * arrives -- "Back to the board" walked the reader off the site, usually
   * back to whatever they were reading before. Go back only when the previous
   * entry is somewhere on this site; otherwise go to the board, which is what
   * the button says it does.
   */
  app.querySelector('.back').onclick = () => {
    if (state.cameFromInApp) history.back(); else location.hash = '#/board';
  };
  wireFollowButtons();
  // The team lists on a phone: one team at a time.
  for (const b of app.querySelectorAll('.tl-switch button')) {
    b.onclick = () => {
      const pair = app.querySelector('.tl-pair');
      if (pair) pair.dataset.showing = b.dataset.show;
      for (const o of app.querySelectorAll('.tl-switch button')) o.setAttribute('aria-selected', String(o === b));
    };
  }
  for (const t of app.querySelectorAll('.tab')) {
    t.onclick = () => {
      for (const o of app.querySelectorAll('.tab')) {
        const on = o === t;
        o.classList.toggle('on', on);
        o.setAttribute('aria-selected', String(on));
      }
      for (const pane of app.querySelectorAll('.tabpane')) pane.hidden = pane.dataset.pane !== t.dataset.tab;
      // replaceState rather than a hash assignment: switching tab is not a
      // navigation, and pushing one would make the back button walk through
      // every tab a reader glanced at before leaving the page.
      const q = t.dataset.tab === TABS[0][0] ? '' : `?tab=${encodeURIComponent(t.dataset.tab)}`;
      history.replaceState(null, '', `${location.pathname}#/fixture/${encodeURIComponent(id)}${q}`);
    };
  }

  /*
   * A match being played is re-read once a minute, and the page redrawn --
   * scroll and open tab intact, because the tab is in the address and the
   * page's height does not change. The router clears the timer on the way
   * out, and a backgrounded tab does not ask.
   */
  // Without the live feed (no provider key on the Worker), the slate's own
  // score is re-read once a minute instead.
  if (st.kind === 'live' && !live.enabled) {
    const refresh = () => {
      if (document.hidden) return;
      getJSON(`/api/fixture/${id}`, { fresh: true })
        .then(() => route({ soft: true }))
        .catch(() => { /* the last good page stays up */ });
    };
    state.poll = setInterval(refresh, 60000);
    state.onVisible = () => { if (!document.hidden) refresh(); };
    addEventListener('visibilitychange', state.onVisible);
  }
}

function bar(label, v) {
  const w = typeof v === 'number' ? Math.round(v * 100) : 0;
  return `<div class="bar-row"><div class="lab" style="grid-column:1/-1"><span>${esc(label)}</span><span>${w}%</span></div>
    <span class="bar"><i style="width:${w}%"></i></span></div>`;
}

// ---------------------------------------------------------------- results

/*
 * A call we took down before kick-off (engine/src/pulled.ts): when, and why,
 * in plain words. What it was and what replaced it come only to members and
 * on the free call (get_fixture); everyone else is told that it came down and
 * why, which is the honest part.
 */
function pulledHTML(f) {
  const list = (Array.isArray(f.pulled) ? f.pulled : []).filter((p) => p && cleanProse(p.reason));
  if (!list.length) return '';
  const today = new Date().toDateString();
  const at = (t) => {
    const d = new Date(Number(t) * 1000);
    return d.toDateString() === today ? clockTime(d)
      : `${d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}, ${clockTime(d)}`;
  };
  return list.map((p) => {
    const what = p.label ? `We’d been on ${p.label}${Number(p.odds) > 1 ? ` at ${oddsOf(Number(p.odds))}` : ''}. ` : '';
    const swap = p.replaced_by ? ` We’ve switched to ${p.replaced_by}.` : '';
    return `<div class="pulled">
      <p class="pulled-head"><span class="pulled-tag">Call pulled</span><span>${esc(at(p.pulled_at))}</span></p>
      <p class="pulled-why">${esc(what)}${esc(cleanProse(p.reason))}${esc(swap)}</p>
    </div>`;
  }).join('');
}

/*
 * When we're confident, are we right?
 *
 * Every settled call we published, grouped by how sure we were when we made
 * it, to the nearest tenth (get_how_sure in schema.pg.sql), against how many
 * landed. The point is honesty: nobody else in this trade shows it.
 *
 * The first version drew a bar of ten per group with a marker for what we
 * said, and the owner read it and "didn't get it at all". So it now leads
 * with one worked example in sentences -- our most common kind of call: how
 * many we made, how many should land if we are honest, how many did -- and
 * then the same three counts for every level, as a plain table. Counts a
 * reader can check on their fingers, never percentages (offside-voice).
 */
const TENTHS = ['none', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const SURE_MIN = 15;
const sureWords = (tenths) => (tenths >= 10 ? 'as good as certain' : `${TENTHS[tenths]} in ten`);
/** How it went, short: for the table. */
function sureShort(n, landed, expected) {
  if (n < SURE_MIN) return 'Too few to judge yet';
  const d = (landed - expected) / n;
  if (Math.abs(d) <= 0.04) return 'Bang on';
  if (d > 0) return 'Better than we said';
  return d <= -0.1 ? 'Well short' : 'A little short';
}

async function viewHowSure() {
  const nav = navTicket;
  placeholder(skeletonHTML());
  let d;
  try { d = await getJSON('/api/how-sure'); } catch (err) { return errorState(err, nav); }
  if (nav !== navTicket) return;
  const bands = (Array.isArray(d?.bands) ? d.bands : [])
    .map((b) => ({ tenths: Number(b.tenths), n: Number(b.n), landed: Number(b.landed), said: Number(b.said) }))
    .filter((b) => b.n > 0);
  const expect = (b) => Math.round(b.n * b.said);
  const n = Number(d?.n) || 0;
  const all = { n, landed: Number(d?.landed) || 0, said: Number(d?.said) || 0 };
  const day = (t) => new Date(Number(t) * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' });

  // The worked example: the level we use most.
  const ex = [...bands].sort((a, b) => b.n - a.n)[0] ?? null;
  const exWords = ex ? sureWords(ex.tenths) : '';
  const exExpect = ex ? expect(ex) : 0;
  const exVerdict = !ex ? '' : (() => {
    const v = sureShort(ex.n, ex.landed, exExpect);
    if (v === 'Bang on') return `Bang on. When we say ${exWords}, we mean it.`;
    if (v === 'Better than we said') return `Better than we said. When we say ${exWords}, it has come in even more often.`;
    const got = Math.round((ex.landed / ex.n) * 10);
    return `${v}. When we say ${exWords}, it has been nearer ${TENTHS[got] ?? got} in ten, and we would rather show you that than hide it.`;
  })();

  app.innerHTML = `
  <div class="wrap section sure">
    <div class="page-head">
      <h1 class="display xl">When we’re confident, are we right?</h1>
      <p class="page-sub">Every call we make comes with how sure we are about it. If we say a call lands eight times in ten,
        then out of every ten calls like that, about eight should land. This page checks that against every call we’ve made, misses included.</p>
    </div>
    ${!ex ? '<p class="record-sub">Nothing has settled yet. This fills in as the first results come in.</p>' : `
    <section class="sure-eg" aria-label="An example">
      <p class="sure-eg-lead">Take our most common kind of call.</p>
      <ol class="sure-steps">
        <li><b>${ex.n}</b><span>times we rated a call about ${esc(exWords)}.</span></li>
        <li><b>${exExpect}</b><span>is about ${esc(exWords)} of ${ex.n}. That’s how many should land if we’re honest.</span></li>
        <li class="is-did"><b>${ex.landed}</b><span>actually landed.</span></li>
      </ol>
      <p class="sure-eg-verdict">${esc(exVerdict)}</p>
    </section>

    <h2 class="sure-h2">Every level, every call</h2>
    <div class="sure-wrap">
      <table class="tbl sure-tbl">
        <thead><tr><th>We rated it</th><th class="num">Calls</th><th class="num">Should land</th><th class="num">Landed</th></tr></thead>
        <tbody>
          ${bands.map((b) => `<tr>
            <td>About ${esc(sureWords(b.tenths))}<small>${esc(sureShort(b.n, b.landed, expect(b)))}</small></td>
            <td class="num">${b.n}</td><td class="num">${b.n < SURE_MIN ? '–' : expect(b)}</td><td class="num"><b>${b.landed}</b></td>
          </tr>`).join('')}
          <tr class="sure-total"><td>All calls<small>${esc(sureShort(all.n, all.landed, Math.round(all.n * all.said)))}</small></td>
            <td class="num">${all.n}</td><td class="num">${Math.round(all.n * all.said)}</td><td class="num"><b>${all.landed}</b></td></tr>
        </tbody>
      </table>
    </div>
    <p class="record-sub sure-foot">“Should land” is what we expected when we made the calls. Calls from ${esc(day(d.from))} to ${esc(day(d.to))},
      updated as each match finishes. Refunds are left out. Every call, one by one, is on <a href="#/results">the results page</a>.</p>`}
  </div>`;
  smartQuotes(app);
}

async function viewResults() {
  // Which navigation this page belongs to: a newer one makes it stand down (see route).
  const nav = navTicket;
  placeholder(skeletonHTML());
  /*
   * Two requests, because one cannot answer both halves of this page.
   *
   * It used to ask for the newest 150 picks and split them locally. On a busy
   * Saturday the newest 150 are all of today's, none of which have finished,
   * so the page printed "95 of the last 111 picks won" from the summary and
   * then "Nothing has finished yet" directly underneath it. The API can filter
   * by settled; asking it to is the whole fix.
   */
  let data, open;
  try {
    [data, open] = await Promise.all([
      getJSON('/api/picks?limit=120&settled=true'),
      getJSON('/api/picks?limit=20&settled=false').catch(() => ({ picks: [] })),
    ]);
  } catch (err) {
    return errorState(err, nav);
    return;
  }

  const summary = data.summary ?? {};
  const picks = data.picks ?? [];
  // A refund is neither won nor lost, so it belongs in the middle band and
  // nowhere else. Counting PUSH here as well as in `voided` is what made the
  // bar say "the 126 most recent" over 120 picks.
  const settled = picks.filter((x) => x.result && x.result !== 'VOID' && x.result !== 'PUSH');
  const openPicks = open?.picks ?? [];

  /*
   * There is no running profit-and-loss figure on this page, and that is a
   * decision rather than an omission.
   *
   * What used to be here read "backing every one of them with £10, you would
   * be £98.67 down" -- which is not a fact about our record, it is a fact
   * about one staking plan nobody follows, invented here and then presented
   * as the headline of the product. Nobody backs every call flat. Somebody
   * taking four of them a week has a completely different number, and we do
   * not know which four.
   *
   * What replaces it is not a rosier figure. It is no figure: every settled
   * pick, won and lost, counted. That is the whole record and it is still
   * published in full, including the losses, which is the part that actually
   * matters. Nothing on this page may imply a profit either -- see the legal
   * pages and engine/src/vocabulary.ts, which ban it outright.
   */
  const n = Number(summary.n ?? 0);
  const wins = Number(summary.wins ?? 0);
  /*
   * Refunds over the whole record rather than over this page's fetch.
   *
   * `pick_summary` does not carry them, so they are estimated from the rate
   * seen in the picks we do hold and stated as a count rather than implied to
   * be exact. When the summary starts carrying `pushes` this becomes a read.
   */
  // The average price the record was struck at, which is the number the strike
  // rate cannot be read without.
  const avgOdds = typeof summary.avg_odds === 'number' && summary.avg_odds > 1
    ? summary.avg_odds : null;
  const seen = picks.length;
  const seenRefunds = picks.filter((x) => x.result === 'VOID' || x.result === 'PUSH').length;
  const refunds = seen > 0 ? Math.round((seenRefunds / seen) * n) : 0;
  const graded = Math.max(1, n - refunds);

  /*
   * The strike rate, said out loud.
   *
   * It is not the banned kind of percentage. What the vocabulary rule bans is a
   * confidence score -- our own number, dressed up as a reason -- and a bare
   * percentage standing in for an argument. This is a count of what happened,
   * which is the one number on this site that is not an opinion.
   *
   * It never appears on its own, though, and that is the important half. A high
   * strike rate at short prices loses money, which is exactly what our record
   * does, so the rate and the money are printed in the same breath. Publishing
   * "86% of our picks won" and stopping there would be the single most
   * misleading true sentence available to us.
   */
  // Over the picks that were actually graded, which is how the bar below has
  // always counted them. It was over every pick including the refunds, so the
  // same page gave a refund two different meanings six lines apart.
  const rate = n > 0 ? Math.round((wins / graded) * 100) : null;
  const headline = n === 0
    ? 'Nothing has finished yet. The first results land as today\'s games do.'
    : `${wins} of the last ${n} picks won. That is ${[8, 11, 18].includes(rate) || (rate >= 80 && rate < 90) ? 'an' : 'a'} ${rate}% strike rate.`;

  const won = settled.filter((x) => x.result === 'WON' || x.result === 'HALF_WON').length;
  const lost = settled.filter((x) => x.result === 'LOST' || x.result === 'HALF_LOST').length;
  const voided = picks.filter((x) => x.result === 'VOID' || x.result === 'PUSH').length;

  /*
   * The masthead, rebuilt.
   *
   * What was here put "Results" at subheading size and then set the record
   * underneath it in the largest type on the site -- two lines of display face
   * on a phone, pushing the actual results below the fold, with the page's own
   * title reading as a caption to it. The hierarchy was upside down and the
   * biggest element was the one that reflowed worst.
   *
   * The numbers are one sentence with the figures set large. They were a
   * grid of boxed cells for a while, which readers found harder to follow
   * than the sentence it replaced; a record is read as a line, "208 landed
   * and 49 missed", not as a table.
   */
  const stat = (v, tone = '') => `<b class="fig${tone ? ` ${tone}` : ''}">${esc(v)}</b>`;

  if (nav !== navTicket) return;
  app.innerHTML = `
  <div class="wrap section">
    <div class="page-head">
      <h1 class="display xl">Results</h1>
      <p class="page-sub">Every pick we have published, marked against the real result.
        Nothing removed, nothing hidden.</p>
    </div>

    ${n === 0 ? `<p class="record-sub">${esc(headline)}</p>` : `
      <!--
        Four numbers over one denominator.
        Three of these came from the all-time summary and the fourth was
        counted from the hundred and twenty picks this page happened to fetch,
        so they described different records and did not add up: 208 + 49 + 4
        against a total of 257. A strip that reads as a partition has to be
        one. Refunds are carved out of the total first, and the rate is over
        what was actually graded -- which is also how the bar six lines below
        has always treated them, and the two disagreeing was the third time
        this page has contradicted itself about the same thing.
      -->
      <p class="figure-line record-line">${stat(wins, 'won')} landed and ${stat(Math.max(0, n - wins - refunds), 'lost')} missed${
        refunds ? `, with ${stat(refunds)} ${refunds === 1 ? 'stake' : 'stakes'} back` : ''}. That is ${stat(`${rate}%`)} of those graded.</p>
      ${formStringHTML(settled)}
      ${formBarHTML(won, voided, lost, ['won', 'stake back', 'lost'],
        `The ${settled.length + voided} most recent, in order. The figures above cover all ${n}.`)}
      <!--
        What the numbers above are and are not evidence of.

        It used to restate the paragraph two elements above it ("every pick we
        have published, marked against the real result" / "every call we have
        published, settled against the real result") and then promise two
        things per card that appear on almost none of them -- the market's
        move, which needs price history no settled pick carries yet.

        What belongs here is the counterweight the strike rate has to be read
        with. A rule in this file says the rate "never appears on its own",
        and since the profit figure came off the page nothing had replaced it.
        These are calls struck at about 1.15, so most of them winning is what
        that price is for, not a result on top of it.
      -->
      <p class="record-sub">${avgOdds
        ? `Called at average ${oddsOf(avgOdds)} or so, so most of them landing
           is what those odds already expect. Winning most is not the same as
           being ahead.`
        : 'These are short prices, so winning most of them is not the same as being ahead.'}</p>
      <p class="record-sub"><a class="record-link" href="#/how-sure">When we’re confident, are we right? See how often our calls land against how sure we were.</a></p>
      ${n > 0 && n < 100
        ? `<p class="record-note">That is ${n} results. It is not enough to tell a good run
             from a good model, and we will say so until it is.</p>`
        : ''}`}

    <div class="with-side">
      <div>
        <h2 class="side-head">How it went</h2>
        <div id="recap">${picks.length ? ''
          : `<div class="empty-state"><b>Nothing has finished yet</b>
               <span>The first results land as today's games do.</span></div>`}</div>
      </div>
      <aside>
        <h2 class="side-head">Still to play</h2>
        ${(() => {
          const upcoming = openPicks.slice(0, 12);
          if (!upcoming.length) return `<p class="acct-line">Nothing open right now.</p>`;
          return `<div class="side-list">${upcoming.map((x) => {
            const d = market({ market: x.market, outcome: x.outcome, line: x.line, home: x.home_team, away: x.away_team, odds: x.odds });
            return `
            <a class="side-item" href="#/fixture/${encodeURIComponent(x.fixture_id)}">
              <span class="side-thumb">${crest(x.home_team ?? '', 'sm', x.home_team_id)}${crest(x.away_team ?? '', 'sm', x.away_team_id)}</span>
              <span class="side-body">
                <span class="side-sel">${esc(d.name)}</span>
                <span class="side-meta">${esc(kickoffLabel(x.kickoff))}<b>${oddsTag(x.odds)}</b></span>
              </span>
            </a>`;
          }).join('')}</div>`;
        })()}
      </aside>
    </div>
  </div>`;

  /*
   * The recap, a matchday at a time.
   *
   * A hundred and twenty settled picks is twenty screens of scrolling, and a
   * record nobody reaches the bottom of is a record nobody reads. Paging it by
   * day matches how the thing is actually remembered -- you look up a Saturday,
   * not pick number 84 -- and it means the page below the fold is finite.
   *
   * The page lives in the address, so a particular matchday can be sent to
   * somebody, and the back button walks through them.
   */
  if (picks.length) {
    /*
     * Paged by pick rather than by matchday, which was the first attempt and
     * the wrong unit: a Saturday carries a hundred and seven of these and a
     * Sunday thirteen, so a page per day is one screen followed by twenty.
     * Twenty picks is a page whatever the fixture list looks like, and the day
     * headings still fall where the days do inside it.
     */
    const ordered = [...picks].sort((a, b) => b.kickoff - a.kickoff);
    const PER = 20;
    const pages = Math.max(1, Math.ceil(ordered.length / PER));

    /*
     * A matchday's record is the matchday's, not the page's.
     *
     * The heading tallied whatever slice of twenty had landed on this page, so
     * one Saturday appeared on five pages with five different records -- "17 of
     * 19", "14 of 19", "18 of 19", "12 of 18" -- and a single card spilling
     * over a boundary got its own heading reading "0 of 1 landed. Not one.
     * Here it is anyway." about a day that went 77 of 95. A reader who paged
     * twice caught the site telling two stories about one afternoon.
     */
    const dayTotals = new Map();
    for (const g of groupByDay(ordered)) {
      const key = new Date(g.at * 1000).toDateString();
      const graded = g.list.filter((x) => x.result !== 'VOID' && x.result !== 'PUSH');
      dayTotals.set(key, {
        won: graded.filter((x) => x.result === 'WON' || x.result === 'HALF_WON').length,
        graded: graded.length,
      });
    }

    const paint = (page) => {
      const p = Math.min(Math.max(1, page), pages);
      const host = document.getElementById('recap');
      if (!host) return;
      host.innerHTML =
        groupByDay(ordered.slice((p - 1) * PER, p * PER))
          .map((g) => dayHTML(g, dayTotals.get(new Date(g.at * 1000).toDateString()))).join('') +
        pagerHTML(p, pages, 'Results pages');
      for (const b of host.querySelectorAll('[data-page]')) {
        b.onclick = (e) => {
          e.preventDefault();
          const next = Number(b.dataset.page);
          history.replaceState(null, '', `#/results?p=${next}`);
          paint(next);
          document.getElementById('recap')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
        };
      }
    };
    paint(Number(parseHash().params.get('p')) || 1);
  }
}

/**
 * A pager.
 *
 * Numbered rather than "load more", because a number is a place you can go
 * back to and a button is not. Long runs collapse around the current page so
 * the control never wraps: 1 … 4 5 6 … 20.
 */
function pagerHTML(page, pages, label = 'Pages') {
  if (pages <= 1) return '';
  const want = new Set([1, pages, page, page - 1, page + 1]);
  if (page <= 3) { want.add(2); want.add(3); }
  if (page >= pages - 2) { want.add(pages - 1); want.add(pages - 2); }
  const nums = [...want].filter((n) => n >= 1 && n <= pages).sort((a, b) => a - b);

  const out = [];
  let prev = 0;
  for (const n of nums) {
    if (n - prev > 1) out.push('<span class="pager-gap">…</span>');
    out.push(`<button type="button" class="pager-num${n === page ? ' on' : ''}" data-page="${n}"
      ${n === page ? 'aria-current="page"' : ''}>${n}</button>`);
    prev = n;
  }

  return `
  <nav class="pager" aria-label="${esc(label)}">
    <button type="button" class="pager-step" data-page="${page - 1}" ${page === 1 ? 'disabled' : ''}>Newer</button>
    <div class="pager-nums">${out.join('')}</div>
    <button type="button" class="pager-step" data-page="${page + 1}" ${page === pages ? 'disabled' : ''}>Older</button>
  </nav>`;
}


/**
 * Every settled call, matchday by matchday.
 *
 * This is the page the record was missing. What was here before was a list of
 * ties with a mark beside each one -- true, and unreadable, and it asked the
 * reader to take our word for the grade because the scoreline that decided it
 * was nowhere on the page.
 *
 * So each one now carries three things in order: what happened, what we said
 * would happen, and the reason we gave at the time. The third is the one that
 * matters on a loss. Anybody can publish their record; publishing the argument
 * that turned out to be wrong, next to the result that proved it wrong, is the
 * part nobody does, and it is the only version of this page worth reading.
 *
 * Grouped by day because that is how a football weekend is remembered -- not
 * as a running total, but as a Saturday that went well or a Sunday that did
 * not. Each day is tallied and given a line, and the line is allowed a bit of
 * character on a good one as long as it is allowed none on a bad one.
 */
function dayVerdict(won, total) {
  if (!total) return '';
  if (total >= 3 && won === total) return 'Every one of them.';
  if (won === 0) return 'Not one. Here it is anyway.';
  const share = won / total;
  if (share >= 0.75) return 'A good one.';
  if (share >= 0.5) return 'More right than wrong.';
  if (share >= 0.34) return 'More wrong than right.';
  return 'A bad one.';
}

/** Newest matchday first; within one, the order the afternoon happened in. */
function groupByDay(picks) {
  const days = new Map();
  for (const x of picks) {
    const key = new Date(x.kickoff * 1000).toDateString();
    const g = days.get(key) ?? { at: x.kickoff, list: [] };
    g.at = Math.max(g.at, x.kickoff);
    g.list.push(x);
    days.set(key, g);
  }
  return [...days.values()]
    .sort((a, b) => b.at - a.at)
    .map((g) => ({ at: g.at, list: [...g.list].sort((a, b) => a.kickoff - b.kickoff) }));
}

/**
 * One matchday.
 *
 * `total` is the whole day's record, which is not the same as this page's
 * share of it -- see the comment where it is built. When a day is split over
 * pages the heading says so rather than quietly re-describing the day from
 * twenty of its picks.
 */
function dayHTML(g, total) {
  const onPage = g.list.filter((x) => x.result !== 'VOID' && x.result !== 'PUSH').length;
  const won = total?.won ?? g.list.filter((x) => x.result === 'WON' || x.result === 'HALF_WON').length;
  const graded = total?.graded ?? onPage;
  const part = graded > onPage;
  const label = new Date(g.at * 1000)
    .toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });

  return `
  <section class="recap-day">
    <div class="recap-head">
      <h3>${esc(unshout(label))}</h3>
      <span class="recap-tally">${won} of ${graded} landed${part ? ' that day' : ''}</span>
    </div>
    ${graded && !part ? `<p class="hand recap-say">${esc(dayVerdict(won, graded))}</p>` : ''}
    ${sortedForDay(g.list).map(recapCardHTML).join('')}
  </section>`;
}

/*
 * Wins first inside a day, then the rest.
 *
 * Every call is still here, every loss in full. What changes is what a reader
 * meets first on a day that went 17 of 19: the seventeen, and then the two,
 * rather than a loss at the top because it happened to kick off latest. Kick-
 * off order carries no information a reader wants on a results page; the
 * result does.
 */
function sortedForDay(list) {
  const rank = (x) => (x.result === 'WON' || x.result === 'HALF_WON' ? 0 : x.result === 'LOST' || x.result === 'HALF_LOST' ? 2 : 1);
  return [...list].sort((a, b) => rank(a) - rank(b) || b.kickoff - a.kickoff);
}

/** The last run of results as a form string, newest on the right, the way a
 *  form guide prints it. Refunds are left out: they are not a result. */
function formStringHTML(settled, n = 20) {
  const seq = [...settled].sort((a, b) => a.kickoff - b.kickoff)
    .filter((x) => x.result === 'WON' || x.result === 'HALF_WON' || x.result === 'LOST' || x.result === 'HALF_LOST')
    .slice(-n);
  if (!seq.length) return '';
  let run = 0;
  for (let i = seq.length - 1; i >= 0 && (seq[i].result === 'WON' || seq[i].result === 'HALF_WON'); i--) run++;
  return `
  <div class="formline">
    <span class="chips big">${seq.map((x) => `<i class="chip ${x.result === 'WON' || x.result === 'HALF_WON' ? 'w' : 'l'}">${x.result === 'WON' || x.result === 'HALF_WON' ? 'W' : 'L'}</i>`).join('')}</span>
    <span class="formline-note">the last ${seq.length}, oldest first${run >= 3 ? `, ending on <b>${run} in a row</b>` : ''}</span>
  </div>`;
}


/*
 * The post-mortem: why it landed, or why it did not.
 *
 * Written by the engine at settlement -- see engine/src/postmortem.ts, which
 * also says at length what it is allowed to claim. Three facts and a verdict:
 * how near it came, whether the match looked like the one we described, and
 * what the market did between our saying it and kick-off.
 *
 * Absent on everything settled before the engine existed, and the card simply
 * does not draw it rather than showing an apology for a missing field.
 */
function postMortemHTML(x) {
  let pm = null;
  try {
    pm = typeof x.postmortem_json === 'string' ? JSON.parse(x.postmortem_json) : x.postmortem_json;
  } catch { pm = null; }
  if (!pm || !pm.line) return '';

  const facts = [];
  // A refunded bet has no cushion and no shortfall -- it landed on the line --
  // so the chip said "1 goal to spare" directly under "the stake came back",
  // which cannot both be true. Three-way field, two-way branch.
  if (typeof pm.swing === 'number' && pm.landed !== 'refunded') {
    // `swing` is how many goals would have turned the result. For a miss that
    // is how far short it was; for a call that landed it is one more than it
    // had to spare -- a swing of one means the next goal would have beaten
    // it. Printing the swing as the cushion put "1 goal to spare" under "nothing
    // spare", on 49 of the last 200 settled calls.
    const spare = pm.swing - 1;
    facts.push(pm.swing === 0
      ? 'finished on the line'
      : pm.landed === 'missed'
        ? `${pm.swing} goal${pm.swing === 1 ? '' : 's'} short`
        : spare <= 0 ? 'nothing to spare' : `${spare} goal${spare === 1 ? '' : 's'} to spare`);
  }
  if (pm.shape) {
    facts.push(pm.shape === 'as we read it' ? 'the game we described' : `a ${pm.shape} game than we called`);
  }
  if (pm.market && pm.opening_odds && pm.closing_odds) {
    facts.push(pm.market === 'held'
      ? `odds held at ${showOdds(pm.closing_odds)}`
      : `odds moved from ${showOdds(pm.opening_odds)} to ${showOdds(pm.closing_odds)} by kick-off`);
  }

  // What decided it, from the match report once there is one: the late goal
  // that flipped it, a sending-off, a side that battered the other and lost.
  // Settle adds it after the report is fetched, so a call settled in the last
  // hour may not carry it yet, and most matches have nothing to add.
  const decided = Array.isArray(pm.decided) ? pm.decided.filter((d) => typeof d === 'string' && d) : [];

  return `
  <div class="pm is-${esc(pm.landed)}">
    <p class="pm-line">${esc(String(pm.line).replace('One goal in it. Right, but there was nothing spare.', 'One goal the other way and it was gone. Right, with nothing to spare.'))}</p>
    ${decided.length ? `<p class="pm-decided">${decided.map((d) => esc(d)).join(' ')}</p>` : ''}
    ${facts.length ? `<p class="pm-facts">${facts.map((f) => `<span>${esc(f)}</span>`).join('')}</p>` : ''}
  </div>`;
}

/**
 * How it went, in one or two sentences, for a page with no room for the whole
 * post-mortem: what decided it where the match report says, the verdict where
 * it does not. The front door carries no prices, so a verdict that leans on
 * how the odds moved is left for the results page.
 */
function wentLine(x) {
  let pm = null;
  try { pm = typeof x.postmortem_json === 'string' ? JSON.parse(x.postmortem_json) : x.postmortem_json; } catch { pm = null; }
  if (!pm) return null;
  const decided = (Array.isArray(pm.decided) ? pm.decided : []).map((d) => cleanProse(d)).filter(Boolean);
  if (decided.length) return decided.join(' ');
  const line = cleanProse(pm.line);
  return line && !/\b(?:market|price|odds)\b/i.test(line) ? line : null;
}

const RESULT_TONE = {
  WON: 'won', HALF_WON: 'part', LOST: 'lost', HALF_LOST: 'part', PUSH: 'back', VOID: 'back',
};
const RESULT_WORD = {
  WON: 'Landed', HALF_WON: 'Half landed', LOST: 'Missed', HALF_LOST: 'Half missed',
  PUSH: 'Refunded', VOID: 'Void',
};

function recapCardHTML(x) {
  const d = market({
    market: x.market, outcome: x.outcome, line: x.line,
    home: x.home_team, away: x.away_team, odds: x.odds,
  });
  const hg = x.home_goals;
  const ag = x.away_goals;
  const hasScore = Number.isInteger(hg) && Number.isInteger(ag);

  /*
   * A mark the scoreline contradicts is not a mark.
   *
   * `recap()` already refuses to describe a result whose grade and score
   * disagree, which was half a guard: the sentence vanished and the green
   * LANDED stayed, so the rows where we were most likely to be wrong were the
   * ones that looked most curated. Six picks in two hundred were doing this,
   * five of them flattering -- including one 1-1 carrying "either team to win:
   * landed" and "home or draw: missed" a few cards apart.
   *
   * The engine re-grades these now (engine/src/settle.ts, regradeSettled), so
   * this should never fire. It stays because "should never" is not a thing to
   * put a green tick behind.
   */
  const fromScore = hasScore
    ? didItLand({ market: x.market, outcome: x.outcome, line: x.line, homeGoals: hg, awayGoals: ag })
    : null;
  const fromGrade = RESULT_TONE[x.result] ?? 'back';
  const disputed = fromScore !== null && fromScore !== fromGrade
    && fromScore !== 'part' && fromGrade !== 'part';
  const tone = disputed ? 'back' : fromGrade;
  const said = recap({
    market: x.market, outcome: x.outcome, line: x.line, result: x.result,
    homeGoals: hg, awayGoals: ag, home: x.home_team, away: x.away_team,
  });

  return `
  <article class="recap is-${esc(tone)}">
    <a class="recap-tie" href="#/fixture/${encodeURIComponent(x.fixture_id)}">
      <span class="recap-side">${crest(x.home_team ?? '', 'sm', x.home_team_id)}<span>${esc(x.home_team ?? '')}</span>${
        hasScore ? `<b class="row-goals${hg > ag ? ' won' : ''}">${esc(hg)}</b>` : ''}</span>
      <span class="recap-side">${crest(x.away_team ?? '', 'sm', x.away_team_id)}<span>${esc(x.away_team ?? '')}</span>${
        hasScore ? `<b class="row-goals${ag > hg ? ' won' : ''}">${esc(ag)}</b>` : ''}</span>
      ${scorersHTML(x.goals)}
    </a>
    <div class="recap-body">
      <p class="recap-call">We said <b>${esc(d.name)}</b>${x.odds ? ` at ${oddsOf(x.odds)}` : ''}.</p>
      ${said ? `<p class="recap-what">${esc(said)}</p>` : ''}
      ${disputed ? '' : postMortemHTML(x)}
      ${(() => {
        /*
         * The argument we made before kick-off, shown back against what
         * happened. On a loss it is the most useful thing on the page and the
         * one thing nobody else publishes.
         *
         * Gated on content, not on a flag. Two thirds of the narratives on
         * record were written by the template grammar and say "expected
         * goals", "the model" and "our numbers" -- the private language the
         * vocabulary rule exists to keep off the page, which is why this was
         * never shown before. Judging each one on what it actually says means
         * the page fills itself as the writing improves, with nothing to
         * switch on.
         */
        // The members' "why" where the record has one; otherwise the
        // preview, unless it is a template write-up (a bare price is the tell
        // -- see verdictHTML).
        const templated = new RegExp(`\\b(?:at|priced)\\s+${dec(x.odds).replace('.', '\\.')}\\b`).test(String(x.narrative ?? ''));
        const allowed = [String(x.odds), dec(x.odds), String(x.line), x.line];
        const why = cleanProse(x.why, allowed) ?? (templated ? null : cleanProse(x.narrative, allowed));
        if (!why) return '';
        return `
        <details class="recap-why">
          <summary>${tone === 'lost' ? 'The reason we gave' : 'Why we said it'}</summary>
          <p>${esc(why)}</p>
        </details>`;
      })()}
    </div>
    <span class="mark ${esc(tone)}"${disputed ? ' title="The score and the grade disagree; this one is being re-checked."' : ''}>${
      disputed ? 'Re-checking' : esc(RESULT_WORD[x.result] ?? 'Void')}</span>
  </article>`;
}

// ---------------------------------------------------------------- leagues

/*
 * Every competition on the board, as a list rather than as forty-four cards.
 *
 * What was here spent two hundred and seventy-five vertical pixels per league
 * to say "Premier League, eight games, two calls", so the page was seven
 * thousand pixels long -- twelve screens to read a list of forty-four names.
 * It also set the league name in the muted colour and the counts in white,
 * which is the hierarchy exactly backwards: the name is the thing being
 * scanned for and the counts are the detail beside it.
 *
 * And a competition we have a call in looked identical to one we have nothing
 * in, on a page whose whole purpose is finding the calls. They lead now, and
 * the rest follow under their own heading rather than being mixed in.
 */
async function viewLeagues() {
  // Which navigation this page belongs to: a newer one makes it stand down (see route).
  const nav = navTicket;
  placeholder(`<div class="wrap section dense">
    <div class="rows">${'<div class="skeleton skeleton-row"></div>'.repeat(8)}</div>
  </div>`);
  const board = state.board ?? (await loadBoard());
  const fixtures = board.fixtures ?? [];

  const byLeague = new Map();
  for (const f of fixtures) {
    const k = f.league_id ?? f.league;
    const e = byLeague.get(k) ?? { name: f.league ?? '', id: f.league_id, n: 0, picks: 0, live: 0, rank: f.rank ?? 6 };
    e.n++;
    e.rank = Math.min(e.rank, f.rank ?? 6);
    if (f.top_pick || f.locked) e.picks++;
    if (matchState(f).kind === 'live') e.live++;
    byLeague.set(k, e);
  }

  const all = [...byLeague.values()].sort((a, b) => (a.rank ?? 6) - (b.rank ?? 6) || b.picks - a.picks || b.n - a.n);
  const withCalls = all.filter((e) => e.picks > 0);
  const without = all.filter((e) => e.picks === 0);
  const totalCalls = all.reduce((t, e) => t + e.picks, 0);

  const row = (e) => `
    <a class="lg" href="${e.id ? `#/league/${encodeURIComponent(e.id)}` : esc(boardHash(state.hours, e.name))}">
      ${crest(e.name, 'sm', e.id, 'league')}
      <span class="lg-name">${esc(e.name)}</span>
      ${e.live ? `<span class="lg-live"><i></i>${e.live}</span>` : ''}
      <span class="lg-games">${e.n} ${e.n === 1 ? 'game' : 'games'}</span>
      <span class="lg-calls${e.picks ? ' on' : ''}">${e.picks ? `${e.picks} ${e.picks === 1 ? 'call' : 'calls'}` : '—'}</span>
    </a>`;

  if (nav !== navTicket) return;
  app.innerHTML = `
  <div class="wrap section dense">
    <div class="page-head">
      <h1 class="display xl">Competitions</h1>
      <p class="page-sub">${all.length} ${all.length === 1 ? 'competition' : 'competitions'} on the board right now,
        out of 88 we cover. ${totalCalls
          ? `${totalCalls} ${totalCalls === 1 ? 'call' : 'calls'} between them.`
          : 'No calls anywhere on it at the moment.'}</p>
    </div>

    ${withCalls.length ? `
      <h2 class="side-head">Where the calls are</h2>
      <div class="lg-list">${withCalls.map(row).join('')}</div>` : ''}

    ${without.length ? `
      <h2 class="side-head">Nothing called in these${withCalls.length ? ', yet' : ''}</h2>
      <div class="lg-list muted">${without.map(row).join('')}</div>` : ''}
  </div>`;
}



// ----------------------------------------------------------------- league

/**
 * A competition's own page.
 *
 * The table, the games either side of today with our calls on them, the top
 * scorers, and how our calls in this competition have gone. Every league name
 * on the site links here, so a reader who meets "Categoría Primera A" on a
 * fixture page can find out what it is without leaving. The tabs work as they
 * do on a fixture page: the open one is in the address.
 */
async function viewLeague(id, params = new URLSearchParams()) {
  // Which navigation this page belongs to: a newer one makes it stand down (see route).
  const nav = navTicket;
  placeholder(skeletonHTML('rows'));
  let d;
  try { d = await getJSON(`/api/league/${encodeURIComponent(id)}`); } catch (err) { return errorState(err, nav); }
  const lg = d?.league;
  if (!lg?.id) return notFound('league', { nav, what: {
    title: 'Not a competition we cover',
    sub: 'The link may be old, or the competition may have left our list. The ones we cover are all on one page.',
    href: '#/leagues', label: 'See the leagues' } });

  const fixtures = Array.isArray(d.fixtures) ? d.fixtures : [];
  // Same rule as loadBoard: on a played match the record decides the call.
  for (const f of fixtures) {
    if (!Array.isArray(f.score)) continue;
    f.locked = false;
    f.top_pick = f.called ? { ...f.called, prices: [{ slug: '', book: f.called.bookmaker, odds: f.called.odds }] } : null;
  }
  const rank = (f) => { const k = matchState(f).kind; return k === 'live' ? 0 : k === 'upcoming' ? 1 : 2; };
  const ahead = fixtures.filter((f) => rank(f) < 2).sort((a, b) => rank(a) - rank(b) || a.kickoff - b.kickoff);
  const played = fixtures.filter((f) => rank(f) === 2).sort((a, b) => b.kickoff - a.kickoff);
  const calls = ahead.filter(hasCall).length;
  const live = ahead.filter((f) => matchState(f).kind === 'live').length;

  // Games, grouped by day, in board rows.
  const byDay = new Map();
  for (const f of ahead) {
    const k = dayLabel(f.kickoff);
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k).push(f);
  }
  /*
   * Beyond the board: the competition's own fixture list and latest results
   * (kept by the engine every few hours, leagueinfo.ts). The board reaches
   * three days ahead, so between rounds, and all through an international
   * break, a competition's page had no games on it at all. These are plain
   * fixtures: the analysis and the call open three days before kick-off.
   */
  const onBoard = new Set(fixtures.map((f) => Number(f.id)));
  const nextList = (Array.isArray(d.next) ? d.next : []).filter((g) => !onBoard.has(Number(g.id)));
  const lastList = (Array.isArray(d.last) ? d.last : []).filter((g) => !onBoard.has(Number(g.id)));
  const listRow = (g) => `
    <div class="fl-row">
      <span class="fl-when">${esc(g.score ? dayLabel(g.kickoff) : kickoffLabel(g.kickoff))}</span>
      <span class="fl-side home"><span>${esc(g.home)}</span>${crest(g.home, 'sm', g.home_id)}</span>
      <span class="fl-mid">${g.score ? `<b>${esc(g.score[0])}–${esc(g.score[1])}</b>` : 'v'}</span>
      <span class="fl-side away">${crest(g.away, 'sm', g.away_id)}<span>${esc(g.away)}</span></span>
    </div>`;
  const listBlock = (title, list, note = '') => list.length ? `
    <section class="league-block fixture-list">
      <h3 class="league-head">${esc(title)} <span class="count">${list.length}</span></h3>
      ${list.map(listRow).join('')}
      ${note ? `<p class="fl-note">${esc(note)}</p>` : ''}
    </section>` : '';

  const gamesHTML = (ahead.length ? [...byDay.entries()].map(([day, list]) => `
    <section class="league-block">
      <h3 class="league-head">${esc(day)} <span class="count">${list.length}</span></h3>
      ${list.map(rowHTML).join('')}
    </section>`).join('') : '')
    + listBlock(ahead.length ? 'Further ahead' : 'Coming up', nextList,
      'The analysis and the call open three days before kick-off.');

  const resultsHTML = (played.length ? `
    <section class="league-block">
      <h3 class="league-head">Played <span class="count">${played.length}</span></h3>
      ${played.map(rowHTML).join('')}
    </section>` : '') + listBlock(played.length ? 'Earlier' : 'Latest results', lastList);

  // The table. Columns the feed did not fill are left out rather than shown
  // as noughts.
  const rows = Array.isArray(d.standings) ? d.standings : [];
  const has = (k) => rows.some((r) => r[k] != null);
  const cols = [
    ['played', 'P', true], ['won', 'W', has('won')], ['drawn', 'D', has('drawn')], ['lost', 'L', has('lost')],
    ['goals_for', 'F', has('goals_for')], ['goals_against', 'A', has('goals_against')],
    ['goal_diff', 'GD', true], ['points', 'Pts', true],
  ].filter(([, , on]) => on);
  const cell = (r, k) => k === 'goal_diff'
    ? `${r.goal_diff > 0 ? '+' : ''}${r.goal_diff ?? ''}`
    : k === 'points' ? `<b>${r.points ?? ''}</b>` : String(r[k] ?? '');
  /*
   * A competition played in groups is one table per group. Drawn as one
   * table it listed four teams in first place, four in second and so on,
   * which is not a table of anything.
   */
  const groups = new Map();
  for (const r of rows) {
    const g = r.group ?? '';
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(r);
  }
  const oneTable = (list) => `
      <div class="scroll-x"><table class="tbl standings">
        <thead><tr><th>#</th><th>Team</th>${cols.map(([, h]) => `<th class="num">${h}</th>`).join('')}</tr></thead>
        <tbody>${list.map((r) => `
          <tr>
            <td class="num">${esc(r.position ?? '')}</td>
            <td class="team">${crest(r.team ?? '', 'sm', r.team_id)}<span>${esc(r.team ?? `Team ${r.team_id}`)}</span></td>
            ${cols.map(([k]) => `<td class="num">${cell(r, k)}</td>`).join('')}
          </tr>`).join('')}</tbody>
      </table></div>`;
  const asOf = d.standings_at ? ` <span>as of ${esc(kickoffLabel(d.standings_at))}</span>` : '';
  const grouped = groups.size > 1 || (groups.size === 1 && !groups.has(''));
  /*
   * A real group has three to six teams. The provider sends the Nations
   * League's groups merged across its four leagues, so its "Group 1" is one
   * ranking of fifteen countries from League A to League D, with nothing in
   * the data to pull them apart. A table like that is not a table of
   * anything, so it is left out and the page says why, rather than printing
   * something wrong with our name on it.
   */
  const MAX_GROUP = 6;
  const realGroups = [...groups.entries()].filter(([, list]) => list.length <= MAX_GROUP);
  const merged = grouped && realGroups.length < groups.size;
  const mergedNote = `<div class="empty-state"><b>No reliable table for this one</b>
      <span>The group tables for this competition reach us merged across its leagues, fifteen
      teams to a group, so we have left them out rather than show them wrong. Every game and
      result is on the other tabs.</span></div>`;
  const tableHTML = !rows.length ? '' : grouped
    ? (realGroups.length
        ? `<div class="group-tables">${realGroups.map(([g, list]) => `
        <div class="panel">
          <p class="panel-head">${esc(g ? (/^group\b/i.test(g) ? g : `Group ${g}`) : 'Table')}${asOf}</p>
          ${oneTable(list)}
        </div>`).join('')}</div>${merged ? mergedNote : ''}`
        : mergedNote)
    : `<div class="panel"><p class="panel-head">The table${asOf}</p>${oneTable(rows)}</div>`;

  const scorers = Array.isArray(d.scorers) ? d.scorers.slice(0, 15) : [];
  const scorersHTML = scorers.length ? `
    <div class="panel">
      <p class="panel-head">Top scorers</p>
      <ol class="scorer-list">${scorers.map((s, i) => `
        <li data-player="${esc(s.player_id)}" data-rank="${chartRank(scorers, i)}">
          ${crest(s.name, 'sm', s.player_id, 'player')}
          <span class="scorer-name">${esc(s.name)}${s.team_name ? `<small>${esc(s.team_name)}</small>` : ''}</span>
          <b>${esc(s.goals)}</b>${s.assists ? `<small>${esc(s.assists)} assist${s.assists === 1 ? '' : 's'}</small>` : ''}
        </li>`).join('')}</ol>
    </div>` : '';

  const rec = d.record ?? {};
  const recent = Array.isArray(d.recent) ? d.recent : [];
  const recordHTML = rec.n ? `
    <div>
      <div class="section-head"><div><h2 class="display">Our calls here</h2></div></div>
      ${formBarHTML(rec.wins, 0, rec.n - rec.wins, ['landed', 'void', 'missed'], `${rec.n} settled call${rec.n === 1 ? '' : 's'} in this competition.`)}
      ${playedHTML(recent.slice(0, 12))}
    </div>` : '';

  const TABS = [
    ['games', 'Games', gamesHTML],
    ['table', 'Table', tableHTML],
    ['results', 'Results', resultsHTML],
    ['scorers', 'Top scorers', scorersHTML],
    ['calls', 'Our calls', recordHTML],
  ].filter(([, , html]) => html);
  const asked = params.get('tab');
  const open = TABS.some(([k]) => k === asked) ? asked : TABS[0]?.[0];

  const sub = [
    lg.country,
    ahead.length ? `${ahead.length} game${ahead.length === 1 ? '' : 's'} coming up`
      : nextList[0] ? `Next games ${kickoffLabel(nextList[0].kickoff).replace(/^(Today|Tomorrow)/, (w) => w.toLowerCase())}` : null,
    calls ? `${calls} call${calls === 1 ? '' : 's'}` : null,
    live ? `${live} on now` : null,
  ].filter(Boolean).join('. ');

  if (nav !== navTicket) return;
  app.innerHTML = `
  <div class="wrap section dense">
    <div class="page-head league-title">
      ${crest(lg.name, 'md', lg.id, 'league')}
      <div>
        <h1 class="display xl">${esc(lg.name)}</h1>
        ${sub ? `<p class="page-sub">${esc(sub)}.</p>` : ''}
      </div>
      ${followButtonHTML('league', lg.id, lg.name)}
    </div>
    ${TABS.length ? `
    <div class="tabs" role="tablist">
      ${TABS.map(([k, label]) => `<button class="tab${k === open ? ' on' : ''}" data-tab="${k}" role="tab" aria-selected="${k === open}">${esc(label)}</button>`).join('')}
    </div>
    ${TABS.map(([k, , html]) => `<div class="tabpane" data-pane="${k}"${k === open ? '' : ' hidden'}>${html}</div>`).join('')}`
    : `<div class="empty-state"><b>Nothing on record here yet</b>
         <span>The table and the games fill in once the board has covered this competition.</span>
         <a class="btn btn-primary" href="#/leagues">Every competition</a></div>`}
  </div>`;

  wireFollowButtons();

  // Arrived from a name in the analysis: that player, highlighted, in view.
  const wanted = params.get('p');
  const row = wanted ? app.querySelector(`.scorer-list li[data-player="${CSS.escape(wanted)}"]`) : null;
  if (row) {
    row.classList.add('is-me', 'flash');
    state.scrollTarget = row;
  }

  for (const t of app.querySelectorAll('.tab')) {
    t.onclick = () => {
      for (const o of app.querySelectorAll('.tab')) {
        const on = o === t;
        o.classList.toggle('on', on);
        o.setAttribute('aria-selected', String(on));
      }
      for (const pane of app.querySelectorAll('.tabpane')) pane.hidden = pane.dataset.pane !== t.dataset.tab;
      const q = t.dataset.tab === TABS[0][0] ? '' : `?tab=${encodeURIComponent(t.dataset.tab)}`;
      history.replaceState(null, '', `${location.pathname}#/league/${encodeURIComponent(id)}${q}`);
    };
  }
}

// ----------------------------------------------------------------- player

/**
 * A player's page, reached from a name in the analysis.
 *
 * What we hold on them, put where a reader looks first: where they stand in
 * the competition they were mentioned in (their goals, their place in its
 * scoring chart, the chart itself with them in it), how they played in the
 * matches we have reports for, and when their team plays next. The chart is
 * the point of the page for the brief it came from: a reader who follows
 * "Haaland has been dangerous" lands on the proof.
 */
async function viewPlayer(id, params = new URLSearchParams()) {
  // Which navigation this page belongs to: a newer one makes it stand down (see route).
  const nav = navTicket;
  placeholder(skeletonHTML());
  const league = Number(params.get('league')) || null;
  let d;
  try { d = await getJSON(`/api/player/${encodeURIComponent(id)}${league ? `?league=${league}` : ''}`); }
  catch (err) { return errorState(err, nav); }
  // Nothing at all on this id: say so and offer a way on, rather than a page
  // headed "Player" with nothing under it and no link out.
  if (!d?.name && !d?.matches?.length && !d?.competitions?.length && !d?.next?.length) {
    if (nav !== navTicket) return;
    app.innerHTML = `
    <div class="wrap section">
      <div class="page-head">
        <h1 class="display xl">${esc(params.get('n') || 'No such player')}</h1>
        <p class="page-sub">We have nothing on this player yet. Their page fills in from the scoring charts and the
          reports of matches we cover, so it appears once they have played in one.</p>
      </div>
      <div class="cta-row">
        <a class="btn btn-primary" href="#/search">Find a game</a>
        <a class="btn btn-ghost" href="#/leagues">The leagues</a>
      </div>
    </div>`;
    return;
  }
  const name = d?.name || params.get('n') || 'Player';
  const lead = d?.lead_league ?? null;
  const comp = (d?.competitions ?? []).find((c) => Number(c.league_id) === Number(lead?.id)) ?? d?.competitions?.[0] ?? null;
  const matches = Array.isArray(d?.matches) ? d.matches : [];
  const rated = matches.filter((m) => typeof m.rating === 'number');
  const avg = rated.length ? rated.reduce((t, m) => t + Number(m.rating), 0) / rated.length : null;
  const goalsSeen = matches.reduce((t, m) => t + (Number(m.goals) || 0), 0);
  const assistsSeen = matches.reduce((t, m) => t + (Number(m.assists) || 0), 0);

  // The figures, as a sentence rather than a grid of boxes. The goals and the
  // chart place are already in the line under the name; this says the rest.
  const fig = (n, cls = '') => `<b class="fig${cls ? ` ${cls}` : ''}">${esc(n)}</b>`;
  const facts = [];
  if (comp?.assists) facts.push(`${fig(comp.assists)} ${comp.assists === 1 ? 'assist' : 'assists'} in the ${esc(comp.league ?? 'competition')}.`);
  if (matches.length) {
    facts.push(`Seen in ${fig(matches.length)} ${matches.length === 1 ? 'match' : 'matches'} we covered${
      avg !== null ? `, with an average rating of ${fig(avg.toFixed(1), avg >= 7 ? 'won' : '')}` : ''}${
      !comp && (goalsSeen || assistsSeen) ? ` and ${fig(goalsSeen, 'won')} ${goalsSeen === 1 ? 'goal' : 'goals'} in those` : ''}.`);
  }
  const cells = facts;

  // The competition's chart, with this player in it.
  const chart = Array.isArray(d?.lead_scorers) ? d.lead_scorers.slice(0, 10) : [];
  const inChart = chart.some((r) => Number(r.player_id) === Number(id));
  const chartHTML = chart.length ? `
    <div class="panel">
      <p class="panel-head">Top scorers${lead?.name ? `, ${esc(lead.name)}` : ''} ${lead?.id ? `<a href="#/league/${encodeURIComponent(lead.id)}?tab=scorers">The full list</a>` : ''}</p>
      <ol class="scorer-list">${chart.map((r, i) => `
        <li class="${Number(r.player_id) === Number(id) ? 'is-me' : ''}" data-rank="${chartRank(chart, i)}">
          ${crest(r.name, 'sm', r.player_id, 'player')}
          <span class="scorer-name">${playerLink(r.player_id, r.name, lead?.id)}${r.team_name ? `<small>${esc(r.team_name)}</small>` : ''}</span>
          <b>${esc(r.goals)}</b>${r.assists ? `<small>${esc(r.assists)} assist${r.assists === 1 ? '' : 's'}</small>` : ''}
        </li>`).join('')}</ol>
      ${!inChart && comp ? `<p class="muted small">${esc(name)} is ${esc(ordinal(comp.rank))} on the list, with ${esc(comp.goals)} goal${comp.goals === 1 ? '' : 's'}.</p>` : ''}
    </div>` : '';

  const matchesHTML = matches.length ? `
    <div class="panel">
      <p class="panel-head">Recent matches</p>
      <div class="pl-matches">${matches.map((m) => {
        const sc = Array.isArray(m.score) ? m.score : null;
        const bits = [];
        for (let i = 0; i < (Number(m.goals) || 0); i++) bits.push(EV_ICON.goal);
        if (m.assists) bits.push(`<i class="tl-assist" role="img" aria-label="${m.assists} assist${m.assists === 1 ? '' : 's'}">${m.assists > 1 ? m.assists : ''}</i>`);
        if (m.red) bits.push(EV_ICON.red); else if (m.yellow) bits.push(EV_ICON.yellow);
        return `
        <a class="pl-match" href="#/fixture/${encodeURIComponent(m.fixture_id)}">
          <span class="pl-when">${esc(dayLabel(m.kickoff))}<small>${esc(m.league ?? '')}</small></span>
          <span class="pl-tie">${crest(m.home, 'xs', m.home_id)}${esc(m.home)} <b>${sc ? `${esc(sc[0])}–${esc(sc[1])}` : 'v'}</b> ${esc(m.away)}${crest(m.away, 'xs', m.away_id)}</span>
          <span class="pl-did">${bits.join('')}${m.minutes != null ? `<small>${esc(m.minutes)}'</small>` : ''}${
            typeof m.rating === 'number' ? `<b class="rating ${ratingClass(m.rating)}">${Number(m.rating).toFixed(1)}</b>` : ''}</span>
        </a>`;
      }).join('')}</div>
    </div>` : '';

  const next = Array.isArray(d?.next) ? d.next : [];
  const nextHTML = next.length ? `
    <div class="panel">
      <p class="panel-head">Next up</p>
      <div class="side-list">${next.map((n) => `
        <a class="side-item" href="#/fixture/${encodeURIComponent(n.fixture_id)}">
          <span class="side-thumb">${crest(n.home, 'sm', n.home_id)}${crest(n.away, 'sm', n.away_id)}</span>
          <span class="side-body"><span class="side-sel">${esc(n.home)} v ${esc(n.away)}</span>
            <span class="side-meta">${esc(kickoffLabel(n.kickoff))}${n.league ? `, ${esc(n.league)}` : ''}</span></span>
        </a>`).join('')}</div>
    </div>` : '';

  const others = (d?.competitions ?? []).filter((c) => c !== comp);
  const othersHTML = others.length ? `
    <div class="panel">
      <p class="panel-head">In other competitions</p>
      <div class="side-list">${others.map((c) => `
        <a class="side-item" href="#/league/${encodeURIComponent(c.league_id)}?tab=scorers">
          <span class="side-body"><span class="side-sel">${esc(c.league ?? 'Competition')}</span>
          <span class="side-meta">${esc(c.goals)} goal${c.goals === 1 ? '' : 's'}, ${esc(ordinal(c.rank))} in the chart</span></span>
        </a>`).join('')}</div>
    </div>` : '';

  const meta = [
    POSITION[d?.position] ?? null,
    d?.number ? `No. ${d.number}` : null,
    d?.team?.name ?? null,
  ].filter(Boolean);
  const empty = !cells.length && !chart.length && !matches.length && !next.length;

  if (nav !== navTicket) return;
  app.innerHTML = `
  <div class="wrap section dense">
    <div class="page-head player-head">
      <span class="player-face">${crest(name, 'md', id, 'player')}</span>
      <div>
        <h1 class="display xl">${esc(name)}</h1>
        ${comp ? `<p class="player-line">${esc(comp.goals)} goal${comp.goals === 1 ? '' : 's'} in the ${esc(comp.league ?? 'competition')}, ${comp.rank === 1 ? 'top of' : `${esc(ordinal(comp.rank))} in`} its scoring chart</p>` : ''}
        ${meta.length ? `<p class="page-sub">${d?.team?.id ? `${crest(d.team.name ?? '', 'xs', d.team.id)} ` : ''}${esc(meta.join(', '))}</p>` : ''}
      </div>
    </div>
    ${cells.length ? `<p class="figure-line player-facts">${cells.join(' ')}</p>` : ''}
    ${empty ? `<div class="empty-state"><b>Not much on ${esc(name)} yet</b>
        <span>We build this page from the scoring charts and the match reports we hold. Once
        ${esc(name)} scores in a competition we cover, or plays in a match we report on, it fills in.</span>
        ${league ? `<a class="btn btn-primary" href="#/league/${encodeURIComponent(league)}">The competition</a>` : ''}</div>` : `
    <div class="with-side player-body">
      <div class="stack">${chartHTML}${matchesHTML}</div>
      <aside class="home-side">${nextHTML}${othersHTML}</aside>
    </div>`}
  </div>`;
}

// ------------------------------------------------- membership: the pages

/**
 * A write, which is a different shape from every other request this file makes.
 *
 * Reads are GET and stream through the Worker untouched. These three do not:
 * they are POSTs that need the reader's token to say who is asking, and the
 * Worker answers them itself rather than proxying a serving function.
 */
async function postJSON(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(await authHeaders()) },
    body: JSON.stringify(body ?? {}),
  });
  let data = null;
  try { data = await res.json(); } catch { /* no body */ }
  if (!res.ok) {
    const err = new Error(data?.error ?? 'Something went wrong. Nothing has been charged.');
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

/**
 * Hand over to the processor.
 *
 * The plan is named, never priced: the amount is read from the database on the
 * server side, so a client that asks to pay a penny is told what it actually
 * costs. Signing in first is required because a payment with nobody attached to
 * it cannot be turned into a membership.
 */
/*
 * What the reader was trying to do when they were sent to sign in.
 *
 * It has to survive a round trip through an email client and back, so it is in
 * storage rather than in memory or in the address bar. Without it the buyer who
 * tapped "Sign in to join", signed in, and came back was returned to the home
 * page with the purchase abandoned and nothing on screen acknowledging that
 * they had been in the middle of anything.
 */
/*
 * A redirect that does not leave a trap behind it.
 *
 * `#/account` signed out sends you to `#/signin`, and the back button sent you
 * to `#/account`, which sent you to `#/signin` again: a reader could not get
 * out of the pair without closing the tab. Replacing the entry rather than
 * pushing one means Back goes to wherever they actually came from.
 */
/**
 * Put a button into its working state: disabled, a turning wheel, and words
 * for what is happening. Returns the undo, which reports whether there was
 * anything to undo.
 *
 * Every busy button is also undone when the browser restores the page from
 * its back/forward cache. Back from Google's sign-in brought the page back
 * exactly as it was left: a button frozen on "Taking you to Google".
 */
const busyButtons = new Set();
function busy(button, label) {
  if (!button) return () => false;
  const was = button.innerHTML;
  button.disabled = true;
  button.classList.add('is-busy');
  button.setAttribute('aria-busy', 'true');
  button.innerHTML = `<span class="spin" aria-hidden="true"></span><span>${esc(label)}</span>`;
  const undo = () => {
    if (!busyButtons.delete(undo)) return false;
    button.disabled = false;
    button.classList.remove('is-busy');
    button.removeAttribute('aria-busy');
    button.innerHTML = was;
    return true;
  };
  busyButtons.add(undo);
  return undo;
}
addEventListener('pageshow', (e) => { if (e.persisted) for (const undo of [...busyButtons]) undo(); });

const goInstead = (hash) => location.replace(`${location.pathname}${location.search}${hash}`);

const INTENT_KEY = 'ow.after-signin';
/*
 * Where to go once signed in, kept for an hour. It used to be kept until
 * used, so a sign-in abandoned on Monday sent Thursday's sign-in back to
 * Monday's match.
 */
const setIntent = (v) => { try { localStorage.setItem(INTENT_KEY, JSON.stringify({ v, at: Date.now() })); } catch { /* private mode */ } };
const readIntent = () => {
  let raw = null;
  try { raw = localStorage.getItem(INTENT_KEY); } catch { return null; }
  if (!raw) return null;
  let o = null;
  try { o = JSON.parse(raw); } catch { return raw; /* stored before it carried a time */ }
  if (!o || typeof o !== 'object' || typeof o.v !== 'string') return null;
  return Date.now() - Number(o.at) < 3600e3 ? o.v : null;
};
const takeIntent = () => {
  const v = readIntent();
  try { localStorage.removeItem(INTENT_KEY); } catch { /* private mode */ }
  return v;
};

/*
 * The last page the reader was reading (a match, the board, the slip), kept
 * for the visit, so signing in and paying can bring them back to it rather
 * than to the front page or their account. Session storage: it survives the
 * round trip to Whop's checkout and Google's sign-in, and not a new visit.
 */
const READING_KEY = 'ow.reading';
const READING_ROUTES = new Set(['fixture', 'board', 'slip', 'results', 'league', 'player', 'leagues', 'search', 'home']);
const setReading = (name) => {
  if (!READING_ROUTES.has(name)) return;
  const hash = location.hash || (pathRoute() ? `#${pathRoute()}` : '#/home');
  try { sessionStorage.setItem(READING_KEY, hash); } catch { /* private mode */ }
};
const reading = () => { try { return sessionStorage.getItem(READING_KEY); } catch { return null; } };

/**
 * A sign-in that finished on this page (Google's button), rather than on a
 * return from a link: carry on where the reader was, exactly as the boot
 * sequence does for a magic link.
 */
async function afterSignIn() {
  state.member = null;
  state.account = null;
  cacheClear();
  const intent = takeIntent();
  if (intent?.startsWith('buy')) {
    history.replaceState(null, '', `${location.pathname}#/pricing`);
    await route();
    await startCheckout(intent.split(':')[1] || 'monthly', intent.split(':')[2] || null);
    headerAuth();
    return;
  }
  history.replaceState(null, '', `${location.pathname}${intent && intent.startsWith('#/') ? intent : '#/home'}`);
  await route();
  headerAuth();
}

async function startCheckout(plan = 'monthly', promoId = null) {
  /*
   * Signed in first, always. The membership is attached to the account that
   * asked for it (its id travels with the payment), so whatever email the
   * buyer gives the card form, it lands on the right account. A reader who is
   * signed out is sent to sign in and comes straight back to this plan.
   */
  // The offer the reader clicked, if any, goes with them through sign-in.
  const promoQ = promoId ? `&promo=${encodeURIComponent(promoId)}` : '';
  if (!(await currentUser())) {
    setIntent(`buy:${plan}${promoId ? `:${promoId}` : ''}`);
    location.hash = '#/signin';
    return;
  }
  location.hash = `#/checkout?plan=${encodeURIComponent(plan)}${promoQ}`;
}

/**
 * Whop's whole checkout in a sheet, or failing that Whop's own page.
 *
 * The fallback for our checkout page: used while the API key cannot take a
 * payment itself, or if the card fields will not load.
 */
async function openEmbeddedCheckout(plan, consent, promo) {
  const out = await postJSON('/api/pay/checkout', { plan, consent, ...(promo ? { promo } : {}) });
  if (out.checkout) {
    try {
      await openCheckout({
        checkout: out.checkout,
        returnUrl: out.returnUrl,
        // The plan and its length only. The price is Whop's to show: it
        // prices in the buyer's own currency, so "£1" here sat over "$1.35"
        // in the form for a reader in America.
        title: PLAN_LINE[plan] ?? 'Membership',
        onPaid: () => { location.hash = '#/account?paid=1'; },
      });
      return;
    } catch (err) {
      // Whop's script would not load (a blocker, a bad connection): its own
      // checkout page takes the same payment with the same account id on it.
      if (out.link) { location.href = out.link; return; }
      throw err;
    }
  }
  if (!out.link) throw new Error('The payment page could not be opened.');
  location.href = out.link;
}

/** Where the payment happens when Whop's fields are not on our page. */
function checkoutWhere(trial, moving) {
  if (trial) return 'Whop\'s secure checkout opens over this page. It takes your card and charges nothing today.';
  if (moving) return 'Whop\'s secure checkout opens over this page to keep your card for that date.';
  return 'Whop\'s secure checkout opens over this page to take the payment.';
}

/** What the card form's heading says, per plan. */
const PLAN_LINE = {
  matchday: 'Matchday pass: seven days, one payment',
  monthly: 'Monthly membership: renews each month',
  quarter: '3-month membership: renews every three months',
  season: 'Season ticket: renews each year',
};

/** Turn renewal on or off. Takes effect immediately, both ways. */
async function setRenewal(on, button) {
  // One request per tap: the button waits for the answer, and a failure is
  // said beside it rather than in a browser alert.
  if (button) button.disabled = true;
  button?.parentElement?.querySelector('.acct-note')?.remove();
  try {
    await postJSON('/api/pay/renewal', { auto_renew: on });
    await viewAccount();
  } catch (err) {
    if (button) {
      button.disabled = false;
      button.insertAdjacentHTML('afterend', `<span class="acct-note bad" role="status">${esc(err.message)}</span>`);
    } else {
      alert(err.message);
    }
  }
}

/**
 * The pricing page's pointer to today's free call: the real one, and in the
 * right tense. Before kick-off it is an invitation to read it; once played,
 * the score and how it went, because a free call that landed is the best
 * argument this page has and one that missed is shown just the same.
 */
function freeLineHTML(free) {
  if (!free?.home) return '';
  const st = matchState(free);
  const score = Array.isArray(free.score) ? free.score : Array.isArray(free.live_score) ? free.live_score : null;
  const WORD = { WON: 'It landed.', HALF_WON: 'Half of it landed.', LOST: 'It missed.', HALF_LOST: 'Half of it missed.', PUSH: 'Stake back.', VOID: 'Stake back.' };
  const tie = score && st.kind !== 'upcoming'
    ? `${esc(free.home)} ${esc(score[0])}–${esc(score[1])} ${esc(free.away)}`
    : `${esc(free.home)} v ${esc(free.away)}`;
  const say = st.kind === 'upcoming' ? 'Free to read in full. Watch it land, then decide.'
    : st.kind === 'live' ? 'Under way now. The call is free to read.'
    : `${WORD[(free.published ?? []).find((x) => x?.market)?.result ?? free.called?.result] ?? 'Played.'} Read how it went.`;
  return `
    <a class="freecall-line" href="#/fixture/${encodeURIComponent(free.id ?? free.fixture_id)}">
      <span class="freecall-tag">Today's free call</span>
      <b>${tie}</b>
      <span>${esc(say)}</span>
    </a>`;
}

/**
 * What a membership costs.
 *
 * One plan, one price, one button. No decoy tier that exists only to flatter
 * the one beside it, and no claim about returns anywhere on the page -- the
 * settled record is public and negative, so selling coverage and explanation is
 * the only honest pitch and it is the one that survives an ad review.
 */
/** The plans in the order the pricing page shows them. */
const order0 = (plans) => ['matchday', 'monthly', 'quarter'].filter((id) => (plans ?? []).some((p) => p.id === id));

async function viewPricing() {
  // Which navigation this page belongs to: a newer one makes it stand down (see route).
  const nav = navTicket;
  placeholder(skeletonHTML());
  const [user, plans, hero, running, sure, board] = await Promise.all([
    currentUser(),
    getJSON('/api/plans').catch(() => []),
    getJSON('/api/hero').catch(() => null),
    getJSON('/api/promos').catch(() => []),
    getJSON('/api/how-sure').catch(() => null),
    loadBoard().catch(() => null),
  ]);
  // Proof beside the price, all of it checkable: the record, whether our
  // confidence holds up, and what is on the board today.
  const callsToday = (board?.fixtures ?? []).filter((f) => hasCall(f) && matchState(f).kind === 'upcoming').length;
  const sureTenths = sure?.n >= 50 ? Math.round(Number(sure.said) * 10) : 0;
  const sureHolds = sureTenths && Math.abs(Number(sure.landed) / Number(sure.n) - Number(sure.said)) <= 0.04;
  // A member arriving here is shown what they have, not sold it again.
  let account = null;
  if (user) {
    try { account = await getJSON('/api/account', { fresh: true }); } catch { /* shown as signed out */ }
    if (account) state.account = account;
  }
  const mine = liveMembership(account);
  // A deal or a free trial on a plan, when one is running and this reader
  // may have it (js/lib/promo.js). Checkout finds the same one by the plan.
  const promo = Array.isArray(running) && running.length && !mine ? await import('./js/lib/promo.js').catch(() => null) : null;
  const offerOn = (id) => (promo ? running.find((o) => o.plan_id === id && o.kind !== 'notice' && promo.eligible(o, { signedIn: !!user, member: false, returning: !!account?.returning })) ?? null : null);
  if (promo && order0(plans).some((id) => offerOn(id))) promo.ensureStyles();
  // The free call is its own fixture, chosen by the slate: not the headline
  // match. Pointing this line at the headline sent readers to a locked call
  // under a label that said it was free.
  const freeId = hero?.free_fixture_id;
  const free = freeId ? await getJSON(`/api/fixture/${encodeURIComponent(freeId)}`).catch(() => null) : null;
  const money = (minor, cur) => new Intl.NumberFormat('en-GB', { style: 'currency', currency: cur || 'GBP', minimumFractionDigits: minor % 100 ? 2 : 0 }).format(minor / 100);
  const byId = Object.fromEntries((plans ?? []).map((p) => [p.id, p]));
  const order = ['matchday', 'monthly', 'quarter'].filter((id) => byId[id]);

  /*
   * What each plan is, in the reader's words.
   *
   * A matchday pass is one payment for a weekend and stops. The month and the
   * season ticket renew until cancelled, because that is how the processor
   * sells a subscription and a reader has to be told so before, not after.
   */
  const COPY = {
    matchday: { blurb: 'A weekend of every call. One payment, seven days, and it stops.', renews: false, tag: null },
    // "Our pick", not "Most take this": nobody has taken anything yet, and a
    // popularity claim we cannot back is the misleading kind (CMA, DMCC Act).
    monthly:  { blurb: 'All the calls, all month. Renews each month until you cancel.', renews: true, tag: 'Our pick' },
    quarter:  { blurb: 'Three months of every call, cheaper by the month. Renews every three months until you cancel.', renews: true, tag: 'Best value' },
  };
  // A longer plan said in smaller units too, the way it is easiest to weigh.
  const perMonth = (p) => {
    const week = money(Math.round(p.amount_minor / (p.days / 7)), p.currency);
    if (p.days >= 80) return `${money(Math.round(p.amount_minor / Math.round(p.days / 30)), p.currency)} a month, about ${week} a week`;
    return p.days > 7 ? `About ${week} a week` : null;
  };
  const per = (p) => (p.days === 7 ? 'for the week' : p.days >= 300 ? 'a year' : p.days >= 80 ? 'for three months' : 'a month');

  // What each plan's button does for this reader: buy it, or, for a member,
  // nothing (it is theirs), an upgrade, or a switch that has to wait for the
  // renewing plan to be cancelled so nobody pays for two.
  /*
   * A member moving plans keeps every day already paid for: the new plan
   * starts now and its first payment is on the date the old one was paid
   * to. So the button says so, and the card says when the new price begins.
   */
  const buttonFor = (id, p) => {
    const buy = p.days === 7 ? 'Get the weekend' : p.days >= 80 ? 'Get three months' : 'Join for the month';
    if (!mine) return { label: buy };
    if (mine.plan_id === id) return { label: 'Your plan', mine: true };
    if (id === 'matchday') return { label: 'Covered by yours', covered: true };
    const up = p.days > (PLAN_DAYS[mine.plan_id] ?? 0);
    return { label: up ? 'Upgrade' : 'Switch', quiet: !up,
      note: `Nothing to pay today. ${money(p.amount_minor, p.currency)} from ${shortDate(mine.expires_at)}, when what you have paid for runs out.` };
  };

  if (nav !== navTicket) return;
  app.innerHTML = `
  <div class="wrap section">
    ${mine ? `
    <div class="page-head">
      <h1 class="display xl">You are in. Every call is open.</h1>
      <p class="page-sub">Your ${esc((PLAN_NAME[mine.plan_id] ?? 'membership').toLowerCase())} runs to
        ${esc(longDate(mine.expires_at))}${renewsItself(mine) ? ' and renews by itself' : mine.plan_id === 'matchday' ? ' and then stops' : ''}.</p>
      <div class="member-actions">
        <a class="btn btn-accent" href="#/board">Today's calls</a>
        <a class="btn btn-ghost" href="#/account?tab=membership">Your membership</a>
      </div>
    </div>` : `
    <div class="page-head">
      <h1 class="display xl">One call a day is free. Members get all of them.</h1>
      <p class="page-sub">Every preview, every team sheet and the whole record stay free. Membership is
        every open call the moment it goes up, the legs of the bet slip, and the reason behind each call.</p>
    </div>

    ${sure?.n || callsToday ? `<ul class="plan-proof">
      ${sure?.n ? `<li><b>${Number(sure.landed)} of ${Number(sure.n)}</b> settled calls landed, misses counted. <a href="#/results">Every result</a></li>` : ''}
      ${sureHolds ? `<li>When we say ${esc(TENTHS[sureTenths])} in ten, ${esc(TENTHS[sureTenths])} in ten land. <a href="#/how-sure">How we check</a></li>` : ''}
      ${callsToday > 1 ? `<li><b>${callsToday} calls</b> on the board still to kick off. One is free.</li>` : ''}
    </ul>` : ''}
    ${freeLineHTML(free)}`}

    <div class="plans" data-public-price>
      ${order.map((id) => {
        const p = byId[id];
        const c = COPY[id];
        const b = buttonFor(id, p);
        const o = offerOn(id);
        const lead = mine ? mine.plan_id === id : o ? true : id === 'monthly' && !order.some((x) => offerOn(x));
        return `
        <section class="plan${lead ? ' plan-main' : ''}${b.mine ? ' plan-mine' : ''}${o ? ' plan-offer' : ''}">
          ${b.mine ? `<span class="plan-tagline is-mine">Yours to ${esc(shortDate(mine.expires_at))}</span>` : o ? `<span class="plan-tagline is-offer">${esc(o.title)}</span>` : !mine && c.tag ? `<span class="plan-tagline">${esc(c.tag)}</span>` : ''}
          <h2>${esc(p.name)}</h2>
          ${o?.kind === 'deal' ? `<p class="plan-price"><s>${esc(money(p.amount_minor, p.currency))}</s> <b>${esc(money(o.price_minor, p.currency))}</b>
            <span>${esc(per(p))}</span></p>` : o?.kind === 'trial' ? `<p class="plan-price"><b>${esc(o.trial_days)} days free</b>
            <span>then ${esc(money(p.amount_minor, p.currency))} ${esc(per(p))}</span></p>` : `<p class="plan-price"><b>${esc(money(p.amount_minor, p.currency))}</b>
            <span>${esc(per(p))}</span></p>`}
          ${o ? `<p class="plan-ends">Ends in <span class="plan-clock" data-ends="${esc(o.ends_at)}"></span></p>` : ''}
          ${perMonth(p) ? `<p class="plan-per">${esc(perMonth(p))}</p>` : ''}
          <p class="plan-blurb">${esc(c.blurb)}</p>
          ${b.note ? `<p class="plan-switch">${esc(b.note)}</p>` : ''}
          ${b.mine
            ? `<a class="btn btn-ghost btn-lg" href="#/account?tab=membership">Your plan</a>`
            : b.covered
              ? `<button class="btn btn-ghost btn-lg" type="button" disabled>${esc(b.label)}</button>`
              : `<button class="btn ${b.quiet ? 'btn-ghost' : lead || !mine ? 'btn-accent' : 'btn-primary'} btn-lg" data-buy="${esc(id)}"${o ? ` data-promo="${esc(o.id)}"` : ''}>${esc(o ? (o.cta || (o.kind === 'trial' ? 'Start the free days' : 'Get the deal')) : b.label)}</button>`}
        </section>`;
      }).join('')}
    </div>

    <div class="tiers">
      <section class="tier">
        <h3>Free, always</h3>
        <ul class="ticks">
          <li>One full call a day, with the reason: the call we are surest of</li>
          <li>Every preview: team news, who starts, who scores, the form</li>
          <li>The bet slip's size, its total odds and its record</li>
          <li>Every settled call, with why it landed or did not</li>
        </ul>
      </section>
      <section class="tier tier-paid">
        <h3>Members</h3>
        <ul class="ticks">
          <li><b>Every open call</b> the moment it goes up, with the odds and the book</li>
          <li><b>The bet slip's legs</b>, before the first one kicks off</li>
          <li><b>Why this call</b> on every match: the argument for this market at these odds</li>
          <li>The board's filters by league and by day</li>
        </ul>
      </section>
    </div>

    <div class="prose pricing-small">
      <p><b>Paying.</b> You pay on this page, in a card form run by Whop, who take the payment. Your card
        details go to Whop and never reach us. The membership goes on the account you are signed in with,
        whatever email you give the card form.</p>
      <p><b>Calls move until kick-off.</b> Every match is looked at again every fifteen minutes as team news
        and prices come in, so a call can change, or come down if we stop backing it. At kick-off it closes:
        calls are not sold once a match is on, and each one is graded at full time. The bet slip is the
        exception: once it is posted it stays exactly as it is, and it is graded on the legs it went up with.</p>
      <p><b>Moving plans is fair.</b> Go from a matchday pass to a month, or from a month to three,
        whenever you like. Every day you have already paid for is kept: the new plan starts straight
        away, nothing is charged until your paid time runs out, and the plan you leave stops renewing.
        You never pay twice for the same day.</p>
      <p><b>Quiet spells are on us.</b> When the big leagues stop for an international break or the close
        season, there are fewer calls to make. So every paying member gets a day added for each quiet day,
        automatically, and an email saying how many when the football is back.</p>
      <p><b>It starts when you pay.</b> At checkout you ask for access straight away, which ends the 14-day
        right to cancel for a change of mind. If anything of ours fails, you get it put right or your money back.
        <a href="#/legal/refunds">How refunds work</a>. Cancel a renewing plan in one tap;
        you keep access to the end of what you paid for.</p>
      <p>It is not tipping and it is not advice to place a bet. We publish what we think will happen and why,
        and the record of how that has gone, including when it has gone badly.
        <a href="#/results">The record is public</a> and always will be. Nothing here is a promise of profit.
        18+. <a href="#/legal/responsible">If gambling has stopped being fun</a>, that page is more use than
        any call on this site.</p>
    </div>
  </div>`;

  for (const b of app.querySelectorAll('[data-buy]')) {
    b.onclick = () => startCheckout(b.dataset.buy, b.dataset.promo || null);
  }
  for (const c of app.querySelectorAll('.plan-clock')) promo?.mountClock(c, Number(c.dataset.ends), { compact: true, onEnd: () => route({ soft: true }) });
}

/* ----------------------------------------------------------------- checkout */

const longDate = (e) => new Date(e * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
const shortDate = (e) => new Date(e * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

/** The membership that is running now, or null. */
function liveMembership(account) {
  const m = account?.membership;
  return m && Number(m.expires_at) * 1000 > Date.now() ? m : null;
}

/** Does it take money again by itself? A matchday pass never does. */
function renewsItself(m) {
  if (!m || m.plan_id === 'matchday' || m.card_brand === 'complimentary') return false;
  // A Whop membership carries whether it still renews (stopped from here or not).
  return Number(m.auto_renew) === 1;
}

/** Whop's page for this membership, when it is one of Whop's. */
function whopManageUrl(m) {
  return m?.manage_url && /^https:\/\/(www\.)?whop\.com\//.test(m.manage_url) ? m.manage_url : null;
}

/** What each plan is, on the checkout page: how long, and what happens after. */
const PLAN_TERMS = {
  matchday: {
    per: 'for seven days',
    runs: 'Seven days from when you pay.',
    after: 'One payment. It stops by itself and nothing renews.',
  },
  monthly: {
    per: 'a month',
    runs: 'A month from when you pay.',
    after: 'Then the same again each month until you cancel. Cancel in one tap and keep it to the end of the month you paid for.',
  },
  quarter: {
    per: 'every three months',
    runs: 'Three months from when you pay.',
    after: 'Then the same again every three months until you cancel. Cancel in one tap and keep it to the end of the three months you paid for.',
  },
  season: {
    per: 'a year',
    runs: 'A year from when you pay.',
    after: 'Then the same again each year until you cancel. Cancel in one tap and keep it to the end of the year you paid for.',
  },
};

/**
 * Why this reader should not pay for this plan right now, if there is a
 * reason: it is already theirs, or they are on a plan that renews by itself
 * and paying again would charge them for both.
 */
function checkoutBlock(m, planId) {
  if (!m) return null;
  const have = PLAN_NAME[m.plan_id] ?? 'membership';
  const until = longDate(m.expires_at);
  if (m.plan_id === planId) {
    return {
      title: 'This one is already yours',
      body: `Your ${have.toLowerCase()} runs to ${until}${renewsItself(m) ? ' and renews by itself' : ''}. There is nothing to pay.`,
      actions: `<a class="btn btn-accent" href="#/board">Today's calls</a>
        <a class="btn btn-ghost" href="#/account?tab=membership">Your membership</a>`,
    };
  }
  if (planId === 'matchday') {
    return {
      title: 'Your membership already covers this week',
      body: `Your ${have.toLowerCase()} runs to ${until}. A matchday pass on top would buy nothing.`,
      actions: `<a class="btn btn-accent" href="#/board">Today's calls</a>
        <a class="btn btn-ghost" href="#/pricing">Back to the plans</a>`,
    };
  }
  return null;
}

/**
 * Our own checkout page.
 *
 * The summary, the price and the pay button are ours; the card fields are
 * Whop's, in frames, so card numbers never touch this page. The button turns
 * what the buyer entered into a one-time token and the Worker charges it at
 * the price in our plan row. If the API key is not yet allowed to take a
 * payment, or the fields will not load, Whop's own checkout takes over in a
 * sheet, so a buyer is never left with a dead button.
 */
async function viewCheckout(params) {
  // Which navigation this page belongs to: a newer one makes it stand down (see route).
  const nav = navTicket;
  const planId = /^[a-z0-9_-]{1,40}$/.test(params.get('plan') ?? '') ? params.get('plan') : 'monthly';
  const promoId = /^[a-z0-9_-]{1,40}$/i.test(params.get('promo') ?? '') ? params.get('promo') : null;
  // A soft refresh (the header catching up on the account) must not wipe
  // half-typed card details by drawing the page again.
  if (state.soft && app.querySelector(`.checkout[data-plan="${planId}"]`)) return;
  placeholder(skeletonHTML());

  const user = await currentUser();
  if (!user) { setIntent(`buy:${planId}${promoId ? `:${promoId}` : ''}`); goInstead('#/signin'); return; }
  const [plans, account, cfg] = await Promise.all([
    getJSON('/api/plans').catch(() => []),
    getJSON('/api/account', { fresh: true }).catch(() => null),
    siteConfig().catch(() => ({})),
  ]);
  if (account) state.account = account;
  const plan = (plans ?? []).find((p) => p.id === planId);
  const back = `<a class="back" href="#/pricing">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>
      All plans</a>`;

  if (!plan) {
    if (nav !== navTicket) return;
    app.innerHTML = `
    <div class="wrap section narrow">
      ${back}
      <div class="empty-state"><b>That plan is not on sale</b>
        <span>The link may be old. The plans on sale today are on the pricing page.</span>
        <p class="member-actions co-center"><a class="btn btn-accent" href="#/pricing">See the plans</a></p></div>
    </div>`;
    return;
  }

  const m = liveMembership(account);
  const block = checkoutBlock(m, planId);
  const terms = PLAN_TERMS[planId] ?? { per: '', runs: '', after: '' };
  const name = PLAN_NAME[planId] ?? plan.name;
  const renews = planId !== 'matchday';
  // A member moving plans: nothing today, the new price from their paid-to date.
  const moving = m && !block ? m : null;
  // A deal or a free trial running on this plan (js/lib/promo.js). Only its
  // id goes with the payment; the Worker checks it and sets the price.
  const promo = moving || block ? null : await import('./js/lib/promo.js').catch(() => null);
  const offer = promo ? await promo.offerForPlan(planId, { signedIn: true, member: !!m, returning: !!account?.returning }, promoId).catch(() => null) : null;
  const trial = offer?.kind === 'trial' ? offer : null;
  const deal = offer?.kind === 'deal' ? offer : null;
  const amount = deal ? deal.price_minor : Number(plan.amount_minor);
  const price = money(amount, plan.currency);
  if (offer) promo.ensureStyles();
  // Whop's card fields go on this page only for a straight payment; a switch,
  // a free trial or no account id all go through Whop's own checkout, so the
  // fields' space is never drawn just to be taken away again.
  const embedding = !moving && !block && !trial && !!cfg?.whopAccount;

  if (nav !== navTicket) return;
  app.innerHTML = `
  <div class="wrap section checkout" data-plan="${esc(planId)}">
    ${back}
    <div class="co-grid">
      <section class="co-summary" aria-labelledby="co-name">
        <h1 class="display" id="co-name">${esc(name)}</h1>
        ${moving ? `
        <p class="co-price"><b>${esc(money(0, plan.currency))}</b> <span>today</span></p>
        <p class="co-terms"><b>Then ${esc(price)} ${esc(terms.per)}, from ${esc(longDate(moving.expires_at))}.</b>
          Your ${esc((PLAN_NAME[moving.plan_id] ?? 'membership').toLowerCase())} is paid up to that date, so the ${esc(name.toLowerCase())}
          starts now and its first payment waits until then. The ${esc((PLAN_NAME[moving.plan_id] ?? 'membership').toLowerCase())} stops renewing.
          You keep every day you have paid for and pay for none twice.</p>` : `
        ${trial ? `
        <p class="co-price"><b>${esc(trial.trial_days)} days free</b> <span>then ${esc(money(plan.amount_minor, plan.currency))} ${esc(terms.per)}</span></p>
        <p class="co-terms"><b>${esc(trial.title)}.</b> ${esc(promo.terms(trial))}</p>
        <p class="co-offer">Ends in <span class="co-clock" data-ends="${esc(trial.ends_at)}"></span></p>` : deal ? `
        <p class="co-price"><s>${esc(money(plan.amount_minor, plan.currency))}</s> <b>${esc(price)}</b> <span>${esc(terms.per)}</span></p>
        <p class="co-terms"><b>${esc(deal.title)}.</b> ${esc(promo.terms(deal))}</p>
        <p class="co-offer">Ends in <span class="co-clock" data-ends="${esc(deal.ends_at)}"></span></p>` : `
        <p class="co-price"><b>${esc(price)}</b> <span>${esc(terms.per)}</span></p>
        <p class="co-terms"><b>${esc(terms.runs)}</b> ${esc(terms.after)}</p>`}`}
      </section>

      <section class="co-pay" aria-labelledby="co-pay-title">
        ${block ? `
        <h2 class="co-pay-title" id="co-pay-title">${esc(block.title)}</h2>
        <p class="co-block">${esc(block.body)}</p>
        <div class="member-actions">${block.actions}</div>` : `
        <h2 class="co-pay-title" id="co-pay-title">${moving ? `Switch to the ${esc(name.toLowerCase())}` : 'Pay by card, Apple Pay or Google Pay'}</h2>
        ${moving ? `<p class="co-upgrade">Nothing is charged today. Whop keeps your card for the first payment on
          ${esc(longDate(moving.expires_at))}. If you stop before the end, your ${esc((PLAN_NAME[moving.plan_id] ?? 'membership').toLowerCase())}
          simply runs to that date.</p>` : ''}
        <fieldset class="co-agree">
          <legend class="visually-hidden">Before you pay</legend>
          <label class="co-check"><input type="checkbox" id="co-adult">
            <span>I am 18 or over and I agree to the <a href="#/legal/terms" target="_blank">terms of use</a>.</span></label>
          <label class="co-check"><input type="checkbox" id="co-waive">
            <span>Start my ${esc(name.toLowerCase())} straight away. I understand that once it starts I lose my
              14-day right to cancel.</span></label>
        </fieldset>
        ${embedding ? `
        <div class="co-fields" aria-busy="true">
          <div id="co-email"></div>
          <div id="co-payment"></div>
          <div id="co-branding"></div>
          <div class="co-skel" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
        </div>` : `
        <p class="co-info">${checkoutWhere(trial, moving)}</p>`}
        <button class="btn btn-accent btn-lg co-button" id="co-pay" type="button" disabled>${trial ? `Start the ${esc(trial.trial_days)} free days` : moving ? 'Switch, nothing to pay today' : embedding ? `Pay ${esc(price)}` : 'Continue to payment'}</button>
        <p class="co-need" aria-live="polite">Tick both boxes above to go on.</p>
        <p class="co-error" role="alert" hidden></p>
        <p class="co-note">${trial ? `By starting you agree to ${esc(money(plan.amount_minor, plan.currency))} ${esc(terms.per)} after the ${esc(trial.trial_days)} free days, until you cancel. ` : renews ? `By ${moving ? 'switching' : 'paying'} you agree to ${esc(price)} ${esc(terms.per)}${moving ? ` from ${esc(shortDate(moving.expires_at))}` : ''} until you cancel. ` : ''}Card details go
          straight to Whop, who take the payment. They never reach offside.win.</p>`}
      </section>

      <section class="co-details" aria-label="What a membership includes">
        <ul class="ticks co-ticks">
          <li><b>Every open call</b> the moment it goes up</li>
          <li><b>The bet slip's legs</b>, before the first one kicks off</li>
          <li><b>Why this call</b> on every match</li>
          <li>The board's filters by league and by day</li>
        </ul>
        <p class="co-small co-moves">Calls can change until kick-off, as we look at every match again every
          fifteen minutes, and close when the match starts.</p>
        <p class="co-who">It goes on the account you are signed in with:
          <b>${esc(user.email ?? '')}</b></p>
        <p class="co-small">If something of ours fails, you get it put right or your money back.
          <a href="#/legal/refunds">How refunds work</a>.</p>
      </section>
    </div>
  </div>`;
  if (block) return;
  for (const c of app.querySelectorAll('.co-clock')) promo.mountClock(c, Number(c.dataset.ends), { compact: true, onEnd: () => route({ soft: false }) });

  const button = app.querySelector('#co-pay');
  const errorLine = app.querySelector('.co-error');
  const needLine = app.querySelector('.co-need');
  const say = (text) => { errorLine.textContent = text; errorLine.hidden = !text; };
  let complete = false;
  let working = null;
  let embedded = !embedding;
  let loaded = false;
  /*
   * Both boxes, every time. The second is the express request and the
   * acknowledgement the Consumer Contracts Regulations 2013 (reg. 37) ask for
   * before digital content may start inside the 14 days; without it a buyer
   * keeps the right to cancel. The Worker refuses a payment without them, so
   * this is the courtesy and that is the rule.
   */
  const boxes = [app.querySelector('#co-adult'), app.querySelector('#co-waive')];
  const agreed = () => boxes.every((b) => b.checked);
  const consent = () => ({ adult: boxes[0].checked, waive: boxes[1].checked, terms: TERMS_VERSION });
  const ready = () => agreed() && (embedded || complete);
  /*
   * The button and the line under it, from one place. A disabled button that
   * says nothing about why is the commonest "it's broken" on a checkout, so
   * the line always names the one thing still missing.
   */
  const need = () => {
    const [adult, waive] = boxes.map((b) => b.checked);
    if (!adult && !waive) return 'Tick both boxes above to go on.';
    if (!adult) return 'Tick the box to say you are 18 or over.';
    if (!waive) return `Tick the box to start the ${name.toLowerCase()} straight away.`;
    if (embedded || complete) return '';
    return loaded ? 'Now fill in your card details.' : 'The card form is loading.';
  };
  const sync = () => {
    if (working) return;
    button.disabled = !ready();
    needLine.textContent = need();
  };
  const idle = () => { working?.(); working = null; sync(); };
  for (const b of boxes) b.onchange = sync;

  // Whop's own checkout, when ours cannot take this payment: the same two
  // boxes first, then a button that opens it.
  const fallback = (note) => {
    embedded = true;
    const fields = app.querySelector('.co-fields');
    if (fields) {
      const info = document.createElement('p');
      info.className = 'co-info';
      info.textContent = note;
      fields.replaceWith(info);
    }
    if (!moving && !trial) button.textContent = 'Continue to payment';
    button.onclick = async () => {
      if (working || !agreed()) return;
      say('');
      working = busy(button, 'Opening the checkout…');
      try { await openEmbeddedCheckout(planId, consent(), offer?.id); } catch (err) { say(err.message); }
      idle();
    };
    idle();
  };

  if (!embedding) { fallback(); return; }

  // Whop's frames paint a moment after they are mounted. The placeholder holds
  // their place until the card frame has loaded, so nothing jumps.
  const fields = app.querySelector('.co-fields');
  const shown = () => {
    if (loaded) return;
    loaded = true;
    fields.classList.add('is-loaded');
    fields.removeAttribute('aria-busy');
    sync();
  };
  const watch = new MutationObserver(() => {
    const frame = fields.querySelector('#co-payment iframe');
    if (!frame) return;
    watch.disconnect();
    frame.addEventListener('load', () => setTimeout(shown, 200), { once: true });
    setTimeout(shown, 4000);
  });
  watch.observe(fields, { childList: true, subtree: true });

  try {
    const handle = await mountPayment({
      accountId: cfg.whopAccount,
      currency: plan.currency,
      amount,
      renews,
      email: user.email,
      returnUrl: `${location.origin}/#/account?paid=1`,
      into: { email: '#co-email', payment: '#co-payment', branding: '#co-branding' },
      onComplete: (ok) => { complete = ok; sync(); },
    });
    // The reader went somewhere else while Whop's script was on its way.
    if (!button.isConnected) { handle.destroy(); return; }
    state.payHandle = handle;
    setTimeout(shown, 6000);
  } catch {
    watch.disconnect();
    if (!button.isConnected) return;
    fallback('The card form did not load on this page, so the payment is taken in Whop\'s secure checkout instead. It opens over this page.');
    return;
  }

  const paid = () => { location.hash = '#/account?paid=1'; };
  button.onclick = async () => {
    if (working || !complete) return;
    if (!agreed()) { say('Tick both boxes above first. Nothing has been charged.'); return; }
    say('');
    working = busy(button, 'Paying…');
    try {
      const token = await state.payHandle.token();
      if (!token) throw new Error('The card details did not come through. Nothing has been charged. Try again.');
      const out = await postJSON('/api/pay/charge', { plan: planId, confirmation_token: token, consent: consent(), ...(offer ? { promo: offer.id } : {}) });
      if (out.status === 'paid') { paid(); return; }
      if (out.client_secret) {
        // The bank wants a word first (3D Secure): Whop runs that step.
        const next = await state.payHandle.nextAction(out.client_secret);
        if (next?.redirected) return;
        if (next?.status === 'succeeded' || next?.status === 'processing') { paid(); return; }
        throw new Error(next?.lastPaymentError?.message ?? 'The bank check was not finished. Nothing has been charged. Try again.');
      }
      // Taken but not yet settled: the account page waits for it.
      if (out.status === 'pending' || out.status === 'processing') { paid(); return; }
      throw new Error('The payment did not go through. Nothing has been charged. Try again.');
    } catch (err) {
      if (err?.data?.fallback) {
        working?.(); working = null;
        state.payHandle?.destroy(); state.payHandle = null;
        fallback('This payment is taken in Whop\'s secure checkout instead. Nothing has been charged. It opens over this page.');
        return;
      }
      say(err?.message ?? 'The payment did not go through. Nothing has been charged. Try again.');
      idle();
    }
  };
}

/** Sign in. One email box and one button, because that is the whole of it. */
async function viewSignin() {
  // Which navigation this page belongs to: a newer one makes it stand down (see route).
  const nav = navTicket;
  if (await currentUser()) { goInstead('#/account'); return; }

  const problem = state.authError;
  state.authError = null;

  // Read without consuming: the intent is spent when the sign-in completes,
  // not when the page renders. Saying it out loud is the difference between
  // "why am I being asked for my email" and "yes, that is what I was doing".
  let intent = readIntent();
  // Sent here from the header, not by a purchase or the account page: once
  // signed in, back to the page they were reading, not the front page.
  if (!intent && reading() && reading() !== '#/home') { intent = reading(); setIntent(intent); }
  const because = intent?.startsWith('buy')
    ? 'Sign in first and your membership will be waiting when you come back.'
    : intent === '#/account'
      ? 'Your account is behind this.'
      : 'Your calls follow you, your slip is yours, and there is nothing to remember.';

  if (nav !== navTicket) return;
  app.innerHTML = `
  <div class="wrap section narrow">
    <div class="turnstile">
      <div class="page-head">
        <p class="hand turnstile-aside">in you come</p>
        <h1 class="display xl">Sign in</h1>
        <p class="page-sub">${esc(because)}</p>
      </div>

      ${problem ? `<p class="form-error">${esc(problem)}</p>` : ''}

      <div class="panel signin" id="signin-panel">
        <!-- Our own button, drawn with the page. With the redirect switched on
             (GOOGLE_REDIRECT) it is the whole thing; until then Google's own
             button is drawn over it by renderGoogleButton once it has loaded,
             and this one is what shows while it does. -->
        <div class="gsi-slot" id="google-wrap">
          <button class="btn-gsi" id="google" type="button"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.9h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.8 3-4.3 3-7.4z" fill="#4285F4"/><path d="M12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.5c-.9.6-2 1-3.4 1-2.6 0-4.8-1.8-5.6-4.1H3.1v2.6A10 10 0 0 0 12 22z" fill="#34A853"/><path d="M6.4 14a6 6 0 0 1 0-3.9V7.5H3.1a10 10 0 0 0 0 9z" fill="#FBBC05"/><path d="M12 6c1.5 0 2.8.5 3.8 1.5l2.8-2.8A10 10 0 0 0 3.1 7.5l3.3 2.6C7.2 7.8 9.4 6 12 6z" fill="#EA4335"/></svg><span>Continue with Google</span></button>
          <div id="google-slot"></div>
        </div>
        <div class="or"><span>or by email</span></div>
        <form id="magic" novalidate>
          <label for="email">Email address</label>
          <input id="email" name="email" type="email" autocomplete="email"
                 inputmode="email" required placeholder="you@example.com">
          <button class="btn btn-ghost btn-lg" type="submit">Email me a sign-in link</button>
        </form>
        <p class="signin-note" id="note"></p>
      </div>

      <p class="prose pricing-small">No password, ever. The link in the email signs you in on the device
        you open it on. By signing in you agree to our <a href="/terms">terms</a> and
        <a href="/privacy">privacy policy</a>.</p>
    </div>
  </div>`;

  const note = document.getElementById('note');
  const say = (msg, bad) => { note.textContent = msg; note.className = bad ? 'signin-note bad' : 'signin-note ok'; };

  /*
   * The auth library's own words, translated.
   *
   * A reader who mistyped their email got "AuthApiError: Unable to validate
   * email address: invalid format", and one who asked twice in a minute got
   * "For security purposes, you can only request this after 47 seconds." Both
   * are accurate and neither is addressed to a person.
   */
  const humanise = (err) => {
    const raw = String(err?.message ?? '');
    if (/rate ?limit|only request this after|too many/i.test(raw)) return 'That is one too many in a row. Give it a minute and try again.';
    if (/invalid format|unable to validate email/i.test(raw)) return 'That does not look like an email address. Check it and try again.';
    if (/signups? not allowed|disabled/i.test(raw)) return 'We cannot open new accounts by email at the moment. Try Google instead.';
    if (/failed to fetch|network/i.test(raw) || navigator.onLine === false) return 'Your device cannot reach us at the moment. Check your connection and try again.';
    if (/popup|window|closed/i.test(raw)) return 'The Google window closed before it finished. Try again.';
    return 'That did not work. Try again, or use the other button.';
  };

  const panel = document.getElementById('signin-panel');
  const wrap = document.getElementById('google-wrap');
  const slot = document.getElementById('google-slot');
  const googleBtn = document.getElementById('google');
  const working = () => { panel.classList.add('working'); say('Signing you in…'); };
  const failed = (err) => { panel.classList.remove('working'); googleBtn.disabled = false; say(humanise(err), true); };

  // Ready before the tap, so the tap goes straight to Google.
  prepareGoogleRedirect();
  googleBtn.onclick = async () => {
    say('');
    const undo = busy(googleBtn, 'Opening Google…');
    // Still here after ten seconds with the page in view: the browser did not
    // go (a blocker, no connection). Say so rather than spin for ever.
    setTimeout(() => {
      if (document.visibilityState === 'visible' && undo()) say('Google did not open. Check your connection and try again.', true);
    }, 10000);
    try {
      if (await googleRedirectReady()) await signInWithGoogleRedirect();
      else await signInWithGoogle();
    } catch (err) { undo(); failed(err); }
  };

  // Google's own button only while the redirect is not switched on.
  googleRedirectReady().then((ready) => {
    if (ready) { slot.remove(); return; }
    new MutationObserver((_, obs) => {
      const frame = slot.querySelector('iframe');
      if (!frame) return;
      obs.disconnect();
      frame.addEventListener('load', () => wrap.classList.add('ready'), { once: true });
    }).observe(slot, { childList: true, subtree: true });
    renderGoogleButton(slot, { onWorking: working, onSignedIn: afterSignIn, onError: failed })
      .then((drawn) => { if (!drawn) slot.remove(); });
  });

  document.getElementById('magic').onsubmit = async (e) => {
    e.preventDefault();
    const email = document.getElementById('email').value.trim();
    if (!email) return say('Put your email address in first.', true);
    const button = e.currentTarget.querySelector('button');
    say('');
    const undo = busy(button, 'Sending the link…');
    try {
      await signInWithEmail(email);
      /*
       * The sent state replaces the form. A form that stays on screen under
       * "check your email" invites a second tap, a second email, and a rate
       * limit; what a reader needs now is the address they typed, where to
       * look, and one way to try again once the first link has had time.
       */
      document.getElementById('signin-panel').innerHTML = `
        <div class="sent">
          <p class="sent-head">Check your inbox</p>
          <p>We sent a sign-in link to <b>${esc(email)}</b>. Tap it on this device and you are in.</p>
          <p class="muted small">Not there in a minute? Look in spam, or
            <button type="button" class="linklike" id="again" disabled>send another (<span id="wait">60</span>)</button>.</p>
        </div>`;
      let left = 60;
      const again = document.getElementById('again');
      const t = setInterval(() => {
        left--;
        const w = document.getElementById('wait');
        if (w) w.textContent = String(left);
        if (left <= 0) { clearInterval(t); if (again) { again.disabled = false; again.textContent = 'send another'; } }
      }, 1000);
      if (again) again.onclick = () => viewSignin();
    } catch (err) {
      undo();
      say(humanise(err), true);
    }
  };
}

const PLAN_NAME = { matchday: 'Matchday pass', monthly: 'Monthly membership', quarter: '3-month membership', season: 'Season ticket' };
const PLAN_DAYS = { matchday: 7, monthly: 30, quarter: 90, season: 365 };

/*
 * The account.
 *
 * It used to be a ticket and a sign-out button: what you had paid for, and
 * nothing about you. An account on a football site is also who you are here
 * (a name and a face), what you follow (so the front page opens on your
 * teams), how you like odds written, and the controls every account owes its
 * holder: sign out everywhere, take your data, delete the lot.
 *
 * Four tabs, in the address like the match page's, so a reload or a shared
 * link opens the same one.
 */
const ACCOUNT_TABS = [['profile', 'Profile'], ['following', 'Following'], ['membership', 'Membership'], ['settings', 'Settings']];

/**
 * A face for the account, as the reader chose it on the account page:
 *   photo    -- Google's picture (the default when there is one);
 *   initials -- their initials on the colour they picked;
 *   crest    -- their club's crest.
 * "auto" is photo when there is one, else initials.
 */
function avatarHTML(user, name, size = 'md', profile = state.account?.profile) {
  const label = name || user?.email || '';
  const style = profile?.avatar_style ?? 'auto';
  const colour = /^c[1-8]$/.test(profile?.avatar_color ?? '') ? ` av-${profile.avatar_color}` : '';
  if (style === 'crest' && profile?.club_id) {
    return `<span class="avatar avatar-${size} is-crest">${crest(profile.club_name ?? label, 'md', profile.club_id, 'team')}</span>`;
  }
  if (style !== 'initials' && user?.avatar) {
    return `<span class="avatar avatar-${size}"><img src="${esc(user.avatar)}" alt="" referrerpolicy="no-referrer"
      onerror="this.parentNode.classList.add('noimg');this.remove()"><i>${esc(initials(label))}</i></span>`;
  }
  return `<span class="avatar avatar-${size} noimg${colour}"><i>${esc(initials(label))}</i></span>`;
}

/** The name to call someone by: what they saved, else what Google said, else their email's first part. */
function accountName(user, profile) {
  return profile?.display_name || user?.name || String(user?.email ?? '').split('@')[0] || 'Your account';
}

async function viewAccount() {
  // Which navigation this page belongs to: a newer one makes it stand down (see route).
  const nav = navTicket;
  const user = await currentUser();
  if (!user) { setIntent('#/account'); goInstead('#/signin'); return; }

  placeholder(skeletonHTML());
  let account = { membership: null, receipts: [], profile: null, follows: [] };
  try { account = await getJSON('/api/account'); } catch { /* shown as a fresh account */ }
  state.account = account;
  if (account.profile?.odds_format && account.profile.odds_format !== oddsFormat) setOddsFormat(account.profile.odds_format);
  if (account.profile?.clock && account.profile.clock !== clockFormat) setClock(account.profile.clock);

  const m = account.membership;
  const active = m && m.expires_at * 1000 > Date.now();
  // The page that knows for certain, so the header stops guessing.
  state.member = Boolean(active);
  const when = (e) => new Date(e * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  const name = accountName(user, account.profile);
  const since = user.since ? new Date(user.since).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }) : null;
  const how = user.provider === 'google' ? 'Signed in with Google' : 'Signed in with an email link';

  const params = new URLSearchParams(location.hash.split('?')[1] ?? '');
  const asked = params.get('tab');
  // Back from the card form. Whop's webhook, not the redirect, is what
  // switches the membership on, so the page says the payment is in and
  // checks again for a short while rather than showing a free account.
  const justPaid = params.get('paid') === '1';
  // Most people pay from a locked call. Once it is open, the way back to it
  // is the first thing on the page, not a hunt through the board.
  const came = justPaid ? reading() : null;
  const paidBack = !came || came === '#/home' ? null
    : /^#\/fixture\//.test(came) ? { href: came, label: 'Back to the match you were reading' }
    : /^#\/slip/.test(came) ? { href: came, label: "Back to today's slip" }
    : { href: came, label: 'Back to where you were' };
  const open = ACCOUNT_TABS.some(([k]) => k === asked) ? asked : justPaid ? 'membership' : 'profile';

  const follows = Array.isArray(account.follows) ? account.follows : [];

  // --- profile: picture and club
  const prof = account.profile ?? {};
  const club = prof.club_id ? { id: prof.club_id, name: prof.club_name ?? 'Your club' } : null;
  const picColour = /^c[1-8]$/.test(prof.avatar_color ?? '') ? prof.avatar_color : 'c1';
  const picStyle = prof.avatar_style === 'crest' && club ? 'crest'
    : prof.avatar_style === 'initials' || !user.avatar ? 'initials' : 'photo';
  // The clubs on offer: the teams this account follows, plus the saved club
  // if it has since been unfollowed.
  const clubChoices = (account.follows ?? []).filter((f) => f.kind === 'team').map((f) => ({ id: f.id, name: f.label }));
  if (club && !clubChoices.some((t) => Number(t.id) === Number(club.id))) clubChoices.unshift(club);

  // --- profile
  /*
   * The profile is shown, not handed over as a form. It used to open straight
   * into editable fields, so glancing at your own account meant looking at a
   * half-filled form with a Save button under it. Now it reads as a profile,
   * with one button that opens the editor, and the editor closes again on
   * Save or Cancel.
   */
  const handle = prof.username ? `@${prof.username}` : null;
  const PIC_WORD = { photo: 'Your Google photo', initials: 'Your initials', crest: club ? `The ${club.name} crest` : 'Your initials' };
  const editing = params.get('edit') === '1';
  const profileHTML = `
    <section class="prof-view" id="prof-view"${editing ? ' hidden' : ''}>
      <dl class="acct-facts prof-facts">
        <div><dt>Name</dt><dd>${esc(prof.display_name || user.name || 'Not set')}</dd></div>
        <div><dt>Username</dt><dd>${handle ? esc(handle) : '<span class="muted">Not chosen yet</span>'}</dd></div>
        <div><dt>Picture</dt><dd>${esc(PIC_WORD[picStyle] ?? 'Your initials')}</dd></div>
        <div><dt>Club</dt><dd>${club ? `<span class="prof-club">${crest(club.name, 'xs', club.id)}${esc(club.name)}</span>` : '<span class="muted">None</span>'}</dd></div>
        <div><dt>Email</dt><dd>${esc(user.email ?? '')}</dd></div>
        <div><dt>Sign-in</dt><dd>${esc(how)}. There is no password to forget.</dd></div>
        ${since ? `<div><dt>Joined</dt><dd>${esc(since)}</dd></div>` : ''}
      </dl>
      <div class="acct-actions"><button class="btn btn-primary" type="button" id="prof-edit">Edit profile</button></div>
    </section>

    <form class="acct-form prof-edit" id="profile-form" novalidate${editing ? '' : ' hidden'}>
      <h2 class="acct-sub">Edit profile</h2>
      <label for="display-name">Your name</label>
      <input id="display-name" name="name" type="text" maxlength="60" autocomplete="name"
             value="${esc(prof.display_name ?? user.name ?? '')}" placeholder="What should we call you?">
      <p class="acct-hint">Used to greet you on the front page.</p>

      <label for="username">Username</label>
      <div class="handle-field"><span aria-hidden="true">@</span>
        <input id="username" name="username" type="text" maxlength="21" autocomplete="username" spellcheck="false"
               autocapitalize="none" value="${esc(prof.username ?? '')}" placeholder="yourname"
               pattern="[A-Za-z0-9_]{3,20}" aria-describedby="username-hint"></div>
      <p class="acct-hint" id="username-hint">Three to twenty letters, numbers or underscores. One per person.</p>

      <fieldset class="acct-choice">
        <legend>Your picture</legend>
        <div class="pic-opts" role="radiogroup" aria-label="Your picture">
          ${user.avatar ? `<label class="pic-opt"><input type="radio" name="pic" value="photo"${picStyle === 'photo' ? ' checked' : ''}>
            <span>${avatarHTML(user, name, 'md', { avatar_style: 'photo' })}<small>Google photo</small></span></label>` : ''}
          <label class="pic-opt"><input type="radio" name="pic" value="initials"${picStyle === 'initials' ? ' checked' : ''}>
            <span>${avatarHTML(user, name, 'md', { avatar_style: 'initials', avatar_color: picColour })}<small>Initials</small></span></label>
          <label class="pic-opt${club ? '' : ' off'}"><input type="radio" name="pic" value="crest"${picStyle === 'crest' ? ' checked' : ''}${club ? '' : ' disabled'}>
            <span>${club ? avatarHTML(user, name, 'md', { avatar_style: 'crest', club_id: club.id, club_name: club.name }) : '<span class="avatar avatar-md noimg"><i>?</i></span>'}<small>${club ? 'Club crest' : 'Pick a club first'}</small></span></label>
        </div>
        <div class="swatches" role="radiogroup" aria-label="Colour behind your initials"${picStyle === 'initials' ? '' : ' hidden'}>
          ${['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8'].map((c) => `<label class="swatch av-${c}"><input type="radio" name="colour" value="${c}"${picColour === c ? ' checked' : ''} aria-label="Colour ${c.slice(1)}"><i></i></label>`).join('')}
        </div>
      </fieldset>

      <fieldset class="acct-choice">
        <legend>Your club</legend>
        <select id="club" class="acct-select" data-icon="shirt" aria-label="Your club">
          <option value="0">No club</option>
          ${clubChoices.map((t) => `<option value="${esc(t.id)}"${club && Number(club.id) === Number(t.id) ? ' selected' : ''}>${esc(t.name)}</option>`).join('')}
        </select>
        <p class="acct-hint">Its games are marked on the board, and its crest can be your picture.${
          clubChoices.length ? '' : ' Follow a team first and it appears here.'}</p>
      </fieldset>
      <div class="acct-actions">
        <button class="btn btn-primary" type="submit">Save changes</button>
        <button class="btn btn-ghost" type="button" id="prof-cancel">Cancel</button>
        <span class="acct-note" id="profile-note" role="status"></span>
      </div>
    </form>`;

  // --- following
  const followRow = (f) => `
    <li class="follow-item">
      ${crest(f.label, 'sm', f.id, f.kind === 'league' ? 'league' : 'team')}
      ${f.kind === 'league'
        ? `<a class="follow-name" href="#/league/${encodeURIComponent(f.id)}">${esc(f.label)}</a>`
        : `<span class="follow-name">${esc(f.label)}</span>`}
      <button class="btn btn-quiet btn-sm" data-unfollow="${esc(f.kind)}:${esc(f.id)}" data-label="${esc(f.label)}">Unfollow</button>
    </li>`;
  const teams = follows.filter((f) => f.kind === 'team');
  const comps = follows.filter((f) => f.kind === 'league');
  const followingHTML = `
    <div class="follow-find">
      <label for="follow-q">Find a team or competition</label>
      <input id="follow-q" type="search" autocomplete="off" placeholder="Arsenal, Serie A, Norway…">
      <ul class="follow-results" id="follow-results" aria-live="polite"></ul>
    </div>
    ${follows.length ? `
      ${comps.length ? `<h2 class="acct-sub">Competitions</h2><ul class="follow-list">${comps.map(followRow).join('')}</ul>` : ''}
      ${teams.length ? `<h2 class="acct-sub">Teams</h2><ul class="follow-list">${teams.map(followRow).join('')}</ul>` : ''}`
    : `<div class="empty-state"><b>You are not following anyone yet</b>
         <span>Follow a team or a competition and its games open the front page for you, above everything else.</span></div>`}`;

  // --- membership
  const membershipHTML = `
    <!--
      The membership as a ticket: the plan, who it is for, and when it runs to.
      A ticket is the shape a football person already knows a paid-for period
      in, and it reads at a glance where "Active until 24 October" did not.
    -->
    <section class="ticket${active ? '' : ' off'}">
      <div class="ticket-main">
        <span class="ticket-kind">${active ? esc(PLAN_NAME[m.plan_id] ?? 'Membership') : 'No membership'}</span>
        <span class="ticket-who">${esc(name)}</span>
        ${active
          ? `<span class="ticket-until">Valid until <b>${esc(when(m.expires_at))}</b></span>`
          : `<span class="ticket-until" data-public-price>One call a day is free. The rest are from £3.49 for the weekend.</span>`}
      </div>
      <div class="ticket-stub">
        ${active
          ? (m.via === 'whop'
              // Paid through Whop: renewal and cancelling live on Whop's page for
              // this membership. A matchday pass is one payment and stops.
              ? (m.plan_id === 'matchday'
                  ? `<span>One payment. It stops by itself.</span>`
                  // One tap, like any other membership: the Worker tells Whop
                  // to end it at the end of the paid period.
                  : Number(m.auto_renew)
                    ? `<span>Renews through Whop until you stop it</span><button class="btn btn-quiet btn-sm" id="cancel">Stop renewing</button>`
                    : `<span>Does not renew. Yours until ${esc(when(m.expires_at))}.</span>${whopManageUrl(m) ? `<a class="btn btn-ghost btn-sm" href="${esc(whopManageUrl(m))}" target="_blank" rel="noopener noreferrer">Renew on Whop</a>` : ''}`)
              : m.card_brand === 'complimentary'
                ? `<span>Complimentary</span>`
                : m.auto_renew
                  ? `<span>Renews ${m.card_last4 ? `on ${esc(m.card_brand ?? 'card')} ending ${esc(m.card_last4)}` : 'itself'}</span><button class="btn btn-quiet btn-sm" id="cancel">Stop renewing</button>`
                  : `<span>Does not renew</span><button class="btn btn-primary btn-sm" id="resume">Renew each month</button>`)
          : `<a class="btn btn-accent" href="#/pricing">See the plans</a>`}
      </div>
    </section>
    ${active && m.via !== 'whop' && account.whop?.renewing ? `
    <p class="acct-line">You also have a membership through Whop that renews on ${esc(when(account.whop.until))}.
      <button class="btn btn-quiet btn-sm" id="cancel">Stop it renewing</button></p>` : ''}
    ${active && m.plan_id !== 'quarter' && m.card_brand !== 'complimentary' ? `
    <a class="acct-upgrade" href="#/checkout?plan=${m.plan_id === 'matchday' ? 'monthly' : 'quarter'}">
      <b>${m.plan_id === 'matchday' ? 'Carry on by the month' : 'Go to three months and pay less a month'}</b>
      <span>Nothing to pay today: the new plan's first payment is on ${esc(when(m.expires_at))}, when what you have paid for runs out.</span>
    </a>` : ''}
    ${active ? `<p class="acct-line"><a class="btn btn-ghost btn-sm" href="#/pricing">See all plans</a></p>` : ''}
    ${account.receipts?.length ? `
      <h2 class="acct-sub">Payments</h2>
      <table class="tbl"><tbody>
        ${account.receipts.map((r) => `
          <tr><td>${esc(when(r.created_at))}</td>
              <td>${esc(PLAN_NAME[r.plan_id] ?? r.plan_id ?? '')}</td>
              <td>${esc(r.status)}</td>
              <td class="num">${esc(money(r.amount_minor, r.currency))}</td></tr>`).join('')}
      </tbody></table>` : `<p class="acct-hint">No payments on this account.</p>`}`;

  // --- settings
  const fmt = [['decimal', 'Decimal', '2.50'], ['fractional', 'Fractional', '6/4'], ['american', 'American', '+150']];
  const settingsHTML = `
    <fieldset class="acct-choice">
      <legend>Odds</legend>
      <p class="acct-hint">How prices are written across the site. The written analysis quotes the books' own decimal odds.</p>
      <div class="seg" role="radiogroup" aria-label="Odds format">
        ${fmt.map(([k, label, eg]) => `
          <label class="seg-opt"><input type="radio" name="odds" value="${k}"${oddsFormat === k ? ' checked' : ''}>
            <span><b>${esc(label)}</b><small>${esc(eg)}</small></span></label>`).join('')}
      </div>
      <span class="acct-note" id="odds-note" role="status"></span>
    </fieldset>

    <fieldset class="acct-choice">
      <legend>Clock</legend>
      <p class="acct-hint">How kick-off times are written.</p>
      <div class="seg" role="radiogroup" aria-label="Clock">
        ${[['24', '24-hour', '20:45'], ['12', '12-hour', '8:45pm']].map(([k, label, eg]) => `
          <label class="seg-opt"><input type="radio" name="clock" value="${k}"${clockFormat === k ? ' checked' : ''}>
            <span><b>${esc(label)}</b><small>${esc(eg)}</small></span></label>`).join('')}
      </div>
      <span class="acct-note" id="clock-note" role="status"></span>
    </fieldset>

    <fieldset class="acct-choice">
      <legend>Pulled calls</legend>
      <p class="acct-hint">An email when late news makes us take a call down before kick-off, with what it was and why. Members only.</p>
      <div class="seg" role="radiogroup" aria-label="Pulled-call emails">
        ${[['on', 'Email me'], ['off', 'No emails']].map(([k, label]) => `
          <label class="seg-opt"><input type="radio" name="alerts" value="${k}"${(account.profile?.call_alerts !== false) === (k === 'on') ? ' checked' : ''}>
            <span><b>${esc(label)}</b></span></label>`).join('')}
      </div>
      <span class="acct-note" id="alerts-note" role="status"></span>
    </fieldset>

    <h2 class="acct-sub">Signing in</h2>
    <p class="acct-hint">Signing out does not touch your membership. Sign back in with the same email and it is still yours.</p>
    <div class="acct-actions">
      <button class="btn btn-ghost" id="out">Sign out</button>
      <button class="btn btn-quiet" id="out-all">Sign out on every device</button>
    </div>

    <h2 class="acct-sub">Your data</h2>
    <p class="acct-hint">Everything this account holds: your email, name, settings, follows, membership and payments.</p>
    <div class="acct-actions"><button class="btn btn-ghost" id="export">Download your data</button></div>

    <div class="danger-zone" id="danger">
      <h2 class="acct-sub">Delete your account</h2>
      <p class="acct-hint">Removes your sign-in, name, settings and follows, and ends any membership straight away with no
        refund for the time left. Payment records are kept, because tax law requires it.</p>
      <div class="acct-actions">
        <button class="btn btn-quiet danger" id="delete">Delete my account</button>
        <span class="acct-note" id="delete-note" role="status"></span>
      </div>
    </div>`;

  const panes = { profile: profileHTML, following: followingHTML, membership: membershipHTML, settings: settingsHTML };

  if (nav !== navTicket) return;
  app.innerHTML = `
  <div class="wrap section narrow account">
    <div class="acct-head">
      ${avatarHTML(user, name, 'lg')}
      <div class="acct-who">
        <h1 class="display">${esc(name)}</h1>
        <p>${prof.username ? `<span class="acct-handle">@${esc(prof.username)}</span> ` : ''}${esc(user.email ?? '')}</p>
        <a class="acct-plan${active ? ' on' : ''}" href="#/account?tab=membership">${active
          ? `Member until ${esc(when(m.expires_at))}` : 'Free account'}</a>
      </div>
    </div>
    ${justPaid ? `<p class="paid-note${active ? ' done' : ''}" role="status">${active
      ? 'Payment received. You are in: every call is open.'
      : 'Payment received. Switching your membership on, which usually takes a few seconds.'}</p>
    ${active && paidBack ? `<p class="member-actions"><a class="btn btn-accent" href="${esc(paidBack.href)}">${esc(paidBack.label)}</a></p>` : ''}
    <p class="paid-confirm">As you asked at checkout, your membership started straight away, and you
      accepted that this ends the 14-day right to cancel for a change of mind. If anything of ours
      fails, you still get it put right or your money back. The <a href="#/legal/terms">terms of use</a>
      (in force from ${esc(TERMS_DATE)}) apply.</p>` : ''}
    <div class="tabs" role="tablist">
      ${ACCOUNT_TABS.map(([k, label]) => `<button class="tab${k === open ? ' on' : ''}" data-tab="${k}" role="tab" aria-selected="${k === open}">${esc(label)}</button>`).join('')}
    </div>
    ${ACCOUNT_TABS.map(([k]) => `<div class="tabpane acct-pane" data-pane="${k}"${k === open ? '' : ' hidden'}>${panes[k]}</div>`).join('')}
  </div>`;

  if (justPaid && !active) {
    // Quietly, without redrawing the page each time: ask again every three
    // seconds for three-quarters of a minute, and redraw once it is on.
    const onPage = () => location.hash.startsWith('#/account') && location.hash.includes('paid=1');
    const poll = async (n) => {
      if (!onPage()) return;
      // Ask Whop directly as well as waiting for its webhook: the first real
      // payment's webhook never arrived, and the membership sat switched off.
      try { await postJSON('/api/pay/confirm', {}); } catch { /* the sweep catches it */ }
      let a = null;
      try { a = await getJSON('/api/account', { fresh: true }); } catch { /* try again */ }
      if (a?.membership && a.membership.expires_at * 1000 > Date.now()) { viewAccount(); return; }
      if (n >= 15) {
        const note = app.querySelector('.paid-note');
        if (note) note.textContent = 'Payment received. Whop has not confirmed it to us yet. It switches on by itself within ten minutes; if it has not, write to support@offside.win and we will sort it.';
        return;
      }
      setTimeout(() => poll(n + 1), 3000);
    };
    setTimeout(() => poll(1), 3000);
  } else if (justPaid) {
    cacheClear();
    headerAuth();
  } else if (!active && !state.confirmedOnce) {
    // A free account: ask Whop once, in the background, whether this reader
    // has paid for something that has not switched on. Redraws only if it has.
    state.confirmedOnce = true;
    postJSON('/api/pay/confirm', {}).then((r) => {
      if (Array.isArray(r?.results) && r.results.includes('granted')) { cacheClear(); viewAccount(); headerAuth(); }
    }).catch(() => {});
  }

  for (const t of app.querySelectorAll('.tab')) {
    t.onclick = () => {
      for (const o of app.querySelectorAll('.tab')) {
        const on = o === t;
        o.classList.toggle('on', on);
        o.setAttribute('aria-selected', String(on));
      }
      for (const pane of app.querySelectorAll('.tabpane')) pane.hidden = pane.dataset.pane !== t.dataset.tab;
      const q = t.dataset.tab === 'profile' ? '' : `?tab=${encodeURIComponent(t.dataset.tab)}`;
      history.replaceState(null, '', `${location.pathname}#/account${q}`);
    };
  }

  const note = (id, text, bad = false) => {
    const el = document.getElementById(id);
    if (el) { el.textContent = text; el.classList.toggle('bad', bad); }
  };

  // Name.
  document.getElementById('profile-form').onsubmit = async (e) => {
    e.preventDefault();
    const button = e.currentTarget.querySelector('button');
    button.disabled = true;
    note('profile-note', 'Saving…');
    try {
      const clubSel = document.getElementById('club');
      const clubId = Number(clubSel.value) || 0;
      const pic = app.querySelector('input[name="pic"]:checked')?.value ?? 'auto';
      const saved = await accountRpc('save_profile', {
        p_name: document.getElementById('display-name').value,
        // The odds and the clock are saved by their own switches.
        p_odds: null,
        // A crest with no club to show falls back to the ordinary picture.
        p_avatar: pic === 'crest' && !clubId ? 'auto' : pic,
        p_color: app.querySelector('input[name="colour"]:checked')?.value ?? null,
        p_club_id: clubId,
        p_club_name: clubId ? clubSel.options[clubSel.selectedIndex].text : null,
        // '' clears it; the database checks the shape and that nobody has it.
        p_username: document.getElementById('username').value.trim().replace(/^@/, ''),
      });
      account.profile = saved;
      if (state.account) state.account.profile = saved;
      state.board = null;
      headerAuth();
      // Saved: back to the profile, showing what was saved.
      history.replaceState(null, '', `${location.pathname}#/account`);
      await viewAccount();
      return;
    } catch (err) {
      const raw = String(err?.message ?? '');
      note('profile-note', /^username:/.test(raw)
        ? `That username will not work: ${raw.replace(/^username:\s*/, '')}.`
        : humaneError(err), true);
    }
    button.disabled = false;
  };

  // Edit and Cancel: one pane or the other, and the address says which, so a
  // refresh keeps the editor open.
  const showEditor = (on) => {
    document.getElementById('prof-view').hidden = on;
    document.getElementById('profile-form').hidden = !on;
    history.replaceState(null, '', `${location.pathname}#/account${on ? '?tab=profile&edit=1' : ''}`);
    if (on) document.getElementById('display-name')?.focus({ preventScroll: true });
  };
  document.getElementById('prof-edit').onclick = () => showEditor(true);
  document.getElementById('prof-cancel').onclick = () => { document.getElementById('profile-form').reset(); showEditor(false); };

  // The picture: preview as it is picked; saved with the name.
  const preview = () => {
    const pic = app.querySelector('input[name="pic"]:checked')?.value ?? 'auto';
    const swatches = app.querySelector('.swatches');
    if (swatches) swatches.hidden = pic !== 'initials';
    const clubSel = document.getElementById('club');
    const clubId = Number(clubSel?.value) || 0;
    const crestOpt = app.querySelector('input[name="pic"][value="crest"]');
    if (crestOpt) {
      crestOpt.disabled = !clubId;
      crestOpt.closest('.pic-opt').classList.toggle('off', !clubId);
      if (!clubId && crestOpt.checked) (app.querySelector('input[name="pic"][value="photo"]') ?? app.querySelector('input[name="pic"][value="initials"]')).checked = true;
      const face = crestOpt.closest('.pic-opt').querySelector('.avatar');
      if (face) face.outerHTML = clubId
        ? avatarHTML(user, name, 'md', { avatar_style: 'crest', club_id: clubId, club_name: clubSel.options[clubSel.selectedIndex].text })
        : '<span class="avatar avatar-md noimg"><i>?</i></span>';
      crestOpt.closest('.pic-opt').querySelector('small').textContent = clubId ? 'Club crest' : 'Pick a club first';
    }
    const colour = app.querySelector('input[name="colour"]:checked')?.value ?? null;
    const initialsFace = app.querySelector('input[name="pic"][value="initials"]')?.closest('.pic-opt').querySelector('.avatar');
    if (initialsFace) initialsFace.outerHTML = avatarHTML(user, name, 'md', { avatar_style: 'initials', avatar_color: colour });
    const look = { avatar_style: app.querySelector('input[name="pic"]:checked')?.value ?? 'auto', avatar_color: colour,
      club_id: clubId || null, club_name: clubId ? clubSel.options[clubSel.selectedIndex].text : null };
    app.querySelector('.acct-head .avatar').outerHTML = avatarHTML(user, name, 'lg', look);
  };
  for (const el of app.querySelectorAll('input[name="pic"], input[name="colour"], #club')) el.addEventListener('change', preview);

  // Clock: saved the moment it is picked, like the odds.
  for (const r of app.querySelectorAll('input[name="clock"]')) {
    r.onchange = async () => {
      setClock(r.value);
      note('clock-note', 'Saving…');
      try {
        account.profile = await accountRpc('save_profile', { p_name: null, p_odds: null, p_clock: r.value });
        if (state.account) state.account.profile = account.profile;
        note('clock-note', `Saved. Kick-offs now read like ${clockTime(new Date(2026, 0, 1, 20, 45))}.`);
        state.board = null;
      } catch (err) {
        note('clock-note', humaneError(err), true);
      }
    };
  }

  // Pulled-call emails: saved the moment it is picked, like the clock.
  for (const r of app.querySelectorAll('input[name="alerts"]')) {
    r.onchange = async () => {
      note('alerts-note', 'Saving…');
      try {
        const on = await accountRpc('set_call_alerts', { p_on: r.value === 'on' });
        account.profile = { ...(account.profile ?? {}), call_alerts: on };
        if (state.account) state.account.profile = account.profile;
        note('alerts-note', on ? 'Saved. We’ll email you when we pull a call.' : 'Saved. No emails when we pull a call.');
      } catch (err) {
        note('alerts-note', humaneError(err), true);
      }
    };
  }

  // Odds format: saved the moment it is picked.
  for (const r of app.querySelectorAll('input[name="odds"]')) {
    r.onchange = async () => {
      setOddsFormat(r.value);
      note('odds-note', 'Saving…');
      try {
        account.profile = await accountRpc('save_profile', { p_name: null, p_odds: r.value });
        note('odds-note', `Saved. Odds now read like ${showOdds(2.5)}.`);
        state.board = null;
      } catch (err) {
        note('odds-note', humaneError(err), true);
      }
    };
  }

  // Following: search the teams and competitions on the board.
  wireFollowing(account);

  // Sign out, here or everywhere.
  document.getElementById('out').onclick = () => leaveAccount(false);
  document.getElementById('out-all').onclick = () => leaveAccount(true);

  // Take your data: one JSON file, built from what the account page already holds.
  document.getElementById('export').onclick = () => {
    const data = {
      exported_at: new Date().toISOString(),
      email: user.email,
      signed_in_with: user.provider,
      joined: user.since,
      profile: account.profile,
      follows,
      membership: account.membership,
      payments: account.receipts,
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: 'offside-win-account.json' });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  // Delete: the one action here with a second step, because it cannot be undone.
  const del = document.getElementById('delete');
  del.onclick = async () => {
    if (del.dataset.armed !== '1') {
      del.dataset.armed = '1';
      del.textContent = 'Yes, delete it for good';
      note('delete-note', 'Tap again to delete. This cannot be undone.');
      return;
    }
    del.disabled = true;
    note('delete-note', 'Deleting…');
    try {
      await postJSON('/api/account/delete', {});
      await leave(false);
    } catch (err) {
      del.disabled = false;
      note('delete-note', err.message, true);
    }
  };

  const cancel = document.getElementById('cancel');
  // One tap, no "are you sure", no offer to stay. Retention mazes are a dark
  // pattern and in several places an illegal one.
  if (cancel) cancel.onclick = () => setRenewal(false, cancel);
  const resume = document.getElementById('resume');
  if (resume) resume.onclick = () => setRenewal(true, resume);
}

/** The database's words, said to a person. */
function humaneError(err) {
  const raw = String(err?.message ?? '');
  if (/sign in first|jwt|token/i.test(raw)) return 'Your sign-in has expired. Sign in again and try once more.';
  if (/follow limit/i.test(raw)) return 'That is a hundred already. Unfollow one to make room.';
  if (/failed to fetch|network/i.test(raw) || navigator.onLine === false) return 'Your device cannot reach us at the moment. Try again.';
  return 'That did not save. Try again in a moment.';
}

/**
 * Follow or unfollow, from anywhere on the site. Returns the stored list and
 * keeps state.account in step, so the front page's "Your games" is right the
 * next time it draws.
 */
async function toggleFollow(kind, id, label, on) {
  const list = await accountRpc('set_follow', { p_kind: kind, p_ref: Number(id), p_label: label, p_on: on });
  if (state.account) state.account.follows = list ?? [];
  return list ?? [];
}
const isFollowing = (kind, id) => Boolean(state.account?.follows?.some((f) => f.kind === kind && Number(f.id) === Number(id)));

/**
 * A Follow button for a team or competition page. Signed out, it goes to
 * sign-in and comes back here, because following is a reason to have an
 * account and the button should say so rather than disappear.
 */
const followText = (on, label, named) => `${on ? 'Following' : 'Follow'}${named ? ` ${label}` : ''}`;
function followButtonHTML(kind, id, label, { named = false } = {}) {
  if (!id) return '';
  const on = isFollowing(kind, id);
  return `<button class="btn btn-sm follow-btn ${on ? 'btn-quiet on' : 'btn-ghost'}" data-follow-kind="${esc(kind)}"
    data-follow-id="${esc(id)}" data-follow-label="${esc(label)}"${named ? ' data-named="1"' : ''} aria-pressed="${on}">${esc(followText(on, label, named))}</button>`;
}
function wireFollowButtons() {
  for (const b of app.querySelectorAll('.follow-btn')) {
    b.onclick = async () => {
      if (!state.user) { setIntent(location.hash); location.hash = '#/signin'; return; }
      const on = b.getAttribute('aria-pressed') !== 'true';
      b.disabled = true;
      try {
        await toggleFollow(b.dataset.followKind, b.dataset.followId, b.dataset.followLabel, on);
        b.setAttribute('aria-pressed', String(on));
        b.textContent = followText(on, b.dataset.followLabel, b.dataset.named === '1');
        b.classList.toggle('on', on);
        b.classList.toggle('btn-quiet', on);
        b.classList.toggle('btn-ghost', !on);
      } catch (err) {
        alert(humaneError(err));
      }
      b.disabled = false;
    };
  }
}

/** The search box and unfollow buttons on the Following tab. */
function wireFollowing(account) {
  const q = document.getElementById('follow-q');
  const out = document.getElementById('follow-results');
  if (!q || !out) return;

  let index = null;
  const buildIndex = async () => {
    if (index) return index;
    const board = state.board ?? (await loadBoard().catch(() => ({ fixtures: [] })));
    const seen = new Map();
    for (const f of board.fixtures ?? []) {
      if (f.league_id && f.league) seen.set(`league:${f.league_id}`, { kind: 'league', id: f.league_id, label: f.league, sub: 'Competition' });
      if (f.home_id && f.home) seen.set(`team:${f.home_id}`, { kind: 'team', id: f.home_id, label: f.home, sub: f.league ?? 'Team' });
      if (f.away_id && f.away) seen.set(`team:${f.away_id}`, { kind: 'team', id: f.away_id, label: f.away, sub: f.league ?? 'Team' });
    }
    index = [...seen.values()];
    return index;
  };
  // Accents do not count against a match: "Turkiye" finds Türkiye.
  const fold = (x) => String(x ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

  const draw = async () => {
    const term = fold(q.value.trim());
    if (term.length < 2) { out.innerHTML = ''; return; }
    const all = await buildIndex();
    const hits = all
      .filter((x) => fold(x.label).includes(term))
      .sort((a, b) => (fold(a.label).startsWith(term) ? 0 : 1) - (fold(b.label).startsWith(term) ? 0 : 1) || (a.kind === 'league' ? -1 : 1))
      .slice(0, 8);
    out.innerHTML = hits.length
      ? hits.map((x) => {
          const on = isFollowing(x.kind, x.id);
          return `<li class="follow-item">
            ${crest(x.label, 'sm', x.id, x.kind === 'league' ? 'league' : 'team')}
            <span class="follow-name">${esc(x.label)}<small>${esc(x.sub)}</small></span>
            <button class="btn btn-sm ${on ? 'btn-quiet' : 'btn-primary'}" data-follow="${esc(x.kind)}:${esc(x.id)}" data-label="${esc(x.label)}" data-on="${on ? '1' : ''}">${on ? 'Following' : 'Follow'}</button>
          </li>`;
        }).join('')
      : `<li class="follow-none">Nothing on the board by that name. Only teams and competitions playing in the next few days show here.</li>`;
  };
  let t = null;
  q.oninput = () => { clearTimeout(t); t = setTimeout(draw, 120); };

  app.querySelector('.acct-pane[data-pane="following"]').onclick = async (e) => {
    const b = e.target.closest('button[data-follow], button[data-unfollow]');
    if (!b) return;
    const [kind, id] = (b.dataset.follow ?? b.dataset.unfollow).split(':');
    const on = b.dataset.follow ? !b.dataset.on : false;
    b.disabled = true;
    try {
      await toggleFollow(kind, id, b.dataset.label, on);
      // Redraw the tab from what was stored, keeping the search as typed.
      const typed = q.value;
      await viewAccount();
      const again = document.getElementById('follow-q');
      if (again && typed) { again.value = typed; again.dispatchEvent(new Event('input')); again.focus(); }
    } catch (err) {
      b.disabled = false;
      alert(humaneError(err));
    }
  };
}

/** Money, from minor units, without floating point anywhere near it. */
function money(minor, currency) {
  const n = Number(minor ?? 0);
  const sign = currency === 'GBP' ? '£' : currency === 'EUR' ? '€' : '$';
  return `${sign}${(n / 100).toFixed(2).replace(/\.00$/, '')}`;
}

// ------------------------------------------------------------------ legal

// The legal text lives in js/lib/legal.js (LEGAL, UPDATED, SUPPORT_EMAIL).

/**
 * The owner's page.
 *
 * Not linked from anywhere; reached by typing the address. It shows who the
 * browser is signed in as and what the API makes of that, and it carries the
 * "view as" switch, so both sides of the wall can be checked from one account
 * without a second browser or a second login.
 */
/*
 * Whose copy is this? Paste a leaked call and read the account code out of it
 * (see zwDecode). Unlinked from anywhere; the code alone identifies nobody,
 * and the trace command in pg.yml turns it into an account.
 */
function viewTrace() {
  app.innerHTML = `
  <div class="wrap section narrow">
    <div class="page-head">
      <h1 class="display">Trace a leaked call</h1>
      <p class="page-sub">Paste the text exactly as it was posted. Calls copied from the site carry the copying
        account's code, invisibly.</p>
    </div>
    <div class="acct-form">
      <label for="leak">The leaked text</label>
      <textarea id="leak" rows="6" class="trace-box" placeholder="Paste it here"></textarea>
      <p class="acct-note" id="trace-out" role="status"></p>
    </div>
  </div>`;
  const out = document.getElementById('trace-out');
  document.getElementById('leak').oninput = (e) => {
    const code = zwDecode(e.target.value);
    out.textContent = !e.target.value ? ''
      : code ? `Account code ${code}. Run the trace command with it (pg workflow, argument ${code}) to see whose account it is.`
        : 'No code in this text. It was retyped, or copied from somewhere other than a members\' call.';
  };
}

async function viewDev() {
  // Which navigation this page belongs to: a newer one makes it stand down (see route).
  const nav = navTicket;
  const me = await currentUser({ real: true });
  let account = null;
  if (me) {
    // Read as the real account, whatever the switch says.
    try {
      const s = await import('./js/lib/auth.js');
      const on = s.viewingAsFree();
      if (on) s.setViewAs('self');
      try { account = await getJSON('/api/account'); } finally { if (on) s.setViewAs('free'); }
    } catch { /* shown as unknown */ }
  }
  const m = account?.membership;
  const active = m && m.expires_at * 1000 > Date.now();
  const free = viewingAsFree();
  if (nav !== navTicket) return;
  app.innerHTML = `
  <div class="wrap section narrow">
    <div class="page-head">
      <h1 class="display">Owner's panel</h1>
      <p class="page-sub">What this browser is, and how the site is showing itself to it.</p>
    </div>
    <section class="panel">
      <p class="panel-head">This browser</p>
      <dl class="kv">
        <dt>Signed in as</dt><dd>${me ? `${esc(me.email ?? '')} <span class="muted">${esc(me.id)}</span>` : 'nobody'}</dd>
        <dt>Membership</dt><dd>${!me ? '—' : active
          ? `active until ${esc(new Date(m.expires_at * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }))} (${esc(m.plan_id ?? '')})`
          : 'none'}</dd>
        <dt>Viewing as</dt><dd>${free ? 'a free reader' : 'yourself'}</dd>
      </dl>
    </section>
    <section class="panel">
      <p class="panel-head">View the site as</p>
      <div class="seg" role="group" aria-label="View as">
        <button type="button" data-view="self"${free ? '' : ' class="on"'}>Yourself</button>
        <button type="button" data-view="free"${free ? ' class="on"' : ''}>A free reader</button>
      </div>
      <p class="muted small">"A free reader" sends every request without your token and renders every page
        as it would for someone who has never signed in. It stays on in this browser until you switch it back;
        the header shows a pill while it is on.</p>
    </section>
    <section class="panel">
      <p class="panel-head">Give yourself a membership</p>
      <p class="muted small">Run the <b>pg</b> workflow with command <b>grant</b> and your account's email in
        <b>arg</b>. It comps a membership for ten years, without a payment, so the paid side can be checked
        from this account.</p>
    </section>
  </div>`;
  for (const b of app.querySelectorAll('[data-view]')) {
    b.onclick = () => {
      setViewAs(b.dataset.view);
      state.member = null;
      state.board = null;
      viewDev();
      headerAuth();
    };
  }
}

/*
 * A page the Worker writes (worker/src/landing.ts): tomorrow's matches, the
 * weekend's, the free call, the kinds of prediction, a team. Shown exactly as
 * written, so what a reader sees is what a search engine read. Arriving on
 * one, it is already on the page; moving to one, it is fetched and dropped in.
 */
const serverFirst = app?.querySelector(':scope > article.seo, :scope > .wrap > article.doc')
  ? (location.pathname.replace(/\/+$/, '') || '/') : null;
let serverUsed = false;
async function viewServerPage(parts) {
  const nav = navTicket;
  const path = `/${parts.slice(1).join('/')}`;
  if (!serverUsed && serverFirst === path) {
    serverUsed = true;
    state.serverTitle = document.title;
    return;
  }
  serverUsed = true;
  placeholder(skeletonHTML());
  const res = await fetch(path, { headers: { accept: 'text/html' } });
  const html = await res.text();
  if (nav !== navTicket) return;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const main = doc.querySelector('main#app');
  if (!main) throw new Error(`The server said ${res.status}.`);
  state.serverTitle = doc.title;
  app.innerHTML = main.innerHTML;
  // The address bar shows the page's own address, so it can be shared.
  if (location.hash && location.pathname !== path) {
    try { history.replaceState(history.state, '', path); } catch { /* keep the hash */ }
  }
}

function viewLegal(which) {
  const page = LEGAL[which];
  if (!page) return notFound(`legal/${which}`);
  /*
   * On the cookie page the choice itself, with what it currently is. A
   * policy that tells a reader they can change their mind should let them
   * change it where they are reading that.
   */
  const choice = which === 'cookies' ? (() => {
    const c = readChoice();
    const gpc = !!navigator.globalPrivacyControl
      && !(() => { try { return localStorage.getItem(CONSENT_KEY); } catch { return null; } })();
    const said = !c ? 'You have not answered yet, so both are off.'
      : gpc ? 'Your browser sends the Global Privacy Control signal, so both are off.'
      : `Saved pages are ${c.save ? 'on' : 'off'} and visit counts are ${c.count ? 'on' : 'off'}.`;
    return `
    <section class="panel consent-panel" aria-labelledby="consent-h">
      <p class="panel-head" id="consent-h">Your choice</p>
      <p>${esc(said)}</p>
      ${consentRows('cp')}
      <div class="cta-row">
        <button class="btn btn-primary" data-consent-save>Save my choices</button>
      </div>
    </section>`;
  })() : '';
  app.innerHTML = `
  <div class="wrap section">
    ${legalHTML(which)}
    ${choice}
  </div>`;
  const save = app.querySelector('.consent-panel [data-consent-save]');
  if (save) save.onclick = () => applyConsent(choiceFrom(app.querySelector('.consent-panel')));
  // Contents links scroll rather than change the address, which the router
  // would read as a page of its own.
  for (const a of app.querySelectorAll('[data-jump]')) {
    a.onclick = (e) => {
      e.preventDefault();
      document.getElementById(a.dataset.jump)?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
    };
  }
}

// -------------------------------------------------------- cookie consent

const CONSENT_KEY = 'ow.consent';

/**
 * A notice that decides something.
 *
 * Two things wait on the answer, and both are real:
 *
 *   - a visit counter: one anonymous hit per page opened, the kind of page
 *     and nothing else (see /api/hit and page_view in the schema), so we can
 *     tell which pages people read;
 *   - keeping a copy of pages on this device, so the site opens on the last
 *     copy instantly next time (see getJSON).
 *
 * Neither runs until the reader says yes, and a no switches both off and
 * deletes the stored copies. A browser sending the Global Privacy Control
 * signal is treated as a no without asking. The choice can be changed at any
 * time from the footer or the cookie policy, which says what it currently is.
 */
function readConsent() {
  try {
    const v = localStorage.getItem(CONSENT_KEY);
    if (v) return v;
  } catch { /* private mode: no stored answer */ }
  return navigator.globalPrivacyControl ? 'declined' : null;
}
/**
 * What the reader allowed, one switch per use: saved pages and visit counts.
 * Stored as 'accepted' (both), 'declined' (neither) or 'custom:' and the ones
 * allowed, so an answer given before the choice was split still reads right.
 * Null until they answer: nothing is on by default.
 */
function readChoice() {
  const v = readConsent();
  if (!v) return null;
  if (v === 'accepted') return { save: true, count: true };
  if (v.startsWith('custom:')) {
    const on = new Set(v.slice(7).split(','));
    return { save: on.has('save'), count: on.has('count') };
  }
  return { save: false, count: false };
}
const canSave = () => !!readChoice()?.save;
const canCount = () => !!readChoice()?.count;
const choiceValue = ({ save, count }) => (save && count ? 'accepted' : !save && !count ? 'declined'
  : `custom:${[save && 'save', count && 'count'].filter(Boolean).join(',')}`);

function applyConsent(value) {
  try { localStorage.setItem(CONSENT_KEY, value); } catch { /* private mode: ask again next visit */ }
  document.getElementById('cookie-notice')?.remove();
  document.body.style.paddingBottom = '';
  // Whatever was waiting for the bottom of the screen (the offer bar) can have it.
  dispatchEvent(new Event('ow:consent'));
  if (canCount()) countView();
  // A no to saved pages removes what a yes stored.
  if (!canSave()) cacheClear({ keepMemory: true });
  // The cookie policy shows the current choice; redraw it if it is open.
  if (parseHash().parts[0] === 'legal') route({ soft: true });
}

/** One anonymous page view, if and only if the reader said yes. */
function countView() {
  if (!canCount()) return;
  const page = parseHash().parts[0] || 'home';
  const body = JSON.stringify({ p: page });
  try {
    if (!navigator.sendBeacon?.('/api/hit', body)) {
      fetch('/api/hit', { method: 'POST', body, keepalive: true }).catch(() => {});
    }
  } catch { /* a lost count is fine */ }
}

/*
 * Keep the page out from under the notice.
 *
 * On a wide screen the notice floats bottom-right and on a phone it is a sheet
 * along the bottom edge (`.cookie` in components.css). Either way it covers
 * the foot of the screen, so its height is reserved at the foot of the
 * document and everything under it can be scrolled clear. Measured rather
 * than guessed, because it wraps differently at every width. This matters
 * most on the pricing page: a notice over Buy, with nothing to scroll it out
 * from under, once took the tap meant for the button that takes the money.
 */
function reserveForNotice() {
  const el = document.getElementById('cookie-notice');
  if (!el) { document.body.style.paddingBottom = ''; return; }
  if (getComputedStyle(el).position !== 'fixed') { document.body.style.paddingBottom = ''; return; }
  // On top of the offer bar's own room, when there is one.
  const bar = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--pb-h')) || 0;
  const gap = el.getBoundingClientRect().height + 24 + bar;
  document.body.style.paddingBottom = `${Math.ceil(gap)}px`;
}

/**
 * The switches, one per use of the reader's device, as the notice and the
 * cookie policy both show them. Off unless the reader has said yes: nothing
 * arrives pre-ticked.
 */
function consentRows(prefix) {
  const c = readChoice() ?? { save: false, count: false };
  const row = (key, title, what) => `
    <li>
      <label for="${prefix}-${key}"><b>${title}</b><span>${what}</span></label>
      <input type="checkbox" role="switch" class="switch" id="${prefix}-${key}" data-consent-key="${key}"${c[key] ? ' checked' : ''}>
    </li>`;
  return `
  <ul class="consent-list">
    <li>
      <div><b>Needed to run the site</b><span>Keeps you signed in and remembers this choice.</span></div>
      <span class="consent-fixed">Always on</span>
    </li>
    ${row('save', 'Saved pages', 'A copy of each page on this device, so the site opens instantly next time.')}
    ${row('count', 'Visit counts', 'An anonymous count of which pages get read. Nothing is stored on your device.')}
  </ul>`;
}

/** The switches under `root`, as a stored answer. */
function choiceFrom(root) {
  const on = (k) => !!root.querySelector(`[data-consent-key="${k}"]`)?.checked;
  return choiceValue({ save: on('save'), count: on('count') });
}

function cookieNotice({ force = false } = {}) {
  if (readConsent() && !force) { document.getElementById('cookie-notice')?.remove(); return; }
  /*
   * The notice itself is a template in index.html, and on a first visit it is
   * already on the page: an inline script there puts it in before the first
   * paint, so it never pushes the page down. Here it is only wired up, or put
   * back when the reader opens it again from the footer.
   */
  let el = document.getElementById('cookie-notice');
  if (force || !el) {
    el?.remove();
    const tpl = document.getElementById('cookie-tpl');
    if (!tpl) return;
    el = tpl.content.firstElementChild.cloneNode(true);
    document.body.insertBefore(el, app);
  }
  if (el.dataset.wired) { reserveForNotice(); return; }
  el.dataset.wired = '1';
  const rows = el.querySelector('[data-consent-rows]');
  if (rows) rows.outerHTML = consentRows('cn');
  const more = el.querySelector('.cookie-more');
  more.onclick = () => {
    const box = el.querySelector('#cookie-options');
    box.hidden = !box.hidden;
    more.setAttribute('aria-expanded', String(!box.hidden));
    more.textContent = box.hidden ? 'Choose what to allow' : 'Hide the choices';
    reserveForNotice();
  };
  el.addEventListener('click', (e) => {
    const t = e.target;
    if (t?.dataset?.consent) applyConsent(t.dataset.consent);
    else if (t?.hasAttribute?.('data-consent-save')) applyConsent(choiceFrom(el));
  });
  reserveForNotice();
  addEventListener('resize', reserveForNotice);
}

/**
 * A page whose data did not arrive.
 *
 * All four of these printed `err.message` straight onto the page, so a reader
 * met "database error (502)" or "Failed to fetch" -- our words for what went
 * wrong, in a box with no way out and no way to try again. Neither tells them
 * anything they can act on, and the second one is not even about us: it is
 * what a browser says when the phone has lost signal, which is the far more
 * common case and the one where retrying actually works.
 *
 * So it distinguishes the two, and the button is the point of the whole thing.
 */
function errorState(err, nav) {
  // A page that failed after a newer one was asked for keeps quiet about it.
  if (nav !== undefined && nav !== navTicket) return;
  const raw = String(err?.message ?? '');
  const offline = /failed to fetch|networkerror|load failed/i.test(raw) || navigator.onLine === false;
  app.innerHTML = `
  <div class="wrap section">
    <div class="page-head">
      <h1 class="display xl">${offline ? 'No connection' : 'The board is not answering'}</h1>
      <p class="page-sub">${offline
        ? 'Your device cannot reach us at the moment. The picks are still there; this is between your phone and the internet.'
        : 'Something at our end is not serving the data right now. It is usually brief.'}</p>
    </div>
    <div class="cta-row">
      <button type="button" class="btn btn-primary" id="retry">Try again</button>
      <a class="btn btn-ghost" href="#/results">The record</a>
    </div>
  </div>`;
  document.getElementById('retry').onclick = () => route();
}

/**
 * An address that is not one of ours. Say so, and offer the two ways out.
 * `what` names a page that exists but not for this id (a competition we do
 * not cover), so it does not claim the whole address is wrong.
 */
function notFound(name, { nav, what } = {}) {
  if (nav !== undefined && nav !== navTicket) return;
  app.innerHTML = what ? `
  <div class="wrap section">
    <div class="page-head">
      <h1 class="display xl">${esc(what.title)}</h1>
      <p class="page-sub">${esc(what.sub)}</p>
    </div>
    <div class="cta-row">
      <a class="btn btn-primary" href="${esc(what.href)}">${esc(what.label)}</a>
      <a class="btn btn-ghost" href="#/board">Today's board</a>
    </div>
  </div>` : `
  <div class="wrap section">
    <div class="page-head">
      <h1 class="display xl">No such page</h1>
      <p class="page-sub">There is nothing at <b>/${esc(String(name ?? '').slice(0, 40))}</b>.
        It may have moved, or the link may have picked up a typo on the way here.</p>
    </div>
    <div class="cta-row">
      <a class="btn btn-primary" href="#/board">Today's board</a>
      <a class="btn btn-ghost" href="#/results">The record</a>
    </div>
  </div>`;
}

// ---------------------------------------------------------------- routing

let routed = 0;

/*
 * Which navigation is current. A view awaits its data and then draws; tap a
 * match and then Results before the match has loaded, and the match used to
 * arrive second and draw over Results, under an address that said Results.
 * Every route takes a ticket, each view notes the one it was started with,
 * and a view whose ticket is no longer the latest draws nothing.
 */
let navTicket = 0;
// A real navigation still loading, and whether a soft redraw (the header
// catching up on the account) asked to run meanwhile. The redraw waits and
// runs once after it, rather than cancelling it and losing its scroll.
let hardPending = null;
let softQueued = false;

/*
 * Where the page sits when it opens.
 *
 * The browser's own scroll restoration was on, and on a single-page site it
 * restores against whatever height the page has at that instant -- a
 * skeleton, half a board -- so a page could open a screen or two down, or
 * jump when the content landed. It is off. A page reached by a link opens at
 * the top. A page reached with Back or Forward opens where the reader left
 * it, which is the one case where remembering is what they want. And a
 * redraw with fresh data (softRefresh) does not move them at all.
 */
if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
const scrollMemory = new Map();
/*
 * Which page the reader is on, as the address bar has it now. Scroll places
 * are kept under this. They were kept under the hash the page opened with,
 * which went wrong two ways: a filter or tab rewrites the address in place,
 * so Back came to an address with nothing remembered and opened at the top;
 * and a match page's address is /match/… with no hash, so every match page
 * shared the front page's place.
 */
const addressKey = () => `${location.pathname}${location.search}${location.hash || (location.pathname === '/' ? '#/home' : '')}`;
// Every in-place rewrite of the address (a filter, a tab, a match's real
// address) moves the reader's place with it.
{
  const replace = history.replaceState.bind(history);
  history.replaceState = (data, unused, url) => {
    replace(data, unused, url);
    if (state.here) state.here = addressKey();
  };
}
let navByLink = false;
// A finger on a sign-in link is a head start on Google's button.
document.addEventListener('pointerdown', (e) => {
  if (e.target.closest?.('a[href="#/signin"]')) warmSignIn();
}, { passive: true });

document.addEventListener('click', (e) => {
  const a = e.target.closest?.('a[href^="#/"], a[data-hash]');
  if (a && !e.defaultPrevented && e.button === 0 && !e.metaKey && !e.ctrlKey) navByLink = true;
}, true);
// A link drawn with a real address still moves within the app on a plain tap;
// a new tab, or a crawler, gets the address.
document.addEventListener('click', (e) => {
  const a = e.target.closest?.('a[data-hash]');
  if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || a.target === '_blank') return;
  e.preventDefault();
  if (location.hash === a.dataset.hash && location.pathname === '/') return;
  location.hash = a.dataset.hash;
});

/*
 * The placeholder a view shows while it waits. Skipped on a soft redraw,
 * where the page already has content and swapping it for a skeleton for one
 * frame is exactly the flash this is meant to remove.
 */
/*
 * And only when the wait is long enough to notice. It used to go up at once
 * on every page change, so even a page that was ready in a tenth of a second
 * went old page, then a short grey skeleton with the footer pulled up under
 * it, then the real page pushing everything back down: a flicker and a jump
 * on every tap. Now the old page stays until the new one is ready, and the
 * skeleton is only shown if that takes more than a quarter of a second. Any
 * write the view makes first cancels it.
 */
let placeholderTimer = null;
function placeholder(html) {
  if (state.soft) return;
  clearTimeout(placeholderTimer);
  placeholderTimer = setTimeout(() => {
    placeholderTimer = null;
    app.innerHTML = html;
    jumpTo(0);
  }, 400);
}
/*
 * Where a new page opens, applied the moment its first content goes in.
 *
 * The jump used to wait for the whole view to finish (finishRoute), and a
 * view writes its page and then keeps loading -- the league's scorers, the
 * free call, the photos. Until then the new page sat at the old page's
 * scroll position, which on a long board is past the bottom of a match page:
 * a tap from low down showed the new page's footer, then jumped to the top.
 * A MutationObserver runs before the browser paints, so the page is never
 * seen anywhere but where it opens. finishRoute still has the last word,
 * for a page that grew enough to reach a remembered place.
 */
let jumpOnWrite = null;
new MutationObserver(() => {
  if (placeholderTimer) { clearTimeout(placeholderTimer); placeholderTimer = null; }
  if (jumpOnWrite !== null) { jumpTo(jumpOnWrite); jumpOnWrite = null; }
}).observe(app, { childList: true });

/** Straight there. Never animated: a page change is not a scroll. */
function jumpTo(y) {
  // 'instant' is newer than the options form itself: a phone that does not
  // know it throws, and a jump that throws leaves the new page wherever the
  // old one was. Nothing here sets smooth scrolling, so the plain form is the
  // same jump.
  try { window.scrollTo({ top: y, left: 0, behavior: 'instant' }); } catch { window.scrollTo(0, y); }
}

async function route({ soft = false } = {}) {
  // The page being left, before anything below rewrites the address.
  const leaving = state.here;
  // Arrived on a real address and moved on inside the app: the address bar
  // follows the route, not the page the visit started on.
  if (location.pathname !== '/' && location.hash.startsWith('#/')) {
    history.replaceState(history.state, '', `/${location.search}${location.hash}`);
  }
  const { parts, params } = parseHash();
  const name = parts[0] || 'home';
  const here = addressKey();
  if (soft && hardPending !== null) { softQueued = true; return; }
  const keepY = window.scrollY;
  const ticket = ++navTicket;
  if (!soft) hardPending = ticket;
  state.soft = soft;
  if (!soft) {
    // Set after the first render, so the first route of a session -- the
    // deep link itself -- does not count as somewhere to go back to.
    state.cameFromInApp = routed++ > 0;
    if (leaving) scrollMemory.set(leaving, keepY);
    state.here = here;
  }
  const backTo = !soft && !navByLink ? scrollMemory.get(here) : undefined;
  navByLink = false;
  jumpOnWrite = soft ? null : (backTo ?? 0);
  // What is on the page is about to be read again, so what it is watching is too.
  live.seen.clear();
  live.watching = false;
  live.focus = null;
  state.liveFixture = null;
  clearInterval(state.tick);
  clearInterval(state.poll);
  if (state.onVisible) { removeEventListener('visibilitychange', state.onVisible); state.onVisible = null; }
  for (const a of document.querySelectorAll('.nav a')) a.classList.toggle('on', a.dataset.route === (name === 'checkout' ? 'pricing' : name));
  // Which page is up, for the few rules that differ by page (the landing page
  // ends on its own call to action, so the footer's band stands down there).
  document.body.dataset.page = name;
  // Whop's card fields belong to the checkout page; leaving it takes them down.
  if (!soft && state.payHandle) { state.payHandle.destroy(); state.payHandle = null; }
  if (!soft) setMenu(false);
  if (!soft) unstick();
  try {
    await render(name, parts, params);
  } catch (err) {
    if (ticket === navTicket) errorState(err);
  } finally {
    // Superseded while it loaded: the newer route does all of this for its own page.
    if (ticket === navTicket) finishRoute(name, soft, keepY, backTo);
    if (hardPending === ticket) {
      hardPending = null;
      if (softQueued) { softQueued = false; route({ soft: true }); }
    }
  }
}

/*
 * A page that will not scroll is the worst thing this site can do to a
 * reader, and every overlay that locks the page has its own way out. This is
 * the belt to those braces: a lock whose overlay is no longer on the page is
 * lifted, on every move of page and on a page brought back from the
 * back-forward cache (which keeps the classes it was frozen with).
 */
const LOCKS = {
  'menu-lock': () => document.getElementById('nav')?.classList.contains('open'),
  'dd-locked': () => document.querySelector('.dd-panel.is-sheet'),
  'pay-open': () => document.querySelector('.pay-panel'),
};
function unstick() {
  const html = document.documentElement;
  for (const [cls, held] of Object.entries(LOCKS)) if (html.classList.contains(cls) && !held()) html.classList.remove(cls);
}
addEventListener('pageshow', (e) => { if (e.persisted) unstick(); });

function finishRoute(name, soft, keepY, backTo) {
  {
    if (!soft) setReading(name);
    if (!soft) countView();
    if (!soft) schedulePromos();
    if (!soft) attention.notePage();
    if (!soft) scheduleSeason();
    state.soft = false;
    liveTick();
    playFlashes();
    if (state.board) paintFooter(state.board);
    enhanceSelects(app);
    readAhead();
    if (state.liveFixture) markLiveEvents(Number(state.liveFixture.id), document.getElementById('live-centre'));
    smartQuotes(app);
    crawlable(app);
    appLinks(app);
    pageTitle(name);
    // A match page's address becomes the match's real one, so a link copied
    // from the address bar unfurls into that match's share card rather than
    // the front page's. Only a plain match route is rewritten; one carrying
    // options after a "?" keeps its hash.
    if (name === 'fixture' && state.titleFor?.id && /^#\/fixture\/\d+$/.test(location.hash)) {
      try { history.replaceState(history.state, '', matchUrl(state.titleFor.id, state.titleFor.home, state.titleFor.away)); } catch { /* keep the hash */ }
    }
    // After the content is in, so the position is measured against the real
    // page rather than a skeleton. A view that asked for an element in view
    // (a highlighted scorer) gets it, centred.
    jumpOnWrite = null;
    const target = state.scrollTarget;
    state.scrollTarget = null;
    if (target && !soft && backTo === undefined) target.scrollIntoView({ block: 'center' });
    else jumpTo(soft ? keepY : (backTo ?? 0));
    clearTimeout(placeholderTimer);
    placeholderTimer = null;
    // The new page arrives in one piece, with a short fade so the swap reads
    // as a change of page and not as the old one breaking.
    if (!soft) {
      app.classList.remove('page-in');
      void app.offsetWidth;
      app.classList.add('page-in');
    }
    // The link that was followed went with the old page, which leaves the
    // keyboard at the top of the document and a screen reader silent about
    // where it now is. Its place goes to the new page's heading instead,
    // unless the page put it somewhere on purpose (the search box). Not on
    // the first page of a visit, where the skip link comes first.
    if (!soft && state.cameFromInApp && (!document.activeElement || document.activeElement === document.body)) {
      const h = app.querySelector('h1');
      if (h) {
        if (!h.hasAttribute('tabindex')) h.setAttribute('tabindex', '-1');
        h.focus({ preventScroll: true });
      }
    }
  }
}

/*
 * The week's note (js/lib/season.js): an international break, the close
 * season or a tournament, read from the board every time, so it changes when
 * the football does and needs nobody to switch it on. Only on the pages that
 * show the board, a beat after the page has drawn, never over the cookie
 * question or an offer, and once per break (or once a day in a tournament).
 */
const SEASON_ROUTES = new Set(['home', 'board', 'today', 'leagues']);
let seasonTimer = 0;
let seasonWaiting = false;
async function scheduleSeason() {
  clearTimeout(seasonTimer);
  const name = parseHash().parts[0] || 'home';
  try {
    const [season, moments] = await Promise.all([import('./js/lib/season.js'), import('./js/lib/moments.js')]);
    // Never over the landing page (attention.js): a stranger's first look at
    // the site stays clear, chip and all. The note waits for the board.
    const landing = () => !!document.querySelector('.ld-hero');
    if (!SEASON_ROUTES.has(name) || landing()) { season.removeSeason(); moments.removeMoment(); return; }
    const board = await getJSON('/api/board?hours=72', { quiet: true }).catch(() => null);
    const now = Date.now() / 1000;
    const fixtures = board?.fixtures ?? [];
    // One read per league, shared: the note asks when the Premier League is
    // back, the moment asks for the table it talks about.
    const leagues = new Map();
    const league = (id) => {
      if (!leagues.has(id)) leagues.set(id, getJSON(`/api/league/${id}`, { quiet: true }).catch(() => null));
      return leagues.get(id);
    };
    const [reading, moment] = await Promise.all([
      season.readSeason({
        fixtures,
        now,
        nextTop: async () => {
          const pl = await league(1);
          return (pl?.next ?? []).map((g) => Number(g.kickoff)).filter((k) => k > now).sort((a, b) => a - b)[0] ?? null;
        },
      }),
      moments.findMoment({ fixtures, now, league }).catch(() => null),
    ]);
    const helpers = { crest, esc, kickoff: kickoffLabel, clock: clockTime, now };
    // Already up: leave it. Seen already: the small chip, which opens it again.
    if (document.getElementById('season-note') || document.getElementById('moment')) return;
    const fresh = moment && !moments.seen(moment.key) ? moment : null;
    if (!fresh && !reading) { season.removeSeason(); return; }
    if (!fresh && season.dismissed(reading.key)) { season.showChip(reading, helpers); return; }
    const go = () => {
      if ((parseHash().parts[0] || 'home') !== name || landing()) return;
      if (document.getElementById('cookie-notice')) {
        if (!seasonWaiting) {
          seasonWaiting = true;
          addEventListener('ow:consent', () => { seasonWaiting = false; seasonTimer = setTimeout(scheduleSeason, 900); }, { once: true });
        }
        return;
      }
      // An offer popup or an open menu: try again shortly.
      const menu = document.getElementById('acct-menu');
      if (document.hidden || document.querySelector('.ofr-root, [aria-modal="true"]') || document.getElementById('nav')?.classList.contains('open') || (menu && !menu.hidden)) {
        seasonTimer = setTimeout(go, 4000);
        return;
      }
      // Mid-scroll: a card that lands under a moving thumb is swiped away
      // by that same thumb before anyone reads it. Wait for a pause.
      if (season.readerMoving()) { seasonTimer = setTimeout(go, 700); return; }
      // Not in the first moments of a visit: a second page, or twenty
      // seconds on the site, first.
      if (!attention.settled()) { seasonTimer = setTimeout(go, 3000); return; }
      // A big moment first, then the week's note; one card a visit between
      // them and the offer (js/lib/attention.js). A note that loses out
      // leaves its chip and opens on a later visit.
      if (fresh && attention.mayInterrupt('moment')) {
        attention.noteInterruption('moment');
        moments.openMoment(fresh, helpers);
        if (reading) season.showChip(reading, helpers);
        return;
      }
      if (reading) season.showSeason(reading, helpers);
    };
    seasonTimer = setTimeout(go, 1400);
  } catch { /* a note about the calendar is never worth an error */ }
}

/*
 * Offers set up in the dashboard: the bar across the top and, once a visit,
 * the popup (js/lib/promo.js). The module and its styles load only when an
 * offer is running, so on an ordinary day this costs one small cached read.
 *
 * Whether the reader is a member decides whether a deal is shown at all, and
 * for a signed-in reader that is not known until the account arrives; until
 * then they are treated as a member, so nobody who has paid is sold to while
 * the page is still finding out. headerAuth() calls this again once it knows.
 */
async function schedulePromos() {
  try {
    const running = await getJSON('/api/promos').catch(() => []);
    if (!Array.isArray(running) || !running.length) { document.getElementById('promo-bar')?.remove(); return; }
    const promo = await import('./js/lib/promo.js');
    const signedIn = !!state.user;
    const member = signedIn ? state.member !== false : false;
    const returning = signedIn && !!state.account?.returning;
    await promo.runPromos({ route: parseHash().parts[0] || 'home', signedIn, member, returning, anchor: app, promos: running });
  } catch { /* an offer is never worth an error */ }
}

/*
 * Typographer's quotes, applied to whatever the page just drew.
 *
 * Copy is written with straight quotes because that is what a keyboard and a
 * data feed produce, and a straight apostrophe in "Today's" or "O'Neill" is a
 * typewriter mark. This walks the text nodes (never attributes, inputs or
 * code) and sets apostrophes and quotation marks as a typesetter would, plus
 * three dots as an ellipsis.
 */
const SKIP_QUOTES = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'INPUT', 'CODE', 'PRE']);
function smartQuotes(root) {
  if (!root) return;
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (SKIP_QUOTES.has(n.parentNode?.nodeName) || !/['"]|\.\.\./.test(n.nodeValue)
      ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  const nodes = [];
  while (walk.nextNode()) nodes.push(walk.currentNode);
  for (const n of nodes) {
    n.nodeValue = n.nodeValue
      .replace(/(\w)'(\w)/g, '$1\u2019$2')          // it's, O'Neill
      .replace(/'(?=\d)/g, '\u2019')                 // the '90s: an apostrophe, not a quote
      .replace(/(^|[\s(\[{\u2014\u2013-])'/g, '$1\u2018') // opening single
      .replace(/'/g, '\u2019')                        // closing single, '90s
      .replace(/(^|[\s(\[{\u2014\u2013-])"/g, '$1\u201C') // opening double
      .replace(/"/g, '\u201D')                        // closing double
      .replace(/\.\.\./g, '\u2026');
  }
}

async function render(name, parts, params) {
  {
    if (name === 'fixture' && parts[1]) return await viewFixture(parts[1], params);
    if (name === 'league' && parts[1]) return await viewLeague(parts[1], params);
    if (name === 'player' && parts[1]) return await viewPlayer(parts[1], params);
    if (name === 'board') return await viewBoard(params);
    if (name === 'leagues') return await viewLeagues();
    if (name === 'search') return await viewSearch(params);
    if (name === 'results') return await viewResults();
    if (name === 'how-sure') return await viewHowSure();
    if (name === 'pricing') return await viewPricing();
    if (name === 'checkout') return await viewCheckout(params);
    if (name === 'slip') return await viewSlip();
    if (name === 'dev') return await viewDev();
    if (name === 'trace') return viewTrace();
    if (name === 'signin') return await viewSignin();
    if (name === 'account') return await viewAccount();
    // The owner's dashboard, loaded only when opened. js/admin.js.
    if (name === 'admin') return await (await import('./js/admin.js')).viewAdmin(app, parts, params, { crest, esc, clock: clockTime });
    if (name === 'legal' && parts[1]) return viewLegal(parts[1]);
    if (name === 'page' && parts[1]) return await viewServerPage(parts);
    if (name === 'home') return await viewHome();
    /*
     * An address we do not have.
     *
     * Everything unrecognised used to fall through to the home page, so a
     * typo, a stale bookmark or a link to a route that has since moved landed
     * on the front page looking like it had worked -- and the reader went
     * looking for whatever they had been sent, on a page that never had it.
     * Saying so costs four lines and two ways out.
     */
    return notFound(name);
  }
}

/**
 * Point the header link at the right place.
 *
 * Runs after the first paint rather than blocking it: the link reads "Sign in"
 * until we know otherwise, which is right for almost everyone and wrong for a
 * few hundred milliseconds for the rest.
 */
/**
 * Say what the reader has, in the header, always.
 *
 * Three states and they are visibly different: signed out, signed in on the
 * free tier, and a member. The version before this showed "Sign in" or
 * "Account" and nothing else, so a free reader had no way of knowing there was
 * a tier above them until a call was withheld. Meeting the gate for the first
 * time at the moment you are refused something is the worst way to meet it, and
 * it is the complaint this answers.
 */
/** Sign out, here or on every device, and land on the front page. */
async function leaveAccount(everywhere = false) {
  await signOut({ everywhere });
  cacheClear();
  state.member = null;
  state.board = null;
  state.account = null;
  closeAccountMenu();
  location.hash = '#/home';
  await route();
  headerAuth();
}

/*
 * The account menu, from the reader's picture in the header.
 *
 * The picture used to go straight to the account page, so a member checking
 * when their membership runs out, or wanting to sign out, went through a full
 * page. Now it opens this: who you are, your plan and when it runs to, the
 * four parts of the account, and signing out.
 */
function closeAccountMenu() {
  const menu = document.getElementById('acct-menu');
  if (!menu || menu.hidden) return;
  menu.hidden = true;
  document.getElementById('account-link')?.setAttribute('aria-expanded', 'false');
}
function accountMenuHTML() {
  const user = state.user;
  if (!user) return '';
  const name = accountName(user, state.account?.profile);
  const m = liveMembership(state.account);
  const until = m ? new Date(m.expires_at * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' }) : '';
  return `
    <div class="am-who">
      ${avatarHTML(user, name, 'md')}
      <div><b>${esc(name)}</b><span>${state.account?.profile?.username ? `@${esc(state.account.profile.username)}` : esc(user.email ?? '')}</span></div>
    </div>
    <a class="am-plan${m ? ' on' : ''}" href="#/account?tab=membership" role="menuitem">
      ${m ? `<b>${esc(PLAN_NAME[m.plan_id] ?? 'Membership')}</b><span>Runs to ${esc(until)}${renewsItself(m) ? ', renews by itself' : ''}</span>`
          : `<b>Free account</b><span>One call a day. See the plans for every call.</span>`}
    </a>
    <nav class="am-links" aria-label="Your account">
      <a href="#/account?tab=profile" role="menuitem">Your profile</a>
      <a href="#/account?tab=following" role="menuitem">Teams you follow</a>
      <a href="#/account?tab=membership" role="menuitem">${m ? 'Membership and payments' : 'Membership'}</a>
      <a href="#/account?tab=settings" role="menuitem">Settings</a>
      <a class="am-cta" href="#/pricing" role="menuitem">${m ? 'See all plans' : 'See the plans'}</a>
      ${state.isAdmin ? '<a class="am-admin" href="#/admin" role="menuitem">Admin dashboard</a>' : ''}
    </nav>
    <button class="am-out" type="button" id="am-out" role="menuitem">Sign out</button>`;
}
function toggleAccountMenu(e) {
  e.preventDefault();
  const link = document.getElementById('account-link');
  let menu = document.getElementById('acct-menu');
  if (!menu) {
    menu = document.createElement('div');
    menu.id = 'acct-menu';
    menu.className = 'acct-menu';
    menu.setAttribute('role', 'menu');
    menu.hidden = true;
    link.after(menu);
    menu.addEventListener('click', (ev) => {
      if (ev.target.closest('#am-out')) { leaveAccount(false); return; }
      if (ev.target.closest('a')) closeAccountMenu();
    });
  }
  if (!menu.hidden) { closeAccountMenu(); return; }
  // The owner sees a way into the dashboard. Asked once, the first time the
  // menu opens; for anyone else the answer is no and nothing shows.
  if (state.isAdmin === undefined) {
    state.isAdmin = false;
    import('./js/admin.js').then((m) => m.isAdmin()).then((yes) => {
      state.isAdmin = yes;
      if (yes && !menu.hidden) menu.innerHTML = accountMenuHTML();
    }).catch(() => {});
  }
  menu.innerHTML = accountMenuHTML();
  menu.hidden = false;
  link.setAttribute('aria-expanded', 'true');
  menu.querySelector('a')?.focus({ preventScroll: true });
}
document.addEventListener('click', (e) => {
  if (!e.target.closest?.('#acct-menu, #account-link')) closeAccountMenu();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !document.getElementById('acct-menu')?.hidden) {
    closeAccountMenu();
    document.getElementById('account-link')?.focus();
  }
});
addEventListener('hashchange', closeAccountMenu);
addEventListener('popstate', closeAccountMenu);

async function headerAuth() {
  const link = document.getElementById('account-link');
  const upgrade = document.getElementById('upgrade-link');
  if (!link) return;

  const user = await currentUser();
  state.user = user;

  // The "view as" pill. Loud on purpose: a preview switch that can be
  // forgotten is a preview switch that gets forgotten.
  let pill = document.getElementById('viewas-pill');
  if (viewingAsFree()) {
    if (!pill) {
      pill = document.createElement('a');
      pill.id = 'viewas-pill';
      pill.className = 'viewas-pill';
      pill.href = '#/dev';
      document.body.prepend(pill);
    }
    pill.textContent = 'Viewing as a free reader. Tap to switch back';
  } else if (pill) {
    pill.remove();
  }

  /*
   * Membership from the account, not from the board.
   *
   * `state.board.member` is whatever the last board response said, which on
   * the pricing page is nothing at all and immediately after paying is the
   * answer from before the payment. So the header told somebody who had just
   * bought a membership that they were on the free tier, which is the single
   * worst moment to get that wrong. `/api/account` answers the question
   * directly; it is asked once per signed-in session and re-asked whenever
   * something has changed.
   */
  let member = false;
  if (user) {
    // The same call carries the profile and the follows, so the front page
    // can greet and personalise without a second request.
    if (state.member === null || !state.account) {
      try {
        state.account = await getJSON('/api/account');
        // What the page drew with: the board's answer, or "not a member" when
        // nothing had said yet (a fixture page opened directly).
        const was = isMember();
        state.member = Boolean(state.account.membership?.expires_at * 1000 > Date.now());
        // If the account says otherwise (an advert shown to a member, a call
        // drawn without its member marks), draw it again with the right one.
        if (was !== state.member) softRefresh();
        const f = state.account.profile?.odds_format;
        const c = state.account.profile?.clock;
        const oddsChanged = (f && f !== oddsFormat) || (c && c !== clockFormat);
        if (f && f !== oddsFormat) setOddsFormat(f);
        if (c && c !== clockFormat) setClock(c);
        // The page may have drawn before the account arrived: redraw it once
        // so the odds and "Your games" are the reader's own.
        if (oddsChanged || state.account.follows?.length) softRefresh();
      } catch { state.member = Boolean(state.board?.member); }
    }
    member = state.member;
  } else {
    state.member = null;
    state.account = null;
  }

  // Signed in, the button is the reader's own face: their picture or their
  // initials, which is how every account on the web says "this is you".
  if (user) {
    const name = accountName(user, state.account?.profile);
    link.className = 'account-chip';
    link.innerHTML = avatarHTML(user, name, 'sm');
    link.setAttribute('aria-label', `Your account, ${name}`);
    link.title = name;
  } else {
    link.className = 'btn btn-ghost btn-sm';
    link.textContent = 'Sign in';
    link.removeAttribute('aria-label');
    link.removeAttribute('title');
  }
  link.href = user ? '#/account' : '#/signin';
  // Signed in, the picture opens the account menu; signed out, it is the
  // sign-in link it looks like.
  link.onclick = user ? toggleAccountMenu : null;
  if (user) { link.setAttribute('aria-haspopup', 'menu'); link.setAttribute('aria-expanded', 'false'); }
  else { link.removeAttribute('aria-haspopup'); link.removeAttribute('aria-expanded'); closeAccountMenu(); }

  // "Membership" in the menu and the footer goes to the plans for everyone.
  // For a member it used to go to their own account page instead, and with
  // the header button hidden too, a signed-in member had no way to see the
  // plans short of a small link three taps deep. The plans page shows a
  // member their own plan first anyway, with the way to their account.
  for (const a of document.querySelectorAll('a[data-member-link]')) {
    (a.querySelector('.nl') ?? a).textContent = member ? 'Plans' : 'Membership';
    const sub = a.querySelector('small');
    if (sub) sub.textContent = member ? 'Yours, and moving to another' : 'Every call, every day';
    if (a.dataset.hash) { a.dataset.hash = '#/pricing'; a.setAttribute('href', '/pricing'); }
    else a.setAttribute('href', '#/pricing');
  }

  paintMemberMark();

  // A member's picture wears the accent as a ring: the plan, without a badge.
  if (user) {
    link.classList.toggle('is-member', member);
    link.title = `${accountName(user, state.account?.profile)}${member ? ', member' : ''}`;
  }
  if (upgrade) {
    // Always there: the plans one tap away from every page. For a member it
    // is a quiet "Plans" rather than a sales button, because they have one.
    // The long words on a laptop, one word on a phone, where it sits in the
    // bar in place of "Sign in" (which moves into the menu).
    upgrade.hidden = false;
    upgrade.classList.toggle('btn-primary', !member);
    upgrade.classList.toggle('btn-ghost', member);
    upgrade.innerHTML = member ? '<span>Plans</span>' : user ? '<span>Upgrade</span>' : '<span class="ul-long">Get the calls</span><span class="ul-short">Join</span>';
  }
  const navSignin = document.getElementById('nav-signin');
  if (navSignin) navSignin.hidden = Boolean(user);
  // Now that membership is known, the offers can be decided properly.
  schedulePromos();
}

/**
 * The country control.
 *
 * Prices are only useful attached to a book somebody can open an account with,
 * and which books those are is decided by where the reader is sitting. We work
 * that out from the device's timezone, which is right most of the time and
 * quietly wrong the rest — a phone bought abroad, a VPN, a traveller.
 *
 * So the guess is stated out loud rather than applied silently. A reader who
 * sees the wrong country can fix it in one tap, and the fix sticks.
 */
function renderRegion() {
  const host = document.getElementById('region-pick');
  if (!host) return;
  const here = country();
  const where = COUNTRY_NAMES[here];
  host.innerHTML = where
    ? `<p>Prices and stakes shown for <b>${esc(where)}</b>, from the books licensed there.</p>`
    : `<p>Prices shown from books that take customers in most countries.</p>`;
}

/*
 * The footer, drawn from the board rather than typed in.
 *
 * It used to carry fixed links to the Premier League, La Liga, Serie A and
 * the Bundesliga, a "88 leagues" that were really competitions, and "Tonight's
 * are on the board" at five in the morning. During an international break the
 * big leagues are two weeks from their next game and those links led to empty
 * pages. Now every link goes somewhere with something on it: the competitions
 * with games in the next three days, the next kick-offs we have a call on,
 * and a live line only while matches are being played.
 */
const FOOT_COMPS = 7;
// The big competitions have their own fixed links (index.html); "This week"
// lists the others that have something on.
const FOOT_FIXED = new Set([7, 1, 3, 4, 5, 6]);
const FOOT_NEXT = 5;
/* The live count in the bar: how many games on the board are being played. */
function paintNavLive(board) {
  const el = document.getElementById('nav-live');
  if (!el) return;
  const n = (board?.fixtures ?? []).filter((f) => matchState(f).kind === 'live').length;
  el.hidden = !n;
  if (!n) return;
  el.querySelector('b').textContent = String(n);
  el.setAttribute('aria-label', `${n} ${n === 1 ? 'game' : 'games'} being played now`);
}

function paintFooter(board) {
  paintNavLive(board);
  const fixtures = board?.fixtures ?? [];
  if (!fixtures.length) return;
  const now = Date.now() / 1000;
  const live = fixtures.filter((f) => matchState(f).kind === 'live');
  const soon = fixtures.filter((f) => matchState(f).kind === 'upcoming' && f.kickoff - now < 72 * 3600);
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

  const liveEl = document.getElementById('foot-live');
  if (liveEl) {
    liveEl.hidden = !live.length;
    if (live.length) {
      liveEl.href = '#/board?when=live';
      liveEl.innerHTML = `<span class="live-badge"><i></i>Live</span> ${plural(live.length, 'match', 'matches')} on now`;
    }
  }

  // Competitions with something on, biggest first, then busiest.
  const by = new Map();
  for (const f of [...live, ...soon]) {
    const k = f.league_id ?? f.league;
    const e = by.get(k) ?? { id: f.league_id, name: f.league ?? '', n: 0, live: 0, rank: f.rank ?? 6 };
    e.n++;
    if (matchState(f).kind === 'live') e.live++;
    e.rank = Math.min(e.rank, f.rank ?? 6);
    by.set(k, e);
  }
  const comps = [...by.values()].filter((e) => e.name && !FOOT_FIXED.has(Number(e.id)))
    .sort((a, b) => b.live - a.live || a.rank - b.rank || b.n - a.n).slice(0, FOOT_COMPS);
  const compsEl = document.getElementById('foot-comps');
  const compsCol = document.getElementById('foot-comps-col');
  if (compsEl && compsCol) {
    compsCol.hidden = !comps.length;
    compsEl.innerHTML = comps.map((e) => `<a class="foot-comp" href="${e.id ? `#/league/${encodeURIComponent(e.id)}` : esc(boardHash(state.hours, e.name))}">
          <span>${esc(e.name)}</span><small>${e.live ? 'on now' : plural(e.n, 'game', 'games')}</small></a>`).join('');
  }

  // The next kick-offs we have a call on, then the biggest games coming, so
  // the list is full without filling it with matches nobody came for.
  const byTime = (a, b) => a.kickoff - b.kickoff;
  const called = soon.filter(hasCall).sort(byTime);
  const big = soon.filter((f) => !hasCall(f)).sort((a, b) => (a.rank ?? 6) - (b.rank ?? 6) || byTime(a, b));
  const next = [...called, ...big].slice(0, FOOT_NEXT).sort(byTime);
  const nextEl = document.getElementById('foot-next');
  const nextCol = document.getElementById('foot-next-col');
  if (nextEl && nextCol) {
    nextCol.hidden = !next.length;
    nextEl.innerHTML = next.map((f) => `<a class="foot-fx" href="#/fixture/${encodeURIComponent(f.id)}">
        <small>${esc(kickoffLabel(f.kickoff))}</small><span>${esc(f.home)} v ${esc(f.away)}</span></a>`).join('');
  }

  // The band above: what is happening now, in one line.
  const kicker = document.getElementById('foot-kicker');
  const line = document.getElementById('foot-line');
  const btn = document.getElementById('foot-cta-btn');
  const day = new Date().toDateString();
  const today = soon.filter((f) => hasCall(f) && new Date(f.kickoff * 1000).toDateString() === day).length;
  if (kicker && line && btn) {
    if (live.length) {
      kicker.textContent = 'on right now';
      line.textContent = `${plural(live.length, 'match', 'matches')} being played.`;
      btn.textContent = 'Follow them live';
      btn.setAttribute('href', '#/board?when=live');
    } else if (today) {
      kicker.textContent = 'the board is up';
      line.textContent = `${plural(today, 'call', 'calls')} on today's games.`;
      btn.textContent = "See today's board";
      btn.setAttribute('href', '#/board');
    } else if (next[0]) {
      kicker.textContent = 'every call, and how it went';
      line.textContent = `Next kick-off ${kickoffLabel(next[0].kickoff).replace(/^(Today|Tomorrow)/, (w) => w.toLowerCase())}.`;
      btn.textContent = 'See the board';
      btn.setAttribute('href', '#/board');
    }
  }

  const stats = document.getElementById('foot-stats');
  if (stats) {
    stats.innerHTML = `
      <div><b>88</b><span>Competitions we cover</span></div>
      <div><b>${fixtures.length.toLocaleString()}</b><span>Games on the board</span></div>
      <div><b>15 min</b><span>Between analysis updates</span></div>
      <div><b>30 sec</b><span>Between live score updates</span></div>`;
  }
  const year = document.getElementById('foot-year');
  if (year) year.textContent = String(new Date().getFullYear());
}

async function health() {
  // The header's tally, on every page. The board is only fetched for it where
  // a page has not already loaded one; the settled record is small.
  try {
    const [recent, board] = await Promise.all([
      getJSON('/api/picks?limit=40&settled=true').then((r) => r.picks ?? []),
      state.board ? state.board : loadBoard().catch(() => null),
    ]);
    paintTally(board?.fixtures ?? [], recent);
    paintFooter(board);
  } catch { /* stays hidden */ }
}

function setMenu(open) {
  document.getElementById('nav').classList.toggle('open', open);
  document.getElementById('burger').setAttribute('aria-expanded', String(open));
  document.documentElement.classList.toggle('menu-lock', open);
}
document.getElementById('burger').onclick = () => setMenu(!document.getElementById('nav').classList.contains('open'));
// The page behind the open menu is dimmed; a tap on it closes the menu rather
// than following whatever was underneath.
document.addEventListener('click', (e) => {
  if (!document.getElementById('nav').classList.contains('open')) return;
  if (e.target.closest?.('#nav, #burger')) return;
  e.preventDefault();
  e.stopPropagation();
  setMenu(false);
}, true);
document.addEventListener('keydown', (e) => {
  const navOpen = document.getElementById('nav').classList.contains('open');
  if (e.key === 'Escape' && navOpen) {
    setMenu(false);
    document.getElementById('burger').focus();
  }
  // The open menu keeps the keyboard: Tab goes round its button and its
  // links, not on into the dimmed page behind, where a tap would only close it.
  if (e.key === 'Tab' && navOpen && getComputedStyle(document.getElementById('burger')).display !== 'none') {
    const ring = [document.getElementById('burger'), ...document.querySelectorAll('#nav a')].filter((el) => el.offsetParent !== null);
    const i = ring.indexOf(document.activeElement);
    const next = ring[(i + (e.shiftKey ? -1 : 1) + ring.length) % ring.length];
    if (next) { e.preventDefault(); next.focus(); }
  }
  // A row of tabs is marked up as tabs, which tells a screen reader the arrow
  // keys move along it. They did nothing. Left, Right, Home and End now move
  // to the next tab and open it, skipping any that are switched off.
  const tab = e.target.closest?.('[role="tab"]');
  if (tab && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) {
    const row = [...(tab.closest('[role="tablist"]')?.querySelectorAll('[role="tab"]') ?? [])].filter((t) => !t.disabled && t.offsetParent !== null);
    const i = row.indexOf(tab);
    const to = e.key === 'Home' ? row[0] : e.key === 'End' ? row[row.length - 1]
      : row[(i + (e.key === 'ArrowRight' ? 1 : -1) + row.length) % row.length];
    if (to && to !== tab) { e.preventDefault(); to.focus(); to.click(); }
  }
  // "/" opens search from anywhere but a field being typed in.
  if (e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey && !e.target.closest?.('input, textarea, select, [contenteditable]')) {
    e.preventDefault();
    if (parseHash().parts[0] === 'search') document.getElementById('search-q')?.focus();
    else location.hash = '#/search';
  }
});

window.addEventListener('hashchange', route);
// Back and forward between a match's real address (/match/…) and a hash
// route change the path as well as the hash, and a browser fires no
// hashchange for that, only popstate. Route on it too, once per URL.
let routedFor = null;
window.addEventListener('popstate', () => {
  setTimeout(() => { if (routedFor !== location.href) route(); }, 0);
});
window.addEventListener('hashchange', () => { routedFor = location.href; });

renderRegion();
// A competition's art (the Champions League star ball) starts itself
// wherever a view puts it.
wakeArt();

// The live poll (liveTick): a look every five seconds at whether one is due,
// which is every thirty while a match on the page is being played. Coming
// back to a backgrounded tab looks at once.
setInterval(liveTick, 5000);
setInterval(tickClocks, 1000);
addEventListener('visibilitychange', () => { if (!document.hidden) liveTick(); });

/**
 * Boot.
 *
 * The sign-in has to be finished before the first render, not alongside it: a
 * view that reads the session while the code is still being exchanged would
 * paint the signed-out page and then not correct itself. Everything after it is
 * fire-and-forget.
 */
(async () => {
  let signedInJustNow = false;
  /*
   * The first page of a visit waits, briefly, for the faces. They are
   * preloaded and nearly always land with the script, so this usually costs
   * nothing; when they are late, text drawn in the fallback rewraps when the
   * real face arrives (the display face is very condensed) and the page under
   * it moves. The skeleton shows meanwhile, and after half a second the page
   * draws regardless.
   */
  const faces = document.fonts?.load
    ? Promise.race([
      Promise.all([document.fonts.load('700 1em "Big Shoulders Display"'), document.fonts.load('400 1em Archivo')]),
      new Promise((ok) => setTimeout(ok, 500)),
    ]).catch(() => {})
    : Promise.resolve();
  // Back from Google: say what is happening while the session is started,
  // rather than a blank page for the second it takes.
  if (isGoogleReturn()) {
    app.innerHTML = `<div class="wrap section narrow"><div class="signing" role="status">
      <span class="spin" aria-hidden="true"></span><p>Signing you in with Google…</p></div></div>`;
  }
  try {
    signedInJustNow = await completeSignIn();
  } catch (err) {
    // A stale or reused magic link. Say so once, on the sign-in page, rather
    // than leaving someone looking at a home page wondering what happened.
    /*
     * A stale or reused link, in words. Supabase says "invalid request: both
     * auth code and code verifier should be non-empty", which is about its
     * internals and not about anything the reader did or can fix.
     */
    state.authError = err?.google
      ? (err.message === 'cancelled' ? 'Google sign-in was cancelled. Try again whenever you like.' : 'Google did not sign you in that time. Try again.')
      : /expired|invalid|verifier|code/i.test(String(err?.message ?? ''))
      ? 'That sign-in link has already been used, or it has expired. Ask for a new one below.'
      : 'That sign-in link did not work. Ask for a new one below.';
    /*
     * replaceState, not `location.hash`.
     *
     * Assigning the hash fires hashchange, which routes -- and then the
     * explicit route() below routes a second time. viewSignin clears
     * state.authError as it reads it, so the first render consumed the message
     * and the second drew the page without it: a reader whose link had expired
     * was sent to the sign-in page and told nothing at all.
     */
    history.replaceState(null, '', `${location.pathname}${location.search}#/signin`);
  }
  /*
   * Pick up where they left off.
   *
   * A magic link opens on whatever address the redirect carries, which is the
   * front page. Someone who was three taps into buying a membership when they
   * were asked to sign in came back to the home page with no membership, no
   * checkout and nothing saying what had happened -- and the only way back was
   * to find the pricing page again and start over.
   */
  if (signedInJustNow) {
    const intent = takeIntent();
    if (intent?.startsWith('buy')) {
      location.hash = '#/pricing';
      await faces;
      await route();
      await startCheckout(intent.split(':')[1] || 'monthly', intent.split(':')[2] || null);
      health();
      headerAuth();
      cookieNotice();
      return;
    }
    if (intent && intent.startsWith('#/')) location.hash = intent;
  }
  await faces;
  await route();
  smartQuotes(document.querySelector('footer'));
  crawlable(document.querySelector('header'));
  crawlable(document.querySelector('footer'));
  const settings = document.getElementById('cookie-settings');
  if (settings) settings.onclick = () => cookieNotice({ force: true });
  health();
  headerAuth();
  cookieNotice();
})();
