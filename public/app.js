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
import { LEGAL, SUPPORT_EMAIL, UPDATED } from './js/lib/legal.js';
import { absenceReason } from './js/lib/absence.js';
import { accountRpc, authHeaders, completeSignIn, currentUser, renderGoogleButton, setViewAs, signInWithEmail, signInWithGoogle, signOut, viewingAsFree } from './js/lib/auth.js';

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
  if (!consented()) return null;
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
  if (!consented()) return;
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
  const res = await fetch(path, { headers });
  const text = await res.text();
  if (!res.ok) {
    let msg = 'Something went wrong loading this.';
    try { msg = JSON.parse(text).error ?? msg; } catch { /* body was not json */ }
    throw new Error(msg);
  }
  return text;
}

async function getJSON(path, { fresh = false } = {}) {
  const headers = await authHeaders();
  if (!CACHEABLE.test(path)) return JSON.parse(await fetchText(path, headers));

  const key = cacheKey(headers.authorization ? 'auth' : 'anon', path);
  const hit = fresh ? null : cacheRead(key);
  const age = hit ? Date.now() - hit.at : Infinity;
  if (hit && age < FRESH_MS) return JSON.parse(hit.text);
  if (hit && age < KEEP_MS) {
    // Serve the old copy now; fetch the new one behind it.
    fetchText(path, headers).then((text) => {
      cacheWrite(key, text);
      if (text !== hit.text) softRefresh();
    }).catch(() => { /* the old copy stays up */ });
    return JSON.parse(hit.text);
  }
  const text = await fetchText(path, headers);
  cacheWrite(key, text);
  return JSON.parse(text);
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
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
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
const LIVE_STATES = new Set(['1st_half', '2nd_half', 'extra_time', 'penalties', 'live']);

function matchState(f) {
  const status = String(f?.status ?? '').toLowerCase();
  if (status === 'finished' || status === 'ended' || status === 'aet' || status === 'ap') {
    return { kind: 'ft', label: 'Full time', short: 'FT' };
  }
  if (status === 'halftime' || status === 'ht') {
    return { kind: 'live', label: 'Half time', short: 'HT' };
  }
  if (LIVE_STATES.has(status)) return { kind: 'live', label: 'Live', short: 'LIVE' };
  if (status === 'postponed' || status === 'cancelled' || status === 'canceled') {
    return { kind: 'off', label: 'Postponed', short: 'OFF' };
  }
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
  return `<span class="crest crest-${size}${type === 'player' ? ' crest-player' : ''}" style="${vars}" aria-hidden="true"
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
function parseHash() {
  const raw = (location.hash || '#/home').slice(1);
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
 * How a call is doing while the match is on.
 *
 * The same grader the board runs on a finished match, run on the running
 * score: a call that would land if the whistle went now is "on track", one
 * that would not is "not yet". Neither is a verdict -- a match is not over at
 * the hour -- so the words say so, and "not yet" is amber, the colour of a
 * thing still pending, rather than the red of a loss. Markets the score cannot
 * grade (corners, cards, a level handicap) get nothing.
 */
function liveTrack(pick, f) {
  if (!pick || !f || matchState(f).kind !== 'live') return null;
  const ls = Array.isArray(f.live_score) && f.live_score.length === 2 ? f.live_score : null;
  if (!ls) return null;
  const r = didItLand({ market: pick.market, outcome: pick.outcome, line: pick.line, homeGoals: ls[0], awayGoals: ls[1] });
  if (r !== 'won' && r !== 'lost') return null;
  return { on: r === 'won', score: `${ls[0]}–${ls[1]}` };
}
const trackHTML = (t) => (t ? `<span class="track ${t.on ? 'on' : 'off'}"><i></i>${t.on ? 'On track' : 'Not yet'}</span>` : '');

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
      : trackHTML(liveTrack(v, free))} <b>${oddsTag(v.odds)}</b>${v.bookmaker ? ` at ${esc(bookName(v.bookmaker))}` : ''}</p>
    <p class="hero-blurb">${landed
      ? 'Free for everyone, as one call is every day. Members had every other call on the board.'
      : 'Free for everyone, and under way. Members get every other call the moment it goes up.'}</p>
  </div>`;
  }

  return `
  <div class="freecall">
    <span class="freecall-tag">Today's free call</span>
    ${elsewhere ? `<a class="freecall-tie" href="#/fixture/${encodeURIComponent(tie.id)}">${crest(tie.home, 'xs', tie.home_id)}${esc(tie.home)} v ${crest(tie.away, 'xs', tie.away_id)}${esc(tie.away)}<span>${esc(kickoffLabel(tie.kickoff))}</span></a>` : ''}
    <p class="freecall-sel">${elsewhere ? `<a href="#/fixture/${encodeURIComponent(tie.id)}">${esc(d.name)}</a>` : esc(d.name)}</p>
    <p class="freecall-meta" data-public-price><b>${oddsTag(v.odds)}</b>${v.bookmaker ? ` at ${esc(bookName(v.bookmaker))}` : ''}</p>
    <p class="hero-blurb">The call we are surest of today, free for everyone. Members get every other call the moment it goes up.</p>
  </div>`;
}

