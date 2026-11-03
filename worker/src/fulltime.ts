/**
 * Full time: a call graded within minutes of the whistle, not at the next
 * hourly settlement.
 *
 * The engine's settlement (engine/src/settle.ts) runs from GitHub Actions at
 * 25 past each hour, behind the slate in the same queue, so a call made on an
 * 8pm kick-off sat ungraded on the front page, the results and its match
 * page until somewhere between 10:25 and 11:30. This does the part that
 * needs nothing but the score, from the Worker's two-minute cron:
 *
 *   - Only matches carrying an unsettled call, from 100 minutes after
 *     kick-off (a match cannot be over sooner) to six hours after (past that
 *     the engine's settlement has it). One indexed read finds them, and on
 *     most runs finds none and stops there.
 *   - Each is asked about once every four minutes at most, three a run, so a
 *     call costs the provider three to six requests in all: a few dozen a day
 *     against the 7,500 the free plan allows.
 *   - The provider must call the match finished (isFinishedStatus, the
 *     engine's own: "halftime" contains "ft"). Postponed, abandoned and the
 *     like are left to the engine, which voids them.
 *   - The grade is the engine's own (engine/src/grade.ts), and so is the
 *     post-mortem. A market the score cannot grade (corners, cards) is left
 *     for the engine, which has the match numbers. Anything the engine's
 *     settlement does later still runs over these: the nightly history's
 *     final score re-grades them if it disagrees (regradeSettled), and
 *     calibration is refreshed then.
 *   - A bet slip whose every leg is graded, or one leg lost, is settled too.
 *     A leg whose call was withdrawn is left for the engine (gradeWithdrawn).
 *
 * The site's reads are copies at the edge, two minutes fresh, so the page is
 * also told: `settled:recent` in kv lists the matches graded in the last six
 * hours and when, and /api/live hands it to the page, which reads again the
 * pages holding one of them (public/app.js, liveTick and getJSON).
 */

import { isFinishedStatus, settleSelection, type Result } from '../../engine/src/grade.ts';
import { postMortem } from '../../engine/src/postmortem.ts';
import type { MarketCode, Outcome } from '../../engine/src/types.ts';
import { leftFrom, mayAsk, spent } from './allowance.ts';

interface Stmt {
  bind(...v: unknown[]): Stmt;
  all<T = Record<string, unknown>>(): Promise<{ results?: T[] }>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run(): Promise<unknown>;
}
export interface FulltimeDb {
  prepare(sql: string): Stmt;
  batch(sts: Stmt[]): Promise<unknown[]>;
}
export interface FulltimeEnv {
  DB?: FulltimeDb;
  BSD_API_KEY?: string;
  BSD_BASE_URL?: string;
}

/** A match is not over before this, half time included. */
export const EARLIEST = 100 * 60;
/** After this the engine's hourly settlement has had it twice over. */
export const LATEST = 6 * 3600;
/** How often one match is asked about. */
export const ASK_EVERY = 4 * 60;
/** Matches asked about per run: the queries a run makes stay well under D1's 50. */
const PER_RUN = 3;
/** How long a match stays in `settled:recent`. */
const RECENT = 6 * 3600;

const BASE = 'https://sports.bzzoiro.com';

const numOr = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

async function kvGet<T>(db: FulltimeDb, k: string): Promise<T | null> {
  try {
    const r = await db.prepare('SELECT v FROM kv WHERE k = ?').bind(k).first<{ v: string }>();
    return r?.v ? (JSON.parse(r.v) as T) : null;
  } catch { return null; }
}
function kvPut(db: FulltimeDb, k: string, v: unknown, now: number): Stmt {
  return db.prepare(`INSERT INTO kv (k, v, expires_at, updated_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(k) DO UPDATE SET v = excluded.v, expires_at = excluded.expires_at, updated_at = excluded.updated_at`)
    .bind(k, JSON.stringify(v), now + 86400, now);
}

/** What the page is told: when anything was last graded, and which matches, by when. */
export interface Recent { at: number; ids: Record<string, number> }

/** `settled:recent` with these matches added and anything past six hours dropped. */
export function addRecent(prev: Recent | null, ids: number[], now: number): Recent {
  const out: Record<string, number> = {};
  for (const [id, at] of Object.entries(prev?.ids ?? {})) if (Number(at) > now - RECENT) out[id] = Number(at);
  for (const id of ids) out[String(id)] = now;
  return { at: ids.length ? now : (prev?.at ?? 0), ids: out };
}

