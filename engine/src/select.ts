import { config } from './config.ts';
import { expectedValue, kelly } from './devig.ts';
import { findConflicts, topTierCoverage } from './ledger.ts';
import { findBookMarket } from './odds.ts';
import { pushRuleFor } from './price.ts';
import { MARKET_FAMILY } from './types.ts';
import type {
  BookMarket, Candidate, Factor, MarketFamily, ModelMarket, Outcome, PickKind,
} from './types.ts';

/**
 * Choosing what to say, and when to say nothing.
 *
 * Ranking naively by edge is how these products go wrong. The biggest apparent
 * edges cluster in the markets the model understands least — corners and cards,
 * where the sample is thin and the distribution is a rougher approximation — so
 * a pure edge sort quietly becomes a corners-and-cards tipping service. The fix
 * is not to exclude those markets but to discount their edges by how wrong the
 * model has actually been on them, which is what the calibration table records.
 *
 * Two rankings are produced because the user asked for the most likely market
 * across the book, and "most likely" and "best priced" are different questions:
 *
 * - VALUE: the biggest mispricing, after shrinkage. Where the money is.
 * - LIKELY: the highest-probability outcome that is *not* badly priced. Not the
 *   highest probability outright, which would be "over 0.5 goals" every single
 *   time at odds nobody would take.
 *
 * And if nothing clears the gates, the answer is a pass. §13 is explicit that a
 * pass is the analysis working, not failing, and that a correctly priced market
 * should produce one.
 */

export interface CalibrationRow {
  market_family: MarketFamily;
  n: number;
  shrink: number;
}

export type CalibrationMap = Map<MarketFamily, CalibrationRow>;

export function shrinkFor(family: MarketFamily, calibration: CalibrationMap): number {
  const row = calibration.get(family);
  const prior = config.selection.priorShrink[family];
  if (!row || row.n < 30) return prior;
  // Blend the measured shrink toward the prior until there is real history
  // behind it; thirty settled picks is not yet a calibration curve.
  const w = Math.min(1, row.n / 200);
  return prior * (1 - w) + row.shrink * w;
}

export interface SelectionResult {
  candidates: Candidate[];
  picks: Array<{ kind: PickKind; candidate: Candidate }>;
  passReason: string | null;
}

export function buildCandidates(
  model: ModelMarket[],
  book: BookMarket[],
  calibration: CalibrationMap,
): Candidate[] {
  const out: Candidate[] = [];

  for (const mm of model) {
    const bm = findBookMarket(book, mm.market, mm.line);
    if (!bm) continue; // not offered — nothing to bet into

    const family = MARKET_FAMILY[mm.market];
    const shrink = shrinkFor(family, calibration);

    for (const [outcome, modelProb] of mm.probs) {
      const bookProb = bm.fair.get(outcome as Outcome);
      const bestQuote = bm.best.get(outcome as Outcome);
      if (bookProb === undefined || !bestQuote) continue;
      if (!Number.isFinite(modelProb) || modelProb <= 0 || modelProb >= 1) continue;

      const edge = modelProb - bookProb;
      out.push({
        market: mm.market,
        outcome: outcome as Outcome,
        line: mm.line,
        push: mm.line !== null && (mm.market === 'asian_handicap') ? pushRuleFor(mm.line) : null,
        model_prob: modelProb,
        book_prob: bookProb,
        edge,
        shrunk_edge: edge * shrink,
        odds: bestQuote.odds,
        bookmaker: bestQuote.bookmaker,
        kelly: kelly(modelProb, bestQuote.odds, config.selection.kellyFraction),
        confidence: mm.confidence,
        family,
      });
    }
  }

  return out;
}

export interface GateContext {
  factors: Factor[];
  confidence: number;
  /** Overround of the market a candidate sits in, keyed as market::line. */
  overroundOf: (c: Candidate) => number;
}

export interface GateFailure {
  reason: string;
}

/**
 * Gates a single candidate. Returns null when it passes.
 *
 * The edge bar scales with the market's own margin, which is §7.3's point made
 * operational: a market carrying a 10% overround needs us to be meaningfully
 * better than the book before the value is real, not marginally better.
 */
