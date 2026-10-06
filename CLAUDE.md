# offside.win — notes for Claude

## Before launch: remove all the dev tooling

The owner asked for this to be remembered. Everything below exists only so the
site could be built and checked from a phone. None of it should ship to real
customers. Remove it (code, routes, workflow options, docs) in one pass when
the owner says the site is going live, and confirm the list with them first.

- `#/dev` page (`viewDev()` in `public/app.js`) and its route.
- The "view as a free reader" switch: `setViewAs` / `viewingAsFree` in
  `public/js/lib/auth.js`, the `viewas-pill` in the header, and every
  `viewingAsFree()` check.
- The `grant` command, which gives a membership for free (`engine/src/grant.ts`,
  `run.ts`, and the `grant` option and `GRANT_*` variables in
  `.github/workflows/pg.yml`). Keep `plans` if checkout links are still set
  from there.
- The `whop:check` command (`engine/src/whopcheck.ts`, its `run.ts` entry,
  the npm scripts, and the `whop:check` option and `WHOP_*` variables in
  `pg.yml`).
- The `gemini:check` command (`engine/src/geminicheck.ts`, its `run.ts` entry,
  the npm scripts, and the `gemini:check` option and `GEMINI_*` variables in
  `pg.yml`; the slate's own `GEMINI_*` settings stay).
- Preview and probe workflows: `narrate-preview.yml`, `poster-preview.yml`,
  `probe.yml`, `supabase-check.yml`, and the `probe*` commands (`run.ts`
  entries, npm scripts, the `probe:players` / `probe:profile` / `probe:reds` / `probe:extras` options in
  `pg.yml`), then `engine/src/probe.ts` once nothing imports it.
- Stray local preview helpers are not in the repo; nothing to do there.

Not dev tooling, and stays at launch: the `#/trace` page (`viewTrace()`) and
the `trace` command (`engine/src/trace.ts`, the `trace` option in `pg.yml`).
They turn a leaked pick's hidden code back into the account that copied it.
`mail:setup` (`engine/src/mailsetup.ts`) is setup, not dev tooling, and stays too:
it re-checks Brevo's DNS records and sends a test email. `mail:auth` (`engine/src/authmail.ts`)
is setup too and stays: it switches Supabase's sign-in emails to the Worker's designed ones
(`worker/src/authhook.ts`) or back. So does the admin dashboard's "send me every email" test.
The admin dashboard (`#/admin`, `public/js/admin.js`, `worker/src/admin.ts`, the
`admin_*` functions and `promo` table in `schema.pg.sql`) is the owner's tool and
stays at launch. So does support (`#/admin/support`, `worker/src/support.ts`, the
Worker's `email` handler, `support_ticket` / `support_message` and `support_inbound`):
mail to support@ and hello@ becomes tickets the owner answers as support@. `mail:route`
(`engine/src/mailroute.ts`) is setup and stays: `worker` routes those addresses to the
tickets, an email address routes them straight to that inbox instead. Its "give free time" replaces the `grant` command for everyday
use. Only the account whose email hashes to `ADMIN_EMAIL_SHA256`
(`worker/wrangler.toml`) can use it.

## Standing rules

- The owner works from a phone only. Trigger workflows and read logs yourself;
  never hand back steps that need a computer.
- Secrets go in GitHub Actions secrets, never in chat. The repo is public, so
  logs print field shapes, never payload values.
- RLS on every Supabase table; the anon key is public. `engine/test/schema.test.ts`
  enforces it.
- Read `.claude/skills/offside-ui`, `offside-voice` and `ui-verify` before any
  user-facing change.
