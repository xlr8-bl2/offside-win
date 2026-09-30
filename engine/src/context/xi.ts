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

import { kvGetJSON, kvSetJSON } from '../store.ts';
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
