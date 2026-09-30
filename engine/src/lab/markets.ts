/**
 * The market lab: replay the calls we could have made, on the prices we
 * actually saw.
 *
 * Every fixture's bundle is frozen at kick-off with, for each market and line,
 * our model's probabilities, the de-vigged consensus, the best price on offer
 * and the margin. With the final score (and the corners and red cards from the
 * match report) that is a real price history, not a reconstructed one: the
 * numbers the engine had in front of it when it had to choose.
 *
 * The lab answers three questions, in this order, and the engine is changed
 * only on what they say:
 *
 *   1. Which probability is most accurate, market by market: the bookmakers'
 *      consensus, our model, the data provider's, or a blend? Scored by log
 *      loss on what happened.
 *   2. Which selection rule earns, across every market we price, when it is
 *      tuned on the older half of the history and scored on the newer half it
 *      never saw?
 *   3. How does that compare with the rule in production today?
 */

import { buildScoreMatrix, priceAsianHandicap, priceBtts, priceDoubleChance, priceDrawNoBet, priceEuropeanHandicap, priceOverUnder, priceResult, type ScoreMatrix } from '../price.ts';
import { blendRates, impliedRates, matrixFor, type ImpliedTargets } from '../implied.ts';
import { settleSelection } from '../settle.ts';
import { config } from '../config.ts';
import { parsePrediction, providerMarkets } from '../provider-model.ts';
import { MARKET_FAMILY, type MarketCode, type MarketFamily, type Outcome } from '../types.ts';

/* ------------------------------------------------------------------ data */

export interface Snap {
  market: MarketCode;
  line: number | null;
  model: Record<string, number>;
  book: Record<string, number>;
  best: Record<string, { odds: number; bookmaker?: string }>;
  overround: number;
  /** How many books quoted the full set, when recorded. */
  books?: number;
  /** The sharpest single book's de-vigged view, when recorded. */
  sharp?: { book: string; fair: Record<string, number> } | null;
  /** How the market opened, de-vigged, when recorded (odds.ts, `open`). */
  open?: { book: string; fair: Record<string, number> } | null;
}

export interface HistRow {
  id: number;
  league_id: number;
  rank: number;
  kickoff: number;
  score: [number, number];
  corners: [number, number] | null;
  reds: number | null;
  lambda: [number, number] | null;
  confidence: number;
  markets: Snap[];
  /** The data provider's probabilities, keyed market::line. */
  provider: Map<string, Map<Outcome, number>> | null;
  /**
   * The referee's record before this match (matches, reds and yellows shown),
   * counted from games before kick-off only, so the lab cannot see the result
   * it is scoring. Null when no referee is recorded.
   */
  ref?: { n: number; reds: number; yellows: number } | null;
  /**
   * Our own read of the match from the ratings alone, refitted as of the
   * week before it (lab/own.ts). Absent until the lab has computed it.
   */
  own?: { home: number; away: number; rho: number } | null;
}

export const keyOf = (market: string, line: number | null) => `${market}::${line === null ? 'x' : Number(line).toFixed(2)}`;

/**
 * Double chance is not a partition -- its three outcomes cover the result
 * twice over -- so de-vigging it as if the implied probabilities should sum to
 * one halved every one of them: 1X at 1.06 went down as 45% instead of 94%.
 * Draw-no-bet is the result with the draw taken out. Both are rebuilt from the
 * result market's own fair prices wherever it was quoted.
 */
export function fixBookFair(markets: Snap[]): Snap[] {
  const r = markets.find((m) => m.market === '1x2' && m.line === null)?.book;
  if (!r || !(r['HOME']! > 0) || !(r['DRAW']! > 0) || !(r['AWAY']! > 0)) return markets;
  const H = r['HOME']!, D = r['DRAW']!, A = r['AWAY']!;
  const sr = markets.find((m) => m.market === '1x2' && m.line === null)?.sharp?.fair;
  const sH = sr?.['HOME'], sD = sr?.['DRAW'], sA = sr?.['AWAY'];
  const sharpOk = sH !== undefined && sD !== undefined && sA !== undefined;
  const or = markets.find((m) => m.market === '1x2' && m.line === null)?.open?.fair;
  const oH = or?.['HOME'], oD = or?.['DRAW'], oA = or?.['AWAY'];
  const openOk = oH !== undefined && oD !== undefined && oA !== undefined;
  return markets.map((m) => {
    if (m.market === 'double_chance') return { ...m, book: { '1X': H + D, '12': H + A, 'X2': D + A }, sharp: sharpOk ? { book: 'sharp', fair: { '1X': sH + sD, '12': sH + sA, 'X2': sD + sA } } : null, open: openOk ? { book: 'open', fair: { '1X': oH + oD, '12': oH + oA, 'X2': oD + oA } } : null };
    if (m.market === 'draw_no_bet') return { ...m, book: { HOME: H / (H + A), AWAY: A / (H + A) }, sharp: sharpOk ? { book: 'sharp', fair: { HOME: sH / (sH + sA), AWAY: sA / (sH + sA) } } : null, open: openOk && oH + oA > 0 ? { book: 'open', fair: { HOME: oH / (oH + oA), AWAY: oA / (oH + oA) } } : null };
    return m;
  });
}

