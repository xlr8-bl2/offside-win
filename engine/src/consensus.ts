/**
 * The probability a published call is chosen on.
 *
 * It used to be the data provider's. The market lab (lab/markets.ts) scored
 * every source against what happened on every market we price, and the
 * provider's was the least accurate on goals by a distance, while the
 * bookmakers' consensus was the most accurate almost everywhere. Almost: on the
 * goals markets, the consensus's own scoring rates pulled part of the way
 * toward our model's beat the consensus alone. So:
 *
 *   - goals (over/under, both teams to score): priced off one score matrix,
 *     whose rates are the market's (fitted back out of the result, goal-line
 *     and both-to-score prices) blended with our model's by `modelWeight`;
 *   - everything else (result, double chance, draw no bet, handicaps,
 *     corners, cards): the sharpest single book's de-vigged price where it
 *     priced the market (Pinnacle, else an exchange), the consensus where not.
 *     On 3,077 fixtures the sharp book was a shade more accurate than the
 *     consensus on results and goals, and measuring value against it rather
 *     than the consensus is what took the published calls from about 77% to
 *     about 81% landed (lab:tune).
 *
 * Every call is then an opinion the best available forecast agrees with,
 * rather than one that a price we can check says is wrong.
 */

import { config } from './config.ts';
import { blendRates, impliedRates, matrixFor, type ImpliedTargets } from './implied.ts';
import { priceBtts, priceOverUnder } from './price.ts';
import { MARKET_FAMILY, type BookMarket, type ModelMarket, type Outcome } from './types.ts';

/** What the consensus says the scoring rates are, from the prices on the card. */
export function targetsFromBook(book: BookMarket[]): ImpliedTargets {
  const t: ImpliedTargets = { over: {} };
  for (const m of book) {
    if (m.market === '1x2' && m.line === null) {
      const h = m.fair.get('HOME'), d = m.fair.get('DRAW'), a = m.fair.get('AWAY');
      if (h && d && a) t.result = { HOME: h, DRAW: d, AWAY: a };
    } else if (/^over_under_\d\d$/.test(m.market)) {
      const line = m.line ?? Number(m.market.slice(-2)) / 10;
      const p = m.fair.get('over');
      // The half-goal line is near-certain and says little about the rates.
      if (typeof p === 'number' && line >= 1.5) t.over![String(line)] = p;
    } else if (m.market === 'btts') {
      const p = m.fair.get('yes');
      if (typeof p === 'number') t.btts = p;
    }
  }
  return t;
}

export interface Consensus {
  markets: ModelMarket[];
  /** The blended scoring rates, when the card had enough prices to fit them. */
  rates: { home: number; away: number } | null;
}

/**
 * One probability per outcome on every market the card prices, from the
 * source the lab measured as sharpest for that family.
 */
export function consensusMarkets(
  book: BookMarket[],
  model: { home: number; away: number } | null,
  modelWeight = config.consensus.modelWeight,
): Consensus {
  const implied = impliedRates(targetsFromBook(book));
  const rates = implied ? blendRates(implied, model, modelWeight) : null;
  const mx = rates ? matrixFor(rates) : null;
  const markets: ModelMarket[] = [];
  for (const b of book) {
    const family = MARKET_FAMILY[b.market];
    let probs: Map<Outcome, number> | null = null;
    if (family === 'goals' && mx) {
      if (b.market === 'btts') probs = priceBtts(mx);
      else if (/^over_under_\d\d$/.test(b.market)) probs = priceOverUnder(mx, b.line ?? Number(b.market.slice(-2)) / 10);
    }
    probs ??= new Map(b.sharp?.fair ?? b.fair);
    if (probs.size) markets.push({ market: b.market, line: b.line, probs, confidence: 1 });
  }
  return { markets, rates };
}
