import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.ts';
import { localD1 } from './d1.ts';
import { FREE, serve } from '../src/d1read.ts';

/**
 * The site as it runs now: free (owner, 17 November 2026). Every read is the
 * open one whoever asks, and nothing can be bought. The wall itself is still
 * tested, with FREE off, in index, auth and stage2.
 */

test('the site is free', () => {
  assert.equal(FREE, true);
});

test('a signed-out reader gets the open board', async () => {
  const { db, sqlite } = localD1();
  const board = await serve(db, 'get_board', { p_from: 0, p_to: 2_000_000_000 }, null) as { member: boolean };
  assert.equal(board.member, true);
  const slip = await serve(db, 'get_slip', {}, null) as { member?: boolean };
  assert.notEqual(slip.member, false);
  sqlite.close();
});

test('nothing can be bought, and the old plans page goes home', async () => {
  const { db, sqlite } = localD1();
  const env = { DB: db, SITE_URL: 'https://offside.win', PAY_PROVIDER: 'whop', ASSETS: { fetch: async () => new Response('page') } } as any;
  for (const path of ['/api/pay/checkout', '/api/pay/charge']) {
    const res = await worker.fetch(new Request(`https://offside.win${path}`, { method: 'POST', body: '{}' }), env, { waitUntil() {} } as any);
    assert.equal(res.status, 410, path);
    assert.match((await res.json() as { error: string }).error, /free/);
  }
  const res = await worker.fetch(new Request('https://offside.win/pricing'), env, { waitUntil() {} } as any);
  assert.equal(res.status, 301);
  assert.equal(res.headers.get('location'), 'https://offside.win/');
  sqlite.close();
});
