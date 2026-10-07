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
    /**
     * In-flight requests. The first live slate ran 58 minutes at 6, almost all
     * of it waiting: the account's request quota was exhausted, every call came
     * back 429, and each one then sat out a 2/4/8/16s backoff. Backoff no longer
     * holds a slot (see bsd.ts), which is the fix that matters; this raises the
     * ceiling now that the account is not rate-limited. Lower it to 6 again if
     * the provider ever starts pushing back.
     */
    concurrency: num('BSD_CONCURRENCY', 12),
    retries: num('BSD_RETRIES', 4),
    timeoutMs: num('BSD_TIMEOUT_MS', 30_000),
  },

  /**
   * Sportradar's Images API, for the football photography.
   *
   * `level` is `t` on a trial key and `p` on a production one, and it is part
   * of the URL rather than a header, so pointing a trial key at the production
   * path returns 403 rather than anything helpful. It defaults to trial because
   * that is what a new key is.
   */
  images: {
    key: process.env.SPORTRADAR_GETTY_KEY ?? '',
    level: (process.env.SPORTRADAR_IMAGES_LEVEL ?? 't') as 't' | 'p',
    /** Days back to sweep for action shots. A week covers a midweek round. */
    days: num('SPORTRADAR_IMAGE_DAYS', 7),
    /*
     * 1100ms was still drawing 429s, so the trial ceiling is tighter than one
     * request a second or it counts a burst window. 2000ms with the retry
     * behind it; a sweep has forty-five minutes and does not need to hurry.
     */
    minGapMs: num('SPORTRADAR_MIN_GAP_MS', 2000),
    /*
     * A hard ceiling on calls per run, and a breaker on top of it.
     *
     * A trial key's budget is the scarce resource, and one bad run spent close
     * to four hundred requests being refused over and over. `budget` caps what
     * a single run can cost; `tripAfter` consecutive refusals stops it dead,
     * because a key that has turned away the last fifteen calls will turn away
     * the next ninety.
     */
    budget: num('SPORTRADAR_BUDGET', 120),
    tripAfter: num('SPORTRADAR_TRIP_AFTER', 8),
    /** Dump what the manifests actually contain, for a run that matches none. */
    debug: process.env.SPORTRADAR_DEBUG === '1',
  },

  /** Supabase Storage, which is where re-hosted photography lands. */
  storage: {
    url: (process.env.SUPABASE_URL ?? '').replace(/\/+$/, ''),
    key: process.env.SUPABASE_SERVICE_KEY ?? '',
    bucket: process.env.SUPABASE_IMAGE_BUCKET ?? 'shots',
  },

  /**
   * Which database the engine writes to. Postgres, since it reproduced the
   * board and the backtest (0.6200 against D1's 0.6209 over the same 34,210
   * matches) and the Worker now reads through it. D1 remains reachable with
   * DB_BACKEND=d1 so the old path can still be run for comparison, but nothing
   * is scheduled against it — defaulting to it again would mean a forgotten
   * environment variable silently publishing to a database no one reads.
   */
  dbBackend: (process.env.DB_BACKEND ?? 'postgres') as 'd1' | 'postgres',

  pg: {
    url: process.env.SUPABASE_DB_URL ?? '',
    /**
     * Postgres allows 65535 bound parameters per statement against D1's 100.
     * Held well under that so a wide table cannot silently cross it, and so one
     * statement stays a sane size to build and send.
     */
    maxParams: num('PG_MAX_PARAMS', 20_000),
    poolSize: num('PG_POOL_SIZE', 8),
  },

  d1: {
    accountId: process.env.CF_ACCOUNT_ID ?? '',
    databaseId: process.env.CF_D1_DATABASE_ID ?? '',
    token: process.env.CF_API_TOKEN ?? '',
    /**
     * The Worker's engine door (worker/src/enginedb.ts), e.g.
     * https://offside.win/api/internal/db. When set, every statement goes
     * through it instead of the REST API; the key is derived from the token.
     */
    gateway: process.env.ENGINE_DB_URL ?? '',
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

  /**
   * What leads the board.
   *
   * The provider publishes no tier — confirmed against /coverage and the event
   * payload — so prominence is a judgement we make and maintain. Without it the
   * board ordered on kickoff alone and led with whatever happened to start
   * soonest, which on a Premier League Saturday meant a Polish cup tie.
   *
   * Lower is more prominent. Anything unlisted sorts at UNRANKED, and friendlies
   * sort below that: a pre-season kickabout should never outrank a real fixture
   * however confident the model is about it.
   */
  leagueRank: {
    // The night that owns the week when it is on.
    7: 1, // Champions League
    // The big five.
    1: 2, 3: 2, 4: 2, 5: 2, 6: 2, // Premier League, La Liga, Serie A, Bundesliga, Ligue 1
    // Secondary European competition and the strong domestic leagues.
    8: 3, 83: 3, 10: 3, 2: 3, 11: 3, 13: 3, 14: 3,
    // Major leagues outside Europe, plus Europe's next rung.
    12: 4, 9: 4, 85: 4, 20: 4, 18: 4, 17: 4, 49: 4, 50: 4,
    23: 4, 26: 4, 54: 4, 25: 4, 15: 4,
    // Second tiers, domestic cups and the rest of the covered set.
    38: 5, 89: 5, 88: 5, 86: 5, 87: 5, 34: 5, 44: 5, 42: 5, 46: 5,
    91: 5, 57: 5, 80: 5, 52: 5, 22: 5, 82: 5, 28: 5, 47: 5, 36: 5, 72: 5,
    // International competition: the Nations League is a Europa-level night
    // and CONCACAF's is a second tier. Neither was ranked, so both sorted
    // below MLS.
    64: 3, 65: 5,
    // Friendlies last, below unranked.
    79: 9, 31: 9,
  } as Record<number, number>,

  /** Where a league we have not ranked sorts. */
  unrankedLeague: num('UNRANKED_LEAGUE_RANK', 6),

  history: {
    /** Seasons of history to fit on. Two is the practical minimum. */
    seasons: num('HISTORY_SEASONS', 3),
    /** Don't pull per-match stats for matches older than this; goals suffice. */
    statsWindowDays: num('STATS_WINDOW_DAYS', 540),
    /**
     * Matches to pull stats for in one run. This is a cap on work per job, not
     * a total: whatever is left is picked up next run, since every fetched match
     * is marked and never re-fetched. Raise it for a wide first backfill — at
     * 88 leagues the default leaves most of the set unfetched and the shortfall
     * is invisible unless you count rows.
     */
    statsLimit: num('STATS_LIMIT', 4000),
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
    /**
     * Variance-to-mean ratio for a team's goals. MEASURED, and left at Poisson.
     *
     * 1.0 is Poisson. Above 1 the marginals become negative binomial with the
     * same mean and fatter tails. The hypothesis was that Poisson is too tight
     * for real football and that this was why we claimed 80%+ on "under 3.5"
     * and landed 71.7%. A hit-rate sweep appeared to confirm it — 80.3% to
     * 82.6% at 1.30 — but that gain was 40% fewer calls, not better ones.
     *
     * The backtest settled it over 34,210 matches:
     *
     *            1.00 (Poisson)   1.25
     *   overall        0.6200    0.6201
     *   over 3.5       0.6030    0.6011   better
     *   over 2.5       0.6842    0.6837   better
     *   over 1.5       0.5544    0.5553   worse
     *   btts           0.6957    0.6966   worse
     *   1x2 home       0.6562    0.6568   worse
     *
     * So it is not a free win, it is a trade: fattening both marginals helps
     * the high line and hurts the low ones and BTTS, because raising P(0) per
     * team is the same move as fattening the top tail. Net zero. A per-line
     * correction, or dispersion applied to the total rather than to each team,
     * might pick up the over-3.5 gain without paying for it — but this knob as
     * written does not, so it stays at Poisson. Do not re-derive this: the
     * evidence is above and `npm run backtest` reproduces it in 73 seconds.
     */
    goalDispersion: num('PRICE_GOAL_DISPERSION', 1.0),
  },

  /**
   * High-confidence calls, sourced from the provider's probabilities rather
   * than our own. A separate gate from `selection` on purpose: that one asks
   * "is the price wrong", this one asks "what is likely", and mixing the two
   * thresholds would mean a change to one silently moved the other.
   */
  /** consensus.ts: how far the goals markets move from the market's rates toward our model's. */
  consensus: {
    /**
     * How far the goals markets move from the price's scoring rates toward
     * our model's. lab:model (our ratings refitted week by week over 3,158
     * fixtures): on its own our read is less accurate than the price on
     * every family, and where the two disagree the price is the one that
     * lands. None, a quarter and half all publish within noise of each other
     * (a bootstrap over days puts them within a point of return either way),
     * so the weight is left where it is rather than moved on noise.
     */
    modelWeight: num('CONSENSUS_MODEL_WEIGHT', 0.5),
  },

  confident: {
    /**
     * Publish a call at or above this probability.
     *
     * Chosen by lab:tune on 3,077 fixtures split three ways by date (tuned on
     * the oldest half, chosen on the next quarter, checked once on the newest):
     *
     *   rule                                   landed           a day   return
     *   provider, 80%+ (the old rule)          83 / 83 / 80%    ~23     -1.0 / -0.3 / -3.2%
     *   consensus 72%+, within 1% of fair      77 / 78 / 78%    ~34     -0.5 / +0.4 / +3.0%
     *   78%+, best price at or above the       80 / 81 / 81%    ~20     +2.2 / +3.3 / +6.3%
     *     sharp book's fair price (this)
     *
     * The sharp-book test (minSharpEv) is what did it: over 1.5 goals, the
     * market the old board leaned on, lost in both tuning periods when value
     * was measured against the consensus.
     */
    //
    // Rechecked by lab deep (3,338 fixtures, 13 August to 6 October 2026,
    // same three-way split): the floor is not what leaves a match uncalled.
    // A match goes without a call because nothing likely is priced at or
    // above fair (55%), the likely outcome is too short (12%) or nothing is
    // priced (4%); too close to call is about 3%. Every looser floor did
    // worse than this one on the newer half (results at 74%: ahead in 0.2%
    // of resampled draws), and so did every lower ceiling and every other
    // ranking (lab deep ceiling): none held in all three periods.
    floor: num('CONF_FLOOR', 0.78),
    /**
     * One call per fixture.
     *
     * It was two, on the reasoning that their page shows two to four. Measured
     * against the settled record, the second call on a fixture is almost always
     * the same read expressed twice -- over 1.5 goals and a double chance on
     * the same one-sided game -- so it doubles the exposure without adding an
     * opinion, and it is half the reason the board carries a hundred and sixty
     * picks a day. One call per game is the whole product: what do you think
     * happens here.
     */
    perFixture: num('CONF_PER_FIXTURE', 1),
    /**
     * Never publish a call this likely without saying what it pays. Over 0.5
     * goals is ~97% and prices near 1.02: true, worthless, and the fastest way
     * to look like every other tips site.
     */
    ceiling: num('CONF_CEILING', 0.97),
    /**
     * And never publish one at a price this short whatever its probability. The
     * live board offered Ajax 1X at 1.04 — a 94% call returning fourpence in
     * the pound. Correct, unusable, and it makes every other call on the page
     * look like padding.
     */
    minOdds: num('CONF_MIN_ODDS', 1.13),
    /** The production rule's ceiling on price (lab/tune.ts PROD maxOdds): past
     *  3.5 a 78% read is the price disagreeing with us, not a call. */
    maxOdds: num('CONF_MAX_ODDS', 3.5),
    /**
     * The floor for a fixture people came to the site for.
     *
     * A picks product with nothing on the Madrid derby is not a picks product.
     * The board was silent on the biggest game of the weekend often enough to
     * be the first thing anyone noticed, because an 80% bar is a high bar and
     * the games with the most attention are also the most evenly matched --
     * which is exactly why they are worth watching and exactly why they do not
     * produce 80% calls.
     *
     * So a marquee fixture drops to this floor rather than passing. It is not
     * a lower standard dressed up: the call is published with `lean: true` and
     * the page says out loud that it is the best read on a close game rather
     * than a strong call, which is the true statement and the only one worth
     * making.
     */
    // 0.62 cost about three points of landing on the rule as a whole; 0.70
    // kept every big game answered and scored better than no exception at all:
    // 81/82/83% landed, +3.7/+6.0/+8.5% (lab:tune, 3,077 fixtures).
    marqueeFloor: num('CONF_MARQUEE_FLOOR', 0.7),
    /**
     * A higher floor for some league ranks. Rank 3 (Europa League, Nations
     * League, the strong second-tier leagues) lost in both tuning periods at
     * 78%; at 85% it earned in all three, and the rule as a whole went from
     * 80/82/82% landed at +2.5/+5.2/+7.3% to 81/83/82% at +3.4/+6.0/+7.8%
     * (lab:tune, 3,077 fixtures).
     */
    rankFloors: {
      3: num('CONF_RANK3_FLOOR', 0.85),
      /*
       * Friendlies (rank 9) at the same 85%. Australia 1-1 Brazil and India
       * 1-1 Panama (25 September 2026) were both "either side to win" at
       * 1.15-1.20, and both went to a side that had flown across the world
       * for a game that counted for nothing. By kind of match (lab:slices,
       * 3,158 fixtures) friendlies were the one slice the rule lost in: 37
       * calls, 70% landed against prices that said 82%, goals calls worst.
       * Taking out the draw-sensitive calls did not help; the bar did:
       *
       *                  older half              newer half
       *   78% (before)   31 calls  71%  -10.4%    6 calls  67%  +10.4%
       *   85% (this)      9 calls  89%   +2.0%    5 calls  80%  +12.4%
       *
       * Small samples both, and the live record agrees (7 calls, 71%).
       */
      9: num('CONF_FRIENDLY_FLOOR', 0.85),
    } as Record<number, number>,
    /**
     * Where a call's probability comes from: `consensus` (consensus.ts: the
     * bookmakers' de-vigged view, with goals priced off market rates blended
     * toward ours) or `provider` (the data provider's prediction, which the
     * market lab scored least accurate on goals). See lab/markets.ts.
     */
    //
    // Correcting the price's biases family by family was tried and rejected
    // (lab:calib, 3,159 fixtures). Over the whole history favourites at 85%+
    // landed 90% and short corners less than priced, but a curve fitted on
    // the older half and checked on the newest quarter took the rule from
    // +11.0% to -0.8% a call (ahead in 0.4% of bootstrap draws): the biases
    // do not hold still, and the correction let in marginal handicaps that
    // lost. The price is used as it is.
    source: (process.env.CONF_SOURCE ?? 'consensus') as 'consensus' | 'provider',
    /**
     * Among the calls on a fixture that clear the floor, which one. `prob`
     * takes the likeliest, which is nearly always the shortest price on the
     * card (over 1.5 goals, a double chance) and made the board one market
     * deep. `growth` weighs what it pays as well: p·ln(odds) plus the expected
     * return at the best price, so a 78% call at 1.30 beats an 86% call at
     * 1.13.
     */
    rankBy: (process.env.CONF_RANK_BY ?? 'prob') as 'prob' | 'growth',
    /**
     * The most any one market (and side of it) may take of a day's calls, as
     * a share of the day's fixtures. A fixture whose first choice is full
     * takes its next call that clears the floor, or none. 0 turns it off.
     */
    diversity: num('CONF_DIVERSITY', 0.3),
    /**
     * Never a call whose best price returns less than this per pound on its
     * own probability; -1 turns it off. Near zero the best price has to be
     * at or about the consensus's fair price: the one condition that separated
     * the rules that earned in the lab from the ones that did not.
     */
    minEv: num('CONF_MIN_EV', -0.01),
    /**
     * A best price this far above the consensus's fair odds (odds × fair
     * probability) is a book that has not moved, not an opportunity anyone
     * could take, and the call is not made on it.
     */
    maxGap: num('CONF_MAX_GAP', 1.12),
    /**
     * Markets (market and side, as bucketOf names them) that are not called.
     * Corners unders lost in both tuning periods under the sharp-book rule,
     * and leaving them out took the held-out quarter from +6.3% to +7.3%
     * (lab:tune, 3,077 fixtures). Comma-separated to override.
     */
    excludeMarkets: (process.env.CONF_EXCLUDE_MARKETS ?? 'total_corners under').split(',').map((x) => x.trim()).filter(Boolean),
    /** Only markets at least this many books priced in full; 0 for any. */
    minBooks: num('CONF_MIN_BOOKS', 0),
    /**
     * The value test against the sharp book as well, where it priced the
     * market: the best price must be within this of its fair price. Null
     * skips it.
     */
    minSharpEv: process.env.CONF_MIN_SHARP_EV ? Number(process.env.CONF_MIN_SHARP_EV) : (0 as number | null),
    /**
     * Price movement: leave a call the money has gone against since the market
     * opened, by more than this (one point: 80% at the open, under 79% now).
     *
     * lab:tune, 2,645 fixtures with opening prices: among options the market
     * prices alike, ones it drifted from by three points or more landed 1.8
     * points under their price, ones it was backed into 1 to 1.4 points over.
     * On the production rule, every limit from half a point to five improved
     * both landing and return in all three periods; one point was chosen on A
     * and B:
     *
     *                     landed (A / B / C)    return (A / B / C)
     *   without           81.2 / 81.3 / 82.7    +3.8 / +5.0 / +9.0%
     *   drift <= 1 point  81.6 / 81.4 / 84.0    +4.6 / +5.6 / +10.1%
     *
     * for about one call in twenty-five fewer. Null skips it. A call with no
     * opening price recorded is judged without it.
     *
     * Tightening it to zero (lab:model, 3,158 fixtures) lands about three
     * points more on B and C, and less on A. Checked period by period, the
     * drifted side is not a steady signal (options it drifted from by a point
     * or more landed 2.2 under their price in A, 0.1 over in B, 1.3 over in C),
     * so the gain is which matches fell where, and the limit stays at one
     * point. Only the other side is steady: backed by a point or more landed
     * 1 to 2.3 over its price in every period.
     */
    maxDrift: process.env.CONF_MAX_DRIFT ? Number(process.env.CONF_MAX_DRIFT) : (0.01 as number | null),
    /**
     * Holding a published call: the slack a call already up gets before it is
     * pulled, on the tests that move with every price update.
     *
     * Every pass re-ran the full bar on every standing call, so a call that
     * cleared it by a hair came down the moment a price twitched or the sharp
     * book's quote dropped out of the feed for a pass -- and went up again
     * when it came back. 14 of the first 15 calls pulled that way (3 to 6
     * October 2026) went on to land, and lab deep found the calls the close
     * would have dropped on price alone landing 80% across all three periods
     * (production 82%). A call with real news against it still comes down:
     * the side it backs rotated, or it falls clearly below the bar.
     */
    hold: {
      /** Points of probability below the floor a standing call may sit. */
      floor: num('CONF_HOLD_FLOOR', 0.01),
      /** How far below fair (consensus or sharp book) its best price may fall. */
      value: num('CONF_HOLD_VALUE', 0.02),
      /** Extra points the money may move against it since the open. */
      drift: num('CONF_HOLD_DRIFT', 0.02),
    },
    /** Quarter handicap lines (-1.75, 0.25) are a split stake nobody can explain in a sentence. */
    quarterLines: process.env.CONF_QUARTER_LINES === 'true',
    /** League rank at or below which a fixture counts as marquee. */
    marqueeRank: num('CONF_MARQUEE_RANK', 2),
    /**
     * How hard to punish a market family that has been overconfident.
     *
     * The settled record says the calls land about four points short of what
     * their prices need -- 82% where 86% breaks even -- and that gap is not
     * spread evenly: some families have been honest about themselves and some
     * have not. `refreshCalibration` already measures exactly that, as
     * mean_model_p against mean_actual, and until now nothing read it: the
     * confident floor was a flat number and the feedback loop the whole engine
     * is built around never reached the only calls that get published.
     *
     * It does now. A family that has been claiming five points more than it
     * delivers needs five more points before it publishes, times this. One is
     * "give back exactly what you overclaimed"; higher is stricter.
     */
    overconfidencePenalty: num('CONF_OVERCONF_PENALTY', 1),
    /** Below this many settled picks a family's measured gap is noise. */
    overconfidenceMinN: num('CONF_OVERCONF_MIN_N', 25),
    /**
     * Only calls made by the rule running now are counted, from when it went
     * live (the consensus source, 27 September 2026 17:18 UTC).
     *
     * The gap was measured over every call ever published, and 254 handicap
     * calls from the engine before that one had said 79% and landed 53%. That
     * charged handicaps 26 points, a floor of 104%, so from the switch onward
     * the live engine could not make a handicap call at all -- while in the
     * lab, which never applied the charge, handicaps were the largest single
     * source of calls (347 of 825) and earned in every period. Replayed day by
     * day on the rule's own calls (lab deep penalty), the charge almost never
     * fires: the rule has been honest about itself. It stays as a safety
     * valve, measured on the right calls.
     */
    overconfidenceSince: num('CONF_OVERCONF_SINCE', 1790529496),
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
    /**
     * Supporting claims per explanation, on top of the fixed beats — the form
     * opener, the mismatch, the reservation and the conclusion. Four was a
     * budget for a list of observations; an argument needs room for the step
     * that connects them.
     */
    maxClaims: num('NARRATE_MAX_CLAIMS', 5),
  },

  slate: {
    /** Fixtures whose data is fetched ahead of the one being analysed. */
    gatherAhead: num('SLATE_GATHER_AHEAD', 6),
    /** slate:loop: minutes between the starts of two passes, and how long one job keeps going. */
    loopEveryMinutes: num('SLATE_LOOP_EVERY', 15),
    loopForMinutes: num('SLATE_LOOP_FOR', 330),
    /** How far ahead to price. */
    horizonHours: num('SLATE_HORIZON_HOURS', 72),
    /** Keep finished fixtures on the board briefly so results are visible. */
    lookbackHours: num('SLATE_LOOKBACK_HOURS', 6),
  },
} as const;

/**
 * Fail fast on a missing credential, naming all of them at once.
 *
 * `provider: false` for work that only touches the database. Applying the
 * schema does not call the provider, and demanding its key there means the
 * deploy workflow has to be handed a secret it never uses — which is both a
 * wider blast radius than it needs and one more thing to get wrong.
 */
export function requireEnv(opts: { provider?: boolean } = {}): void {
  const missing: string[] = [];
  if (opts.provider !== false && !config.bsd.key) missing.push('BSD_API_KEY');
  // Only the active backend's credentials are required. Demanding the other
  // one's would make the cutover need secrets it has no use for.
  if (config.dbBackend === 'postgres') {
    if (!config.pg.url) missing.push('SUPABASE_DB_URL');
  } else {
    if (!config.d1.accountId) missing.push('CF_ACCOUNT_ID');
    if (!config.d1.databaseId) missing.push('CF_D1_DATABASE_ID');
    if (!config.d1.token) missing.push('CF_API_TOKEN');
  }
  if (missing.length) {
    throw new Error(
      `Missing required environment: ${missing.join(', ')}.\n` +
        `Set them as GitHub Actions secrets, or export them locally to run the engine by hand.`,
    );
  }
}
