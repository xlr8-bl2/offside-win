/**
 * offside.win — the front end.
 *
 * Everything on screen comes from /api/*, which serves finished JSON computed
 * in GitHub Actions. This file fetches, routes and renders; it calculates
 * nothing about football.
 *
 * One thing it does generate: team identity. The provider returns names and ids
 * and no images at all — no crests, no player photos, no league marks — so a
 * design built on badge rows would be a design full of holes. Instead each club
 * gets a monogram whose colours are derived from its own name, which is stable
 * for the life of the site, needs no asset pipeline, and never 404s.
 */

const app = document.getElementById('app');

// ---------------------------------------------------------------- helpers

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const pct = (v, dp = 0) => (typeof v === 'number' && isFinite(v) ? `${(v * 100).toFixed(dp)}%` : '—');
const dec = (v) => (typeof v === 'number' && isFinite(v) ? v.toFixed(2) : '—');

async function getJSON(path) {
  const res = await fetch(path);
  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try { msg = (await res.json()).error ?? msg; } catch { /* body was not json */ }
    throw new Error(msg);
  }
  return res.json();
}

function kickoffLabel(epoch) {
  if (!epoch) return '';
  const d = new Date(epoch * 1000);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const tomorrow = new Date(now.getTime() + 864e5).toDateString() === d.toDateString();
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (sameDay) return `Today ${time}`;
  if (tomorrow) return `Tomorrow ${time}`;
  return `${d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })} ${time}`;
}

/**
 * A club's colours, from its own name.
 *
 * Hashed rather than random so a team looks the same on every page and every
 * visit, and drawn from a hand-picked set of deep tones rather than the full
 * hue wheel — an unconstrained hash produces the neon greens and muddy browns
 * that make generated palettes look generated.
 */
const PALETTE = [
  ['#1e3a8a', '#3b82f6'], ['#7f1d1d', '#ef4444'], ['#14532d', '#22c55e'],
  ['#3b0764', '#a855f7'], ['#7c2d12', '#f97316'], ['#134e4a', '#14b8a6'],
  ['#1e1b4b', '#6366f1'], ['#831843', '#ec4899'], ['#365314', '#84cc16'],
  ['#422006', '#d4a574'], ['#0c4a6e', '#0ea5e9'], ['#4c0519', '#f43f5e'],
];

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

/** Up to three initials, skipping the club-type words that every side shares. */
function initials(name) {
  const skip = /^(fc|afc|ac|as|sv|sc|cf|cd|ud|rc|us|ss|ssc|bk|if|ik|fk|nk|hk|gks|kv|rkc|vfl|vfb|tsg|tsv|spvgg|1|de|do|la|le|el|al|club|the)$/i;
  const words = String(name || '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
  const core = words.filter((w) => !skip.test(w));
  const use = (core.length ? core : words).slice(0, 3);
  return use.map((w) => w[0].toUpperCase()).join('') || '?';
}

function crest(name, size = 'md') {
  const [dark, light] = PALETTE[hash(String(name || '')) % PALETTE.length];
  const text = initials(name);
  const fit = text.length >= 3 ? 'font-size:0.72em' : '';
  return `<span class="crest crest-${size}" style="background:linear-gradient(145deg,${light},${dark});${fit}"
    aria-hidden="true">${esc(text)}</span>`;
}

// ---------------------------------------------------------------- markets

const OUTCOME_WORD = {
  HOME: 'Home win', DRAW: 'Draw', AWAY: 'Away win',
  '1X': 'Home or draw', '12': 'Home or away', 'X2': 'Draw or away',
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
      return o;
    case 'draw_no_bet': return `${outcome === 'HOME' ? home ?? 'Home' : away ?? 'Away'} (draw no bet)`;
    case 'btts': return `Both teams to score — ${o.toLowerCase()}`;
    case 'over_under_05': case 'over_under_15': case 'over_under_25': case 'over_under_35':
      return `${o} ${line ?? ''} goals`.replace(/\s+/g, ' ').trim();
    case 'total_corners': return `${o} ${line ?? ''} corners`.trim();
    case 'asian_handicap': return `Asian handicap ${outcome} ${line > 0 ? '+' : ''}${line}`;
    case 'european_handicap': return `European handicap ${outcome} ${line > 0 ? '+' : ''}${line}`;
    case 'total_red_cards': return `${o} ${line ?? ''} red cards`.trim();
    case 'red_card': return `A red card — ${o.toLowerCase()}`;
    default: return `${market} ${o} ${line ?? ''}`.trim();
  }
}

