-- offside.win — Postgres (Supabase) schema
--
-- Written by the engine (GitHub Actions, over the transaction pooler), read by
-- the Worker through PostgREST with the anon key. The Worker never writes and
-- never computes: every serving row is pre-rendered JSON.
--
-- Applied by migrate() on every entry point, so every statement must be
-- idempotent. migrate() splits this file on the semicolon character before it
-- strips comments, which has two consequences: nothing here may contain a
-- dollar-quoted body (that is why the grants and policies are written out per
-- table rather than looped in a DO block), and no comment may contain a
-- semicolon either, or the tail of it is left behind and executed as SQL.
-- Both are enforced by engine/test/schema.test.ts.
--
-- Type choices, deliberately conservative to keep the engine unchanged:
--   INTEGER (epoch seconds, provider ids, counts) -> bigint
--   REAL                                          -> double precision
--   0/1 flags stay integers, not booleans, because the engine writes 1/0 and
--   queries compare `= 1`. Converting them would be a wider change than it looks.

-- ---------------------------------------------------------------- reference

CREATE TABLE IF NOT EXISTS league (
  id          bigint PRIMARY KEY,
  name        text NOT NULL,
  country     text,
  season_id   bigint,
  tracked     integer NOT NULL DEFAULT 1,
  updated_at  bigint NOT NULL
);

CREATE TABLE IF NOT EXISTS team (
  id          bigint PRIMARY KEY,
  name        text NOT NULL,
  league_id   bigint,
  updated_at  bigint NOT NULL
);

-- ---------------------------------------------------------------- history

