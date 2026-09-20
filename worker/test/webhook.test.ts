import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_SKEW_SECONDS, parseSignature, safeEqual, verifyWebhook } from '../src/webhook.ts';

const SECRET = 'whsec_a_real_looking_validation_key';
const BODY = JSON.stringify({ eventType: 'Settled', data: { amount: 900 } });
const NOW = 1_800_000_000;

/** Sign a body the way the processor says it does, so the test proves the
 *  agreement rather than repeating the implementation's own opinion. */
async function sign(body: string, secret = SECRET, t = NOW): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${t}.${body}`));
  const hex = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `t=${t},v1=${hex}`;
}

const h = (o: Record<string, string>) => new Headers(o);

/* ----------------------------------------------------------- the happy path */

test('a correctly signed delivery is accepted', async () => {
  const v = await verifyWebhook(BODY, h({ 'coinflow-signature': await sign(BODY) }), SECRET, NOW);
  assert.deepEqual(v, { ok: true, via: 'signature' });
});

test('an uppercase hex digest is accepted', async () => {
  const sig = (await sign(BODY)).replace(/v1=(.*)$/, (_, d) => `v1=${d.toUpperCase()}`);
  assert.equal((await verifyWebhook(BODY, h({ 'coinflow-signature': sig }), SECRET, NOW)).ok, true);
});

test('the documented Authorization fallback is accepted when no signature is offered', async () => {
  const v = await verifyWebhook(BODY, h({ authorization: SECRET }), SECRET, NOW);
  assert.deepEqual(v, { ok: true, via: 'validation-key' });
});

/* ------------------------------------------------------------- the refusals */

test('a tampered body is refused', async () => {
  // The case that matters most: a valid signature over a different amount.
  const sig = await sign(BODY);
  const tampered = JSON.stringify({ eventType: 'Settled', data: { amount: 900000 } });
  const v = await verifyWebhook(tampered, h({ 'coinflow-signature': sig }), SECRET, NOW);
  assert.deepEqual(v, { ok: false, why: 'bad-signature' });
});

test('a body reserialised rather than passed raw does not verify', async () => {
  // Proves the route must use the raw bytes. Same data, different spelling.
  const reserialised = JSON.stringify(JSON.parse(BODY), null, 2);
  const v = await verifyWebhook(reserialised, h({ 'coinflow-signature': await sign(BODY) }), SECRET, NOW);
  assert.equal(v.ok, false);
});

test('a signature made with the wrong secret is refused', async () => {
  const sig = await sign(BODY, 'whsec_someone_elses_key');
  assert.deepEqual(await verifyWebhook(BODY, h({ 'coinflow-signature': sig }), SECRET, NOW), { ok: false, why: 'bad-signature' });
});

test('a stale delivery is refused in both directions', async () => {
  const old = await sign(BODY, SECRET, NOW - MAX_SKEW_SECONDS - 1);
  assert.deepEqual(await verifyWebhook(BODY, h({ 'coinflow-signature': old }), SECRET, NOW), { ok: false, why: 'stale' });

  // A clock ahead of ours is just as suspicious as one behind it.
  const future = await sign(BODY, SECRET, NOW + MAX_SKEW_SECONDS + 1);
  assert.deepEqual(await verifyWebhook(BODY, h({ 'coinflow-signature': future }), SECRET, NOW), { ok: false, why: 'stale' });
});

test('a delivery just inside the window is still accepted', async () => {
  const edge = await sign(BODY, SECRET, NOW - MAX_SKEW_SECONDS);
  assert.equal((await verifyWebhook(BODY, h({ 'coinflow-signature': edge }), SECRET, NOW)).ok, true);
});

test('a wrong validation key is refused', async () => {
  assert.deepEqual(
    await verifyWebhook(BODY, h({ authorization: 'not-the-key' }), SECRET, NOW),
    { ok: false, why: 'bad-key' },
  );
});

test('a delivery offering no proof at all is refused', async () => {
  assert.deepEqual(await verifyWebhook(BODY, h({}), SECRET, NOW), { ok: false, why: 'no-proof' });
});

test('a malformed signature header is refused rather than crashing', async () => {
  for (const bad of ['', 'garbage', 't=,v1=', 'v1=abc', 't=abc,v1=def', 't=0,v1=abc']) {
    const v = await verifyWebhook(BODY, h({ 'coinflow-signature': bad }), SECRET, NOW);
    assert.equal(v.ok, false, `accepted: ${JSON.stringify(bad)}`);
  }
});

test('an unset secret refuses everything rather than allowing it', async () => {
  // A deploy that forgets the secret must break the webhook loudly. The
  // alternative -- an empty secret comparing equal to an absent header -- would
  // hand membership to anyone who found the URL.
  // Signed with a real key, checked against a missing one -- the shape a
  // deploy with an unset secret actually takes.
  const sig = await sign(BODY);
  assert.deepEqual(await verifyWebhook(BODY, h({ authorization: '' }), '', NOW), { ok: false, why: 'no-secret' });
  assert.deepEqual(await verifyWebhook(BODY, h({ authorization: SECRET }), '', NOW), { ok: false, why: 'no-secret' });
  assert.deepEqual(await verifyWebhook(BODY, h({ 'coinflow-signature': sig }), '', NOW), { ok: false, why: 'no-secret' });
});

test('a signature is preferred over a validation key when both are present', async () => {
  // A caller who knows the key but sends a bad signature must not be able to
  // downgrade to the weaker check by supplying both.
  const v = await verifyWebhook(BODY, h({ 'coinflow-signature': 't=1800000000,v1=deadbeef', authorization: SECRET }), SECRET, NOW);
  assert.deepEqual(v, { ok: false, why: 'bad-signature' });
});

/* ------------------------------------------------------------ the internals */

test('the signature header parses in either order and with spaces', () => {
  assert.deepEqual(parseSignature('t=123,v1=abc'), { t: 123, v1: 'abc' });
  assert.deepEqual(parseSignature('v1=abc, t=123'), { t: 123, v1: 'abc' });
  assert.deepEqual(parseSignature(' t = 123 , v1 = abc '), { t: 123, v1: 'abc' });
  assert.equal(parseSignature('t=123'), null);
});

test('safeEqual agrees with equality', () => {
  assert.equal(safeEqual('abc', 'abc'), true);
  assert.equal(safeEqual('abc', 'abd'), false);
  assert.equal(safeEqual('abc', 'abcd'), false);
  assert.equal(safeEqual('', ''), true);
});
