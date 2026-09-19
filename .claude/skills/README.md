# Skills and commands

Claude Code picks these up automatically when it runs anywhere inside this
repository.

## Calling them

Skills trigger on their own when a task matches. To drive one deliberately,
use a slash command — they live in `.claude/commands/` and are verbs rather
than one-per-skill wrappers:

| Command | Does |
|---|---|
| `/design <what>` | Decide tokens, layout and a direction **before** writing UI. Queries the design data, applies the generated-design-tells lens, works inside the existing identity. |
| `/design-check [routes]` | Render the real pages and measure them — undefined tokens, horizontal scroll, console errors, leaked prices. |
| `/ui-search <query>` | Raw query into the 192 palettes, 74 font pairings and 119 UX rules. |
| `/voice <text or file>` | Audit and rewrite user-facing copy against the vocabulary rule, checked in code rather than by eye. |
| `/page <what it is for>` | Build a new page end to end: plan, build on the tokens, route it, write the copy, render it. |

`/design-check` knows which view it is looking at. A price is the product for a
member and forbidden for everyone else, so it asks the API whether the board
is redacted and only treats decimals as findings in the free view. The blunt
version flagged the odds on the board as violations, and a checker that cries
wolf gets ignored. Nothing to install and nothing to configure — they are here, so
they are available, and they travel with the project rather than depending on
what happens to be set up on a given machine.

To use them somewhere else, copy a directory into that project's
`.claude/skills/`, or into `~/.claude/skills/` to have it everywhere.

## Vendored from GitHub

| Skill | From | Licence | What it gives you |
|---|---|---|---|
| `ui-ux-pro-max` | [nextlevelbuilder/ui-ux-pro-max-skill](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) | MIT | The big one. 79 styles, 192 product palettes with reasoning, 74 font pairings, 119 UX guidelines, 105 icons, 25 chart types, 22 stacks — all searchable locally through `scripts/search.py`, no network needed. |
| `design-system` | same repo | MIT | Three-layer token architecture (primitive → semantic → component), spacing and type scales, component specs. |
| `frontend-design` | [anthropics/skills](https://github.com/anthropics/skills) | Apache 2.0 | Aesthetic direction, and a list of the traits that mark a page as AI-generated. See its `NOTICE.md` — it caught two of this site's three theme drafts before they reached code. |
| `frontend-ui-engineering` | [addyosmani/agent-skills](https://github.com/addyosmani/agent-skills) | MIT | Production-quality accessible UI: WCAG, responsive behaviour, state, the difference between working and shippable. |

Each keeps the licence file it arrived with. They are copies pinned at the
moment they were vendored, so check upstream before assuming they are current.

The search tool is worth knowing by hand:

```bash
python3 .claude/skills/ui-ux-pro-max/scripts/search.py "dense dark dashboard" --domain style
python3 .claude/skills/ui-ux-pro-max/scripts/search.py "condensed numerals" --domain typography
```

Domains: `style`, `color`, `chart`, `landing`, `product`, `ux`, `typography`,
`icons`, `gsap`, `react`, `web`, `google-fonts`.

## Written for this project

These hold what this codebase has learned the hard way. A generic skill cannot
know that `style.css` loads after `tokens.css`, and that is the bug that made a
contrast fix ship without changing a rendered pixel.

| Skill | What it holds |
|---|---|
| `offside-ui` | The token layer and the one rule about it, the identity and why each value was chosen against the competition, the two registers, and the component rules that came out of real failures. |
| `ui-verify` | Render it and measure it. Bundles a local server that proxies the live API and a checker for undefined tokens, horizontal scroll, console errors, spreadsheet numbers and banned words. Every check in it caught something that reading the diff did not. |
| `offside-voice` | What the site is allowed to say. The banned vocabulary, the rule about which numbers may appear, and the pundit register. Enforced in code by `engine/src/vocabulary.ts`, and a violation stops a paragraph reaching a free reader. |

## Considered and left out

Not oversights — each is a poor fit for this particular codebase, and knowing
why saves the next person from re-evaluating them:

- **`ui-styling`** (same repo as `ui-ux-pro-max`) — shadcn/ui, Radix and
  Tailwind. This front end has no framework and no build step, deliberately.
  Also 5.5MB of it is canvas fonts.
- **`design`** — logo generation, corporate identity programmes and banner
  design through paid image APIs. Far outside what this needs.
- **`brand`** — marketing brand voice. `offside-voice` is stricter, specific to
  this product, and already enforced in code.
- **`browser-testing-with-devtools`** — needs the Chrome DevTools MCP server,
  which this project's sessions do not have. `ui-verify` uses Playwright, which
  they do.
- **`theme-factory`** and **`webapp-testing`** (anthropics/skills) — aimed at
  artifacts and slides, and overlapping `ui-verify` respectively.
