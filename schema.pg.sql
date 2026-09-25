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
  SELECT coalesce(
    (SELECT (try_json(v)->>'fixture_id')::bigint FROM kv WHERE k = 'free:today'),
    (SELECT (try_json(v)->>'fixture_id')::bigint FROM kv WHERE k = 'hero:today')
  );
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
CREATE OR REPLACE FUNCTION record_entitlement(
  p_source text, p_ref text, p_email text, p_plan text, p_expires bigint,
  p_amount bigint, p_currency text, p_raw text
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
  IF p_ref IS NOT NULL AND EXISTS (
    SELECT 1 FROM entitlement WHERE lower(email) = lower(p_email) AND source_ref = p_ref
  ) THEN
    RETURN json_build_object('applied', false, 'reason', 'already recorded');
  END IF;

  -- The receipt, for the account page, when there is an account to hang it on.
  SELECT id INTO v_user FROM auth.users WHERE lower(email) = lower(p_email) LIMIT 1;
  IF p_ref IS NOT NULL AND v_user IS NOT NULL THEN
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
  INSERT INTO entitlement (email, plan_id, expires_at, source, source_ref, status, created_at, updated_at)
  VALUES (lower(p_email), p_plan, v_until, p_source, p_ref, 'active', v_now, v_now)
  ON CONFLICT (email) DO UPDATE SET
    plan_id = excluded.plan_id, expires_at = greatest(entitlement.expires_at, excluded.expires_at),
    source = excluded.source, source_ref = coalesce(excluded.source_ref, entitlement.source_ref),
    status = 'active', updated_at = v_now;
  RETURN json_build_object('applied', true, 'expires_at', v_until);
END;
$fn$;

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
  SELECT json_build_object(
           'email', auth.email(),
           -- The card-based membership, or the email entitlement from a
           -- processor that runs its own accounts, whichever is live longer.
           'membership', coalesce(
             (SELECT to_json(m) FROM (
                SELECT plan_id, expires_at, auto_renew, cancelled_at, card_brand, card_last4, 'card' AS via
                FROM membership WHERE user_id = auth.uid()
                  AND expires_at > floor(extract(epoch FROM now()))::bigint
              ) m),
             (SELECT to_json(e) FROM (
                SELECT plan_id, expires_at, 0 AS auto_renew, NULL::bigint AS cancelled_at,
                       source AS card_brand, NULL::text AS card_last4, source AS via
                FROM entitlement
                WHERE auth.email() IS NOT NULL AND lower(email) = lower(auth.email()) AND status = 'active'
                  AND expires_at > floor(extract(epoch FROM now()))::bigint
              ) e),
             (SELECT to_json(m) FROM (
                SELECT plan_id, expires_at, auto_renew, cancelled_at, card_brand, card_last4, 'card' AS via
                FROM membership WHERE user_id = auth.uid()
              ) m)
           ),
           'receipts', coalesce((
             SELECT json_agg(r) FROM (
               SELECT created_at, plan_id, amount_minor, currency, status
               FROM payment_receipt LIMIT 24
             ) r
           ), '[]'::json)
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
    SELECT (
             -- Finished matches are not walled, for the reason set out on
             -- get_fixture below: the settled call is already published free
             -- on the results page, so hiding it here hid the evidence and
             -- sold the promise.
             (CASE WHEN (SELECT ok FROM m)
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
           )::json AS card,
           f.kickoff, f.rank
    FROM fixture f
    WHERE f.kickoff BETWEEN p_from AND p_to
      AND (p_league IS NULL OR f.league_id = p_league)
    ORDER BY (f.kickoff / 86400) ASC, f.rank ASC, f.kickoff ASC
    LIMIT 300
  ) b;
$fn$;

CREATE OR REPLACE FUNCTION get_fixture(p_id bigint)
RETURNS json LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT (
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
           -- The calls, from the record rather than from the write-up.
           --
           -- The write-up is a snapshot, and before the freeze at kick-off it
           -- was rewritten by every slate that passed over the match -- so for
           -- a stretch of fixtures it says "no call" while the pick table, and
           -- therefore the results page and the board, say a call was made and
           -- how it went. The pick table is the record; the page reads it.
           -- Same visibility rule as get_picks: settled calls are public, open
           -- ones need a membership.
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
  FROM fixture f WHERE f.id = p_id;
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

-- A competition's own page: the table, the top scorers, its games either side
-- of today, and how our calls in it have gone. The table and the scorers are
-- written by the slate once per run per league (kv league:<id>:standings and
-- :scorers); the fixtures come through get_board, so they are walled exactly
-- as the board is; the settled record is public, as it is everywhere.
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
               'goal_diff', (r->>'goal_diff')::int, 'points', (r->>'points')::int)
             ORDER BY (r->>'position')::int)
      FROM kv k
      CROSS JOIN LATERAL jsonb_array_elements(coalesce(try_json(k.v)::jsonb->'rows', '[]'::jsonb)) r
      LEFT JOIN team tm ON tm.id = (r->>'team_id')::bigint
      WHERE k.k = 'league:' || p_id || ':standings'
    ), '[]'::json),
    'standings_at', (SELECT (try_json(v)->>'updated_at')::bigint FROM kv WHERE k = 'league:' || p_id || ':standings'),
    'scorers', coalesce((SELECT try_json(v)->'rows' FROM kv WHERE k = 'league:' || p_id || ':scorers'), '[]'::json),
    'fixtures', coalesce((SELECT get_board(t.now - 3 * 86400, t.now + 10 * 86400, p_id)->'fixtures' FROM t), '[]'::json),
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
               'legs', CASE WHEN (SELECT ok FROM m) THEN s.legs_json::json ELSE NULL END)
      FROM slip s WHERE s.settled_at IS NULL
      ORDER BY s.created_at DESC LIMIT 1),
    'recent', coalesce((
      SELECT json_agg(r ORDER BY r.first_kickoff DESC) FROM (
        SELECT s.id, s.odds, s.chance, s.result, s.first_kickoff, s.legs_json::json AS legs
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
GRANT EXECUTE ON FUNCTION get_board(bigint, bigint, bigint) TO anon;
GRANT EXECUTE ON FUNCTION get_fixture(bigint) TO anon;
GRANT EXECUTE ON FUNCTION get_picks(integer, text) TO anon;
GRANT EXECUTE ON FUNCTION get_model() TO anon;
GRANT EXECUTE ON FUNCTION get_hero() TO anon;
GRANT EXECUTE ON FUNCTION get_health() TO anon;
GRANT EXECUTE ON FUNCTION get_slip() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION get_plans() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION free_fixture_id() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION get_league(bigint) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION get_board(bigint, bigint, bigint), get_fixture(bigint), get_picks(integer, text),
  get_model(), get_hero(), get_health(), get_account(), has_membership(), try_json(text) TO authenticated;

-- PostgREST caches the schema and will answer 404 for a function it has not
-- seen yet. Supabase reloads on DDL via an event trigger, but that fires on its
-- own schedule and a deploy that races it serves a broken read path until the
-- next one. Asking explicitly costs nothing and removes the race.
NOTIFY pgrst, 'reload schema';
