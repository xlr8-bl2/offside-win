/**
 * `npm run lab:review`: where the production rule is good and where it is
 * bad, and whether it can safely make more calls.
 *
 * The live record is a few hundred calls; at ~1.2 a call that is a hit rate
 * known to about three points either way, which is the whole margin between
 * earning and losing. So the questions are asked of the lab's full history,
 * split by date as lab:tune splits it (A oldest half, B next quarter, C the
 * newest quarter), and a segment only counts as bad when it lost in A and B.
 *
 *   1. The production rule by segment: market and side, price band, the
 *      handicap's line from the backed side, league rank, family.
 *   2. Candidate changes, each scored on A, B and C, with how often it beats
 *      production on B and C together when the days are resampled.
 *
 * Read-only. Prints counts, rates and returns.
 */

import { bucketOf, chooseDay, grade, optionsFor, type HistRow, type Option, type Pick, type Policy } from './markets.ts';
import { PROD } from './tune.ts';

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const dayOf = (t: number) => Math.floor((t + 3600) / 86400);

interface Graded { day: number; pick: Pick; result: string; pnl: number }

/** Every call a rule makes over some fixtures, graded; voids left out. */
export function callsOf(policy: Policy, rows: HistRow[], cache: Map<number, Option[]>): Graded[] {
  const days = new Map<number, HistRow[]>();
  for (const r of rows) days.set(dayOf(r.kickoff), [...(days.get(dayOf(r.kickoff)) ?? []), r]);
  const out: Graded[] = [];
  for (const [day, rs] of days) {
    for (const pick of chooseDay(policy, rs, cache)) {
      const g = grade(pick.row, pick.option);
      if (!g || g.result === 'VOID') continue;
      out.push({ day, pick, result: g.result, pnl: g.pnl });
    }
  }
  return out;
}

interface Tally { n: number; won: number; lost: number; pnl: number; p: number; odds: number }
const tally = (cs: Graded[]): Tally => {
  const t: Tally = { n: 0, won: 0, lost: 0, pnl: 0, p: 0, odds: 0 };
  for (const c of cs) {
    t.n++;
    t.pnl += c.pnl;
    t.p += c.pick.p;
    t.odds += c.pick.option.odds;
    if (c.result === 'WON' || c.result === 'HALF_WON') t.won++;
    if (c.result === 'LOST' || c.result === 'HALF_LOST') t.lost++;
  }
  return t;
};
const cell = (t: Tally) => t.n
  ? `${String(t.n).padStart(4)} ${pct(t.won / Math.max(1, t.won + t.lost)).padStart(6)} said ${pct(t.p / t.n).padStart(6)} @${(t.odds / t.n).toFixed(2)} ${pct(t.pnl / t.n).padStart(7)}`
  : '   0'.padEnd(38);

/** The handicap's line as the backed side gets it: +2 is "this side, given two goals". */
export function backedLine(o: { market: string; outcome: string; line: number | null }): number | null {
  if (o.market !== 'asian_handicap' || o.line === null) return null;
  return o.outcome === 'HOME' ? o.line : -o.line;
}

export function bandOf(odds: number): string {
  const bands = [1.15, 1.2, 1.25, 1.3, 1.4, 1.6];
  const lo = [1.0, ...bands];
  for (let i = 0; i < bands.length; i++) if (odds < bands[i]!) return `${lo[i]!.toFixed(2)}-${bands[i]!.toFixed(2)}`;
  return '1.60+';
}

const segments: Array<[string, (c: Graded) => string | null]> = [
  ['market and side', (c) => bucketOf(c.pick.option)],
  ['price band', (c) => bandOf(c.pick.option.odds)],
  ['handicap, line for the backed side', (c) => {
    const l = backedLine(c.pick.option);
    return l === null ? null : `${l > 0 ? '+' : ''}${l}`;
  }],
  ['league rank', (c) => `rank ${c.pick.row.rank}`],
  ['probability', (c) => (c.pick.p < 0.8 ? 'under 80%' : c.pick.p < 0.85 ? '80-85%' : c.pick.p < 0.9 ? '85-90%' : '90%+')],
];