function providerMap(raw: unknown): Map<string, Map<Outcome, number>> | null {
  const p = parsePrediction(raw);
  if (!p) return null;
  const out = new Map<string, Map<Outcome, number>>();
  for (const m of providerMarkets(p)) out.set(keyOf(m.market, m.line), m.probs);
  return out.size ? out : null;
}

/** From the public fixture JSON or a database row's bundle; both carry the same fields. */
export function toHistRow(r: Record<string, any>): HistRow | null {
  const score = Array.isArray(r.score) ? r.score : null;
  const markets: Snap[] = Array.isArray(r.markets) ? r.markets : [];
  if (!score || score.length !== 2 || !markets.length) return null;
  const c = Array.isArray(r.corners) && r.corners.every((x: unknown) => typeof x === 'number') ? r.corners : null;
  const lam = Array.isArray(r.lambda) && r.lambda.every((x: unknown) => typeof x === 'number' && x > 0) ? r.lambda : null;
  return {
    id: Number(r.id),
    league_id: Number(r.league_id),
    // Backfilled snapshots carry no rank; the league's tier is in config.
    rank: Number(r.rank ?? config.leagueRank[Number(r.league_id)] ?? config.unrankedLeague),
    kickoff: Number(r.kickoff),
    score: [Number(score[0]), Number(score[1])],
    corners: c ? [Number(c[0]), Number(c[1])] : null,
    reds: typeof r.reds === 'number' ? r.reds : null,
    lambda: lam ? [Number(lam[0]), Number(lam[1])] : null,
    confidence: Number(r.confidence ?? 0),
    markets: fixBookFair(markets.filter((m) => m && m.market && m.book && m.best)),
    provider: providerMap(r.provider),
  };
}

/* --------------------------------------------------------- probabilities */

/** One (market, line, outcome) the engine could call, with every source's view of it. */
export interface Option {
  market: MarketCode;
  family: MarketFamily;
  line: number | null;
  outcome: Outcome;
  odds: number;
  book: number;
  model: number | null;
  provider: number | null;
  /** From the blended score matrix, for goals markets. */
  blend: number | null;
  /** Probability the stake comes back (draw-no-bet draw, whole handicap lines). */
  push: number;
  /** The sharp book's probability, when it priced the market. */
  sharp: number | null;
  /** How many books priced the market, when recorded. */
  books: number | null;
  /** The probability when the market opened, when recorded. */
  open: number | null;
  /** Our own analysis's probability, from the ratings alone (lab/own.ts). */
  own: number | null;
}

const GOALS_MARKETS = new Set<MarketCode>(['1x2', 'double_chance', 'draw_no_bet', 'btts', 'over_under_05', 'over_under_15', 'over_under_25', 'over_under_35', 'asian_handicap', 'european_handicap']);

export function targetsOf(row: HistRow): ImpliedTargets {
  const t: ImpliedTargets = { over: {} };
  for (const m of row.markets) {
    if (m.market === '1x2' && m.book['HOME'] && m.book['DRAW'] && m.book['AWAY']) {
      t.result = { HOME: m.book['HOME'], DRAW: m.book['DRAW'], AWAY: m.book['AWAY'] };
    } else if (/^over_under_\d\d$/.test(m.market) && typeof m.book['over'] === 'number') {
      const line = m.line ?? Number(m.market.slice(-2)) / 10;
      // The half-goal line is near-certain and says little about the rates.
      if (line >= 1.5) t.over![String(line)] = m.book['over'];
    } else if (m.market === 'btts' && typeof m.book['yes'] === 'number') {
      t.btts = m.book['yes'];
    }
  }
  return t;
}

