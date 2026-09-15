// offside.win — the whole client. No framework, no build step, no bundler.
// Every number rendered here was computed in GitHub Actions and stored as JSON;
// this file only arranges it.

const app = document.getElementById('app');
const statusEl = document.getElementById('status');

// ---------------------------------------------------------------- helpers

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const pct = (v, dp = 1) => (v == null || !isFinite(v) ? '—' : `${(v * 100).toFixed(dp)}%`);
const dec = (v, dp = 2) => (v == null || !isFinite(v) ? '—' : Number(v).toFixed(dp));

function kickoffLabel(epoch) {
  const d = new Date(epoch * 1000);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const tomorrow = new Date(now.getTime() + 864e5).toDateString() === d.toDateString();
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (sameDay) return `Today ${time}`;
  if (tomorrow) return `Tomorrow ${time}`;
  return `${d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })} ${time}`;
}

/** Turn a market code and outcome into something a person would say. */
function marketLabel(market, outcome, line) {
  const L = line == null ? '' : (line > 0 ? `+${line}` : String(line));
  switch (market) {
    case '1x2': return outcome === 'DRAW' ? 'Draw' : outcome === 'HOME' ? 'Home win' : 'Away win';
    case 'double_chance': return `Double chance ${outcome}`;
    case 'draw_no_bet': return `${outcome === 'HOME' ? 'Home' : 'Away'} draw-no-bet`;
    case 'btts': return `Both teams to score — ${outcome}`;
    case 'over_under_05': case 'over_under_15':
    case 'over_under_25': case 'over_under_35':
      return `${outcome === 'over' ? 'Over' : 'Under'} ${line ?? ''} goals`.trim();
    case 'total_corners': return `${outcome === 'over' ? 'Over' : 'Under'} ${line ?? ''} corners`.trim();
    case 'corners_1x2': return `Most corners — ${outcome === 'DRAW' ? 'tie' : outcome === 'HOME' ? 'home' : 'away'}`;
    case 'total_red_cards': return `${outcome === 'over' ? 'Over' : 'Under'} ${line ?? ''} red cards`.trim();
    case 'red_card': return outcome === 'yes' ? 'A red card shown' : 'No red card';
    case 'european_handicap': return `${outcome === 'DRAW' ? 'Draw' : outcome === 'HOME' ? 'Home' : 'Away'} ${L} handicap`.trim();
    case 'asian_handicap': return `${outcome === 'HOME' ? 'Home' : 'Away'} ${L} Asian`.trim();
    default: return `${market} ${outcome}`;
  }
}

async function getJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? res.statusText);
  return res.json();
}

// ------------------------------------------------------------------ views

async function viewBoard() {
  app.innerHTML = '<div class="spinner">Loading the board…</div>';
  const data = await getJSON('/api/board?hours=' + (state.hours ?? 72));

  const leagues = [...new Map(data.fixtures.map((f) => [f.league_id, f.league])).entries()]
    .sort((a, b) => String(a[1]).localeCompare(String(b[1])));

  const shown = state.league
    ? data.fixtures.filter((f) => String(f.league_id) === state.league)
    : data.fixtures;

  app.innerHTML = `
    <h1>The board</h1>
    <p class="lede">
      Every fixture in the window with fitted ratings behind it. Cards show what the market
      makes of the game and what, if anything, we would take against it. Most fixtures should
      read <em>no call</em> — a correctly priced market is supposed to produce one.
    </p>
    <div class="filters">
      <select id="league-filter">
        <option value="">All competitions (${data.fixtures.length})</option>
        ${leagues.map(([id, name]) =>
          `<option value="${id}"${state.league === String(id) ? ' selected' : ''}>${esc(name)}</option>`).join('')}
      </select>
      <select id="hours-filter">
        ${[24, 48, 72, 168].map((h) =>
          `<option value="${h}"${(state.hours ?? 72) === h ? ' selected' : ''}>Next ${h} hours</option>`).join('')}
      </select>
    </div>
    ${shown.length === 0
      ? `<div class="empty">No fixtures priced in this window yet.</div>`
      : `<div class="grid">${shown.map(cardHTML).join('')}</div>`}
  `;

  document.getElementById('league-filter').onchange = (e) => {
    state.league = e.target.value;
    viewBoard();
  };
  document.getElementById('hours-filter').onchange = (e) => {
    state.hours = Number(e.target.value);
    viewBoard();
  };
  for (const el of app.querySelectorAll('.card')) {
    el.onclick = () => { location.hash = `#/fixture/${el.dataset.id}`; };
  }
}

