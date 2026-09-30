import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sliceOf } from '../src/lab/slices.ts';

test('competitions sort into leagues, cups, continental club football, internationals and friendlies', () => {
  assert.equal(sliceOf('Premier League'), 'league');
  assert.equal(sliceOf('Brasileirão Serie B'), 'league');
  assert.equal(sliceOf('Taça de Portugal'), 'domestic cup');
  assert.equal(sliceOf('Carabao Cup'), 'domestic cup');
  assert.equal(sliceOf('DFB Pokal'), 'domestic cup');
  assert.equal(sliceOf('Europa League'), 'continental club');
  assert.equal(sliceOf('Copa Libertadores'), 'continental club');
  assert.equal(sliceOf('UEFA Nations League'), 'international');
  assert.equal(sliceOf('CONCACAF Nations League'), 'international');
  assert.equal(sliceOf('World Cup Qualification UEFA'), 'international');
  assert.equal(sliceOf('International Friendly Games'), 'friendly');
});

test('friendlies are judged at the international bar, not the default one', async () => {
  const { floorForRank } = await import('../src/select.ts');
  assert.equal(floorForRank(9), 0.85);
  assert.equal(floorForRank(3), 0.85);
  assert.equal(floorForRank(5), 0.78);
});
