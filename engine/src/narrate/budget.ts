/**
 * The writer's daily allowance, shared by every run of the day.
 *
 * The slate runs every fifteen minutes, ninety-six times a day, and each run
 * only knew its own count (GEMINI_PER_RUN). Twelve a run is well inside any
 * per-minute limit and far past any free daily one, and once Google said the
 * day was spent, every later run asked again, got the same 429, and spent its
 * first minute finding out. So the count is kept for the day, in kv, and the
 * writer stands down when either the count reaches GEMINI_PER_DAY or Google
 * has said no, until the quota resets.
 *
 * Google resets free-tier daily quotas at midnight Pacific time, so that is
 * the day this counts in, not UTC and not London.
 */

import { QuotaExhausted } from './gemini.ts';
import type { Writer } from './write.ts';

export interface BudgetState {
  /** The Pacific calendar day this count is for, as YYYY-MM-DD. */
  day: string;
  /**
   * Which key it counts for: a short hash, never the key. A new key (a new
   * account, a new quota) starts the day at nothing; without this, a key
   * swapped in after the old one hit Google's limit was not used until the
   * next day.
   */
  key?: string;
  /** Requests sent today, across every run. */
  used: number;
  /** Google answered with its daily limit: nothing more until tomorrow. */
  exhausted: boolean;
  /**
   * When to ask again after Google refused for quota. Not the end of the day:
   * the first refusal a brand-new key got was a one-off (the same key answered
   * at once a few minutes later), and treating it as final kept the writer
   * off until midnight Pacific. One request every two hours is what finding
   * out costs when the day really is spent.
   */
  pausedUntil?: number;
}

export function pacificDay(ms = Date.now()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(ms);
}

/** Today's state for this key: yesterday's count, or another key's, does not carry over. */
export function todays(saved: BudgetState | null, day = pacificDay(), key?: string): BudgetState {
  const k = key ?? (saved?.day === day ? saved?.key : undefined);
  const base = { day, ...(k ? { key: k } : {}) };
  return saved && saved.day === day && (!key || saved.key === key)
    ? { ...base, used: Number(saved.used) || 0, exhausted: Boolean(saved.exhausted),
        ...(Number(saved.pausedUntil) ? { pausedUntil: Number(saved.pausedUntil) } : {}) }
    : { ...base, used: 0, exhausted: false };
}

/** A short, one-way fingerprint of the key, safe to store and to log. */
export async function keyId(apiKey: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(apiKey));
  return [...new Uint8Array(buf)].slice(0, 6).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** How long a quota refusal pauses the writer. */
export const PAUSE = 2 * 3600;

export function spent(state: BudgetState, limit: number): boolean {
  // A refusal saved before pauses existed has no pausedUntil, and does not stop anything.
  return state.used >= limit || (state.pausedUntil ?? 0) > Math.floor(Date.now() / 1000);
}

/**
 * The writer, counting against the day. A request past the allowance is not
 * sent at all; Google's own "that is the day" is remembered, so the next run
 * does not ask again.
 */
export function budgeted(writer: Writer, state: BudgetState, limit: number): Writer {
  return {
    name: writer.name,
    async generate(prompt: string): Promise<string> {
      if (spent(state, limit)) throw new QuotaExhausted(`today's allowance of ${limit} is spent`);
      state.used++;
      try {
        return await writer.generate(prompt);
      } catch (err) {
        if (err instanceof QuotaExhausted) {
          state.exhausted = true;
          state.pausedUntil = Math.floor(Date.now() / 1000) + PAUSE;
        }
        throw err;
      }
    },
  };
}
