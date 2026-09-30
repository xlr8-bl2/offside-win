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
import { scoreSources, simulate, type HistRow } from './markets.ts';
import { PROD } from './tune.ts';

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
  // The rule the slate runs, drift limit and friendly bar included.
  const production = PROD;
  const marketOnly = { ...production, name: 'production, market only (no blend)', modelWeight: 0 };

  // Calls with and without an opening price. Without one the drift limit
  // cannot run (Houston v Sporting KC, 26 September 2026: called at 1.17,
  // 1.27 by kick-off, lost 0-2), so if those calls land less, the limit
  // missing is costing us.
  console.log('\nThe production rule, by whether the call had an opening price:');
  for (const p of [production, { ...production, name: 'with an opening price', requireOpen: true }, { ...production, name: 'without one', requireOpen: false }]) {
    const r = simulate(p, rows);
    console.log(`  ${p.name.padEnd(38)} ${String(r.n).padStart(4)} calls  ${pct(r.hitRate).padStart(6)} landed  odds ${r.avgOdds.toFixed(2)}  return ${pct(r.roi).padStart(7)}`);
  }

  // The start of a season, and sides new to the division. Wydad Casablanca
  // 1-3 Widad Temara (26 September 2026) was the opening day of the Botola,
  // against a promoted side playing its first top-flight game: nothing in
  // last season's numbers says what that side is worth.
  const ids = rows.filter((r) => sliceOf(nameOf.get(r.league_id) ?? '') === 'league').map((r) => r.id);
  const facts = await select<{ id: number; hg: number; ag: number; hnew: boolean; anew: boolean }>(
    `SELECT m.id,
            (SELECT count(*) FROM match p WHERE p.league_id = m.league_id AND p.season_id = m.season_id AND p.kickoff < m.kickoff
               AND (p.home_team_id = m.home_team_id OR p.away_team_id = m.home_team_id))::int AS hg,
            (SELECT count(*) FROM match p WHERE p.league_id = m.league_id AND p.season_id = m.season_id AND p.kickoff < m.kickoff
               AND (p.home_team_id = m.away_team_id OR p.away_team_id = m.away_team_id))::int AS ag,
            NOT EXISTS (SELECT 1 FROM match p WHERE p.league_id = m.league_id AND p.season_id <> m.season_id
               AND (p.home_team_id = m.home_team_id OR p.away_team_id = m.home_team_id)) AS hnew,
            NOT EXISTS (SELECT 1 FROM match p WHERE p.league_id = m.league_id AND p.season_id <> m.season_id
               AND (p.home_team_id = m.away_team_id OR p.away_team_id = m.away_team_id)) AS anew
       FROM match m WHERE m.id = ANY(?) AND m.season_id IS NOT NULL`,
    [ids],
  );
  const early = new Set(facts.filter((f) => Math.min(Number(f.hg), Number(f.ag)) < 2).map((f) => Number(f.id)));
  const fresh = new Set(facts.filter((f) => f.hnew || f.anew).map((f) => Number(f.id)));
  const leagueRows = rows.filter((r) => ids.includes(r.id));
  console.log(`\nLeague matches: ${leagueRows.length}; ${early.size} with a side in its first two games of the season; ${fresh.size} with a side new to the division (${facts.length} with a season recorded)`);
  const split = (label: string, rs: HistRow[]) => {
    const sorted = [...rs].sort((a, b) => a.kickoff - b.kickoff);
    const half = Math.floor(sorted.length / 2);
    for (const p of [production, { ...production, name: 'floor 0.82', minProb: 0.82 }, { ...production, name: 'floor 0.85', minProb: 0.85 }]) {
      const all = simulate(p, rs);
      const a = simulate(p, sorted.slice(0, half));
      const b = simulate(p, sorted.slice(half));
      const cell = (r: typeof a) => `${String(r.n).padStart(3)} calls ${pct(r.hitRate).padStart(6)} ${pct(r.roi).padStart(7)}`;
      console.log(`  ${label.padEnd(26)} ${p.name.padEnd(12)} ${cell(all)}   halves: ${cell(a)}  |  ${cell(b)}`);
    }
  };
  split('early season', leagueRows.filter((r) => early.has(r.id)));
  split('rest of the season', leagueRows.filter((r) => !early.has(r.id)));
  split('a side new to the division', leagueRows.filter((r) => fresh.has(r.id)));
  split('neither side new', leagueRows.filter((r) => !fresh.has(r.id)));

  for (const [slice, rs] of [...bySlice].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`\n== ${slice}: ${rs.length} fixtures`);
    for (const w of [0, 0.5]) {
      const s = scoreSources(rs, w);
      const goals = s['goals'];
      if (!goals) continue;
      const cell = (k: string) => (goals[k] ? `${k} ${goals[k]!.logLoss.toFixed(4)} (${goals[k]!.n})` : '');
      console.log(`  goals, model weight ${w}: ${['book', 'blend', 'model', 'sharp'].map(cell).filter(Boolean).join('   ')}`);
    }
    for (const p of [production, marketOnly]) {
      const r = simulate(p, rs);
      console.log(`  ${p.name.padEnd(38)} ${String(r.n).padStart(4)} calls  ${pct(r.hitRate).padStart(6)} landed  odds ${r.avgOdds.toFixed(2)}  return ${pct(r.roi).padStart(7)}  ${Object.entries(r.byFamily).map(([f, v]) => `${f} ${v.n}:${pct(v.roi)}`).join(' ')}`);
    }
    // The alternatives, on the older and the newer half of the slice apart,
    // so a change has to hold in both periods rather than in the pooled total.
    if (slice === 'friendly' || slice === 'domestic cup') {
      const sorted = [...rs].sort((a, b) => a.kickoff - b.kickoff);
      const half = Math.floor(sorted.length / 2);
      // Each bar set both as the default and as the friendly bar, which the
      // live rule now carries on its own (rank 9), so the rows compare like
      // with like; "78%" is the rule as it was before.
      const at = (x: number, name: string) => ({ ...production, name, minProb: x, rankFloor: { ...production.rankFloor, 9: x } });
      const before = at(0.78, 'production before (78%)');
      const variants = [
        before,
        at(0.82, 'floor 0.82'),
        at(0.85, 'floor 0.85 (production now)'),
        at(0.88, 'floor 0.88'),
        { ...before, name: 'no "either side to win"', excludeBuckets: [...(production.excludeBuckets ?? []), 'double_chance 12'] },
        { ...before, name: 'no draw-sensitive calls (12, draw no bet)', excludeBuckets: [...(production.excludeBuckets ?? []), 'double_chance 12', 'draw_no_bet home', 'draw_no_bet away'] },
      ];
      console.log(`  alternatives, older half | newer half:`);
      for (const p of variants) {
        const a = simulate(p, sorted.slice(0, half));
        const b = simulate(p, sorted.slice(half));
        const cell = (r: typeof a) => `${String(r.n).padStart(3)} calls ${pct(r.hitRate).padStart(6)} ${pct(r.roi).padStart(7)}`;
        console.log(`    ${p.name.padEnd(44)} ${cell(a)}  |  ${cell(b)}`);
      }
    }
  }
}
