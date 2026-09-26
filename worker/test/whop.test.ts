import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseWhop, verifyWhop, whopCheckoutBody } from '../src/whop.ts';

const BODY = JSON.stringify({ action: 'membership.went_valid', data: { id: 'mem_1', user: { email: 'Buyer@Example.com' }, plan: { id: 'plan_abc' }, renewal_period_end: '2026-10-24T17:00:00Z' } });
const NOW = 1_800_000_000;
const h = (o: Record<string, string>) => new Headers(o);

const keyBytes = crypto.getRandomValues(new Uint8Array(24));
const b64 = (u: Uint8Array | ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(u)));
const SECRET = `whsec_${b64(keyBytes)}`;

async function standardSig(id: string, t: number, body: string, bytes = keyBytes): Promise<string> {
  const key = await crypto.subtle.importKey('raw', bytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return `v1,${b64(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${id}.${t}.${body}`)))}`;
}
async function digestSig(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return [...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)))].map((b) => b.toString(16).padStart(2, '0')).join('');
}

test('a Standard Webhooks delivery is accepted', async () => {
  const sig = await standardSig('msg_1', NOW, BODY);
  const v = await verifyWhop(BODY, h({ 'webhook-id': 'msg_1', 'webhook-timestamp': String(NOW), 'webhook-signature': sig }), SECRET, NOW);
  assert.deepEqual(v, { ok: true, via: 'standard-webhooks' });
});

test('a rotated secret listed second still matches', async () => {
  const sig = await standardSig('msg_1', NOW, BODY);
  const v = await verifyWhop(BODY, h({ 'webhook-id': 'msg_1', 'webhook-timestamp': String(NOW), 'webhook-signature': `v1,AAAA ${sig}` }), SECRET, NOW);
  assert.equal(v.ok, true);
});

test('a tampered body, a wrong key and a stale stamp are each refused', async () => {
  const sig = await standardSig('msg_1', NOW, BODY);
  const hd = (t = NOW) => h({ 'webhook-id': 'msg_1', 'webhook-timestamp': String(t), 'webhook-signature': sig });
  assert.equal((await verifyWhop(BODY.replace('mem_1', 'mem_2'), hd(), SECRET, NOW)).ok, false);
  assert.equal((await verifyWhop(BODY, hd(), `whsec_${b64(crypto.getRandomValues(new Uint8Array(24)))}`, NOW)).ok, false);
  assert.deepEqual(await verifyWhop(BODY, hd(NOW - 3600), SECRET, NOW), { ok: false, why: 'stale' });
});

test('the plain digest scheme is accepted and a missing secret never is', async () => {
  const v = await verifyWhop(BODY, h({ 'x-whop-signature': await digestSig('plain-secret', BODY) }), 'plain-secret', NOW);
  assert.deepEqual(v, { ok: true, via: 'digest' });
  assert.deepEqual(await verifyWhop(BODY, h({ 'x-whop-signature': 'abc' }), '', NOW), { ok: false, why: 'no-secret' });
  assert.deepEqual(await verifyWhop(BODY, h({}), 'plain-secret', NOW), { ok: false, why: 'no-proof' });
});

test('a membership going valid is read with its email, plan and period end', () => {
  const e = parseWhop(JSON.parse(BODY));
  assert.equal(e.kind, 'valid');
  assert.equal(e.email, 'buyer@example.com');
  assert.equal(e.membershipId, 'mem_1');
  assert.equal(e.planRef, 'plan_abc');
  assert.equal(e.periodEnd, Math.floor(Date.parse('2026-10-24T17:00:00Z') / 1000));
});

test('a membership going invalid, a payment, and an unknown event are told apart', () => {
  assert.equal(parseWhop({ action: 'membership.went_invalid', data: { user: { email: 'a@b.c' } } }).kind, 'invalid');
  const paid = parseWhop({ action: 'payment.succeeded', data: { id: 'pay_9', final_amount: '9.00', currency: 'gbp', user: { email: 'a@b.c' }, membership: { id: 'mem_1' } } });
  assert.equal(paid.kind, 'paid');
  assert.equal(paid.paymentId, 'pay_9');
  assert.equal(paid.amountMinor, 900);
  assert.equal(paid.currency, 'GBP');
  assert.equal(parseWhop({ action: 'something.else', data: {} }).kind, 'ignore');
  assert.equal(parseWhop({ action: 'membership.went_valid', data: {} }).email, null);
});

/* ------------------------------------------------ Whop's current format */

test("a ws_ secret, Whop's own format, is the HMAC key as written", async () => {
  // Whop documents the key as the ws_ string itself; it must not be base64-decoded.
  const secret = 'ws_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcd';
  const body = JSON.stringify({ type: 'payment.succeeded', data: { id: 'pay_1' } });
  const sig = await standardSig("msg_9", NOW, body, new Uint8Array(new TextEncoder().encode(secret)));
  const v = await verifyWhop(body, h({ 'webhook-id': 'msg_9', 'webhook-timestamp': String(NOW), 'webhook-signature': sig }), secret, NOW);
  assert.deepEqual(v, { ok: true, via: 'standard-webhooks' });
});

test('a payment from our own checkout is read by account id, plan and total', () => {
  const uid = '3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f';
  const e = parseWhop({
    type: 'payment.succeeded',
    data: {
      id: 'pay_9', total: 9, currency: 'gbp',
      user: { email: 'typed-something-else@example.com' },
      plan: { id: 'plan_x' }, membership: { id: 'mem_9' },
      metadata: { user_id: uid, plan: 'monthly' },
    },
  });
  assert.equal(e.kind, 'paid');
  assert.equal(e.userId, uid);
  assert.equal(e.ourPlan, 'monthly');
  assert.equal(e.amountMinor, 900);
  assert.equal(e.currency, 'GBP');
});

test('metadata that is not an account id is ignored rather than trusted', () => {
  const e = parseWhop({ type: 'payment.succeeded', data: { id: 'pay_1', user: { email: 'a@b.co' }, metadata: { user_id: 'admin' } } });
  assert.equal(e.userId, null);
  assert.equal(e.email, 'a@b.co');
});

test('the checkout is priced from our plan row, and a pass does not renew', () => {
  const base = { companyId: 'biz_1', user: { id: 'u1', email: 'x@y.z' }, returnUrl: 'https://offside.win/#/account?paid=1' };
  const monthly = whopCheckoutBody({ ...base, plan: { id: 'monthly', name: 'Monthly', amountMinor: 900, currency: 'GBP', days: 30, renews: true } }) as any;
  assert.equal(monthly.plan.plan_type, 'renewal');
  assert.equal(monthly.plan.renewal_price, 9);
  assert.equal(monthly.plan.billing_period, 30);
  assert.equal(monthly.plan.currency, 'gbp');
  assert.equal(monthly.plan.company_id, 'biz_1');
  assert.deepEqual(monthly.metadata, { user_id: 'u1', plan: 'monthly', email: 'x@y.z' });
  const pass = whopCheckoutBody({ ...base, plan: { id: 'matchday', name: 'Matchday pass', amountMinor: 349, currency: 'GBP', days: 7, renews: false } }) as any;
  assert.equal(pass.plan.plan_type, 'one_time');
  assert.equal(pass.plan.initial_price, 3.49);
  assert.equal(pass.plan.expiration_days, 7);
});
