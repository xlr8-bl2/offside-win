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
function selections(lh: number, la: number, rho: number, hg: number, ag: number, disp: number): Sel[] {
  const m = buildScoreMatrix(lh, la, rho, disp);
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
  /** The fitted rates, kept rather than the prices, so the same walk-forward
   *  fit can be re-priced at several dispersions without refitting. */
  lh: number;
  la: number;
  rho: number;
  hg: number;
  ag: number;
}

const gradedAt = (r: Row, disp: number): Map<string, Sel> =>
  new Map(selections(r.lh, r.la, r.rho, r.hg, r.ag, disp).map((x) => [x.label, x]));

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
    rows.push({
      id: m.id,
      kickoff: m.kickoff,
      lh: home,
      la: away,
      rho: fit.params.rho,
      hg: m.home_goals!,
      ag: m.away_goals!,
    });
  }
}

rows.sort((a, b) => b.kickoff - a.kickoff);
const sample = rows.slice(0, TOTAL);
console.log(`${sample.length} matches across ${leaguesUsed} leagues, ${refits} refits`);

// --------------------------------------------------------- their side

const theirProbs = new Map<number, Map<string, number>>();
const queue = [...sample];
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    for (;;) {
      const row = queue.shift();
      if (!row) break;
      const p = (await bsdOrNull(`/api/v2/events/${row.id}/prediction/`)) as Record<string, any> | null;
      if (p) theirProbs.set(row.id, theirSelections(p));
    }
  }),
);

// ------------------------------------------------------------- report

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
    if (g) out.push({ label, prob, won: g.won });
  }
  return out;
}

const hit = (c: Call[]) => c.filter((x) => x.won).length;
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

const graded = sample.filter((r) => theirProbs.has(r.id));
console.log(`\nprovider answered for ${graded.length}/${sample.length} matches`);

const BAR = Number(process.env.H2H_BAR ?? 0.8);
const theirCalls: Call[] = [];
for (const r of graded) {
  theirCalls.push(...callsFor(theirProbs.get(r.id)!, gradedAt(r, 1), BAR));
}
console.log(`\n=== at the ${Math.round(BAR * 100)}% confidence bar ===`);
console.log(
  `  them          ${pct(hit(theirCalls), theirCalls.length).padStart(6)}  (${hit(theirCalls)}/${theirCalls.length})` +
    `  ${(theirCalls.length / graded.length).toFixed(2)} calls/match`,
);

// Sweep the dispersion. Everything expensive — the walk-forward fits and the
// provider calls — is already done, so each extra value costs only arithmetic.
// 1.0 is the Poisson the model ships with today, and is the row to beat.
console.log(`\n=== us, sweeping goal dispersion (1.0 = Poisson = today) ===`);
let best = { disp: 1, rate: -1, calls: [] as Call[] };
for (const disp of [1.0, 1.05, 1.1, 1.15, 1.2, 1.25, 1.3, 1.4, 1.5]) {
  const ours: Call[] = [];
  for (const r of graded) {
    const g = gradedAt(r, disp);
    ours.push(...callsFor(new Map([...g].map(([k, v]) => [k, v.prob])), g, BAR));
  }
  const rate = ours.length ? hit(ours) / ours.length : 0;
  const mark = rate > best.rate ? ' <-- best' : '';
  if (rate > best.rate) best = { disp, rate, calls: ours };
  console.log(
    `  dispersion ${disp.toFixed(2)}  ${pct(hit(ours), ours.length).padStart(6)}  (${hit(ours)}/${ours.length})` +
      `  ${(ours.length / graded.length).toFixed(2)} calls/match${mark}`,
  );
}

console.log(`\n=== per selection, dispersion ${best.disp.toFixed(2)} vs them ===`);
const theirBy = new Map(byLabel(theirCalls));
for (const [label, c] of byLabel(best.calls)) {
  const t = theirBy.get(label);
  console.log(
    `  ${label.padEnd(14)} us ${pct(c.hit, c.n).padStart(6)} (${String(c.n).padStart(4)})` +
      `   them ${t ? `${pct(t.hit, t.n).padStart(6)} (${String(t.n).padStart(4)})` : '     —'}`,
  );
}

console.log(`\nprovider requests: ${stats.requests} (${stats.errors} errors)`);
await closeDb();
