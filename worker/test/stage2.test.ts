import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import type { DatabaseSync } from 'node:sqlite';
import worker from '../src/index.ts';
import { localD1 } from './d1.ts';
import { sha256Hex } from '../src/d1read.ts';
import { deleteAccountData, hadMembership, recordEntitlement, revokeEntitlement } from '../src/paydb.ts';
import { goodwillCredit, goodwillEnded, goodwillNoted, pulledClaim } from '../src/jobsdb.ts';
import { adminCall } from '../src/admindb.ts';
import { webhook } from '../src/pay.ts';
import { deleteAccount } from '../src/account.ts';

/**
 * Stage 2 of the move off Supabase: payments, the owner's dashboard, support
 * tickets, account deletion and the scheduled jobs, on D1. Each runs on a
 * local SQLite built from schema.sql; Supabase is never called (fetch to it
 * fails the test).
 */

let sqlite: DatabaseSync;
let db: any;
let ENV: any;
const realFetch = globalThis.fetch;
const OWNER = 'owner@example.com';
const OWNER_ID = '11111111-1111-4111-8111-111111111111';
const FAN_ID = '22222222-2222-4222-8222-222222222222';
const now = () => Math.floor(Date.now() / 1000);

beforeEach(async () => {
  ({ sqlite, db } = localD1());
  const t = now();
  sqlite.prepare(`INSERT INTO plan (id, name, days, amount_minor, currency, active, sort, updated_at, checkout_url)
    VALUES ('monthly', 'Monthly', 30, 900, 'GBP', 1, 1, ?, 'https://whop.com/checkout/plan_m'),
           ('matchday', 'Matchday pass', 7, 300, 'GBP', 1, 0, ?, NULL)`).run(t, t);
  for (const [id, email] of [[OWNER_ID, OWNER], [FAN_ID, 'fan@example.com']]) {
    sqlite.prepare('INSERT INTO account (id, email, provider, created_at) VALUES (?, ?, ?, ?)').run(id!, email!, 'email', t - 86400);
  }
  ENV = {
    DB: db,
    SITE_URL: 'https://offside.win',
    PAY_PROVIDER: 'whop',
    WHOP_WEBHOOK_SECRET: 'ws_secret',
    ADMIN_EMAIL_SHA256: await sha256Hex(OWNER),
    ASSETS: { fetch: async () => new Response('page') },
    EMAIL: { send: async () => ({ messageId: 'm1' }) },
  };
  globalThis.fetch = (async (url: string | URL | Request) => {
    const u = String(url instanceof Request ? url.url : url);
    if (u.includes('supabase')) throw new Error(`Supabase was called: ${u}`);
    return new Response('{}', { status: 404 });
  }) as typeof fetch;
});
afterEach(() => { globalThis.fetch = realFetch; sqlite.close(); });

async function session(id: string): Promise<string> {
  const token = `tok-${id}-${'x'.repeat(30)}`;
  const t = now();
  sqlite.prepare('INSERT INTO auth_session (token_sha256, account_id, created_at, expires_at, seen_at) VALUES (?, ?, ?, ?, ?)')
    .run(await sha256Hex(token), id, t, t + 86400, t);
  return token;
}

