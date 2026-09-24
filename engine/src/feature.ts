import { leagueRank } from './slate.ts';
import { occasionOf, statureOf, COMPETITION } from './occasion.ts';

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
 * Competition weighting now lives in occasion.ts alongside the named fixtures,
 * because they are the same judgement and drifted apart when they were two
 * lists. Kept exported under the old name for the tests that pin the Europa
 * League behaviour.
 */
const MARQUEE: Record<number, { label: string; boost: number }> = Object.fromEntries(
  Object.entries(COMPETITION).map(([id, c]) => [id, { label: c.kicker, boost: c.weight }]),
);

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
  /** "Quarterfinals", "Final" — what names the stage of a cup run. */
  round_label?: string | null;
  star_home?: number | null;
  star_away?: number | null;
  /** Whether a call was published on it. The masthead only leads with one that has. */
  called?: boolean;
}

/**
 * Score a fixture for the masthead.
 *
 * Prominence dominates on purpose. A 92%-confidence call in a reserve league is
 * a good pick and a terrible headline, and the whole complaint this answers is
 * that the page led with competitions nobody came for.
 *
 * The occasion replaces what used to be a flat +180 for the provider's derby
 * flag. That flag fired on a Belgian under-23 reserve fixture and a Bulgarian
 * second-tier tie, and never on El Clasico, so the bonus meant for the biggest
 * nights of the season was going to games nobody has heard of.
 */
export function scoreCandidate(f: HeroCandidate, now: number): number {
  const rank = leagueRank(f.league_id);
  let score = (10 - rank) * 100;

  score += occasionOf({
    home: f.home,
    away: f.away,
    league_id: f.league_id,
    round_label: f.round_label ?? null,
    local_derby: f.derby,
    rank,
  }).weight;

  // Who is playing, whoever they are playing for. See statureOf.
  score += statureOf(f.home) + statureOf(f.away);

  // Today beats later this week: a masthead is about tonight. A game two
  // days out has to be a good deal bigger to lead over one this evening.
  const hoursOut = (f.kickoff - now) / 3600;
  if (hoursOut >= 0 && hoursOut <= 12) score += 150;
  else if (hoursOut > 12 && hoursOut <= 36) score += 60;
  else if (hoursOut > 36) score -= 100;
  else if (hoursOut < 0) score -= 400; // already kicked off

  score += Math.round((f.confidence ?? 0) * 40);
  return score;
}

export function chooseHero(fixtures: HeroCandidate[], now = Math.floor(Date.now() / 1000)): HeroPick | null {
  /*
   * A called fixture, or nothing.
   *
   * The masthead says "Our call on it, the argument for it", and it was
   * choosing on prominence alone -- so the front page led with Rivers United v
   * Kun Khalifat, a match we had passed on, under a sentence promising a call.
   * A candidate without `called` set is treated as called, so older callers
   * and tests keep their behaviour; the slate always sets it.
   */
  const live = fixtures.filter((f) => f.kickoff > now - 2 * 3600 && f.called !== false);
  if (live.length === 0) return null;

  const best = live.reduce((a, b) => (scoreCandidate(b, now) > scoreCandidate(a, now) ? b : a));

  const rank = leagueRank(best.league_id);
  const occasion = occasionOf({
    home: best.home,
    away: best.away,
    league_id: best.league_id,
    round_label: best.round_label ?? null,
    local_derby: best.derby,
    rank,
  });

  const kicker = occasion.kicker || best.league;
  const reason = occasion.kicker
    ? occasion.reason
    : rank <= 2
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
