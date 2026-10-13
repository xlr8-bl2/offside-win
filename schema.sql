-- offside.win on Cloudflare D1 (SQLite).
--
-- Generated on 7 October 2026 from schema.pg.sql (the Supabase schema) by
-- introspecting a Postgres built from it, for the move off Supabase
-- (HANDOFF.md). Tables, keys and indexes only: D1 has no roles, row-level
-- security or stored functions. What those did is done by the Worker, which is
-- the only reader, and by the engine, the only writer. From here this file is
-- maintained by hand; keep it in step with what the engine writes.
--
-- Types: integers and booleans are INTEGER (booleans as 0/1), floats REAL,
-- text, uuids and dates TEXT. Times are unix seconds throughout, as before.


CREATE TABLE IF NOT EXISTS admin_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT,
  detail_json TEXT
);

CREATE TABLE IF NOT EXISTS backtest (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  label TEXT NOT NULL,
  report_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS calibration (
  market_family TEXT PRIMARY KEY,
  n INTEGER NOT NULL,
  brier REAL,
  log_loss REAL,
  mean_model_p REAL,
  mean_actual REAL,
  roi REAL,
  clv_mean REAL,
  shrink REAL NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS entitlement (
  email TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  source TEXT NOT NULL,
  source_ref TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  manage_url TEXT,
  renew_stopped_at INTEGER
);

CREATE TABLE IF NOT EXISTS entitlement_grant (
  ref TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS fixture (
  id INTEGER PRIMARY KEY,
  league_id INTEGER NOT NULL,
  kickoff INTEGER NOT NULL,
  home_team TEXT NOT NULL,
  away_team TEXT NOT NULL,
  status TEXT NOT NULL,
  provisional INTEGER NOT NULL DEFAULT 1,
  board_json TEXT NOT NULL,
  bundle_json TEXT NOT NULL,
  computed_at INTEGER NOT NULL,
  rank INTEGER NOT NULL DEFAULT 6,
  board_free_json TEXT,
  bundle_free_json TEXT,
  home_goals INTEGER,
  away_goals INTEGER,
  live_home INTEGER,
  live_away INTEGER,
  live_minute INTEGER,
  report_json TEXT,
  home_team_id INTEGER,
  away_team_id INTEGER
);

CREATE TABLE IF NOT EXISTS follow (
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  ref_id INTEGER NOT NULL,
  label TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, kind, ref_id)
);

CREATE TABLE IF NOT EXISTS former_member (
  email_sha256 TEXT PRIMARY KEY,
  at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS goodwill (
  day INTEGER NOT NULL,
  account TEXT NOT NULL,
  email TEXT,
  stretch INTEGER NOT NULL,
  applied INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (day, account)
);

CREATE TABLE IF NOT EXISTS goodwill_notice (
  account TEXT NOT NULL,
  stretch INTEGER NOT NULL,
  kind TEXT NOT NULL,
  sent_at INTEGER NOT NULL,
  PRIMARY KEY (account, stretch, kind)
);

CREATE TABLE IF NOT EXISTS kv (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL,
  expires_at INTEGER,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS league (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  country TEXT,
  season_id INTEGER,
  tracked INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS market_snapshot (
  fixture_id INTEGER PRIMARY KEY,
  league_id INTEGER NOT NULL,
  kickoff INTEGER NOT NULL,
  home_goals INTEGER NOT NULL,
  away_goals INTEGER NOT NULL,
  snapshot TEXT NOT NULL,
  archived_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS match (
  id INTEGER PRIMARY KEY,
  league_id INTEGER NOT NULL,
  season_id INTEGER,
  kickoff INTEGER NOT NULL,
  home_team_id INTEGER NOT NULL,
  away_team_id INTEGER NOT NULL,
  home_goals INTEGER,
  away_goals INTEGER,
  home_xg REAL,
  away_xg REAL,
  xg_estimated INTEGER,
  home_corners INTEGER,
  away_corners INTEGER,
  home_yellows INTEGER,
  away_yellows INTEGER,
  home_reds INTEGER,
  away_reds INTEGER,
  home_possession REAL,
  away_possession REAL,
  home_shots INTEGER,
  away_shots INTEGER,
  home_sot INTEGER,
  away_sot INTEGER,
  referee_id INTEGER,
  stats_fetched INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS membership (
  user_id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  auto_renew INTEGER NOT NULL DEFAULT 0,
  cancelled_at INTEGER,
  dunning_from INTEGER,
  attempts INTEGER NOT NULL DEFAULT 0,
  card_brand TEXT,
  card_last4 TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS page_view (
  day TEXT NOT NULL,
  page TEXT NOT NULL,
  n INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, page)
);

CREATE TABLE IF NOT EXISTS payment (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL,
  provider_ref TEXT NOT NULL,
  user_id TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  amount_minor INTEGER NOT NULL,
  currency TEXT NOT NULL,
  status TEXT NOT NULL,
  raw_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS payment_method (
  user_id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  vault_token TEXT NOT NULL,
  origin_ref TEXT NOT NULL,
  brand TEXT,
  last4 TEXT,
  exp_month INTEGER,
  exp_year INTEGER,
  consent_at INTEGER NOT NULL,
  consent_ip TEXT,
  consent_terms TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS pick (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fixture_id INTEGER NOT NULL,
  kickoff INTEGER NOT NULL,
  market TEXT NOT NULL,
  outcome TEXT NOT NULL,
  line REAL,
  kind TEXT NOT NULL,
  model_prob REAL NOT NULL,
  book_prob REAL NOT NULL,
  edge REAL NOT NULL,
  shrunk_edge REAL NOT NULL,
  odds REAL NOT NULL,
  bookmaker TEXT,
  kelly REAL,
  confidence REAL NOT NULL,
  provisional INTEGER NOT NULL,
  narrative TEXT NOT NULL,
  evidence_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  settled_at INTEGER,
  result TEXT,
  pnl REAL,
  closing_odds REAL,
  clv REAL,
  opening_odds REAL,
  postmortem_json TEXT,
  why TEXT
);

CREATE TABLE IF NOT EXISTS pick_archive (
  id INTEGER NOT NULL,
  fixture_id INTEGER NOT NULL,
  kickoff INTEGER NOT NULL,
  market TEXT NOT NULL,
  outcome TEXT NOT NULL,
  line REAL,
  kind TEXT NOT NULL,
  model_prob REAL NOT NULL,
  book_prob REAL NOT NULL,
  edge REAL NOT NULL,
  shrunk_edge REAL NOT NULL,
  odds REAL NOT NULL,
  bookmaker TEXT,
  kelly REAL,
  confidence REAL NOT NULL,
  provisional INTEGER NOT NULL,
  narrative TEXT NOT NULL,
  evidence_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  settled_at INTEGER,
  result TEXT,
  pnl REAL,
  closing_odds REAL,
  clv REAL,
  opening_odds REAL,
  postmortem_json TEXT,
  why TEXT,
  archived_at INTEGER
);

CREATE TABLE IF NOT EXISTS plan (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  days INTEGER NOT NULL,
  amount_minor INTEGER NOT NULL,
  currency TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  checkout_url TEXT
);

CREATE TABLE IF NOT EXISTS profile (
  user_id TEXT PRIMARY KEY,
  display_name TEXT,
  odds_format TEXT NOT NULL DEFAULT 'decimal',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  avatar_style TEXT NOT NULL DEFAULT 'auto',
  avatar_color TEXT,
  club_id INTEGER,
  club_name TEXT,
  clock TEXT NOT NULL DEFAULT '24',
  username TEXT,
  call_alerts INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS promo (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  cta TEXT,
  plan_id TEXT,
  price_minor INTEGER,
  trial_days INTEGER,
  audience TEXT NOT NULL DEFAULT 'everyone',
  starts_at INTEGER NOT NULL,
  ends_at INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (kind IN ('deal', 'trial', 'notice')),
  CHECK (((price_minor IS NULL) OR (price_minor > 0))),
  CHECK (((trial_days IS NULL) OR ((trial_days >= 1) AND (trial_days <= 60)))),
  CHECK (audience IN ('everyone', 'signed_out', 'free'))
);

CREATE TABLE IF NOT EXISTS pulled_call (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pick_id INTEGER NOT NULL,
  fixture_id INTEGER NOT NULL,
  kickoff INTEGER NOT NULL,
  home TEXT NOT NULL,
  away TEXT NOT NULL,
  market TEXT NOT NULL,
  outcome TEXT NOT NULL,
  line REAL,
  label TEXT NOT NULL,
  odds REAL NOT NULL,
  bookmaker TEXT,
  reason TEXT NOT NULL,
  replaced_by TEXT,
  published_at INTEGER NOT NULL,
  pulled_at INTEGER NOT NULL,
  restored_at INTEGER,
  alerted_at INTEGER,
  after_result TEXT,
  after_home INTEGER,
  after_away INTEGER,
  after_at INTEGER,
  UNIQUE (pick_id)
);

CREATE TABLE IF NOT EXISTS pulled_call_archive (
  id INTEGER NOT NULL,
  pick_id INTEGER NOT NULL,
  fixture_id INTEGER NOT NULL,
  kickoff INTEGER NOT NULL,
  home TEXT NOT NULL,
  away TEXT NOT NULL,
  market TEXT NOT NULL,
  outcome TEXT NOT NULL,
  line REAL,
  label TEXT NOT NULL,
  odds REAL NOT NULL,
  bookmaker TEXT,
  reason TEXT NOT NULL,
  replaced_by TEXT,
  published_at INTEGER NOT NULL,
  pulled_at INTEGER NOT NULL,
  restored_at INTEGER,
  alerted_at INTEGER,
  after_result TEXT,
  after_home INTEGER,
  after_away INTEGER,
  after_at INTEGER,
  archived_at INTEGER
);

CREATE TABLE IF NOT EXISTS pulled_notice (
  pulled_id INTEGER NOT NULL,
  email TEXT NOT NULL,
  sent_at INTEGER NOT NULL,
  PRIMARY KEY (pulled_id, email)
);

CREATE TABLE IF NOT EXISTS purchase_consent (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  terms_version TEXT NOT NULL,
  adult INTEGER NOT NULL,
  waived INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS rating (
  league_id INTEGER NOT NULL,
  team_id INTEGER NOT NULL,
  attack REAL NOT NULL,
  defence REAL NOT NULL,
  attack_se REAL,
  defence_se REAL,
  matches REAL NOT NULL,
  shrunk REAL,
  fitted_at INTEGER NOT NULL,
  PRIMARY KEY (league_id, team_id)
);

CREATE TABLE IF NOT EXISTS rating_meta (
  league_id INTEGER PRIMARY KEY,
  home_adv REAL NOT NULL,
  rho REAL NOT NULL,
  xi REAL NOT NULL,
  mean_goals REAL NOT NULL,
  n_matches INTEGER NOT NULL,
  log_lik REAL,
  fitted_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS referee_rate (
  referee_id INTEGER PRIMARY KEY,
  name TEXT,
  matches INTEGER NOT NULL,
  yellows_per REAL,
  reds_per REAL,
  fitted_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS schedule (
  id INTEGER PRIMARY KEY,
  league_id INTEGER NOT NULL,
  kickoff INTEGER NOT NULL,
  home_team TEXT NOT NULL,
  away_team TEXT NOT NULL,
  home_team_id INTEGER,
  away_team_id INTEGER,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS slip (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at INTEGER NOT NULL,
  first_kickoff INTEGER NOT NULL,
  legs_json TEXT NOT NULL,
  odds REAL NOT NULL,
  chance REAL NOT NULL,
  result TEXT,
  settled_at INTEGER
);

CREATE TABLE IF NOT EXISTS slip_archive (
  id INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  first_kickoff INTEGER NOT NULL,
  legs_json TEXT NOT NULL,
  odds REAL NOT NULL,
  chance REAL NOT NULL,
  result TEXT,
  settled_at INTEGER,
  archived_at INTEGER
);

CREATE TABLE IF NOT EXISTS support_message (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id INTEGER NOT NULL,
  direction TEXT NOT NULL,
  at INTEGER NOT NULL,
  from_email TEXT,
  to_email TEXT,
  subject TEXT,
  body TEXT NOT NULL,
  message_id TEXT,
  attachments INTEGER NOT NULL DEFAULT 0,
  actor TEXT,
  CHECK (direction IN ('in', 'out')),
  FOREIGN KEY (ticket_id) REFERENCES support_ticket(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS support_ticket (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  name TEXT,
  subject TEXT NOT NULL,
  mailbox TEXT NOT NULL DEFAULT 'support',
  status TEXT NOT NULL DEFAULT 'open',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_in_at INTEGER,
  last_out_at INTEGER,
  CHECK (status IN ('open', 'waiting', 'closed'))
);

CREATE TABLE IF NOT EXISTS team (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  league_id INTEGER,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS team_color (
  team_id INTEGER PRIMARY KEY,
  color TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS team_rate (
  league_id INTEGER NOT NULL,
  team_id INTEGER NOT NULL,
  corners_for REAL,
  corners_against REAL,
  corners_disp REAL,
  yellows_for REAL,
  reds_for REAL,
  matches REAL NOT NULL,
  fitted_at INTEGER NOT NULL,
  PRIMARY KEY (league_id, team_id)
);

CREATE TABLE IF NOT EXISTS team_shot (
  team_id INTEGER PRIMARY KEY,
  url TEXT NOT NULL,
  credit TEXT NOT NULL,
  title TEXT,
  asset_id TEXT,
  width INTEGER,
  height INTEGER,
  taken_at INTEGER,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS venue (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  city TEXT NOT NULL DEFAULT '',
  capacity INTEGER,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS match_league_kickoff ON match (league_id, kickoff);

CREATE INDEX IF NOT EXISTS match_home ON match (home_team_id, kickoff);

CREATE INDEX IF NOT EXISTS match_away ON match (away_team_id, kickoff);

CREATE INDEX IF NOT EXISTS match_needs_stats ON match (stats_fetched, kickoff);

CREATE INDEX IF NOT EXISTS match_referee ON match (referee_id);

CREATE INDEX IF NOT EXISTS slip_open ON slip (settled_at, first_kickoff);

CREATE UNIQUE INDEX IF NOT EXISTS profile_username ON profile (lower(username)) WHERE (username IS NOT NULL);

CREATE INDEX IF NOT EXISTS membership_renewing ON membership (expires_at) WHERE (auto_renew = 1);

CREATE INDEX IF NOT EXISTS payment_user ON payment (user_id, created_at);

CREATE UNIQUE INDEX IF NOT EXISTS payment_provider_ref ON payment (provider, provider_ref);

CREATE INDEX IF NOT EXISTS market_snapshot_kickoff ON market_snapshot (kickoff);

CREATE INDEX IF NOT EXISTS pick_fixture ON pick (fixture_id);

CREATE INDEX IF NOT EXISTS pick_unsettled ON pick (settled_at, kickoff);

CREATE INDEX IF NOT EXISTS pick_created ON pick (created_at);

CREATE UNIQUE INDEX IF NOT EXISTS pick_unique_line ON pick (fixture_id, market, outcome, COALESCE(line, -1e9), kind);

CREATE INDEX IF NOT EXISTS fixture_kickoff ON fixture (kickoff);

CREATE INDEX IF NOT EXISTS fixture_league_kickoff ON fixture (league_id, kickoff);

CREATE INDEX IF NOT EXISTS fixture_day_rank ON fixture ((kickoff / 86400), rank, kickoff);

CREATE INDEX IF NOT EXISTS fixture_home_team ON fixture (home_team_id, kickoff);

CREATE INDEX IF NOT EXISTS fixture_away_team ON fixture (away_team_id, kickoff);

CREATE INDEX IF NOT EXISTS schedule_kickoff ON schedule (kickoff);

-- Which competitions have games to come (search, get_leagues in worker/src/d1read.ts).
CREATE INDEX IF NOT EXISTS schedule_league ON schedule (league_id, kickoff);

CREATE INDEX IF NOT EXISTS admin_log_at ON admin_log (at DESC);

CREATE INDEX IF NOT EXISTS purchase_consent_user ON purchase_consent (user_id, created_at);

CREATE INDEX IF NOT EXISTS support_ticket_status ON support_ticket (status, updated_at DESC);

CREATE INDEX IF NOT EXISTS support_ticket_email ON support_ticket (email);

CREATE INDEX IF NOT EXISTS support_message_ticket ON support_message (ticket_id, at);

CREATE UNIQUE INDEX IF NOT EXISTS support_message_mid ON support_message (message_id) WHERE (message_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS pulled_call_fixture ON pulled_call (fixture_id);

-- ------------------------------------------------------------ accounts (stage 2)
--
-- Sign-in without Supabase (worker/src/auth.ts). An account is an email
-- address; the six accounts from Supabase keep their ids (`db:accounts` loads
-- them from the export), so membership, profile and follow rows still point at
-- them. Times are unix seconds. Emails are stored lower-cased.
CREATE TABLE IF NOT EXISTS account (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT,
  avatar_url TEXT,
  provider TEXT NOT NULL DEFAULT 'email',
  google_sub TEXT UNIQUE,
  created_at INTEGER NOT NULL,
  last_sign_in_at INTEGER
);

-- A signed-in browser. Only the SHA-256 of its token is kept, so a copy of the
-- table signs nobody in.
CREATE TABLE IF NOT EXISTS auth_session (
  token_sha256 TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  seen_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS auth_session_account ON auth_session (account_id);

-- A signed-in browser, from October 2026 (auth_session above is the first
-- version, moved over a row at a time as each is next used; worker/src/auth.ts).
-- The hash is of the token joined to the kind of browser it was issued to, so
-- a token copied into another browser matches nothing. An account is signed
-- in on at most two at once; signing in on a third ends the one least
-- recently used, kept here with why until it would have expired, so that
-- browser can say what happened.
CREATE TABLE IF NOT EXISTS account_session (
  token_sha256 TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  device TEXT,
  country TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  seen_at INTEGER NOT NULL,
  ended_at INTEGER,
  ended_reason TEXT
);

CREATE INDEX IF NOT EXISTS account_session_account ON account_session (account_id, ended_at);

-- A sign-in link sent by email: one use, one hour. Hashed like the sessions.
CREATE TABLE IF NOT EXISTS auth_link (
  token_sha256 TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);

CREATE INDEX IF NOT EXISTS auth_link_email ON auth_link (email, created_at);

CREATE INDEX IF NOT EXISTS auth_link_created ON auth_link (created_at);

-- Pictures the engine draws or re-hosts (share cards at og/<id>.jpg, team
-- photographs at team/<id>.jpg), served by the Worker at /img/<path> and
-- /og/<id>.jpg. Base64 text, because the engine writes through the Worker's
-- JSON door (worker/src/enginedb.ts). They lived in Supabase Storage until
-- the October 2026 block.
CREATE TABLE IF NOT EXISTS image (
  path TEXT PRIMARY KEY,
  content_type TEXT NOT NULL,
  data TEXT NOT NULL,
  cache_control TEXT,
  updated_at INTEGER NOT NULL
);
