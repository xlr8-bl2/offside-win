import { test } from 'node:test';
import assert from 'node:assert/strict';
import { asResults, bsdOrNull, clearCache, quota } from '../src/bsd.ts';

/**
 * Results come first (worker/src/allowance.ts): below a job's floor nothing
 * is asked, except a final score inside asResults.
 */
test('below the floor nothing is asked, but a final score still is', async () => {
  const asked: string[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (u: string | URL) => {
    asked.push(String(u));
    return new Response(JSON.stringify({ id: 1, status: 'finished', home_score: 2, away_score: 0 }), {
      headers: { 'content-type': 'application/json', ratelimit: '"football";r=90;t=100' },
    });
  }) as typeof fetch;
  clearCache();
  quota.remaining = 100;
  quota.exhausted = false;
  try {
    assert.equal(await bsdOrNull('/api/v2/events/1/'), null, 'below the default floor: no request');
    assert.equal(asked.length, 0);
    const ev = await asResults(() => bsdOrNull<{ home_score: number }>('/api/v2/events/1/'));
    assert.equal(ev?.home_score, 2);
    assert.equal(asked.length, 1);
    assert.equal(quota.remaining, 90);
    assert.equal(await bsdOrNull('/api/v2/events/2/'), null, 'and the floor is back afterwards');
    assert.equal(asked.length, 1);
  } finally {
    globalThis.fetch = real;
    quota.remaining = null;
    quota.exhausted = false;
    clearCache();
  }
});
