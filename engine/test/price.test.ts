import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildScoreMatrix, priceResult, priceBtts, priceOverUnder, priceDoubleChance,
  priceDrawNoBet, priceEuropeanHandicap, priceAsianHandicap, priceTotalCorners,
  priceCornersResult, priceTotalReds, priceRedCard, negBinomPmf, sumWhere,
  isQuarterLine, pushRuleFor,
} from '../src/price.ts';
import { shin, multiplicative, kelly, expectedValue, fairOdds } from '../src/devig.ts';

const close = (a: number, b: number, tol = 1e-9) =>
  assert.ok(Math.abs(a - b) < tol, `${a} should equal ${b} within ${tol}`);

test('score matrix is a proper distribution', () => {
  for (const [lh, la, rho] of [[1.6, 1.1, -0.12], [0.7, 2.4, -0.05], [2.8, 2.6, 0], [0.3, 0.4, -0.2]]) {
    const m = buildScoreMatrix(lh!, la!, rho!);
    const total = sumWhere(m, () => true);
    close(total, 1, 1e-9);
    for (let h = 0; h <= m.max; h++) {
      for (let a = 0; a <= m.max; a++) {
        assert.ok(m.p[h]![a]! >= 0, `p(${h}-${a}) must not be negative`);
      }
    }
  }
});

test('every goals market is internally consistent with the same matrix', () => {
  const m = buildScoreMatrix(1.55, 1.15, -0.11);
  const r = priceResult(m);
  close(r.get('HOME')! + r.get('DRAW')! + r.get('AWAY')!, 1, 1e-9);

  const dc = priceDoubleChance(m);
  // Double chance must agree with 1X2 exactly, not approximately: they are the
  // same distribution read two ways.
  close(dc.get('1X')!, r.get('HOME')! + r.get('DRAW')!, 1e-12);
  close(dc.get('12')!, r.get('HOME')! + r.get('AWAY')!, 1e-12);
  close(dc.get('X2')!, r.get('DRAW')! + r.get('AWAY')!, 1e-12);

  const dnb = priceDrawNoBet(m);
  close(dnb.get('HOME')! + dnb.get('AWAY')!, 1, 1e-12);
  close(dnb.get('HOME')!, r.get('HOME')! / (r.get('HOME')! + r.get('AWAY')!), 1e-12);

  for (const line of [0.5, 1.5, 2.5, 3.5]) {
    const ou = priceOverUnder(m, line);
    close(ou.get('over')! + ou.get('under')!, 1, 1e-9);
  }
  // Over 0.5 must be at least over 1.5, and so on down the ladder.
  const o05 = priceOverUnder(m, 0.5).get('over')!;
  const o15 = priceOverUnder(m, 1.5).get('over')!;
  const o25 = priceOverUnder(m, 2.5).get('over')!;
  const o35 = priceOverUnder(m, 3.5).get('over')!;
  assert.ok(o05 > o15 && o15 > o25 && o25 > o35, 'over probabilities must decrease with the line');

  // BTTS cannot exceed the chance of at least two goals being scored.
  const btts = priceBtts(m).get('yes')!;
  assert.ok(btts <= o15 + 1e-12, 'BTTS yes cannot exceed over 1.5');
});

test('under 0.5 equals the exact 0-0 probability', () => {
  const m = buildScoreMatrix(1.4, 1.2, -0.12);
  close(priceOverUnder(m, 0.5).get('under')!, m.p[0]![0]!, 1e-12);
});

test('european handicap at zero reproduces the 1X2 market', () => {
  const m = buildScoreMatrix(1.7, 1.0, -0.1);
  const r = priceResult(m);
  const eh = priceEuropeanHandicap(m, 0);
  close(eh.get('HOME')!, r.get('HOME')!, 1e-12);
  close(eh.get('DRAW')!, r.get('DRAW')!, 1e-12);
  close(eh.get('AWAY')!, r.get('AWAY')!, 1e-12);
});

