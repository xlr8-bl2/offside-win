/**
 * What the market thinks the score will be.
 *
 * A bookmaker's prices on the result, the goal lines and both-teams-to-score
 * are all readings of one belief about how many goals each side scores. Fitting
 * that belief back out -- the pair of scoring rates whose score matrix best
 * reproduces the de-vigged prices -- turns a dozen separate quotes into one
 * coherent distribution, anchored on the most accurate forecaster there is.
 *
 * The rates are then pulled toward our own model's by a weight the backtest
 * chooses, and every goals market (handicaps included, with their pushes
 * priced exactly) comes off the one matrix. That is the whole point: a card
 * cannot say 1X at 80% and the draw-no-bet at 55% when both are the same two
 * numbers underneath.
 */

import { config } from './config.ts';
import { buildScoreMatrix, priceBtts, priceOverUnder, priceResult, type ScoreMatrix } from './price.ts';

/** De-vigged probabilities the fit is aimed at, by market key. */
export interface ImpliedTargets {
  /** HOME / DRAW / AWAY. */
  result?: { HOME: number; DRAW: number; AWAY: number } | null;
  /** P(over) at each goal line, e.g. { 2.5: 0.54 }. */
  over?: Record<string, number>;
  /** P(both teams score). */
  btts?: number | null;
}

export interface ImpliedRates {
  home: number;
  away: number;
  /** Mean squared miss against the targets; a large one means the prices disagree with each other. */
  loss: number;
  /** How many prices the fit had to go on. */
  targets: number;
}

const RHO = config.ratings.rho;

function lossAt(lh: number, la: number, t: ImpliedTargets): { loss: number; n: number } {
  const m = buildScoreMatrix(lh, la, RHO, 1);
  let loss = 0;
  let n = 0;
  if (t.result) {
    const r = priceResult(m);
    // The result is the best-traded market there is, so it counts double.
    for (const o of ['HOME', 'DRAW', 'AWAY'] as const) {
      const d = (r.get(o) ?? 0) - t.result[o];
      loss += 2 * d * d;
      n += 2;
    }
  }
  for (const [line, p] of Object.entries(t.over ?? {})) {
    const q = priceOverUnder(m, Number(line)).get('over') ?? 0;
    loss += (q - p) ** 2;
    n++;
  }
  if (typeof t.btts === 'number') {
    const q = priceBtts(m).get('yes') ?? 0;
    loss += (q - t.btts) ** 2;
    n++;
  }
  return { loss: n ? loss / n : Infinity, n };
}

/**
 * Nelder-Mead over log-rates. Two parameters and a smooth surface, so it
 * converges in a few dozen evaluations from any sensible start.
 */
export function impliedRates(t: ImpliedTargets, start: { home: number; away: number } = { home: 1.4, away: 1.1 }): ImpliedRates | null {
  const has = (t.result ? 1 : 0) + Object.keys(t.over ?? {}).length + (typeof t.btts === 'number' ? 1 : 0);
  // One market alone cannot pin two rates down: the result fixes the
  // difference, a goal line the total. Ask for both kinds.
  if (!t.result || has < 2) return null;
  const f = (x: number[]) => lossAt(Math.exp(x[0]!), Math.exp(x[1]!), t).loss;
  let simplex: number[][] = [
    [Math.log(Math.max(0.2, start.home)), Math.log(Math.max(0.2, start.away))],
    [Math.log(Math.max(0.2, start.home)) + 0.25, Math.log(Math.max(0.2, start.away))],
    [Math.log(Math.max(0.2, start.home)), Math.log(Math.max(0.2, start.away)) + 0.25],
  ];
  let vals = simplex.map(f);
  for (let it = 0; it < 120; it++) {
    const order = [0, 1, 2].sort((a, b) => vals[a]! - vals[b]!);
    simplex = order.map((i) => simplex[i]!);
    vals = order.map((i) => vals[i]!);
    if (Math.abs(vals[2]! - vals[0]!) < 1e-10) break;
    const c = [(simplex[0]![0]! + simplex[1]![0]!) / 2, (simplex[0]![1]! + simplex[1]![1]!) / 2];
    const w = simplex[2]!;
    const refl = [c[0]! + (c[0]! - w[0]!), c[1]! + (c[1]! - w[1]!)];
    const fr = f(refl);
    if (fr < vals[0]!) {
      const exp = [c[0]! + 2 * (c[0]! - w[0]!), c[1]! + 2 * (c[1]! - w[1]!)];
      const fe = f(exp);
      simplex[2] = fe < fr ? exp : refl;
      vals[2] = Math.min(fe, fr);
    } else if (fr < vals[1]!) {
      simplex[2] = refl;
      vals[2] = fr;
    } else {
      const con = [c[0]! + 0.5 * (w[0]! - c[0]!), c[1]! + 0.5 * (w[1]! - c[1]!)];
      const fc = f(con);
      if (fc < vals[2]!) {
        simplex[2] = con;
        vals[2] = fc;
      } else {
        const b = simplex[0]!;
        simplex = simplex.map((p) => [b[0]! + 0.5 * (p[0]! - b[0]!), b[1]! + 0.5 * (p[1]! - b[1]!)]);
        vals = simplex.map(f);
      }
    }
  }
  const best = vals.indexOf(Math.min(...vals));
  const [lh, la] = simplex[best]!;
  const home = Math.exp(lh!);
  const away = Math.exp(la!);
  if (!Number.isFinite(home) || !Number.isFinite(away) || home > 8 || away > 8) return null;
  return { home, away, loss: vals[best]!, targets: has };
}

/**
 * The rates the card is priced on: the market's, pulled toward the model's by
 * `modelWeight` in log space (a geometric blend, so a side the market puts at
 * 2.0 and we put at 1.0 lands at 1.41 with weight 0.5, not 1.5).
 */
export function blendRates(
  market: { home: number; away: number },
  model: { home: number; away: number } | null,
  modelWeight: number,
): { home: number; away: number } {
  if (!model || !(modelWeight > 0)) return { home: market.home, away: market.away };
  const w = Math.min(1, Math.max(0, modelWeight));
  const g = (a: number, b: number) => Math.exp((1 - w) * Math.log(a) + w * Math.log(Math.max(0.05, b)));
  return { home: g(market.home, model.home), away: g(market.away, model.away) };
}

export function matrixFor(rates: { home: number; away: number }): ScoreMatrix {
  return buildScoreMatrix(rates.home, rates.away, RHO, 1);
}