function heroHTML(hero = null, venueIds = [], detail = null, free = null) {
  const queue = hero?.venue_id ? [hero.venue_id, ...venueIds] : [].concat(venueIds).filter(Boolean);

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

  return `
  <section class="hero" data-shot="${queue.length ? 'yes' : 'none'}">
    <div class="hero-media">${venueShot(queue, '', true)}</div>
    <div class="wrap hero-inner">
      <div class="hero-copy">
        <span class="timechip${isSoon(hero.kickoff) ? ' soon' : ''}">${esc(when)}</span>
        ${compHTML}
        <!-- The tie is the page's heading. Without this the home page had no
             h1 at all whenever a hero fixture was set, which is the one case
             it always is. -->
        <h1 class="fx-stack">
          <span class="fx-line">${crest(hero.home, 'md', hero.home_id)}<span class="name">${esc(hero.home)}</span></span>
          <span class="fx-line">${crest(hero.away, 'md', hero.away_id)}<span class="name">${esc(hero.away)}</span></span>
        </h1>
        ${freeCallHTML(hero, detail, free)}
        <div class="hero-cta">
          <a class="btn btn-primary" href="#/fixture/${encodeURIComponent(hero.fixture_id)}">Read why</a>
          <a class="btn btn-ghost" href="#/board">Today's calls</a>
        </div>
      </div>
      ${matchCentreHTML(hero, detail)}
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
  const time = k.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
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
    : f.locked ? `<small class="next-pick" title="A pick for members">${lock}Pick</small>` : '';
  return `
  <li><a class="next-row" href="#/fixture/${encodeURIComponent(f.id)}">
    <span class="next-side home"><span class="next-name">${esc(f.home)}</span>${crest(f.home, 'sm', f.home_id)}</span>
    <span class="next-mid">${middle}${mark}</span>
    <span class="next-side away">${crest(f.away, 'sm', f.away_id)}<span class="next-name">${esc(f.away)}</span></span>
  </a></li>`;
}

/** The one block of solid colour on the site, and it sells the membership. */
function promoHTML(user) {
  return `
  <section class="promo">
    <p class="hand promo-aside">nobody else prints the losses</p>
    <h2>Members see every call the moment it goes up.</h2>
    <p>The analysis stays free. Membership adds the call itself on every match we cover: the
       market, the side, the price and the bookmaker offering it.</p>
    <a class="btn btn-light" href="#/pricing">${user ? 'See what membership costs' : 'Become a member'}</a>
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
   * The slip follows the board until its first leg kicks off, then it is a
   * record. Saying when that is, and counting down to it, is the difference
   * between "a slip" and "the slip, and you have forty minutes".
   */
  const first = Number(cur.first_kickoff) || 0;
  const lock = !first ? ''
    : first <= Date.now() / 1000
      ? `<p class="slip-lock live"><i></i>Locked. The first leg is under way.</p>`
      : `<p class="slip-lock">Locks in <b data-countdown="${first}" data-done="a moment">—</b></p>`;
  /*
   * Each leg, as it stands. The board rows carry the running score and, once
   * a match is over, the record's grade, so a member watching the slip sees
   * every leg move: on track, not yet, landed, missed.
   */
  const byId = new Map(fixtures.map((f) => [Number(f.id), f]));
  const GRADE = { WON: 'won', LOST: 'lost', HALF_WON: 'part', HALF_LOST: 'part', PUSH: 'back', VOID: 'back' };
  const MARK = { won: 'Landed', lost: 'Missed', back: 'Void', part: 'Half' };
  const legState = (l) => {
    const f = byId.get(Number(l.fixture_id));
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
  <section class="panel slip">
    <p class="panel-head">Today's bet slip <a href="#/slip">Every slip</a></p>
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
      text: `${t ? (t.on ? 'On track: ' : 'Not yet: ') : ''}${f.home} ${sc ? `${sc[0]}–${sc[1]}` : 'v'} ${f.away}` });
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
    const t = new Date(f.kickoff * 1000).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
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

