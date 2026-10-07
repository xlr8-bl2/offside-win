import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import worker from '../src/index.ts';
import { cleanEmail, landing, verifyGoogle } from '../src/auth.ts';
import { sha256Hex } from '../src/d1read.ts';

/**
 * Signing in without Supabase (auth.ts, profile.ts), end to end through the
 * router, on a local SQLite built from schema.sql standing in for D1. Mail is
 * caught by a fake EMAIL binding so the link can be read back out of it.
 */

function d1(db: DatabaseSync) {
  const clean = (vs: unknown[]) => vs.map((v) => (typeof v === 'boolean' ? (v ? 1 : 0) : v === undefined ? null : v));
  const make = (sql: string, params: unknown[]): any => ({
    bind: (...values: unknown[]) => make(sql, clean(values)),
    async all() { return { results: db.prepare(sql).all(...(params as never[])) }; },
    async first() { return db.prepare(sql).get(...(params as never[])) ?? null; },
    async run() { const r = db.prepare(sql).run(...(params as never[])); return { meta: { changes: Number(r.changes) } }; },
  });
  return {
    prepare: (sql: string) => make(sql, []),
    async batch(sts: any[]) {
      db.exec('BEGIN');
      try {
        const out = [];
        for (const s of sts) out.push(/^\s*(SELECT|WITH)/i.test(s.sql ?? '') ? await s.all() : await s.all());
        db.exec('COMMIT');
        return out;
      } catch (e) { db.exec('ROLLBACK'); throw e; }
    },
  };
}

let sqlite: DatabaseSync;
let ENV: any;
let sent: Array<{ to: string; raw: string }>;
const realFetch = globalThis.fetch;

beforeEach(() => {
  sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../../schema.sql', import.meta.url), 'utf8'));
  sent = [];
  ENV = {
    DB: d1(sqlite),
    SITE_URL: 'https://offside.win',
    GOOGLE_CLIENT_ID: 'client-1',
    ASSETS: { fetch: async () => new Response('page') },
    EMAIL: { send: async (m: any) => { sent.push({ to: m.to, raw: JSON.stringify(m) }); return { messageId: 'x' }; } },
  };
});
afterEach(() => { globalThis.fetch = realFetch; sqlite.close(); });

const call = (path: string, init: RequestInit & { token?: string } = {}) => {
  const headers = new Headers(init.headers);
  if (init.token) headers.set('authorization', `Bearer ${init.token}`);
  if (init.body) headers.set('content-type', 'application/json');
  return worker.fetch(new Request(`https://offside.win${path}`, { ...init, headers }), ENV);
};
const post = (path: string, body: unknown, token?: string) => call(path, { method: 'POST', body: JSON.stringify(body), token });

async function signInByLink(email: string): Promise<{ session: string; user: any }> {
  const res = await post('/api/auth/link', { email, redirect: 'https://offside.win/' });
  assert.equal(res.status, 200, await res.clone().text());
  const token = /signin=([A-Za-z0-9_-]+)/.exec(sent.at(-1)!.raw)?.[1];
  assert.ok(token, 'the email carries the link');
  const v = await post('/api/auth/verify', { token });
  assert.equal(v.status, 200);
  return v.json() as Promise<any>;
}

test('an email link signs in once, makes the account, and only its hash is stored', async () => {
  const { session, user } = await signInByLink('Reader@Example.com');
  assert.equal(user.email, 'reader@example.com');
  assert.equal(sent[0]!.to, 'reader@example.com');
  const stored = sqlite.prepare('SELECT token_sha256 FROM auth_session').all() as any[];
  assert.equal(stored.length, 1);
  assert.equal(stored[0].token_sha256, await sha256Hex(session));
  // The same link a second time is refused.
  const token = /signin=([A-Za-z0-9_-]+)/.exec(sent[0]!.raw)![1];
  assert.equal((await post('/api/auth/verify', { token })).status, 401);
  // And the session works.
  const me = await call('/api/auth/me', { token: session });
  assert.equal(me.status, 200);
  assert.equal(((await me.json()) as any).user.email, 'reader@example.com');
});

