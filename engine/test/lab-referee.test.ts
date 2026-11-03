import { test } from 'node:test';
import assert from 'node:assert/strict';
import { refereeLookup } from '../src/lab/run.ts';

// The referee's record before a kick-off: what the LATERAL join used to give,
// now counted in the lab so it runs on D1.
test('a referee record counts only the games before the kick-off', () => {
  const at = refereeLookup(new Map([
    [7, [{ k: 300, reds: 1, yel: 4 }, { k: 100, reds: 0, yel: 3 }, { k: 200, reds: 2, yel: 5 }]],
  ]));
  assert.equal(at(7, 100), null);
  assert.deepEqual(at(7, 101), { n: 1, reds: 0, yellows: 3 });
  assert.deepEqual(at(7, 300), { n: 2, reds: 2, yellows: 8 });
  assert.deepEqual(at(7, 999), { n: 3, reds: 3, yellows: 12 });
  assert.equal(at(8, 999), null);
});
