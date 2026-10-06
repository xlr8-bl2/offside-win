/**
 * `lab` with the argument `deep slip`: the bet slip, rebuilt on every finished
 * day in our history from the calls the engine would have made that day, and
 * graded on the real results.
 *
 * The slip is built exactly as the slate builds it (slip.ts, buildSlip): the
 * most confident call first, then the next, until the total odds reach 2.00,
 * skipping any that would pass 3.00. A day whose calls cannot reach 2.00 gets
 * no slip. Each leg settles as a bookmaker settles a leg of an accumulator: a
 * stake back counts as odds of 1, half won as half the odds, half lost as a
 * half, a loss ends it.
 *
 * Read-only. Prints counts, rates and returns, on the same date periods as
 * the other lab studies, for the new engine and the old one side by side.
 */

import { chooseDay, grade, optionsFor, type HistRow, type Option, type Policy } from './markets.ts';
import { byDay, PROD } from './tune.ts';
import { buildSlip, SLIP_DEFAULTS, type Leg } from '../slip.ts';
import { config } from '../config.ts';
import { bootstrap } from './learned.ts';

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

interface Tally { days: number; slips: number; legs: number; odds: number; said: number; won: number; lost: number; voided: number; pnl: number }

function factor(result: string, odds: number): number {
  if (result === 'WON') return odds;
  if (result === 'HALF_WON') return (1 + odds) / 2;
  if (result === 'PUSH' || result === 'VOID') return 1;
  if (result === 'HALF_LOST') return 0.5;
  return 0;
}

function run(policy: Policy, part: HistRow[], cache: Map<number, Option[]>, order: 'longest' | 'surest' = 'surest'): Tally {
  const t: Tally = { days: 0, slips: 0, legs: 0, odds: 0, said: 0, won: 0, lost: 0, voided: 0, pnl: 0 };
  for (const day of byDay(part)) {
    t.days++;
    const picks = chooseDay(policy, day, cache);
    const byId = new Map(day.map((r) => [r.id, r]));
    const legs: Leg[] = picks.map((p) => ({
      fixture_id: p.row.id, kickoff: p.row.kickoff, home: '', away: '', league: null,
      market: p.option.market, outcome: String(p.option.outcome), line: p.option.line,
      odds: p.option.odds, bookmaker: null, model_prob: p.p,
    }));
    // The slate takes only calls at or above the confident floor for a slip
    // (refreshSlip): a lower-ranked league's lower floor does not reach it.
    const slip = buildSlip(legs.filter((l) => l.model_prob >= config.confident.floor), { ...SLIP_DEFAULTS, order });
    if (!slip) continue;
    let f = 1;
    let played = 0;
    for (const l of slip.legs) {
      const row = byId.get(l.fixture_id)!;
      const g = grade(row, { market: l.market as Option['market'], outcome: l.outcome as Option['outcome'], line: l.line, odds: l.odds });
      const r = g?.result ?? 'VOID';
      if (r !== 'VOID' && r !== 'PUSH') played++;
      f *= factor(r, l.odds);
    }
    if (played === 0) { t.voided++; continue; }
    t.slips++;
    t.legs += slip.legs.length;
    t.odds += slip.odds;
    t.said += slip.chance;
    if (f >= 1) t.won++; else t.lost++;
    t.pnl += f - 1;
  }
  return t;
}

const line = (label: string, t: Tally) => t.slips
  ? `  ${label.padEnd(4)} ${String(t.slips).padStart(4)} slips on ${String(t.days).padStart(4)} days (${pct(t.slips / t.days)} of days)  ${(t.legs / t.slips).toFixed(1)} legs  odds ${(t.odds / t.slips).toFixed(2)}`
    + `  came in ${pct(t.won / t.slips).padStart(6)} (said ${pct(t.said / t.slips)})  return ${pct(t.pnl / t.slips).padStart(6)}  £10 a slip: ${t.pnl >= 0 ? '+' : '-'}£${Math.abs(t.pnl * 10).toFixed(0)}`
  : `  ${label.padEnd(4)}    0 slips on ${t.days} days`;

