/**
 * `npm run lab` with the argument `deep`: where the production rule is strict
 * for no gain, measured on the same three date periods as lab:tune.
 *
 *   1. Why a fixture gets no call: the first test its likeliest options fail.
 *   2. Holding a published call: the calls a looser rule would keep that the
 *      production rule drops at the close. A call the slate published hours
 *      earlier and then pulled is one of these, so their record is the cost
 *      (or not) of leaving a call up instead of pulling it.
 *   3. Quiet days: one best read on a day the rule makes few calls.
 *   4. Floors by market family and by league rank.
 *   5. Whether a probability means what it says, on the newest period.
 *
 * Read-only. Every fixture here has finished; prints counts, rates and returns.
 */

import { chooseDay, evOf, grade, optionsFor, probOf, simulate, type HistRow, type Option, type Pick, type Policy, type SimResult } from './markets.ts';
import { bootstrap } from './learned.ts';
import { byDay, PROD } from './tune.ts';
import { MARKET_FAMILY, type MarketFamily } from '../types.ts';

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const dayOf = (t: number) => Math.floor((t + 3600) / 86400);

type Cache = Map<number, Option[]>;

/** The floor a policy asks of an option on a fixture. */
export function floorOf(policy: Policy, row: HistRow, o: Option): number {
  return policy.rankFloor?.[row.rank] ?? policy.familyFloor?.[o.family] ?? policy.minProb;
}

/** The first of the policy's tests an option fails, or null when it passes them all. */
export function failedGate(policy: Policy, row: HistRow, o: Option): string | null {
  if (o.odds < policy.minOdds) return 'short';
  if (o.odds > policy.maxOdds) return 'long';
  if (policy.noQuarters && o.line !== null && Math.abs((o.line * 4) % 2) === 1) return 'quarter';
  const side = o.outcome === 'HOME' || o.outcome === '1X' ? 'home' : o.outcome === 'AWAY' || o.outcome === 'X2' ? 'away' : String(o.outcome);
  if (policy.excludeBuckets?.includes(`${o.market} ${side}`)) return 'excluded';
  if (policy.excludeRanks?.includes(row.rank)) return 'excluded';
  const p = probOf(policy, o);
  if (p === null) return 'noprob';
  if (p > policy.maxProb) return 'certain';
  if (p < floorOf(policy, row, o)) return 'floor';
  if (o.odds * o.book > policy.maxGap) return 'gap';
  if (evOf(p, o) < policy.minEv) return 'value';
  if (policy.minSharpEv !== undefined && o.sharp !== null && evOf(o.sharp, o) < policy.minSharpEv) return 'value';
  if (o.open !== null && policy.maxDrift !== undefined && (o.sharp ?? o.book) - o.open < -policy.maxDrift) return 'drift';
  return null;
}

/**
 * Why a fixture gets no call, as a reader would want it said:
 *
 *   no prices    nothing priced at all;
 *   called       something passes (before the day's market mix);
 *   short        the likely outcome is too short and nothing else is sure enough;
 *   value        sure enough at a usable price, but the price is shorter than fair;
 *   drift        sure enough, but the money has gone against it;
 *   close        nothing at a usable price is sure enough (split by how close).
 */
export function whyNot(policy: Policy, row: HistRow, opts: Option[]): string {
  if (!opts.length) return 'no prices';
  const gates = opts.map((o) => ({ o, g: failedGate(policy, row, o), p: probOf(policy, o) ?? 0 }));
  if (gates.some((x) => x.g === null)) return 'called';
  const sure = gates.filter((x) => x.p >= floorOf(policy, row, x.o) && x.p <= policy.maxProb);
  const usable = sure.filter((x) => x.g !== 'short' && x.g !== 'long' && x.g !== 'quarter' && x.g !== 'excluded');
  if (usable.length) {
    const best = usable.sort((a, b) => b.p - a.p)[0]!;
    return best.g === 'drift' ? 'drift' : best.g === 'gap' || best.g === 'value' ? 'value' : `other:${best.g}`;
  }
  const inBand = gates.filter((x) => x.o.odds >= policy.minOdds && x.o.odds <= policy.maxOdds && x.p <= policy.maxProb)
    .sort((a, b) => b.p - a.p)[0];
  if (sure.some((x) => x.g === 'short')) return 'short';
  if (!inBand) return 'close <60%';
  return inBand.p >= 0.7 ? 'close 70%+' : inBand.p >= 0.6 ? 'close 60-70%' : 'close <60%';
}