/** The slip, and every settled slip before it. */
async function viewSlip() {
  placeholder(skeletonHTML());
  let data;
  let board = null;
  // The board rides along so each leg can show how its match stands.
  try { [data, board] = await Promise.all([getJSON('/api/slip'), loadBoard().catch(() => null)]); }
  catch (err) { return errorState(err); }
  const tone = (r) => (r === 'WON' ? 'won' : r === 'LOST' ? 'lost' : 'back');
  const recent = data?.recent ?? [];
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
            <span class="side-meta"><span class="side-league">${esc(f.league ?? '')}</span><b>${sc ? `${sc[0]}–${sc[1]}` : 'under way'}</b>${
              f.live_minute != null ? `<span class="minute">${esc(f.live_minute)}'</span>` : ''}${trackHTML(liveTrack(f.top_pick, f))}</span>
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
  const time = k.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
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

  return `
  <a class="row is-${state.kind}${played ? ' is-played' : ''}${terse ? ' is-terse' : ''}" href="#/fixture/${encodeURIComponent(f.id)}"
     aria-label="${esc(f.home)} versus ${esc(f.away)}">
    <div class="row-when">
      ${state.kind === 'upcoming'
        ? `<span class="row-time">${esc(time)}</span><span class="row-day">${esc(day)}</span>`
        // On a match in progress the bare time reads as the clock -- "LIVE
        // 12:00" looks like the twelfth minute of the second half. It is the
        // kick-off, so it says so, in the shorthand every football page uses.
        // The day matters here too: the board reaches back past midnight, so
        // "ko 16:30" alone cannot tell yesterday's game from this
        // afternoon's.
        : `<span class="row-time">${liveBadge(state)}</span><span class="row-day">${
            state.kind === 'live' && f.live_minute != null
              ? `<span class="minute">${esc(f.live_minute)}'</span>`
              : `${day === 'Today' ? '' : `${esc(day)} · `}ko ${esc(time)}`}</span>`}
    </div>

    <div class="row-teams">
      <span class="row-side">${crest(f.home, 'sm', f.home_id)}<span>${esc(f.home)}</span>${
        shown ? `<b class="row-goals${shown[0] > shown[1] ? ' won' : ''}">${esc(shown[0])}</b>` : ''}</span>
      <span class="row-side">${crest(f.away, 'sm', f.away_id)}<span>${esc(f.away)}</span>${
        shown ? `<b class="row-goals${shown[1] > shown[0] ? ' won' : ''}">${esc(shown[1])}</b>` : ''}</span>
    </div>

    ${d ? `<div class="row-call">
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
        : pick && p && track ? `
        ${trackHTML(track)}<span class="odds-book">at ${oddsOf(p.odds)}</span>`
        : pick && p ? `
        <span class="odds-tile${p.local ? '' : ' away'}"><span class="odds">${showOdds(p.odds)}</span><span class="odds-unit">odds</span></span>
        <span class="odds-book">${pick.lean ? 'lean, ' : ''}${esc(p.book)}</span>`
        : f.locked ? `<span class="row-locked-mark">
                        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10V7a5 5 0 0 1 10 0v3"/><rect x="4" y="10" width="16" height="10" rx="2"/></svg>
                        Members</span>`
        : `<span class="row-pass">No pick</span>`}
    </div>
  </a>`;
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

async function viewHome() {
  placeholder(heroHTML(state.hero, state.heroVenue) + skeletonHTML('rows'));
  // Everything the page needs, asked for at once. They used to go in three
  // rounds -- board and masthead, then the masthead's bundle, then the record
  // and the slip -- so a cold visit waited on three trips instead of one.
  const picksReq = getJSON('/api/picks?limit=40&settled=true').then((r) => r.picks ?? []).catch(() => []);
  const slipReq = getJSON('/api/slip').catch(() => null);
  let board;
  try {
    [board, state.hero] = await Promise.all([
      loadBoard(),
      getJSON('/api/hero').catch(() => null),
    ]);
    // The hero endpoint carries the fixture id and little else. The bundle
    // behind it has the table, the form and the head-to-head, none of which is
    // behind the wall, and all of which the masthead was leaving on the floor.
    state.heroDetail = state.hero?.fixture_id
      ? await getJSON(`/api/fixture/${state.hero.fixture_id}`).catch(() => null)
      : null;
  } catch (err) {
    return errorState(err);
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

  const rail = () => fixtures.filter((f) => hasCall(f) && f.id !== state.hero?.fixture_id);
  // The free call's row, flagged by the board itself.
  const freeFx = fixtures.find((f) => f.free_call && f.top_pick) ?? null;
  app.innerHTML =
    `<div data-live="ticker">${tickerHTML(fixtures, recent)}</div>` +
    heroHTML(state.hero, state.heroVenue, state.heroDetail, freeFx) +
    `<div data-live="today">${todayStripHTML(fixtures, recent)}</div>` +
    `<div data-live="mine">${yourGamesHTML(fixtures)}</div>` +
    `<div data-live="rail">${nextRailHTML(rail())}</div>` +
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
             ${playedHTML(settled.slice(0, 8))}
           </div>
         </div>
         ${sideHTML(fixtures, slip)}
       </div>
     </div>`;

  paintTally(fixtures, recent);
  tickCountdowns();

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
  // The filters live in the URL, so a filtered board survives a reload and can
  // be sent to someone. They used to live only in `state`, which meant the one
  // thing a reader would want to share -- "the La Liga card for the next two
  // days" -- was the one thing they could not.
  const hours = Number(params.get('hours'));
  if ([24, 48, 72, 120, 240].includes(hours)) state.hours = hours;
  else if (params.has('hours')) state.hours = 72;
  if (params.has('league')) state.leagueName = params.get('league');
  if (params.has('when')) {
    const w = params.get('when');
    state.when = WHEN.some((x) => x.id === w) ? w : 'upcoming';
  }

  app.innerHTML = `<div class="wrap section dense">
    <div class="rows">${'<div class="skeleton skeleton-row"></div>'.repeat(8)}</div>
  </div>`;
  let board;
  try { board = await loadBoard(); } catch (err) {
    return errorState(err);
    return;
  }
  // Calls only. See hasCall.
  const fixtures = (board.fixtures ?? []).filter(hasCall);
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
  const counts = { upcoming: 0, live: 0, played: 0 };
  for (const f of fixtures) counts[whenOf(f)]++;

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
  if (!params.has('when')) {
    const holds = (when) => fixtures.filter((f) =>
      whenOf(f) === when
      && (!state.leagueName || f.league === state.leagueName)).length;
    const order = ['upcoming', 'live', 'played'];
    state.when = order.find(holds)
      ?? order.find((w) => counts[w])
      ?? 'upcoming';
  } else if (!counts[state.when]) {
    state.when = counts.upcoming ? 'upcoming' : counts.live ? 'live' : 'played';
  }

  const kickoffs = fixtures.map((f) => f.kickoff).filter(Boolean);
  const furthest = kickoffs.length ? Math.max(...kickoffs) : null;
  const capped = furthest !== null && furthest < Date.now() / 1000 + (state.hours - 6) * 3600;

  app.innerHTML = `
  <div class="wrap section dense">
    <div class="section-head">
      <div>
        <h1 class="display">The board</h1>
        <!-- Written by paint(), from what is actually on screen. See ledeFor. -->
        <p id="board-lede"></p>
      </div>
      <div class="filters">
        <!--
          The board's primary axis is time, not whether we fancied it.
          "With a call / Everything" was in this slot and it answered a
          question nobody arrives with; what a reader wants first is today's
          games, what is on right now, and what has already finished. That was
          the one thing the board could not do: everything played dropped off
          after six hours, so by the evening the page could say what was coming
          and not what had happened.
        -->
        <div class="seg" role="group" aria-label="When">
          ${WHEN.map((w) => `
            <button type="button" data-when="${w.id}"${state.when === w.id ? ' class="on"' : ''}
              ${counts[w.id] ? '' : 'disabled'}>${esc(w.label)} <i>${counts[w.id]}</i></button>`).join('')}
        </div>
        <select id="hours-filter" aria-label="Time window">
          ${[24, 48, 72, 120, 240].map((h) => `<option value="${h}"${h === state.hours ? ' selected' : ''}>Next ${h}h</option>`).join('')}
        </select>
        <select id="league-filter" aria-label="League">
          <option value="">All leagues</option>
          ${leagues.map((l) => `<option${l === state.leagueName ? ' selected' : ''}>${esc(l)}</option>`).join('')}
        </select>
      </div>
    </div>
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
    // Every row is a call now, so this counts calls and nothing else.
    const n = inTab.length;
    const calls = n === 1 ? 'One call' : `${n} calls`;
    const where = state.leagueName ? ` in ${state.leagueName}` : '';
    if (!n) return '';

    if (state.when === 'live') return `${calls}${where} on matches being played right now.`;

    if (state.when === 'played') {
      // Counted from the record's grade, the same one the results page prints.
      const GRADE = { WON: 'won', HALF_WON: 'won', LOST: 'lost', HALF_LOST: 'lost' };
      let landed = 0;
      let judged = 0;
      for (const f of inTab) {
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
      return `${calls}${where} on matches already played.${judged ? ` ${landed} of ${judged} landed.` : ''}`;
    }

    const next = inTab.map((f) => f.kickoff).filter(Boolean);
    const last = next.length ? Math.max(...next) : null;
    return `${calls}${where} on matches still to play.${
      last ? ` The last of them kicks off ${dayLabel(last).toLowerCase()}.` : ''}`;
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

    const groups = new Map();
    for (const f of shown) {
      const key = f.league ?? 'Other';
      if (!groups.has(key)) groups.set(key, { id: f.league_id, list: [] });
      groups.get(key).list.push(f);
    }
    for (const g of groups.values()) g.list.sort(order);

    // And the competitions themselves lead with whoever is on next.
    const groupsSorted = [...groups.entries()].sort((a, b) => order(a[1].list[0], b[1].list[0]));

    document.getElementById('grid').innerHTML =
      shown.length
        ? groupsSorted.map(([name, g]) => `
            <section class="league-block">
              <h3 class="league-head">
                ${g.id ? `<a href="#/league/${encodeURIComponent(g.id)}">${crest(name, 'xs', g.id, 'league')}${esc(name)}</a>`
                       : `${crest(name, 'xs', g.id, 'league')}${esc(name)}`}
                <span class="count">${g.list.length}</span>
              </h3>
              ${g.list.map(rowHTML).join('')}
            </section>`).join('')
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

  for (const b of app.querySelectorAll('.seg button')) {
    b.onclick = () => {
      state.when = b.dataset.when;
      history.replaceState(null, '', boardHash());
      for (const o of app.querySelectorAll('.seg button')) o.classList.toggle('on', o === b);
      paint();
    };
  }
  // A longer window needs the board fetched again, so it goes through the
  // router. A league is a filter over what is already here, so it repaints in
  // place and only rewrites the address -- replaceState does not fire
  // hashchange, which is what keeps that from turning into a second render.
  document.getElementById('hours-filter').onchange = (e) => {
    location.hash = boardHash(Number(e.target.value), state.leagueName);
  };
  document.getElementById('league-filter').onchange = (e) => {
    state.leagueName = e.target.value;
    history.replaceState(null, '', boardHash());
    paint();
  };
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
      for (const k of Object.keys(counts)) counts[k] = 0;
      for (const f of fixtures) counts[whenOf(f)]++;
      for (const b of app.querySelectorAll('.seg button')) {
        const i = b.querySelector('i');
        if (i) i.textContent = counts[b.dataset.when] ?? 0;
        b.disabled = !counts[b.dataset.when];
      }
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
  const n = Number(fixture?.locked_calls) || 0;
  const tie = fixture?.home && fixture?.away
    ? `${fixture.home} v ${fixture.away}`
    : 'this match';
  // Name the match and say how many calls are on it. A wall that states what
  // it is holding is a different proposition from one that states only that it
  // is shut, and the count gives nothing away: no market, no side, no price.
  const head = n > 1
    ? `${n} calls on ${tie}.`
    : `Our call on ${tie}.`;

  return `
  <div class="locked">
    <div class="locked-body">
      <b>${esc(head)}</b>
      <p>Which market, which side, the odds and the book offering it. The reading above
         is free; one call a day is free too, on the front page. This one is for members.</p>
    </div>
    <a class="btn btn-accent" href="#/pricing" data-public-price>From £3.49 for the weekend</a>
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
  <div class="verdict${landed ? ` settled ${landed}` : ''}">
    <div class="verdict-head">
      <span class="sel">${esc(d.name)}</span>
      ${landed
        ? `<span class="mark ${landed}">${esc(VERDICT_WORD[landed] ?? '')}</span>`
        : `<span class="price">${showOdds(odds)}<small>odds</small></span>`}
    </div>
    ${landed
      ? `<p class="wins">${esc(story ?? d.wins)}</p>`
      : `<p class="wins">${esc(d.wins)}</p>`}
    ${track ? `<p class="track-line">${trackHTML(track)} It is ${esc(track.score)} as things stand${
        track.on ? ', which is what we need.' : ', so this one still has work to do.'}</p>` : ''}
    ${prose ? `<p class="narrative">${link(esc(prose))}</p>` : ''}
    ${why ? `<div class="why"><p class="why-head">Why this call</p><p>${link(esc(why))}</p></div>` : ''}
    ${played && (prose || why) ? `<p class="aside">Written before kick-off, and left as it was.</p>` : ''}
    <div class="verdict-meta">
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
        m.assists ? `<i class="tl-assist" title="${m.assists} assist${m.assists === 1 ? '' : 's'}">${m.assists > 1 ? m.assists : ''}A</i>` : '',
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
    const marks = [
      m.goals + m.own ? `<i class="pp-goal" title="${m.goals + m.own} goal${m.goals + m.own === 1 ? '' : 's'}">${m.goals + m.own > 1 ? m.goals + m.own : ''}</i>` : '',
      m.card ? `<i class="pp-card ${m.card}" title="${m.card === 'yellow' ? 'Booked' : 'Sent off'}"></i>` : '',
      m.off ? `<i class="pp-off" title="Went off ${esc(minuteOf(m.off))}"></i>` : '',
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
    ${report ? `<p class="lineup-key"><span><i class="pp-goal"></i> goal</span><span><i class="pp-card yellow"></i> booked</span><span><i class="pp-card red"></i> sent off</span><span><i class="pp-off"></i> went off</span><span><b class="pp-rating good">7.2</b> rating</span></p>` : ''}
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
};

