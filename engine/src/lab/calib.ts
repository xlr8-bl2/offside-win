/**
 * `npm run lab:calib`: does correcting the price's known biases make the calls
 * more accurate on matches the correction never saw?
 *
 * lab:slices printed the price against the result, family by family, over
 * 3,159 fixtures. Two biases stood out where the published calls live:
 *
 *   result    favourites the price had at 85%+ landed 90%, at 90%+ 95%
 *             (the favourite-longshot bias, the best-documented bias in
 *             betting markets);
 *   corners   the short end the other way: 90%+ landed 90.5% against 92.8%.
 *
 * The correction is a curve per family from the price to how often it landed:
 * binned, each bin pulled toward "the price is right" by `n0` pseudo-matches
 * so a thin bin moves little, and made non-decreasing. Quarter-line handicaps
 * are left alone (their half results cannot be scored as won or lost, and the
 * engine does not call them).
 *
 * Judged the way lab:tune judges everything: fitted on the oldest half (A),
 * chosen on the next quarter (B), refitted on A and B and checked once on the
 * newest quarter (C), with a bootstrap over days on C. On each: log loss and
 * Brier of the options in the region calls are made from, and the production
 * rule with and without the correction.
 *
 * Read-only.
 */

import { applyCalibration, calBase, calEligible, chooseDay, grade, optionsFor, simulate, type CalMap, type HistRow, type Option, type Policy } from './markets.ts';
import { bootstrap } from './learned.ts';
import { labelled, PROD } from './tune.ts';

const EDGES = [0.5, 0.6, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 1.0001];
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

const baseProb = calBase;
const eligible = calEligible;

/** Fit the curve per family: binned, shrunk toward the price, non-decreasing. */
export function fitCal(data: Array<{ o: Option; y: number }>, n0 = 200): CalMap {
  const acc = new Map<string, Array<{ n: number; p: number; y: number }>>();
  for (const { o, y } of data) {
    if (!eligible(o)) continue;
    const p = baseProb(o);
    const i = EDGES.findIndex((e, j) => p >= e && p < EDGES[j + 1]!);
    if (i < 0) continue;
    const a = acc.get(o.family) ?? EDGES.slice(1).map(() => ({ n: 0, p: 0, y: 0 }));
    a[i]!.n++; a[i]!.p += p; a[i]!.y += y;
    acc.set(o.family, a);
  }
  const out: CalMap = {};
  for (const [fam, bins] of acc) {
    const x: number[] = [];
    const yv: number[] = [];
    const w: number[] = [];
    bins.forEach((b, i) => {
      const mid = (EDGES[i]! + Math.min(1, EDGES[i + 1]!)) / 2;
      const mp = b.n ? b.p / b.n : mid;
      x.push(mp);
      yv.push((b.y + n0 * mp) / (b.n + n0));
      w.push(b.n + n0);
    });
    // Pool adjacent violators: a higher price never maps below a lower one.
    const blocks = yv.map((v, i) => ({ v, w: w[i]!, n: 1 }));
    for (let i = 0; i < blocks.length - 1;) {
      if (blocks[i]!.v > blocks[i + 1]!.v) {
        const a = blocks[i]!, b = blocks[i + 1]!;
        blocks.splice(i, 2, { v: (a.v * a.w + b.v * b.w) / (a.w + b.w), w: a.w + b.w, n: a.n + b.n });
        if (i > 0) i--;
      } else i++;
    }
    const ys = blocks.flatMap((b) => new Array(b.n).fill(b.v) as number[]);
    out[fam] = { x, y: ys };
  }
  return out;
}

export const applyCal = applyCalibration;

function scores(data: Array<{ o: Option; y: number }>, p: (o: Option) => number) {
  let ll = 0, br = 0, n = 0;
  for (const { o, y } of data) {
    if (!eligible(o) || baseProb(o) < 0.7) continue;
    const q = Math.min(1 - 1e-6, Math.max(1e-6, p(o)));
    ll += -(y * Math.log(q) + (1 - y) * Math.log(1 - q));
    br += (q - y) ** 2;
    n++;
  }
  return { n, ll: ll / (n || 1), br: br / (n || 1) };
}

