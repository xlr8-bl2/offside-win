/**
 * Who was picked, against who was expected.
 *
 * The engine knew when a team sheet was confirmed and who was injured, and
 * nothing about who was chosen. Germany v Greece (27 September 2026) is the
 * case that found it: the predicted eleven had Neuer in goal and Havertz and
 * Undav up front; the confirmed one had Nübel, Ebnoutalib and a rotated side
 * with Wirtz, Gnabry and ter Stegen on the bench. The call ("Germany or a
 * draw", 1.13) stood, was argued on the predicted names, and lost 0-1. Any fan
 * reading the sheet an hour before would have left it alone.
 *
 * So the last predicted eleven is kept while the sheet is still a prediction,
 * and when the confirmed one lands the two are compared: which of the players
 * expected to start are not in the eleven. A side with several of those has
 * been rotated, and a call backing it is set aside (slate.ts, select.ts).
 *
 * The predicted eleven is the provider's projection from recent selections and
 * known absences, so it is the side a reader expected; a change from it is a
 * choice the manager made, which is exactly the information a price set before
 * the sheet was out may not carry.
 */

import { kvGetJSON, kvSetJSON, select } from '../store.ts';
import type { LineupInfo, SideLineup } from './types.ts';

export interface XiChange {
  /** How many of the expected starters are not in the confirmed eleven. */
  n: number;
  /** Their names, expected starters first as the prediction listed them. */
  out: string[];
  /** Who came in for them. */
  in: string[];
}
export type XiChanges = { home: XiChange | null; away: XiChange | null };

type Player = { id: number; name: string };
const KEEP_S = 14 * 86400;
const key = (fixtureId: number) => `xi:pred:${fixtureId}`;

export function startersOf(side: SideLineup | null | undefined): Player[] {
  return (side?.players ?? [])
    .filter((p) => p.starting && p.name && Number.isFinite(p.id))
    .map((p) => ({ id: p.id, name: p.name }));
}

/** The expected starters missing from the confirmed eleven, and who replaced them. */
export function xiChange(predicted: Player[], confirmed: Player[]): XiChange | null {
  // Fewer than nine named either way is not a sheet to compare.
  if (predicted.length < 9 || confirmed.length < 9) return null;
  const now = new Set(confirmed.map((p) => p.id));
  const before = new Set(predicted.map((p) => p.id));
  const out = predicted.filter((p) => !now.has(p.id)).map((p) => p.name);
  const inn = confirmed.filter((p) => !before.has(p.id)).map((p) => p.name);
  return { n: out.length, out, in: inn };
}

/**
 * Keep the predicted eleven while it is one; compare once it is confirmed.
 * Null when there is nothing to compare (no prediction was ever seen, or a
 * side was too thin to read).
 */
export async function trackXi(fixtureId: number, lineups: LineupInfo): Promise<XiChanges | null> {
  if (lineups.status === 'predicted') {
    const home = startersOf(lineups.home);
    const away = startersOf(lineups.away);
    if (home.length >= 9 || away.length >= 9) {
      await kvSetJSON(key(fixtureId), { home, away, at: Math.floor(Date.now() / 1000) }, KEEP_S);
    }
    return null;
  }
  if (lineups.status !== 'confirmed') return null;
  const was = await kvGetJSON<{ home: Player[]; away: Player[] }>(key(fixtureId));
  if (!was) return null;
  const home = xiChange(was.home ?? [], startersOf(lineups.home));
  const away = xiChange(was.away ?? [], startersOf(lineups.away));
  return home || away ? { home, away } : null;
}

/** The side a call backs to win or not lose, or null for a call on goals, corners or cards. */
export function sideBacked(market: string, outcome: string): 'home' | 'away' | null {
  const o = outcome.toUpperCase();
  if (market === '1x2' || market === 'draw_no_bet' || market === 'asian_handicap' || market === 'european_handicap') {
    return o === 'HOME' ? 'home' : o === 'AWAY' ? 'away' : null;
  }
  if (market === 'double_chance') return o === '1X' ? 'home' : o === 'X2' ? 'away' : null;
  return null;
}

/**
 * How many changes from the expected eleven make a side "rotated": enough that
 * a call backing it is set aside. Two or three is a manager's normal
 * tinkering, or the prediction being a little wrong; four is a different team.
 */