interface PickRow {
  id: number; market: MarketCode; outcome: Outcome; line: number | null; odds: number;
  opening_odds: number | null; closing_odds: number | null; evidence_json: string | null;
}

/** One pick graded on a final score, in the columns settlement writes. Null: the score cannot grade it. */
export function gradePick(p: PickRow, hg: number, ag: number): { result: Result; pnl: number; clv: number | null; postmortem: string } | null {
  const graded = settleSelection(p.market, p.outcome, p.line === null ? null : Number(p.line), Number(p.odds), {
    homeGoals: hg, awayGoals: ag, homeCorners: null, awayCorners: null, reds: null,
  });
  if (!graded) return null;
  let expected: { home?: number; away?: number } = {};
  try { expected = (JSON.parse(p.evidence_json ?? '{}') as { expected?: typeof expected }).expected ?? {}; } catch { /* an older shape */ }
  const pm = postMortem({
    market: p.market, outcome: p.outcome, line: p.line === null ? null : Number(p.line), result: graded.result,
    homeGoals: hg, awayGoals: ag, expectedHome: expected.home ?? null, expectedAway: expected.away ?? null,
    openingOdds: p.opening_odds, closingOdds: p.closing_odds,
  });
  // As settle.ts: where the price finished against where it was called.
  const clv = p.opening_odds && p.closing_odds && p.opening_odds > 1 && p.closing_odds > 1
    ? Number((p.opening_odds / p.closing_odds - 1).toFixed(4))
    : null;
  return { result: graded.result, pnl: graded.pnl, clv, postmortem: JSON.stringify(pm) };
}

/** The provider's word on one match: its status and score. Null when it would not say. */
async function askProvider(env: FulltimeEnv, id: number): Promise<{ status: string; hg: number | null; ag: number | null } | null> {
  try {
    const res = await fetch(new URL(`/api/v2/events/${id}/`, env.BSD_BASE_URL || BASE).toString(), {
      headers: { Authorization: `Token ${env.BSD_API_KEY}`, Accept: 'application/json', 'User-Agent': 'offside-win-live/1.0 (+https://offside.win)' },
    });
    // Results come first: no floor, but still counted, and what is left is shared.
    await spent(env.DB as never, 'results', 1, leftFrom(res));
    if (!res.ok) return null;
    const ev = await res.json() as Record<string, unknown>;
    return { status: String(ev['status'] ?? ''), hg: numOr(ev['home_score']), ag: numOr(ev['away_score']) };
  } catch { return null; }
}

/** Open bet slips that can be settled now that more legs are graded. Mirrors engine/src/slip.ts settleSlips. */
async function settleSlips(db: FulltimeDb, now: number): Promise<number> {
  const open = (await db.prepare('SELECT id, legs_json FROM slip WHERE settled_at IS NULL AND first_kickoff <= ? LIMIT 3')
    .bind(now).all<{ id: number; legs_json: string }>()).results ?? [];
  let settled = 0;
  for (const s of open) {
    let legs: Array<{ fixture_id: number; market: string; outcome: string; line: number | null }>;
    try { legs = JSON.parse(s.legs_json); } catch { continue; }
    if (!Array.isArray(legs) || !legs.length || legs.length > 12) continue;
    const results: Array<string | null> = [];
    let withdrawn = false;
    for (const l of legs) {
      const row = await db.prepare(`SELECT result, settled_at FROM pick WHERE fixture_id = ? AND kind = 'CONFIDENT'
          AND market = ? AND outcome = ? AND ${l.line === null ? 'line IS NULL' : 'line = ?'}`)
        .bind(...(l.line === null ? [l.fixture_id, l.market, l.outcome] : [l.fixture_id, l.market, l.outcome, l.line]))
        .first<{ result: string | null; settled_at: number | null }>();
      if (!row) { withdrawn = true; break; }
      results.push(row.settled_at ? row.result : null);
    }
    // A withdrawn leg is graded on the score by the engine (gradeWithdrawn).
    if (withdrawn) continue;
    const lost = results.some((r) => r === 'LOST' || r === 'HALF_LOST');
    if (!lost && results.some((r) => r === null)) continue;
    const result = lost ? 'LOST' : results.some((r) => r === 'WON' || r === 'HALF_WON') ? 'WON' : 'VOID';
    await db.prepare('UPDATE slip SET result = ?, settled_at = ? WHERE id = ? AND settled_at IS NULL').bind(result, now, s.id).run();
    settled++;
  }
  return settled;
}

/**
 * The writes that grade one finished match on its final score: each
 * unsettled call the score can grade, and the score and state on the fixture.
 */