const VERDICT_LABEL = {
  VALUE: 'biggest mispricing',
  LIKELY: 'most likely to land',
  CONFIDENT: 'high-confidence call',
};

// ------------------------------------------------------------------ state

const state = { board: null, hours: 72, league: '', model: null };

// ------------------------------------------------------------------ views

function heroHTML() {
  return `
  <section class="hero">
    <div class="hero-media">
      <img src="https://images.unsplash.com/photo-1522778119026-d647f0596c20?auto=format&fit=crop&w=2000&q=70"
           alt="" loading="eager" fetchpriority="high">
    </div>
    <div class="hero-inner">
      <p class="eyebrow">88 leagues · updated every 30 minutes</p>
      <h1 class="display">The picks for<br>the biggest games.</h1>
      <p class="script hero-script">Every pick,<br>explained.</p>
      <p class="lede">
        Every call on this site shows its working: the ratings behind it, the team news,
        the schedule, and what the price actually pays. Including the reasons not to like it.
      </p>
      <div style="display:flex;gap:12px;flex-wrap:wrap">
        <a class="btn btn-primary" href="#/board">View today's picks
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12h14M13 6l6 6-6 6"/></svg></a>
        <a class="btn btn-ghost" href="#/model">How it works</a>
      </div>
    </div>
  </section>`;
}

function railHTML(fixtures) {
  const byLeague = new Map();
  for (const f of fixtures) {
    const k = f.league ?? `League ${f.league_id}`;
    byLeague.set(k, (byLeague.get(k) ?? 0) + 1);
  }
  const top = [...byLeague].sort((a, b) => b[1] - a[1]).slice(0, 14);
  if (!top.length) return '';
  return `
  <div class="rail"><div class="rail-inner">
    <span class="rail-label">On the board</span>
    ${top.map(([name, n]) => `
      <a class="rail-item" href="#/board">${crest(name, 'sm')}<b>${esc(name)}</b><span class="count">${n}</span></a>`).join('')}
  </div></div>`;
}

function cardHTML(f) {
  const p = f.odds_1x2 ?? {};
  const pick = f.top_pick;
  const extra = (f.confident ?? []).slice(pick && pick.kind === 'CONFIDENT' ? 1 : 0);
  return `
  <article class="card" data-id="${f.id}" tabindex="0" role="link" aria-label="${esc(f.home)} versus ${esc(f.away)}">
    <div class="card-top">
      <span class="card-league">${crest(f.league ?? '', 'sm')}<span>${esc(f.league ?? '')}</span></span>
      <span class="card-kick">${esc(kickoffLabel(f.kickoff))}</span>
    </div>
    <div class="card-teams">
      <div class="team-row">${crest(f.home, 'md')}<span class="name">${esc(f.home)}</span><span class="pc">${pct(p.HOME)}</span></div>
      <div class="team-row">${crest(f.away, 'md')}<span class="name">${esc(f.away)}</span><span class="pc">${pct(p.AWAY)}</span></div>
    </div>
    ${pick
      ? `<div class="card-pick">
           <span class="tag ${esc(pick.kind.toLowerCase())}">${pick.kind === 'CONFIDENT' ? 'Call' : esc(pick.kind)}</span>
           <span class="sel">${esc(marketLabel(pick.market, pick.outcome, pick.line, f.home, f.away))}</span>
           <span class="num">${pick.kind === 'CONFIDENT' && pick.prob ? pct(pick.prob) : dec(pick.odds)}</span>
         </div>`
      : `<div class="card-pick none">No call here — the price looks right</div>`}
    ${extra.length
      ? `<div class="also">${extra.map((c) => `
          <span class="also-call">${esc(marketLabel(c.market, c.outcome, c.line, f.home, f.away))} <b>${pct(c.prob)}</b>${
            c.caveat ? '<i class="caveat" title="our context argues against this">!</i>' : ''}</span>`).join('')}</div>`
      : ''}
    ${f.provisional ? `<div><span class="tag prov">lineup ${esc(f.lineup_status ?? 'unconfirmed')}</span></div>` : ''}
  </article>`;
}

