import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import type { DatabaseSync } from 'node:sqlite';
import { localD1 } from './d1.ts';
import worker from '../src/index.ts';
import { cleanCode, codeFor, friendDays, MAX_A_YEAR, recordReferral, REWARD_DAYS, rewards, FRIEND_DAYS } from '../src/referral.ts';
import { whopCheckoutBody } from '../src/whop.ts';

/**
 * Tell a friend (referral.ts): the link, the sign-up it counts, the friend's
 * free days and the sharer's thank-you, on a local SQLite from schema.sql.
 */

let sqlite: DatabaseSync;
let db: any;
let ENV: any;
let sent: Array<{ to: string; raw: string }>;
const realFetch = globalThis.fetch;
const now = () => Math.floor(Date.now() / 1000);
const SHARER = '33333333-3333-4333-8333-333333333333';

beforeEach(() => {
  ({ sqlite, db } = localD1());
  sent = [];
  const t = now();
  sqlite.prepare(`INSERT INTO plan (id, name, days, amount_minor, currency, active, sort, updated_at)
    VALUES ('monthly', 'Monthly', 30, 900, 'GBP', 1, 1, ?), ('matchday', 'Matchday pass', 7, 349, 'GBP', 1, 0, ?)`).run(t, t);
  sqlite.prepare('INSERT INTO account (id, email, provider, created_at) VALUES (?, ?, ?, ?)').run(SHARER, 'sharer@example.com', 'email', t - 86400);
  ENV = {
    DB: db,
    SITE_URL: 'https://offside.win',
    ASSETS: { fetch: async () => new Response('page') },
    EMAIL: { send: async (m: any) => { sent.push({ to: m.to, raw: JSON.stringify(m) }); return { messageId: 'x' }; } },
  };
});
afterEach(() => { globalThis.fetch = realFetch; sqlite.close(); });

const post = (path: string, body: unknown) => worker.fetch(new Request(`https://offside.win${path}`, {
  method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' },
}), ENV);

async function signUpThroughLink(email: string, ref: string): Promise<any> {
  const res = await post('/api/auth/link', { email, redirect: 'https://offside.win/', ref });
  assert.equal(res.status, 200);
  const raw = sent.at(-1)!.raw;
  const token = /signin=([A-Za-z0-9_-]+)/.exec(raw)?.[1];
  assert.match(raw, new RegExp(`ref=${ref}`), 'the email link carries the friend code');
  const v = await post('/api/auth/verify', { token, ref });
  assert.equal(v.status, 200);
  return v.json();
}

test('codes are short, readable and one per account', async () => {
  const a = await codeFor(db, SHARER);
  assert.match(a, /^[a-hjkmnp-z2-9]{6}$/);
  assert.equal(await codeFor(db, SHARER), a);
  assert.equal(cleanCode(` ${a.toUpperCase()} `), a);
  assert.equal(cleanCode('abc'), null);
  assert.equal(cleanCode('o0o0o0'), null);
});

test('a new account on a friend link is counted; an existing one and the sharer are not', async () => {
  const code = await codeFor(db, SHARER);
  const { user } = await signUpThroughLink('friend@example.com', code);
  const row = sqlite.prepare('SELECT referrer_id FROM referral WHERE referred_id = ?').get(user.id) as any;
  assert.equal(row.referrer_id, SHARER);
  // Signing in again on someone else's link changes nothing.
  sqlite.prepare('INSERT INTO account (id, email, provider, created_at) VALUES (?, ?, ?, ?)').run('44444444-4444-4444-8444-444444444444', 'other@example.com', 'email', now());
  const other = await codeFor(db, '44444444-4444-4444-8444-444444444444');
  await signUpThroughLink('friend@example.com', other);
  assert.equal((sqlite.prepare('SELECT referrer_id FROM referral WHERE referred_id = ?').get(user.id) as any).referrer_id, SHARER);
  // An account that already existed before the link is not a referral.
  await signUpThroughLink('sharer@example.com', other);
  assert.equal(sqlite.prepare('SELECT count(*) AS n FROM referral').get()!.n, 1);
  // The sharer's own address never counts.
  assert.equal(await recordReferral(db, code, { id: 'x', email: 'SHARER@example.com' }), false);
});

test('the friend gets free days at checkout only while they have never been a member', async () => {
  const code = await codeFor(db, SHARER);
  const { user } = await signUpThroughLink('friend@example.com', code);
  assert.equal(await friendDays(db, user, false), FRIEND_DAYS);
  assert.equal(await friendDays(db, user, true), 0);
  assert.equal(await friendDays(db, { id: SHARER }, false), 0);
  // The Whop checkout carries them as a trial, marked as the friend's, not a plan switch.
  const body = whopCheckoutBody({
    companyId: 'biz_1', plan: { id: 'monthly', name: 'Monthly', amountMinor: 900, currency: 'GBP', days: 30, renews: true },
    user: { id: user.id, email: user.email }, returnUrl: 'https://offside.win/#/account', trialDays: FRIEND_DAYS, referral: true,
  }) as any;
  assert.equal(body.plan.trial_period_days, FRIEND_DAYS);
  assert.equal(body.metadata.referral, '1');
  assert.equal(body.metadata.switch, undefined);
});

