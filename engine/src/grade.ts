/**
 * The grader on its own: a score in, a result out, nothing read or written.
 *
 * Kept apart from settle.ts (which reads and writes the database through
 * store.ts and the provider through bsd.ts) so the Worker can grade a call
 * the minute its match ends with exactly the same rules (worker/src/fulltime.ts).
 * settle.ts re-exports all of it, so nothing that imported it from there changes.
 */
import type { MarketCode, Outcome } from './types.ts';

/** A quarter line (x.25, x.75): an Asian handicap that splits the stake over two lines. */
export function isQuarterLine(line: number): boolean {
  const frac = Math.abs(line % 1);
  return Math.abs(frac - 0.25) < 1e-9 || Math.abs(frac - 0.75) < 1e-9;
}

export type Result = 'WON' | 'LOST' | 'PUSH' | 'HALF_WON' | 'HALF_LOST' | 'VOID';

export interface FinalScore {
  homeGoals: number;
  awayGoals: number;
  homeCorners: number | null;
  awayCorners: number | null;
  reds: number | null;
}

/**
 * Settle one selection. Returns the result and the profit on a one-unit stake.
 *
 * Asian handicaps are the fiddly part and the reason this is not a one-liner:
 * a whole line refunds on the exact margin, a quarter line splits the stake, and
 * getting either wrong silently corrupts every performance number downstream.
 */
export function settleSelection(
  market: MarketCode,
  outcome: Outcome,
  line: number | null,
  odds: number,
  s: FinalScore,
): { result: Result; pnl: number } | null {
  const total = s.homeGoals + s.awayGoals;
  const win = (): { result: Result; pnl: number } => ({ result: 'WON', pnl: odds - 1 });
  const lose = (): { result: Result; pnl: number } => ({ result: 'LOST', pnl: -1 });
  const push = (): { result: Result; pnl: number } => ({ result: 'PUSH', pnl: 0 });
  const won = (b: boolean) => (b ? win() : lose());

  switch (market) {
    case '1x2':
      return won(
        (outcome === 'HOME' && s.homeGoals > s.awayGoals) ||
          (outcome === 'DRAW' && s.homeGoals === s.awayGoals) ||
          (outcome === 'AWAY' && s.homeGoals < s.awayGoals),
      );

    case 'double_chance':
      return won(
        (outcome === '1X' && s.homeGoals >= s.awayGoals) ||
          (outcome === '12' && s.homeGoals !== s.awayGoals) ||
          (outcome === 'X2' && s.homeGoals <= s.awayGoals),
      );

    case 'draw_no_bet':
      if (s.homeGoals === s.awayGoals) return push();
      return won(
        (outcome === 'HOME' && s.homeGoals > s.awayGoals) ||
          (outcome === 'AWAY' && s.homeGoals < s.awayGoals),
      );

    case 'btts':
      return won((outcome === 'yes') === (s.homeGoals >= 1 && s.awayGoals >= 1));

    case 'over_under_05':
    case 'over_under_15':
    case 'over_under_25':
    case 'over_under_35': {
      const l = line ?? Number(market.slice(-2)) / 10;
      return won((outcome === 'over') === (total > l));
    }

    case 'european_handicap': {
      if (line === null) return null;
      const adj = s.homeGoals + line;
      return won(
        (outcome === 'HOME' && adj > s.awayGoals) ||
          (outcome === 'DRAW' && adj === s.awayGoals) ||
          (outcome === 'AWAY' && adj < s.awayGoals),
      );
    }

    case 'asian_handicap': {
      if (line === null) return null;
      const legs = isQuarterLine(line) ? [line - 0.25, line + 0.25] : [line];
      let pnl = 0;
      let wins = 0;
      let losses = 0;
      let pushes = 0;
      for (const leg of legs) {
        const share = 1 / legs.length;
        const margin = outcome === 'HOME' ? s.homeGoals + leg - s.awayGoals : s.awayGoals - leg - s.homeGoals;
        if (margin > 0) {
          pnl += share * (odds - 1);
          wins++;
        } else if (margin < 0) {
          pnl -= share;
          losses++;
        } else {
          pushes++;
        }
      }
      const result: Result =
        wins === legs.length ? 'WON'
        : losses === legs.length ? 'LOST'
        : pushes === legs.length ? 'PUSH'
        : wins > 0 && pushes > 0 ? 'HALF_WON'
        : losses > 0 && pushes > 0 ? 'HALF_LOST'
        : 'PUSH';
      return { result, pnl };
    }

    case 'total_corners': {
      if (line === null || s.homeCorners === null || s.awayCorners === null) return null;
      const c = s.homeCorners + s.awayCorners;
      if (Number.isInteger(line) && c === line) return push();
      return won((outcome === 'over') === (c > line));
    }

    case 'corners_1x2': {
      if (s.homeCorners === null || s.awayCorners === null) return null;
      return won(
        (outcome === 'HOME' && s.homeCorners > s.awayCorners) ||
          (outcome === 'DRAW' && s.homeCorners === s.awayCorners) ||
          (outcome === 'AWAY' && s.homeCorners < s.awayCorners),
      );
    }

    case 'total_red_cards': {
      if (line === null || s.reds === null) return null;
      if (Number.isInteger(line) && s.reds === line) return push();
      return won((outcome === 'over') === (s.reds > line));
    }

    case 'red_card': {
      if (s.reds === null) return null;
      return won((outcome === 'yes') === (s.reds > 0));
    }

    default:
      return null;
  }
}

/**
 * Whether the provider's status says the match is over.
 *
 * It was `/finish|ft|ended|after/`, and "halftime" contains "ft". On 19
 * September 2026 a run of late kick-offs in MLS and the USL were graded
 * against their half-time scores: New England 4-2 Orlando went down as "over
 * 1.5 goals, missed" at 1-0, DC United 1-2 Charlotte the same at 0-1. Four
 * published calls marked lost had won, and one marked won had lost. So the
 * statuses that mean the end are named, and anything else waits.
 */
export function isFinishedStatus(status: string): boolean {
  const s = status.trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (/half|progress|live|1st|2nd|break|interrupt|delay|suspend|postpon|not_?started|scheduled/.test(s)) return false;
  return /^(finished|ended|ft|full_?time|aet|ap|pen|after_(extra_?time|et|penalties|pen|ot|overtime)|finished_(aet|ap|pen|after_[a-z_]+))$/.test(s);
}

