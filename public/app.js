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

import { describe as market } from './js/lib/markets.js';
import { authHeaders, completeSignIn, currentUser, signInWithEmail, signInWithGoogle, signOut } from './js/lib/auth.js';

const app = document.getElementById('app');

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = (v, dp = 0) => (typeof v === 'number' && isFinite(v) ? `${(v * 100).toFixed(dp)}%` : '—');
const dec = (v) => (typeof v === 'number' && isFinite(v) ? v.toFixed(2) : '—');

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
const isSoon = (epoch) => epoch && epoch * 1000 - Date.now() < 6 * 3600e3;

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
  const started = f?.kickoff && f.kickoff * 1000 < Date.now();
  // Feed says not started, clock says otherwise. Say "under way" rather than
  // inventing a half we cannot see.
  if (started) return { kind: 'live', label: 'Under way', short: 'LIVE' };
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
const READ_LABEL = {
  'availability.home.absences': 'Team news',
  'availability.away.absences': 'Team news',
  'availability.home.full_strength': 'Squad',
  'availability.away.full_strength': 'Squad',
  'availability.lineup_confirmed': 'Line-ups',
  'availability.rotation_risk': 'Selection',
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
  user: null, authError: null,
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
  if (state.show === 'all') q.set('show', 'all');
  const s = q.toString();
  return s ? `#/board?${s}` : '#/board';
}

