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
  /**
   * A match we passed on: the preview alone, no members' paragraph. Written
   * with the day's spare allowance, so a match page with no call still reads
   * like someone who watches football wrote it.
   */
  previewOnly?: boolean;
}

export interface Writer {
  name: string;
  generate(prompt: string): Promise<string>;
}

/** Why a draft was thrown away, for the run log. */
export type Rejection = 'banned-term' | 'invented-number' | 'too-short' | 'too-long' | 'copied-fact' | 'error';

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
  /** Numbers the drafts used that no fact carried, for the run log. */
  unbacked?: string[];
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
/*
 * Every rule the checks below hold a draft to, said in the brief. A rule the
 * model is not told is a rule it breaks by accident: "confidence" is in the
 * banned list (it is our filing system's word), and a pundit writing "low on
 * confidence" about a side on a bad run was a draft thrown away for using the
 * most natural phrase in football. Kept beside the checks so the two move
 * together.
 */
const NEVER = [
  'confidence (say "belief", "nerve" or "form" instead)', 'probability', 'expected goals', 'xG', 'edge',
  'value', 'the model', 'our numbers', 'fair price', 'points per game', 'goal difference per game',
  'goal share', 'stake', 'units', 'bankroll', 'yield', 'ROI', 'calibrated', 'Poisson', 'Kelly',
  'any percentage or % sign',
].join(', ');

export function buildPrompt(req: WriteRequest): string {
  const facts = req.facts.slice(0, 18).map((f) => `- ${f.text}`).join('\n');
  const odds = oddsPhrase(req.odds);
  const rules = `Hard rules:
- Use ONLY the facts listed. Do not invent a statistic, a result, a player, a score or a date.
- Every number you write must appear in the facts, written the same way (if a fact says "four", write "four" or "4", nothing else). When unsure, leave the number out and say it in words: "a poor run", "goals in most of them".
- No number with a decimal point${odds ? `, except the odds exactly as given: "${odds}"` : ''}.
- Never use these words: ${NEVER}.
- Never mention a bet, market, odds, price or bookmaker${req.previewOnly ? '' : ' in PREVIEW'}.
- Short sentences against longer ones. Talk to someone who watches football.
- No dashes between clauses. Use a full stop, a comma or a colon instead.
- No heading beyond the label${req.previewOnly ? '' : 's'}, no sign-off, no quotation marks around the paragraph.
- Never say how long a manager has been in charge, and never list who starts or who is out. A reader can look those up; they are paying for what they cannot.
- Rest only matters when one side has had clearly less of it than the other. Otherwise leave it out.`;

  // What the reader pays for: the read underneath the results, not the lookups.
  const analysis = `- Lead with what is happening underneath the results: who makes the better chances, whose results are ahead of or behind their football, who is finishing above or below their chances, what each side gives up at the back. The facts that say this come first in the list. Build on at least two of them.
- Join them into an argument about how this game goes: who controls it, where the chances come from, and what that means for the score.
- Mention an absence only when you can say what it changes on the pitch for that side, and never as a list of names.
- The facts are your evidence, not your sentences. Say each one in your own words and tie it to the next; never copy a fact, and never repeat a line from these instructions.
- Have a take, and back it. Be willing to say a side's results are flattering them, or that they are better than the table says.`;

  if (req.previewOnly) {
    return `You are a football pundit writing a preview of ${req.home} v ${req.away} in the ${req.competition}.

These are the only facts you may use:
${facts}

Write one paragraph, introduced by its label on its own line, exactly like this:

PREVIEW:
<the preview>

PREVIEW: 70 to 120 words about the football only. Count them.
- Open with your take on how this one goes, in one sentence.
${analysis}
- End on the one thing that decides it.

${rules}`;
  }

  return `You are a football pundit writing about ${req.home} v ${req.away} in the ${req.competition}.

These are the only facts you may use:
${facts}

Write two paragraphs, each introduced by its label on its own line, exactly like this:

PREVIEW:
<the preview>
WHY:
<why the call>

PREVIEW: 70 to 120 words about the football only. Count them.
- Open with your take on how this one goes, in one sentence.
${analysis}
- End on the one thing that decides it.
- Do NOT mention any bet, market, call, odds, price or bookmaker in this paragraph.

WHY: 40 to 90 words explaining why our call is: ${req.call}${odds ? `, ${odds}` : ''}.
- Show the mechanism: how the reads underneath lead to THIS outcome, not just that one side is better.
  If the call is about goals, argue about the chances each side makes and gives up.
  If it is about a side not losing, argue about why the other side cannot hurt them.
- Then say in one sentence what would have to go wrong for it to fail.${odds ? `
- Include the exact words "${odds}" once.` : ''}

${rules.replace('Hard rules:', 'Hard rules for both:')}`;
}

