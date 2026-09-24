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
import { authHeaders, completeSignIn, currentUser, signInWithEmail, signInWithGoogle, signOut } from './js/lib/auth.js';

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
const oddsOf = (v) => `odds of ${dec(v)}`;
const oddsTag = (v) => `${dec(v)} odds`;

/**
 * Every read goes through here, which is why the token goes on here.
 *
 * authHeaders() returns an empty object for a signed-out reader without
 * loading anything, so this costs nothing on the page most people see. It also
 * never throws: a failure to attach a token produces an anonymous request,
 * which is a page that loads rather than a page that does not.
 */
async function getJSON(path) {
  const res = await fetch(path, { headers: await authHeaders() });
  if (!res.ok) {
    let msg = 'Something went wrong loading this.';
    try { msg = (await res.json()).error ?? msg; } catch { /* body was not json */ }
    throw new Error(msg);
  }
  return res.json();
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
  return `<span class="crest crest-${size}" style="${vars}" aria-hidden="true"
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
  user: null, authError: null, tick: null, poll: null, onVisible: null,
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

async function loadBoard() {
  state.board = await getJSON(`/api/board?hours=${state.hours}`);
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

function matchCentreHTML(hero, d) {
  if (!d) return '';
  const st = d.standings ?? {};
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
        <span class="mc-label">${meetings} meetings</span>
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

function heroHTML(hero = null, venueIds = [], detail = null) {
  const queue = hero?.venue_id ? [hero.venue_id, ...venueIds] : [].concat(venueIds).filter(Boolean);

  if (!hero) {
    return `
    <section class="hero" data-shot="${queue.length ? 'yes' : 'none'}">
      <div class="hero-media">${venueShot(queue, '', true)}</div>
      <div class="wrap hero-inner">
        <div class="hero-copy">
          <h1 class="display">The picks for the biggest games.</h1>
          <p class="hero-blurb">Every call comes with the reason behind it. And the reason
             not to like it. Eighty-eight competitions, updated through the day.</p>
          <div class="hero-cta">
            <a class="btn btn-primary" href="#/board">Today's picks</a>
            <a class="btn btn-ghost" href="#/results">See the results</a>
          </div>
        </div>
      </div>
    </section>`;
  }

  const when = kickoffLabel(hero.kickoff);
  // The occasion is the pundit's aside — "the Madrid derby", "Champions League
  // night" — so it goes in the handwriting above the tie, not buried in a
  // sentence under it. The league stays in the blurb, where it is a fact.
  const aside = unshout(hero.kicker) || hero.league || '';

  return `
  <section class="hero" data-shot="${queue.length ? 'yes' : 'none'}">
    <div class="hero-media">${venueShot(queue, '', true)}</div>
    <div class="wrap hero-inner">
      <div class="hero-copy">
        <span class="timechip${isSoon(hero.kickoff) ? ' soon' : ''}">${esc(when)}</span>
        ${aside ? `<p class="kicker">${esc(aside)}</p>` : ''}
        <!-- The tie is the page's heading. Without this the home page had no
             h1 at all whenever a hero fixture was set, which is the one case
             it always is. -->
        <h1 class="fx-stack">
          <span class="fx-line">${crest(hero.home, 'md', hero.home_id)}<span class="name">${esc(hero.home)}</span></span>
          <span class="fx-line">${crest(hero.away, 'md', hero.away_id)}<span class="name">${esc(hero.away)}</span></span>
        </h1>
        <p class="hero-blurb">${esc(hero.league ?? '')}${hero.league ? '. ' : ''}Our call on it, the
           argument for it, and the thing that argues against it.</p>
        <div class="hero-cta">
          <a class="btn btn-primary" href="#/fixture/${encodeURIComponent(hero.fixture_id)}">Read the analysis</a>
          <a class="btn btn-ghost" href="#/board">All of today's picks</a>
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
  const clock = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>`;
  return `
  <div class="wrap section dense">
    <div class="section-head"><div><h2 class="display">${esc(heading)}</h2></div>
      <a class="btn btn-ghost btn-sm" href="#/board${heading === 'Just finished' ? '?when=played' : ''}">The full board</a></div>
    <div class="next-rail">
      ${soon.map((f) => {
        const k = new Date(f.kickoff * 1000);
        const time = k.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
        const st = matchState(f);
        const mark = (f.top_pick || f.locked) ? '<span class="pill call">call</span>' : '';
        return `
        <a class="nextcard" href="#/fixture/${encodeURIComponent(f.id)}">
          <span class="nextcard-side">${crest(f.home, 'sm', f.home_id)}<span>${esc(f.home)}</span>${mark}</span>
          <span class="nextcard-side">${crest(f.away, 'sm', f.away_id)}<span>${esc(f.away)}</span></span>
          <span class="nextcard-foot">
            <span>${st.kind === 'upcoming' ? esc(dayLabel(f.kickoff)) : liveBadge(st)}</span>
            <time>${clock}${esc(time)}</time>
          </span>
        </a>`;
      }).join('')}
    </div>
  </div>`;
}

/** The one block of solid colour on the site, and it sells the membership. */
function promoHTML(user) {
  return `
  <section class="promo">
    <p class="hand promo-aside">nobody else prints the losses</p>
    <h2>Every call, every competition.</h2>
    <p>The analysis is free and stays free. Membership is the call itself — which market,
       which side, the price and the book offering it.</p>
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
function slipHTML(data) {
  const cur = data?.current;
  const rec = data?.record;
  const record = rec?.n ? `<p class="slip-record">Slips so far: <b>${rec.won} of ${rec.n}</b> landed.</p>` : '';
  if (!cur) {
    return `
    <section class="panel slip">
      <p class="panel-head">Today's bet slip</p>
      <p class="slip-empty">No slip up yet. It goes up once there are enough strong calls on the
        board to reach total odds of 2.00 without reaching for weaker ones.</p>
      ${record}
    </section>`;
  }
  const legs = Array.isArray(cur.legs) ? cur.legs : null;
  return `
  <section class="panel slip">
    <p class="panel-head">Today's bet slip</p>
    <div class="slip-total">
      <span class="slip-odds">${dec(cur.odds)}<small>total odds</small></span>
      <span class="slip-legs">${cur.legs_count} legs</span>
    </div>
    <p class="slip-chance">Our most likely calls, combined. A slip like this comes in
      <b>${esc(chanceInWords(cur.chance))}</b>.</p>
    ${legs ? `<ol class="slip-list">${legs.map((l) => {
      const d = market({ market: l.market, outcome: l.outcome, line: l.line, home: l.home, away: l.away, odds: l.odds });
      return `
        <li><a href="#/fixture/${encodeURIComponent(l.fixture_id)}">
          <span class="slip-tie">${esc(l.home)} v ${esc(l.away)}</span>
          <span class="slip-sel">${esc(d.name)}</span>
          <span class="slip-meta">${esc(kickoffLabel(l.kickoff))}<b>${oddsTag(l.odds)}</b></span>
        </a></li>`;
    }).join('')}</ol>`
    : `<div class="slip-locked">
        <p>The ${cur.legs_count} matches and the calls on them are for members.</p>
        <a class="btn btn-accent" href="#/pricing">See what membership costs</a>
      </div>`}
    ${record}
  </section>`;
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
            <span class="side-meta">${esc(f.league ?? '')}<b>${sc ? `${sc[0]}–${sc[1]}` : 'under way'}</b></span>
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
        <a class="league-chip" href="#/board?league=${encodeURIComponent(name)}">
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
  return `
  <aside class="home-side">
    ${slipHTML(slip)}
    ${liveNowHTML(fixtures)}
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
          return `
          <a class="side-item" href="#/fixture/${encodeURIComponent(f.id)}">
            <span class="side-thumb">${crest(f.home, 'sm', f.home_id)}${crest(f.away, 'sm', f.away_id)}</span>
            <span class="side-body">
              <span class="side-sel">${esc(d.name)}</span>
              <span class="side-meta">${esc(kickoffLabel(f.kickoff))}<b>${oddsTag(f.top_pick.odds)}</b></span>
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
            day === 'Today' ? '' : `${esc(day)} · `}ko ${esc(time)}</span>`}
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
                : `<span class="row-pass">Passed</span>`)
        : pick && p ? `
        <span class="odds-tile${p.local ? '' : ' away'}"><span class="odds">${dec(p.odds)}</span><span class="odds-unit">odds</span></span>
        <span class="odds-book">${pick.lean ? 'lean · ' : ''}${p.local ? esc(p.book) : `no ${esc(country())} book`}</span>`
        : f.locked ? `<span class="row-locked-mark">
                        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10V7a5 5 0 0 1 10 0v3"/><rect x="4" y="10" width="16" height="10" rx="2"/></svg>
                        Members</span>`
        : `<span class="row-pass">Passed</span>`}
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
  app.innerHTML = heroHTML(state.hero, state.heroVenue) + '<div class="spinner">Loading the board…</div>';
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
  [recent, slip] = await Promise.all([
    getJSON('/api/picks?limit=40&settled=true').then((r) => r.picks ?? []).catch(() => []),
    getJSON('/api/slip').catch(() => null),
  ]);
  const settled = recent.filter((x) => x.result && x.result !== 'VOID');
  const won = settled.filter((x) => x.result === 'WON' || x.result === 'HALF_WON').length;
  const lost = settled.filter((x) => x.result === 'LOST' || x.result === 'HALF_LOST').length;

  // Grounds hosting today's games, strongest call first. The browser works down
  // the list until one has a photograph, so the masthead is always a real
  // stadium with a real fixture in it tonight.
  state.heroVenue = [...top, ...fixtures].map((f) => f.venue_id).filter(Boolean);

  app.innerHTML =
    heroHTML(state.hero, state.heroVenue, state.heroDetail) +
    nextRailHTML(fixtures.filter((f) => hasCall(f) && f.id !== state.hero?.fixture_id)) +
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

  tickCountdowns();
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
      if (left <= 0) { el.textContent = 'Under way'; el.classList.add('live'); continue; }
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
                ${crest(name, 'xs', g.id, 'league')}${esc(name)}
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
      const fresh = await loadBoard();
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
      <p>Which market, which side, the price and the book offering it.
         The reading of the match above stays free, always.</p>
    </div>
    <a class="btn btn-accent" href="#/pricing">See what membership costs</a>
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
      ? `<div class="verdict"><p class="narrative">${esc(v.narrative)}</p></div>`
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
        : `<span class="price">${dec(odds)}<small>odds</small></span>`}
    </div>
    ${landed
      ? `<p class="wins">${esc(story ?? d.wins)}</p>`
      : `<p class="wins">${esc(d.wins)}</p>`}
    ${prose ? `<p class="narrative">${esc(prose)}</p>` : ''}
    ${why ? `<div class="why"><p class="why-head">Why this call</p><p>${esc(why)}</p></div>` : ''}
    ${played && (prose || why) ? `<p class="aside">Written before kick-off, and left as it was.</p>` : ''}
    <div class="verdict-meta">
      ${played
        ? `<span>We put it up at ${oddsOf(c.odds)}${c.bookmaker ? ` with ${esc(bookName(c.bookmaker))}` : ''}.</span>`
        : `${p ? (p.local
            ? `<span>Best price at <b>${esc(p.book)}</b> in ${esc(COUNTRY_NAMES[country()] ?? 'your country')}</span>`
            : `<span class="warnish">No book in ${esc(COUNTRY_NAMES[country()] ?? 'your country')} is quoting this. ` +
              `The ${oddsOf(p.odds)} above are ${esc(p.book)}'s.</span>`) : ''}
           <span>${esc(d.returns)}</span>`}
    </div>
    ${!played && p && p.local && p.count > 1 ? `
      <details class="settles">
        <summary>${p.count} book${p.count === 1 ? '' : 's'} where you are</summary>
        <table class="tbl settle-tbl"><thead><tr><th>Bookmaker</th><th class="num">Odds</th></tr></thead><tbody>
          ${(c.prices ?? []).filter((q) => localPrice([q]).local).sort((a, b) => b.odds - a.odds)
            .map((q) => `<tr><td>${esc(bookName(q.book, q.slug))}</td><td class="num">${dec(q.odds)}</td></tr>`).join('')}
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

function squadHTML(lineups, home, away) {
  const side = (label, s) => {
    const players = (s?.players ?? []).filter((x) => x?.name);
    if (!players.length) return '';
    return `
    <div class="panel">
      <p class="panel-head">${esc(label)}${s.formation ? ` <span>${esc(s.formation)}</span>` : ''}</p>
      <div class="squad">
        ${players.map((x) => `
          <div class="squad-row">
            <span class="name">${esc(x.name)}</span>
            <span class="pos">${esc(POSITION[x.position] ?? x.position ?? '')}</span>
            <span class="no">${x.starting === false ? 'sub' : ''}</span>
          </div>`).join('')}
      </div>
    </div>`;
  };
  const both = side(home, lineups?.home) + side(away, lineups?.away);
  return both ? `<div class="grid-2">${both}</div>` : '';
}

/*
 * The surname, which is not always the last word.
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
 * It used to be two stacked half-pitches, both teams laid out in the same
 * direction, which is not how a team sheet has ever been drawn: the whole
 * point of the picture is that the two sides face each other, so you can see
 * a back four against a front three. Two blocks pointing the same way is a
 * list with a green background.
 *
 * So: one pitch, home attacking up from the bottom, away attacking down from
 * the top, and the markings actually drawn -- halfway line, centre circle,
 * both boxes, penalty spots, corner arcs. The markings are the thing that
 * makes it read as a pitch rather than as a green panel, and they cost one
 * inline SVG.
 */
function pitchHTML(lineups, home, away, homeId, awayId) {
  if (!lineups?.home?.players?.length || !lineups?.away?.players?.length) return '';

  const rowsFor = (side) => {
    const starters = side.players.filter((p) => p.starting !== false).slice(0, 11);
    const shape = String(side.formation ?? '')
      .split(/[-–]/)
      .map((n) => parseInt(n, 10))
      .filter((n) => Number.isFinite(n) && n > 0);
    // No formation on record: an even spread still reads as a team sheet.
    const bands = shape.length ? shape : [4, 4, 2];
    const out = [[starters[0]].filter(Boolean)];
    let i = 1;
    for (const n of bands) {
      out.push(starters.slice(i, i + n));
      i += n;
    }
    if (i < starters.length) out.push(starters.slice(i));
    return out.filter((r) => r.length);
  };

  // The best-rated starter per side, ringed. Not labelled with the rating --
  // that is our own score and stays ours -- but worth pointing at.
  const keyManOf = (side) => {
    const rated = (side.players ?? []).filter((p) => p.starting !== false && typeof p.ai_score === 'number');
    if (!rated.length) return null;
    return rated.reduce((a, b) => (b.ai_score > a.ai_score ? b : a)).id;
  };

  const player = (p, keyMan) => `
    <div class="pp${p.id === keyMan ? ' key' : ''}" title="${esc(p.name)}">
      ${crest(p.name, 'md', p.id, 'player')}
      <span class="pp-name">${esc(surname(p.name))}</span>
    </div>`;

  const sideHTML = (side, atTop) => {
    const keyMan = keyManOf(side);
    // Drawn from each side's own goal outwards, so the keepers end up at the
    // two ends and the forwards meet in the middle.
    const rows = rowsFor(side);
    const ordered = atTop ? rows : [...rows].reverse();
    return `<div class="pitch-side ${atTop ? 'away' : 'home'}">
      ${ordered.map((row) => `<div class="pitch-row">${row.map((x) => player(x, keyMan)).join('')}</div>`).join('')}
    </div>`;
  };

  const head = (teamName, teamId, side) => `
    <div class="sheet-team">
      ${crest(teamName, 'sm', teamId)}<b>${esc(teamName)}</b>
      ${side?.formation ? `<span class="formation">${esc(side.formation)}</span>` : ''}
    </div>`;

  const out = (lineups.unavailable ?? []).filter((u) => u.name);
  return `
  <div class="panel">
    <p class="panel-head">Team sheet ${lineups.status === 'confirmed'
      ? '<span class="tag ok">confirmed</span>'
      : '<span class="tag prov">predicted</span>'}</p>

    <div class="sheet-heads">
      ${head(away, awayId, lineups.away)}
      ${head(home, homeId, lineups.home)}
    </div>

    <div class="pitch">
      <!-- The markings, drawn to a 68x105 pitch so the boxes are the right
           size relative to it rather than eyeballed. -->
      <svg class="pitch-lines" viewBox="0 0 68 105" preserveAspectRatio="none" aria-hidden="true">
        <rect x="1" y="1" width="66" height="103" />
        <line x1="1" y1="52.5" x2="67" y2="52.5" />
        <circle cx="34" cy="52.5" r="9.15" />
        <circle class="spot" cx="34" cy="52.5" r="0.6" />
        <rect x="20.15" y="1" width="27.7" height="16.5" />
        <rect x="26.85" y="1" width="14.3" height="5.5" />
        <circle class="spot" cx="34" cy="12" r="0.6" />
        <rect x="20.15" y="87.5" width="27.7" height="16.5" />
        <rect x="26.85" y="98.5" width="14.3" height="5.5" />
        <circle class="spot" cx="34" cy="93" r="0.6" />
      </svg>
      ${sideHTML(lineups.away, true)}
      ${sideHTML(lineups.home, false)}
    </div>

    ${out.length
      ? `<div class="outlist"><b>Unavailable</b>${out.map((u) => `<span class="also-call">${esc(u.name)}${u.reason ? ` — ${esc(u.reason)}` : ''}</span>`).join('')}</div>`
      : ''}
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
  if (!st || (!st.home && !st.away)) return '';
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
  const t = String(r ?? '').toLowerCase().replace(/\s*injury$/, '').trim();
  return t && !/^(unknown|other|undisclosed|n\/a|missing)$/.test(t) ? t : null;
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
  const size = f.standings?.size;
  for (const side of ['home', 'away']) {
    const pos = f.standings?.[side]?.position;
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

  // The last meeting, as a result a supporter remembers.
  const last = (f.h2h?.recent_matches ?? [])[0];
  if (last?.score) {
    const when = last.date ? new Date(last.date).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }) : null;
    items.push({ label: 'Last time', note: `Finished ${last.score}${when ? `, ${when}` : ''}.`, weight: 50 });
  }

  // The manager, by name, when the feed has one.
  for (const side of ['home', 'away']) {
    const e = ledger.find((x) => x.id.startsWith(`manager.${side}.`) && x.state === 'COMPUTED');
    const name = e?.evidence?.manager;
    const games = e?.evidence?.matches_in_charge;
    if (name && name !== 'the manager' && typeof games === 'number' && games <= 10) {
      items.push({ label: `In the dugout: ${team[side]}`, note: `${name} is ${saidN(games)} games into the job.`, weight: 60 });
    }
  }

  // The engine's own notes, only the specific kinds, and only if they pass.
  const KEEP = /^(fatigue\.|fixture\.derby|fixture\.revenge|referee\.tendency|environment\.weather|stakes\.)/;
  for (const x of ledger) {
    if (x.state !== 'COMPUTED' || !KEEP.test(x.id) || !READ_LABEL[x.id]) continue;
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
  app.innerHTML = '<div class="wrap section"><div class="spinner">Loading…</div></div>';
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
    : (played ? 'We did not call this one' : 'No call');

  const overview = `
    <div class="grid-2">
      <div>
        <div class="panel">
          <p class="panel-head">${callHead}</p>
          ${verdicts.length
            ? verdicts.map((v) => verdictHTML(v, f.home, f.away, f, { played, hg, ag })).join('')
              + (anyLocked ? lockedHTML(f) : '')
            : `<p class="narrative">${esc(f.pass ?? 'Nothing here is worth a call. The price looks about right.')}</p>`}
        </div>
        ${reads.length ? `<div class="panel">
          <p class="panel-head">${verdicts.length ? (played ? 'What made us call it' : 'What made the call') : 'What stood out'}</p>
          <div class="reads">${reads.map((r) => `<div class="read"><b>${esc(r.label)}</b><p>${esc(r.note)}</p></div>`).join('')}</div>
          ${rest.length ? `
            <details class="more-reads">
              <summary>${rest.length} other thing${rest.length === 1 ? '' : 's'} we checked</summary>
              <div class="reads">${rest.map((r) => `<div class="read"><b>${esc(r.label)}</b><p>${esc(r.note)}</p></div>`).join('')}</div>
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
      pitchHTML(f.lineups, f.home, f.away, f.home_id, f.away_id)
      + squadHTML(f.lineups, f.home, f.away)],
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

  app.innerHTML = `
  <section class="hero fx-top" data-shot="${f.venue_id ? 'yes' : 'none'}">
    <div class="hero-media">${venueShot(f.venue_id, '', true)}</div>
    <div class="wrap hero-inner">
      ${backHTML('Back to the board')}
      <div class="hero-copy">
        <span class="timechip${isSoon(f.kickoff) ? ' soon' : ''}">${esc(kickoffLabel(f.kickoff))}</span>
        ${st.kind === 'upcoming' ? '' : liveBadge(st)}
        <h1 class="fx-stack${sc ? ' scored' : ''}">
          <span class="fx-line">
            ${crest(f.home, 'md', f.home_id)}
            <span class="name">${esc(f.home)}</span>
            ${sc ? `<span class="gf${hg > ag ? ' win' : ''}">${hg}</span>` : formChips(f.form?.home)}
          </span>
          <span class="fx-line">
            ${crest(f.away, 'md', f.away_id)}
            <span class="name">${esc(f.away)}</span>
            ${sc ? `<span class="gf${ag > hg ? ' win' : ''}">${ag}</span>` : formChips(f.form?.away)}
          </span>
        </h1>
        <p class="hero-blurb">${esc([f.league, ...meta.slice(1)].filter(Boolean).join(', '))}</p>
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
}

function bar(label, v) {
  const w = typeof v === 'number' ? Math.round(v * 100) : 0;
  return `<div class="bar-row"><div class="lab" style="grid-column:1/-1"><span>${esc(label)}</span><span>${w}%</span></div>
    <span class="bar"><i style="width:${w}%"></i></span></div>`;
}

// ---------------------------------------------------------------- results

async function viewResults() {
  app.innerHTML = '<div class="wrap section"><div class="spinner">Loading…</div></div>';
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
   * The numbers are a strip instead. Four figures, each with what it is, which
   * is how anybody reads a record and is legible at any width because it is a
   * grid rather than a sentence. The sentence stays, at sentence size, because
   * it says the thing the numbers cannot: that winning most of them is not the
   * same as making money.
   */
  const stat = (v, label, tone = '') =>
    `<div class="stat${tone ? ` ${tone}` : ''}"><b>${esc(v)}</b><span>${esc(label)}</span></div>`;

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
      <div class="record-strip">
        ${stat(wins, 'won', 'won')}
        ${stat(Math.max(0, n - wins - refunds), 'did not', 'lost')}
        ${stat(refunds, 'stake back')}
        ${stat(`${rate}%`, 'of those graded')}
      </div>
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
        : 'Winning most of them is not the same as being ahead — these are short prices.'}</p>
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
    ${g.list.map(recapCardHTML).join('')}
  </section>`;
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
    facts.push(pm.swing === 0
      ? 'finished on the line'
      : `${pm.swing} goal${pm.swing === 1 ? '' : 's'} ${pm.landed === 'missed' ? 'short' : 'to spare'}`);
  }
  if (pm.shape) {
    facts.push(pm.shape === 'as we read it' ? 'the game we described' : `a ${pm.shape} game than we called`);
  }
  if (pm.market && pm.opening_odds && pm.closing_odds) {
    facts.push(pm.market === 'held'
      ? `odds held at ${dec(pm.closing_odds)}`
      : `odds moved from ${dec(pm.opening_odds)} to ${dec(pm.closing_odds)} by kick-off`);
  }

  return `
  <div class="pm is-${esc(pm.landed)}">
    <p class="pm-line">${esc(pm.line)}</p>
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
    <a class="lg" href="${esc(boardHash(state.hours, e.name))}">
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

async function startCheckout(plan = 'monthly') {
  // A push, not a replace: pricing is somewhere a reader might reasonably want
  // to go back to, unlike `#/account` signed out, which only ever bounces.
  if (!(await currentUser())) { setIntent('buy'); location.hash = '#/signin'; return; }
  const button = document.getElementById('buy');
  if (button) { button.disabled = true; button.textContent = 'Opening checkout…'; }
  try {
    const { link } = await postJSON('/api/pay/checkout', { plan });
    if (!link) throw new Error('The payment page could not be opened.');
    location.href = link;
  } catch (err) {
    if (button) { button.disabled = false; button.textContent = 'Become a member'; }
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
 * What a membership costs.
 *
 * One plan, one price, one button. No decoy tier that exists only to flatter
 * the one beside it, and no claim about returns anywhere on the page -- the
 * settled record is public and negative, so selling coverage and explanation is
 * the only honest pitch and it is the one that survives an ad review.
 */
async function viewPricing() {
  const user = await currentUser();

  app.innerHTML = `
  <div class="wrap section">
    <div class="section-head">
      <div>
        <h1 class="display">Membership</h1>
        <p>Every match we cover, read properly. The call is the part you pay for.</p>
      </div>
    </div>

    <div class="pricing">
      <div class="panel plan-free">
        <h3 class="panel-head">Free, forever</h3>
        <ul class="ticks">
          <li>Every fixture across 88 leagues</li>
          <li>The full write-up on each one</li>
          <li>Form, team news, line-ups, head-to-head</li>
          <li>The complete settled record, wins and losses alike</li>
        </ul>
      </div>

      <div class="panel plan-paid">
        <h3 class="panel-head">Member</h3>
        <p class="plan-price"><b>£9</b><span>a month</span></p>
        <ul class="ticks">
          <li><b>The call itself</b> — which market and which side</li>
          <li><b>The price</b>, and the bookmaker offering it</li>
          <li>What has to happen for it to win, in plain English</li>
          <li>Every open call, not just the ones on the front page</li>
        </ul>
        <button class="btn btn-accent btn-lg" id="buy">
          ${user ? 'Become a member' : 'Sign in to join'}
        </button>
        <!--
          What actually happens when the button is pressed, in the place a
          reader looks before pressing it.

          The page used to say only "thirty days, cancel whenever you like",
          which leaves the one question anybody has about a monthly price
          unanswered: does it come out again next month. It does not --
          membership.auto_renew defaults to 0 and record_payment never sets
          it, so a membership bought here is thirty days and then it stops.
          Saying so is not a concession; a subscription nobody remembers
          agreeing to is the thing people hate.
        -->
        <p class="plan-note"><b>One payment. Thirty days.</b> It does not renew by itself — you can
          turn renewal on from your account if you want it to, and off again in one tap.</p>
        <p class="plan-note">Changed your mind? Fourteen days, full refund, whatever you have
          read. <a href="#/legal/refunds">How refunds work</a>.</p>
      </div>
    </div>

    <div class="prose pricing-small">
      <h2>What this is not</h2>
      <p>It is not tipping and it is not advice to place a bet. We publish what we
         think will happen and why, and we publish the record of how that has gone —
         including when it has gone badly. Nothing here is a promise of profit, and
         a high strike rate at short odds can still lose money.</p>
      <p>18+. <a href="#/legal/responsible">Gambling can be a problem</a> — if it has
         stopped being entertainment you can afford, that page is more use than any
         call on this site.</p>
    </div>
  </div>`;

  document.getElementById('buy').onclick = () => startCheckout();
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
    ? 'Then we will take you straight back to membership.'
    : intent === '#/account'
      ? 'Your account lives behind this.'
      : null;

  app.innerHTML = `
  <div class="wrap section narrow">
    <div class="section-head"><div>
      <h1 class="display">Sign in</h1>
      <p>No password to remember or lose. We email you a link.${because ? ` ${esc(because)}` : ''}</p>
    </div></div>

    ${problem ? `<p class="form-error">${esc(problem)}</p>` : ''}

    <div class="panel signin">
      <button class="btn btn-ghost btn-lg btn-google" id="google">Continue with Google</button>
      <div class="or"><span>or</span></div>
      <form id="magic" novalidate>
        <label for="email">Your email address</label>
        <input id="email" name="email" type="email" autocomplete="email"
               inputmode="email" required placeholder="you@example.com">
        <button class="btn btn-primary btn-lg" type="submit">Email me a link</button>
      </form>
      <p class="signin-note" id="note"></p>
    </div>

    <p class="prose pricing-small">By signing in you agree to our
      <a href="#/legal/terms">terms</a> and <a href="#/legal/privacy">privacy policy</a>.</p>
  </div>`;

  const note = document.getElementById('note');
  const say = (msg, bad) => { note.textContent = msg; note.className = bad ? 'signin-note bad' : 'signin-note ok'; };

  /*
   * The auth library's own words, translated.
   *
   * A reader who mistyped their email got "AuthApiError: Unable to validate
   * email address: invalid format", and one who asked twice in a minute got
   * "For security purposes, you can only request this after 47 seconds." Both
   * are accurate and neither is addressed to a person. The cases we can name
   * are named; anything we cannot is a sentence that at least says what to do
   * next, with the original kept off the page.
   */
  const humanise = (err) => {
    const raw = String(err?.message ?? '');
    if (/rate ?limit|only request this after|too many/i.test(raw)) {
      return 'That is one too many requests in a row. Give it a minute and try again.';
    }
    if (/invalid format|unable to validate email/i.test(raw)) {
      return 'That does not look like an email address. Check it and try again.';
    }
    if (/signups? not allowed|disabled/i.test(raw)) {
      return 'We cannot open new accounts by email at the moment. Try Google instead.';
    }
    if (/failed to fetch|network/i.test(raw) || navigator.onLine === false) {
      return 'Your device cannot reach us at the moment. Check your connection and try again.';
    }
    if (/popup|window|closed/i.test(raw)) return 'The Google window closed before it finished. Try again.';
    return 'That did not work. Try again, or use the other button.';
  };

  document.getElementById('google').onclick = async (e) => {
    e.currentTarget.disabled = true;
    try { await signInWithGoogle(); } catch (err) { say(humanise(err), true); e.currentTarget.disabled = false; }
  };

  document.getElementById('magic').onsubmit = async (e) => {
    e.preventDefault();
    const email = document.getElementById('email').value.trim();
    if (!email) return say('Put your email address in first.', true);
    const button = e.currentTarget.querySelector('button');
    button.disabled = true;
    say('Sending…');
    try {
      await signInWithEmail(email);
      say(`Check ${email}. The link signs you straight in.`);
    } catch (err) {
      say(humanise(err), true);
      button.disabled = false;
    }
  };
}

/** The account: what you have, what it costs, and how to stop it. */
async function viewAccount() {
  const user = await currentUser();
  if (!user) { setIntent('#/account'); goInstead('#/signin'); return; }

  app.innerHTML = '<div class="wrap section narrow"><div class="spinner">Loading…</div></div>';
  let account = { membership: null, receipts: [] };
  try { account = await getJSON('/api/account'); } catch { /* shown as no membership */ }

  const m = account.membership;
  const active = m && m.expires_at * 1000 > Date.now();
  // The page that knows for certain, so the header stops guessing.
  state.member = Boolean(active);
  const when = (e) => new Date(e * 1000).toLocaleDateString([], { day: 'numeric', month: 'long', year: 'numeric' });

  app.innerHTML = `
  <div class="wrap section narrow">
    <div class="section-head"><div>
      <h1 class="display">Your account</h1>
      <p>${esc(user.email ?? '')}</p>
    </div></div>

    <div class="panel">
      <h3 class="panel-head">Membership</h3>
      ${active ? `
        <p class="acct-state on">Active until <b>${esc(when(m.expires_at))}</b>.</p>
        <p class="acct-line">${m.auto_renew
          ? `It renews itself on that date${m.card_last4 ? ` using your ${esc(m.card_brand ?? 'card')} ending ${esc(m.card_last4)}` : ''}.`
          : 'It will not renew itself — access simply stops on that date.'}</p>
        ${m.auto_renew
          ? `<button class="btn btn-quiet" id="cancel">Stop renewing</button>`
          : `<button class="btn btn-primary" id="resume">Renew each month</button>`}
      ` : `
        <p class="acct-state off">You are not a member.</p>
        <p class="acct-line">The reading of each match is free. The call, the price and
           the bookmaker are not.</p>
        <a class="btn btn-accent" href="#/pricing">See what it costs</a>
      `}
    </div>

    ${account.receipts?.length ? `
      <div class="panel">
        <h3 class="panel-head">Payments</h3>
        <table class="tbl"><tbody>
          ${account.receipts.map((r) => `
            <tr><td>${esc(when(r.created_at))}</td>
                <td>${esc(r.status)}</td>
                <td class="num">${esc(money(r.amount_minor, r.currency))}</td></tr>`).join('')}
        </tbody></table>
      </div>` : ''}

    <div class="panel">
      <h3 class="panel-head">This browser</h3>
      <button class="btn btn-ghost" id="out">Sign out</button>
    </div>
  </div>`;

  document.getElementById('out').onclick = async () => {
    await signOut();
    state.member = null;
    state.board = null;
    location.hash = '#/home';
    await route();
    headerAuth();
  };
  const cancel = document.getElementById('cancel');
  // One tap, no "are you sure", no offer to stay. Retention mazes are a dark
  // pattern and in several places an illegal one.
  if (cancel) cancel.onclick = () => setRenewal(false);
  const resume = document.getElementById('resume');
  if (resume) resume.onclick = () => setRenewal(true);
}

/** Money, from minor units, without floating point anywhere near it. */
function money(minor, currency) {
  const n = Number(minor ?? 0);
  const sign = currency === 'GBP' ? '£' : currency === 'EUR' ? '€' : '$';
  return `${sign}${(n / 100).toFixed(2).replace(/\.00$/, '')}`;
}

// ------------------------------------------------------------------ legal

const UPDATED = 'September 2026';

/*
 * The address on the contact page. It is referenced from the privacy policy and
 * the refunds policy as well, so it is a constant rather than three strings.
 */
const SUPPORT_EMAIL = 'support@offside.win';

const LEGAL = {
  privacy: {
    title: 'Privacy policy',
    body: `
      <p>This policy explains what offside.win collects, why, and what you can do about it.
         It is written to be read rather than to be survived.</p>
      <h2>What we collect</h2>
      <p><b>Nothing, until you make an account.</b> You can read every fixture, every write-up and
         the whole results record without telling us anything at all.</p>
      <p>If you sign in, we hold your <b>email address</b> — because that is how you sign in — and,
         if you become a member, the <b>dates your membership runs</b> and a <b>record of each
         payment</b>: when, how much, and whether it went through.</p>
      <p><b>We never see your card.</b> Card details are entered on our payment processor's own
         page and never touch this site or our database. What we are told is the brand and the last
         four digits, so your account page can say "Visa ending 4242" and you know which card is
         on file. That is all we could tell anyone, including ourselves.</p>
      <p>Our host records standard server logs — IP address, browser, page requested, time — which
         are used to keep the site up and to spot abuse, and are not used to build a profile of you.</p>
      <h2>Analytics</h2>
      <p>If analytics are enabled they run only after you accept them in the cookie notice. Decline
         and none are loaded at all — not loaded-but-anonymised, not loaded. Your choice is stored
         in your own browser so we do not have to ask again.</p>
      <h2>What we never do</h2>
      <ul>
        <li>Sell or share your data with advertisers or data brokers.</li>
        <li>Track you across other websites.</li>
        <li>Send you marketing email. If you have an account you will get sign-in links and
            notices about your membership, and nothing else.</li>
      </ul>
      <h2>Third parties</h2>
      <p>Two companies process data on our behalf, and only what they need to do their job.
         <b>Supabase</b> stores the accounts and runs the sign-in. <b>Coinflow</b> takes the
         payments and holds the card details we never see. Both are bound by their own agreements
         with us and may not use your data for anything else.</p>
      <p>If you sign in with Google, Google is told that you signed in to this site. We are told
         your email address and nothing more.</p>
      <p>Pages load club crests, league marks and stadium photographs from our data provider, and
         fonts from Google Fonts. Those requests reach their servers and are subject to their own
         policies. Match and odds data comes from our provider; none of your information is sent to
         them.</p>
      <h2>Your rights</h2>
      <p>Where the UK GDPR or EU GDPR applies you may ask what we hold, ask for it to be corrected
         or deleted, and complain to your data protection authority. Ask and we will delete your
         account and your email address. We have to keep the record of payments themselves for as
         long as tax and accounting law requires, which we cannot waive — but it can be separated
         from you.</p>
      <h2>Contact</h2>
      <p>Questions about this policy go to <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>,
         or see the <a href="#/legal/contact">contact page</a>.</p>`,
  },
  cookies: {
    title: 'Cookie policy',
    body: `
      <p>A short policy, because the site uses very few cookies.</p>
      <h2>Strictly necessary</h2>
      <p>One item of local storage records whether you accepted or declined non-essential cookies,
         so the notice is not shown on every visit. It holds a single value and nothing else. It
         cannot be switched off, because without it we cannot remember that you said no.</p>
      <p>If you sign in, a second item holds your session — the thing that keeps you signed in
         between visits. It is set only after you sign in, it is removed when you sign out, and
         without it an account would not work at all.</p>
      <h2>Analytics — optional, off until you say otherwise</h2>
      <p>If you accept, an analytics cookie may be set to count visits and see which pages are
         read. If you decline, the analytics script is never loaded, so no such cookie can exist.</p>
      <h2>Advertising</h2>
      <p>We set no advertising cookies and run no ad network on this site.</p>
      <h2>Changing your mind</h2>
      <p>Clear this site's data in your browser settings and the notice will appear again on your
         next visit, letting you choose differently.</p>`,
  },
  terms: {
    title: 'Terms of use',
    body: `
      <p>By using offside.win you agree to these terms. If you do not, please do not use the site.</p>
      <h2>What this site is</h2>
      <p>offside.win publishes statistical analysis of football fixtures. Every figure is computed
         from public match data and publicly quoted bookmaker prices.</p>
      <h2>What it is not</h2>
      <p><b>It is not betting advice, and it is not a promise of profit.</b> A pick is our reading of
         a match. Nothing here is a recommendation that you place a bet, and no past result predicts
         a future one. You are solely responsible for anything you choose to stake.</p>
      <h2>Accuracy</h2>
      <p>Odds move and team news changes. Figures are correct as at the time shown on the page and
         may be out of date by the time you read them. We publish our losing picks alongside the
         winning ones, but we do not warrant that any number is free of error.</p>
      <h2>Eligibility</h2>
      <p>This site is for people aged 18 or over. Gambling laws differ by country and it is your
         responsibility to know the law where you are.</p>
      <h2>Liability</h2>
      <p>To the fullest extent the law allows, we are not liable for any loss arising from your use
         of this site, including money lost betting.</p>
      <h2>Membership</h2>
      <p>Reading the site is free: every fixture, every write-up, the form, the team news and the
         full record of results. A membership adds the call itself — which market, which side, the
         price, and the bookmaker offering it.</p>
      <p>A membership runs for thirty days from the day you pay. <b>It does not renew by
         itself.</b> If you want it to, you can turn renewal on from your account page, and off
         again the same way; while it is on we charge the same card on the day the membership runs
         out, at the price shown on the membership page at that time, and we will tell you before
         any price changes. Turning renewal off keeps the access you have already paid for until it
         runs out.</p>
      <p>This is digital content and your access starts the moment you pay. UK consumer law lets a
         seller ask you to give up the 14-day right to cancel in exchange for that. <b>We do not
         ask.</b> You keep the 14 days in full — see the refunds page — and there is nothing to
         agree to at checkout beyond the payment itself.</p>
      <h2>Changes</h2>
      <p>These terms may change. The date below shows when they were last revised.</p>`,
  },
  refunds: {
    title: 'Refunds',
    body: `
      <p>Short, because it should be.</p>
      <h2>If it did not work</h2>
      <p>If the site was down, or your membership did not start after you paid, tell us and we will
         put it right — either by extending your membership by the time you lost, or by refunding
         you in full. No argument and no form.</p>
      <h2>If you changed your mind</h2>
      <p>Tell us within 14 days of your first payment and you can have it back in full, whatever
         you have read in the meantime. We could ask you to sign that right away at checkout, the
         way most sellers of digital content do, in exchange for access starting immediately. We do
         not. Your access starts immediately anyway and the 14 days stand.</p>
      <h2>If you simply want to stop</h2>
      <p>Nothing to do: a membership is thirty days and then it stops. If you turned renewal on,
         turn it off on your account page — you keep what you have paid for until it runs out and
         are not charged again. We do not refund part of a month already under way, and we do not
         make you ask a person to leave.</p>
      <h2>What we will not refund</h2>
      <p><b>Losing bets.</b> Nothing here is advice to stake money and no call is a promise. Our
         record is published in full, wins and losses alike, so that is knowable before you pay
         rather than after.</p>
      <h2>How to ask</h2>
      <p>Write to <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a> from the email address on
         the account. We answer every refund request, including the ones we turn down.</p>`,
  },
  /*
   * A way to reach a person.
   *
   * The privacy and refunds pages both told readers to write to "the address
   * on our contact page", and there was no contact page -- on a site that
   * takes money, from strangers, under a refund policy that asks them to write
   * in. Both of those sentences now point somewhere.
   *
   * SUPPORT_EMAIL is the one thing on this page that has to be real. Change it
   * in one place if the mailbox moves.
   */
  contact: {
    title: 'Contact',
    body: `
      <p>One address, read by a person.</p>
      <h2>Anything at all</h2>
      <p><a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a></p>
      <p>Refunds, a membership that did not start, a scoreline we have got wrong, a question about
         what we hold on you, or a complaint. Write from the email address on your account where
         the question is about your account — it saves us asking you to prove it is you.</p>
      <h2>What to expect</h2>
      <p>We answer every email, including the ones where the answer is no. Refund requests are
         answered within two working days; everything else as soon as we can.</p>
      <h2>What we cannot help with</h2>
      <p>We are not a bookmaker and we hold no betting account. If a bet has been settled in a way
         you disagree with, that is between you and the book that took it — the rules that decided
         it are theirs, not ours. If gambling has stopped being something you can afford, the
         <a href="#/legal/responsible">responsible gambling page</a> lists people who can help, and
         they are better placed than we are.</p>`,
  },
  responsible: {
    title: 'Responsible gambling',
    body: `
      <p>Betting should be entertainment you can afford. If it has stopped being that, the
         information below is more useful than any pick on this site.</p>
      <h2>Signs worth taking seriously</h2>
      <ul>
        <li>Betting more than you planned, or more than you can comfortably lose.</li>
        <li>Chasing losses — staking more to win back what has gone.</li>
        <li>Borrowing money to bet, or hiding betting from people close to you.</li>
        <li>Betting to escape stress or low mood rather than for enjoyment.</li>
      </ul>
      <h2>Practical steps</h2>
      <ul>
        <li>Set a deposit limit with your bookmaker before you need one.</li>
        <li>Use self-exclusion — <a href="https://www.gamstop.co.uk" target="_blank" rel="noopener noreferrer">GAMSTOP</a>
            covers every licensed operator in Great Britain in one step.</li>
        <li>Block gambling sites with software such as Gamban, and turn on your bank's gambling block.</li>
      </ul>
      <h2>Free, confidential help</h2>
      <ul>
        <li><a href="https://www.begambleaware.org" target="_blank" rel="noopener noreferrer">BeGambleAware</a> — advice and a 24/7 helpline on 0808 8020 133.</li>
        <li><a href="https://www.gamcare.org.uk" target="_blank" rel="noopener noreferrer">GamCare</a> — support for anyone affected by gambling, including family.</li>
        <li><a href="https://www.gamblersanonymous.org" target="_blank" rel="noopener noreferrer">Gamblers Anonymous</a> — meetings worldwide.</li>
      </ul>
      <p><b>A high strike rate is not a safe bet.</b> Everything published here can be right more often
         than not and still lose money at the wrong price. Please treat it accordingly.</p>`,
  },
};

function viewLegal(which) {
  const page = LEGAL[which];
  if (!page) return notFound(`legal/${which}`);
  app.innerHTML = `
  <div class="wrap section">
    <div class="section-head"><div><h1 class="display">${esc(page.title)}</h1>
      <p>Last updated ${esc(UPDATED)}.</p></div></div>
    <div class="prose">${page.body}</div>
  </div>`;
}

// -------------------------------------------------------- cookie consent

const CONSENT_KEY = 'ow.consent';

/**
 * A notice that actually decides something.
 *
 * Most cookie banners set their trackers before you answer and then record the
 * answer. This one loads nothing until a choice is made, and "decline" means the
 * analytics script is never fetched — not fetched and anonymised. The only thing
 * stored either way is the answer itself, which is what makes the notice stop
 * appearing.
 */
function readConsent() {
  try { return localStorage.getItem(CONSENT_KEY); } catch { return null; }
}

function applyConsent(value) {
  try { localStorage.setItem(CONSENT_KEY, value); } catch { /* private mode: ask again next visit */ }
  document.getElementById('cookie-notice')?.remove();
  document.body.style.paddingBottom = '';
  // Analytics would be loaded here, and only here, when value === 'accepted'.
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

function cookieNotice() {
  if (readConsent()) return;
  const el = document.createElement('div');
  el.className = 'cookie';
  el.id = 'cookie-notice';
  el.innerHTML = `
    <p>One item of storage remembers this choice. Analytics load only if you
       accept. <a href="#/legal/cookies">Cookie policy</a></p>
    <button class="btn btn-ghost btn-sm" data-consent="declined">Decline</button>
    <button class="btn btn-primary btn-sm" data-consent="accepted">Accept</button>`;
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

async function route() {
  const { parts, params } = parseHash();
  const name = parts[0] || 'home';
  // Set after the first render, so the first route of a session -- the deep
  // link itself -- does not count as somewhere to go back to.
  state.cameFromInApp = routed++ > 0;
  clearInterval(state.tick);
  clearInterval(state.poll);
  if (state.onVisible) { removeEventListener('visibilitychange', state.onVisible); state.onVisible = null; }
  for (const a of document.querySelectorAll('.nav a')) a.classList.toggle('on', a.dataset.route === name);
  document.getElementById('nav').classList.remove('open');
  document.getElementById('burger').setAttribute('aria-expanded', 'false');
  window.scrollTo(0, 0);
  try {
    if (name === 'fixture' && parts[1]) return await viewFixture(parts[1], params);
    if (name === 'board') return await viewBoard(params);
    if (name === 'leagues') return await viewLeagues();
    if (name === 'results') return await viewResults();
    if (name === 'pricing') return await viewPricing();
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
  } catch (err) {
    errorState(err);
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
    if (state.member === null) {
      try { state.member = Boolean((await getJSON('/api/account')).membership?.expires_at * 1000 > Date.now()); }
      catch { state.member = Boolean(state.board?.member); }
    }
    member = state.member;
  } else {
    state.member = null;
  }

  link.textContent = user ? 'Account' : 'Sign in';
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
  health();
  headerAuth();
  cookieNotice();
})();
