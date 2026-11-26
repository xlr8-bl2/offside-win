import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.ts';

test('the Apple Pay domain-association file is served exactly, as text', async () => {
  const res = await worker.fetch(new Request('https://offside.win/.well-known/apple-developer-merchantid-domain-association'),
    { ASSETS: { fetch: async () => new Response('nope', { status: 404 }) } } as any);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /^text\/plain/);
  const body = await res.text();
  assert.equal(body.length, 228);
  assert.match(body, /^[0-9a-f]+$/, 'no newline, nothing but the token');
});
