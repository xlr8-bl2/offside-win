/**
 * A paragraph made from the reads alone, for when the writer cannot help.
 *
 * Two things sent the site back to the template grammar: a day's free Gemini
 * allowance running out before lunch, and a draft failing its checks twice.
 * Either way the reader got "took over only three games ago" and a list of
 * who starts, which is the analysis the owner asked us to stop writing.
 *
 * The reads underneath the results (insight.ts) are already said the way a
 * supporter would say them, and each knows which way it points. So when the
 * writer has nothing, they are put together here: a take, two or three reads,
 * and what decides it. It is plainer than a written paragraph, and it says
 * something the reader could not have looked up, which the old grammar did not.
 *
 * Never cached under the writer's key, so the writer replaces it the next time
 * it has the allowance.
 */

import { findBannedInProse } from '../vocabulary.ts';
import type { PubFact } from './facts.ts';

/** Fewer reads than this and there is no argument to make; the grammar keeps it. */
const MIN_READS = 2;
const MIN_WORDS = 40;

const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
const sentence = (t: string) => cap(t.trim()).replace(/[.\s]*$/, '.');

/** A stable choice per match, so a page does not change voice every run. */
function pick<T>(xs: T[], seed: number): T {
  return xs[Math.abs(seed) % xs.length]!;
}

function seedOf(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function fromReads(home: string, away: string, facts: PubFact[]): string | null {
  const reads = facts.filter((f) => f.lean !== undefined && f.side !== 'match')
    .sort((a, b) => b.weight - a.weight);
  if (reads.length < MIN_READS) return null;
  const decides = facts.find((f) => f.decides);
  const seed = seedOf(`${home}|${away}`);

  // Which way the reads point, home minus away.
  let net = 0;
  for (const r of reads) net += (r.side === 'home' ? 1 : -1) * (r.lean ?? 0);
  if (decides) net += decides.decides === 'home' ? 2 : -2;
  const fav = net > 0 ? home : away;
  const other = net > 0 ? away : home;

  const take = Math.abs(net) >= 2
    ? pick([
      `Look past the results and this is ${fav}'s game.`,
      `Everything underneath the results points to ${fav}.`,
      `The results only tell half of this one, and the other half is all ${fav}.`,
    ], seed)
    : Math.abs(net) === 1
      ? pick([
        `${fav} have the better of the football underneath this one, if not by much.`,
        `There is a little more to ${fav} than to ${other} once you look past the results.`,
      ], seed)
      : pick([
        'Look underneath the results and there is not much to choose between these two.',
        'Strip away the results and these two are closer than they look.',
      ], seed);

  // The strongest read, then the best from the other side, then the next best:
  // an argument about both teams, not three lines about one.
  const chosen: PubFact[] = [reads[0]!];
  const otherSide = reads.find((r) => r.side !== reads[0]!.side);
  if (otherSide) chosen.push(otherSide);
  for (const r of reads) {
    if (chosen.length >= 3) break;
    if (!chosen.includes(r)) chosen.push(r);
  }

  const body = chosen.map((r, i) => {
    if (i === 0) return sentence(r.text);
    const same = r.side === chosen[i - 1]!.side;
    const lead = same ? pick(['And', 'On top of that,'], seed + i) : pick(['Meanwhile,', 'On the other side,'], seed + i);
    return `${lead} ${lowerLead(r.text.trim()).replace(/[.\s]*$/, '.')}`;
  });

  const close = decides
    ? sentence(decides.text)
    : Math.abs(net) >= 1
      ? pick([
        `If that carries on, ${fav} should have the better of it.`,
        `That is the pattern to trust here, and it favours ${fav}.`,
      ], seed)
      : 'Whoever makes the better chances on the day takes this one.';

  const text = [take, ...body, close].join(' ');
  if (text.split(/\s+/).length < MIN_WORDS) return null;
  // Every read is already said in the pub's words; this only makes sure.
  if (findBannedInProse(text, [home, away, ...facts.map((f) => f.text)]).length) return null;
  return text;
}

/**
 * "At home, Scotland have..." after a connector reads "Meanwhile, at home,
 * Scotland have...". A read that opens with a team name keeps its capital.
 */
function lowerLead(t: string): string {
  return /^(At home|Away from home)\b/.test(t) ? t.charAt(0).toLowerCase() + t.slice(1) : t;
}
