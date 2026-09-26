import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { charge, checkout, confirm, grantFromMembership, sweepWhop, renewal, webhook } from '../src/pay.ts';
import { parseWebhook } from '../src/coinflow.ts';

/**
 * The write routes.
 *
 * Every outbound call is captured so the test can assert what was sent, which
 * is where the security properties actually live: which credential was used,
 * and whether the price came from us or from the caller.
 */

const ENV = {
  SUPABASE_URL: 'https://project.supabase.co',
  SUPABASE_ANON_KEY: 'anon-key',
  SUPABASE_SERVICE_KEY: 'service-key-bypasses-rls',
  COINFLOW_API_KEY: 'merchant-key',
  COINFLOW_WEBHOOK_SECRET: 'whsec_test',
  COINFLOW_BASE_URL: 'https://api-sandbox.coinflow.cash',
  COINFLOW_WALLET: 'WALLET',
  COINFLOW_BLOCKCHAIN: 'solana',
  SITE_URL: 'https://offside.win',
} as any;

let sent: { url: string; method: string; headers: any; body: any }[] = [];
let route: (url: string) => Response;
const realFetch = globalThis.fetch;

beforeEach(() => {
  sent = [];
  route = (url) => {
    if (url.includes('/auth/v1/user')) return new Response(JSON.stringify({ id: 'user-1', email: 'a@b.c' }), { status: 200 });
    if (url.includes('/rest/v1/plan')) return new Response(JSON.stringify([{ id: 'monthly', amount_minor: 900, currency: 'GBP', days: 30 }]), { status: 200 });
    if (url.includes('/checkout/link')) return new Response(JSON.stringify({ link: 'https://pay.example/abc' }), { status: 200 });
    if (url.includes('/rpc/')) return new Response(JSON.stringify({ applied: true }), { status: 200 });
    return new Response('{}', { status: 200 });
  };
  globalThis.fetch = (async (input: any, init: any) => {
    const url = String(typeof input === 'string' ? input : input.url ?? input);
    let body = init?.body;
    try { body = JSON.parse(init?.body); } catch { /* not json */ }
    sent.push({ url, method: init?.method ?? 'GET', headers: init?.headers ?? {}, body });
    return route(url);
  }) as any;
});
afterEach(() => { globalThis.fetch = realFetch; });

const post = (path: string, body: unknown) =>
  new Request('https://offside.win' + path, { method: 'POST', body: JSON.stringify(body) });

const find = (needle: string) => sent.find((c) => c.url.includes(needle));

/* ------------------------------------------------------------- the checkout */

test('checkout refuses anyone who is not signed in', async () => {
  const res = await checkout(post('/api/pay/checkout', {}), ENV, null);
  assert.equal(res.status, 401);
  assert.equal(sent.length, 0, 'it must not reach the processor at all');
});

test('the price comes from the database, never from the caller', async () => {
  // The attack this stops: "I would like to pay one penny for a year."
  const res = await checkout(post('/api/pay/checkout', { plan: 'monthly', amount_minor: 1, days: 3650 }), ENV, 'jwt');
  assert.equal(res.status, 200);

  const order = find('/checkout/link')!;
  assert.equal(order.body.subtotal.cents, 900, 'the caller set the price');
  assert.equal(order.body.subtotal.currency, 'GBP');
  assert.equal(order.body.settlementType, 'USDC', 'settlement must be in stablecoin');
  assert.equal(order.body.zeroAuthorizationConfig.enabled, true, 'the card must be saved for renewal');
});

test('checkout identifies the reader with the issuer rather than trusting the token', async () => {
  await checkout(post('/api/pay/checkout', {}), ENV, 'jwt');
  const who = find('/auth/v1/user');
  assert.ok(who, 'the token was never checked with Supabase');
  assert.equal((who!.headers as any).authorization, 'Bearer jwt');

  const order = find('/checkout/link')!;
  assert.equal((order.headers as any)['x-coinflow-auth-user-id'], 'user-1', 'the order must carry our own user id');
});

