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

/**
 * Every selection either side publishes, priced and graded.
 *
 * The market list is theirs, taken off their own predictions page: double
 * chance ("to win or draw", "to avoid defeat"), over 1.5, under 3.5. Those are
 * the calls an 86.7% is a ratio over, and the first version of this comparison
 * scored 1x2 and over 2.5 instead — a different, harder set of markets, which
 * made the two sides incomparable.
 */
function selections(lh: number, la: number, rho: number, hg: number, ag: number): Sel[] {
  const m = buildScoreMatrix(lh, la, rho);
  const r = priceResult(m);
  const H = r.get('HOME')!;
  const D = r.get('DRAW')!;
  const A = r.get('AWAY')!;
  const o = (line: number) => priceOverUnder(m, line).get('over')!;
  const yes = priceBtts(m).get('yes')!;
  const total = hg + ag;
  return [
    { label: 'home', market: '1x2', prob: H, won: hg > ag },
    { label: 'draw', market: '1x2', prob: D, won: hg === ag },
    { label: 'away', market: '1x2', prob: A, won: hg < ag },
    { label: 'home or draw', market: 'dc', prob: H + D, won: hg >= ag },
    { label: 'away or draw', market: 'dc', prob: A + D, won: ag >= hg },
    { label: 'home or away', market: 'dc', prob: H + A, won: hg !== ag },
    { label: 'over 1.5', market: 'ou', prob: o(1.5), won: total > 1.5 },
    { label: 'under 1.5', market: 'ou', prob: 1 - o(1.5), won: total < 1.5 },
    { label: 'over 2.5', market: 'ou', prob: o(2.5), won: total > 2.5 },
    { label: 'under 2.5', market: 'ou', prob: 1 - o(2.5), won: total < 2.5 },
    { label: 'over 3.5', market: 'ou', prob: o(3.5), won: total > 3.5 },
    { label: 'under 3.5', market: 'ou', prob: 1 - o(3.5), won: total < 3.5 },
    { label: 'btts yes', market: 'btts', prob: yes, won: hg >= 1 && ag >= 1 },
    { label: 'btts no', market: 'btts', prob: 1 - yes, won: !(hg >= 1 && ag >= 1) },
  ];
}

/** The same table from the provider's published probabilities. */
function theirSelections(p: Record<string, any>): Map<string, number> {
  const pc = (v: unknown) => (typeof v === 'number' ? (v > 1 ? v / 100 : v) : null);
  const mr = p.markets?.match_result ?? {};
  const ou = p.markets?.over_under ?? {};
  const H = pc(mr.prob_home);
  const D = pc(mr.prob_draw);
  const A = pc(mr.prob_away);
  const o15 = pc(ou.prob_over_15);
  const o25 = pc(ou.prob_over_25);
  const o35 = pc(ou.prob_over_35);
  const yes = pc(p.markets?.btts?.prob_yes);
  const out = new Map<string, number>();
  const put = (k: string, v: number | null) => {
    if (v !== null && Number.isFinite(v)) out.set(k, v);
  };
  put('home', H);
  put('draw', D);
  put('away', A);
  if (H !== null && D !== null) put('home or draw', H + D);
  if (A !== null && D !== null) put('away or draw', A + D);
  if (H !== null && A !== null) put('home or away', H + A);
  put('over 1.5', o15);
  put('under 1.5', o15 === null ? null : 1 - o15);
  put('over 2.5', o25);
  put('under 2.5', o25 === null ? null : 1 - o25);
  put('over 3.5', o35);
  put('under 3.5', o35 === null ? null : 1 - o35);
  put('btts yes', yes);
  put('btts no', yes === null ? null : 1 - yes);
  return out;
}

interface Row {
  id: number;
  kickoff: number;
  /** Every selection graded, so either side's call can be looked up by label. */
  graded: Map<string, Sel>;
}

// ------------------------------------------------- our side, walk-forward

console.log('fitting our model walk-forward (this is the slow part)...');
const rows: Row[] = [];
let refits = 0;
let leaguesUsed = 0;

for (const league of await trackedLeagues()) {
  const all = (await loadMatches(league.id)).filter(
    (m: MatchRow) => m.home_goals !== null && m.away_goals !== null,
  );
  if (all.length < BURN_IN + 10) continue;
  leaguesUsed++;

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
    rows.push({ id: m.id, kickoff: m.kickoff, graded: new Map(sels.map((x) => [x.label, x])) });
  }
}

rows.sort((a, b) => b.kickoff - a.kickoff);
const sample = rows.slice(0, TOTAL);
console.log(`${sample.length} matches across ${leaguesUsed} leagues, ${refits} refits`);

// --------------------------------------------------------- their side

const theirProbs = new Map<number, Map<string, number>>();
let shapeShown = false;