function explainHTML(sample) {
  if (!sample) return '';
  const { fixture, verdict } = sample;
  return `
  <section class="explain">
    <div class="wrap section">
      <div class="explain-grid">
        <div>
          <p class="eyebrow">What makes this different</p>
          <h2 class="display">Anyone can post<br>a favourite.</h2>
          <p class="lede" style="margin-top:18px">
            The hard part is saying why — and saying what the number has not accounted for.
            Every pick here carries its reasoning, drawn from the same evidence the model priced it on.
          </p>
          <ul class="points">
            <li><span class="n">01</span><div><b>The case, with numbers</b><span>Expected goals, team news, schedule and stakes — each cited from what was actually measured.</span></div></li>
            <li><span class="n">02</span><div><b>The reservation, out loud</b><span>Where our context argues against the call, it says so. That is the sentence nobody else prints.</span></div></li>
            <li><span class="n">03</span><div><b>What it pays</b><span>A high strike rate at short odds is not a profit. The return sits next to the confidence, every time.</span></div></li>
          </ul>
        </div>
        <div class="quote">
          <div class="qmeta">
            ${crest(fixture.home, 'sm')}<b style="color:var(--ink);font-weight:600">${esc(fixture.home)} v ${esc(fixture.away)}</b>
            <span class="tag ${esc(verdict.kind.toLowerCase())}">${esc(VERDICT_LABEL[verdict.kind] ?? verdict.kind)}</span>
          </div>
          ${esc(verdict.narrative)}
        </div>
      </div>
    </div>
  </section>`;
}

async function viewHome() {
  app.innerHTML = heroHTML() + '<div class="spinner">Loading the board…</div>';
  let board;
  try {
    board = await loadBoard();
  } catch (err) {
    app.innerHTML = heroHTML() + `<div class="wrap section"><div class="empty">${esc(err.message)}</div></div>`;
    return;
  }
  const fixtures = board.fixtures ?? [];
  const withPicks = fixtures.filter((f) => f.top_pick);
  const top = [...withPicks]
    .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))
    .slice(0, 8);

  app.innerHTML =
    heroHTML() +
    railHTML(fixtures) +
    `<div class="wrap section">
      <div class="section-head">
        <div>
          <h2 class="display">Today's top picks</h2>
          <p>${withPicks.length} calls across ${new Set(fixtures.map((f) => f.league)).size} leagues, recomputed every 30 minutes.</p>
        </div>
        <a class="btn btn-ghost" href="#/board">All ${fixtures.length} fixtures</a>
      </div>
      ${top.length ? `<div class="cards">${top.map(cardHTML).join('')}</div>`
                   : `<div class="empty">Nothing clears the bar right now. That is the analysis working, not failing.</div>`}
    </div>` +
    explainHTML(await sampleNarrative(top));

  wireCards();
}

/** Pull one real narrative for the explainer band rather than inventing one. */
async function sampleNarrative(candidates) {
  for (const f of candidates.slice(0, 4)) {
    try {
      const full = await getJSON(`/api/fixture/${f.id}`);
      const v = (full.verdicts ?? []).find((x) => x.narrative && x.narrative.length > 120);
      if (v) return { fixture: full, verdict: v };
    } catch { /* try the next one */ }
  }
  return null;
}

async function loadBoard() {
  const q = new URLSearchParams({ hours: String(state.hours) });
  if (state.league) q.set('league', state.league);
  state.board = await getJSON(`/api/board?${q}`);
  return state.board;
}

