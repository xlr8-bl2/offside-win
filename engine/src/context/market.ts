import { asArray, asRecord, num, pickNum, str } from '../bsd.ts';
import { clamp, computed, thin, unavailable } from '../ledger.ts';
import { buildBookMarkets, findBookMarket } from '../odds.ts';
import type { Claim, Factor, Outcome } from '../types.ts';
import type { FixtureContext } from './types.ts';

/**
 * §7 — the market.
 *
 * Note what these factors deliberately do *not* do: they never adjust λ. §12
 * places market signals last and calls them the final check, and there is a
 * hard reason to respect that. If the price fed back into our rates, the model
 * would converge on the bookmaker's number and the product would become an
 * expensive way to reprint the odds. The whole value is in having an
 * independent opinion and then being honest about what it means when the market
 * disagrees.
 *
 * So these emit evidence, claims and a disagreement signal that selection reads
 * as a confidence penalty. §13's formulation is the one being implemented: if
 * our read and the line movement conflict, we have either found something the
 * market missed or missed something the market found, and the analysis should
 * make an explicit call on which.
 */

/** How far apart a prediction market and a bookmaker must be to be interesting. */
const POLYMARKET_DIVERGENCE = 0.05;

export function marketFactors(ctx: FixtureContext): Factor[] {
  return [
    overroundFactor(ctx),
    movementFactor(ctx),
    sharpReferenceFactor(ctx),
    polymarketFactor(ctx),
  ];
}

/** §7.3 — how much margin sits in the price, which sets how big an edge must be. */
function overroundFactor(ctx: FixtureContext): Factor {
  const main = findBookMarket(ctx.book, '1x2', null);
  if (!main) {
    return unavailable({
      id: 'market.overround',
      section: '§7.3',
      tier: 7,
      note: 'No priced match-odds market for this fixture yet.',
    });
  }

  const margin = main.overround - 1;
  return computed({
    id: 'market.overround',
    section: '§7.3',
    tier: 7,
    note:
      `The bookmakers are taking a ${(margin * 100).toFixed(1)}% cut on this match. ` +
      `The bigger their cut, the further out a price has to be before it is worth backing.`,
    evidence: {
      overround: Number(main.overround.toFixed(4)),
      margin_pct: Number((margin * 100).toFixed(2)),
      devig_method: main.method,
      books_quoting: main.best.size,
    },
    strength: 0.2,
  });
}

/**
 * §7.1 — line movement. The provider carries the opening price and a movement
 * direction per quote, so this is read rather than reconstructed from snapshots.
 */
function movementFactor(ctx: FixtureContext): Factor {
  const main = findBookMarket(ctx.book, '1x2', null);
  if (!main || main.movement.size === 0) {
    return thin({
      id: 'market.movement',
      section: '§7.1',
      tier: 7,
      note: 'No opening price on record for this market, so movement cannot be read.',
    });
  }

  const moves: Array<{ outcome: Outcome; pct: number; dir: string | null }> = [];
  for (const [outcome, mv] of main.movement) {
    if (!mv.opening || !mv.current) continue;
    // Movement in implied-probability terms, which is what actually matters —
    // 1.50 to 1.45 is a bigger move than 8.00 to 7.50 despite the smaller step.
    const pct = (1 / mv.current - 1 / mv.opening) / (1 / mv.opening);
    moves.push({ outcome, pct, dir: mv.dir });
  }

  if (moves.length === 0) {
    return thin({
      id: 'market.movement',
      section: '§7.1',
      tier: 7,
      note: 'Opening prices are present but unusable.',
    });
  }

  moves.sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct));
  const biggest = moves[0]!;
  const claims: Claim[] = [];

  // Below a couple of percent is noise, not a signal.
  if (Math.abs(biggest.pct) >= 0.04) {
    claims.push({
      subject: 'the market',
      predicate: 'market_move',
      polarity: biggest.pct > 0 ? 1 : -1,
      magnitude: clamp(Math.abs(biggest.pct) / 0.2, 0.2, 1),
      evidence: {
        outcome: biggest.outcome,
        move_pct: Number((biggest.pct * 100).toFixed(1)),
        direction: biggest.dir ?? (biggest.pct > 0 ? 'SHORTENING' : 'DRIFTING'),
      },
      section: '§7.1',
      tier: 7,
    });
  }

  return computed({
    id: 'market.movement',
    section: '§7.1',
    tier: 7,
    note:
      Math.abs(biggest.pct) >= 0.04
        ? `Since opening, ${biggest.outcome} has ${biggest.pct > 0 ? 'shortened' : 'drifted'} ` +
          `${Math.abs(biggest.pct * 100).toFixed(1)}% since the market opened.`
        : 'The line has barely moved since it opened.',
    evidence: {
      moves: moves.map((m) => ({
        outcome: m.outcome,
        move_pct: Number((m.pct * 100).toFixed(1)),
        direction: m.dir,
      })),
    },
    claims,
    strength: clamp(Math.abs(biggest.pct) / 0.2, 0, 0.6),
  });
}

