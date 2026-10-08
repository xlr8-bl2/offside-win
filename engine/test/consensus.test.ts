import { test } from 'node:test';
import assert from 'node:assert/strict';
import { consensusMarkets, targetsFromBook } from '../src/consensus.ts';
import { buildBookMarkets } from '../src/odds.ts';
import { bucketOf, confidentGate, confidentHolds, standingGate, confidentScore, DayMix, rankConfident, whyNoCall } from '../src/select.ts';
import type { Candidate, Quote } from '../src/types.ts';

/**
 * The probability published calls are chosen on, and how one is chosen.
 * The lab (lab/markets.ts) is the evidence; these pin the behaviour.
 */

const q = (market: string, outcome: string, odds: number, line: number | null = null, book = 'pinnacle'): Quote => ({
  market, outcome, line, push: null, bookmaker_slug: book, bookmaker_name: book,
  decimal_odds: odds, opening_decimal_odds: null, movement: null, is_max_quote: false, updated_at: 1,
} as unknown as Quote);

const card = () => buildBookMarkets([
  q('1x2', 'HOME', 1.6), q('1x2', 'DRAW', 4.2), q('1x2', 'AWAY', 5.6),
  q('over_under_25', 'over', 1.8, 2.5), q('over_under_25', 'under', 2.05, 2.5),
  q('over_under_15', 'over', 1.25, 1.5), q('over_under_15', 'under', 3.9, 1.5),
  q('btts', 'yes', 1.9), q('btts', 'no', 1.9),
  q('double_chance', '1X', 1.15), q('double_chance', '12', 1.25), q('double_chance', 'X2', 2.4),
]);

test('the card\'s prices become scoring-rate targets', () => {
  const t = targetsFromBook(card());
  assert.ok(t.result && Math.abs(t.result.HOME + t.result.DRAW + t.result.AWAY - 1) < 1e-9);
  assert.ok(t.over!['2.5'] && t.over!['1.5']);
  assert.ok(typeof t.btts === 'number');
});

test('goals markets come off the fitted matrix; the rest is the consensus', () => {
  const book = card();
  const c = consensusMarkets(book, null, 0);
  assert.ok(c.rates);
  const ou = c.markets.find((m) => m.market === 'over_under_25')!;
  const bookOu = book.find((m) => m.market === 'over_under_25')!;
  // Close to the consensus (it was fitted to it) but from the matrix, not copied.
  assert.ok(Math.abs(ou.probs.get('over')! - bookOu.fair.get('over')!) < 0.05);
  assert.ok(Math.abs(ou.probs.get('over')! + ou.probs.get('under')! - 1) < 1e-9);
  const r = c.markets.find((m) => m.market === '1x2')!;
  assert.deepEqual([...r.probs], [...book.find((m) => m.market === '1x2')!.fair]);
});

test('our model moves the goals markets, and only by its weight', () => {
  const book = card();
  const base = consensusMarkets(book, null, 0).markets.find((m) => m.market === 'over_under_25')!.probs.get('over')!;
  const high = { home: 2.6, away: 1.6 };
  const half = consensusMarkets(book, high, 0.5).markets.find((m) => m.market === 'over_under_25')!.probs.get('over')!;
  const zero = consensusMarkets(book, high, 0).markets.find((m) => m.market === 'over_under_25')!.probs.get('over')!;
  assert.ok(half > base + 0.02, `${half} vs ${base}`);
  assert.ok(Math.abs(zero - base) < 1e-12);
});

const cand = (market: string, outcome: string, p: number, odds: number): Candidate => ({
  market, outcome, line: null, push: null, model_prob: p, book_prob: p, edge: 0, shrunk_edge: 0,
  odds, bookmaker: 'x', prices: [], kelly: 0, confidence: 1, family: 'goals',
} as unknown as Candidate);

test('calls are ranked likeliest first (lab:tune); growth is kept as an option', () => {
  const short = cand('over_under_15', 'over', 0.88, 1.14);
  const pays = cand('btts', 'no', 0.8, 1.3);
  assert.ok(confidentScore(pays, 'growth') > confidentScore(short, 'growth'));
  assert.ok(confidentScore(short, 'prob') > confidentScore(pays, 'prob'));
  assert.equal(rankConfident([pays, short], 0.75)[0], short);
});

test('a price more than 1% below fair is not a call, however likely', () => {
  const near = cand('over_under_15', 'over', 0.88, 1.13); // 0.88 × 1.13 = 0.994: within 1% of fair
  const bad = cand('btts', 'no', 0.8, 1.2); // 0.96: 4% under fair
  const out = rankConfident([near, bad], 0.72);
  assert.ok(out.includes(near));
  assert.ok(!out.includes(bad));
});