interface Tally { n: number; won: number; pnl: number; odds: number; p: number }
const empty = (): Tally => ({ n: 0, won: 0, pnl: 0, odds: 0, p: 0 });

function add(t: Tally, row: HistRow, pick: { option: Option; p: number }): boolean {
  const g = grade(row, pick.option);
  if (!g || g.result === 'VOID') return false;
  t.n++;
  t.pnl += g.pnl;
  t.odds += pick.option.odds;
  t.p += pick.p;
  if (g.result === 'WON' || g.result === 'HALF_WON') t.won++;
  return true;
}

const show = (t: Tally) => t.n
  ? `${String(t.n).padStart(4)} calls  ${pct(t.won / t.n).padStart(6)} landed (said ${pct(t.p / t.n)})  odds ${(t.odds / t.n).toFixed(2)}  return ${pct(t.pnl / t.n).padStart(6)}`
  : '   0 calls';

/** Per-day tallies of a set of picks, for the bootstrap. */
function perDay(picks: Array<{ row: HistRow; option: Option; p: number }>): Map<number, { n: number; won: number; pnl: number }> {
  const m = new Map<number, { n: number; won: number; pnl: number }>();
  for (const pk of picks) {
    const g = grade(pk.row, pk.option);
    if (!g || g.result === 'VOID') continue;
    const d = dayOf(pk.row.kickoff);
    const e = m.get(d) ?? { n: 0, won: 0, pnl: 0 };
    e.n++; e.pnl += g.pnl; if (g.result === 'WON' || g.result === 'HALF_WON') e.won++;
    m.set(d, e);
  }
  return m;
}

function dayPicks(policy: Policy, part: HistRow[], cache: Cache): Pick[] {
  return byDay(part).flatMap((d) => chooseDay(policy, d, cache));
}

const simLine = (label: string, r: SimResult) =>
  `  ${label.padEnd(3)} ${String(r.n).padStart(4)} calls ${r.perDay.toFixed(1).padStart(5)}/day  ${pct(r.hitRate).padStart(6)} landed  odds ${r.avgOdds.toFixed(2)}  return ${pct(r.roi).padStart(6)}`;