function daysOf(policy: Policy, rows: HistRow[], cache: Map<number, Option[]>) {
  const m = new Map<number, HistRow[]>();
  for (const r of rows) { const d = Math.floor((r.kickoff + 3600) / 86400); m.set(d, [...(m.get(d) ?? []), r]); }
  const out = new Map<number, { n: number; won: number; pnl: number }>();
  for (const [d, rs] of m) {
    let n = 0, won = 0, pnl = 0;
    for (const pk of chooseDay(policy, rs, cache)) {
      const g = grade(pk.row, pk.option);
      if (!g) continue;
      n++; pnl += g.pnl; if (g.result === 'WON' || g.result === 'HALF_WON') won++;
    }
    out.set(d, { n, won, pnl });
  }
  return out;
}

export function runCalib(rows: HistRow[]): void {
  const sorted = [...rows].sort((a, b) => a.kickoff - b.kickoff);
  const a = sorted.slice(0, Math.floor(sorted.length * 0.5));
  const b = sorted.slice(Math.floor(sorted.length * 0.5), Math.floor(sorted.length * 0.75));
  const c = sorted.slice(Math.floor(sorted.length * 0.75));
  const cache = new Map(sorted.map((r) => [r.id, optionsFor(r, PROD.modelWeight)] as [number, Option[]]));
  console.log(`lab:calib: ${sorted.length} fixtures; A ${a.length}, B ${b.length}, C ${c.length}`);

  const line = (label: string, r: ReturnType<typeof simulate>) =>
    console.log(`    ${label.padEnd(30)} ${String(r.n).padStart(4)} calls  ${pct(r.hitRate).padStart(6)} landed  odds ${r.avgOdds.toFixed(2)}  return ${pct(r.roi).padStart(7)}  ${Object.entries(r.byFamily).map(([f, v]) => `${f} ${v.n}:${pct(v.roi)}`).join(' ')}`);

  const judge = (label: string, fit: HistRow[], test: HistRow[], n0: number, boot: boolean) => {
    const cal = fitCal(labelled(fit, cache), n0);
    const td = labelled(test, cache);
    const raw = scores(td, baseProb);
    const cor = scores(td, (o) => applyCal(cal, o));
    console.log(`  ${label}, n0 ${n0}: options priced 70%+ (${raw.n}): log loss ${raw.ll.toFixed(4)} -> ${cor.ll.toFixed(4)}, Brier ${raw.br.toFixed(4)} -> ${cor.br.toFixed(4)}`);
    const calPolicy: Policy = { ...PROD, name: 'production, corrected', source: 'calibrated', calibration: cal };
    line('production', simulate(PROD, test, cache));
    line('production, corrected', simulate(calPolicy, test, cache));
    if (boot) {
      const bs = bootstrap(daysOf(calPolicy, test, cache), daysOf(PROD, test, cache));
      console.log(`    bootstrap over days: corrected ahead on return ${pct(bs.roiAhead)} of draws, on landing ${pct(bs.hitAhead)}; return difference, middle 90%: ${pct(bs.lo)} to ${pct(bs.hi)}`);
    }
    return cal;
  };

  console.log('\nFitted on A, judged on B (choosing the shrinkage):');
  for (const n0 of [50, 200, 800]) judge('B', a, b, n0, false);
  console.log('\nFitted on A and B, checked once on C:');
  for (const n0 of [50, 200, 800]) {
    const cal = judge('C', [...a, ...b], c, n0, true);
    if (n0 === 200) {
      for (const [fam, m] of Object.entries(cal)) {
        console.log(`    curve ${fam.padEnd(9)} ${m.x.map((x, i) => `${pct(x)}->${pct(m.y[i]!)}`).join('  ')}`);
      }
    }
  }
}