function cardHTML(f) {
  const p = f.odds_1x2 ?? {};
  const pick = f.top_pick;
  return `
  <article class="card" data-id="${f.id}">
    <div class="card-top">
      <span>${esc(f.league ?? '')}</span>
      <span>${esc(kickoffLabel(f.kickoff))}</span>
    </div>
    <div class="teams">${esc(f.home)}<span class="v">v</span>${esc(f.away)}</div>
    <div class="probs">
      <div class="prob"><span>H</span><b>${pct(p.HOME, 0)}</b></div>
      <div class="prob"><span>D</span><b>${pct(p.DRAW, 0)}</b></div>
      <div class="prob"><span>A</span><b>${pct(p.AWAY, 0)}</b></div>
    </div>
    <div class="pick-line${pick ? '' : ' pass'}">
      ${pick
        ? `<span class="tag ${pick.kind.toLowerCase()}">${pick.kind === 'CONFIDENT' ? 'CALL' : pick.kind}</span>
           <span>${esc(marketLabel(pick.market, pick.outcome, pick.line))}</span>
           <span class="odds">${pick.kind === 'CONFIDENT' && pick.prob ? pct(pick.prob, 0) : dec(pick.odds)}</span>`
        : `<span>No call — see the reasoning</span>`}
    </div>
    ${(f.confident ?? []).length > 1
      ? `<div class="also">${(f.confident ?? []).slice(1).map((c) =>
          `<span class="also-call">${esc(marketLabel(c.market, c.outcome, c.line))} <b>${pct(c.prob, 0)}</b>${
            c.caveat ? '<i class="caveat" title="our context argues against this">!</i>' : ''}</span>`).join('')}</div>`
      : ''}
    ${f.provisional
      ? `<div class="factor-meta" style="margin-top:8px"><span class="tag prov">provisional</span>
         <span>lineup ${esc(f.lineup_status)}</span></div>`
      : ''}
  </article>`;
}