test('the sharer is thanked once, when the friend pays, and the get_account shows the invite', async () => {
  const code = await codeFor(db, SHARER);
  const { user, session } = await signUpThroughLink('friend@example.com', code);
  const acct = await (await worker.fetch(new Request('https://offside.win/api/account', { headers: { authorization: `Bearer ${session}` } }), ENV)).json() as any;
  assert.deepEqual(acct.invite, { friend_days: FRIEND_DAYS });

  // A trial alone earns nothing.
  assert.deepEqual(await rewards(ENV), { paid: 0, rewarded: 0, errors: 0 });
  const t = now();
  sqlite.prepare(`INSERT INTO payment (provider, provider_ref, user_id, plan_id, amount_minor, currency, status, raw_json, created_at)
    VALUES ('whop', 'pay_1', ?, 'monthly', 900, 'GBP', 'succeeded', '', ?)`).run(user.id, t);
  const out = await rewards(ENV);
  assert.equal(out.paid, 1);
  assert.equal(out.rewarded, 1);
  const m = sqlite.prepare('SELECT expires_at, card_brand FROM membership WHERE user_id = ?').get(SHARER) as any;
  assert.ok(Math.abs(m.expires_at - (t + REWARD_DAYS * 86400)) < 5);
  assert.equal(m.card_brand, 'complimentary');
  assert.ok(sent.some((s) => s.to === 'sharer@example.com' && /mate joined/i.test(s.raw)));
  // Run again: nothing more.
  assert.deepEqual(await rewards(ENV), { paid: 0, rewarded: 0, errors: 0 });

  const summary = await (await worker.fetch(new Request('https://offside.win/api/referral', {
    headers: { authorization: `Bearer ${(await signUpThroughLink('sharer@example.com', 'zzzzzz')).session}` },
  }), ENV)).json() as any;
  assert.equal(summary.code, code);
  assert.equal(summary.link, `https://offside.win/?ref=${code}`);
  assert.equal(summary.joined, 1);
  assert.equal(summary.paid, 1);
  assert.equal(summary.days_earned, REWARD_DAYS);
});

test('past the yearly cap a friend still counts, for no days', async () => {
  const t = now();
  for (let i = 0; i < MAX_A_YEAR; i++) {
    sqlite.prepare(`INSERT INTO referral (referred_id, referrer_id, code, created_at, paid_at, reward_days, rewarded_at)
      VALUES (?, ?, 'aaaaaa', ?, ?, ?, ?)`).run(`old-${i}`, SHARER, t, t - 86400, REWARD_DAYS, t);
  }
  sqlite.prepare(`INSERT INTO referral (referred_id, referrer_id, code, created_at) VALUES ('new', ?, 'aaaaaa', ?)`).run(SHARER, t);
  sqlite.prepare(`INSERT INTO payment (provider, provider_ref, user_id, plan_id, amount_minor, currency, status, raw_json, created_at)
    VALUES ('whop', 'pay_2', 'new', 'monthly', 900, 'GBP', 'succeeded', '', ?)`).run(t);
  const out = await rewards(ENV);
  assert.equal(out.paid, 1);
  assert.equal(out.rewarded, 0);
  const r = sqlite.prepare(`SELECT reward_days, rewarded_at FROM referral WHERE referred_id = 'new'`).get() as any;
  assert.equal(r.reward_days, 0);
  assert.ok(r.rewarded_at);
});

test('a sharer Whop bills each month has the next payment moved back instead', async () => {
  const t = now();
  sqlite.prepare(`INSERT INTO entitlement (email, plan_id, expires_at, source, status, created_at, updated_at)
    VALUES ('sharer@example.com', 'monthly', ?, 'whop', 'active', ?, ?)`).run(t + 10 * 86400, t, t);
  sqlite.prepare(`INSERT INTO entitlement_grant (ref, email, plan_id, created_at) VALUES (?, 'sharer@example.com', 'monthly', ?)`).run(`mem_abc:${t + 10 * 86400}`, t);
  sqlite.prepare(`INSERT INTO referral (referred_id, referrer_id, code, created_at) VALUES ('f', ?, 'aaaaaa', ?)`).run(SHARER, t);
  sqlite.prepare(`INSERT INTO payment (provider, provider_ref, user_id, plan_id, amount_minor, currency, status, raw_json, created_at)
    VALUES ('whop', 'pay_3', 'f', 'monthly', 900, 'GBP', 'succeeded', '', ?)`).run(t);
  ENV.WHOP_API_KEY = 'k';
  let asked: any = null;
  globalThis.fetch = (async (url: string, init: any) => {
    asked = { url: String(url), body: JSON.parse(init.body) };
    return new Response(JSON.stringify({ renewal_period_end: t + 24 * 86400 }), { status: 200 });
  }) as any;
  const out = await rewards(ENV);
  assert.equal(out.rewarded, 1);
  assert.match(asked.url, /memberships\/mem_abc\/add_free_days$/);
  assert.equal(asked.body.free_days, REWARD_DAYS);
  assert.equal((sqlite.prepare(`SELECT expires_at FROM entitlement`).get() as any).expires_at, t + 24 * 86400);
  assert.equal(sqlite.prepare('SELECT count(*) AS n FROM membership').get()!.n, 0);
});
