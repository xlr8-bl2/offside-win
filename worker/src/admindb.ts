/**
 * The owner's dashboard and support tickets, on D1 (HANDOFF.md, stage 2).
 *
 * Each function here is one of the admin_* / support_inbound Postgres
 * functions in schema.pg.sql, rebuilt over D1 with the same answer, so
 * admin.ts, support.ts and public/js/admin.js need no change in what they
 * read. Accounts come from D1's `account` table where Postgres read
 * auth.users. Only admin.ts calls these, after whoIsAdmin has passed.
 */

import type { AuthDb } from './auth.ts';
import { getHealth, type D1Read } from './d1read.ts';

type Rec = Record<string, any>;
const now = () => Math.floor(Date.now() / 1000);
const DAY = 86400;
const PAID = `('paid', 'succeeded', 'completed')`;

async function all<T = Rec>(db: AuthDb, sql: string, ...params: unknown[]): Promise<T[]> {
  return (await db.prepare(sql).bind(...params).all<T>()).results ?? [];
}
async function first<T = Rec>(db: AuthDb, sql: string, ...params: unknown[]): Promise<T | null> {
  return db.prepare(sql).bind(...params).first<T>();
}
async function run(db: AuthDb, sql: string, ...params: unknown[]): Promise<{ changes: number; id: number | null }> {
  const r = await db.prepare(sql).bind(...params).run() as { meta?: { changes?: number; last_row_id?: number } };
  return { changes: Number(r.meta?.changes ?? 0), id: r.meta?.last_row_id ?? null };
}
const json = (v: unknown) => { if (v === null || v === undefined) return null; try { return JSON.parse(String(v)); } catch { return String(v); } };
const log = (db: AuthDb, actor: string, action: string, target: string | null, detail: unknown) =>
  run(db, 'INSERT INTO admin_log (at, actor, action, target, detail_json) VALUES (?, ?, ?, ?, ?)',
    now(), actor, action, target, detail === null ? null : JSON.stringify(detail));

/** London's calendar date for a time, YYYY-MM-DD. */
const londonDay = (t: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(t * 1000));
const londonShort = (t: number, time = false) => new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London', day: '2-digit', month: 'short', ...(time ? { hour: '2-digit', minute: '2-digit', hour12: false } : { year: 'numeric' }),
}).format(new Date(t * 1000)).replace(',', '');

/* ------------------------------------------------------------ members */

/** admin_live_members(): every account with membership now, one row each. */
async function liveMembers(db: AuthDb): Promise<Array<{ email: string; plan_id: string; expires_at: number; free: boolean; via: string }>> {
  const t = now();
  const rows = await all(db, `
    SELECT lower(a.email) AS email, m.plan_id, m.expires_at, (coalesce(m.card_brand, '') = 'complimentary') AS free, 'membership' AS via
      FROM membership m JOIN account a ON a.id = m.user_id WHERE m.expires_at > ?
    UNION ALL
    SELECT lower(e.email), e.plan_id, e.expires_at, 0, e.source FROM entitlement e WHERE e.status = 'active' AND e.expires_at > ?
    ORDER BY 1, 4, 3 DESC`, t, t);
  const out = new Map<string, any>();
  for (const r of rows) if (!out.has(r.email)) out.set(r.email, { ...r, free: Boolean(r.free) });
  return [...out.values()];
}