async function viewFixture(id) {
  app.innerHTML = '<div class="spinner">Loading the analysis…</div>';
  let f;
  try {
    f = await getJSON(`/api/fixture/${id}`);
  } catch (err) {
    app.innerHTML = `<button class="back">← Board</button><div class="empty">${esc(err.message)}</div>`;
    app.querySelector('.back').onclick = () => { location.hash = '#/board'; };
    return;
  }

  const counts = (f.ledger ?? []).reduce((a, x) => { a[x.state] = (a[x.state] ?? 0) + 1; return a; }, {});

  app.innerHTML = `
    <button class="back">← Board</button>
    <h1>${esc(f.home)} <span style="color:var(--ink-faint);font-weight:400">v</span> ${esc(f.away)}</h1>
    <p class="lede">
      ${esc(f.league ?? '')} · ${esc(kickoffLabel(f.kickoff))} ·
      lineup ${esc(f.lineup_status)}${f.provisional ? ' — every call here is provisional until the eleven is named' : ''}
    </p>

    <div class="stat-row">
      <div class="stat"><div class="k">Expected goals</div><div class="v">${dec(f.lambda_home)}–${dec(f.lambda_away)}</div></div>
      <div class="stat"><div class="k">Expected corners</div><div class="v">${dec(f.corner_rate, 1)}</div></div>
      <div class="stat"><div class="k">Expected reds</div><div class="v">${dec(f.card_rate, 2)}</div></div>
      <div class="stat"><div class="k">Confidence</div><div class="v">${pct(f.confidence, 0)}</div></div>
    </div>

    ${(f.verdicts ?? []).map(verdictHTML).join('')}
    ${f.pass_reason ? `<div class="pass-box">${esc(f.pass ?? f.pass_reason)}</div>` : ''}

    <h2>The evidence</h2>
    <p class="lede" style="margin-bottom:14px">
      Every factor the model looked at, in the order the doctrine ranks them.
      <b>${counts.COMPUTED ?? 0} computed</b>, ${counts.THIN ?? 0} too thin to use,
      ${counts.UNAVAILABLE ?? 0} unavailable. Thin and unavailable factors are shown in place
      rather than hidden — a fixture we know little about should look like one.
    </p>
    <div class="ledger">${(f.ledger ?? []).map(factorHTML).join('')}</div>

    <h2>Every market</h2>
    <div class="scroll"><table>
      <thead><tr>
        <th>Market</th><th>Outcome</th><th style="text-align:right">Our price</th>
        <th style="text-align:right">Book</th><th style="text-align:right">Edge</th>
        <th style="text-align:right">Best</th><th>Where</th>
      </tr></thead>
      <tbody>${marketRows(f)}</tbody>
    </table></div>

    ${f.external && Object.keys(f.external).length
      ? `<h2>Other opinions</h2>
         <p class="lede">Recorded alongside ours and never used as the call.</p>
         <details class="evidence" style="background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);padding:12px 14px">
           <summary>Provider model and prediction-market prices</summary>
           <pre>${esc(JSON.stringify(f.external, null, 2))}</pre>
         </details>`
      : ''}
  `;
  app.querySelector('.back').onclick = () => { location.hash = '#/board'; };
}

const VERDICT_LABEL = {
  VALUE: 'biggest mispricing',
  LIKELY: 'most likely to land',
  CONFIDENT: 'high-confidence call',
};

function verdictHTML(v) {
  const c = v.candidate;
  const confident = v.kind === 'CONFIDENT';
  return `
  <div class="verdict ${v.kind.toLowerCase()}">
    <div class="verdict-head">
      <span class="tag ${v.kind.toLowerCase()}">${VERDICT_LABEL[v.kind] ?? esc(v.kind)}</span>
      <span class="sel">${esc(marketLabel(c.market, c.outcome, c.line))}</span>
      <span class="odds">${dec(c.odds)}</span>
      <span class="tag muted">${esc(c.bookmaker ?? '')}</span>
    </div>
    <p class="narrative">${esc(v.narrative)}</p>
    ${confident
      // Edge and stake are meaningless on a call that agrees with the price —
      // both are ~0 by construction — and printing them would imply a value the
      // call does not claim. What a reader needs instead is what it returns.
      ? `<div class="numbers">
           <span>confidence <b>${pct(c.model_prob)}</b></span>
           <span>price <b>${dec(c.odds)}</b></span>
           <span>returns <b>${((c.odds - 1) * 100).toFixed(0)}p</b> in the pound</span>
         </div>
         <p class="disclosure">A confidence, not a tip. This agrees with the market price rather than
         disputing it, so it is a read on the match — not a claim that betting it makes money.</p>`
      : `<div class="numbers">
           <span>we make it <b>${pct(c.model_prob)}</b></span>
           <span>market <b>${pct(c.book_prob)}</b></span>
           <span>edge <b>${(c.edge * 100).toFixed(1)} pts</b></span>
           <span>stake <b>${pct(c.kelly, 2)}</b> of bank</span>
         </div>`}
    ${v.set_aside && v.set_aside.length
      ? `<details class="evidence"><summary>Assessed and set aside (${v.set_aside.length})</summary>
         <pre>${esc(v.set_aside.map((s) => `${s.section} ${s.note}`).join('\n\n'))}</pre></details>`
      : ''}
  </div>`;
}

