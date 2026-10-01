/**
 * The owner's dashboard (#/admin).
 *
 * Loaded only when the route is opened, so nobody else downloads it. It holds
 * no secret and decides nothing: every figure comes from /api/admin/*, which
 * checks who is asking on every call (worker/src/admin.ts). A reader who
 * opens #/admin gets this page's frame and a refusal from the server.
 *
 * Six tabs, one address each so a phone's back button works:
 *   #/admin            the day at a glance
 *   #/admin/users      search accounts; one account, free time given or ended
 *   #/admin/calls      open calls and the last month
 *   #/admin/offers     deals, free trials and notices, with a live preview
 *   #/admin/plans      names and prices; the price here is the price charged
 *   #/admin/log        what was changed here, newest first
 */

import { authHeaders } from './lib/auth.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const TABS = [
  ['', 'Overview'],
  ['users', 'Users'],
  ['calls', 'Calls'],
  ['offers', 'Offers'],
  ['plans', 'Plans'],
  ['log', 'Log'],
];
const PLAN_NAMES = { matchday: 'Matchday pass', monthly: 'Monthly', quarter: '3 months', season: 'Season ticket' };
const planName = (id) => PLAN_NAMES[id] ?? id ?? 'None';

const money = (minor, cur = 'GBP') => new Intl.NumberFormat('en-GB', { style: 'currency', currency: cur, minimumFractionDigits: minor % 100 ? 2 : 0 }).format((Number(minor) || 0) / 100);
const count = (n) => new Intl.NumberFormat('en-GB').format(Number(n) || 0);
const day = (t) => (t ? new Date(t * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
const when = (t) => (t ? new Date(t * 1000).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');
function ago(t) {
  if (!t) return 'never';
  const s = Math.max(0, Date.now() / 1000 - t);
  if (s < 90) return 'just now';
  if (s < 5400) return `${Math.round(s / 60)} min ago`;
  if (s < 129600) return `${Math.round(s / 3600)} hours ago`;
  return `${Math.round(s / 86400)} days ago`;
}

async function api(path, body) {
  const res = await fetch(`/api/admin/${path}`, {
    method: body ? 'POST' : 'GET',
    // The owner's real session, always: previewing the site as a free reader
    // must not lock the owner out of their own dashboard.
    headers: { ...(await authHeaders({ real: true })), ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });
  let data = null;
  try { data = await res.json(); } catch { /* empty */ }
  if (!res.ok) {
    const err = new Error(data?.error ?? `The server said ${res.status}.`);
    err.status = res.status;
    throw err;
  }
  return data;
}

/** Whether the signed-in reader is the owner. Asked once a visit; a no costs nothing. */
let adminKnown = null;
export async function isAdmin() {
  if (adminKnown !== null) return adminKnown;
  try { adminKnown = !!(await api('me'))?.admin; } catch { adminKnown = false; }
  return adminKnown;
}

function ensureStyles() {
  if (document.getElementById('admin-css')) return;
  const l = document.createElement('link');
  l.id = 'admin-css';
  l.rel = 'stylesheet';
  l.href = '/admin.css';
  document.head.append(l);
}

function frame(tab, inner) {
  return `
  <div class="adm">
    <aside class="adm-rail">
      <p class="adm-mark">Admin</p>
      <nav class="adm-tabs" aria-label="Dashboard">
        ${TABS.map(([k, label]) => `<a href="#/admin${k ? `/${k}` : ''}"${k === tab ? ' aria-current="page"' : ''}>${label}</a>`).join('')}
      </nav>
    </aside>
    <section class="adm-main" id="adm-main" aria-live="polite">${inner}</section>
  </div>`;
}

const loading = '<div class="adm-loading" aria-busy="true"><span></span><span></span><span></span></div>';

function refusal(err) {
  const msg = err.status === 401 ? 'Sign in with the owner’s account to open the dashboard.'
    : err.status === 403 ? 'This account cannot open the dashboard.'
    : err.message;
  return `
    <div class="adm-refused">
      <h1>Dashboard</h1>
      <p>${esc(msg)}</p>
      ${err.status === 401 ? '<a class="btn btn-primary" href="#/signin">Sign in</a>' : '<a class="btn btn-ghost" href="#/home">Back to the site</a>'}
    </div>`;
}

let previewHelpers = {};
export async function viewAdmin(app, parts, params, helpers = {}) {
  previewHelpers = helpers;
  ensureStyles();
  const tab = TABS.some(([k]) => k === (parts[1] ?? '')) ? (parts[1] ?? '') : '';
  app.innerHTML = frame(tab, loading);
  const main = app.querySelector('#adm-main');
  try {
    if (tab === '') await overview(main);
    else if (tab === 'users') await (parts[2] ? oneUser(main, parts[2]) : users(main, params));
    else if (tab === 'calls') await calls(main);
    else if (tab === 'offers') await offers(main, parts[2]);
    else if (tab === 'plans') await plans(main);
    else if (tab === 'log') await log(main);
  } catch (err) {
    app.innerHTML = err.status === 401 || err.status === 403 ? refusal(err) : frame(tab, `<p class="adm-error">${esc(err.message)}</p>`);
  }
}

/* ------------------------------------------------------------- overview */

function spark(days) {
  const rows = days ?? [];
  if (!rows.length) return '<p class="adm-quiet">No visits counted yet. Visits are counted only for readers who allow it in the cookie notice.</p>';
  const max = Math.max(1, ...rows.map((r) => Number(r.n)));
  const w = 14, gap = 4, h = 64;
  const bars = rows.map((r, i) => {
    const bh = Math.max(2, Math.round((Number(r.n) / max) * h));
    return `<rect x="${i * (w + gap)}" y="${h - bh}" width="${w}" height="${bh}" rx="2"><title>${esc(new Date(r.day).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }))}: ${count(r.n)}</title></rect>`;
  }).join('');
  return `<svg class="adm-spark" viewBox="0 0 ${rows.length * (w + gap) - gap} ${h}" role="img" aria-label="Visits a day, the last two weeks">${bars}</svg>`;
}

function engineRow(label, at, okWithin, detail) {
  const fresh = at && Date.now() / 1000 - at < okWithin;
  return `<li><i class="${fresh ? 'ok' : 'late'}" aria-hidden="true"></i><b>${esc(label)}</b><span>${at ? esc(ago(at)) : 'never'}${detail ? `. ${esc(detail)}` : ''}</span></li>`;
}

async function overview(main) {
  const o = await api('overview');
  const cur = o.money?.currency ?? 'GBP';
  const m = o.members ?? {};
  const month = o.calls?.month ?? {};
  const landed = month.n ? Math.round((month.won / month.n) * 100) : null;
  const slate = o.engine?.slate, settle = o.engine?.settle, writer = o.engine?.writer, health = o.engine?.health;
  const byPlan = Object.entries(m.by_plan ?? {}).map(([k, v]) => `${esc(planName(k))} ${count(v)}`).join(', ');
  main.innerHTML = `
    <header class="adm-head">
      <h1>Today</h1>
      <p>${esc(new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }))}</p>
    </header>
    <div class="adm-figures">
      <div><b>${count(m.active)}</b><span>members now</span><small>${count(m.paying)} paying, ${count(m.free)} free${byPlan ? `. ${byPlan}` : ''}</small></div>
      <div><b>${money(o.money?.month, cur)}</b><span>taken in 30 days</span><small>${money(o.money?.week, cur)} this week. ${money(o.money?.all, cur)} all time</small></div>
      <div><b>${count(o.accounts?.week)}</b><span>new accounts this week</span><small>${count(o.accounts?.day)} today. ${count(o.accounts?.total)} in all</small></div>
      <div><b>${count(o.visits?.today)}</b><span>visits today</span><small>${count(o.visits?.week)} this week</small></div>
    </div>
    <div class="adm-grid">
      <section class="adm-card">
        <h2>Visits, two weeks</h2>
        ${spark(o.visits?.days)}
        <p class="adm-quiet">Only readers who allowed visit counts are counted.</p>
      </section>
      <section class="adm-card">
        <h2>Calls</h2>
        <p class="adm-big"><b>${count(o.calls?.open)}</b> open now</p>
        <p class="adm-quiet">${month.n ? `Last 30 days: ${count(month.won)} of ${count(month.n)} landed (${landed}%). ${Number(month.pnl) >= 0 ? 'Up' : 'Down'} ${money(Math.abs(Math.round(Number(month.pnl) * 1000)), cur)} at £10 a call.` : 'No calls settled in the last 30 days.'}</p>
        <a class="adm-link" href="#/admin/calls">See the calls</a>
      </section>
      <section class="adm-card">
        <h2>Engine</h2>
        <ul class="adm-engine">
          ${engineRow('Analysis', slate?.at, 3600, slate ? `${count(slate.analysed)} games, ${count(slate.picks)} calls` : '')}
          ${engineRow('Results', settle?.at, 6 * 3600, '')}
          ${engineRow('Board', health?.last_computed_minutes_ago != null ? Date.now() / 1000 - health.last_computed_minutes_ago * 60 : null, 3600, health ? `${count(health.fixtures)} games on it` : '')}
          <li><i class="${writer?.exhausted ? 'late' : 'ok'}" aria-hidden="true"></i><b>Writer</b><span>${writer ? `${count(writer.used)} of today's Gemini requests used${writer.exhausted ? ', allowance spent until 08:00 UK' : ''}` : 'no record yet'}</span></li>
        </ul>
      </section>
      <section class="adm-card">
        <h2>Emails</h2>
        <p class="adm-quiet">Every email the site sends, to your own address, so you can see them as members do.</p>
        <p><button class="btn btn-ghost btn-sm" type="button" id="adm-mail">Send me every email</button></p>
        <p class="adm-quiet" id="adm-mail-out" role="status"></p>
      </section>
    </div>`;
  const btn = main.querySelector('#adm-mail');
  const out = main.querySelector('#adm-mail-out');
  btn.onclick = async () => {
    btn.disabled = true;
    out.textContent = 'Sending…';
    try {
      const r = await api('mail-test', {});
      const via = [...new Set(Object.values(r.via ?? {}).filter(Boolean))].join(' and ');
      out.textContent = r.sent
        ? `Sent ${r.sent} of ${r.of}${via ? ` through ${via === 'cloudflare' ? 'Cloudflare' : via === 'brevo' ? 'Brevo' : via}` : ''}. Check your inbox.`
        : 'None went out: no way to send email is set up yet.';
    } catch (err) {
      out.textContent = err.message;
    } finally {
      btn.disabled = false;
    }
  };
}

/* ---------------------------------------------------------------- users */

function memberCell(u) {
  if (!u.plan_id || !u.expires_at || u.expires_at * 1000 < Date.now()) return '<span class="adm-tag">Free account</span>';
  return `<span class="adm-tag ${u.free ? 'gift' : 'paid'}">${esc(planName(u.plan_id))}${u.free ? ', free time' : ''}</span><small>to ${esc(day(u.expires_at))}</small>`;
}

async function users(main, params) {
  const q = params.get?.('q') ?? '';
  const rows = await api(`users?q=${encodeURIComponent(q)}`);
  main.innerHTML = `
    <header class="adm-head"><h1>Users</h1><p>Newest first. Search by email, name or username.</p></header>
    <form class="adm-search" id="adm-search" role="search">
      <input type="search" name="q" value="${esc(q)}" placeholder="Search accounts" aria-label="Search accounts" autocomplete="off">
      <button class="btn btn-ghost btn-sm" type="submit">Search</button>
    </form>
    ${rows.length ? `
    <ul class="adm-users">
      ${rows.map((u) => `
        <li><a href="#/admin/users/${esc(u.id)}">
          <span class="adm-who"><b>${esc(u.display_name || u.username || u.email)}</b><small>${esc(u.email)}</small></span>
          <span class="adm-mem">${memberCell(u)}</span>
          <span class="adm-meta"><small>Joined ${esc(day(u.created_at))}</small>${u.paid_minor ? `<small>Paid ${money(u.paid_minor)}</small>` : ''}</span>
        </a></li>`).join('')}
    </ul>` : `<p class="adm-quiet">${q ? `No account matches “${esc(q)}”.` : 'No accounts yet.'}</p>`}`;
  main.querySelector('#adm-search').onsubmit = (e) => {
    e.preventDefault();
    const v = new FormData(e.currentTarget).get('q');
    location.hash = `#/admin/users${v ? `?q=${encodeURIComponent(v)}` : ''}`;
  };
}

async function oneUser(main, id) {
  const d = await api(`user?id=${encodeURIComponent(id)}`);
  if (!d?.user) { main.innerHTML = '<p class="adm-error">No such account.</p>'; return; }
  const m = d.membership, e = d.entitlement;
  const now = Date.now() / 1000;
  // An account can have both: a Whop subscription and free time given here.
  // Each is its own line, so the free time can be ended without touching what
  // they pay for, and "renews" is said of the one that does.
  const whop = e && e.status === 'active' && e.expires_at > now
    ? { ...e, how: 'Paid through Whop', renews: e.plan_id !== 'matchday' && !e.renew_stopped_at } : null;
  const own = m && m.expires_at > now
    ? { ...m, how: m.card_brand === 'complimentary' ? 'Free time given here' : 'Paid by card', renews: !!m.auto_renew } : null;
  const lines = [whop, own].filter(Boolean);
  const free = own?.how === 'Free time given here';
  main.innerHTML = `
    <a class="adm-back" href="#/admin/users">All users</a>
    <header class="adm-head">
      <h1>${esc(d.profile?.display_name || d.user.email)}</h1>
      <p>${esc(d.user.email)}${d.profile?.username ? `, @${esc(d.profile.username)}` : ''}. Joined ${esc(day(d.user.created_at))}, last signed in ${esc(ago(d.user.last_sign_in_at))}.</p>
    </header>
    <div class="adm-grid">
      <section class="adm-card">
        <h2>Membership</h2>
        ${lines.length ? lines.map((l) => `<p class="adm-big"><b>${esc(planName(l.plan_id))}</b> to ${esc(day(l.expires_at))}</p><p class="adm-quiet">${esc(l.how)}${l.renews ? ', renews by itself' : ''}.</p>`).join('')
          : '<p class="adm-big"><b>Free account</b></p><p class="adm-quiet">No membership running.</p>'}
        <div class="adm-give">
          <p class="adm-label">Give free time</p>
          <div class="adm-chips">
            ${[7, 30, 90, 365].map((n) => `<button class="adm-chip" data-days="${n}">${n === 365 ? 'A year' : `${n} days`}</button>`).join('')}
          </div>
          <form class="adm-inline" id="adm-days">
            <input type="number" name="days" min="1" max="3650" placeholder="Days" aria-label="Number of days" inputmode="numeric">
            <button class="btn btn-ghost btn-sm" type="submit">Give</button>
          </form>
          ${free ? '<button class="btn btn-danger btn-sm" id="adm-end">End the free time now</button>' : ''}
          ${whop ? `<p class="adm-quiet">${whop.renews ? 'Whop charges this account again when its time is up, so free days are added in Whop, not here. ' : 'Free days given here start when the Whop time ends. '}Paid memberships are cancelled in Whop, so they stop charging.</p>` : ''}
          <p class="adm-msg" id="adm-msg" role="status"></p>
        </div>
      </section>
      <section class="adm-card">
        <h2>Payments</h2>
        ${d.payments?.length ? `<ul class="adm-rows">${d.payments.map((p) => `<li><b>${money(p.amount_minor, p.currency)}</b><span>${esc(planName(p.plan_id))}, ${esc(p.provider)}</span><small>${esc(day(p.created_at))}</small></li>`).join('')}</ul>`
          : '<p class="adm-quiet">Nothing paid yet.</p>'}
      </section>
      <section class="adm-card">
        <h2>Changed here</h2>
        ${d.log?.length ? `<ul class="adm-rows">${d.log.map((l) => `<li><b>${esc(logWords(l))}</b><small>${esc(when(l.at))}</small></li>`).join('')}</ul>` : '<p class="adm-quiet">Nothing yet.</p>'}
      </section>
    </div>`;
  const msg = main.querySelector('#adm-msg');
  const give = async (days) => {
    msg.textContent = 'Saving';
    try {
      const r = await api('grant', { user: id, days });
      msg.textContent = `Done. Runs to ${day(r.expires_at)}.`;
      setTimeout(() => oneUser(main, id), 900);
    } catch (err) { msg.textContent = err.message; }
  };
  for (const b of main.querySelectorAll('[data-days]')) b.onclick = () => give(Number(b.dataset.days));
  main.querySelector('#adm-days').onsubmit = (ev) => {
    ev.preventDefault();
    const n = Number(new FormData(ev.currentTarget).get('days'));
    if (n >= 1) give(n);
  };
  const end = main.querySelector('#adm-end');
  if (end) end.onclick = async () => {
    msg.textContent = 'Ending';
    try { await api('end', { user: id }); oneUser(main, id); } catch (err) { msg.textContent = err.message; }
  };
}

/* ---------------------------------------------------------------- calls */

const RESULT = { WON: 'Landed', HALF_WON: 'Half landed', LOST: 'Lost', HALF_LOST: 'Half lost', VOID: 'Void' };
function pickWords(p) {
  const line = p.line == null ? '' : ` ${Number(p.line) > 0 ? '+' : ''}${p.line}`;
  return `${p.market.replace(/_/g, ' ')} ${String(p.outcome).toLowerCase()}${line}`;
}

async function calls(main) {
  const d = await api('picks');
  const totals = (d.days ?? []).reduce((a, x) => ({ n: a.n + Number(x.n), won: a.won + Number(x.won) }), { n: 0, won: 0 });
  main.innerHTML = `
    <header class="adm-head"><h1>Calls</h1><p>${count(d.open?.length)} open. ${totals.n ? `${count(totals.won)} of ${count(totals.n)} landed in 30 days.` : 'Nothing settled in 30 days.'}</p></header>
    <section class="adm-card">
      <h2>Open</h2>
      ${d.open?.length ? `<ul class="adm-rows">${d.open.map((p) => `
        <li><a href="#/fixture/${esc(p.fixture_id)}"><b>${esc(p.home_team)} v ${esc(p.away_team)}</b></a><span>${esc(pickWords(p))}, ${esc(p.odds)} at ${esc(p.bookmaker ?? 'the best price')}</span><small>${esc(when(p.kickoff))}</small></li>`).join('')}</ul>`
        : '<p class="adm-quiet">No open calls. The engine passes on games it cannot call with confidence.</p>'}
    </section>
    <section class="adm-card">
      <h2>Settled, newest first</h2>
      ${d.recent?.length ? `<ul class="adm-rows">${d.recent.map((p) => `
        <li><a href="#/fixture/${esc(p.fixture_id)}"><b>${esc(p.home_team)} ${p.home_goals ?? ''}${p.home_goals != null ? '–' : 'v '}${p.away_goals ?? ''} ${esc(p.away_team)}</b></a><span>${esc(pickWords(p))}, ${esc(p.odds)}</span><small class="adm-res ${String(p.result).toLowerCase()}">${esc(RESULT[p.result] ?? p.result)}</small></li>`).join('')}</ul>`
        : '<p class="adm-quiet">Nothing settled yet.</p>'}
    </section>`;
}

/* ---------------------------------------------------------------- plans */

async function plans(main) {
  const rows = await api('plans');
  main.innerHTML = `
    <header class="adm-head"><h1>Plans</h1><p>The price here is what checkout charges. A change applies to new purchases: members already paying through Whop keep their price. Taking a plan off sale stops new purchases and ends nobody's membership.</p></header>
    <ul class="adm-plans">
      ${rows.map((p) => `
        <li>
          <form data-plan="${esc(p.id)}">
            <label class="adm-f"><span>Name</span><input name="name" value="${esc(p.name)}" maxlength="40"></label>
            <label class="adm-f"><span>Price (£)</span><input name="price" type="number" min="1" max="1000" step="0.01" value="${(p.amount_minor / 100).toFixed(2)}" inputmode="decimal"></label>
            <p class="adm-quiet">${esc(p.days)} days${p.id === 'matchday' ? ', one payment' : ', renews'}</p>
            <label class="adm-toggle"><input type="checkbox" role="switch" class="switch" name="active"${p.active ? ' checked' : ''}><span>On sale</span></label>
            <button class="btn btn-ghost btn-sm" type="submit">Save</button>
            <p class="adm-msg" role="status"></p>
          </form>
        </li>`).join('')}
    </ul>`;
  for (const f of main.querySelectorAll('form[data-plan]')) {
    f.onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(f);
      const msg = f.querySelector('.adm-msg');
      msg.textContent = 'Saving';
      try {
        await api('plan', { id: f.dataset.plan, name: String(fd.get('name')), amount_minor: Math.round(Number(fd.get('price')) * 100), active: fd.get('active') === 'on' });
        msg.textContent = 'Saved.';
      } catch (err) { msg.textContent = err.message; }
    };
  }
}

/* ----------------------------------------------------------------- offers */

const KINDS = { deal: 'Deal', trial: 'Free trial', notice: 'Notice' };
const AUDIENCE = { everyone: 'Everyone', signed_out: 'Signed-out visitors', free: 'Free accounts and visitors' };
const toLocal = (t) => { const d = new Date(t * 1000); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
const fromLocal = (v) => (v ? Math.floor(new Date(v).getTime() / 1000) : null);

function offerState(p) {
  const now = Date.now() / 1000;
  if (!p.active) return ['off', 'Switched off'];
  if (p.starts_at > now) return ['soon', `Starts ${when(p.starts_at)}`];
  if (p.ends_at <= now) return ['over', `Ended ${day(p.ends_at)}`];
  return ['live', `Live to ${when(p.ends_at)}`];
}

async function offers(main, editId) {
  const [rows, planRows] = await Promise.all([api('promos'), api('plans')]);
  const editing = editId === 'new' ? {} : rows.find((r) => r.id === editId);
  if (editId && editing) return offerEditor(main, editing, planRows);
  main.innerHTML = `
    <header class="adm-head adm-head-row">
      <div><h1>Offers</h1><p>Deals and free trials show as a popup and on the plans page. A notice runs as a line across the top of the site.</p></div>
      <a class="btn btn-primary btn-sm" href="#/admin/offers/new">New offer</a>
    </header>
    ${rows.length ? `<ul class="adm-offers">${rows.map((p) => {
      const [k, words] = offerState(p);
      return `<li><a href="#/admin/offers/${esc(p.id)}">
        <span class="adm-state ${k}">${esc(words)}</span>
        <b>${esc(p.title)}</b>
        <small>${esc(KINDS[p.kind])}${p.plan_id ? `, ${esc(planName(p.plan_id))}` : ''}${p.price_minor ? ` at ${money(p.price_minor)}` : ''}${p.trial_days ? `, ${p.trial_days} days free` : ''}</small>
      </a></li>`;
    }).join('')}</ul>` : '<p class="adm-quiet">No offers yet. A deal takes a plan to a lower price until a deadline; a free trial gives new members days before the first charge.</p>'}
    <section class="adm-moments">
      <h2>Big moments</h2>
      <p>These open by themselves: a named derby within a day, a big league back after a break (one card for the whole comeback weekend), a Champions League night. They wait for our calls: a derby until its call is in (a pass only shows on the day, and says so), a league or a night until most of its games are looked at and one is called. Each reader sees each once, and never more than one card a visit. Men’s senior football only. Preview them here with real teams; nothing is remembered.</p>
      <div class="adm-moment-btns">
        <button class="btn btn-ghost btn-sm" type="button" data-moment="derby">El Clásico</button>
        <button class="btn btn-ghost btn-sm" type="button" data-moment="return">Premier League back</button>
        <button class="btn btn-ghost btn-sm" type="button" data-moment="ucl">Champions League night</button>
      </div>
    </section>`;
  for (const b of main.querySelectorAll('[data-moment]')) b.onclick = () => previewMoment(b.dataset.moment);
}

/* Real teams and real fixtures for the previews, read from the public API. */
async function previewMoment(kind) {
  const moments = await import('./lib/moments.js');
  const get = (path) => fetch(path).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const now = Math.floor(Date.now() / 1000);
  let m;
  if (kind === 'derby') {
    const liga = await get('/api/league/3');
    const id = (re) => (liga?.standings ?? []).find((r) => re.test(r.team ?? ''))?.team_id ?? null;
    m = { kind: 'derby', key: 'preview', kicker: 'El Clásico', today: false, fixture: {
      id: 0, home: 'Real Madrid', away: 'FC Barcelona', home_id: id(/real madrid/i), away_id: id(/barcelona/i),
      kickoff: now + 26 * 3600, league: 'La Liga', league_id: 3, colors: { home: '#febe10', away: '#a50044' }, call: 'members' },
      table: { standings: liga?.standings ?? [], last: liga?.last ?? [], scorers: liga?.scorers ?? [] } };
  } else {
    const lid = kind === 'ucl' ? 7 : 1;
    const l = await get(`/api/league/${lid}`);
    const next = (l?.next ?? []).slice().sort((a, b) => a.kickoff - b.kickoff);
    const last = Math.max(0, ...(l?.last ?? []).map((g) => Number(g.kickoff)));
    // As if our calls were in on the first two (the cards wait for calls).
    const games = next.slice(0, 4).map((g, i) => ({ id: g.id, home: g.home, away: g.away, home_id: g.home_id, away_id: g.away_id, kickoff: kind === 'ucl' ? now + 3 * 3600 : g.kickoff, call: i < 2 ? 'open' : 'pass' }));
    const table = { standings: l?.standings ?? [], last: l?.last ?? [], scorers: l?.scorers ?? [] };
    m = kind === 'ucl'
      ? { kind: 'ucl', key: 'preview', leagueId: 7, league: 'Champions League', count: 4, calls: 2, games, table }
      : { kind: 'return', key: 'preview', leagueId: 1, league: 'Premier League', name: 'the Premier League', count: 10, calls: 2, gap: last && next[0] ? Math.floor((next[0].kickoff - last) / 86400) : 19, games, table };
  }
  moments.openMoment(m, previewHelpers, { preview: true });
}

function offerEditor(main, p, planRows) {
  const now = Math.floor(Date.now() / 1000);
  const v = {
    kind: 'deal', audience: 'everyone', starts_at: now, ends_at: now + 3 * 86400,
    plan_id: planRows.find((x) => x.active && x.id !== 'matchday')?.id ?? '', ...p,
  };
  // The plans on sale, plus this offer's own if it has since been taken off
  // sale, so opening it to switch it off does not quietly move it to another.
  const onSale = planRows.filter((x) => x.active || x.id === p.plan_id);
  main.innerHTML = `
    <a class="adm-back" href="#/admin/offers">All offers</a>
    <header class="adm-head"><h1>${p.id ? 'Edit offer' : 'New offer'}</h1></header>
    <form class="adm-form" id="adm-offer">
      <fieldset class="adm-seg" aria-label="Kind of offer">
        ${Object.entries(KINDS).map(([k, label]) => `<label><input type="radio" name="kind" value="${k}"${v.kind === k ? ' checked' : ''}><span>${label}</span></label>`).join('')}
      </fieldset>
      <label class="adm-f"><span>Headline</span><input name="title" maxlength="80" required value="${esc(v.title ?? '')}" placeholder="Derby week: every call for less"></label>
      <label class="adm-f"><span>Text</span><textarea name="body" maxlength="280" rows="3" placeholder="What they get, in a sentence.">${esc(v.body ?? '')}</textarea></label>
      <label class="adm-f"><span>Button</span><input name="cta" maxlength="30" value="${esc(v.cta ?? '')}" placeholder="Get the deal"></label>
      <div class="adm-two" data-for="deal trial">
        <label class="adm-f"><span>Plan</span><select name="plan_id">${onSale.map((x) => `<option value="${esc(x.id)}"${x.id === v.plan_id ? ' selected' : ''}>${esc(x.name)}, ${money(x.amount_minor, x.currency)}${x.active ? '' : ', off sale'}</option>`).join('')}</select></label>
        <label class="adm-f" data-for="deal"><span>Deal price (£)</span><input name="price" type="number" min="1" step="0.01" inputmode="decimal" value="${v.price_minor ? (v.price_minor / 100).toFixed(2) : ''}"></label>
        <label class="adm-f" data-for="trial"><span>Days free</span><input name="trial_days" type="number" min="1" max="60" inputmode="numeric" value="${esc(v.trial_days ?? 7)}"></label>
      </div>
      <div class="adm-two">
        <label class="adm-f"><span>Starts</span><input name="starts_at" type="datetime-local" value="${toLocal(v.starts_at)}"></label>
        <label class="adm-f"><span>Ends</span><input name="ends_at" type="datetime-local" value="${toLocal(v.ends_at)}" required></label>
      </div>
      <label class="adm-f"><span>Who sees it</span><select name="audience">${Object.entries(AUDIENCE).map(([k, label]) => `<option value="${k}"${v.audience === k ? ' selected' : ''}>${label}</option>`).join('')}</select></label>
      <label class="adm-toggle"><input type="checkbox" role="switch" class="switch" name="active"${v.active === 0 ? '' : ' checked'}><span>Switched on</span></label>
      <p class="adm-quiet" data-for="deal">The deal price is what they pay every time it renews, for as long as they keep it. Members already paying are not changed.</p>
      <p class="adm-quiet" data-for="trial">A trial asks for a card and charges after the free days unless cancelled. New members only.</p>
      <div class="adm-actions">
        <button class="btn btn-ghost" type="button" id="adm-preview">Preview</button>
        <button class="btn btn-primary" type="submit">${p.id ? 'Save' : 'Create'}</button>
      </div>
      <p class="adm-msg" id="adm-msg" role="status"></p>
    </form>`;
  const form = main.querySelector('#adm-offer');
  const sync = () => {
    const kind = form.elements.kind.value;
    for (const el of form.querySelectorAll('[data-for]')) el.hidden = !el.dataset.for.split(' ').includes(kind);
  };
  form.addEventListener('change', sync);
  sync();
  const read = () => {
    const fd = new FormData(form);
    const kind = String(fd.get('kind'));
    const plan = planRows.find((x) => x.id === fd.get('plan_id'));
    return {
      ...(p.id ? { id: p.id } : {}),
      kind,
      title: String(fd.get('title') ?? ''),
      body: String(fd.get('body') ?? ''),
      cta: String(fd.get('cta') ?? ''),
      plan_id: kind === 'notice' ? '' : String(fd.get('plan_id') ?? ''),
      price_minor: kind === 'deal' && fd.get('price') ? Math.round(Number(fd.get('price')) * 100) : '',
      trial_days: kind === 'trial' ? Number(fd.get('trial_days')) : '',
      audience: String(fd.get('audience')),
      starts_at: fromLocal(fd.get('starts_at')) ?? '',
      ends_at: fromLocal(fd.get('ends_at')) ?? '',
      active: fd.get('active') === 'on' ? 1 : 0,
      plan: plan ? { id: plan.id, name: plan.name, days: plan.days, amount_minor: plan.amount_minor, currency: plan.currency } : null,
    };
  };
  main.querySelector('#adm-preview').onclick = async () => {
    const promo = await import('./lib/promo.js');
    promo.preview(read());
  };
  form.onsubmit = async (e) => {
    e.preventDefault();
    const msg = main.querySelector('#adm-msg');
    msg.textContent = 'Saving';
    const { plan: _plan, ...body } = read();
    try {
      const r = await api('promo', body);
      msg.textContent = 'Saved.';
      if (!p.id) location.hash = `#/admin/offers/${r.id}`;
    } catch (err) { msg.textContent = err.message; }
  };
}

/* ------------------------------------------------------------------- log */

function logWords(l) {
  let d = {};
  try { d = JSON.parse(l.detail_json ?? '{}') ?? {}; } catch { /* keep empty */ }
  if (l.action === 'grant') return `Gave ${d.days} days free${d.until ? `, to ${day(d.until)}` : ''}`;
  if (l.action === 'end') return 'Ended the free time';
  if (l.action === 'plan') return `Changed the ${planName(l.target)} plan${d.amount_minor ? `, price ${money(d.amount_minor)}` : ''}`;
  if (l.action === 'promo') return `Saved the offer “${d.title ?? l.target}”`;
  return l.action;
}

async function log(main) {
  const rows = await api('log');
  main.innerHTML = `
    <header class="adm-head"><h1>Log</h1><p>Everything changed from this dashboard, newest first.</p></header>
    ${rows.length ? `<ul class="adm-rows adm-log">${rows.map((l) => `
      <li><b>${esc(logWords(l))}</b><span>${l.target_email ? `<a href="#/admin/users/${esc(l.target)}">${esc(l.target_email)}</a>` : ''}</span><small>${esc(when(l.at))}</small></li>`).join('')}</ul>`
      : '<p class="adm-quiet">Nothing changed yet.</p>'}`;
}
