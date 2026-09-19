---
description: Query the local UI/UX design intelligence — styles, palettes, fonts, UX rules
argument-hint: a query, optionally --domain style|color|typography|ux|product|chart|landing
---

Search the bundled design data for: **$ARGUMENTS**

```bash
python3 .claude/skills/ui-ux-pro-max/scripts/search.py $ARGUMENTS
```

If no `--domain` was given, run the query across the two or three domains that
fit and show what each returns. Domains: `style`, `color`, `chart`, `landing`,
`product`, `ux`, `typography`, `icons`, `gsap`, `react`, `web`, `google-fonts`.

It is local data, so there is no reason to guess instead of asking it. 79
styles, 192 product palettes with reasoning, 74 font pairings, 119 UX
guidelines.

Then say what you would actually take from the results for this project, and
what you would leave — the data describes a general case and this site has
already made specific choices that `offside-ui` records.
