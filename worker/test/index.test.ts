import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.ts';

/**
 * The routing and header wiring, driven end to end.
 *
 * http.test.ts proves the header functions in isolation; this proves they are
 * actually reached. The difference matters -- the cache bug these guard against
 * would be a correct function that nothing calls.
 *
 * PostgREST is stubbed by replacing global fetch, which is also how the
 * outgoing request gets inspected. That is the thing worth asserting: which key
 * ends up in the `authorization` header decides whether a reader is a member.
 */

const ANON = 'anon-key-public-by-design';
const ENV = {
  SUPABASE_URL: 'https://project.supabase.co',
  SUPABASE_ANON_KEY: ANON,
  ASSETS: { fetch: async () => new Response('the page', { status: 200 }) },
} as any;

let calls: { url: string; headers: Record<string, string> }[] = [];
let respond: (n: number) => Response;
const realFetch = globalThis.fetch;

beforeEach(() => {
  calls = [];
  respond = () => new Response('{"count":0,"fixtures":[]}', { status: 200 });
  globalThis.fetch = (async (input: any, init: any) => {
    const url = typeof input === 'string' ? input : input.url ?? String(input);
    calls.push({ url: String(url), headers: { ...(init?.headers ?? {}) } });
    return respond(calls.length);
  }) as any;
});

afterEach(() => { globalThis.fetch = realFetch; });

const get = (path: string, headers: Record<string, string> = {}) =>
  worker.fetch(new Request('https://offside.win' + path, { headers }), ENV);

/* ------------------------------------------------------- who is asking */

test('an anonymous board reads as the anon key and may be cached', async () => {
  const res = await get('/api/board');
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.headers['authorization'], `Bearer ${ANON}`);
  assert.equal(calls[0]!.headers['apikey'], ANON, 'apikey identifies the project and never changes');
  assert.match(res.headers.get('cache-control')!, /public/);
});

test("a reader's token is forwarded in place of the anon key", async () => {
  // This single swap is the whole membership mechanism: the serving functions
  // are SECURITY INVOKER, so auth.uid() resolves and the policies do the rest.
  const res = await get('/api/board', { authorization: 'Bearer reader.jwt.here' });
  assert.equal(calls[0]!.headers['authorization'], 'Bearer reader.jwt.here');
  assert.equal(calls[0]!.headers['apikey'], ANON, 'the project key must still be sent');
  assert.match(res.headers.get('cache-control')!, /no-store/);
  assert.equal(res.headers.get('vary'), 'Authorization');
});

test('every reader-facing route carries the token', async () => {
  for (const path of ['/api/board', '/api/fixture/1', '/api/picks']) {
    calls = [];
    respond = () => new Response('{"id":1}', { status: 200 });
    const res = await get(path, { authorization: 'Bearer reader.jwt.here' });
    assert.equal(calls[0]!.headers['authorization'], 'Bearer reader.jwt.here', `${path} dropped the token`);
    assert.match(res.headers.get('cache-control')!, /no-store/, `${path} let a member response be cached`);
  }
});

test('a fixture bundle is still returned whole to a member', async () => {
  respond = () => new Response('{"id":1,"verdicts":[]}', { status: 200 });
  const res = await get('/api/fixture/1', { authorization: 'Bearer reader.jwt.here' });
  assert.equal(res.status, 200);
  assert.equal(await res.text(), '{"id":1,"verdicts":[]}');
});

/* ------------------------------------------------ when a session goes stale */

test('an expired token degrades to anonymous rather than breaking the page', async () => {
  // A reader whose session lapsed should see a signed-out board, not an error.
  respond = (n) => n === 1
    ? new Response('{"message":"JWT expired"}', { status: 401 })
    : new Response('{"count":2,"fixtures":[]}', { status: 200 });

  const res = await get('/api/board', { authorization: 'Bearer stale.jwt' });
  assert.equal(res.status, 200);
  assert.equal(calls.length, 2, 'should have retried');
  assert.equal(calls[0]!.headers['authorization'], 'Bearer stale.jwt');
  assert.equal(calls[1]!.headers['authorization'], `Bearer ${ANON}`, 'the retry must drop the token');
  assert.match(
    res.headers.get('cache-control')!,
    /no-store/,
    'the retry produced an anonymous body but the request still carried a token, so it must not be cached',
  );
});

test('a retry that also fails surfaces as an error rather than looping', async () => {
  respond = () => new Response('nope', { status: 401 });
  const res = await get('/api/board', { authorization: 'Bearer stale.jwt' });
  assert.equal(calls.length, 2, 'exactly one retry');
  assert.equal(res.status, 502);
});

test('a genuine database error is not retried', async () => {
  respond = () => new Response('boom', { status: 500 });
  const res = await get('/api/board', { authorization: 'Bearer reader.jwt' });
  assert.equal(calls.length, 1);
  assert.equal(res.status, 502);
});

/* ----------------------------------------------------------------- config */

test('/api/config serves what the browser needs to reach Supabase Auth', async () => {
  const res = await get('/api/config');
  assert.equal(calls.length, 0, 'it answers from env and must not touch the database');
  assert.deepEqual(await res.json(), { supabaseUrl: ENV.SUPABASE_URL, anonKey: ANON });
  assert.match(res.headers.get('cache-control')!, /public/, 'it is the same for everyone');
});

/* --------------------------------------------------------------- unchanged */

test('the public endpoints are untouched by any of this', async () => {
  for (const path of ['/api/model', '/api/hero', '/api/health']) {
    calls = [];
    respond = () => new Response('{"ok":true}', { status: 200 });
    // Even handed a token: these carry nothing reader-specific, so they stay
    // cacheable and keep reading as anon.
    const res = await get(path, { authorization: 'Bearer reader.jwt' });
    assert.equal(calls[0]!.headers['authorization'], `Bearer ${ANON}`, `${path} should not personalise`);
    assert.match(res.headers.get('cache-control')!, /public/);
  }
});

test('a non-api path is served from assets and an unknown api path is a 404', async () => {
  assert.equal(await (await get('/board')).text(), 'the page');
  assert.equal((await get('/api/nope')).status, 404);
});

test('a missing database configuration says so rather than throwing', async () => {
  const res = await worker.fetch(
    new Request('https://offside.win/api/board'),
    { ...ENV, SUPABASE_URL: '' } as any,
  );
  assert.equal(res.status, 503);
});