test('a call the money has drifted from since the open is left; one it came for is kept (lab:tune)', () => {
  const drifted = { ...cand('over_under_15', 'over', 0.86, 1.18), sharp_prob: 0.86, open_prob: 0.9 };
  const backed = { ...cand('over_under_15', 'over', 0.86, 1.18), sharp_prob: 0.86, open_prob: 0.82 };
  const barely = { ...cand('over_under_15', 'over', 0.86, 1.18), sharp_prob: 0.86, open_prob: 0.865 };
  const unknown = { ...cand('over_under_15', 'over', 0.86, 1.18), sharp_prob: 0.86, open_prob: null };
  assert.deepEqual(rankConfident([drifted], 0.78), [], 'four points against it');
  assert.equal(rankConfident([backed], 0.78).length, 1);
  assert.equal(rankConfident([barely], 0.78).length, 1, 'half a point is within the limit');
  assert.equal(rankConfident([unknown], 0.78).length, 1, 'no opening price: judged without it');
});

test('the day mix caps one market and keeps a standing call', () => {
  const kick = Date.UTC(2026, 8, 27, 15) / 1000;
  const day = DayMix.dayOf(kick);
  const mix = new DayMix(new Map([[day, 10]]), 0.3); // cap: three of ten
  const ou = cand('over_under_15', 'over', 0.85, 1.2);
  const dc = cand('double_chance', '1X', 0.83, 1.2);
  const picks = Array.from({ length: 5 }, () => mix.choose([ou, dc], kick, null));
  assert.equal(picks.filter((p) => p === ou).length, 3);
  assert.equal(picks.filter((p) => p === dc).length, 2);
  // A call already standing stays, full bucket or not.
  const standing = { market: 'over_under_15', outcome: 'over', line: null };
  assert.equal(mix.choose([ou, dc], kick, standing), ou);
  assert.equal(bucketOf({ market: 'double_chance', outcome: '1X' }), 'double_chance home');
});

test('a match with no call is given the call rule\'s own reason', () => {
  // Albania v San Marino: the win is certain and far too short, the next
  // likeliest is nowhere near the bar. Not "too close to call".
  const mismatch = [cand('1x2', 'HOME', 0.93, 1.04), cand('over_under_25', 'over', 0.7, 1.4)];
  assert.equal(confidentGate(mismatch[0]!, 0.78), 'short');
  assert.equal(whyNoCall(mismatch, 0.78), 'short');
  // Likely enough at a usable price, but shorter than it deserves.
  const mean = { ...cand('over_under_15', 'over', 0.82, 1.18), sharp_prob: 0.82 } as Candidate;
  assert.equal(confidentGate(mean, 0.78), 'value');
  assert.equal(whyNoCall([mean], 0.78), 'value');
  // Nothing likely enough: close when the best is a real lean, open when not.
  assert.equal(whyNoCall([cand('1x2', 'HOME', 0.72, 1.35)], 0.78), 'close');
  assert.equal(whyNoCall([cand('1x2', 'HOME', 0.45, 2.1)], 0.78), 'open');
  assert.equal(whyNoCall([], 0.78), 'no-prices');
  // And a call that clears every test has no gate.
  assert.equal(confidentGate({ ...cand('btts', 'no', 0.8, 1.3), sharp_prob: 0.8 } as Candidate, 0.78), null);
});

test('a call already up holds through a twitch, and comes down on a real fall', () => {
  const at = (p: number, odds: number, sharp: number | null = p, open: number | null = null) =>
    ({ ...cand('1x2', 'HOME', p, odds), sharp_prob: sharp, open_prob: open } as Candidate);
  // Half a point under the floor: not a new call, still a standing one.
  assert.equal(confidentGate(at(0.775, 1.3), 0.78), 'floor');
  assert.ok(confidentHolds(at(0.775, 1.3), 0.78));
  // The best price a point under the sharp book's fair price.
  assert.equal(confidentGate(at(0.8, 1.237), 0.78), 'value');
  assert.ok(confidentHolds(at(0.8, 1.237), 0.78));
  // Two points of money against it since the open.
  assert.equal(confidentGate(at(0.8, 1.3, 0.8, 0.82), 0.78), 'drift');
  assert.ok(confidentHolds(at(0.8, 1.3, 0.8, 0.82), 0.78));
  // A real fall is not held.
  assert.ok(!confidentHolds(at(0.75, 1.36), 0.78), 'three points under');
  assert.ok(!confidentHolds(at(0.8, 1.3, 0.8, 0.85), 0.78), 'five points against it');
  // The price coming in after we publish is the market agreeing, not news:
  // too short or under fair for a new call, and still a standing one.
  assert.equal(confidentGate(at(0.8, 1.1), 0.78), 'short');
  assert.ok(confidentHolds(at(0.8, 1.1), 0.78), 'shortened below the minimum');
  assert.ok(confidentHolds(at(0.8, 1.2), 0.78), 'four per cent under fair');
  assert.equal(standingGate(at(0.75, 1.1), 0.78), 'floor', 'a real fall still counts when the price is short too');
});
