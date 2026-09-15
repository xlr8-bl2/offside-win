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

// ---------------------------------------------------------------- markets

const OUTCOME_WORD = {
  HOME: 'Home win', DRAW: 'Draw', AWAY: 'Away win',
  '1X': 'Home or draw', '12': 'Home or away', X2: 'Draw or away',
  over: 'Over', under: 'Under', yes: 'Yes', no: 'No',
};

function marketLabel(market, outcome, line, home, away) {
  const o = OUTCOME_WORD[outcome] ?? outcome;
  switch (market) {
    case '1x2':
      if (outcome === 'HOME' && home) return `${home} to win`;
      if (outcome === 'AWAY' && away) return `${away} to win`;
      return o;
    case 'double_chance':
      if (outcome === '1X' && home) return `${home} to win or draw`;
      if (outcome === 'X2' && away) return `${away} to win or draw`;
      if (outcome === '12') return 'Either team to win';
      return o;
    case 'draw_no_bet': return `${outcome === 'HOME' ? home ?? 'Home' : away ?? 'Away'} — draw no bet`;
    case 'btts': return `Both teams to score — ${o.toLowerCase()}`;
    case 'over_under_05': case 'over_under_15': case 'over_under_25': case 'over_under_35':
      return `${o} ${line ?? ''} goals`.replace(/\s+/g, ' ').trim();
    case 'total_corners': return `${o} ${line ?? ''} corners`.trim();
    case 'asian_handicap': return `${outcome === 'HOME' ? home ?? 'Home' : away ?? 'Away'} ${line > 0 ? '+' : ''}${line}`;
    case 'european_handicap': return `${outcome} ${line > 0 ? '+' : ''}${line}`;
    case 'total_red_cards': return `${o} ${line ?? ''} red cards`.trim();
    case 'red_card': return `A red card — ${o.toLowerCase()}`;
    default: return `${o} ${line ?? ''}`.trim();
  }
}

const KIND_TAG = { VALUE: 'Value', LIKELY: 'Likely', CONFIDENT: 'Call' };
const KIND_TITLE = {
  VALUE: 'The price looks wrong',
  LIKELY: 'Most likely to land',
  CONFIDENT: 'High-confidence call',
};

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

const state = { board: null, hours: 72, leagueName: '', heroVenue: null };

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
window.__shotMissing = (img) => {
  img.closest('[data-shot]')?.setAttribute('data-shot', 'none');
  img.remove();
};
// A ground with no photograph answers 200 with a 1x1 transparent PNG, so the
// load handler has to measure it. Anything that small is the placeholder.
window.__shotCheck = (img) => {
  if (img.naturalWidth < 40) window.__shotMissing(img);
};

function venueShot(venueId, className, eager = false) {
  if (!Number.isFinite(Number(venueId))) return '';
  return `<img src="${IMG_BASE}/venue/${encodeURIComponent(venueId)}/" alt="" class="${className}"
    ${eager ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async"
    onload="window.__shotCheck(this)" onerror="window.__shotMissing(this)">`;
}

function heroHTML(venueId = null) {
  return `
  <section class="hero" data-shot="${venueId ? 'yes' : 'none'}">
    <div class="hero-media">${venueShot(venueId, '', true)}</div>
    <div class="hero-inner">
      <p class="eyebrow">88 leagues · every day</p>
      <h1 class="display">The picks for the <em>biggest</em> games.</h1>
      <p class="script hero-script">Same games.<br>Better picks.</p>
      <p class="lede">
        Every call comes with the reason behind it. And the reason not to like it.
      </p>
      <div class="hero-cta">
        <a class="btn btn-primary btn-lg" href="#/board">Today's picks
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12h14M13 6l6 6-6 6"/></svg></a>
        <a class="btn btn-ghost btn-lg" href="#/results">See the results</a>
      </div>
    </div>
  </section>`;
}

function railHTML(fixtures) {
  const byLeague = new Map();
  for (const f of fixtures) {
    const k = f.league_id ?? f.league;
    const e = byLeague.get(k) ?? { name: f.league ?? '', id: f.league_id, n: 0 };
    e.n++;
    byLeague.set(k, e);
  }
  const top = [...byLeague.values()].sort((a, b) => b.n - a.n).slice(0, 16);
  if (!top.length) return '';
  return `
  <div class="rail"><div class="rail-inner">
    <span class="rail-label">On today</span>
    ${top.map((l) => `<a class="rail-item" href="#/board">${crest(l.name, 'sm', l.id, 'league')}<b>${esc(l.name)}</b><span class="count">${l.n}</span></a>`).join('')}
  </div></div>`;
}

