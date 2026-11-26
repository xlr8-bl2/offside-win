import { test } from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../src/config.ts';
import { confidentGate } from '../src/select.ts';
import { PROD } from '../src/lab/tune.ts';
import { ranked, type HistRow, type Option } from '../src/lab/markets.ts';
import type { Candidate } from '../src/types.ts';

/*
 * The owner's rule (21 November 2026): handicap calls cut to the least. No
 * goal-margin handicap is ever called: an Asian handicap only at -0.5, 0 or
 * +0.5 for the backed side (which read as "to win" and "to win or draw"),
 * and no three-way handicap. These tests are here so the rule is not loosened
 * by accident, live or in the lab's copy of it. Changing it is a decision for
 * the owner, not a tidy-up.
 */

const cand = (market: string, outcome: string, line: number | null): Candidate => ({
  market, outcome, line, push: null, model_prob: 0.86, book_prob: 0.86, sharp_prob: 0.86, edge: 0, shrunk_edge: 0,
  odds: 1.2, bookmaker: 'x', prices: [], kelly: 0, confidence: 1, family: 'handicap',
} as unknown as Candidate);

test('the live rule allows half a goal at most, either way', () => {
  assert.equal(config.confident.maxHandicapMargin, 0.5);
  for (const line of [1, 1.5, 2, 2.5, 3, -1, -1.5, -2, -2.5]) {
    assert.equal(confidentGate(cand('asian_handicap', 'HOME', line), 0.78), 'excluded', `HOME ${line}`);
    assert.equal(confidentGate(cand('asian_handicap', 'AWAY', line), 0.78), 'excluded', `AWAY ${line}`);
  }
  for (const line of [0.5, 0, -0.5]) assert.equal(confidentGate(cand('asian_handicap', 'HOME', line), 0.78), null, `HOME ${line}`);
  for (const outcome of ['HOME', 'DRAW', 'AWAY']) assert.equal(confidentGate(cand('european_handicap', outcome, -1), 0.78), 'excluded');
});

test("the lab's production rule is the same rule", () => {
  assert.equal(PROD.maxHandicap, 0.5);
  for (const b of ['european_handicap home', 'european_handicap away', 'european_handicap DRAW']) assert.ok(PROD.excludeBuckets?.includes(b), b);
  // A fixture whose likeliest options are all goal-margin handicaps gets none of them.
  const opt = (market: string, outcome: string, line: number | null, p: number): Option => ({
    market, family: market.includes('handicap') ? 'handicap' : 'goals', line, outcome, odds: 1.2, book: p, model: null, provider: null,
    blend: null, push: 0, sharp: p, books: 10, open: null, own: null,
  } as unknown as Option);
  const row = { id: 1, league_id: 1, rank: 5, kickoff: 0, score: [0, 0], corners: null, reds: null, lambda: null, confidence: 1, markets: [], provider: null } as unknown as HistRow;
  const picks = ranked(PROD, row, [
    opt('asian_handicap', 'HOME', 2, 0.9), opt('asian_handicap', 'AWAY', -1.5, 0.89), opt('european_handicap', 'HOME', 1, 0.88),
    opt('over_under_15', 'over', 1.5, 0.84),
  ]);
  assert.ok(picks.length > 0);
  assert.ok(picks.every((p) => !(p.option.family === 'handicap' && Math.abs(p.option.line ?? 0) > 0.5)), 'no goal-margin handicap');
  assert.equal(picks[0]!.option.market, 'over_under_15');
});
