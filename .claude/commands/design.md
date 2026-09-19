---
description: Decide a visual direction and token set before writing any UI code
argument-hint: what you are designing, e.g. "the pricing page" or "a matchday poster"
---

Design **$ARGUMENTS** for offside.win. Decide before you build — the point of
this command is to stop a page being designed by accumulation.

1. Read the `offside-ui` skill. This site already has an identity, a token
   layer and a set of rules that came out of real failures. You are working
   inside it, not starting over — unless the brief above explicitly says
   otherwise, in which case say so out loud before you diverge.

2. Query the design intelligence for anything the brief needs that the existing
   system does not already answer:

   ```bash
   python3 .claude/skills/ui-ux-pro-max/scripts/search.py "$ARGUMENTS" --domain style
   python3 .claude/skills/ui-ux-pro-max/scripts/search.py "$ARGUMENTS" --domain ux
   ```

   Other domains when relevant: `color`, `typography`, `product`, `chart`,
   `landing`. Run the searches rather than recalling what they probably say.

3. Apply the `frontend-design` lens. Check your plan against its list of
   generated-design tells, and say which ones you considered and rejected.
   Four of them were live on this site and have been removed; reintroducing
   one is a regression, not a style choice.

4. Read `offside-voice` before writing a single word of copy. Every number on
   screen has to be one a supporter would say out loud.

Output a short plan — the tokens you are using or adding, the layout concept,
the one element carrying the boldness, and what you deliberately did not do.
Get agreement on that before writing code.
