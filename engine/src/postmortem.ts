import type { MarketCode, Outcome } from './types.ts';
import { settleSelection, type Result } from './settle.ts';

/**
 * Why a call landed, and why one missed.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS IS ALLOWED TO CLAIM
 *
 * The temptation with a post-mortem is to grade the reasoning: we said the
 * derby would be cagey, was it cagey? Almost none of that is adjudicable from
 * the data a finished match leaves behind. We do not know whether the rested
 * side looked fresher, or whether the absent striker would have scored. A
 * verdict on it would be a sentence with the shape of evidence and none of the
 * substance, which is the exact failure this product exists to avoid.
 *
 * So this engine judges only the three things the record genuinely settles:
 *
 *  1. **How close it was.** How many goals would have had to change for the
 *     bet to settle the other way. One is a different story from four, and it
 *     is the first thing anybody wants to know about a loss.
 *
 *  2. **Whether the game looked like we thought it would.** We publish an
 *     expected shape for every fixture. A 0-0 after we called it open is a
 *     read that was wrong about the match; a 4-3 after the same call is a read
 *     that was right about the match and lost anyway.
 *
 *  3. **Whether the market came round to us.** The price when we called it
 *     against the price at kick-off. A call that shortened from 1.28 to 1.19
 *     and lost was a good call that did not come in. One that drifted to 1.45
 *     was a call the rest of the market disagreed with, and they were right.
 *
 * Crossing (2) and (3) is the whole product of this file. Right about the
 * match and wrong about the result is variance. Wrong about the match with the
 * market moving away is a mistake, and saying so is the only reason anybody
 * should believe the rest of it.
 */

export type Landed = 'landed' | 'missed' | 'refunded' | 'split';
export type Closeness = 'knife-edge' | 'clear' | 'nowhere near';
export type Shape = 'as we read it' | 'quieter' | 'busier';
export type MarketMove = 'came to us' | 'moved away' | 'held';

export interface PostMortem {
  landed: Landed;
  /** Goals that would have had to change for it to settle the other way. */
  swing: number | null;
  closeness: Closeness | null;
  /** The match against the shape we published for it. */
  shape: Shape | null;
  expected_total: number | null;
  actual_total: number | null;
  /** The price when we called it against the price at kick-off. */
  market: MarketMove | null;
  opening_odds: number | null;
  closing_odds: number | null;
  /** The verdict, in words. */
  line: string;
}

export interface PostMortemInput {
  market: MarketCode;
  outcome: Outcome;
  line: number | null;
  result: Result;
  homeGoals: number;
  awayGoals: number;
  /** The shape we published: our expected goals for each side. */
  expectedHome?: number | null;
  expectedAway?: number | null;
  openingOdds?: number | null;
  closingOdds?: number | null;
}

/**
 * How many goals would have had to change for this to settle the other way.
 *
 * Searched against `settleSelection` rather than derived in arithmetic, and
 * that is the important decision in this file. The first version worked the
 * distance out per market by hand and was wrong on ninety-eight of seven
 * hundred and fifty scorelines: a whole-line European handicap has no push so
 * the boundary is not where the arithmetic put it, both teams to score needs
 * two goals from 0-0 rather than one, and a draw-no-bet sitting on a level
 * score is already on its boundary and still one goal from anything different.
 *
 * Every one of those was a second implementation of settlement drifting from
 * the first. There is no second implementation now: the rule for what a bet
 * does is in one function, and this asks it. A hundred scorelines is nothing
 * to evaluate, and it cannot disagree with the grader by construction.
 *
 * Returns null where the market does not settle on goals -- corners and cards
 * are decided by numbers a finished-score payload does not carry, and guessing
 * at them would be inventing the one figure the whole page turns on.
 */
const GOAL_SETTLED = new Set<MarketCode>([
  '1x2', 'double_chance', 'draw_no_bet', 'btts',
  'over_under_05', 'over_under_15', 'over_under_25', 'over_under_35',
  'asian_handicap', 'european_handicap',
]);

/** Far enough that no realistic scoreline is closer to the edge than to a flip. */
const SEARCH = 10;

export function swingFor(
  market: MarketCode,
  outcome: Outcome,
  line: number | null,
  hg: number,
  ag: number,
): number | null {
  if (!GOAL_SETTLED.has(market)) return null;
  if (!Number.isInteger(hg) || !Number.isInteger(ag) || hg < 0 || ag < 0) return null;

  const grade = (h: number, a: number) =>
    settleSelection(market, outcome, line, 2, {
      homeGoals: h,
      awayGoals: a,
      homeCorners: null,
      awayCorners: null,
      reds: null,
    })?.result;

  const now = grade(hg, ag);
  if (now === undefined) return null;

  let best: number | null = null;
  for (let h = 0; h <= SEARCH; h++) {
    for (let a = 0; a <= SEARCH; a++) {
      if (grade(h, a) === now) continue;
      const d = Math.abs(h - hg) + Math.abs(a - ag);
      if (best === null || d < best) best = d;
    }
  }
  return best;
}

const WORD = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'];
const word = (n: number): string => WORD[n] ?? String(n);

