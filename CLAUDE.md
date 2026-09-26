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
  `probe.yml`, `supabase-check.yml` (and `engine/src/probe.ts` if nothing
  else imports it).
- Stray local preview helpers are not in the repo; nothing to do there.

## Standing rules

- The owner works from a phone only. Trigger workflows and read logs yourself;
  never hand back steps that need a computer.
- Secrets go in GitHub Actions secrets, never in chat. The repo is public, so
  logs print field shapes, never payload values.
- RLS on every Supabase table; the anon key is public. `engine/test/schema.test.ts`
  enforces it.
- Read `.claude/skills/offside-ui`, `offside-voice` and `ui-verify` before any
  user-facing change.
