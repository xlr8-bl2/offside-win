import { config } from './config.ts';
import { tau } from './ratings/dixoncoles.ts';
import type { MarketCode, ModelMarket, Outcome, PushRule } from './types.ts';

/**
 * Turning rates into prices.
 *
 * Every goals-derived market comes off one score matrix. That is the point:
 * 1X2, both-teams-to-score, over 2.5 and an Asian line are not four opinions,
 * they are four readings of the same distribution, and pricing them separately
 * is how a model ends up quoting a 1X2 that contradicts its own over/under.
 *
 * Corners and cards get their own distributions, because they are not goals and
 * do not behave like them.
 */

export interface ScoreMatrix {
  /** p[h][a] = probability of exactly h home goals and a away goals. */
  p: number[][];
  max: number;
  lambdaHome: number;
  lambdaAway: number;
  rho: number;
}

/**
 * Goal counts for one team.
 *
 * Poisson at dispersion 1, negative binomial above it. Which one this is
 * matters most at the outer lines: Poisson puts too little mass on 0 and on 4+,
 * so "under 3.5" and "over 1.5" come out more certain than they are.
 */
function goalPmf(lambda: number, max: number, dispersion: number): number[] {
  return negBinomPmf(lambda, dispersion, max);
}

export function buildScoreMatrix(
  lambdaHome: number,
  lambdaAway: number,
  rho: number,
  dispersion: number = config.pricing.goalDispersion,
): ScoreMatrix {
  const max = config.pricing.maxGoals;
  const ph = goalPmf(lambdaHome, max, dispersion);
  const pa = goalPmf(lambdaAway, max, dispersion);

  const p: number[][] = [];
  let total = 0;
  for (let h = 0; h <= max; h++) {
    const row = new Array<number>(max + 1);
    for (let a = 0; a <= max; a++) {
      // tau only touches the four low cells; everywhere else this is 1.
      const v = ph[h]! * pa[a]! * tau(h, a, lambdaHome, lambdaAway, rho);
      // A badly-chosen rho can drive a cell negative. Clamp rather than emit a
      // negative probability, which would poison every market downstream.
      row[a] = v > 0 ? v : 0;
      total += row[a]!;
    }
    p.push(row);
  }

  // Renormalise: the tau correction does not preserve total mass exactly, and
  // truncating at `max` goals loses a sliver more.
  if (total > 0) {
    for (let h = 0; h <= max; h++) {
      for (let a = 0; a <= max; a++) p[h]![a]! /= total;
    }
  }

  return { p, max, lambdaHome, lambdaAway, rho };
}

/** Sum the matrix over every scoreline satisfying a predicate. */
export function sumWhere(m: ScoreMatrix, pred: (h: number, a: number) => boolean): number {
  let s = 0;
  for (let h = 0; h <= m.max; h++) {
    for (let a = 0; a <= m.max; a++) {
      if (pred(h, a)) s += m.p[h]![a]!;
    }
  }
  return s;
}

// ------------------------------------------------------------ goals markets

export function priceResult(m: ScoreMatrix): Map<Outcome, number> {
  const home = sumWhere(m, (h, a) => h > a);
  const draw = sumWhere(m, (h, a) => h === a);
  const away = sumWhere(m, (h, a) => h < a);
  return new Map<Outcome, number>([
    ['HOME', home],
    ['DRAW', draw],
    ['AWAY', away],
  ]);
}

export function priceDoubleChance(m: ScoreMatrix): Map<Outcome, number> {
  const r = priceResult(m);
  return new Map<Outcome, number>([
    ['1X', r.get('HOME')! + r.get('DRAW')!],
    ['12', r.get('HOME')! + r.get('AWAY')!],
    ['X2', r.get('DRAW')! + r.get('AWAY')!],
  ]);
}

/** Draw-no-bet: the draw refunds, so renormalise over the resolving outcomes. */
export function priceDrawNoBet(m: ScoreMatrix): Map<Outcome, number> {
  const r = priceResult(m);
  const resolving = r.get('HOME')! + r.get('AWAY')!;
  if (resolving <= 0) return new Map<Outcome, number>([['HOME', 0.5], ['AWAY', 0.5]]);
  return new Map<Outcome, number>([
    ['HOME', r.get('HOME')! / resolving],
    ['AWAY', r.get('AWAY')! / resolving],
  ]);
}

export function priceBtts(m: ScoreMatrix): Map<Outcome, number> {
  const yes = sumWhere(m, (h, a) => h >= 1 && a >= 1);
  return new Map<Outcome, number>([
    ['yes', yes],
    ['no', 1 - yes],
  ]);
}

