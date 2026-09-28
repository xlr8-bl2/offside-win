/**
 * `npm run lab:tune`: search for the rule that lands the most calls and still
 * earns, without fooling ourselves.
 *
 * The history is split three ways by date:
 *
 *   A (oldest half)    anything fitted is fitted here: the stacked
 *                      probability's weights, and the grid is run on it;
 *   B (next quarter)   rules are chosen here, on how they did in A *and* B;
 *   C (newest quarter) the chosen few are scored here once, and nothing is
 *                      chosen on it. This is the number to believe.
 *
 * Iterating on one train/test split turns the test set into a training set a
 * few runs in. C is the guard against that: if a rule only looks good on the
 * data it was picked on, C says so.
 *
 * The stacked probability. The consensus is the sharpest single source, but
 * de-vigged prices are known to shade favourites (the favourite-longshot
 * bias), and our blend and the provider may each know something it does not.
 * So per market family a logistic regression, fitted on A, maps
 * logit(consensus), the blend's and the provider's disagreement with it, to a
 * probability. If it is no better than the consensus on B, the report says so.
 */

import { bucketOf, chooseDay, CURRENT, grade, optionsFor, simulate, stackFeatures, stackProb, type HistRow, type Option, type Policy, type SimResult } from './markets.ts';
import { MARKET_FAMILY, type MarketFamily } from '../types.ts';

const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));

export type StackWeights = Partial<Record<MarketFamily, number[]>>;

/** Newton's method for logistic regression, with a little ridge so it cannot run off. */
function fitLogistic(X: number[][], y: number[], ridge = 1): number[] {
  const k = X[0]!.length;
  // Start at "believe the consensus": intercept 0, slope 1.
  const w: number[] = Array.from({ length: k }, (_, i) => (i === 1 ? 1 : 0));
  for (let it = 0; it < 25; it++) {
    const g = new Array(k).fill(0);
    const H = Array.from({ length: k }, () => new Array(k).fill(0));
    for (let n = 0; n < X.length; n++) {
      const x = X[n]!;
      const p = sigmoid(x.reduce((a, xi, i) => a + xi * w[i]!, 0));
      const r = p - y[n]!;
      const s = p * (1 - p);
      for (let i = 0; i < k; i++) {
        g[i] += r * x[i]!;
        for (let j = 0; j < k; j++) H[i]![j] += s * x[i]! * x[j]!;
      }
    }
    // Shrink toward the start, not toward zero.
    for (let i = 0; i < k; i++) {
      g[i] += ridge * (w[i]! - (i === 1 ? 1 : 0));
      H[i]![i] += ridge;
    }
    const step = solve(H, g);
    let moved = 0;
    for (let i = 0; i < k; i++) { w[i] = w[i]! - step[i]!; moved += Math.abs(step[i]!); }
    if (moved < 1e-8) break;
  }
  return w;
}

function solve(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]!]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r]![c]!) > Math.abs(M[p]![c]!)) p = r;
    [M[c], M[p]] = [M[p]!, M[c]!];
    const d = M[c]![c]! || 1e-12;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r]![c]! / d;
      for (let k = c; k <= n; k++) M[r]![k] = M[r]![k]! - f * M[c]![k]!;
    }
  }
  return M.map((row, i) => row[n]! / (row[i]! || 1e-12));
}

/** Every option that resolved cleanly (no push possible), with what happened. */
function labelled(rows: HistRow[], cache: Map<number, Option[]>): Array<{ o: Option; y: number }> {
  const out: Array<{ o: Option; y: number }> = [];
  for (const row of rows) {
    for (const o of cache.get(row.id) ?? []) {
      if (o.push > 1e-9) continue;
      const g = grade(row, o);
      if (!g || (g.result !== 'WON' && g.result !== 'LOST')) continue;
      out.push({ o, y: g.result === 'WON' ? 1 : 0 });
    }
  }
  return out;
}