test('an unknown plan is refused rather than guessed at', async () => {
  route = (url) => url.includes('/auth/v1/user')
    ? new Response(JSON.stringify({ id: 'user-1' }), { status: 200 })
    : new Response('[]', { status: 200 });
  const res = await checkout(post('/api/pay/checkout', { plan: 'lifetime' }), ENV, 'jwt');
  assert.equal(res.status, 404);
});

test('a forged token buys nothing', async () => {
  route = (url) => url.includes('/auth/v1/user')
    ? new Response('{"msg":"invalid"}', { status: 401 })
    : new Response('{}', { status: 200 });
  const res = await checkout(post('/api/pay/checkout', {}), ENV, 'forged.jwt');
  assert.equal(res.status, 401);
  assert.equal(find('/checkout/link'), undefined);
});

test('the service key is never sent to the processor or used for a checkout', async () => {
  await checkout(post('/api/pay/checkout', {}), ENV, 'jwt');
  const leaked = sent.filter((c) => JSON.stringify(c.headers).includes(ENV.SUPABASE_SERVICE_KEY));
  assert.deepEqual(leaked, [], 'the service key reached a request that did not need it');
});

/* -------------------------------------------------------------- the renewal */

test('renewal is made with the reader own token, not the service key', async () => {
  // Postgres enforces the rest: a policy picks the row, a column grant picks
  // the field. Using the service key here would bypass both.
  const res = await renewal(post('/api/pay/renewal', { auto_renew: true }), ENV, 'jwt');
  assert.equal(res.status, 200);
  const patch = find('/rest/v1/membership')!;
  assert.equal(patch.method, 'PATCH');
  assert.equal((patch.headers as any).authorization, 'Bearer jwt');
  assert.equal(patch.body.auto_renew, 1);
  assert.equal(patch.body.cancelled_at, null);
});

test('cancelling writes the cancellation and does not touch the expiry', async () => {
  await renewal(post('/api/pay/renewal', { auto_renew: false }), ENV, 'jwt');
  const patch = find('/rest/v1/membership')!;
  assert.equal(patch.body.auto_renew, 0);
  assert.ok(typeof patch.body.cancelled_at === 'number');
  assert.ok(!('expires_at' in patch.body), 'cancelling must not shorten access already paid for');
});

test('renewal refuses a caller with no token', async () => {
  assert.equal((await renewal(post('/api/pay/renewal', { auto_renew: true }), ENV, null)).status, 401);
  assert.equal(sent.length, 0);
});

/* -------------------------------------------------------------- the webhook */