function factorHTML(x) {
  const moves = (x.moves ?? [])
    .map((m) => `<span class="move ${m.pct > 0 ? 'up' : 'down'}">${m.channel} ${m.side} ${m.pct > 0 ? '+' : ''}${m.pct}%</span>`)
    .join('');
  const hasEvidence = x.evidence && Object.keys(x.evidence).length > 0;
  return `
  <div class="factor ${x.state.toLowerCase()}">
    <div class="factor-state">${x.state}</div>
    <div>
      <div class="factor-note">${esc(x.note)}</div>
      <div class="factor-meta">
        <span>${esc(x.section)}</span>
        <span>tier ${x.tier}</span>
        ${moves}
      </div>
      ${hasEvidence
        ? `<details class="evidence"><summary>evidence</summary><pre>${esc(JSON.stringify(x.evidence, null, 2))}</pre></details>`
        : ''}
    </div>
  </div>`;
}

function marketRows(f) {
  const rows = [];
  for (const m of f.markets ?? []) {
    for (const [outcome, ourP] of Object.entries(m.model ?? {})) {
      const bookP = (m.book ?? {})[outcome];
      const best = (m.best ?? {})[outcome];
      const edge = bookP == null ? null : ourP - bookP;
      rows.push({ m, outcome, ourP, bookP, best, edge });
    }
  }
  rows.sort((a, b) => (b.edge ?? -9) - (a.edge ?? -9));
  if (rows.length === 0) return `<tr><td colspan="7" class="empty">No priced markets yet.</td></tr>`;
  return rows
    .map((r) => `
      <tr>
        <td>${esc(r.m.market)}${r.m.line != null ? ` <span style="color:var(--ink-faint)">${r.m.line}</span>` : ''}</td>
        <td>${esc(r.outcome)}</td>
        <td class="num">${pct(r.ourP)}</td>
        <td class="num">${r.bookP == null ? '—' : pct(r.bookP)}</td>
        <td class="num ${r.edge > 0 ? 'pos' : r.edge < 0 ? 'neg' : ''}">${r.edge == null ? '—' : (r.edge * 100).toFixed(1)}</td>
        <td class="num">${r.best ? dec(r.best.odds) : '—'}</td>
        <td style="color:var(--ink-faint)">${esc(r.best?.bookmaker ?? '')}</td>
      </tr>`)
    .join('');
}

async function viewPicks() {
  app.innerHTML = '<div class="spinner">Loading picks…</div>';
  const data = await getJSON('/api/picks?limit=120');
  const s = data.summary ?? {};
  const settled = Number(s.n ?? 0);
  const roi = settled > 0 ? Number(s.pnl ?? 0) / settled : null;

  app.innerHTML = `
    <h1>Picks</h1>
    <p class="lede">
      Every call published, graded at the price taken once the match finishes.
      Returns are shown to one unit staked flat, not to the Kelly fraction — a flat record is
      the honest one to judge a model by.
    </p>
    <div class="stat-row">
      <div class="stat"><div class="k">Settled</div><div class="v">${settled}</div></div>
      <div class="stat"><div class="k">Won</div><div class="v">${s.wins ?? 0}</div></div>
      <div class="stat"><div class="k">Units</div><div class="v" style="color:${Number(s.pnl ?? 0) >= 0 ? 'var(--accent)' : 'var(--bad)'}">${settled ? (Number(s.pnl) >= 0 ? '+' : '') + dec(s.pnl) : '—'}</div></div>
      <div class="stat"><div class="k">ROI</div><div class="v" style="color:${(roi ?? 0) >= 0 ? 'var(--accent)' : 'var(--bad)'}">${roi == null ? '—' : pct(roi)}</div></div>
      <div class="stat"><div class="k">Avg price</div><div class="v">${dec(s.avg_odds)}</div></div>
    </div>
    ${settled < 50 ? `<div class="note">
      <b>Too early to judge.</b> ${settled} settled ${settled === 1 ? 'pick' : 'picks'} is nowhere near
      enough to separate skill from variance — several hundred is the region where a record starts
      meaning something. The number above is reported because hiding it would be worse, not because
      it is yet evidence of anything.
    </div>` : ''}
    <div class="scroll"><table>
      <thead><tr>
        <th>Kickoff</th><th>Fixture</th><th>Selection</th>
        <th style="text-align:right">Odds</th><th style="text-align:right">Ours</th>
        <th style="text-align:right">Edge</th><th>Result</th><th style="text-align:right">P/L</th>
      </tr></thead>
      <tbody>${(data.picks ?? []).map(pickRow).join('') || `<tr><td colspan="8" class="empty">No picks published yet.</td></tr>`}</tbody>
    </table></div>
  `;
}

