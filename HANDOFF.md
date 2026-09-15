# Handoff

Read this if you are picking the project up in a session scoped to
**`xlr8-bl2/offside-win`**. It is the account whose Actions actually run.

## Where things stand

Live and running. The site is at <https://offside-win.ashleymbaht.workers.dev>, all eight
workflows are registered and green on schedule, and 100 tests pass.

**The data lives in Supabase, not D1.** The engine writes to Postgres over the session pooler;
the Worker reads through PostgREST with the anon key, confined to reading by row-level security
and SELECT-only grants declared in `schema.pg.sql`. D1 is still reachable with `DB_BACKEND=d1`
for comparison, but nothing is scheduled against it and the site no longer reads it.

Why the move: D1's free tier caps daily row writes, and an 88-league backfill exhausted it in 27
minutes. The same work on Postgres wrote 66,782 rows in 402 queries. The tracked set is now every
league the provider covers.

**The Worker parses nothing.** Each endpoint calls one STABLE function in `schema.pg.sql`
(`get_board`, `get_fixture`, `get_picks`, `get_model`, `get_health`) that returns the finished
response body as a single json value, and the Worker streams those bytes straight through.
Reassembling a 300-fixture board in the Worker would blow Cloudflare's free-tier budget of 10 ms
of CPU per request. If you add an endpoint, add a function — do not add a JSON.parse.

**The backtest passes.** 0.6200 log loss over 34,210 matches across 64 leagues and 1,554 refits,
against a naive Poisson baseline it beats decisively and a base rate of 0.6277 it beats by
~0.008. That last figure is the honest one: the model is better than guessing the base rate, and
not by much yet. Run `backtest` after any change to pricing or context.

## What has never been verified

**No part of this has touched the live provider API.** It was written without a key. Every field
the provider types as `any` — `weather`, `head_to_head`, `unavailable_players`,
`appointment_effect`, prediction `markets` — is read through alias lists in
`engine/src/history.ts` and `engine/src/context/gather.ts`, returning `null` on a miss rather than
guessing or zeroing.

**The first real job is to run the `probe` workflow and read its log.** It prints the actual field
shapes and which endpoints the account's tier serves. Then tighten those alias lists against what
came back.

### What the probe found when it was finally run

The alias lists largely survived contact. `expected_goals` and `xg.actual` both arrive on finished
matches and both are in the list; `xg.estimated` is a **flag, not a value**. Cards come back `null`
even on a finished match, so `extractCardsFromIncidents` is not a fallback for odd feeds — it is the
only path that ever populates cards, and the incidents feed does carry them.

**`PITCH_SCALE_MAX` cannot be set, and the instruction to set it should not be followed.** The
probe measured `pitch_condition` across 400 upcoming fixtures: it is populated on **none** of them.
It carries a number only on fixtures already played, which is exactly when §6.3 can no longer use
it. So there is no observed range to read a scale from, and §6.3 is inert for want of data rather
than for want of configuration. Setting the variable to a guessed maximum would activate a real
price adjustment on a field that is always absent at pricing time. Leave it unset; the factor
correctly reports itself unavailable. Revisit only if the provider starts populating it pre-match.

**Odds are served, but only near kickoff.** An early sample said 0 of 30 leagues carried any odds,
including the Premier League, which reads like a tier problem and is not one: it was sampling each
league's *first* fixture in a five-day window. Sampling each league's *soonest* fixture instead
gives 24 of 30 leagues priced — La Liga, the Championship and the Carabao Cup all at 62 rows. Before
concluding anything about entitlement from an empty `results: []`, check how far out the fixture is.

## The user

Works entirely from a phone and cannot run anything locally. Do not hand back instructions that
assume a terminal, and prefer triggering workflows and reading logs directly over asking them to
tap through the Actions UI.

The four secrets are already set on this repo. They are not readable — GitHub only decrypts them
inside a running job — which is correct and not a problem to solve.

## Running it

After syncing, setup is complete and the system starts itself: every entry point applies the schema,
and the pricing run cold-starts by backfilling and fitting when it finds no ratings. To see it
sooner rather than waiting for a schedule, trigger in this order:

