---
name: ui-verify
description: Render offside.win in a real browser and measure it, rather than reading the diff and hoping. Use this before committing any change to public/*.css, public/app.js, public/js/**, or public/index.html — every visual regression this project has shipped was invisible in the diff and obvious in a browser. Also use it when asked whether a page looks right, whether something is broken on mobile, or to check a redesign actually landed. Bundles a local server that proxies the live API and a checker that catches undefined CSS tokens, horizontal scroll, console errors, spreadsheet numbers and banned vocabulary in one pass.
---

# Verifying the UI

Reading CSS tells you what you wrote. A browser tells you what rendered. On
this project those have differed three times, and every time the diff looked
fine.

## Why this exists

**A commit claimed to fix two measured contrast failures and changed nothing.**
The page layer loads after `tokens.css` and had its own `:root` with the old
values. Same specificity, later wins. The fix was real and the cascade ate it.

**`.odds` rendered at inherited weight for a whole commit.** The type scale
dropped `--weight-black` deliberately; `components.css` still referenced it in
four places. An unresolved `var()` invalidates the entire declaration, silently
— no error, nothing obviously broken, just the price column on the main board
quietly losing its emphasis.

**Every fixture page scrolled three pixels sideways on a phone.** A button with
`white-space: nowrap` made its min-content width a floor the verdict, the panel
and then the document all had to honour. Three pixels is invisible until you
measure it, and it is on every page with a call.

None of these were catchable by reading. All three took under a minute to find
once something rendered the page and measured it.

## How to run it

Two terminals' worth of work, both backgroundable:

```bash
node .claude/skills/ui-verify/scripts/serve.mjs &
node .claude/skills/ui-verify/scripts/check.mjs '#/board' '#/fixture/213698' '#/pricing'
```

`serve.mjs` serves `public/` and proxies `/api/*` to the live Worker, because
Chromium cannot reach it directly from a sandbox — the egress proxy
re-terminates TLS and the browser's root store does not carry its CA. Node
does. **Never disable certificate verification to get around this.**

`check.mjs` drives each route at 1440px and 390px and reports:

- pages that rendered almost nothing
- horizontal scroll, in pixels, at any width
- sibling elements overlapping each other, including behind tabs
- `var()` references that resolve to nothing
- decimals on the page (the vocabulary rule bans spreadsheet numbers)
- banned terms
- console errors, ignoring the sandbox's own TLS failures

Widths and routes are arguments: `WIDTHS=1440,390,320 node ... '#/account'`.

## Seeing what a signed-out reader sees

The paywall only engages once the slate has written free copies, so on a fresh
deploy everything still looks paid. To see the real free view now:

```bash
FREE=1 node .claude/skills/ui-verify/scripts/serve.mjs &
```

That passes every API response through the engine's own `freeBoard` and
`freeBundle`, so the browser gets exactly what the redaction produces — not an
approximation of it.

## Attributing a regression rather than guessing

When something is wrong, find out whether you caused it before you start
fixing. Serve the committed version beside the working one:

```bash
rm -rf /tmp/old && mkdir -p /tmp/old
git archive HEAD public | tar -x -C /tmp/old --strip-components=1
ROOT=/tmp/old PORT=8790 node .claude/skills/ui-verify/scripts/serve.mjs &
```

That is how the 3px overflow was pinned on the new locked component rather than
on the data: the committed version measured 0px, the working one 3px, and the
difference only appeared when `.locked` rendered.

**Take the whole tree, not a list of files.** Copying five named files leaves
out `public/js/lib/`, `app.js` fails its imports, and the old build reports
"rendered almost nothing (8 chars)" — which looks like a finding about the old
code and is really a finding about the copy.

**Some findings are not deterministic.** The front door samples a live
narrative, so a banned term can appear on one run and not the next depending on
which fixtures are on the board. A clean run on `#/home` is weaker evidence than
a clean run on a static page; when something shows up there once, fix the
selection rule rather than re-running until it passes.

## Things worth knowing before you conclude anything

**Wait long enough.** The board fetches through the proxy to a live Worker. A
700ms wait reported "rendered almost nothing" on a page that was perfectly
fine. The script waits 2.5s; do not shorten it and then trust the result.

**A hash change is not a page load.** `page.goto` to a different `#/route` on
an already-loaded page is a same-document navigation, so `waitUntil:
'networkidle'` returns immediately. Use `load` and an explicit wait.

**Overlap is not overflow.** A grid whose tracks collapse under their own
content renders its children on top of each other while the page reports zero
horizontal scroll, because the overlap is contained. Two team sheets sat in the
same place on the line-ups tab for as long as that bug existed and every check
passed. The overlap scan compares in-flow siblings and ignores anything with a
negative margin, which is an author asking for overlap on purpose.

**A hidden tab is an unmeasured tab.** A hidden element has a zero-size rect,
so it cannot overlap anything and cannot be measured at all — the checker only
ever saw whichever pane opens first. It reveals `.tabpane[hidden]` for the
measurement now. That is why the pitch bug survived: it lived one tab across.

**External hosts always fail here.** Google Fonts and the provider's image host
both fail TLS in the sandbox. That means the typefaces are declared and applied
but *not visually confirmed* — say so rather than claiming the type is verified.
Look at the live site after deploy for that.

**A screenshot is worth a thousand tokens.** When something is wrong and the
measurements do not explain it, take one and look.

## Add to the checker rather than around it

Every check in `check.mjs` is there because it caught something real. When you
find a new class of bug by hand, add it — the next session gets it free, and
one-off scripts do not survive the session that wrote them.
