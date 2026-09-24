import { adj, clamp, computed, effect, thin, unavailable } from '../ledger.ts';
import type { Claim, Factor } from '../types.ts';
import type { FixtureContext, SideContext, StandingRow } from './types.ts';

/**
 * §5 — the fixture itself. Stakes (§5.1), derby (§5.2), revenge (§5.3).
 *
 * §12 ranks stakes second only to availability, and for a specific reason:
 * stakes determine tactical setup and motivation more than any other single
 * factor. Two mid-table sides with nothing to play for produce a structurally
 * different game from two sides fighting relegation, whatever their ratings say.
 *
 * The doctrine is also unusually precise about which way each state pushes, and
 * this module follows it literally rather than reaching for the intuitive
 * answer. The clearest example is the derby: it is tempting to raise goals for
 * a fierce local fixture, but §5.2 states plainly that total goals are *not*
 * reliably elevated — derbies are as often cagey as chaotic. What is reliable is
 * cards, and BTTS through defensive error. So that is what moves here, and goals
 * are deliberately left alone.
 */

export type StakeState =
  | 'title_race'
  | 'european_chase'
  | 'relegation_fight'
  | 'six_pointer'
  | 'dead_rubber'
  | 'mid_table'
  | 'unknown';

interface SideStake {
  state: StakeState;
  /** 0..1 — how much is actually riding on it. */
  intensity: number;
  detail: Record<string, unknown>;
}

/** Rough European-qualification depth by table size. */
function europeanPlaces(tableSize: number): number {
  return tableSize >= 18 ? 6 : tableSize >= 12 ? 4 : 3;
}

function relegationPlaces(tableSize: number): number {
  return tableSize >= 18 ? 3 : tableSize >= 12 ? 2 : 1;
}

/**
 * How late in the season a state needs it to be before it means anything.
 *
 * Expressed as the share of the season still to play, not as a round count.
 * The gates were written as absolutes — eight games left for a title race,
 * twelve for a European chase — which is right for the 38-round league they
 * were written against and wrong for the other eighty-seven we now track, where
 * a season can be nineteen rounds or ninety.
 *
 * Relegation had no gate at all, which is the bug that reached the board:
 * Valencia were published as "fighting relegation with 32 to play" — game six of
 * thirty-eight, where the table is noise and nobody in the dressing room is
 * thinking about the drop. §5.1 is about motivation and tactical setup, and
 * those are late-season effects by nature. A relegation fight is real earlier
 * than a title race is decided, hence the looser share.
 */
const LATE_ENOUGH = {
  title_race: 0.21,
  european_chase: 0.32,
  relegation_fight: 0.4,
  dead_rubber: 0.21,
} as const;

