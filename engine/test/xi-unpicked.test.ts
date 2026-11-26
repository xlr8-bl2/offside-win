import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withoutUnpicked } from '../src/context/xi.ts';

const side = (names: Array<[number, string, boolean]>) => ({
  formation: '4-3-3', confidence: 0.7,
  players: names.map(([id, name, starting]) => ({ id, name, position: 'F', starting, ai_score: null })),
});

test('a projected starter on none of the recent team sheets is left out (a retired player)', () => {
  const s = side([[10, 'Lionel Messi', true], [9, 'Julián Álvarez', true], [23, 'Emiliano Martínez', true], [7, 'Bench man', false]]);
  const r = withoutUnpicked(s, { sheets: 4, ids: new Set([9, 23, 7]) });
  assert.deepEqual(r.dropped, ['Lionel Messi']);
  assert.deepEqual(r.side.players.map((p) => p.name), ['Julián Álvarez', 'Emiliano Martínez', 'Bench man']);
});

test('with fewer than two recent sheets there is no evidence, so nothing is changed', () => {
  const s = side([[10, 'Lionel Messi', true]]);
  assert.deepEqual(withoutUnpicked(s, { sheets: 1, ids: new Set() }).dropped, []);
  assert.equal(withoutUnpicked(s, { sheets: 1, ids: new Set() }).side, s);
});
