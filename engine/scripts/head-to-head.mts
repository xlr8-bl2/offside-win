/**
 * Our model against the provider's, on the same matches, scored the way a
 * tipster is scored: of the bets each side would have published, how many won.
 *
 * This is a different question from the log loss the backtest reports, and it
 * is the one an "87% accuracy" claim is about. It needs two guards to mean
 * anything:
 *
 *   1. **Matched volume.** A hit rate rises as you publish less — someone who
 *      only tips heavy favourites posts 85% and still loses money. So our side
 *      is reported at the same selectivity as theirs, not at our own.
 *   2. **The market each side chose.** "Over 1.5 goals" lands ~78% of the time
 *      unaided, and a hit rate is meaningless without the base rate of the
 *      thing being picked. Both are printed, per market.
 *
 * Our side is walk-forward: ratings are fitted only on matches strictly before
 * the one being predicted, refitting on a cadence, so the model never sees the
 * result it is predicting. Theirs is whatever their endpoint says today, which
 * if anything flatters them — we cannot prove they are not using the result.
 */
import { bsdOrNull, stats } from '../src/bsd.ts';
import { loadMatches, trackedLeagues } from '../src/history.ts';
import { buildScoreMatrix, priceBtts, priceOverUnder, priceResult } from '../src/price.ts';
import { defaultFitOptions, expectedGoals, fitDixonColes } from '../src/ratings/dixoncoles.ts';
import { closeDb } from '../src/store.ts';
import type { MatchRow } from '../src/types.ts';

const TOTAL = Number(process.env.H2H_MATCHES ?? 600);
const PER_LEAGUE = Number(process.env.H2H_PER_LEAGUE ?? 25);
const BURN_IN = Number(process.env.H2H_BURN_IN ?? 150);
const REFIT_DAYS = 14;
const CONCURRENCY = 12;

interface Sel {
  label: string;
  market: string;
  prob: number;
  won: boolean;
}

/** Every selection either side could name for one match, priced and graded. */
function selections(lh: number, la: number, rho: number, hg: number, ag: number): Sel[] {
  const m = buildScoreMatrix(lh, la, rho);
  const r = priceResult(m);
  const over = priceOverUnder(m, 2.5).get('over')!;
  const over15 = priceOverUnder(m, 1.5).get('over')!;
  const yes = priceBtts(m).get('yes')!;
  return [
    { label: 'home', market: '1x2', prob: r.get('HOME')!, won: hg > ag },
    { label: 'draw', market: '1x2', prob: r.get('DRAW')!, won: hg === ag },
    { label: 'away', market: '1x2', prob: r.get('AWAY')!, won: hg < ag },
    { label: 'over 1.5', market: 'ou15', prob: over15, won: hg + ag > 1.5 },
    { label: 'under 1.5', market: 'ou15', prob: 1 - over15, won: hg + ag < 1.5 },
    { label: 'over 2.5', market: 'ou25', prob: over, won: hg + ag > 2.5 },
    { label: 'under 2.5', market: 'ou25', prob: 1 - over, won: hg + ag < 2.5 },
    { label: 'btts yes', market: 'btts', prob: yes, won: hg >= 1 && ag >= 1 },
    { label: 'btts no', market: 'btts', prob: 1 - yes, won: !(hg >= 1 && ag >= 1) },
  ];
}

interface Row {
  id: number;
  kickoff: number;
  /** Every selection graded, so either side's label can be looked up. */
  graded: Map<string, Sel>;
  /** What we would publish: our most likely selection.  */
  ours: Sel;
}

// ------------------------------------------------- our side, walk-forward

console.log('fitting our model walk-forward (this is the slow part)...');
const rows: Row[] = [];
let refits = 0;
let leagues = 0;