export function classifySide(
  standing: StandingRow | null,
  standings: StandingRow[] | null,
  gamesLeft: number | null,
  seasonRounds: number | null = null,
): SideStake {
  if (!standing || !standings || standings.length < 4 || gamesLeft === null) {
    return { state: 'unknown', intensity: 0, detail: {} };
  }

  // Without a season length there is no way to know whether this is round six
  // or round thirty, so the absolute gates stand in — which is what the code
  // did everywhere before, and is only ever a fallback now.
  const rounds = seasonRounds && seasonRounds > 0 ? seasonRounds : null;
  const isLate = (state: keyof typeof LATE_ENOUGH, fallbackRounds: number): boolean =>
    rounds ? gamesLeft <= Math.round(rounds * LATE_ENOUGH[state]) : gamesLeft <= fallbackRounds;

  const size = standings.length;
  const leader = standings[0]!;
  const maxPoints = gamesLeft * 3;
  const gapToLeader = leader.points - standing.points;

  const relCut = standings[size - relegationPlaces(size) - 1];
  const gapToSafety = relCut ? standing.points - relCut.points : null;

  const euroCut = standings[europeanPlaces(size) - 1];
  const gapToEurope = euroCut ? euroCut.points - standing.points : null;

  const detail = {
    position: standing.position,
    points: standing.points,
    games_left: gamesLeft,
    gap_to_leader: gapToLeader,
    gap_to_safety: gapToSafety,
    gap_to_europe: gapToEurope,
  };

  // §5.1's title race: genuinely in it, and late enough for it to bite.
  if (gapToLeader <= Math.min(5, maxPoints) && isLate('title_race', 8) && standing.position <= 4) {
    return { state: 'title_race', intensity: clamp(1 - gapToLeader / 6, 0.4, 1), detail };
  }

  // Relegation: still catchable either way. A side already doomed or already
  // safe is a dead rubber, not a fight.
  if (standing.position > size - relegationPlaces(size) - 2 && gamesLeft > 0 && isLate('relegation_fight', 15)) {
    const reachable = gapToSafety === null || Math.abs(gapToSafety) <= maxPoints;
    if (reachable) {
      return { state: 'relegation_fight', intensity: clamp(1 - Math.abs(gapToSafety ?? 0) / 12, 0.4, 1), detail };
    }
    return { state: 'dead_rubber', intensity: 0.8, detail };
  }

  if (gapToEurope !== null && gapToEurope >= 0 && gapToEurope <= Math.min(6, maxPoints) && isLate('european_chase', 12)) {
    return { state: 'european_chase', intensity: clamp(1 - gapToEurope / 8, 0.3, 1), detail };
  }

  // Mathematically out of everything with games still to play: §5.1 calls this
  // the strongest systematic under signal in football.
  const outOfTitle = gapToLeader > maxPoints;
  const safeFromDrop = gapToSafety !== null && gapToSafety > maxPoints;
  const outOfEurope = gapToEurope !== null && gapToEurope > maxPoints;
  if (outOfTitle && safeFromDrop && outOfEurope && isLate('dead_rubber', 8)) {
    return { state: 'dead_rubber', intensity: clamp(1 - gamesLeft / 10, 0.4, 1), detail };
  }

  return { state: 'mid_table', intensity: 0.2, detail };
}

const STATE_LABEL: Record<StakeState, string> = {
  title_race: 'in the title race',
  european_chase: 'chasing European qualification',
  relegation_fight: 'fighting relegation',
  six_pointer: 'in a relegation six-pointer',
  dead_rubber: 'with nothing left to play for',
  mid_table: 'safely mid-table',
  unknown: 'in an unknown position',
};

export function stakesFactors(ctx: FixtureContext): Factor[] {
  const out: Factor[] = [];
  const gamesLeft =
    ctx.seasonRounds !== null && ctx.round !== null ? Math.max(0, ctx.seasonRounds - ctx.round) : null;

  /*
   * A table that is not a league table is not read.
   *
   * A cup or a group stage comes back flattened into one list -- the Nations
   * League as fifty-four rows, every one of them on nil points -- and read as
   * a league it says both sides are "safely mid-table with 105 games
   * remaining". No side in any competition has 105 games left. Anything with
   * more than twenty-four rows, or where nobody has played, has no table to
   * read yet, and the honest note says so.
   */
  const rows = ctx.standings ?? [];
  const nobodyHasPlayed = rows.length > 0 && rows.every((r) => (r.played ?? 0) === 0);
  const notALeague = rows.length > 24 || nobodyHasPlayed || (gamesLeft !== null && gamesLeft > 46);

  if (!ctx.standings || gamesLeft === null || notALeague) {
    out.push(
      unavailable({
        id: 'stakes.table',
        section: '§5.1',
        tier: 2,
        note: notALeague
          ? 'A cup or a group stage, so there is no league table to read what either side is playing for.'
          : 'No league table or round number available, so what either side is playing for is unknown.',
      }),
    );
  } else {
    const home = classifySide(ctx.home.standing, ctx.standings, gamesLeft, ctx.seasonRounds);
    const away = classifySide(ctx.away.standing, ctx.standings, gamesLeft, ctx.seasonRounds);
    out.push(stakeFactor(ctx, home, away, gamesLeft));
  }

  out.push(derbyFactor(ctx));
  out.push(revengeFactor(ctx));
  return out;
}

