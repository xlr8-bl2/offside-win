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

const app = document.getElementById('app');

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = (v, dp = 0) => (typeof v === 'number' && isFinite(v) ? `${(v * 100).toFixed(dp)}%` : '—');
const dec = (v) => (typeof v === 'number' && isFinite(v) ? v.toFixed(2) : '—');

async function getJSON(path) {
  const res = await fetch(path);
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
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === now.toDateString()) return `Today ${time}`;
  if (new Date(now.getTime() + 864e5).toDateString() === d.toDateString()) return `Tomorrow ${time}`;
  return `${d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })} ${time}`;
}
const isSoon = (epoch) => epoch && epoch * 1000 - Date.now() < 6 * 3600e3;

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

const state = { board: null, hours: 72, leagueName: '', heroVenue: [], hero: null };

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

function heroHTML(hero = null, venueIds = []) {
  const queue = hero?.venue_id ? [hero.venue_id, ...venueIds] : [].concat(venueIds).filter(Boolean);
  const kicker = hero?.kicker ?? '88 leagues · every day';

  // With a fixture chosen, the masthead is about tonight's game. Without one —
  // an empty board, a failed slate — it falls back to the standing headline
  // rather than to an empty stage.
  // Long club names have to be allowed to shrink. "RSC Anderlecht v Olympique
  // Lyonnais" at the size "Arsenal v Everton" wants filled the whole viewport and
  // pushed the buttons off the bottom of it.
  const longest = hero ? Math.max(hero.home.length, hero.away.length) : 0;
  const size = longest > 20 ? '3.1vw' : longest > 14 ? '4vw' : '5.2vw';

  const body = hero
    ? `<h1 class="display hero-fx" style="--fx: clamp(1.9rem, ${size}, 4.6rem)">
         <span>${esc(hero.home)}</span>
         <em>vs</em>
         <span>${esc(hero.away)}</span>
       </h1>
       <p class="lede">${esc(hero.league)} · ${esc(kickoffLabel(hero.kickoff))}. Our call, and the reasons behind it.</p>
       <div class="hero-cta">
         <a class="btn btn-primary btn-lg" href="#/fixture/${encodeURIComponent(hero.fixture_id)}">Read the analysis
           <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12h14M13 6l6 6-6 6"/></svg></a>
         <a class="btn btn-ghost btn-lg" href="#/board">All of today's picks</a>
       </div>`
    : `<h1 class="display">The picks for the <em>biggest</em> games.</h1>
       <p class="lede">Every call comes with the reason behind it. And the reason not to like it.</p>
       <div class="hero-cta">
         <a class="btn btn-primary btn-lg" href="#/board">Today's picks
           <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12h14M13 6l6 6-6 6"/></svg></a>
         <a class="btn btn-ghost btn-lg" href="#/results">See the results</a>
       </div>`;

  return `
  <section class="hero" data-shot="${queue.length ? 'yes' : 'none'}">
    <div class="hero-media">${venueShot(queue, '', true)}</div>
    <div class="hero-inner">
      <p class="kicker">${esc(kicker)}</p>
      ${body}
      <p class="script hero-script">Same games.<br>Better picks.</p>
      ${hero
        ? `<div class="hero-badges">
             ${crest(hero.home, 'xl', hero.home_id)}
             <span class="hero-vs">V</span>
             ${crest(hero.away, 'xl', hero.away_id)}
           </div>`
        : ''}
    </div>
  </section>
  <div class="trust"><div class="trust-inner">
    ${[
      ['88 leagues', 'Europe, the Americas, Asia'],
      ['Updated every 15 minutes', 'Prices and team news'],
      ['Every pick explained', 'Including what argues against it'],
      ['Full results published', 'Won and lost, nothing hidden'],
    ].map(([t, sub]) => `<div class="trust-item"><b>${esc(t)}</b><span>${esc(sub)}</span></div>`).join('')}
  </div></div>`;
}