/** What to tell the model about its last draft, so the second is not the first again. */
export function feedback(preview: string, why: string | null, req: WriteRequest): string {
  const allowed = backing(req);
  const whyAllowed = [...allowed, req.call, oddsPhrase(req.odds) ?? ''];
  const notes: string[] = [];
  const nums = [...new Set([...unbackedNumbers(preview, allowed), ...(why ? unbackedNumbers(why, whyAllowed) : [])])];
  if (nums.length) notes.push(`It used ${nums.map((n) => `"${n}"`).join(', ')}, which ${nums.length === 1 ? 'is' : 'are'} not in the facts. Leave ${nums.length === 1 ? 'it' : 'them'} out entirely.`);
  const banned = [...new Set([...findBannedInProse(preview, allowed), ...(why ? findBannedInProse(why, whyAllowed) : [])].map((v) => v.term))];
  if (banned.length) notes.push(`It used ${banned.map((t) => `"${t}"`).join(', ')}, which ${banned.length === 1 ? 'is' : 'are'} not allowed. Say it another way.`);
  const copied = copiedFact(preview, req.facts);
  if (copied) notes.push(`It copied a fact word for word ("${copied}"). Every fact must be said in your own words.`);
  const words = (t: string) => t.trim().split(/\s+/).filter(Boolean).length;
  const pw = words(preview);
  if (pw < MIN_WORDS) notes.push(`PREVIEW was ${pw} words. Write 70 to 120.`);
  if (pw > MAX_WORDS) notes.push(`PREVIEW was ${pw} words. Write 70 to 120.`);
  if (!req.previewOnly) {
    if (!why) notes.push('WHY was missing. Write it, under its own label.');
    else {
      const ww = words(why);
      if (ww < WHY_MIN || ww > WHY_MAX) notes.push(`WHY was ${ww} words. Write 40 to 90.`);
      const odds = oddsPhrase(req.odds);
      if (odds && !why.includes(odds.replace(/^at /, ''))) notes.push(`WHY must include the exact words "${odds}".`);
    }
  }
  return notes.length ? `\n\nYour last draft was rejected. ${notes.join(' ')}` : '';
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

  const allowed = backing(req);
  const violations = findBannedInProse(text, allowed);
  if (violations.length) out.push('banned-term');

  // Every digit and every number-word has to be traceable to a fact.
  if (inventedNumber(text, allowed)) out.push('invented-number');

  // A paragraph made of the fact lines strung together is the list the
  // reader already had, not analysis of it.
  if (copiedFact(text, req.facts)) out.push('copied-fact');

  return out;
}

const WINDOW = 10;
const wordsOf = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}' ]+/gu, ' ').split(/\s+/).filter(Boolean);

/** The first fact the text repeats word for word, ten words or more in a row; null when none. */
export function copiedFact(text: string, facts: PubFact[]): string | null {
  const hay = ` ${wordsOf(text).join(' ')} `;
  for (const f of facts) {
    const w = wordsOf(f.text);
    for (let i = 0; i + WINDOW <= w.length; i++) {
      if (hay.includes(` ${w.slice(i, i + WINDOW).join(' ')} `)) return f.text;
    }
  }
  return null;
}

/**
 * What may vouch for a number: the facts, and the names on the match. A
 * club called Schalke 04 or Hannover 96 carries its number in its name, and
 * a draft that names it was being thrown away as though it had made a
 * statistic up.
 */
function backing(req: WriteRequest): string[] {
  return [...req.facts.map((f) => f.text), req.home, req.away, req.competition];
}

/*
 * The furniture of football talk: numbers that are part of a phrase every
 * supporter uses, and that state nothing about this match. "The top four",
 * "down to ten men", "for 90 minutes", "a six-pointer". The check was reading
 * each as a claimed statistic, and in the run logs "invented number" was
 * nearly every draft thrown away. Removed before the numbers are counted.
 */
const IDIOMS = new RegExp([
  String.raw`\btop[- ](?:two|three|four|five|six|seven|eight|ten|half|2|3|4|5|6|8|10)\b`,
  String.raw`\bbottom[- ](?:two|three|four|five|six|half|2|3|4|5|6)\b`,
  String.raw`\b(?:ten|nine|10|9)[- ]men\b`,
  String.raw`\b(?:90|ninety)[- ]minutes?\b`,
  String.raw`\bsix[- ]pointer\b`,
  String.raw`\b(?:one|1)[- ](?:on|v)[- ](?:one|1)\b`,
  String.raw`\b(?:back|front)[- ](?:three|four|five|two|3|4|5|2)\b`,
  String.raw`\bnumber (?:9|10|nine|ten)\b`,
  String.raw`\b(?:4|3|5)-(?:3|4|2|5)-(?:3|2|1)(?:-1)?\b`,
].join('|'), 'gi');
const withoutIdioms = (text: string) => text.replace(IDIOMS, ' ');

const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve'];

/** Scorelines written with any dash are one scoreline: "3–1", "3—1" and "3-1". */
function unifyDashes(s: string): string {
  return s.replace(/(\d)\s*[–—-]\s*(\d)/g, '$1-$2');
}

/**
 * Whether the text uses a number no fact carries.
 *
 * A number is the same number however it is spelt: the facts say "won four of
 * their last six" and a draft that says "won 4 of their last 6" has invented
 * nothing. Rejecting it threw away good drafts and fell back to the template
 * voice, which was the commonest rejection in the run logs. A scoreline is one
 * token ("3-1"), so "3-1" in the text needs "3-1" in the facts, not a 3 and a
 * 1 from two different sentences.
 */
