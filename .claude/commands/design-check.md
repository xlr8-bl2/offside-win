---
description: Render the site in a real browser and measure what actually shipped
argument-hint: routes to check, e.g. "#/board #/pricing" (defaults to home and board)
---

Verify the UI by rendering it, not by reading the diff. Every visual regression
this project has shipped was invisible in the diff and obvious in a browser.

Read the `ui-verify` skill, then:

```bash
node .claude/skills/ui-verify/scripts/serve.mjs &
node .claude/skills/ui-verify/scripts/check.mjs $ARGUMENTS
```

That reports, at 1440px and 390px: pages that rendered nothing, horizontal
scroll in pixels, `var()` references that resolve to nothing, spreadsheet
numbers on screen, banned vocabulary, and console errors.

To see what a signed-out reader gets before the slate has written free copies,
run the server with `FREE=1` — it passes every API response through the
engine's own redaction rather than an approximation of it.

Report what you found honestly. If something is wrong, work out whether you
caused it before fixing: serve the committed version alongside, per the
attribution recipe in the skill. "The committed version measured 0px and this
one measures 3px" is how the last one was pinned on the right change.

Do not claim the typefaces are verified. External hosts fail TLS in the
sandbox, so fonts are declared and applied but not seen.
