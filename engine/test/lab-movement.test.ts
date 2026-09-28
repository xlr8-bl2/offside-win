import { test } from 'node:test';
import assert from 'node:assert/strict';
import { optionsFor, ranked, type HistRow, type Policy } from '../src/lab/markets.ts';

/**
 * The lab's price-movement rule: a call the money has gone against since the
 * open is left out when the rule asks it to be; one with no opening price is
 * judged as before.
 */

const row = (open: Record<string, number> | null): HistRow => ({
  id: 1, league_id: 1, rank: 1, kickoff: 0, score: [2, 0], corners: null, reds: null, lambda: null, confidence: 0, provider: null,
  markets: [{
    market: '1x2', line: null, model: {},
    book: { HOME: 0.8, DRAW: 0.12, AWAY: 0.08 },
    best: { HOME: { odds: 1.27 }, DRAW: { odds: 8 }, AWAY: { odds: 12 } },
    overround: 1.04,
    sharp: { book: 'pinnacle', fair: { HOME: 0.8, DRAW: 0.12, AWAY: 0.08 } },
    open: open ? { book: 'pinnacle', fair: open } : null,
  }],
});

const P: Policy = { name: 't', source: 'sharp', modelWeight: 0, minProb: 0.75, maxProb: 0.97, minOdds: 1.1, maxOdds: 3, minEv: -0.05, maxGap: 1.2, rankBy: 'prob' };

test('a call the money has drifted from is left out; one it came for is kept', () => {
  const drifted = row({ HOME: 0.86, DRAW: 0.09, AWAY: 0.05 });
  const backed = row({ HOME: 0.74, DRAW: 0.15, AWAY: 0.11 });
  assert.equal(ranked(P, drifted, optionsFor(drifted, 0)).length, 1, 'no movement rule: taken');
  assert.equal(ranked({ ...P, maxDrift: 0.03 }, drifted, optionsFor(drifted, 0)).length, 0, 'drifted six points');
  assert.equal(ranked({ ...P, maxDrift: 0.03 }, backed, optionsFor(backed, 0)).length, 1);
  assert.equal(ranked({ ...P, minSteam: 0.01 }, backed, optionsFor(backed, 0)).length, 1);
  assert.equal(ranked({ ...P, minSteam: 0.01 }, drifted, optionsFor(drifted, 0)).length, 0);
});

test('no opening price recorded: the movement rule does not apply', () => {
  const r = row(null);
  assert.equal(ranked({ ...P, maxDrift: 0.01, minSteam: 0.01 }, r, optionsFor(r, 0)).length, 1);
});

test('a no-red-card call is left under a referee who sends players off a lot, and kept under one who does not', () => {
  const r = (ref: HistRow['ref']): HistRow => ({
    id: 2, league_id: 1, rank: 1, kickoff: 0, score: [1, 0], corners: null, reds: 0, lambda: null, confidence: 0, provider: null, ref,
    markets: [{
      market: 'red_card', line: null, model: {},
      book: { yes: 0.18, no: 0.82 }, best: { yes: { odds: 5 }, no: { odds: 1.2 } }, overround: 1.04,
      sharp: { book: 'pinnacle', fair: { yes: 0.18, no: 0.82 } },
    }],
  });
  const strict = { ...P, maxRefReds: 0.3 };
  assert.equal(ranked(strict, r({ n: 40, reds: 18, yellows: 160 }), optionsFor(r({ n: 40, reds: 18, yellows: 160 }), 0)).length, 0, 'nearly half a red a game');
  assert.equal(ranked(strict, r({ n: 40, reds: 6, yellows: 160 }), optionsFor(r({ n: 40, reds: 6, yellows: 160 }), 0)).length, 1);
  assert.equal(ranked(strict, r({ n: 8, reds: 6, yellows: 30 }), optionsFor(r({ n: 8, reds: 6, yellows: 30 }), 0)).length, 1, 'too few games to judge');
});
