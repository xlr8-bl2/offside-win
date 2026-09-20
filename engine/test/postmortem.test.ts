import { test } from 'node:test';
import assert from 'node:assert/strict';
import { postMortem, swingFor } from '../src/postmortem.ts';
import { settleSelection } from '../src/settle.ts';
import type { MarketCode, Outcome } from '../src/types.ts';

/**
 * The post-mortem makes claims about scorelines, so the arithmetic behind it
 * is pinned rather than eyeballed. "One goal away from landing" printed under
 * a 4-0 is worse than saying nothing.
 *
 * The property that matters, and the reason for the exhaustive pass at the
 * bottom: applying the swing to the score really does flip the settlement. A
 * swing that does not flip anything is a number made up to look like evidence.
 */

test('the swing is the goal that would have changed it', () => {
  // 1x2: a 2-1 home win is one away goal from a draw, which loses.
  assert.equal(swingFor('1x2', 'HOME', null, 2, 1), 1);
  assert.equal(swingFor('1x2', 'HOME', null, 3, 0), 3);
  // Lost 0-1: home needs two to win it.
  assert.equal(swingFor('1x2', 'HOME', null, 0, 1), 2);
  // Lost 1-1: home needs one.
  assert.equal(swingFor('1x2', 'HOME', null, 1, 1), 1);

  // Goals lines sit on the half, so the distance rounds up to the goal.
  assert.equal(swingFor('over_under_25', 'over', 2.5, 3, 0), 1);
  assert.equal(swingFor('over_under_25', 'over', 2.5, 1, 0), 2);
  assert.equal(swingFor('over_under_25', 'under', 2.5, 1, 0), 2);
  assert.equal(swingFor('over_under_15', 'over', 1.5, 1, 3), 3);

  // A double chance loses on one result only: 1-1 is one away goal from it.
  assert.equal(swingFor('double_chance', '1X', null, 1, 1), 1);
  // Both teams to score from 0-0 needs a goal at each end, not one anywhere.
  assert.equal(swingFor('btts', 'yes', null, 0, 0), 2);
  // A draw-no-bet sitting on a level score has already pushed; anything
  // different is still a goal away.
  assert.equal(swingFor('draw_no_bet', 'HOME', null, 1, 1), 1);
  assert.equal(swingFor('double_chance', '1X', null, 0, 1), 1);

  // Corners and cards are settled from numbers a score does not carry.
  assert.equal(swingFor('total_corners', 'over', 9.5, 2, 1), null);
  assert.equal(swingFor('red_card', 'yes', null, 2, 1), null);
});

test('the swing is the smallest number of goals that changes anything', () => {
  /*
   * The ground truth, computed rather than asserted: walk every scoreline
   * within reach and find the nearest one that settles differently, where
   * distance is the total number of goals added or removed on either side.
   * `swingFor` has to agree with it exactly.
   *
   * This is the version of the test that matters. Checking that *a* scoreline
   * at the stated distance flips the bet catches a swing that is too small; it
   * does not catch one that is too large, and "three goals away" printed on a
   * game that was one goal away is the failure a reader would actually notice.
   */
  const cases: Array<{ market: MarketCode; outcomes: Outcome[]; lines: Array<number | null> }> = [
    { market: '1x2', outcomes: ['HOME', 'DRAW', 'AWAY'], lines: [null] },
    { market: 'double_chance', outcomes: ['1X', '12', 'X2'], lines: [null] },
    { market: 'draw_no_bet', outcomes: ['HOME', 'AWAY'], lines: [null] },
    { market: 'btts', outcomes: ['yes', 'no'], lines: [null] },
    { market: 'over_under_05', outcomes: ['over', 'under'], lines: [0.5] },
    { market: 'over_under_15', outcomes: ['over', 'under'], lines: [1.5] },
    { market: 'over_under_25', outcomes: ['over', 'under'], lines: [2.5] },
    { market: 'over_under_35', outcomes: ['over', 'under'], lines: [3.5] },
    { market: 'european_handicap', outcomes: ['HOME', 'DRAW', 'AWAY'], lines: [-2, -1, 1, 2] },
    { market: 'asian_handicap', outcomes: ['HOME', 'AWAY'], lines: [-1.5, -1, -0.75, -0.5, -0.25, 0, 0.5, 1] },
  ];

  const grade = (m: MarketCode, o: Outcome, l: number | null, h: number, a: number) =>
    settleSelection(m, o, l, 2, {
      homeGoals: h, awayGoals: a, homeCorners: null, awayCorners: null, reds: null,
    })?.result;

  let checked = 0;
  const wrong: string[] = [];
  for (const { market, outcomes, lines } of cases) {
    for (const outcome of outcomes) {
      for (const line of lines) {
        for (let hg = 0; hg <= 4; hg++) {
          for (let ag = 0; ag <= 4; ag++) {
            const now = grade(market, outcome, line, hg, ag);
            let truth = Infinity;
            for (let h = 0; h <= 9; h++) {
              for (let a = 0; a <= 9; a++) {
                if (grade(market, outcome, line, h, a) === now) continue;
                truth = Math.min(truth, Math.abs(h - hg) + Math.abs(a - ag));
              }
            }
            const got = swingFor(market, outcome, line, hg, ag);
            if (got !== truth) {
              wrong.push(`${market} ${outcome} ${line ?? ''} at ${hg}-${ag}: said ${got}, truth ${truth}`);
            }
            checked++;
          }
        }
      }
    }
  }
  if (process.env.DUMP) { console.error(wrong.join('\n')); }
  assert.deepEqual(wrong.slice(0, 8), [], `${wrong.length} of ${checked} scorelines disagree`);
  assert.ok(checked > 400, `only ${checked} scorelines checked`);
});

