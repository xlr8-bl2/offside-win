// Core types. The engine is a pipeline of these:
//   history -> ratings -> context -> pricing -> selection -> narration
// Every stage is pure over its inputs so the backtest can run the same code
// against historical data without touching the network.

// ---------------------------------------------------------------- evidence

/**
 * The doctrine's §13 made structural: "never uses thin data as if it were
 * thick". A factor is in exactly one of these states, and only COMPUTED
 * factors are allowed to move a number. THIN and UNAVAILABLE still appear in
 * the ledger — a fixture we know little about should visibly look like one.
 */
export type EvidenceState = 'COMPUTED' | 'THIN' | 'UNAVAILABLE';

/** §12's hierarchy of factors, lowest number = most dispositive. */
export type Tier = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export const TIER_NAMES: Record<Tier, string> = {
  1: 'availability',
  2: 'stakes',
  3: 'regime',
  4: 'form and fatigue',
  5: 'matchup',
  6: 'environment',
  7: 'market',
};

/** Which side of the fixture an adjustment applies to. */
export type Side = 'home' | 'away' | 'both';

/** The channels a factor can move. Goals feed every goals-derived market. */
export type Channel = 'goals' | 'corners' | 'cards';

/**
 * A bounded multiplicative adjustment. Factors never write probabilities
 * directly — they scale a rate, and the rate feeds one coherent distribution.
 * Keeping it multiplicative is what stops two factors double-counting into a
 * nonsensical probability.
 */
export interface Adjustment {
  channel: Channel;
  side: Side;
  /** Multiplier on the rate. 1.0 = no effect. Clamped by the caps in config. */
  multiplier: number;
}

/**
 * One reading of the fixture. Carries enough to (a) move the model,
 * (b) show its working in the ledger, and (c) be spoken about by the
 * narrator without the narrator knowing anything about football.
 */
export interface Factor {
  /** Stable id, e.g. "availability.absent_attacker". */
  id: string;
  /** Doctrine reference, e.g. "§2.4". Every factor traces to the document. */
  section: string;
  tier: Tier;
  state: EvidenceState;
  /** Human-readable summary of what was found, or why nothing was. */
  note: string;
  /** Raw numbers behind the note. The narrator may only cite from here. */
  evidence: Record<string, unknown>;
  /** Empty unless state === 'COMPUTED'. */
  adjustments: Adjustment[];
  /** Claims for the narrator. Empty unless the factor is worth saying aloud. */
  claims: Claim[];
  /** 0..1 — how strongly this factor is held, used for conflict detection. */
  strength: number;
}

// ---------------------------------------------------------------- narration

/**
 * A structured thing-to-say. The grammar turns this into a sentence; it never
 * invents a number, because every number it prints is read out of `evidence`.
 */
export interface Claim {
  /** Who or what the sentence is about: "Foden", "City", "the referee". */
  subject: string;
  /** Predicate class — selects which syntactic frames are eligible. */
  predicate: ClaimPredicate;
  /** Direction on the market in question: -1 suppresses, +1 promotes. */
  polarity: -1 | 0 | 1;
  /** 0..1. Drives intensifier choice ("slightly" vs "materially"). */
  magnitude: number;
  /** Only these values may appear as numbers in the generated sentence. */
  evidence: Record<string, number | string>;
  /** Doctrine section, carried through so the UI can link the reasoning. */
  section: string;
  tier: Tier;
}

export type ClaimPredicate =
  | 'absence'          // a player is out
  | 'suspension'       // out specifically through cards
  | 'return'           // a player is back
  | 'rotation'         // the XI looks changed
  | 'fatigue'          // short rest / congestion
  | 'travel'
  | 'regime_new'       // new manager
  | 'regime_bounce'
  | 'regime_settled'
  | 'stakes'           // what the game is worth
  | 'derby'
  | 'revenge'
  | 'form'             // recent output
  | 'form_run'         // §2.1 — the run of results a supporter would open with
  | 'conclusion'       // what we expect to happen, before the price is named
  | 'style_clash'      // §4.2 matchup read
  | 'set_piece'
  | 'weather'
  | 'pitch'
  | 'crowd'
  | 'referee'
  | 'market_move'      // §7.1
  | 'market_sharp'     // Pinnacle divergence
  | 'market_crowd'     // Polymarket divergence
  | 'rating_gap'       // our own numbers disagree with the price
  // Confidence calls. These answer "what is likely", not "what is mispriced",
  // and are kept as separate predicates so a frame written for one can never be
  // selected for the other — a value bet and a likely outcome make opposite
  // arguments and a sentence that blurs them misleads the reader.
  | 'strength_gap'     // the expected-goals mismatch that drives a confident call
  | 'match_shape'      // the same evidence read as a total, for a goals bet with no side
  | 'confidence_case'  // the verdict for a confidence call, including what it pays
  | 'counterweight';   // context pulling against the call, said out loud

// ---------------------------------------------------------------- history

export interface MatchRow {
  id: number;
  league_id: number;
  season_id: number | null;
  kickoff: number;
  home_team_id: number;
  away_team_id: number;
  home_goals: number | null;
  away_goals: number | null;
  home_xg: number | null;
  away_xg: number | null;
  /** 1 = provider estimated the xG, 0 = measured, null = none. */
  xg_estimated: number | null;
  home_corners: number | null;
  away_corners: number | null;
  home_yellows: number | null;
  away_yellows: number | null;
  home_reds: number | null;
  away_reds: number | null;
  home_possession: number | null;
  away_possession: number | null;
  home_shots: number | null;
  away_shots: number | null;
  home_sot: number | null;
  away_sot: number | null;
  referee_id: number | null;
}

// ---------------------------------------------------------------- ratings