async function signed(body: string, secret = 'whsec_test', t = Math.floor(Date.now() / 1000)) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${t}.${body}`));
  const hex = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return new Request('https://offside.win/api/pay/webhook', {
    method: 'POST', body, headers: { 'coinflow-signature': `t=${t},v1=${hex}` },
  });
}

const PAID = JSON.stringify({
  eventType: 'Settled',
  data: { paymentId: 'pay-1', userId: 'user-1', planId: 'monthly', cents: 900, currency: 'usd', brand: 'visa', last4: '4242' },
});

test('an unsigned delivery is refused and writes nothing', async () => {
  const res = await webhook(new Request('https://offside.win/api/pay/webhook', { method: 'POST', body: PAID }), ENV);
  assert.equal(res.status, 401);
  assert.equal(sent.length, 0, 'an unverified delivery reached the database');
});

test('a delivery signed with the wrong secret writes nothing', async () => {
  const res = await webhook(await signed(PAID, 'whsec_wrong'), ENV);
  assert.equal(res.status, 401);
  assert.equal(sent.length, 0);
});

test('a genuine payment is recorded through the service role', async () => {
  const res = await webhook(await signed(PAID), ENV);
  assert.equal(res.status, 200);

  const call = find('/rpc/record_payment')!;
  assert.equal((call.headers as any).authorization, `Bearer ${ENV.SUPABASE_SERVICE_KEY}`);
  assert.equal(call.body.p_user, 'user-1');
  assert.equal(call.body.p_ref, 'pay-1');
  assert.equal(call.body.p_plan, 'monthly');
  assert.equal(call.body.p_amount, 900);
  assert.equal(call.body.p_currency, 'USD');
  assert.equal(call.body.p_origin_ref, 'pay-1', 'the renewal reference must be captured at the first payment');
  assert.equal(call.body.p_last4, '4242');
});

test('a chargeback revokes rather than records', async () => {
  const body = JSON.stringify({ eventType: 'Chargeback Opened', data: { paymentId: 'pay-1' } });
  const res = await webhook(await signed(body), ENV);
  assert.equal(res.status, 200);
  assert.ok(find('/rpc/revoke_membership'), 'a chargeback left the membership in place');
  assert.equal(find('/rpc/record_payment'), undefined);
});

test('an event we do not care about is acknowledged, not retried', async () => {
  // A 500 here would earn sixteen redeliveries of something irrelevant.
  const body = JSON.stringify({ eventType: 'ACH Batched', data: { paymentId: 'x' } });
  const res = await webhook(await signed(body), ENV);
  assert.equal(res.status, 200);
  assert.equal(sent.length, 0);
});

test('a payment that cannot be attributed is acknowledged but not recorded', async () => {
  // Recording money against nobody is worse than saying it happened.
  const body = JSON.stringify({ eventType: 'Settled', data: { paymentId: 'pay-9', cents: 900 } });
  const res = await webhook(await signed(body), ENV);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, skipped: 'unattributed' });
  assert.equal(find('/rpc/record_payment'), undefined);
});

/* ------------------------------------------------- reading their envelope */

test('the event parser survives the field names being different from our guess', () => {
  // The one thing their docs do not pin down. Every spelling resolves, and a
  // shape we have never seen reports absence rather than inventing a user.
  const a = parseWebhook({ eventType: 'Settled', data: { payment_id: 'p1', user_id: 'u1', cents: 500 } });
  assert.equal(a.paymentId, 'p1');
  assert.equal(a.userId, 'u1');

  const nested = parseWebhook({ eventType: 'Settled', data: { payment: { id: 'p2' }, customer: { externalUserId: 'u2' }, subtotal: { cents: 900 } } });
  assert.equal(nested.paymentId, 'p2');
  assert.equal(nested.userId, 'u2');
  assert.equal(nested.amountMinor, 900);

  const unknown = parseWebhook({ eventType: 'Settled', data: { mystery: true } });
  assert.equal(unknown.userId, null);
  assert.equal(unknown.paymentId, null);

  assert.equal(parseWebhook({}).kind, 'ignore');
  assert.equal(parseWebhook(null).kind, 'ignore');
});

test('every reversal word is classified as a reversal', () => {
  for (const e of ['Chargeback Opened', 'Chargeback Lost', 'Refund', 'Dispute Opened']) {
    assert.equal(parseWebhook({ eventType: e, data: {} }).kind, 'reversed', e);
  }
  for (const e of ['Settled', 'Card Payment Authorized', 'USDC Payment Received']) {
    assert.equal(parseWebhook({ eventType: e, data: {} }).kind, 'paid', e);
  }
});

test('checkout says so plainly when there is no processor configured yet', async () => {
  // The real state of the site between deploying this and opening a merchant
  // account. A 500 here would read as "the site is broken" rather than "not
  // yet", and someone would go looking for a bug that is not there.
  const res = await checkout(post('/api/pay/checkout', {}), { ...ENV, COINFLOW_API_KEY: '' }, 'jwt');
  assert.equal(res.status, 503);
  assert.match((await res.json() as any).error, /not open yet/);
  assert.equal(sent.length, 0, 'it must not even check who is asking');
});

/* --------------------------------------------------------------------- Whop */

test('with Whop live, checkout hands back the plan\'s own link with the email on it', async () => {
  route = (url) => {
    if (url.includes('/auth/v1/user')) return new Response(JSON.stringify({ id: 'user-1', email: 'a@b.c' }), { status: 200 });
    if (url.includes('/rest/v1/plan')) return new Response(JSON.stringify([{ id: 'season', amount_minor: 4900, currency: 'GBP', days: 365, checkout_url: 'https://whop.com/checkout/plan_s' }]), { status: 200 });
    return new Response('{}', { status: 200 });
  };
  const res = await checkout(post('/api/pay/checkout', { plan: 'season' }), { ...ENV, PAY_PROVIDER: 'whop', WHOP_WEBHOOK_SECRET: 'whsec_x' }, 'jwt');
  assert.equal(res.status, 200);
  const { link } = await res.json() as { link: string };
  assert.equal(link, 'https://whop.com/checkout/plan_s?email=a%40b.c');
  assert.ok(!find('/checkout/link'), 'Coinflow must not be called');
});

test('with Whop live, a valid membership grants an entitlement by email', async () => {
  const body = JSON.stringify({ action: 'membership.went_valid', data: { id: 'mem_7', user: { email: 'Fan@Example.com' }, plan: { id: 'plan_m' }, renewal_period_end: 1_900_000_000 } });
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode('plain'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = [...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)))].map((b) => b.toString(16).padStart(2, '0')).join('');
  route = (url) => {
    if (url.includes('/rest/v1/plan')) return new Response(JSON.stringify([{ id: 'monthly', checkout_url: 'https://whop.com/checkout/plan_m' }]), { status: 200 });
    if (url.includes('/rpc/record_entitlement')) return new Response(JSON.stringify({ applied: true, expires_at: 1_900_000_000 }), { status: 200 });
    return new Response('{}', { status: 200 });
  };
  const req = new Request('https://offside.win/api/pay/webhook', { method: 'POST', body, headers: { 'x-whop-signature': sig } });
  const res = await webhook(req, { ...ENV, PAY_PROVIDER: 'whop', WHOP_WEBHOOK_SECRET: 'plain' });
  assert.equal(res.status, 200);
  const call = find('/rpc/record_entitlement')!;
  assert.ok(call, 'the entitlement was not recorded');
  assert.equal(call.body.p_email, 'fan@example.com');
  assert.equal(call.body.p_plan, 'monthly', 'the plan was not matched through its checkout link');
  assert.equal(call.body.p_expires, 1_900_000_000);
  assert.equal((call.headers as any).authorization, 'Bearer service-key-bypasses-rls');
});

test('with Whop live, an unsigned delivery is refused', async () => {
  const req = new Request('https://offside.win/api/pay/webhook', { method: 'POST', body: '{"action":"membership.went_valid"}' });
  const res = await webhook(req, { ...ENV, PAY_PROVIDER: 'whop', WHOP_WEBHOOK_SECRET: 'plain' });
  assert.equal(res.status, 401);
  assert.ok(!sent.some((c) => c.url.includes('/rpc/')), 'nothing may be recorded from an unsigned delivery');
  // Only the note that a delivery was refused, and never its payload.
  const note = sent.find((c) => c.url.includes('/rest/v1/kv'));
  assert.ok(note, 'the refusal should be noted for the status check');
  const v = JSON.parse((note!.body as any).v);
  assert.equal(v.verified, false);
  assert.equal(v.why, 'no-proof');
  assert.ok(!('raw' in v) && !JSON.stringify(v).includes('went_valid') || v.type === 'membership.went_valid');
});

test('a payment from our own checkout lands on the account in its metadata, dated by the membership', async () => {
  const uid = '3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f';
  const body = JSON.stringify({ type: 'payment.succeeded', data: { id: 'pay_5', total: 9, currency: 'gbp', user: { email: 'typed@elsewhere.com' }, membership: { id: 'mem_5', manage_url: 'https://whop.com/billing/manage/mem_5' }, plan: { id: 'plan_q' }, metadata: { user_id: uid, plan: 'monthly' } } });
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode('plain'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = [...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)))].map((b) => b.toString(16).padStart(2, '0')).join('');
  route = (url) => {
    if (url.includes(`/auth/v1/admin/users/${uid}`)) return new Response(JSON.stringify({ id: uid, email: 'Account@Owner.com' }), { status: 200 });
    if (url.includes('/memberships/mem_5')) return new Response(JSON.stringify({ id: 'mem_5', renewal_period_end: '2026-10-26T10:00:00Z' }), { status: 200 });
    if (url.includes('/rpc/record_entitlement')) return new Response(JSON.stringify({ applied: true }), { status: 200 });
    return new Response('[]', { status: 200 });
  };
  const req = new Request('https://offside.win/api/pay/webhook', { method: 'POST', body, headers: { 'x-whop-signature': sig } });
  const res = await webhook(req, { ...ENV, PAY_PROVIDER: 'whop', WHOP_WEBHOOK_SECRET: 'plain', WHOP_API_KEY: 'k' });
  assert.equal(res.status, 200);
  const call = find('/rpc/record_entitlement')!;
  assert.equal(call.body.p_email, 'account@owner.com', 'the account in the metadata, not the address typed into the card form');
  assert.equal(call.body.p_plan, 'monthly');
  assert.equal(call.body.p_ref, 'pay_5');
  assert.equal(call.body.p_amount, 900);
  assert.equal(call.body.p_expires, Math.floor(Date.parse('2026-10-26T10:00:00Z') / 1000));
  assert.equal(call.body.p_manage_url, 'https://whop.com/billing/manage/mem_5');
});

test('with an API key, checkout makes a Whop checkout priced from our plan row', async () => {
  route = (url) => {
    if (url.includes('/auth/v1/user')) return new Response(JSON.stringify({ id: 'user-1', email: 'a@b.c' }), { status: 200 });
    if (url.includes('/rest/v1/plan')) return new Response(JSON.stringify([{ id: 'monthly', name: 'Monthly', amount_minor: 900, currency: 'GBP', days: 30, checkout_url: null }]), { status: 200 });
    if (url.includes('/checkout_configurations')) return new Response(JSON.stringify({ id: 'ch_1', purchase_url: '/checkout/ch_1/' }), { status: 200 });
    return new Response('{}', { status: 200 });
  };
  const res = await checkout(post('/api/pay/checkout', { plan: 'monthly' }), { ...ENV, PAY_PROVIDER: 'whop', WHOP_WEBHOOK_SECRET: 'x', WHOP_API_KEY: 'k', WHOP_COMPANY_ID: 'biz_1', SITE_URL: 'https://offside.win' }, 'jwt');
  const out = await res.json() as any;
  assert.equal(out.checkout, 'ch_1');
  assert.equal(out.link, 'https://whop.com/checkout/ch_1/');
  const whopBody = find('/checkout_configurations')!.body as any;
  assert.equal(whopBody.plan.renewal_price, 9);
  assert.equal(whopBody.metadata.user_id, 'user-1');
  assert.equal(whopBody.redirect_url, 'https://offside.win/#/account?paid=1');
});

/* ------------------------------------------------ asking Whop directly */

const UID = '3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f';
const WHOP = { ...ENV, PAY_PROVIDER: 'whop', WHOP_API_KEY: 'k', WHOP_COMPANY_ID: 'biz_1', WHOP_WEBHOOK_SECRET: 'x' };
const future = new Date(Date.now() + 5 * 86400_000).toISOString();
const mem = (o: Record<string, unknown> = {}) => ({
  id: 'mem_9', status: 'active', created_at: new Date().toISOString(), renewal_period_end: null,
  metadata: { user_id: UID, plan: 'matchday' }, user: { email: 'typed@elsewhere.com' },
  manage_url: 'https://whop.com/billing/manage/mem_9', ...o,
});

test('a live membership from our checkout is granted to its account, dated from the plan when it does not renew', async () => {
  route = (url) => {
    if (url.includes(`/auth/v1/admin/users/${UID}`)) return new Response(JSON.stringify({ id: UID, email: 'Owner@Account.com' }), { status: 200 });
    if (url.includes('/rest/v1/plan')) return new Response(JSON.stringify([{ id: 'matchday', days: 7 }, { id: 'monthly', days: 30 }]), { status: 200 });
    if (url.includes('/rpc/record_entitlement')) return new Response(JSON.stringify({ applied: true }), { status: 200 });
    return new Response('{}', { status: 200 });
  };
  const out = await grantFromMembership(WHOP, mem());
  assert.equal(out.result, 'granted');
  const call = find('/rpc/record_entitlement')!;
  assert.equal(call.body.p_email, 'owner@account.com');
  assert.equal(call.body.p_plan, 'matchday');
  assert.equal(call.body.p_amount, null, 'not a second receipt');
  const expect = Math.floor(Date.now() / 1000) + 7 * 86400;
  assert.ok(Math.abs(call.body.p_expires - expect) < 60, 'seven days from purchase');
  assert.match(call.body.p_ref, /^mem_9:\d+$/);
});

test('a renewing membership is dated by Whop, and a dead one is left alone', async () => {
  route = (url) => {
    if (url.includes('/auth/v1/admin/users/')) return new Response(JSON.stringify({ email: 'o@a.com' }), { status: 200 });
    if (url.includes('/rpc/record_entitlement')) return new Response(JSON.stringify({ applied: true }), { status: 200 });
    return new Response('[]', { status: 200 });
  };
  await grantFromMembership(WHOP, mem({ renewal_period_end: future, metadata: { user_id: UID, plan: 'monthly' } }));
  assert.equal(find('/rpc/record_entitlement')!.body.p_expires, Math.floor(Date.parse(future) / 1000));
  sent = [];
  for (const status of ['canceled', 'expired', 'drafted', 'unresolved']) {
    const r = await grantFromMembership(WHOP, mem({ status }));
    assert.match(r.result, /not live/);
  }
  assert.ok(!find('/rpc/record_entitlement'), 'nothing granted for a dead membership');
});

test('confirm grants only the caller\'s own memberships', async () => {
  route = (url) => {
    if (url.includes('/auth/v1/user')) return new Response(JSON.stringify({ id: UID, email: 'o@a.com' }), { status: 200 });
    if (url.includes('api.whop.com/api/v1/memberships')) return new Response(JSON.stringify({ data: [mem(), mem({ id: 'mem_other', metadata: { user_id: '11111111-2222-4333-8444-555555555555', plan: 'monthly' }, user: { email: 'someone@else.com' } })], page_info: { has_next_page: false } }), { status: 200 });
    if (url.includes('/auth/v1/admin/users/')) return new Response(JSON.stringify({ email: 'o@a.com' }), { status: 200 });
    if (url.includes('/rest/v1/plan')) return new Response(JSON.stringify([{ id: 'matchday', days: 7 }]), { status: 200 });
    if (url.includes('/rpc/record_entitlement')) return new Response(JSON.stringify({ applied: true }), { status: 200 });
    return new Response('{}', { status: 200 });
  };
  const res = await confirm(post('/api/pay/confirm', {}), WHOP, 'jwt');
  const out = await res.json() as any;
  assert.equal(out.checked, 1);
  assert.deepEqual(out.results, ['granted']);
  const grants = sent.filter((c) => c.url.includes('/rpc/record_entitlement'));
  assert.equal(grants.length, 1);
  assert.match(String(grants[0]!.body.p_ref), /^mem_9:/);
});

test('the sweep grants every live membership and notes what it did', async () => {
  route = (url) => {
    if (url.includes('api.whop.com/api/v1/memberships')) return new Response(JSON.stringify({ data: [mem(), mem({ id: 'mem_old', status: 'expired' })], page_info: { has_next_page: false } }), { status: 200 });
    if (url.includes('/auth/v1/admin/users/')) return new Response(JSON.stringify({ email: 'o@a.com' }), { status: 200 });
    if (url.includes('/rest/v1/plan')) return new Response(JSON.stringify([{ id: 'matchday', days: 7 }]), { status: 200 });
    if (url.includes('/rpc/record_entitlement')) return new Response(JSON.stringify({ applied: true }), { status: 200 });
    return new Response('{}', { status: 200 });
  };
  const t = await sweepWhop(WHOP);
  assert.deepEqual(t, { checked: 2, granted: 1, errors: 0 });
  assert.ok(find('/rest/v1/kv'), 'the sweep is noted for the status check');
});

/* ------------------------------------------------ our own checkout page */

test('charge prices from our plan row and passes only the token from the page', async () => {
  route = (url) => {
    if (url.includes('/auth/v1/user')) return new Response(JSON.stringify({ id: UID, email: 'o@a.com' }), { status: 200 });
    if (url.includes('/rest/v1/plan')) return new Response(JSON.stringify([{ id: 'monthly', name: 'Monthly', amount_minor: 900, currency: 'GBP', days: 30 }]), { status: 200 });
    if (url.endsWith('/api/v1/payments')) return new Response(JSON.stringify({ id: 'pay_1', status: 'paid', client_secret: 'cs_1' }), { status: 200 });
    if (url.includes('api.whop.com/api/v1/memberships')) return new Response(JSON.stringify({ data: [mem({ metadata: { user_id: UID, plan: 'monthly' }, renewal_period_end: future })], page_info: {} }), { status: 200 });
    if (url.includes('/auth/v1/admin/users/')) return new Response(JSON.stringify({ email: 'o@a.com' }), { status: 200 });
    if (url.includes('/rpc/record_entitlement')) return new Response(JSON.stringify({ applied: true }), { status: 200 });
    return new Response('{}', { status: 200 });
  };
  const res = await charge(post('/api/pay/charge', { plan: 'monthly', confirmation_token: 'ctok_abc123', amount: 1 }), WHOP, 'jwt');
  const out = await res.json() as any;
  assert.equal(res.status, 200);
  assert.equal(out.status, 'paid');
  assert.equal(out.member, true, 'a paid charge is switched on before the answer');
  const body = find('/api/v1/payments')!.body as any;
  assert.equal(body.confirmation_token, 'ctok_abc123');
  assert.equal(body.account_id, 'biz_1');
  assert.equal(body.plan.renewal_price, 9, 'the price comes from the row, not the request');
  assert.equal(body.plan.plan_type, 'renewal');
  assert.ok(!('company_id' in body.plan));
  assert.equal(body.metadata.user_id, UID);
});

test('charge refuses a malformed token, and falls back when the key may not charge', async () => {
  route = (url) => {
    if (url.includes('/auth/v1/user')) return new Response(JSON.stringify({ id: UID, email: 'o@a.com' }), { status: 200 });
    if (url.includes('/rest/v1/plan')) return new Response(JSON.stringify([{ id: 'matchday', name: 'Matchday pass', amount_minor: 349, currency: 'GBP', days: 7 }]), { status: 200 });
    if (url.endsWith('/api/v1/payments')) return new Response(JSON.stringify({ error: { type: 'forbidden', message: 'Missing permission payment:charge' } }), { status: 403 });
    return new Response('{}', { status: 200 });
  };
  const bad = await charge(post('/api/pay/charge', { plan: 'matchday', confirmation_token: 'not-a-token' }), WHOP, 'jwt');
  assert.equal(bad.status, 400);
  assert.ok(!find('/api/v1/payments'), 'nothing sent to Whop for a malformed token');
  const res = await charge(post('/api/pay/charge', { plan: 'matchday', confirmation_token: 'ctok_x1234' }), WHOP, 'jwt');
  const out = await res.json() as any;
  assert.equal(res.status, 409);
  assert.equal(out.fallback, true);
});

test('a Whop membership running out is left to its date; a refund ends it now', async () => {
  const send = async (payload: unknown) => {
    const body = JSON.stringify(payload);
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode('plain'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sig = [...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)))].map((b) => b.toString(16).padStart(2, '0')).join('');
    const req = new Request('https://offside.win/api/pay/webhook', { method: 'POST', body, headers: { 'x-whop-signature': sig } });
    return webhook(req, { ...ENV, PAY_PROVIDER: 'whop', WHOP_WEBHOOK_SECRET: 'plain' });
  };
  // A matchday pass ending must not take a monthly membership bought after it.
  let res = await send({ type: 'membership.deactivated', data: { id: 'mem_1', user: { email: 'fan@example.com' } } });
  assert.equal(res.status, 200);
  assert.ok(!find('/rpc/revoke_entitlement'), 'a membership ending on its date revoked the entitlement');
  res = await send({ type: 'membership.cancel_at_period_end_changed', data: { id: 'mem_2', user: { email: 'fan@example.com' } } });
  assert.ok(!find('/rpc/revoke_entitlement'), 'cancelling for the period end revoked access that was paid for');
  res = await send({ type: 'payment.refunded', data: { id: 'pay_3', user: { email: 'fan@example.com' } } });
  assert.equal(res.status, 200);
  assert.ok(find('/rpc/revoke_entitlement'), 'a refund must end access');
});
