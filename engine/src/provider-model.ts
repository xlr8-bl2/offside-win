import { bsdOrNull } from './bsd.ts';
import type { MarketCode, ModelMarket, Outcome } from './types.ts';

/**
 * The provider's prediction, in the shape the rest of the engine speaks.
 *
 * Why this exists at all, stated plainly so nobody has to reconstruct it:
 * measured against de-vigged live quotes, their numbers sit 0.93 points from
 * the bookmakers' fair price, where ours sit 8.52. Theirs is, to a very good
 * approximation, the market — which is the best public forecast in football and
 * comfortably better calibrated than our own Dixon-Coles. So on the question
 * "what is likely to happen", we defer to them.
 *
 * What that buys is accuracy, not an edge. A number that equals the price
 * cannot beat the price, and the picks this produces are high-confidence calls
 * rather than value bets. The engine keeps both and labels them differently,
 * because they answer different questions and a reader must never have to guess
 * which one they are looking at.
 *
 * Everything downstream — book matching, best-price attachment, storage,
 * settlement — works unchanged, because this returns exactly the ModelMarket[]
 * our own pricing returns.
 */

const pc = (v: unknown): number | null => {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  // They mix scales: 1x2 arrives as fractions in some payloads and percentages
  // in others, and over/under arrives as percentages. Anything above 1 is a
  // percentage, because no probability is.
  const p = v > 1 ? v / 100 : v;
  return p > 0 && p < 1 ? p : null;
};

export interface ProviderPrediction {
  markets: Record<string, Record<string, unknown>>;
  model: { confidence: number | null; version: string | null };
  /** Their own headline call, kept for display rather than for pricing. */
  predicted: string | null;
  expected_goals: { home: number; away: number } | null;
}

export function parsePrediction(raw: unknown): ProviderPrediction | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, any>;
  if (!r.markets || typeof r.markets !== 'object') return null;
  const xg = r.markets.expected_goals;
  return {
    markets: r.markets,
    model: {
      confidence: typeof r.model?.confidence === 'number' ? r.model.confidence : null,
      version: typeof r.model?.version === 'string' ? r.model.version : null,
    },
    predicted: typeof r.markets.match_result?.predicted === 'string' ? r.markets.match_result.predicted : null,
    expected_goals:
      typeof xg?.home === 'number' && typeof xg?.away === 'number'
        ? { home: xg.home, away: xg.away }
        : null,
  };
}

export async function fetchPrediction(eventId: number): Promise<ProviderPrediction | null> {
  return parsePrediction(await bsdOrNull(`/api/v2/events/${eventId}/prediction/`));
}

/**
 * Their probabilities as ModelMarket[].
 *
 * Double chance and draw-no-bet are derived from the 1x2 rather than read,
 * because a derived number is guaranteed consistent with its parent and a read
 * one is not — and double chance is most of what they publish, so a 1X that
 * disagreed with its own HOME and DRAW would be visible on the board.
 */
export function providerMarkets(p: ProviderPrediction): ModelMarket[] {
  const out: ModelMarket[] = [];
  const conf = p.model.confidence ?? 0.5;
  const add = (market: MarketCode, line: number | null, probs: Array<[Outcome, number | null]>) => {
    if (probs.some(([, v]) => v === null)) return;
    out.push({
      market,
      line,
      probs: new Map(probs as Array<[Outcome, number]>),
      confidence: conf,
    });
  };

  const mr = p.markets.match_result ?? {};
  const H = pc(mr.prob_home);
  const D = pc(mr.prob_draw);
  const A = pc(mr.prob_away);

  if (H !== null && D !== null && A !== null) {
    // Normalise: their three do not always sum to exactly one, and an unnormalised
    // set would put a fake edge on every outcome in the same direction.
    const sum = H + D + A;
    const h = H / sum;
    const d = D / sum;
    const a = A / sum;
    add('1x2', null, [['HOME', h], ['DRAW', d], ['AWAY', a]]);
    add('double_chance', null, [['1X', h + d], ['12', h + a], ['X2', d + a]]);
    if (h + a > 0) add('draw_no_bet', null, [['HOME', h / (h + a)], ['AWAY', a / (h + a)]]);
  }

  const ou = p.markets.over_under ?? {};
  for (const [key, line, code] of [
    ['prob_over_15', 1.5, 'over_under_15'],
    ['prob_over_25', 2.5, 'over_under_25'],
    ['prob_over_35', 3.5, 'over_under_35'],
  ] as const) {
    const over = pc(ou[key]);
    if (over !== null) add(code, line, [['over', over], ['under', 1 - over]]);
  }

  const yes = pc(p.markets.btts?.prob_yes);
  if (yes !== null) add('btts', null, [['yes', yes], ['no', 1 - yes]]);

  return out;
}