export function priceOverUnder(m: ScoreMatrix, line: number): Map<Outcome, number> {
  const over = sumWhere(m, (h, a) => h + a > line);
  return new Map<Outcome, number>([
    ['over', over],
    ['under', 1 - over],
  ]);
}

/**
 * European handicap: a whole-goal head start that cannot push, because the
 * line shifts the scoreline and a draw remains a distinct outcome.
 * The line is home-relative, so −1 means the home team starts a goal down.
 */
export function priceEuropeanHandicap(m: ScoreMatrix, line: number): Map<Outcome, number> {
  const home = sumWhere(m, (h, a) => h + line > a);
  const draw = sumWhere(m, (h, a) => h + line === a);
  const away = sumWhere(m, (h, a) => h + line < a);
  return new Map<Outcome, number>([
    ['HOME', home],
    ['DRAW', draw],
    ['AWAY', away],
  ]);
}

export interface AsianResult {
  /** Break-even probability: wins / (wins + losses), the price that makes EV zero. */
  effective: Map<Outcome, number>;
  /** Stake returned, so the size of the bet that is really at risk is visible. */
  push: Map<Outcome, number>;
}

/**
 * Asian handicap, including quarter lines.
 *
 * The push is the whole difficulty. A whole line refunds on the exact margin; a
 * quarter line splits the stake across the two adjacent lines, so an outcome can
 * be a half-win or a half-loss. A model that ignores this and prices an Asian
 * line as a straight two-way market will misprice every quarter line it sees.
 *
 * The returned probability is the conditional win probability given the bet
 * resolves — `p_win / (p_win + p_loss)`. That is exactly the number whose
 * reciprocal is the break-even price, which makes it directly comparable to a
 * de-vigged book quote, and it handles quarter lines correctly because the
 * half-stake legs average into the same ratio.
 */
export function priceAsianHandicap(m: ScoreMatrix, line: number): AsianResult {
  // A quarter line is half a stake on each neighbour; anything else is itself.
  const legs = isQuarterLine(line) ? [line - 0.25, line + 0.25] : [line];

  const acc: Record<'HOME' | 'AWAY', { win: number; lose: number; push: number }> = {
    HOME: { win: 0, lose: 0, push: 0 },
    AWAY: { win: 0, lose: 0, push: 0 },
  };

  for (const leg of legs) {
    const share = 1 / legs.length;
    for (let h = 0; h <= m.max; h++) {
      for (let a = 0; a <= m.max; a++) {
        const prob = m.p[h]![a]! * share;
        const margin = h + leg - a;
        if (margin > 0) {
          acc.HOME.win += prob;
          acc.AWAY.lose += prob;
        } else if (margin < 0) {
          acc.HOME.lose += prob;
          acc.AWAY.win += prob;
        } else {
          acc.HOME.push += prob;
          acc.AWAY.push += prob;
        }
      }
    }
  }

  const effective = new Map<Outcome, number>();
  const push = new Map<Outcome, number>();
  for (const side of ['HOME', 'AWAY'] as const) {
    const { win, lose, push: pu } = acc[side];
    const resolving = win + lose;
    effective.set(side, resolving > 0 ? win / resolving : 0.5);
    push.set(side, pu);
  }
  return { effective, push };
}

export function isQuarterLine(line: number): boolean {
  const frac = Math.abs(line % 1);
  return Math.abs(frac - 0.25) < 1e-9 || Math.abs(frac - 0.75) < 1e-9;
}

export function pushRuleFor(line: number): PushRule {
  if (isQuarterLine(line)) return 'half';
  return Number.isInteger(line) ? 'full' : 'none';
}

// --------------------------------------------------------- corners and cards

/**
 * Negative binomial pmf, parameterised by mean and dispersion, where dispersion
 * is the variance-to-mean ratio. Corners cluster — one scramble produces three —
 * so their variance runs well above their mean and a Poisson would price the
 * tails too thin, which is exactly where the over/under lines sit.
 */
export function negBinomPmf(mean: number, dispersion: number, max: number): number[] {
  const out = new Array<number>(max + 1).fill(0);
  if (mean <= 0) {
    out[0] = 1;
    return out;
  }
  // Dispersion at or below 1 is Poisson; there is no negative binomial there.
  if (dispersion <= 1.0001) {
    let term = Math.exp(-mean);
    out[0] = term;
    for (let k = 1; k <= max; k++) {
      term = (term * mean) / k;
      out[k] = term;
    }
    return out;
  }

  const r = mean / (dispersion - 1);
  const p = r / (r + mean);

  // P(0) = p^r, then the standard recurrence P(k) = P(k-1)·(k+r-1)/k·(1-p).
  let term = Math.pow(p, r);
  out[0] = term;
  for (let k = 1; k <= max; k++) {
    term = (term * (k + r - 1) * (1 - p)) / k;
    out[k] = term;
  }
  const total = out.reduce((a, b) => a + b, 0);
  return total > 0 ? out.map((v) => v / total) : out;
}

