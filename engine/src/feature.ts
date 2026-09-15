import { leagueRank } from './slate.ts';

/**
 * What the site leads with today.
 *
 * A masthead that never changes says nothing is happening, and something is
 * always happening. This picks the one fixture worth the top of the page and
 * names the occasion, so a Champions League night looks like one and a Tuesday
 * in the Championship does not pretend to be one.
 *
 * Chosen rather than designed: there is no manual step, so the page is different
 * tomorrow whether or not anybody touches it. `hero:override` in kv still wins
 * when it is set, which is how a hand-made graphic goes up for a final without a
 * deploy.
 */

export interface HeroPick {
  fixture_id: number;
  kicker: string;
  headline: string;
  kickoff: number;
  league: string;
  league_id: number;
  venue_id: number | null;
  home: string;
  away: string;
  home_id: number | null;
  away_id: number | null;
  /** Faces for the composite, best-rated starter per side where known. */
  star_home: number | null;
  star_away: number | null;
  /** Why this fixture won, kept so the choice can be audited from the board. */
  reason: string;
}

/**
 * Competitions whose name alone is the occasion, and how much that is worth.
 *
 * The bonus has to be read against the rank gap, which is 100 a tier. A flat
 * +220 for all three put a Europa League tie above a La Liga fixture kicking off
 * in the same hour — Anderlecht v Lyon led the page over Barcelona, which is the
 * exact complaint this feature exists to answer.
 *
 * So only the Champions League gets a bonus large enough to jump tiers. Europa
 * and Conference nights are worth something and not worth more than a top-five
 * league game: they lead when nothing bigger is on, which on a Thursday is
 * usually the case, and step aside when there is.
 */
const MARQUEE: Record<number, { label: string; boost: number }> = {
  7: { label: 'Champions League night', boost: 220 },
  8: { label: 'Europa League night', boost: 60 },
  83: { label: 'Conference League night', boost: 30 },
};

export interface HeroCandidate {
  id: number;
  league_id: number;
  league: string;
  kickoff: number;
  home: string;
  away: string;
  home_id?: number | null;
  away_id?: number | null;
  venue_id?: number | null;
  confidence?: number;
  /** Set when the derby factor fired for this fixture. */
  derby?: boolean;
  star_home?: number | null;
  star_away?: number | null;
}

/**
 * Score a fixture for the masthead.
 *
 * Prominence dominates on purpose. A 92%-confidence call in a reserve league is
 * a good pick and a terrible headline, and the whole complaint this answers is
 * that the page led with competitions nobody came for.
 */
export function scoreCandidate(f: HeroCandidate, now: number): number {
  const rank = leagueRank(f.league_id);
  let score = (10 - rank) * 100;

  score += MARQUEE[f.league_id]?.boost ?? 0;
  if (f.derby) score += 180;

  // Today beats later this week: a masthead is about tonight.
  const hoursOut = (f.kickoff - now) / 3600;
  if (hoursOut >= 0 && hoursOut <= 12) score += 120;
  else if (hoursOut > 12 && hoursOut <= 36) score += 60;
  else if (hoursOut < 0) score -= 400; // already kicked off

  score += Math.round((f.confidence ?? 0) * 40);
  return score;
}

export function chooseHero(fixtures: HeroCandidate[], now = Math.floor(Date.now() / 1000)): HeroPick | null {
  const live = fixtures.filter((f) => f.kickoff > now - 2 * 3600);
  if (live.length === 0) return null;

  const best = live.reduce((a, b) => (scoreCandidate(b, now) > scoreCandidate(a, now) ? b : a));

  const marquee = MARQUEE[best.league_id]?.label;
  const kicker = marquee ?? (best.derby ? 'Derby day' : best.league);
  const reason = marquee
    ? 'marquee competition'
    : best.derby
      ? 'local derby'
      : leagueRank(best.league_id) <= 2
        ? 'top-flight fixture'
        : 'highest-rated fixture available';

  return {
    fixture_id: best.id,
    kicker,
    headline: `${best.home} v ${best.away}`,
    kickoff: best.kickoff,
    league: best.league,
    league_id: best.league_id,
    venue_id: best.venue_id ?? null,
    home: best.home,
    away: best.away,
    home_id: best.home_id ?? null,
    away_id: best.away_id ?? null,
    star_home: best.star_home ?? null,
    star_away: best.star_away ?? null,
    reason,
  };
}

export const _internals = { MARQUEE, scoreCandidate };