export async function adminOverview(db: AuthDb): Promise<Rec> {
  const t = now();
  const today = londonDay(t);
  const dayBack = (n: number) => londonDay(t - n * DAY);
  const live = await liveMembers(db);
  const byPlan: Record<string, number> = {};
  for (const m of live) byPlan[m.plan_id] = (byPlan[m.plan_id] ?? 0) + 1;
  const [acc, money, cur, visitsToday, visitsWeek, days, pages, open, month, slate, settle, writer] = await Promise.all([
    first(db, `SELECT count(*) AS total, sum(created_at > ?) AS day, sum(created_at > ?) AS week, sum(created_at > ?) AS month FROM account`, t - DAY, t - 7 * DAY, t - 30 * DAY),
    first(db, `SELECT coalesce(sum(CASE WHEN created_at > ? THEN amount_minor END), 0) AS week,
        coalesce(sum(CASE WHEN created_at > ? THEN amount_minor END), 0) AS month,
        coalesce(sum(amount_minor), 0) AS "all", count(*) AS payments FROM payment WHERE status IN ${PAID}`, t - 7 * DAY, t - 30 * DAY),
    first<{ currency: string }>(db, 'SELECT currency FROM plan WHERE active = 1 ORDER BY sort LIMIT 1'),
    first<{ n: number }>(db, 'SELECT coalesce(sum(n), 0) AS n FROM page_view WHERE day = ?', today),
    first<{ n: number }>(db, 'SELECT coalesce(sum(n), 0) AS n FROM page_view WHERE day > ?', dayBack(7)),
    all(db, 'SELECT day, sum(n) AS n FROM page_view WHERE day > ? GROUP BY day ORDER BY day', dayBack(14)),
    all<{ page: string; n: number }>(db, 'SELECT page, sum(n) AS n FROM page_view WHERE day > ? GROUP BY page', dayBack(7)),
    first<{ n: number }>(db, `SELECT count(*) AS n FROM pick WHERE kind = 'CONFIDENT' AND settled_at IS NULL`),
    first(db, `SELECT count(*) AS n, coalesce(sum(result IN ('WON', 'HALF_WON')), 0) AS won,
        coalesce(sum(result IN ('LOST', 'HALF_LOST')), 0) AS lost, coalesce(sum(pnl), 0) AS pnl
      FROM pick WHERE kind = 'CONFIDENT' AND settled_at IS NOT NULL AND result <> 'VOID' AND kickoff > ?`, t - 30 * DAY),
    first<{ v: string }>(db, `SELECT v FROM kv WHERE k = 'slate:last_run'`),
    first<{ v: string }>(db, `SELECT v FROM kv WHERE k = 'settle:last_run'`),
    first<{ v: string }>(db, `SELECT v FROM kv WHERE k = 'gemini:budget'`),
  ]);
  return {
    at: t,
    accounts: { total: acc?.total ?? 0, day: acc?.day ?? 0, week: acc?.week ?? 0, month: acc?.month ?? 0 },
    members: { active: live.length, paying: live.filter((m) => !m.free).length, free: live.filter((m) => m.free).length, by_plan: byPlan },
    money: { currency: cur?.currency ?? 'GBP', week: money?.week ?? 0, month: money?.month ?? 0, all: money?.all ?? 0, payments: money?.payments ?? 0 },
    visits: {
      today: visitsToday?.n ?? 0, week: visitsWeek?.n ?? 0, days,
      pages: Object.fromEntries(pages.map((p) => [p.page, p.n])),
    },
    calls: { open: open?.n ?? 0, month },
    engine: {
      health: await getHealth(db as unknown as D1Read),
      slate: slate ? json(slate.v) : null, settle: settle ? json(settle.v) : null, writer: writer ? json(writer.v) : null,
    },
  };
}