const queue = [...sample];
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    for (;;) {
      const row = queue.shift();
      if (!row) break;
      const p = (await bsdOrNull(`/api/v2/events/${row.id}/prediction/`)) as Record<string, any> | null;
      if (!p) continue;
      if (!shapeShown) {
        shapeShown = true;
        console.log('\n--- one prediction payload, as it actually arrives ---');
        for (const [k, v] of Object.entries(p)) {
          if (k === 'markets') continue;
          console.log(`  ${k}: ${JSON.stringify(v).slice(0, 240)}`);
        }
        for (const [k, v] of Object.entries(p.markets ?? {})) {
          console.log(`  markets.${k}: ${JSON.stringify(v).slice(0, 240)}`);
        }
        console.log('---\n');
      }
      theirProbs.set(row.id, theirSelections(p));
    }
  }),
);

// ------------------------------------------------------------- report
//
// Their published rule, reconstructed from their own page: every market whose
// probability clears a confidence bar becomes a call, and a match can carry
// several ("+N more"). Applying the identical rule to our probabilities is the
// only comparison that isolates the models rather than the selection policy.

const pct = (h: number, n: number) => (n ? `${((100 * h) / n).toFixed(1)}%` : '—');

interface Call {
  label: string;
  prob: number;
  won: boolean;
}

function callsFor(probs: Map<string, number>, graded: Map<string, Sel>, floor: number): Call[] {
  const out: Call[] = [];
  for (const [label, prob] of probs) {
    if (prob < floor) continue;
    const g = graded.get(label);
    if (!g) continue;
    out.push({ label, prob, won: g.won });
  }
  return out;
}

const graded = sample.filter((r) => theirProbs.has(r.id));
console.log(`\nprovider answered for ${graded.length}/${sample.length} matches`);

for (const floor of [0.8, 0.75, 0.7]) {
  const theirCalls: Call[] = [];
  const ourCalls: Call[] = [];
  for (const r of graded) {
    theirCalls.push(...callsFor(theirProbs.get(r.id)!, r.graded, floor));
    const ourProbs = new Map([...r.graded].map(([k, v]) => [k, v.prob] as const));
    ourCalls.push(...callsFor(ourProbs, r.graded, floor));
  }
  const hit = (c: Call[]) => c.filter((x) => x.won).length;
  const mpp = (c: Call[]) => (c.length / graded.length).toFixed(2);
  // Break-even: a call at hit rate h needs odds above 1/h to make money.
  const be = (c: Call[]) => (c.length ? (c.length / Math.max(1, hit(c))).toFixed(2) : '—');

  console.log(`\n=== every market at or above ${Math.round(floor * 100)}% confidence ===`);
  console.log(
    `  them  ${pct(hit(theirCalls), theirCalls.length).padStart(6)}  ` +
      `(${hit(theirCalls)}/${theirCalls.length})  ${mpp(theirCalls)} calls/match  break-even odds ${be(theirCalls)}`,
  );
  console.log(
    `  us    ${pct(hit(ourCalls), ourCalls.length).padStart(6)}  ` +
      `(${hit(ourCalls)}/${ourCalls.length})  ${mpp(ourCalls)} calls/match  break-even odds ${be(ourCalls)}`,
  );

  // Same markets, same matches, same number of calls: the cleanest read, because
  // it removes any advantage that comes from simply publishing more or less.
  if (ourCalls.length && theirCalls.length) {
    const n = Math.min(ourCalls.length, theirCalls.length);
    const top = (c: Call[]) => [...c].sort((a, b) => b.prob - a.prob).slice(0, n);
    const t = top(theirCalls);
    const u = top(ourCalls);
    console.log(`  at a matched ${n} calls each:  them ${pct(hit(t), n)}   us ${pct(hit(u), n)}`);
  }

  if (floor === 0.8) {
    const byLabel = (c: Call[]) => {
      const m = new Map<string, { n: number; hit: number }>();
      for (const x of c) {
        const e = m.get(x.label) ?? { n: 0, hit: 0 };
        e.n++;
        if (x.won) e.hit++;
        m.set(x.label, e);
      }
      return [...m].sort((a, b) => b[1].n - a[1].n);
    };
    console.log(`  what each side called:`);
    for (const [label, c] of byLabel(theirCalls)) {
      console.log(`    them  ${label.padEnd(14)} ${String(c.n).padStart(5)}  ${pct(c.hit, c.n)}`);
    }
    for (const [label, c] of byLabel(ourCalls)) {
      console.log(`    us    ${label.padEnd(14)} ${String(c.n).padStart(5)}  ${pct(c.hit, c.n)}`);
    }
  }
}

console.log(`\nprovider requests: ${stats.requests} (${stats.errors} errors)`);
await closeDb();