async function viewBoard() {
  app.innerHTML = '<div class="wrap section"><div class="spinner">Loading the board…</div></div>';
  let board;
  try {
    board = await loadBoard();
  } catch (err) {
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
        <p>${fixtures.length} fixtures in the window. ${fixtures.filter((f) => f.top_pick).length} carry a call.</p>
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
    ${fixtures.length ? `<div class="cards" id="grid">${fixtures.map(cardHTML).join('')}</div>`
                      : `<div class="empty">No fixtures in this window.</div>`}
  </div>`;

  document.getElementById('hours-filter').onchange = (e) => {
    state.hours = Number(e.target.value);
    viewBoard();
  };
  document.getElementById('league-filter').onchange = (e) => {
    state.leagueName = e.target.value;
    const grid = document.getElementById('grid');
    const shown = e.target.value ? fixtures.filter((f) => f.league === e.target.value) : fixtures;
    grid.innerHTML = shown.length ? shown.map(cardHTML).join('') : '';
    wireCards();
  };
  wireCards();
}

function wireCards() {
  for (const el of app.querySelectorAll('.card')) {
    const go = () => { location.hash = `#/fixture/${el.dataset.id}`; };
    el.onclick = go;
    el.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } };
  }
}

function verdictHTML(v, home, away) {
  const c = v.candidate;
  const confident = v.kind === 'CONFIDENT';
  return `
  <div class="verdict">
    <div class="verdict-head">
      <span class="tag ${esc(v.kind.toLowerCase())}">${esc(VERDICT_LABEL[v.kind] ?? v.kind)}</span>
      <span class="sel">${esc(marketLabel(c.market, c.outcome, c.line, home, away))}</span>
      <span class="odds">${dec(c.odds)}</span>
    </div>
    <p class="narrative">${esc(v.narrative)}</p>
    ${confident
      ? `<div class="numbers">
           <span>confidence <b>${pct(c.model_prob)}</b></span>
           <span>price <b>${dec(c.odds)}</b></span>
           <span>returns <b>${((c.odds - 1) * 100).toFixed(0)}p</b> in the pound</span>
           ${c.bookmaker ? `<span>at <b>${esc(c.bookmaker)}</b></span>` : ''}
         </div>
         <p class="disclosure">A confidence, not a tip. This agrees with the market price rather than
         disputing it, so it is a read on the match — not a claim that betting it makes money.</p>`
      : `<div class="numbers">
           <span>we make it <b>${pct(c.model_prob)}</b></span>
           <span>market <b>${pct(c.book_prob)}</b></span>
           <span>edge <b>${(c.edge * 100).toFixed(1)} pts</b></span>
           <span>stake <b>${pct(c.kelly, 2)}</b> of bank</span>
           ${c.bookmaker ? `<span>at <b>${esc(c.bookmaker)}</b></span>` : ''}
         </div>`}
  </div>`;
}

function factorHTML(f) {
  return `
  <div class="factor">
    <div class="factor-top">
      <span class="state ${esc((f.state ?? '').toLowerCase())}">${esc(f.state ?? '')}</span>
      <b style="font-size:0.85rem">${esc(f.id ?? '')}</b>
      <span class="sec">${esc(f.section ?? '')}</span>
    </div>
    <p class="factor-note">${esc(f.note ?? '')}</p>
  </div>`;
}