test('european handicap shifts the scoreline in the right direction', () => {
  const m = buildScoreMatrix(1.7, 1.0, -0.1);
  const level = priceEuropeanHandicap(m, 0).get('HOME')!;
  const giving = priceEuropeanHandicap(m, -1).get('HOME')!;
  const taking = priceEuropeanHandicap(m, 1).get('HOME')!;
  assert.ok(giving < level, 'a home team starting a goal down should win the handicap less often');
  assert.ok(taking > level, 'a home team starting a goal up should win it more often');
});

test('asian handicap at a whole line refunds on the exact margin', () => {
  const m = buildScoreMatrix(1.6, 1.1, -0.11);
  const ah = priceAsianHandicap(m, -1);
  // Home giving one goal pushes exactly when home wins by one.
  const exactlyOne = sumWhere(m, (h, a) => h - a === 1);
  close(ah.push.get('HOME')!, exactlyOne, 1e-12);
  close(ah.push.get('AWAY')!, exactlyOne, 1e-12);
  // Break-even probabilities are conditional on resolving, so they complement.
  close(ah.effective.get('HOME')! + ah.effective.get('AWAY')!, 1, 1e-9);
});

test('asian half lines never push and agree with the raw margin split', () => {
  const m = buildScoreMatrix(1.5, 1.3, -0.1);
  const ah = priceAsianHandicap(m, -0.5);
  close(ah.push.get('HOME')!, 0, 1e-12);
  // -0.5 is simply "home to win".
  close(ah.effective.get('HOME')!, priceResult(m).get('HOME')!, 1e-9);
});

test('asian quarter line sits between its two neighbours', () => {
  const m = buildScoreMatrix(1.6, 1.1, -0.11);
  const at0 = priceAsianHandicap(m, 0).effective.get('HOME')!;
  const atQuarter = priceAsianHandicap(m, -0.25).effective.get('HOME')!;
  const atHalf = priceAsianHandicap(m, -0.5).effective.get('HOME')!;
  assert.ok(
    atQuarter < at0 && atQuarter > atHalf,
    `quarter line ${atQuarter.toFixed(4)} should sit between ${atHalf.toFixed(4)} and ${at0.toFixed(4)}`,
  );
  // Half the stake rides a pushing line, so half the push probability survives.
  assert.ok(ah0Push(m) / 2 - ahQuarterPush(m) < 1e-9, 'quarter line carries half the push');
});

function ah0Push(m: ReturnType<typeof buildScoreMatrix>) {
  return priceAsianHandicap(m, 0).push.get('HOME')!;
}
function ahQuarterPush(m: ReturnType<typeof buildScoreMatrix>) {
  return priceAsianHandicap(m, -0.25).push.get('HOME')!;
}

test('line classification matches settlement rules', () => {
  assert.equal(isQuarterLine(-0.25), true);
  assert.equal(isQuarterLine(0.75), true);
  assert.equal(isQuarterLine(-0.5), false);
  assert.equal(isQuarterLine(1), false);
  assert.equal(pushRuleFor(0), 'full');
  assert.equal(pushRuleFor(-1), 'full');
  assert.equal(pushRuleFor(-0.5), 'none');
  assert.equal(pushRuleFor(-0.25), 'half');
});

test('negative binomial has the mean and dispersion it was asked for', () => {
  const mean = 10.4;
  const disp = 1.45;
  const pmf = negBinomPmf(mean, disp, 60);
  close(pmf.reduce((a, b) => a + b, 0), 1, 1e-9);

  let m1 = 0;
  for (let k = 0; k < pmf.length; k++) m1 += k * pmf[k]!;
  close(m1, mean, 0.02);

  let m2 = 0;
  for (let k = 0; k < pmf.length; k++) m2 += (k - m1) ** 2 * pmf[k]!;
  // Variance-to-mean is the dispersion; this is the whole reason corners are
  // not modelled as Poisson.
  close(m2 / m1, disp, 0.05);
});

test('negative binomial collapses to Poisson at dispersion 1', () => {
  const pmf = negBinomPmf(2.5, 1, 40);
  let fact = 1;
  for (let k = 0; k <= 8; k++) {
    if (k > 0) fact *= k;
    close(pmf[k]!, (Math.exp(-2.5) * Math.pow(2.5, k)) / fact, 1e-10);
  }
});