export function inventedNumber(text: string, allowed: string[], extra: RegExp = /(?!)/): boolean {
  return unbackedNumbers(text, allowed, extra).length > 0;
}

/** The numbers in `text` that nothing in `allowed` vouches for, in order. */
export function unbackedNumbers(text: string, allowed: string[], extra: RegExp = /(?!)/): string[] {
  const said = new Set<string>();
  for (const tok of unifyDashes(allowed.join(' ')).toLowerCase().match(/[a-z0-9.-]+/g) ?? []) {
    said.add(tok);
    // "3-1" also vouches for nothing else; a lone number vouches for its word.
    const i = NUMBER_WORDS.indexOf(tok);
    if (i >= 0) said.add(String(i));
    // Not "08": a club's founding year in its name (Sarpsborg 08) says nothing about eight.
    if (/^(?:0|[1-9]\d*)$/.test(tok) && Number(tok) < NUMBER_WORDS.length) said.add(NUMBER_WORDS[Number(tok)]!);
    // A trailing full stop is punctuation, not a decimal.
    if (tok.endsWith('.')) said.add(tok.replace(/\.+$/, ''));
  }
  const numbers = unifyDashes(withoutIdioms(text)).toLowerCase()
    .match(/\b\d+(?:[.-]\d+)?\b|\b(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/g) ?? [];
  const out: string[] = [];
  for (const tok of numbers) {
    if (said.has(tok) || HARMLESS.test(tok) || extra.test(tok)) continue;
    out.push(tok);
  }
  return out;
}

/**
 * A draft with one bad sentence is a good draft with one bad sentence. Where
 * the only fault is a number no fact carries, the sentences carrying one are
 * taken out; if what is left is still long enough, it stands. That keeps the
 * writing and removes the claim, which is the whole point of the check.
 */
export function withoutUnbacked(text: string, allowed: string[], extra: RegExp = /(?!)/): string {
  const sentences = text.match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g) ?? [text];
  return sentences.filter((s) => unbackedNumbers(s, allowed, extra).length === 0).join('').trim();
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
  const allowed = [...backing(req), req.call, odds ?? ''];
  if (findBannedInProse(text, allowed).length) out.push('banned-term');
  if (inventedNumber(text, allowed)) out.push('invented-number');
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
  const unbacked: string[] = [];
  let prompt = buildPrompt(req);
  const allowed = backing(req);
  const whyAllowed = [...allowed, req.call, oddsPhrase(req.odds) ?? ''];
  // What has passed so far: a preview from the first draft is kept if the
  // second is only for the members' paragraph, and the other way round.
  let good: string | null = null;
  let goodWhy: string | null = null;

  for (let attempt = 0; attempt < 2; attempt++) {
    let draft: string;
    try {
      draft = (await writer.generate(prompt)).trim();
    } catch (err) {
      rejections.push('error');
      return {
        text: null,
        rejections,
        unbacked,
        provider: writer.name,
        error: err instanceof Error ? err.message : String(err),
      };
    }

    let { preview, why } = splitDraft(draft);
    const seen = unbackedNumbers(preview, allowed);
    unbacked.push(...seen, ...(why ? unbackedNumbers(why, whyAllowed) : []));
    // Only a number out of place: take out the sentences that carry one.
    if (seen.length && validate(preview, req).every((p) => p === 'invented-number')) {
      preview = withoutUnbacked(preview, allowed);
    }
    if (why && unbackedNumbers(why, whyAllowed).length) why = withoutUnbacked(why, whyAllowed);

    const problems = validate(preview, req);
    const whyOk = !req.previewOnly && why && validateWhy(why, req).length === 0 ? tidy(why) : null;
    if (problems.length === 0) {
      good ??= tidy(preview);
      // A members' paragraph that failed is worth one more try while there is
      // one: it is the part a member pays to read. The preview already stands.
      if (req.previewOnly || whyOk || attempt === 1) {
        return { text: good, why: whyOk ?? goodWhy, rejections, unbacked, provider: writer.name };
      }
    } else {
      rejections.push(...problems);
    }
    goodWhy ??= whyOk;
    // The second attempt is told exactly what went wrong, rather than asked
    // the same question and given the same answer.
    prompt = buildPrompt(req) + feedback(preview, why, req);
  }

  return { text: good, why: goodWhy, rejections, unbacked, provider: writer.name };
}

/** Strip the wrapper a model reaches for even when told not to. */
function tidy(s: string): string {
  return s
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/^\**(preview|analysis|take)\**\s*:?\s*/i, '')
    // The dash as universal connector is the surest sign of machine prose. A
    // spaced dash between clauses becomes a comma; a dash inside a scoreline
    // ("2-1") has no spaces round it and is left alone.
    .replace(/\s*—\s*/g, ', ')
    .replace(/\s+(?:–|-{1,2})\s+/g, ', ')
    .replace(/,\s*,/g, ',')
    .replace(/\s+/g, ' ')
    .trim();
}