async function viewFixture(id) {
  app.innerHTML = '<div class="wrap section"><div class="spinner">Loading the analysis…</div></div>';
  let f;
  try {
    f = await getJSON(`/api/fixture/${id}`);
  } catch (err) {
    app.innerHTML = `<div class="wrap section"><button class="back">← Board</button><div class="empty">${esc(err.message)}</div></div>`;
    app.querySelector('.back').onclick = () => { location.hash = '#/board'; };
    return;
  }

  const p = f.odds_1x2 ?? {};
  const verdicts = f.verdicts ?? [];
  const ledger = f.ledger ?? [];
  const computed = ledger.filter((x) => x.state === 'COMPUTED');
  const other = ledger.filter((x) => x.state !== 'COMPUTED');

  app.innerHTML = `
  <div class="wrap section">
    <button class="back">← Back to the board</button>

    <div class="fx-hero">
      <div class="fx-teams">
        <div class="fx-side">${crest(f.home, 'lg')}<span class="name">${esc(f.home)}</span></div>
        <div class="fx-mid">
          <div class="fx-score">${pct(p.HOME)} <span style="color:var(--ink-3);font-size:0.5em">/</span> ${pct(p.DRAW)} <span style="color:var(--ink-3);font-size:0.5em">/</span> ${pct(p.AWAY)}</div>
          <div class="fx-when">${esc(kickoffLabel(f.kickoff))}</div>
        </div>
        <div class="fx-side">${crest(f.away, 'lg')}<span class="name">${esc(f.away)}</span></div>
      </div>
      <div class="fx-meta">
        <span>${esc(f.league ?? '')}</span>
        <span>·</span>
        <span>model rates ${dec(f.lambda?.[0])} — ${dec(f.lambda?.[1])} goals</span>
        ${f.provisional ? `<span>·</span><span class="tag prov">lineup ${esc(f.lineup_status ?? 'unconfirmed')}</span>` : ''}
      </div>
    </div>

    <div class="grid-2">
      <div>
        <div class="panel">
          <p class="panel-head">${verdicts.length ? 'The calls' : 'No call'}</p>
          ${verdicts.length
            ? verdicts.map((v) => verdictHTML(v, f.home, f.away)).join('')
            : `<p class="narrative">${esc(f.pass ?? 'Nothing here cleared the evidence bar. A pass is the analysis working, not failing.')}</p>`}
        </div>
        ${computed.length ? `<div class="panel">
          <p class="panel-head">What the model found (${computed.length})</p>
          ${computed.map(factorHTML).join('')}
        </div>` : ''}
      </div>

      <div>
        <div class="panel">
          <p class="panel-head">Model rates</p>
          <div class="bars">
            ${barRow('H', p.HOME)}${barRow('D', p.DRAW)}${barRow('A', p.AWAY)}
          </div>
          <div class="numbers" style="margin-top:16px">
            <span>corners <b>${dec(f.corner_rate)}</b></span>
            <span>cards <b>${dec(f.card_rate)}</b></span>
            <span>confidence <b>${pct(f.confidence)}</b></span>
          </div>
        </div>
        ${other.length ? `<div class="panel">
          <p class="panel-head">Assessed, not used (${other.length})</p>
          ${other.map(factorHTML).join('')}
        </div>` : ''}
      </div>
    </div>
  </div>`;

  app.querySelector('.back').onclick = () => { history.length > 1 ? history.back() : (location.hash = '#/board'); };
}

function barRow(label, v) {
  const w = typeof v === 'number' ? Math.round(v * 100) : 0;
  return `<div class="bar-row"><span>${label}</span><span class="bar"><i class="${label === 'A' ? 'a' : 'h'}" style="width:${w}%"></i></span><span>${w}%</span></div>`;
}