export function runSlipBack(rows: HistRow[]): Record<string, unknown> {
  const sorted = [...rows].sort((a, b) => a.kickoff - b.kickoff);
  const a = sorted.slice(0, Math.floor(sorted.length * 0.5));
  const b = sorted.slice(a.length, Math.floor(sorted.length * 0.75));
  const c = sorted.slice(a.length + b.length);
  const cache = new Map(sorted.map((r) => [r.id, optionsFor(r, PROD.modelWeight)]));
  const OLD: Policy = { ...PROD, name: 'old engine', floorBump: { handicap: 0.257, result: 0.017 } };
  const NEW: Policy = { ...PROD, name: 'new engine' };
  const iso = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);
  console.log(`lab deep slip: ${sorted.length} finished games, ${iso(sorted[0]!.kickoff)} to ${iso(sorted[sorted.length - 1]!.kickoff)}`);
  const out: Record<string, unknown> = {};
  for (const [label, part] of [['A (oldest half)', a], ['B (next quarter)', b], ['C (newest quarter)', c], ['all', sorted]] as const) {
    console.log(`\n  ${label}: ${part.length} games, ${iso(part[0]!.kickoff)} to ${iso(part[part.length - 1]!.kickoff)}`);
    for (const p of [OLD, NEW]) {
      const t = run(p, part, cache);
      out[`${label} ${p.name}`] = t;
      console.log(line(p.name === 'old engine' ? 'old' : 'new', t));
    }
    const t = run(NEW, part, cache, 'longest');
    out[`${label} new engine, longest first`] = t;
    console.log(line('now', t));
  }
  return out;
}

/* ------------------------------------------------------------------------
 * `deep slip study`: can the slip be built better?
 *
 * Two kinds of evidence, because a slip a day is too few to judge on alone.
 *
 *   1. Legs. Every call the slip could have used (about fifteen a day), by
 *      price, by market family, by how sure we were and by whether the sharp
 *      book agreed: how often each kind landed against how often we said it
 *      would. A kind of leg that lands less often than said is a slip-killer
 *      however sure it looks; one that lands more often is what a slip wants.
 *   2. Slips. Six other ways of building the slip, each against the current
 *      one on the same days. Anything learned from the results (which family
 *      to drop, how far to trust each family) is learned on the oldest half
 *      only and judged on the newer half it never saw.
 * ---------------------------------------------------------------------- */


interface LegX { day: number; row: HistRow; option: Option; p: number; ev: number; result: string }

const landedOf = (r: string) => r === 'WON' || r === 'HALF_WON';
const countsOf = (r: string) => r !== 'PUSH' && r !== 'VOID';

function legsByDay(policy: Policy, part: HistRow[], cache: Map<number, Option[]>): LegX[][] {
  return byDay(part).map((day) => chooseDay(policy, day, cache)
    .filter((p) => p.p >= config.confident.floor)
    .map((p) => ({
      day: Math.floor((p.row.kickoff + 3600) / 86400), row: p.row, option: p.option, p: p.p, ev: p.ev,
      result: grade(p.row, p.option)?.result ?? 'VOID',
    })));
}