function pickRow(p) {
  const resultColour = ['WON', 'HALF_WON'].includes(p.result) ? 'pos'
    : ['LOST', 'HALF_LOST'].includes(p.result) ? 'neg' : '';
  return `
  <tr style="cursor:pointer" onclick="location.hash='#/fixture/${p.fixture_id}'">
    <td style="color:var(--ink-faint)">${esc(kickoffLabel(p.kickoff))}</td>
    <td>${esc(p.home_team ?? '')} v ${esc(p.away_team ?? '')}</td>
    <td>${esc(marketLabel(p.market, p.outcome, p.line))} <span class="tag ${String(p.kind).toLowerCase()}">${esc(p.kind)}</span></td>
    <td class="num">${dec(p.odds)}</td>
    <td class="num">${pct(p.model_prob, 0)}</td>
    <td class="num ${p.edge > 0 ? 'pos' : 'neg'}">${(p.edge * 100).toFixed(1)}</td>
    <td class="${resultColour}">${p.result ? esc(p.result.replace('_', ' ').toLowerCase()) : '<span style="color:var(--ink-faint)">pending</span>'}</td>
    <td class="num ${p.pnl > 0 ? 'pos' : p.pnl < 0 ? 'neg' : ''}">${p.pnl == null ? '—' : (p.pnl > 0 ? '+' : '') + dec(p.pnl)}</td>
  </tr>`;
}