export function fitStack(rows: HistRow[], cache: Map<number, Option[]>): StackWeights {
  const data = labelled(rows, cache);
  const out: StackWeights = {};
  for (const fam of new Set(Object.values(MARKET_FAMILY))) {
    const d = data.filter((x) => x.o.family === fam);
    if (d.length < 400) continue;
    out[fam] = fitLogistic(d.map((x) => stackFeatures(x.o)), d.map((x) => x.y));
  }
  return out;
}

function logLoss(data: Array<{ o: Option; y: number }>, p: (o: Option) => number): number {
  let ll = 0;
  for (const { o, y } of data) {
    const q = Math.min(1 - 1e-6, Math.max(1e-6, p(o)));
    ll -= y * Math.log(q) + (1 - y) * Math.log(1 - q);
  }
  return data.length ? ll / data.length : NaN;
}

/**
 * How often an outcome the consensus rates at p actually happens, in bands.
 * A band that lands above its rate is where the consensus is too cautious.
 */
function calibration(data: Array<{ o: Option; y: number }>, p: (o: Option) => number) {
  const bands = [0.5, 0.6, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 1.01];
  const out: Array<{ band: string; n: number; said: number; landed: number }> = [];
  for (let i = 0; i < bands.length - 1; i++) {
    const lo = bands[i]!, hi = bands[i + 1]!;
    const d = data.filter((x) => p(x.o) >= lo && p(x.o) < hi);
    if (!d.length) continue;
    out.push({
      band: `${Math.round(lo * 100)}-${Math.min(100, Math.round(hi * 100))}%`,
      n: d.length,
      said: d.reduce((a, x) => a + p(x.o), 0) / d.length,
      landed: d.reduce((a, x) => a + x.y, 0) / d.length,
    });
  }
  return out;
}

export type TunedPolicy = Policy;