test('a verdict separates a bad read from a bad result', () => {
  // Read the game right, lost by one: variance, and it says so.
  const unlucky = postMortem({
    market: 'over_under_25', outcome: 'over', line: 2.5, result: 'LOST',
    homeGoals: 1, awayGoals: 1, expectedHome: 1.4, expectedAway: 1.3,
    openingOdds: 1.30, closingOdds: 1.22,
  });
  assert.equal(unlucky.shape, 'as we read it');
  assert.equal(unlucky.market, 'came to us');
  assert.match(unlucky.line, /read the game right|one goal/i);

  // Misread the game and the market was drifting away: a mistake, and it says that.
  const wrong = postMortem({
    market: 'over_under_25', outcome: 'over', line: 2.5, result: 'LOST',
    homeGoals: 0, awayGoals: 0, expectedHome: 1.9, expectedAway: 1.6,
    openingOdds: 1.30, closingOdds: 1.52,
  });
  assert.equal(wrong.shape, 'quieter');
  assert.equal(wrong.market, 'moved away');
  assert.match(wrong.line, /market saw this one before we did/i);

  // No price history: the verdict still works off the score alone.
  const bare = postMortem({
    market: '1x2', outcome: 'HOME', line: null, result: 'WON', homeGoals: 3, awayGoals: 0,
  });
  assert.equal(bare.market, null);
  assert.equal(bare.shape, null);
  assert.ok(bare.line.length > 10);
});

test('no verdict uses the private vocabulary', async () => {
  // @ts-expect-error — plain ES module shipped to the browser, no types.
  const { findBanned } = await import('../../public/js/lib/vocabulary.js');
  const seen = new Set<string>();
  for (const result of ['WON', 'LOST', 'PUSH', 'HALF_WON'] as const) {
    for (const [h, a] of [[0, 0], [1, 1], [2, 1], [4, 0], [1, 3]]) {
      for (const [op, cl] of [[1.3, 1.2], [1.3, 1.5], [1.3, 1.3], [0, 0]]) {
        for (const [eh, ea] of [[1.4, 1.3], [1.9, 1.6], [0.6, 0.5]]) {
          seen.add(postMortem({
            market: 'over_under_25', outcome: 'over', line: 2.5, result,
            homeGoals: h!, awayGoals: a!, expectedHome: eh, expectedAway: ea,
            openingOdds: op || null, closingOdds: cl || null,
          }).line);
        }
      }
    }
  }
  assert.ok(seen.size >= 6, `only ${seen.size} distinct verdicts`);
  for (const line of seen) assert.equal(findBanned(line), null, `banned term in: ${line}`);
});