test('an account carried over from Supabase keeps its id, and so its membership', async () => {
  const id = '11111111-1111-1111-1111-111111111111';
  const t = Math.floor(Date.now() / 1000);
  sqlite.prepare('INSERT INTO account (id, email, provider, created_at) VALUES (?, ?, ?, ?)').run(id, 'member@example.com', 'email', t - 86400);
  sqlite.prepare('INSERT INTO membership (user_id, plan_id, expires_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(id, 'monthly', t + 86400, t, t);
  const { session, user } = await signInByLink('member@example.com');
  assert.equal(user.id, id);
  const acct = await (await call('/api/account', { token: session })).json() as any;
  assert.equal(acct.email, 'member@example.com');
  assert.equal(acct.membership.plan_id, 'monthly');
  const board = await (await call('/api/board', { token: session })).json() as any;
  assert.equal(board.member, true);
  const anon = await (await call('/api/board')).json() as any;
  assert.equal(anon.member, false);
});

test('a Whop entitlement on the email counts as a membership', async () => {
  const t = Math.floor(Date.now() / 1000);
  sqlite.prepare(`INSERT INTO entitlement (email, plan_id, expires_at, source, status, created_at, updated_at)
    VALUES (?, ?, ?, 'whop', 'active', ?, ?)`).run('whop@example.com', 'monthly', t + 86400, t, t);
  const { session } = await signInByLink('whop@example.com');
  const board = await (await call('/api/board', { token: session })).json() as any;
  assert.equal(board.member, true);
});

test('a made-up or expired token reads as signed out, not an error', async () => {
  const res = await call('/api/board', { token: 'x'.repeat(43) });
  assert.equal(res.status, 200);
  assert.equal(((await res.json()) as any).member, false);
  assert.equal((await call('/api/auth/me', { token: 'x'.repeat(43) })).status, 401);
});

test('signing out ends the session; everywhere ends them all', async () => {
  const a = await signInByLink('out@example.com');
  const b = await signInByLink('out@example.com');
  await post('/api/auth/signout', {}, a.session);
  assert.equal((await call('/api/auth/me', { token: a.session })).status, 401);
  assert.equal((await call('/api/auth/me', { token: b.session })).status, 200);
  const c = await signInByLink('out@example.com');
  await post('/api/auth/signout', { everywhere: true }, c.session);
  assert.equal((await call('/api/auth/me', { token: b.session })).status, 401);
});

test('links are capped per address', async () => {
  for (let i = 0; i < 5; i++) assert.equal((await post('/api/auth/link', { email: 'cap@example.com' })).status, 200);
  assert.equal((await post('/api/auth/link', { email: 'cap@example.com' })).status, 429);
  assert.equal((await post('/api/auth/link', { email: 'not an email' })).status, 400);
});

test('profile, follows and alerts are written for the session\'s account only', async () => {
  const { session, user } = await signInByLink('me@example.com');
  const saved = await post('/api/account/save_profile', { p_name: '  Ash  ', p_odds: 'fractional', p_username: '@Ash_1' }, session);
  assert.equal(saved.status, 200);
  const p = await saved.json() as any;
  assert.equal(p.display_name, 'Ash');
  assert.equal(p.odds_format, 'fractional');
  assert.equal(p.username, 'ash_1');
  // Null leaves the name as it was.
  const again = await (await post('/api/account/save_profile', { p_name: null, p_odds: 'decimal' }, session)).json() as any;
  assert.equal(again.display_name, 'Ash');
  assert.equal(again.odds_format, 'decimal');
  assert.equal((await post('/api/account/save_profile', { p_username: 'admin' }, session)).status, 409);
  assert.equal((await post('/api/account/save_profile', { p_odds: 'roman' }, session)).status, 400);

  const list = await (await post('/api/account/set_follow', { p_kind: 'team', p_ref: 42, p_label: 'Arsenal', p_on: true }, session)).json() as any[];
  assert.deepEqual(list, [{ kind: 'team', id: 42, label: 'Arsenal' }]);
  assert.equal(await (await post('/api/account/set_call_alerts', { p_on: false }, session)).json(), false);

  const other = await signInByLink('other@example.com');
  assert.equal((await post('/api/account/save_profile', { p_username: 'ash_1' }, other.session)).status, 409);
  assert.equal((await post('/api/account/set_follow', { p_kind: 'team', p_ref: 1, p_on: true })).status, 401);

  const acct = await (await call('/api/account', { token: session })).json() as any;
  assert.equal(acct.profile.call_alerts, false);
  assert.deepEqual(acct.follows, [{ kind: 'team', id: 42, label: 'Arsenal' }]);
  assert.equal(user.email, 'me@example.com');
});

test('links land on this site only', () => {
  assert.equal(landing('https://offside.win', 'https://evil.example/x').toString(), 'https://offside.win/');
  assert.equal(landing('https://offside.win', 'https://offside.win/?a=1#/board').toString(), 'https://offside.win/');
  assert.equal(cleanEmail(' A@B.co '), 'a@b.co');
  assert.equal(cleanEmail('a@b'), null);
});

/* ------------------------------------------------------------ Google */

const b64url = (b: Uint8Array | string) => Buffer.from(b).toString('base64url');

async function googleFixture() {
  const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']) as CryptoKeyPair;
  const jwk = { ...(await crypto.subtle.exportKey('jwk', pair.publicKey) as JsonWebKey), kid: 'k1' };
  const sign = async (claims: Record<string, unknown>, kid = 'k1') => {
    const h = b64url(JSON.stringify({ alg: 'RS256', kid, typ: 'JWT' }));
    const p = b64url(JSON.stringify(claims));
    const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(`${h}.${p}`)));
    return `${h}.${p}.${b64url(sig)}`;
  };
  return { jwk, sign, keys: async (kid: string) => (kid === 'k1' ? jwk : null) };
}