export function priceTotalCorners(
  meanTotal: number,
  dispersion: number,
  line: number,
): Map<Outcome, number> {
  const pmf = negBinomPmf(meanTotal, dispersion, config.pricing.maxCorners);
  let over = 0;
  for (let k = 0; k < pmf.length; k++) if (k > line) over += pmf[k]!;
  return new Map<Outcome, number>([
    ['over', over],
    ['under', 1 - over],
  ]);
}

/** Which side wins the corner count. Sides modelled independently. */
export function priceCornersResult(
  meanHome: number,
  meanAway: number,
  dispersion: number,
): Map<Outcome, number> {
  const max = config.pricing.maxCorners;
  const ph = negBinomPmf(meanHome, dispersion, max);
  const pa = negBinomPmf(meanAway, dispersion, max);
  let home = 0;
  let draw = 0;
  let away = 0;
  for (let h = 0; h <= max; h++) {
    for (let a = 0; a <= max; a++) {
      const pr = ph[h]! * pa[a]!;
      if (h > a) home += pr;
      else if (h === a) draw += pr;
      else away += pr;
    }
  }
  return new Map<Outcome, number>([
    ['HOME', home],
    ['DRAW', draw],
    ['AWAY', away],
  ]);
}

/** Red cards: rare enough that Poisson is the right call and the sample is the risk. */
export function priceTotalReds(meanReds: number, line: number): Map<Outcome, number> {
  const pmf = negBinomPmf(meanReds, 1, config.pricing.maxCards);
  let over = 0;
  for (let k = 0; k < pmf.length; k++) if (k > line) over += pmf[k]!;
  return new Map<Outcome, number>([
    ['over', over],
    ['under', 1 - over],
  ]);
}

export function priceRedCard(meanReds: number): Map<Outcome, number> {
  const yes = 1 - Math.exp(-meanReds);
  return new Map<Outcome, number>([
    ['yes', yes],
    ['no', 1 - yes],
  ]);
}

// ------------------------------------------------------------- full board

export interface PricingInputs {
  lambdaHome: number;
  lambdaAway: number;
  rho: number;
  cornersHome: number;
  cornersAway: number;
  cornersDispersion: number;
  reds: number;
  /** Lines the book is actually offering, so we price what can be bet. */
  cornerLines: number[];
  redLines: number[];
  handicapLines: { european: number[]; asian: number[] };
  confidence: number;
}

/**
 * Price every market the provider carries. Only markets the book is quoting get
 * a line-specific price — pricing a corner line nobody offers is arithmetic with
 * no purpose.
 */
export function priceAll(inp: PricingInputs): ModelMarket[] {
  const m = buildScoreMatrix(inp.lambdaHome, inp.lambdaAway, inp.rho);
  const out: ModelMarket[] = [];
  const add = (market: MarketCode, probs: Map<Outcome, number>, line: number | null = null) =>
    out.push({ market, line, probs, confidence: inp.confidence });

  add('1x2', priceResult(m));
  add('double_chance', priceDoubleChance(m));
  add('draw_no_bet', priceDrawNoBet(m));
  add('btts', priceBtts(m));
  add('over_under_05', priceOverUnder(m, 0.5), 0.5);
  add('over_under_15', priceOverUnder(m, 1.5), 1.5);
  add('over_under_25', priceOverUnder(m, 2.5), 2.5);
  add('over_under_35', priceOverUnder(m, 3.5), 3.5);

  for (const line of inp.handicapLines.european) {
    add('european_handicap', priceEuropeanHandicap(m, line), line);
  }
  for (const line of inp.handicapLines.asian) {
    add('asian_handicap', priceAsianHandicap(m, line).effective, line);
  }

  const cornersTotal = inp.cornersHome + inp.cornersAway;
  for (const line of inp.cornerLines) {
    add('total_corners', priceTotalCorners(cornersTotal, inp.cornersDispersion, line), line);
  }
  // Corners are noisier than goals and our corner model is thinner, so this
  // market carries a visibly lower confidence into selection.
  out.push({
    market: 'corners_1x2',
    line: null,
    probs: priceCornersResult(inp.cornersHome, inp.cornersAway, inp.cornersDispersion),
    confidence: inp.confidence * 0.8,
  });

  for (const line of inp.redLines) {
    out.push({
      market: 'total_red_cards',
      line,
      probs: priceTotalReds(inp.reds, line),
      confidence: inp.confidence * 0.7,
    });
  }
  out.push({
    market: 'red_card',
    line: null,
    probs: priceRedCard(inp.reds),
    confidence: inp.confidence * 0.7,
  });

  return out;
}