function railHTML(fixtures) {
  const byLeague = new Map();
  for (const f of fixtures) {
    const k = f.league_id ?? f.league;
    const e = byLeague.get(k) ?? { name: f.league ?? '', id: f.league_id, n: 0, rank: f.rank ?? 6 };
    e.n++;
    e.rank = Math.min(e.rank, f.rank ?? 6);
    byLeague.set(k, e);
  }
  // By prominence, not by fixture count — otherwise the rail opens on whichever
  // minor division happens to have the fullest card that day.
  const top = [...byLeague.values()]
    .sort((a, b) => (a.rank ?? 6) - (b.rank ?? 6) || b.n - a.n)
    .slice(0, 16);
  if (!top.length) return '';
  return `
  <div class="rail"><div class="rail-inner">
    <span class="rail-label">On today</span>
    ${top.map((l) => `<a class="rail-item" href="#/board">${crest(l.name, 'sm', l.id, 'league')}<b>${esc(l.name)}</b><span class="count">${l.n}</span></a>`).join('')}
  </div></div>`;
}


/**
 * A pick, and the only four things a reader gets: what it is, what has to
 * happen, the price, and who is offering it.
 *
 * No class tag, no percentage, no meter. Those were our filing system and our
 * scoring leaking onto the page; see engine/src/vocabulary.ts.
 */
function pickHTML(pick, f) {
  const d = market({
    market: pick.market, outcome: pick.outcome, line: pick.line,
    home: f.home, away: f.away, odds: pick.odds,
  });
  return `
  <div class="card-pick">
    <span class="sel">${esc(d.name)}</span>
    <p class="wins">${esc(d.wins)}</p>
    <div class="pick-meta">
      <span class="price">${dec(pick.odds)}</span>
      ${pick.bookmaker ? `<span class="book">at ${esc(pick.bookmaker)}</span>` : ''}
      <span class="ret">${esc(d.returns)}</span>
    </div>
  </div>`;
}

