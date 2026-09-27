/**
 * `npm run lab`: the market lab over every finished fixture in the database.
 *
 * Reads in pages (a bundle is large and there are thousands), keeps only what
 * the lab needs, and prints the report. The summary is also kept in kv as
 * `lab:markets`, so the numbers the engine's settings were chosen on are on
 * record beside them.
 *
 * Prints market names, counts and returns. Never a key, an account or a price
 * a member paid for that is still to be played: every fixture here has
 * finished.
 */

import { kvSetJSON, select } from '../store.ts';
import { scoreSources, simulate, toHistRow, walkForward, CURRENT, type HistRow } from './markets.ts';

interface Row {
  id: number;
  league_id: number;
  rank: number | null;
  kickoff: number;
  home_goals: number;
  away_goals: number;
  bundle_json: string;
  report_json: string | null;
}

export async function loadHistory(): Promise<HistRow[]> {
  const out: HistRow[] = [];
  let after = 0;
  for (;;) {
    const page = await select<Row>(
      `SELECT id, league_id, rank, kickoff, home_goals, away_goals, bundle_json, report_json
         FROM fixture
        WHERE home_goals IS NOT NULL AND away_goals IS NOT NULL AND kickoff > $1
        ORDER BY kickoff
        LIMIT 400`,
      [after],
    );
    if (!page.length) break;
    for (const r of page) {
      after = Math.max(after, Number(r.kickoff));
      let b: Record<string, any>;
      try { b = JSON.parse(r.bundle_json); } catch { continue; }
      let rep: Record<string, any> | null = null;
      try { rep = r.report_json ? JSON.parse(r.report_json) : null; } catch { rep = null; }
      const st = rep?.stats;
      const corners = st?.home && st?.away && typeof st.home.corners === 'number' && typeof st.away.corners === 'number'
        ? [st.home.corners, st.away.corners] : null;
      const reds = st?.home && st?.away ? (Number(st.home.red) || 0) + (Number(st.away.red) || 0) : null;
      const h = toHistRow({
        id: r.id,
        league_id: r.league_id,
        rank: r.rank ?? b.rank,
        kickoff: r.kickoff,
        score: [r.home_goals, r.away_goals],
        corners,
        reds,
        lambda: [b.lambda_home, b.lambda_away],
        confidence: b.confidence,
        markets: b.markets,
        provider: b.external?.bsd_prediction ?? null,
      });
      if (h) out.push(h);
    }
    if (page.length < 400) break;
  }
  return out;
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

export async function runLab(): Promise<void> {
  const rows = await loadHistory();
  const withCorners = rows.filter((r) => r.corners).length;
  const days = rows.length ? (rows[rows.length - 1]!.kickoff - rows[0]!.kickoff) / 86400 : 0;
  console.log(`lab: ${rows.length} finished fixtures with a market snapshot, over ${days.toFixed(0)} days; ${withCorners} with corners`);
  if (rows.length < 50) {
    console.log('lab: not enough history to say anything yet');
    return;
  }

  console.log('\nAccuracy by source (log loss, lower is better):');
  const accuracy: Record<string, unknown> = {};
  for (const w of [0, 0.15, 0.3, 0.5]) {
    const s = scoreSources(rows, w);
    accuracy[String(w)] = s;
    console.log(`  model weight ${w}`);
    for (const [fam, srcs] of Object.entries(s)) {
      console.log(`    ${fam.padEnd(9)} ${Object.entries(srcs).map(([k, v]) => `${k} ${v.logLoss.toFixed(4)} (${v.n})`).join('   ')}`);
    }
  }

  const all = simulate(CURRENT, rows);
  console.log(`\nToday's rule over everything: ${all.n} calls, ${pct(all.hitRate)} landed, average odds ${all.avgOdds.toFixed(2)}, return ${pct(all.roi)} per call`);

  const wf = walkForward(rows, 0.6, Math.max(40, Math.round(rows.length * 0.04)));
  console.log(`\nWalk-forward: tuned on the first ${wf.trainRows} fixtures, scored on the last ${wf.testRows}`);
  const line = (label: string, r: ReturnType<typeof simulate>) =>
    console.log(`  ${label.padEnd(8)} ${String(r.n).padStart(5)} calls  ${pct(r.hitRate).padStart(6)} landed  odds ${r.avgOdds.toFixed(2)}  return ${pct(r.roi).padStart(7)}  worst run ${r.drawdown.toFixed(1)}  ${Object.entries(r.byFamily).map(([f, v]) => `${f} ${v.n}:${pct(v.roi)}`).join(' ')}`);
  console.log('  today\'s rule');
  line('train', wf.current.train);
  line('test', wf.current.test);
  for (const b of wf.best) {
    console.log(`  ${b.policy.name}`);
    line('train', b.train);
    line('test', b.test);
  }

  await kvSetJSON('lab:markets', {
    at: Math.floor(Date.now() / 1000),
    rows: rows.length,
    days,
    accuracy,
    current: all,
    walkForward: {
      trainRows: wf.trainRows,
      testRows: wf.testRows,
      current: wf.current,
      best: wf.best.map((b) => ({ policy: b.policy, train: b.train, test: b.test })),
    },
  });
}