/** How a rating reads: the colour says it before the number does. */
const ratingClass = (r) => (r >= 8 ? 'top' : r >= 7 ? 'good' : r < 6 ? 'poor' : '');

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
function reportHTML(f) {
  const r = f?.report;
  if (!r) return '';
  const events = (r.events ?? []).filter((e) => e && (e.t === 'goal' || e.t === 'card' || e.t === 'sub'));
  const st = r.stats;
  const hl = (r.highlights ?? []).find((h) => h?.url) ?? null;
  if (!events.length && !st && !hl) return '';

  const line = (e) => {
    if (e.t === 'goal') {
      const kind = /own/i.test(e.kind ?? '') ? '<small>own goal</small>' : /pen/i.test(e.kind ?? '') ? '<small>penalty</small>' : '';
      return `${/own/i.test(e.kind ?? '') ? EV_ICON.own : EV_ICON.goal}<b>${playerLink(e.player_id, e.player ?? 'Goal', f.league_id)}</b>${kind}${
        e.assist ? `<small>assist ${(f._link ?? ((h) => h))(esc(e.assist))}</small>` : ''}${
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
        e.assist ? `<small class="rep-assist">assist ${(f._link ?? ((h) => h))(esc(e.assist))}</small>` : ''}`;
      return `<li class="rep-goal ${e.side === 'away' ? 'away' : 'home'}">
        <span class="rg-who">${who}</span>
        <span class="rg-mid"><em>${esc(minuteOf(e))}</em>${e.score ? `<b>${esc(e.score[0])}–${esc(e.score[1])}</b>` : ''}</span>
      </li>`;
    }).join('')}</ol>` : '<p class="rep-none">No goals.</p>';
  const cardsFor = (side) => events.filter((e) => e.t === 'card' && (e.side === 'away' ? 'away' : 'home') === side)
    .map((e) => `<span class="rep-card">${EV_ICON[e.card] ?? EV_ICON.yellow}${esc(surname(e.player ?? ''))} ${esc(minuteOf(e))}</span>`).join('');
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
        ${events.map((e) => `<div class="ev ${e.side === 'away' ? 'away' : 'home'} is-${e.t}">
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
    <p class="panel-head">Match report${r.ht ? ` <span>Half time ${esc(r.ht[0])}–${esc(r.ht[1])}</span>` : ''}</p>
    ${events.length ? goalsHTML : ''}
    ${cardsHTML}
    ${timeline}
    ${numbers}
    ${hl ? `<a class="rep-highlights" href="${esc(hl.url)}" target="_blank" rel="noopener noreferrer">${
      hl.thumbnail ? `<img src="${esc(hl.thumbnail)}" alt="" loading="lazy" decoding="async">` : ''}<span>Watch the highlights</span></a>` : ''}
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