function pricesFromMatrix(mx: ScoreMatrix, market: MarketCode, line: number | null): { probs: Map<Outcome, number>; push: Map<Outcome, number> } | null {
  const none = new Map<Outcome, number>();
  switch (market) {
    case '1x2': return { probs: priceResult(mx), push: none };
    case 'double_chance': return { probs: priceDoubleChance(mx), push: none };
    case 'draw_no_bet': {
      const draw = priceResult(mx).get('DRAW') ?? 0;
      return { probs: priceDrawNoBet(mx), push: new Map([['HOME', draw], ['AWAY', draw]]) };
    }
    case 'btts': return { probs: priceBtts(mx), push: none };
    case 'over_under_05': case 'over_under_15': case 'over_under_25': case 'over_under_35':
      return { probs: priceOverUnder(mx, line ?? Number(market.slice(-2)) / 10), push: none };
    case 'european_handicap': return line === null ? null : { probs: priceEuropeanHandicap(mx, line), push: none };
    case 'asian_handicap': {
      if (line === null) return null;
      const a = priceAsianHandicap(mx, line);
      return { probs: a.effective, push: a.push };
    }
    default: return null;
  }
}

/**
 * Every option on a fixture, with the book's, the model's, the provider's and
 * the blend's probability of it. `modelWeight` is how far the blend moves from
 * the market's rates toward our model's.
 */
export function optionsFor(row: HistRow, modelWeight: number): Option[] {
  const implied = impliedRates(targetsOf(row));
  const blendMx = implied
    ? matrixFor(blendRates(implied, row.lambda ? { home: row.lambda[0], away: row.lambda[1] } : null, modelWeight))
    : null;
  const ownMx = row.own ? buildScoreMatrix(row.own.home, row.own.away, row.own.rho) : null;
  const out: Option[] = [];
  for (const m of row.markets) {
    const fromOwn = ownMx && GOALS_MARKETS.has(m.market) ? pricesFromMatrix(ownMx, m.market, m.line) : null;
    const fromMx = blendMx && GOALS_MARKETS.has(m.market) ? pricesFromMatrix(blendMx, m.market, m.line) : null;
    const prov = row.provider?.get(keyOf(m.market, m.line)) ?? null;
    for (const [o, q] of Object.entries(m.best)) {
      const odds = Number(q?.odds);
      const book = m.book[o];
      if (!(odds > 1) || !(typeof book === 'number' && book > 0 && book < 1)) continue;
      out.push({
        market: m.market,
        family: MARKET_FAMILY[m.market],
        line: m.line,
        outcome: o as Outcome,
        odds,
        book,
        model: typeof m.model[o] === 'number' ? m.model[o]! : null,
        provider: prov?.get(o as Outcome) ?? null,
        blend: fromMx?.probs.get(o as Outcome) ?? null,
        push: fromMx?.push.get(o as Outcome) ?? 0,
        sharp: typeof m.sharp?.fair?.[o] === 'number' ? m.sharp.fair[o]! : null,
        books: typeof m.books === 'number' ? m.books : null,
        open: typeof m.open?.fair?.[o] === 'number' ? m.open.fair[o]! : null,
        own: fromOwn?.probs.get(o as Outcome) ?? null,
      });
    }
  }
  return out;
}

/** The graded result of an option against what happened, on a one-unit stake. */
export function grade(row: HistRow, o: { market: MarketCode; outcome: Outcome; line: number | null; odds: number }) {
  if ((o.market === 'total_corners' || o.market === 'corners_1x2') && !row.corners) return null;
  if ((o.market === 'total_red_cards' || o.market === 'red_card') && row.reds === null) return null;
  return settleSelection(o.market, o.outcome, o.line, o.odds, {
    homeGoals: row.score[0],
    awayGoals: row.score[1],
    homeCorners: row.corners?.[0] ?? null,
    awayCorners: row.corners?.[1] ?? null,
    reds: row.reds,
  });
}

/* --------------------------------------------------------------- scoring */

export interface Score { n: number; logLoss: number; brier: number }

const clampP = (p: number) => Math.min(1 - 1e-6, Math.max(1e-6, p));

/**
 * Log loss and Brier per family for each source, over every outcome that
 * resolved cleanly (pushes and half results say nothing about a probability).
 * Only options every compared source has a view on are counted, so the sources
 * are scored on identical questions.
 */