export function gateCandidate(c: Candidate, ctx: GateContext): GateFailure | null {
  if (c.odds < config.selection.minOdds) {
    return { reason: `price of ${c.odds.toFixed(2)} is too short to be worth the risk` };
  }
  if (c.odds > config.selection.maxOdds) {
    return { reason: `price of ${c.odds.toFixed(2)} is beyond where the model is reliable` };
  }
  if (c.confidence < config.selection.minConfidence) {
    return { reason: `model confidence of ${(c.confidence * 100).toFixed(0)}% is below the threshold` };
  }

  const margin = Math.max(0, ctx.overroundOf(c) - 1);
  const required = config.selection.baseEdge + margin / 2;
  if (c.shrunk_edge < required) {
    return {
      reason:
        `edge of ${(c.shrunk_edge * 100).toFixed(1)} points does not clear the ` +
        `${(required * 100).toFixed(1)} needed against a ${(margin * 100).toFixed(1)}% margin`,
    };
  }
  return null;
}

export function select(
  candidates: Candidate[],
  book: BookMarket[],
  factors: Factor[],
  confidence: number,
): SelectionResult {
  const overroundOf = (c: Candidate): number =>
    findBookMarket(book, c.market, c.line)?.overround ?? 1.08;

  const coverage = topTierCoverage(factors);
  if (coverage < config.selection.minTopTierFactors) {
    return {
      candidates,
      picks: [],
      passReason:
        `Only ${coverage} of the dispositive factors — availability, stakes and regime — could be ` +
        `computed for this fixture. That is not enough context to disagree with the price.`,
    };
  }

  // §8's tension rule. Two strongly-held factors of equal tier pulling opposite
  // ways is not something to average out; the doctrine says it requires
  // judgement, and absent judgement the honest answer is a pass.
  const conflicts = findConflicts(factors);
  if (conflicts.length > 0) {
    const c = conflicts[0]!;
    return {
      candidates,
      picks: [],
      passReason:
        `Two factors of equal weight pull against each other on ${c.channel}: ` +
        `${c.positive.note} Against that, ${lowerFirst(c.negative.note)} ` +
        `Netting those out would invent a confidence the evidence does not support.`,
    };
  }

  const ctx: GateContext = { factors, confidence, overroundOf };
  const passing = candidates.filter((c) => gateCandidate(c, ctx) === null);

  if (passing.length === 0) {
    // Report the nearest miss — far more useful than "nothing found", and it
    // shows the reader the gates are real rather than decorative.
    const best = [...candidates].sort((a, b) => b.shrunk_edge - a.shrunk_edge)[0];
    const why = best ? gateCandidate(best, ctx) : null;
    return {
      candidates,
      picks: [],
      passReason: best
        ? `Nothing is mispriced enough to call. The closest was ${describe(best)}, where the ${why?.reason}.`
        : 'No market is priced for this fixture yet.',
    };
  }

  const picks: SelectionResult['picks'] = [];

  // VALUE: the biggest mispricing once the model's own track record on that
  // market family has been taken off the top.
  const byValue = [...passing].sort(
    (a, b) => b.shrunk_edge - a.shrunk_edge || b.confidence - a.confidence,
  );
  picks.push({ kind: 'VALUE', candidate: byValue[0]! });

  // LIKELY: the highest-probability outcome that is not badly priced. Sorting
  // by probability alone would return "over 0.5 goals" on every fixture ever
  // played, at a price nobody would take.
  const likelyPool = passing.filter(
    (c) => c.edge >= 0 && c.odds >= config.selection.minOdds && expectedValue(c.model_prob, c.odds) > 0,
  );
  const byLikely = [...likelyPool].sort(
    (a, b) => b.model_prob - a.model_prob || b.shrunk_edge - a.shrunk_edge,
  );
  const likely = byLikely[0];
  if (
    likely &&
    !(likely.market === byValue[0]!.market &&
      likely.outcome === byValue[0]!.outcome &&
      likely.line === byValue[0]!.line)
  ) {
    picks.push({ kind: 'LIKELY', candidate: likely });
  }

  return { candidates, picks, passReason: null };
}

export function describe(c: Candidate): string {
  return `${marketLabel(c)} at ${c.odds.toFixed(2)}`;
}