function stakeFactor(
  ctx: FixtureContext,
  home: SideStake,
  away: SideStake,
  gamesLeft: number,
): Factor {
  // §5.1's hardest fixture type: both sides desperate at once.
  const sixPointer =
    home.state === 'relegation_fight' &&
    away.state === 'relegation_fight' &&
    Math.abs((ctx.home.standing?.position ?? 0) - (ctx.away.standing?.position ?? 0)) <= 4;

  const bothDead = home.state === 'dead_rubber' && away.state === 'dead_rubber';
  const bothTitle = home.state === 'title_race' && away.state === 'title_race';

  const claims: Claim[] = [];
  const adjustments = [];
  let note: string;
  let strength: number;

  if (bothDead) {
    // The doctrine's strongest systematic under signal: rotation, mental
    // disengagement, pressing intensity collapsing, roughly seventy percent
    // of normal intensity.
    const k = (home.intensity + away.intensity) / 2;
    adjustments.push(adj('goals', 'both', effect(-0.75 * k)));
    adjustments.push(adj('corners', 'both', effect(-0.6 * k)));
    adjustments.push(adj('cards', 'both', effect(-0.5 * k)));
    note = `Neither side has anything left to play for with ${gamesLeft} games remaining.`;
    strength = clamp(k, 0.4, 0.95);
    claims.push({
      subject: 'both sides',
      predicate: 'stakes',
      polarity: -1,
      magnitude: strength,
      evidence: { state: 'dead rubber', games_left: gamesLeft },
      section: '§5.1',
      tier: 2,
    });
  } else if (sixPointer) {
    // High variance rather than a direction: cards and BTTS are the reliable
    // angles, and §5.1 says precise scoreline calls are hardest here.
    const k = (home.intensity + away.intensity) / 2;
    adjustments.push(adj('cards', 'both', effect(0.85 * k)));
    adjustments.push(adj('goals', 'both', effect(0.15 * k)));
    note = `A relegation six-pointer: both sides are in the drop zone's orbit with ${gamesLeft} games left.`;
    strength = clamp(k, 0.5, 1);
    claims.push({
      subject: 'both sides',
      predicate: 'stakes',
      polarity: 1,
      magnitude: strength,
      evidence: { state: 'relegation six-pointer', games_left: gamesLeft },
      section: '§5.1',
      tier: 2,
    });
  } else if (bothTitle) {
    // §5.1: controlled tempos, defensive discipline, fewer goals than the
    // attacking profiles suggest.
    const k = (home.intensity + away.intensity) / 2;
    adjustments.push(adj('goals', 'both', effect(-0.5 * k)));
    note = `Both sides are in the title race with ${gamesLeft} games to go, and neither wants to lose it here.`;
    strength = clamp(k, 0.4, 0.9);
    claims.push({
      subject: 'both sides',
      predicate: 'stakes',
      polarity: -1,
      magnitude: strength,
      evidence: { state: 'title race', games_left: gamesLeft },
      section: '§5.1',
      tier: 2,
    });
  } else {
    // Asymmetric: one side has something to play for and the other does not.
    const pairs: Array<[SideContext, SideStake, 'home' | 'away']> = [
      [ctx.home, home, 'home'],
      [ctx.away, away, 'away'],
    ];
    const parts: string[] = [];
    for (const [side, stake, which] of pairs) {
      parts.push(`${side.team_name} are ${STATE_LABEL[stake.state]}`);
      if (stake.state === 'european_chase' || stake.state === 'relegation_fight') {
        adjustments.push(adj('goals', which, effect(0.35 * stake.intensity)));
        claims.push({
          subject: side.team_name,
          predicate: 'stakes',
          polarity: 1,
          magnitude: stake.intensity,
          evidence: {
            state: stake.state === 'european_chase' ? 'chasing Europe' : 'fighting relegation',
            position: Number(stake.detail.position ?? 0),
            games_left: gamesLeft,
          },
          section: '§5.1',
          tier: 2,
        });
      } else if (stake.state === 'dead_rubber') {
        adjustments.push(adj('goals', which, effect(-0.5 * stake.intensity)));
        claims.push({
          subject: side.team_name,
          predicate: 'stakes',
          polarity: -1,
          magnitude: stake.intensity,
          evidence: { state: 'nothing to play for', games_left: gamesLeft },
          section: '§5.1',
          tier: 2,
        });
      }
    }
    // Two sides with nothing riding on it is not a sentence worth two clauses
    // and a games-remaining count. Say it once, quietly, and carry no weight.
    const bothMid = home.state === 'mid_table' && away.state === 'mid_table';
    note = bothMid
      ? 'Nothing much riding on this one for either side yet.'
      : `${parts.join('; ')}, with ${gamesLeft} game${gamesLeft === 1 ? '' : 's'} remaining.`;
    strength = bothMid ? 0 : clamp(Math.max(home.intensity, away.intensity), 0.1, 0.8);
  }

  return computed({
    id: 'stakes.season',
    section: '§5.1',
    tier: 2,
    note,
    evidence: {
      games_left: gamesLeft,
      home: { state: home.state, ...home.detail },
      away: { state: away.state, ...away.detail },
      six_pointer: sixPointer,
    },
    adjustments,
    claims,
    strength,
  });
}

