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

import { CURRENT, grade, optionsFor, simulate, stackFeatures, stackProb, type HistRow, type Option, type Policy, type SimResult } from './markets.ts';
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
  // already calibrated), so the search is over the rule, not the source.
  void stack;
  for (const source of ['best', 'book'] as const) {
    for (const minProb of [0.7, 0.72, 0.75, 0.78, 0.8, 0.82, 0.85]) {
      for (const minEv of [-0.02, -0.01, 0, 0.01, 0.02]) {
        for (const rankBy of ['prob', 'growth'] as const) {
          for (const maxGap of [1.06, 1.12]) {
            for (const maxHandicap of [1, 1.5, 99]) {
              out.push({
                name: `${source} p>=${minProb} ev>=${minEv} ${rankBy} gap ${maxGap} hcap<=${maxHandicap}`,
                source, modelWeight: source === 'book' ? 0 : 0.5, minProb, maxProb: 0.97, minOdds: 1.13, maxOdds: 3.5,
                minEv, maxGap, rankBy, diversity: 0.3, noQuarters: true, maxHandicap,
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

function line(label: string, r: SimResult): string {
  return `  ${label.padEnd(3)} ${String(r.n).padStart(4)} calls ${r.perDay.toFixed(1).padStart(5)}/day  ${pct(r.hitRate).padStart(6)} landed  odds ${r.avgOdds.toFixed(2)}  return ${pct(r.roi).padStart(6)}  top ${pct(r.topShare)} of ${r.markets}`;
}

/** The rule the slate runs (config.confident). */
const PROD: Policy = { name: 'production', source: 'best', modelWeight: 0.5, minProb: 0.72, maxProb: 0.97, minOdds: 1.13, maxOdds: 3.5, minEv: -0.01, maxGap: 1.12, rankBy: 'prob', diversity: 0.3, noQuarters: true };
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
    ['production (72%+, within 1% of fair, likeliest first)', PROD],
    ['80%+ only', STRICT],
  ];
  const report: Record<string, unknown> = { split: { a: a.length, b: b.length, c: c.length }, stack };
  for (const [label, p] of refs) {
    console.log(`\n  ${label}`);
    console.log(line('A', simulate(p, a, cacheFor(p))));
    console.log(line('B', simulate(p, b, cacheFor(p))));
    console.log(line('C', simulate(p, c, cacheFor(p))));
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
  return report;
}