async function viewFixture(id, params = new URLSearchParams()) {
  placeholder(skeletonHTML());
  let f;
  try { f = await getJSON(`/api/fixture/${id}`); } catch {
    /*
     * A fixture we cannot show. The provider's message was printed raw --
     * "fixture not found or not yet analysed" -- under a Back button and
     * nothing else, which tells a reader what our database thinks rather than
     * what to do next. Both of those are true and only one is useful.
     */
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
    f.neutral ? 'neutral ground' : null,
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
        ${reportHTML(f)}
        <div class="panel">
          <p class="panel-head">${callHead}</p>
          ${verdicts.length
            ? verdicts.map((v) => verdictHTML(v, f.home, f.away, f, { played, hg, ag })).join('')
              + (anyLocked ? lockedHTML(f) : '')
            // Older pass notes were written for us ("the 58.1 needed against a
            // 109.1% margin"); the gate withholds those and the plain line
            // stands in.
            : `<p class="narrative">${esc(cleanProse(f.pass) ?? 'Nothing here is worth a call. The bookmakers have it about right.')}</p>`}
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
        ${f.venue_id ? `<div class="panel venue" data-shot="yes">
          <p class="panel-head">The ground</p>
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
  const wash = homeC || awayC
    ? ` has-colors" style="--home-c:${homeC ?? 'transparent'};--away-c:${awayC ?? 'transparent'}`
    : '';

  app.innerHTML = `
  <section class="hero fx-top${wash}" data-shot="${f.venue_id ? 'yes' : 'none'}">
    <div class="hero-media">${venueShot(f.venue_id, '', true)}</div>
    ${wash ? '<div class="fx-wash" aria-hidden="true"></div>' : ''}
    <div class="wrap hero-inner">
      ${backHTML('Back to the board')}
      <div class="hero-copy">
        <span class="timechip${isSoon(f.kickoff) ? ' soon' : ''}">${esc(kickoffLabel(f.kickoff))}</span>
        ${st.kind === 'upcoming' ? '' : liveBadge(st)}${st.kind === 'live' && f.live_minute != null ? `<span class="minute">${esc(f.live_minute)}'</span>` : ''}
        <h1 class="fx-stack${shown ? ' scored' : ''}">
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
        </h1>
        <p class="hero-blurb">${f.league && f.league_id
          ? `<a class="league-link" href="#/league/${encodeURIComponent(f.league_id)}">${esc(f.league)}</a>${meta.slice(1).length ? `, ${esc(meta.slice(1).join(', '))}` : ''}`
          : esc([f.league, ...meta.slice(1)].filter(Boolean).join(', '))}</p>
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
  if (st.kind === 'live') {
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

async function viewResults() {
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
    return errorState(err);
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

  return `
  <div class="pm is-${esc(pm.landed)}">
    <p class="pm-line">${esc(String(pm.line).replace('One goal in it. Right, but there was nothing spare.', 'One goal the other way and it was gone. Right, with nothing to spare.'))}</p>
    ${facts.length ? `<p class="pm-facts">${facts.map((f) => `<span>${esc(f)}</span>`).join('')}</p>` : ''}
  </div>`;
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
  app.innerHTML = `<div class="wrap section dense">
    <div class="rows">${'<div class="skeleton skeleton-row"></div>'.repeat(8)}</div>
  </div>`;
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

  app.innerHTML = `
  <div class="wrap section dense">
    <div class="page-head">
      <h1 class="display xl">Leagues</h1>
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
  placeholder(skeletonHTML('rows'));
  let d;
  try { d = await getJSON(`/api/league/${encodeURIComponent(id)}`); } catch (err) { return errorState(err); }
  const lg = d?.league;
  if (!lg?.id) return notFound('league');

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
  const gamesHTML = ahead.length ? [...byDay.entries()].map(([day, list]) => `
    <section class="league-block">
      <h3 class="league-head">${esc(day)} <span class="count">${list.length}</span></h3>
      ${list.map(rowHTML).join('')}
    </section>`).join('') : '';

  const resultsHTML = played.length ? `
    <section class="league-block">
      <h3 class="league-head">Played <span class="count">${played.length}</span></h3>
      ${played.map(rowHTML).join('')}
    </section>` : '';

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
    ahead.length ? `${ahead.length} game${ahead.length === 1 ? '' : 's'} coming up` : null,
    calls ? `${calls} call${calls === 1 ? '' : 's'}` : null,
    live ? `${live} on now` : null,
  ].filter(Boolean).join('. ');

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
  placeholder(skeletonHTML());
  const league = Number(params.get('league')) || null;
  let d;
  try { d = await getJSON(`/api/player/${encodeURIComponent(id)}${league ? `?league=${league}` : ''}`); }
  catch (err) { return errorState(err); }
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
        if (m.assists) bits.push(`<i class="tl-assist">${m.assists > 1 ? m.assists : ''}A</i>`);
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
  if (!res.ok) throw new Error(data?.error ?? 'Something went wrong. Nothing has been charged.');
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
const goInstead = (hash) => location.replace(`${location.pathname}${location.search}${hash}`);

const INTENT_KEY = 'ow.after-signin';
const setIntent = (v) => { try { localStorage.setItem(INTENT_KEY, v); } catch { /* private mode */ } };
const takeIntent = () => {
  try {
    const v = localStorage.getItem(INTENT_KEY);
    localStorage.removeItem(INTENT_KEY);
    return v;
  } catch { return null; }
};

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
  if (intent === 'buy') {
    history.replaceState(null, '', `${location.pathname}#/pricing`);
    await route();
    await startCheckout();
    headerAuth();
    return;
  }
  history.replaceState(null, '', `${location.pathname}${intent && intent.startsWith('#/') ? intent : '#/home'}`);
  await route();
  headerAuth();
}

async function startCheckout(plan = 'monthly', row = null) {
  const button = document.querySelector(`[data-buy="${plan}"]`) ?? document.getElementById('buy');
  const was = button?.textContent;
  if (button) { button.disabled = true; button.textContent = 'Opening checkout…'; }
  try {
    /*
     * Signed in: through the Worker, which puts the account's email on the
     * checkout so the membership finds it. Signed out: straight to the plan's
     * own checkout, because a reader with a card out should not be sent to
     * find their inbox first -- the pricing page tells them to sign in with
     * the same email afterwards, and the entitlement waits for them.
     */
    if (await currentUser()) {
      const { link } = await postJSON('/api/pay/checkout', { plan });
      if (!link) throw new Error('The payment page could not be opened.');
      location.href = link;
      return;
    }
    if (row?.checkout_url) { location.href = row.checkout_url; return; }
    setIntent('buy');
    location.hash = '#/signin';
  } catch (err) {
    if (button) { button.disabled = false; button.textContent = was; }
    alert(err.message);
  }
}

/** Turn renewal on or off. Takes effect immediately, both ways. */
async function setRenewal(on) {
  try {
    await postJSON('/api/pay/renewal', { auto_renew: on });
    await viewAccount();
  } catch (err) {
    alert(err.message);
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
async function viewPricing() {
  placeholder(skeletonHTML());
  const [user, plans, hero] = await Promise.all([
    currentUser(),
    getJSON('/api/plans').catch(() => []),
    getJSON('/api/hero').catch(() => null),
  ]);
  // The free call is its own fixture, chosen by the slate: not the headline
  // match. Pointing this line at the headline sent readers to a locked call
  // under a label that said it was free.
  const freeId = hero?.free_fixture_id;
  const free = freeId ? await getJSON(`/api/fixture/${encodeURIComponent(freeId)}`).catch(() => null) : null;
  const money = (minor, cur) => new Intl.NumberFormat('en-GB', { style: 'currency', currency: cur || 'GBP', minimumFractionDigits: minor % 100 ? 2 : 0 }).format(minor / 100);
  const byId = Object.fromEntries((plans ?? []).map((p) => [p.id, p]));
  const order = ['matchday', 'monthly', 'season'].filter((id) => byId[id]);

  /*
   * What each plan is, in the reader's words.
   *
   * A matchday pass is one payment for a weekend and stops. The month and the
   * season ticket renew until cancelled, because that is how the processor
   * sells a subscription and a reader has to be told so before, not after.
   */
  const COPY = {
    matchday: { blurb: 'A weekend of every call. One payment, seven days, and it stops.', renews: false, tag: null },
    monthly:  { blurb: 'All the calls, all month. Renews each month until you cancel.', renews: true, tag: 'Most take this' },
    season:   { blurb: 'The whole season for less than half the monthly price.', renews: true, tag: 'Best value' },
  };
  const perMonth = (p) => p.days >= 300 ? money(Math.round(p.amount_minor / 12), p.currency) + ' a month' : null;

  app.innerHTML = `
  <div class="wrap section">
    <div class="page-head">
      <h1 class="display xl">One call a day is free. Members get all of them.</h1>
      <p class="page-sub">Every preview, every team sheet and the whole record stay free. Membership is
        every open call the moment it goes up, the legs of the bet slip, and the reason behind each call.</p>
    </div>

    ${freeLineHTML(free)}

    <div class="plans" data-public-price>
      ${order.map((id) => {
        const p = byId[id];
        const c = COPY[id];
        return `
        <section class="plan${id === 'monthly' ? ' plan-main' : ''}">
          ${c.tag ? `<span class="plan-tagline">${esc(c.tag)}</span>` : ''}
          <h2>${esc(p.name)}</h2>
          <p class="plan-price"><b>${esc(money(p.amount_minor, p.currency))}</b>
            <span>${p.days === 7 ? 'for the week' : p.days >= 300 ? 'a year' : 'a month'}</span></p>
          ${perMonth(p) ? `<p class="plan-per">${esc(perMonth(p))}</p>` : ''}
          <p class="plan-blurb">${esc(c.blurb)}</p>
          <button class="btn ${id === 'monthly' ? 'btn-accent' : 'btn-primary'} btn-lg" data-buy="${esc(id)}">
            ${p.days === 7 ? 'Get the weekend' : p.days >= 300 ? 'Get the season' : 'Join for the month'}
          </button>
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
          <li><b>Every open call</b> the moment it goes up, typically twenty to sixty a day</li>
          <li><b>The bet slip's legs</b>, before the first one kicks off</li>
          <li><b>Why this call</b> on every match: the argument for this market at these odds</li>
          <li>The board's filters by league and by day</li>
        </ul>
      </section>
    </div>

    <div class="prose pricing-small">
      <p><b>Paying and signing in.</b> Payment is taken by Whop. Use the same email address there as you
        use to sign in here. That is how your membership finds you. Nothing else is needed.</p>
      <p><b>Changed your mind?</b> Fourteen days, full refund, whatever you have read.
        <a href="#/legal/refunds">How refunds work</a>. Cancel a renewing plan from your Whop account in one tap;
        you keep access to the end of what you paid for.</p>
      <p>It is not tipping and it is not advice to place a bet. We publish what we think will happen and why,
        and the record of how that has gone, including when it has gone badly.
        <a href="#/results">The record is public</a> and always will be. Nothing here is a promise of profit.
        18+. <a href="#/legal/responsible">If gambling has stopped being fun</a>, that page is more use than
        any call on this site.</p>
    </div>
  </div>`;

  for (const b of app.querySelectorAll('[data-buy]')) {
    b.onclick = () => startCheckout(b.dataset.buy, byId[b.dataset.buy]);
  }
}

/** Sign in. One email box and one button, because that is the whole of it. */
async function viewSignin() {
  if (await currentUser()) { goInstead('#/account'); return; }

  const problem = state.authError;
  state.authError = null;

  // Read without consuming: the intent is spent when the sign-in completes,
  // not when the page renders. Saying it out loud is the difference between
  // "why am I being asked for my email" and "yes, that is what I was doing".
  let intent = null;
  try { intent = localStorage.getItem(INTENT_KEY); } catch { /* private mode */ }
  const because = intent === 'buy'
    ? 'Sign in first and your membership will be waiting when you come back.'
    : intent === '#/account'
      ? 'Your account is behind this.'
      : 'Your calls follow you, your slip is yours, and there is nothing to remember.';

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
        <!-- Google's own button, drawn here by renderGoogleButton; it signs in
             on offside.win, so Google's window names this site. The button
             below is the fallback, shown only if Google's script cannot load. -->
        <div class="gsi-slot" id="google-slot" aria-live="polite"></div>
        <button class="btn btn-primary btn-lg btn-google" id="google" hidden>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.9h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.8 3-4.3 3-7.4z" fill="#4285F4"/><path d="M12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.5c-.9.6-2 1-3.4 1-2.6 0-4.8-1.8-5.6-4.1H3.1v2.6A10 10 0 0 0 12 22z" fill="#34A853"/><path d="M6.4 14a6 6 0 0 1 0-3.9V7.5H3.1a10 10 0 0 0 0 9z" fill="#FBBC05"/><path d="M12 6c1.5 0 2.8.5 3.8 1.5l2.8-2.8A10 10 0 0 0 3.1 7.5l3.3 2.6C7.2 7.8 9.4 6 12 6z" fill="#EA4335"/></svg>
          Continue with Google
        </button>
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

  document.getElementById('google').onclick = async (e) => {
    e.currentTarget.disabled = true;
    try { await signInWithGoogle(); } catch (err) { say(humanise(err), true); e.currentTarget.disabled = false; }
  };
  const slot = document.getElementById('google-slot');
  renderGoogleButton(slot, {
    onSignedIn: afterSignIn,
    onError: (err) => say(humanise(err), true),
  }).then((drawn) => {
    if (drawn) return;
    slot.remove();
    document.getElementById('google').hidden = false;
  });

  document.getElementById('magic').onsubmit = async (e) => {
    e.preventDefault();
    const email = document.getElementById('email').value.trim();
    if (!email) return say('Put your email address in first.', true);
    const button = e.currentTarget.querySelector('button');
    button.disabled = true;
    say('Sending…');
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
      say(humanise(err), true);
      button.disabled = false;
    }
  };
}

const PLAN_NAME = { matchday: 'Matchday pass', monthly: 'Monthly membership', season: 'Season ticket' };

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

/** A face for the account: Google's picture where there is one, else initials. */
function avatarHTML(user, name, size = 'md') {
  const label = name || user?.email || '';
  if (user?.avatar) {
    return `<span class="avatar avatar-${size}"><img src="${esc(user.avatar)}" alt="" referrerpolicy="no-referrer"
      onerror="this.parentNode.classList.add('noimg');this.remove()"><i>${esc(initials(label))}</i></span>`;
  }
  return `<span class="avatar avatar-${size} noimg"><i>${esc(initials(label))}</i></span>`;
}

/** The name to call someone by: what they saved, else what Google said, else their email's first part. */
function accountName(user, profile) {
  return profile?.display_name || user?.name || String(user?.email ?? '').split('@')[0] || 'Your account';
}

async function viewAccount() {
  const user = await currentUser();
  if (!user) { setIntent('#/account'); goInstead('#/signin'); return; }

  placeholder(skeletonHTML());
  let account = { membership: null, receipts: [], profile: null, follows: [] };
  try { account = await getJSON('/api/account'); } catch { /* shown as a fresh account */ }
  state.account = account;
  if (account.profile?.odds_format && account.profile.odds_format !== oddsFormat) setOddsFormat(account.profile.odds_format);

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
  const open = ACCOUNT_TABS.some(([k]) => k === asked) ? asked : 'profile';

  const follows = Array.isArray(account.follows) ? account.follows : [];

  // --- profile
  const profileHTML = `
    <form class="acct-form" id="profile-form" novalidate>
      <label for="display-name">Your name</label>
      <input id="display-name" name="name" type="text" maxlength="60" autocomplete="name"
             value="${esc(account.profile?.display_name ?? user.name ?? '')}" placeholder="What should we call you?">
      <p class="acct-hint">Used to greet you on the front page. Nobody else sees it.</p>
      <div class="acct-actions"><button class="btn btn-primary" type="submit">Save name</button><span class="acct-note" id="profile-note" role="status"></span></div>
    </form>
    <dl class="acct-facts">
      <div><dt>Email</dt><dd>${esc(user.email ?? '')}</dd></div>
      <div><dt>Sign-in</dt><dd>${esc(how)}. There is no password to forget.</dd></div>
      ${since ? `<div><dt>Joined</dt><dd>${esc(since)}</dd></div>` : ''}
    </dl>`;

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
              ? `<span>Renews through Whop</span><a class="btn btn-ghost btn-sm" href="https://whop.com/" target="_blank" rel="noopener">Manage on Whop</a>`
              : m.card_brand === 'complimentary'
                ? `<span>Complimentary</span>`
                : m.auto_renew
                  ? `<span>Renews ${m.card_last4 ? `on ${esc(m.card_brand ?? 'card')} ending ${esc(m.card_last4)}` : 'itself'}</span><button class="btn btn-quiet btn-sm" id="cancel">Stop renewing</button>`
                  : `<span>Does not renew</span><button class="btn btn-primary btn-sm" id="resume">Renew each month</button>`)
          : `<a class="btn btn-accent" href="#/pricing">See the plans</a>`}
      </div>
    </section>
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

  app.innerHTML = `
  <div class="wrap section narrow account">
    <div class="acct-head">
      ${avatarHTML(user, name, 'lg')}
      <div class="acct-who">
        <h1 class="display">${esc(name)}</h1>
        <p>${esc(user.email ?? '')}</p>
        <a class="acct-plan${active ? ' on' : ''}" href="#/account?tab=membership">${active
          ? `Member until ${esc(when(m.expires_at))}` : 'Free account'}</a>
      </div>
    </div>
    <div class="tabs" role="tablist">
      ${ACCOUNT_TABS.map(([k, label]) => `<button class="tab${k === open ? ' on' : ''}" data-tab="${k}" role="tab" aria-selected="${k === open}">${esc(label)}</button>`).join('')}
    </div>
    ${ACCOUNT_TABS.map(([k]) => `<div class="tabpane acct-pane" data-pane="${k}"${k === open ? '' : ' hidden'}>${panes[k]}</div>`).join('')}
  </div>`;

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
      const saved = await accountRpc('save_profile', { p_name: document.getElementById('display-name').value, p_odds: oddsFormat });
      account.profile = saved;
      note('profile-note', 'Saved');
      const n = accountName(user, saved);
      app.querySelector('.acct-who h1').textContent = n;
      headerAuth();
    } catch (err) {
      note('profile-note', humaneError(err), true);
    }
    button.disabled = false;
  };

  // Odds format: saved the moment it is picked.
  for (const r of app.querySelectorAll('input[name="odds"]')) {
    r.onchange = async () => {
      setOddsFormat(r.value);
      note('odds-note', 'Saving…');
      try {
        account.profile = await accountRpc('save_profile', { p_name: account.profile?.display_name ?? user.name ?? '', p_odds: r.value });
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
  const leave = async (everywhere) => {
    await signOut({ everywhere });
    cacheClear();
    state.member = null;
    state.board = null;
    state.account = null;
    location.hash = '#/home';
    await route();
    headerAuth();
  };
  document.getElementById('out').onclick = () => leave(false);
  document.getElementById('out-all').onclick = () => leave(true);

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
  if (cancel) cancel.onclick = () => setRenewal(false);
  const resume = document.getElementById('resume');
  if (resume) resume.onclick = () => setRenewal(true);
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
async function viewDev() {
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

function viewLegal(which) {
  const page = LEGAL[which];
  if (!page) return notFound(`legal/${which}`);
  /*
   * On the cookie page the choice itself, with what it currently is. A
   * policy that tells a reader they can change their mind should let them
   * change it where they are reading that.
   */
  const choice = which === 'cookies' ? (() => {
    const now = readConsent();
    const gpc = !!navigator.globalPrivacyControl;
    const said = now === 'accepted' ? 'You said yes.' : now === 'declined'
      ? (gpc && !(() => { try { return localStorage.getItem(CONSENT_KEY); } catch { return null; } })()
          ? 'Your browser sends the Global Privacy Control signal, so this is set to no.'
          : 'You said no.')
      : 'You have not answered yet.';
    return `
    <section class="panel consent-panel" aria-labelledby="consent-h">
      <p class="panel-head" id="consent-h">Your choice</p>
      <p>${esc(said)} Saved pages and visit counting are ${now === 'accepted' ? 'on' : 'off'}.</p>
      <div class="cta-row">
        <button class="btn ${now === 'accepted' ? 'btn-ghost' : 'btn-primary'}" data-consent-set="accepted"${now === 'accepted' ? ' disabled' : ''}>Turn them on</button>
        <button class="btn ${now === 'accepted' ? 'btn-primary' : 'btn-ghost'}" data-consent-set="declined"${now === 'declined' ? ' disabled' : ''}>Turn them off</button>
      </div>
    </section>`;
  })() : '';
  app.innerHTML = `
  <div class="wrap section">
    <div class="section-head"><div><h1 class="display">${esc(page.title)}</h1>
      <p>Last updated ${esc(UPDATED)}.</p></div></div>
    <div class="prose">${page.body}</div>
    ${choice}
  </div>`;
  for (const b of app.querySelectorAll('[data-consent-set]')) b.onclick = () => applyConsent(b.dataset.consentSet);
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
const consented = () => readConsent() === 'accepted';

function applyConsent(value) {
  try { localStorage.setItem(CONSENT_KEY, value); } catch { /* private mode: ask again next visit */ }
  document.getElementById('cookie-notice')?.remove();
  document.body.style.paddingBottom = '';
  if (value === 'accepted') countView();
  // A no removes what a yes stored.
  else cacheClear({ keepMemory: true });
  // The cookie policy shows the current choice; redraw it if it is open.
  if (parseHash().parts[0] === 'legal') route({ soft: true });
}

/** One anonymous page view, if and only if the reader said yes. */
function countView() {
  if (!consented()) return;
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
 * On a wide screen the notice floats bottom-right, where it can still sit over
 * the last thing in the footer, so its height is reserved at the foot of the
 * document. Measured rather than guessed, because it wraps to two or three
 * lines depending on width.
 *
 * On a phone it does not float at all -- see `.cookie` in components.css --
 * so there is nothing to reserve and the style is cleared. That is the actual
 * fix for the pricing page, where a floating notice sat on top of the button
 * that takes the money: `elementFromPoint` on Buy returned the notice, so the
 * tap went to the notice and nothing happened. A buyer with a card out,
 * tapping a dead target.
 */
function reserveForNotice() {
  const el = document.getElementById('cookie-notice');
  if (!el) { document.body.style.paddingBottom = ''; return; }
  if (getComputedStyle(el).position !== 'fixed') { document.body.style.paddingBottom = ''; return; }
  const gap = el.getBoundingClientRect().height + 24;
  document.body.style.paddingBottom = `${Math.ceil(gap)}px`;
}

function cookieNotice({ force = false } = {}) {
  if (readConsent() && !force) return;
  document.getElementById('cookie-notice')?.remove();
  const el = document.createElement('div');
  el.className = 'cookie';
  el.id = 'cookie-notice';
  el.setAttribute('role', 'region');
  el.setAttribute('aria-label', 'Cookie choice');
  el.innerHTML = `
    <p>Say yes and we count visits anonymously and keep a copy of pages on this
       device so they open instantly. Say no and we do neither.
       <a href="#/legal/cookies">What we store</a></p>
    <button class="btn btn-ghost btn-sm" data-consent="declined">No thanks</button>
    <button class="btn btn-primary btn-sm" data-consent="accepted">Yes, that's fine</button>`;
  el.addEventListener('click', (e) => {
    const v = e.target?.dataset?.consent;
    if (v) applyConsent(v);
  });
  /*
   * In the document, above the page, rather than appended to the end of the
   * body. Where it floats (wide screens) the position in the DOM makes no
   * difference; where it does not (phones) it has to be in the flow, and it
   * has to be somewhere a reader will actually see it. Directly under the
   * header is both.
   */
  document.body.insertBefore(el, app);
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
function errorState(err) {
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

/** An address that is not one of ours. Say so, and offer the two ways out. */
function notFound(name) {
  app.innerHTML = `
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
let navByLink = false;
document.addEventListener('click', (e) => {
  const a = e.target.closest?.('a[href^="#/"]');
  if (a && !e.defaultPrevented && e.button === 0 && !e.metaKey && !e.ctrlKey) navByLink = true;
}, true);

/*
 * The placeholder a view shows while it waits. Skipped on a soft redraw,
 * where the page already has content and swapping it for a skeleton for one
 * frame is exactly the flash this is meant to remove.
 */
function placeholder(html) {
  if (!state.soft) app.innerHTML = html;
}

async function route({ soft = false } = {}) {
  const { parts, params } = parseHash();
  const name = parts[0] || 'home';
  const here = location.hash || '#/home';
  const keepY = window.scrollY;
  state.soft = soft;
  if (!soft) {
    // Set after the first render, so the first route of a session -- the
    // deep link itself -- does not count as somewhere to go back to.
    state.cameFromInApp = routed++ > 0;
    if (state.here) scrollMemory.set(state.here, keepY);
    state.here = here;
  }
  const backTo = !soft && !navByLink ? scrollMemory.get(here) : undefined;
  navByLink = false;
  clearInterval(state.tick);
  clearInterval(state.poll);
  if (state.onVisible) { removeEventListener('visibilitychange', state.onVisible); state.onVisible = null; }
  for (const a of document.querySelectorAll('.nav a')) a.classList.toggle('on', a.dataset.route === name);
  if (!soft) {
    document.getElementById('nav').classList.remove('open');
    document.getElementById('burger').setAttribute('aria-expanded', 'false');
    window.scrollTo(0, 0);
  }
  try {
    await render(name, parts, params);
  } catch (err) {
    errorState(err);
  } finally {
    if (!soft) countView();
    state.soft = false;
    smartQuotes(app);
    // After the content is in, so the position is measured against the real
    // page rather than a skeleton. A view that asked for an element in view
    // (a highlighted scorer) gets it, centred.
    const target = state.scrollTarget;
    state.scrollTarget = null;
    if (target && !soft && backTo === undefined) target.scrollIntoView({ block: 'center' });
    else window.scrollTo(0, soft ? keepY : (backTo ?? 0));
  }
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
    if (name === 'results') return await viewResults();
    if (name === 'pricing') return await viewPricing();
    if (name === 'slip') return await viewSlip();
    if (name === 'dev') return await viewDev();
    if (name === 'signin') return await viewSignin();
    if (name === 'account') return await viewAccount();
    if (name === 'legal' && parts[1]) return viewLegal(parts[1]);
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
async function headerAuth() {
  const link = document.getElementById('account-link');
  const tag = document.getElementById('plan-tag');
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
        state.member = Boolean(state.account.membership?.expires_at * 1000 > Date.now());
        const f = state.account.profile?.odds_format;
        const oddsChanged = f && f !== oddsFormat;
        if (oddsChanged) setOddsFormat(f);
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

  if (tag) {
    tag.hidden = !user;
    tag.textContent = member ? 'Member' : 'Free';
    tag.className = member ? 'plan-tag on' : 'plan-tag';
    tag.href = member ? '#/account' : '#/pricing';
  }
  if (upgrade) {
    upgrade.hidden = member;
    upgrade.textContent = user ? 'Upgrade' : 'Get the calls';
  }
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

async function health() {
  try {
    const h = await getJSON('/api/health');
    const live = document.getElementById('live');
    if (!h.stale) live.classList.add('ok');
    document.getElementById('foot-stats').innerHTML = `
      <div><b>88</b><span>Leagues</span></div>
      <div><b>${(h.fixtures ?? 0).toLocaleString()}</b><span>Games on the board</span></div>
      <div><b>Every 15 min</b><span>Refreshed</span></div>`;
  } catch { /* the dot stays grey, which is the honest state */ }
  // The header's tally, on every page. The board is only fetched for it where
  // a page has not already loaded one; the settled record is small.
  try {
    const [recent, board] = await Promise.all([
      getJSON('/api/picks?limit=40&settled=true').then((r) => r.picks ?? []),
      state.board ? state.board : loadBoard().catch(() => null),
    ]);
    paintTally(board?.fixtures ?? [], recent);
  } catch { /* stays hidden */ }
}

document.getElementById('burger').onclick = (e) => {
  const open = document.getElementById('nav').classList.toggle('open');
  e.currentTarget.setAttribute('aria-expanded', String(open));
};

window.addEventListener('hashchange', route);

renderRegion();

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
    state.authError = /expired|invalid|verifier|code/i.test(String(err?.message ?? ''))
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
    if (intent === 'buy') {
      location.hash = '#/pricing';
      await route();
      await startCheckout();
      health();
      headerAuth();
      cookieNotice();
      return;
    }
    if (intent && intent.startsWith('#/')) location.hash = intent;
  }
  await route();
  smartQuotes(document.querySelector('footer'));
  const settings = document.getElementById('cookie-settings');
  if (settings) settings.onclick = () => cookieNotice({ force: true });
  health();
  headerAuth();
  cookieNotice();
})();