/**
 * §7.1's Pinnacle reference. Pinnacle runs high limits on thin margins; when it
 * and a soft book disagree, the doctrine's position is that Pinnacle is almost
 * certainly right. That divergence is itself the signal.
 */
function sharpReferenceFactor(ctx: FixtureContext): Factor {
  const pinnacleQuotes = ctx.quotes.filter((q) => q.bookmaker_slug === 'pinnacle');

  if (pinnacleQuotes.length === 0) {
    return unavailable({
      id: 'market.sharp_reference',
      section: '§7.1',
      tier: 7,
      note: ctx.comparisonEntitled
        ? 'The sharp reference book is not quoting this fixture.'
        : 'Per-bookmaker prices are not available on the current data tier, so the sharp reference ' +
          'cannot be compared against the consensus.',
      evidence: { entitled: ctx.comparisonEntitled },
    });
  }

  const consensus = findBookMarket(ctx.book, '1x2', null);
  // Rebuild the market from the sharp book's quotes alone, so its own de-vigged
  // opinion can be set against the consensus it is part of.
  const sharp = findBookMarket(buildBookMarkets(pinnacleQuotes), '1x2', null);

  if (!consensus || !sharp) {
    return thin({
      id: 'market.sharp_reference',
      section: '§7.1',
      tier: 7,
      note: 'The sharp book is not quoting a complete match-odds market.',
    });
  }

  let maxGap = 0;
  let gapOutcome: Outcome = 'HOME';
  for (const [outcome, p] of sharp.fair) {
    const c = consensus.fair.get(outcome);
    if (c === undefined) continue;
    const gap = p - c;
    if (Math.abs(gap) > Math.abs(maxGap)) {
      maxGap = gap;
      gapOutcome = outcome;
    }
  }

  return computed({
    id: 'market.sharp_reference',
    section: '§7.1',
    tier: 7,
    note:
      Math.abs(maxGap) >= 0.02
        ? `The sharp book makes ${gapOutcome} ${(Math.abs(maxGap) * 100).toFixed(1)} points ` +
          `${maxGap > 0 ? 'more' : 'less'} likely than the wider market does.`
        : 'The sharp book and the wider market agree on this fixture.',
    evidence: {
      sharp: Object.fromEntries([...sharp.fair].map(([k, v]) => [k, Number(v.toFixed(4))])),
      consensus: Object.fromEntries([...consensus.fair].map(([k, v]) => [k, Number(v.toFixed(4))])),
      largest_gap: { outcome: gapOutcome, points: Number((maxGap * 100).toFixed(2)) },
      sharp_overround: Number(sharp.overround.toFixed(4)),
    },
    claims:
      Math.abs(maxGap) >= 0.03
        ? [
            {
              subject: 'the sharp market',
              predicate: 'market_sharp',
              polarity: maxGap > 0 ? 1 : -1,
              magnitude: clamp(Math.abs(maxGap) / 0.08, 0.2, 1),
              evidence: {
                outcome: gapOutcome,
                gap_points: Number((Math.abs(maxGap) * 100).toFixed(1)),
              },
              section: '§7.1',
              tier: 7,
            },
          ]
        : [],
    strength: clamp(Math.abs(maxGap) / 0.08, 0, 0.7),
  });
}