for (const league of await trackedLeagues()) {
  const all = (await loadMatches(league.id)).filter(
    (m: MatchRow) => m.home_goals !== null && m.away_goals !== null,
  );
  if (all.length < BURN_IN + 10) continue;
  leagues++;

  let fit: ReturnType<typeof fitDixonColes> | null = null;
  let lastFit = 0;

  for (let i = Math.max(BURN_IN, all.length - PER_LEAGUE); i < all.length; i++) {
    const m = all[i]!;
    if (fit === null || m.kickoff - lastFit > REFIT_DAYS * 86400) {
      fit = fitDixonColes(all.slice(0, i), league.id, defaultFitOptions(m.kickoff));
      lastFit = m.kickoff;
      refits++;
    }
    const { home, away } = expectedGoals(fit, m.home_team_id, m.away_team_id);
    const sels = selections(home, away, fit.params.rho, m.home_goals!, m.away_goals!);
    rows.push({
      id: m.id,
      kickoff: m.kickoff,
      graded: new Map(sels.map((s) => [s.label, s])),
      ours: sels.reduce((a, b) => (b.prob > a.prob ? b : a)),
    });
  }
}

rows.sort((a, b) => b.kickoff - a.kickoff);
const sample = rows.slice(0, TOTAL);
console.log(`${sample.length} matches across ${leagues} leagues, ${refits} refits`);

// --------------------------------------------------------- their side

const asProb = (v: unknown): number | null =>
  typeof v !== 'number' ? null : v > 1 ? v / 100 : v;
const RESULT_LABEL: Record<string, string> = {
  H: 'home', HOME: 'home', home: 'home', '1': 'home',
  D: 'draw', DRAW: 'draw', draw: 'draw', X: 'draw',
  A: 'away', AWAY: 'away', away: 'away', '2': 'away',
};

interface Theirs {
  label: string;
  conf: number | null;
}
const theirs = new Map<number, Theirs>();
let shapeShown = false;

const queue = [...sample];
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    for (;;) {
      const row = queue.shift();
      if (!row) break;
      const p = (await bsdOrNull(`/api/v2/events/${row.id}/prediction/`)) as Record<string, any> | null;
      if (!p) continue;

      // The recommendations block was read through a guessed shape and matched
      // nothing — n=0 on every recommended-bet line. Print the payload once so
      // the shape is read rather than guessed again.
      if (!shapeShown) {
        shapeShown = true;
        console.log('\n--- one prediction payload, as it actually arrives ---');
        console.log('top level:', Object.keys(p).join(', '));
        for (const [k, v] of Object.entries(p)) {
          if (k === 'markets') continue;
          console.log(`  ${k}: ${JSON.stringify(v).slice(0, 300)}`);
        }
        for (const [k, v] of Object.entries(p.markets ?? {})) {
          console.log(`  markets.${k}: ${JSON.stringify(v).slice(0, 300)}`);
        }
        console.log('---\n');
      }

      const mr = p.markets?.match_result;
      const rec = p.recommendations ?? p.recommendation ?? p.tips ?? p.best_bet ?? null;
      let label: string | null = null;

      if (rec && typeof rec === 'object' && !Array.isArray(rec)) {
        if (rec.winner === true && mr?.predicted) label = RESULT_LABEL[String(mr.predicted)] ?? null;
        else if (rec.over_25 === true) label = 'over 2.5';
        else if (rec.btts === true) label = 'btts yes';
        else if (typeof rec.selection === 'string') label = rec.selection.toLowerCase();
      } else if (Array.isArray(rec) && rec.length) {
        const first = rec[0];
        const s = typeof first === 'string' ? first : first?.selection ?? first?.pick ?? first?.bet;
        if (typeof s === 'string') label = RESULT_LABEL[s] ?? s.toLowerCase();
      }
      // No recommendations block: their published call is the outcome they name.
      if (!label && mr?.predicted) label = RESULT_LABEL[String(mr.predicted)] ?? null;
      if (!label) continue;

      theirs.set(row.id, {
        label,
        conf: asProb(p.confidence ?? mr?.confidence ?? mr?.prob_home) ?? null,
      });
    }
  }),
);

// ------------------------------------------------------------- report

const pct = (h: number, n: number) => (n ? `${((100 * h) / n).toFixed(1)}%` : '—');
const rate = (sels: Sel[]) => ({ n: sels.length, hit: sels.filter((s) => s.won).length });