/**
 * §5.2 derby.
 *
 * Cards are elevated because aggression is; BTTS is elevated because emotional
 * football produces defensive errors from both sides. Total goals are *not*
 * reliably elevated — the doctrine is explicit that derbies are as often tight
 * and cagey as chaotic, and neither extreme is the more likely. So goals stay
 * where they are and only the reliable channels move.
 */
function derbyFactor(ctx: FixtureContext): Factor {
  const isDerby = ctx.event['is_local_derby'] === true;
  if (!isDerby) {
    return computed({
      id: 'fixture.derby',
      section: '§5.2',
      tier: 2,
      note: 'Not a local derby.',
      evidence: { derby: false },
      strength: 0,
    });
  }

  return computed({
    id: 'fixture.derby',
    section: '§5.2',
    tier: 2,
    note:
      'Local derby. Cards and both-teams-to-score are the reliable reads; total goals are not, ' +
      'since derbies run cagey about as often as they run open.',
    evidence: { derby: true },
    adjustments: [adj('cards', 'both', effect(0.9))],
    claims: [
      {
        subject: 'the fixture',
        predicate: 'derby',
        polarity: 1,
        magnitude: 0.7,
        evidence: { home: ctx.home.team_name, away: ctx.away.team_name },
        section: '§5.2',
        tier: 2,
      },
    ],
    strength: 0.6,
  });
}

/**
 * §5.3 revenge. A side beaten heavily in the reverse fixture tends to perform
 * better than their aggregate form suggests. The doctrine notes the effect
 * scales with how meaningful that first meeting was, so a thrashing counts for
 * more than a narrow defeat and nothing below a three-goal margin registers.
 */
function revengeFactor(ctx: FixtureContext): Factor {
  const rev = ctx.reverseFixture;
  if (!rev || rev.home_goals === null || rev.away_goals === null) {
    return thin({
      id: 'fixture.revenge',
      section: '§5.3',
      tier: 2,
      note: 'No reverse fixture on record this season, so there is no revenge angle to read.',
    });
  }

  // In the reverse meeting the roles were swapped: our home side was away.
  const ourHomeScored = rev.away_goals;
  const ourHomeConceded = rev.home_goals;
  const margin = ourHomeScored - ourHomeConceded;

  if (Math.abs(margin) < 3) {
    return computed({
      id: 'fixture.revenge',
      section: '§5.3',
      tier: 2,
      note: `The reverse fixture finished ${ourHomeConceded}-${ourHomeScored}, too close to carry a revenge motive.`,
      evidence: { reverse_margin: margin },
      strength: 0,
    });
  }

  const beaten = margin < 0 ? 'home' : 'away';
  const side = beaten === 'home' ? ctx.home : ctx.away;
  const k = clamp(Math.abs(margin) / 5, 0.3, 1);

  return computed({
    id: 'fixture.revenge',
    section: '§5.3',
    tier: 2,
    note: `${side.team_name} lost the reverse fixture by ${Math.abs(margin)} goals and tend to show up better than form implies in the return.`,
    evidence: {
      reverse_margin: Math.abs(margin),
      beaten_side: side.team_name,
      reverse_score: `${rev.home_goals}-${rev.away_goals}`,
      reverse_date: rev.kickoff,
    },
    adjustments: [adj('goals', beaten, effect(0.3 * k))],
    claims: [
      {
        subject: side.team_name,
        predicate: 'revenge',
        polarity: 1,
        magnitude: k,
        evidence: {
          margin: Math.abs(margin),
          reverse_score: `${rev.home_goals}-${rev.away_goals}`,
        },
        section: '§5.3',
        tier: 2,
      },
    ],
    strength: clamp(k * 0.6, 0.2, 0.7),
  });
}

export const _internals = { europeanPlaces, relegationPlaces };