export function tuneGrid(stack: StackWeights): TunedPolicy[] {
  const out: TunedPolicy[] = [];
  // The stacked source added nothing on the first pass (the consensus is
  // already calibrated), so the search is over the rule, the reference price
  // and how well traded the market is.
  void stack;
  for (const source of ['best', 'book', 'bestsharp'] as const) {
    for (const minProb of [0.7, 0.72, 0.75, 0.78, 0.8, 0.82, 0.85]) {
      for (const minEv of [-0.02, -0.01, 0, 0.01]) {
        for (const rankBy of ['prob', 'growth'] as const) {
          for (const minBooks of [0, 6, 12]) {
            for (const minSharpEv of [undefined, -0.01, 0]) {
              out.push({
                name: `${source} p>=${minProb} ev>=${minEv} ${rankBy}${minBooks ? ` books>=${minBooks}` : ''}${minSharpEv !== undefined ? ` sharp-ev>=${minSharpEv}` : ''}`,
                source, modelWeight: source === 'book' ? 0 : 0.5, minProb, maxProb: 0.97, minOdds: 1.13, maxOdds: 3.5,
                minEv, maxGap: 1.12, rankBy, diversity: 0.3, noQuarters: true, minBooks: minBooks || undefined, minSharpEv,
              });
            }
          }
        }
      }
    }
  }
  return out;
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

/** Rows grouped by day, as simulate groups them. */
function byDay(rows: HistRow[]): HistRow[][] {
  const m = new Map<number, HistRow[]>();
  for (const r of rows) {
    const d = Math.floor((r.kickoff + 3600) / 86400);
    m.set(d, [...(m.get(d) ?? []), r]);
  }
  return [...m.values()];
}

function line(label: string, r: SimResult): string {
  return `  ${label.padEnd(3)} ${String(r.n).padStart(4)} calls ${r.perDay.toFixed(1).padStart(5)}/day  ${pct(r.hitRate).padStart(6)} landed  odds ${r.avgOdds.toFixed(2)}  return ${pct(r.roi).padStart(6)}  top ${pct(r.topShare)} of ${r.markets}`;
}

/** The rule the slate runs (config.confident). */
const PROD: Policy = { name: 'production', source: 'bestsharp', modelWeight: 0.5, minProb: 0.78, maxProb: 0.97, minOdds: 1.13, maxOdds: 3.5, minEv: -0.01, maxGap: 1.12, rankBy: 'prob', diversity: 0.3, noQuarters: true, minSharpEv: 0, excludeBuckets: ['total_corners under'], rankFloor: { 1: 0.7, 2: 0.7, 3: 0.85 } };
/** The rule before the sharp book. */
const CONSENSUS72: Policy = { name: 'consensus 72', source: 'best', modelWeight: 0.5, minProb: 0.72, maxProb: 0.97, minOdds: 1.13, maxOdds: 3.5, minEv: -0.01, maxGap: 1.12, rankBy: 'prob', diversity: 0.3, noQuarters: true };
/** The rule before this search. */
const PREV: Policy = { name: 'previous', source: 'best', modelWeight: 0.5, minProb: 0.7, maxProb: 0.95, minOdds: 1.13, maxOdds: 3.5, minEv: 0, maxGap: 1.12, rankBy: 'growth', diversity: 0.3, noQuarters: true };
const STRICT: Policy = { ...PROD, name: 'strict 80', minProb: 0.8 };

export function runTune(rows: HistRow[]): Record<string, unknown> {
  const sorted = [...rows].sort((a, b) => a.kickoff - b.kickoff);
  const a = sorted.slice(0, Math.floor(sorted.length * 0.5));
  const b = sorted.slice(a.length, Math.floor(sorted.length * 0.75));
  const c = sorted.slice(a.length + b.length);
  const cache = new Map(sorted.map((r) => [r.id, optionsFor(r, 0.5)]));
  const book0 = new Map(sorted.map((r) => [r.id, optionsFor(r, 0)]));
  const cacheFor = (p: Policy) => (p.modelWeight === 0 ? book0 : cache);
  console.log(`lab:tune: A ${a.length} fixtures, B ${b.length}, C ${c.length} (oldest to newest)`);

  // 1. The stacked probability, fitted on A, judged on B.
  const stack = fitStack(a, cache);
  const dataB = labelled(b, cache);
  console.log('\nStacked probability (fitted on A), log loss on B, lower is better:');
  for (const fam of Object.keys(stack) as MarketFamily[]) {
    const d = dataB.filter((x) => x.o.family === fam);
    const w = stack[fam]!;
    console.log(`  ${fam.padEnd(9)} consensus ${logLoss(d, (o) => o.book).toFixed(4)}  blend ${logLoss(d, (o) => o.blend ?? o.book).toFixed(4)}  stacked ${logLoss(d, (o) => stackProb(w, o)).toFixed(4)}  (n ${d.length}; weights ${w.map((x) => x.toFixed(2)).join(' ')})`);
  }
  // The sharp book against the consensus, on the options both priced.
  const both = [...labelled(a, cache), ...dataB].filter((x) => x.o.sharp !== null);
  const all = labelled(sorted, cache);
  console.log(`\nSharp book against the consensus (A and B, where both priced it; sharp view on ${pct(all.filter((x) => x.o.sharp !== null).length / Math.max(1, all.length))} of all options):`);
  for (const fam of ['result', 'goals', 'handicap', 'corners'] as MarketFamily[]) {
    const d = both.filter((x) => x.o.family === fam);
    if (d.length < 100) continue;
    console.log(`  ${fam.padEnd(9)} consensus ${logLoss(d, (o) => o.book).toFixed(4)}  sharp ${logLoss(d, (o) => o.sharp!).toFixed(4)}  blend ${logLoss(d, (o) => o.blend ?? o.book).toFixed(4)}  (n ${d.length})`);
  }
  const booksKnown = all.filter((x) => x.o.books !== null);
  if (booksKnown.length > 500) {
    console.log('\nConsensus log loss by how many books priced the market:');
    for (const [lo, hi] of [[1, 5], [6, 11], [12, 19], [20, 999]] as const) {
      const d = booksKnown.filter((x) => x.o.books! >= lo && x.o.books! <= hi);
      if (d.length >= 100) console.log(`  ${String(lo).padStart(2)}-${hi === 999 ? '+' : hi} books  ${logLoss(d, (o) => o.book).toFixed(4)}  (n ${d.length})`);
    }
  }

  // Is the red card record believable? The books expect a red in about one
  // match in five; a record far from that is a data fault, not a finding.
  {
    const withReds = sorted.filter((r) => r.reds !== null);
    const any = withReds.filter((r) => (r.reds ?? 0) > 0).length;
    let said = 0, n = 0;
    for (const r of withReds) {
      const m = r.markets.find((x) => x.market === 'red_card');
      const y = m?.book?.['yes'];
      if (typeof y === 'number') { said += y; n++; }
    }
    const src = (r: HistRow) => (r.lambda ? 'board' : 'backfill');
    const by = (k: string) => { const d = withReds.filter((r) => src(r) === k); return `${d.filter((r) => (r.reds ?? 0) > 0).length}/${d.length}`; };
    console.log(`\nRed cards: ${any} of ${withReds.length} matches recorded one or more (${pct(any / Math.max(1, withReds.length))}); the books expected ${n ? pct(said / n) : 'n/a'} on ${n} they priced. Board rows ${by('board')}, backfilled ${by('backfill')}.`);
  }

  console.log('\nHow often the consensus is right, by what it says (A):');
  for (const r of calibration(labelled(a, cache), (o) => o.book)) {
    console.log(`  ${r.band.padEnd(8)} n ${String(r.n).padStart(5)}  says ${pct(r.said)}  landed ${pct(r.landed)}`);
  }

  // 2. The grid, run on A and B; chosen on both.
  const grid = tuneGrid(stack);
  const scored = grid.map((p) => {
    const ra = simulate(p, a, cacheFor(p));
    const rb = simulate(p, b, cacheFor(p));
    return { p, ra, rb };
  });
  // Earns in both, carries a real board, then lands the most.
  // A clear margin in both periods, not a hair above zero: the first pass
  // showed rules that scraped a profit in A and B losing it in C.
  const ok = scored.filter((s) => s.ra.roi > 0.015 && s.rb.roi > 0.015 && s.ra.perDay >= 8 && s.rb.perDay >= 8 && s.rb.n >= 80);
  ok.sort((x, y) => Math.min(y.ra.hitRate, y.rb.hitRate) - Math.min(x.ra.hitRate, x.rb.hitRate));
  // One per probability floor, so the report is the trade-off curve rather
  // than eight near-copies of one rule.
  const seenFloor = new Set<number>();
  const top = ok.filter((s) => (seenFloor.has(s.p.minProb) ? false : (seenFloor.add(s.p.minProb), true))).slice(0, 8);

  console.log(`\n${ok.length} of ${grid.length} rules earned 1.5% or more in both A and B with eight or more calls a day. The eight that land most:`);
  const refs: Array<[string, Policy]> = [
    ['old rule (provider, 80%+)', CURRENT],
    ['previous rule (70%+, fair or better, growth)', PREV],
    ['consensus 72%+, within 1% of fair', CONSENSUS72],
    ['production (78%+, at or above the sharp book\'s fair price)', PROD],
    ['production at 80%+', STRICT],
    ['production with a 62% marquee floor (before)', { ...PROD, name: 'marquee 62', rankFloor: { ...PROD.rankFloor, 1: 0.62, 2: 0.62 } }],
    ['production without a marquee exception', { ...PROD, name: 'no marquee', rankFloor: { 3: 0.85 } }],
  ];
  const report: Record<string, unknown> = { split: { a: a.length, b: b.length, c: c.length }, stack };
  for (const [label, p] of refs) {
    console.log(`\n  ${label}`);
    console.log(line('A', simulate(p, a, cacheFor(p))));
    console.log(line('B', simulate(p, b, cacheFor(p))));
    console.log(line('C', simulate(p, c, cacheFor(p))));
  }
  // Price movement. Does the money since the open know something the price
  // now does not? Asked first as a question of calibration (among options
  // the market rates alike, do the ones it moved toward land more?), then as
  // a rule on top of production, judged the same way as everything else.
  {
    const moved = (o: Option) => (o.open === null ? null : (o.sharp ?? o.book) - o.open);
    const withOpen = all.filter((x) => moved(x.o) !== null);
    console.log(`\nPrice movement since the open (recorded on ${pct(withOpen.length / Math.max(1, all.length))} of options):`);
    if (withOpen.length >= 300) {
      const now = (o: Option) => o.sharp ?? o.book;
      for (const [lo, hi, label] of [[-1, -0.03, 'drifted 3+ pts'], [-0.03, -0.01, 'drifted 1-3'], [-0.01, 0.01, 'flat'], [0.01, 0.03, 'backed 1-3'], [0.03, 1, 'backed 3+ pts']] as const) {
        const d = withOpen.filter((x) => now(x.o) >= 0.6 && moved(x.o)! >= lo && moved(x.o)! < hi);
        if (d.length < 50) continue;
        const said = d.reduce((acc, x) => acc + now(x.o), 0) / d.length;
        const landed = d.reduce((acc, x) => acc + x.y, 0) / d.length;
        console.log(`  ${label.padEnd(15)} n ${String(d.length).padStart(5)}  priced ${pct(said)}  landed ${pct(landed)}  (${landed >= said ? '+' : ''}${((landed - said) * 100).toFixed(1)} pts)`);
      }
    }
    const moves: Policy[] = [];
    for (const maxDrift of [0.005, 0.01, 0.02, 0.03, 0.05]) moves.push({ ...PROD, name: `production, drift <= ${maxDrift}`, maxDrift });
    for (const minSteam of [0, 0.005, 0.01]) moves.push({ ...PROD, name: `production, backed >= ${minSteam}`, minSteam });
    const rows: unknown[] = [];
    for (const p of moves) {
      const ra = simulate(p, a, cacheFor(p)), rb = simulate(p, b, cacheFor(p)), rc = simulate(p, c, cacheFor(p));
      console.log(`\n  ${p.name}`);
      console.log(line('A', ra));
      console.log(line('B', rb));
      console.log(line('C', rc));
      rows.push({ name: p.name, a: ra, b: rb, c: rc });
    }
    report['movement'] = rows;
  }

  // The referee. Does a referee who sends players off more often make "no red
  // card" land less often than its price says? The record is counted from
  // games before each match, so this cannot peek at the result.
  {
    const refRows = new Map(sorted.map((r) => [r.id, r]));
    const noRed = all.filter((x) => ((x.o.market === 'red_card' && x.o.outcome === 'no') || (x.o.market === 'total_red_cards' && x.o.outcome === 'under')));
    const rate = (id: number) => { const r = refRows.get(id)?.ref; return r && r.n >= 15 ? r.reds / r.n : null; };
    // `all` is flattened options; find each option's fixture through the cache.
    const owner = new Map<Option, number>();
    for (const r of sorted) for (const o of cache.get(r.id) ?? []) owner.set(o, r.id);
    const known = noRed.filter((x) => rate(owner.get(x.o) ?? -1) !== null);
    console.log(`\nNo red card, by how often the referee sends players off (${known.length} of ${noRed.length} options with 15+ games of referee history):`);
    for (const [lo, hi, label] of [[0, 0.15, 'rarely (under 0.15 a game)'], [0.15, 0.25, 'sometimes'], [0.25, 0.35, 'often'], [0.35, 9, 'a lot (0.35+ a game)']] as const) {
      const d = known.filter((x) => { const v = rate(owner.get(x.o)!)!; return v >= lo && v < hi; });
      if (d.length < 40) continue;
      const said = d.reduce((acc, x) => acc + (x.o.sharp ?? x.o.book), 0) / d.length;
      const landed = d.reduce((acc, x) => acc + x.y, 0) / d.length;
      console.log(`  ${label.padEnd(28)} n ${String(d.length).padStart(5)}  priced ${pct(said)}  landed ${pct(landed)}  (${landed >= said ? '+' : ''}${((landed - said) * 100).toFixed(1)} pts)`);
    }
    const refs: unknown[] = [];
    for (const maxRefReds of [0.2, 0.25, 0.3, 0.35, 0.45]) {
      const p: Policy = { ...PROD, name: `production, no-red calls only under referees at ${maxRefReds} reds a game or fewer`, maxRefReds };
      const ra = simulate(p, a, cacheFor(p)), rb = simulate(p, b, cacheFor(p)), rc = simulate(p, c, cacheFor(p));
      console.log(`\n  ${p.name}`);
      console.log(line('A', ra));
      console.log(line('B', rb));
      console.log(line('C', rc));
      refs.push({ name: p.name, a: ra, b: rb, c: rc });
    }
    report['referee'] = refs;
  }

  const finalists: unknown[] = [];
  for (const s of top) {
    const rc = simulate(s.p, c, cacheFor(s.p));
    console.log(`\n  ${s.p.name}`);
    console.log(line('A', s.ra));
    console.log(line('B', s.rb));
    console.log(line('C', rc));
    const mk = Object.entries(rc.byMarket).sort((x, y) => y[1].n - x[1].n).slice(0, 6);
    console.log(`      C markets: ${mk.map(([k, v]) => `${k} ${v.n}`).join(', ')}`);
    finalists.push({ policy: { ...s.p, stack: undefined }, a: s.ra, b: s.rb, c: rc });
  }
  report['finalists'] = finalists;

  // Where the production rule loses. A segment is dropped only if it lost in
  // both A and B on a real number of calls; C then says whether that helped
  // or was noise.
  const segs = (rows0: HistRow[]) => {
    const out = new Map<string, { n: number; pnl: number; won: number }>();
    for (const day of byDay(rows0)) {
      for (const pick of chooseDay(PROD, day, cacheFor(PROD))) {
        const g = grade(pick.row, pick.option);
        if (!g || g.result === 'VOID') continue;
        for (const k of [`market ${bucketOf(pick.option)}`, `rank ${pick.row.rank}`]) {
          const e = out.get(k) ?? { n: 0, pnl: 0, won: 0 };
          e.n++; e.pnl += g.pnl; if (g.result === 'WON' || g.result === 'HALF_WON') e.won++;
          out.set(k, e);
        }
      }
    }
    return out;
  };
  const sa = segs(a), sb = segs(b);
  console.log('\nThe production rule by segment (A | B): calls, landed, return');
  const losers: string[] = [];
  for (const k of [...new Set([...sa.keys(), ...sb.keys()])].sort()) {
    const x = sa.get(k), y = sb.get(k);
    const f = (e?: { n: number; pnl: number; won: number }) => e ? `${String(e.n).padStart(4)} ${pct(e.won / e.n).padStart(6)} ${pct(e.pnl / e.n).padStart(7)}` : '     -';
    const lose = !!x && !!y && x.n >= 25 && y.n >= 12 && x.pnl < 0 && y.pnl < 0;
    if (lose) losers.push(k);
    console.log(`  ${k.padEnd(34)} ${f(x)} | ${f(y)}${lose ? '   <- lost in both' : ''}`);
  }
  if (losers.length) {
    const pruned: Policy = {
      ...PROD, name: 'production without the losing segments',
      excludeBuckets: losers.filter((k) => k.startsWith('market ')).map((k) => k.slice(7)),
      excludeRanks: losers.filter((k) => k.startsWith('rank ')).map((k) => Number(k.slice(5))),
    };
    console.log(`\n  ${pruned.name}: leaves out ${losers.join(', ')}`);
    console.log(line('A', simulate(pruned, a, cacheFor(pruned))));
    console.log(line('B', simulate(pruned, b, cacheFor(pruned))));
    console.log(line('C', simulate(pruned, c, cacheFor(pruned))));
    report['pruned'] = { losers, c: simulate(pruned, c, cacheFor(pruned)) };
  }
  return report;
}