const graded = sample.filter((r) => theirs.has(r.id));
const theirSels: Sel[] = [];
const unmatched = new Map<string, number>();
for (const r of graded) {
  const t = theirs.get(r.id)!;
  const s = r.graded.get(t.label);
  if (!s) {
    unmatched.set(t.label, (unmatched.get(t.label) ?? 0) + 1);
    continue;
  }
  theirSels.push(s);
}

console.log(`\nprovider answered for ${graded.length}/${sample.length} matches`);
if (unmatched.size) {
  console.log('labels we could not grade (so not counted):');
  for (const [k, v] of [...unmatched].sort((a, b) => b[1] - a[1])) console.log(`  ${k} x${v}`);
}

const them = rate(theirSels);
console.log(`\n=== the provider, on every match it answered ===`);
console.log(`  hit rate: ${pct(them.hit, them.n)}  (${them.hit}/${them.n})`);
{
  const byMarket = new Map<string, Sel[]>();
  for (const s of theirSels) byMarket.set(s.market, [...(byMarket.get(s.market) ?? []), s]);
  for (const [m, list] of byMarket) {
    const r = rate(list);
    console.log(`    ${m.padEnd(6)} ${pct(r.hit, r.n)}  (${r.hit}/${r.n})`);
  }
}

// Ours at the same volume: our most confident N picks, where N is how many they
// published. Publishing less is how a hit rate is inflated, so the comparison
// only means something if both sides publish the same number.
const oursAll = sample.map((r) => r.ours);
const oursRanked = [...oursAll].sort((a, b) => b.prob - a.prob);
const oursMatched = oursRanked.slice(0, them.n);
const om = rate(oursMatched);

console.log(`\n=== us, same matches, same number of picks (${them.n}) ===`);
console.log(`  hit rate: ${pct(om.hit, om.n)}  (${om.hit}/${om.n})`);
{
  const byMarket = new Map<string, Sel[]>();
  for (const s of oursMatched) byMarket.set(s.market, [...(byMarket.get(s.market) ?? []), s]);
  for (const [m, list] of byMarket) {
    const r = rate(list);
    console.log(`    ${m.padEnd(6)} ${pct(r.hit, r.n)}  (${r.hit}/${r.n})`);
  }
}

console.log(`\n=== us, by how selective we are ===`);
console.log(`  a hit rate is a choice of volume, not a property of a model.`);
for (const frac of [1, 0.6, 0.4, 0.25, 0.1]) {
  const cut = oursRanked.slice(0, Math.max(1, Math.round(oursRanked.length * frac)));
  const r = rate(cut);
  const minP = Math.min(...cut.map((s) => s.prob));
  console.log(
    `  top ${String(Math.round(frac * 100)).padStart(3)}%  ${pct(r.hit, r.n)}  (${r.hit}/${r.n})` +
      `  model prob >= ${minP.toFixed(2)}  break-even odds ${(r.n / Math.max(1, r.hit)).toFixed(2)}`,
  );
}

console.log(`\n=== what these picks actually are ===`);
console.log(`  a hit rate without its base rate says nothing. "Over 1.5" lands ~78% unaided.`);
const counts = new Map<string, { n: number; hit: number }>();
for (const s of oursMatched) {
  const c = counts.get(s.label) ?? { n: 0, hit: 0 };
  c.n++;
  if (s.won) c.hit++;
  counts.set(s.label, c);
}
for (const [label, c] of [...counts].sort((a, b) => b[1].n - a[1].n)) {
  console.log(`  ours: ${label.padEnd(10)} ${String(c.n).padStart(4)} picks  ${pct(c.hit, c.n)}`);
}
const tCounts = new Map<string, { n: number; hit: number }>();
for (const s of theirSels) {
  const c = tCounts.get(s.label) ?? { n: 0, hit: 0 };
  c.n++;
  if (s.won) c.hit++;
  tCounts.set(s.label, c);
}
for (const [label, c] of [...tCounts].sort((a, b) => b[1].n - a[1].n)) {
  console.log(`  them: ${label.padEnd(10)} ${String(c.n).padStart(4)} picks  ${pct(c.hit, c.n)}`);
}

console.log(`\nprovider requests: ${stats.requests} (${stats.errors} errors)`);
await closeDb();
