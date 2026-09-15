/**
 * Is the provider's model actually the bookmakers' price?
 *
 * Their payload reports `model.version: "dc-blend-v1"` — a blend — and their own
 * page says "we do not claim these beat the bookmakers'". Those two facts have
 * an obvious joint explanation: the blend includes the market price. If it does,
 * their 86.7% is not evidence of a good model. It is the market's accuracy,
 * relabelled, and it is worth exactly zero as a betting edge, because a price
 * cannot beat itself.
 *
 * That is a checkable claim, not a suspicion. For upcoming fixtures we hold real
 * bookmaker quotes, so this de-vigs them to a fair probability and measures how
 * far the provider's number sits from it — against how far ours does. A model
 * that tracks the market to within a point or two is the market.
 */
import { bsdOrNull, stats } from '../src/bsd.ts';
import { devig } from '../src/devig.ts';
import { buildBookMarkets, fetchQuotes } from '../src/odds.ts';
import { closeDb, select } from '../src/store.ts';

const LIMIT = Number(process.env.MARKET_LIMIT ?? 120);

const fixtures = await select<{ id: number; home_team: string; away_team: string; bundle_json: string }>(
  `SELECT id, home_team, away_team, bundle_json FROM fixture
   WHERE kickoff > ? ORDER BY kickoff ASC LIMIT ?`,
  [Math.floor(Date.now() / 1000), LIMIT],
);
console.log(`${fixtures.length} upcoming fixtures on the board`);

const absDiff: number[] = [];
const oursDiff: number[] = [];
let compared = 0;

const queue = [...fixtures];
await Promise.all(
  Array.from({ length: 8 }, async () => {
    for (;;) {
      const f = queue.shift();
      if (!f) break;

      const quotes = await fetchQuotes(f.id);
      const market = buildBookMarkets(quotes).find((m) => m.market === '1x2');
      if (!market) continue;

      const outcomes = ['HOME', 'DRAW', 'AWAY'] as const;
      const prices = outcomes.map((o) => market.best.get(o)?.odds ?? 0);
      if (prices.some((p) => !p || p <= 1)) continue;
      const fair = devig(prices).probs;

      const p = (await bsdOrNull(`/api/v2/events/${f.id}/prediction/`)) as Record<string, any> | null;
      const mr = p?.markets?.match_result;
      if (!mr || typeof mr.prob_home !== 'number') continue;
      const pc = (v: number) => (v > 1 ? v / 100 : v);
      const theirs = [pc(mr.prob_home), pc(mr.prob_draw), pc(mr.prob_away)];
      const ts = theirs.reduce((a, b) => a + b, 0) || 1;

      // Ours, as published on the board for this same fixture.
      let ours: number[] | null = null;
      try {
        const b = JSON.parse(f.bundle_json) as Record<string, any>;
        const o = b.odds_1x2 ?? b.model_1x2 ?? null;
        if (o && typeof o.HOME === 'number') ours = [o.HOME, o.DRAW, o.AWAY];
      } catch {
        ours = null;
      }

      let dTheirs = 0;
      let dOurs = 0;
      for (let i = 0; i < 3; i++) {
        dTheirs += Math.abs(theirs[i]! / ts - fair[i]!);
        if (ours) dOurs += Math.abs(ours[i]! - fair[i]!);
      }
      absDiff.push(dTheirs / 3);
      if (ours) oursDiff.push(dOurs / 3);
      compared++;
    }
  }),
);

const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const pp = (v: number) => `${(100 * v).toFixed(2)} pts`;

console.log(`\ncompared on ${compared} fixtures with both a real price and a prediction`);
console.log(`\nmean absolute distance from the de-vigged market price, per outcome:`);
console.log(`  provider : ${pp(mean(absDiff))}`);
console.log(`  us       : ${oursDiff.length ? pp(mean(oursDiff)) : '— (board carries no model 1x2)'}`);
console.log(`
Read it like this. Under ~2 points means the number IS the market, repackaged:
accurate by construction, and worth nothing as an edge, because you cannot bet
a price into itself. Well above that means a genuinely independent opinion —
which is the only kind that can be either right or wrong about a price.`);
console.log(`\nprovider requests: ${stats.requests} (${stats.errors} errors)`);
await closeDb();
