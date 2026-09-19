---
name: offside-ui
description: The design system for offside.win — the token layer, the component rules, the identity and the reasoning behind it, and the specific mistakes this codebase has already made and fixed. Use this whenever touching public/*.css, public/app.js, public/js/**, public/index.html, or building any new page, view, component or visual state for this site. Use it before picking a colour, a typeface, a spacing value or a radius, and before writing any CSS at all — the token layer is the only place values are allowed to be defined, and the last two visual regressions here came from not knowing that. Also use it when asked to redesign, restyle, rebuild a page, add a screen, or make something "look better".
---

# offside.win — the design system

Read `frontend-design` alongside this one. That skill is about not producing a
generic page; this one is about this particular page, and about the specific
ways it has already gone wrong.

## The rule that has bitten twice

**`public/tokens.css` is the only file that may define a design token.**

`style.css` and `components.css` load after it. A token redefined in either
silently wins the cascade, which is how a commit that claimed to fix two
measured contrast failures shipped without changing a single rendered colour:
`style.css` had its own `:root` block with the old values, same specificity,
later in the document. The fix was real; the cascade ate it.

A corollary, from the same week: **a `var()` that resolves to nothing
invalidates the whole declaration.** Rewriting the type scale dropped
`--weight-black` and `--tracking-caps` on purpose, but `components.css` still
referenced both in five places, so `.odds` — the price column the whole board
is built around — rendered at inherited weight. Nothing errored, nothing
looked broken enough to notice.

So before committing any CSS change, run the sweep in the `ui-verify` skill.
It checks every referenced token resolves, and it takes a second.

## The identity, and why

Chosen against a survey of twenty products in and around this category. The
reasoning is written down because otherwise the next pass reverts it by eye.

| Token | Value | Why |
|---|---|---|
| `--pitch` | `#0c0b09` | Warm-cast near-black. Every competitor is blue-cast or neutral — Polymarket `#000`, Stake `#0F212E`, FotMob pure black. Robinhood warmed its canvas deliberately to differentiate from exactly that, and it works. Football at night is sodium, wood and concrete, not fintech. |
| `--stand` / `--terrace` | `#15130f` / `#201c17` | Surface steps of about 4%. Depth comes from these and from hairlines, never from a shadow under every card. |
| `--chalk` | `#f7f4ed` | Warm white, so type sits on the ground instead of glowing off it. |
| `--floodlight` | `#7a5af8` | Violet is unclaimed in football — bet365 green, FanDuel blue, DraftKings orange, OneFootball lime, Sofascore royal blue. It is also cool against a warm ground and does not collide with the semantic red and green. |
| `--won` / `--lost` | `#3db468` / `#cb3131` | Muted on purpose, taken from Polymarket. **These are states, never brand.** |

**Green is spent.** bet365, Betway, Paddy Power and every tipster site own
saturated green, so it reads as gambling promo. It is semantic here and
nothing else.

**Three faces, three jobs.** `Bricolage Grotesque` for display (variable, with
width and optical-size axes, and not the face anyone reaches for by default),
`Inter` for UI with `cv01`/`ss03` on, `Saira Condensed` for prices, scores and
long club names. The last one is not decoration: Sofascore commissioned a
condensed width axis specifically because the product "deals with unexpectedly
long names", and the professional answer to Borussia Mönchengladbach in a 96px
column is a condensed cut, not an ellipsis.

**Weight ceiling 600.** Bold-everything is the fastest way to look cheap. The
display face carries emphasis through width.

**Numbers are typeset differently from text.** `tabular-nums` everywhere there
is a price. Proportional digits make a column of odds unscannable — 1.11 and
2.87 come out different widths and the decimal points stop lining up — and a
live board jitters on every tick.

## Two registers

The density belongs to the **pick surfaces** — board, fixture, results — where
a reader wants a lot on screen at once. A board of four tall cards shows four
games; the same screen as rows shows a dozen, and someone scanning for their
fixture wants the dozen.

The **front door and the blog** are analysis-led and read like football media.
Same components, different spacing.

This is not a compromise. Advertising review looks at the landing page, so the
pages traffic arrives on carry no odds at all — that is the whole §0a
positioning, and it is why the wall sits where it does.

## Component rules that came from real failures

- **Three states, not two.** A fixture row is: has a call, call is locked, or
  genuinely has no call. Forty-four per cent of the board is the third kind.
  Collapsing locked and no-call promises a reader something that is not there,
  and they find out after paying.
- **A locked state is an offer, not an error.** It uses the accent and a raised
  surface, sits directly under the reasoning where the argument has just been
  made, and says what is behind it.
- **An empty state says what this is, why it is empty, and that the emptiness
  is deliberate.** Without the third part the page reads as broken.
- **A panel with nothing behind it is never rendered.**
- **No pick is shown without its price and the book offering it.** A number
  with no source is not a usable price.
- **Nothing that does not wrap sits next to flexible content.** A button with
  `white-space: nowrap` makes its min-content width a floor that the parent,
  and then the document, has to honour — three pixels of horizontal scroll on
  every fixture page, traced back to one declaration.

## Tells this codebase has already committed

From `frontend-design`'s list, all four were live here and all four are out.
Do not reintroduce them:

- tracked-out ALL-CAPS eyebrow labels above every heading
- meta strings joined with middle dots (`A · B · C`)
- tinted near-black standing in for black
- `→` appended to link and button text

## Copy is part of the design

Every number on a user-facing surface has to be one a supporter would say out
loud. "Points a game 4.17", "goals expected 3.33" and "goals a game 3.33" were
all on the fixture page, all rendered client-side, all on the page adverts are
meant to land on. They now say "travel badly", "goals look likely", "there are
usually goals in this one".

The full rule lives in the `offside-voice` skill and is enforced in code by
`engine/src/vocabulary.ts`. Read that skill before writing any user-facing
string.

## Where things are

- `public/tokens.css` — every value, and the reasoning in comments
- `public/components.css` — written against the tokens, no raw hex, no raw px
- `public/style.css` — older page-level CSS, still being migrated; **no `:root`**
- `public/app.js` — one file, hash router at the bottom, views as `viewX()`
- `public/js/lib/` — extracted modules (`markets.js`, `auth.js`)

No framework and no build step. That constraint has served this project well —
the whole front end is three CSS files and some ES modules served as-is.
