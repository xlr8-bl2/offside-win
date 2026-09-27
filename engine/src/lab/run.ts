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
import { confidentGrid, productionRules, scoreSources, simulate, toHistRow, walkForward, CURRENT, type HistRow } from './markets.ts';

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
  // And everything the board has since let go of (market_snapshot, filled by
  // pruneBoard), which is what lets the history outgrow the board's week.
  const seen = new Set(out.map((r) => r.id));
  let from = 0;
  for (;;) {
    const page = await select<{ fixture_id: number; league_id: number; kickoff: number; home_goals: number; away_goals: number; snapshot: string }>(
      `SELECT fixture_id, league_id, kickoff, home_goals, away_goals, snapshot
         FROM market_snapshot WHERE kickoff > $1 ORDER BY kickoff LIMIT 1000`,
      [from],
    );
    if (!page.length) break;
    for (const r of page) {
      from = Math.max(from, Number(r.kickoff));
      if (seen.has(Number(r.fixture_id))) continue;
      let s: Record<string, any>;
      try { s = JSON.parse(r.snapshot); } catch { continue; }
      const h = toHistRow({ ...s, id: r.fixture_id, league_id: r.league_id, kickoff: r.kickoff, score: [r.home_goals, r.away_goals] });
      if (h) out.push(h);
    }
    if (page.length < 1000) break;
  }
  return out.sort((a, b) => a.kickoff - b.kickoff);
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
  console.log(`\nThe old rule over everything: ${all.n} calls, ${pct(all.hitRate)} landed, average odds ${all.avgOdds.toFixed(2)}, return ${pct(all.roi)} per call`);

  const wf = walkForward(rows, 0.6, Math.max(40, Math.round(rows.length * 0.04)));
  console.log(`\nWalk-forward: tuned on the first ${wf.trainRows} fixtures, scored on the last ${wf.testRows}`);
  const line = (label: string, r: ReturnType<typeof simulate>) =>
    console.log(`  ${label.padEnd(8)} ${String(r.n).padStart(5)} calls  ${r.perDay.toFixed(1)}/day  ${pct(r.hitRate).padStart(6)} landed  odds ${r.avgOdds.toFixed(2)}  return ${pct(r.roi).padStart(7)}  worst run ${r.drawdown.toFixed(1)}  top market ${pct(r.topShare)} of ${r.markets}  ${Object.entries(r.byFamily).map(([f, v]) => `${f} ${v.n}:${pct(v.roi)}`).join(' ')}`);
  console.log('  today\'s rule');
  line('train', wf.current.train);
  line('test', wf.current.test);
  for (const b of wf.best) {
    console.log(`  ${b.policy.name}`);
    line('train', b.train);
    line('test', b.test);
  }

  // The published kind: likely calls, any market, varied. Eligible only if
  // they stay likely (seven in ten landing in training) and cover the board.
  const lk = walkForward(rows, 0.6, Math.max(40, Math.round(rows.length * 0.04)), confidentGrid(),
    (r) => r.hitRate >= 0.7 && r.perDay >= 5);
  console.log(`\nLikely calls, any market (walk-forward, same split)`);
  console.log('  today\'s rule');
  line('train', lk.current.train);
  line('test', lk.current.test);
  for (const b of lk.best) {
    console.log(`  ${b.policy.name}`);
    line('train', b.train);
    line('test', b.test);
    const top = Object.entries(b.test.byMarket).sort((x, y) => y[1].n - x[1].n).slice(0, 6);
    console.log(`           markets: ${top.map(([k, v]) => `${k} ${v.n}`).join(', ')}`);
  }

  // The rule the slate runs, and its neighbours, on the same split.
  const sorted = [...rows].sort((a, b) => a.kickoff - b.kickoff);
  const cut = Math.floor(sorted.length * 0.6);
  console.log('\nThe production rule and its neighbours (same split)');
  const production: Record<string, unknown> = {};
  for (const p of productionRules()) {
    const train = simulate(p, sorted.slice(0, cut));
    const test = simulate(p, sorted.slice(cut));
    production[p.name] = { train, test };
    console.log(`  ${p.name}`);
    line('train', train);
    line('test', test);
    const top = Object.entries(test.byMarket).sort((x, y) => y[1].n - x[1].n).slice(0, 6);
    console.log(`           markets: ${top.map(([k, v]) => `${k} ${v.n}`).join(', ')}`);
  }

  await kvSetJSON('lab:markets', {
    production,
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
    likely: {
      best: lk.best.map((b) => ({ policy: b.policy, train: b.train, test: b.test })),
    },
  });
}

/**
 * `npm run lab:odds`: does the provider still hold odds for matches already
 * played, and how far back? The answer decides whether the lab can be run on
 * thousands of matches from the history table rather than on the week the
 * fixture table keeps. Prints counts only.
 */
export async function probeHistoricOdds(): Promise<void> {
  const { bsdList, bsdOrNull } = await import('../bsd.ts');
  const now = Math.floor(Date.now() / 1000);
  for (const days of [3, 14, 30, 90, 200, 400]) {
    const ids = await select<{ id: number; kickoff: number }>(
      `SELECT id, kickoff FROM match WHERE home_goals IS NOT NULL AND kickoff < $1 ORDER BY kickoff DESC LIMIT 3`,
      [now - days * 86400],
    );
    for (const m of ids) {
      const rows = await bsdList<Record<string, unknown>>('/api/v2/odds/', { event_id: m.id, updated_after: '2015-01-01T00:00:00Z' }, { limit: 200, max: 2000 });
      const markets = new Set(rows.map((r) => String(r['market'])));
      const books = new Set(rows.map((r) => String(r['bookmaker_slug'] ?? r['bookmaker'])));
      const consensus = await bsdOrNull<Record<string, unknown>>(`/api/v2/events/${m.id}/odds/`);
      console.log(`  ${days}d ago  event ${m.id}  ${rows.length} quotes, ${markets.size} markets [${[...markets].join(',')}], ${books.size} books; consensus endpoint: ${consensus ? Object.keys(consensus).slice(0, 8).join(',') : 'none'}`);
    }
  }
}
