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
