---
description: Build a new page or view end to end on this project's design system
argument-hint: what the page is for, e.g. "a league table view" or "the blog index"
---

Build **$ARGUMENTS**.

Work in this order. Each step exists because skipping it has cost this project
a commit before.

1. **Plan it** — run `/design $ARGUMENTS` and agree the direction before
   writing code. A page designed by accumulation looks like one.

2. **Build it against the token layer.** `public/tokens.css` is the only file
   that may define a token; `components.css` and `style.css` consume them and
   must contain no raw hex and no raw pixel value. Read `offside-ui` for the
   component rules — three row states not two, empty states that say the
   emptiness is deliberate, nothing that refuses to wrap beside flexible
   content.

3. **Route it.** `public/app.js` has a hash router at the bottom; views are
   plain `async function viewX()` that assign `app.innerHTML`. Follow the
   `viewLegal` precedent. Two lines in `route()`.

4. **Write the copy with `offside-voice` open**, not afterwards.

5. **Render it** — `/design-check '#/your-route'`. Do not report it as done on
   the strength of the code being written.

If the page shows anything a member pays for, check what a signed-out reader
sees as well, with the `FREE=1` server. The wall is content-gated, and prose
can leak a call that key-stripping never touches.