function legTable(title: string, legs: LegX[], key: (l: LegX) => string) {
  const g = new Map<string, { n: number; won: number; said: number; pnl: number }>();
  for (const l of legs) {
    if (!countsOf(l.result)) continue;
    const k = key(l);
    const e = g.get(k) ?? { n: 0, won: 0, said: 0, pnl: 0 };
    e.n++; e.said += l.p; if (landedOf(l.result)) e.won++;
    e.pnl += factor(l.result, l.option.odds) - 1;
    g.set(k, e);
  }
  console.log(`\n  legs by ${title}:`);
  for (const [k, e] of [...g.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    console.log(`    ${k.padEnd(22)} ${String(e.n).padStart(4)} legs  landed ${pct(e.won / e.n).padStart(6)}  said ${pct(e.said / e.n).padStart(6)}  gap ${((e.won - e.said) / e.n * 100).toFixed(1).padStart(5)} pts  return ${pct(e.pnl / e.n).padStart(6)}`);
  }
}

const oddsBand = (o: number) => o < 1.2 ? '1.13-1.19' : o < 1.3 ? '1.20-1.29' : o < 1.45 ? '1.30-1.44' : '1.45 and up';
const probBand = (p: number) => p < 0.82 ? '78-81%' : p < 0.86 ? '82-85%' : p < 0.9 ? '86-89%' : '90% and up';
const sharpBand = (l: LegX) => l.option.sharp === null ? 'no sharp price' : l.option.sharp >= l.p ? 'sharp as sure or surer' : 'sharp less sure';

type Builder = (legs: LegX[]) => LegX[] | null;

function slipOf(legs: LegX[], prob: (l: LegX) => number, maxLegs = 6, order: 'longest' | 'surest' = 'surest'): LegX[] | null {
  const asLeg = (l: LegX): Leg => ({ fixture_id: l.row.id, kickoff: l.row.kickoff, home: '', away: '', league: null,
    market: l.option.market, outcome: String(l.option.outcome), line: l.option.line, odds: l.option.odds, bookmaker: null, model_prob: prob(l) });
  const s = buildSlip(legs.map(asLeg), { minOdds: 2, maxOdds: 3, minLegs: 2, maxLegs, pool: 14, order });
  if (!s) return null;
  const ids = new Set(s.legs.map((x) => x.fixture_id));
  return legs.filter((l) => ids.has(l.row.id));
}

/** The best joint chance inside the band, with the day's top call always on it. */
function jointBest(legs: LegX[], prob: (l: LegX) => number): LegX[] | null {
  const pool = [...legs].sort((a, b) => prob(b) - prob(a)).slice(0, 10);
  if (pool.length < 2) return null;
  const top = pool[0]!;
  let best: LegX[] | null = null;
  let bestP = -1;
  const rest = pool.slice(1);
  const walk = (i: number, picked: LegX[], odds: number, p: number) => {
    if (odds > 3) return;
    if (picked.length >= 2 && odds >= 2 && p > bestP) { best = [...picked]; bestP = p; }
    if (picked.length >= 6 || i >= rest.length) return;
    for (let k = i; k < rest.length; k++) {
      const l = rest[k]!;
      walk(k + 1, [...picked, l], odds * l.option.odds, p * prob(l));
    }
  };
  walk(0, [top], top.option.odds, prob(top));
  return best;
}

function settle(slip: LegX[]): { f: number; played: number } {
  let f = 1, played = 0;
  for (const l of slip) { if (countsOf(l.result)) played++; f *= factor(l.result, l.option.odds); }
  return { f, played };
}

export function runSlipStudy(rows: HistRow[]): Record<string, unknown> {
  const sorted = [...rows].sort((a, b) => a.kickoff - b.kickoff);
  const half = Math.floor(sorted.length * 0.5);
  const learnRows = sorted.slice(0, half);
  const testRows = sorted.slice(half);
  const cache = new Map(sorted.map((r) => [r.id, optionsFor(r, PROD.modelWeight)]));
  const NEW: Policy = { ...PROD, name: 'new engine' };
  const learnDays = legsByDay(NEW, learnRows, cache);
  const testDays = legsByDay(NEW, testRows, cache);
  const all = [...learnDays, ...testDays].flat();
  const iso = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);
  console.log(`lab deep slip study: ${all.length} legs the slip could use; learned on ${iso(learnRows[0]!.kickoff)} to ${iso(learnRows[learnRows.length - 1]!.kickoff)}, judged on ${iso(testRows[0]!.kickoff)} to ${iso(testRows[testRows.length - 1]!.kickoff)}`);

  // 1. Legs.
  legTable('price', all, (l) => oddsBand(l.option.odds));
  legTable('how sure we were', all, (l) => probBand(l.p));
  legTable('market family', all, (l) => l.option.family);
  legTable('the sharp book', all, sharpBand);
  legTable('price, newer half only', testDays.flat(), (l) => oddsBand(l.option.odds));
  legTable('family, newer half only', testDays.flat(), (l) => l.option.family);

  // What the older half says about each family, for the variants that learn.
  const fam = new Map<string, { won: number; said: number; n: number }>();
  for (const l of learnDays.flat()) {
    if (!countsOf(l.result)) continue;
    const e = fam.get(l.option.family) ?? { won: 0, said: 0, n: 0 };
    e.n++; e.said += l.p; if (landedOf(l.result)) e.won++;
    fam.set(l.option.family, e);
  }
  // Trust in each family, shrunk towards one with ten imaginary legs.
  const trust = (f: string) => { const e = fam.get(f); return e ? (e.won + 10) / (e.said + 10) : 1; };
  const worst = [...fam.entries()].filter(([, e]) => e.n >= 30).sort((a, b) => (a[1].won - a[1].said) / a[1].n - (b[1].won - b[1].said) / b[1].n)[0]?.[0];
  console.log(`\n  learned on the older half: trust ${[...fam.keys()].map((f) => `${f} ${trust(f).toFixed(2)}`).join(', ')}; worst family ${worst ?? 'none'}`);

  // The same, by price band: how often each band landed in the older half.
  const band = new Map<string, { won: number; n: number }>();
  for (const l of learnDays.flat()) {
    if (!countsOf(l.result)) continue;
    const e = band.get(oddsBand(l.option.odds)) ?? { won: 0, n: 0 };
    e.n++; if (landedOf(l.result)) e.won++;
    band.set(oddsBand(l.option.odds), e);
  }
  const overall = [...band.values()].reduce((a, e) => ({ won: a.won + e.won, n: a.n + e.n }), { won: 0, n: 0 });
  // Shrunk towards the overall rate with twenty imaginary legs.
  const bandRate = (l: LegX) => { const e = band.get(oddsBand(l.option.odds)) ?? { won: 0, n: 0 }; return (e.won + 20 * overall.won / Math.max(1, overall.n)) / (e.n + 20); };
  console.log(`  learned on the older half, by price: ${[...band.entries()].map(([k, e]) => `${k} ${pct(e.won / e.n)} of ${e.n}`).join(', ')}`);

  const p = (l: LegX) => l.p;
  const adj = (l: LegX) => Math.min(0.99, l.p * trust(l.option.family));
  // Longest price first among calls we are sure of: fewer legs to reach 2.00.
  const longFirst = (ls: LegX[], keepTop: boolean) => {
    const byP = [...ls].sort((a, b) => b.p - a.p);
    const top = byP[0];
    const rest = [...ls].filter((l) => !keepTop || l !== top).sort((a, b) => b.option.odds - a.option.odds);
    const order = keepTop && top ? [top, ...rest] : rest;
    // slipOf sorts by the probability it is handed, so hand it the order.
    const rank = new Map(order.map((l, i) => [l, 1 - i / 1000]));
    return slipOf(order, (l) => rank.get(l)!);
  };
  const builders: Array<[string, Builder]> = [
    ['current: surest first', (ls) => slipOf(ls, p)],
    ['best joint chance', (ls) => jointBest(ls, p)],
    ['surest first, trusted', (ls) => slipOf(ls, adj)],
    ['best joint, trusted', (ls) => jointBest(ls, adj)],
    ['three legs at most', (ls) => slipOf(ls, p, 3)],
    ['sharp book agrees', (ls) => slipOf(ls.filter((l) => l.option.sharp !== null && l.option.sharp >= l.p - 0.02), p)],
    [`without ${worst ?? '-'}`, (ls) => slipOf(ls.filter((l) => l.option.family !== worst), p)],
    ['longest price first', (ls) => longFirst(ls, false)],
    ['top call, then longest', (ls) => longFirst(ls, true)],
    ['the slip as built now', (ls) => slipOf(ls, p, 6, 'longest')],
    ['best joint, by price', (ls) => jointBest(ls, bandRate)],
    ['top call, joint by price', (ls) => jointBest(ls, (l) => l === [...ls].sort((a, b) => b.p - a.p)[0] ? 2 : bandRate(l))],
  ];

  const out: Record<string, unknown> = {};
  for (const [label, days] of [['older half (some rules learned here)', learnDays], ['newer half (out of sample)', testDays], ['all', [...learnDays, ...testDays]]] as const) {
    console.log(`\n  ${label}: ${days.length} days`);
    const maps: Array<Map<number, { n: number; won: number; pnl: number }>> = [];
    for (const [name, build] of builders) {
      const m = new Map<number, { n: number; won: number; pnl: number }>();
      let slips = 0, won = 0, pnl = 0, legs = 0, odds = 0, said = 0;
      for (const ls of days) {
        const s = build(ls);
        if (!s) continue;
        const { f, played } = settle(s);
        if (!played) continue;
        slips++; legs += s.length; pnl += f - 1; if (f >= 1) won++;
        odds += s.reduce((a, l) => a * l.option.odds, 1);
        said += s.reduce((a, l) => a * l.p, 1);
        m.set(s[0]!.day, { n: 1, won: f >= 1 ? 1 : 0, pnl: f - 1 });
      }
      maps.push(m);
      const vs = maps.length > 1 ? bootstrap(m, maps[0]!, 4000) : null;
      console.log(`    ${name.padEnd(24)} ${String(slips).padStart(3)} slips  ${slips ? (legs / slips).toFixed(1) : '-'} legs  odds ${slips ? (odds / slips).toFixed(2) : '-'}  came in ${slips ? pct(won / slips).padStart(6) : '-'} (said ${slips ? pct(said / slips) : '-'})  return ${slips ? pct(pnl / slips).padStart(7) : '-'}`
        + (vs ? `  ahead of current in ${pct(vs.roiAhead)} of draws` : ''));
      out[`${label} ${name}`] = { slips, won, pnl };
    }
  }
  return out;
}
