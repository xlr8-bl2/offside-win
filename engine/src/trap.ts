/**
 * The trap of the day: the favourite everyone is on, and we wouldn't touch.
 *
 * Every tipster tells you who to back. Nobody tells you who to leave alone,
 * and the short-priced favourite with something wrong underneath it is the bet
 * that empties more pockets than any other. The engine already knows when it
 * rates a favourite lower than the bookmakers do, when a manager has rotated,
 * when the price has been drifting and which factors pull against a side. This
 * puts the strongest of those on the front page, free, once a day.
 *
 * It is a warning, never a call. Nothing here is graded as a pick, and it is
 * left out entirely where we have a members' call on the result of the same
 * match: a free card saying "don't back the favourite" beside a paid "draw or
 * away" would be giving the paid one away.
 *
 * Every reason is a sentence about the football that passes the same
 * vocabulary gate the free copy does (vocabulary.ts). No price, no number a
 * supporter would not say out loud, because the front door carries no odds.
 */

import { ROTATED_AT, sideBacked, type XiChanges } from './context/xi.ts';
import { findBannedInProse } from './vocabulary.ts';
import type { BookMarket, Factor, ModelMarket, Outcome } from './types.ts';

/** The bookmakers make them clear favourites: better than four in seven. */
export const FAVOURITE_AT = 0.58;
/** We have them lower by at least this much. Less is a rounding difference. */
export const GAP_AT = 0.04;
/** Changes from the expected eleven worth naming (four is a rotated side; see xi.ts). */
const CHANGES_AT = 3;
/** How far the favourite's price has to drift from its opening to count. */
const DRIFT_AT = 1.06;
/** How far ahead a trap can be: today's and tonight's games. */
export const WINDOW_S = 36 * 3600;

export interface TrapInput {
  fixture_id: number;
  kickoff: number;
  league: string;
  league_id: number;
  /** League prominence, lower is bigger (config.leagueRank). */
  rank: number;
  home: string;
  away: string;
  home_id: number | null;
  away_id: number | null;
  book: BookMarket[];
  model: ModelMarket[];
  factors: Factor[];
  changes: XiChanges | null | undefined;
  /** Our confident calls on the match, to stay clear of. */
  calls: Array<{ market: string; outcome: string }>;
}

export interface Trap {
  fixture_id: number;
  kickoff: number;
  league: string;
  league_id: number;
  home: string;
  away: string;
  home_id: number | null;
  away_id: number | null;
  /** The favourite we would leave alone. */
  side: 'home' | 'away';
  team: string;
  against: string;
  /** Why, as sentences, strongest first. At most three. */
  reasons: string[];
  /** How strong a trap it is, for choosing between them. Not shown. */
  score: number;
}

const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven'];
const say = (n: number) => WORDS[n] ?? String(n);
const listOf = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

function prob(m: Map<Outcome, number> | undefined, o: Outcome): number | null {
  const v = m?.get(o);
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** The trap on one match, or null when there is not one worth naming. */
export function trapFor(i: TrapInput): Trap | null {
  const book = i.book.find((b) => b.market === '1x2');
  if (!book) return null;
  const ph = prob(book.fair, 'HOME');
  const pa = prob(book.fair, 'AWAY');
  if (ph === null || pa === null) return null;
  const side: 'home' | 'away' = ph >= pa ? 'home' : 'away';
  const outcome: Outcome = side === 'home' ? 'HOME' : 'AWAY';
  const theirs = side === 'home' ? ph : pa;
  if (theirs < FAVOURITE_AT) return null;

  // A members' call on the result of this match: say nothing about it.
  if (i.calls.some((c) => sideBacked(c.market, String(c.outcome)) !== null)) return null;

  const team = side === 'home' ? i.home : i.away;
  const against = side === 'home' ? i.away : i.home;
  const other = side === 'home' ? 'away' : 'home';
  const ours = prob(i.model.find((m) => m.market === '1x2')?.probs, outcome);
  const gap = ours === null ? 0 : theirs - ours;

  const reasons: string[] = [];

  // The sheet: the side everyone priced is not the side that's playing.
  const ch = i.changes?.[side] ?? null;
  const rotated = !!ch && ch.n >= CHANGES_AT;
  if (ch && rotated) {
    const names = ch.out.slice(0, 3);
    reasons.push(names.length
      ? `${team} have made ${say(ch.n)} changes from the side everyone expected. ${listOf(names)} ${names.length === 1 ? 'doesn’t' : 'don’t'} start.`
      : `${team} have made ${say(ch.n)} changes from the side everyone expected.`);
  }

  // The money: the price on them has been going out, not in.
  const mv = book.movement?.get(outcome);
  const openFair = prob(book.open?.fair, outcome);
  const drifting = (!!mv && mv.opening > 1 && mv.current >= mv.opening * DRIFT_AT)
    || (openFair !== null && openFair - theirs >= 0.03);
  if (drifting) reasons.push(`The bookies have been pushing ${team} out since the first prices went up.`);

  // The football: the factors that pull against them, in the engine's own
  // notes where those read as a supporter would say them.
  const against_ = i.factors
    .filter((f) => f.state === 'COMPUTED' && f.note && f.adjustments.some((a) => a.channel === 'goals'
      && ((a.side === side && a.multiplier < 1) || (a.side === other && a.multiplier > 1))))
    .sort((a, b) => b.strength - a.strength);
  for (const f of against_) {
    if (reasons.length >= 3) break;
    const note = f.note.trim();
    if (findBannedInProse(note).length) continue;
    if (reasons.includes(note)) continue;
    reasons.push(note);
  }

  // It has to be ours to say: we rate them lower, or the side is not the one
  // that was priced. A favourite we agree with is not a trap however many
  // little things pull against it.
  const ourCase = gap >= GAP_AT || (ch !== null && ch.n >= ROTATED_AT) || (drifting && gap > 0);
  if (!ourCase || reasons.length === 0) return null;

  const score = gap * 20 + reasons.length + (rotated ? 1 : 0) + (drifting ? 0.5 : 0) + theirs - i.rank * 0.4;
  return {
    fixture_id: i.fixture_id, kickoff: i.kickoff, league: i.league, league_id: i.league_id,
    home: i.home, away: i.away, home_id: i.home_id, away_id: i.away_id,
    side, team, against, reasons: reasons.slice(0, 3), score: Number(score.toFixed(3)),
  };
}

/**
 * The one to lead with: the strongest trap still to kick off in the window.
 *
 * The slate runs every fifteen minutes, and a front page that names a
 * different trap each time someone refreshes it is not saying anything. So
 * the one already up stays while it still stands, unless another is clearly
 * stronger.
 */
export function chooseTrap(traps: Trap[], now: number, incumbent: number | null = null): Trap | null {
  const live = traps.filter((t) => t.kickoff > now && t.kickoff <= now + WINDOW_S);
  if (!live.length) return null;
  const best = live.reduce((a, b) => (b.score > a.score || (b.score === a.score && b.kickoff < a.kickoff) ? b : a));
  const held = incumbent === null ? undefined : live.find((t) => t.fixture_id === incumbent);
  return held && best.score <= held.score + 1 ? held : best;
}