/** Pull outcome probabilities out of whatever shape the prediction market ships. */
export function parsePolymarket(raw: unknown): Map<Outcome, number> | null {
  const rec = asRecord(raw);
  if (!rec) return null;

  const out = new Map<Outcome, number>();
  const direct: Array<[string, Outcome]> = [
    ['home', 'HOME'], ['draw', 'DRAW'], ['away', 'AWAY'],
    ['home_price', 'HOME'], ['draw_price', 'DRAW'], ['away_price', 'AWAY'],
  ];
  for (const [key, outcome] of direct) {
    const v = num(rec[key]) ?? pickNum(rec, `${key}.price`, `${key}.probability`);
    if (v !== undefined && v > 0 && v < 1) out.set(outcome, v);
  }
  if (out.size >= 2) return out;

  // Or a list of {outcome, price} rows.
  const list = asArray(rec['markets'] ?? rec['outcomes'] ?? rec['results'] ?? raw);
  if (list) {
    for (const r of list) {
      const row = asRecord(r);
      const label = (str(row?.['outcome'] ?? row?.['name'] ?? row?.['question']) ?? '').toLowerCase();
      const price = num(row?.['price'] ?? row?.['probability'] ?? row?.['implied_probability']);
      if (price === undefined || price <= 0 || price >= 1) continue;
      if (label.includes('draw') || label.includes('tie')) out.set('DRAW', price);
      else if (label.includes('home')) out.set('HOME', price);
      else if (label.includes('away')) out.set('AWAY', price);
    }
  }
  return out.size >= 2 ? out : null;
}

/**
 * §7.2 — prediction markets. Participants have capital at risk and process news
 * independently, so they often reprice breaking news faster than a book does.
 * The doctrine's threshold for "one of them has mispriced something" is five
 * percentage points, and that is the number used.
 */
function polymarketFactor(ctx: FixtureContext): Factor {
  const poly = parsePolymarket(ctx.polymarket);
  const book = findBookMarket(ctx.book, '1x2', null);

  if (!poly) {
    return unavailable({
      id: 'market.prediction_market',
      section: '§7.2',
      tier: 7,
      note: 'No prediction-market prices for this fixture.',
    });
  }
  if (!book) {
    return thin({
      id: 'market.prediction_market',
      section: '§7.2',
      tier: 7,
      note: 'Prediction-market prices exist but there is no bookmaker market to compare them against.',
    });
  }

  // Prediction-market prices carry their own small overround; normalise so the
  // comparison is like for like.
  const total = [...poly.values()].reduce((a, b) => a + b, 0);
  const normalised = new Map<Outcome, number>();
  for (const [k, v] of poly) normalised.set(k, v / total);

  let maxGap = 0;
  let gapOutcome: Outcome = 'HOME';
  for (const [outcome, p] of normalised) {
    const b = book.fair.get(outcome);
    if (b === undefined) continue;
    const gap = p - b;
    if (Math.abs(gap) > Math.abs(maxGap)) {
      maxGap = gap;
      gapOutcome = outcome;
    }
  }

  const diverges = Math.abs(maxGap) >= POLYMARKET_DIVERGENCE;

  return computed({
    id: 'market.prediction_market',
    section: '§7.2',
    tier: 7,
    note: diverges
      ? `The prediction market makes ${gapOutcome} ${(Math.abs(maxGap) * 100).toFixed(1)} points ` +
        `${maxGap > 0 ? 'more' : 'less'} likely than the bookmakers do — past the five-point mark ` +
        `where one of them is wrong.`
      : 'The prediction market and the bookmakers agree within the noise.',
    evidence: {
      prediction_market: Object.fromEntries([...normalised].map(([k, v]) => [k, Number(v.toFixed(4))])),
      bookmaker: Object.fromEntries([...book.fair].map(([k, v]) => [k, Number(v.toFixed(4))])),
      largest_gap: { outcome: gapOutcome, points: Number((maxGap * 100).toFixed(2)) },
      threshold_points: POLYMARKET_DIVERGENCE * 100,
    },
    claims: diverges
      ? [
          {
            subject: 'the prediction market',
            predicate: 'market_crowd',
            polarity: maxGap > 0 ? 1 : -1,
            magnitude: clamp(Math.abs(maxGap) / 0.12, 0.2, 1),
            evidence: {
              outcome: gapOutcome,
              gap_points: Number((Math.abs(maxGap) * 100).toFixed(1)),
            },
            section: '§7.2',
            tier: 7,
          },
        ]
      : [],
    strength: clamp(Math.abs(maxGap) / 0.12, 0, 0.7),
  });
}

export const _internals = { POLYMARKET_DIVERGENCE, parsePolymarket };