function cardHTML(f) {
  const p = f.odds_1x2 ?? {};
  const pick = f.top_pick;
  const extra = (f.confident ?? []).slice(pick && pick.kind === 'CONFIDENT' ? 1 : 0).slice(0, 2);
  return `
  <article class="card" data-id="${f.id}" tabindex="0" role="link" aria-label="${esc(f.home)} versus ${esc(f.away)}">
    <div class="card-top">
      <span class="card-league">${crest(f.league ?? '', 'sm', f.league_id, 'league')}<span>${esc(f.league ?? '')}</span></span>
      <span class="card-kick${isSoon(f.kickoff) ? ' soon' : ''}">${esc(kickoffLabel(f.kickoff))}</span>
    </div>
    <div class="card-teams">
      <div class="team-row">${crest(f.home, 'md', f.home_id)}<span class="name">${esc(f.home)}</span><span class="pc">${pct(p.HOME)}</span></div>
      <div class="team-row">${crest(f.away, 'md', f.away_id)}<span class="name">${esc(f.away)}</span><span class="pc">${pct(p.AWAY)}</span></div>
    </div>
    ${pick
      ? `<div class="card-pick">
           <div class="pick-meta">
             <span class="tag ${esc(pick.kind.toLowerCase())}">${esc(KIND_TAG[pick.kind] ?? pick.kind)}</span>
             <span class="num">${pick.kind === 'CONFIDENT' && pick.prob ? pct(pick.prob) : dec(pick.odds)}</span>
           </div>
           <span class="sel">${esc(marketLabel(pick.market, pick.outcome, pick.line, f.home, f.away))}</span>
         </div>`
      : `<div class="card-pick none">No call on this one</div>`}
    ${extra.length
      ? `<div class="also">${extra.map((c) => `<span class="also-call">${esc(marketLabel(c.market, c.outcome, c.line, f.home, f.away))} <b>${pct(c.prob)}</b>${c.caveat ? '<i class="caveat" title="worth reading the caveat">!</i>' : ''}</span>`).join('')}</div>`
      : ''}
  </article>`;
}

/**
 * The front row, chosen for variety as well as confidence. Ranking on
 * confidence alone shows the same two markets eight times — accurate, and a
 * poor shop window.
 */
function spread(fixtures, limit) {
  const ranked = [...fixtures].sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));
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
          <span class="tag ${esc(verdict.kind.toLowerCase())}">${esc(KIND_TAG[verdict.kind] ?? verdict.kind)}</span>
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
  app.innerHTML = heroHTML(state.heroVenue) + '<div class="spinner">Loading the board…</div>';
  let board;
  try { board = await loadBoard(); } catch (err) {
    app.innerHTML = heroHTML(state.heroVenue) + `<div class="wrap section"><div class="empty">${esc(err.message)}</div></div>`;
    return;
  }
  const fixtures = board.fixtures ?? [];
  const withPicks = fixtures.filter((f) => f.top_pick);
  const top = spread(withPicks, 8);

  let recent = [];
  try { recent = (await getJSON('/api/picks?limit=40&settled=true')).picks ?? []; } catch { /* strip is optional */ }

  // The ground hosting the strongest call on the board, so the masthead is a
  // real venue playing a real game today rather than a mood shot.
  state.heroVenue = (top.find((f) => f.venue_id) ?? fixtures.find((f) => f.venue_id))?.venue_id ?? null;

  app.innerHTML =
    heroHTML(state.heroVenue) +
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
    bandHTML(await sampleNarrative(top));

  wireCards();
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