export function runDeep(rows: HistRow[]): Record<string, unknown> {
  const sorted = [...rows].sort((a, b) => a.kickoff - b.kickoff);
  const a = sorted.slice(0, Math.floor(sorted.length * 0.5));
  const b = sorted.slice(a.length, Math.floor(sorted.length * 0.75));
  const c = sorted.slice(a.length + b.length);
  const parts = [['A', a], ['B', b], ['C', c]] as const;
  const cache: Cache = new Map(sorted.map((r) => [r.id, optionsFor(r, PROD.modelWeight)]));
  const iso = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);
  console.log(`lab deep: ${sorted.length} fixtures, ${iso(sorted[0]!.kickoff)} to ${iso(sorted[sorted.length - 1]!.kickoff)}`);
  for (const [l, part] of parts) console.log(`  ${l}: ${part.length} fixtures, ${iso(part[0]!.kickoff)} to ${iso(part[part.length - 1]!.kickoff)}`);
  const report: Record<string, unknown> = {};

  /* ---------------------------------------------------------- 0. baseline */
  console.log('\n0. Production, period by period');
  for (const [l, part] of parts) console.log(simLine(l, simulate(PROD, part, cache)));
  {
    const days = byDay(sorted).filter((d) => d.length >= 5);
    const counts = days.map((d) => chooseDay(PROD, d, cache).length);
    const hist = [0, 1, 2, 3].map((k) => counts.filter((n) => n === k).length);
    console.log(`  days with five or more fixtures: ${days.length}; with 0 calls ${hist[0]}, 1 call ${hist[1]}, 2 calls ${hist[2]}, 3 calls ${hist[3]}, more ${counts.filter((n) => n > 3).length}`);
    const recent = byDay(sorted.filter((r) => r.kickoff >= sorted[sorted.length - 1]!.kickoff - 21 * 86400));
    console.log('  the last three weeks, day by day (fixtures / calls):');
    console.log('   ' + recent.map((d) => `${iso(d[0]!.kickoff).slice(5)} ${d.length}/${chooseDay(PROD, d, cache).length}`).join('  '));
  }

  /* -------------------------------------------------------- 1. why not */
  console.log('\n1. Why a fixture gets no call (before the day\'s market mix)');
  const groups: Array<[string, (r: HistRow) => boolean]> = [
    ['all', () => true],
    ['rank 1-2', (r) => r.rank <= 2],
    ['rank 3', (r) => r.rank === 3],
    ['rank 4', (r) => r.rank === 4],
    ['rank 5-6', (r) => r.rank === 5 || r.rank === 6],
    ['friendly', (r) => r.rank === 9],
  ];
  const why: Record<string, Record<string, number>> = {};
  for (const [name, f] of groups) {
    for (const [label, set] of [['whole', sorted], ['last 3 weeks', sorted.filter((r) => r.kickoff >= sorted[sorted.length - 1]!.kickoff - 21 * 86400)]] as const) {
      const counts: Record<string, number> = {};
      const sub = set.filter(f);
      for (const r of sub) { const k = whyNot(PROD, r, cache.get(r.id) ?? []); counts[k] = (counts[k] ?? 0) + 1; }
      why[`${name} ${label}`] = counts;
      const total = sub.length || 1;
      console.log(`  ${name.padEnd(9)} ${label.padEnd(13)} ${String(sub.length).padStart(5)}: ${Object.entries(counts).sort((x, y) => y[1] - x[1]).map(([k, v]) => `${k} ${pct(v / total)}`).join(', ')}`);
    }
  }
  report['why'] = why;

  /* ---------------------------------------------------- 2. holding a call */
  console.log('\n2. Holding a call: what a looser rule keeps that production drops at the close');
  console.log('   (a call published earlier and pulled before kick-off is one of these; graded at the closing price)');
  const lower = (by: number): Record<number, number> => Object.fromEntries(Object.entries(PROD.rankFloor ?? {}).map(([k, v]) => [k, v - by]));
  const holds: Array<[string, Policy]> = [
    ['floor -2 points', { ...PROD, name: 'hold floor -2', minProb: PROD.minProb - 0.02, rankFloor: lower(0.02) }],
    ['floor -4 points', { ...PROD, name: 'hold floor -4', minProb: PROD.minProb - 0.04, rankFloor: lower(0.04) }],
    ['price within 2% of fair', { ...PROD, name: 'hold value', minEv: -0.03, minSharpEv: -0.02 }],
    ['money against by up to 3 points', { ...PROD, name: 'hold drift', maxDrift: 0.03 }],
    ['all three (floor -3, 2% of fair, 3 points)', { ...PROD, name: 'hold all', minProb: PROD.minProb - 0.03, rankFloor: lower(0.03), minEv: -0.03, minSharpEv: -0.02, maxDrift: 0.03 }],
  ];
  const holdOut: Record<string, unknown> = {};
  for (const [label, hp] of holds) {
    console.log(`  ${label}`);
    const res: Record<string, Tally> = {};
    const allExtra: Array<{ row: HistRow; option: Option; p: number }> = [];
    for (const [l, part] of parts) {
      const t = empty();
      const prodIds = new Set(dayPicks(PROD, part, cache).map((x) => x.row.id));
      for (const pk of dayPicks(hp, part, cache)) {
        if (prodIds.has(pk.row.id)) continue;
        if (add(t, pk.row, pk)) allExtra.push(pk);
      }
      res[l] = t;
      console.log(`    ${l}  ${show(t)}`);
    }
    holdOut[label] = res;
    // By what the call needed: does a near miss on price land as well as on probability?
    const byFam: Record<string, Tally> = {};
    for (const pk of allExtra) add(byFam[pk.option.family] ??= empty(), pk.row, pk);
    console.log(`    by family: ${Object.entries(byFam).map(([k, t]) => `${k} ${t.n} ${pct(t.won / (t.n || 1))} ${pct(t.pnl / (t.n || 1))}`).join('; ')}`);
  }
  report['hold'] = holdOut;

  /* --------------------------------------------------------- 3. quiet days */
  console.log('\n3. Quiet days: one best read when the rule makes few calls');
  console.log('   (chosen among fixtures the rule passed on: most prominent league first, then likeliest; production\'s tests at a lower floor)');
  const quietOut: Record<string, unknown> = {};
  for (const upTo of [0, 1, 2]) {
    for (const floor of [0.65, 0.68, 0.7, 0.72, 0.75]) {
      for (const maxRank of [4, 6]) {
        const lean: Policy = { ...PROD, name: `read ${floor}`, minProb: floor, rankFloor: undefined, excludeRanks: [9] };
        const line: string[] = [];
        const res: Record<string, Tally & { days: number }> = {};
        for (const [l, part] of parts) {
          const t = { ...empty(), days: 0 };
          for (const day of byDay(part)) {
            if (day.length < 3) continue;
            const called = chooseDay(PROD, day, cache);
            if (called.length > upTo) continue;
            t.days++;
            const ids = new Set(called.map((x) => x.row.id));
            const cands = day.filter((r) => !ids.has(r.id) && r.rank <= maxRank)
              .map((r) => ({ r, pk: chooseDay(lean, [r], cache)[0] }))
              .filter((x) => x.pk)
              .sort((x, y) => x.r.rank - y.r.rank || y.pk!.p - x.pk!.p);
            if (cands[0]) add(t, cands[0].r, cands[0].pk!);
          }
          res[l] = t;
          line.push(`${l} ${t.days}d ${show(t)}`);
        }
        quietOut[`<=${upTo} calls, ${floor}, rank<=${maxRank}`] = res;
        console.log(`  days with ${upTo === 0 ? 'no calls' : `at most ${upTo}`}, floor ${pct(floor)}, rank <= ${maxRank}`);
        for (const s of line) console.log(`    ${s}`);
      }
    }
  }
  report['quiet'] = quietOut;

  /* --------------------------------------------------- 4. floors, by family */
  console.log('\n4. Floors by market family and league rank (against production, B and C together, days resampled)');
  const fam = (f: Partial<Record<MarketFamily, number>>) => f;
  const variants: Array<[string, Policy]> = [
    ['goals 76%', { ...PROD, familyFloor: fam({ goals: 0.76 }) }],
    ['goals 74%', { ...PROD, familyFloor: fam({ goals: 0.74 }) }],
    ['goals 80%', { ...PROD, familyFloor: fam({ goals: 0.8 }) }],
    ['result 76%', { ...PROD, familyFloor: fam({ result: 0.76 }) }],
    ['result 74%', { ...PROD, familyFloor: fam({ result: 0.74 }) }],
    ['result 80%', { ...PROD, familyFloor: fam({ result: 0.8 }) }],
    ['handicap 76%', { ...PROD, familyFloor: fam({ handicap: 0.76 }) }],
    ['handicap 80%', { ...PROD, familyFloor: fam({ handicap: 0.8 }) }],
    ['handicap 82%', { ...PROD, familyFloor: fam({ handicap: 0.82 }) }],
    ['corners 80%', { ...PROD, familyFloor: fam({ corners: 0.8 }) }],
    ['corners 76%', { ...PROD, familyFloor: fam({ corners: 0.76 }) }],
    ['all 76%', { ...PROD, minProb: 0.76 }],
    ['all 75%', { ...PROD, minProb: 0.75 }],
    ['all 80%', { ...PROD, minProb: 0.8 }],
    ['rank 3 at 78%', { ...PROD, rankFloor: { ...PROD.rankFloor, 3: 0.78 } }],
    ['rank 3 at 80%', { ...PROD, rankFloor: { ...PROD.rankFloor, 3: 0.8 } }],
    ['rank 3 at 82%', { ...PROD, rankFloor: { ...PROD.rankFloor, 3: 0.82 } }],
    ['ranks 1-2 at 74%', { ...PROD, rankFloor: { ...PROD.rankFloor, 1: 0.74, 2: 0.74 } }],
    ['ranks 1-2 at 78%', { ...PROD, rankFloor: { ...PROD.rankFloor, 1: 0.78, 2: 0.78 } }],
    ['friendlies at 80%', { ...PROD, rankFloor: { ...PROD.rankFloor, 9: 0.8 } }],
    ['no friendlies', { ...PROD, excludeRanks: [9] }],
    ['no drift limit', { ...PROD, maxDrift: undefined }],
    ['sharp within 1%', { ...PROD, minSharpEv: -0.01 }],
    ['sharp 1% over', { ...PROD, minSharpEv: 0.01 }],
    ['no diversity cap', { ...PROD, diversity: null }],
    ['growth ranking', { ...PROD, rankBy: 'growth' }],
    ['max odds 2.5', { ...PROD, maxOdds: 2.5 }],
    ['min odds 1.18', { ...PROD, minOdds: 1.18 }],
  ];
  const floorsOut: Record<string, unknown> = {};
  const baseBC = perDay([...dayPicks(PROD, b, cache), ...dayPicks(PROD, c, cache)]);
  for (const [label, v] of variants) {
    const p = { ...v, name: label };
    const sims = parts.map(([l, part]) => [l, simulate(p, part, cache)] as const);
    const bs = bootstrap(perDay([...dayPicks(p, b, cache), ...dayPicks(p, c, cache)]), baseBC, 2000);
    floorsOut[label] = { ...Object.fromEntries(sims), bootstrap: bs };
    console.log(`  ${label}`);
    for (const [l, r] of sims) console.log(`  ${simLine(l, r)}`);
    console.log(`      vs production on B+C: return ahead in ${pct(bs.roiAhead)} of draws, landing ahead in ${pct(bs.hitAhead)}, difference ${pct(bs.lo)} to ${pct(bs.hi)}`);
  }
  report['floors'] = floorsOut;

  /* ------------------------------------------------------- 5. calibration */
  console.log('\n5. Does a probability mean what it says? Production\'s calls (p, rank floors included), and every option at 70%+');
  const bands = [0.65, 0.7, 0.75, 0.78, 0.82, 0.86, 0.9, 0.97];
  const calOut: Record<string, unknown> = {};
  for (const [label, set] of [['whole', sorted], ['C', c]] as const) {
    const all = new Map<string, Tally>();
    for (const r of set) {
      for (const o of cache.get(r.id) ?? []) {
        if (o.push > 1e-9 || o.odds < 1.13) continue;
        const p = probOf(PROD, o);
        if (p === null || p < bands[0]!) continue;
        const i = bands.findIndex((x, k) => p >= x && p < (bands[k + 1] ?? 1));
        if (i < 0 || i >= bands.length - 1) continue;
        const k = `${o.family} ${pct(bands[i]!)}-${pct(bands[i + 1]!)}`;
        add(all.get(k) ?? (all.set(k, empty()), all.get(k)!), r, { option: o, p });
      }
    }
    calOut[label] = Object.fromEntries(all);
    console.log(`  every option, ${label}:`);
    for (const [k, t] of [...all].sort()) if (t.n >= 30) console.log(`    ${k.padEnd(22)} ${show(t)}`);
    const picks = dayPicks(PROD, set, cache);
    const byFam = new Map<string, Tally>();
    for (const pk of picks) { const k = pk.option.family; add(byFam.get(k) ?? (byFam.set(k, empty()), byFam.get(k)!), pk.row, pk); }
    console.log(`  production's calls, ${label}: ${[...byFam].map(([k, t]) => `${k} ${show(t).trim()}`).join(' | ')}`);
  }
  report['calibration'] = calOut;
  return report;
}