function cardHTML(f) {
  const pick = f.top_pick;
  // top_pick is the first confident call, so the rest start at one.
  const extra = (f.confident ?? []).slice(pick ? 1 : 0).slice(0, 2);
  return `
  <article class="card" data-id="${f.id}" tabindex="0" role="link" aria-label="${esc(f.home)} versus ${esc(f.away)}">
    <div class="card-top">
      <span class="card-league">${crest(f.league ?? '', 'sm', f.league_id, 'league')}<span>${esc(f.league ?? '')}</span></span>
      <span class="card-kick${isSoon(f.kickoff) ? ' soon' : ''}">${esc(kickoffLabel(f.kickoff))}</span>
    </div>

    <div class="vs">
      <div class="vs-side">${crest(f.home, 'lg', f.home_id)}<span>${esc(f.home)}</span></div>
      <span class="vs-mark">vs</span>
      <div class="vs-side">${crest(f.away, 'lg', f.away_id)}<span>${esc(f.away)}</span></div>
    </div>

    ${pick ? pickHTML(pick, f) : `<div class="card-pick none">
           <b>No call here</b>
           <span>The price looks about right to us. We would rather say nothing than pad the board.</span>
         </div>`}
    ${extra.length
      ? `<div class="also">${extra.map((c) => {
           const d = market({ market: c.market, outcome: c.outcome, line: c.line, home: f.home, away: f.away, odds: c.odds });
           return `<span class="also-call">${esc(d.name)} <b>${dec(c.odds)}</b></span>`;
         }).join('')}</div>`
      : ''}
    <span class="card-go">Read the analysis →</span>
  </article>`;
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

function bandHTML(sample) {
  if (!sample) return '';
  const { fixture, verdict } = sample;
  return `
  <section class="band" data-shot="${fixture.venue_id ? 'yes' : 'none'}">
    <div class="band-media">${venueShot(fixture.venue_id, '')}</div>
    <div class="band-inner">
      <div>
        <p class="eyebrow">Why ours</p>
        <h2 class="display">Anyone can pick<br>a favourite.</h2>
        <p class="lede" style="margin-top:20px">
          The hard part is saying why — and saying what the pick has going against it.
          That is on every call here.
        </p>
        <ul class="points">
          <li><span class="n">01</span><div><b>The case, in plain English</b><span>Form, team news, rest, what the game is worth. Written out, not hidden behind a number.</span></div></li>
          <li><span class="n">02</span><div><b>The catch, out loud</b><span>When something argues against the pick, we print it. Nobody else does.</span></div></li>
          <li><span class="n">03</span><div><b>What it actually pays</b><span>A big strike rate at short odds is not a win. The return is always on the card.</span></div></li>
        </ul>
      </div>
      <div class="reason">
        <div class="qmeta">
          ${crest(fixture.home, 'sm', fixture.home_id)}
          <b style="color:var(--ink);font-weight:700">${esc(fixture.home)} v ${esc(fixture.away)}</b>
          <span class="qodds">${dec(verdict.candidate?.odds ?? verdict.odds)}</span>
        </div>
        ${esc(verdict.narrative)}
      </div>
    </div>
  </section>`;
}

function stripHTML(picks) {
  const done = picks.filter((x) => x.result && x.result !== 'VOID').slice(0, 12);
  if (!done.length) return '';
  return `
  <div class="strip"><div class="strip-inner">
    <span class="rail-label">Recent results</span>
    ${done.map((x) => {
      const won = x.result === 'WON' || x.result === 'HALF_WON';
      return `<span class="res">${crest(x.home_team ?? '', 'sm')}<span>${esc(x.home_team ?? '')} v ${esc(x.away_team ?? '')}</span>
        <span class="score">${dec(x.odds)}</span><span class="mark ${won ? 'w' : 'l'}">${won ? '✓' : '✕'}</span></span>`;
    }).join('')}
  </div></div>`;
}

async function sampleNarrative(candidates) {
  for (const f of candidates.slice(0, 5)) {
    try {
      const full = await getJSON(`/api/fixture/${f.id}`);
      const v = (full.verdicts ?? []).find((x) => x.narrative && x.narrative.length > 150);
      if (v) return { fixture: full, verdict: v };
    } catch { /* next */ }
  }
  return null;
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
  try { recent = (await getJSON('/api/picks?limit=40&settled=true')).picks ?? []; } catch { /* strip is optional */ }

  // Grounds hosting today's games, strongest call first. The browser works down
  // the list until one has a photograph, so the masthead is always a real
  // stadium with a real fixture in it tonight.
  state.heroVenue = [...top, ...fixtures].map((f) => f.venue_id).filter(Boolean);

  app.innerHTML =
    heroHTML(state.hero, state.heroVenue) +
    railHTML(fixtures) +
    `<div class="wrap section">
       <div class="section-head">
         <div>
           <h2 class="display">Today's top picks</h2>
           <p>${withPicks.length} calls across ${new Set(fixtures.map((f) => f.league)).size} leagues.</p>
         </div>
         <a class="btn btn-ghost" href="#/board">All ${fixtures.length} games</a>
       </div>
       ${top.length ? `<div class="cards">${top.map(cardHTML).join('')}</div>`
                    : `<div class="empty">Nothing worth calling right now. Check back shortly.</div>`}
     </div>` +
    stripHTML(recent) +
    bandHTML(await sampleNarrative(top)) +
    statsHTML(fixtures, recent) +
    leaguesHTML(fixtures) +
    closingHTML();

  wireCards();
}

/**
 * Four figures, all of them true.
 *
 * The reference designs lead on "500K+ active users" and "78% average prediction
 * accuracy". We have neither, and inventing them on a page that will eventually
 * take money is not a shortcut worth taking. These are read from the board and
 * the ledger, and they say enough.
 */
function statsHTML(fixtures, recent) {
  const calls = fixtures.filter((f) => f.top_pick).length;
  const settled = recent.filter((x) => x.result && x.result !== 'VOID').length;
  const items = [
    ['88', 'Leagues covered'],
    [String(fixtures.length), 'Games on the board'],
    [String(calls), 'Calls live right now'],
    [settled ? String(settled) : 'All', settled ? 'Results settled' : 'Picks published'],
  ];
  return `
  <section class="statband"><div class="wrap">
    <div class="statgrid">
      ${items.map(([b, l]) => `<div class="statcell"><b>${esc(b)}</b><span>${esc(l)}</span></div>`).join('')}
    </div>
  </div></section>`;
}

function leaguesHTML(fixtures) {
  const byLeague = new Map();
  for (const f of fixtures) {
    const k = f.league_id ?? f.league;
    const e = byLeague.get(k) ?? { name: f.league ?? '', id: f.league_id, n: 0, rank: f.rank ?? 6 };
    e.n++;
    e.rank = Math.min(e.rank, f.rank ?? 6);
    byLeague.set(k, e);
  }
  const rows = [...byLeague.values()]
    .sort((a, b) => (a.rank ?? 6) - (b.rank ?? 6) || b.n - a.n)
    .slice(0, 12);
  if (!rows.length) return '';
  return `
  <div class="wrap section">
    <div class="section-head">
      <div><h2 class="display">Every league that matters</h2>
      <p>From the Champions League down. ${rows.length} in play right now, 88 covered.</p></div>
      <a class="btn btn-ghost" href="#/leagues">All leagues</a>
    </div>
    <div class="lgrid">
      ${rows.map((e) => `
        <a class="lcard" href="#/board" data-league="${esc(e.name)}">
          ${crest(e.name, 'lg', e.id, 'league')}
          <b>${esc(e.name)}</b>
          <span>${e.n} ${e.n === 1 ? 'game' : 'games'}</span>
        </a>`).join('')}
    </div>
  </div>`;
}

function closingHTML() {
  return `
  <section class="closing"><div class="wrap closing-in">
    <div>
      <p class="script" style="margin:0 0 4px">Your next win</p>
      <h2 class="display">is one pick away.</h2>
    </div>
    <a class="btn btn-primary btn-lg" href="#/board">See today's board
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12h14M13 6l6 6-6 6"/></svg></a>
  </div></section>`;
}

// ------------------------------------------------------------------ board

async function viewBoard() {
  app.innerHTML = '<div class="wrap section"><div class="spinner">Loading the board…</div></div>';
  let board;
  try { board = await loadBoard(); } catch (err) {
    app.innerHTML = `<div class="wrap section"><div class="empty">${esc(err.message)}</div></div>`;
    return;
  }
  const fixtures = board.fixtures ?? [];
  const leagues = [...new Set(fixtures.map((f) => f.league).filter(Boolean))].sort();

  app.innerHTML = `
  <div class="wrap section">
    <div class="section-head">
      <div>
        <h2 class="display">The board</h2>
        <p>${fixtures.length} games · ${fixtures.filter((f) => f.top_pick).length} with a call.</p>
      </div>
      <div class="filters">
        <select id="hours-filter" aria-label="Time window">
          ${[24, 48, 72, 120, 240].map((h) => `<option value="${h}"${h === state.hours ? ' selected' : ''}>Next ${h}h</option>`).join('')}
        </select>
        <select id="league-filter" aria-label="League">
          <option value="">All leagues</option>
          ${leagues.map((l) => `<option${l === state.leagueName ? ' selected' : ''}>${esc(l)}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="cards" id="grid"></div>
  </div>`;

  const paint = () => {
    const shown = state.leagueName ? fixtures.filter((f) => f.league === state.leagueName) : fixtures;
    document.getElementById('grid').innerHTML =
      shown.length ? shown.map(cardHTML).join('') : '<div class="empty">Nothing in this league right now.</div>';
    wireCards();
  };
  document.getElementById('hours-filter').onchange = (e) => { state.hours = Number(e.target.value); viewBoard(); };
  document.getElementById('league-filter').onchange = (e) => { state.leagueName = e.target.value; paint(); };
  paint();
}

function wireCards() {
  for (const el of app.querySelectorAll('.card[data-id]')) {
    const go = () => { location.hash = `#/fixture/${el.dataset.id}`; };
    el.onclick = go;
    el.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } };
  }
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
function verdictHTML(v, home, away) {
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
    <p class="panel-head">Team sheet · ${esc(lineups.status === 'confirmed' ? 'confirmed' : 'predicted')}</p>
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
  const two = (d) => Number(d ?? 0).toFixed(2);

  const rows = [
    ['points a game', h?.ppg, a?.ppg, two],
    ['goals scored', h?.goals_for, a?.goals_for, one],
    ['goals conceded', h?.goals_against, a?.goals_against, one],
    ['clean sheets', h?.clean_sheets, a?.clean_sheets, (d) => String(Math.round(Number(d ?? 0)))],
  ].filter(([, hv, av]) => typeof hv === 'number' || typeof av === 'number');

  // "1.83 a game at home" against "0.90 a game on the road" — the travel read.
  const splits = [
    typeof h?.venue_ppg === 'number' && h.venue_matches >= 2
      ? `${esc(home)} take <b>${two(h.venue_ppg)}</b> a game at home`
      : null,
    typeof a?.venue_ppg === 'number' && a.venue_matches >= 2
      ? `${esc(away)} take <b>${two(a.venue_ppg)}</b> a game on the road`
      : null,
  ].filter(Boolean);

  const runOf = (ev) => {
    if (!ev || !ev.streak_kind || ev.streak_kind === 'none' || !ev.streak_length) return '';
    const word = { won: 'won', unbeaten: 'unbeaten in', lost: 'lost', winless: 'winless in' }[ev.streak_kind];
    return word ? `<span class="run">${esc(word)} ${ev.streak_length}</span>` : '';
  };

  return `
  <div class="panel">
    <p class="panel-head">Form · last ${Math.max(h?.matches ?? 0, a?.matches ?? 0)}</p>
    <div class="form-top">
      <div class="form-side">${formChips(h)}${runOf(h)}</div>
      <div class="form-side right">${runOf(a)}${formChips(a)}</div>
    </div>
    ${rows.map(([label, hv, av, fmt]) => statBar(label, hv ?? 0, av ?? 0, fmt)).join('')}
    ${splits.length ? `<p class="form-split">${splits.join(' · ')}</p>` : ''}
  </div>`;
}

