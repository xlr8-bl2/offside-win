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

-- A club's colour, read off its crest (engine/src/images/crest.ts). One hex
-- value per team, or '' for a crest that could not be read, so it is tried
-- once rather than every run. The match page washes its masthead in the two.
CREATE TABLE IF NOT EXISTS team_color (
  team_id    bigint PRIMARY KEY,
  color      text NOT NULL,
  updated_at bigint NOT NULL
);

-- A ground, by name (engine/src/context/venue.ts). The provider puts only an
-- id on each match; this is its name, city and capacity, looked up once. An
-- empty name means the provider could not describe it, so it is not asked
-- again every run.
CREATE TABLE IF NOT EXISTS venue (
  id         bigint PRIMARY KEY,
  name       text NOT NULL,
  city       text NOT NULL DEFAULT '',
  capacity   integer,
  updated_at bigint NOT NULL
);

-- What is coming up, beyond what has been analysed.
--
-- The slate reads matches three days ahead; search has to know about the
-- ones after that too, or a reader looking for next week's derby is told it
-- does not exist. One row per upcoming match in a covered competition, for
-- two weeks, written by the slate (engine/src/schedule.ts). No analysis and
-- no calls, so it is public.
CREATE TABLE IF NOT EXISTS schedule (
  id            bigint PRIMARY KEY,
  league_id     bigint NOT NULL,
  kickoff       bigint NOT NULL,
  home_team     text NOT NULL,
  away_team     text NOT NULL,
  home_team_id  bigint,
  away_team_id  bigint,
  updated_at    bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS schedule_kickoff ON schedule (kickoff);

-- A photograph of a team, re-hosted.
--
-- One row per team, holding the best action shot we have found for them. The
-- URL points at our own storage rather than at Sportradar: every request to
-- their image API needs the key in a header, and a browser cannot be given the
-- key on a site whose source is public.
--
-- `credit` is NOT NULL on purpose. Agency photography travels with its
-- copyright line and a page that drops it is the kind of thing that ends a
-- licence. A row with no credit is a row we must not publish, so the column
-- makes that unrepresentable rather than a rule somebody has to remember.
CREATE TABLE IF NOT EXISTS team_shot (
  team_id     bigint PRIMARY KEY,
  url         text NOT NULL,
  credit      text NOT NULL,
  title       text,
  asset_id    text,
  width       integer,
  height      integer,
  taken_at    bigint,
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

-- Competition prominence, lower is bigger. It lived only inside board_json, so
-- the board could not sort on it and did not -- which is how a Europa League
-- tie came to lead a day with La Liga on it, and a fourth-round cup tie sat
-- third. Added as a separate ALTER because the guarded create above is a
-- no-op against a table that already exists, so a new column never lands.
ALTER TABLE fixture ADD COLUMN IF NOT EXISTS rank integer NOT NULL DEFAULT 6;
CREATE INDEX IF NOT EXISTS fixture_day_rank ON fixture((kickoff / 86400), rank, kickoff);

-- The same fixture with the call taken out: the write-up, the form, the team
-- news and the line-ups, but no selection, no price and no bookmaker. Written
-- by the slate beside the full copy rather than derived here, because the
-- Worker's whole design is that nothing is assembled at request time.
--
-- Nullable, and the serving functions fall back to the full copy when it is.
-- That is deliberate: until the slate has rewritten a fixture these columns are
-- empty, and the alternative to falling back is a blank board. Nothing leaks
-- that is not already public today -- the wall simply engages per fixture as
-- the slate catches up. get_health reports how many are still waiting, so a
-- slate that never runs cannot leave the paywall quietly disabled.
ALTER TABLE fixture ADD COLUMN IF NOT EXISTS board_free_json  text;
ALTER TABLE fixture ADD COLUMN IF NOT EXISTS bundle_free_json text;

-- The final score.
--
-- Everything on this site that looks backwards needed it and nothing had it.
-- The board could say FT but not what happened; the results page marked a pick
-- won or lost and could not print the scoreline that decided it, so a reader
-- was asked to take our word for the grade. That is the one thing a record
-- publishing its own losses cannot afford to ask for.
--
-- Written from two places on purpose. The slate sets it every quarter of an
-- hour for anything inside its lookback window, which is what makes a match
-- read as played within minutes of finishing. Settlement sets it again from
-- the score it graded against, which reaches further back and is the version
-- that is authoritative -- a pick and the scoreline beside it can then never
-- disagree, because they came from the same number.
ALTER TABLE fixture ADD COLUMN IF NOT EXISTS home_goals integer;
ALTER TABLE fixture ADD COLUMN IF NOT EXISTS away_goals integer;

-- The running score, while the match is on.
--
-- It used to travel only inside board_json, and board_json is frozen at
-- kick-off -- so the one moment a live score exists was the one moment the
-- card could not carry it, and no page ever showed one. These two columns
-- update on every slate pass like the status does, and the serving functions
-- lay them over the frozen card under their own name, so nothing can mistake
-- a first-half score for a result. Null once the match is over, when
-- home_goals and away_goals take over.
ALTER TABLE fixture ADD COLUMN IF NOT EXISTS live_home integer;
ALTER TABLE fixture ADD COLUMN IF NOT EXISTS live_away integer;
-- And the minute, so a live row can say 61' rather than just LIVE.
ALTER TABLE fixture ADD COLUMN IF NOT EXISTS live_minute integer;

-- The match report, once there is one: goals with minutes and assists, cards,
-- substitutions, player ratings, team totals and the confirmed team sheets.
-- Written once per finished match by engine/src/report.ts, in its own column
-- because the write-up beside it is frozen at kick-off. A finished match is
-- public, so the serving functions hand it to everyone.
ALTER TABLE fixture ADD COLUMN IF NOT EXISTS report_json text;

-- The provider's team ids, which are also the keys to its image service:
-- /img/team/{id}/ returns the real crest. They were on the board card and
-- nowhere a SQL query could reach them, so every page built from `pick` rather
-- than from the card -- the whole results record -- drew generated monograms
-- beside clubs whose badge we already had.
ALTER TABLE fixture ADD COLUMN IF NOT EXISTS home_team_id bigint;
ALTER TABLE fixture ADD COLUMN IF NOT EXISTS away_team_id bigint;

-- Every finished fixture's market snapshot, kept after the fixture itself
-- leaves the board. The fixture table holds a week; the bundle inside it is
-- the only record of the prices the engine saw and what it made of them, and
-- deleting it weekly threw away the one dataset that can say which markets and
-- which selection rules actually earn (engine/src/lab). pruneBoard copies a
-- fixture here before deleting it. Private: read by the lab, nothing else.
CREATE TABLE IF NOT EXISTS market_snapshot (
  fixture_id   bigint PRIMARY KEY,
  league_id    bigint NOT NULL,
  kickoff      bigint NOT NULL,
  home_goals   integer NOT NULL,
  away_goals   integer NOT NULL,
  snapshot     text NOT NULL,
  archived_at  bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS market_snapshot_kickoff ON market_snapshot(kickoff);

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
-- The price when we first called it, and what it had become by kick-off.
--
-- `odds` is overwritten on every slate run, because the board has to show a
-- price somebody can still get. That makes it useless for asking the question
-- that actually matters after a loss: did the market come round to us and the
-- ball not go in, or were we wrong and the market knew it? So the first price
-- is kept where nothing overwrites it, and the last one seen before kick-off
-- is kept beside it.
ALTER TABLE pick ADD COLUMN IF NOT EXISTS opening_odds double precision;

-- The post-mortem: what the result says about the call, written at settlement.
-- Nullable because every pick settled before this existed has none, and a page
-- that demands it would show nothing for the whole back record.
ALTER TABLE pick ADD COLUMN IF NOT EXISTS postmortem_json text;
-- Why this call, at its odds: the members' paragraph. Kept on the record so a
-- settled call still carries its argument once the fixture's write-up is gone.
ALTER TABLE pick ADD COLUMN IF NOT EXISTS why text;

-- Calls taken down before kick-off (engine/src/pulled.ts). The withdrawal in
-- the slate deleted the pick and kept nothing, so a member who had seen the
-- call was never told it had gone, or why. Now the call, the reason in plain
-- words and what replaced it are kept here, the Worker emails members who
-- want to know (worker/src/pulled.ts), and the match page says so.
-- `restored_at` is set if the same call comes back before kick-off.
CREATE TABLE IF NOT EXISTS pulled_call (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  pick_id      bigint NOT NULL UNIQUE,
  fixture_id   bigint NOT NULL,
  kickoff      bigint NOT NULL,
  home         text NOT NULL,
  away         text NOT NULL,
  market       text NOT NULL,
  outcome      text NOT NULL,
  line         double precision,
  label        text NOT NULL,      -- the call in words, as the site names it
  odds         double precision NOT NULL,
  bookmaker    text,
  reason       text NOT NULL,      -- why, without naming the call
  replaced_by  text,               -- the new call in words, members only
  published_at bigint NOT NULL,
  pulled_at    bigint NOT NULL,
  restored_at  bigint,
  alerted_at   bigint
);
CREATE INDEX IF NOT EXISTS pulled_call_fixture ON pulled_call (fixture_id);
ALTER TABLE pulled_call ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON pulled_call FROM anon, authenticated;
-- How a pulled call would have gone, graded after the game by settle.ts
-- (gradePulled) exactly as a live call is. Shown on the results page beside
-- why it was pulled, and never counted in the record: nobody was told to
-- back it at kick-off. VOID when the match was not played.
ALTER TABLE pulled_call ADD COLUMN IF NOT EXISTS after_result text;
ALTER TABLE pulled_call ADD COLUMN IF NOT EXISTS after_home   integer;
ALTER TABLE pulled_call ADD COLUMN IF NOT EXISTS after_away   integer;
ALTER TABLE pulled_call ADD COLUMN IF NOT EXISTS after_at     bigint;

-- Calls pulled before kick-off, for the results page: only once the match
-- has started (before that, a pulled call can still come back, and what it
-- was is for members), one row per call however often it was pulled, and
-- none that came back and went out at kick-off -- those are in the record.
CREATE OR REPLACE FUNCTION get_pulled(p_limit integer DEFAULT 20)
RETURNS json LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT coalesce(json_agg(row_to_json(x) ORDER BY x.kickoff DESC), '[]'::json)
  FROM (
    SELECT * FROM (
      SELECT DISTINCT ON (pc.fixture_id, pc.market, pc.outcome, pc.line)
             pc.fixture_id, coalesce(f.kickoff, pc.kickoff) AS kickoff, pc.home, pc.away,
             f.home_team_id, f.away_team_id,
             pc.label, pc.odds, pc.bookmaker, pc.reason, pc.pulled_at,
             pc.after_result, pc.after_home, pc.after_away
        FROM pulled_call pc
        LEFT JOIN fixture f ON f.id = pc.fixture_id
       WHERE pc.restored_at IS NULL
         AND coalesce(f.kickoff, pc.kickoff) < floor(extract(epoch FROM now()))::bigint
         AND NOT EXISTS (
           SELECT 1 FROM pick p
            WHERE p.fixture_id = pc.fixture_id AND p.kind = 'CONFIDENT'
              AND p.market = pc.market AND p.outcome = pc.outcome
              AND p.line IS NOT DISTINCT FROM pc.line)
       ORDER BY pc.fixture_id, pc.market, pc.outcome, pc.line, pc.pulled_at DESC
    ) d
    ORDER BY d.kickoff DESC
    LIMIT greatest(1, least(coalesce(p_limit, 20), 60))
  ) x;
$fn$;
REVOKE ALL ON FUNCTION get_pulled(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_pulled(integer) TO anon, authenticated;

-- Which member has been emailed about which pulled call, so a retry or a
-- second Worker run never sends the same alert twice.
CREATE TABLE IF NOT EXISTS pulled_notice (
  pulled_id bigint NOT NULL,
  email     text NOT NULL,
  sent_at   bigint NOT NULL,
  PRIMARY KEY (pulled_id, email)
);
ALTER TABLE pulled_notice ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON pulled_notice FROM anon, authenticated;

-- The bet slip: the most likely calls on the board, combined to total odds
-- between 2.00 and 3.00 (engine/src/slip.ts). Rebuilt each slate until its
-- first leg kicks off, then frozen and graded like any call, so it has a
-- record of its own.
CREATE TABLE IF NOT EXISTS slip (
  id            bigserial PRIMARY KEY,
  created_at    bigint NOT NULL,
  first_kickoff bigint NOT NULL,
  legs_json     text NOT NULL,
  odds          double precision NOT NULL,
  chance        double precision NOT NULL,
  result        text,
  settled_at    bigint
);
CREATE INDEX IF NOT EXISTS slip_open ON slip(settled_at, first_kickoff);

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

-- ------------------------------------------------------------ membership
--
-- What a reader buys, what they currently hold, and what they paid. Every
-- table here is private: the policies below are scoped to auth.uid() rather
-- than USING (true), so the public anon key -- which has no uid -- matches no
-- rows at all. That is the same seam the serving tables use, pointed the other
-- way.
--
-- None of these carry a foreign key to auth.users. Deliberately: auth.users is
-- GoTrue's, this file is re-applied on every entry point, and a cross-schema
-- reference is a permissions failure waiting for a bad day. A payment record
-- also has to outlive the account it belonged to, which a cascade would
-- prevent. A deleted user leaves rows nobody can ever read, which is harmless.

CREATE TABLE IF NOT EXISTS plan (
  id           text PRIMARY KEY,
  name         text NOT NULL,
  days         integer NOT NULL,
  amount_minor bigint NOT NULL,
  currency     text NOT NULL,
  active       integer NOT NULL DEFAULT 1,
  sort         integer NOT NULL DEFAULT 0,
  updated_at   bigint NOT NULL
);

-- The amount is in minor units -- pence, not pounds -- because a price in
-- floating point is a rounding error with a customer attached to it.
INSERT INTO plan (id, name, days, amount_minor, currency, active, sort, updated_at)
VALUES ('monthly', 'Monthly', 30, 900, 'GBP', 1, 1, floor(extract(epoch FROM now()))::bigint)
ON CONFLICT (id) DO NOTHING;

-- Three plans, in football terms: a matchday pass for a weekend, a month, and
-- a season ticket. The weekly one is the impulse buy and the season ticket is
-- the anchor that makes the month look cheap; both are rows, so a price is an
-- UPDATE and not a deploy. `checkout_url` is the processor's own checkout link
-- for the plan (Whop issues one per pricing plan), read by the Worker's
-- checkout route when the provider is Whop.
ALTER TABLE plan ADD COLUMN IF NOT EXISTS checkout_url text;
INSERT INTO plan (id, name, days, amount_minor, currency, active, sort, updated_at)
VALUES ('matchday', 'Matchday pass', 7, 349, 'GBP', 1, 0, floor(extract(epoch FROM now()))::bigint),
       ('season',   'Season ticket', 365, 4900, 'GBP', 1, 2, floor(extract(epoch FROM now()))::bigint)
ON CONFLICT (id) DO NOTHING;

-- Three months in place of a year. A year up front was a large first payment
-- for a site a reader has only just met, and a switch into it would have been
-- a long wait before the new price began. Three months at seven pounds a
-- month is the saving without the commitment. The season ticket is retired,
-- not deleted: past receipts still name it.
INSERT INTO plan (id, name, days, amount_minor, currency, active, sort, updated_at)
VALUES ('quarter', '3 months', 90, 2100, 'GBP', 1, 2, floor(extract(epoch FROM now()))::bigint)
ON CONFLICT (id) DO NOTHING;
-- Written as an insert because migrate runs only statements that shape the
-- schema or seed it; it is a no-op once the row is off.
INSERT INTO plan (id, name, days, amount_minor, currency, active, sort, updated_at)
VALUES ('season', 'Season ticket', 365, 4900, 'GBP', 0, 3, floor(extract(epoch FROM now()))::bigint)
ON CONFLICT (id) DO UPDATE SET active = 0, updated_at = excluded.updated_at WHERE plan.active = 1;

-- An entitlement by email, for a processor that runs its own accounts.
--
-- Whop takes the payment on its own site under whatever email the buyer uses
-- there, and tells us by webhook. There may be no account here yet, so the
-- grant is keyed on the email and has_membership() honours it through
-- auth.email() once that person signs in. It is the paid product, so it is
-- locked like `pick` and read only through the functions.
CREATE TABLE IF NOT EXISTS entitlement (
  email        text PRIMARY KEY,
  plan_id      text NOT NULL,
  expires_at   bigint NOT NULL,
  source       text NOT NULL,
  source_ref   text,
  status       text NOT NULL DEFAULT 'active',
  created_at   bigint NOT NULL,
  updated_at   bigint NOT NULL
);
-- Where the buyer manages a membership sold through Whop (cancel, change
-- plan): Whop's own page for it, from the membership's `manage_url`.
ALTER TABLE entitlement ADD COLUMN IF NOT EXISTS manage_url text;
-- When the reader stopped a Whop membership renewing from our account page
-- (the Worker has already told Whop to end it at its period end). Cleared by
-- the next genuine renewal, which can only come if it was switched back on.
ALTER TABLE entitlement ADD COLUMN IF NOT EXISTS renew_stopped_at bigint;

-- Every processor reference an entitlement has been granted from, so a grant
-- is applied once however many times it is replayed. The entitlement row only
-- remembers its latest reference: a reader who bought a matchday pass and then
-- went monthly has two, and with only the latest remembered the sweep kept
-- re-applying the other one, flipping the plan back and forth.
-- A deleted account that had a membership, remembered only as a one-way
-- fingerprint of its email, so a free trial is once per person rather than
-- once per account: without it, deleting and signing up again with the same
-- address was a fresh trial every time. Kept six years (pruneBoard purges
-- older rows), and named in the privacy policy's retention table.
CREATE TABLE IF NOT EXISTS former_member (
  email_sha256 text PRIMARY KEY,
  at           bigint NOT NULL
);
ALTER TABLE former_member ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON former_member FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS entitlement_grant (
  ref        text PRIMARY KEY,
  email      text NOT NULL,
  plan_id    text NOT NULL,
  created_at bigint NOT NULL
);

-- What each buyer confirmed at checkout: 18 or over and the terms (with the
-- version), and the express request to start at once with the acknowledgement
-- that it ends the 14-day right to cancel (Consumer Contracts Regulations 2013,
-- reg. 37). Written through record_consent with the buyer's own token before
-- any payment is started; read by nobody but the service role. Kept six years after the
-- membership ends, the window in which a claim about it can be brought.
CREATE TABLE IF NOT EXISTS purchase_consent (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id       uuid NOT NULL,
  plan_id       text NOT NULL,
  terms_version text NOT NULL,
  adult         boolean NOT NULL,
  waived        boolean NOT NULL,
  created_at    bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS purchase_consent_user ON purchase_consent (user_id, created_at);

-- The entitlement, and the only one of these four a browser ever reads. It
-- carries the card's brand and last four so the account page can say "Visa
-- ending 4242" without going anywhere near the credential table.
CREATE TABLE IF NOT EXISTS membership (
  user_id      uuid PRIMARY KEY,
  plan_id      text NOT NULL,
  expires_at   bigint NOT NULL,
  auto_renew   integer NOT NULL DEFAULT 0,
  cancelled_at bigint,
  dunning_from bigint,
  attempts     integer NOT NULL DEFAULT 0,
  card_brand   text,
  card_last4   text,
  created_at   bigint NOT NULL,
  updated_at   bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS membership_renewing ON membership(expires_at) WHERE auto_renew = 1;

-- The credential. Private: no grant to anon at all, so nothing holding the
-- public key can read it whatever JWT it presents.
--
-- The first attempt at this granted the table and revoked the sensitive
-- columns. That does not work -- a table-level SELECT satisfies every column
-- and the column revoke is silently a no-op, which a live database said and a
-- regex never would. The fix is not to grant the table.
--
-- It holds a vault token and the last four digits. Never a card number, never
-- a CVV -- those stay with the processor, which is the whole reason to use one.
--
-- origin_ref is the irreplaceable column. Every merchant-initiated charge has
-- to cite the customer-initiated payment that carried CVV and 3DS, so losing
-- it means that card can never be charged again. consent_at, consent_ip and
-- consent_terms are the stored-credential disclosure the card networks require
-- at that same first payment. All four are written before anything reads them.
CREATE TABLE IF NOT EXISTS payment_method (
  user_id       uuid PRIMARY KEY,
  provider      text NOT NULL,
  vault_token   text NOT NULL,
  origin_ref    text NOT NULL,
  brand         text,
  last4         text,
  exp_month     integer,
  exp_year      integer,
  consent_at    bigint NOT NULL,
  consent_ip    text,
  consent_terms text NOT NULL,
  created_at    bigint NOT NULL,
  updated_at    bigint NOT NULL
);

-- Also private, for the same reason: raw_json is whatever the processor sent,
-- which is their schema and not ours, and may carry more about a person than
-- the account page has any business showing. Readers get the payment_receipt
-- view below instead, which names its columns.
CREATE TABLE IF NOT EXISTS payment (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  provider     text NOT NULL,
  provider_ref text NOT NULL,
  user_id      uuid NOT NULL,
  plan_id      text NOT NULL,
  amount_minor bigint NOT NULL,
  currency     text NOT NULL,
  status       text NOT NULL,
  raw_json     text NOT NULL,
  created_at   bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS payment_user ON payment(user_id, created_at);

-- The idempotency key, and the only thing standing between a retried webhook
-- and a membership extended twice. Processors retry on any non-200, including
-- ones where the write already succeeded.
CREATE UNIQUE INDEX IF NOT EXISTS payment_provider_ref ON payment(provider, provider_ref);

-- ------------------------------------------------------------- serving API
--
-- The Worker reads through these, not through the tables, and that is a CPU
-- decision rather than a stylistic one. Cloudflare's free tier allows 10 ms of
-- CPU per request. Reading rows over PostgREST and reassembling them in the
-- Worker means JSON.parse over the whole board on every request -- a megabyte
-- of pre-rendered fixture JSON, parsed only to be serialised straight back --
-- which is comfortably over that budget. Each function below returns the
-- finished response body as a single json value, so PostgREST sends exactly the
-- bytes the Worker needs and the Worker streams them through without parsing
-- anything at all.
--
-- All are STABLE, so PostgREST accepts them over GET and the edge can cache
-- them, and all are SECURITY INVOKER: they read as the caller, under the same
-- RLS policies as a direct select, and grant no access the anon key lacks.

-- kv values are written by kvSetJSON and are therefore valid JSON, but a
-- malformed one would take the whole /api/model response down with it rather
-- than dropping one row. The engine's own reader has always been forgiving here
-- and so is this.
CREATE OR REPLACE FUNCTION try_json(raw text)
RETURNS json LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE SET search_path = public AS $fn$
BEGIN
  RETURN raw::json;
EXCEPTION WHEN others THEN
  RETURN to_json(raw);
END;
$fn$;

-- The goals out of a match report, for a row that has room for the scorers
-- and not for the whole report. Null when there is no report or no goals.
CREATE OR REPLACE FUNCTION report_goals(raw text)
RETURNS jsonb LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = public AS $fn$
  SELECT CASE WHEN raw IS NULL THEN NULL ELSE (
    SELECT jsonb_agg(e ORDER BY (e->>'minute')::numeric NULLS FIRST, (e->>'added')::numeric NULLS FIRST)
    FROM jsonb_array_elements(coalesce(try_json(raw)::jsonb->'events', '[]'::jsonb)) e
    WHERE e->>'t' = 'goal'
  ) END;
$fn$;

-- A reader's own account: the name they go by and how they like odds written.
-- One row per signed-in user, written only through save_profile() below, so
-- the table itself grants nothing to anyone.
CREATE TABLE IF NOT EXISTS profile (
  user_id      uuid PRIMARY KEY,
  display_name text,
  odds_format  text NOT NULL DEFAULT 'decimal',
  created_at   bigint NOT NULL,
  updated_at   bigint NOT NULL
);
-- How the account looks and how the site reads for this person: which
-- picture stands for them (Google's, their initials on a colour they chose,
-- or their club's crest), their club, and a 12- or 24-hour clock.
ALTER TABLE profile ADD COLUMN IF NOT EXISTS avatar_style text NOT NULL DEFAULT 'auto';
ALTER TABLE profile ADD COLUMN IF NOT EXISTS avatar_color text;
ALTER TABLE profile ADD COLUMN IF NOT EXISTS club_id bigint;
ALTER TABLE profile ADD COLUMN IF NOT EXISTS club_name text;
ALTER TABLE profile ADD COLUMN IF NOT EXISTS clock text NOT NULL DEFAULT '24';
-- A handle the reader chooses: lower-case letters, digits and underscores,
-- three to twenty of them, one per person whatever the capitals.
ALTER TABLE profile ADD COLUMN IF NOT EXISTS username text;
CREATE UNIQUE INDEX IF NOT EXISTS profile_username ON profile (lower(username)) WHERE username IS NOT NULL;
-- An email when a call is pulled before kick-off. On unless switched off on
-- the account page; a member with no profile row gets them too.
ALTER TABLE profile ADD COLUMN IF NOT EXISTS call_alerts boolean NOT NULL DEFAULT true;

-- The teams and competitions a reader follows. The label is kept so the
-- account page can list a follow without a lookup, and so a team that drops
-- off the board still reads as itself.
CREATE TABLE IF NOT EXISTS follow (
  user_id    uuid NOT NULL,
  kind       text NOT NULL,
  ref_id     bigint NOT NULL,
  label      text NOT NULL,
  created_at bigint NOT NULL,
  PRIMARY KEY (user_id, kind, ref_id)
);

-- The picks page needs one aggregate row. Settled, non-void picks only: a void
-- bet is a stake returned, so counting it would dilute the strike rate with
-- results that were never in play. HALF_WON is an Asian-handicap half-win and
-- counts as a win, as it does in the ledger.
-- The published record, and only the published record. We compute calls in
-- three kinds but show one, so a summary spanning all three would describe
-- picks nobody was ever shown -- which is the opposite of what a results page
-- is for. The other kinds keep being marked; they live in the by-kind view
-- below, which is how we judge the model rather than how we present it.
-- What the account page shows: a receipt, not a processor payload.
--
-- The WHERE clause is doing the security work here, not a policy. A view is
-- not RLS-aware by default -- it runs with its owner's rights, which is how it
-- can read a table anon cannot -- so filtering to auth.uid() inside the view is
-- the only thing standing between one member and everyone else's payments.
-- Do not remove it, and do not add a column from the base table without asking
-- whether a browser should hold it.
CREATE OR REPLACE VIEW payment_receipt AS
  SELECT p.created_at, p.plan_id, p.amount_minor, p.currency, p.status
  FROM payment p
  WHERE p.user_id = auth.uid()
  ORDER BY p.created_at DESC;

CREATE OR REPLACE VIEW pick_summary AS
  SELECT count(*)                                                   AS n,
         count(*) FILTER (WHERE result IN ('WON', 'HALF_WON'))       AS wins,
         sum(pnl)                                                    AS pnl,
         avg(odds)                                                   AS avg_odds
  FROM pick
  WHERE settled_at IS NOT NULL AND result IS DISTINCT FROM 'VOID'
    AND kind = 'CONFIDENT';

-- The same aggregate, split by what kind of call it was. Mixing them produces a
-- number that describes nothing: a value bet is taken at 2.50 expecting to lose
-- most of the time, a confidence call is taken at 1.16 expecting to win nearly
-- always, and their combined strike rate and ROI belong to neither. The split
-- is what lets the page show each product against its own bar.
CREATE OR REPLACE VIEW pick_summary_by_kind AS
  SELECT kind,
         count(*)                                                   AS n,
         count(*) FILTER (WHERE result IN ('WON', 'HALF_WON'))      AS wins,
         sum(pnl)                                                   AS pnl,
         avg(odds)                                                  AS avg_odds,
         avg(clv) FILTER (WHERE clv IS NOT NULL)                    AS clv_mean
  FROM pick
  WHERE settled_at IS NOT NULL AND result IS DISTINCT FROM 'VOID'
  GROUP BY kind;

-- Does the caller hold a membership that has not run out?
--
-- SECURITY INVOKER is not a concession here, it is what makes this correct. The
-- function reads `membership` under that table's own policy, so an anonymous
-- caller -- who has no auth.uid() -- matches no rows and gets false, with no
-- special case anywhere. It must also be declared before the serving functions
-- that call it: a LANGUAGE sql body is parsed at creation, and migrate() sends
-- statements in file order.
CREATE OR REPLACE FUNCTION has_membership()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM membership m
    WHERE m.user_id = auth.uid()
      AND m.expires_at > floor(extract(epoch FROM now()))::bigint
  ) OR EXISTS (
    SELECT 1 FROM entitlement e
    WHERE auth.email() IS NOT NULL
      AND lower(e.email) = lower(auth.email())
      AND e.status = 'active'
      AND e.expires_at > floor(extract(epoch FROM now()))::bigint
  );
$fn$;

-- The free call of the day: the headline fixture's call is public.
--
-- One call a day, in full, with the reason -- the oldest hook in this trade
-- and the one that converts, because a reader who has watched a free call
-- land knows what the paid ones look like. chooseHero() only picks a called
-- fixture, so this is never empty on a day with calls.
-- The free call is the strongest open call of the day, chosen by the slate
-- (engine/src/free.ts) and kept under free:today. The headline fixture is the
-- fallback for a database the new slate has not written yet.
CREATE OR REPLACE FUNCTION free_fixture_id()
RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  -- Only the call engine/src/free.ts chose. It writes null on a day with no
  -- call to give, and the headline fixture used to stand in then: its call,
  -- often days away, went out free under "Today's free call", and a headline
  -- with no call at all was marked as the free one.
  SELECT (try_json(v)->>'fixture_id')::bigint FROM kv WHERE k = 'free:today';
$fn$;

-- ------------------------------------------------------------ the writes
--
-- Two functions the webhook calls, and the only things in this file that are
-- not reads. They are private: no grant to anon, so the public key cannot reach
-- them however it asks. The Worker calls them holding a service key, which
-- bypasses RLS -- that is what makes them work and also why they are written to
-- do exactly one thing each.
--
-- Both are one round trip on purpose. The processor expects a 200 inside five
-- seconds and retries up to sixteen times over eighteen hours if it does not
-- get one, so a read-then-write from the Worker would be two chances to be slow
-- and two chances to race a retry.

-- Record a payment and extend the membership it paid for.
--
-- Idempotent by construction. The insert is guarded by the unique index on
-- (provider, provider_ref), and if it does nothing then this delivery has been
-- seen before and the membership must not be extended a second time. With
-- sixteen retries in play that is the normal case, not the exotic one.
CREATE OR REPLACE FUNCTION record_payment(
  p_provider text, p_ref text, p_user uuid, p_plan text,
  p_amount bigint, p_currency text, p_status text, p_raw text,
  p_origin_ref text DEFAULT NULL, p_brand text DEFAULT NULL, p_last4 text DEFAULT NULL
) RETURNS json LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = public AS $fn$
DECLARE
  v_now  bigint := floor(extract(epoch FROM now()))::bigint;
  v_days integer;
  v_new  bigint;
  v_rows integer;
BEGIN
  INSERT INTO payment (provider, provider_ref, user_id, plan_id, amount_minor, currency, status, raw_json, created_at)
  VALUES (p_provider, p_ref, p_user, p_plan, p_amount, p_currency, p_status, p_raw, v_now)
  ON CONFLICT (provider, provider_ref) DO NOTHING;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RETURN json_build_object('applied', false, 'reason', 'already recorded');
  END IF;

  SELECT days INTO v_days FROM plan WHERE id = p_plan;
  IF v_days IS NULL THEN
    RETURN json_build_object('applied', false, 'reason', 'unknown plan');
  END IF;

  -- Renewing early adds to whatever is left rather than discarding it, which is
  -- the difference between a renewal and a punishment for being early.
  INSERT INTO membership (user_id, plan_id, expires_at, created_at, updated_at, card_brand, card_last4)
  VALUES (p_user, p_plan, v_now + v_days * 86400, v_now, v_now, p_brand, p_last4)
  ON CONFLICT (user_id) DO UPDATE SET
    plan_id      = excluded.plan_id,
    expires_at   = greatest(membership.expires_at, v_now) + v_days * 86400,
    cancelled_at = NULL,
    dunning_from = NULL,
    attempts     = 0,
    card_brand   = coalesce(excluded.card_brand, membership.card_brand),
    card_last4   = coalesce(excluded.card_last4, membership.card_last4),
    updated_at   = v_now
  RETURNING expires_at INTO v_new;

  -- The credential reference, captured at the first payment because it is the
  -- only moment it exists. Nothing charges it until the renewal job does.
  IF p_origin_ref IS NOT NULL THEN
    INSERT INTO payment_method (user_id, provider, vault_token, origin_ref, brand, last4, consent_at, consent_terms, created_at, updated_at)
    VALUES (p_user, p_provider, '', p_origin_ref, p_brand, p_last4, v_now, 'v1', v_now, v_now)
    ON CONFLICT (user_id) DO UPDATE SET
      origin_ref = excluded.origin_ref,
      brand      = coalesce(excluded.brand, payment_method.brand),
      last4      = coalesce(excluded.last4, payment_method.last4),
      updated_at = v_now;
  END IF;

  RETURN json_build_object('applied', true, 'expires_at', v_new);
END;
$fn$;

-- Grant or extend an entitlement by email. Called by the Whop webhook route
-- as the service role; idempotent on (source, source_ref) through `payment`.
-- The signature grew a manage-page argument; drop the old one so the two
-- cannot both exist as overloads.
DROP FUNCTION IF EXISTS record_entitlement(text, text, text, text, bigint, bigint, text, text);
DROP FUNCTION IF EXISTS record_entitlement(text, text, text, text, bigint, bigint, text, text, text);
CREATE OR REPLACE FUNCTION record_entitlement(
  p_source text, p_ref text, p_email text, p_plan text, p_expires bigint,
  p_amount bigint, p_currency text, p_raw text, p_manage_url text DEFAULT NULL,
  p_user uuid DEFAULT NULL
) RETURNS json LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = public AS $fn$
DECLARE
  v_now   bigint := floor(extract(epoch FROM now()))::bigint;
  v_days  integer;
  v_until bigint;
  v_rows  integer;
  v_user  uuid;
BEGIN
  IF p_email IS NULL OR p_email = '' THEN
    RETURN json_build_object('applied', false, 'reason', 'no email');
  END IF;
  SELECT days INTO v_days FROM plan WHERE id = p_plan;
  IF v_days IS NULL THEN
    RETURN json_build_object('applied', false, 'reason', 'unknown plan');
  END IF;

  -- A retried delivery is a no-op whether or not the buyer has an account
  -- here yet: the reference is remembered on the entitlement itself. Whop
  -- retries a webhook it has not had a 200 for, and each retry must not be
  -- another month.
  IF p_ref IS NOT NULL AND (
    EXISTS (SELECT 1 FROM entitlement_grant WHERE ref = p_ref)
    OR EXISTS (SELECT 1 FROM entitlement WHERE lower(email) = lower(p_email) AND source_ref = p_ref)
  ) THEN
    RETURN json_build_object('applied', false, 'reason', 'already recorded');
  END IF;

  -- The receipt, for the account page, when there is an account to hang it on
  -- and money changed hands: a membership event carries no amount, and it is
  -- the same purchase as its payment, so it is not a second receipt.
  -- The account comes from the caller, who knows it (the checkout put it in
  -- Whop's metadata). Not looked up in auth.users: the service role that runs
  -- this may not read that table, and the first real payment failed on it.
  v_user := p_user;
  IF p_ref IS NOT NULL AND v_user IS NOT NULL AND p_amount IS NOT NULL THEN
    INSERT INTO payment (provider, provider_ref, user_id, plan_id, amount_minor, currency, status, raw_json, created_at)
    VALUES (p_source, p_ref, v_user, p_plan, coalesce(p_amount, 0), coalesce(p_currency, 'GBP'), 'succeeded', p_raw, v_now)
    ON CONFLICT (provider, provider_ref) DO NOTHING;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows = 0 THEN
      RETURN json_build_object('applied', false, 'reason', 'already recorded');
    END IF;
  END IF;

  -- The processor's own period end when it sent one; otherwise the plan's
  -- length from now, or from the current expiry if that is later.
  v_until := coalesce(p_expires, greatest(v_now, coalesce((SELECT expires_at FROM entitlement WHERE lower(email) = lower(p_email)), v_now)) + v_days * 86400);
  INSERT INTO entitlement (email, plan_id, expires_at, source, source_ref, status, created_at, updated_at, manage_url)
  VALUES (lower(p_email), p_plan, v_until, p_source, p_ref, 'active', v_now, v_now, p_manage_url)
  -- Two grants at once (a matchday pass, then an upgrade to monthly): the one
  -- that runs longest names the plan and where it is managed. A live row that
  -- was ended early (a refund) is replaced outright.
  ON CONFLICT (email) DO UPDATE SET
    plan_id    = CASE WHEN entitlement.status <> 'active' OR excluded.expires_at >= entitlement.expires_at
                      THEN excluded.plan_id ELSE entitlement.plan_id END,
    source     = CASE WHEN entitlement.status <> 'active' OR excluded.expires_at >= entitlement.expires_at
                      THEN excluded.source ELSE entitlement.source END,
    manage_url = CASE WHEN entitlement.status <> 'active' OR excluded.expires_at >= entitlement.expires_at
                      THEN coalesce(excluded.manage_url, entitlement.manage_url) ELSE entitlement.manage_url END,
    expires_at = CASE WHEN entitlement.status <> 'active' THEN excluded.expires_at
                      ELSE greatest(entitlement.expires_at, excluded.expires_at) END,
    source_ref = coalesce(excluded.source_ref, entitlement.source_ref),
    -- A later period means it renewed, so it is renewing again.
    renew_stopped_at = CASE WHEN excluded.expires_at > entitlement.expires_at THEN NULL ELSE entitlement.renew_stopped_at END,
    status = 'active', updated_at = v_now;
  IF p_ref IS NOT NULL THEN
    INSERT INTO entitlement_grant (ref, email, plan_id, created_at)
    VALUES (p_ref, lower(p_email), p_plan, v_now) ON CONFLICT (ref) DO NOTHING;
  END IF;
  RETURN json_build_object('applied', true, 'expires_at', v_until);
END;
$fn$;

-- The reader stopped their Whop membership renewing from our account page;
-- the Worker has already told Whop. Service role only.
CREATE OR REPLACE FUNCTION stop_entitlement_renewal(p_email text)
RETURNS json LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path = public AS $fn$
  UPDATE entitlement SET renew_stopped_at = floor(extract(epoch FROM now()))::bigint,
                         updated_at = floor(extract(epoch FROM now()))::bigint
   WHERE lower(email) = lower(p_email) AND status = 'active' AND renew_stopped_at IS NULL;
  SELECT json_build_object('ok', true);
$fn$;
REVOKE ALL ON FUNCTION stop_entitlement_renewal(text) FROM PUBLIC, anon, authenticated;

-- End an entitlement: the processor says the membership is no longer valid.
CREATE OR REPLACE FUNCTION revoke_entitlement(p_email text, p_status text)
RETURNS json LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = public AS $fn$
DECLARE v_now bigint := floor(extract(epoch FROM now()))::bigint; v_rows integer;
BEGIN
  UPDATE entitlement SET status = coalesce(p_status, 'ended'), expires_at = least(expires_at, v_now), updated_at = v_now
  WHERE lower(email) = lower(p_email);
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN json_build_object('applied', v_rows > 0);
END;
$fn$;

-- End a membership that was charged back or refunded.
--
-- Without this the product is free to anyone willing to dispute nine pounds.
-- Access stops immediately rather than at the end of the period: the money has
-- gone back, so the thing it bought goes with it.
CREATE OR REPLACE FUNCTION revoke_membership(p_provider text, p_ref text, p_status text)
RETURNS json LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = public AS $fn$
DECLARE
  v_now  bigint := floor(extract(epoch FROM now()))::bigint;
  v_user uuid;
BEGIN
  UPDATE payment SET status = p_status
  WHERE provider = p_provider AND provider_ref = p_ref
  RETURNING user_id INTO v_user;

  IF v_user IS NULL THEN
    RETURN json_build_object('revoked', false, 'reason', 'no such payment');
  END IF;

  UPDATE membership
  SET expires_at = least(expires_at, v_now), auto_renew = 0, cancelled_at = v_now, updated_at = v_now
  WHERE user_id = v_user;

  RETURN json_build_object('revoked', true);
END;
$fn$;

-- Everything the account page shows, in one call.
--
-- Reads `membership` under its own policy and `payment_receipt`, which filters
-- to the caller inside the view. An anonymous caller gets nulls and an empty
-- list rather than an error -- the page redirects to sign-in on its own.
CREATE OR REPLACE FUNCTION get_account()
RETURNS json LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  WITH live AS (
    SELECT plan_id, expires_at, auto_renew, cancelled_at, card_brand, card_last4, 'card'::text AS via, NULL::text AS manage_url
      FROM membership WHERE user_id = auth.uid() AND expires_at > floor(extract(epoch FROM now()))::bigint
    UNION ALL
    SELECT plan_id, expires_at,
           CASE WHEN renew_stopped_at IS NULL AND plan_id <> 'matchday' THEN 1 ELSE 0 END AS auto_renew,
           renew_stopped_at AS cancelled_at, source AS card_brand, NULL::text AS card_last4, source AS via, manage_url
      FROM entitlement
     WHERE auth.email() IS NOT NULL AND lower(email) = lower(auth.email()) AND status = 'active'
       AND expires_at > floor(extract(epoch FROM now()))::bigint
  )
  SELECT json_build_object(
           'email', auth.email(),
           -- Whichever live membership runs longest (a complimentary grant and a
           -- Whop subscription can both be live); else the lapsed card one, so
           -- the page can say when it ended.
           'membership', coalesce(
             (SELECT to_json(l) FROM (SELECT * FROM live ORDER BY expires_at DESC LIMIT 1) l),
             (SELECT to_json(m) FROM (
                SELECT plan_id, expires_at, auto_renew, cancelled_at, card_brand, card_last4, 'card' AS via
                FROM membership WHERE user_id = auth.uid()
              ) m)
           ),
           -- A Whop subscription that will take money again, whichever
           -- membership is shown: the page must always offer to stop it.
           -- Has this account, or a deleted one with the same email, ever
           -- had a membership. Free trials are for new members, and checkout
           -- refuses one otherwise (hadMembership in worker/src/pay.ts asks
           -- the same four things), so the site does not offer it.
           'returning', auth.uid() IS NOT NULL AND (
             EXISTS (SELECT 1 FROM membership WHERE user_id = auth.uid())
             OR EXISTS (SELECT 1 FROM payment WHERE user_id = auth.uid())
             OR (auth.email() IS NOT NULL AND EXISTS (SELECT 1 FROM entitlement WHERE email = lower(auth.email())))
             OR (auth.email() IS NOT NULL AND EXISTS (SELECT 1 FROM former_member
                   WHERE email_sha256 = encode(sha256(convert_to(lower(btrim(auth.email())), 'UTF8')), 'hex')))),
           'whop', (SELECT json_build_object('renewing', true, 'manage_url', manage_url, 'until', expires_at)
                      FROM entitlement
                     WHERE auth.email() IS NOT NULL AND lower(email) = lower(auth.email()) AND status = 'active'
                       AND source = 'whop' AND plan_id <> 'matchday' AND renew_stopped_at IS NULL
                       AND expires_at > floor(extract(epoch FROM now()))::bigint
                     LIMIT 1),
           'receipts', coalesce((
             SELECT json_agg(r) FROM (
               SELECT created_at, plan_id, amount_minor, currency, status
               FROM payment_receipt LIMIT 24
             ) r
           ), '[]'::json),
           'profile', (SELECT json_build_object('display_name', display_name, 'odds_format', odds_format,
                                                'avatar_style', avatar_style, 'avatar_color', avatar_color,
                                                'club_id', club_id, 'club_name', club_name, 'clock', clock,
                                                'username', username, 'call_alerts', call_alerts)
                       FROM profile WHERE user_id = auth.uid()),
           'follows', coalesce((
             SELECT json_agg(json_build_object('kind', kind, 'id', ref_id, 'label', label) ORDER BY created_at)
             FROM follow WHERE user_id = auth.uid()
           ), '[]'::json)
         );
$fn$;

-- The account's own settings. SECURITY DEFINER because the tables grant the
-- caller nothing; every statement is pinned to auth.uid(), so a caller can
-- only ever read or write their own row, and an anonymous one is refused.
-- The signature grew; the old two-argument one is dropped so a stale caller
-- gets a clear error rather than a second function.
DROP FUNCTION IF EXISTS save_profile(text, text);
DROP FUNCTION IF EXISTS save_profile(text, text, text, text, bigint, text, text);
-- Save the account's profile. Every argument, the name included, is optional
-- and NULL means "leave it as it is", so the odds switch can save the odds
-- without knowing the name: a page open since before the name was changed
-- elsewhere must not write the old one back. '' clears the name. A club of 0
-- clears the club.
CREATE OR REPLACE FUNCTION save_profile(
  p_name text, p_odds text,
  p_avatar text DEFAULT NULL, p_color text DEFAULT NULL,
  p_club_id bigint DEFAULT NULL, p_club_name text DEFAULT NULL,
  p_clock text DEFAULT NULL,
  p_username text DEFAULT NULL
)
RETURNS json LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  me uuid := auth.uid();
  -- NULL keeps the username; '' clears it.
  handle text := CASE WHEN p_username IS NULL THEN NULL ELSE lower(btrim(p_username, ' @')) END;
  now_s bigint := floor(extract(epoch FROM now()))::bigint;
  name_clean text := nullif(left(btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')), 60), '');
  club_clean text := nullif(left(btrim(regexp_replace(coalesce(p_club_name, ''), '\s+', ' ', 'g')), 80), '');
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'sign in first' USING ERRCODE = '28000'; END IF;
  IF coalesce(p_odds, 'decimal') NOT IN ('decimal', 'fractional', 'american') THEN
    RAISE EXCEPTION 'unknown odds format' USING ERRCODE = '22023';
  END IF;
  IF p_avatar IS NOT NULL AND p_avatar NOT IN ('auto', 'photo', 'initials', 'crest') THEN
    RAISE EXCEPTION 'unknown picture style' USING ERRCODE = '22023';
  END IF;
  IF p_color IS NOT NULL AND p_color !~ '^c[1-8]$' THEN
    RAISE EXCEPTION 'unknown colour' USING ERRCODE = '22023';
  END IF;
  IF p_clock IS NOT NULL AND p_clock NOT IN ('24', '12') THEN
    RAISE EXCEPTION 'unknown clock' USING ERRCODE = '22023';
  END IF;
  IF p_club_id IS NOT NULL AND p_club_id < 0 THEN
    RAISE EXCEPTION 'unknown club' USING ERRCODE = '22023';
  END IF;
  IF handle IS NOT NULL AND handle <> '' THEN
    IF handle !~ '^[a-z0-9_]{3,20}$' THEN
      RAISE EXCEPTION 'username: 3 to 20 letters, numbers or underscores' USING ERRCODE = '22023';
    END IF;
    IF handle IN ('admin', 'administrator', 'offside', 'offsidewin', 'support', 'help', 'staff', 'moderator', 'mod', 'root', 'system', 'official') THEN
      RAISE EXCEPTION 'username: that one is taken' USING ERRCODE = '23505';
    END IF;
    IF EXISTS (SELECT 1 FROM profile WHERE lower(username) = handle AND user_id <> me) THEN
      RAISE EXCEPTION 'username: that one is taken' USING ERRCODE = '23505';
    END IF;
  END IF;
  INSERT INTO profile (user_id, display_name, odds_format, avatar_style, avatar_color, club_id, club_name, clock, username, created_at, updated_at)
  VALUES (me, name_clean, coalesce(p_odds, 'decimal'), coalesce(p_avatar, 'auto'), p_color,
          nullif(p_club_id, 0), CASE WHEN coalesce(p_club_id, 0) = 0 THEN NULL ELSE club_clean END,
          coalesce(p_clock, '24'), nullif(handle, ''), now_s, now_s)
  ON CONFLICT (user_id) DO UPDATE SET
    display_name = CASE WHEN p_name IS NULL THEN profile.display_name ELSE excluded.display_name END,
    odds_format  = coalesce(p_odds, profile.odds_format),
    avatar_style = coalesce(p_avatar, profile.avatar_style),
    avatar_color = coalesce(p_color, profile.avatar_color),
    club_id      = CASE WHEN p_club_id IS NULL THEN profile.club_id ELSE nullif(p_club_id, 0) END,
    club_name    = CASE WHEN p_club_id IS NULL THEN profile.club_name WHEN p_club_id = 0 THEN NULL ELSE club_clean END,
    clock        = coalesce(p_clock, profile.clock),
    username     = CASE WHEN handle IS NULL THEN profile.username ELSE nullif(handle, '') END,
    updated_at   = excluded.updated_at;
  RETURN (SELECT json_build_object('display_name', display_name, 'odds_format', odds_format,
                                   'avatar_style', avatar_style, 'avatar_color', avatar_color,
                                   'club_id', club_id, 'club_name', club_name, 'clock', clock,
                                   'username', username)
          FROM profile WHERE user_id = me);
EXCEPTION WHEN unique_violation THEN
  -- Two people choosing the same name in the same instant: the index decides.
  RAISE EXCEPTION 'username: that one is taken' USING ERRCODE = '23505';
END;
$fn$;

-- Follow or unfollow one team or competition. Returns the whole list, so the
-- page redraws from what was stored rather than from what it hoped for.
-- Capped at a hundred: enough for anyone, and a ceiling on what one account
-- can make the table hold.
CREATE OR REPLACE FUNCTION set_follow(p_kind text, p_ref bigint, p_label text, p_on boolean)
RETURNS json LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  me uuid := auth.uid();
  now_s bigint := floor(extract(epoch FROM now()))::bigint;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'sign in first' USING ERRCODE = '28000'; END IF;
  IF p_kind NOT IN ('team', 'league') OR p_ref IS NULL THEN
    RAISE EXCEPTION 'unknown follow' USING ERRCODE = '22023';
  END IF;
  IF p_on THEN
    IF (SELECT count(*) FROM follow WHERE user_id = me) >= 100 THEN
      RAISE EXCEPTION 'follow limit reached' USING ERRCODE = '54000';
    END IF;
    INSERT INTO follow (user_id, kind, ref_id, label, created_at)
    VALUES (me, p_kind, p_ref, coalesce(nullif(left(btrim(coalesce(p_label, '')), 80), ''), p_kind || ' ' || p_ref), now_s)
    ON CONFLICT (user_id, kind, ref_id) DO UPDATE SET label = excluded.label;
  ELSE
    DELETE FROM follow WHERE user_id = me AND kind = p_kind AND ref_id = p_ref;
  END IF;
  RETURN coalesce((SELECT json_agg(json_build_object('kind', kind, 'id', ref_id, 'label', label) ORDER BY created_at)
                   FROM follow WHERE user_id = me), '[]'::json);
END;
$fn$;

-- Everything held about one account, removed, for the Worker's delete route
-- (which has already checked the caller's token and runs with the service
-- key). Payment records stay, without the processor's payload: tax law
-- requires the records, and the privacy policy says so. SECURITY INVOKER and no grant, so the public key cannot call it.
-- Deleting an account. The Worker has already stopped any Whop renewal
-- (worker/src/account.ts), so the entitlement goes with the email on it; the
-- grant ledger keeps its references (so a sweep cannot grant the same
-- period again) with the address taken off.
DROP FUNCTION IF EXISTS delete_account_data(uuid);
CREATE OR REPLACE FUNCTION delete_account_data(p_user uuid, p_email text DEFAULT NULL)
RETURNS void LANGUAGE sql VOLATILE SET search_path = public AS $fn$
  INSERT INTO former_member (email_sha256, at)
  SELECT encode(sha256(convert_to(lower(btrim(p_email)), 'UTF8')), 'hex'), floor(extract(epoch FROM now()))::bigint
   WHERE p_email IS NOT NULL AND p_email <> '' AND (
         EXISTS (SELECT 1 FROM membership WHERE user_id = p_user)
      OR EXISTS (SELECT 1 FROM payment WHERE user_id = p_user)
      OR EXISTS (SELECT 1 FROM entitlement WHERE lower(email) = lower(p_email)))
  ON CONFLICT (email_sha256) DO UPDATE SET at = excluded.at;
  DELETE FROM follow WHERE user_id = p_user;
  DELETE FROM profile WHERE user_id = p_user;
  DELETE FROM payment_method WHERE user_id = p_user;
  DELETE FROM membership WHERE user_id = p_user;
  DELETE FROM entitlement WHERE p_email IS NOT NULL AND lower(email) = lower(p_email);
  UPDATE entitlement_grant SET email = 'deleted' WHERE p_email IS NOT NULL AND lower(email) = lower(p_email);
  -- The records stay, for tax; the processor's raw payload goes, because it
  -- can carry the email address and the privacy policy promises it will not.
  UPDATE payment SET raw_json = '{"redacted": true}' WHERE user_id = p_user;
$fn$;

-- One fixture's card on the board, walled or not. Shared by get_board and
-- search_games so the two cannot disagree about what a reader may see:
-- p_member is has_membership(), decided once by the caller.
CREATE OR REPLACE FUNCTION board_card(f fixture, p_member boolean)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = public AS $fn$
  SELECT (
             -- Finished matches are not walled, for the reason set out on
             -- get_fixture below: the settled call is already published free
             -- on the results page, so hiding it here hid the evidence and
             -- sold the promise.
             (CASE WHEN p_member
                     OR (f.home_goals IS NOT NULL AND f.away_goals IS NOT NULL)
                     OR f.id = free_fixture_id()
                   THEN f.board_json
                   ELSE coalesce(f.board_free_json, f.board_json) END)::jsonb
             -- The score comes from the column, not from the card.
             --
             -- The board reaches a day back and the slate only rewrites the
             -- last six hours, so a match that finished yesterday afternoon
             -- keeps whatever card it had when it was still to be played: no
             -- score, and a status saying it had not kicked off. Overlaying
             -- the column costs nothing here and means the scoreline is
             -- whatever settlement last wrote, however old the card is.
             || CASE WHEN f.id = free_fixture_id() THEN '{"free_call": true}'::jsonb ELSE '{}'::jsonb END
           -- The two clubs' colours, for the masthead. Absent until the slate
           -- has read both crests, and the page falls back to its own wash.
           || jsonb_build_object('colors', jsonb_build_object(
                'home', (SELECT nullif(c.color, '') FROM team_color c WHERE c.team_id = f.home_team_id),
                'away', (SELECT nullif(c.color, '') FROM team_color c WHERE c.team_id = f.away_team_id)))
             -- The status and the running score come from the columns too:
             -- the card froze at kick-off saying the match had not started,
             -- and these are the only two things that can say otherwise
             -- before the final score lands.
             || jsonb_build_object('status', f.status)
             || CASE WHEN f.home_goals IS NULL AND f.live_home IS NOT NULL AND f.live_away IS NOT NULL
                     THEN jsonb_build_object('live_score', jsonb_build_array(f.live_home, f.live_away),
                                             'live_minute', f.live_minute)
                     ELSE '{}'::jsonb END
             || CASE WHEN f.home_goals IS NOT NULL AND f.away_goals IS NOT NULL
                     THEN jsonb_build_object(
                            'score', jsonb_build_array(f.home_goals, f.away_goals),
                            'status', 'finished',
                            -- A played match's call comes from the record, the
                            -- same row the results page and the fixture page
                            -- read, so the three cannot disagree about whether
                            -- a call was made or how it went.
                            'called', (
                              SELECT jsonb_build_object(
                                       'market', pk.market, 'outcome', pk.outcome, 'line', pk.line,
                                       'odds', pk.odds, 'bookmaker', pk.bookmaker, 'result', pk.result)
                              FROM pick pk
                              WHERE pk.fixture_id = f.id AND pk.kind = 'CONFIDENT'
                              ORDER BY pk.model_prob DESC LIMIT 1),
                            -- Who scored, for the row. The whole report is
                            -- on the fixture page; the board carries only
                            -- the goals.
                            'goals', report_goals(f.report_json))
                     ELSE '{}'::jsonb END
           );
$fn$;

CREATE OR REPLACE FUNCTION get_board(p_from bigint, p_to bigint, p_league bigint DEFAULT NULL)
RETURNS json LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  WITH m AS MATERIALIZED (SELECT has_membership() AS ok)
  SELECT json_build_object(
           'generated_at', floor(extract(epoch FROM now()))::bigint,
           'count', count(*),
           'member', (SELECT ok FROM m),
           'fixtures', coalesce(json_agg(b.card ORDER BY (b.kickoff / 86400) ASC, b.rank ASC, b.kickoff ASC), '[]'::json)
         )
  FROM (
    SELECT board_card(f, (SELECT ok FROM m))::json AS card,
           f.kickoff, f.rank
    FROM fixture f
    WHERE f.kickoff BETWEEN p_from AND p_to
      AND (p_league IS NULL OR f.league_id = p_league)
    ORDER BY (f.kickoff / 86400) ASC, f.rank ASC, f.kickoff ASC
    LIMIT 300
  ) b;
$fn$;

-- Text folded for matching: lower case, accents off, so "atletico" finds
-- "Atlético" and "munchen" finds "München".
CREATE OR REPLACE FUNCTION fold(p text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $fn$
  SELECT translate(lower(coalesce(p, '')),
    'áàâäãåāçćčéèêëēęíìîïīñńóòôöõøōúùûüūýÿšśžźżđłőűğışțß',
    'aaaaaaaccceeeeeeiiiiinnoooooooouuuuuyysszzzdlougistb');
$fn$;

-- Search the games we know about, for a team or a competition.
--
-- Three kinds of answer, because not every game has a call and not every game
-- has been looked at yet:
--   analysed  -- on the board: a call (walled for non-members exactly as the
--                board walls it), a deliberate no-pick, a live score or a result.
--   later     -- in a covered competition but too far off to have been
--                analysed; the page says when it will be.
--   leagues   -- competitions whose name matches, to jump to their page.
CREATE OR REPLACE FUNCTION search_games(p_q text)
RETURNS json LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  WITH q AS (
         SELECT '%' || replace(replace(replace(fold(trim(p_q)), '\', '\\'), '%', '\%'), '_', '\_') || '%' AS pat,
                length(trim(coalesce(p_q, ''))) AS n,
                floor(extract(epoch FROM now()))::bigint AS now),
       m AS MATERIALIZED (SELECT has_membership() AS ok),
       hits AS (
         SELECT f.* FROM fixture f, q
         WHERE q.n >= 2 AND q.n <= 60
           AND f.kickoff BETWEEN q.now - 3 * 86400 AND q.now + 14 * 86400
           AND (fold(f.home_team) LIKE q.pat OR fold(f.away_team) LIKE q.pat
                OR fold(f.board_json::jsonb->>'league') LIKE q.pat)
         ORDER BY f.kickoff ASC
         LIMIT 60),
       later AS (
         SELECT s.*, l.name AS league FROM schedule s LEFT JOIN league l ON l.id = s.league_id, q
         WHERE q.n >= 2 AND q.n <= 60
           AND s.kickoff > q.now AND s.kickoff <= q.now + 14 * 86400
           AND NOT EXISTS (SELECT 1 FROM fixture f WHERE f.id = s.id)
           AND (fold(s.home_team) LIKE q.pat OR fold(s.away_team) LIKE q.pat OR fold(l.name) LIKE q.pat)
         ORDER BY s.kickoff ASC
         LIMIT 60)
  SELECT json_build_object(
    'q', trim(coalesce(p_q, '')),
    'member', (SELECT ok FROM m),
    'analysed', coalesce((SELECT json_agg(board_card(h, (SELECT ok FROM m)) ORDER BY h.kickoff) FROM hits h), '[]'::json),
    'later', coalesce((SELECT json_agg(json_build_object(
                'id', x.id, 'league_id', x.league_id, 'league', x.league, 'kickoff', x.kickoff,
                'home', x.home_team, 'away', x.away_team, 'home_id', x.home_team_id, 'away_id', x.away_team_id)
              ORDER BY x.kickoff) FROM later x), '[]'::json),
    'leagues', coalesce((
      SELECT json_agg(json_build_object('id', l.id, 'name', l.name, 'country', l.country) ORDER BY l.name)
      FROM (SELECT l.* FROM league l, q
            WHERE q.n >= 2 AND fold(l.name) LIKE q.pat
              AND (EXISTS (SELECT 1 FROM schedule s WHERE s.league_id = l.id)
                   OR EXISTS (SELECT 1 FROM fixture f WHERE f.league_id = l.id AND f.kickoff > q.now - 3 * 86400))
            LIMIT 6) l), '[]'::json)
  );
$fn$;

-- One team: its games either side of today, for its own page
-- (/team/<id>/<name>, worker/src/landing.ts). The cards are the board's own,
-- built by board_card and walled exactly as the board is, so a team's page
-- shows a free reader what the board would and no more.
CREATE INDEX IF NOT EXISTS fixture_home_team ON fixture(home_team_id, kickoff);
CREATE INDEX IF NOT EXISTS fixture_away_team ON fixture(away_team_id, kickoff);
CREATE OR REPLACE FUNCTION get_team(p_id bigint)
RETURNS json LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  WITH q AS (SELECT floor(extract(epoch FROM now()))::bigint AS now),
       m AS MATERIALIZED (SELECT has_membership() AS ok),
       games AS (
         SELECT f.* FROM fixture f, q
         WHERE (f.home_team_id = p_id OR f.away_team_id = p_id)
           AND f.kickoff BETWEEN q.now - 60 * 86400 AND q.now + 21 * 86400
         ORDER BY f.kickoff DESC
         LIMIT 30),
       later AS (
         SELECT s.*, l.name AS league FROM schedule s LEFT JOIN league l ON l.id = s.league_id, q
         WHERE (s.home_team_id = p_id OR s.away_team_id = p_id)
           AND s.kickoff > q.now AND s.kickoff <= q.now + 45 * 86400
           AND NOT EXISTS (SELECT 1 FROM fixture f WHERE f.id = s.id)
         ORDER BY s.kickoff ASC
         LIMIT 10),
       named AS (
         SELECT CASE WHEN x.home_team_id = p_id THEN x.home_team ELSE x.away_team END AS name
         FROM (SELECT home_team_id, home_team, away_team, kickoff FROM games
               UNION ALL SELECT home_team_id, home_team, away_team, kickoff FROM later) x
         ORDER BY x.kickoff DESC
         LIMIT 1)
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM named) THEN NULL ELSE json_build_object(
    'id', p_id,
    'name', (SELECT name FROM named),
    'member', (SELECT ok FROM m),
    'games', coalesce((SELECT json_agg(board_card(g, (SELECT ok FROM m)) ORDER BY g.kickoff) FROM games g), '[]'::json),
    'later', coalesce((SELECT json_agg(json_build_object(
                'id', x.id, 'league_id', x.league_id, 'league', x.league, 'kickoff', x.kickoff,
                'home', x.home_team, 'away', x.away_team, 'home_id', x.home_team_id, 'away_id', x.away_team_id)
              ORDER BY x.kickoff) FROM later x), '[]'::json)
  ) END;
$fn$;

-- A match not yet analysed, as far as we know it: the teams, the kick-off
-- and the competition, from the schedule (two weeks ahead) or a competition's
-- own fixture list and results (leagueinfo.ts). The match page shows it in
-- the competition's colours -- the star ball on a Champions League night --
-- and says when the analysis opens. There is no call and no price in it.
CREATE OR REPLACE FUNCTION fixture_preview(p_id bigint)
RETURNS json LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  WITH g AS (
    SELECT * FROM (
      SELECT 1 AS src, s.id, s.league_id, s.kickoff, s.home_team AS home, s.away_team AS away,
             s.home_team_id AS home_id, s.away_team_id AS away_id, NULL::int AS hg, NULL::int AS ag
        FROM schedule s WHERE s.id = p_id
      UNION ALL
      SELECT 2, (r->>'id')::bigint, split_part(k.k, ':', 2)::bigint, (r->>'kickoff')::bigint,
             r->>'home', r->>'away',
             CASE WHEN (r->>'home_id') ~ '^[0-9]+$' THEN (r->>'home_id')::bigint END,
             CASE WHEN (r->>'away_id') ~ '^[0-9]+$' THEN (r->>'away_id')::bigint END,
             CASE WHEN (r->'score'->>0) ~ '^[0-9]+$' THEN (r->'score'->>0)::int END,
             CASE WHEN (r->'score'->>1) ~ '^[0-9]+$' THEN (r->'score'->>1)::int END
        FROM kv k, json_array_elements(coalesce(try_json(k.v)->'rows', '[]'::json)) r
       WHERE (k.k LIKE 'league:%:next' OR k.k LIKE 'league:%:last') AND r->>'id' = p_id::text
    ) x ORDER BY src LIMIT 1)
  SELECT json_build_object(
           'id', g.id, 'league_id', g.league_id, 'league', l.name, 'kickoff', g.kickoff,
           'home', g.home, 'away', g.away, 'home_id', g.home_id, 'away_id', g.away_id,
           'status', CASE WHEN g.hg IS NOT NULL AND g.ag IS NOT NULL THEN 'finished' ELSE 'notstarted' END,
           'score', CASE WHEN g.hg IS NOT NULL AND g.ag IS NOT NULL THEN json_build_array(g.hg, g.ag) END,
           'unanalysed', true, 'verdicts', '[]'::json, 'markets', '[]'::json,
           'published', '[]'::json, 'pulled', '[]'::json,
           'colors', json_build_object(
             'home', (SELECT nullif(c.color, '') FROM team_color c WHERE c.team_id = g.home_id),
             'away', (SELECT nullif(c.color, '') FROM team_color c WHERE c.team_id = g.away_id)))
  FROM g LEFT JOIN league l ON l.id = g.league_id;
$fn$;

CREATE OR REPLACE FUNCTION get_fixture(p_id bigint)
RETURNS json LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT coalesce((SELECT (
           -- A finished match is not the thing being sold, so it is not walled.
           --
           -- `get_picks` already publishes every settled call to everyone, on
           -- the grounds that the record is the only honest marketing this
           -- product has and gating it would defeat the point of publishing
           -- losses. The fixture page was walling the same call the results
           -- page was handing out, which is both inconsistent and the wrong
           -- way round: it hid the evidence and sold the promise. The free
           -- bundle is written at slate time, before kick-off, so the wall
           -- cannot make this judgement -- the serving function can.
           (CASE WHEN has_membership()
                   OR (f.home_goals IS NOT NULL AND f.away_goals IS NOT NULL)
                   OR f.id = free_fixture_id()
                 THEN f.bundle_json
                 ELSE coalesce(f.bundle_free_json, f.bundle_json) END)::jsonb
           -- Same overlay as get_board, and for the same reason. The bundle is
           -- written when the slate last touched the fixture, which for a match
           -- played yesterday was before it kicked off: it still says the game
           -- is to come and carries no score. Everything the page says about
           -- tense, about whether a price is still live, and about whether a
           -- call landed hangs off these two keys, so they come from the
           -- columns settlement writes rather than from the frozen card.
           || jsonb_build_object('status', f.status)
           || CASE WHEN f.home_goals IS NULL AND f.live_home IS NOT NULL AND f.live_away IS NOT NULL
                   THEN jsonb_build_object('live_score', jsonb_build_array(f.live_home, f.live_away),
                                           'live_minute', f.live_minute)
                   ELSE '{}'::jsonb END
           || CASE WHEN f.home_goals IS NOT NULL AND f.away_goals IS NOT NULL
                   THEN jsonb_build_object(
                          'score', jsonb_build_array(f.home_goals, f.away_goals),
                          'status', 'finished')
                   ELSE '{}'::jsonb END
           -- What happened, once it has. See report_json above.
           || CASE WHEN f.report_json IS NOT NULL
                   THEN jsonb_build_object('report', try_json(f.report_json)::jsonb)
                   ELSE '{}'::jsonb END
           || CASE WHEN f.id = free_fixture_id() THEN '{"free_call": true}'::jsonb ELSE '{}'::jsonb END
           -- The two clubs' colours, for the masthead. Absent until the slate
           -- has read both crests, and the page falls back to its own wash.
           || jsonb_build_object('colors', jsonb_build_object(
                'home', (SELECT nullif(c.color, '') FROM team_color c WHERE c.team_id = f.home_team_id),
                'away', (SELECT nullif(c.color, '') FROM team_color c WHERE c.team_id = f.away_team_id)))
           -- The ground by name, when the slate has looked it up.
           || jsonb_build_object('venue', (
                SELECT jsonb_build_object('name', v.name, 'city', nullif(v.city, ''), 'capacity', v.capacity)
                FROM venue v
                WHERE v.name <> ''
                  AND v.id = CASE WHEN (f.bundle_json::jsonb->>'venue_id') ~ '^[0-9]+$'
                                  THEN (f.bundle_json::jsonb->>'venue_id')::bigint END))
           -- The calls, from the record rather than from the write-up.
           --
           -- The write-up is a snapshot, and before the freeze at kick-off it
           -- was rewritten by every slate that passed over the match -- so for
           -- a stretch of fixtures it says "no call" while the pick table, and
           -- therefore the results page and the board, say a call was made and
           -- how it went. The pick table is the record; the page reads it.
           -- Same visibility rule as get_picks: settled calls are public, open
           -- ones need a membership.
           -- Calls taken down before kick-off, newest first. Everyone sees that
           -- one was pulled and why; what it was, and what replaced it, is for
           -- members and the free call, like the call itself.
           || jsonb_build_object('pulled', coalesce((
                SELECT jsonb_agg(jsonb_build_object('pulled_at', pc.pulled_at, 'reason', pc.reason,
                                                    'after_result', pc.after_result,
                                                    'after_home', pc.after_home, 'after_away', pc.after_away)
                         -- What it was is for members and the free call until
                         -- kick-off; after that it is history, like the results page.
                         || CASE WHEN has_membership() OR f.id = free_fixture_id()
                                   OR f.kickoff < floor(extract(epoch FROM now()))::bigint
                                 THEN jsonb_build_object('label', pc.label, 'odds', pc.odds, 'bookmaker', pc.bookmaker,
                                                         'replaced_by', pc.replaced_by)
                                 ELSE '{}'::jsonb END
                       ORDER BY pc.pulled_at DESC)
                FROM pulled_call pc WHERE pc.fixture_id = f.id AND pc.restored_at IS NULL
              ), '[]'::jsonb))
           || jsonb_build_object('published', coalesce((
                SELECT jsonb_agg(jsonb_build_object(
                         'market', pk.market, 'outcome', pk.outcome, 'line', pk.line,
                         'odds', pk.odds, 'bookmaker', pk.bookmaker,
                         'model_prob', pk.model_prob, 'narrative', pk.narrative, 'why', pk.why,
                         'result', pk.result, 'settled', pk.settled_at IS NOT NULL,
                         'postmortem', try_json(pk.postmortem_json))
                       ORDER BY pk.model_prob DESC)
                FROM pick pk
                WHERE pk.fixture_id = f.id AND pk.kind = 'CONFIDENT'
                  AND (pk.settled_at IS NOT NULL OR has_membership()
                       OR (f.home_goals IS NOT NULL AND f.away_goals IS NOT NULL)
                       OR f.id = free_fixture_id())
              ), '[]'::jsonb))
         )::json
  FROM fixture f WHERE f.id = p_id),
  -- Not analysed yet: what we know of it (fixture_preview).
  fixture_preview(p_id));
$fn$;

-- p_settled: 'true' for settled picks, 'false' for open ones, anything else for
-- both. A text flag rather than a boolean because the query string carries it
-- as text and a missing value must mean "both", not false.
CREATE OR REPLACE FUNCTION get_picks(p_limit integer DEFAULT 60, p_settled text DEFAULT NULL)
RETURNS json LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT json_build_object(
           'summary', (SELECT to_json(s) FROM pick_summary s),
           'picks', coalesce((
             SELECT json_agg(row_to_json(p) ORDER BY p.kickoff DESC)
             FROM (
               -- The fixture's kick-off, not the one saved with the call: a
               -- rescheduled match kept its old date on the results page
               -- while its own page had the new one.
               SELECT pk.id, pk.fixture_id, coalesce(f.kickoff, pk.kickoff) AS kickoff, pk.market, pk.outcome, pk.line, pk.kind,
                      pk.model_prob, pk.book_prob, pk.edge, pk.odds, pk.bookmaker, pk.kelly,
                      pk.confidence, pk.provisional, pk.narrative, pk.result, pk.pnl,
                      f.home_team, f.away_team,
                      -- The scoreline that decided the grade. Without it the
                      -- results page asks the reader to trust the mark.
                      f.home_goals, f.away_goals, f.status, f.league_id,
                      -- And the ids the crests are served by.
                      f.home_team_id, f.away_team_id,
                      -- What the result says about the call, and what the
                      -- market did between our saying it and kick-off.
                      pk.postmortem_json, pk.opening_odds, pk.closing_odds,
                      -- The members' paragraph. Settled calls are public, so
                      -- their argument is too.
                      pk.why,
                      -- Who scored and when, for the results sheet.
                      report_goals(f.report_json) AS goals
               FROM pick pk LEFT JOIN fixture f ON f.id = pk.fixture_id
               -- Settled picks stay public forever, membership or not: the
               -- results page is the only honest marketing this product has and
               -- gating it would defeat the point of publishing losses. Open
               -- picks are the thing being sold, so they need a membership.
               WHERE pk.kind = 'CONFIDENT'
                 AND (pk.settled_at IS NOT NULL OR has_membership() OR pk.fixture_id = free_fixture_id())
                 AND ((p_settled = 'true'  AND pk.settled_at IS NOT NULL)
                   OR (p_settled = 'false' AND pk.settled_at IS NULL)
                   OR (p_settled IS DISTINCT FROM 'true' AND p_settled IS DISTINCT FROM 'false'))
               ORDER BY pk.kickoff DESC
               LIMIT greatest(1, least(200, p_limit))
             ) p
           ), '[]'::json)
         );
$fn$;

CREATE OR REPLACE FUNCTION get_model()
RETURNS json LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT json_build_object(
           'calibration', coalesce((
             SELECT json_agg(row_to_json(c) ORDER BY c.market_family)
             FROM calibration c
           ), '[]'::json),
           'leagues', coalesce((
             SELECT json_agg(row_to_json(g) ORDER BY g.n_matches DESC)
             FROM (
               SELECT rm.league_id, l.name, rm.home_adv, rm.rho, rm.xi, rm.mean_goals,
                      rm.n_matches, rm.fitted_at
               FROM rating_meta rm LEFT JOIN league l ON l.id = rm.league_id
             ) g
           ), '[]'::json),
           'runs', coalesce((
             SELECT json_object_agg(k, try_json(v))
             FROM kv WHERE k LIKE '%:last_run' OR k LIKE 'ratings:%'
           ), '{}'::json),
           'backtest', (
             SELECT json_build_object('label', b.label, 'created_at', b.created_at,
                                      'report', try_json(b.report_json))
             FROM backtest b ORDER BY b.created_at DESC LIMIT 1
           )
         );
$fn$;

-- The slate runs every 30 minutes, so a board much older than that means
-- Actions is not running. That is the failure this endpoint exists to surface,
-- and the threshold belongs next to the query that decides it.
-- What the site leads with. An override set by hand wins over the daily pick,
-- so a hand-made graphic can go up for a final without a deploy.
-- The masthead, with the id of today's free call beside it. The two used to be
-- the same fixture; now the front page leads with the biggest game and hands
-- out the strongest call, and needs to know both. A day with no headline
-- still answers with the free call's id, so the page checks for fixture_id
-- rather than for null.
CREATE OR REPLACE FUNCTION get_hero()
RETURNS json LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT (
    CASE WHEN jsonb_typeof(h.hero) = 'object' THEN h.hero ELSE '{}'::jsonb END
    || jsonb_build_object('free_fixture_id', free_fixture_id())
    -- The trap of the day (engine/src/trap.ts): a favourite we'd leave alone.
    -- Free and priceless by design, so it rides along here for everyone, and
    -- only while its match is still to kick off.
    || jsonb_build_object('trap', (
         SELECT t FROM (SELECT try_json(v)::jsonb AS t FROM kv WHERE k = 'trap:today') x
          WHERE jsonb_typeof(t) = 'object'
            AND (t->>'kickoff') ~ '^[0-9]+$'
            AND (t->>'kickoff')::bigint > floor(extract(epoch FROM now()))))
  )::json
  FROM (
    SELECT coalesce(
      (SELECT try_json(v)::jsonb FROM kv WHERE k = 'hero:override'
         AND (expires_at IS NULL OR expires_at > floor(extract(epoch FROM now())))),
      (SELECT try_json(v)::jsonb FROM kv WHERE k = 'hero:today'),
      'null'::jsonb
    ) AS hero
  ) h;
$fn$;

-- The front page's record from the newest engine (engine/src/lab/record.ts):
-- the production rule replayed on the games already played, up to
-- `live_from`, after which the page takes the live engine's settled calls.
-- Every fixture in it has finished, so nothing paid is in it.
CREATE OR REPLACE FUNCTION get_record()
RETURNS json LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT coalesce((SELECT try_json(v) FROM kv WHERE k = 'record:engine'), json_build_object('rows', '[]'::json));
$fn$;

-- "When we say likely": every settled call we published, grouped by how sure
-- we were when we made it (to the nearest tenth: about seven, eight or nine
-- in ten) against how many landed. A half-win counts as landed and a half-loss
-- as missed, as on the results page; refunds and voids are left out. Only
-- settled calls, so nothing paid is in it.
CREATE OR REPLACE FUNCTION get_how_sure()
RETURNS json LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  WITH s AS (
    SELECT model_prob AS p, result IN ('WON', 'HALF_WON') AS landed, kickoff
      FROM pick
     WHERE kind = 'CONFIDENT' AND settled_at IS NOT NULL
       AND result IN ('WON', 'HALF_WON', 'LOST', 'HALF_LOST')
       AND model_prob > 0 AND model_prob <= 1)
  SELECT json_build_object(
    'n', (SELECT count(*) FROM s),
    'landed', (SELECT count(*) FILTER (WHERE landed) FROM s),
    'said', (SELECT avg(p) FROM s),
    'from', (SELECT min(kickoff) FROM s),
    'to', (SELECT max(kickoff) FROM s),
    'bands', coalesce((
      SELECT json_agg(json_build_object('tenths', b.tenths, 'n', b.n, 'landed', b.landed, 'said', b.said) ORDER BY b.tenths DESC)
        FROM (SELECT least(10, greatest(5, round(p * 10)::int)) AS tenths, count(*) AS n,
                     count(*) FILTER (WHERE landed) AS landed, avg(p) AS said
                FROM s GROUP BY 1) b), '[]'::json));
$fn$;

-- A competition's own page: the table, the top scorers, its games either side
-- of today, and how our calls in it have gone. The table and the scorers are
-- kept in kv (league:<id>:standings and :scorers) by the slate and by
-- leagueinfo.ts every three hours; the board's fixtures come through
-- get_board, so they are walled exactly as the board is; the next games and
-- latest results beyond the board are the plain fixture list (:next, :last);
-- the settled record is public, as it is everywhere.
-- Every competition we cover, for the Competitions page's "All" tab.
--
-- The page used to list only what is on the board, which during a break or
-- midweek is a fraction of the list, under a button that said "All of them".
-- Each comes with its country and when it next plays: the soonest of the
-- schedule's fixtures and the competition's own fixture list (leagueinfo.ts).
-- Its length is also the count the site quotes ("all 89 competitions").
CREATE OR REPLACE FUNCTION get_leagues()
RETURNS json LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  WITH t AS (SELECT floor(extract(epoch FROM now()))::bigint AS now),
  l AS (
    SELECT l.id, l.name, nullif(l.country, '') AS country,
           -- A tournament named for its year ("Africa Cup of Nations 2023").
           substring(l.name FROM '\s((?:19|20)[0-9]{2})$')::int AS yr,
           least(
             (SELECT min(s.kickoff) FROM schedule s, t WHERE s.league_id = l.id AND s.kickoff > t.now),
             (SELECT min((r->>'kickoff')::bigint)
                FROM kv k, t, json_array_elements(coalesce(try_json(k.v)->'rows', '[]'::json)) r
               WHERE k.k = 'league:' || l.id || ':next' AND (r->>'kickoff') ~ '^[0-9]+$'
                 AND (r->>'kickoff')::bigint > t.now)) AS next
    FROM league l WHERE l.tracked = 1),
  -- A past edition with nothing scheduled is over, and is left off the list.
  -- One whose next edition is scheduled is called by the competition's name,
  -- not the old year's.
  shown AS (
    SELECT id, country, next,
           CASE WHEN yr IS NOT NULL AND next IS NOT NULL
                     AND yr < extract(year FROM to_timestamp(next))::int
                THEN regexp_replace(name, '\s+(19|20)[0-9]{2}$', '') ELSE name END AS name
    FROM l
    WHERE NOT (yr IS NOT NULL AND next IS NULL AND yr < extract(year FROM now())::int))
  SELECT coalesce(json_agg(json_build_object('id', id, 'name', name, 'country', country, 'next', next)
                  ORDER BY name), '[]'::json)
  FROM shown;
$fn$;

CREATE OR REPLACE FUNCTION get_league(p_id bigint)
RETURNS json LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  WITH t AS (SELECT floor(extract(epoch FROM now()))::bigint AS now)
  SELECT json_build_object(
    'league', (SELECT json_build_object('id', l.id, 'name', l.name, 'country', l.country)
               FROM league l WHERE l.id = p_id),
    'standings', coalesce((
      SELECT json_agg(json_build_object(
               'team_id', (r->>'team_id')::bigint,
               'team', coalesce(tm.name, r->>'team_name'),
               'position', (r->>'position')::int, 'played', (r->>'played')::int,
               'won', (r->>'won')::int, 'drawn', (r->>'drawn')::int, 'lost', (r->>'lost')::int,
               'goals_for', (r->>'goals_for')::int, 'goals_against', (r->>'goals_against')::int,
               'goal_diff', (r->>'goal_diff')::int, 'points', (r->>'points')::int,
               'group', r->>'group')
             ORDER BY r->>'group' NULLS FIRST, (r->>'position')::int)
      FROM kv k
      CROSS JOIN LATERAL jsonb_array_elements(coalesce(try_json(k.v)::jsonb->'rows', '[]'::jsonb)) r
      LEFT JOIN team tm ON tm.id = (r->>'team_id')::bigint
      WHERE k.k = 'league:' || p_id || ':standings'
    ), '[]'::json),
    'standings_at', (SELECT (try_json(v)->>'updated_at')::bigint FROM kv WHERE k = 'league:' || p_id || ':standings'),
    'scorers', coalesce((SELECT try_json(v)->'rows' FROM kv WHERE k = 'league:' || p_id || ':scorers'), '[]'::json),
    'fixtures', coalesce((SELECT get_board(t.now - 3 * 86400, t.now + 10 * 86400, p_id)->'fixtures' FROM t), '[]'::json),
    -- The competition's next games and latest results from the provider,
    -- whether or not they are on the board (leagueinfo.ts), so the page is
    -- never empty between rounds. No calls in these: they are the fixture list.
    'next', coalesce((SELECT try_json(v)->'rows' FROM kv WHERE k = 'league:' || p_id || ':next'), '[]'::json),
    'last', coalesce((SELECT try_json(v)->'rows' FROM kv WHERE k = 'league:' || p_id || ':last'), '[]'::json),
    'record', (
      SELECT json_build_object('n', count(*), 'wins', count(*) FILTER (WHERE pk.result IN ('WON', 'HALF_WON')))
      FROM pick pk JOIN fixture f ON f.id = pk.fixture_id
      WHERE f.league_id = p_id AND pk.kind = 'CONFIDENT' AND pk.settled_at IS NOT NULL
        AND pk.result IS DISTINCT FROM 'VOID'),
    'recent', coalesce((
      SELECT json_agg(row_to_json(p) ORDER BY p.kickoff DESC) FROM (
        SELECT pk.fixture_id, f.kickoff, pk.market, pk.outcome, pk.line, pk.odds, pk.bookmaker, pk.result,
               f.home_team, f.away_team, f.home_goals, f.away_goals, f.home_team_id, f.away_team_id,
               report_goals(f.report_json) AS goals
        FROM pick pk JOIN fixture f ON f.id = pk.fixture_id
        WHERE f.league_id = p_id AND pk.kind = 'CONFIDENT' AND pk.settled_at IS NOT NULL
        ORDER BY f.kickoff DESC LIMIT 24
      ) p), '[]'::json)
  );
$fn$;

-- A player's page. Built from what we already hold rather than a feed of its
-- own: where they stand in each competition's top scorers (kv
-- league:<id>:scorers), how they played in the matches we have reports for
-- (fixture.report_json, finished matches only, so nothing here is walled),
-- and the next games of the team they last played for. p_league says which
-- competition the reader came from, so its scorers list leads.
CREATE OR REPLACE FUNCTION get_player(p_id bigint, p_league bigint DEFAULT NULL)
RETURNS json LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  WITH t AS (SELECT floor(extract(epoch FROM now()))::bigint AS now),
  scorer AS (
    -- Rank shared between level scorers: one goal in a chart where fourteen
    -- players have one is joint second, not fifteenth.
    SELECT substring(k.k FROM '^league:(\d+):scorers$')::bigint AS league_id,
           1 + (SELECT count(*) FROM jsonb_array_elements(coalesce(try_json(k.v)::jsonb->'rows', '[]'::jsonb)) o
                WHERE coalesce((o->>'goals')::int, 0) > coalesce((e.v->>'goals')::int, 0)) AS rank,
           e.v AS row
    FROM kv k
    CROSS JOIN LATERAL jsonb_array_elements(coalesce(try_json(k.v)::jsonb->'rows', '[]'::jsonb)) WITH ORDINALITY e(v, ord)
    WHERE k.k LIKE 'league:%:scorers' AND (e.v->>'player_id')::bigint = p_id
  ),
  app AS (
    SELECT f.id AS fixture_id, f.kickoff, f.league_id, l.name AS league,
           f.home_team, f.away_team, f.home_team_id, f.away_team_id, f.home_goals, f.away_goals,
           pl.v AS line,
           (SELECT sh FROM jsonb_array_elements(
                     coalesce(x.r->'lineups'->'home'->'players', '[]'::jsonb)
                     || coalesce(x.r->'lineups'->'away'->'players', '[]'::jsonb)) sh
             WHERE (sh->>'id')::bigint = p_id LIMIT 1) AS sheet
    FROM fixture f
    LEFT JOIN league l ON l.id = f.league_id
    CROSS JOIN LATERAL (SELECT try_json(f.report_json)::jsonb AS r) x
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(x.r->'players') = 'array' THEN x.r->'players' ELSE '[]'::jsonb END) pl(v)
    WHERE f.report_json IS NOT NULL AND f.home_goals IS NOT NULL
      AND f.kickoff > (SELECT now FROM t) - 240 * 86400
      AND (pl.v->>'id')::bigint = p_id
  ),
  their AS (
    SELECT coalesce(
      (SELECT (line->>'team_id')::bigint FROM app WHERE line->>'team_id' IS NOT NULL ORDER BY kickoff DESC LIMIT 1),
      (SELECT (row->>'team_id')::bigint FROM scorer WHERE row->>'team_id' IS NOT NULL LIMIT 1)) AS id
  ),
  lead AS (
    SELECT coalesce(p_league, (SELECT league_id FROM scorer ORDER BY rank LIMIT 1),
                    (SELECT league_id FROM app ORDER BY kickoff DESC LIMIT 1)) AS id
  )
  SELECT json_build_object(
    'id', p_id,
    'name', coalesce((SELECT sheet->>'name' FROM app WHERE sheet IS NOT NULL ORDER BY kickoff DESC LIMIT 1),
                     (SELECT row->>'name' FROM scorer LIMIT 1)),
    'position', (SELECT sheet->>'position' FROM app WHERE sheet IS NOT NULL ORDER BY kickoff DESC LIMIT 1),
    'number', (SELECT (sheet->>'number')::int FROM app WHERE sheet IS NOT NULL ORDER BY kickoff DESC LIMIT 1),
    'team', (SELECT json_build_object('id', tm.id, 'name', coalesce(
                (SELECT CASE WHEN a.home_team_id = tm.id THEN a.home_team ELSE a.away_team END
                 FROM app a WHERE tm.id IN (a.home_team_id, a.away_team_id) ORDER BY a.kickoff DESC LIMIT 1),
                (SELECT row->>'team_name' FROM scorer WHERE row->>'team_name' IS NOT NULL LIMIT 1),
                (SELECT name FROM team WHERE id = tm.id)))
             FROM their tm WHERE tm.id IS NOT NULL),
    'competitions', coalesce((
      SELECT json_agg(json_build_object(
               'league_id', sc.league_id, 'league', l.name, 'rank', sc.rank,
               'goals', (sc.row->>'goals')::int, 'assists', (sc.row->>'assists')::int)
             ORDER BY sc.league_id = (SELECT id FROM lead) DESC, (sc.row->>'goals')::int DESC)
      FROM scorer sc LEFT JOIN league l ON l.id = sc.league_id), '[]'::json),
    'lead_league', (SELECT json_build_object('id', l.id, 'name', l.name) FROM league l WHERE l.id = (SELECT id FROM lead)),
    'lead_scorers', coalesce((
      SELECT try_json(v)->'rows' FROM kv WHERE k = 'league:' || (SELECT id FROM lead) || ':scorers'), '[]'::json),
    'matches', coalesce((
      SELECT json_agg(json_build_object(
               'fixture_id', a.fixture_id, 'kickoff', a.kickoff, 'league', a.league, 'league_id', a.league_id,
               'home', a.home_team, 'away', a.away_team, 'home_id', a.home_team_id, 'away_id', a.away_team_id,
               'score', json_build_array(a.home_goals, a.away_goals),
               'minutes', (a.line->>'minutes')::int, 'rating', (a.line->>'rating')::numeric,
               'goals', (a.line->>'goals')::int, 'assists', (a.line->>'assists')::int,
               'yellow', (a.line->>'yellow')::int, 'red', (a.line->>'red')::int,
               'started', coalesce((a.sheet->>'starting')::boolean, true))
             ORDER BY a.kickoff DESC)
      FROM (SELECT * FROM app ORDER BY kickoff DESC LIMIT 12) a), '[]'::json),
    'next', coalesce((
      SELECT json_agg(json_build_object('fixture_id', f.id, 'kickoff', f.kickoff, 'home', f.home_team, 'away', f.away_team,
                                        'home_id', f.home_team_id, 'away_id', f.away_team_id, 'league', l.name)
             ORDER BY f.kickoff)
      FROM (SELECT * FROM fixture f2
            WHERE (SELECT id FROM their) IN (f2.home_team_id, f2.away_team_id) AND f2.kickoff > (SELECT now FROM t)
            ORDER BY f2.kickoff LIMIT 3) f
      LEFT JOIN league l ON l.id = f.league_id), '[]'::json)
  );
$fn$;

CREATE OR REPLACE FUNCTION get_health()
RETURNS json LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  WITH s AS (
    SELECT count(*) AS fixtures,
           count(*) FILTER (WHERE board_free_json IS NULL) AS without_free_copy,
           round((extract(epoch FROM now()) - max(computed_at)) / 60)::bigint AS age_minutes
    FROM fixture
  )
  SELECT json_build_object(
           'ok', true,
           'fixtures', s.fixtures,
           'last_computed_minutes_ago', s.age_minutes,
           'stale', s.age_minutes IS NULL OR s.age_minutes > 120,
           -- Non-zero means those fixtures are still serving the full copy to
           -- everyone, because the slate has not rewritten them yet. Expected
           -- briefly after a deploy and a bug if it does not fall to zero.
           'unwalled', s.without_free_copy
         )
  FROM s;
$fn$;

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

ALTER TABLE team_shot ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS team_shot_read ON team_shot;
CREATE POLICY team_shot_read ON team_shot FOR SELECT TO anon USING (true);
GRANT SELECT ON team_shot TO anon;

ALTER TABLE schedule ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS schedule_read ON schedule;
CREATE POLICY schedule_read ON schedule FOR SELECT TO anon USING (true);
GRANT SELECT ON schedule TO anon;
ALTER TABLE venue ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS venue_read ON venue;
CREATE POLICY venue_read ON venue FOR SELECT TO anon USING (true);
GRANT SELECT ON venue TO anon;
ALTER TABLE team_color ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS team_color_read ON team_color;
CREATE POLICY team_color_read ON team_color FOR SELECT TO anon USING (true);
GRANT SELECT ON team_color TO anon;

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
-- No direct reads. See "The paid tables are read through the functions" below.
REVOKE ALL ON fixture FROM anon, authenticated;

ALTER TABLE pick ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pick_read ON pick;
-- No direct reads. See "The paid tables are read through the functions" below.
REVOKE ALL ON pick FROM anon, authenticated;

ALTER TABLE slip ENABLE ROW LEVEL SECURITY;
-- Same rule as pick: the legs of an open slip are the paid product.
REVOKE ALL ON slip FROM anon, authenticated;

ALTER TABLE entitlement ENABLE ROW LEVEL SECURITY;
-- Who has paid is nobody's business but theirs; read through get_account.
REVOKE ALL ON entitlement FROM anon, authenticated;

ALTER TABLE market_snapshot ENABLE ROW LEVEL SECURITY;
-- The lab's history: service role only.
REVOKE ALL ON market_snapshot FROM anon, authenticated;

ALTER TABLE purchase_consent ENABLE ROW LEVEL SECURITY;
-- Service role only, like the grant ledger: nobody reads another's consent,
-- and nobody may write one for themselves without paying through the Worker.
REVOKE ALL ON purchase_consent FROM anon, authenticated;

ALTER TABLE entitlement_grant ENABLE ROW LEVEL SECURITY;
-- A ledger for the service role only, which Supabase's default privileges
-- already give it, exactly as for entitlement.
REVOKE ALL ON entitlement_grant FROM anon, authenticated;

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
-- No direct reads. See "The paid tables are read through the functions" below.
REVOKE ALL ON kv FROM anon, authenticated;

-- The membership tables. Same four-line shape as everything above, but the
-- USING clause is a predicate rather than `true`, and that is the whole
-- mechanism: PostgREST runs as `anon` for a visitor and as the signed-in user
-- when the Worker forwards their JWT instead of the anon key. auth.uid() is
-- NULL in the first case, so `user_id = auth.uid()` is never true and not one
-- row comes back. No second role, no service key on the read path.

-- The price list is the exception and is genuinely public: the pricing page
-- reads it, and the checkout route reads it server-side so the amount charged
-- can never come from the client.
ALTER TABLE plan ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS plan_read ON plan;
CREATE POLICY plan_read ON plan FOR SELECT TO anon USING (active = 1);
GRANT SELECT ON plan TO anon;

ALTER TABLE membership ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS membership_read ON membership;
CREATE POLICY membership_read ON membership FOR SELECT TO anon USING (user_id = auth.uid());
GRANT SELECT ON membership TO anon;

-- The one write a reader is allowed to make: turning their own renewal on or
-- off. Two separate mechanisms have to agree before it happens, and it is worth
-- being precise about which does what, because the obvious alternative -- a
-- service key in the Worker plus JWT verification to decide whose row to touch
-- -- is more code, more CPU and a far larger blast radius for the same result.
--
--   The policy picks the row. USING stops the update reaching anyone else's
--   membership; WITH CHECK stops it being reassigned to someone else on the way
--   out.
--
--   The grant picks the columns. Naming them is the whole point: `expires_at`
--   is absent, so a member can stop their renewal and cannot extend their own
--   access by a single second.
--
-- Verified against a live Postgres rather than reasoned about: a member flips
-- their own flag, is refused on expires_at, updates zero rows when aiming at
-- somebody else's, and cannot insert or delete at all.
DROP POLICY IF EXISTS membership_self_update ON membership;
CREATE POLICY membership_self_update ON membership FOR UPDATE TO anon
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
GRANT UPDATE (auto_renew, cancelled_at, updated_at) ON membership TO anon;

-- These two are private and get no grant of any kind. RLS is still enabled so
-- that a grant added later in a hurry cannot quietly open them, and
-- engine/test/schema.test.ts asserts the absence rather than trusting it.
ALTER TABLE payment_method ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment ENABLE ROW LEVEL SECURITY;

-- Private as well: read through get_account(), written through save_profile()
-- and set_follow(), each pinned to the caller. Supabase grants new tables to
-- the public roles by default, so that is revoked explicitly.
ALTER TABLE profile ENABLE ROW LEVEL SECURITY;
ALTER TABLE follow ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON profile FROM anon, authenticated;
REVOKE ALL ON follow FROM anon, authenticated;

-- The safe projection of `payment`, filtered to the caller inside the view.
GRANT SELECT ON payment_receipt TO anon;

-- No table here grants a write to anyone. The webhook writes with credentials
-- that bypass RLS entirely and the renewal job writes over the pooler, so
-- nothing that reaches these tables came through the public key.

GRANT SELECT ON pick_summary TO anon;
-- Not granted to anon. The by-kind split carries closing-line value and the
-- record of calls we do not publish -- both are how we judge the model, not
-- how we present it, and the anon key is public by design. The engine reads
-- it over the pooler with real credentials.
REVOKE ALL ON pick_summary_by_kind FROM anon;

-- The serving functions are the Worker's whole read path. EXECUTE only: they
-- are SECURITY INVOKER, so each one still reads under the anon SELECT policies
-- above and can reach nothing a direct select could not.
-- What is for sale. The pricing page prints these rather than hardcoding a
-- price, so a change is an UPDATE. The checkout link travels with each plan.
CREATE OR REPLACE FUNCTION get_plans()
RETURNS json LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT coalesce(json_agg(json_build_object(
           'id', id, 'name', name, 'days', days, 'amount_minor', amount_minor,
           'currency', currency, 'checkout_url', checkout_url) ORDER BY sort), '[]'::json)
  FROM plan WHERE active = 1;
$fn$;

-- The current slip and the slip record.
--
-- An open slip's legs need a membership; its size, total odds and chance do
-- not, because those are the offer. A settled slip is public in full, like a
-- settled call.
-- Each leg of a slip, as its match stands now: status, score (or the running
-- score) and the record's grade for that call. The slip page used to borrow
-- these from the board, which reaches back a day, so a slip whose first leg
-- was two days ago showed its played matches with nothing against them.
-- Runs as the caller: inside get_slip that is the owner, and called directly
-- by the public key it can read neither table and returns nothing.
CREATE OR REPLACE FUNCTION slip_legs(p_legs text)
RETURNS json LANGUAGE sql STABLE SET search_path = public AS $fn$
  SELECT coalesce(json_agg(
           l.leg || jsonb_build_object(
             'status', f.status,
             'score', CASE WHEN f.home_goals IS NOT NULL AND f.away_goals IS NOT NULL
                           THEN jsonb_build_array(f.home_goals, f.away_goals) END,
             'live_score', CASE WHEN f.home_goals IS NULL AND f.live_home IS NOT NULL AND f.live_away IS NOT NULL
                                THEN jsonb_build_array(f.live_home, f.live_away) END,
             'live_minute', f.live_minute,
             'result', (SELECT pk.result FROM pick pk
                        WHERE pk.fixture_id = f.id AND pk.kind = 'CONFIDENT' AND pk.settled_at IS NOT NULL
                          AND pk.market = l.leg->>'market' AND pk.outcome = l.leg->>'outcome'
                          AND pk.line IS NOT DISTINCT FROM (l.leg->>'line')::double precision
                        LIMIT 1),
             -- The call was taken down before its match: the slip settles this
             -- leg as void (settleSlips), so the page must not grade it.
             'withdrawn', NOT EXISTS (SELECT 1 FROM pick pk
                        WHERE pk.fixture_id = (l.leg->>'fixture_id')::bigint AND pk.kind = 'CONFIDENT'
                          AND pk.market = l.leg->>'market' AND pk.outcome = l.leg->>'outcome'
                          AND pk.line IS NOT DISTINCT FROM (l.leg->>'line')::double precision))
           ORDER BY l.ord), '[]'::json)
  FROM jsonb_array_elements(coalesce(try_json(p_legs)::jsonb, '[]'::jsonb)) WITH ORDINALITY AS l(leg, ord)
  LEFT JOIN fixture f ON f.id = (l.leg->>'fixture_id')::bigint;
$fn$;

CREATE OR REPLACE FUNCTION get_slip()
RETURNS json LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  WITH m AS MATERIALIZED (SELECT has_membership() AS ok)
  SELECT json_build_object(
    'member', (SELECT ok FROM m),
    'current', (
      SELECT json_build_object(
               'id', s.id, 'odds', s.odds, 'chance', s.chance,
               'first_kickoff', s.first_kickoff,
               'legs_count', json_array_length(s.legs_json::json),
               'legs', CASE WHEN (SELECT ok FROM m) THEN slip_legs(s.legs_json) ELSE NULL END)
      FROM slip s WHERE s.settled_at IS NULL
      ORDER BY s.created_at DESC LIMIT 1),
    'recent', coalesce((
      SELECT json_agg(r ORDER BY r.first_kickoff DESC) FROM (
        SELECT s.id, s.odds, s.chance, s.result, s.first_kickoff, slip_legs(s.legs_json) AS legs
        FROM slip s WHERE s.settled_at IS NOT NULL
        ORDER BY s.first_kickoff DESC LIMIT 10) r), '[]'::json),
    'record', (
      SELECT json_build_object('n', count(*), 'won', count(*) FILTER (WHERE result = 'WON'))
      FROM slip WHERE settled_at IS NOT NULL AND result IN ('WON', 'LOST'))
  );
$fn$;

-- The paid tables are read through the functions, never directly.
--
-- fixture, pick and kv used to carry a policy letting the public key SELECT
-- every row, on the reasoning that there was nothing secret in them. There
-- is: `pick` holds every open call, `fixture.bundle_json` the full write-up
-- with the call in it, and `kv` the cached members' paragraphs. The public key
-- ships to every browser and /api/config hands out the project URL, so anyone
-- could skip the site and read all thirty-two open calls from
-- /rest/v1/pick with it -- confirmed against production before this change.
--
-- So those tables grant nothing to either role, and the serving functions
-- below run SECURITY DEFINER: they read as the owner, apply the wall
-- (has_membership(), settled or not, finished or not) themselves, and return
-- only what the caller is entitled to. That also fixes the other half: the
-- read policies were written TO anon only, so a signed-in member (role
-- `authenticated`) calling them as invoker would have seen empty tables.
-- Every definer function pins search_path, which is what makes it safe.
GRANT EXECUTE ON FUNCTION try_json(text) TO anon;
GRANT EXECUTE ON FUNCTION report_goals(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION has_membership() TO anon;
GRANT EXECUTE ON FUNCTION get_account() TO anon;
GRANT EXECUTE ON FUNCTION save_profile(text, text, text, text, bigint, text, text, text) TO anon, authenticated;

-- The checkout's two boxes, recorded as the signed-in buyer and only for them:
-- auth.uid() names the account, so nobody can write a confirmation for
-- someone else, and the table itself stays closed to every public role.
CREATE OR REPLACE FUNCTION record_consent(p_plan text, p_terms text)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  me uuid := auth.uid();
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'sign in first' USING ERRCODE = '28000'; END IF;
  IF NOT EXISTS (SELECT 1 FROM plan WHERE id = p_plan) THEN RAISE EXCEPTION 'no such plan' USING ERRCODE = '22023'; END IF;
  IF p_terms IS NULL OR p_terms !~ '^[\w.-]{1,40}$' THEN RAISE EXCEPTION 'no terms version' USING ERRCODE = '22023'; END IF;
  INSERT INTO purchase_consent (user_id, plan_id, terms_version, adult, waived, created_at)
  VALUES (me, p_plan, p_terms, true, true, floor(extract(epoch FROM now()))::bigint);
END
$fn$;
GRANT EXECUTE ON FUNCTION record_consent(text, text) TO anon, authenticated;


GRANT EXECUTE ON FUNCTION set_follow(text, bigint, text, boolean) TO anon, authenticated;
REVOKE ALL ON FUNCTION delete_account_data(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION get_board(bigint, bigint, bigint) TO anon;
GRANT EXECUTE ON FUNCTION board_card(fixture, boolean) TO anon;
GRANT EXECUTE ON FUNCTION fold(text) TO anon;
GRANT EXECUTE ON FUNCTION search_games(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION get_team(bigint) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION get_fixture(bigint) TO anon;
GRANT EXECUTE ON FUNCTION get_picks(integer, text) TO anon;
GRANT EXECUTE ON FUNCTION get_model() TO anon;
GRANT EXECUTE ON FUNCTION get_hero() TO anon;
GRANT EXECUTE ON FUNCTION get_health() TO anon;
GRANT EXECUTE ON FUNCTION get_slip() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION slip_legs(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION get_plans() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION free_fixture_id() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION get_league(bigint) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION fixture_preview(bigint) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION get_leagues() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION get_record() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION get_how_sure() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION get_player(bigint, bigint) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION get_board(bigint, bigint, bigint), get_fixture(bigint), get_picks(integer, text),
  get_model(), get_hero(), get_health(), get_account(), has_membership(), try_json(text) TO authenticated;

-- PostgREST caches the schema and will answer 404 for a function it has not
-- seen yet. Supabase reloads on DDL via an event trigger, but that fires on its
-- own schedule and a deploy that races it serves a broken read path until the
-- next one. Asking explicitly costs nothing and removes the race.
NOTIFY pgrst, 'reload schema';


-- ------------------------------------------------------------ page views
--
-- Visits, counted, for readers who accepted analytics in the cookie notice
-- and for no one else. Deliberately the least a counter can hold: the UK day,
-- which kind of page (never which fixture, never a URL, never an IP, a
-- browser, a referrer or anything that could tell one reader from another),
-- and a number. The Worker only sends a hit when the page asks it to, and the
-- page only asks after the reader has said yes.
--
-- Private: RLS on, no policy, no grant. The one way in is record_view, which
-- can add one to a known page and do nothing else.
CREATE TABLE IF NOT EXISTS page_view (
  day   date   NOT NULL,
  page  text   NOT NULL,
  n     bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (day, page)
);
ALTER TABLE page_view ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON page_view FROM anon, authenticated;

CREATE OR REPLACE FUNCTION record_view(p_page text)
RETURNS void LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public AS $fn$
  INSERT INTO page_view (day, page, n)
  SELECT (now() AT TIME ZONE 'Europe/London')::date, p_page, 1
  WHERE p_page IN ('home', 'board', 'fixture', 'league', 'leagues', 'results', 'slip',
                   'pricing', 'signin', 'account', 'legal', 'player')
  ON CONFLICT (day, page) DO UPDATE SET n = page_view.n + 1;
$fn$;
GRANT EXECUTE ON FUNCTION record_view(text) TO anon, authenticated;

-- ------------------------------------------------------------------ admin
--
-- The owner's dashboard (#/admin). Every function here is private: no grant
-- to anon or authenticated, and the default EXECUTE that Postgres hands to
-- PUBLIC is revoked, so the public key cannot call one however it asks. The
-- Worker calls them holding the service key, and only after GoTrue has said
-- whose token it is and that account's email is the owner's
-- (worker/src/admin.ts). The acting account is passed in so every write
-- lands in admin_log beside what it did.
--
-- SECURITY DEFINER because they read auth.users and the payment tables,
-- which grant the public roles nothing.

CREATE TABLE IF NOT EXISTS admin_log (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  at          bigint NOT NULL,
  actor       uuid NOT NULL,
  action      text NOT NULL,
  target      text,
  detail_json text
);
CREATE INDEX IF NOT EXISTS admin_log_at ON admin_log (at DESC);
ALTER TABLE admin_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON admin_log FROM anon, authenticated;

-- Offers the site shows: a deal (a plan at a lower price until a deadline), a
-- free trial (days before the first charge, new members only), or a notice (a
-- line across the site). Private, because a scheduled offer is not public
-- until it starts; the live ones are served by get_promos().
CREATE TABLE IF NOT EXISTS promo (
  id          text PRIMARY KEY,
  kind        text NOT NULL CHECK (kind IN ('deal', 'trial', 'notice')),
  title       text NOT NULL,
  body        text,
  cta         text,
  plan_id     text,
  price_minor bigint CHECK (price_minor IS NULL OR price_minor > 0),
  trial_days  integer CHECK (trial_days IS NULL OR trial_days BETWEEN 1 AND 60),
  audience    text NOT NULL DEFAULT 'everyone' CHECK (audience IN ('everyone', 'signed_out', 'free')),
  starts_at   bigint NOT NULL,
  ends_at     bigint NOT NULL,
  active      integer NOT NULL DEFAULT 1,
  created_at  bigint NOT NULL,
  updated_at  bigint NOT NULL
);
ALTER TABLE promo ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON promo FROM anon, authenticated;

-- The offers running now, with the plan each one is for.
CREATE OR REPLACE FUNCTION get_promos()
RETURNS json LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT coalesce(json_agg(json_build_object(
           'id', p.id, 'kind', p.kind, 'title', p.title, 'body', p.body, 'cta', p.cta,
           'plan_id', p.plan_id, 'price_minor', p.price_minor, 'trial_days', p.trial_days,
           'audience', p.audience, 'ends_at', p.ends_at,
           'plan', CASE WHEN pl.id IS NULL THEN NULL ELSE json_build_object(
             'id', pl.id, 'name', pl.name, 'days', pl.days, 'amount_minor', pl.amount_minor, 'currency', pl.currency) END
         ) ORDER BY p.starts_at DESC), '[]'::json)
  FROM promo p LEFT JOIN plan pl ON pl.id = p.plan_id AND pl.active = 1
  WHERE p.active = 1
    AND p.starts_at <= floor(extract(epoch FROM now()))::bigint
    AND p.ends_at > floor(extract(epoch FROM now()))::bigint
    AND (p.plan_id IS NULL OR pl.id IS NOT NULL)
    -- A deal is only a deal while it is below the plan's price: lower the
    -- plan under it and checkout would refuse it, so it is not advertised.
    AND (p.kind <> 'deal' OR p.price_minor < pl.amount_minor);
$fn$;
GRANT EXECUTE ON FUNCTION get_promos() TO anon, authenticated;

-- Every account with membership now, however it came: one row an account.
CREATE OR REPLACE FUNCTION admin_live_members()
RETURNS TABLE (email text, plan_id text, expires_at bigint, free boolean, via text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  WITH t AS (SELECT floor(extract(epoch FROM now()))::bigint AS now_),
  rows_ AS (
    SELECT lower(u.email) AS email, m.plan_id, m.expires_at, coalesce(m.card_brand, '') = 'complimentary' AS free, 'membership' AS via
      FROM membership m JOIN auth.users u ON u.id = m.user_id, t WHERE m.expires_at > t.now_
    UNION ALL
    SELECT lower(e.email), e.plan_id, e.expires_at, false, e.source
      FROM entitlement e, t WHERE e.status = 'active' AND e.expires_at > t.now_
  )
  SELECT DISTINCT ON (email) email, plan_id, expires_at, free, via FROM rows_ ORDER BY email, free, expires_at DESC;
$fn$;
REVOKE ALL ON FUNCTION admin_live_members() FROM PUBLIC, anon, authenticated;

-- The front page of the dashboard: members, money, visits, calls, and
-- whether the engine and the writer are keeping up.
CREATE OR REPLACE FUNCTION admin_overview()
RETURNS json LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  WITH now_ AS (SELECT floor(extract(epoch FROM now()))::bigint AS t,
                       (now() AT TIME ZONE 'Europe/London')::date AS d)
  SELECT json_build_object(
    'at', (SELECT t FROM now_),
    'accounts', json_build_object(
      'total', (SELECT count(*) FROM auth.users),
      'day',   (SELECT count(*) FROM auth.users WHERE created_at > now() - interval '1 day'),
      'week',  (SELECT count(*) FROM auth.users WHERE created_at > now() - interval '7 days'),
      'month', (SELECT count(*) FROM auth.users WHERE created_at > now() - interval '30 days')),
    -- Members come two ways: a membership row (free time given here, and the
    -- card processor before Whop) and a Whop entitlement, keyed on the email.
    'members', (SELECT json_build_object(
        'active', count(*),
        'paying', count(*) FILTER (WHERE NOT free),
        'free', count(*) FILTER (WHERE free),
        'by_plan', (SELECT coalesce(json_object_agg(plan_id, n), '{}'::json)
                      FROM (SELECT plan_id, count(*) AS n FROM admin_live_members() GROUP BY plan_id) x))
      FROM admin_live_members()),
    'money', json_build_object(
      'currency', coalesce((SELECT currency FROM plan WHERE active = 1 ORDER BY sort LIMIT 1), 'GBP'),
      'week',  (SELECT coalesce(sum(amount_minor), 0) FROM payment, now_ WHERE status IN ('paid', 'succeeded', 'completed') AND created_at > now_.t - 7 * 86400),
      'month', (SELECT coalesce(sum(amount_minor), 0) FROM payment, now_ WHERE status IN ('paid', 'succeeded', 'completed') AND created_at > now_.t - 30 * 86400),
      'all',   (SELECT coalesce(sum(amount_minor), 0) FROM payment WHERE status IN ('paid', 'succeeded', 'completed')),
      'payments', (SELECT count(*) FROM payment WHERE status IN ('paid', 'succeeded', 'completed'))),
    'visits', json_build_object(
      'today', (SELECT coalesce(sum(n), 0) FROM page_view, now_ WHERE day = now_.d),
      'week',  (SELECT coalesce(sum(n), 0) FROM page_view, now_ WHERE day > now_.d - 7),
      'days',  (SELECT coalesce(json_agg(json_build_object('day', day, 'n', n) ORDER BY day), '[]'::json)
                  FROM (SELECT day, sum(n) AS n FROM page_view, now_ WHERE day > now_.d - 14 GROUP BY day) x),
      'pages', (SELECT coalesce(json_object_agg(page, n), '{}'::json)
                  FROM (SELECT page, sum(n) AS n FROM page_view, now_ WHERE day > now_.d - 7 GROUP BY page) x)),
    'calls', json_build_object(
      'open', (SELECT count(*) FROM pick WHERE kind = 'CONFIDENT' AND settled_at IS NULL),
      'month', (SELECT json_build_object('n', count(*),
                        'won', count(*) FILTER (WHERE result IN ('WON', 'HALF_WON')),
                        'lost', count(*) FILTER (WHERE result IN ('LOST', 'HALF_LOST')),
                        'pnl', coalesce(sum(pnl), 0))
                  FROM pick, now_ WHERE kind = 'CONFIDENT' AND settled_at IS NOT NULL AND result <> 'VOID'
                   AND kickoff > now_.t - 30 * 86400)),
    'engine', json_build_object(
      'health', get_health(),
      'slate', (SELECT try_json(v) FROM kv WHERE k = 'slate:last_run'),
      'settle', (SELECT try_json(v) FROM kv WHERE k = 'settle:last_run'),
      'writer', (SELECT try_json(v) FROM kv WHERE k = 'gemini:budget'))
  );
$fn$;
REVOKE ALL ON FUNCTION admin_overview() FROM PUBLIC, anon, authenticated;

-- Accounts, newest first, or those whose email or name matches.
CREATE OR REPLACE FUNCTION admin_users(p_q text DEFAULT NULL, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
RETURNS json LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT coalesce(json_agg(row_to_json(x)), '[]'::json) FROM (
    SELECT u.id, u.email, floor(extract(epoch FROM u.created_at))::bigint AS created_at,
           floor(extract(epoch FROM u.last_sign_in_at))::bigint AS last_sign_in_at,
           pr.display_name, pr.username,
           coalesce(lm.plan_id, m.plan_id) AS plan_id, coalesce(lm.expires_at, m.expires_at) AS expires_at,
           lm.free, lm.via, m.auto_renew,
           (SELECT coalesce(sum(amount_minor), 0) FROM payment p
             WHERE p.user_id = u.id AND p.status IN ('paid', 'succeeded', 'completed')) AS paid_minor
    FROM auth.users u
    LEFT JOIN profile pr ON pr.user_id = u.id
    LEFT JOIN membership m ON m.user_id = u.id
    LEFT JOIN admin_live_members() lm ON lm.email = lower(u.email)
    CROSS JOIN LATERAL (SELECT '%' || replace(replace(replace(coalesce(p_q, ''), '\', '\\'), '%', '\%'), '_', '\_') || '%' AS pat) q
    -- A "_" or "%" typed in the search box is a letter, not a wildcard.
    WHERE p_q IS NULL OR p_q = ''
       OR u.email ILIKE q.pat
       OR pr.display_name ILIKE q.pat
       OR pr.username ILIKE q.pat
    ORDER BY u.created_at DESC
    LIMIT least(greatest(coalesce(p_limit, 50), 1), 200) OFFSET greatest(coalesce(p_offset, 0), 0)
  ) x;
$fn$;
REVOKE ALL ON FUNCTION admin_users(text, integer, integer) FROM PUBLIC, anon, authenticated;

-- One account in full: who, the membership, every payment, what they follow.
CREATE OR REPLACE FUNCTION admin_user(p_user uuid)
RETURNS json LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT json_build_object(
    'user', (SELECT json_build_object('id', u.id, 'email', u.email,
               'created_at', floor(extract(epoch FROM u.created_at))::bigint,
               'last_sign_in_at', floor(extract(epoch FROM u.last_sign_in_at))::bigint,
               'provider', u.raw_app_meta_data->>'provider')
             FROM auth.users u WHERE u.id = p_user),
    'profile', (SELECT row_to_json(p) FROM (SELECT display_name, username, club_name, created_at FROM profile WHERE user_id = p_user) p),
    'membership', (SELECT row_to_json(m) FROM (SELECT plan_id, expires_at, auto_renew, cancelled_at, dunning_from, card_brand, card_last4, created_at
                                               FROM membership WHERE user_id = p_user) m),
    'entitlement', (SELECT row_to_json(e) FROM (SELECT e.plan_id, e.expires_at, e.status, e.source, e.manage_url, e.created_at, e.renew_stopped_at
                                                FROM entitlement e JOIN auth.users u ON lower(u.email) = lower(e.email)
                                                WHERE u.id = p_user) e),
    'payments', (SELECT coalesce(json_agg(row_to_json(p) ORDER BY p.created_at DESC), '[]'::json)
                 FROM (SELECT provider, plan_id, amount_minor, currency, status, created_at FROM payment WHERE user_id = p_user) p),
    'follows', (SELECT count(*) FROM follow WHERE user_id = p_user),
    'log', (SELECT coalesce(json_agg(row_to_json(l) ORDER BY l.at DESC), '[]'::json)
            FROM (SELECT at, action, detail_json FROM admin_log WHERE target = p_user::text ORDER BY at DESC LIMIT 20) l)
  );
$fn$;
REVOKE ALL ON FUNCTION admin_user(uuid) FROM PUBLIC, anon, authenticated;

-- Free time on an account: extends whatever it has, or starts one. Marked
-- complimentary, so the account page never shows a card for it.
--
-- The days start when the account's paid time ends, however it was paid, so
-- they are never spent running alongside time already bought. An account whose
-- Whop subscription is still renewing is refused: Whop would charge again in
-- the middle of the free time, so the days are added in Whop instead.
CREATE OR REPLACE FUNCTION admin_grant(p_actor uuid, p_user uuid, p_days integer)
RETURNS json LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  t bigint := floor(extract(epoch FROM now()))::bigint;
  plan_ text;
  until_ bigint;
  paid_to bigint;
  whop_ record;
BEGIN
  IF p_days IS NULL OR p_days < 1 OR p_days > 3650 THEN
    RETURN json_build_object('error', 'Give between 1 and 3,650 days.');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_user) THEN
    RETURN json_build_object('error', 'No such account.');
  END IF;
  SELECT e.plan_id, e.expires_at, e.renew_stopped_at INTO whop_
    FROM entitlement e JOIN auth.users u ON lower(u.email) = lower(e.email)
   WHERE u.id = p_user AND e.status = 'active' AND e.expires_at > t;
  IF whop_.expires_at IS NOT NULL AND whop_.renew_stopped_at IS NULL AND whop_.plan_id <> 'matchday' THEN
    RETURN json_build_object('error', format('This account pays through Whop, next on %s. Free days here would run alongside time they pay for. Add them to the membership in Whop instead.',
      to_char(to_timestamp(whop_.expires_at) AT TIME ZONE 'Europe/London', 'DD Mon YYYY')));
  END IF;
  paid_to := greatest(t, coalesce(whop_.expires_at, t));
  SELECT id INTO plan_ FROM plan WHERE active = 1 ORDER BY sort DESC LIMIT 1;
  INSERT INTO membership (user_id, plan_id, expires_at, created_at, updated_at, card_brand)
  VALUES (p_user, coalesce(plan_, 'monthly'), paid_to + p_days * 86400, t, t, 'complimentary')
  ON CONFLICT (user_id) DO UPDATE SET
    expires_at = greatest(membership.expires_at, paid_to) + p_days * 86400,
    cancelled_at = NULL, dunning_from = NULL, attempts = 0,
    card_brand = CASE WHEN membership.expires_at > t THEN membership.card_brand ELSE 'complimentary' END,
    updated_at = t
  RETURNING expires_at INTO until_;
  INSERT INTO admin_log (at, actor, action, target, detail_json)
  VALUES (t, p_actor, 'grant', p_user::text, json_build_object('days', p_days, 'until', until_)::text);
  RETURN json_build_object('ok', true, 'expires_at', until_);
END;
$fn$;
REVOKE ALL ON FUNCTION admin_grant(uuid, uuid, integer) FROM PUBLIC, anon, authenticated;

-- End free time now. A paid membership is not ended here: the processor
-- would go on charging for it, so that is done where it was bought. Free time
-- alongside a Whop subscription can be ended; the paid time is untouched.
CREATE OR REPLACE FUNCTION admin_end(p_actor uuid, p_user uuid)
RETURNS json LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $fn$
DECLARE t bigint := floor(extract(epoch FROM now()))::bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM membership WHERE user_id = p_user AND expires_at > t) THEN
    IF EXISTS (SELECT 1 FROM entitlement e JOIN auth.users u ON lower(u.email) = lower(e.email)
               WHERE u.id = p_user AND e.status = 'active' AND e.expires_at > t) THEN
      RETURN json_build_object('error', 'This one was paid for through Whop. Cancel it there, or it will go on charging.');
    END IF;
    RETURN json_build_object('error', 'That account has no membership running.');
  END IF;
  IF EXISTS (SELECT 1 FROM membership WHERE user_id = p_user AND coalesce(card_brand, '') <> 'complimentary') THEN
    RETURN json_build_object('error', 'This one was paid for by card. Ending it here would take time they paid for.');
  END IF;
  UPDATE membership SET expires_at = t, auto_renew = 0, updated_at = t WHERE user_id = p_user;
  INSERT INTO admin_log (at, actor, action, target, detail_json) VALUES (t, p_actor, 'end', p_user::text, NULL);
  RETURN json_build_object('ok', true);
END;
$fn$;
REVOKE ALL ON FUNCTION admin_end(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- Calls, open and recent, with how the last thirty days went.
CREATE OR REPLACE FUNCTION admin_picks()
RETURNS json LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT json_build_object(
    'open', (SELECT coalesce(json_agg(row_to_json(p) ORDER BY p.kickoff), '[]'::json) FROM (
       SELECT pk.id, pk.fixture_id, coalesce(f.kickoff, pk.kickoff) AS kickoff, pk.market, pk.outcome, pk.line,
              pk.odds, pk.bookmaker, pk.model_prob, f.home_team, f.away_team, f.league_id
       FROM pick pk LEFT JOIN fixture f ON f.id = pk.fixture_id
       WHERE pk.kind = 'CONFIDENT' AND pk.settled_at IS NULL) p),
    'recent', (SELECT coalesce(json_agg(row_to_json(p) ORDER BY p.kickoff DESC), '[]'::json) FROM (
       SELECT pk.id, pk.fixture_id, coalesce(f.kickoff, pk.kickoff) AS kickoff, pk.market, pk.outcome, pk.line,
              pk.odds, pk.bookmaker, pk.result, pk.pnl, f.home_team, f.away_team, f.home_goals, f.away_goals
       FROM pick pk LEFT JOIN fixture f ON f.id = pk.fixture_id
       WHERE pk.kind = 'CONFIDENT' AND pk.settled_at IS NOT NULL
       ORDER BY pk.settled_at DESC LIMIT 60) p),
    'days', (SELECT coalesce(json_agg(row_to_json(d) ORDER BY d.day DESC), '[]'::json) FROM (
       SELECT to_char(to_timestamp(kickoff) AT TIME ZONE 'Europe/London', 'YYYY-MM-DD') AS day,
              count(*) AS n,
              count(*) FILTER (WHERE result IN ('WON', 'HALF_WON')) AS won,
              round(coalesce(sum(pnl), 0)::numeric, 2) AS pnl
       FROM pick WHERE kind = 'CONFIDENT' AND settled_at IS NOT NULL AND result <> 'VOID'
         AND kickoff > floor(extract(epoch FROM now()))::bigint - 30 * 86400
       GROUP BY 1) d)
  );
$fn$;
REVOKE ALL ON FUNCTION admin_picks() FROM PUBLIC, anon, authenticated;

-- Every plan, on sale or not, and a change to one. The price here is the
-- price: checkout builds the processor's plan from this row.
CREATE OR REPLACE FUNCTION admin_plans()
RETURNS json LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT coalesce(json_agg(row_to_json(p) ORDER BY p.sort), '[]'::json)
  FROM (SELECT id, name, days, amount_minor, currency, active, sort, checkout_url, updated_at FROM plan) p;
$fn$;
REVOKE ALL ON FUNCTION admin_plans() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION admin_save_plan(p_actor uuid, p_id text, p_name text, p_amount bigint, p_active integer)
RETURNS json LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $fn$
DECLARE t bigint := floor(extract(epoch FROM now()))::bigint; before_ json; clash_ record;
BEGIN
  SELECT json_build_object('name', name, 'amount_minor', amount_minor, 'active', active) INTO before_ FROM plan WHERE id = p_id;
  IF before_ IS NULL THEN RETURN json_build_object('error', 'No such plan.'); END IF;
  IF p_amount IS NOT NULL AND (p_amount < 100 OR p_amount > 100000) THEN
    RETURN json_build_object('error', 'A price between £1 and £1,000.');
  END IF;
  IF p_name IS NOT NULL AND (length(trim(p_name)) = 0 OR length(p_name) > 40) THEN
    RETURN json_build_object('error', 'A name of up to 40 characters.');
  END IF;
  -- A deal that is running or to come must stay below the plan's price, or it
  -- silently stops being offered. Say which one is in the way.
  IF p_amount IS NOT NULL THEN
    SELECT title, price_minor INTO clash_ FROM promo
     WHERE plan_id = p_id AND kind = 'deal' AND active = 1 AND ends_at > t AND price_minor >= p_amount
     ORDER BY starts_at LIMIT 1;
    IF clash_.title IS NOT NULL THEN
      RETURN json_build_object('error', format('The deal "%s" sells this plan at £%s. Lower or end it first.',
        clash_.title, to_char(clash_.price_minor / 100.0, 'FM999990.00')));
    END IF;
  END IF;
  UPDATE plan SET name = coalesce(nullif(trim(p_name), ''), name),
                  amount_minor = coalesce(p_amount, amount_minor),
                  active = coalesce(p_active, active),
                  updated_at = t
   WHERE id = p_id;
  INSERT INTO admin_log (at, actor, action, target, detail_json)
  VALUES (t, p_actor, 'plan', p_id, json_build_object('before', before_, 'name', p_name, 'amount_minor', p_amount, 'active', p_active)::text);
  RETURN json_build_object('ok', true);
END;
$fn$;
REVOKE ALL ON FUNCTION admin_save_plan(uuid, text, text, bigint, integer) FROM PUBLIC, anon, authenticated;

-- Every offer, live, scheduled or over, and a change to one.
CREATE OR REPLACE FUNCTION admin_promos()
RETURNS json LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT coalesce(json_agg(row_to_json(p) ORDER BY p.starts_at DESC), '[]'::json)
  FROM (SELECT * FROM promo ORDER BY starts_at DESC LIMIT 100) p;
$fn$;
REVOKE ALL ON FUNCTION admin_promos() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION admin_save_promo(p_actor uuid, p json)
RETURNS json LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  t bigint := floor(extract(epoch FROM now()))::bigint;
  -- A new offer's id carries a random tail, so two made in the same second
  -- do not land on one row.
  id_ text := coalesce(nullif(p->>'id', ''), 'p' || to_char(now(), 'YYYYMMDDHH24MISS') || substr(md5(random()::text), 1, 4));
  kind_ text := p->>'kind';
  plan_ text := nullif(p->>'plan_id', '');
  price_ bigint := nullif(p->>'price_minor', '')::bigint;
  trial_ integer := nullif(p->>'trial_days', '')::integer;
  starts_ bigint := coalesce(nullif(p->>'starts_at', '')::bigint, t);
  ends_ bigint := nullif(p->>'ends_at', '')::bigint;
  full_ bigint;
  clash_ record;
BEGIN
  IF kind_ IS NULL OR kind_ NOT IN ('deal', 'trial', 'notice') THEN RETURN json_build_object('error', 'Pick a deal, a trial or a notice.'); END IF;
  -- Checkout and the Worker only take ids of this shape; anything else would
  -- save and then never work.
  IF id_ !~ '^[A-Za-z0-9_-]{1,40}$' THEN RETURN json_build_object('error', 'An id of letters, numbers, dashes and underscores.'); END IF;
  IF coalesce(nullif(p->>'audience', ''), 'everyone') NOT IN ('everyone', 'signed_out', 'free') THEN
    RETURN json_build_object('error', 'Pick who sees it: everyone, signed-out visitors or readers without a membership.');
  END IF;
  IF length(coalesce(trim(p->>'title'), '')) = 0 OR length(p->>'title') > 80 THEN
    RETURN json_build_object('error', 'A headline of up to 80 characters.');
  END IF;
  IF length(coalesce(p->>'body', '')) > 280 THEN RETURN json_build_object('error', 'Keep the text under 280 characters.'); END IF;
  IF length(coalesce(p->>'cta', '')) > 30 THEN RETURN json_build_object('error', 'Keep the button under 30 characters.'); END IF;
  IF ends_ IS NULL OR ends_ <= starts_ THEN RETURN json_build_object('error', 'It has to end after it starts.'); END IF;
  IF kind_ IN ('deal', 'trial') THEN
    SELECT amount_minor INTO full_ FROM plan WHERE id = plan_ AND active = 1;
    -- Switching an offer off is always allowed, even once its plan has been
    -- taken off sale; only a live one needs a plan someone can buy.
    IF full_ IS NULL AND coalesce(nullif(p->>'active', '')::integer, 1) = 1 THEN
      RETURN json_build_object('error', 'Pick a plan that is on sale.');
    END IF;
    IF full_ IS NULL THEN SELECT amount_minor INTO full_ FROM plan WHERE id = plan_; END IF;
    IF full_ IS NULL THEN RETURN json_build_object('error', 'Pick a plan.'); END IF;
  END IF;
  IF kind_ = 'deal' AND (price_ IS NULL OR price_ < 100 OR price_ >= full_) THEN
    RETURN json_build_object('error', 'A deal needs a price below the plan''s own, and at least £1.');
  END IF;
  IF kind_ = 'trial' AND (trial_ IS NULL OR plan_ = 'matchday') THEN
    RETURN json_build_object('error', 'A trial needs a number of days and a plan that renews.');
  END IF;
  IF kind_ = 'trial' AND (trial_ < 1 OR trial_ > 60) THEN
    RETURN json_build_object('error', 'A trial of 1 to 60 days.');
  END IF;
  -- One offer on a plan at a time. Two would put one in the popup and the
  -- other at checkout, and a reader who clicked a trial would be charged a
  -- deal price. Notices carry no price, so any number may run.
  IF kind_ IN ('deal', 'trial') AND coalesce(nullif(p->>'active', '')::integer, 1) = 1 THEN
    SELECT o.id, o.title, o.starts_at, o.ends_at INTO clash_ FROM promo o
     WHERE o.id <> id_ AND o.active = 1 AND o.kind IN ('deal', 'trial') AND o.plan_id = plan_
       AND o.starts_at < ends_ AND o.ends_at > starts_ AND o.ends_at > t
     ORDER BY o.starts_at LIMIT 1;
    IF clash_.id IS NOT NULL THEN
      RETURN json_build_object('error', format('"%s" already runs on this plan from %s to %s. Switch it off or change the dates first.',
        clash_.title,
        to_char(to_timestamp(clash_.starts_at) AT TIME ZONE 'Europe/London', 'DD Mon HH24:MI'),
        to_char(to_timestamp(clash_.ends_at) AT TIME ZONE 'Europe/London', 'DD Mon HH24:MI')));
    END IF;
  END IF;
  INSERT INTO promo (id, kind, title, body, cta, plan_id, price_minor, trial_days, audience, starts_at, ends_at, active, created_at, updated_at)
  VALUES (id_, kind_, trim(p->>'title'), nullif(trim(p->>'body'), ''), nullif(trim(p->>'cta'), ''),
          CASE WHEN kind_ = 'notice' THEN NULL ELSE plan_ END,
          CASE WHEN kind_ = 'deal' THEN price_ END,
          CASE WHEN kind_ = 'trial' THEN trial_ END,
          coalesce(nullif(p->>'audience', ''), 'everyone'), starts_, ends_,
          coalesce(nullif(p->>'active', '')::integer, 1), t, t)
  ON CONFLICT (id) DO UPDATE SET
    kind = excluded.kind, title = excluded.title, body = excluded.body, cta = excluded.cta,
    plan_id = excluded.plan_id, price_minor = excluded.price_minor, trial_days = excluded.trial_days,
    audience = excluded.audience, starts_at = excluded.starts_at, ends_at = excluded.ends_at,
    active = excluded.active, updated_at = t;
  INSERT INTO admin_log (at, actor, action, target, detail_json) VALUES (t, p_actor, 'promo', id_, p::text);
  RETURN json_build_object('ok', true, 'id', id_);
END;
$fn$;
REVOKE ALL ON FUNCTION admin_save_promo(uuid, json) FROM PUBLIC, anon, authenticated;

-- What was changed from the dashboard, newest first.
CREATE OR REPLACE FUNCTION admin_log_list(p_limit integer DEFAULT 50)
RETURNS json LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT coalesce(json_agg(row_to_json(l) ORDER BY l.at DESC), '[]'::json)
  FROM (SELECT l.at, l.action, l.target, l.detail_json, u.email AS target_email
        FROM admin_log l LEFT JOIN auth.users u ON u.id::text = l.target
        ORDER BY l.at DESC LIMIT least(greatest(coalesce(p_limit, 50), 1), 200)) l;
$fn$;
REVOKE ALL ON FUNCTION admin_log_list(integer) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------- support
--
-- Mail to support@ and hello@ reaches the Worker (Cloudflare Email Routing,
-- worker/src/support.ts), which keeps each conversation here as a ticket and
-- forwards the original to the owner's inbox. The owner answers from the
-- dashboard (#/admin/support), as support@offside.win.
--
-- A ticket is open while it waits on us, waiting while it waits on them, and
-- closed when it is done; a reply from them opens it again. Messages are kept
-- as plain text only: what a stranger sends is never rendered as HTML.
--
-- Private: the owner's dashboard reads it through admin_ functions, the
-- Worker writes it through support_inbound with the service key.
CREATE TABLE IF NOT EXISTS support_ticket (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email       text NOT NULL,              -- who we are talking to, lower-cased
  name        text,
  subject     text NOT NULL,
  mailbox     text NOT NULL DEFAULT 'support',   -- the address they wrote to
  status      text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'waiting', 'closed')),
  created_at  bigint NOT NULL,
  updated_at  bigint NOT NULL,
  last_in_at  bigint,
  last_out_at bigint
);
CREATE INDEX IF NOT EXISTS support_ticket_status ON support_ticket (status, updated_at DESC);
CREATE INDEX IF NOT EXISTS support_ticket_email ON support_ticket (email);
ALTER TABLE support_ticket ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON support_ticket FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS support_message (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ticket_id   bigint NOT NULL REFERENCES support_ticket (id) ON DELETE CASCADE,
  direction   text NOT NULL CHECK (direction IN ('in', 'out')),
  at          bigint NOT NULL,
  from_email  text,
  to_email    text,
  subject     text,
  body        text NOT NULL,             -- plain text, at most 20,000 characters
  message_id  text,                      -- the Message-ID, without angle brackets, for threading
  attachments integer NOT NULL DEFAULT 0,
  actor       uuid                       -- who answered, on our side
);
CREATE INDEX IF NOT EXISTS support_message_ticket ON support_message (ticket_id, at);
-- A delivery repeated by the mail system is one message, not two.
CREATE UNIQUE INDEX IF NOT EXISTS support_message_mid ON support_message (message_id) WHERE message_id IS NOT NULL;
ALTER TABLE support_message ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON support_message FROM anon, authenticated;

-- One email in. The ticket it belongs to is, in order: the one whose number
-- is in the subject ("[#12]") from the same address; the one holding a
-- message this one answers (In-Reply-To or References); otherwise a new one.
-- Runs as the caller, which is the Worker holding the service key.
CREATE OR REPLACE FUNCTION support_inbound(
  p_from text, p_name text, p_to text, p_subject text, p_body text,
  p_message_id text, p_refs text, p_attachments integer
) RETURNS json LANGUAGE plpgsql VOLATILE SET search_path = public AS $fn$
DECLARE
  t bigint := floor(extract(epoch FROM now()))::bigint;
  v_from text := lower(trim(coalesce(p_from, '')));
  v_mid text := nullif(lower(trim(both '<> ' FROM coalesce(p_message_id, ''))), '');
  v_subject text := left(coalesce(nullif(trim(p_subject), ''), '(no subject)'), 200);
  v_ticket bigint;
  v_new boolean := false;
  v_tag text;
BEGIN
  IF v_from !~ '^[^@\s]+@[^@\s]+$' THEN RETURN json_build_object('error', 'no sender'); END IF;
  IF v_mid IS NOT NULL THEN
    SELECT ticket_id INTO v_ticket FROM support_message WHERE message_id = v_mid;
    IF FOUND THEN RETURN json_build_object('ticket', v_ticket, 'new', false, 'repeat', true); END IF;
  END IF;

  v_tag := substring(v_subject FROM '\[#(\d{1,12})\]');
  IF v_tag IS NOT NULL THEN
    SELECT id INTO v_ticket FROM support_ticket WHERE id = v_tag::bigint AND email = v_from;
  END IF;
  IF v_ticket IS NULL AND coalesce(p_refs, '') <> '' THEN
    SELECT m.ticket_id INTO v_ticket
    FROM support_message m JOIN support_ticket k ON k.id = m.ticket_id
    WHERE k.email = v_from
      AND m.message_id = ANY (SELECT lower(trim(both '<> ' FROM r)) FROM regexp_split_to_table(p_refs, '\s+') r WHERE r <> '')
    ORDER BY m.at DESC LIMIT 1;
  END IF;
  IF v_ticket IS NULL THEN
    INSERT INTO support_ticket (email, name, subject, mailbox, status, created_at, updated_at)
    VALUES (v_from, left(nullif(trim(p_name), ''), 120), v_subject,
            CASE WHEN lower(coalesce(p_to, '')) LIKE 'hello@%' THEN 'hello' ELSE 'support' END, 'open', t, t)
    RETURNING id INTO v_ticket;
    v_new := true;
  END IF;

  INSERT INTO support_message (ticket_id, direction, at, from_email, to_email, subject, body, message_id, attachments)
  VALUES (v_ticket, 'in', t, v_from, lower(coalesce(p_to, '')), v_subject, left(coalesce(p_body, ''), 20000), v_mid, greatest(coalesce(p_attachments, 0), 0));
  UPDATE support_ticket SET status = 'open', updated_at = t, last_in_at = t,
         name = coalesce(name, left(nullif(trim(p_name), ''), 120))
  WHERE id = v_ticket;
  RETURN json_build_object('ticket', v_ticket, 'new', v_new);
END;
$fn$;
REVOKE ALL ON FUNCTION support_inbound(text, text, text, text, text, text, text, integer) FROM PUBLIC, anon, authenticated;

-- The list: how many in each state, and the tickets in one of them.
CREATE OR REPLACE FUNCTION admin_support_list(p_status text DEFAULT 'open', p_limit integer DEFAULT 100)
RETURNS json LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT json_build_object(
    'counts', (SELECT json_build_object(
        'open', count(*) FILTER (WHERE status = 'open'),
        'waiting', count(*) FILTER (WHERE status = 'waiting'),
        'closed', count(*) FILTER (WHERE status = 'closed')) FROM support_ticket),
    'tickets', (SELECT coalesce(json_agg(row_to_json(k) ORDER BY k.updated_at DESC), '[]'::json) FROM (
       SELECT k.id, k.email, k.name, k.subject, k.mailbox, k.status, k.created_at, k.updated_at, k.last_in_at, k.last_out_at,
              (SELECT count(*) FROM support_message m WHERE m.ticket_id = k.id) AS messages,
              (SELECT left(regexp_replace(m.body, '\s+', ' ', 'g'), 160) FROM support_message m
                WHERE m.ticket_id = k.id ORDER BY m.at DESC, m.id DESC LIMIT 1) AS preview,
              (SELECT m.direction FROM support_message m WHERE m.ticket_id = k.id ORDER BY m.at DESC, m.id DESC LIMIT 1) AS last_direction,
              (SELECT u.id FROM auth.users u WHERE lower(u.email) = k.email LIMIT 1) AS user_id
       FROM support_ticket k
       WHERE coalesce(p_status, 'open') = 'all' OR k.status = coalesce(p_status, 'open')
       ORDER BY k.updated_at DESC
       LIMIT least(greatest(coalesce(p_limit, 100), 1), 300)) k));
$fn$;
REVOKE ALL ON FUNCTION admin_support_list(text, integer) FROM PUBLIC, anon, authenticated;

-- One ticket: every message, and the account behind the address if there is one.
CREATE OR REPLACE FUNCTION admin_support_ticket(p_id bigint)
RETURNS json LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT json_build_object(
    'ticket', row_to_json(k),
    'messages', (SELECT coalesce(json_agg(row_to_json(m) ORDER BY m.at, m.id), '[]'::json) FROM (
       SELECT id, direction, at, from_email, to_email, subject, body, message_id, attachments FROM support_message WHERE ticket_id = k.id) m),
    'account', (SELECT row_to_json(a) FROM (
       SELECT u.id, u.created_at,
              (SELECT json_build_object('plan_id', m.plan_id, 'expires_at', m.expires_at) FROM membership m WHERE m.user_id = u.id) AS membership,
              (SELECT json_build_object('plan_id', e.plan_id, 'expires_at', e.expires_at, 'status', e.status)
                 FROM entitlement e WHERE lower(e.email) = k.email ORDER BY e.expires_at DESC LIMIT 1) AS entitlement
       FROM auth.users u WHERE lower(u.email) = k.email LIMIT 1) a))
  FROM support_ticket k WHERE k.id = p_id;
$fn$;
REVOKE ALL ON FUNCTION admin_support_ticket(bigint) FROM PUBLIC, anon, authenticated;

-- A new conversation started from the dashboard. The ticket comes first so its
-- number can go in the subject; one whose email never went is removed again
-- (admin_support_drop).
CREATE OR REPLACE FUNCTION admin_support_new(p_actor uuid, p_email text, p_subject text)
RETURNS json LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $fn$
DECLARE t bigint := floor(extract(epoch FROM now()))::bigint; v_id bigint; v_email text := lower(trim(coalesce(p_email, '')));
BEGIN
  IF v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN RETURN json_build_object('error', 'That email address does not look right.'); END IF;
  IF coalesce(trim(p_subject), '') = '' THEN RETURN json_build_object('error', 'Give it a subject.'); END IF;
  INSERT INTO support_ticket (email, subject, mailbox, status, created_at, updated_at)
  VALUES (v_email, left(trim(p_subject), 200), 'support', 'waiting', t, t) RETURNING id INTO v_id;
  RETURN json_build_object('id', v_id);
END;
$fn$;
REVOKE ALL ON FUNCTION admin_support_new(uuid, text, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION admin_support_drop(p_id bigint)
RETURNS json LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public AS $fn$
  DELETE FROM support_ticket k WHERE k.id = p_id AND NOT EXISTS (SELECT 1 FROM support_message m WHERE m.ticket_id = k.id);
  SELECT json_build_object('ok', true);
$fn$;
REVOKE ALL ON FUNCTION admin_support_drop(bigint) FROM PUBLIC, anon, authenticated;

-- A reply that has gone out: kept on the ticket, which then waits on them
-- (or is closed, when the reply was the last word).
CREATE OR REPLACE FUNCTION admin_support_reply(
  p_actor uuid, p_id bigint, p_to text, p_subject text, p_body text, p_message_id text, p_close boolean DEFAULT false
) RETURNS json LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $fn$
DECLARE t bigint := floor(extract(epoch FROM now()))::bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM support_ticket WHERE id = p_id) THEN RETURN json_build_object('error', 'No such ticket.'); END IF;
  INSERT INTO support_message (ticket_id, direction, at, from_email, to_email, subject, body, message_id, actor)
  VALUES (p_id, 'out', t, 'support@offside.win', lower(p_to), left(p_subject, 200), left(coalesce(p_body, ''), 20000),
          nullif(lower(trim(both '<> ' FROM coalesce(p_message_id, ''))), ''), p_actor)
  ON CONFLICT DO NOTHING;
  UPDATE support_ticket SET status = CASE WHEN p_close THEN 'closed' ELSE 'waiting' END, updated_at = t, last_out_at = t WHERE id = p_id;
  INSERT INTO admin_log (at, actor, action, target, detail_json)
  VALUES (t, p_actor, 'support_reply', 'ticket:' || p_id, json_build_object('ticket', p_id, 'closed', p_close)::text);
  RETURN json_build_object('ok', true);
END;
$fn$;
REVOKE ALL ON FUNCTION admin_support_reply(uuid, bigint, text, text, text, text, boolean) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION admin_support_status(p_actor uuid, p_id bigint, p_status text)
RETURNS json LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $fn$
DECLARE t bigint := floor(extract(epoch FROM now()))::bigint;
BEGIN
  IF p_status NOT IN ('open', 'waiting', 'closed') THEN RETURN json_build_object('error', 'No such state.'); END IF;
  UPDATE support_ticket SET status = p_status, updated_at = t WHERE id = p_id;
  IF NOT FOUND THEN RETURN json_build_object('error', 'No such ticket.'); END IF;
  INSERT INTO admin_log (at, actor, action, target, detail_json)
  VALUES (t, p_actor, 'support_status', 'ticket:' || p_id, json_build_object('ticket', p_id, 'status', p_status)::text);
  RETURN json_build_object('ok', true);
END;
$fn$;
REVOKE ALL ON FUNCTION admin_support_status(uuid, bigint, text) FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';

-- ------------------------------------------------------------- goodwill days
--
-- A day added to every paying member for every day the club game is off: an
-- international break or the close season. Fewer matches means fewer calls,
-- which is not what anyone paid for, so the membership stops counting down
-- while it lasts. Worked out and applied once a day by the Worker's cron
-- (worker/src/goodwill.ts); nothing for a member to ask for or claim.
--
-- A quiet day is one inside a run of at least four with no Champions League
-- or big-five match, which is what a break looks like from the fixture list
-- and what an ordinary Thursday does not. It also needs matches on the board
-- that day, so a stalled slate cannot look like a break and hand out time.
CREATE TABLE IF NOT EXISTS goodwill (
  day        bigint NOT NULL,   -- the quiet day, as UK midnight
  account    text NOT NULL,     -- 'u:<user id>' for a card membership, 'e:<email>' for one through Whop
  email      text,
  stretch    bigint NOT NULL,   -- the first quiet day of this run, for the emails
  -- Whop: true once Whop has moved the renewal back; everything else is true
  -- on the spot, because the expiry is ours.
  applied    boolean NOT NULL DEFAULT false,
  created_at bigint NOT NULL,
  PRIMARY KEY (day, account)
);
ALTER TABLE goodwill ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON goodwill FROM anon, authenticated;

-- Which emails have gone: one when a run of quiet days starts, one when it ends.
CREATE TABLE IF NOT EXISTS goodwill_notice (
  account  text NOT NULL,
  stretch  bigint NOT NULL,
  kind     text NOT NULL,     -- 'start' or 'end'
  sent_at  bigint NOT NULL,
  PRIMARY KEY (account, stretch, kind)
);
ALTER TABLE goodwill_notice ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON goodwill_notice FROM anon, authenticated;

-- Whether a UK day was quiet.
CREATE OR REPLACE FUNCTION goodwill_lean(p_day bigint)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $fn$
  WITH top AS (
    SELECT kickoff FROM fixture WHERE league_id IN (7, 1, 3, 4, 5, 6)
       AND kickoff >= p_day - 3 * 86400 AND kickoff < p_day + 4 * 86400
    UNION ALL
    SELECT kickoff FROM schedule WHERE league_id IN (7, 1, 3, 4, 5, 6)
       AND kickoff >= p_day - 3 * 86400 AND kickoff < p_day + 4 * 86400)
  SELECT (SELECT count(*) FROM fixture WHERE kickoff >= p_day AND kickoff < p_day + 86400) >= 5
     AND EXISTS (
       SELECT 1 FROM generate_series(0, 3) s
        WHERE NOT EXISTS (SELECT 1 FROM top
                           WHERE kickoff >= p_day - s * 86400 AND kickoff < p_day + (4 - s) * 86400));
$fn$;
REVOKE ALL ON FUNCTION goodwill_lean(bigint) FROM PUBLIC, anon, authenticated;

-- Credit one quiet day, once. Card memberships are extended here; a Whop
-- subscription that renews is handed back to the Worker, which asks Whop to
-- move the renewal (goodwill_whop_applied records it). A Whop pass or a
-- subscription already stopped is extended here, since nothing will bill it.
-- Complimentary time is not credited: nobody paid for the day.
CREATE OR REPLACE FUNCTION goodwill_credit(p_day bigint)
RETURNS json LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  t bigint := floor(extract(epoch FROM now()))::bigint;
  v_end bigint := p_day + 86400;
BEGIN
  IF NOT goodwill_lean(p_day) THEN
    RETURN json_build_object('lean', false);
  END IF;

  -- Card memberships, paid, running the whole day.
  WITH eligible AS (
    SELECT m.user_id, u.email FROM membership m JOIN auth.users u ON u.id = m.user_id
     WHERE m.expires_at > v_end AND m.created_at < p_day AND coalesce(m.card_brand, '') <> 'complimentary'),
  ins AS (
    INSERT INTO goodwill (day, account, email, stretch, applied, created_at)
    SELECT p_day, 'u:' || e.user_id, e.email,
           coalesce((SELECT g.stretch FROM goodwill g WHERE g.account = 'u:' || e.user_id AND g.day = p_day - 86400), p_day),
           true, t
      FROM eligible e
    ON CONFLICT (day, account) DO NOTHING
    RETURNING account)
  UPDATE membership SET expires_at = expires_at + 86400, updated_at = t
   WHERE 'u:' || user_id IN (SELECT account FROM ins);

  -- Whop: every live entitlement running the whole day. The ones nothing will
  -- bill again are extended now; the renewing ones wait for Whop.
  WITH eligible AS (
    SELECT e.email, (e.plan_id <> 'matchday' AND e.renew_stopped_at IS NULL) AS renews
      FROM entitlement e
     WHERE e.status = 'active' AND e.expires_at > v_end AND e.created_at < p_day),
  ins AS (
    INSERT INTO goodwill (day, account, email, stretch, applied, created_at)
    SELECT p_day, 'e:' || e.email, e.email,
           coalesce((SELECT g.stretch FROM goodwill g WHERE g.account = 'e:' || e.email AND g.day = p_day - 86400), p_day),
           NOT e.renews, t
      FROM eligible e
    ON CONFLICT (day, account) DO NOTHING
    RETURNING account, applied)
  UPDATE entitlement SET expires_at = expires_at + 86400, updated_at = t
   WHERE 'e:' || email IN (SELECT account FROM ins WHERE applied);

  RETURN json_build_object(
    'lean', true,
    -- Whop renewals still to move, this day or any in the last week that failed.
    'pending', coalesce((
      SELECT json_agg(json_build_object(
               'day', g.day, 'account', g.account, 'email', g.email,
               'membership', (SELECT split_part(eg.ref, ':', 1) FROM entitlement_grant eg
                               WHERE eg.email = g.email AND eg.ref LIKE 'mem\_%' ORDER BY eg.created_at DESC LIMIT 1)))
        FROM goodwill g WHERE NOT g.applied AND g.day > p_day - 7 * 86400), '[]'::json),
    -- Runs starting today, whose first email has not gone.
    'started', coalesce((
      SELECT json_agg(json_build_object('account', g.account, 'email', g.email, 'stretch', g.stretch,
               'until', CASE WHEN g.account LIKE 'u:%'
                             THEN (SELECT m.expires_at FROM membership m WHERE 'u:' || m.user_id = g.account)
                             ELSE (SELECT e.expires_at FROM entitlement e WHERE 'e:' || e.email = g.account) END,
               'whop', g.account LIKE 'e:%'))
        FROM goodwill g
       WHERE g.day = p_day AND g.stretch = p_day AND g.email IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM goodwill_notice n WHERE n.account = g.account AND n.stretch = g.stretch AND n.kind = 'start')), '[]'::json)
  );
END;
$fn$;
REVOKE ALL ON FUNCTION goodwill_credit(bigint) FROM PUBLIC, anon, authenticated;

-- Whop has moved a renewal back: the day is applied, the entitlement runs to
-- Whop's new date, and that period is recorded so the sweep does not take it
-- for a renewal (and send a receipt for money nobody paid).
CREATE OR REPLACE FUNCTION goodwill_whop_applied(p_day bigint, p_account text, p_membership text, p_until bigint)
RETURNS json LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $fn$
DECLARE t bigint := floor(extract(epoch FROM now()))::bigint; v_email text;
BEGIN
  UPDATE goodwill SET applied = true WHERE day = p_day AND account = p_account RETURNING email INTO v_email;
  IF v_email IS NULL THEN RETURN json_build_object('ok', false); END IF;
  UPDATE entitlement SET expires_at = greatest(expires_at, coalesce(p_until, expires_at + 86400)), updated_at = t
   WHERE email = v_email;
  IF p_membership IS NOT NULL AND p_until IS NOT NULL THEN
    INSERT INTO entitlement_grant (ref, email, plan_id, created_at)
    SELECT p_membership || ':' || p_until, v_email, coalesce((SELECT plan_id FROM entitlement WHERE email = v_email), 'monthly'), t
    ON CONFLICT (ref) DO NOTHING;
  END IF;
  RETURN json_build_object('ok', true);
END;
$fn$;
REVOKE ALL ON FUNCTION goodwill_whop_applied(bigint, text, text, bigint) FROM PUBLIC, anon, authenticated;

-- Mark an email sent, once. False when it already had been.
CREATE OR REPLACE FUNCTION goodwill_noted(p_account text, p_stretch bigint, p_kind text)
RETURNS boolean LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public AS $fn$
  WITH ins AS (
    INSERT INTO goodwill_notice (account, stretch, kind, sent_at)
    VALUES (p_account, p_stretch, p_kind, floor(extract(epoch FROM now()))::bigint)
    ON CONFLICT DO NOTHING RETURNING 1)
  SELECT EXISTS (SELECT 1 FROM ins);
$fn$;
REVOKE ALL ON FUNCTION goodwill_noted(text, bigint, text) FROM PUBLIC, anon, authenticated;

-- The runs that ended the day before p_day (p_day itself was not quiet): who
-- had days added, how many, and when they now run to.
CREATE OR REPLACE FUNCTION goodwill_ended(p_day bigint)
RETURNS json LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT coalesce(json_agg(json_build_object(
           'account', r.account, 'email', r.email, 'stretch', r.stretch, 'days', r.days, 'whop', r.account LIKE 'e:%',
           'until', CASE WHEN r.account LIKE 'u:%'
                         THEN (SELECT m.expires_at FROM membership m WHERE 'u:' || m.user_id = r.account)
                         ELSE (SELECT e.expires_at FROM entitlement e WHERE 'e:' || e.email = r.account) END)), '[]'::json)
    FROM (
      SELECT g.account, max(g.email) AS email, g.stretch, count(*) AS days
        FROM goodwill g
       WHERE g.stretch IN (SELECT stretch FROM goodwill WHERE day = p_day - 86400)
         AND NOT EXISTS (SELECT 1 FROM goodwill x WHERE x.account = g.account AND x.day = p_day)
         AND NOT EXISTS (SELECT 1 FROM goodwill_notice n WHERE n.account = g.account AND n.stretch = g.stretch AND n.kind = 'end')
       GROUP BY g.account, g.stretch
       HAVING max(g.day) = p_day - 86400) r
   WHERE r.email IS NOT NULL;
$fn$;
REVOKE ALL ON FUNCTION goodwill_ended(bigint) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------- pulled calls

-- The account page's switch for pulled-call emails. Signed in only; the
-- caller's own profile, created if it is not there yet.
CREATE OR REPLACE FUNCTION set_call_alerts(p_on boolean)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  me uuid := auth.uid();
  now_s bigint := floor(extract(epoch FROM now()))::bigint;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'sign in first' USING ERRCODE = '28000'; END IF;
  INSERT INTO profile (user_id, created_at, updated_at, call_alerts)
  VALUES (me, now_s, now_s, coalesce(p_on, true))
  ON CONFLICT (user_id) DO UPDATE SET call_alerts = coalesce(p_on, true), updated_at = now_s;
  RETURN coalesce(p_on, true);
END;
$fn$;
GRANT EXECUTE ON FUNCTION set_call_alerts(boolean) TO anon, authenticated;

-- The Worker's alert run, in one step: the calls pulled in the last three
-- hours that are still to kick off, not since restored and not yet handled;
-- the members who want to hear about them; a notice for each pair, written
-- before anything is sent; and the calls marked handled, so nobody joining
-- later is emailed about an old pull. Returns one bundle per member, so each
-- gets one email however many calls came down. At most once: a send that
-- fails after this is not retried, which beats the same email twice.
-- A member is anyone with a live card membership or a live Whop
-- entitlement; the switch is on their profile, by account or, for Whop, by
-- email.
CREATE OR REPLACE FUNCTION pulled_claim()
RETURNS json LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  now_s bigint := floor(extract(epoch FROM now()))::bigint;
  v json;
BEGIN
  WITH calls AS (
    SELECT * FROM pulled_call
     WHERE alerted_at IS NULL AND restored_at IS NULL
       AND kickoff > now_s AND pulled_at > now_s - 3 * 3600
     FOR UPDATE SKIP LOCKED),
  members AS (
    SELECT lower(u.email) AS email
      FROM membership m JOIN auth.users u ON u.id = m.user_id
      LEFT JOIN profile p ON p.user_id = m.user_id
     WHERE m.expires_at > now_s AND u.email IS NOT NULL AND coalesce(p.call_alerts, true)
    UNION
    SELECT lower(e.email)
      FROM entitlement e
      LEFT JOIN auth.users u ON lower(u.email) = lower(e.email)
      LEFT JOIN profile p ON p.user_id = u.id
     WHERE e.status = 'active' AND e.expires_at > now_s AND coalesce(p.call_alerts, true)),
  -- A member is told about a call once. The slate can pull a call, see it
  -- come back on the next pass and pull it again: that is a new row here,
  -- but the same call on the same match, and it arrived twice in an inbox.
  claimed AS (
    INSERT INTO pulled_notice (pulled_id, email, sent_at)
    SELECT c.id, m.email, now_s FROM calls c CROSS JOIN members m
     WHERE NOT EXISTS (
       SELECT 1 FROM pulled_notice n JOIN pulled_call o ON o.id = n.pulled_id
        WHERE n.email = m.email AND o.fixture_id = c.fixture_id
          AND o.market = c.market AND o.outcome = c.outcome AND o.line IS NOT DISTINCT FROM c.line)
    ON CONFLICT DO NOTHING RETURNING pulled_id, email),
  handled AS (
    UPDATE pulled_call SET alerted_at = now_s WHERE id IN (SELECT id FROM calls) RETURNING id)
  SELECT coalesce(json_agg(json_build_object('email', x.email, 'calls', x.calls)), '[]'::json) INTO v
    FROM (SELECT cl.email, json_agg(json_build_object(
                   'id', c.id, 'fixture_id', c.fixture_id, 'kickoff', c.kickoff, 'home', c.home, 'away', c.away,
                   'label', c.label, 'odds', c.odds, 'bookmaker', c.bookmaker, 'reason', c.reason,
                   'replaced_by', c.replaced_by) ORDER BY c.kickoff) AS calls
            FROM claimed cl JOIN calls c ON c.id = cl.pulled_id
           GROUP BY cl.email) x;
  RETURN v;
END;
$fn$;
REVOKE ALL ON FUNCTION pulled_claim() FROM PUBLIC, anon, authenticated;

-- Every published call keeps its match page.
--
-- The slate deleted every fixture a week after kick-off while the calls on
-- them stay in the record for good, so the older half of the results page
-- showed "? v ?" with no score and its match links said "not found". The
-- slate now keeps any fixture with a published call (slate.ts, pruneBoard);
-- this puts back the ones already gone, from what survives them: the match,
-- team and league tables, the schedule and the archived snapshot. The
-- analysis went with the old row, so the page carries the teams, the score
-- and the call. Only missing rows are written: run again, it does nothing.
INSERT INTO fixture (id, league_id, kickoff, home_team, away_team, status, provisional,
                     board_json, bundle_json, board_free_json, bundle_free_json, computed_at,
                     home_goals, away_goals, home_team_id, away_team_id, rank)
SELECT g.id, g.league_id, g.kickoff, g.home, g.away, 'finished', 0,
       c.card, c.card, c.card, c.card, floor(extract(epoch FROM now()))::bigint,
       g.hg, g.ag, g.home_id, g.away_id, 9
FROM (
  SELECT DISTINCT ON (p.fixture_id)
         p.fixture_id AS id,
         coalesce(m.league_id, s.league_id, ms.league_id) AS league_id,
         coalesce(m.kickoff, s.kickoff, ms.kickoff, p.kickoff) AS kickoff,
         coalesce(th.name, s.home_team) AS home,
         coalesce(ta.name, s.away_team) AS away,
         coalesce(m.home_team_id, s.home_team_id) AS home_id,
         coalesce(m.away_team_id, s.away_team_id) AS away_id,
         coalesce(ms.home_goals, m.home_goals) AS hg,
         coalesce(ms.away_goals, m.away_goals) AS ag
    FROM pick p
    LEFT JOIN match m ON m.id = p.fixture_id
    LEFT JOIN schedule s ON s.id = p.fixture_id
    LEFT JOIN market_snapshot ms ON ms.fixture_id = p.fixture_id
    LEFT JOIN team th ON th.id = m.home_team_id
    LEFT JOIN team ta ON ta.id = m.away_team_id
   WHERE p.kind = 'CONFIDENT' AND p.settled_at IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM fixture f WHERE f.id = p.fixture_id)
   ORDER BY p.fixture_id
) g
LEFT JOIN league l ON l.id = g.league_id
CROSS JOIN LATERAL (SELECT jsonb_build_object(
    'id', g.id, 'league_id', g.league_id, 'league', l.name, 'kickoff', g.kickoff,
    'home', g.home, 'away', g.away, 'home_id', g.home_id, 'away_id', g.away_id,
    'verdicts', '[]'::jsonb, 'markets', '[]'::jsonb, 'restored', true)::text AS card) c
WHERE g.league_id IS NOT NULL AND g.home IS NOT NULL AND g.away IS NOT NULL
ON CONFLICT (id) DO NOTHING;

-- The record before launch, set aside (engine/src/recordreset.ts, `record:reset`).
--
-- Before launch the owner chose to start the public record with the engine of
-- 6 October 2026, the one that goes live, rather than carry the calls of the
-- engines before it. Nothing is deleted: those calls, their pulled calls and
-- their slips move here, out of reach of every page (all of which read pick,
-- pulled_call and slip), and `record:reset undo` moves them back. Private:
-- no page reads these and the public key reaches none of them.
CREATE TABLE IF NOT EXISTS pick_archive (LIKE pick);
ALTER TABLE pick_archive ADD COLUMN IF NOT EXISTS archived_at bigint;
ALTER TABLE pick_archive ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON pick_archive FROM anon, authenticated;
CREATE TABLE IF NOT EXISTS pulled_call_archive (LIKE pulled_call);
ALTER TABLE pulled_call_archive ADD COLUMN IF NOT EXISTS archived_at bigint;
ALTER TABLE pulled_call_archive ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON pulled_call_archive FROM anon, authenticated;
CREATE TABLE IF NOT EXISTS slip_archive (LIKE slip);
ALTER TABLE slip_archive ADD COLUMN IF NOT EXISTS archived_at bigint;
ALTER TABLE slip_archive ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON slip_archive FROM anon, authenticated;
