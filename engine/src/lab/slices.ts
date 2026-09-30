/**
 * `npm run lab:slices`: the production rule and the probability sources, one
 * kind of match at a time.
 *
 * The audit of lost calls turned up matches where our own ratings have no
 * common scale: a cup tie between a fourth-tier side and a professional club
 * (SU Sintrense v AVS), friendlies between national sides who rarely meet.
 * The ratings are fitted league by league, so a blend that helps inside a
 * league may hurt across one. This asks, per kind of match, whether the
 * market alone or the blend reads it better, and how the published rule has
 * done there, so any exception is made on evidence rather than on a story.
 *
 * Read-only. Prints counts, rates and returns.
 */

import { select } from '../store.ts';
import { productionRules, scoreSources, simulate, type HistRow } from './markets.ts';

export type Slice = 'league' | 'domestic cup' | 'continental club' | 'international' | 'friendly';

/** What kind of competition a league name describes. */
export function sliceOf(name: string): Slice {
  const n = name.toLowerCase();
  if (/friendl/.test(n)) return 'friendly';
  if (/nations league|world cup|euro(pean championship)?\b|qualif|copa am[eé]rica|africa cup|asian cup|gold cup|concacaf nations|afcon/.test(n)
      && !/club/.test(n)) return 'international';
  if (/champions league|europa|conference league|libertadores|sudamericana|concacaf champions|afc champions|caf champions|leagues cup|club world/.test(n)) return 'continental club';
  if (/\bcup\b|pokal|coupe|coppa|copa del rey|copa do brasil|copa argentina|ta[çc]a|beker|trophy|shield|super ?cup|supercopa|carabao|fa cup|efl cup|dfb|knvb|kupa|kubok|puchar|pohár/.test(n)) return 'domestic cup';
  return 'league';
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

export async function runSlices(rows: HistRow[]): Promise<void> {
  const leagues = await select<{ id: number; name: string }>('SELECT id, name FROM league');
  const nameOf = new Map(leagues.map((l) => [Number(l.id), l.name]));
  const bySlice = new Map<Slice, HistRow[]>();
  const unnamed = new Set<number>();
  for (const r of rows) {
    const name = nameOf.get(r.league_id);
    if (!name) unnamed.add(r.league_id);
    const s = sliceOf(name ?? '');
    bySlice.set(s, [...(bySlice.get(s) ?? []), r]);
  }
  console.log(`lab:slices: ${rows.length} finished fixtures; ${unnamed.size} competitions without a name counted as league`);
  const [production] = productionRules();
  const marketOnly = { ...production!, name: 'production, market only (no blend)', modelWeight: 0 };

  for (const [slice, rs] of [...bySlice].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`\n== ${slice}: ${rs.length} fixtures`);
    for (const w of [0, 0.5]) {
      const s = scoreSources(rs, w);
      const goals = s['goals'];
      if (!goals) continue;
      const cell = (k: string) => (goals[k] ? `${k} ${goals[k]!.logLoss.toFixed(4)} (${goals[k]!.n})` : '');
      console.log(`  goals, model weight ${w}: ${['book', 'blend', 'model', 'sharp'].map(cell).filter(Boolean).join('   ')}`);
    }
    for (const p of [production!, marketOnly]) {
      const r = simulate(p, rs);
      console.log(`  ${p.name.padEnd(38)} ${String(r.n).padStart(4)} calls  ${pct(r.hitRate).padStart(6)} landed  odds ${r.avgOdds.toFixed(2)}  return ${pct(r.roi).padStart(7)}  ${Object.entries(r.byFamily).map(([f, v]) => `${f} ${v.n}:${pct(v.roi)}`).join(' ')}`);
    }
  }
}
