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

import { decidedBy, postMortem, type DecidedEvent, type DecidedSide, type PostMortem } from '../postmortem.ts';
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
  /** How it went, as the results page says it of a live call (postmortem.ts). */
  postmortem: PostMortem | null;
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

  // Names and crests: the fixture row while the board still has it, then the
  // match and team tables, then the schedule (as lab/losses.ts finds them),
  // because the board keeps a week and most of these have left it.
  const ids = picks.map((p) => p.row.id);
  const names = new Map<number, { home: string; away: string; home_id: number | null; away_id: number | null; league_id: number | null }>();
  // The match report, where the board still holds one, for what decided it.
  const reports = new Map<number, { events?: DecidedEvent[]; stats?: { home?: DecidedSide; away?: DecidedSide } | null }>();
  for (let i = 0; i < ids.length; i += 400) {
    const chunk = ids.slice(i, i + 400);
    const got = await select<{ id: number; league_id: number | null; home: string | null; away: string | null; home_id: number | null; away_id: number | null; bundle_json: string | null; report_json: string | null }>(
      `SELECT x.id,
              coalesce(f.league_id, m.league_id, s.league_id) AS league_id,
              coalesce(f.home_team, th.name, sh.home_team) AS home,
              coalesce(f.away_team, ta.name, sh.away_team) AS away,
              m.home_team_id AS home_id, m.away_team_id AS away_id,
              f.bundle_json, f.report_json
         FROM (SELECT unnest(?::bigint[]) AS id) x
         LEFT JOIN fixture f ON f.id = x.id
         LEFT JOIN match m ON m.id = x.id
         LEFT JOIN market_snapshot s ON s.fixture_id = x.id
         LEFT JOIN schedule sh ON sh.id = x.id
         LEFT JOIN team th ON th.id = m.home_team_id
         LEFT JOIN team ta ON ta.id = m.away_team_id`,
      [chunk],
    );
    const num = (x: unknown) => (x !== null && x !== undefined && Number.isFinite(Number(x)) ? Number(x) : null);
    for (const g of got) {
      if (g.report_json) { try { reports.set(Number(g.id), JSON.parse(g.report_json)); } catch { /* no report, no lines */ } }
      if (!g.home || !g.away) continue;
      let b: Record<string, unknown> = {};
      try { b = g.bundle_json ? JSON.parse(g.bundle_json) : {}; } catch { /* the ids from match do */ }
      names.set(Number(g.id), {
        home: g.home, away: g.away,
        home_id: num(g.home_id) ?? num(b['home_id']), away_id: num(g.away_id) ?? num(b['away_id']),
        league_id: num(g.league_id),
      });
    }
  }

  // And for the rest, which never sat on the board long enough to leave a
  // name behind, the provider still has the event (as lab/losses.ts asks it).
  const missing = ids.filter((id) => !names.has(id));
  if (missing.length) {
    const { bsdOrNull } = await import('../bsd.ts');
    for (const id of missing) {
      const e = await bsdOrNull<Record<string, unknown>>(`/api/v2/events/${id}/`).catch(() => null);
      if (!e || !e['home_team'] || !e['away_team']) continue;
      const num = (x: unknown) => (x !== null && x !== undefined && Number.isFinite(Number(x)) ? Number(x) : null);
      names.set(id, {
        home: String(e['home_team']), away: String(e['away_team']),
        home_id: num(e['home_team_id']), away_id: num(e['away_team_id']),
        league_id: num(e['league_id']) ?? picks.find((p) => p.row.id === id)?.row.league_id ?? null,
      });
    }
    console.log(`  names from the provider for ${missing.filter((id) => names.has(id)).length} of ${missing.length} games the board had let go of`);
  }

  const out: RecordRow[] = [];
  for (const { row, o } of picks) {
    const n = names.get(row.id);
    const g = grade(row, o);
    if (!n || !g) continue;
    const at = { market: o.market, outcome: o.outcome, line: o.line, homeGoals: row.score[0], awayGoals: row.score[1] };
    const pm: PostMortem | null = (() => {
      try {
        const p = postMortem({ ...at, result: g.result,
          expectedHome: row.lambda?.[0] ?? null, expectedAway: row.lambda?.[1] ?? null });
        const rep = reports.get(row.id);
        if (rep) p.decided = decidedBy({ ...at, home: n.home, away: n.away, events: Array.isArray(rep.events) ? rep.events : [], stats: rep.stats ?? null });
        return p;
      } catch { return null; }
    })();
    out.push({
      fixture_id: row.id, kickoff: row.kickoff, league_id: n.league_id,
      home: n.home, away: n.away, home_id: n.home_id, away_id: n.away_id,
      home_goals: row.score[0], away_goals: row.score[1],
      market: o.market, outcome: String(o.outcome), line: o.line, result: g.result, postmortem: pm,
    });
  }
  out.sort((a, b) => b.kickoff - a.kickoff);

  const won = out.filter((r) => r.result === 'WON' || r.result === 'HALF_WON').length;
  const lost = out.filter((r) => r.result === 'LOST' || r.result === 'HALF_LOST').length;
  console.log(`lab:record: ${period.length} finished fixtures from ${new Date(from * 1000).toISOString()} to ${new Date(liveFrom * 1000).toISOString()}`);
  console.log(`  ${out.length} calls by the production rule: ${won} landed, ${lost} missed, ${out.length - won - lost} void or push`);
  console.log(`  (${picks.length - out.length} replayed calls left out for want of team names or a gradeable score)`);

  await kvSetJSON('record:engine', { live_from: liveFrom, from, made_at: Math.floor(Date.now() / 1000), rows: out.slice(0, 400) });
  console.log('  written to kv as record:engine');
}
