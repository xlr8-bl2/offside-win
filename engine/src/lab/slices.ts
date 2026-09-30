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
import { grade, optionsFor, scoreSources, simulate, type HistRow } from './markets.ts';
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

  // Does a probability mean what it says? For every option the market priced,
  // by family and by the probability we would publish (the sharp book's, else
  // the consensus), how often it landed. A line read the wrong way round (a
  // handicap's sign, say) shows up here as "said 85%, got 15%".
  console.log('\nCalibration: the probability we would publish against how often it landed (pushes left out)');
  const bins = [0.5, 0.6, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 1.0001];
  const cal = new Map<string, Array<{ n: number; p: number; y: number }>>();
  for (const r of rows) {
    for (const o of optionsFor(r, 0)) {
      const p = o.sharp ?? o.book;
      if (p < 0.5) continue;
      const g = grade(r, o);
      if (!g || (g.result !== 'WON' && g.result !== 'LOST')) continue;
      const k = o.market === 'asian_handicap' ? `handicap ${o.line !== null && Number.isInteger(o.line * 2) ? (Number.isInteger(o.line) ? 'whole' : 'half') : 'quarter'}` : o.family;
      const arr = cal.get(k) ?? bins.slice(1).map(() => ({ n: 0, p: 0, y: 0 }));
      const i = bins.findIndex((b, j) => p >= b && p < bins[j + 1]!);
      if (i < 0) continue;
      arr[i]!.n++; arr[i]!.p += p; arr[i]!.y += g.result === 'WON' ? 1 : 0;
      cal.set(k, arr);
    }
  }
  for (const [k, arr] of [...cal].sort()) {
    console.log(`  ${k.padEnd(16)} ${arr.map((b, i) => b.n ? `${bins[i]!.toFixed(2)}+: ${pct(b.p / b.n)} said, ${pct(b.y / b.n)} got (${b.n})` : '').filter(Boolean).join('   ')}`);
  }

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

  // A favourite on a winning run. Brighton 3-0 Arsenal (19 September 2026):
  // Arsenal had won seven straight, and backers are said to overrate a run.
  // The run is counted over each side's last five finished matches in any
  // competition, before kick-off.
  const runs = await select<{ id: number; hw: number; hn: number; aw: number; an: number }>(
    `SELECT m.id,
            (SELECT count(*) FILTER (WHERE (p.home_team_id = m.home_team_id AND p.home_goals > p.away_goals)
                                        OR (p.away_team_id = m.home_team_id AND p.away_goals > p.home_goals))
               FROM (SELECT * FROM match p WHERE (p.home_team_id = m.home_team_id OR p.away_team_id = m.home_team_id)
                       AND p.kickoff < m.kickoff AND p.home_goals IS NOT NULL ORDER BY p.kickoff DESC LIMIT 5) p)::int AS hw,
            (SELECT count(*) FROM (SELECT 1 FROM match p WHERE (p.home_team_id = m.home_team_id OR p.away_team_id = m.home_team_id)
                       AND p.kickoff < m.kickoff AND p.home_goals IS NOT NULL ORDER BY p.kickoff DESC LIMIT 5) p)::int AS hn,
            (SELECT count(*) FILTER (WHERE (p.home_team_id = m.away_team_id AND p.home_goals > p.away_goals)
                                        OR (p.away_team_id = m.away_team_id AND p.away_goals > p.home_goals))
               FROM (SELECT * FROM match p WHERE (p.home_team_id = m.away_team_id OR p.away_team_id = m.away_team_id)
                       AND p.kickoff < m.kickoff AND p.home_goals IS NOT NULL ORDER BY p.kickoff DESC LIMIT 5) p)::int AS aw,
            (SELECT count(*) FROM (SELECT 1 FROM match p WHERE (p.home_team_id = m.away_team_id OR p.away_team_id = m.away_team_id)
                       AND p.kickoff < m.kickoff AND p.home_goals IS NOT NULL ORDER BY p.kickoff DESC LIMIT 5) p)::int AS an
       FROM match m WHERE m.id = ANY(?)`,
    [rows.map((r) => r.id)],
  );
  const runOf = new Map(runs.map((x) => [Number(x.id), x]));
  const favOnRun = (r: HistRow): boolean | null => {
    const res = r.markets.find((m) => m.market === '1x2' && m.line === null);
    const x = runOf.get(r.id);
    if (!res || !x) return null;
    const home = (res.book['HOME'] ?? 0) >= (res.book['AWAY'] ?? 0);
    return home ? Number(x.hn) === 5 && Number(x.hw) === 5 : Number(x.an) === 5 && Number(x.aw) === 5;
  };
  const known = rows.filter((r) => favOnRun(r) !== null);
  console.log(`\nFavourite on a winning run (won its last five), all competitions: ${known.filter((r) => favOnRun(r)).length} of ${known.length} fixtures`);
  split('favourite won last five', known.filter((r) => favOnRun(r)));
  split('favourite otherwise', known.filter((r) => !favOnRun(r)));

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