test('corner and card markets are proper distributions', () => {
  for (const line of [8.5, 9.5, 10.5, 11.5]) {
    const c = priceTotalCorners(10.2, 1.4, line);
    close(c.get('over')! + c.get('under')!, 1, 1e-9);
  }
  const cr = priceCornersResult(5.6, 4.6, 1.4);
  close(cr.get('HOME')! + cr.get('DRAW')! + cr.get('AWAY')!, 1, 1e-9);
  assert.ok(cr.get('HOME')! > cr.get('AWAY')!, 'the side with more expected corners should be favourite');

  const reds = priceTotalReds(0.12, 0.5);
  close(reds.get('over')! + reds.get('under')!, 1, 1e-9);
  // "Over 0.5 red cards" and "a red card is shown" are the same event.
  close(reds.get('over')!, priceRedCard(0.12).get('yes')!, 1e-9);
});

// ------------------------------------------------------------------ de-vig

test('shin strips the margin and returns a proper distribution', () => {
  const odds = [2.1, 3.4, 3.6];
  const raw = odds.reduce((a, o) => a + 1 / o, 0);
  assert.ok(raw > 1, 'test fixture should actually carry a margin');

  const s = shin(odds);
  close(s.probs.reduce((a, b) => a + b, 0), 1, 1e-9);
  close(s.overround, raw, 1e-12);
  assert.equal(s.method, 'shin');
  assert.ok(s.z > 0 && s.z < 0.2, `z ${s.z} should be a small positive insider share`);
});

test('shin shades longshots harder than proportional de-vigging', () => {
  // The favourite-longshot bias: books load more margin onto the outsider.
  // Proportional de-vigging ignores that and leaves longshots looking better
  // priced than they are, which is how a model drifts into backing them.
  const odds = [1.35, 5.5, 11.0];
  const s = shin(odds);
  const m = multiplicative(odds);

  assert.ok(s.probs[2]! < m.probs[2]!, 'shin should assign the longshot less probability');
  assert.ok(s.probs[0]! > m.probs[0]!, 'shin should assign the favourite more probability');
  close(s.probs.reduce((a, b) => a + b, 0), 1, 1e-9);
});

test('shin is a no-op on a market with no margin', () => {
  const p = [0.5, 0.3, 0.2];
  const s = shin(p.map((x) => 1 / x));
  for (let i = 0; i < p.length; i++) close(s.probs[i]!, p[i]!, 1e-6);
  close(s.z, 0, 1e-9);
});

test('shin falls back rather than returning nonsense', () => {
  const bad = shin([1.01, 1.01, 1.01]); // ~297% overround
  close(bad.probs.reduce((a, b) => a + b, 0), 1, 1e-9);
  assert.ok(bad.probs.every((p) => p > 0 && p < 1));
});

test('kelly and EV agree about where the break-even point is', () => {
  // At fair odds there is no edge, so no stake.
  close(kelly(0.5, 2.0), 0, 1e-12);
  close(expectedValue(0.5, 2.0), 0, 1e-12);
  close(fairOdds(0.4), 2.5, 1e-12);

  assert.ok(kelly(0.55, 2.0) > 0, 'a real edge should produce a stake');
  assert.equal(kelly(0.45, 2.0), 0, 'a negative edge must produce no stake, not a negative one');
  // Quarter-Kelly is exactly a quarter of full Kelly.
  close(kelly(0.55, 2.0, 0.25), kelly(0.55, 2.0) * 0.25, 1e-12);
});

// ------------------------------------------------------------ book consensus

import { buildBookMarkets, offeredLines, findBookMarket } from '../src/odds.ts';
import type { Quote } from '../src/types.ts';

function q(
  bookmaker_slug: string,
  market: Quote['market'],
  outcome: Quote['outcome'],
  decimal_odds: number,
  extra: Partial<Quote> = {},
): Quote {
  return {
    market,
    outcome,
    line: null,
    push: null,
    bookmaker_slug,
    bookmaker_name: bookmaker_slug,
    decimal_odds,
    opening_decimal_odds: null,
    opening_at: null,
    previous_decimal_odds: null,
    implied_probability: null,
    movement: null,
    is_max_quote: false,
    updated_at: 1000,
    ...extra,
  };
}

