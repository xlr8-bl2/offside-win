import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  accessEndedMail, accountDeletedMail, authMail, deliver, freeTimeMail, membershipMail,
  pulledMail, receiptMail, receiptNumber, renewalStoppedMail, renewedMail, type EmailBinding, type Mail,
} from '../src/mail.ts';
import { authEmailHook, hookSecret, verifyHook } from '../src/authhook.ts';

const NOW = 1_790_000_000;
const until = NOW + 30 * 86400;

const every: Mail[] = [
  membershipMail({ plan: 'monthly', until, consent: { at: NOW, terms: '2026-09-27' } }),
  membershipMail({ plan: 'matchday', until: NOW + 86400 }),
  renewedMail({ plan: 'quarter', until }),
  renewalStoppedMail({ plan: 'monthly', until }),
  renewalStoppedMail({}),
  accessEndedMail({ reason: 'refund' }),
  freeTimeMail({ days: 7, until }),
  accountDeletedMail({ stoppedRenewal: false }),
  accountDeletedMail({ stoppedRenewal: true }),
  receiptMail({ paymentId: 'pay_abc123', at: NOW, plan: 'monthly', amountMinor: 900, currency: 'GBP', until }),
  authMail({ action: 'magiclink', link: 'https://x.supabase.co/auth/v1/verify?token=a&type=magiclink' }),
  authMail({ action: 'signup', link: 'https://x.supabase.co/auth/v1/verify?token=a&type=signup' }),
  authMail({ action: 'reauthentication', link: null, code: '123456' }),
  pulledMail([{ home: 'France', away: 'Belgium', kickoff: NOW + 7200, label: 'France to win', odds: 1.45, bookmaker: 'bet365',
    reason: 'France have made five changes from the side expected. Mbappé doesn’t start.', href: 'https://offside.win/match/1/france-v-belgium' }]),
];

/* ------------------------------------------------------------ the designs */

test('every message has a subject, html and a plain-text twin', () => {
  for (const m of every) {
    assert.ok(m.subject.length > 5, m.tag);
    assert.match(m.html, /^<!doctype html>/, m.tag);
    assert.ok(m.text.length > 40, m.tag);
    // Nothing left as a template hole or an undefined.
    assert.doesNotMatch(m.html + m.text, /undefined|NaN|\$\{/, m.tag);
  }
});

test('mail about betting carries the 18+ line; mail about the account does not need to', () => {
  assert.match(membershipMail({ plan: 'monthly', until }).text, /18\+/);
  assert.doesNotMatch(authMail({ action: 'magiclink', link: 'https://a.b/c' }).text, /18\+/);
});

test('the confirmation keeps the record the law asks for', () => {
  const m = membershipMail({ plan: 'monthly', until, consent: { at: NOW, terms: '2026-09-27' } });
  assert.match(m.text, /14-day right to cancel/);
  assert.match(m.text, /27 September 2026/);
  assert.match(m.text, /renews at the same price/);
  assert.match(membershipMail({ plan: 'matchday', until }).text, /Nothing renews/);
});

test('no message promises money back from betting', () => {
  for (const m of every) assert.doesNotMatch(m.text, /profit|guaranteed|win big|returns/i, m.tag);
});

test('a sign-in link goes in the button and in plain text', () => {
  const link = 'https://x.supabase.co/auth/v1/verify?token=pkce_1&type=magiclink&redirect_to=https%3A%2F%2Foffside.win%2F';
  const m = authMail({ action: 'magiclink', link });
  assert.ok(m.html.includes(link.replace(/&/g, '&amp;')));
  assert.ok(m.text.includes(link));
});

test('what a reader typed is escaped', () => {
  const m = authMail({ action: 'email_change_current', link: 'https://a.b/c', newEmail: '<b>x</b>@y.z' });
  assert.ok(!m.html.includes('<b>x</b>'));
  assert.ok(m.html.includes('&lt;b&gt;x&lt;/b&gt;'));
});

/* ---------------------------------------------------------- the transport */

function binding(fail = false): EmailBinding & { sent: unknown[] } {
  const sent: unknown[] = [];
  return {
    sent,
    async send(msg) {
      if (fail) throw Object.assign(new Error('nope'), { code: 'E_SENDER_NOT_VERIFIED' });
      sent.push(msg);
      return { messageId: 'm1' };
    },
  };
}

test('Cloudflare is used when the binding is there', async () => {
  const EMAIL = binding();
  assert.equal(await deliver({ EMAIL, BREVO_API_KEY: 'k' }, 'a@b.c', every[0]!), 'cloudflare');
  assert.equal(EMAIL.sent.length, 1);
});

test('a Cloudflare refusal falls through to Brevo', async (t) => {
  const calls: string[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string) => { calls.push(String(url)); return new Response('{}', { status: 201 }); });
  assert.equal(await deliver({ EMAIL: binding(true), BREVO_API_KEY: 'k' }, 'a@b.c', every[0]!), 'brevo');
  assert.equal(calls.length, 1);
  assert.match(calls[0]!, /brevo/);
});

