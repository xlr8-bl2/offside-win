/**
 * The analysis, written rather than assembled.
 *
 * `grammar.ts` says of itself: "this is a template system underneath." That is
 * the honest description, and it is why the output reads as a list — 164 frames
 * render one sentence per fact and `compose.ts` joins them with a space. There
 * is no step that fuses two facts into one thought, so N facts arrive as N
 * sentences however they are worded.
 *
 * So the grammar stops writing and becomes the fact source. `facts.ts` turns
 * the evidence into lines a supporter would say, and a model turns those lines
 * into a paragraph with an opinion in it.
 *
 * Three things keep this honest:
 *
 *   1. The model sees only the pub facts. It cannot reach for a spreadsheet
 *      number because there is not one in its input. A prompt asking a model to
 *      avoid jargon while handing it jargon competes with itself and loses.
 *   2. Every number in the output must appear in the facts, and the §0c banned
 *      list is checked as a regex. Either failing rejects the text.
 *   3. A rejection falls back to the existing grammar output. That path is
 *      load-bearing, not a nicety: the free tier this runs on has had its
 *      quotas cut sharply and without notice before, and the site has to keep
 *      publishing when it happens.
 */

import { findBannedInProse } from '../vocabulary.ts';
import type { PubFact } from './facts.ts';

export interface WriteRequest {
  home: string;
  away: string;
  competition: string;
  /** The call itself, already in plain English: "Osasuna to win by two or more". */
  call: string;
  facts: PubFact[];
  /** The price the call is published at, for the members' paragraph. */
  odds?: number | null;
}

export interface Writer {
  name: string;
  generate(prompt: string): Promise<string>;
}

/** Why a draft was thrown away, for the run log. */
export type Rejection = 'banned-term' | 'invented-number' | 'too-short' | 'too-long' | 'error';

export interface WriteResult {
  text: string | null;
  /**
   * Why this call, for members: the argument for this market on this match,
   * at its odds. Separate from `text` because `text` is shown to everyone and
   * must never name the call -- that is what keeps the wall a wall -- while
   * this is the part a member pays to read. Null when it failed its checks;
   * the preview can still stand on its own.
   */
  why?: string | null;
  rejections: Rejection[];
  provider: string;
  /**
   * Why the provider threw, when it did.
   *
   * Recording only the word "error" was a mistake worth not repeating: the
   * first real run came back twelve for twelve rejected with no indication of
   * whether that was a bad key, a wrong model name, a spent quota or a
   * network, and the whole point of the fallback is that it fails quietly --
   * so quietly that nothing said what had gone wrong.
   */
  error?: string;
}

const MIN_WORDS = 55;
const MAX_WORDS = 150;

/**
 * The brief.
 *
 * Written as instructions to a pundit rather than to a model, because that is
 * the register wanted: opinionated, willing to call a team poor, backed by
 * something real. The previous output closed on "which is worth knowing and is
 * not an edge" — talking a reader out of the call it had just made.
 */
export function buildPrompt(req: WriteRequest): string {
  const facts = req.facts.slice(0, 18).map((f) => `- ${f.text}`).join('\n');
  const odds = oddsPhrase(req.odds);

  return `You are a football pundit writing about ${req.home} v ${req.away} in the ${req.competition}.

These are the only facts you may use:
${facts}

Write two paragraphs, each introduced by its label on its own line, exactly like this:

PREVIEW:
<the preview>
WHY:
<why the call>

PREVIEW — 70 to 120 words about the football only.
- Open with an opinion, not a fact. Have a take.
- Name players and managers from the facts: who is out, who starts, who scores.
  A reader pays for names. "Nice are missing four players" is not analysis;
  "Nice are without Mendy and Bombito at the back" is.
- Be willing to say a team is poor, in trouble, or flattered by the table.
- Do NOT mention any bet, market, call, odds, price or bookmaker in this paragraph.

WHY — 40 to 90 words explaining why our call is: ${req.call}${odds ? `, ${odds}` : ''}.
- Say plainly how the football above leads to THIS outcome, not just that one side is good.
  If the call is about goals, argue about goals: who scores, who cannot defend.
  If it is about a side not losing, argue about why that side avoids defeat.
- Name at least one player from the facts.${odds ? `
- Include the exact words "${odds}" once.` : ''}

Hard rules for both:
- Use ONLY the facts listed. Do not invent a statistic, a result, a player or a score.
- Do not use any number that is not in the facts above${odds ? ', apart from the odds' : ''}.
- Never write: confidence, probability, expected goals, xG, edge, value, model,
  our numbers, points per game, stake, units, bankroll, or any percentage.
- Short sentences against longer ones. Talk to someone who watches football.
- No heading beyond the two labels, no sign-off.`;
}