/** Resample days of B+C: how often `v` returns more per call than `base`. */
export function bootstrap(base: Graded[], v: Graded[], draws = 2000, seed = 7): { ahead: number; lo: number; hi: number } {
  const days = [...new Set([...base, ...v].map((c) => c.day))];
  const by = (cs: Graded[]) => {
    const m = new Map<number, { n: number; pnl: number }>();
    for (const c of cs) { const t = m.get(c.day) ?? { n: 0, pnl: 0 }; t.n++; t.pnl += c.pnl; m.set(c.day, t); }
    return m;
  };
  const b = by(base), w = by(v);
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
  const diffs: number[] = [];
  for (let i = 0; i < draws; i++) {
    let bn = 0, bp = 0, vn = 0, vp = 0;
    for (let j = 0; j < days.length; j++) {
      const d = days[Math.floor(rnd() * days.length)]!;
      const x = b.get(d), y = w.get(d);
      if (x) { bn += x.n; bp += x.pnl; }
      if (y) { vn += y.n; vp += y.pnl; }
    }
    diffs.push((vn ? vp / vn : 0) - (bn ? bp / bn : 0));
  }
  diffs.sort((a, z) => a - z);
  return { ahead: diffs.filter((d) => d > 0).length / draws, lo: diffs[Math.floor(draws * 0.05)]!, hi: diffs[Math.floor(draws * 0.95)]! };
}

/** The changes worth asking about, each a whole rule. */
export function candidates(): Policy[] {
  const ex = (name: string, more: string[]): Policy => ({ ...PROD, name, excludeBuckets: [...(PROD.excludeBuckets ?? []), ...more] });
  return [
    { ...PROD, name: 'the rule before 3 November 2026 (best price at fair)', minEv: -0.01, minSharpEv: 0 },
    ex('no "either side to win" (double chance 12)', ['double_chance 12']),
    ex('no double chance at all', ['double_chance 12', 'double_chance home', 'double_chance away']),
    ex('no draw no bet', ['draw_no_bet home', 'draw_no_bet away']),
    ex('no under 3.5 goals', ['over_under_35 under']),
    { ...PROD, name: 'handicaps up to 3 goals', maxHandicap: 3 },
    { ...PROD, name: 'handicaps up to 2.5 goals', maxHandicap: 2.5 },
    { ...PROD, name: 'prices from 1.15', minOdds: 1.15 },
    { ...PROD, name: 'prices from 1.18', minOdds: 1.18 },
    { ...PROD, name: 'rank by growth (pays more among calls that clear)', rankBy: 'growth' },
    // More calls.
    { ...PROD, name: 'more: floor 76%', minProb: 0.76 },
    { ...PROD, name: 'more: floor 75%', minProb: 0.75 },
    { ...PROD, name: 'more: market mix 40%', diversity: 0.4 },
    { ...PROD, name: 'more: no market mix', diversity: 0 },
    { ...PROD, name: 'more: rank 3 floor 82%', rankFloor: { ...PROD.rankFloor, 3: 0.82 } },
    { ...PROD, name: 'more: fallback 74% for ranks 1-4', fallback: fallback(0.74, 4) },
    { ...PROD, name: 'more: fallback 72% for ranks 1-4', fallback: fallback(0.72, 4) },
    { ...PROD, name: 'more: fallback 76% for every rank', fallback: fallback(0.76, 10) },
    ex('no handicap on the away side', ['asian_handicap away']),
    { ...PROD, name: 'marquee floor 74% (was 70%)', rankFloor: { ...PROD.rankFloor, 1: 0.74, 2: 0.74 } },
    { ...PROD, name: 'more: no drift limit', maxDrift: undefined },
    { ...PROD, name: 'more: value within 1% of fair', minEv: -0.02, minSharpEv: -0.01 },
    { ...PROD, name: 'more: value within 2% of fair', minEv: -0.03, minSharpEv: -0.02 },
    {
      ...PROD, name: 'combined: marquee 74%, fallback 74% ranks 1-4',
      rankFloor: { ...PROD.rankFloor, 1: 0.74, 2: 0.74 },
      fallback: { ...fallback(0.74, 4), rankFloor: { ...PROD.rankFloor, 1: 0.74, 2: 0.74 } },
    },
    { ...PROD, name: 'more: value within 1.5% of fair', minEv: -0.025, minSharpEv: -0.015 },
    { ...PROD, name: 'more: value within 0.5% of fair', minEv: -0.015, minSharpEv: -0.005 },
    {
      ...PROD, name: 'combined: value within 1%, fallback 74% ranks 1-4', minEv: -0.02, minSharpEv: -0.01,
      fallback: { ...fallback(0.74, 4), minEv: -0.02, minSharpEv: -0.01 },
    },
    {
      ...PROD, name: 'combined: value within 1%, marquee 74%', minEv: -0.02, minSharpEv: -0.01,
      rankFloor: { ...PROD.rankFloor, 1: 0.74, 2: 0.74 },
    },
    { ...PROD, name: 'combined: fallback 74% ranks 1-4, no drift limit', maxDrift: undefined, fallback: { ...fallback(0.74, 4), maxDrift: undefined } },
    {
      ...ex('combined: fallback 74% ranks 1-4, no under 3.5', ['over_under_35 under']),
      fallback: { ...fallback(0.74, 4), excludeBuckets: [...(PROD.excludeBuckets ?? []), 'over_under_35 under'] },
    },
  ];
}