function closenessOf(swing: number | null): Closeness | null {
  if (swing === null) return null;
  if (swing <= 1) return 'knife-edge';
  if (swing <= 2) return 'clear';
  return 'nowhere near';
}

/**
 * The match against the shape we published for it.
 *
 * The band is deliberately wide. Football is a low-scoring game and a
 * half-goal difference between expectation and outcome is noise, not a
 * misread -- calling it one would make this engine say "we were wrong about
 * the match" on every 1-1 we expected to be 1-1.
 */
function shapeOf(expected: number | null, actual: number): Shape | null {
  if (expected === null) return null;
  const gap = actual - expected;
  if (gap <= -1.5) return 'quieter';
  if (gap >= 1.5) return 'busier';
  return 'as we read it';
}

/** The price when we called it against the price at kick-off. */
function marketOf(opening: number | null, closing: number | null): MarketMove | null {
  if (!opening || !closing || opening <= 1 || closing <= 1) return null;
  const move = closing / opening - 1;
  // Under two per cent is the same price quoted by a different book.
  if (Math.abs(move) < 0.02) return 'held';
  return move < 0 ? 'came to us' : 'moved away';
}

const LANDED: Record<Result, Landed> = {
  WON: 'landed',
  HALF_WON: 'split',
  LOST: 'missed',
  HALF_LOST: 'split',
  PUSH: 'refunded',
  VOID: 'refunded',
};

/**
 * The verdict, in one sentence.
 *
 * Written rather than assembled from fragments, because the interesting cases
 * are the crossings: a loss on a game we read correctly is a different
 * sentence from a loss on a game we misread, and both are different again
 * from a loss the market saw coming.
 */
function verdict(pm: Omit<PostMortem, 'line'>): string {
  const { landed, swing, shape, market } = pm;

  if (landed === 'refunded') return 'It settled level, so the stake came back.';

  if (landed === 'missed') {
    if (shape === 'as we read it' && swing !== null && swing <= 1) {
      return market === 'came to us'
        ? 'We read the game right and the market agreed by kick-off. It still came down to one goal, and the goal went the other way.'
        : 'The game went the way we said it would. One goal in the wrong place is the whole of it.';
    }
    if (shape === 'as we read it') {
      return 'The match was roughly what we expected. The result was not, and there is no more to it than that.';
    }
    if (market === 'moved away') {
      return shape === 'quieter'
        ? 'A quieter game than we called, and the price had been drifting all week. The market saw this one before we did.'
        : 'A busier game than we called, and the price was drifting. The market was on the other side of this and it was right.';
    }
    if (shape === 'quieter') {
      return swing !== null && swing >= 3
        ? 'Nothing like the game we described. Not close, and not unlucky.'
        : 'A quieter game than we read it for, and that is where this was lost.';
    }
    if (shape === 'busier') {
      return 'More happened than we allowed for, which is the risk we named and the one that came in.';
    }
    return swing !== null && swing <= 1
      ? 'One goal away from settling the other way.'
      : 'Wrong, and not close enough to call it unlucky.';
  }

  if (landed === 'split') {
    return 'It finished on the line, so half the stake came back and half of it won.';
  }

  // Landed.
  if (swing !== null && swing <= 1) {
    return market === 'moved away'
      ? 'It came in by a goal, with the market drifting against us the whole way. Right, and closer than it should have been.'
      : 'One goal the other way and it was gone. Right, with nothing to spare.';
  }
  if (shape === 'as we read it') {
    return market === 'came to us'
      ? 'The game we described, at a price that had already started shortening. Called.'
      : 'The game went almost exactly as we read it.';
  }
  if (swing !== null && swing >= 3) {
    return 'Never in doubt, whatever the price said beforehand.';
  }
  return 'It landed with room to spare.';
}

export function postMortem(input: PostMortemInput): PostMortem {
  const { market, outcome, line, result, homeGoals: hg, awayGoals: ag } = input;
  const swing = swingFor(market, outcome, line, hg, ag);
  const actual = hg + ag;
  const expected =
    typeof input.expectedHome === 'number' && typeof input.expectedAway === 'number'
      ? Number((input.expectedHome + input.expectedAway).toFixed(2))
      : null;

  const base: Omit<PostMortem, 'line'> = {
    landed: LANDED[result] ?? 'refunded',
    swing,
    closeness: closenessOf(swing),
    shape: shapeOf(expected, actual),
    expected_total: expected,
    actual_total: actual,
    market: marketOf(input.openingOdds ?? null, input.closingOdds ?? null),
    opening_odds: input.openingOdds ?? null,
    closing_odds: input.closingOdds ?? null,
  };

  return { ...base, line: verdict(base) };
}

/** How near it came, in words, for a page that wants the fact without the verdict. */
export function swingLine(pm: PostMortem): string | null {
  if (pm.swing === null) return null;
  if (pm.swing === 0) return 'It finished exactly on the line.';
  const goals = `${word(pm.swing)} goal${pm.swing === 1 ? '' : 's'}`;
  return pm.landed === 'missed'
    ? `${goals[0]!.toUpperCase()}${goals.slice(1)} away from landing.`
    : `${goals[0]!.toUpperCase()}${goals.slice(1)} of cushion.`;
}