export function scoreSources(rows: HistRow[], modelWeight: number) {
  type Src = 'book' | 'model' | 'provider' | 'blend' | 'sharp';
  const acc = new Map<string, { n: number; ll: number; br: number }>();
  const add = (fam: string, src: Src, p: number, y: number) => {
    const k = `${fam}|${src}`;
    const a = acc.get(k) ?? { n: 0, ll: 0, br: 0 };
    a.n++;
    a.ll += -(y * Math.log(clampP(p)) + (1 - y) * Math.log(clampP(1 - p)));
    a.br += (p - y) ** 2;
    acc.set(k, a);
  };
  for (const row of rows) {
    for (const o of optionsFor(row, modelWeight)) {
      const g = grade(row, o);
      if (!g || (g.result !== 'WON' && g.result !== 'LOST')) continue;
      // Handicaps and draw-no-bet carry the conditional probability, which is
      // not the chance of a win; score them only where no push was possible.
      if (o.push > 1e-9) continue;
      const y = g.result === 'WON' ? 1 : 0;
      const fam = o.family;
      add(fam, 'book', o.book, y);
      if (o.model !== null) add(fam, 'model', o.model, y);
      if (o.provider !== null) add(fam, 'provider', o.provider, y);
      if (o.blend !== null) add(fam, 'blend', o.blend, y);
    }
  }
  const out: Record<string, Record<string, Score>> = {};
  for (const [k, a] of acc) {
    const [fam, src] = k.split('|') as [string, string];
    out[fam] ??= {};
    out[fam]![src] = { n: a.n, logLoss: a.ll / a.n, brier: a.br / a.n };
  }
  return out;
}

/* ------------------------------------------------------------ selection */

export interface Policy {
  name: string;
  /** Which probability the policy believes. */
  source: 'book' | 'model' | 'provider' | 'blend' | 'mix' | 'best' | 'stack' | 'sharp' | 'bestsharp' | 'own' | 'learned';
  /** Per-family logistic weights for the stacked source (lab/tune.ts). */
  stack?: Partial<Record<MarketFamily, number[]>>;
  /** Per-family weights for the learned source (lab/learned.ts). */
  learned?: Partial<Record<MarketFamily, number[]>>;
  /**
   * Our own analysis has to agree: its probability may sit at most this far
   * below the price's. Undefined skips it; an option our analysis has no
   * view on is left out when it is set.
   */
  minOwnGap?: number;
  modelWeight: number;
  minProb: number;
  maxProb: number;
  minOdds: number;
  maxOdds: number;
  /** Expected return per unit staked, at the best price, before a call is made. */
  minEv: number;
  /**
   * A best price this far above the consensus's fair odds is treated as a
   * stale or erroneous quote rather than an opportunity.
   */
  maxGap: number;
  /**
   * How the one call per fixture is chosen among those that qualify. `growth`
   * is the expected log of the odds, p·ln(odds): among calls that clear the
   * probability floor it prefers the one that pays, rather than the shortest
   * price on the board every time.
   */
  rankBy: 'ev' | 'prob' | 'evprob' | 'growth';
  families?: MarketFamily[] | null;
  /**
   * The most any one market may take of a day's calls, 0..1. A fixture whose
   * favourite market is already full takes its next qualifying one. Null for
   * no cap.
   */
  diversity?: number | null;
  /** Leave out quarter lines (-1.75, 0.25): a split stake nobody can explain in a sentence. */
  noQuarters?: boolean;
  /** The biggest handicap line a call may use, either way; -2.5 is a call on a rout. */
  maxHandicap?: number;
  /** A different floor for some league ranks (higher or lower): rank -> minimum probability. */
  rankFloor?: Record<number, number>;
  /** Markets (bucketOf) and league ranks this rule leaves alone. */
  excludeBuckets?: string[];
  excludeRanks?: number[];
  /** Only markets at least this many books priced in full. */
  minBooks?: number;
  /** Only where the sharp book priced the market too. */
  requireSharp?: boolean;
  /**
   * The value test against the sharp book as well: the best price must be
   * within this of the sharp book's fair price. Undefined skips it.
   */
  minSharpEv?: number;
  /**
   * Price movement. The money since the market opened: the market's view now
   * (the sharp book, else the consensus) less its view at the open, for this
   * outcome. A call the money has moved against by more than `maxDrift` is
   * left; `minSteam` asks for money to have come for it. Undefined skips it,
   * and so does an option with no opening price recorded.
   */
  maxDrift?: number;
  minSteam?: number;
  /**
   * The referee. A "no red card" call (or under on the red card line) is left
   * when the referee has shown more reds a game than this, over fifteen or
   * more games before this one.
   */
  maxRefReds?: number;
  /**
   * A second rule for a fixture with nothing this one would take: the strict
   * rule first, and only then the looser one.
   */
  fallback?: Policy;
}

