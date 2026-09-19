---
name: offside-voice
description: How offside.win is allowed to talk — the banned vocabulary, the rule about which numbers may appear, and the pundit register. Use this before writing ANY user-facing string on this project: page copy, button labels, empty states, error messages, meta descriptions, marketing text, legal pages, and especially anything the analysis writer produces. Also use it when reviewing existing copy, when asked to make the writing better or less robotic, or when a number appears on screen. The rule is enforced in code by engine/src/vocabulary.ts and a violation blocks a narrative from ever reaching a free reader, so getting it wrong is not cosmetic.
---

# How this site talks

The brief, in the client's words: **"sound like pundits who are rage baiting
fans but who actually know ball."**

Not neutral, not careful, not explanatory-teacher. Opinionated, willing to call
a team poor and say why. Short punchy lines against longer ones. A take you
could argue with, backed by something real — which is the half most bait
merchants skip.

## The number rule

**Use a number only if a fan would say it out loud in a pub.** Everything else
is cut. This is the single most-repeated complaint about this product and it
has been raised three separate times.

| Say | Never |
|---|---|
| won one in six | 1.78 expected goals |
| four clean sheets in a row | 83% |
| hasn't scored since September | 2.17 points a game |
| beat them 4–0 in April | 0.6 goal difference per match |
| conceded in every away game | 13.9 points of disagreement |
| unbeaten in twelve | 27% of the side's league goals |
| out for six weeks | returns 15p in the pound |

The underlying evidence is fine. `form.ts` computes wins, draws, clean sheets,
streaks and the home/away split, and those are all pub numbers. It is the
*rendering* that keeps reaching for the spreadsheet figure instead.

The mechanical tell: **a decimal with one or two places is almost always a
spreadsheet number.** `vocabulary.ts` matches that shape directly. When you
catch one, do not round it — say the comparison instead. "Travel badly" rather
than "0.90 a game on the road". "There are usually goals in this one" rather
than "3.33 goals a game". "The referee books more players than most" rather
than a yellow-card rate.

## Banned outright

Nothing internal reaches the screen — not the pick classes, not the scoring,
not the maths vocabulary.

| Never | Because |
|---|---|
| `CONFIDENT` / `VALUE` / `LIKELY`, "Call", "Value" | internal pick classes; the reader does not have our taxonomy |
| "confidence 83%", confidence bars, any bare percentage | a score is not a reason |
| edge, value, overlay, fair price, the market, the book says | trading-desk vocabulary |
| units, P/L, staking, bankroll, ROI, yield | gambling-industry shorthand, and adjacent to a profit claim |
| model, our model, our numbers, on our numbers | nobody buys a model, they buy an opinion |
| expected goals, xG, lambda, probability | jargon, and the source of "1.78 to 1.15" meaning nothing |
| points per game, goal difference per match, goal share % | spreadsheet numbers |
| de-vig, overround, margin, Shin | pricing internals |
| CLV, Kelly, log loss, Brier, calibration | measurement internals |
| §2.4, COMPUTED, THIN, UNAVAILABLE | debug output |

`engine/src/vocabulary.ts` is the single definition. Add to that file rather
than to a second list somewhere — the writer's validator and the free-copy gate
both read it, and two lists drift.

## What a pick shows

Four things, and nothing else:

1. **The pick** — a plain sentence. *"Osasuna to win by two goals or more."*
2. **The odds** — `2.35`
3. **The bookmaker** — *at 1xBet*
4. **Why we're confident** — a paragraph in the voice above

## Before and after

| Now | Wanted |
|---|---|
| "Sarpsborg 08 are the better side at 1.78 to 1.15, though not by the margin the confidence number might suggest." | "Sarpsborg have won one in six and they're still favourites. That tells you everything about what KFUM have been putting out." |
| "83% on our numbers, 1.18 on the board. Both are saying the same thing, which is worth knowing and is not an edge." | "Ajax at home to Willem II. Four clean sheets on the bounce and Willem II haven't won away since April." |
| "1.46 expected for Grasshopper, 1.79 for Sion — neither side projects to run away with it." | "Neither of these can defend. Sion have shipped two or more in five straight. Goals are coming." |

Note what the bad column has in common: it talks about the *model* rather than
the *football*, and it closes by talking the reader out of the call it just
made.

## Never a profit claim

The settled record is negative — £10 a pick across 171 settled picks is £69.90
down. Publishing only the high-probability calls is roughly break-even on 60
picks, which is a small sample and proof of nothing.

So: sell coverage, explanation and transparency. Never returns. This is not
only honest, it is what makes the advertising reviewable at all — Google and
Meta both reject gambling-adjacent ads carrying profit claims, and UK ASA rules
bite. The results page stays public and unfiltered, forever, including the
losses.

Results are said in money, not units: **"Of the last 171 picks, 104 won. £10 on
every pick would have left you £69.90 down."** The sign is never softened. That
page being believable is the entire marketing strategy.

## Why the gate is not cosmetic

The free copy of every fixture passes its prose through `findBannedInProse`
before a signed-out reader can see it. Fail it and the paragraph is withheld
entirely.

That is load-bearing: measured against the live site, **fifteen of fifteen**
template-written narratives opened by naming the call and its price — *"Over
1.5 goals at 1.13."* — so none of them could be shown for free. A paywall that
strips `top_pick` and then ships that sentence is decoration.

The gate is on content rather than a flag, so it opens by itself as the writing
improves. Nothing needs switching on.

## Other surfaces, same rules

**Errors don't apologise and are never vague.** Say what happened and what to
do. "Memberships are not open yet. Nothing has been charged." beats a 500.

**An empty screen is an invitation to act**, and it says the emptiness is
deliberate. Forty-four per cent of the board has no call on it; without that
third part the page reads as broken rather than restrained.

**A CTA says what happens.** "Save changes", not "Submit". The action keeps its
name through the whole flow.

**Cancelling is one tap.** No "are you sure", no retention offer. Retention
mazes are a dark pattern and in several places an illegal one.
