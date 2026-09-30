import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readOf } from '../src/read.ts';
import { freeBoard } from '../src/membership/redact.ts';

/** Our read on a match with no call (read.ts): words from the bookmakers' view, never a number. */

const base = { home: 'Finland', away: 'Belarus' };

test('a clear favourite, a narrow one, and a match too close to call', () => {
  assert.equal(readOf({ ...base, result: { HOME: 0.62, DRAW: 0.24, AWAY: 0.14 } })?.text, 'Finland to win');
  assert.equal(readOf({ ...base, result: { HOME: 0.5, DRAW: 0.28, AWAY: 0.22 } })?.text, 'Finland to edge it');
  assert.equal(readOf({ ...base, result: { HOME: 0.33, DRAW: 0.32, AWAY: 0.35 } })?.text, 'Too close to call. A draw is live');
  assert.equal(readOf({ ...base, result: { HOME: 0.14, DRAW: 0.2, AWAY: 0.66 }, over25: 0.64 })?.text, 'Belarus to win, with goals');
  assert.equal(readOf({ ...base, result: { HOME: 0.7, DRAW: 0.2, AWAY: 0.1 }, over25: 0.35 })?.text, 'Finland to win a tight one');
});

test('no market, no read: our own rates are not trusted on their own', () => {
  assert.equal(readOf({ ...base, result: null }), null);
  assert.equal(readOf({ ...base, result: {} }), null);
});

test('no digit ever reaches the words', () => {
  for (const h of [0.1, 0.3, 0.45, 0.55, 0.7, 0.85]) {
    for (const over of [null, 0.3, 0.5, 0.7]) {
      const r = readOf({ ...base, result: { HOME: h, DRAW: 0.25, AWAY: Math.max(0.05, 1 - h - 0.25) }, over25: over });
      assert.ok(r && !/\d/.test(r.text), JSON.stringify(r));
    }
  }
});

test('the read is free on a match with no call, and gone beside a lock', () => {
  const open = freeBoard({ id: 1, home: 'A', away: 'B', read: { text: 'A to win', side: 'home' }, top_pick: null });
  assert.deepEqual(open['read'], { text: 'A to win', side: 'home' });
  const locked = freeBoard({ id: 2, home: 'A', away: 'B', read: { text: 'A to win', side: 'home' }, top_pick: { market: '1x2' } });
  assert.equal(locked['read'], undefined);
});