/**
 * A second, looser rule for fixtures the production rule passes on: the
 * same tests at a lower default floor, only in leagues ranked `maxRank` or
 * better. The rank floors stay as they are (marquee 70%, rank 3 85%).
 */
function fallback(floor: number, maxRank: number): Policy {
  return {
    ...PROD, name: `fallback ${floor}`, minProb: floor,
    excludeRanks: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].filter((r) => r > maxRank),
  };
}

export function runReview(rows: HistRow[]): Record<string, unknown> {
  const sorted = [...rows].sort((a, b) => a.kickoff - b.kickoff);
  const a = sorted.slice(0, Math.floor(sorted.length * 0.5));
  const b = sorted.slice(a.length, Math.floor(sorted.length * 0.75));
  const c = sorted.slice(a.length + b.length);
  const iso = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);
  const cache = new Map(sorted.map((r) => [r.id, optionsFor(r, PROD.modelWeight)]));
  console.log(`lab:review: ${sorted.length} finished fixtures, ${iso(sorted[0]!.kickoff)} to ${iso(sorted[sorted.length - 1]!.kickoff)}`);
  for (const [l, part] of [['A', a], ['B', b], ['C', c]] as const) console.log(`  ${l}: ${part.length} fixtures from ${iso(part[0]!.kickoff)}`);

  const prod = { A: callsOf(PROD, a, cache), B: callsOf(PROD, b, cache), C: callsOf(PROD, c, cache) };
  const daysIn = (part: HistRow[]) => new Set(part.map((r) => dayOf(r.kickoff))).size;
  console.log('\n(each cell: calls, landed, said, average price, return per call)');
  console.log(`\nProduction: A ${cell(tally(prod.A))} | B ${cell(tally(prod.B))} | C ${cell(tally(prod.C))}`);
  console.log(`  calls a day: A ${(prod.A.length / daysIn(a)).toFixed(1)}, B ${(prod.B.length / daysIn(b)).toFixed(1)}, C ${(prod.C.length / daysIn(c)).toFixed(1)}`);

  const flagged: string[] = [];
  for (const [label, key] of segments) {
    console.log(`\n1. By ${label}`);
    const keys = new Set([...prod.A, ...prod.B, ...prod.C].map(key).filter((k): k is string => k !== null));
    for (const k of [...keys].sort()) {
      const t = (cs: Graded[]) => tally(cs.filter((x) => key(x) === k));
      const [ta, tb, tc] = [t(prod.A), t(prod.B), t(prod.C)];
      const bad = ta.n >= 10 && tb.n >= 5 && ta.pnl < 0 && tb.pnl < 0;
      if (bad) flagged.push(`${label}: ${k}`);
      console.log(`  ${k.padEnd(26)} A ${cell(ta)} | B ${cell(tb)} | C ${cell(tc)}${bad ? '  <- lost in A and B' : ''}`);
    }
  }
  console.log(`\nLost in both A and B: ${flagged.length ? flagged.join('; ') : 'none'}`);

  console.log('\n2. Candidate changes (A | B | C), and against production on B and C with the days resampled');
  const out: Record<string, unknown> = {};
  for (const p of candidates()) {
    const v = { A: callsOf(p, a, cache), B: callsOf(p, b, cache), C: callsOf(p, c, cache) };
    const bs = bootstrap([...prod.B, ...prod.C], [...v.B, ...v.C]);
    const perDay = (v.B.length + v.C.length) / Math.max(1, daysIn(b) + daysIn(c));
    console.log(`\n  ${p.name}`);
    console.log(`    A ${cell(tally(v.A))} | B ${cell(tally(v.B))} | C ${cell(tally(v.C))}`);
    console.log(`    ${perDay.toFixed(1)} calls a day on B+C (production ${((prod.B.length + prod.C.length) / Math.max(1, daysIn(b) + daysIn(c))).toFixed(1)}); return ahead in ${pct(bs.ahead)} of draws, difference ${pct(bs.lo)} to ${pct(bs.hi)}`);
    out[p.name] = { A: tally(v.A), B: tally(v.B), C: tally(v.C), ahead: bs.ahead };
  }
  return { prod: { A: tally(prod.A), B: tally(prod.B), C: tally(prod.C) }, flagged, candidates: out };
}
