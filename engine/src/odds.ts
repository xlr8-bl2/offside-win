import { bsdList, num, str, toEpoch } from './bsd.ts';
import { devig } from './devig.ts';
import type { BookMarket, BookPrice, MarketCode, Outcome, PushRule, Quote } from './types.ts';

/**
 * Fetching quotes and working out what the book actually thinks.
 *
 * The subtle part is which prices to de-vig. It is tempting to take the best
 * price available for each outcome and strip the margin from that set — but
 * best-of-many-books prices already have much of the margin competed away, so
 * the result sums below one and every outcome looks like value. That single
 * mistake would make the whole product wrong in the same direction.
 *
 * So: de-vig *within* each bookmaker, where the margin is real and coherent,
 * then average those opinions across books. Best price is tracked separately —
 * it is what you would actually get on, and it belongs in the stake, not in the
 * estimate of truth.
 */

/** Outcome sets per market, used to tell a complete quote set from a partial one. */
const OUTCOMES: Record<MarketCode, Outcome[]> = {
  '1x2': ['HOME', 'DRAW', 'AWAY'],
  double_chance: ['1X', '12', 'X2'],
  draw_no_bet: ['HOME', 'AWAY'],
  btts: ['yes', 'no'],
  over_under_05: ['over', 'under'],
  over_under_15: ['over', 'under'],
  over_under_25: ['over', 'under'],
  over_under_35: ['over', 'under'],
  total_corners: ['over', 'under'],
  corners_1x2: ['HOME', 'DRAW', 'AWAY'],
  total_red_cards: ['over', 'under'],
  red_card: ['yes', 'no'],
  european_handicap: ['HOME', 'DRAW', 'AWAY'],
  asian_handicap: ['HOME', 'AWAY'],
};

/**
 * How much each book's opinion counts. Pinnacle runs high limits on thin
 * margins and is the reference sharp book — its number is worth more than a
 * recreational book's, and §7.1 says so explicitly.
 */
const BOOK_WEIGHT: Record<string, number> = {
  pinnacle: 3.0,
  betfair: 2.0,
  smarkets: 1.8,
  matchbook: 1.8,
  bet365: 1.3,
  williamhill: 1.0,
  '1xbet': 0.9,
};
const DEFAULT_BOOK_WEIGHT = 1.0;

/**
 * How many books' prices travel per outcome. Every card on the board carries
 * this list, so it is a size decision as much as a completeness one: twelve
 * covers every mainstream operator in any one country several times over, and
 * the thirteenth-best price on a market is nobody's reason to read.
 */
const MAX_BOOKS = 12;

export const MARKET_CODES = Object.keys(OUTCOMES) as MarketCode[];

function isMarketCode(v: string): v is MarketCode {
  return v in OUTCOMES;
}

function isOutcome(v: string): v is Outcome {
  return ['HOME', 'DRAW', 'AWAY', '1X', '12', 'X2', 'over', 'under', 'yes', 'no'].includes(v);
}

export async function fetchQuotes(eventId: number): Promise<Quote[]> {
  const raw = await bsdList<Record<string, unknown>>(
    '/api/v2/odds/',
    { event_id: eventId },
    { limit: 200, max: 4000 },
  );

  const out: Quote[] = [];
  for (const r of raw) {
    const market = str(r['market']);
    const outcome = str(r['outcome']);
    const odds = num(r['decimal_odds']);
    if (!market || !outcome || odds === undefined || odds <= 1) continue;
    if (!isMarketCode(market) || !isOutcome(outcome)) continue;

    const pushRaw = str(r['push']);
    out.push({
      market,
      outcome,
      line: num(r['line']) ?? null,
      push: pushRaw === 'none' || pushRaw === 'full' || pushRaw === 'half' ? (pushRaw as PushRule) : null,
      bookmaker_slug: str(r['bookmaker_slug']) ?? 'unknown',
      bookmaker_name: str(r['bookmaker_name']) ?? str(r['bookmaker_slug']) ?? 'unknown',
      decimal_odds: odds,
      opening_decimal_odds: num(r['opening_decimal_odds']) ?? null,
      opening_at: toEpoch(r['opening_at']) ?? null,
      previous_decimal_odds: num(r['previous_decimal_odds']) ?? null,
      implied_probability: num(r['implied_probability']) ?? null,
      movement:
        str(r['movement']) === 'SHORTENING'
          ? 'SHORTENING'
          : str(r['movement']) === 'DRIFTING'
            ? 'DRIFTING'
            : null,
      is_max_quote: r['is_max_quote'] === true,
      updated_at: toEpoch(r['updated_at']) ?? 0,
    });
  }
  return out;
}

const keyOf = (market: MarketCode, line: number | null) =>
  `${market}::${line === null ? 'x' : line.toFixed(2)}`;

/**
 * Collapse raw quotes into one opinion per (market, line).
 *
 * Books that are not quoting a complete outcome set are skipped for the
 * consensus — half a market cannot be de-vigged, and including it would bias
 * whichever side it happened to quote.
 */
