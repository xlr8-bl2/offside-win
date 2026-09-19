---
description: Check or rewrite user-facing copy against the vocabulary rule
argument-hint: the text, or a file/route to audit, e.g. "public/app.js legal pages"
---

Audit and fix the writing in: **$ARGUMENTS**

Read the `offside-voice` skill first. The two rules that matter most:

- **A number only appears if a fan would say it out loud in a pub.** A decimal
  with one or two places is almost always a spreadsheet number. Do not round it
  — say the comparison instead. "Travel badly", not "0.90 a game on the road".
- **Nothing internal reaches the screen.** No pick classes, no confidence, no
  expected goals, no edge, no model.

The rule is machine-checkable, so check it rather than eyeballing:

```bash
node --experimental-strip-types -e "
import('./engine/src/vocabulary.ts').then(({ findBannedInProse }) => {
  const text = process.argv[1] ?? '';
  console.log(JSON.stringify(findBannedInProse(text), null, 2));
});" "TEXT TO CHECK"
```

For rendered pages, `/design-check` already scans for banned terms and
decimals across every route it visits.

When you rewrite, keep the register: opinionated, willing to call a team poor,
short lines against longer ones, and a take you could argue with. Never a
profit claim — the settled record is negative and the results page stays public
and unfiltered.
