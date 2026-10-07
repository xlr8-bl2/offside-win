# Handoff: read this first

**Last updated:** 7 October 2026, 02:10 UTC, by the Claude Code session working on branch
`claude/offside-win-context-sync-6k7yi7`.

**Keep this file current.** The owner may move the work to a different coding agent or account
at any time. Whoever is working updates the "Right now" section and the checklist after every
meaningful step, and commits it with that step, not at the end of the day.

---

## Right now

### The site is down: Supabase has blocked the project

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

### Cut-over: how stage 1 goes live

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
- [ ] `db:import`: built (`engine/src/d1import.ts`, statements from `engine/src/d1load.ts`). Run
      `pg.yml` with command `db:import` (input `export_run`, default the run above): it finds or
      creates the D1 database `offside` (`engine/src/d1setup.ts`, `d1:create`), applies
      `schema.sql`, empties and refills every table over the REST API's batch form, and reads the
      counts back. Trial run 37559421357 (export 37557342873): every table landed, counts equal,
      67 seconds. Run it again with a fresh export at the cut-over.
- [ ] Engine writes to D1. Built: the Worker's `POST /api/internal/db` (`worker/src/enginedb.ts`)
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
- [ ] Worker serves the public endpoints from D1. Built: `worker/src/d1read.ts` rebuilds every
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
- [ ] Workflows switched to `DB_BACKEND=d1`: done on the branch for slate, settle, ratings,
      images, cards, renew, backtest and bootstrap (`ENGINE_DB_URL=https://offside.win/api/internal/db`,
      `CF_API_TOKEN`). The slate loop is every 30 minutes (`SLATE_LOOP_EVERY`), because each query
      is a Worker request and 15-minute passes alone would use the 10M a month in the plan.
      deploy.yml now applies `schema.sql` to D1 and pushes `ENGINE_DB_KEY`. Takes effect on merge.
- [ ] Deployed and checked live: every page at 390px and 1440px (`.claude/skills/ui-verify`).

Stage 2, accounts:
- [ ] Sessions issued by the Worker: email link sent through Cloudflare Email Service, which
      already sends the site's mail (`worker/src/mail.ts`); Google sign-in (`GOOGLE_CLIENT_ID` is
      already a Worker variable). The 6 existing accounts are carried over by email.
- [ ] Membership, Whop webhook and sweep, entitlements, goodwill, pulled-call alerts and
      account deletion over D1.
- [ ] Admin dashboard and support tickets over D1. PR #154 (support tickets) is built on Supabase
      and **not merged**. Port it rather than merging it as it stands.
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
