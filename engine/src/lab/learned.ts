/**
 * `npm run lab:model`: can anything beat the price at its own game?
 *
 * The bookmakers' price is the best single forecast we have: lab:tune shows
 * the consensus landing within a point of what it says in every band. So a
 * better model is not a different forecast, it is the price plus whatever the
 * price has not yet taken in. Three candidates, each with a reason to think
 * it might carry something:
 *
 *   our own analysis   the ratings, refitted week by week on the matches
 *                      before (lab/own.ts): an independent read of the game;
 *   the money          how far the price has moved since the market opened.
 *                      lab:tune found options the money came for landing a
 *                      point or two above their price, and ones it left
 *                      landing below;
 *   the rest           the data provider's forecast, where the sharp book and
 *                      the consensus disagree, and how far the best price
 *                      sits above fair.
 *
 * Each is asked the same three questions, in order, and nothing reaches the
 * engine unless it passes all three:
 *
 *   1. Is it right more often than the price, on matches it was not fitted
 *      on? (log loss, per market family)
 *   2. When it disagrees with the price, who is right? (landed against priced,
 *      by how far apart they are)
 *   3. Do the calls it chooses land more, and lose less, than production's, on
 *      the newest quarter of the history that nothing was tuned or chosen on?
 *      With a bootstrap over days, because a few good Saturdays can make any
 *      rule look clever.
 *
 * The split is lab:tune's: A the oldest half, B the next quarter, C the
 * newest. Weights are fitted on A to judge on B, and refitted on A and B to
 * judge on C, which is how the engine would use them: fitted on everything
 * up to now, applied to what comes next.
 */

import { chooseDay, grade, learnedFeatures, learnedProb, LEARNED_FEATURES, optionsFor, simulate, type HistRow, type Option, type Policy, type SimResult } from './markets.ts';
import { byDay, fitLogistic, labelled, PROD } from './tune.ts';
import { MARKET_FAMILY, type MarketFamily } from '../types.ts';

export type LearnedWeights = Partial<Record<MarketFamily, number[]>>;

const ref = (o: Option) => o.sharp ?? o.book;
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const lg = (p: number) => { const q = Math.min(1 - 1e-6, Math.max(1e-6, p)); return Math.log(q / (1 - q)); };

/** The feature indices each variant may use; the rest are held at zero. */
export const VARIANTS: Record<string, number[]> = {
  'the price, recalibrated': [0, 1],
  '+ the money since the open': [0, 1, 2],
  '+ our own analysis': [0, 1, 3],
  '+ the money and our own analysis': [0, 1, 2, 3],
  'everything': [0, 1, 2, 3, 4, 5, 6, 7],
};

const FAMILIES = [...new Set(Object.values(MARKET_FAMILY))];

/**
 * Per-family logistic weights over the chosen features, fitted on the given
 * labelled options. The ridge pulls toward "believe the price" (slope one,
 * everything else zero), so a family with little data stays at the price.
 */
