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
  /** Requests sent today, across every run. */
  used: number;
  /** Google answered with its daily limit: nothing more until tomorrow. */
  exhausted: boolean;
}

export function pacificDay(ms = Date.now()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(ms);
}

/** Today's state: yesterday's count does not carry over. */
export function todays(saved: BudgetState | null, day = pacificDay()): BudgetState {
  return saved && saved.day === day
    ? { day, used: Number(saved.used) || 0, exhausted: Boolean(saved.exhausted) }
    : { day, used: 0, exhausted: false };
}

export function spent(state: BudgetState, limit: number): boolean {
  return state.exhausted || state.used >= limit;
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
        if (err instanceof QuotaExhausted) state.exhausted = true;
        throw err;
      }
    },
  };
}