```
probe      ~1 min    does the provider key work, and what shapes come back
deploy     ~2 min    creates tables, publishes the site, prints its URL
bootstrap  30-90 min full history, ratings, first board
backtest   manual    the only evidence the model works — run it
```

## Things worth not re-deriving

**Actions is blocked on the original account** (`xlr8-bl`). Runs there end in seconds with no
runner, no logs and no steps. That is why the project moved accounts. It is not a code problem.

**Workflows must be touched before they exist.** `xlr8-bl2/offside-win` was created with GitHub's
importer, which copies workflow files into git without registering them with Actions. An
unregistered workflow is invisible to the API: it is not listed by `list_workflows`, and
dispatching it returns a bare `404` whether you aim at the default branch or any other. It becomes
real only once a push has **modified that file** on the default branch — merging commits that
leave the file untouched is not enough, which is why the first sync registered only the workflows
it happened to change. All eight have since been touched, so this should not recur. If a new
workflow ever 404s on dispatch, this is the reason, and the fix is a one-line edit to it on the
default branch — not permissions and not secrets.

**The root package.json must forward every script a workflow calls.** `bootstrap` died immediately
on `Missing script: "migrate"`: the root forwarded probe, history, ratings, slate, settle and
backtest to the engine workspace but not migrate, though `engine/package.json` defines it. `deploy`
applies the schema through wrangler instead, so it never noticed, and the gap stayed invisible until
a workflow actually ran. Fixed, but check the whole list if a new entry point is ever added.

**D1 caps bound parameters at 100 per query, not SQLite's much larger limit.** `insertMany` chunks
on total parameters — the right shape — but with a ceiling of 480, so the first bulk write of the
backfill went out at 480 parameters and came back `7500: too many SQL variables`. Every bulk write
in the engine would have hit it. The cap now comes from `config.d1.maxParams`.

**The UI has now been rendered, and it works.** All four views were driven in Chromium at 390px and
360px against live data: board, picks, model and a fixture detail, with **no JavaScript errors** on
any of them. The page never scrolls sideways at either width — the wide stats tables live in
`.scroll` containers (`overflow-x: auto`, `table { min-width: 560px }`), so they scroll inside
themselves, which looks like a clipped column in a screenshot and is the intended behaviour rather
than a layout bug. The model page carries the real backtest verdict and still refuses to print an
ROI; the picks page still says 0 settled picks is too few to judge.

To render it yourself in a sandbox: the egress proxy re-terminates TLS and Chromium's own root store
does not pick up its CA, so the browser cannot reach the Worker directly. Serve `public/` from
127.0.0.1 and proxy `/api/*` through Node, which does trust the CA. Never disable certificate
verification to get around it.

**Tracking is what everything reads, and it is one fetch away from empty.** `ratings`, `slate` and
`backtest` all work from `league.tracked = 1`. A scheduled `history` run with no `LEAGUES` set,
firing while the provider quota was exhausted, discovered zero leagues and untracked all fifteen —
silently, in two log lines, taking ratings and the backtest down while the board carried on serving
its last good result. Narrowing now requires an explicit pin and a non-empty discovery, discovery
returning nothing is a hard error, and `ratings.yml` and `slate.yml` pin `LEAGUES` (override with a
repository variable of that name). If something that worked yesterday reports nothing today, check
`tracked` first.

**The backtest is the claim.** The model must beat both a naive Poisson and the league base rate on
log loss. Until it has run, the model page says outright there is no evidence any of this works —
keep it that way rather than softening it.

A backtest that scores **nothing** now says "No verdict" and exits non-zero, rather than announcing
that the model fails. Every comparison is `NaN` in that case and `NaN > 0` is false, so the empty
run used to fall straight into the failure branch and publish "Model does NOT beat the naive
Poisson" off zero matches — a far stronger claim than the data supports, and the opposite of the
honesty the rest of this document insists on. Distinguishing "no evidence" from "it failed" is not
softening the verdict; printing a verdict nobody measured is what would be. (That change, and the
report-path fix below, were committed under 9e7b0a8, whose message covers only the tracking bug.)