function verdictHTML(v, home, away) {
  const c = v.candidate;
  const confident = v.kind === 'CONFIDENT';
  return `
  <div class="verdict">
    <div class="verdict-head">
      <span class="tag ${esc(v.kind.toLowerCase())}">${esc(KIND_TITLE[v.kind] ?? v.kind)}</span>
      <span class="sel">${esc(marketLabel(c.market, c.outcome, c.line, home, away))}</span>
      <span class="odds">${dec(c.odds)}</span>
    </div>
    <p class="narrative">${esc(v.narrative)}</p>
    <div class="numbers">
      <span>${confident ? 'confidence' : 'our number'} <b>${pct(c.model_prob)}</b></span>
      ${confident
        ? `<span>returns <b>${((c.odds - 1) * 100).toFixed(0)}p</b> in the pound</span>`
        : `<span>the price says <b>${pct(c.book_prob)}</b></span>`}
      ${c.bookmaker ? `<span>best at <b>${esc(c.bookmaker)}</b></span>` : ''}
    </div>
    ${confident
      ? `<p class="disclosure">A confidence, not a tip — this one agrees with the bookmakers rather than
         disputing them, so treat it as a read on the game rather than on the price.</p>`
      : ''}
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
  // Only notes we have a human label for, and only where something was found.
  const reads = (f.ledger ?? [])
    .filter((x) => x.state === 'COMPUTED' && READ_LABEL[x.id] && x.note)
    .map((x) => ({ label: READ_LABEL[x.id], note: x.note }))
    .filter((x, i, arr) => arr.findIndex((y) => y.note === x.note) === i);

  app.innerHTML = `
  <div class="wrap section">
    <button class="back">← Back to the board</button>

    <div class="fx-hero" data-shot="${f.venue_id ? 'yes' : 'none'}">
      <div class="fx-hero-media">${venueShot(f.venue_id, '')}</div>
      <div class="fx-hero-in">
        <div class="fx-teams">
          <div class="fx-side">${crest(f.home, 'xl', f.home_id)}<span class="name">${esc(f.home)}</span></div>
          <div class="fx-mid">
            <div class="fx-when">${esc(kickoffLabel(f.kickoff))}</div>
            <div class="fx-league">${esc(f.league ?? '')}</div>
          </div>
          <div class="fx-side">${crest(f.away, 'xl', f.away_id)}<span class="name">${esc(f.away)}</span></div>
        </div>
      </div>
    </div>

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
          <div class="bars">
            ${bar(f.home, p.HOME)}${bar('Draw', p.DRAW)}${bar(f.away, p.AWAY)}
          </div>
          <div class="numbers" style="margin-top:18px">
            <span>goals expected <b>${dec((f.lambda?.[0] ?? 0) + (f.lambda?.[1] ?? 0))}</b></span>
            ${f.provisional ? `<span class="tag prov" style="padding:7px 12px">line-ups not final</span>` : ''}
          </div>
        </div>
      </div>
    </div>
  </div>`;

  app.querySelector('.back').onclick = () => {
    if (history.length > 1) history.back(); else location.hash = '#/board';
  };
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
  const byKind = data.summary_by_kind ?? {};
  const picks = data.picks ?? [];
  const settled = picks.filter((x) => x.result && x.result !== 'VOID');

  const block = (kind, s) => `
    <div class="stat"><b>${s.n ? `${Math.round((100 * (s.wins ?? 0)) / s.n)}%` : '—'}</b><span>${esc(KIND_TAG[kind] ?? kind)} strike rate</span></div>
    <div class="stat"><b>${s.n ?? 0}</b><span>${esc(KIND_TAG[kind] ?? kind)} settled</span></div>
    <div class="stat"><b>${typeof s.pnl === 'number' ? (s.pnl >= 0 ? '+' : '') + s.pnl.toFixed(1) : '—'}</b><span>${esc(KIND_TAG[kind] ?? kind)} units</span></div>`;

  app.innerHTML = `
  <div class="wrap section">
    <div class="section-head"><div>
      <h2 class="display">Results</h2>
      <p>Every pick we have published, settled against the real result. Nothing removed.</p>
    </div></div>
    ${Object.keys(byKind).length
      ? `<div class="ledger">${Object.entries(byKind).map(([k, s]) => block(k, s)).join('')}</div>`
      : `<div class="empty" style="margin-bottom:24px">Nothing has settled yet — the first results land as today's games finish.</div>`}
    ${picks.length ? `<div class="scroll-x"><table class="tbl">
      <thead><tr><th>Game</th><th>Call</th><th class="num">Odds</th><th class="num">Result</th></tr></thead>
      <tbody>${picks.map((x) => `
        <tr>
          <td>${x.home_team ? `${esc(x.home_team)} v ${esc(x.away_team)}` : '—'}</td>
          <td>${esc(marketLabel(x.market, x.outcome, x.line, x.home_team, x.away_team))}</td>
          <td class="num">${dec(x.odds)}</td>
          <td class="num">${x.result
            ? `<span class="tag ${x.result === 'WON' || x.result === 'HALF_WON' ? 'won' : 'lost'}">${x.result === 'HALF_WON' ? 'Won' : esc(x.result[0] + x.result.slice(1).toLowerCase())}</span>`
            : '<span style="color:var(--ink-3)">Pending</span>'}</td>
        </tr>`).join('')}</tbody></table></div>`
      : `<div class="empty">Nothing published yet.</div>`}
    ${settled.length === 0 && picks.length > 0
      ? `<p class="foot-note" style="margin-top:20px">${picks.length} picks are live and none have finished yet, so there is no strike rate to show.</p>` : ''}
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
    const e = byLeague.get(k) ?? { name: f.league ?? '', id: f.league_id, n: 0, picks: 0 };
    e.n++;
    if (f.top_pick) e.picks++;
    byLeague.set(k, e);
  }
  const rows = [...byLeague.values()].sort((a, b) => b.n - a.n);

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
      <div><b>Every 30 min</b><span>Refreshed</span></div>`;
  } catch { /* the dot stays grey, which is the honest state */ }
}

document.getElementById('burger').onclick = (e) => {
  const open = document.getElementById('nav').classList.toggle('open');
  e.currentTarget.setAttribute('aria-expanded', String(open));
};

window.addEventListener('hashchange', route);
route();
health();
