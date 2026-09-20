/**
 * What the product is not allowed to say.
 *
 * The old UI leaked three separate private languages onto the page: the pick
 * classes it files things under (CONFIDENT, VALUE, LIKELY), the scores it
 * ranks them by (confidence, edge), and the maths it prices them with
 * (expected goals, de-vig, overround). A reader has none of that vocabulary,
 * so all of it read as noise — and the numbers read as noise twice over,
 * because a figure like "1.78 to 1.15" never said what it was counting.
 *
 * This module is the single definition of that rule. Two things consume it and
 * they must not drift apart:
 *
 *   1. the writer's validator, which rejects generated prose containing any of
 *      it and falls back to the older template output;
 *   2. the copy scan, which reads the rendered pages and fails the build.
 *
 * The distinction that matters throughout: a *pub number* is one a supporter
 * would say out loud — "won one in six", "beat them 4-0", "four clean sheets".
 * A *spreadsheet number* is one only an analyst would say — 2.17 points a game,
 * 83%, 1.78 expected goals. Pub numbers are the product. Spreadsheet numbers
 * are what made the old site unreadable.
 */

export interface BannedTerm {
  /** Matched case-insensitively against rendered text. */
  pattern: RegExp;
  /** Shown to whoever has to fix it, so it says what to write instead. */
  instead: string;
}

/**
 * Terms banned everywhere a reader can see them — generated prose, static
 * copy, labels, chips, tooltips, alt text.
 *
 * Every pattern is deliberately narrow. Broad ones were tried and produced
 * false positives that trained people to ignore the check, which is worse than
 * having no check: "value" catches `formatValue`, "edge" catches "edge of the
 * box", "call" catches "a good call". Each entry below is anchored on the
 * phrasing that is actually private to us.
 */
