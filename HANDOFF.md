# Handoff

Read this if you are picking the project up in a session scoped to
**`xlr8-bl2/offside-win`**. It is the account whose Actions actually run.

## Where things stand

The code is complete: 50 tests pass, both projects typecheck, and it is deployed nowhere yet.
`README.md` explains the architecture and `SETUP.md` the setup.

`xlr8-bl2/offside-win` was created with GitHub's importer from `xlr8-bl/offside-win`. An import is
a one-time copy, not a live link, so **this repo may be behind**. The upstream is public, so
syncing needs no credentials:

```bash
git fetch https://github.com/xlr8-bl/offside-win claude/offside-win-context-model-ehx2ik
git merge FETCH_HEAD          # fast-forward; the histories are shared
git push
```

## What has never been verified

**No part of this has touched the live provider API.** It was written without a key. Every field
the provider types as `any` — `weather`, `head_to_head`, `unavailable_players`,
`appointment_effect`, prediction `markets` — is read through alias lists in
`engine/src/history.ts` and `engine/src/context/gather.ts`, returning `null` on a miss rather than
guessing or zeroing.

**The first real job is to run the `probe` workflow and read its log.** It prints the actual field
shapes and which endpoints the account's tier serves. Then tighten those alias lists against what
came back, and set a repository variable `PITCH_SCALE_MAX` from the observed range so §6.3 stops
reporting itself as unusable.

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

## Three things worth not re-deriving

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

**The backtest is the claim.** The model must beat both a naive Poisson and the league base rate on
log loss. Until it has run, the model page says outright there is no evidence any of this works —
keep it that way rather than softening it.
