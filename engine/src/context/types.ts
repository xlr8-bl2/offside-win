import type { BookMarket, Factor, MatchRow, Quote, RefereeRate } from '../types.ts';
import type { LoadedLeagueModel } from '../ratings/fit.ts';

/** One squad member, as the provider reports them. */
export interface SquadPlayer {
  id: number;
  name: string;
  position: string | null;
  availability: string | null;
  injury_type: string | null;
  injury_expected_return: string | null;
}

/** A player named in a lineup, predicted or confirmed. */
export interface LineupPlayer {
  id: number;
  name: string;
  position: string | null;
  starting: boolean;
  ai_score: number | null;
}

export interface SideLineup {
  formation: string | null;
  players: LineupPlayer[];
  /** The provider's own confidence in this predicted XI, 0..1, per side. */
  confidence: number | null;
}

export interface LineupInfo {
  status: 'confirmed' | 'predicted' | 'unavailable';
  confidence: number | null;
  home: SideLineup | null;
  away: SideLineup | null;
  /** Players the provider says are out, with a reason where given. */
  /**
   * `side` is which half of the provider's split list the player came from.
   * The provider sends `unavailable_players` as `{ home: [...], away: [...] }`
   * with no team on the individual entries, so the key is the only thing that
   * says whose player this is. It used to be flattened away.
   */
  unavailable: Array<{
    id: number; name: string; team_id: number | null; reason: string | null;
    side: 'home' | 'away' | null;
  }>;
}

/** Where a team sits, and what that position is worth to them. */
export interface StandingRow {
  team_id: number;
  position: number;
  played: number;
  points: number;
  goal_diff: number;
  /** The rest of a table row, where the feed carries it; the league page draws it. */
  team_name?: string | null;
  won?: number | null;
  drawn?: number | null;
  lost?: number | null;
  goals_for?: number | null;
  goals_against?: number | null;
}

export interface ManagerTenure {
  team_id: number;
  team_name: string | null;
  date_from: number | null;
  date_to: number | null;
  matches: number;
  ppm: number | null;
  /** §1.1's honest measure: the club's form before the appointment vs after. */
  appointment_effect: { before_ppm: number | null; after_ppm: number | null; delta: number | null } | null;
}

export interface ManagerInfo {
  id: number;
  name: string | null;
  current: ManagerTenure | null;
  /** Matches into the current tenure as of this fixture. */
  matchesInCharge: number | null;
  tenureDays: number | null;
}

/** A player's share of their team's output, used to size an absence. */
export interface ScorerRow {
  player_id: number;
  name: string;
  goals: number;
  assists: number;
  /** Whose player, where the feed says; the league page groups by it. */
  team_id?: number | null;
  team_name?: string | null;
}

export interface SideContext {
  team_id: number;
  team_name: string;
  squad: SquadPlayer[] | null;
  scorers: ScorerRow[] | null;
  manager: ManagerInfo | null;
  standing: StandingRow | null;
  /** Recent fixtures, newest first, for rest and congestion. */
  recent: MatchRow[];
  /** The XI last time out, to measure rotation against. */
  lastLineupIds: number[] | null;
  /** Kickoff times across all competitions, for rest and congestion. */
  schedule: number[] | null;
}

/**
 * Everything the doctrine's factors read. Assembled once per fixture, then
 * passed to each module. Every field is nullable: an absent source becomes an
 * UNAVAILABLE factor, never a guess.
 */
export interface FixtureContext {
  fixture_id: number;
  league_id: number;
  league_name: string;
  kickoff: number;
  now: number;
  home: SideContext;
  away: SideContext;

  /** Raw event record — carries weather, derby, travel, pitch, attendance. */
  event: Record<string, unknown>;
  lineups: LineupInfo;
  referee: RefereeRate | null;
  standings: StandingRow[] | null;
  /** Total rounds in the season, to tell a dead rubber from a run-in. */
  seasonRounds: number | null;
  round: number | null;
  h2h: unknown;
  /** The reverse meeting this season, if played — §5.3's revenge read. */
  reverseFixture: MatchRow | null;
  /** Recent finished matches for both sides, for style and opponent adjustment. */
  styleMatches: { home: MatchRow[]; away: MatchRow[] };

  model: LoadedLeagueModel;
  quotes: Quote[];
  book: BookMarket[];
  polymarket: unknown;
  prediction: unknown;
  /** True when the per-bookmaker grid is behind a tier we do not hold. */
  comparisonEntitled: boolean;
}

export type FactorModule = (ctx: FixtureContext) => Factor[];
