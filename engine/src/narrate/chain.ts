/**
 * The analysis as an argument, in order.
 *
 * The writer used to get the eighteen heaviest facts in one list. The reads
 * about who makes the better chances weigh more than nearly anything else, so
 * every write-up led on them, and the owner said so: "biased towards chance
 * creation... who created the chances, why, how did they come about, what are
 * their tactics". A list ranked by weight is not an argument.
 *
 * So the facts are handed over in the order a pundit builds a case, each step
 * with its own share of the space and both sides in every step:
 *
 *   1. the situation: what is riding on it and the state each side is in;
 *   2. how each side plays and makes its chances;
 *   3. who drives it, and who is missing and what that changes;
 *   4. the conditions, and the luck in the results.
 *
 * The verdict follows from those, and the strongest facts for the other side
 * are kept, so the case is made against the evidence and not around it.
 */

import type { PubFact, Topic } from './facts.ts';

interface Step {
  label: string;
  topics: Topic[];
  /** At most this many facts in the step. */
  cap: number;
  /** And at most this many about either side. */
  perSide: number;
}

export const STEPS: Step[] = [
  { label: 'WHERE THEY ARE (what is riding on it, form, the manager, the schedule)', topics: ['situation'], cap: 8, perSide: 4 },
  { label: 'HOW THEY PLAY (where the chances come from, at each end)', topics: ['play'], cap: 4, perSide: 2 },
  { label: 'WHO IS PLAYING AND WHO IS NOT (and what that changes)', topics: ['missing', 'people'], cap: 6, perSide: 3 },
  { label: 'EVERYTHING ELSE (conditions, and results ahead of or behind the football)', topics: ['conditions', 'luck'], cap: 3, perSide: 2 },
];

/** A fact from before topics existed is placed by what it says. */
export function topicOf(f: PubFact): Topic {
  if (f.topic) return f.topic;
  if (f.lean === 0) return 'luck';
  if (f.lean !== undefined) return 'play';
  if (/\b(without|out for|suspended|misses|not in the)\b/.test(f.text)) return 'missing';
  if (/\b(start|in goal|fancied to score|line up)\b/.test(f.text)) return 'people';
  if (/\b(rain|wind|freezing|referee)\b/.test(f.text)) return 'conditions';
  return 'situation';
}

/** The facts for each step, heaviest first, in proportion. */
export function chain(facts: PubFact[]): Array<{ label: string; facts: PubFact[] }> {
  const used = new Set<PubFact>();
  return STEPS.map((step) => {
    const pool = facts.filter((f) => step.topics.includes(topicOf(f))).sort((a, b) => b.weight - a.weight);
    const per = { home: 0, away: 0, match: 0 };
    const chosen: PubFact[] = [];
    for (const f of pool) {
      if (chosen.length >= step.cap || used.has(f)) continue;
      if (f.side !== 'match' && per[f.side] >= step.perSide) continue;
      per[f.side]++;
      chosen.push(f);
      used.add(f);
    }
    return { label: step.label, facts: chosen };
  }).filter((s) => s.facts.length);
}

/** The brief as the prompt shows it. */
export function brief(facts: PubFact[]): string {
  return chain(facts).map((s) => `${s.label}:\n${s.facts.map((f) => `- ${f.text}`).join('\n')}`).join('\n\n');
}

/** Every fact the brief hands over, for the checks that only allow those. */
export function briefFacts(facts: PubFact[]): PubFact[] {
  return chain(facts).flatMap((s) => s.facts);
}