test('nothing configured sends nothing and does not throw', async () => {
  assert.equal(await deliver({}, 'a@b.c', every[0]!), null);
});

/* --------------------------------------------------------- the sign-in hook */

const SERVICE = 'service-key-for-tests';

async function signed(body: unknown, secret: string, ts = Math.floor(Date.now() / 1000), id = 'msg_1') {
  const raw = JSON.stringify(body);
  const key = Uint8Array.from(atob(secret.replace(/^v1,whsec_/, '')), (c) => c.charCodeAt(0));
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(`${id}.${ts}.${raw}`)));
  const sig = btoa(String.fromCharCode(...mac));
  return new Request('https://offside.win/api/auth/email', {
    method: 'POST', body: raw,
    headers: { 'webhook-id': id, 'webhook-timestamp': String(ts), 'webhook-signature': `v1,${sig}` },
  });
}

test('the derived secret is in the form Supabase takes, and stable', async () => {
  const s = await hookSecret(SERVICE);
  assert.match(s, /^v1,whsec_[A-Za-z0-9+/]+=*$/);
  assert.equal(s, await hookSecret(SERVICE));
  assert.notEqual(s, await hookSecret('another'));
});

test('a signed delivery verifies; tampered, stale or unsigned ones do not', async () => {
  const secret = await hookSecret(SERVICE);
  const req = await signed({ a: 1 }, secret);
  const raw = await req.clone().text();
  assert.deepEqual(await verifyHook(raw, req.headers, secret), { ok: true });
  assert.equal((await verifyHook(raw + ' ', req.headers, secret)).ok, false);
  assert.equal((await verifyHook(raw, req.headers, await hookSecret('other'))).ok, false);
  const old = await signed({ a: 1 }, secret, Math.floor(Date.now() / 1000) - 3600);
  assert.deepEqual(await verifyHook(await old.clone().text(), old.headers, secret), { ok: false, why: 'stale' });
  assert.deepEqual(await verifyHook(raw, new Headers(), secret), { ok: false, why: 'unsigned' });
});

test('the hook sends a sign-in link built from the token hash', async () => {
  const EMAIL = binding();
  const env = { SUPABASE_URL: 'https://abc.supabase.co', SUPABASE_SERVICE_KEY: SERVICE, EMAIL };
  const req = await signed({
    user: { email: 'a@b.c' },
    email_data: { token: '123456', token_hash: 'pkce_xyz', email_action_type: 'magiclink', redirect_to: 'https://offside.win/' },
  }, await hookSecret(SERVICE));
  const res = await authEmailHook(req, env);
  assert.equal(res.status, 200);
  const msg = EMAIL.sent[0] as { to: string; text: string };
  assert.equal(msg.to, 'a@b.c');
  assert.ok(msg.text.includes('https://abc.supabase.co/auth/v1/verify?token=pkce_xyz&type=magiclink&redirect_to=https%3A%2F%2Foffside.win%2F'));
});

