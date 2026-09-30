import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.ts';
import { sha256Hex } from '../src/admin.ts';

/**
 * The dashboard's gate (admin.ts), end to end through the router.
 *
 * GoTrue and PostgREST are stubbed by replacing global fetch. What matters is
 * what reaches the database: nothing at all unless GoTrue named an admin, and
 * then the service key with the acting account GoTrue named -- never one the
 * request body tried to supply.
 */

const OWNER = 'owner@example.com';
const OWNER_ID = '11111111-1111-1111-1111-111111111111';
const OTHER_ID = '22222222-2222-2222-2222-222222222222';

let ENV: any;
let calls: { url: string; headers: Record<string, string>; body: string | null }[] = [];
let gotrue: { status: number; user: Record<string, unknown> };
const realFetch = globalThis.fetch;

beforeEach(async () => {
  ENV = {
    SUPABASE_URL: 'https://project.supabase.co',
    SUPABASE_ANON_KEY: 'anon',
    SUPABASE_SERVICE_KEY: 'service',
    ADMIN_EMAIL_SHA256: await sha256Hex(OWNER),
    ASSETS: { fetch: async () => new Response('page') },
  };
  calls = [];
  gotrue = { status: 200, user: { id: OWNER_ID, email: 'Owner@Example.com', email_confirmed_at: '2026-01-01T00:00:00Z' } };
  globalThis.fetch = (async (input: any, init: any) => {
    const url = String(typeof input === 'string' ? input : input.url ?? input);
    calls.push({ url, headers: { ...(init?.headers ?? {}) }, body: init?.body ?? null });
    if (url.endsWith('/auth/v1/user')) return new Response(JSON.stringify(gotrue.user), { status: gotrue.status });
    return new Response('{"ok":true}', { status: 200 });
  }) as any;
});
afterEach(() => { globalThis.fetch = realFetch; });

const call = (path: string, init: RequestInit = {}, token: string | null = 'tok') =>
  worker.fetch(new Request('https://offside.win' + path, {
    ...init,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(init.headers as Record<string, string> ?? {}) },
  }), ENV);

const dbCalls = () => calls.filter((c) => c.url.includes('/rest/v1/'));

test('signed out: 401 and the database is never asked', async () => {
  const res = await call('/api/admin/overview', {}, null);
  assert.equal(res.status, 401);
  assert.equal(calls.length, 0);
});

test('a token GoTrue rejects: 401', async () => {
  gotrue = { status: 401, user: {} };
  const res = await call('/api/admin/overview');
  assert.equal(res.status, 401);
  assert.equal(dbCalls().length, 0);
});

test('someone else signed in: 403 and nothing reaches the database', async () => {
  gotrue.user = { id: OTHER_ID, email: 'fan@example.com', email_confirmed_at: '2026-01-01T00:00:00Z' };
  const res = await call('/api/admin/overview');
  assert.equal(res.status, 403);
  assert.equal(dbCalls().length, 0);
});

test('the owner\'s address, not yet confirmed: refused', async () => {
  gotrue.user = { id: OWNER_ID, email: OWNER, email_confirmed_at: null };
  const res = await call('/api/admin/overview');
  assert.equal(res.status, 401);
  assert.equal(dbCalls().length, 0);
});

test('no hash configured: switched off, whoever asks', async () => {
  ENV.ADMIN_EMAIL_SHA256 = '';
  const res = await call('/api/admin/overview');
  assert.equal(res.status, 503);
  assert.equal(dbCalls().length, 0);
});

test('the owner: the service key reaches the admin function, and nothing is cached', async () => {
  const res = await call('/api/admin/overview');
  assert.equal(res.status, 200);
  const [c] = dbCalls();
  assert.match(c!.url, /\/rest\/v1\/rpc\/admin_overview$/);
  assert.equal(c!.headers['authorization'], 'Bearer service');
  assert.equal(res.headers.get('cache-control'), 'no-store');
});

test('a grant acts as the account GoTrue named, whatever the body claims', async () => {
  const res = await call('/api/admin/grant', {
    method: 'POST',
    body: JSON.stringify({ user: OTHER_ID, days: 30, p_actor: OTHER_ID, actor: OTHER_ID }),
  });
  assert.equal(res.status, 200);
  const sent = JSON.parse(dbCalls()[0]!.body!);
  assert.deepEqual(sent, { p_actor: OWNER_ID, p_user: OTHER_ID, p_days: 30 });
});

test('writes are POST only: a GET to a write route is not found', async () => {
  const res = await call('/api/admin/grant?user=' + OTHER_ID + '&days=30');
  assert.equal(res.status, 404);
  assert.equal(dbCalls().length, 0);
});

test('an admin route is never served from the edge copy', async () => {
  // No token at all: the edge would answer a public path before the router.
  const res = await call('/api/admin/overview', {}, null);
  assert.equal(res.status, 401);
  assert.equal(res.headers.get('x-edge'), null);
});

test('the offers running now are a public read', async () => {
  const res = await call('/api/promos', {}, null);
  assert.equal(res.status, 200);
  assert.match(dbCalls()[0]!.url, /\/rest\/v1\/rpc\/get_promos$/);
  assert.equal(dbCalls()[0]!.headers['authorization'], 'Bearer anon');
});

test('an offer with a price that is not whole pence is refused before the database', async () => {
  const res = await call('/api/admin/promo', {
    method: 'POST',
    body: JSON.stringify({ kind: 'deal', title: 'Derby', plan_id: 'monthly', price_minor: '4.99', ends_at: 2_000_000_000 }),
  });
  assert.equal(res.status, 400);
  assert.equal(dbCalls().length, 0);
});

test('an offer\'s numbers reach the database as numbers', async () => {
  const res = await call('/api/admin/promo', {
    method: 'POST',
    body: JSON.stringify({ kind: 'trial', title: 'Try it', plan_id: 'monthly', trial_days: '7', ends_at: 2_000_000_000, active: true }),
  });
  assert.equal(res.status, 200);
  const sent = JSON.parse(dbCalls()[0]!.body!);
  assert.deepEqual(sent.p, { kind: 'trial', title: 'Try it', plan_id: 'monthly', trial_days: 7, ends_at: 2_000_000_000, active: 1 });
});