/**
 * How odds are said, everywhere: the number, and the word.
 *
 * The owner's rule, stated plainly: when mentioning odds, say the specific
 * number and attach the word odds to it. A bare "at 1.29" reads as a price
 * tag or a time.
 */
export function oddsPhrase(odds: number | null | undefined): string | null {
  return typeof odds === 'number' && Number.isFinite(odds) && odds > 1 ? `at odds of ${odds.toFixed(2)}` : null;
}

/** Split the two labelled paragraphs. Either may be missing. */
export function splitDraft(draft: string): { preview: string; why: string | null } {
  const m = /PREVIEW:\s*([\s\S]*?)(?:\n\s*WHY:\s*([\s\S]*))?$/i.exec(draft.trim());
  if (!m) return { preview: draft.trim(), why: null };
  return { preview: (m[1] ?? '').trim(), why: m[2] ? m[2].trim() : null };
}

/** Numbers a supporter says that need no backing — the ordinary furniture of a sentence. */
const HARMLESS = /\b(one|two|three|first|second|half|both)\b/i;

/**
 * Check a draft against the facts it was given.
 *
 * The number check is the important half. A model told to use only the supplied
 * facts will still occasionally produce "their fourth defeat in five" when the
 * facts said three in six, and that is a false statement about a real football
 * club rather than a style problem.
 */
export function validate(text: string, req: WriteRequest): Rejection[] {
  const out: Rejection[] = [];
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  if (words < MIN_WORDS) out.push('too-short');
  if (words > MAX_WORDS) out.push('too-long');

  const allowed = req.facts.map((f) => f.text);
  const violations = findBannedInProse(text, allowed);
  if (violations.length) out.push('banned-term');

  // Every digit and every number-word has to be traceable to a fact.
  const said = new Set(allowed.join(' ').toLowerCase().match(/[a-z0-9-]+/g) ?? []);
  const numbers = text.toLowerCase().match(/\b\d+(?:-\d+)?\b|\b(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/g) ?? [];
  for (const tok of numbers) {
    if (said.has(tok) || HARMLESS.test(tok)) continue;
    out.push('invented-number');
    break;
  }

  return out;
}

const WHY_MIN = 30;
const WHY_MAX = 110;

/**
 * The members' paragraph has its own rules: it may, and must, state the odds
 * -- as "odds of 1.29", never bare -- and it may name the call. Everything
 * else is held to the same standard as the preview: no invented numbers, no
 * banned vocabulary.
 */
export function validateWhy(text: string, req: WriteRequest): Rejection[] {
  const out: Rejection[] = [];
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  if (words < WHY_MIN) out.push('too-short');
  if (words > WHY_MAX) out.push('too-long');
  const odds = oddsPhrase(req.odds);
  const allowed = [...req.facts.map((f) => f.text), req.call, odds ?? ''];
  if (findBannedInProse(text, allowed).length) out.push('banned-term');
  const said = new Set(allowed.join(' ').toLowerCase().match(/[a-z0-9.-]+/g) ?? []);
  const numbers = text.toLowerCase().match(/\b\d+(?:[.-]\d+)?\b|\b(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/g) ?? [];
  for (const tok of numbers) {
    if (said.has(tok) || HARMLESS.test(tok)) continue;
    out.push('invented-number');
    break;
  }
  // A bare price is the thing the owner asked to stop.
  if (odds && !text.includes(odds.replace(/^at /, ''))) out.push('banned-term');
  return out;
}

/**
 * Write one preview, or return null and let the caller fall back.
 *
 * One retry, because a rejected draft is usually a one-off rather than a
 * systematic failure, and a second rejection means something is wrong with the
 * brief or the facts and more attempts will not fix it.
 */
export async function write(req: WriteRequest, writer: Writer): Promise<WriteResult> {
  const rejections: Rejection[] = [];
  const prompt = buildPrompt(req);

  for (let attempt = 0; attempt < 2; attempt++) {
    let draft: string;
    try {
      draft = (await writer.generate(prompt)).trim();
    } catch (err) {
      rejections.push('error');
      return {
        text: null,
        rejections,
        provider: writer.name,
        error: err instanceof Error ? err.message : String(err),
      };
    }

    const { preview, why } = splitDraft(draft);
    const problems = validate(preview, req);
    if (problems.length === 0) {
      // The preview can stand without the members' paragraph; a failed WHY
      // costs that paragraph, not the whole write-up.
      const whyOk = why && validateWhy(why, req).length === 0 ? tidy(why) : null;
      return { text: tidy(preview), why: whyOk, rejections, provider: writer.name };
    }
    rejections.push(...problems);
  }

  return { text: null, rejections, provider: writer.name };
}

/** Strip the wrapper a model reaches for even when told not to. */
function tidy(s: string): string {
  return s
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/^\**(preview|analysis|take)\**\s*:?\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}