export function marketLabel(c: Candidate): string {
  const line = c.line === null ? '' : ` ${formatLine(c.line)}`;
  switch (c.market) {
    case '1x2':
      return c.outcome === 'DRAW' ? 'the draw' : `${c.outcome === 'HOME' ? 'home' : 'away'} win`;
    case 'double_chance':
      return `double chance ${c.outcome}`;
    case 'draw_no_bet':
      return `${c.outcome === 'HOME' ? 'home' : 'away'} draw-no-bet`;
    case 'btts':
      return `both teams to score — ${c.outcome}`;
    case 'over_under_05':
    case 'over_under_15':
    case 'over_under_25':
    case 'over_under_35':
      return `${c.outcome} ${c.line ?? ''} goals`.trim();
    case 'total_corners':
      return `${c.outcome} ${c.line ?? ''} corners`.trim();
    case 'corners_1x2':
      return `most corners — ${c.outcome === 'DRAW' ? 'tie' : c.outcome === 'HOME' ? 'home' : 'away'}`;
    case 'total_red_cards':
      return `${c.outcome} ${c.line ?? ''} red cards`.trim();
    case 'red_card':
      return c.outcome === 'yes' ? 'a red card to be shown' : 'no red card';
    case 'european_handicap':
      return `${c.outcome === 'DRAW' ? 'draw' : c.outcome === 'HOME' ? 'home' : 'away'} on the${line} handicap`;
    case 'asian_handicap':
      return `${c.outcome === 'HOME' ? 'home' : 'away'}${line} on the Asian line`;
    default:
      return `${c.market} ${c.outcome}`;
  }
}

function formatLine(line: number): string {
  return line > 0 ? `+${line}` : String(line);
}

function lowerFirst(s: string): string {
  return s.length ? s[0]!.toLowerCase() + s.slice(1) : s;
}

/** Factors that actually moved the market a pick sits in, most dispositive first. */
export function driversFor(candidate: Candidate, factors: Factor[]): Factor[] {
  const channel =
    candidate.family === 'corners' ? 'corners' : candidate.family === 'cards' ? 'cards' : 'goals';
  return factors
    .filter(
      (f) =>
        f.state === 'COMPUTED' &&
        f.strength > 0.15 &&
        f.adjustments.some((a) => a.channel === channel && Math.abs(a.multiplier - 1) > 1e-4),
    )
    .sort((a, b) => a.tier - b.tier || b.strength - a.strength);
}

/**
 * §12's closing requirement: the reasoning explains which factors drove the call
 * and which were assessed and set aside. This is the second half of that.
 */
export function setAsideFor(candidate: Candidate, factors: Factor[], drivers: Factor[]): Factor[] {
  const driverIds = new Set(drivers.map((d) => d.id));
  return factors
    .filter((f) => !driverIds.has(f.id) && f.state === 'COMPUTED' && f.strength > 0.25)
    .sort((a, b) => a.tier - b.tier || b.strength - a.strength)
    .slice(0, 4);
}

// --------------------------------------------------------- confidence calls

/**
 * High-confidence calls, which are a different product from value bets.
 *
 * `select` above asks whether the market is wrong. This asks what is likely,
 * and takes no view on the price — because the probabilities it runs on are the
 * provider's, which measure 0.93 points from the de-vigged market, so by
 * construction there is no disagreement to find. A call here is "this is very
 * probably going to happen, and here is why", and the board labels it as such.
 *
 * Three rules keep it from degenerating into the thing every tips site does:
 *
 *  - A ceiling as well as a floor. "Over 0.5 goals" is 97% and pays 1.02.
 *    Publishing it is true, worthless, and indistinguishable from filler.
 *  - One call per market family. 1X and 12 are nearly the same bet on the same
 *    side; showing both is padding the count, not adding an opinion.
 *  - A hard cap per fixture, so a lopsided game cannot fill the board alone.
 */
export function selectConfident(candidates: Candidate[], floor = config.confident.floor): Candidate[] {
  const eligible = candidates
    .filter(
      (c) =>
        c.model_prob >= floor &&
        c.model_prob <= config.confident.ceiling &&
        c.odds >= config.confident.minOdds,
    )
    .sort((a, b) => b.model_prob - a.model_prob);

  const seen = new Set<MarketFamily>();
  const out: Candidate[] = [];
  for (const c of eligible) {
    const family = MARKET_FAMILY[c.market];
    if (seen.has(family)) continue;
    seen.add(family);
    out.push(c);
    if (out.length >= config.confident.perFixture) break;
  }
  return out;
}
