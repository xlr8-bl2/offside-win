import { test } from 'node:test';
import assert from 'node:assert/strict';
import { backsRotatedSide, sideBacked, xiChange, ROTATED_AT } from '../src/context/xi.ts';
import { buildBookMarkets } from '../src/odds.ts';
import type { Quote } from '../src/types.ts';

/**
 * Germany v Greece, 27 September 2026: a rotated Germany, a call backing them
 * that stood, and a drift limit that never ran. What the engine now does with
 * each of those.
 */

const XI = (names: string[]) => names.map((name, i) => ({ id: i + 1, name }));
const predicted = XI(['Neuer', 'Kimmich', 'Rüdiger', 'Tah', 'Raum', 'Andrich', 'Wirtz', 'Musiala', 'Gnabry', 'Havertz', 'Undav']);

test('changes are the expected starters missing from the confirmed eleven, with who came in', () => {
  const confirmed = [
    ...predicted.filter((p) => ['Kimmich', 'Tah'].includes(p.name)),
    ...['Nübel', 'Vagnoman', 'Bisseck', 'Brown', 'Nmecha', 'Schade', 'Conté', 'Adeyemi', 'Ebnoutalib'].map((name, i) => ({ id: 100 + i, name })),
  ];
  const ch = xiChange(predicted, confirmed)!;
  assert.equal(ch.n, 9);
  assert.ok(ch.out.includes('Neuer') && ch.out.includes('Havertz') && ch.out.includes('Undav'));
  assert.ok(ch.in.includes('Nübel') && ch.in.includes('Ebnoutalib'));
});

test('the same eleven is no change, and a thin sheet is not compared', () => {
  assert.equal(xiChange(predicted, predicted)!.n, 0);
  assert.equal(xiChange(predicted.slice(0, 8), predicted), null);
});

test('which side a call backs: result, double chance, draw no bet and handicaps; never goals', () => {
  assert.equal(sideBacked('double_chance', '1X'), 'home');
  assert.equal(sideBacked('double_chance', 'X2'), 'away');
  assert.equal(sideBacked('double_chance', '12'), null);
  assert.equal(sideBacked('1x2', 'HOME'), 'home');
  assert.equal(sideBacked('1x2', 'DRAW'), null);
  assert.equal(sideBacked('asian_handicap', 'AWAY'), 'away');
  assert.equal(sideBacked('draw_no_bet', 'HOME'), 'home');
  assert.equal(sideBacked('over_under_25', 'over'), null);
});

test('a call backing a rotated side is flagged; the other side and small changes are not', () => {
  const changes = { home: { n: ROTATED_AT + 2, out: ['Neuer'], in: ['Nübel'] }, away: { n: 1, out: [], in: [] } };
  assert.ok(backsRotatedSide({ market: 'double_chance', outcome: '1X' }, changes));
  assert.equal(backsRotatedSide({ market: 'double_chance', outcome: 'X2' }, changes), null);
  assert.equal(backsRotatedSide({ market: 'over_under_25', outcome: 'under' }, changes), null);
  const small = { home: { n: ROTATED_AT - 1, out: [], in: [] }, away: null };
  assert.equal(backsRotatedSide({ market: '1x2', outcome: 'HOME' }, small), null);
  assert.equal(backsRotatedSide({ market: '1x2', outcome: 'HOME' }, null), null);
});

const q = (outcome: string, odds: number, opening: number | null, book: string): Quote => ({
  market: '1x2', outcome, line: null, push: null, bookmaker_slug: book, bookmaker_name: book,
  decimal_odds: odds, opening_decimal_odds: opening, movement: null, is_max_quote: false, updated_at: 1,
} as unknown as Quote);

test('no book kept every opening price: the opening view is rebuilt from each outcome\'s own, so the drift limit can run', () => {
  // As on the night: Greece shortened a long way, and no single book kept all three openers.
  const book = buildBookMarkets([
    q('HOME', 1.46, 1.3, 'bet365'), q('DRAW', 5.3, null, 'bet365'), q('AWAY', 7.5, null, 'bet365'),
    q('HOME', 1.47, null, 'unibet'), q('DRAW', 5.2, 5.6, 'unibet'), q('AWAY', 7.4, 9.2, 'unibet'),
    { ...q('1X', 1.13, null, 'bet365'), market: 'double_chance' } as Quote,
    { ...q('12', 1.19, null, 'bet365'), market: 'double_chance' } as Quote,
    { ...q('X2', 2.84, null, 'bet365'), market: 'double_chance' } as Quote,
  ]);
  const r = book.find((m) => m.market === '1x2')!;
  assert.ok(r.open, 'an opening view exists');
  assert.equal(r.open!.book, 'movement');
  // The money went against Germany: home was likelier at the open than now.
  assert.ok(r.open!.fair.get('HOME')! > r.fair.get('HOME')!);
  assert.ok(r.open!.fair.get('AWAY')! < r.fair.get('AWAY')!);
  // And it flows to Germany-or-draw, which the drift limit then reads.
  const dc = book.find((m) => m.market === 'double_chance')!;
  assert.ok(dc.open, 'double chance has an opening view too');
  assert.ok(dc.open!.fair.get('1X')! > dc.fair.get('1X')!, 'the money moved against Germany or a draw');
});

test('a book that kept every opening price is still preferred over the rebuilt view', () => {
  const book = buildBookMarkets([
    q('HOME', 1.5, 1.6, 'pinnacle'), q('DRAW', 4.4, 4.2, 'pinnacle'), q('AWAY', 7.2, 6.4, 'pinnacle'),
  ]);
  assert.equal(book.find((m) => m.market === '1x2')!.open!.book, 'pinnacle');
});
