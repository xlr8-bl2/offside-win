# offside.win

Football market analysis. Fits its own team ratings, prices every market a bookmaker offers off one
distribution, and explains each call in language you can check against the evidence.

It is built to disagree with the price only when it has a reason to, and to say so plainly when it
does not. Most fixtures should return a pass.

---

## How it is put together

**GitHub Actions is the analyst. Cloudflare is the shop window.**

Cloudflare's free tier caps CPU at **10 ms per invocation — for cron triggers exactly as for HTTP
requests**. There is no longer-running free handler, so fitting ratings or building score matrices
cannot happen there. All modelling therefore runs on GitHub Actions, which is free and *uncapped*
on public repositories, and writes finished JSON to D1. The Worker reads those rows and returns
them.

Two consequences worth knowing:

- **The repo must stay public.** That is what makes Actions free. Making it private puts every
  workflow onto metered minutes.
- **The Worker holds no secrets.** It has a D1 read binding and nothing else. Your provider key and
  Cloudflare token live in Actions secrets.

```
GitHub Actions                          Cloudflare
┌──────────────────────────┐            ┌────────────────────┐
│ history  → match history │            │                    │
│ ratings  → Dixon-Coles   │─── D1 ────▶│ Worker (read-only) │──▶ browser
│ slate    → price + pick  │   REST     │ + static assets    │
│ settle   → grade + calib │            │                    │
└──────────────────────────┘            └────────────────────┘
```

---

## Setup

### 1. Create the database

```bash
npm install
npx wrangler d1 create offside-win      # note the database_id it prints
```

Nothing else is configured on Cloudflare. `worker/wrangler.toml` carries a placeholder that the
deploy workflow substitutes from a secret, so the id never sits in the repo.

### 2. Add four GitHub Actions secrets

Settings → Secrets and variables → Actions:

| Secret | Where it comes from |
|---|---|
| `BSD_API_KEY` | register at [sports.bzzoiro.com](https://sports.bzzoiro.com/register/) |
| `CF_ACCOUNT_ID` | Cloudflare dashboard sidebar |
| `CF_D1_DATABASE_ID` | printed by `wrangler d1 create` above |
| `CF_API_TOKEN` | Cloudflare API token with **D1 edit** and **Workers Scripts edit** |

That is the entire configuration.

### 3. Probe the provider before anything else

Run the **probe** workflow from the Actions tab (or locally with `BSD_API_KEY=... npm run probe`).
It needs only `BSD_API_KEY`, so it works before any Cloudflare setup exists.

This is not optional ceremony. The provider's OpenAPI types several of the fields this model leans
on hardest — `weather`, `head_to_head`, `unavailable_players`, `appointment_effect`, prediction
`markets` — as `any`. Every parser here reads them through alias lists and returns `null` on a miss
rather than crashing or, worse, returning zero. But the probe is what turns those guesses into
facts: it walks a real fixture end to end and writes both raw payloads and inferred shape sketches
to `probe-output/`.

It also tells you which endpoints your tier actually serves. Two things are known to sit behind the
paid tier and degrade to an explicit `UNAVAILABLE` rather than an error:

- per-bookmaker odds comparison (the sharp-reference read in §7.1)
- the `/wom/` money-flow endpoints

Both are detected at runtime and cached for a day, so buying the tier later lifts them on its own
with no code change.

Read `probe-output/event.sketch.json` and set `PITCH_SCALE_MAX` once you can see the pitch-condition
scale — until then §6.3 correctly reports itself as thin rather than guessing which end of an
undocumented integer means "heavy".

### 4. First run

Run the **bootstrap** workflow from the Actions tab. It does the whole first run in order:

```
migrate  → create the tables
history  → backfill finished matches and their stats   (the slow step)
ratings  → fit Dixon-Coles and the corner/card models
slate    → price the next 72 hours and publish the board
```

**The order is load-bearing.** A league with no fitted ratings is skipped by `slate`, deliberately:
without our own numbers there is no opinion to publish, and falling back to the bookmaker's price
dressed up as analysis would be worse than showing nothing.

Locally the same sequence is `npm run migrate && npm run history && npm run ratings && npm run slate`.

Then deploy: pushing to `main` runs the deploy workflow, which applies the schema and ships the
Worker.

> The repo was empty on first push, so GitHub made that branch the default. The workflows are
> already dispatchable from the Actions tab — nothing needs merging first.

After that the workflows run themselves:

| Workflow | Schedule | Does |
|---|---|---|
| `slate` | every 30 min | reprices the next 72h, republishes the board |
| `settle` | hourly | grades finished picks, refreshes calibration |
| `ratings` | daily 04:00 UTC | backfills new results, refits |
| `backtest` | manual | walk-forward evaluation |
| `deploy` | on push | schema + Worker |

> GitHub disables scheduled workflows on public repos after **60 days without a commit**. If the
> board goes stale, that is the first thing to check.

---

## Running the engine from a different GitHub account

Nothing here is tied to an account. The engine is Node 22 and `fetch` with five environment
variables, so moving it is a push and four secrets.

```bash
git remote add runner https://github.com/OTHER-ACCOUNT/offside-win.git
git push runner HEAD:main
```

Then on that repo: add `BSD_API_KEY`, `CF_ACCOUNT_ID`, `CF_D1_DATABASE_ID` and `CF_API_TOKEN`, and
run the **probe** workflow.

Both accounts can point at the same Cloudflare D1 database — the engine writes over the REST API
with an account ID and token, so where it runs is irrelevant to where the data lands.

### Make that repo public too

This is the part worth getting right. On a **private** repo Actions minutes are metered, and this
schedule does not fit in the free allowance:

| Workflow | Frequency | Runs/month | Rough minutes/month |
|---|---|---|---|
| `slate` | every 30 min | ~1,440 | 2,900+ |
| `settle` | hourly | ~720 | 1,400+ |
| `ratings` | daily | 30 | 900–1,800 |

A personal account gets 2,000 free minutes a month, so a private repo would blow through that in
under a week and then bill. **Public repos get unlimited free standard runners**, which is what this
schedule assumes.

If the repo has to be private, drop `slate` to hourly and `settle` to every three hours, and expect
to pay for the `ratings` backfill regardless.

### If Actions is blocked on an account

The symptom is unmistakable: runs complete in one to five seconds with **no runner assigned, no
logs, and no steps executed**. That is GitHub declining to schedule the job, not a failure in the
code — a genuine code failure produces logs. The Actions tab shows the reason as a banner; it is
usually a failed payment, which blocks Actions account-wide regardless of whether the repository
is public.

---

## What it actually does

### Ratings

Dixon-Coles fitted per league by maximum likelihood:

```
λ_home = exp(μ0 + γ + att_home − def_away)
λ_away = exp(μ0     + att_away − def_home)
```

with time decay, the low-score correction, sum-to-zero constraints, ridge shrinkage toward the
league mean, and standard errors carried forward so later stages know how well each team is known.
Goals-fitted and xG-fitted ratings are blended, with the xG weight halved where the provider flags
its xG estimated rather than measured.

Two things found while validating it against synthetic seasons, both of which changed the code:

- Adam at a fixed learning rate never settles — it orbits the optimum at a radius of about `lr`. On
  data generated with ρ = 0 exactly it recovered ρ = 0.089, an invented dependence the same size as
  the real effect. Fixed with a decay schedule and gradient-norm convergence.
- Even with a correct optimiser, ρ is barely identified by one league's history: only 0-0, 1-0, 0-1
  and 1-1 inform it, so a season gives about ±0.07. A grid search confirmed +0.089 genuinely *was*
  that sample's MLE. Left alone the fitter adopts noise of the wrong sign, pushing probability away
  from score draws — worse than no correction at all. There is now a negative prior the data has to
  earn its way off.

Corners use a negative binomial, not a Poisson: they cluster, so their variance runs above their
mean and Poisson tails would be too thin exactly where the over/under lines sit. Red cards are a
heavily shrunk Poisson, with the referee multiplier gated at 30 matches.

### Context

Eight modules implement the Context Model document, running in its own hierarchy order. Each emits
a **bounded multiplicative adjustment** to a rate plus the raw evidence behind it, so the same
object drives the model, the ledger and the prose.

Where the doctrine is counter-intuitive it is followed literally rather than rounded off:

- Derbies raise cards and BTTS but **not** total goals — derbies run cagey about as often as chaotic.
- Wind raises corner *volume* while lowering goals: teams hit it longer, so the count rises and the
  conversion falls.
- Absences are sized by the player's measured share of his team's league goals and damped by cover at
  his position — not a flat "star out" constant that treats a 25-goal striker and a squad forward
  alike.
- The new-manager bounce applies inside its window and deliberately not outside it.

Market signals never touch λ. If the price fed back into our rates the model would converge on the
bookmaker's number and this would become an expensive way to reprint the odds.

### Evidence states

Every factor is `COMPUTED`, `THIN` or `UNAVAILABLE`, enforced by construction — the constructors for
thin and unavailable factors physically cannot carry an adjustment. Thin and unavailable factors are
still shown, in place, on the fixture page. A fixture we know little about should look like one.

### Selection

Ranks across every market, not just 1X2, and answers two different questions:

- **VALUE** — the biggest mispricing after shrinkage.
- **LIKELY** — the highest-probability outcome that is not badly priced. Sorting by probability alone
  would return "over 0.5 goals" on every fixture ever played, at a price nobody would take.

Edges are shrunk by how wrong the model has actually been on that market family, measured by
settlement. Without that, raw edge ranking quietly becomes a corners-and-cards tipping service,
because the biggest apparent edges cluster in the markets the model understands least.

A pass is a result, not a failure, and names the nearest miss and why it failed the gate.

### Narration

A generative phrase grammar — no language model. Two rules do the work: vary sentence *structure*
rather than vocabulary, since shape is what readers recognise; and every number comes from the
claim's evidence map, so a sentence physically cannot cite a figure the model never computed.

> Under 2.5 goals at 2.05. Foden's suspension substantially weakens Manchester City, removing 21% of
> the goals they have scored this season. Alongside it, congestion bites here: 3 matches already
> inside a week for Brighton, and 2.4 days before this one. The 6.0-point difference between our
> 58.0% and the book's 52.0% is what makes this worth taking.

Honest limitation: this is a template system underneath, and a daily reader will eventually start
recognising shapes. Frames are seeded per pick so regenerating a slate does not rewrite yesterday's
reasoning, and a repetition ledger spanning the whole board stops two fixtures opening the same way.

---

## Is it any good?

`npm run backtest` walks forward without ever letting the model see the match it is predicting, and
scores against a naive Poisson and the league base rate. **If it does not beat both on log loss, the
extra machinery is decoration and should not be trusted** — the model page prints that verdict either
way.

It reports **no ROI**. That needs historical closing prices we do not hold, and a backtested return
from reconstructed odds would be the most flattering and least trustworthy number on the page.
Returns come only from real settled picks, on the picks page, flat-staked.

---

## Development

```bash
npm test          # 50 tests
npm run typecheck # engine and worker
npm run dev       # wrangler dev
```

The tests that matter: the fitter recovering known ratings from synthetic seasons; every goals market
agreeing *exactly* with the score matrix it came from; Asian quarter-line push settlement; Shin
shading longshots harder than proportional de-vigging; narration citing only numbers that exist.

### Layout

```
engine/src/
  bsd.ts store.ts ledger.ts config.ts types.ts
  history.ts  ratings/{dixoncoles,blend,rates,fit}.ts
  price.ts devig.ts odds.ts
  context/{availability,stakes,manager,fatigue,style,referee,environment,market}.ts
  select.ts narrate/{grammar,compose}.ts
  slate.ts settle.ts backtest.ts run.ts
worker/src/index.ts     # reads D1, computes nothing
public/                 # board, fixture, picks, model
```

Tunables live in `engine/src/config.ts`, overridable by environment variable. Values marked `FITTED`
are starting points the backtest is meant to replace.

## Deliberate gaps

- **§6.3 pitch condition** — recorded but inert until `PITCH_SCALE_MAX` is set from probe output.
- **§4.2 press matchup** — needs PPDA and defensive line height, which the fitting set does not
  carry. Possession correlates with pressing but is not it, and substituting it would produce a
  confident sentence about something unmeasured.
- **Player-prop factors** (§2.2, §2.5, §2.6) — the provider carries no player-prop markets, so there
  is nothing to bet on them.
- **NBA (Part Two)** — the basketball feed has no injury endpoint, and the scheduled injury report is
  the whole NBA edge.

## Note

This produces analysis, not advice. A pass is the model working correctly.
