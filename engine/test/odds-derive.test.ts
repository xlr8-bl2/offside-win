import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBookMarkets } from '../src/odds.ts';
import type { Quote } from '../src/types.ts';

const q = (market: string, outcome: string, odds: number, book = 'pinnacle'): Quote => ({
  market, outcome, line: null, push: null, bookmaker_slug: book, bookmaker_name: book,
  decimal_odds: odds, opening_decimal_odds: null, movement: null, is_max_quote: false, updated_at: 1,
} as unknown as Quote);

test('double chance is priced from the result market, not de-vigged as if it were a partition', () => {
  const book = buildBookMarkets([
    q('1x2', 'HOME', 1.3), q('1x2', 'DRAW', 5.5), q('1x2', 'AWAY', 11),
    q('double_chance', '1X', 1.06), q('double_chance', '12', 1.2), q('double_chance', 'X2', 3.6),
    q('draw_no_bet', 'HOME', 1.08), q('draw_no_bet', 'AWAY', 9),
  ]);
  const r = book.find((m) => m.market === '1x2')!.fair;
  const dc = book.find((m) => m.market === 'double_chance')!;
  // 1X was 45% under the old de-vig. It is home plus draw.
  assert.ok(Math.abs(dc.fair.get('1X')! - (r.get('HOME')! + r.get('DRAW')!)) < 1e-9);
  assert.ok(dc.fair.get('1X')! > 0.9);
  const sum = [...dc.fair.values()].reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 2) < 1e-9, 'pairs cover the result twice');
  // The margin is the implied total over two, a few per cent, not 100%+.
  assert.ok(dc.overround > 1 && dc.overround < 1.15);
  const dnb = book.find((m) => m.market === 'draw_no_bet')!.fair;
  assert.ok(Math.abs(dnb.get('HOME')! - r.get('HOME')! / (r.get('HOME')! + r.get('AWAY')!)) < 1e-9);
});

test('the sharp book\'s own view is kept beside the consensus, and the book count', async () => {
  const { snapshotOf } = await import('../src/odds.ts');
  const book = buildBookMarkets([
    q('1x2', 'HOME', 1.5, 'pinnacle'), q('1x2', 'DRAW', 4.4, 'pinnacle'), q('1x2', 'AWAY', 7.2, 'pinnacle'),
    q('1x2', 'HOME', 1.45, 'bet365'), q('1x2', 'DRAW', 4.2, 'bet365'), q('1x2', 'AWAY', 6.5, 'bet365'),
    q('double_chance', '1X', 1.1, 'bet365'), q('double_chance', '12', 1.25, 'bet365'), q('double_chance', 'X2', 2.9, 'bet365'),
  ]);
  const r = book.find((m) => m.market === '1x2')!;
  assert.equal(r.books, 2);
  assert.equal(r.sharp?.book, 'pinnacle');
  assert.ok(Math.abs([...r.sharp!.fair.values()].reduce((a, b) => a + b, 0) - 1) < 1e-9);
  // Double chance's sharp view comes from the sharp result, not from Pinnacle's own set.
  const dc = book.find((m) => m.market === 'double_chance')!;
  assert.ok(Math.abs(dc.sharp!.fair.get('1X')! - (r.sharp!.fair.get('HOME')! + r.sharp!.fair.get('DRAW')!)) < 1e-9);
  const snap = snapshotOf(r);
  assert.equal(snap.books, 2);
  assert.equal(snap.sharp?.book, 'pinnacle');
});

test('no sharp book, no sharp view', () => {
  const book = buildBookMarkets([q('1x2', 'HOME', 1.45, 'bet365'), q('1x2', 'DRAW', 4.2, 'bet365'), q('1x2', 'AWAY', 6.5, 'bet365')]);
  assert.equal(book[0]!.sharp, null);
});

test('the market as it opened is kept: the sharp book\'s first prices, else the books that kept theirs', async () => {
  const { snapshotOf } = await import('../src/odds.ts');
  const o = (market: string, outcome: string, odds: number, open: number | null, book = 'pinnacle'): Quote =>
    ({ ...q(market, outcome, odds, book), opening_decimal_odds: open } as Quote);
  const book = buildBookMarkets([
    // Home backed from 1.80 into 1.50 at the sharp book.
    o('1x2', 'HOME', 1.5, 1.8), o('1x2', 'DRAW', 4.4, 3.8), o('1x2', 'AWAY', 7.2, 4.6),
    o('1x2', 'HOME', 1.45, 1.75, 'bet365'), o('1x2', 'DRAW', 4.2, 3.7, 'bet365'), o('1x2', 'AWAY', 6.5, 4.4, 'bet365'),
    // A goal line only the soft book kept an opening price for.
    o('over_under_25', 'over', 1.9, 2.0, 'bet365'), o('over_under_25', 'under', 1.9, 1.8, 'bet365'),
    o('double_chance', '1X', 1.1, null, 'bet365'), o('double_chance', '12', 1.25, null, 'bet365'), o('double_chance', 'X2', 2.9, null, 'bet365'),
  ]);
  const r = book.find((m) => m.market === '1x2')!;
  assert.equal(r.open?.book, 'pinnacle');
  assert.ok(r.open!.fair.get('HOME')! < r.sharp!.fair.get('HOME')!, 'the money came for the home side');
  const ou = book.find((m) => m.market === 'over_under_25')!;
  assert.equal(ou.open?.book, 'consensus');
  // Double chance opens as the result market opened.
  const dc = book.find((m) => m.market === 'double_chance')!;
  assert.ok(Math.abs(dc.open!.fair.get('1X')! - (r.open!.fair.get('HOME')! + r.open!.fair.get('DRAW')!)) < 1e-9);
  assert.deepEqual(Object.keys(snapshotOf(r).open!.fair).sort(), ['AWAY', 'DRAW', 'HOME']);
  // No opening price anywhere: nothing is made up.
  const none = buildBookMarkets([q('btts', 'yes', 1.8), q('btts', 'no', 2.0)]);
  assert.equal(none[0]!.open, null);
});