async function signed(body: string): Promise<Headers> {
  const id = 'msg_1';
  const ts = String(now());
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode('ws_secret'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = Buffer.from(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${id}.${ts}.${body}`))).toString('base64');
  return new Headers({ 'webhook-id': id, 'webhook-timestamp': ts, 'webhook-signature': `v1,${sig}` });
}

/* ------------------------------------------------------------ payments */

test('a Whop delivery grants once, by email, and a retry changes nothing', async () => {
  const until = now() + 30 * 86400;
  const body = JSON.stringify({ type: 'membership.went_valid', data: { id: 'mem_7', user: { email: 'Fan@Example.com' }, plan: { id: 'plan_m' }, renewal_period_end: until } });
  for (let i = 0; i < 2; i++) {
    const res = await webhook(new Request('https://offside.win/api/pay/webhook', { method: 'POST', body, headers: await signed(body) }), ENV);
    assert.equal(res.status, 200);
    const out = await res.json() as any;
    assert.equal(out.applied, i === 0, i === 0 ? 'granted' : 'a retry must not grant again');
  }
  const e = sqlite.prepare('SELECT * FROM entitlement').all() as any[];
  assert.equal(e.length, 1);
  assert.equal(e[0].email, 'fan@example.com');
  assert.equal(e[0].plan_id, 'monthly');
  assert.equal(e[0].expires_at, until);
  // The status check's note, in D1's kv.
  assert.ok(sqlite.prepare(`SELECT v FROM kv WHERE k = 'pay:last_webhook'`).get());
  // And the reader is a member on the board.
  const token = await session(FAN_ID);
  const board = await (await worker.fetch(new Request('https://offside.win/api/board', { headers: { authorization: `Bearer ${token}` } }), ENV)).json() as any;
  assert.equal(board.member, true);
});

test('record_entitlement keeps the longer grant and a refund ends it', async () => {
  const t = now();
  await recordEntitlement(db, { p_source: 'whop', p_ref: 'a', p_email: 'x@y.co', p_plan: 'monthly', p_expires: t + 30 * 86400, p_amount: null, p_currency: null, p_raw: '' });
  await recordEntitlement(db, { p_source: 'whop', p_ref: 'b', p_email: 'x@y.co', p_plan: 'matchday', p_expires: t + 7 * 86400, p_amount: null, p_currency: null, p_raw: '' });
  let e = sqlite.prepare('SELECT plan_id, expires_at FROM entitlement').get() as any;
  assert.equal(e.plan_id, 'monthly');
  assert.equal(e.expires_at, t + 30 * 86400);
  assert.deepEqual(await recordEntitlement(db, { p_source: 'whop', p_ref: 'c', p_email: 'x@y.co', p_plan: 'nope', p_expires: null, p_amount: null, p_currency: null, p_raw: '' }), { applied: false, reason: 'unknown plan' });
  assert.deepEqual(await revokeEntitlement(db, 'X@Y.co', 'payment.refunded'), { applied: true });
  e = sqlite.prepare('SELECT status, expires_at FROM entitlement').get() as any;
  assert.equal(e.status, 'payment.refunded');
  assert.ok(e.expires_at <= now());
});

test('checkout on D1: signed-in, the plan from D1, consent kept', async () => {
  const token = await session(FAN_ID);
  const res = await worker.fetch(new Request('https://offside.win/api/pay/checkout', {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ plan: 'monthly', consent: { adult: true, waive: true, terms: '2026-09-27' } }),
  }), ENV);
  assert.equal(res.status, 200);
  assert.equal((await res.json() as any).link, 'https://whop.com/checkout/plan_m?email=fan%40example.com');
  const c = sqlite.prepare('SELECT user_id, plan_id, terms_version FROM purchase_consent').get() as any;
  assert.deepEqual({ ...c }, { user_id: FAN_ID, plan_id: 'monthly', terms_version: '2026-09-27' });
});

test('deleting an account removes it, its sessions and its entitlement, and remembers it had one', async () => {
  const token = await session(FAN_ID);
  const t = now();
  sqlite.prepare(`INSERT INTO entitlement (email, plan_id, expires_at, source, status, created_at, updated_at, renew_stopped_at)
    VALUES ('fan@example.com', 'monthly', ?, 'whop', 'active', ?, ?, ?)`).run(t + 86400, t, t, t);
  sqlite.prepare(`INSERT INTO profile (user_id, display_name, created_at, updated_at) VALUES (?, 'Fan', ?, ?)`).run(FAN_ID, t, t);
  const res = await deleteAccount(new Request('https://offside.win/api/account/delete', { method: 'POST' }), { ...ENV, PAY_PROVIDER: 'whop' }, token);
  assert.equal(res.status, 204);
  assert.equal(sqlite.prepare('SELECT count(*) AS n FROM account WHERE id = ?').get(FAN_ID)!.n, 0);
  assert.equal(sqlite.prepare('SELECT count(*) AS n FROM auth_session').get()!.n, 0);
  assert.equal(sqlite.prepare('SELECT count(*) AS n FROM entitlement').get()!.n, 0);
  assert.equal(sqlite.prepare('SELECT count(*) AS n FROM profile').get()!.n, 0);
  assert.equal(await hadMembership(db, { id: 'someone-new', email: 'fan@example.com' }), true, 'a free trial is not had twice');
  await deleteAccountData(db, 'nobody', null);
});

/* ------------------------------------------------------------- admin */

test('the dashboard answers from D1 for the owner, and refuses anyone else', async () => {
  const owner = await session(OWNER_ID);
  const fan = await session(FAN_ID);
  const get = (path: string, token: string) => worker.fetch(new Request(`https://offside.win${path}`, { headers: { authorization: `Bearer ${token}` } }), ENV);
  assert.equal((await get('/api/admin/overview', fan)).status, 403);
  const ov = await (await get('/api/admin/overview', owner)).json() as any;
  assert.equal(ov.accounts.total, 2);
  assert.equal(typeof ov.engine.health, 'object');
  const users = await (await get('/api/admin/users?q=fan', owner)).json() as any[];
  assert.deepEqual(users.map((u) => u.email), ['fan@example.com']);
  const one = await (await get(`/api/admin/user?id=${FAN_ID}`, owner)).json() as any;
  assert.equal(one.user.email, 'fan@example.com');

  const grant = await worker.fetch(new Request('https://offside.win/api/admin/grant', {
    method: 'POST', headers: { authorization: `Bearer ${owner}`, 'content-type': 'application/json' }, body: JSON.stringify({ user: FAN_ID, days: 7 }),
  }), ENV);
  assert.equal(grant.status, 200);
  const m = sqlite.prepare('SELECT card_brand, expires_at FROM membership WHERE user_id = ?').get(FAN_ID) as any;
  assert.equal(m.card_brand, 'complimentary');
  assert.ok(Math.abs(m.expires_at - (now() + 7 * 86400)) < 5);
  assert.equal(sqlite.prepare(`SELECT action FROM admin_log`).get()!.action, 'grant');
  assert.deepEqual(await adminCall(db, 'admin_end', { p_actor: OWNER_ID, p_user: FAN_ID }), { ok: true });
});

test('plans and offers are checked as before', async () => {
  const t = now();
  assert.deepEqual(await adminCall(db, 'admin_save_plan', { p_actor: OWNER_ID, p_id: 'monthly', p_name: null, p_amount: 50, p_active: null }), { error: 'A price between £1 and £1,000.' });
  const ok = await adminCall(db, 'admin_save_promo', { p_actor: OWNER_ID, p: { kind: 'deal', title: 'Half off', plan_id: 'monthly', price_minor: 450, starts_at: t, ends_at: t + 86400 } }) as any;
  assert.equal(ok.ok, true);
  const clash = await adminCall(db, 'admin_save_promo', { p_actor: OWNER_ID, p: { kind: 'trial', title: 'Try it', plan_id: 'monthly', trial_days: 7, starts_at: t, ends_at: t + 86400 } }) as any;
  assert.match(clash.error, /already runs on this plan/);
  const lower = await adminCall(db, 'admin_save_plan', { p_actor: OWNER_ID, p_id: 'monthly', p_name: null, p_amount: 400, p_active: null }) as any;
  assert.match(lower.error, /sells this plan at £4\.50/);
  const promos = await (await worker.fetch(new Request('https://offside.win/api/promos'), ENV)).json() as any[];
  assert.equal(promos[0].title, 'Half off');
});

test('support: an email files a ticket, a reply threads onto it, the owner answers', async () => {
  const first = await adminCall(db, 'support_inbound', { p_from: 'Fan@Example.com', p_name: 'Fan', p_to: 'hello@offside.win', p_subject: 'Hi', p_body: 'Question', p_message_id: '<a@x>', p_refs: '', p_attachments: 0 }) as any;
  assert.equal(first.new, true);
  const again = await adminCall(db, 'support_inbound', { p_from: 'fan@example.com', p_to: 'hello@offside.win', p_subject: 'Hi', p_body: 'Question', p_message_id: '<a@x>' }) as any;
  assert.equal(again.repeat, true);
  const reply = await adminCall(db, 'support_inbound', { p_from: 'fan@example.com', p_to: 'support@offside.win', p_subject: 'Re: Hi', p_body: 'More', p_message_id: '<b@x>', p_refs: '<a@x>' }) as any;
  assert.equal(reply.ticket, first.ticket);
  await adminCall(db, 'admin_support_reply', { p_actor: OWNER_ID, p_id: first.ticket, p_to: 'fan@example.com', p_subject: 'Re: Hi [#1]', p_body: 'Answer', p_message_id: '<c@offside.win>', p_close: false });
  const list = await adminCall(db, 'admin_support_list', { p_status: 'all', p_limit: 10 }) as any;
  assert.deepEqual(list.counts, { open: 0, waiting: 1, closed: 0 });
  assert.equal(list.tickets[0].messages, 3);
  assert.equal(list.tickets[0].mailbox, 'hello');
  assert.equal(list.tickets[0].user_id, FAN_ID);
  const one = await adminCall(db, 'admin_support_ticket', { p_id: first.ticket }) as any;
  assert.equal(one.account.id, FAN_ID);
  assert.deepEqual(await adminCall(db, 'admin_support_status', { p_actor: OWNER_ID, p_id: 999, p_status: 'closed' }), { error: 'No such ticket.' });
});

/* --------------------------------------------------------- the jobs */

test('pulled-call alerts: each member once, and only those who want them', async () => {
  const t = now();
  sqlite.prepare(`INSERT INTO membership (user_id, plan_id, expires_at, created_at, updated_at) VALUES (?, 'monthly', ?, ?, ?)`).run(FAN_ID, t + 86400, t, t);
  sqlite.prepare(`INSERT INTO entitlement (email, plan_id, expires_at, source, status, created_at, updated_at)
    VALUES ('quiet@example.com', 'monthly', ?, 'whop', 'active', ?, ?)`).run(t + 86400, t, t);
  sqlite.prepare(`INSERT INTO account (id, email, provider, created_at) VALUES ('q', 'quiet@example.com', 'email', ?)`).run(t);
  sqlite.prepare(`INSERT INTO profile (user_id, created_at, updated_at, call_alerts) VALUES ('q', ?, ?, 0)`).run(t, t);
  sqlite.prepare(`INSERT INTO pulled_call (pick_id, fixture_id, kickoff, home, away, market, outcome, line, label, odds, reason, published_at, pulled_at)
    VALUES (1, 10, ?, 'A', 'B', '1x2', 'home', NULL, 'A to win', 1.8, 'News', ?, ?)`).run(t + 3600, t - 600, t - 60);
  const out = await pulledClaim(db);
  assert.deepEqual(out.map((b) => b.email), ['fan@example.com']);
  assert.equal(out[0]!.calls[0].label, 'A to win');
  assert.deepEqual(await pulledClaim(db), [], 'a second run sends nothing');
});

test('goodwill: a quiet day credits paid members once, and the end is reported', async () => {
  const DAY = 86400;
  const day = Math.floor(now() / DAY) * DAY - 10 * DAY;
  // A full board that day and no top-flight football around it.
  for (let i = 0; i < 5; i++) {
    sqlite.prepare(`INSERT INTO fixture (id, league_id, kickoff, home_team, away_team, status, rank, computed_at, board_json, bundle_json)
      VALUES (?, 99, ?, 'H', 'A', 'notstarted', 0, 0, '{}', '{}')`).run(100 + i, day + 3600 * (i + 1));
  }
  const start = day + 5 * DAY;
  sqlite.prepare(`INSERT INTO membership (user_id, plan_id, expires_at, created_at, updated_at, card_brand)
    VALUES (?, 'monthly', ?, ?, ?, 'visa')`).run(FAN_ID, start + 30 * DAY, day - DAY, day - DAY);
  const r = await goodwillCredit(db, day);
  assert.equal(r.lean, true);
  assert.equal(r.started.length, 1);
  assert.equal(sqlite.prepare('SELECT expires_at FROM membership').get()!.expires_at, start + 31 * DAY);
  await goodwillCredit(db, day);
  assert.equal(sqlite.prepare('SELECT expires_at FROM membership').get()!.expires_at, start + 31 * DAY, 'once per day');
  assert.equal(await goodwillNoted(db, `u:${FAN_ID}`, day, 'start'), true);
  assert.equal(await goodwillNoted(db, `u:${FAN_ID}`, day, 'start'), false);
  const ended = await goodwillEnded(db, day + DAY);
  assert.equal(ended.length, 1);
  assert.equal(ended[0]!.days, 1);
});

/* ------------------------------------------------------------ pictures */

test('share cards and pictures are served from D1, with the site picture when there is none', async () => {
  const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
  sqlite.prepare(`INSERT INTO image (path, content_type, data, cache_control, updated_at) VALUES ('og/42.jpg', 'image/jpeg', ?, NULL, 0)`)
    .run(jpg.toString('base64'));
  const card = await worker.fetch(new Request('https://offside.win/og/42.jpg'), ENV);
  assert.equal(card.status, 200);
  assert.equal(card.headers.get('content-type'), 'image/jpeg');
  assert.deepEqual(Buffer.from(await card.arrayBuffer()), jpg);
  const none = await worker.fetch(new Request('https://offside.win/og/43.jpg'), { ...ENV, ASSETS: { fetch: async () => new Response('png') } });
  assert.equal(none.headers.get('x-card'), 'fallback');
  const img = await worker.fetch(new Request('https://offside.win/img/og/42.jpg'), ENV);
  assert.equal(img.status, 200);
  assert.equal((await worker.fetch(new Request('https://offside.win/img/og/99.jpg'), ENV)).status, 404);
  assert.equal((await worker.fetch(new Request('https://offside.win/img/a%2Fb/x.jpg'), ENV)).status, 404);
});