export interface Pick { row: HistRow; option: Option; p: number; ev: number }

/** The probability a policy believes for an option, or null when it has none. */
export function probOf(policy: Policy, o: Option): number | null {
  switch (policy.source) {
    case 'book': return o.book;
    case 'model': return o.model;
    case 'provider': return o.provider;
    case 'blend': return o.blend ?? o.book;
    // Whichever source the accuracy table says is sharpest for the family:
    // the blend for goals, where our rates add to the market's, and the
    // consensus everywhere else, where they do not.
    case 'best': return o.family === 'goals' ? (o.blend ?? o.book) : o.book;
    case 'stack': return stackProb(policy.stack?.[o.family], o);
    // The sharp book where it priced the market, the consensus where not.
    case 'sharp': return o.sharp ?? o.book;
    // As 'best', with the sharp book standing in for the consensus.
    case 'bestsharp': return o.family === 'goals' ? (o.blend ?? o.sharp ?? o.book) : (o.sharp ?? o.book);
    // Our own analysis first, alone: the price only decides whether it pays.
    case 'own': return o.own;
    case 'learned': return learnedProb(policy.learned?.[o.family], o);
    // The blend where there is one, and the book's own view elsewhere, with the
    // provider's opinion averaged in where it has one.
    case 'mix': {
      const base = o.blend ?? o.book;
      return o.provider !== null ? 0.8 * base + 0.2 * o.provider : base;
    }
  }
}

const lg = (p: number) => { const q = Math.min(1 - 1e-6, Math.max(1e-6, p)); return Math.log(q / (1 - q)); };

/** The features of one option for the stacked probability: intercept, the consensus, and how the others differ from it. */
export function stackFeatures(o: Option): number[] {
  const b = lg(o.book);
  return [1, b, o.blend !== null ? lg(o.blend) - b : 0, o.provider !== null ? lg(o.provider) - b : 0];
}

export function stackProb(w: number[] | undefined, o: Option): number {
  if (!w) return o.book;
  const z = stackFeatures(o).reduce((a, x, i) => a + x * (w[i] ?? 0), 0);
  return 1 / (1 + Math.exp(-z));
}

/**
 * The features of one option for the learned probability, all relative to
 * the reference price (the sharp book, else the consensus) on the log-odds
 * scale, so that all-zero weights but the slope reproduce the price:
 *
 *   intercept, the price, the money since the open, our own read's
 *   disagreement, the blend's, the data provider's, the sharp book's with the
 *   consensus, and how far the best price sits above fair.
 */
export const LEARNED_FEATURES = ['intercept', 'price', 'moved', 'own', 'blend', 'provider', 'sharp', 'best'] as const;

export function learnedFeatures(o: Option): number[] {
  const ref = o.sharp ?? o.book;
  const r = lg(ref);
  return [
    1,
    r,
    o.open !== null ? r - lg(o.open) : 0,
    o.own !== null ? lg(o.own) - r : 0,
    o.blend !== null ? lg(o.blend) - r : 0,
    o.provider !== null ? lg(o.provider) - r : 0,
    o.sharp !== null ? lg(o.sharp) - lg(o.book) : 0,
    Math.log(o.odds * ref),
  ];
}

export function learnedProb(w: number[] | undefined, o: Option): number {
  if (!w) return o.sharp ?? o.book;
  const z = learnedFeatures(o).reduce((a, x, i) => a + x * (w[i] ?? 0), 0);
  return 1 / (1 + Math.exp(-z));
}

export function evOf(p: number, o: Option): number {
  // Expected profit per unit: the push hands the stake back.
  return (1 - o.push) * (p * o.odds - 1);
}

/** The market a call counts against for diversity: the market and the side of it. */
export function bucketOf(o: { market: MarketCode; outcome: Outcome }): string {
  const side = o.outcome === 'HOME' || o.outcome === '1X' ? 'home' : o.outcome === 'AWAY' || o.outcome === 'X2' ? 'away' : String(o.outcome);
  return `${o.market} ${side}`;
}

