/**
 * The words on the channel's posts. Loud, in the site's pundit voice
 * (offside-voice), and inside the lines that keep a betting channel legal:
 *
 * - opinion, never certainty: no "lock", "banker", "guaranteed", "can't lose";
 * - never money: no profit, no returns, no staking sums;
 * - the true count on every results post, the misses shown, a bad day owned.
 *
 * The morning headline is written by Gemini from the call's own analysis when
 * a key is set, checked against all of the above and the site's banned
 * vocabulary, and falls back to a line built from the market when it fails.
 */

import { isClean } from '../vocabulary.ts';
import { DEFAULT_MODEL } from '../narrate/gemini.ts';

const NUM = ['none', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
export const word = (n: number) => NUM[n] ?? String(n);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Words a betting channel must not use about a call: they promise an outcome or money. */
const PROMISE = /\b(lock|locks|banker|bankers|guarantee\w*|certain\w*|sure thing|can'?t lose|cannot lose|free money|easy money|profit\w*|cash|win big|nailed on|dead cert|risk[- ]free|bet\b|bets\b|betting|stake\w*|punt\w*)\b/i;

export const clean = (s: string) => !PROMISE.test(s) && !/\d/.test(s) && isClean(s);

const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!));
/** "*word*" → the highlighted span the graphics use. */
export const highlight = (s: string) => esc(s).replace(/\*([^*]+)\*/g, '<span>$1</span>');
export const plain = (s: string) => s.replace(/\*/g, '');

export interface CallFacts {
  market: string; outcome: string; line: number | null;
  home: string; away: string; backed: string; other: string;
}

/** A headline from the market alone, for when no writer is available. */
export function fallbackHook(c: CallFacts): string {
  const t = c.backed;
  switch (c.market) {
    case '1x2':
      return c.outcome === 'DRAW' ? 'Nobody *wins* this one.' : `${t} *win* this. Simple.`;
    case 'draw_no_bet':
      return `${t} *win* this.`;
    case 'double_chance':
      return c.outcome === '12' ? 'Somebody *wins* this.' : `${t} *don't lose* this.`;
    case 'asian_handicap':
    case 'european_handicap': {
      const own = c.line === null ? 0 : c.outcome === 'HOME' ? c.line : -c.line;
      if (own > 0) return `Write ${t} off? *Not a chance.*`;
      if (own < 0) return `${t} don't just win. *They run it.*`;
      return `${t} *win* this.`;
    }
    default:
      if (/over/i.test(c.outcome)) return `Goals. *Plenty* of them.`;
      if (/under/i.test(c.outcome)) return `This one stays *tight.*`;
      return `${c.home} v ${c.away}. *Our call.*`;
  }
}

/** Gemini's headline for the call, or null when there is no key, no answer or it fails the checks. */
export async function writtenHook(c: CallFacts, analysis: string, callName: string): Promise<string | null> {
  const key = process.env['GEMINI_API_KEY'];
  if (!key || !analysis) return null;
  const model = process.env['GEMINI_MODEL'] || DEFAULT_MODEL;
  const prompt = `You write the headline on a football tipster's social post. Voice: a pundit winding up fans who actually knows ball. Short, punchy, opinionated, British English.

The match: ${c.home} v ${c.away}.
Our call: ${callName} (we are backing ${c.backed}).
Our analysis: ${analysis}

Write ONE headline of 5 to 10 words that argues for the call using something real from the analysis (an injury, form, a weakness). It can be two short sentences.
Rules: no numbers or digits, no odds, no mention of betting, money, profit, or certainty (never "lock", "banker", "guaranteed", "can't lose", "sure thing"). No hashtags, no emoji, no quotation marks.
Wrap the single most important word or two in *asterisks*.
Reply with the headline only.`;
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 1.0, maxOutputTokens: 2048 } }),
      signal: AbortSignal.timeout(45_000),
    });
    if (!res.ok) return null;
    const j = await res.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    const text = (j.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('').trim().replace(/^["'“]+|["'”]+$/g, '').split('\n')[0]!.trim();
    const words = plain(text).split(/\s+/).filter(Boolean).length;
    if (words < 3 || words > 12 || !clean(plain(text))) return null;
    if (!text.includes('*')) return text.replace(/(\S+)\s*$/, '*$1*');
    return text;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------- results */

export interface DayCount { landed: number; graded: number }

/** The results graphic's headline, by how the day went. */
export function resultsHook({ landed, graded }: DayCount): string {
  const r = landed / graded;
  if (landed === graded) return graded >= 3 ? `Clean sweep. <span style="color:var(--won)">All ${word(graded)}.</span>` : `<span style="color:var(--won)">Landed.</span> Next.`;
  if (r >= 0.7) return `${cap(word(landed))} from ${word(graded)}. <span style="color:var(--won)">Told you.</span>`;
  if (r >= 0.5) return `${cap(word(landed))} from ${word(graded)}. <span>Job done.</span>`;
  return `<span style="color:var(--lost)">Rough one.</span> We go again.`;
}

/** The results post's opening lines, by how the day went. */
export function resultsLead({ landed, graded }: DayCount, day: string): string[] {
  const r = landed / graded;
  if (landed === graded && graded >= 3) return [`🔥 <b>CLEAN SWEEP. ${landed} from ${graded}.</b>`, `${day} went exactly to script. Every one is on the picture.`];
  if (landed === graded) return [`✅ <b>${landed} from ${graded}.</b>`, `${day} done.`];
  if (r >= 0.7) return [`✅ <b>${landed} from ${graded} on ${day}.</b>`, `Another good night. The miss is on the list too, because that's how this works.`];
  if (r >= 0.5) return [`<b>${landed} from ${graded} on ${day}.</b>`, 'Not pretty, job done. Every call is below, the misses included.'];
  return [`😤 <b>Rough one. ${landed} from ${graded} on ${day}.</b>`, 'No hiding it, every miss is below. Back tomorrow with the free call.'];
}
