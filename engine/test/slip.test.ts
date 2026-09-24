import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSlip, chanceInWords, type Leg } from '../src/slip.ts';

const leg = (id: number, odds: number, p: number, extra: Partial<Leg> = {}): Leg => ({
  fixture_id: id, kickoff: 1000 + id, home: `H${id}`, away: `A${id}`, league: null,
  market: 'double_chance', outcome: '1X', line: null, odds, bookmaker: 'Bet365', model_prob: p, ...extra,
});

test('the slip lands inside the odds band', () => {
  const s = buildSlip([leg(1, 1.2, 0.86), leg(2, 1.25, 0.84), leg(3, 1.3, 0.82), leg(4, 1.18, 0.85), leg(5, 1.4, 0.8)]);
  assert.ok(s);
  assert.ok(s.odds >= 2 && s.odds <= 3, `odds ${s.odds} outside 2-3`);
});

test('it maximises the chance of all landing, not the number of legs', () => {
  // Two legs at 1.5 each (2.25) with 0.7 each = 0.49, against four short legs
  // (1.2^4 = 2.07) at 0.85 each = 0.52. The four-leg slip is likelier.
  const s = buildSlip([leg(1, 1.5, 0.7), leg(2, 1.5, 0.7), leg(3, 1.2, 0.85), leg(4, 1.2, 0.85), leg(5, 1.2, 0.85), leg(6, 1.2, 0.85)]);
  assert.ok(s);
  assert.ok(Math.abs(s.chance - 0.85 ** 4) < 1e-3, `chance ${s.chance}`);
  assert.equal(s.legs.length, 4);
});

test('one leg per match', () => {
  const s = buildSlip([leg(1, 1.5, 0.8), leg(1, 1.6, 0.79, { outcome: 'X2' }), leg(2, 1.5, 0.8)]);
  assert.ok(s);
  assert.equal(new Set(s.legs.map((l) => l.fixture_id)).size, s.legs.length);
});

test('no slip rather than a padded one', () => {
  // Three calls at 1.15 make 1.52: nothing reaches 2.00.
  assert.equal(buildSlip([leg(1, 1.15, 0.9), leg(2, 1.15, 0.9), leg(3, 1.15, 0.9)]), null);
});

test('legs are listed in kick-off order', () => {
  const s = buildSlip([leg(3, 1.3, 0.85), leg(1, 1.3, 0.85), leg(2, 1.3, 0.85)]);
  assert.ok(s);
  assert.deepEqual(s.legs.map((l) => l.fixture_id), [...s.legs.map((l) => l.fixture_id)].sort((a, b) => a - b));
});

test('the chance is said in words, not as a percentage', () => {
  assert.equal(chanceInWords(0.41), 'about four times in ten');
  assert.equal(chanceInWords(0.52), 'about five times in ten');
  assert.equal(chanceInWords(0.03), 'less than once in ten');
});