/** Every option a policy would take on a fixture, best first. */
export function ranked(policy: Policy, row: HistRow, options?: Option[]): Pick[] {
  const opts = options ?? optionsFor(row, policy.modelWeight);
  const out: Array<Pick & { score: number }> = [];
  for (const o of opts) {
    if (policy.families && !policy.families.includes(o.family)) continue;
    if (o.odds < policy.minOdds || o.odds > policy.maxOdds) continue;
    if (policy.noQuarters && o.line !== null && Math.abs((o.line * 4) % 2) === 1) continue;
    if (policy.maxHandicap !== undefined && o.family === 'handicap' && o.line !== null && Math.abs(o.line) > policy.maxHandicap) continue;
    if (policy.minBooks !== undefined && (o.books ?? 0) < policy.minBooks) continue;
    if (policy.excludeBuckets?.includes(bucketOf(o))) continue;
    if (policy.excludeRanks?.includes(row.rank)) continue;
    if (policy.requireSharp && o.sharp === null) continue;
    if (policy.minOwnGap !== undefined && (o.own === null || o.own - (o.sharp ?? o.book) < policy.minOwnGap)) continue;
    if (policy.minSharpEv !== undefined && o.sharp !== null && evOf(o.sharp, o) < policy.minSharpEv) continue;
    if (policy.maxRefReds !== undefined && row.ref && row.ref.n >= 15 && row.ref.reds / row.ref.n > policy.maxRefReds
      && ((o.market === 'red_card' && o.outcome === 'no') || (o.market === 'total_red_cards' && o.outcome === 'under'))) continue;
    if (o.open !== null && (policy.maxDrift !== undefined || policy.minSteam !== undefined)) {
      const moved = (o.sharp ?? o.book) - o.open;
      if (policy.maxDrift !== undefined && moved < -policy.maxDrift) continue;
      if (policy.minSteam !== undefined && moved < policy.minSteam) continue;
    }
    // A price far beyond what the consensus thinks is fair is almost always a
    // book that has not updated, not an opportunity anyone could take.
    if (o.odds * o.book > policy.maxGap) continue;
    const p = probOf(policy, o);
    if (p === null || p < (policy.rankFloor?.[row.rank] ?? policy.minProb) || p > policy.maxProb) continue;
    const ev = evOf(p, o);
    if (ev < policy.minEv) continue;
    const score = policy.rankBy === 'ev' ? ev
      : policy.rankBy === 'prob' ? p
      : policy.rankBy === 'growth' ? p * Math.log(o.odds) + ev
      : ev * Math.sqrt(p);
    out.push({ row, option: o, p, ev, score });
  }
  const mine = out.sort((a, b) => b.score - a.score);
  if (!policy.fallback) return mine;
  const seen = new Set(mine.map((x) => `${x.option.market}|${x.option.line}|${x.option.outcome}`));
  return [...mine, ...ranked(policy.fallback, row, options).filter((x) => !seen.has(`${x.option.market}|${x.option.line}|${x.option.outcome}`))];
}

export function choose(policy: Policy, row: HistRow, options?: Option[]): Pick | null {
  return ranked(policy, row, options)[0] ?? null;
}

/**
 * One call per fixture across a day, with no market taking more than the
 * policy's share of the day's calls. Fixtures are served strongest first, so
 * the cap costs the weakest calls their first choice, not the best ones.
 */
export function chooseDay(policy: Policy, rows: HistRow[], cache?: Map<number, Option[]>): Pick[] {
  const lists = rows.map((r) => ranked(policy, r, cache?.get(r.id))).filter((l) => l.length);
  if (!policy.diversity) return lists.map((l) => l[0]!);
  // As DayMix in production: a share of the day's fixtures, never below two.
  const cap = Math.max(2, Math.ceil(policy.diversity * rows.length));
  const used = new Map<string, number>();
  const out: Pick[] = [];
  for (const l of lists.sort((a, b) => b[0]!.p - a[0]!.p)) {
    const pick = l.find((c) => (used.get(bucketOf(c.option)) ?? 0) < cap);
    if (!pick) continue;
    used.set(bucketOf(pick.option), (used.get(bucketOf(pick.option)) ?? 0) + 1);
    out.push(pick);
  }
  return out;
}

const dayOf = (t: number) => Math.floor((t + 3600) / 86400);