export const ROTATED_AT = 4;

/** Whether a call backs a side that has been rotated. */
export function backsRotatedSide(c: { market: string; outcome: string }, changes: XiChanges | null | undefined): XiChange | null {
  const side = sideBacked(c.market, String(c.outcome));
  if (!side || !changes) return null;
  const ch = changes[side];
  return ch && ch.n >= ROTATED_AT ? ch : null;
}

/*
 * A predicted eleven is the provider's projection, and the projection does not
 * know who has stopped being picked. Argentina's was still starting Messi in
 * November 2026, after he had finished with the national side (owner, 21
 * November), and the page said he was expected to start and wrote him up as
 * the threat. So a predicted starter is checked against the side's own recent
 * team sheets: the starters and substitutes in the reports of its last few
 * finished games (fixture.report_json). Someone on none of them is not
 * expected to start, whatever the projection says, and comes off the sheet.
 * Nothing is checked once the eleven is confirmed, and nothing when fewer
 * than two recent sheets are held: then there is no evidence either way.
 */
const SHEETS = 4;
const SHEET_WINDOW_S = 540 * 86400;

/** The players on a side's last few team sheets we hold, and how many sheets that was. */
export async function recentlyPicked(teamId: number, kickoff: number): Promise<{ sheets: number; ids: Set<number> }> {
  const ids = new Set<number>();
  let sheets = 0;
  const rows: Array<{ home_team_id: number | null; away_team_id: number | null; kickoff: number; report_json: string | null }> = [];
  for (const col of ['home_team_id', 'away_team_id'] as const) {
    rows.push(...await select<{ home_team_id: number | null; away_team_id: number | null; kickoff: number; report_json: string | null }>(
      `SELECT home_team_id, away_team_id, kickoff, report_json FROM fixture
        WHERE ${col} = ? AND kickoff < ? AND kickoff > ? AND report_json IS NOT NULL
        ORDER BY kickoff DESC LIMIT ${SHEETS}`,
      [teamId, kickoff - 3 * 3600, kickoff - SHEET_WINDOW_S],
    ));
  }
  for (const r of rows.sort((a, b) => b.kickoff - a.kickoff).slice(0, SHEETS)) {
    let rep: { lineups?: Record<string, { players?: Array<{ id?: number }> } | null> | null; players?: Array<{ id?: number; team_id?: number | null }> } | null = null;
    try { rep = JSON.parse(r.report_json ?? 'null'); } catch { rep = null; }
    const side = r.home_team_id === teamId ? 'home' : 'away';
    const sheet = rep?.lineups?.[side]?.players ?? [];
    if (!sheet.length) continue;
    sheets++;
    for (const p of sheet) if (Number.isFinite(p.id)) ids.add(Number(p.id));
    for (const p of rep?.players ?? []) if (p.team_id === teamId && Number.isFinite(p.id)) ids.add(Number(p.id));
  }
  return { sheets, ids };
}

/** A predicted side with every starter nobody has picked lately taken off; the names taken off. */
export function withoutUnpicked(side: SideLineup, picked: { sheets: number; ids: Set<number> }): { side: SideLineup; dropped: string[] } {
  if (picked.sheets < 2) return { side, dropped: [] };
  const dropped = side.players.filter((p) => p.starting && !picked.ids.has(p.id)).map((p) => p.name);
  if (!dropped.length) return { side, dropped };
  return { side: { ...side, players: side.players.filter((p) => !(p.starting && !picked.ids.has(p.id))) }, dropped };
}

/** Apply withoutUnpicked to both sides of a predicted line-up, in place. */
export async function pruneUnpicked(lineups: LineupInfo, teams: { home: number | null; away: number | null }, kickoff: number): Promise<string[]> {
  if (lineups.status !== 'predicted') return [];
  const out: string[] = [];
  for (const which of ['home', 'away'] as const) {
    const side = lineups[which];
    const id = teams[which];
    if (!side?.players?.length || id === null) continue;
    const r = withoutUnpicked(side, await recentlyPicked(id, kickoff));
    lineups[which] = r.side;
    out.push(...r.dropped);
  }
  return out;
}
