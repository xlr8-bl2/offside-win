import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitCal } from '../src/lab/calib.ts';
import { applyCalibration, type Option } from '../src/lab/markets.ts';

const opt = (family: string, p: number, market = family === 'result' ? '1x2' : 'total_corners'): Option => ({
  market, family, line: null, outcome: 'HOME', odds: 1 / p, book: p, model: null, provider: null, blend: null, push: 0, sharp: null, books: null, open: null, own: null,
} as unknown as Option);

test('a family whose short prices land more often is corrected upward, and the curve never falls', () => {
  const data: Array<{ o: Option; y: number }> = [];
  // Result favourites at 88% that land 94% of the time.
  for (let i = 0; i < 2000; i++) data.push({ o: opt('result', 0.88), y: i % 100 < 94 ? 1 : 0 });
  for (let i = 0; i < 2000; i++) data.push({ o: opt('result', 0.76), y: i % 100 < 76 ? 1 : 0 });
  const cal = fitCal(data, 200);
  const at88 = applyCalibration(cal, opt('result', 0.88));
  assert.ok(at88 > 0.9 && at88 < 0.945, `88% corrected to ${at88}`);
  assert.ok(Math.abs(applyCalibration(cal, opt('result', 0.76)) - 0.76) < 0.01);
  const ys = cal['result']!.y;
  for (let i = 1; i < ys.length; i++) assert.ok(ys[i]! >= ys[i - 1]! - 1e-9);
});

test('no data, or a price under 50%, leaves the price alone', () => {
  assert.equal(applyCalibration(undefined, opt('corners', 0.9)), 0.9);
  assert.equal(applyCalibration(fitCal([], 200), opt('corners', 0.9)), 0.9);
  assert.equal(applyCalibration(fitCal([], 200), opt('corners', 0.4)), 0.4);
});