CREATE TABLE IF NOT EXISTS match (
  id            bigint PRIMARY KEY,
  league_id     bigint NOT NULL,
  season_id     bigint,
  kickoff       bigint NOT NULL,
  home_team_id  bigint NOT NULL,
  away_team_id  bigint NOT NULL,
  home_goals    integer,
  away_goals    integer,
  home_xg       double precision,
  away_xg       double precision,
  xg_estimated  integer,
  home_corners  integer,
  away_corners  integer,
  home_yellows  integer,
  away_yellows  integer,
  home_reds     integer,
  away_reds     integer,
  home_possession double precision,
  away_possession double precision,
  home_shots    integer,
  away_shots    integer,
  home_sot      integer,
  away_sot      integer,
  referee_id    bigint,
  stats_fetched integer NOT NULL DEFAULT 0,
  updated_at    bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS match_league_kickoff ON match(league_id, kickoff);
CREATE INDEX IF NOT EXISTS match_home ON match(home_team_id, kickoff);
CREATE INDEX IF NOT EXISTS match_away ON match(away_team_id, kickoff);
CREATE INDEX IF NOT EXISTS match_needs_stats ON match(stats_fetched, kickoff);
CREATE INDEX IF NOT EXISTS match_referee ON match(referee_id);

-- ---------------------------------------------------------------- ratings

CREATE TABLE IF NOT EXISTS rating_meta (
  league_id     bigint PRIMARY KEY,
  home_adv      double precision NOT NULL,
  rho           double precision NOT NULL,
  xi            double precision NOT NULL,
  mean_goals    double precision NOT NULL,
  n_matches     bigint NOT NULL,
  log_lik       double precision,
  fitted_at     bigint NOT NULL
);

CREATE TABLE IF NOT EXISTS rating (
  league_id     bigint NOT NULL,
  team_id       bigint NOT NULL,
  attack        double precision NOT NULL,
  defence       double precision NOT NULL,
  attack_se     double precision,
  defence_se    double precision,
  -- Effective, decay-weighted match count, so fractional. SQLite stored 12.86
  -- in a column it called INTEGER without complaint. Postgres rejects it.
  matches       double precision NOT NULL,
  shrunk        double precision,
  fitted_at     bigint NOT NULL,
  PRIMARY KEY (league_id, team_id)
);

CREATE TABLE IF NOT EXISTS team_rate (
  league_id       bigint NOT NULL,
  team_id         bigint NOT NULL,
  corners_for     double precision,
  corners_against double precision,
  corners_disp    double precision,
  yellows_for     double precision,
  reds_for        double precision,
  -- Decay-weighted, like rating.matches above.
  matches         double precision NOT NULL,
  fitted_at       bigint NOT NULL,
  PRIMARY KEY (league_id, team_id)
);

-- These two are decay-weighted counts and must be floating point. Stated as
-- alters as well as in the definitions above, because CREATE TABLE IF NOT
-- EXISTS silently leaves an existing table's types alone — a database created
-- before this was noticed would keep rejecting every ratings run otherwise.
ALTER TABLE rating ALTER COLUMN matches TYPE double precision;
ALTER TABLE team_rate ALTER COLUMN matches TYPE double precision;

CREATE TABLE IF NOT EXISTS referee_rate (
  referee_id    bigint PRIMARY KEY,
  name          text,
  matches       bigint NOT NULL,
  yellows_per   double precision,
  reds_per      double precision,
  fitted_at     bigint NOT NULL
);

-- ---------------------------------------------------------------- serving

CREATE TABLE IF NOT EXISTS fixture (
  id           bigint PRIMARY KEY,
  league_id    bigint NOT NULL,
  kickoff      bigint NOT NULL,
  home_team    text NOT NULL,
  away_team    text NOT NULL,
  status       text NOT NULL,
  provisional  integer NOT NULL DEFAULT 1,
  board_json   text NOT NULL,
  bundle_json  text NOT NULL,
  computed_at  bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS fixture_kickoff ON fixture(kickoff);
CREATE INDEX IF NOT EXISTS fixture_league_kickoff ON fixture(league_id, kickoff);

CREATE TABLE IF NOT EXISTS pick (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  fixture_id   bigint NOT NULL,
  kickoff      bigint NOT NULL,
  market       text NOT NULL,
  outcome      text NOT NULL,
  line         double precision,
  kind         text NOT NULL,
  model_prob   double precision NOT NULL,
  book_prob    double precision NOT NULL,
  edge         double precision NOT NULL,
  shrunk_edge  double precision NOT NULL,
  odds         double precision NOT NULL,
  bookmaker    text,
  kelly        double precision,
  confidence   double precision NOT NULL,
  provisional  integer NOT NULL,
  narrative    text NOT NULL,
  evidence_json text NOT NULL,
  created_at   bigint NOT NULL,
  settled_at   bigint,
  result       text,
  pnl          double precision,
  closing_odds double precision,
  clv          double precision
);
CREATE INDEX IF NOT EXISTS pick_fixture ON pick(fixture_id);
CREATE INDEX IF NOT EXISTS pick_unsettled ON pick(settled_at, kickoff);
CREATE INDEX IF NOT EXISTS pick_created ON pick(created_at);

-- `line` is NULL for every market without one (1x2, BTTS, double chance). On
-- SQLite that silently defeated the unique index, because NULLs there are always
-- distinct, and every rerun published a duplicate pick. Postgres 15 lets the
-- index say what we actually mean instead of hiding it behind COALESCE.
CREATE UNIQUE INDEX IF NOT EXISTS pick_unique_line
  ON pick(fixture_id, market, outcome, line, kind) NULLS NOT DISTINCT;

CREATE TABLE IF NOT EXISTS calibration (
  market_family text PRIMARY KEY,
  n             bigint NOT NULL,
  brier         double precision,
  log_loss      double precision,
  mean_model_p  double precision,
  mean_actual   double precision,
  roi           double precision,
  clv_mean      double precision,
  shrink        double precision NOT NULL,
  updated_at    bigint NOT NULL
);

CREATE TABLE IF NOT EXISTS backtest (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  label        text NOT NULL,
  report_json  text NOT NULL,
  created_at   bigint NOT NULL
);

CREATE TABLE IF NOT EXISTS kv (
  k          text PRIMARY KEY,
  v          text NOT NULL,
  expires_at bigint,
  updated_at bigint NOT NULL
);

-- The picks page needs one aggregate row. PostgREST cannot express it, and a
-- view keeps the Worker's promise that it computes nothing.
CREATE OR REPLACE VIEW pick_summary AS
  SELECT count(*) FILTER (WHERE settled_at IS NOT NULL)            AS n,
         count(*) FILTER (WHERE result = 'WON')                    AS wins,
         sum(pnl) FILTER (WHERE settled_at IS NOT NULL)            AS pnl,
         avg(odds) FILTER (WHERE settled_at IS NOT NULL)           AS avg_odds
  FROM pick;

-- ---------------------------------------------------------------- access
--
-- The anon key is public by design — it ships in the Worker and would ship in a
-- browser app. What keeps that safe is RLS plus SELECT-only grants: the site is
-- already public, so public reads change nothing, while writes stay with the
-- engine's pooler credentials. Every table below must be covered — a table left
-- out of this list is writable by anyone holding the anon key.

ALTER TABLE league ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS league_read ON league;
CREATE POLICY league_read ON league FOR SELECT TO anon USING (true);
GRANT SELECT ON league TO anon;

ALTER TABLE team ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS team_read ON team;
CREATE POLICY team_read ON team FOR SELECT TO anon USING (true);
GRANT SELECT ON team TO anon;

ALTER TABLE match ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS match_read ON match;
CREATE POLICY match_read ON match FOR SELECT TO anon USING (true);
GRANT SELECT ON match TO anon;

ALTER TABLE rating_meta ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rating_meta_read ON rating_meta;
CREATE POLICY rating_meta_read ON rating_meta FOR SELECT TO anon USING (true);
GRANT SELECT ON rating_meta TO anon;

ALTER TABLE rating ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rating_read ON rating;
CREATE POLICY rating_read ON rating FOR SELECT TO anon USING (true);
GRANT SELECT ON rating TO anon;

ALTER TABLE team_rate ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS team_rate_read ON team_rate;
CREATE POLICY team_rate_read ON team_rate FOR SELECT TO anon USING (true);
GRANT SELECT ON team_rate TO anon;

ALTER TABLE referee_rate ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS referee_rate_read ON referee_rate;
CREATE POLICY referee_rate_read ON referee_rate FOR SELECT TO anon USING (true);
GRANT SELECT ON referee_rate TO anon;

ALTER TABLE fixture ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fixture_read ON fixture;
CREATE POLICY fixture_read ON fixture FOR SELECT TO anon USING (true);
GRANT SELECT ON fixture TO anon;

ALTER TABLE pick ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pick_read ON pick;
CREATE POLICY pick_read ON pick FOR SELECT TO anon USING (true);
GRANT SELECT ON pick TO anon;

ALTER TABLE calibration ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS calibration_read ON calibration;
CREATE POLICY calibration_read ON calibration FOR SELECT TO anon USING (true);
GRANT SELECT ON calibration TO anon;

ALTER TABLE backtest ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS backtest_read ON backtest;
CREATE POLICY backtest_read ON backtest FOR SELECT TO anon USING (true);
GRANT SELECT ON backtest TO anon;

ALTER TABLE kv ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS kv_read ON kv;
CREATE POLICY kv_read ON kv FOR SELECT TO anon USING (true);
GRANT SELECT ON kv TO anon;

GRANT SELECT ON pick_summary TO anon;