test('an email change sends each address its own half', async () => {
  const EMAIL = binding();
  const env = { SUPABASE_URL: 'https://abc.supabase.co', SUPABASE_SERVICE_KEY: SERVICE, EMAIL };
  const req = await signed({
    user: { email: 'old@b.c', new_email: 'new@b.c' },
    email_data: { token_hash: 'for_new', token_hash_new: 'for_old', email_action_type: 'email_change' },
  }, await hookSecret(SERVICE));
  assert.equal((await authEmailHook(req, env)).status, 200);
  const byTo = Object.fromEntries((EMAIL.sent as Array<{ to: string; text: string }>).map((m) => [m.to, m.text]));
  assert.match(byTo['old@b.c']!, /token=for_old/);
  assert.match(byTo['new@b.c']!, /token=for_new/);
});

test('with no way to send, the hook says so instead of pretending', async () => {
  const env = { SUPABASE_URL: 'https://abc.supabase.co', SUPABASE_SERVICE_KEY: SERVICE };
  const req = await signed({ user: { email: 'a@b.c' }, email_data: { token_hash: 'h', email_action_type: 'magiclink' } }, await hookSecret(SERVICE));
  assert.equal((await authEmailHook(req, env)).status, 500);
});

test('an unsigned call to the hook is refused before anything is sent', async () => {
  const EMAIL = binding();
  const req = new Request('https://offside.win/api/auth/email', { method: 'POST', body: '{}' });
  const res = await authEmailHook(req, { SUPABASE_URL: 'https://abc.supabase.co', SUPABASE_SERVICE_KEY: SERVICE, EMAIL });
  assert.equal(res.status, 401);
  assert.equal(EMAIL.sent.length, 0);
});

/* --------------------------------------------------------- pulled calls */

test('a pulled call says what it was, why, and what replaced it', () => {
  const m = pulledMail([{ home: 'France', away: 'Belgium', kickoff: NOW + 7200, label: 'France to win', odds: 1.45,
    reason: 'France have made five changes from the side expected.', replaced_by: 'Under 2.5 goals', href: 'https://offside.win/match/1/france-v-belgium' }]);
  assert.equal(m.subject, 'Call pulled: France v Belgium');
  assert.match(m.text, /We were on: France to win at odds of 1\.45/);
  assert.match(m.text, /five changes/);
  assert.match(m.text, /switched to Under 2\.5 goals/);
  assert.match(m.text, /See the match: https:\/\/offside\.win\/match\/1\/france-v-belgium/);
  assert.match(m.text, /turn them off on your account page/);
  assert.match(m.text, /18\+/);
});

test('several pulled at once are one email', () => {
  const c = (home: string) => ({ home, away: 'X', kickoff: NOW + 3600, label: `${home} to win`, odds: 1.3, reason: 'With the latest team news and prices, it’s no longer one we’d back.', href: `https://offside.win/match/1/${home}` });
  const m = pulledMail([c('Ajax'), c('PSV'), c('Feyenoord')]);
  assert.equal(m.subject, '3 calls pulled before kick-off');
  assert.match(m.html, /We’ve pulled three calls\./);
  for (const t of ['Ajax v X', 'PSV v X', 'Feyenoord v X']) assert.match(m.html, new RegExp(t));
});

test('no email names the payment processor', () => {
  for (const m of every) {
    assert.doesNotMatch(m.html, /whop/i, m.tag);
    assert.doesNotMatch(m.text, /whop/i, m.tag);
  }
});

test('the receipt says what was bought, what it cost and its number', () => {
  const m = receiptMail({ paymentId: 'pay_abc123', at: NOW, plan: 'monthly', amountMinor: 900, currency: 'GBP', until });
  const no = receiptNumber('pay_abc123');
  assert.match(no, /^OW-[2-9A-HJKMNP-Z]{8}$/);
  assert.equal(receiptNumber('pay_abc123'), no, 'the same payment always has the same number');
  assert.notEqual(receiptNumber('pay_abc124'), no);
  assert.match(m.text, /£9\.00/);
  assert.match(m.text, /Monthly membership/);
  assert.ok(m.text.includes(no));
  assert.ok(m.subject.includes(no));
});