function h2hHTML(h2h, home, away) {
  if (!h2h || !h2h.total_matches) return '';
  const recent = (h2h.recent_matches ?? []).slice(0, 6);
  return `
  <div class="panel">
    <p class="panel-head">Head to head · ${h2h.total_matches} meetings</p>
    ${statBar(`${home} wins · draws · ${away} wins`, h2h.home_wins ?? 0, h2h.away_wins ?? 0)}
    <div class="numbers" style="margin-top:14px">
      <span>${esc(home)} <b>${h2h.home_wins ?? 0}</b></span>
      <span>drawn <b>${h2h.draws ?? 0}</b></span>
      <span>${esc(away)} <b>${h2h.away_wins ?? 0}</b></span>
      ${typeof h2h.avg_total_goals === 'number' ? `<span>goals a game <b>${h2h.avg_total_goals.toFixed(2)}</b></span>` : ''}
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
    <p class="panel-head">In the table${st.size ? ` · ${st.size} teams` : ''}</p>
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
    app.innerHTML = `<div class="wrap section"><button class="back">← Back</button><div class="empty">${esc(err.message)}</div></div>`;
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

  const meta = [
    kickoffLabel(f.kickoff),
    f.round_label || f.league,
    f.neutral ? 'Neutral ground' : null,
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
          <div class="numbers" style="margin-top:18px">
            <span>goals expected <b>${dec((f.lambda?.[0] ?? 0) + (f.lambda?.[1] ?? 0))}</b></span>
            ${f.provisional ? `<span class="tag prov" style="padding:7px 12px">line-ups not final</span>` : ''}
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
    ['lineups', 'Line-ups', pitchHTML(f.lineups, f.home, f.away, f.home_id, f.away_id)],
    ['h2h', 'Head to head', h2hHTML(f.h2h, f.home, f.away)],
    ['table', 'Table', standingsHTML(f.standings, f.home, f.away, f.home_id, f.away_id)],
  ].filter(([, , html]) => html);

  app.innerHTML = `
  <div class="wrap section tight">
    <button class="back">← Back to the board</button>

    <div class="fx-hero" data-shot="${f.venue_id ? 'yes' : 'none'}">
      <div class="fx-hero-media">${venueShot(f.venue_id, '')}</div>
      <div class="fx-hero-in">
        <p class="kicker">${esc(f.league ?? '')}</p>
        <div class="fx-teams">
          <div class="fx-side">
            ${crest(f.home, 'xl', f.home_id)}
            <span class="name">${esc(f.home)}</span>
            ${formChips(f.form?.home)}
          </div>
          <div class="fx-mid">
            <div class="fx-when">${esc(kickoffLabel(f.kickoff))}</div>
            <div class="fx-league">${meta.slice(1).map(esc).join(' · ')}</div>
          </div>
          <div class="fx-side">
            ${crest(f.away, 'xl', f.away_id)}
            <span class="name">${esc(f.away)}</span>
            ${formChips(f.form?.away)}
          </div>
        </div>
      </div>
    </div>

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

  const headline = n === 0
    ? 'Nothing has finished yet. The first results land as today\'s games do.'
    : `Of the last ${n} picks, ${wins} won.`;

  app.innerHTML = `
  <div class="wrap section">
    <div class="section-head"><div>
      <h2 class="display">Results</h2>
      <p>Every pick we have published, marked against the real result. Nothing removed, nothing hidden.</p>
    </div></div>

    <div class="record">
      <p class="record-line">${esc(headline)}</p>
      ${profit === null ? '' : `<p class="record-sub">Backing every one of them with £${STAKE}, ${esc(verdict)}.</p>`}
      ${n > 0 && n < 100
        ? `<p class="record-note">That is ${n} results. It is not enough to tell a good run from a good model, and we will say so until it is.</p>`
        : ''}
    </div>

    ${picks.length ? `<div class="scroll-x"><table class="tbl">
      <thead><tr><th>Game</th><th>Call</th><th class="num">Odds</th><th class="num">Result</th></tr></thead>
      <tbody>${picks.map((x) => {
        const d = market({ market: x.market, outcome: x.outcome, line: x.line, home: x.home_team, away: x.away_team, odds: x.odds });
        return `
        <tr>
          <td>${x.home_team ? `${esc(x.home_team)} v ${esc(x.away_team)}` : '—'}</td>
          <td>${esc(d.name)}</td>
          <td class="num">${dec(x.odds)}</td>
          <td class="num">${resultTag(x.result)}</td>
        </tr>`;
      }).join('')}</tbody></table></div>`
      : `<div class="empty">Nothing published yet.</div>`}

    ${settled.length === 0 && picks.length > 0
      ? `<p class="foot-note" style="margin-top:20px">${picks.length} are still to play.</p>` : ''}
  </div>`;
}