async function loadBoard() {
  state.board = await getJSON(`/api/board?hours=${state.hours}`);
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
function heroHTML(hero = null, venueIds = []) {
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
  const bits = [hero.league, unshout(hero.kicker)].filter(Boolean);

  return `
  <section class="hero" data-shot="${queue.length ? 'yes' : 'none'}">
    <div class="hero-media">${venueShot(queue, '', true)}</div>
    <div class="wrap hero-inner">
      <div class="hero-copy">
        <span class="timechip${isSoon(hero.kickoff) ? ' soon' : ''}">${esc(when)}</span>
        <div class="fx-stack">
          <span class="fx-line">${crest(hero.home, 'md', hero.home_id)}<span class="name">${esc(hero.home)}</span></span>
          <span class="fx-line">${crest(hero.away, 'md', hero.away_id)}<span class="name">${esc(hero.away)}</span></span>
        </div>
        <p class="hero-blurb">${esc(bits.join('. '))}${bits.length ? '. ' : ''}Our call on it, the
           argument for it, and the thing that argues against it.</p>
        <div class="hero-cta">
          <a class="btn btn-primary" href="#/fixture/${encodeURIComponent(hero.fixture_id)}">Read the analysis</a>
          <a class="btn btn-ghost" href="#/board">All of today's picks</a>
        </div>
      </div>
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
function nextRailHTML(fixtures) {
  const soon = fixtures.slice(0, 8);
  if (!soon.length) return '';
  const clock = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>`;
  return `
  <div class="wrap section dense">
    <div class="section-head"><div><h2 class="display">Next up</h2></div>
      <a class="btn btn-ghost btn-sm" href="#/board">The full board</a></div>
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
function sideHTML(fixtures) {
  const withCall = fixtures.filter((f) => f.top_pick).slice(0, 10);
  if (!withCall.length) return '';
  return `
  <aside>
    <h2 class="side-head">Live calls <a href="#/board">All</a></h2>
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
            <span class="side-meta">${esc(kickoffLabel(f.kickoff))}<b>${dec(f.top_pick.odds)}</b></span>
          </span>
        </a>`;
      }).join('')}
    </div>
  </aside>`;
}

/** Won, drawn, lost as one bar with the share written under it. */
function formBarHTML(w, d, l, labels = ['won', 'drawn', 'lost']) {
  const total = w + d + l;
  if (!total) return '';
  const pc = (n) => Math.round((n / total) * 100);
  return `
  <div class="formbar">
    <div class="formbar-track">
      ${w ? `<i class="w" style="width:${pc(w)}%"></i>` : ''}
      ${d ? `<i class="d" style="width:${pc(d)}%"></i>` : ''}
      ${l ? `<i class="l" style="width:${pc(l)}%"></i>` : ''}
    </div>
    <div class="formbar-keys">
      <span class="w"><b>${pc(w)}%</b> ${esc(labels[0])}</span>
      ${d ? `<span class="d"><b>${pc(d)}%</b> ${esc(labels[1])}</span>` : ''}
      <span class="l"><b>${pc(l)}%</b> ${esc(labels[2])}</span>
    </div>
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
  return `
  <div class="played">
    ${picks.map((x) => {
      const won = x.result === 'WON' || x.result === 'HALF_WON';
      const lost = x.result === 'LOST' || x.result === 'HALF_LOST';
      const badge = showOdds ? dec(x.odds) : won ? 'Won' : lost ? 'Lost' : 'Void';
      return `
      <a class="played-row" href="#/fixture/${encodeURIComponent(x.fixture_id)}">
        <div class="played-meta"><span>${esc(kickoffLabel(x.kickoff))}</span></div>
        <div class="played-tie">
          <span class="played-side">${crest(x.home_team ?? '', 'sm')}<span>${esc(x.home_team ?? '')}</span></span>
          <span class="played-score ${won ? 'w' : lost ? 'l' : ''}">${esc(badge)}</span>
          <span class="played-side away">${crest(x.away_team ?? '', 'sm')}<span>${esc(x.away_team ?? '')}</span></span>
        </div>
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
  const d = pick && market({
    market: pick.market, outcome: pick.outcome, line: pick.line,
    home: f.home, away: f.away, odds: pick.odds,
  });
  const k = new Date(f.kickoff * 1000);
  // 24-hour: "11:00 PM" wraps in the column, and a board is read the way a
  // fixture list is printed.
  const time = k.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
  const state = matchState(f);
  const day = dayLabel(f.kickoff);

  return `
  <a class="row ${state.kind}" href="#/fixture/${encodeURIComponent(f.id)}"
     aria-label="${esc(f.home)} versus ${esc(f.away)}">
    <div class="row-when">
      <span class="row-league" title="${esc(f.league ?? '')}">
        ${crest(f.league ?? '', 'xs', f.league_id, 'league')}
      </span>
      ${state.kind === 'upcoming'
        ? `<span class="row-time">${esc(time)}</span><span class="row-day">${esc(day)}</span>`
        : `<span class="row-time">${liveBadge(state)}</span><span class="row-day">${esc(time)}</span>`}
    </div>

    <div class="row-teams">
      <span class="row-side">${crest(f.home, 'sm', f.home_id)}<span>${esc(f.home)}</span></span>
      <span class="row-side">${crest(f.away, 'sm', f.away_id)}<span>${esc(f.away)}</span></span>
    </div>

    <div class="row-call">
      ${d ? `<div class="row-sel">${esc(d.name)}</div><p class="row-wins">${esc(d.wins)}</p>`
        : f.locked ? `<p class="row-locked">We have a call on this one.</p>`
        : `<p class="row-none">No call — the price looks about right to us.</p>`}
    </div>

    <div class="row-price">
      ${pick ? `
        <span class="odds-tile"><span class="odds">${dec(pick.odds)}</span></span>
        ${pick.bookmaker ? `<span class="odds-book">${esc(pick.bookmaker)}</span>` : ''}`
        : f.locked ? `<span class="odds-tile locked"><span class="odds-locked" aria-hidden="true">••</span></span>
                      <span class="odds-book">members</span>` : ''}
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
  } catch (err) {
    app.innerHTML = heroHTML(null, []) + `<div class="wrap section"><div class="empty">${esc(err.message)}</div></div>`;
    return;
  }
  const fixtures = board.fixtures ?? [];
  const withPicks = fixtures.filter((f) => f.top_pick);
  const top = spread(withPicks, 8);

  let recent = [];
  try { recent = (await getJSON('/api/picks?limit=40&settled=true')).picks ?? []; } catch { /* optional */ }
  const settled = recent.filter((x) => x.result && x.result !== 'VOID');
  const won = settled.filter((x) => x.result === 'WON' || x.result === 'HALF_WON').length;
  const lost = settled.filter((x) => x.result === 'LOST' || x.result === 'HALF_LOST').length;

  // Grounds hosting today's games, strongest call first. The browser works down
  // the list until one has a photograph, so the masthead is always a real
  // stadium with a real fixture in it tonight.
  state.heroVenue = [...top, ...fixtures].map((f) => f.venue_id).filter(Boolean);

  app.innerHTML =
    heroHTML(state.hero, state.heroVenue) +
    nextRailHTML(fixtures.filter((f) => f.id !== state.hero?.fixture_id)) +
    `<div class="wrap section dense">
       <div class="with-side">
         <div class="stack" style="gap:var(--space-9)">
           ${promoHTML(state.user)}
           <div>
             <div class="section-head">
               <div><h2 class="display">How the last ${settled.length} went</h2></div>
               <a class="btn btn-ghost btn-sm" href="#/results">The full record</a>
             </div>
             ${formBarHTML(won, settled.length - won - lost, lost, ['won', 'void', 'lost'])}
             ${playedHTML(settled.slice(0, 8))}
           </div>
         </div>
         ${sideHTML(top)}
       </div>
     </div>`;
}

/**
 * A back link.
 *
 * It used to be the character `←` typed into the label, which is the same
 * mistake as `→` on a call to action: a glyph doing an icon's job, at whatever
 * size and weight the text around it happens to be, with a screen reader
 * announcing "left arrow back to the board".
 */
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
  if (params.has('show')) state.show = params.get('show') === 'all' ? 'all' : 'calls';

  app.innerHTML = `<div class="wrap section dense">
    <div class="rows">${'<div class="skeleton skeleton-row"></div>'.repeat(8)}</div>
  </div>`;
  let board;
  try { board = await loadBoard(); } catch (err) {
    app.innerHTML = `<div class="wrap section"><div class="empty">${esc(err.message)}</div></div>`;
    return;
  }
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
  const kickoffs = fixtures.map((f) => f.kickoff).filter(Boolean);
  const furthest = kickoffs.length ? Math.max(...kickoffs) : null;
  const capped = furthest !== null && furthest < Date.now() / 1000 + (state.hours - 6) * 3600;

  app.innerHTML = `
  <div class="wrap section dense">
    <div class="section-head">
      <div>
        <h2 class="display">The board</h2>
        <p>${fixtures.filter((f) => f.top_pick || f.locked).length} calls across ${fixtures.length} games.${
          furthest ? ` The last of them kicks off ${esc(dayLabel(furthest).toLowerCase())}.` : ''}</p>
      </div>
      <div class="filters">
        <div class="seg" role="group" aria-label="What to show">
          <button type="button" data-show="calls"${state.show === 'calls' ? ' class="on"' : ''}>With a call</button>
          <button type="button" data-show="all"${state.show === 'all' ? ' class="on"' : ''}>Everything</button>
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

  const paint = () => {
    let shown = state.leagueName ? fixtures.filter((f) => f.league === state.leagueName) : fixtures;
    if (state.show === 'calls') shown = shown.filter((f) => f.top_pick || f.locked);
    document.getElementById('grid').innerHTML =
      shown.length
        ? shown.map(rowHTML).join('')
        : `<div class="empty-state"><b>No calls here right now</b>
             <span>We would rather say nothing than pad the board. Switch to
             Everything to see the games we are passing on.</span></div>`;
  };

  for (const b of app.querySelectorAll('.seg button')) {
    b.onclick = () => {
      state.show = b.dataset.show;
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
function lockedHTML() {
  return `
  <div class="locked">
    <div class="locked-body">
      <b>The call is for members.</b>
      <p>Which market, which side, the price and the bookmaker offering it.
         The reading of the match above stays free, always.</p>
    </div>
    <a class="btn btn-accent" href="#/pricing">See what membership costs</a>
  </div>`;
}

function verdictHTML(v, home, away) {
  // A free copy keeps the narrative and drops the selection, so a verdict can
  // arrive with everything except the thing being sold.
  if (!v.candidate) {
    return `
    <div class="verdict">
      ${v.narrative ? `<p class="narrative">${esc(v.narrative)}</p>` : ''}
      ${lockedHTML()}
    </div>`;
  }

  const c = v.candidate;
  const d = market({
    market: c.market, outcome: c.outcome, line: c.line,
    home, away, odds: c.odds,
  });

  return `
  <div class="verdict">
    <div class="verdict-head">
      <span class="sel">${esc(d.name)}</span>
      <span class="price">${dec(c.odds)}</span>
    </div>
    <p class="wins">${esc(d.wins)}</p>
    <p class="narrative">${esc(v.narrative)}</p>
    <div class="verdict-meta">
      ${c.bookmaker ? `<span>Best price at <b>${esc(c.bookmaker)}</b></span>` : ''}
      <span>${esc(d.returns)}</span>
    </div>
    ${d.outcomes?.length ? `
      <details class="settles">
        <summary>How this settles</summary>
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

  const player = (p) => `
    <div class="pp" title="${esc(p.name)}">
      ${crest(p.name, 'md', p.id, 'player')}
      <span class="pp-name">${esc((p.name ?? '').split(' ').slice(-1)[0])}</span>
    </div>`;

  const half = (side, teamName, teamId, flip) => `
    <div class="pitch-half${flip ? ' flip' : ''}">
      <div class="pitch-head">${crest(teamName, 'sm', teamId)}<b>${esc(teamName)}</b>
        ${side.formation ? `<span class="formation">${esc(side.formation)}</span>` : ''}</div>
      ${rowsFor(side).map((row) => `<div class="pitch-row">${row.map(player).join('')}</div>`).join('')}
    </div>`;

  const out = (lineups.unavailable ?? []).filter((u) => u.name);
  return `
  <div class="panel">
    <p class="panel-head">Team sheet <span>${esc(lineups.status === 'confirmed' ? 'confirmed' : 'predicted')}</span></p>
    <div class="pitch">
      ${half(lineups.home, home, homeId, false)}
      <div class="pitch-mid"></div>
      ${half(lineups.away, away, awayId, true)}
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

async function viewFixture(id) {
  app.innerHTML = '<div class="wrap section"><div class="spinner">Loading…</div></div>';
  let f;
  try { f = await getJSON(`/api/fixture/${id}`); } catch (err) {
    app.innerHTML = `<div class="wrap section">${backHTML('Back')}<div class="empty">${esc(err.message)}</div></div>`;
    app.querySelector('.back').onclick = () => { location.hash = '#/board'; };
    return;
  }

  const p = f.odds_1x2 ?? {};
  const verdicts = f.verdicts ?? [];
  const NOTHING = /^(not a|no |neither side holds a clear|conditions are unremarkable|the sharp book and the wider market agree|the line has barely moved|scoring about what their chances are worth)/i;
  const reads = (f.ledger ?? [])
    .filter((x) => x.state === 'COMPUTED' && READ_LABEL[x.id] && x.note && !NOTHING.test(x.note))
    .map((x) => ({ label: READ_LABEL[x.id], note: x.note }))
    .filter((x, i, arr) => arr.findIndex((y) => y.note === x.note) === i);

  // The provider hands back round labels already joined with a middle dot
  // ("Regular season · Matchday 4"), which is the meta-string tell arriving
  // from outside. Split it back into its parts and let the one join rule below
  // decide how they are set.
  const meta = [
    kickoffLabel(f.kickoff),
    ...String(f.round_label || f.league || '').split(/\s*·\s*/).filter(Boolean),
    f.neutral ? 'neutral ground' : null,
  ].filter(Boolean);

  const overview = `
    <div class="grid-2">
      <div>
        <div class="panel">
          <p class="panel-head">${verdicts.length ? 'The call' : 'No call'}</p>
          ${verdicts.length
            ? verdicts.map((v) => verdictHTML(v, f.home, f.away)).join('')
            : `<p class="narrative">${esc(f.pass ?? 'Nothing here is worth a call. The price looks about right.')}</p>`}
        </div>
        ${reads.length ? `<div class="panel">
          <p class="panel-head">What we looked at</p>
          <div class="reads">${reads.map((r) => `<div class="read"><b>${esc(r.label)}</b><p>${esc(r.note)}</p></div>`).join('')}</div>
        </div>` : ''}
      </div>
      <div>
        <div class="panel">
          <p class="panel-head">How we see it</p>
          <div class="bars">${bar(f.home, p.HOME)}${bar('Draw', p.DRAW)}${bar(f.away, p.AWAY)}</div>
          <div class="numbers">
            <!-- "goals expected 3.33" was expected goals with the label filed
                 off: a banned term, a number no supporter says out loud, and on
                 the page a reader lands on from an advert. What the total is
                 actually being used to say is whether the game looks open. -->
            <span>${((f.lambda?.[0] ?? 0) + (f.lambda?.[1] ?? 0)) >= 3.1 ? 'goals look likely'
                   : ((f.lambda?.[0] ?? 0) + (f.lambda?.[1] ?? 0)) <= 2.1 ? 'this one looks tight'
                   : 'an even game on paper'}</span>
            ${f.provisional ? `<span class="tag prov">line-ups not final</span>` : ''}
          </div>
        </div>
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

  app.innerHTML = `
  <section class="hero fx-top" data-shot="${f.venue_id ? 'yes' : 'none'}">
    <div class="hero-media">${venueShot(f.venue_id, '', true)}</div>
    <div class="wrap hero-inner">
      ${backHTML('Back to the board')}
      <div class="hero-copy">
        <span class="timechip${isSoon(f.kickoff) ? ' soon' : ''}">${esc(kickoffLabel(f.kickoff))}</span>
        <div class="fx-stack">
          <span class="fx-line">
            ${crest(f.home, 'md', f.home_id)}
            <span class="name">${esc(f.home)}</span>
            ${formChips(f.form?.home)}
          </span>
          <span class="fx-line">
            ${crest(f.away, 'md', f.away_id)}
            <span class="name">${esc(f.away)}</span>
            ${formChips(f.form?.away)}
          </span>
        </div>
        <p class="hero-blurb">${esc([f.league, ...meta.slice(1)].filter(Boolean).join(', '))}</p>
      </div>
    </div>
  </section>

  <div class="wrap section dense">

    ${TABS.length > 1 ? `<div class="tabs" role="tablist">
      ${TABS.map(([k, label], i) => `<button class="tab${i === 0 ? ' on' : ''}" data-tab="${k}" role="tab">${esc(label)}</button>`).join('')}
    </div>` : ''}
    ${TABS.map(([k, , html], i) => `<div class="tabpane" data-pane="${k}"${i === 0 ? '' : ' hidden'}>${html}</div>`).join('')}
  </div>`;

  app.querySelector('.back').onclick = () => {
    if (history.length > 1) history.back(); else location.hash = '#/board';
  };
  for (const t of app.querySelectorAll('.tab')) {
    t.onclick = () => {
      for (const o of app.querySelectorAll('.tab')) o.classList.toggle('on', o === t);
      for (const pane of app.querySelectorAll('.tabpane')) pane.hidden = pane.dataset.pane !== t.dataset.tab;
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
  let data;
  try { data = await getJSON('/api/picks?limit=150'); } catch (err) {
    app.innerHTML = `<div class="wrap section"><div class="empty">${esc(err.message)}</div></div>`;
    return;
  }

  const summary = data.summary ?? {};
  const picks = data.picks ?? [];
  const settled = picks.filter((x) => x.result && x.result !== 'VOID');

  // A tenner a pick, because "-6.99 units" is a sentence in a language the
  // reader does not speak. The sign is not softened: if it is down, it says
  // down, which is the entire point of publishing this page at all.
  const STAKE = 10;
  const n = Number(summary.n ?? 0);
  const wins = Number(summary.wins ?? 0);
  const profit = typeof summary.pnl === 'number' ? summary.pnl * STAKE : null;

  const money = (v) => `£${Math.abs(v).toFixed(2).replace(/\.00$/, '')}`;
  const verdict = profit === null ? ''
    : profit > 0 ? `you would be ${money(profit)} up`
    : profit < 0 ? `you would be ${money(profit)} down`
    : 'you would be exactly even';

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
  const rate = n > 0 ? Math.round((wins / n) * 100) : null;
  const headline = n === 0
    ? 'Nothing has finished yet. The first results land as today\'s games do.'
    : `${wins} of the last ${n} picks won. That is a ${rate}% strike rate.`;

  const won = settled.filter((x) => x.result === 'WON' || x.result === 'HALF_WON').length;
  const lost = settled.filter((x) => x.result === 'LOST' || x.result === 'HALF_LOST').length;
  const voided = picks.filter((x) => x.result === 'VOID' || x.result === 'PUSH').length;

  app.innerHTML = `
  <div class="wrap section">
    <div class="section-head"><div>
      <h2 class="display">Results</h2>
      <p>Every pick we have published, marked against the real result. Nothing removed, nothing hidden.</p>
    </div></div>

    <div class="record">
      <p class="record-line">${esc(headline)}</p>
      ${profit === null ? '' : `<p class="record-sub">And backing every one of them with £${STAKE}, ${esc(verdict)}.${
        profit < 0 && rate !== null && rate >= 60
          ? ' Winning most of them is not the same as making money, and the prices are why.'
          : ''}</p>`}
      ${n > 0 && n < 100
        ? `<p class="record-note">That is ${n} results. It is not enough to tell a good run from a good model, and we will say so until it is.</p>`
        : ''}
    </div>

    ${formBarHTML(won, voided, lost, ['won', 'stake back', 'lost'])}

    <div class="with-side">
      <div>
        <h2 class="side-head">Settled</h2>
        ${settled.length ? playedHTML(settled.slice(0, 40), { showOdds: true })
          : `<div class="empty-state"><b>Nothing has finished yet</b>
               <span>The first results land as today's games do.</span></div>`}
      </div>
      <aside>
        <h2 class="side-head">Still to play</h2>
        ${(() => {
          const open = picks.filter((x) => !x.result).slice(0, 12);
          if (!open.length) return `<p class="acct-line">Nothing open right now.</p>`;
          return `<div class="side-list">${open.map((x) => {
            const d = market({ market: x.market, outcome: x.outcome, line: x.line, home: x.home_team, away: x.away_team, odds: x.odds });
            return `
            <a class="side-item" href="#/fixture/${encodeURIComponent(x.fixture_id)}">
              <span class="side-thumb">${crest(x.home_team ?? '', 'sm')}${crest(x.away_team ?? '', 'sm')}</span>
              <span class="side-body">
                <span class="side-sel">${esc(d.name)}</span>
                <span class="side-meta">${esc(kickoffLabel(x.kickoff))}<b>${dec(x.odds)}</b></span>
              </span>
            </a>`;
          }).join('')}</div>`;
        })()}
      </aside>
    </div>
  </div>`;
}

// ---------------------------------------------------------------- leagues

async function viewLeagues() {
  app.innerHTML = '<div class="wrap section"><div class="spinner">Loading…</div></div>';
  const board = state.board ?? (await loadBoard());
  const fixtures = board.fixtures ?? [];
  const byLeague = new Map();
  for (const f of fixtures) {
    const k = f.league_id ?? f.league;
    const e = byLeague.get(k) ?? { name: f.league ?? '', id: f.league_id, n: 0, picks: 0, rank: f.rank ?? 6 };
    e.n++;
    e.rank = Math.min(e.rank, f.rank ?? 6);
    if (f.top_pick) e.picks++;
    byLeague.set(k, e);
  }
  const rows = [...byLeague.values()].sort((a, b) => (a.rank ?? 6) - (b.rank ?? 6) || b.n - a.n);

  app.innerHTML = `
  <div class="wrap section">
    <div class="section-head"><div>
      <h2 class="display">Leagues</h2>
      <p>${rows.length} leagues in play right now, from 88 covered.</p>
    </div></div>
    <div class="cards">
      ${rows.map((e) => `
        <a class="card" href="${esc(boardHash(state.hours, e.name))}">
          <div class="card-top"><span class="card-league">${crest(e.name, 'md', e.id, 'league')}<span>${esc(e.name)}</span></span></div>
          <div class="also">
            <span class="also-call">${e.n} <b>games</b></span>
            <span class="also-call">${e.picks} <b>calls</b></span>
          </div>
        </a>`).join('')}
    </div>
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
async function startCheckout(plan = 'monthly') {
  if (!(await currentUser())) { location.hash = '#/signin'; return; }
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
        <h2 class="display">Membership</h2>
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
        <p class="plan-note">Thirty days. Cancel whenever you like, in one tap.</p>
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
  if (await currentUser()) { location.hash = '#/account'; return; }

  const problem = state.authError;
  state.authError = null;

  app.innerHTML = `
  <div class="wrap section narrow">
    <div class="section-head"><div>
      <h2 class="display">Sign in</h2>
      <p>No password to remember or lose. We email you a link.</p>
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

  document.getElementById('google').onclick = async (e) => {
    e.currentTarget.disabled = true;
    try { await signInWithGoogle(); } catch (err) { say(err.message, true); e.currentTarget.disabled = false; }
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
      say(err.message, true);
      button.disabled = false;
    }
  };
}

/** The account: what you have, what it costs, and how to stop it. */
async function viewAccount() {
  const user = await currentUser();
  if (!user) { location.hash = '#/signin'; return; }

  app.innerHTML = '<div class="wrap section narrow"><div class="spinner">Loading…</div></div>';
  let account = { membership: null, receipts: [] };
  try { account = await getJSON('/api/account'); } catch { /* shown as no membership */ }

  const m = account.membership;
  const active = m && m.expires_at * 1000 > Date.now();
  const when = (e) => new Date(e * 1000).toLocaleDateString([], { day: 'numeric', month: 'long', year: 'numeric' });

  app.innerHTML = `
  <div class="wrap section narrow">
    <div class="section-head"><div>
      <h2 class="display">Your account</h2>
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

  document.getElementById('out').onclick = async () => { await signOut(); location.hash = '#/home'; };
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
      <p>Questions about this policy can be sent to the address on our contact page.</p>`,
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
      <p>A membership runs for thirty days from the day you pay. If you have turned renewal on, we
         charge the same card again on the day it runs out, at the price shown on the membership
         page at that time; we will tell you before any price changes. You can stop renewal at any
         time from your account page, in one tap, and keep the access you have already paid for
         until it runs out.</p>
      <p>Because this is digital content delivered immediately, you are asked at checkout to agree
         that it starts straight away. Doing so ends the 14-day right to cancel that would otherwise
         apply under UK consumer law. If you would rather keep that right, do not agree, and your
         access will begin after the 14 days have passed.</p>
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
      <p>Tell us within 14 days of your first payment and you can have it back, provided you agreed
         at checkout to wait rather than to start immediately. If you asked to start immediately,
         that right ends when your access begins — which is what agreeing to it means, and why we
         ask rather than assume.</p>
      <h2>If you simply want to stop</h2>
      <p>Turn renewal off on your account page. You keep what you have paid for until it runs out
         and are not charged again. We do not refund part of a month already under way, and we do
         not make you ask a person to leave.</p>
      <h2>What we will not refund</h2>
      <p><b>Losing bets.</b> Nothing here is advice to stake money and no call is a promise. Our
         record is published in full, wins and losses alike, so that is knowable before you pay
         rather than after.</p>
      <h2>How to ask</h2>
      <p>Write to the address on our contact page from the email address on the account. We answer
         every refund request, including the ones we turn down.</p>`,
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
  if (!page) {
    app.innerHTML = `<div class="wrap section"><div class="empty">Page not found.</div></div>`;
    return;
  }
  app.innerHTML = `
  <div class="wrap section">
    <div class="section-head"><div><h2 class="display">${esc(page.title)}</h2>
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
  // Analytics would be loaded here, and only here, when value === 'accepted'.
}

function cookieNotice() {
  if (readConsent()) return;
  const el = document.createElement('div');
  el.className = 'cookie';
  el.id = 'cookie-notice';
  el.innerHTML = `
    <p>We use one item of storage to remember this choice. Optional analytics load
       only if you accept — decline and nothing is loaded at all.
       <a href="#/legal/cookies">Cookie policy</a></p>
    <button class="btn btn-ghost" data-consent="declined">Decline</button>
    <button class="btn btn-primary" data-consent="accepted">Accept</button>`;
  el.addEventListener('click', (e) => {
    const v = e.target?.dataset?.consent;
    if (v) applyConsent(v);
  });
  document.body.appendChild(el);
}

// ---------------------------------------------------------------- routing

async function route() {
  const { parts, params } = parseHash();
  const name = parts[0] || 'home';
  for (const a of document.querySelectorAll('.nav a')) a.classList.toggle('on', a.dataset.route === name);
  document.getElementById('nav').classList.remove('open');
  document.getElementById('burger').setAttribute('aria-expanded', 'false');
  window.scrollTo(0, 0);
  try {
    if (name === 'fixture' && parts[1]) return await viewFixture(parts[1]);
    if (name === 'board') return await viewBoard(params);
    if (name === 'leagues') return await viewLeagues();
    if (name === 'results') return await viewResults();
    if (name === 'pricing') return await viewPricing();
    if (name === 'signin') return await viewSignin();
    if (name === 'account') return await viewAccount();
    if (name === 'legal' && parts[1]) return viewLegal(parts[1]);
    return await viewHome();
  } catch (err) {
    app.innerHTML = `<div class="wrap section"><div class="empty">${esc(err.message ?? 'Something went wrong.')}</div></div>`;
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
  const member = Boolean(state.board?.member);

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

/**
 * Boot.
 *
 * The sign-in has to be finished before the first render, not alongside it: a
 * view that reads the session while the code is still being exchanged would
 * paint the signed-out page and then not correct itself. Everything after it is
 * fire-and-forget.
 */
(async () => {
  try {
    await completeSignIn();
  } catch (err) {
    // A stale or reused magic link. Say so once, on the sign-in page, rather
    // than leaving someone looking at a home page wondering what happened.
    state.authError = err.message ?? 'That sign-in link did not work.';
    location.hash = '#/signin';
  }
  await route();
  health();
  headerAuth();
  cookieNotice();
})();