/**
 * `lab deep anatomy`: what separates production's calls that land from the
 * ones that do not, period by period. Each feature is something known before
 * kick-off; a split that holds in A, B and C is a candidate for the rule, one
 * that flips is noise.
 */
export function runAnatomy(rows: HistRow[]): Record<string, unknown> {
  const sorted = [...rows].sort((a, b) => a.kickoff - b.kickoff);
  const a = sorted.slice(0, Math.floor(sorted.length * 0.5));
  const b = sorted.slice(a.length, Math.floor(sorted.length * 0.75));
  const c = sorted.slice(a.length + b.length);
  const cache: Cache = new Map(sorted.map((r) => [r.id, optionsFor(r, PROD.modelWeight)]));
  // The pool: every production call, plus the near misses on price, so that
  // a split has enough in it to say something.
  const loose: Policy = { ...PROD, name: 'loose', minEv: -0.03, minSharpEv: -0.02, maxDrift: 0.03 };
  const features: Array<[string, (pk: Pick) => string]> = [
    ['best odds over the sharp book\'s fair', (pk) => { const o = pk.option; if (o.sharp === null) return 'no sharp book'; const e = evOf(o.sharp, o); return e < 0 ? 'under' : e < 0.01 ? '0-1%' : e < 0.03 ? '1-3%' : e < 0.06 ? '3-6%' : '6%+'; }],
    ['sharp book against the consensus', (pk) => { const o = pk.option; if (o.sharp === null) return 'no sharp book'; const d = o.sharp - o.book; return d < -0.02 ? 'sharp 2+ under' : d < 0 ? 'sharp 0-2 under' : d < 0.02 ? 'sharp 0-2 over' : 'sharp 2+ over'; }],
    ['money since the open', (pk) => { const o = pk.option; if (o.open === null) return 'no open'; const m = (o.sharp ?? o.book) - o.open; return m < -0.01 ? 'against 1+' : m < 0 ? 'against 0-1' : m < 0.01 ? 'for 0-1' : m < 0.03 ? 'for 1-3' : 'for 3+'; }],
    ['books pricing it', (pk) => { const n = pk.option.books; return n === null ? 'unknown' : n < 6 ? '<6' : n < 12 ? '6-11' : n < 20 ? '12-19' : '20+'; }],
    ['odds', (pk) => { const x = pk.option.odds; return x < 1.17 ? '1.13-1.16' : x < 1.22 ? '1.17-1.21' : x < 1.3 ? '1.22-1.29' : x < 1.45 ? '1.30-1.44' : '1.45+'; }],
    ['probability', (pk) => { const p = pk.p; return p < 0.78 ? '<78' : p < 0.82 ? '78-82' : p < 0.86 ? '82-86' : p < 0.9 ? '86-90' : '90+'; }],
    ['family', (pk) => pk.option.family],
    ['market', (pk) => `${pk.option.market} ${pk.option.outcome}${pk.option.line === null ? '' : ` ${pk.option.line > 0 ? '+' : ''}${pk.option.line}`}`.replace(/(asian_handicap|european_handicap) (HOME|AWAY) .*/, '$1 $2')],
    ['handicap line', (pk) => pk.option.family !== 'handicap' || pk.option.line === null ? 'n/a' : `${pk.option.market === 'european_handicap' ? 'eh' : 'ah'} ${pk.option.line > 0 ? '+' : ''}${pk.option.line}`],
    ['rank', (pk) => String(pk.row.rank)],
    ['provider agrees', (pk) => { const o = pk.option; if (o.provider === null) return 'no provider'; const d = o.provider - (o.sharp ?? o.book); return d < -0.05 ? 'provider 5+ under' : d < 0 ? 'provider 0-5 under' : 'provider over'; }],
    ['our blend agrees (goals)', (pk) => { const o = pk.option; if (o.family !== 'goals' || o.blend === null) return 'n/a'; const d = o.blend - (o.sharp ?? o.book); return d < -0.02 ? 'blend 2+ under' : d < 0.02 ? 'within 2' : 'blend 2+ over'; }],
  ];
  const out: Record<string, unknown> = {};
  for (const [pname, pol] of [['production', PROD], ['production plus near misses on price', loose]] as const) {
    console.log(`\n${pname}`);
    const picks = { A: dayPicks(pol, a, cache), B: dayPicks(pol, b, cache), C: dayPicks(pol, c, cache) };
    for (const [fname, f] of features) {
      console.log(`  ${fname}`);
      const keys = new Set<string>();
      const tallies: Record<string, Record<string, Tally>> = {};
      for (const [l, ps] of Object.entries(picks)) {
        for (const pk of ps) {
          const k = f(pk);
          keys.add(k);
          add(((tallies[k] ??= {})[l] ??= empty()), pk.row, pk);
        }
      }
      for (const k of [...keys].sort()) {
        const t = tallies[k]!;
        const cell = (l: string) => { const x = t[l]; return x?.n ? `${String(x.n).padStart(4)} ${pct(x.won / x.n).padStart(6)}/${pct(x.p / x.n).padStart(6)} ${pct(x.pnl / x.n).padStart(7)}` : '   0' + ' '.repeat(29); };
        console.log(`    ${k.padEnd(26)} A ${cell('A')}  B ${cell('B')}  C ${cell('C')}`);
      }
      out[`${pname} | ${fname}`] = tallies;
    }
  }
  console.log('\n  (each cell: calls, landed / said, return per call)');
  return out;
}