export function buildBookMarkets(quotes: Quote[]): BookMarket[] {
  const groups = new Map<string, { market: MarketCode; line: number | null; quotes: Quote[] }>();
  for (const q of quotes) {
    const k = keyOf(q.market, q.line);
    const g = groups.get(k) ?? { market: q.market, line: q.line, quotes: [] };
    g.quotes.push(q);
    groups.set(k, g);
  }

  const out: BookMarket[] = [];

  for (const g of groups.values()) {
    const wanted = OUTCOMES[g.market];

    // Every book's price per outcome, best first, and the best of them.
    //
    // The full list travels because the best price in the world is regularly
    // at a book the reader cannot open an account with. Which books those are
    // depends on where they are sitting, which is a fact about them and not
    // about this fixture — so the choosing happens on the page and all this
    // stage does is refuse to throw the alternatives away.
    const perOutcome = new Map<Outcome, Map<string, BookPrice>>();
    for (const q of g.quotes) {
      const m = perOutcome.get(q.outcome) ?? new Map<string, BookPrice>();
      const prev = m.get(q.bookmaker_slug);
      // One row per book. A book quoting twice keeps its better price.
      if (!prev || q.decimal_odds > prev.odds) {
        m.set(q.bookmaker_slug, {
          slug: q.bookmaker_slug,
          book: q.bookmaker_name,
          odds: q.decimal_odds,
        });
      }
      perOutcome.set(q.outcome, m);
    }

    const quotesByOutcome = new Map<Outcome, BookPrice[]>();
    const best = new Map<Outcome, { odds: number; bookmaker: string }>();
    for (const [o, m] of perOutcome) {
      const list = [...m.values()].sort((a, b) => b.odds - a.odds).slice(0, MAX_BOOKS);
      quotesByOutcome.set(o, list);
      const top = list[0];
      if (top) best.set(o, { odds: top.odds, bookmaker: top.book });
    }

    // Per-bookmaker complete sets.
    const byBook = new Map<string, Map<Outcome, Quote>>();
    for (const q of g.quotes) {
      const m = byBook.get(q.bookmaker_slug) ?? new Map<Outcome, Quote>();
      // Keep the freshest quote if a book appears more than once.
      const prev = m.get(q.outcome);
      if (!prev || q.updated_at >= prev.updated_at) m.set(q.outcome, q);
      byBook.set(q.bookmaker_slug, m);
    }

    const fairAcc = new Map<Outcome, number>();
    let weightTotal = 0;
    let overroundAcc = 0;
    let overroundWeight = 0;
    let methodUsed: 'shin' | 'multiplicative' = 'shin';

    for (const [slug, m] of byBook) {
      if (!wanted.every((o) => m.has(o))) continue; // partial set: unusable
      const odds = wanted.map((o) => m.get(o)!.decimal_odds);
      const d = devig(odds);
      if (d.method === 'multiplicative') methodUsed = 'multiplicative';

      const w = BOOK_WEIGHT[slug] ?? DEFAULT_BOOK_WEIGHT;
      wanted.forEach((o, i) => fairAcc.set(o, (fairAcc.get(o) ?? 0) + w * d.probs[i]!));
      weightTotal += w;
      overroundAcc += w * d.overround;
      overroundWeight += w;
    }

    const fair = new Map<Outcome, number>();
    if (weightTotal > 0) {
      for (const [o, v] of fairAcc) fair.set(o, v / weightTotal);
    } else {
      // No book quoted the full set. Fall back to de-vigging the best prices,
      // which understates the margin — flagged by the method field so the
      // selection stage can treat it with the suspicion it deserves.
      const complete = wanted.every((o) => best.has(o));
      if (!complete) continue;
      const d = devig(wanted.map((o) => best.get(o)!.odds));
      wanted.forEach((o, i) => fair.set(o, d.probs[i]!));
      methodUsed = 'multiplicative';
      overroundAcc = d.overround;
      overroundWeight = 1;
    }

    // §7.1 movement. Take the sharpest book that reported an opening price;
    // a recreational book's drift says less than Pinnacle's.
    const movement = new Map<Outcome, { opening: number; current: number; dir: 'SHORTENING' | 'DRIFTING' | null }>();
    for (const o of wanted) {
      const withOpening = g.quotes
        .filter((q) => q.outcome === o && q.opening_decimal_odds !== null)
        .sort(
          (a, b) =>
            (BOOK_WEIGHT[b.bookmaker_slug] ?? DEFAULT_BOOK_WEIGHT) -
            (BOOK_WEIGHT[a.bookmaker_slug] ?? DEFAULT_BOOK_WEIGHT),
        );
      const q = withOpening[0];
      if (q) {
        movement.set(o, {
          opening: q.opening_decimal_odds!,
          current: q.decimal_odds,
          dir: q.movement,
        });
      }
    }

    out.push({
      market: g.market,
      line: g.line,
      fair,
      best,
      quotes: quotesByOutcome,
      overround: overroundWeight > 0 ? overroundAcc / overroundWeight : 1,
      method: methodUsed,
      movement,
    });
  }

  return out;
}

/** Prices from one named book, for the sharp-reference comparison in §7.1. */
export function bookOnly(quotes: Quote[], slug: string): BookMarket[] {
  return buildBookMarkets(quotes.filter((q) => q.bookmaker_slug === slug));
}

/** Which lines the book is offering, so we only price what can actually be bet. */
export function offeredLines(quotes: Quote[], market: MarketCode): number[] {
  const lines = new Set<number>();
  for (const q of quotes) {
    if (q.market === market && q.line !== null) lines.add(q.line);
  }
  return [...lines].sort((a, b) => a - b);
}

export function findBookMarket(
  markets: BookMarket[],
  market: MarketCode,
  line: number | null,
): BookMarket | undefined {
  return markets.find(
    (m) => m.market === market && (line === null ? m.line === null : Math.abs((m.line ?? NaN) - line) < 1e-9),
  );
}
