import { test } from 'node:test';
import assert from 'node:assert/strict';
import { narrativeKey } from '../src/slate.ts';

/**
 * The caching rule, on its own.
 *
 * The slate runs every fifteen minutes. Writing a fresh paragraph on each pass
 * would be thousands of requests a day to reproduce prose that has not changed
 * -- which is what the free allowance was actually being spent on, and why the
 * plan's "roughly 120 a day" was wrong by two orders of magnitude.
 *
 * The key is therefore the call rather than the fixture, and these are the
 * cases that decide whether a request is made.
 */

const c = (over: Record<string, unknown> = {}) =>
  ({ market: 'double_chance', outcome: '1X', line: null, odds: 1.18, ...over }) as any;

test('the same call on the same fixture reuses its paragraph', () => {
  // The common case, ninety-five times out of ninety-six.
  assert.equal(narrativeKey(7, c()), narrativeKey(7, c({ odds: 1.24 })),
    'a price move must not be worth a rewrite — the writing never mentions the price');
});

test('a different call is a different paragraph', () => {
  const base = narrativeKey(7, c());
  assert.notEqual(base, narrativeKey(7, c({ market: 'over_under_15' })), 'market');
  assert.notEqual(base, narrativeKey(7, c({ outcome: 'X2' })), 'side');
  assert.notEqual(base, narrativeKey(7, c({ line: 1.5 })), 'line');
  assert.notEqual(base, narrativeKey(8, c()), 'fixture');
});

test('a null line and a zero line are not confused', () => {
  // A handicap of zero is a real line; no line at all is a different market
  // shape. Collapsing them would serve one fixture another's paragraph.
  assert.notEqual(narrativeKey(7, c({ line: null })), narrativeKey(7, c({ line: 0 })));
});