export const BANNED: BannedTerm[] = [
  // --- pick classes: our filing system, not the reader's ------------------
  { pattern: /\bCONFIDENT\b/, instead: 'describe the call, do not name its class' },
  { pattern: /\bLIKELY\b(?!\s+to\b)/, instead: 'describe the call, do not name its class' },
  { pattern: /\bVALUE\b/, instead: 'describe the call, do not name its class' },
  { pattern: /\bhigh[- ]confidence call\b/i, instead: 'just make the call' },
  { pattern: /\ba confidence, not a tip\b/i, instead: 'say what you think will happen' },

  // --- scores: a number is not a reason ----------------------------------
  { pattern: /\bconfidence\b(?!\w)/i, instead: 'say why, in words — "confident" is fine, "confidence 83%" is not' },
  { pattern: /\bour (?:own )?numbers?\b/i, instead: 'state the view directly' },
  { pattern: /\bon our numbers\b/i, instead: 'state the view directly' },
  { pattern: /\bthe model\b/i, instead: 'nobody buys a model, they buy an opinion' },
  // "edge of the box" is football; "no edge here" is a trading desk.
  { pattern: /\b(?:an?|the|our|any|no) edge\b(?!\s+of\b)/i, instead: 'trading-desk vocabulary' },
  { pattern: /\bpoints? of disagreement\b/i, instead: 'trading-desk vocabulary' },
  { pattern: /\bthe price (?:says|implies)\b/i, instead: 'trading-desk vocabulary' },
  { pattern: /\bfair price\b/i, instead: 'trading-desk vocabulary' },

  // --- pricing internals --------------------------------------------------
  { pattern: /\bexpected goals?\b/i, instead: 'say what you expect to happen' },
  { pattern: /\bxG\b/, instead: 'say what you expect to happen' },
  { pattern: /\blambda\b/i, instead: 'say what you expect to happen' },
  { pattern: /\bimplied probabilit/i, instead: 'plain English' },
  { pattern: /\bprobabilit(?:y|ies)\b/i, instead: 'plain English' },
  { pattern: /\bde-?vig/i, instead: 'pricing internals' },
  { pattern: /\boverround\b/i, instead: 'pricing internals' },
  { pattern: /\bShin'?s? method\b/i, instead: 'pricing internals' },
  { pattern: /\bpoints? (?:per|a) game\b/i, instead: 'say "won four of their last six"' },
  { pattern: /\bgoal difference per\b/i, instead: 'say it the way a supporter would' },
  { pattern: /\bgoal share\b/i, instead: 'say "their top scorer"' },

  // --- staking and returns: gambling shorthand, and adjacent to a claim ---
  { pattern: /\bin the pound\b/i, instead: 'show what a stake returns in money' },
  { pattern: /\bbankroll\b/i, instead: 'gambling shorthand' },
  { pattern: /\bstaking plan\b/i, instead: 'gambling shorthand' },
  { pattern: /\bKelly\b/, instead: 'staking internals' },
  { pattern: /\bROI\b/, instead: 'say how many won, and what a stake would have done' },
  { pattern: /\byield\b/i, instead: 'say how many won, and what a stake would have done' },
  { pattern: /\bP\/L\b/i, instead: 'say it in money' },
  { pattern: /\b\d+(?:\.\d+)?\s*units?\b/i, instead: 'say it in money' },

  // --- measurement internals ---------------------------------------------
  { pattern: /\bclosing line value\b/i, instead: 'internal measurement — never shipped' },
  { pattern: /\bCLV\b/, instead: 'internal measurement — never shipped' },
  { pattern: /\blog loss\b/i, instead: 'internal measurement — never shipped' },
  { pattern: /\bBrier\b/i, instead: 'internal measurement — never shipped' },
  { pattern: /\bcalibrat(?:ion|ed)\b/i, instead: 'internal measurement — never shipped' },
  { pattern: /\bDixon-?Coles\b/i, instead: 'internal measurement — never shipped' },
  { pattern: /\bPoisson\b/i, instead: 'internal measurement — never shipped' },

  // --- debug output -------------------------------------------------------
  { pattern: /§\d/, instead: 'doctrine reference — never shipped' },
  { pattern: /\bCOMPUTED\b/, instead: 'evidence state — never shipped' },
  { pattern: /\bUNAVAILABLE\b/, instead: 'evidence state — never shipped' },
  { pattern: /\bsample of \d+ is below\b/i, instead: 'evidence state — never shipped' },
];

/**
 * Numbers only an analyst would say.
 *
 * Applied to generated prose only, never to the whole page — a price *is* a
 * two-decimal number and belongs on screen. Inside a sentence, though, a
 * figure of that shape has always come from a spreadsheet: 1.78 goals, 2.17
 * points a game, 0.83 of something.
 *
 * Scorelines and dates are the exception a supporter genuinely says, so
 * "4-0" and "2026" survive; "1.78" does not.
 */
export const SPREADSHEET_NUMBER = /(?<![\d-])\d+\.\d{1,2}(?![\d%])/;
export const PERCENTAGE = /\b\d{1,3}(?:\.\d+)?\s*%/;

export interface Violation {
  term: string;
  instead: string;
}

/** Every banned term present in `text`, in the order they are defined. */
export function findBanned(text: string): Violation[] {
  const out: Violation[] = [];
  for (const { pattern, instead } of BANNED) {
    const hit = pattern.exec(text);
    if (hit) out.push({ term: hit[0], instead });
  }
  return out;
}

/**
 * The stricter check, for prose we generate rather than copy we write.
 *
 * `allowed` is the set of pub facts the writer was given. A number that
 * appears there may be repeated; anything else is invention or a spreadsheet
 * figure, and both are rejected.
 */
export function findBannedInProse(text: string, allowed: readonly string[] = []): Violation[] {
  const out = findBanned(text);
  const permitted = allowed.join(' ');

  const dec = SPREADSHEET_NUMBER.exec(text);
  if (dec && !permitted.includes(dec[0])) {
    out.push({ term: dec[0], instead: 'a supporter would not say this number out loud' });
  }

  const pc = PERCENTAGE.exec(text);
  if (pc && !permitted.includes(pc[0].trim())) {
    out.push({ term: pc[0].trim(), instead: 'a percentage is not a reason' });
  }

  return out;
}

/** True when `text` is safe to publish. */
export function isClean(text: string, allowed: readonly string[] = []): boolean {
  return findBannedInProse(text, allowed).length === 0;
}
