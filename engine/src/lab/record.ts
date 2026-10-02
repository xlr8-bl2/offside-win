/**
 * `npm run lab:record`: the record the front page shows, from the newest
 * engine.
 *
 * Before launch the owner chose to show the production rule's calls on the
 * games already played, in place of what earlier versions of the engine
 * published (lab/live.ts compares the two). This replays the production rule
 * (lab/tune.ts PROD, the rule the live engine now runs) over every finished
 * fixture up to `live_from`, grades each call on the score, and stores the
 * lot in kv as `record:engine`. From `live_from` on, the front page takes the
 * live engine's own settled calls, so the record keeps itself up to date
 * without this being run again.
 *
 * The workflow's argument sets `live_from` (a date, "2026-10-02"); blank is
 * now. Nothing paid is in it: every fixture here has finished.
 */

import { kvSetJSON, select } from '../store.ts';
import { chooseDay, grade, optionsFor, type HistRow, type Option } from './markets.ts';
import { PROD } from './tune.ts';

const dayOf = (t: number) => Math.floor((t + 3600) / 86400);

export interface RecordRow {
  fixture_id: number;
  kickoff: number;
  league_id: number | null;
  home: string;
  away: string;
  home_id: number | null;
  away_id: number | null;
  home_goals: number;
  away_goals: number;
  market: string;
  outcome: string;
  line: number | null;
  result: string;
}

export async function runRecord(rows: HistRow[]): Promise<void> {
  const arg = String(process.env.ARG ?? '').trim();
  const liveFrom = /^\d{4}-\d{2}-\d{2}$/.test(arg) ? Math.floor(Date.parse(`${arg}T00:00:00Z`) / 1000) : Math.floor(Date.now() / 1000);
  // From the first call the site ever settled: the same games the record
  // has always covered.
  const [first] = await select<{ k: number }>(`SELECT MIN(kickoff) AS k FROM pick WHERE kind = 'CONFIDENT' AND settled_at IS NOT NULL`, []);
  const from = Number(first?.k ?? 0);
  const period = rows.filter((r) => r.kickoff >= from && r.kickoff < liveFrom);

  const cache = new Map(period.map((r) => [r.id, optionsFor(r, PROD.modelWeight)] as [number, Option[]]));
  const days = new Map<number, HistRow[]>();
  for (const r of period) days.set(dayOf(r.kickoff), [...(days.get(dayOf(r.kickoff)) ?? []), r]);
  const picks: Array<{ row: HistRow; o: Option }> = [];
  for (const rs of days.values()) for (const pk of chooseDay(PROD, rs, cache)) picks.push({ row: pk.row, o: pk.option });

  // Names and crests, from the fixture rows (a replayed call on a fixture the
  // board has let go of, with no name to show, is left out).
  const ids = picks.map((p) => p.row.id);
  const names = new Map<number, { home: string; away: string; home_id: number | null; away_id: number | null; league_id: number | null }>();
  for (let i = 0; i < ids.length; i += 400) {
    const chunk = ids.slice(i, i + 400);
    const got = await select<{ id: number; league_id: number; home_team: string; away_team: string; bundle_json: string }>(
      `SELECT id, league_id, home_team, away_team, bundle_json FROM fixture WHERE id IN (${chunk.map(() => '?').join(',')})`,
      chunk,
    );
    for (const g of got) {
      let b: Record<string, unknown> = {};
      try { b = JSON.parse(g.bundle_json); } catch { /* names still do */ }
      const num = (x: unknown) => (Number.isFinite(Number(x)) && x !== null ? Number(x) : null);
      names.set(Number(g.id), { home: g.home_team, away: g.away_team, home_id: num(b['home_id']), away_id: num(b['away_id']), league_id: num(g.league_id) });
    }
  }

  const out: RecordRow[] = [];
  for (const { row, o } of picks) {
    const n = names.get(row.id);
    const g = grade(row, o);
    if (!n || !g) continue;
    out.push({
      fixture_id: row.id, kickoff: row.kickoff, league_id: n.league_id,
      home: n.home, away: n.away, home_id: n.home_id, away_id: n.away_id,
      home_goals: row.score[0], away_goals: row.score[1],
      market: o.market, outcome: String(o.outcome), line: o.line, result: g.result,
    });
  }
  out.sort((a, b) => b.kickoff - a.kickoff);

  const won = out.filter((r) => r.result === 'WON' || r.result === 'HALF_WON').length;
  const lost = out.filter((r) => r.result === 'LOST' || r.result === 'HALF_LOST').length;
  console.log(`lab:record: ${period.length} finished fixtures from ${new Date(from * 1000).toISOString()} to ${new Date(liveFrom * 1000).toISOString()}`);
  console.log(`  ${out.length} calls by the production rule: ${won} landed, ${lost} missed, ${out.length - won - lost} void or push`);
  console.log(`  (${picks.length - out.length} replayed calls left out for want of a fixture row)`);

  await kvSetJSON('record:engine', { live_from: liveFrom, from, made_at: Math.floor(Date.now() / 1000), rows: out.slice(0, 400) });
  console.log('  written to kv as record:engine');
}
