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
import { buildSlip, type Leg } from '../slip.ts';
import { config } from '../config.ts';

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

interface Tally { days: number; slips: number; legs: number; odds: number; said: number; won: number; lost: number; voided: number; pnl: number }

function factor(result: string, odds: number): number {
  if (result === 'WON') return odds;
  if (result === 'HALF_WON') return (1 + odds) / 2;
  if (result === 'PUSH' || result === 'VOID') return 1;
  if (result === 'HALF_LOST') return 0.5;
  return 0;
}

function run(policy: Policy, part: HistRow[], cache: Map<number, Option[]>): Tally {
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
    const slip = buildSlip(legs.filter((l) => l.model_prob >= config.confident.floor));
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
  }
  return out;
}
