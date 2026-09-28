import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { EDGE_PATHS, edgeCached } from '../src/edge.ts';

/**
 * The edge's copy of the public reads (edge.ts): fresh, then stale-and-
 * refreshing, then gone; and never anything but the public paths.
 */

let store: Map<string, Response>;
beforeEach(() => {
  store = new Map();
  (globalThis as any).caches = {
    default: {
      async match(req: Request) { const r = store.get(req.url); return r ? r.clone() : undefined; },
      async put(req: Request, res: Response) { store.set(req.url, new Response(await res.arrayBuffer(), { status: res.status, headers: res.headers })); },
    },
  };
});

const waits: Promise<unknown>[] = [];
const ctx = { waitUntil: (p: Promise<unknown>) => { waits.push(p); } };
const settle = async () => { await Promise.all(waits.splice(0)); };
const req = () => new Request('https://offside.win/api/board?hours=72');
const body = (n: number) => async () => new Response(JSON.stringify({ n }), { headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=60' } });

test('the first read goes to the database; the next within thirty seconds does not', async () => {
  let calls = 0;
  const build = async () => { calls++; return body(calls)(); };
  const t0 = 1_000_000;
  const a = await edgeCached(req(), ctx, build, t0);
  assert.equal(a.headers.get('x-edge'), 'miss');
  assert.deepEqual(await a.json(), { n: 1 });
  await settle();
  const b = await edgeCached(req(), ctx, build, t0 + 10_000);
  assert.equal(b.headers.get('x-edge'), 'hit');
  assert.deepEqual(await b.json(), { n: 1 });
  assert.equal(calls, 1);
  assert.equal(b.headers.get('cache-control'), 'public, max-age=60', 'the browser gets the site\'s own lifetime back');
});

test('an older copy is served at once and replaced behind it', async () => {
  let calls = 0;
  const build = async () => { calls++; return body(calls)(); };
  const t0 = 2_000_000;
  await edgeCached(req(), ctx, build, t0); await settle();
  const stale = await edgeCached(req(), ctx, build, t0 + 60_000);
  assert.equal(stale.headers.get('x-edge'), 'stale');
  assert.deepEqual(await stale.json(), { n: 1 }, 'no wait for the database');
  await settle();
  assert.equal(calls, 2, 'refreshed behind the reader');
  const next = await edgeCached(req(), ctx, build, Date.now());
  assert.deepEqual(await next.json(), { n: 2 });
});

test('past five minutes the reader waits for a fresh one, and an error is never stored', async () => {
  const t0 = 3_000_000;
  await edgeCached(req(), ctx, body(1), t0); await settle();
  const old = await edgeCached(req(), ctx, body(2), t0 + 400_000);
  assert.equal(old.headers.get('x-edge'), 'miss');
  assert.deepEqual(await old.json(), { n: 2 });
  await settle();
  store.clear();
  const bad = await edgeCached(req(), ctx, async () => new Response('{"error":"x"}', { status: 502 }), t0);
  assert.equal(bad.status, 502);
  await settle();
  assert.equal(store.size, 0);
});

test('only the public reads qualify', () => {
  for (const p of ['/api/board', '/api/hero', '/api/picks', '/api/slip', '/api/plans', '/api/fixture/212619', '/api/league/1', '/api/player/5', '/api/search']) {
    assert.ok(EDGE_PATHS.test(p), p);
  }
  for (const p of ['/api/account', '/api/pay/checkout', '/api/live', '/api/live/5', '/api/hit', '/api/config', '/api/fixture/abc', '/api/account/delete']) {
    assert.ok(!EDGE_PATHS.test(p), p);
  }
});