async function viewModel() {
  app.innerHTML = '<div class="spinner">Loading model diagnostics…</div>';
  const data = await getJSON('/api/model');
  const bt = data.backtest?.report;

  app.innerHTML = `
    <h1>The model</h1>
    <p class="lede">
      Attack and defence fitted per league by maximum likelihood with time decay, a low-score
      correction and shrinkage toward the league mean. Every market is priced off one score
      distribution, so the numbers cannot contradict each other.
    </p>

    ${bt ? `
      <h2>Walk-forward backtest</h2>
      <div class="note" style="border-left-color:${bt.improvement.vs_naive_poisson > 0 && bt.improvement.vs_base_rate > 0 ? 'var(--accent)' : 'var(--bad)'}">
        ${esc(bt.verdict)}
      </div>
      <p class="lede">
        ${bt.matches.toLocaleString()} matches across ${bt.leagues} leagues, ${bt.refits} refits.
        The model never saw the match it was predicting. No return figure is shown here: that needs
        historical closing prices we do not hold, and a backtested ROI from reconstructed odds would
        be the most flattering and least trustworthy number on this page.
      </p>
      <div class="scroll"><table>
        <thead><tr><th>Market</th><th style="text-align:right">n</th>
          <th style="text-align:right">Log loss</th><th style="text-align:right">Brier</th>
          <th style="text-align:right">vs naive</th></tr></thead>
        <tbody>${Object.entries(bt.models.full ?? {}).filter(([, v]) => v.n > 0).map(([k, v]) => {
          const naive = bt.models.naive_poisson?.[k];
          const diff = naive ? naive.logLoss - v.logLoss : null;
          return `<tr>
            <td>${esc(k)}</td>
            <td class="num">${v.n.toLocaleString()}</td>
            <td class="num">${dec(v.logLoss, 4)}</td>
            <td class="num">${dec(v.brier, 4)}</td>
            <td class="num ${diff > 0 ? 'pos' : 'neg'}">${diff == null ? '—' : (diff > 0 ? '+' : '') + dec(diff, 4)}</td>
          </tr>`;
        }).join('')}</tbody>
      </table></div>
    ` : `<div class="note">No backtest has been run yet. Trigger the <code>backtest</code> workflow to produce one — until then there is no evidence on this page that the model works.</div>`}

    <h2>Live calibration</h2>
    <p class="lede">
      What the model said would happen, against what did. Markets it has been overconfident on have
      their edge cut automatically — that multiplier is the <em>shrink</em> column, and it is applied
      before anything is ranked.
    </p>
    <div class="scroll"><table>
      <thead><tr><th>Market family</th><th style="text-align:right">n</th>
        <th style="text-align:right">We said</th><th style="text-align:right">Happened</th>
        <th style="text-align:right">Brier</th><th style="text-align:right">ROI</th>
        <th style="text-align:right">Shrink</th></tr></thead>
      <tbody>${(data.calibration ?? []).map((c) => `
        <tr>
          <td>${esc(c.market_family)}</td>
          <td class="num">${c.n}</td>
          <td class="num">${pct(c.mean_model_p)}</td>
          <td class="num">${pct(c.mean_actual)}</td>
          <td class="num">${dec(c.brier, 4)}</td>
          <td class="num ${c.roi > 0 ? 'pos' : 'neg'}">${pct(c.roi)}</td>
          <td class="num">${dec(c.shrink)}</td>
        </tr>`).join('') || `<tr><td colspan="7" class="empty">No settled picks yet — calibration starts once results arrive.</td></tr>`}
      </tbody>
    </table></div>

    <h2>Fitted leagues</h2>
    <div class="scroll"><table>
      <thead><tr><th>League</th><th style="text-align:right">Matches</th>
        <th style="text-align:right">Home adv</th><th style="text-align:right">Rho</th>
        <th style="text-align:right">Mean goals</th><th>Fitted</th></tr></thead>
      <tbody>${(data.leagues ?? []).map((l) => `
        <tr>
          <td>${esc(l.name ?? `league ${l.league_id}`)}</td>
          <td class="num">${l.n_matches?.toLocaleString?.() ?? l.n_matches}</td>
          <td class="num">${dec(l.home_adv, 3)}</td>
          <td class="num">${dec(l.rho, 3)}</td>
          <td class="num">${dec(l.mean_goals)}</td>
          <td style="color:var(--ink-faint)">${l.fitted_at ? new Date(l.fitted_at * 1000).toLocaleDateString() : '—'}</td>
        </tr>`).join('') || `<tr><td colspan="6" class="empty">No leagues fitted yet.</td></tr>`}
      </tbody>
    </table></div>
  `;
}

// ----------------------------------------------------------------- router

const state = { league: '', hours: 72 };

async function route() {
  const hash = location.hash || '#/board';
  const [, name, arg] = hash.split('/');

  for (const b of document.querySelectorAll('nav button')) {
    b.setAttribute('aria-current', String(b.dataset.route === (name || 'board')));
  }

  try {
    if (name === 'fixture' && arg) await viewFixture(arg);
    else if (name === 'picks') await viewPicks();
    else if (name === 'model') await viewModel();
    else await viewBoard();
  } catch (err) {
    app.innerHTML = `<div class="empty">Could not load: ${esc(err.message)}</div>`;
  }
}

async function refreshStatus() {
  try {
    const h = await getJSON('/api/health');
    statusEl.className = 'status' + (h.stale ? ' stale' : '');
    statusEl.innerHTML = `<span class="dot"></span>${h.fixtures} priced · updated ${
      h.last_computed_minutes_ago == null ? 'never' : h.last_computed_minutes_ago + 'm ago'}`;
  } catch {
    statusEl.textContent = '';
  }
}

for (const b of document.querySelectorAll('nav button')) {
  b.onclick = () => { location.hash = `#/${b.dataset.route}`; };
}
addEventListener('hashchange', route);
route();
refreshStatus();
