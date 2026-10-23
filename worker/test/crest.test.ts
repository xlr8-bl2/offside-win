import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.ts';

/** /media/<kind>/<id>: the provider's badge from our own address; its blank 1x1 is a 404. */
const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });
const ENV: any = { ASSETS: { fetch: async () => new Response('page') } };

test('a crest is passed through with a long cache, a blank one is a 404, and nothing else is fetched', async () => {
  const asked: string[] = [];
  globalThis.fetch = (async (url: string | URL | Request) => {
    asked.push(String(url));
    const big = String(url).includes('/team/71/');
    return new Response(new Uint8Array(big ? 5000 : 68), { headers: { 'content-type': 'image/png' } });
  }) as typeof fetch;
  const ok = await worker.fetch(new Request('https://offside.win/media/team/71'), ENV);
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('content-type'), 'image/png');
  assert.match(ok.headers.get('cache-control') ?? '', /max-age=604800/);
  assert.equal((await ok.arrayBuffer()).byteLength, 5000);
  assert.equal((await worker.fetch(new Request('https://offside.win/media/team/9'), ENV)).status, 404);
  assert.deepEqual(asked, ['https://sports.bzzoiro.com/img/team/71/', 'https://sports.bzzoiro.com/img/team/9/']);
  // Only numeric team or league ids reach the provider.
  await worker.fetch(new Request('https://offside.win/media/player/1'), ENV);
  await worker.fetch(new Request('https://offside.win/media/team/..%2F1'), ENV);
  assert.equal(asked.length, 2);
});

test('a freely licensed photo passes through from Flickr or Wikimedia only', async () => {
  const asked: string[] = [];
  globalThis.fetch = (async (url: string | URL | Request) => {
    asked.push(String(url));
    return new Response(new Uint8Array(900), { headers: { 'content-type': 'image/jpeg' } });
  }) as typeof fetch;
  const ok = await worker.fetch(new Request('https://offside.win/media/cc?u=' + encodeURIComponent('https://live.staticflickr.com/1/2_b.jpg')), ENV);
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('content-type'), 'image/jpeg');
  for (const bad of ['https://example.com/x.jpg', 'http://live.staticflickr.com/1.jpg', 'https://live.staticflickr.com.evil.com/1.jpg', 'nonsense']) {
    assert.equal((await worker.fetch(new Request('https://offside.win/media/cc?u=' + encodeURIComponent(bad)), ENV)).status, 404);
  }
  assert.equal(asked.length, 1);
});
