/**
 * Every tunable in one place. The values here are starting points drawn from
 * the doctrine and from published football-modelling practice; the ones marked
 * FITTED are replaced by backtest output as soon as there is history to fit
 * against. Nothing in the engine hard-codes a constant that isn't here.
 */

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const v = Number(raw);
  return Number.isFinite(v) ? v : fallback;
}

export const config = {
  bsd: {
    base: process.env.BSD_BASE_URL ?? 'https://sports.bzzoiro.com',
    key: process.env.BSD_API_KEY ?? '',
    /** Provider is uncapped, but be a good citizen and stay reproducible. */
    concurrency: num('BSD_CONCURRENCY', 6),
    retries: num('BSD_RETRIES', 4),
    timeoutMs: num('BSD_TIMEOUT_MS', 30_000),
  },

  d1: {
    accountId: process.env.CF_ACCOUNT_ID ?? '',
    databaseId: process.env.CF_D1_DATABASE_ID ?? '',
    token: process.env.CF_API_TOKEN ?? '',
    /** D1 REST caps statements per batch; stay well under it. */
    batchSize: num('D1_BATCH', 40),
    /**
     * D1 caps *bound parameters per query* at 100 — far below SQLite's own
     * SQLITE_MAX_VARIABLE_NUMBER, and the ceiling that actually bites when
     * chunking multi-row inserts. Overridable so a raised cap needs no release.
     */
    maxParams: num('D1_MAX_PARAMS', 100),
  },

  /**
   * Leagues to track. Empty means **every league the provider covers** — 88 at
   * last count, cups, second tiers, women's and youth competitions included.
   * There is no top-flight filter; `discoverLeagues` applies this list or takes
   * everything. An earlier comment here promised tier filtering that was never
   * implemented, and the gap is expensive: a blank list backfilled against three
   * seasons exhausted D1's free-tier daily row-write quota in 27 minutes.
   * Set LEAGUES=1,6,12 to pin explicit BSD league ids, which is what any install
   * on the free tier wants.
   */
  leagues: (process.env.LEAGUES ?? '')
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0),

  history: {
    /** Seasons of history to fit on. Two is the practical minimum. */
    seasons: num('HISTORY_SEASONS', 3),
    /** Don't pull per-match stats for matches older than this; goals suffice. */
    statsWindowDays: num('STATS_WINDOW_DAYS', 540),
  },

  ratings: {
    /**
     * Time decay per day. FITTED. 0.0065 ≈ a 107-day half-life, which is the
     * region most published work lands in for top-flight football.
     */
    xi: num('RATING_XI', 0.0065),
    /** Dixon-Coles low-score dependence. FITTED. Negative in every real league. */
    rho: num('RATING_RHO', -0.11),
    /**
     * Prior strength for ρ, counted in low-score matches. ρ is informed only by
     * 0-0, 1-0, 0-1 and 1-1 results, so one league-season identifies it to about
     * ±0.07 — as large as the effect. Without this the fitter adopts noise, and
     * a positive ρ is actively worse than no correction.
     */
    rhoPriorMatches: num('RATING_RHO_PRIOR', 200),
    /** Optimiser controls. */
    maxIter: num('RATING_MAX_ITER', 2500),
    tolerance: num('RATING_TOL', 2e-4),
    /**
     * Shrinkage prior strength, in effective matches. A team with this many
     * weighted matches sits halfway between its own form and the league mean.
     * Stops three August wins turning a promoted side into a contender.
     */
    priorMatches: num('RATING_PRIOR_MATCHES', 8),
    /**
     * Weight on xG-derived ratings vs goals-derived, where xG was *measured*.
     * xG is a cleaner read of the underlying process; goals are its noisy
     * realisation. Halved automatically where the provider flags xG estimated.
     */
    xgWeight: num('RATING_XG_WEIGHT', 0.6),
    /** Below this many effective matches a rating is THIN, not COMPUTED. */
    minMatches: num('RATING_MIN_MATCHES', 6),
  },

  /** Caps that stop the doctrine's factors running away with the model. */
  context: {
    /** Largest multiplier any single factor may apply. */
    factorCap: num('CTX_FACTOR_CAP', 0.15),
    /** Largest combined multiplier across the whole stack, per channel/side. */
    stackCap: num('CTX_STACK_CAP', 0.35),
  },

  /** Sample gates. §13: thin data is stated as thin and excluded. */
  gates: {
    refereeMatches: num('GATE_REFEREE', 30),
    playerAppearances: num('GATE_PLAYER_APPS', 20),
    playerMinutes: num('GATE_PLAYER_MINUTES', 45),
    opponentAdjustFixtures: num('GATE_OPP_ADJUST', 6),
    absenceHistory: num('GATE_ABSENCE_HISTORY', 3),
    h2hMeetings: num('GATE_H2H', 3),
  },

  pricing: {
    /** Score matrix dimension. 11 covers >99.99% of football scorelines. */
    maxGoals: num('PRICE_MAX_GOALS', 11),
    maxCorners: num('PRICE_MAX_CORNERS', 26),
    maxCards: num('PRICE_MAX_CARDS', 12),
  },

  selection: {
    /**
     * Base edge required before a price counts as wrong. The real bar is
     * this plus half the overround — §7.3: a fatter margin demands a
     * stronger read.
     */
    baseEdge: num('SEL_BASE_EDGE', 0.035),
    /** Minimum model confidence (0..1) for a pick to be publishable. */
    minConfidence: num('SEL_MIN_CONFIDENCE', 0.45),
    /** Minimum count of COMPUTED tier-1..3 factors. */
    minTopTierFactors: num('SEL_MIN_TOP_FACTORS', 2),
    /** Never bet into odds outside this band; too short to matter, too long to trust. */
    minOdds: num('SEL_MIN_ODDS', 1.25),
    maxOdds: num('SEL_MAX_ODDS', 12),
    /** Kelly fraction. Quarter-Kelly is the standard defensive choice. */
    kellyFraction: num('SEL_KELLY', 0.25),
    /** Most picks of each kind per fixture. */
    maxPerFixture: num('SEL_MAX_PER_FIXTURE', 1),
    /**
     * Prior trust per market family before live calibration exists. Goals
     * markets come off one well-understood distribution; cards are rare
     * events on thin data and are trusted least.
     */
    priorShrink: {
      result: num('SHRINK_RESULT', 0.80),
      goals: num('SHRINK_GOALS', 0.85),
      handicap: num('SHRINK_HANDICAP', 0.75),
      corners: num('SHRINK_CORNERS', 0.55),
      cards: num('SHRINK_CARDS', 0.40),
    },
  },

  narrate: {
    /** How many recent picks the anti-repetition ledger remembers. */
    ledgerSize: num('NARRATE_LEDGER', 400),
    /** Claims composed into one narrative. */
    minClaims: num('NARRATE_MIN_CLAIMS', 2),
    maxClaims: num('NARRATE_MAX_CLAIMS', 4),
  },

  slate: {
    /** How far ahead to price. */
    horizonHours: num('SLATE_HORIZON_HOURS', 72),
    /** Keep finished fixtures on the board briefly so results are visible. */
    lookbackHours: num('SLATE_LOOKBACK_HOURS', 6),
  },
} as const;

export function requireEnv(): void {
  const missing: string[] = [];
  if (!config.bsd.key) missing.push('BSD_API_KEY');
  if (!config.d1.accountId) missing.push('CF_ACCOUNT_ID');
  if (!config.d1.databaseId) missing.push('CF_D1_DATABASE_ID');
  if (!config.d1.token) missing.push('CF_API_TOKEN');
  if (missing.length) {
    throw new Error(
      `Missing required environment: ${missing.join(', ')}.\n` +
        `Set them as GitHub Actions secrets, or export them locally to run the engine by hand.`,
    );
  }
}