async function viewResults() {
  app.innerHTML = '<div class="wrap section"><div class="spinner">Loading the ledger…</div></div>';
  let data;
  try {
    data = await getJSON('/api/picks?limit=120');
  } catch (err) {
    app.innerHTML = `<div class="wrap section"><div class="empty">${esc(err.message)}</div></div>`;
    return;
  }
  const byKind = data.summary_by_kind ?? {};
  const picks = data.picks ?? [];
  const settled = picks.filter((x) => x.result);

  const kindBlock = (kind, s) => `
    <div class="stat"><b>${s.n ?? 0}</b><span>${esc(kind)} settled</span></div>
    <div class="stat"><b>${s.n ? `${Math.round((100 * (s.wins ?? 0)) / s.n)}%` : '—'}</b><span>${esc(kind)} strike</span></div>
    <div class="stat"><b>${typeof s.pnl === 'number' ? (s.pnl >= 0 ? '+' : '') + s.pnl.toFixed(2) : '—'}</b><span>${esc(kind)} units</span></div>`;

  app.innerHTML = `
  <div class="wrap section">
    <div class="section-head"><div>
      <h2 class="display">Results</h2>
      <p>Every settled pick, graded against the real result. Kinds are kept apart on purpose —
         a call at 1.16 and a value bet at 2.50 are different products and averaging them describes neither.</p>
    </div></div>
    ${Object.keys(byKind).length
      ? `<div class="ledger">${Object.entries(byKind).map(([k, s]) => kindBlock(k, s)).join('')}</div>`
      : `<div class="empty" style="margin-bottom:22px">Nothing has settled yet. The ledger fills as fixtures finish — and an empty one is
         stated as empty rather than filled with a number that would flatter us.</div>`}
    ${picks.length ? `<div class="scroll-x"><table class="tbl">
      <thead><tr><th>Fixture</th><th>Call</th><th>Kind</th><th class="num">Odds</th><th class="num">Result</th><th class="num">P/L</th></tr></thead>
      <tbody>${picks.map((x) => `
        <tr>
          <td>${x.home_team ? `${esc(x.home_team)} v ${esc(x.away_team)}` : `Fixture ${x.fixture_id}`}</td>
          <td>${esc(marketLabel(x.market, x.outcome, x.line, x.home_team, x.away_team))}</td>
          <td><span class="tag ${esc((x.kind ?? '').toLowerCase())}">${x.kind === 'CONFIDENT' ? 'Call' : esc(x.kind ?? '')}</span></td>
          <td class="num">${dec(x.odds)}</td>
          <td class="num">${x.result ? `<span class="tag ${x.result === 'WON' || x.result === 'HALF_WON' ? 'won' : 'lost'}">${esc(x.result)}</span>` : '<span style="color:var(--ink-3)">open</span>'}</td>
          <td class="num">${typeof x.pnl === 'number' ? (x.pnl >= 0 ? '+' : '') + x.pnl.toFixed(2) : '—'}</td>
        </tr>`).join('')}</tbody></table></div>`
      : `<div class="empty">No picks published yet.</div>`}
    ${settled.length === 0 && picks.length > 0
      ? `<p class="foot-note" style="margin-top:18px">${picks.length} picks are open and none have settled, so there is no strike rate or return to show yet.</p>`
      : ''}
  </div>`;
}

async function viewModel() {
  app.innerHTML = '<div class="wrap section"><div class="spinner">Loading…</div></div>';
  let m;
  try {
    m = await getJSON('/api/model');
  } catch (err) {
    app.innerHTML = `<div class="wrap section"><div class="empty">${esc(err.message)}</div></div>`;
    return;
  }
  const bt = m.backtest?.report;
  const leagues = m.leagues ?? [];

  app.innerHTML = `
  <div class="wrap section">
    <div class="section-head"><div>
      <h2 class="display">How it works</h2>
      <p>Ratings are fitted from match history; prices come from real bookmaker quotes; context is
         read per fixture. Nothing on this page is an estimate of what it could be.</p>
    </div></div>

    ${bt ? `<div class="ledger">
      <div class="stat"><b>${(bt.models?.full && meanLL(bt.models.full).toFixed(4)) ?? '—'}</b><span>log loss</span></div>
      <div class="stat"><b>${(bt.matches ?? bt.total_matches ?? 0).toLocaleString()}</b><span>matches tested</span></div>
      <div class="stat"><b>${bt.leagues ?? leagues.length}</b><span>leagues</span></div>
      <div class="stat"><b>${bt.refits ?? '—'}</b><span>walk-forward refits</span></div>
    </div>` : ''}

    <div class="panel">
      <p class="panel-head">Fitted leagues (${leagues.length})</p>
      <div class="scroll-x"><table class="tbl">
        <thead><tr><th>League</th><th class="num">Matches</th><th class="num">Home edge</th><th class="num">Mean goals</th><th class="num">Fitted</th></tr></thead>
        <tbody>${leagues.slice(0, 40).map((l) => `
          <tr>
            <td>${crest(l.name ?? '', 'sm')} ${esc(l.name ?? `League ${l.league_id}`)}</td>
            <td class="num">${(l.n_matches ?? 0).toLocaleString()}</td>
            <td class="num">${dec(l.home_adv)}</td>
            <td class="num">${dec(l.mean_goals)}</td>
            <td class="num">${l.fitted_at ? new Date(l.fitted_at * 1000).toLocaleDateString() : '—'}</td>
          </tr>`).join('')}</tbody>
      </table></div>
    </div>
  </div>`;
}