test('consensus de-vigs within each book rather than across the best prices', () => {
  // Two books, each with a real margin, disagreeing slightly.
  const quotes = [
    q('bet365', '1x2', 'HOME', 2.10), q('bet365', '1x2', 'DRAW', 3.40), q('bet365', '1x2', 'AWAY', 3.60),
    q('pinnacle', '1x2', 'HOME', 2.20), q('pinnacle', '1x2', 'DRAW', 3.50), q('pinnacle', '1x2', 'AWAY', 3.50),
  ];
  const markets = buildBookMarkets(quotes);
  const m = findBookMarket(markets, '1x2', null)!;

  const sum = [...m.fair.values()].reduce((a, b) => a + b, 0);
  close(sum, 1, 1e-9);

  // Taking the best of each book and de-vigging *that* would sum below one and
  // make every outcome look like value. The guard is that the consensus is a
  // proper distribution while the best-price set is not.
  const bestSum = [...m.best.values()].reduce((a, b) => a + 1 / b.odds, 0);
  assert.ok(bestSum < m.overround, 'best prices should show less margin than a single book');
  assert.ok(m.overround > 1, 'the per-book overround should still be visible');
});

test('a book quoting only half a market is excluded from the consensus', () => {
  const quotes = [
    q('bet365', 'btts', 'yes', 1.90), q('bet365', 'btts', 'no', 1.90),
    // Only one side — cannot be de-vigged, must not skew the average.
    q('sketchy', 'btts', 'yes', 5.00),
  ];
  const m = findBookMarket(buildBookMarkets(quotes), 'btts', null)!;
  close(m.fair.get('yes')!, 0.5, 1e-6);
  // It can still offer the best price, which is where you would place the bet.
  assert.equal(m.best.get('yes')!.odds, 5.0);
});

test('sharper books carry more weight in the consensus', () => {
  const quotes = [
    q('pinnacle', 'btts', 'yes', 1.80), q('pinnacle', 'btts', 'no', 2.00),
    q('williamhill', 'btts', 'yes', 2.20), q('williamhill', 'btts', 'no', 1.65),
  ];
  const m = findBookMarket(buildBookMarkets(quotes), 'btts', null)!;
  // Pinnacle makes yes the favourite; the soft book does not. Weighted 3:1,
  // the consensus should land nearer Pinnacle's view.
  assert.ok(m.fair.get('yes')! > 0.5, 'consensus should follow the sharp book');
  assert.ok(m.fair.get('yes')! < 0.53, 'but not ignore the other book entirely');
});

test('lines are grouped separately and discoverable', () => {
  const quotes = [
    q('bet365', 'total_corners', 'over', 1.90, { line: 9.5 }),
    q('bet365', 'total_corners', 'under', 1.90, { line: 9.5 }),
    q('bet365', 'total_corners', 'over', 2.30, { line: 10.5 }),
    q('bet365', 'total_corners', 'under', 1.62, { line: 10.5 }),
  ];
  const markets = buildBookMarkets(quotes);
  assert.equal(markets.length, 2, 'each line is its own market');
  assert.deepEqual(offeredLines(quotes, 'total_corners'), [9.5, 10.5]);

  const at95 = findBookMarket(markets, 'total_corners', 9.5)!;
  const at105 = findBookMarket(markets, 'total_corners', 10.5)!;
  assert.ok(
    at95.fair.get('over')! > at105.fair.get('over')!,
    'over should be less likely at the higher line',
  );
});

test('movement is read from the sharpest book that reported an opening price', () => {
  const quotes = [
    q('williamhill', 'btts', 'yes', 1.95, { opening_decimal_odds: 1.80, movement: 'DRIFTING' }),
    q('williamhill', 'btts', 'no', 1.85),
    q('pinnacle', 'btts', 'yes', 1.72, { opening_decimal_odds: 2.10, movement: 'SHORTENING' }),
    q('pinnacle', 'btts', 'no', 2.15),
  ];
  const m = findBookMarket(buildBookMarkets(quotes), 'btts', null)!;
  const mv = m.movement.get('yes')!;
  assert.equal(mv.dir, 'SHORTENING', 'should take Pinnacle over the soft book');
  close(mv.opening, 2.10, 1e-9);
  close(mv.current, 1.72, 1e-9);
});
