# Setup, from a phone

Nothing here needs a computer. Wrangler only ever runs inside a workflow, so the database and the
Worker are both created from a browser. Roughly 15 minutes.

Work through it in order — later steps need values from earlier ones.

---

## 1. Provider key

1. [sports.bzzoiro.com/register](https://sports.bzzoiro.com/register/) — register, free.
2. Account page → copy the API key.

Keep it somewhere you can paste from. Call this **BSD_API_KEY**.

---

## 2. Cloudflare

All in the dashboard at [dash.cloudflare.com](https://dash.cloudflare.com). If a menu name has moved,
use the dashboard search — the product names below are stable even when the navigation is not.

### Account ID

It is in the right-hand sidebar of the account home page, and also in the dashboard URL itself:
`dash.cloudflare.com/<this-is-your-account-id>`.

Call this **CF_ACCOUNT_ID**.

### Database

**Storage & Databases → D1 SQL Database → Create database.**

- Name it exactly `offside-win`. The Worker config looks it up by that name.
- Leave the location on automatic.

Open it once created and copy the **Database ID**.

Call this **CF_D1_DATABASE_ID**.

> Do not create any tables. The deploy workflow applies `schema.sql` for you.

### API token

**My Profile → API Tokens → Create Token → Create Custom Token.**

Give it these two permissions, both at Account level:

| Type | Resource | Access |
|---|---|---|
| Account | D1 | Edit |
| Account | Workers Scripts | Edit |

Set Account Resources to the account you just took the ID from. Create it, then copy the token —
**it is shown once and never again.**

Call this **CF_API_TOKEN**.

---

## 3. Copy the repo to your working GitHub account

Sign in to the account whose Actions are **not** blocked.

Go to **[github.com/new/import](https://github.com/new/import)**.

| Field | Value |
|---|---|
| Your old repository's clone URL | `https://github.com/xlr8-bl/offside-win` |
| Owner | the working account |
| Repository name | `offside-win` |
| Visibility | **Public** |

Press **Begin import** and wait for it to finish.

### Two things that matter here

**Import, not fork.** GitHub does not run scheduled workflows in forks — it is a deliberate security
measure, and people find them disabled again even after switching Actions on. An import creates a
real, unlinked repository where schedules behave normally.

**Public, not private.** On a private repo Actions minutes are metered at 2,000 a month, and this
schedule needs roughly 5,000 — the slate alone runs 1,440 times a month. Public repositories get
unlimited free standard runners, which is what the cadence assumes.

---

## 4. Add the four secrets

On the new repo: **Settings → Secrets and variables → Actions → New repository secret.**

Add all four, named exactly:

```
BSD_API_KEY
CF_ACCOUNT_ID
CF_D1_DATABASE_ID
CF_API_TOKEN
```

That is the entire configuration. Nothing is set on Cloudflare's side.

---

## 5. Check the provider works

**Actions** tab. If it offers a green "I understand my workflows, go ahead and enable them" button,
press it.

Run **probe** → *Run workflow*.

It needs only `BSD_API_KEY`, so it is the cheapest way to find out whether your key works before
anything else depends on it. When it finishes, open the run and read the log. You are looking for:

- **Print inferred shapes** — the field names and types the provider actually returns.
- **Endpoint availability** — which endpoints your tier serves. Some are expected to be missing on
  the free tier; the model reports them as unavailable rather than guessing, and picks them up on
  its own if you ever upgrade.

If this fails with an authentication error, the key is wrong. Fix it before going further.

---

## 6. Deploy the site

Run **deploy** → *Run workflow*.

This creates the tables and publishes the Worker. When it finishes, the URL appears near the end of
the log — something like `https://offside-win.<your-subdomain>.workers.dev`.

The site will be empty. That is correct; there is no data yet.

---

## 7. Load the data

Run **bootstrap** → *Run workflow*.

Leave the inputs at their defaults unless you want fewer seasons of history. This is the slow one —
**expect 30 to 90 minutes**, most of it backfilling match history and fetching per-match statistics.

It runs four steps in order, and the order is load-bearing:

```
migrate  → create the tables
history  → backfill finished matches and their stats
ratings  → fit the team ratings
slate    → price the next 72 hours and publish the board
```

Running the slate before ratings exist publishes nothing on purpose: without our own numbers there
is no opinion worth publishing, so those leagues are skipped rather than falling back to the
bookmaker's price dressed up as analysis.

Reload the site when it finishes.

---

## 8. It now runs itself

| Workflow | When | What |
|---|---|---|
| `slate` | every 30 min | reprices the next 72h, republishes the board |
| `settle` | hourly | grades finished picks, updates calibration |
| `ratings` | daily, 04:00 UTC | backfills new results and refits |
| `backtest` | manual | walk-forward evaluation — run this to find out if the model is any good |
| `deploy` | on push | schema and Worker |

---

## Afterwards

**Run the backtest.** Until it has, the model page says outright that there is no evidence any of
this works, because there isn't. It must beat both a naive Poisson and the league base rate on log
loss; it prints the verdict either way.

**Read the probe output and set `PITCH_SCALE_MAX`.** The provider reports pitch condition as a bare
number with no documented scale, so that factor currently reports itself as unusable rather than
guessing which end means "heavy". Once you can see the range in the probe log, add a repository
*variable* (not a secret) called `PITCH_SCALE_MAX` and it starts contributing.

---

## If something breaks

**Runs finish in under 10 seconds with no logs.** Actions is blocked on that account — check the
banner on the Actions tab. This is what is happening on the original account. A real code failure
always produces logs.

**The board is stale.** Check `/api/health` on the site; it reports how long ago the data was last
computed. GitHub also disables scheduled workflows on repositories with no commits for 60 days.

**Everything runs but the board stays empty.** Ratings probably have not been fitted — run
`bootstrap` again with *skip_history* ticked, which refits without repeating the slow backfill.