export interface TeamRating {
  team_id: number;
  /** Log-scale attack strength; league mean is 0 by the sum-to-zero constraint. */
  attack: number;
  /** Log-scale defence; more negative concedes fewer. */
  defence: number;
  attack_se: number;
  defence_se: number;
  /** Decay-weighted effective match count, not a raw fixture count. */
  matches: number;
  /** 0..1 — how far this rating was pulled toward the league mean. */
  shrunk: number;
}

export interface LeagueParams {
  league_id: number;
  /** Log-scale home advantage, added to the home attack. */
  home_adv: number;
  /** Dixon-Coles low-score dependence. Negative in practice. */
  rho: number;
  /** Time-decay rate per day. */
  xi: number;
  mean_goals: number;
  n_matches: number;
  log_lik: number;
}

export interface RatingSet {
  params: LeagueParams;
  teams: Map<number, TeamRating>;
}

export interface TeamRate {
  team_id: number;
  corners_for: number;
  corners_against: number;
  corners_disp: number;
  yellows_for: number;
  reds_for: number;
  matches: number;
}

export interface RefereeRate {
  referee_id: number;
  name: string | null;
  matches: number;
  yellows_per: number;
  reds_per: number;
}

// ---------------------------------------------------------------- markets

export type MarketCode =
  | '1x2'
  | 'btts'
  | 'over_under_05'
  | 'over_under_15'
  | 'over_under_25'
  | 'over_under_35'
  | 'double_chance'
  | 'draw_no_bet'
  | 'total_corners'
  | 'corners_1x2'
  | 'total_red_cards'
  | 'red_card'
  | 'european_handicap'
  | 'asian_handicap';

export type MarketFamily = 'result' | 'goals' | 'corners' | 'cards' | 'handicap';

export const MARKET_FAMILY: Record<MarketCode, MarketFamily> = {
  '1x2': 'result',
  double_chance: 'result',
  draw_no_bet: 'result',
  btts: 'goals',
  over_under_05: 'goals',
  over_under_15: 'goals',
  over_under_25: 'goals',
  over_under_35: 'goals',
  total_corners: 'corners',
  corners_1x2: 'corners',
  total_red_cards: 'cards',
  red_card: 'cards',
  european_handicap: 'handicap',
  asian_handicap: 'handicap',
};

export type Outcome =
  | 'HOME' | 'DRAW' | 'AWAY'
  | '1X' | '12' | 'X2'
  | 'over' | 'under'
  | 'yes' | 'no';

/** Asian handicap settlement rule, straight off BSD's `push` field. */
export type PushRule = 'none' | 'full' | 'half';

/** One bookmaker quote as BSD reports it. */
export interface Quote {
  market: MarketCode;
  outcome: Outcome;
  line: number | null;
  push: PushRule | null;
  bookmaker_slug: string;
  bookmaker_name: string;
  decimal_odds: number;
  opening_decimal_odds: number | null;
  opening_at: number | null;
  previous_decimal_odds: number | null;
  implied_probability: number | null;
  movement: 'SHORTENING' | 'DRIFTING' | null;
  is_max_quote: boolean;
  updated_at: number;
}

/** A market as the book collectively prices it, after removing the margin. */
export interface BookMarket {
  market: MarketCode;
  line: number | null;
  /** Outcome -> de-vigged probability. Sums to 1 across the outcome set. */
  fair: Map<Outcome, number>;
  /** Outcome -> best available decimal odds, and who is offering them. */
  best: Map<Outcome, { odds: number; bookmaker: string }>;
  /** Sum of raw implied probabilities; 1.08 means an 8% margin. */
  overround: number;
  /** Which de-vig produced `fair`. Shin unless it failed to converge. */
  method: 'shin' | 'multiplicative';
  /** §7.1 movement, per outcome, where the book reported it. */
  movement: Map<Outcome, { opening: number; current: number; dir: 'SHORTENING' | 'DRIFTING' | null }>;
}

/** Our own price for the same market. */
export interface ModelMarket {
  market: MarketCode;
  line: number | null;
  probs: Map<Outcome, number>;
  /** 0..1 — how much we trust this number, from rating SE and evidence cover. */
  confidence: number;
}

// ---------------------------------------------------------------- selection

export type PickKind = 'VALUE' | 'LIKELY';

export interface Candidate {
  market: MarketCode;
  outcome: Outcome;
  line: number | null;
  push: PushRule | null;
  model_prob: number;
  book_prob: number;
  edge: number;
  shrunk_edge: number;
  odds: number;
  bookmaker: string;
  kelly: number;
  confidence: number;
  family: MarketFamily;
}

export interface Verdict {
  kind: PickKind;
  candidate: Candidate;
  narrative: string;
  /** Factors that drove it, most dispositive first. */
  drivers: Factor[];
  /** Factors considered and deliberately set aside — §12's closing line. */
  set_aside: Factor[];
}

export interface FixtureAnalysis {
  fixture_id: number;
  league_id: number;
  kickoff: number;
  home_team: string;
  away_team: string;
  home_team_id: number;
  away_team_id: number;
  status: string;
  /** True until the XI is confirmed — §12 puts availability first. */
  provisional: boolean;
  lineup_status: 'confirmed' | 'predicted' | 'unavailable';
  lambda_home: number;
  lambda_away: number;
  corner_rate: number;
  card_rate: number;
  factors: Factor[];
  book: BookMarket[];
  model: ModelMarket[];
  candidates: Candidate[];
  verdicts: Verdict[];
  /** Populated when nothing cleared the gates. This is a result, not a failure. */
  pass_reason: string | null;
  /** Third opinions, recorded but never used as the call. */
  external: {
    bsd_prediction?: Record<string, unknown>;
    polymarket?: Record<string, unknown>;
  };
  computed_at: number;
}