function meanLL(set) {
  const vals = Object.values(set).filter((s) => s && s.n > 0).map((s) => s.logLoss);
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : NaN;
}

async function viewLeagues() {
  app.innerHTML = '<div class="wrap section"><div class="spinner">Loading leagues…</div></div>';
  const board = state.board ?? (await loadBoard());
  const fixtures = board.fixtures ?? [];
  const byLeague = new Map();
  for (const f of fixtures) {
    const k = f.league ?? `League ${f.league_id}`;
    const e = byLeague.get(k) ?? { n: 0, picks: 0 };
    e.n++;
    if (f.top_pick) e.picks++;
    byLeague.set(k, e);
  }
  const rows = [...byLeague].sort((a, b) => b[1].n - a[1].n);

  app.innerHTML = `
  <div class="wrap section">
    <div class="section-head"><div>
      <h2 class="display">Leagues</h2>
      <p>${rows.length} leagues have fixtures in the current window, out of 88 tracked.</p>
    </div></div>
    <div class="cards">
      ${rows.map(([name, e]) => `
        <article class="card" data-league="${esc(name)}">
          <div class="card-top"><span class="card-league">${crest(name, 'md')}<span>${esc(name)}</span></span></div>
          <div class="numbers" style="margin:0">
            <span>fixtures <b>${e.n}</b></span>
            <span>calls <b>${e.picks}</b></span>
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
  const hash = location.hash || '#/home';
  const parts = hash.slice(2).split('/');
  const name = parts[0] || 'home';

  for (const a of document.querySelectorAll('.nav a')) {
    a.classList.toggle('on', a.dataset.route === name);
  }
  document.getElementById('nav').classList.remove('open');
  document.getElementById('burger').setAttribute('aria-expanded', 'false');
  window.scrollTo(0, 0);

  try {
    if (name === 'fixture' && parts[1]) return await viewFixture(parts[1]);
    if (name === 'board') return await viewBoard();
    if (name === 'leagues') return await viewLeagues();
    if (name === 'results') return await viewResults();
    if (name === 'model') return await viewModel();
    return await viewHome();
  } catch (err) {
    app.innerHTML = `<div class="wrap section"><div class="empty">${esc(err.message ?? 'Something went wrong.')}</div></div>`;
  }
}

async function health() {
  try {
    const h = await getJSON('/api/health');
    const dot = document.getElementById('health');
    dot.className = `health ${h.stale ? 'stale' : 'ok'}`;
    dot.title = h.stale
      ? `The board is ${h.last_computed_minutes_ago} minutes old`
      : `Board updated ${h.last_computed_minutes_ago ?? 0} minutes ago`;
    document.getElementById('foot-stats').innerHTML = `
      <div><b>88</b><span>Leagues tracked</span></div>
      <div><b>${(h.fixtures ?? 0).toLocaleString()}</b><span>Fixtures analysed</span></div>
      <div><b>${h.last_computed_minutes_ago ?? '—'}m</b><span>Since last update</span></div>`;
  } catch { /* the dot stays grey, which is the honest state */ }
}

document.getElementById('burger').onclick = (e) => {
  const nav = document.getElementById('nav');
  const open = nav.classList.toggle('open');
  e.currentTarget.setAttribute('aria-expanded', String(open));
};

window.addEventListener('hashchange', route);
route();
health();
