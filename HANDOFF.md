# Handoff: read this first

**Last updated:** 7 October 2026, about 13:00 UTC, by the Claude Code session working on branch
`claude/amazing-galileo-isfeue`.

**Keep this file current.** The owner may move the work to a different coding agent or account
at any time. Whoever is working updates the "Right now" section and the checklist after every
meaningful step, and commits it with that step, not at the end of the day.

---

## Right now

### Stage 1 is live: the public site runs on Cloudflare D1

Since about 02:20 UTC on 7 October the site reads from D1 and the engine writes to it (PR #154,
merged as 4cd3684; deploy run 37561380007 passed, including its own health and board check).
Checked by hand afterwards: every public `/api/*` endpoint answers 200 from D1, the engine door
answers 404 without its key, and `#/`, `#/board`, a match page, `#/results`, `#/leagues` and
`#/slip` render clean at 390px and 1440px (ui-verify `check.mjs`). The first D1 slate
(run 37561498163) wrote its first pass through the Worker at 02:24.

Not working until stage 2, by design: sign-in and accounts (Supabase Auth is still blocked),
membership and Whop payments, the admin dashboard and support tickets, team photos and share
cards (still in Supabase Storage, to move to R2), and the Worker's crons (Whop sweep, pulled-call
alerts, goodwill), which still call Supabase and fail quietly. Members' calls show locked to all.

**Next: stage 2** (checklist below). Supabase keeps the 6 accounts; the export artifacts
(runs 37557342873 and 37560985337, kept 90 days) hold them too.

### Stage 2: accounts, payments and the rest, on D1

