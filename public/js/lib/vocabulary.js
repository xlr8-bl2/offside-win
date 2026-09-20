/**
 * The private vocabulary, for the browser.
 *
 * engine/src/vocabulary.ts is the definition of this rule and the reason it
 * exists. This is the same list of terms, in a form a page can apply at render
 * time, and engine/test/vocabulary-agreement.test.ts fails if the two ever
 * differ by a single character.
 *
 * What needs it: the results page shows the argument we made before kick-off,
 * which is the most interesting thing on the page after a loss and the one
 * thing nobody else publishes. Those arguments were written by the template
 * grammar, and two thirds of them say "expected goals", "the model" or "our
 * numbers" -- the exact private language the rule exists to keep off the page.
 *
 * So the gate is on content rather than on a flag: a narrative is shown if it
 * reads like something a person would say and withheld if it does not. It
 * opens by itself as the writing improves, with nothing to switch on.
 *
 * Numbers are checked too, by the same rule the engine applies to generated
 * prose: a figure of the shape 1.87 or 82% inside a sentence has always come
 * from a spreadsheet. The call's own price is the one exception, passed in as
 * `allowed`, because a price is what the sentence is about.
 */

export const BANNED = [

  // --- pick classes: our filing system, not the reader's ------------------
  /\bCONFIDENT\b/,
  /\bLIKELY\b(?!\s+to\b)/,
  /\bVALUE\b/,
  /\bhigh[- ]confidence call\b/i,
  /\ba confidence, not a tip\b/i,

  // --- scores: a number is not a reason ----------------------------------
  /\bconfidence\b(?!\w)/i,
  /\bour (?:own )?numbers?\b/i,
  /\bon our numbers\b/i,
  /\bthe model\b/i,
  // "edge of the box" is football; "no edge here" is a trading desk.
  /\b(?:an?|the|our|any|no) edge\b(?!\s+of\b)/i,
  /\bpoints? of disagreement\b/i,
  /\bthe price (?:says|implies)\b/i,
  /\bfair price\b/i,

  // --- pricing internals --------------------------------------------------
  /\bexpected goals?\b/i,
  /\bxG\b/,
  /\blambda\b/i,
  /\bimplied probabilit/i,
  /\bprobabilit(?:y|ies)\b/i,
  /\bde-?vig/i,
  /\boverround\b/i,
  /\bShin'?s? method\b/i,
  /\bpoints? (?:per|a) game\b/i,
  /\bgoal difference per\b/i,
  /\bgoal share\b/i,

  // --- staking and returns: gambling shorthand, and adjacent to a claim ---
  /\bin the pound\b/i,
  /\bbankroll\b/i,
  /\bstaking plan\b/i,
  /\bKelly\b/,
  /\bROI\b/,
  /\byield\b/i,
  /\bP\/L\b/i,
  /\b\d+(?:\.\d+)?\s*units?\b/i,

  // --- measurement internals ---------------------------------------------
  /\bclosing line value\b/i,
  /\bCLV\b/,
  /\blog loss\b/i,
  /\bBrier\b/i,
  /\bcalibrat(?:ion|ed)\b/i,
  /\bDixon-?Coles\b/i,
  /\bPoisson\b/i,

  // --- debug output -------------------------------------------------------
  /§\d/,
  /\bCOMPUTED\b/,
  /\bUNAVAILABLE\b/,
  /\bsample of \d+ is below\b/i,
];

/**
 * Numbers only an analyst would say. Kept identical to the engine's pair --
 * engine/test/vocabulary-agreement.test.ts checks both sources character for
 * character.
 *
 * Scorelines and years are what a supporter genuinely says, so "4-0" and
 * "2026" survive and "1.78" does not.
 */
export const SPREADSHEET_NUMBER = /(?<![\d-])\d+\.\d{1,2}(?![\d%])/;
export const PERCENTAGE = /\b\d{1,3}(?:\.\d+)?\s*%/;

/** The first banned term in `text`, or null when there is none. */
export function findBanned(text) {
  const t = String(text ?? '');
  for (const pattern of BANNED) {
    const hit = pattern.exec(t);
    if (hit) return hit[0];
  }
  return null;
}

/**
 * `text` when it is safe to publish, null when it is not.
 *
 * `allowed` is the numbers this particular sentence is entitled to repeat --
 * in practice the call's price, and nothing else. Anything of a spreadsheet
 * shape that is not in it withholds the whole passage, because one invented
 * figure discredits the paragraph around it.
 */
export function cleanProse(text, allowed = []) {
  const t = String(text ?? '').trim();
  if (!t) return null;
  if (findBanned(t)) return null;

  // Every figure, not just the first. A narrative that opens "Over 1.5 goals
  // at 1.17" and goes on to invent three more would pass a check that stopped
  // at the line, which is the one number in the sentence we can vouch for.
  const permitted = new Set(allowed.filter((v) => v !== null && v !== undefined).map(String));
  for (const m of t.matchAll(new RegExp(SPREADSHEET_NUMBER.source, 'g'))) {
    if (!permitted.has(m[0])) return null;
  }
  for (const m of t.matchAll(new RegExp(PERCENTAGE.source, 'g'))) {
    if (!permitted.has(m[0].trim())) return null;
  }

  return t;
}