export function fitLearned(data: Array<{ o: Option; y: number }>, use: number[], ridge = 4): LearnedWeights {
  const out: LearnedWeights = {};
  const mask = (x: number[]) => x.map((v, i) => (use.includes(i) ? v : 0));
  for (const fam of FAMILIES) {
    const d = data.filter((x) => x.o.family === fam);
    if (d.length < 400) continue;
    out[fam] = fitLogistic(d.map((x) => mask(learnedFeatures(x.o))), d.map((x) => x.y), ridge);
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

/** Per day: calls, landed, profit on a one-unit stake. */
function days(policy: Policy, rows: HistRow[], cache: Map<number, Option[]>): Map<number, { n: number; won: number; pnl: number }> {
  const out = new Map<number, { n: number; won: number; pnl: number }>();
  for (const day of byDay(rows)) {
    const key = Math.floor((day[0]!.kickoff + 3600) / 86400);
    const e = { n: 0, won: 0, pnl: 0 };
    for (const pick of chooseDay(policy, day, cache)) {
      const g = grade(pick.row, pick.option);
      if (!g || g.result === 'VOID') continue;
      e.n++;
      e.pnl += g.pnl;
      if (g.result === 'WON' || g.result === 'HALF_WON') e.won++;
    }
    out.set(key, e);
  }
  return out;
}

/** Deterministic, so a rerun on the same history prints the same interval. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}

/**
 * The candidate against production on the same days, resampling days with
 * replacement: how often the candidate's return per call and its landing rate
 * come out ahead, and the middle 90% of the difference in return.
 */
export function bootstrap(cand: Map<number, { n: number; won: number; pnl: number }>, base: Map<number, { n: number; won: number; pnl: number }>, draws = 4000) {
  const keys = [...new Set([...cand.keys(), ...base.keys()])];
  const r = rng(20260930);
  const diffs: number[] = [];
  let roiAhead = 0, hitAhead = 0;
  for (let i = 0; i < draws; i++) {
    let cn = 0, cw = 0, cp = 0, bn = 0, bw = 0, bp = 0;
    for (let k = 0; k < keys.length; k++) {
      const d = keys[Math.floor(r() * keys.length)]!;
      const c = cand.get(d), b = base.get(d);
      if (c) { cn += c.n; cw += c.won; cp += c.pnl; }
      if (b) { bn += b.n; bw += b.won; bp += b.pnl; }
    }
    const diff = (cn ? cp / cn : 0) - (bn ? bp / bn : 0);
    diffs.push(diff);
    if (diff > 0) roiAhead++;
    if ((cn ? cw / cn : 0) > (bn ? bw / bn : 0)) hitAhead++;
  }
  diffs.sort((a, b) => a - b);
  return {
    roiAhead: roiAhead / draws,
    hitAhead: hitAhead / draws,
    lo: diffs[Math.floor(draws * 0.05)]!,
    hi: diffs[Math.floor(draws * 0.95)]!,
  };
}

function line(label: string, r: SimResult): string {
  return `  ${label.padEnd(3)} ${String(r.n).padStart(4)} calls ${r.perDay.toFixed(1).padStart(5)}/day  ${pct(r.hitRate).padStart(6)} landed  odds ${r.avgOdds.toFixed(2)}  return ${pct(r.roi).padStart(6)}  top ${pct(r.topShare)} of ${r.markets}`;
}

export function runModel(rows: HistRow[]): Record<string, unknown> {
  const sorted = [...rows].sort((a, b) => a.kickoff - b.kickoff);
  const a = sorted.slice(0, Math.floor(sorted.length * 0.5));
  const b = sorted.slice(a.length, Math.floor(sorted.length * 0.75));
  const c = sorted.slice(a.length + b.length);
  const cache = new Map(sorted.map((r) => [r.id, optionsFor(r, 0.5)]));
  const withOwn = sorted.filter((r) => r.own).length;
  console.log(`lab:model: A ${a.length} fixtures, B ${b.length}, C ${c.length} (oldest to newest); our own read on ${withOwn}`);
  const report: Record<string, unknown> = { split: { a: a.length, b: b.length, c: c.length, own: withOwn } };

  const LA = labelled(a, cache), LB = labelled(b, cache), LC = labelled(c, cache);
  const all = [...LA, ...LB, ...LC];

  // 1. Our own analysis on its own, against the price, where it has a view.
  console.log('\n1. Our own analysis against the price (log loss, lower is better; every match, all periods):');
  const ownRows: unknown[] = [];
  for (const fam of FAMILIES) {
    const d = all.filter((x) => x.o.family === fam && x.o.own !== null);
    if (d.length < 200) continue;
    const r = { family: fam, n: d.length, own: logLoss(d, (o) => o.own!), price: logLoss(d, ref), consensus: logLoss(d, (o) => o.book), halfway: logLoss(d, (o) => 1 / (1 + Math.exp(-(lg(o.own!) + lg(ref(o))) / 2))) };
    ownRows.push(r);
    console.log(`  ${fam.padEnd(9)} ours ${r.own.toFixed(4)}  the price ${r.price.toFixed(4)}  halfway between ${r.halfway.toFixed(4)}  (n ${r.n})`);
  }
  report['own'] = ownRows;

  // 2. When they disagree, who is right? Only the likely end, which is where
  // the calls come from.
  console.log('\n2. Where the price says 70% or more: when our own analysis disagrees, who is right?');
  const agree: unknown[] = [];
  const likely = all.filter((x) => x.o.own !== null && ref(x.o) >= 0.7);
  for (const [lo, hi, label] of [[-1, -0.1, 'we rate it 10+ pts lower'], [-0.1, -0.04, '4-10 pts lower'], [-0.04, 0.04, 'we agree (within 4)'], [0.04, 0.1, '4-10 pts higher'], [0.1, 1, 'we rate it 10+ pts higher']] as const) {
    const d = likely.filter((x) => { const g = x.o.own! - ref(x.o); return g >= lo && g < hi; });
    if (d.length < 40) continue;
    const priced = d.reduce((s, x) => s + ref(x.o), 0) / d.length;
    const ours = d.reduce((s, x) => s + x.o.own!, 0) / d.length;
    const landed = d.reduce((s, x) => s + x.y, 0) / d.length;
    agree.push({ label, n: d.length, priced, ours, landed });
    console.log(`  ${label.padEnd(26)} n ${String(d.length).padStart(5)}  price says ${pct(priced)}  we say ${pct(ours)}  landed ${pct(landed)}  (${landed >= priced ? '+' : ''}${((landed - priced) * 100).toFixed(1)} pts on the price)`);
  }
  report['agreement'] = agree;

  // 3. The learned probability: which features earn their place?
  console.log('\n3. The learned probability (fitted on A to judge B, on A and B to judge C). Log loss, lower is better; "likely" is where the price says 70%+:');
  const band = (d: Array<{ o: Option; y: number }>) => d.filter((x) => ref(x.o) >= 0.7);
  console.log(`  ${'the price as it is'.padEnd(34)} B ${logLoss(LB, ref).toFixed(4)}  likely ${logLoss(band(LB), ref).toFixed(4)}   C ${logLoss(LC, ref).toFixed(4)}  likely ${logLoss(band(LC), ref).toFixed(4)}`);
  const variants: Record<string, { onB: LearnedWeights; onC: LearnedWeights; ll: number[] }> = {};
  for (const [name, use] of Object.entries(VARIANTS)) {
    const onB = fitLearned(LA, use);
    const onC = fitLearned([...LA, ...LB], use);
    const pB = (o: Option) => learnedProb(onB[o.family], o);
    const pC = (o: Option) => learnedProb(onC[o.family], o);
    const ll = [logLoss(LB, pB), logLoss(band(LB), pB), logLoss(LC, pC), logLoss(band(LC), pC)];
    variants[name] = { onB, onC, ll };
    console.log(`  ${name.padEnd(34)} B ${ll[0]!.toFixed(4)}  likely ${ll[1]!.toFixed(4)}   C ${ll[2]!.toFixed(4)}  likely ${ll[3]!.toFixed(4)}`);
  }
  const full = variants['everything']!.onC;
  console.log('  weights, everything, fitted on A and B:');
  for (const [fam, w] of Object.entries(full)) {
    console.log(`    ${fam.padEnd(9)} ${w.map((x, i) => `${LEARNED_FEATURES[i]} ${x.toFixed(2)}`).join('  ')}`);
  }
  report['learned'] = Object.fromEntries(Object.entries(variants).map(([k, v]) => [k, { ll: v.ll, weights: v.onC }]));

  // 4. The rules. Production is the bar. A candidate is chosen on B alone
  // (the learned weights were fitted on A, so A flatters them), and judged
  // once on C against production on the same days.
  const prodB = simulate(PROD, b, cache);
  const cands: Array<{ p: Policy; pC: Policy; family: string }> = [];
  for (const minOwnGap of [-0.08, -0.04, -0.02, 0, 0.02]) {
    const p: Policy = { ...PROD, name: `production, our own analysis within ${minOwnGap * 100} pts or above`, minOwnGap };
    cands.push({ p, pC: p, family: 'agreement' });
  }
  for (const minProb of [0.72, 0.75, 0.78, 0.8]) {
    for (const minEv of [0, 0.02]) {
      const p: Policy = { ...PROD, name: `our own analysis first: ${minProb * 100}%+, paying ${minEv * 100}%+ on our number, at or above the sharp price`, source: 'own', minProb, rankFloor: undefined, minEv };
      cands.push({ p, pC: p, family: 'own first' });
    }
  }
  for (const vname of ['+ the money since the open', '+ the money and our own analysis', 'everything']) {
    const v = variants[vname]!;
    for (const minProb of [0.76, 0.78, 0.8, 0.82]) {
      for (const minEv of [-0.01, 0, 0.01]) {
        const name = `learned (${vname.replace(/^\+ /, '')}) ${minProb * 100}%+ ev>=${minEv}`;
        const base: Policy = { ...PROD, name, source: 'learned', minProb, minEv, rankFloor: { 1: minProb - 0.08, 2: minProb - 0.08, 3: minProb + 0.07 } };
        cands.push({ p: { ...base, learned: v.onB }, pC: { ...base, learned: v.onC }, family: 'learned' });
      }
    }
  }

  console.log('\n4. Rules against production. Chosen on B, judged once on C.');
  console.log(`  production`);
  console.log(line('A', simulate(PROD, a, cache)));
  console.log(line('B', prodB));
  const prodC = simulate(PROD, c, cache);
  console.log(line('C', prodC));
  const prodDays = days(PROD, c, cache);

  const scored = cands.map((x) => ({ ...x, rb: simulate(x.p, b, cache) }));
  // At least three calls in four of production's, landing at least as often,
  // then the best return per call on B.
  const eligible = scored.filter((x) => x.rb.n >= prodB.n * 0.75 && x.rb.hitRate >= prodB.hitRate);
  const bestOf = (fam: string) => eligible.filter((x) => x.family === fam).sort((p, q) => q.rb.roi - p.rb.roi)[0] ?? null;
  const finalists: unknown[] = [];
  for (const fam of ['agreement', 'own first', 'learned']) {
    // Every candidate of the family on B, so the report shows the field, not only the winner.
    const field = scored.filter((x) => x.family === fam).sort((p, q) => q.rb.roi - p.rb.roi).slice(0, 4);
    console.log(`\n  ${fam}: best on B`);
    for (const x of field) console.log(`    ${x.p.name}\n  ${line('B', x.rb)}`);
    const w = bestOf(fam);
    if (!w) { console.log(`  ${fam}: nothing landed as often as production on B with three quarters of its calls`); continue; }
    const rc = simulate(w.pC, c, cache);
    const bs = bootstrap(days(w.pC, c, cache), prodDays);
    console.log(`  chosen: ${w.p.name}`);
    console.log(line('C', rc));
    console.log(`      against production on C: return ahead in ${pct(bs.roiAhead)} of 4,000 resamples of the days, landing rate ahead in ${pct(bs.hitAhead)}; return difference ${pct(bs.lo)} to ${pct(bs.hi)} (90%)`);
    const mk = Object.entries(rc.byMarket).sort((x, y) => y[1].n - x[1].n).slice(0, 6);
    console.log(`      C markets: ${mk.map(([k, v]) => `${k} ${v.n}`).join(', ')}`);
    finalists.push({ family: fam, policy: { ...w.pC, learned: undefined }, weights: w.pC.learned ?? null, b: w.rb, c: rc, bootstrap: bs });
  }
  // 5. Production's own blend. For goals it moves the price halfway toward
  // our model's scoring rates (where the board kept them). If our own read
  // loses to the price, that half may be costing calls. Named variants, not
  // a search, each judged on every period and against production on B and C
  // together, which none of them was tuned on.
  console.log('\n5. How much of our own model production should mix into the goals markets:');
  const cacheW = new Map<number, Map<number, Option[]>>([[0.5, cache]]);
  const cacheOf = (w: number) => {
    let x = cacheW.get(w);
    if (!x) { x = new Map(sorted.map((r) => [r.id, optionsFor(r, w)])); cacheW.set(w, x); }
    return x;
  };
  const bc = [...b, ...c];
  const prodBC = days(PROD, bc, cache);
  const blendRows: unknown[] = [];
  for (const [name, p] of [
    ['none: the sharp price alone', { ...PROD, source: 'sharp', modelWeight: 0 }],
    ['a quarter', { ...PROD, source: 'bestsharp', modelWeight: 0.25 }],
    ['half (production)', PROD],
    ['production, and only where the money has come for it', { ...PROD, minSteam: 0 }],
    ['none, and only where the money has come for it', { ...PROD, source: 'sharp', modelWeight: 0, minSteam: 0 }],
  ] as Array<[string, Policy]>) {
    const cc = cacheOf(p.modelWeight);
    const ra = simulate(p, a, cc), rb = simulate(p, b, cc), rc = simulate(p, c, cc);
    const bs = bootstrap(days(p, bc, cc), prodBC);
    console.log(`  ${name}`);
    console.log(line('A', ra));
    console.log(line('B', rb));
    console.log(line('C', rc));
    if (p !== PROD) console.log(`      against production on B and C: return ahead in ${pct(bs.roiAhead)} of resamples, landing rate ahead in ${pct(bs.hitAhead)}; return difference ${pct(bs.lo)} to ${pct(bs.hi)} (90%)`);
    blendRows.push({ name, a: ra, b: rb, c: rc, bootstrap: bs });
  }
  report['blend'] = blendRows;

  report['production'] = { b: prodB, c: prodC };
  report['finalists'] = finalists;
  return report;
}