**Part 1, sign-in (live since about 11:50 UTC on 7 October, PR #155):**
- `worker/src/auth.ts`: email link (`POST /api/auth/link`, one use, one hour, 5 an hour per
  address, 300 an hour site-wide), `POST /api/auth/verify`, `POST /api/auth/google` (ID token
  checked against Google's keys, `GOOGLE_CLIENT_ID` and the nonce), `GET /api/auth/me`,
  `POST /api/auth/signout`. Sessions are random tokens stored as SHA-256 in `auth_session`,
  60 days, extended while used; the 10-minute cron clears spent ones.
- Reads are member-aware: `rpc()` turns the bearer token into a `Viewer` and `d1read.ts` takes
  `member` from it. `get_account` and the account settings (`worker/src/profile.ts`) run on D1.
- Front end `public/js/lib/auth.js`: no Supabase SDK; session in `ow.session`; old `sb-*` keys
  cleared on load. Email links land on `/?signin=<token>`, redeemed by a POST from the page.
- `db:accounts` (pg.yml) copied the 6 Supabase accounts into `account` with their ids:
  run 37616517389, 6 accounts, 5 with Google, no membership without an account.

**Part 2, everything else (branch `claude/amazing-galileo-isfeue`, see the PR after #155):**
- `worker/src/paydb.ts`: record_entitlement, revoke_entitlement, stop_entitlement_renewal,
  record_payment, revoke_membership, consent, plans, kv, account deletion. `pay.ts` uses it
  whenever `DB` is bound: checkout, the Whop webhook, the 10-minute sweep, confirm, renewal.
- `worker/src/jobsdb.ts`: goodwill (credit, Whop applied, noted, ended) and pulled-call alerts.
- `worker/src/admindb.ts`: every admin_* function and support_inbound; `admin.ts` and
  `support.ts` call it through their one database helper.
- `worker/src/account.ts`: deleting an account on D1 (stops Whop first, as before).
- Pictures: share cards and team photos go to D1's `image` table (base64) through the engine's
  door (`engine/src/images/store.ts`), served at `/og/<id>.jpg` and `/img/<path>`. Nothing on
  the site reads `team_shot` today; the cards are what readers see.
- The Supabase code paths are still there, used only when `DB` is not bound (the older tests run
  them). Remove them with the rest of Supabase at the end of stage 2.
- Tests: `worker/test/stage2.test.ts` (10, on a SQLite from `schema.sql`, with any call to
  Supabase failing the test) and `worker/test/auth.test.ts` (10). Shared helper `worker/test/d1.ts`.

### The earlier calls back on the results page (owner, 7 October)

The owner asked for the calls made before the 6 October record reset to show again. `record:reset`
now runs on D1 (`undo-dry` counts, `undo` puts the archived pick, pulled_call and slip rows back),
and `pg.yml` runs engine commands against D1 (`db:export` and `db:verify` still use Postgres).
Share cards were redrawn under a new kv key (`cards:keys:d1`), because the old key listed cards
that only existed in Supabase Storage.

### Landing page rebuilt (7 October, branch `claude/amazing-galileo-isfeue`)

The owner called the landing page "vibe coded". Rebuilt as a sport section: dateline, two-line
headline ("Football predictions, argued properly."), today's free call as the lead story, sections
divided by hairline rules, the record as a results table with Landed/Missed in words. Gone: the
glowing day shout, the stadium photo and scrim, the slam-in animations, the ticket card with the
gradient band, the filled W/L squares (three times over), the giant stat numbers, the coloured card
edges. Copy in `public/js/lib/front.js`; styles in the landing block of `components.css`.
Then, on the owner's word: the offer bar with its countdown no longer runs for deals and trials
(only a plain notice can be a bar; offers still show in the popup and at checkout,
`runPromos` in `public/js/lib/promo.js`), and the footer's four stat tiles are gone.

### Depth behind every header (7 October)

The landing page has its stadium photograph back (low, under a scrim heaviest where the words
are, no tint). Every other page header gets a layer too (`headDepth` in `app.js`, styles `.ph-bg`
in `components.css`): a competition page shows the ground of its next game and its crest, large
and faint; a player page its club's crest; the results page the ground of the latest match played;
every other page the ground of today's biggest game. Pages with their own masthead (a match,
the members' front page, the landing page) are left alone.

### Champions League a step above, faster ball, landing depth (7 October)

- **Champions League night** (`body[data-comp="ucl"]`, set in `finishRoute` for league 7 and its
  matches): the page's tokens move to the competition's ultramarine (scoped block in `tokens.css`),
  a fixed star field with a slow twinkle sits behind everything, the competition page gets the
  star ball behind its title (`headDepth`), and UCL games are set apart in any list (night block,
  star by the name: `.league-block.comp-ucl`, `.row.comp-ucl`). A UCL free call puts the night and
  the ball behind the landing header.
- **Ball speed:** first paint is `brand/starball-480.webp` (52KB, was the 205KB still); the full
  still only where WebGL is missing; the shader compiles when the browser is idle; on 3x screens
  it starts at 2x and steps up (`comptheme.js`, `starball.js`).
- **Landing depth:** the ground moves at a third of the scroll speed (`landingDepth`), drifts
  slowly closer, a floodlight falls from the top right, the edges fall into the dark, and the
  lead card is frosted with a deep shade.

### Heroes and the ball, second pass (7 October)

- **Ball smoothness** (`starball.js`): at most 1.5x density on touch screens and 2x elsewhere,
  the box measured on resize rather than every frame, 30fps on phones and 60 elsewhere, and
  sharpness only ever stepped down (it used to flip up and down, which showed as a jump).
- **Masthead** (front page and match pages, `.hero`): the kick-off is a line of type in the figures
  face (no dark box), form is coloured letters (no filled squares), the match-centre labels are in
  sentence case. Match pages now show the match centre (countdown, table, meetings) beside the
  tie on desktop, before kick-off.
- **Sign-in:** two columns on desktop (why, then the form on a frosted panel), no handwriting.
- **Champions League page:** `nightHTML` under the title: the countdown to the next night and
  its ties in kick-off order.
- **Landing:** taller header with the content centred; the free call's countdown on its own line.

### What happened: Supabase blocked the project

Since the night of 6 to 7 October 2026 (between 21:10 and 00:58 UTC), every request to the site's
data has failed. Supabase answers `402 exceed_egress_quota`: the project used more than the free
plan's 5 GB of transfer for the month, and Supabase restricted it.

- **Blocked:** Supabase's REST API (PostgREST) and Auth (GoTrue). The Worker reads everything
  through these, so every `/api/*` call returns 502 and pages open empty. Sign-in is down too.
- **Still working:** the direct Postgres connection (`SUPABASE_DB_URL`, session pooler).
  `supabase-check` confirmed it at 01:07 UTC. The engine's workflows can still read and write.
- **Do not** route the site through the direct connection to get around the block. That evades
  Supabase's restriction and risks the project being suspended outright. Use the connection only
  to get the data out.

**Why it happened.** The database is only 92 MB. The transfer came from the engine re-reading
match history every 15 minutes (`slate.yml` loops for 5.5 hours per run), plus about ten lab
backtests on 6 October that each read the whole history. Visitors barely touch the database:
`/api/*` responses are cached at Cloudflare's edge (`worker/src/edge.ts`).

**Decision (owner, 7 October):** move off Supabase to **Cloudflare D1**. It is included in the
Workers Paid plan the owner already pays ($5/month): 25 billion rows read, 50 million rows written
and 5 GB of storage a month, with **no charge for data transfer**. The owner does not want to pay
for Supabase Pro. Doing it in two stages:

1. **Stage 1: the public site back.** Board, match pages, picks, results, leagues, players,
   teams, bet slip and search are served from D1, and the engine writes to D1. Members' calls show
   locked to everyone until stage 2. No one has paid yet, so no one loses anything.
2. **Stage 2: accounts.** Sign-in (email link and Google), profiles, membership, Whop payments,
   the admin dashboard and support tickets, all without Supabase.

### The data is secured

`db:export` ran at 01:30 UTC on 7 October, run 37557342873.

- **What:** all 40 public tables plus `auth.users` (6) and `auth.identities` (7): 82,807 rows. The
  database is 92 MB on disk.
- **Where:** artifact `offside-export` (ID 11454972318), 14.7 MB, kept until about 5 January 2027.
- **Format:** `tar` of `export/<schema>.<table>.jsonl.gz` plus `export/manifest.json` (columns,
  types, row counts), encrypted with
  `openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass env:EXPORT_KEY`.
- **Key:** `EXPORT_KEY` is the Actions secret `SUPABASE_SERVICE_KEY`. Only a workflow can decrypt
  it. The repository and its artifacts are public, so never upload it unencrypted.
- **To decrypt in a workflow:**
  `openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:EXPORT_KEY -in offside-export.tar.enc | tar -xf -`.
- **If the data changes before the cutover**, run `pg.yml` with command `db:export` again while
  the direct connection still works. The engine keeps writing picks until it is pointed at D1.

### Cut-over: done on 7 October, about 02:20 UTC (owner approved the merge)

- The old Supabase slate job (run 37526971826) was cancelled first, so nothing more went to Supabase.
- Fresh export: run 37560985337. Imported into D1: run 37561088157, every table's count equal.
- Then PR #154 was merged; deploy.yml points the Worker at D1. Supabase now only holds the
  accounts (sign-in) for stage 2, and the export artifacts are the backup.

### Cut-over: how stage 1 goes live (the steps, kept for reference)

Everything for stage 1 is on branch `claude/offside-win-context-sync-6k7yi7`, open as **PR #154**
(it also carries the support-ticket work, which stays inactive until stage 2). The steps, in order,
all from the phone through Actions:

1. `pg.yml`, command `db:export`, run on the branch: a fresh export, so D1 gets the picks the engine
   has written to Supabase since 01:30. Note the run id.
2. `pg.yml`, command `db:import`, `export_run` = that id: empties and refills D1, then prints each
   table's count exported against its count in D1. Any `MISMATCH` stops here.
3. Optionally `pg.yml` `db:verify` with the same id: expect no `DIFFER` lines.
4. Merge PR #154 (owner's OK first). deploy.yml runs: finds D1, applies `schema.sql`, binds `DB`,
   pushes `ENGINE_DB_KEY`, deploys, then checks `/api/health` and `/api/board`.
5. Dispatch `slate.yml` once so the board refreshes from the engine through D1; check its log for
   `D1 error` and the live site at 390px and 1440px.

Until step 4 the live site still points at Supabase and stays down; nothing on the branch touches
production before the merge (the import writes only to the new, unused D1 database).

### Migration checklist

Tick each line as it lands, with the commit or run that did it.

Stage 1, the public site:
- [x] Encrypted export of every table (`engine/src/dbexport.ts`, run 37557342873).
- [x] `schema.sql` rewritten as the full D1 (SQLite) schema: all 40 tables, 28 indexes, no RLS or
      functions. Generated from `schema.pg.sql` once; hand-maintained from now on. Applies twice
      cleanly on SQLite.
- [x] D1 database created: `offside` (pg.yml `d1:create`, run 37559148025). `worker/wrangler.toml`
      binds it as `DB` with `database_id = "REPLACE_WITH_D1_DATABASE_ID"`, which deploy.yml fills
      in after finding the database by name. The September D1 (secret `CF_D1_DATABASE_ID`) is a
      stale copy in an older schema; it is not used and can be deleted later.
- [x] `db:import`: built (`engine/src/d1import.ts`, statements from `engine/src/d1load.ts`). Run
      `pg.yml` with command `db:import` (input `export_run`, default the run above): it finds or
      creates the D1 database `offside` (`engine/src/d1setup.ts`, `d1:create`), applies
      `schema.sql`, empties and refills every table over the REST API's batch form, and reads the
      counts back. Trial run 37559421357 (export 37557342873): every table landed, counts equal,
      67 seconds. Run it again with a fresh export at the cut-over.
- [x] Engine writes to D1 (live since the merge). Built: the Worker's `POST /api/internal/db` (`worker/src/enginedb.ts`)
      runs a batch of statements on the `DB` binding behind `x-engine-key`; `engine/src/store.d1.ts`
      sends there when `ENGINE_DB_URL` is set (REST API otherwise). Still to do: deploy.yml setting
      `ENGINE_DB_KEY`, and the workflows' env.
- [x] Postgres-only SQL in the engine ported: `archiveSnapshots` has a SQLite version
      (`json_object`, `->`), `restoreCalledFixtures`, the `former_member` purge and settle's
      `UPDATE ... FROM` now run on both. Still Postgres-only, and fine to leave until stage 2:
      `grant.ts`, `trace.ts` (reads auth.users), `recordreset.ts`, and the lab.
      Original note: Known spots: `slate.ts` around line 1590
      (the market snapshot uses `jsonb`, `LATERAL`, `extract(epoch)`), and the `config.dbBackend ===
      'postgres'` branches in `slate.ts` and `settle.ts`.
- [x] Worker serves the public endpoints from D1 (live). Built: `worker/src/d1read.ts` rebuilds every
      get_* function (plus `fixture_preview`, `record_view`, and a signed-out `get_account`);
      `rpc()` in `worker/src/index.ts`, `read()` in `seo.ts` and `social.ts` use it whenever the
      `DB` binding exists. Verify with `pg.yml` command `db:verify` (`engine/src/d1verify.ts`): it
      loads the export into a throwaway Postgres and a local SQLite and compares every answer
      field by field, printing paths only. **Passed on the real export** (run 37560367756): all 658
      fixture pages, 170 player pages, picks, slip, hero, plans, promos, how-sure and previews are
      identical; board, team, competition, pulled and search lists hold the same rows, some in a
      different order where Postgres broke ties arbitrarily (D1 breaks them by id).
      Name order uses case-insensitive sorting, so `get_leagues` may differ in order only.
      Original note: each Postgres function the Worker calls through
      PostgREST is reimplemented over the `DB` binding: `get_board`, `get_fixture`, `get_picks`,
      `get_hero`, `get_health`, `get_slip`, `get_plans`, `get_promos`, `get_model`, `get_league`,
      `get_leagues`, `get_player`, `get_team`, `get_record`, `get_how_sure`, `get_pulled`,
      `search_games`. Verify each by diffing its JSON against the Postgres function on the same
      exported data.
- [x] Workflows switched to `DB_BACKEND=d1` (on main): slate, slate, settle, ratings,
      images, cards, renew, backtest and bootstrap (`ENGINE_DB_URL=https://offside.win/api/internal/db`,
      `CF_API_TOKEN`). The slate loop is every 30 minutes (`SLATE_LOOP_EVERY`), because each query
      is a Worker request and 15-minute passes alone would use the 10M a month in the plan.
      deploy.yml now applies `schema.sql` to D1 and pushes `ENGINE_DB_KEY`. Takes effect on merge.
- [x] Deployed and checked live: every page at 390px and 1440px (`.claude/skills/ui-verify`).

Stage 2, accounts:
- [x] Sessions issued by the Worker (PR #155), and the 6 accounts carried over (`db:accounts`).
- [x] Share cards and team photos off Supabase Storage: D1 `image` table (part 2).
- [x] Membership, Whop webhook and sweep, entitlements, goodwill, pulled-call alerts and
      account deletion over D1 (part 2).
- [x] Admin dashboard and support tickets over D1 (part 2).
- [ ] After part 2 is live: sign in by email and by Google on the phone, open `#/admin`, check
      `/api/pay/status` shows `database: d1` and a recent `last_sweep`, and the next `cards` run
      draws cards.
- [ ] Supabase removed: secrets, `schema.pg.sql` kept for reference or deleted, and docs updated.

### Design for D1, and why

- **The Worker may parse now.** The "parse nothing, stream one Postgres function's bytes" rule in
  older notes came from the free plan's 10 ms CPU limit. The account is on Workers Paid now
  (30 seconds of CPU), so building a response in the Worker from D1 rows is fine. Keep large
  pre-rendered JSON as stored text (`fixture.bundle_json` and the like) and splice it in rather
  than re-serialising it.
- **The engine reaches D1 through the Worker, not the REST API.** The plan is an internal
  endpoint (`POST /internal/db`) that runs a batch of statements on the `DB` binding, guarded by a
  shared secret derived from an existing Actions secret. No new secret is needed, and the owner
  cannot easily add one from a phone. This avoids the REST API's rate limit and makes one request
  per batch instead of per query.
- **Read less, whatever the database.** The engine should not re-read all match history every
  15 minutes. It should keep what it needs between passes (Actions cache or a summary table) and
  run the full pass less often when no match is near.

### Other things in flight

- **PR #154, support tickets:** open and not merged. It needs Supabase (see stage 2).
- **Support mail:** support@ and hello@offside.win forward to the owner's iCloud through
  Cloudflare Email Routing (set 6 October with `mail:route`). This works and does not depend on
  Supabase.
- **Gemini:** the free daily quota for the analysis writer resets at 08:00 UK time. When it is
  spent, `narrate/rescue.ts` writes a paragraph from the insight reads.
- **Bet slip:** since 6 October it is built surest call first, then the longest prices. Lab study
  `deep slip study`: it came in 67% against 50%.

---

## The owner

- **Works from a phone only.** Never hand back steps that need a computer. Trigger workflows and
  read their logs yourself (GitHub MCP tools, or `gh api`).
- **Wants plain answers.** Say what happened and what it means; keep internals out of replies.
- **Ask before merging a PR, before writing to the live database, and before anything outward-
  facing.** The owner says "merge" when they want a merge.
- **Is cost-sensitive:** prefers free options and declined iCloud+ and Supabase Pro.
- **Commits:** author `xlr8-bl2 <ashleymbah56@gmail.com>`. No model names in commits, PRs or code.
- **Standing rules are in `CLAUDE.md`.** Secrets stay in Actions secrets and never go in chat; the
  repository is public, so logs print shapes, never values. Read the `offside-ui`, `offside-voice`
  and `ui-verify` skills before any user-facing change. There is also the list of dev tooling to
  remove at launch.
- **Never** present backtested results as the published record, and never publish a profit claim.
  The public record restarted with the new engine on 6 October 2026 (`record:reset`; old rows are
  in the `*_archive` tables).

## How it fits together

- **`engine/`** (TypeScript, runs on GitHub Actions) fetches the sports data provider (`BSD_API_KEY`),
  rates teams, analyses upcoming matches, chooses calls, writes the analysis (Gemini, with
  fallbacks), settles results and builds the bet slip. Entry point `engine/src/run.ts`; commands are
  exposed through `pg.yml` (`command` plus `arg`).
- **`worker/`** (Cloudflare Worker `offside-win`) serves `public/` and `/api/*`, the Whop webhook
  and sweep, emails (`mail.ts`), the admin API (`admin.ts`), live scores (`live.ts`) and SEO pages
  (`seo.ts`). Deployed by `deploy.yml` on push to `main` and daily.
- **`public/`** is the front end: plain ES modules, no framework, no build beyond
  `scripts/build-public.mjs` (versioning and minifying into `dist/`). Hash router in `public/app.js`.
- **Database today:** Supabase Postgres, `schema.pg.sql` (40 tables, 62 functions, RLS on every
  table). Being replaced by D1; see above.
- **Workflows** (`.github/workflows`):

  | Workflow | When | What |
  |---|---|---|
  | `slate.yml` | every 15 min, loops for 5.5 h | analysis and calls |
  | `settle.yml` | hourly at :25 | results |
  | `cards.yml` | :07 and :37 | social cards |
  | `ratings.yml` | 04:00 and 16:00 | ratings |
  | `images.yml` | 04:40 | images |
  | `renew.yml` | 06:10 | renewals |
  | `deploy.yml` | push to `main`, 03:15 | deploy |
  | `pg.yml` | manual | any engine command |
  | `ci.yml` | pull requests | tests |

- **Secrets** (names only): `BSD_API_KEY`, `SUPABASE_DB_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
  `SUPABASE_SERVICE_KEY`, `SUPABASE_ACCESS_TOKEN`, `CF_API_TOKEN`, `CF_ACCOUNT_ID`,
  `CF_D1_DATABASE_ID` (from September), `GEMINI_API_KEY`, `WHOP_API_KEY`, `WHOP_WEBHOOK_SECRET`,
  `SPORTRADAR_GETTY_KEY`, `BREVO_API_KEY` (empty), `COINFLOW_*` (unused).
  - `CF_API_TOKEN` currently has: Workers Scripts, D1, Zone Settings (edit), Analytics, Email
    Routing Rules (edit), Email Routing Addresses (edit) and DNS (edit).
- **Tests:** `npm test -w engine` and `npm test -w worker`; typecheck with `npm run typecheck -w …`.
  `engine/test/schema.test.ts` enforces RLS and grants on the Postgres schema. It needs a D1
  equivalent once the move is done.

## Recent work, newest first

- **6 to 7 October:**
  - #154 (open): support tickets.
  - `mail:route`, so support@ and hello@ forward to the owner.
  - #153: the analysis leads with the insight reads, with a fallback paragraph built from them.
    Picks are laid out like a bookmaker's slip (selection, market name, "If the final result
    is / Your bet" table). The bet slip is built surest call first, then the longest prices.
- **6 October:**
  - #152: the results line.
  - #151: the record reset to the new engine.
  - #150: Whop pixel behind consent.
  - #149: SEO events JSON-LD.
  - #148: engine lab findings, the hold rule and honest no-call reasons.

---

## History and things worth not re-deriving

These notes date from September, when the project moved from D1 to Supabase. Some describe
constraints that no longer apply: the 10 ms CPU limit and D1's free-tier write cap are gone on
Workers Paid. They are kept because the reasoning still matters.

**Why it left D1 in September.** D1's *free* tier caps daily row writes, and an 88-league backfill
exhausted it in 27 minutes. On Workers Paid the allowance is 50 million rows written a month, so
that reason no longer holds. `6f8be39` is the cutover commit; its message explains the old read
path.

**Actions is blocked on the original account** (`xlr8-bl`). Runs there end in seconds with no
runner and no logs. That is why the project moved to `xlr8-bl2/offside-win`. It is not a code
problem.

**A workflow must be modified on the default branch before it can be dispatched.** A workflow
file that has never been changed on `main` returns a bare 404 when dispatched. A new workflow file
pushed only on a branch cannot be dispatched until it reaches `main`, so add a command to `pg.yml`
instead; `pg.yml` dispatched with `ref` set to a branch runs that branch's copy.

**The root package.json must forward every script a workflow calls.** Add any new engine command
to both `engine/package.json` and the root `package.json`, and to `pg.yml`'s `options`.

**D1 caps bound parameters at 100 per query.** `insertMany` chunks on that
(`config.d1.maxParams`).

**Rendering the UI in a sandbox:** serve `public/` locally and proxy `/api/*` through Node
(`.claude/skills/ui-verify/scripts/serve.mjs`); Chromium cannot reach the live site through the
egress proxy. Never disable certificate verification.

**Tracking is what everything reads.** `ratings`, `slate` and `backtest` work from
`league.tracked = 1`. If something that worked yesterday reports nothing today, check `tracked`
first.

**The provider's own model is the bookmakers' price.** A head-to-head and a de-vig comparison in
September showed the provider's model sits within one point of the de-vigged market, while ours
was about 8.5 points away. Do not compare our multi-binary log loss (0.62) with their three-way
one (1.01); they are different quantities. The number that decides whether there is a business is
our calls against the closing price, which `pick.closing_odds` and `clv` accumulate as calls
settle.

**Pitch condition is never populated before kick-off.** Leave `PITCH_SCALE_MAX` unset.

**Odds are only served near kick-off.** Before deciding an empty `results: []` means the tier is
not entitled, check how far out the fixture is.
