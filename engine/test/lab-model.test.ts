import { test } from 'node:test';
import assert from 'node:assert/strict';
import { learnedProb, optionsFor, probOf, ranked, type HistRow, type Option, type Policy } from '../src/lab/markets.ts';
import { bootstrap } from '../src/lab/learned.ts';

/** lab:model (lab/learned.ts, lab/own.ts): the learned price, our own read, and the day bootstrap. */

const opt = (o: Partial<Option>): Option => ({
  market: '1x2', family: 'result', line: null, outcome: 'HOME', odds: 1.3, book: 0.75, model: null, provider: null,
  blend: null, push: 0, sharp: null, books: null, open: null, own: null, ...o,
});

test('slope-only weights give back the reference price: the sharp book, else the consensus', () => {
  const w = [0, 1, 0, 0, 0, 0, 0, 0];
  assert.ok(Math.abs(learnedProb(w, opt({ book: 0.75 })) - 0.75) < 1e-9);
  assert.ok(Math.abs(learnedProb(w, opt({ book: 0.75, sharp: 0.8 })) - 0.8) < 1e-9);
  assert.equal(learnedProb(undefined, opt({ book: 0.75, sharp: 0.8 })), 0.8);
});

test('the money since the open moves the learned price the way its weight says', () => {
  const w = [0, 1, 1, 0, 0, 0, 0, 0];
  assert.ok(learnedProb(w, opt({ book: 0.75, open: 0.7 })) > 0.75);
  assert.ok(learnedProb(w, opt({ book: 0.75, open: 0.8 })) < 0.75);
});

test('our own read prices the goals markets from its scoring rates, and the own source uses it alone', () => {
  const row: HistRow = {
    id: 1, league_id: 1, rank: 4, kickoff: 1.7e9, score: [2, 0], corners: null, reds: null, lambda: null, confidence: 1, provider: null,
    own: { home: 2.2, away: 0.6, rho: -0.05 },
    markets: [{ market: '1x2', line: null, model: {}, book: { HOME: 0.6, DRAW: 0.25, AWAY: 0.15 }, best: { HOME: { odds: 1.7 }, DRAW: { odds: 4 }, AWAY: { odds: 6.5 } }, overround: 1.04 }],
  };
  const home = optionsFor(row, 0).find((o) => o.outcome === 'HOME')!;
  assert.ok(home.own !== null && home.own > 0.7, 'a 2.2 to 0.6 read makes the home side a strong favourite');
  const own: Policy = { name: 'own', source: 'own', modelWeight: 0, minProb: 0.7, maxProb: 0.97, minOdds: 1.1, maxOdds: 5, minEv: 0, maxGap: 9, rankBy: 'prob' };
  assert.equal(probOf(own, home), home.own);
  assert.equal(ranked(own, row)[0]?.option.outcome, 'HOME');
  // Without our read the option has no probability under that source.
  assert.equal(probOf(own, { ...home, own: null }), null);
});

test('the agreement filter leaves out a call our own read rates well below the price', () => {
  const row: HistRow = {
    id: 2, league_id: 1, rank: 4, kickoff: 1.7e9, score: [0, 0], corners: null, reds: null, lambda: null, confidence: 1, provider: null,
    own: { home: 0.9, away: 1.4, rho: -0.05 },
    markets: [{ market: '1x2', line: null, model: {}, book: { HOME: 0.8, DRAW: 0.12, AWAY: 0.08 }, best: { HOME: { odds: 1.3 }, DRAW: { odds: 8 }, AWAY: { odds: 12 } }, overround: 1.04 }],
  };
  const p: Policy = { name: 'p', source: 'book', modelWeight: 0, minProb: 0.75, maxProb: 0.97, minOdds: 1.1, maxOdds: 5, minEv: -1, maxGap: 9, rankBy: 'prob' };
  assert.equal(ranked(p, row).length, 1);
  assert.equal(ranked({ ...p, minOwnGap: -0.05 }, row).length, 0);
});

test('a rule against itself is never ahead in the bootstrap', () => {
  const days = new Map([[1, { n: 3, won: 2, pnl: 0.2 }], [2, { n: 2, won: 2, pnl: 0.5 }], [3, { n: 4, won: 3, pnl: -0.4 }]]);
  const r = bootstrap(days, days, 500);
  assert.equal(r.roiAhead, 0);
  assert.equal(r.hitAhead, 0);
  assert.equal(r.lo, 0);
  assert.equal(r.hi, 0);
});