export async function adminUsers(db: AuthDb, q: string | null, limit: number, offset: number): Promise<Rec[]> {
  const live = new Map((await liveMembers(db)).map((m) => [m.email, m]));
  const pat = `%${(q ?? '').replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const rows = await all(db, `
    SELECT a.id, a.email, a.created_at, a.last_sign_in_at, pr.display_name, pr.username,
           m.plan_id AS m_plan, m.expires_at AS m_expires, m.auto_renew,
           (SELECT coalesce(sum(amount_minor), 0) FROM payment p WHERE p.user_id = a.id AND p.status IN ${PAID}) AS paid_minor
      FROM account a
      LEFT JOIN profile pr ON pr.user_id = a.id
      LEFT JOIN membership m ON m.user_id = a.id
     WHERE ?2 = '' OR a.email LIKE ?1 ESCAPE '\\' OR pr.display_name LIKE ?1 ESCAPE '\\' OR pr.username LIKE ?1 ESCAPE '\\'
     ORDER BY a.created_at DESC LIMIT ?3 OFFSET ?4`,
  pat, q ?? '', Math.min(Math.max(limit || 50, 1), 200), Math.max(offset || 0, 0));
  return rows.map((r) => {
    const lm = live.get(String(r.email).toLowerCase());
    return {
      id: r.id, email: r.email, created_at: r.created_at, last_sign_in_at: r.last_sign_in_at,
      display_name: r.display_name, username: r.username,
      plan_id: lm?.plan_id ?? r.m_plan ?? null, expires_at: lm?.expires_at ?? r.m_expires ?? null,
      free: lm ? lm.free : null, via: lm?.via ?? null, auto_renew: r.auto_renew ?? null, paid_minor: r.paid_minor,
    };
  });
}

export async function adminUser(db: AuthDb, id: string): Promise<Rec> {
  const u = await first(db, 'SELECT id, email, created_at, last_sign_in_at, provider FROM account WHERE id = ?', id);
  const [profile, membership, entitlement, payments, follows, logRows] = await Promise.all([
    first(db, 'SELECT display_name, username, club_name, created_at FROM profile WHERE user_id = ?', id),
    first(db, 'SELECT plan_id, expires_at, auto_renew, cancelled_at, dunning_from, card_brand, card_last4, created_at FROM membership WHERE user_id = ?', id),
    u ? first(db, 'SELECT plan_id, expires_at, status, source, manage_url, created_at, renew_stopped_at FROM entitlement WHERE email = ?', String(u.email).toLowerCase()) : null,
    all(db, 'SELECT provider, plan_id, amount_minor, currency, status, created_at FROM payment WHERE user_id = ? ORDER BY created_at DESC', id),
    first<{ n: number }>(db, 'SELECT count(*) AS n FROM follow WHERE user_id = ?', id),
    all(db, 'SELECT at, action, detail_json FROM admin_log WHERE target = ? ORDER BY at DESC LIMIT 20', id),
  ]);
  return { user: u, profile, membership, entitlement, payments, follows: follows?.n ?? 0, log: logRows };
}

export async function adminGrant(db: AuthDb, actor: string, user: string, days: number): Promise<Rec> {
  if (!Number.isInteger(days) || days < 1 || days > 3650) return { error: 'Give between 1 and 3,650 days.' };
  const a = await first<{ email: string }>(db, 'SELECT email FROM account WHERE id = ?', user);
  if (!a) return { error: 'No such account.' };
  const t = now();
  const w = await first<{ plan_id: string; expires_at: number; renew_stopped_at: number | null }>(db,
    `SELECT plan_id, expires_at, renew_stopped_at FROM entitlement WHERE email = ? AND status = 'active' AND expires_at > ?`, a.email.toLowerCase(), t);
  if (w && w.renew_stopped_at === null && w.plan_id !== 'matchday') {
    return { error: `This account pays through Whop, next on ${londonShort(w.expires_at)}. Free days here would run alongside time they pay for. Add them to the membership in Whop instead.` };
  }
  const paidTo = Math.max(t, w?.expires_at ?? t);
  const plan = await first<{ id: string }>(db, 'SELECT id FROM plan WHERE active = 1 ORDER BY sort DESC LIMIT 1');
  await run(db, `INSERT INTO membership (user_id, plan_id, expires_at, created_at, updated_at, card_brand)
    VALUES (?, ?, ?, ?, ?, 'complimentary')
    ON CONFLICT (user_id) DO UPDATE SET
      expires_at = max(membership.expires_at, ?) + ?,
      cancelled_at = NULL, dunning_from = NULL, attempts = 0,
      card_brand = CASE WHEN membership.expires_at > ? THEN membership.card_brand ELSE 'complimentary' END,
      updated_at = excluded.updated_at`,
  user, plan?.id ?? 'monthly', paidTo + days * DAY, t, t, paidTo, days * DAY, t);
  const until = (await first<{ expires_at: number }>(db, 'SELECT expires_at FROM membership WHERE user_id = ?', user))?.expires_at ?? null;
  await log(db, actor, 'grant', user, { days, until });
  return { ok: true, expires_at: until };
}

export async function adminEnd(db: AuthDb, actor: string, user: string): Promise<Rec> {
  const t = now();
  const m = await first<{ card_brand: string | null }>(db, 'SELECT card_brand FROM membership WHERE user_id = ? AND expires_at > ?', user, t);
  if (!m) {
    const w = await first(db, `SELECT 1 AS x FROM entitlement e JOIN account a ON a.email = e.email
      WHERE a.id = ? AND e.status = 'active' AND e.expires_at > ?`, user, t);
    return { error: w ? 'This one was paid for through Whop. Cancel it there, or it will go on charging.' : 'That account has no membership running.' };
  }
  if ((m.card_brand ?? '') !== 'complimentary') return { error: 'This one was paid for by card. Ending it here would take time they paid for.' };
  await run(db, 'UPDATE membership SET expires_at = ?, auto_renew = 0, updated_at = ? WHERE user_id = ?', t, t, user);
  await log(db, actor, 'end', user, null);
  return { ok: true };
}

/* -------------------------------------------------------------- calls */

export async function adminPicks(db: AuthDb): Promise<Rec> {
  const t = now();
  const [open, recent, settled] = await Promise.all([
    all(db, `SELECT pk.id, pk.fixture_id, coalesce(f.kickoff, pk.kickoff) AS kickoff, pk.market, pk.outcome, pk.line,
        pk.odds, pk.bookmaker, pk.model_prob, f.home_team, f.away_team, f.league_id
      FROM pick pk LEFT JOIN fixture f ON f.id = pk.fixture_id
      WHERE pk.kind = 'CONFIDENT' AND pk.settled_at IS NULL ORDER BY 3`),
    all(db, `SELECT pk.id, pk.fixture_id, coalesce(f.kickoff, pk.kickoff) AS kickoff, pk.market, pk.outcome, pk.line,
        pk.odds, pk.bookmaker, pk.result, pk.pnl, f.home_team, f.away_team, f.home_goals, f.away_goals
      FROM pick pk LEFT JOIN fixture f ON f.id = pk.fixture_id
      WHERE pk.kind = 'CONFIDENT' AND pk.settled_at IS NOT NULL ORDER BY pk.settled_at DESC LIMIT 60`),
    all<{ kickoff: number; result: string; pnl: number | null }>(db, `SELECT kickoff, result, pnl FROM pick
      WHERE kind = 'CONFIDENT' AND settled_at IS NOT NULL AND result <> 'VOID' AND kickoff > ?`, t - 30 * DAY),
  ]);
  const days = new Map<string, { day: string; n: number; won: number; pnl: number }>();
  for (const p of settled) {
    const d = londonDay(p.kickoff);
    const row = days.get(d) ?? { day: d, n: 0, won: 0, pnl: 0 };
    row.n++;
    if (p.result === 'WON' || p.result === 'HALF_WON') row.won++;
    row.pnl += Number(p.pnl ?? 0);
    days.set(d, row);
  }
  return {
    open, recent: recent.sort((a, b) => b.kickoff - a.kickoff),
    days: [...days.values()].map((d) => ({ ...d, pnl: Math.round(d.pnl * 100) / 100 })).sort((a, b) => (a.day < b.day ? 1 : -1)),
  };
}

/* -------------------------------------------------------- plans, offers */

export async function adminPlans(db: AuthDb): Promise<Rec[]> {
  return all(db, 'SELECT id, name, days, amount_minor, currency, active, sort, checkout_url, updated_at FROM plan ORDER BY sort');
}

const pounds = (minor: number) => (minor / 100).toFixed(2);

export async function adminSavePlan(db: AuthDb, actor: string, id: string, name: string | null, amount: number | null, active: number | null): Promise<Rec> {
  const before = await first(db, 'SELECT name, amount_minor, active FROM plan WHERE id = ?', id);
  if (!before) return { error: 'No such plan.' };
  if (amount !== null && (amount < 100 || amount > 100000)) return { error: 'A price between £1 and £1,000.' };
  if (name !== null && (name.trim().length === 0 || name.length > 40)) return { error: 'A name of up to 40 characters.' };
  const t = now();
  if (amount !== null) {
    const clash = await first<{ title: string; price_minor: number }>(db, `SELECT title, price_minor FROM promo
      WHERE plan_id = ? AND kind = 'deal' AND active = 1 AND ends_at > ? AND price_minor >= ? ORDER BY starts_at LIMIT 1`, id, t, amount);
    if (clash) return { error: `The deal "${clash.title}" sells this plan at £${pounds(clash.price_minor)}. Lower or end it first.` };
  }
  await run(db, `UPDATE plan SET name = coalesce(nullif(trim(?), ''), name), amount_minor = coalesce(?, amount_minor),
    active = coalesce(?, active), updated_at = ? WHERE id = ?`, name, amount, active, t, id);
  await log(db, actor, 'plan', id, { before, name, amount_minor: amount, active });
  return { ok: true };
}

export async function adminPromos(db: AuthDb): Promise<Rec[]> {
  return all(db, 'SELECT * FROM promo ORDER BY starts_at DESC LIMIT 100');
}

export async function adminSavePromo(db: AuthDb, actor: string, p: Rec): Promise<Rec> {
  const t = now();
  const s = (k: string) => (p[k] === undefined || p[k] === null || p[k] === '' ? null : String(p[k]));
  const n = (k: string) => (s(k) === null ? null : Number(s(k)));
  const rand = [...crypto.getRandomValues(new Uint8Array(2))].map((b) => b.toString(16).padStart(2, '0')).join('');
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const id = s('id') ?? `p${stamp}${rand}`;
  const kind = s('kind');
  const plan = s('plan_id');
  const price = n('price_minor');
  const trial = n('trial_days');
  const starts = n('starts_at') ?? t;
  const ends = n('ends_at');
  const active = n('active') ?? 1;
  const audience = s('audience') ?? 'everyone';
  const title = (s('title') ?? '').trim();
  if (!kind || !['deal', 'trial', 'notice'].includes(kind)) return { error: 'Pick a deal, a trial or a notice.' };
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(id)) return { error: 'An id of letters, numbers, dashes and underscores.' };
  if (!['everyone', 'signed_out', 'free'].includes(audience)) return { error: 'Pick who sees it: everyone, signed-out visitors or readers without a membership.' };
  if (!title || String(p.title).length > 80) return { error: 'A headline of up to 80 characters.' };
  if ((s('body') ?? '').length > 280) return { error: 'Keep the text under 280 characters.' };
  if ((s('cta') ?? '').length > 30) return { error: 'Keep the button under 30 characters.' };
  if (ends === null || ends <= starts) return { error: 'It has to end after it starts.' };
  let full: number | null = null;
  if (kind === 'deal' || kind === 'trial') {
    full = (await first<{ amount_minor: number }>(db, 'SELECT amount_minor FROM plan WHERE id = ? AND active = 1', plan))?.amount_minor ?? null;
    if (full === null && active === 1) return { error: 'Pick a plan that is on sale.' };
    if (full === null) full = (await first<{ amount_minor: number }>(db, 'SELECT amount_minor FROM plan WHERE id = ?', plan))?.amount_minor ?? null;
    if (full === null) return { error: 'Pick a plan.' };
  }
  if (kind === 'deal' && (price === null || price < 100 || price >= (full ?? 0))) return { error: "A deal needs a price below the plan's own, and at least £1." };
  if (kind === 'trial' && (trial === null || plan === 'matchday')) return { error: 'A trial needs a number of days and a plan that renews.' };
  if (kind === 'trial' && (trial! < 1 || trial! > 60)) return { error: 'A trial of 1 to 60 days.' };
  if ((kind === 'deal' || kind === 'trial') && active === 1) {
    const c = await first<{ title: string; starts_at: number; ends_at: number }>(db, `SELECT title, starts_at, ends_at FROM promo
      WHERE id <> ? AND active = 1 AND kind IN ('deal', 'trial') AND plan_id = ? AND starts_at < ? AND ends_at > ? AND ends_at > ?
      ORDER BY starts_at LIMIT 1`, id, plan, ends, starts, t);
    if (c) return { error: `"${c.title}" already runs on this plan from ${londonShort(c.starts_at, true)} to ${londonShort(c.ends_at, true)}. Switch it off or change the dates first.` };
  }
  await run(db, `INSERT INTO promo (id, kind, title, body, cta, plan_id, price_minor, trial_days, audience, starts_at, ends_at, active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (id) DO UPDATE SET kind = excluded.kind, title = excluded.title, body = excluded.body, cta = excluded.cta,
      plan_id = excluded.plan_id, price_minor = excluded.price_minor, trial_days = excluded.trial_days,
      audience = excluded.audience, starts_at = excluded.starts_at, ends_at = excluded.ends_at,
      active = excluded.active, updated_at = excluded.updated_at`,
  id, kind, title, s('body')?.trim() || null, s('cta')?.trim() || null,
  kind === 'notice' ? null : plan, kind === 'deal' ? price : null, kind === 'trial' ? trial : null,
  audience, starts, ends, active, t, t);
  await log(db, actor, 'promo', id, p);
  return { ok: true, id };
}

export async function adminLogList(db: AuthDb, limit: number): Promise<Rec[]> {
  return all(db, `SELECT l.at, l.action, l.target, l.detail_json, a.email AS target_email
    FROM admin_log l LEFT JOIN account a ON a.id = l.target ORDER BY l.at DESC LIMIT ?`, Math.min(Math.max(limit || 50, 1), 200));
}

/* ------------------------------------------------------------- support */

const cleanMid = (v: unknown) => {
  const s = String(v ?? '').trim().replace(/^[<\s]+|[>\s]+$/g, '').toLowerCase();
  return s || null;
};

/** support_inbound(): one email in, filed on its ticket or a new one. */
export async function supportInbound(db: AuthDb, a: Rec): Promise<Rec> {
  const t = now();
  const from = String(a.p_from ?? '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+$/.test(from)) return { error: 'no sender' };
  const mid = cleanMid(a.p_message_id);
  const subject = (String(a.p_subject ?? '').trim() || '(no subject)').slice(0, 200);
  const name = String(a.p_name ?? '').trim().slice(0, 120) || null;
  if (mid) {
    const seen = await first<{ ticket_id: number }>(db, 'SELECT ticket_id FROM support_message WHERE message_id = ?', mid);
    if (seen) return { ticket: seen.ticket_id, new: false, repeat: true };
  }
  let ticket: number | null = null;
  const tag = /\[#(\d{1,12})\]/.exec(subject)?.[1];
  if (tag) ticket = (await first<{ id: number }>(db, 'SELECT id FROM support_ticket WHERE id = ? AND email = ?', Number(tag), from))?.id ?? null;
  const refs = String(a.p_refs ?? '').split(/\s+/).map(cleanMid).filter((x): x is string => Boolean(x)).slice(0, 50);
  if (ticket === null && refs.length) {
    ticket = (await first<{ ticket_id: number }>(db, `SELECT m.ticket_id FROM support_message m JOIN support_ticket k ON k.id = m.ticket_id
      WHERE k.email = ? AND m.message_id IN (${refs.map(() => '?').join(', ')}) ORDER BY m.at DESC LIMIT 1`, from, ...refs))?.ticket_id ?? null;
  }
  let fresh = false;
  if (ticket === null) {
    const box = String(a.p_to ?? '').toLowerCase().startsWith('hello@') ? 'hello' : 'support';
    ticket = (await run(db, `INSERT INTO support_ticket (email, name, subject, mailbox, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'open', ?, ?)`, from, name, subject, box, t, t)).id;
    fresh = true;
  }
  await run(db, `INSERT INTO support_message (ticket_id, direction, at, from_email, to_email, subject, body, message_id, attachments)
    VALUES (?, 'in', ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
  ticket, t, from, String(a.p_to ?? '').toLowerCase(), subject, String(a.p_body ?? '').slice(0, 20000), mid, Math.max(Number(a.p_attachments) || 0, 0));
  await run(db, `UPDATE support_ticket SET status = 'open', updated_at = ?, last_in_at = ?, name = coalesce(name, ?) WHERE id = ?`, t, t, name, ticket);
  return { ticket, new: fresh };
}

export async function adminSupportList(db: AuthDb, status: string, limit: number): Promise<Rec> {
  const counts = await first(db, `SELECT coalesce(sum(status = 'open'), 0) AS open, coalesce(sum(status = 'waiting'), 0) AS waiting,
    coalesce(sum(status = 'closed'), 0) AS closed FROM support_ticket`);
  const tickets = await all(db, `
    SELECT k.id, k.email, k.name, k.subject, k.mailbox, k.status, k.created_at, k.updated_at, k.last_in_at, k.last_out_at,
           (SELECT count(*) FROM support_message m WHERE m.ticket_id = k.id) AS messages,
           (SELECT m.body FROM support_message m WHERE m.ticket_id = k.id ORDER BY m.at DESC, m.id DESC LIMIT 1) AS preview,
           (SELECT m.direction FROM support_message m WHERE m.ticket_id = k.id ORDER BY m.at DESC, m.id DESC LIMIT 1) AS last_direction,
           (SELECT a.id FROM account a WHERE a.email = k.email LIMIT 1) AS user_id
      FROM support_ticket k WHERE ? = 'all' OR k.status = ?
     ORDER BY k.updated_at DESC LIMIT ?`, status, status, Math.min(Math.max(limit || 100, 1), 300));
  return {
    counts: { open: counts?.open ?? 0, waiting: counts?.waiting ?? 0, closed: counts?.closed ?? 0 },
    tickets: tickets.map((k) => ({ ...k, preview: k.preview === null ? null : String(k.preview).replace(/\s+/g, ' ').slice(0, 160) })),
  };
}

export async function adminSupportTicket(db: AuthDb, id: number): Promise<Rec | null> {
  const k = await first(db, 'SELECT * FROM support_ticket WHERE id = ?', id);
  if (!k) return null;
  const messages = await all(db, `SELECT id, direction, at, from_email, to_email, subject, body, message_id, attachments
    FROM support_message WHERE ticket_id = ? ORDER BY at, id`, id);
  const u = await first(db, 'SELECT id, created_at FROM account WHERE email = ? LIMIT 1', k.email);
  const account = u ? {
    ...u,
    membership: await first(db, 'SELECT plan_id, expires_at FROM membership WHERE user_id = ?', u.id),
    entitlement: await first(db, 'SELECT plan_id, expires_at, status FROM entitlement WHERE email = ? ORDER BY expires_at DESC LIMIT 1', k.email),
  } : null;
  return { ticket: k, messages, account };
}

export async function adminSupportNew(db: AuthDb, email: string, subject: string): Promise<Rec> {
  const e = email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return { error: 'That email address does not look right.' };
  if (!subject.trim()) return { error: 'Give it a subject.' };
  const t = now();
  const r = await run(db, `INSERT INTO support_ticket (email, subject, mailbox, status, created_at, updated_at)
    VALUES (?, ?, 'support', 'waiting', ?, ?)`, e, subject.trim().slice(0, 200), t, t);
  return { id: r.id };
}

export async function adminSupportDrop(db: AuthDb, id: number): Promise<Rec> {
  await run(db, 'DELETE FROM support_ticket WHERE id = ? AND NOT EXISTS (SELECT 1 FROM support_message m WHERE m.ticket_id = ?)', id, id);
  return { ok: true };
}

export async function adminSupportReply(db: AuthDb, a: Rec): Promise<Rec> {
  const id = Number(a.p_id);
  if (!await first(db, 'SELECT 1 AS x FROM support_ticket WHERE id = ?', id)) return { error: 'No such ticket.' };
  const t = now();
  await run(db, `INSERT INTO support_message (ticket_id, direction, at, from_email, to_email, subject, body, message_id, actor)
    VALUES (?, 'out', ?, 'support@offside.win', ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
  id, t, String(a.p_to ?? '').toLowerCase(), String(a.p_subject ?? '').slice(0, 200), String(a.p_body ?? '').slice(0, 20000), cleanMid(a.p_message_id), a.p_actor);
  await run(db, 'UPDATE support_ticket SET status = ?, updated_at = ?, last_out_at = ? WHERE id = ?', a.p_close ? 'closed' : 'waiting', t, t, id);
  await log(db, String(a.p_actor), 'support_reply', `ticket:${id}`, { ticket: id, closed: Boolean(a.p_close) });
  return { ok: true };
}

export async function adminSupportStatus(db: AuthDb, actor: string, id: number, status: string): Promise<Rec> {
  if (!['open', 'waiting', 'closed'].includes(status)) return { error: 'No such state.' };
  const r = await run(db, 'UPDATE support_ticket SET status = ?, updated_at = ? WHERE id = ?', status, now(), id);
  if (!r.changes) return { error: 'No such ticket.' };
  await log(db, actor, 'support_status', `ticket:${id}`, { ticket: id, status });
  return { ok: true };
}

/** The admin_* function by name, with its PostgREST arguments, as admin.ts calls it. */
export async function adminCall(db: AuthDb, fn: string, a: Rec): Promise<unknown> {
  switch (fn) {
    case 'admin_overview': return adminOverview(db);
    case 'admin_users': return adminUsers(db, a.p_q ?? null, Number(a.p_limit ?? 50), Number(a.p_offset ?? 0));
    case 'admin_user': return adminUser(db, String(a.p_user));
    case 'admin_grant': return adminGrant(db, String(a.p_actor), String(a.p_user), Number(a.p_days));
    case 'admin_end': return adminEnd(db, String(a.p_actor), String(a.p_user));
    case 'admin_picks': return adminPicks(db);
    case 'admin_plans': return adminPlans(db);
    case 'admin_save_plan': return adminSavePlan(db, String(a.p_actor), String(a.p_id), a.p_name ?? null, a.p_amount ?? null, a.p_active ?? null);
    case 'admin_promos': return adminPromos(db);
    case 'admin_save_promo': return adminSavePromo(db, String(a.p_actor), (a.p ?? {}) as Rec);
    case 'admin_log_list': return adminLogList(db, Number(a.p_limit ?? 50));
    case 'admin_support_list': return adminSupportList(db, String(a.p_status ?? 'open'), Number(a.p_limit ?? 100));
    case 'admin_support_ticket': return adminSupportTicket(db, Number(a.p_id));
    case 'admin_support_new': return adminSupportNew(db, String(a.p_email ?? ''), String(a.p_subject ?? ''));
    case 'admin_support_drop': return adminSupportDrop(db, Number(a.p_id));
    case 'admin_support_reply': return adminSupportReply(db, a);
    case 'admin_support_status': return adminSupportStatus(db, String(a.p_actor), Number(a.p_id), String(a.p_status));
    case 'support_inbound': return supportInbound(db, a);
    default: throw new Error(`no D1 version of ${fn}`);
  }
}
