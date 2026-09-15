-- offside.win — D1 schema
-- Written by the engine (GitHub Actions, via the D1 REST API), read by the Worker.
-- The Worker never writes and never computes: every serving row is pre-rendered JSON.

-- ---------------------------------------------------------------- reference

CREATE TABLE IF NOT EXISTS league (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  country     TEXT,
  season_id   INTEGER,           -- current season per BSD
  tracked     INTEGER NOT NULL DEFAULT 1,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS team (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  league_id   INTEGER,
  updated_at  INTEGER NOT NULL
);

-- ---------------------------------------------------------------- history

-- One row per finished match. The fitting set for every model.
-- xg_estimated mirrors BSD's provenance flag: 1 = their estimate, 0 = measured,
-- NULL = no xG at all. Never silently treat an estimate as a measurement.
CREATE TABLE IF NOT EXISTS match (
  id            INTEGER PRIMARY KEY,
  league_id     INTEGER NOT NULL,
  season_id     INTEGER,
  kickoff       INTEGER NOT NULL,          -- unix seconds
  home_team_id  INTEGER NOT NULL,
  away_team_id  INTEGER NOT NULL,
  home_goals    INTEGER,
  away_goals    INTEGER,
  home_xg       REAL,
  away_xg       REAL,
  xg_estimated  INTEGER,
  home_corners  INTEGER,
  away_corners  INTEGER,
  home_yellows  INTEGER,
  away_yellows  INTEGER,
  home_reds     INTEGER,
  away_reds     INTEGER,
  -- Style signal. Free to capture: the same stats payload already fetched for
  -- xG carries these, and they turn §4.2's matchup read from a stub into a
  -- computation.
  home_possession REAL,
  away_possession REAL,
  home_shots    INTEGER,
  away_shots    INTEGER,
  home_sot      INTEGER,
  away_sot      INTEGER,
  referee_id    INTEGER,
  stats_fetched INTEGER NOT NULL DEFAULT 0, -- 0 = stats endpoint not yet pulled
  updated_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS match_league_kickoff ON match(league_id, kickoff);
CREATE INDEX IF NOT EXISTS match_home ON match(home_team_id, kickoff);
CREATE INDEX IF NOT EXISTS match_away ON match(away_team_id, kickoff);
CREATE INDEX IF NOT EXISTS match_needs_stats ON match(stats_fetched, kickoff);
CREATE INDEX IF NOT EXISTS match_referee ON match(referee_id);

-- ---------------------------------------------------------------- ratings

-- Per-league fitted parameters. One row per league per fit.
CREATE TABLE IF NOT EXISTS rating_meta (
  league_id     INTEGER PRIMARY KEY,
  home_adv      REAL NOT NULL,     -- gamma, log scale
  rho           REAL NOT NULL,     -- Dixon-Coles low-score correction
  xi            REAL NOT NULL,     -- time-decay rate per day
  mean_goals    REAL NOT NULL,
  n_matches     INTEGER NOT NULL,
  log_lik       REAL,
  fitted_at     INTEGER NOT NULL
);

-- Per-team attack/defence on the log scale, with the uncertainty that gates
-- how far the model is allowed to disagree with the market.
CREATE TABLE IF NOT EXISTS rating (
  league_id     INTEGER NOT NULL,
  team_id       INTEGER NOT NULL,
  attack        REAL NOT NULL,
  defence       REAL NOT NULL,
  attack_se     REAL,
  defence_se    REAL,
  matches       INTEGER NOT NULL,  -- effective (decay-weighted) match count
  shrunk        REAL,              -- 0..1, how far pulled toward league mean
  fitted_at     INTEGER NOT NULL,
  PRIMARY KEY (league_id, team_id)
);

-- Corner and card rates, fitted separately from goals.
CREATE TABLE IF NOT EXISTS team_rate (
  league_id      INTEGER NOT NULL,
  team_id        INTEGER NOT NULL,
  corners_for    REAL,
  corners_against REAL,
  corners_disp   REAL,             -- negative-binomial dispersion
  yellows_for    REAL,
  reds_for       REAL,
  matches        INTEGER NOT NULL,
  fitted_at      INTEGER NOT NULL,
  PRIMARY KEY (league_id, team_id)
);

-- Referee card tendency. Only written once the sample gate (>=30) is cleared;
-- a referee below it stays absent rather than being stored as a weak number.
CREATE TABLE IF NOT EXISTS referee_rate (
  referee_id    INTEGER PRIMARY KEY,
  name          TEXT,
  matches       INTEGER NOT NULL,
  yellows_per   REAL,
  reds_per      REAL,
  fitted_at     INTEGER NOT NULL
);

-- ---------------------------------------------------------------- serving

-- One row per upcoming fixture. board_json is the compact card for the board;
-- bundle_json is everything the fixture page needs. The Worker does a single
-- indexed read and returns the blob untouched.
CREATE TABLE IF NOT EXISTS fixture (
  id           INTEGER PRIMARY KEY,
  league_id    INTEGER NOT NULL,
  kickoff      INTEGER NOT NULL,
  home_team    TEXT NOT NULL,
  away_team    TEXT NOT NULL,
  status       TEXT NOT NULL,
  provisional  INTEGER NOT NULL DEFAULT 1,   -- 1 until lineups are confirmed
  board_json   TEXT NOT NULL,
  bundle_json  TEXT NOT NULL,
  computed_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS fixture_kickoff ON fixture(kickoff);
CREATE INDEX IF NOT EXISTS fixture_league_kickoff ON fixture(league_id, kickoff);

-- Every published pick, with the evidence that produced it, so it can be
-- audited after the fact and fed back into calibration.
CREATE TABLE IF NOT EXISTS pick (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  fixture_id   INTEGER NOT NULL,
  kickoff      INTEGER NOT NULL,
  market       TEXT NOT NULL,
  outcome      TEXT NOT NULL,
  line         REAL,
  kind         TEXT NOT NULL,      -- VALUE (biggest mispricing) | LIKELY (most likely to land)
  model_prob   REAL NOT NULL,
  book_prob    REAL NOT NULL,      -- de-vigged
  edge         REAL NOT NULL,
  shrunk_edge  REAL NOT NULL,
  odds         REAL NOT NULL,
  bookmaker    TEXT,
  kelly        REAL,
  confidence   REAL NOT NULL,
  provisional  INTEGER NOT NULL,
  narrative    TEXT NOT NULL,
  evidence_json TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  settled_at   INTEGER,
  result       TEXT,               -- WON | LOST | PUSH | HALF_WON | HALF_LOST | VOID
  pnl          REAL,               -- units at 1pt stake, push-aware
  closing_odds REAL,               -- for closing-line value
  clv          REAL
);
CREATE INDEX IF NOT EXISTS pick_fixture ON pick(fixture_id);
CREATE INDEX IF NOT EXISTS pick_unsettled ON pick(settled_at, kickoff);
CREATE INDEX IF NOT EXISTS pick_created ON pick(created_at);
-- A pick is identified by fixture, market, outcome, line and kind — but `line`
-- is NULL for every market that has no line (1x2, BTTS, double chance), and
-- SQLite treats NULLs in a UNIQUE index as distinct from one another. So the
-- original index over the bare `line` column constrained nothing for exactly
-- those markets, ON CONFLICT never fired, and each slate published another copy
-- of every 1x2 pick instead of refreshing the one already there. Observed live:
-- ten picks across five fixtures, three of them duplicated verbatim.
--
-- COALESCE gives the absent line one concrete value so the constraint applies.
-- The ON CONFLICT target in slate.ts must spell the expression identically, or
-- SQLite will not match it to this index.
DROP INDEX IF EXISTS pick_unique;
DELETE FROM pick WHERE id NOT IN (
  SELECT id FROM (
    SELECT id, ROW_NUMBER() OVER (
      PARTITION BY fixture_id, market, outcome, COALESCE(line, -1e9), kind
      ORDER BY (settled_at IS NOT NULL) DESC, id DESC
    ) rn FROM pick
  ) WHERE rn = 1
);
CREATE UNIQUE INDEX IF NOT EXISTS pick_unique_line
  ON pick(fixture_id, market, outcome, COALESCE(line, -1e9), kind);

-- Rolling calibration per market family. Feeds selection shrinkage: markets we
-- have been wrong about are trusted less, automatically.
CREATE TABLE IF NOT EXISTS calibration (
  market_family TEXT PRIMARY KEY,  -- goals | result | corners | cards | handicap
  n             INTEGER NOT NULL,
  brier         REAL,
  log_loss      REAL,
  mean_model_p  REAL,
  mean_actual   REAL,
  roi           REAL,
  clv_mean      REAL,
  shrink        REAL NOT NULL,     -- 0..1 multiplier applied to raw edge
  updated_at    INTEGER NOT NULL
);

-- Backtest reports, newest first, rendered on the model page.
CREATE TABLE IF NOT EXISTS backtest (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  label        TEXT NOT NULL,
  report_json  TEXT NOT NULL,
  created_at   INTEGER NOT NULL
);

-- Small key/value state: entitlement probes, run cursors, narration ledger.
CREATE TABLE IF NOT EXISTS kv (
  k          TEXT PRIMARY KEY,
  v          TEXT NOT NULL,
  expires_at INTEGER,
  updated_at INTEGER NOT NULL
);
