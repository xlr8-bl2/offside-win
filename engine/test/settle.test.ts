import { test } from 'node:test';
import assert from 'node:assert/strict';
import { settleSelection } from '../src/settle.ts';

const score = (h: number, a: number, extra: Partial<{ homeCorners: number; awayCorners: number; reds: number }> = {}) => ({
  homeGoals: h,
  awayGoals: a,
  homeCorners: extra.homeCorners ?? null,
  awayCorners: extra.awayCorners ?? null,
  reds: extra.reds ?? null,
});

const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} vs ${b}`);

test('match result markets settle correctly', () => {
  assert.equal(settleSelection('1x2', 'HOME', null, 2.0, score(2, 1))!.result, 'WON');
  assert.equal(settleSelection('1x2', 'DRAW', null, 3.4, score(1, 1))!.result, 'WON');
  assert.equal(settleSelection('1x2', 'AWAY', null, 4.0, score(1, 1))!.result, 'LOST');
  assert.equal(settleSelection('double_chance', '1X', null, 1.3, score(1, 1))!.result, 'WON');
  assert.equal(settleSelection('double_chance', '12', null, 1.2, score(1, 1))!.result, 'LOST');
});

test('draw-no-bet refunds the stake on a draw', () => {
  const r = settleSelection('draw_no_bet', 'HOME', null, 1.6, score(2, 2))!;
  assert.equal(r.result, 'PUSH');
  close(r.pnl, 0);
});

test('goals markets settle on the total', () => {
  assert.equal(settleSelection('over_under_25', 'over', 2.5, 2.0, score(2, 1))!.result, 'WON');
  assert.equal(settleSelection('over_under_25', 'under', 2.5, 2.0, score(2, 1))!.result, 'LOST');
  assert.equal(settleSelection('btts', 'yes', null, 1.8, score(1, 1))!.result, 'WON');
  assert.equal(settleSelection('btts', 'yes', null, 1.8, score(3, 0))!.result, 'LOST');
});

test('asian whole line refunds on the exact margin', () => {
  // Home -1, home wins by exactly one: stake returned.
  const r = settleSelection('asian_handicap', 'HOME', -1, 2.0, score(2, 1))!;
  assert.equal(r.result, 'PUSH');
  close(r.pnl, 0);

  assert.equal(settleSelection('asian_handicap', 'HOME', -1, 2.0, score(3, 1))!.result, 'WON');
  assert.equal(settleSelection('asian_handicap', 'HOME', -1, 2.0, score(1, 1))!.result, 'LOST');
});

test('asian quarter line splits the stake', () => {
  // Home -0.25 = half on level, half on -0.5. A draw gives half back and loses
  // the other half. Getting this wrong silently corrupts every ROI figure.
  const draw = settleSelection('asian_handicap', 'HOME', -0.25, 2.0, score(1, 1))!;
  assert.equal(draw.result, 'HALF_LOST');
  close(draw.pnl, -0.5);

  // A win settles both legs.
  const winBoth = settleSelection('asian_handicap', 'HOME', -0.25, 2.0, score(2, 0))!;
  assert.equal(winBoth.result, 'WON');
  close(winBoth.pnl, 1.0);

  // Home +0.25 with a draw: half won, half refunded.
  const halfWon = settleSelection('asian_handicap', 'HOME', 0.25, 2.0, score(1, 1))!;
  assert.equal(halfWon.result, 'HALF_WON');
  close(halfWon.pnl, 0.5);
});

test('asian line is home-relative and the away leg mirrors it', () => {
  // line = -0.5 means home gives half a goal, so away receives it.
  assert.equal(settleSelection('asian_handicap', 'AWAY', -0.5, 2.0, score(1, 1))!.result, 'WON');
  assert.equal(settleSelection('asian_handicap', 'HOME', -0.5, 2.0, score(1, 1))!.result, 'LOST');
});

test('european handicap has no push', () => {
  // The line shifts the scoreline; a draw stays a distinct outcome.
  assert.equal(settleSelection('european_handicap', 'DRAW', -1, 3.5, score(2, 1))!.result, 'WON');
  assert.equal(settleSelection('european_handicap', 'HOME', -1, 2.4, score(2, 1))!.result, 'LOST');
  assert.equal(settleSelection('european_handicap', 'HOME', -1, 2.4, score(3, 1))!.result, 'WON');
});

test('corner and card markets need their data and void without it', () => {
  assert.equal(
    settleSelection('total_corners', 'over', 9.5, 1.9, score(1, 0, { homeCorners: 6, awayCorners: 5 }))!.result,
    'WON',
  );
  // A whole corner line can push.
  assert.equal(
    settleSelection('total_corners', 'over', 10, 1.9, score(1, 0, { homeCorners: 6, awayCorners: 4 }))!.result,
    'PUSH',
  );
  assert.equal(settleSelection('red_card', 'yes', null, 5.0, score(1, 0, { reds: 1 }))!.result, 'WON');
  assert.equal(settleSelection('red_card', 'no', null, 1.2, score(1, 0, { reds: 0 }))!.result, 'WON');

  // Without corner data the pick cannot be graded. Returning null is what makes
  // settlement void it rather than guess — a wrong grade corrupts calibration
  // permanently, and calibration is what the model steers by.
  assert.equal(settleSelection('total_corners', 'over', 9.5, 1.9, score(1, 0)), null);
  assert.equal(settleSelection('red_card', 'yes', null, 5.0, score(1, 0)), null);
});

test('profit and loss is computed at the taken price', () => {
  close(settleSelection('1x2', 'HOME', null, 3.40, score(1, 0))!.pnl, 2.40);
  close(settleSelection('1x2', 'HOME', null, 3.40, score(0, 1))!.pnl, -1);
});