export interface SimResult {
  policy: string;
  n: number;
  won: number;
  lost: number;
  staked: number;
  pnl: number;
  roi: number;
  hitRate: number;
  avgOdds: number;
  /** Largest peak-to-trough fall in units. */
  drawdown: number;
  byFamily: Record<string, { n: number; pnl: number; roi: number }>;
  byMarket: Record<string, { n: number; pnl: number }>;
  /** How varied the calls are: the biggest market's share, and how many markets were used. */
  topShare: number;
  markets: number;
  /** Calls per day on average, over the days with any. */
  perDay: number;
}

export function simulate(policy: Policy, rows: HistRow[], cache?: Map<number, Option[]>): SimResult {
  let n = 0, won = 0, lost = 0, pnl = 0, odds = 0, peak = 0, dd = 0;
  const byFamily: SimResult['byFamily'] = {};
  const byMarket: SimResult['byMarket'] = {};
  const buckets = new Map<string, number>();
  const days = new Map<number, HistRow[]>();
  for (const row of [...rows].sort((a, b) => a.kickoff - b.kickoff)) {
    const d = dayOf(row.kickoff);
    days.set(d, [...(days.get(d) ?? []), row]);
  }
  let activeDays = 0;
  for (const dayRows of days.values()) {
    const picks = chooseDay(policy, dayRows, cache).sort((a, b) => a.row.kickoff - b.row.kickoff);
    if (picks.length) activeDays++;
    for (const pick of picks) {
      const g = grade(pick.row, pick.option);
      if (!g || g.result === 'VOID') continue;
      n++;
      pnl += g.pnl;
      odds += pick.option.odds;
      if (g.result === 'WON' || g.result === 'HALF_WON') won++;
      if (g.result === 'LOST' || g.result === 'HALF_LOST') lost++;
      peak = Math.max(peak, pnl);
      dd = Math.max(dd, peak - pnl);
      const f = (byFamily[pick.option.family] ??= { n: 0, pnl: 0, roi: 0 });
      f.n++;
      f.pnl += g.pnl;
      const mk = `${pick.option.market}${pick.option.line === null ? '' : ` ${pick.option.line}`} ${pick.option.outcome}`;
      const m = (byMarket[mk] ??= { n: 0, pnl: 0 });
      m.n++;
      m.pnl += g.pnl;
      buckets.set(bucketOf(pick.option), (buckets.get(bucketOf(pick.option)) ?? 0) + 1);
    }
  }
  for (const f of Object.values(byFamily)) f.roi = f.n ? f.pnl / f.n : 0;
  return {
    policy: policy.name,
    n, won, lost, staked: n, pnl,
    roi: n ? pnl / n : 0,
    hitRate: n ? won / n : 0,
    avgOdds: n ? odds / n : 0,
    drawdown: dd,
    byFamily,
    byMarket,
    topShare: n ? Math.max(0, ...buckets.values()) / n : 0,
    markets: buckets.size,
    perDay: activeDays ? n / activeDays : 0,
  };
}

/** The rule before the lab: the provider's most likely outcome at 80% or more, at 1.13 or longer. */
export const CURRENT: Policy = {
  name: 'old rule (most likely, provider, 80%+)',
  source: 'provider', modelWeight: 0, minProb: 0.8, maxProb: 0.95, minOdds: 1.13, maxOdds: 100,
  minEv: -1, maxGap: 99, rankBy: 'prob',
};

export function policyGrid(): Policy[] {
  const out: Policy[] = [];
  for (const source of ['book', 'blend', 'mix'] as const) {
    for (const modelWeight of source === 'book' ? [0] : [0, 0.15, 0.3, 0.5]) {
      for (const minProb of [0.45, 0.55, 0.65]) {
        for (const minEv of [0, 0.02, 0.04, 0.07]) {
          for (const maxGap of [1.06, 1.12]) {
            for (const rankBy of ['ev', 'evprob'] as const) {
              out.push({
                name: `${source} w=${modelWeight} p>=${minProb} ev>=${minEv} gap<=${maxGap} ${rankBy}`,
                source, modelWeight, minProb, maxProb: 0.92, minOdds: 1.3, maxOdds: 4, minEv, maxGap, rankBy,
              });
            }
          }
        }
      }
    }
  }
  return out;
}

/**
 * Rules of the published kind: likely calls, one a fixture, but free to use
 * any market that clears the bar rather than the shortest price every time,
 * and with a cap on how much of a day any one market may take.
 */
