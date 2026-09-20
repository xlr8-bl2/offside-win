import { test } from 'node:test';
import assert from 'node:assert/strict';
import { settleSelection } from '../src/settle.ts';
import type { MarketCode, Outcome } from '../src/types.ts';
// @ts-expect-error — plain ES module shipped to the browser, no types.
import { didItLand } from '../../public/js/lib/markets.js';

/**
 * Two implementations of settlement, held to each other.
 *
 * The engine grades a pick three hours after kick-off. The board marks a match
 * the moment the score arrives, from public/js/lib/markets.js, because a
 * finished match sits on the board for six hours and leaving it unmarked for
 * most of that is a board that has not caught up.
 *
 * Two graders is a real risk: one that disagrees with the other puts a mark on
 * the board the record then contradicts, and the record is the only honest
 * marketing this product has. So they are run against each other here over
 * every market the score can answer and every scoreline a football match
 * plausibly produces, plus every line a book actually offers.
 *
 * If this fails, the front end is wrong until proven otherwise -- the engine's
 * grade is what goes in the ledger.
 */

const COARSE = (r: string): 'won' | 'lost' | 'back' | 'part' =>
  r === 'WON' ? 'won'
  : r === 'LOST' ? 'lost'
  : r === 'PUSH' ? 'back'
  : 'part';

const SCORES: Array<[number, number]> = [];
for (let h = 0; h <= 5; h++) for (let a = 0; a <= 5; a++) SCORES.push([h, a]);

const CASES: Array<{ market: MarketCode; outcomes: Outcome[]; lines: Array<number | null> }> = [
  { market: '1x2', outcomes: ['HOME', 'DRAW', 'AWAY'], lines: [null] },
  { market: 'double_chance', outcomes: ['1X', '12', 'X2'], lines: [null] },
  { market: 'draw_no_bet', outcomes: ['HOME', 'AWAY'], lines: [null] },
  { market: 'btts', outcomes: ['yes', 'no'], lines: [null] },
  { market: 'over_under_05', outcomes: ['over', 'under'], lines: [0.5] },
  { market: 'over_under_15', outcomes: ['over', 'under'], lines: [1.5] },
  { market: 'over_under_25', outcomes: ['over', 'under'], lines: [2.5] },
  { market: 'over_under_35', outcomes: ['over', 'under'], lines: [3.5] },
  { market: 'european_handicap', outcomes: ['HOME', 'DRAW', 'AWAY'], lines: [-2, -1, 1, 2] },
  {
    market: 'asian_handicap',
    outcomes: ['HOME', 'AWAY'],
    lines: [-2, -1.75, -1.5, -1.25, -1, -0.75, -0.5, -0.25, 0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2],
  },
];

test('the board grades a finished match exactly as the engine does', () => {
  let checked = 0;
  for (const { market, outcomes, lines } of CASES) {
    for (const outcome of outcomes) {
      for (const line of lines) {
        for (const [homeGoals, awayGoals] of SCORES) {
          const engine = settleSelection(market, outcome, line, 2.0, {
            homeGoals, awayGoals, homeCorners: null, awayCorners: null, reds: null,
          });
          const page = didItLand({ market, outcome, line, homeGoals, awayGoals });
          assert.ok(engine, `engine would not grade ${market} ${outcome} ${line}`);
          assert.equal(
            page,
            COARSE(engine.result),
            `${market} ${outcome} ${line ?? ''} at ${homeGoals}-${awayGoals}: ` +
              `page said ${page}, engine said ${engine.result}`,
          );
          checked++;
        }
      }
    }
  }
  // A guard against the loops silently emptying and the test passing on air.
  assert.ok(checked > 1500, `only ${checked} combinations checked`);
});

test('markets the score cannot answer are left unmarked rather than guessed', () => {
  for (const market of ['total_corners', 'corners_1x2', 'total_red_cards', 'red_card'] as MarketCode[]) {
    assert.equal(
      didItLand({ market, outcome: 'over', line: 9.5, homeGoals: 2, awayGoals: 1 }),
      null,
      `${market} was graded from goals alone`,
    );
  }
});

test('a match with no score yet is unmarked', () => {
  assert.equal(didItLand({ market: '1x2', outcome: 'HOME', line: null, homeGoals: null, awayGoals: null }), null);
  assert.equal(didItLand({ market: '1x2', outcome: 'HOME', line: null, homeGoals: 2, awayGoals: undefined }), null);
});
