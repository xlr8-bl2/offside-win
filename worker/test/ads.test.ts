import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker, { adsConfig, adsTxt } from '../src/index.ts';

/** Adverts (public/js/lib/ads.js): off until a real AdSense publisher and unit are set. */

test('adverts are off until both ids are set, and only real-looking ids count', () => {
  assert.equal(adsConfig({}), null);
  assert.equal(adsConfig({ ADSENSE_CLIENT: 'ca-pub-1234567890123456' }), null);
  assert.equal(adsConfig({ ADSENSE_CLIENT: 'ca-pub-12"><script>', ADSENSE_SLOT: '1234567890' }), null);
  assert.deepEqual(adsConfig({ ADSENSE_CLIENT: ' ca-pub-1234567890123456 ', ADSENSE_SLOT: '1234567890' }),
    { client: 'ca-pub-1234567890123456', slot: '1234567890' });
});

test('ads.txt names Google as a direct seller once a publisher is set, and is absent before', async () => {
  assert.equal(adsTxt('ca-pub-1234567890123456'), 'google.com, pub-1234567890123456, DIRECT, f08c47fec0942fa0\n');
  const ctx = { waitUntil() {} } as any;
  const off = await worker.fetch(new Request('https://offside.win/ads.txt'), { ASSETS: { fetch: async () => new Response('page') } } as any, ctx);
  assert.equal(off.status, 404);
  const on = await worker.fetch(new Request('https://offside.win/ads.txt'),
    { ADSENSE_CLIENT: 'ca-pub-1234567890123456', ADSENSE_SLOT: '1234567890', ASSETS: { fetch: async () => new Response('page') } } as any, ctx);
  assert.equal(on.status, 200);
  assert.match(await on.text(), /^google\.com, pub-1234567890123456, DIRECT, f08c47fec0942fa0/);
});
