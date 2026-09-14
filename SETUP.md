# Setup, from a phone

Nothing here needs a computer. Wrangler only ever runs inside a workflow, so the database and the
Worker are both created from a browser. Roughly 15 minutes.

Work through it in order — later steps need values from earlier ones. After the secrets are in,
the system starts itself; there is nothing to run by hand.

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

## 5. Wait

That is the whole setup. Nothing else needs pressing.

Within half an hour the pricing job runs on its schedule, finds an empty database, and builds what
it needs: it creates the tables, backfills a season of matches, fits the team ratings, then prices
the board. The site publishes itself on its own daily schedule.

| When | What happens |
|---|---|
| within 30 min | first pricing run — creates tables, backfills, fits ratings, prices the board |
| within a day | site published, history deepened to three seasons, results graded |
| every 30 min after | reprices as team news lands |

### Checking on it

**Actions** tab on the repo shows the runs. Green is fine. The first pricing run takes far longer
than the others because it is doing the backfill — that is expected, not a hang.

Once the site is up, `/api/health` reports how many fixtures are priced and how long ago the data
was computed.

### If you want to skip the wait

Every workflow can also be run by hand from the Actions tab — `probe` to check your provider key
in about a minute, `deploy` to publish the site immediately, `bootstrap` to do the full deep load
now rather than overnight. None of it is required.

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