/**
 * `lab deep live`: what the live engine does that the lab's replay does not.
 *
 *   1. The overclaim each market family is charged on the floor (slate.ts,
 *      loadCalibration), which the lab never applies.
 *   2. The settled record week by week.
 *   3. How much of each week's prices carried the sharp book, the opening
 *      price and a book count: the tests that lean on them go quiet without.
 *   4. The calls the lab would make since the switch that the live engine did
 *      not, against the floor the overclaim makes.
 */
export async function runLiveGap(rows: HistRow[]): Promise<Record<string, unknown>> {
  const { loadCalibration } = await import('../slate.ts');
  const { overclaim } = await import('../select.ts');
  const { select } = await import('../store.ts');
  const out: Record<string, unknown> = {};
  const cal = await loadCalibration();
  console.log('1. The floor each family is charged (published calls only)');
  const fams: MarketFamily[] = ['result', 'goals', 'handicap', 'corners', 'cards'];
  for (const f of fams) {
    const r = cal.get(f);
    const oc = overclaim(f, cal);
    console.log(`  ${f.padEnd(9)} n ${String(r?.n ?? 0).padStart(4)}  said ${r?.mean_model_p != null ? pct(r.mean_model_p) : '-'}  got ${r?.mean_actual != null ? pct(r.mean_actual) : '-'}  overclaim ${pct(oc)}  floor ${pct(0.78 + oc)} (marquee ${pct(0.7 + oc)}, rank 3 ${pct(0.85 + oc)})`);
  }
  out['overclaim'] = Object.fromEntries(fams.map((f) => [f, overclaim(f, cal)]));

  console.log('\n2. The settled record, week by week (first call per fixture)');
  const picks = await select<{ fixture_id: number; kickoff: number; market: string; model_prob: number; odds: number; result: string; created_at: number }>(
    `SELECT fixture_id, kickoff, market, model_prob, odds, result, created_at FROM pick
      WHERE kind = 'CONFIDENT' AND settled_at IS NOT NULL AND result IN ('WON','LOST','HALF_WON','HALF_LOST','PUSH') ORDER BY kickoff`,
  );
  const weeks = new Map<string, Tally & { fams: Record<string, number> }>();
  for (const p of picks) {
    const wk = new Date((Math.floor(Number(p.kickoff) / 604800) * 604800 + 345600) * 1000).toISOString().slice(0, 10);
    const t = weeks.get(wk) ?? { ...empty(), fams: {} };
    t.n++; t.p += Number(p.model_prob); t.odds += Number(p.odds);
    const won = p.result === 'WON' ? 1 : p.result === 'HALF_WON' ? 0.5 : 0;
    t.won += won;
    t.pnl += p.result === 'WON' ? Number(p.odds) - 1 : p.result === 'LOST' ? -1 : p.result === 'HALF_WON' ? (Number(p.odds) - 1) / 2 : p.result === 'HALF_LOST' ? -0.5 : 0;
    const fam = MARKET_FAMILY[p.market as keyof typeof MARKET_FAMILY] ?? p.market;
    t.fams[fam] = (t.fams[fam] ?? 0) + 1;
    weeks.set(wk, t);
  }
  for (const [wk, t] of weeks) console.log(`  week of ${wk}  ${show(t)}  ${Object.entries(t.fams).map(([k, v]) => `${k} ${v}`).join(', ')}`);

  console.log('\n3. What the prices carried, week by week (options in the lab\'s history)');
  const cov = new Map<string, { fx: number; sharp: number; open: number; books: number; opts: number; optSharp: number }>();
  for (const r of rows) {
    const wk = new Date((Math.floor(r.kickoff / 604800) * 604800 + 345600) * 1000).toISOString().slice(0, 10);
    const c = cov.get(wk) ?? { fx: 0, sharp: 0, open: 0, books: 0, opts: 0, optSharp: 0 };
    c.fx++;
    const res = r.markets.find((m) => m.market === '1x2');
    if (res?.sharp) c.sharp++;
    if (res?.open) c.open++;
    if (typeof res?.books === 'number') c.books++;
    for (const m of r.markets) { c.opts++; if (m.sharp) c.optSharp++; }
    cov.set(wk, c);
  }
  for (const [wk, c] of [...cov].sort()) console.log(`  week of ${wk}  ${String(c.fx).padStart(4)} fixtures: result market with sharp book ${pct(c.sharp / c.fx)}, opening price ${pct(c.open / c.fx)}, book count ${pct(c.books / c.fx)}; markets with sharp book ${pct(c.optSharp / (c.opts || 1))}`);
  out['coverage'] = Object.fromEntries(cov);

  console.log('\n4. Since the switch: calls the lab would make, against the floor the overclaim makes');
  const SWITCH = 1790529496;
  const period = rows.filter((r) => r.kickoff >= SWITCH);
  const cache: Cache = new Map(period.map((r) => [r.id, optionsFor(r, PROD.modelWeight)]));
  const liveIds = new Set(picks.map((p) => Number(p.fixture_id)));
  const blocked = empty(), passed = empty();
  for (const day of byDay(period)) {
    for (const pk of chooseDay(PROD, day, cache)) {
      if (liveIds.has(pk.row.id)) continue;
      const floor = floorOf(PROD, pk.row, pk.option) + overclaim(pk.option.family, cal);
      const t = pk.p < floor ? blocked : passed;
      add(t, pk.row, pk);
    }
  }
  console.log(`  lab only, under the charged floor  ${show(blocked)}`);
  console.log(`  lab only, over it (missed for another reason)  ${show(passed)}`);
  return out;
}