async function gradeWrites(db: FulltimeDb, id: number, hg: number, ag: number, now: number): Promise<{ writes: Stmt[]; settled: number; left: number }> {
  const picks = (await db.prepare(`SELECT id, market, outcome, line, odds, opening_odds, closing_odds, evidence_json
      FROM pick WHERE fixture_id = ? AND settled_at IS NULL`).bind(id).all<PickRow>()).results ?? [];
  const writes: Stmt[] = [];
  let settled = 0;
  for (const p of picks) {
    const g = gradePick(p, hg, ag);
    if (!g) continue;
    writes.push(db.prepare('UPDATE pick SET settled_at = ?, result = ?, pnl = ?, clv = ?, postmortem_json = ? WHERE id = ? AND settled_at IS NULL')
      .bind(now, g.result, g.pnl, g.clv, g.postmortem, p.id));
    settled++;
  }
  // The score the grade was made on, on the fixture, as settlement writes it:
  // every page reads a finished match from these two columns. The status
  // too, which the slate would not rewrite until its next pass, so a graded
  // call no longer sits beside a match still marked as in play.
  writes.push(db.prepare("UPDATE fixture SET home_goals = ?, away_goals = ?, status = 'finished' WHERE id = ?").bind(hg, ag, id));
  return { writes, settled, left: picks.length - settled };
}

/**
 * The owner's final score for a match (the admin dashboard, when the provider
 * cannot be asked): graded exactly as a score from the provider would be.
 * Calls on corners or cards stay for the engine, which reads the match numbers.
 */
export async function setFinalScore(db: FulltimeDb, id: number, hg: number, ag: number, now = Math.floor(Date.now() / 1000)): Promise<{ settled: number; left: number; slips: number }> {
  const g = await gradeWrites(db, id, hg, ag, now);
  const writes = [...g.writes];
  if (g.settled) writes.push(kvPut(db, 'settled:recent', addRecent(await kvGet<Recent>(db, 'settled:recent'), [id], now), now));
  await db.batch(writes);
  const slips = g.settled ? await settleSlips(db, now) : 0;
  return { settled: g.settled, left: g.left, slips };
}

export interface FulltimeReport { candidates: number; asked: number; settled: number; matches: number[]; slips: number }

/** One run: the matches with an ungraded call that could be over, asked about, and graded if they are. */
export async function settleFinished(env: FulltimeEnv, now = Math.floor(Date.now() / 1000)): Promise<FulltimeReport> {
  const report: FulltimeReport = { candidates: 0, asked: 0, settled: 0, matches: [], slips: 0 };
  const db = env.DB;
  if (!db || !env.BSD_API_KEY) return report;

  // pick_unsettled (settled_at, kickoff): only the rows in the window are read.
  const due = (await db.prepare(`SELECT fixture_id, min(kickoff) AS kickoff FROM pick
      WHERE settled_at IS NULL AND kickoff BETWEEN ? AND ? GROUP BY fixture_id ORDER BY kickoff ASC LIMIT 20`)
    .bind(now - LATEST, now - EARLIEST).all<{ fixture_id: number; kickoff: number }>()).results ?? [];
  report.candidates = due.length;
  if (!due.length) return report;

  const asked = (await kvGet<Record<string, number>>(db, 'settle:asked')) ?? {};
  const ready = due.filter((d) => !(Number(asked[String(d.fixture_id)] ?? 0) > now - ASK_EVERY)).slice(0, PER_RUN);
  if (!ready.length) return report;

  const writes: Stmt[] = [];
  for (const d of ready) {
    const id = Number(d.fixture_id);
    asked[String(id)] = now;
    report.asked++;
    if (!await mayAsk(db as never, 'results', now)) break;
    const ev = await askProvider(env, id);
    if (!ev || ev.hg === null || ev.ag === null || !isFinishedStatus(ev.status)) continue;
    const g = await gradeWrites(db, id, ev.hg, ev.ag, now);
    writes.push(...g.writes);
    report.settled += g.settled;
    if (g.settled) report.matches.push(id);
  }

  // Forget matches past the window, so the key stays a handful of entries.
  for (const k of Object.keys(asked)) if (Number(asked[k]) < now - LATEST) delete asked[k];
  writes.push(kvPut(db, 'settle:asked', asked, now));
  if (report.matches.length) {
    const recent = addRecent(await kvGet<Recent>(db, 'settled:recent'), report.matches, now);
    writes.push(kvPut(db, 'settled:recent', recent, now));
  }
  await db.batch(writes);

  if (report.settled) report.slips = await settleSlips(db, now);
  return report;
}