**`backtest-report.json` is written relative to `engine/`.** `npm -w engine run backtest` sets the
working directory to the workspace, so the old `engine/backtest-report.json` path resolved to
`engine/engine/…`, threw, and was swallowed by a bare `catch` — the upload step then only warned.
Same shape as the probe output-path bug; worth suspecting first whenever an artifact step warns that
it found no files.

**The provider's 86.7% is real, reproducible, and beats us — on the markets they publish.**
`npm run h2h` prices the same fourteen selections from both models over recent finished matches
and publishes under their rule: every market clearing a confidence bar, several to a match.
569 matches, walk-forward on our side:

| confidence bar | them | us | their calls/match |
|---|---|---|---|
| >= 80% | **86.3%** (384/445) | 80.3% (326/406) | 0.78 |
| >= 75% | **81.5%** (807/990) | 76.8% (677/882) | 1.74 |
| >= 70% | **77.9%** (1351/1735) | 75.3% (1264/1678) | 3.05 |

86.3% against the 86.7% their own page claims, from an independent sample, which is what says
the method is right and the claim is honest. At matched volume it holds: 86.2% to 80.3%.

**Our defect is specific and in the goal lines.** Per selection at the 80% bar: under 3.5 —
us 71.7% on 113 calls against their 75.6% on 45; over 1.5 — us 82.2% on 169 against their 86.6%
on 134; home-or-draw — us 88.3% against their 89.4%, near parity. So the double chance is fine
and the totals are not: we call goal lines more often, at higher stated confidence, and land them
less. A model saying 80%+ and hitting 71.7% is overconfident, not unlucky — Poisson totals are
too tight for real football, and the fix is over-dispersion in the totals distribution
(negative binomial or a Poisson mixture), not more context.

**What the hit rate does not say.** Break-even odds on their calls are 1.16, and double chance on
a strong home side prices 1.15-1.25. Their own page says so in the footer: "A confidence, not a
tip. We do not claim these beat the bookmakers'." Do not republish 86.7% without that caveat —
they are careful about it, and they are the ones with the better number.

**The provider's model is the bookmakers' price.** `npm run market` de-vigs live 1x2 quotes and
measures how far each model sits from the fair price, per outcome, over 87 upcoming fixtures:

| | distance from the de-vigged market |
|---|---|
| provider | **0.93 pts** |
| us | **8.52 pts** |

0.93 points is inside the noise of de-vig method choice. Their `dc-blend-v1` is the market with a
hat on, which explains all of it at once: an 86.7% hit rate (the market is well calibrated), every
`recommendations` flag false (nothing to recommend when you agree with the price), and their own
footer refusing to claim an edge. Their number is unbeatable on that scoreboard and worthless as
one, because a price cannot be bet into itself.

**Ours is genuinely independent, and that is not yet good news.** 8.52 points from the market is a
long way. Combined with a backtest that beats the league base rate by only 0.008 log loss, the
likeliest reading is that we are noisy rather than contrarian — a model with real information
would sit closer to the price and diverge *selectively*. Nothing here has established an edge, and
the distance alone is not evidence of one.

**Do not compare our 0.6200 to their 1.0102.** Repeated several times in this project and wrong
every time. 0.6200 is the mean of seven *binary* log losses (1x2 outcomes, BTTS, three goal
lines); 1.0102 is a *three-way categorical* log loss on 1x2 alone. A uniform guess scores 0.693 on
the first scale and 1.0986 on the second. They are not the same quantity and the comparison
flattered us every time.

**The test that decides whether there is a business** is our model against the de-vigged closing
price on finished matches — not against a base rate, and not on hit rate. It needs historical
odds, which are not stored. The `pick` table already carries `closing_odds` and `clv`, so settling
real picks accumulates it; that is the number to wait for before any claim is published.

**Six context factors are still dark**, losing 19 of the weight: `stakes.table` (6),
`manager.home` (5), `style.press_matchup` (3), `environment.pitch` (2), `environment.venue` (2),
`market.prediction_market` (1). `npm run board:stats` prints the current tally per factor.
`stakes.table` and `manager.home` had their parsers fixed and are still UNAVAILABLE, so the gap
is upstream of the parser — diagnose before writing more parsing code.
