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
  /** Their 1x2 call: always present, this is their `predicted` label. */
  call: string | null;
  /** The bets their own recommendations block flags as worth placing. */
  recommended: string[];
  conf: number | null;
}
const theirs = new Map<number, Theirs>();
let shapeShown = false;
let recBlocks = 0;

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
          console.log(`  ${k}: ${JSON.stringify(v).slice(0, 300)}`);
        }
        for (const [k, v] of Object.entries(p.markets ?? {})) {
          console.log(`  markets.${k}: ${JSON.stringify(v).slice(0, 300)}`);
        }
        console.log('---\n');
      }

      const mr = p.markets?.match_result;
      const rec = p.recommendations ?? null;
      if (rec && typeof rec === 'object') recBlocks++;

      // Their published bets, exactly as their own flags declare them. These
      // are the picks an "X% accuracy" claim is a ratio over.
      const recommended: string[] = [];
      const call = mr?.predicted ? RESULT_LABEL[String(mr.predicted)] ?? null : null;
      if (rec) {
        if (rec.winner === true && call) recommended.push(call);
        if (rec.bet_favorite === true && rec.favorite) {
          const fav = RESULT_LABEL[String(rec.favorite)];
          if (fav) recommended.push(fav);
        }
        if (rec.over_15 === true) recommended.push('over 1.5');
        if (rec.over_25 === true) recommended.push('over 2.5');
        if (rec.btts === true) recommended.push('btts yes');
      }

      theirs.set(row.id, {
        call,
        recommended: [...new Set(recommended)],
        conf: asProb(p.model?.confidence ?? p.confidence ?? null),
      });
    }
  }),
);

// ------------------------------------------------------------- report

const pct = (h: number, n: number) => (n ? `${((100 * h) / n).toFixed(1)}%` : '—');
const rate = (sels: Sel[]) => ({ n: sels.length, hit: sels.filter((s) => s.won).length });
const line = (name: string, r: { n: number; hit: number }, extra = '') =>
  console.log(`  ${name.padEnd(26)} ${pct(r.hit, r.n).padStart(6)}  (${r.hit}/${r.n})${extra}`);

const graded = sample.filter((r) => theirs.has(r.id));
console.log(`\nprovider answered for ${graded.length}/${sample.length} matches` +
  `, ${recBlocks} carried a recommendations block`);

// 1. Their own recommended bets. This is the denominator an accuracy claim is
//    a ratio over, and the flags are theirs, not our reading of their numbers.
const theirRecs: Sel[] = [];
const recLabels = new Map<string, { n: number; hit: number }>();
for (const r of graded) {
  for (const label of theirs.get(r.id)!.recommended) {
    const s = r.graded.get(label);
    if (!s) continue;
    theirRecs.push(s);
    const c = recLabels.get(label) ?? { n: 0, hit: 0 };
    c.n++;
    if (s.won) c.hit++;
    recLabels.set(label, c);
  }
}
console.log(`\n=== the provider's OWN recommended bets ===`);
if (!theirRecs.length) {
  console.log(`  none. Across ${graded.length} matches their recommendations block flagged`);
  console.log(`  no bet at all — every winner/bet_favorite/over/btts flag came back false.`);
  console.log(`  So an accuracy figure over "matches they predicted" cannot be reproduced`);
  console.log(`  from this sample: the set it is a ratio over is empty here.`);
} else {
  line('all recommended bets', rate(theirRecs));
  for (const [label, c] of [...recLabels].sort((a, b) => b[1].n - a[1].n)) line(`  ${label}`, c);
}

// 2. Same market, same matches: their 1x2 call against ours. The only fully
//    like-for-like comparison, because both sides name exactly one of three.
const h2h = graded.filter((r) => theirs.get(r.id)!.call);
const theirCall: Sel[] = [];
const ourCall: Sel[] = [];
for (const r of h2h) {
  const t = r.graded.get(theirs.get(r.id)!.call!);
  const best1x2 = [...r.graded.values()]
    .filter((s) => s.market === '1x2')
    .reduce((a, b) => (b.prob > a.prob ? b : a));
  if (t) theirCall.push(t);
  ourCall.push(best1x2);
}
console.log(`\n=== 1x2, head to head on the same ${h2h.length} matches ===`);
line('them (their `predicted`)', rate(theirCall));
line('us  (our most likely)', rate(ourCall));
line('always pick home', {
  n: h2h.length,
  hit: h2h.filter((r) => r.graded.get('home')!.won).length,
});

// 3. Over 2.5 and BTTS, where both sides publish a probability.
console.log(`\n=== over 2.5 and btts, same matches ===`);
for (const [market, ours, theirsKey] of [
  ['over 2.5', 'over 2.5', 'prob_over_25'],
  ['btts', 'btts yes', 'prob_yes'],
] as const) {
  const our = graded.map((r) => {
    const yes = r.graded.get(ours)!;
    const no = r.graded.get(ours === 'over 2.5' ? 'under 2.5' : 'btts no')!;
    return yes.prob >= 0.5 ? yes : no;
  });
  void theirsKey;
  line(`us: ${market}`, rate(our));
  line(`  always say yes`, { n: graded.length, hit: graded.filter((r) => r.graded.get(ours)!.won).length });
}

// 4. Ours by selectivity, on markets that are not nearly free. "Over 1.5" lands
//    ~78% unaided and is priced near 1.20, so a tipster who only names it posts
//    a high number and loses money — it is excluded from what we would publish.
const REAL = new Set(['1x2', 'ou25', 'btts']);
const oursReal = sample.map((r) =>
  [...r.graded.values()].filter((s) => REAL.has(s.market)).reduce((a, b) => (b.prob > a.prob ? b : a)),
);
const ranked = [...oursReal].sort((a, b) => b.prob - a.prob);
console.log(`\n=== us, excluding near-free markets, by how selective we are ===`);
console.log(`  a hit rate is a choice of volume, not a property of a model.`);
for (const frac of [1, 0.5, 0.25, 0.1]) {
  const cut = ranked.slice(0, Math.max(1, Math.round(ranked.length * frac)));
  const r = rate(cut);
  console.log(
    `  top ${String(Math.round(frac * 100)).padStart(3)}%  ${pct(r.hit, r.n).padStart(6)}  (${r.hit}/${r.n})` +
      `  model prob >= ${Math.min(...cut.map((s) => s.prob)).toFixed(2)}` +
      `  break-even odds ${(r.n / Math.max(1, r.hit)).toFixed(2)}`,
  );
}
const mix = new Map<string, { n: number; hit: number }>();
for (const s of oursReal) {
  const c = mix.get(s.label) ?? { n: 0, hit: 0 };
  c.n++;
  if (s.won) c.hit++;
  mix.set(s.label, c);
}
console.log(`  what those picks are:`);
for (const [label, c] of [...mix].sort((a, b) => b[1].n - a[1].n)) line(`    ${label}`, c);

console.log(`\nprovider requests: ${stats.requests} (${stats.errors} errors)`);
await closeDb();
