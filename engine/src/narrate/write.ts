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
}

export interface Writer {
  name: string;
  generate(prompt: string): Promise<string>;
}

/** Why a draft was thrown away, for the run log. */
export type Rejection = 'banned-term' | 'invented-number' | 'too-short' | 'too-long' | 'error';

export interface WriteResult {
  text: string | null;
  rejections: Rejection[];
  provider: string;
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
  const facts = req.facts.slice(0, 10).map((f) => `- ${f.text}`).join('\n');

  return `You are a football pundit writing a short preview for ${req.home} v ${req.away} in the ${req.competition}.

Our call is: ${req.call}

These are the only facts you may use:
${facts}

Write one paragraph of 70 to 120 words explaining why we like that call.

How to write it:
- Open with the opinion, not with a fact. Have a take.
- Back it with two or three of the facts above. Name the players and managers.
- Be willing to say a team is poor, or in trouble, or flattered by the table.
- Short sentences against longer ones. You may ask a rhetorical question.
- Write like you are talking to someone who watches football, not to a client.

Hard rules:
- Use ONLY the facts listed. Do not invent a statistic, a result or a player.
- Do not use any number that is not in the facts above.
- Never write: confidence, probability, expected goals, xG, edge, value, model,
  points per game, odds, price, bet, stake, units, or any percentage.
- Do not mention us, the call, the odds or the bookmakers. Just the football.
- No preamble, no heading, no sign-off. The paragraph only.`;
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
    } catch {
      rejections.push('error');
      break;
    }

    const problems = validate(draft, req);
    if (problems.length === 0) {
      return { text: tidy(draft), rejections, provider: writer.name };
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
