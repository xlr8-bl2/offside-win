import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseWhop, verifyWhop } from '../src/whop.ts';

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