test('a Google token is checked for signature, audience, expiry and nonce', async () => {
  const g = await googleFixture();
  const t = Math.floor(Date.now() / 1000);
  const good = { iss: 'https://accounts.google.com', aud: 'client-1', sub: 'g-1', email: 'G@Example.com', email_verified: true, exp: t + 600, nonce: await sha256Hex('raw-nonce'), name: 'G' };
  assert.equal((await verifyGoogle(await g.sign(good), 'client-1', 'raw-nonce', g.keys))?.email, 'g@example.com');
  assert.equal(await verifyGoogle(await g.sign(good), 'client-1', 'other-nonce', g.keys), null);
  assert.equal(await verifyGoogle(await g.sign({ ...good, aud: 'client-2' }), 'client-1', 'raw-nonce', g.keys), null);
  assert.equal(await verifyGoogle(await g.sign({ ...good, exp: t - 3600 }), 'client-1', 'raw-nonce', g.keys), null);
  assert.equal(await verifyGoogle(await g.sign({ ...good, email_verified: false }), 'client-1', 'raw-nonce', g.keys), null);
  assert.equal(await verifyGoogle(await g.sign({ ...good, iss: 'https://evil.example' }), 'client-1', 'raw-nonce', g.keys), null);
  const forged = (await g.sign(good)).split('.');
  forged[1] = b64url(JSON.stringify({ ...good, email: 'owner@example.com' }));
  assert.equal(await verifyGoogle(forged.join('.'), 'client-1', 'raw-nonce', g.keys), null);
});

test('Google sign-in through the router links the Google account to an existing email account', async () => {
  const g = await googleFixture();
  globalThis.fetch = (async (url: string | URL | Request) => {
    if (String(url).includes('googleapis.com/oauth2/v3/certs')) return new Response(JSON.stringify({ keys: [g.jwk] }));
    return realFetch(url as never);
  }) as typeof fetch;
  const first = await signInByLink('both@example.com');
  const t = Math.floor(Date.now() / 1000);
  const id_token = await g.sign({ iss: 'accounts.google.com', aud: 'client-1', sub: 'g-9', email: 'both@example.com', email_verified: true, exp: t + 600, nonce: await sha256Hex('n'), name: 'Both', picture: 'https://lh3.googleusercontent.com/a' });
  const res = await post('/api/auth/google', { id_token, nonce: 'n' });
  assert.equal(res.status, 200);
  const body = await res.json() as any;
  assert.equal(body.user.id, first.user.id);
  assert.equal(body.user.name, 'Both');
  const row = sqlite.prepare('SELECT google_sub FROM account WHERE id = ?').get(first.user.id) as any;
  assert.equal(row.google_sub, 'g-9');
  assert.equal((await post('/api/auth/google', { id_token, nonce: 'wrong' })).status, 401);
});