export function confidentGrid(): Policy[] {
  const out: Policy[] = [];
  for (const [source, modelWeight] of [['book', 0], ['best', 0.3], ['best', 0.5], ['blend', 0.3], ['mix', 0.3]] as const) {
    for (const minProb of [0.6, 0.65, 0.7, 0.75, 0.8]) {
      for (const rankBy of ['prob', 'growth', 'evprob'] as const) {
        for (const diversity of [null, 0.3]) {
          for (const minEv of [-1, -0.03]) {
            out.push({
              name: `likely ${source}${source === 'book' ? '' : ` w=${modelWeight}`} p>=${minProb} ${rankBy}${diversity ? ` cap ${diversity}` : ''}${minEv > -1 ? ` ev>=${minEv}` : ''}`,
              source, modelWeight, minProb, maxProb: 0.95, minOdds: 1.13, maxOdds: 3.5, minEv, maxGap: 1.12, rankBy, diversity,
            });
          }
        }
      }
    }
  }
  return out;
}

/**
 * The production rule and its near neighbours, scored as named rules rather
 * than searched for, so the report says how the rule the slate runs does.
 */
export function productionRules(): Policy[] {
  const base: Policy = {
    name: 'production', source: 'bestsharp', modelWeight: 0.5, minProb: 0.78, maxProb: 0.97, minOdds: 1.13, maxOdds: 3.5,
    minEv: -0.01, maxGap: 1.12, rankBy: 'prob', diversity: 0.3, noQuarters: true, minSharpEv: 0, excludeBuckets: ['total_corners under'],
    rankFloor: { 1: 0.7, 2: 0.7, 3: 0.85 },
  };
  const v = (name: string, o: Partial<Policy>): Policy => ({ ...base, ...o, name });
  return [
    base,
    v('production, p >= 0.8', { minProb: 0.8 }),
    v('production, p >= 0.75', { minProb: 0.75 }),
    v('production, p >= 0.7, ev >= 0, growth (previous)', { minProb: 0.7, minEv: 0, rankBy: 'growth', maxProb: 0.95 }),
    v('production, no cap', { diversity: null }),
    v('production, quarter lines allowed', { noQuarters: false }),
    v('value: p >= 0.65, ev >= 0.02, gap 1.06', { minProb: 0.65, minEv: 0.02, maxGap: 1.06, rankBy: 'ev' }),
    v('value: p >= 0.7, ev >= 0.01, gap 1.08', { minProb: 0.7, minEv: 0.01, maxGap: 1.08, rankBy: 'ev' }),
  ];
}

/**
 * Tune on the older part of the history, report on the newer part the tuning
 * never saw. A rule is only eligible if it made enough calls in training to
 * mean something, and it is ranked on a lower confidence bound of its return
 * rather than the return itself, which is what stops a lucky dozen from
 * winning the grid.
 */
export function walkForward(rows: HistRow[], trainShare = 0.6, minCalls = 40, grid: Policy[] = policyGrid(), eligible: (r: SimResult) => boolean = () => true) {
  const sorted = [...rows].sort((a, b) => a.kickoff - b.kickoff);
  const cut = Math.floor(sorted.length * trainShare);
  const train = sorted.slice(0, cut);
  const test = sorted.slice(cut);
  const caches = new Map<number, Map<number, Option[]>>();
  const cacheFor = (w: number) => {
    let c = caches.get(w);
    if (!c) {
      c = new Map(sorted.map((r) => [r.id, optionsFor(r, w)]));
      caches.set(w, c);
    }
    return c;
  };
  const scored = grid.map((p) => {
    const r = simulate(p, train, cacheFor(p.modelWeight));
    // Return minus one standard error of it, per call.
    const se = r.n > 1 ? Math.sqrt(Math.max(1e-9, r.avgOdds - 1) / r.n) : 1;
    return { p, r, lcb: r.n >= minCalls && eligible(r) ? r.roi - se : -Infinity };
  }).sort((a, b) => b.lcb - a.lcb);
  const top = scored.slice(0, 5);
  return {
    trainRows: train.length,
    testRows: test.length,
    current: { train: simulate(CURRENT, train), test: simulate(CURRENT, test) },
    best: top.map(({ p, r, lcb }) => ({
      policy: p,
      train: r,
      lcb,
      test: simulate(p, test, cacheFor(p.modelWeight)),
    })),
  };
}