/** Won, lost, or the stake came back — said the way it happened. */
function resultTag(result) {
  if (!result) return '<span class="pending">To play</span>';
  const map = {
    WON: ['won', 'Won'],
    HALF_WON: ['won', 'Won half'],
    LOST: ['lost', 'Lost'],
    HALF_LOST: ['lost', 'Lost half'],
    PUSH: ['void', 'Stake back'],
    VOID: ['void', 'Void'],
  };
  const [cls, label] = map[result] ?? ['void', result[0] + result.slice(1).toLowerCase()];
  return `<span class="tag ${cls}">${esc(label)}</span>`;
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
        <article class="card" data-league="${esc(e.name)}" tabindex="0">
          <div class="card-top"><span class="card-league">${crest(e.name, 'md', e.id, 'league')}<span style="font-size:0.95rem;color:var(--ink);font-weight:600">${esc(e.name)}</span></span></div>
          <div class="also">
            <span class="also-call">${e.n} <b>games</b></span>
            <span class="also-call">${e.picks} <b>calls</b></span>
          </div>
        </article>`).join('')}
    </div>
  </div>`;

  for (const el of app.querySelectorAll('[data-league]')) {
    el.onclick = () => { state.leagueName = el.dataset.league; location.hash = '#/board'; };
  }
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
      <p><b>Nothing that identifies you, unless you give it to us.</b> There is no account to
         create and no form to fill in, so we hold no name, email address or payment detail.</p>
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
        <li>Send you email, because we do not have your address.</li>
      </ul>
      <h2>Third parties</h2>
      <p>Pages load club crests, league marks and stadium photographs from our data provider, and
         fonts from Google Fonts. Those requests reach their servers and are subject to their own
         policies. Match and odds data comes from our provider; none of your information is sent to
         them.</p>
      <h2>Your rights</h2>
      <p>Where the UK GDPR or EU GDPR applies you may ask what we hold, ask for it to be corrected
         or deleted, and complain to your data protection authority. Since we hold no personal data
         beyond server logs, most such requests will be answered by telling you exactly that.</p>
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
      <h2>Changes</h2>
      <p>These terms may change. The date below shows when they were last revised.</p>`,
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
  const parts = (location.hash || '#/home').slice(2).split('/');
  const name = parts[0] || 'home';
  for (const a of document.querySelectorAll('.nav a')) a.classList.toggle('on', a.dataset.route === name);
  document.getElementById('nav').classList.remove('open');
  document.getElementById('burger').setAttribute('aria-expanded', 'false');
  window.scrollTo(0, 0);
  try {
    if (name === 'fixture' && parts[1]) return await viewFixture(parts[1]);
    if (name === 'board') return await viewBoard();
    if (name === 'leagues') return await viewLeagues();
    if (name === 'results') return await viewResults();
    if (name === 'legal' && parts[1]) return viewLegal(parts[1]);
    return await viewHome();
  } catch (err) {
    app.innerHTML = `<div class="wrap section"><div class="empty">${esc(err.message ?? 'Something went wrong.')}</div></div>`;
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
route();
health();
cookieNotice();
