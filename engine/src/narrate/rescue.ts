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
  const name = (side: 'home' | 'away') => (side === 'home' ? home : away);

  // How good each side looks underneath, from the reads about quality only.
  // The reads about luck say the results will move, not who is better, and
  // counting them in made Albania v San Marino "closer than it looks".
  const score = { home: 0, away: 0 };
  const said = { home: 0, away: 0 };
  for (const r of reads) {
    if (!r.lean) continue;
    score[r.side as 'home' | 'away'] += r.lean;
    said[r.side as 'home' | 'away']++;
  }
  const better: 'home' | 'away' = decides?.decides ?? (score.home >= score.away ? 'home' : 'away');
  const worse: 'home' | 'away' = better === 'home' ? 'away' : 'home';
  const B = name(better), W = name(worse);
  const gap = score[better] - score[worse];

  // Which kind of match this is, said once at the top and once at the end.
  let take: string;
  let close: string;
  if (decides || (score[better] > 0 && score[worse] < 0) || (score[better] > 0 && gap >= 2)) {
    take = pick([
      `Look past the results and this is ${B}'s game.`,
      `Everything underneath the results points to ${B}.`,
      `The results only tell half of this one, and the other half is all ${B}.`,
    ], seed);
    close = decides ? sentence(decides.text) : pick([
      `If that carries on, ${B} should have the better of it.`,
      `That is the pattern to trust here, and it favours ${B}.`,
    ], seed);
  } else if (score[better] > 0) {
    take = said[worse]
      ? `Two sides doing the right things underneath the results, and ${B} doing a little more of them.`
      : `${B} are the side doing the right things underneath the results.`;
    close = said[worse] ? 'Whoever makes the better chances on the day takes this one.' : `If that carries on, ${B} should have the better of it.`;
  } else if (score[worse] < 0 && score[better] < 0) {
    take = gap >= 2
      ? `Neither of these is in good shape underneath the results, and ${W} are in the worse of it.`
      : 'Neither of these is in good shape underneath the results.';
    close = 'The side that stops giving up the better chances first takes this one.';
  } else if (score[worse] < 0) {
    take = `${W} are in trouble, and not only on results.`;
    close = `Until ${W} sort that out, they are there to be got at.`;
  } else {
    take = 'The results here are not telling the whole story.';
    close = 'Whoever makes the better chances on the day takes this one.';
  }

  // The read that puts both sides together says the general one for each, so
  // those are left to it rather than said twice.
  const general = /^[^,]+ have (created the better chances|been out-created) in /;
  const pool = decides && reads.filter((r) => !general.test(r.text)).length >= MIN_READS
    ? reads.filter((r) => !general.test(r.text))
    : reads;

  // The strongest read, then the best from the other side, then the next best:
  // an argument about both teams, not three lines about one.
  const chosen: PubFact[] = [pool[0]!];
  const otherSide = pool.find((r) => r.side !== pool[0]!.side);
  if (otherSide) chosen.push(otherSide);
  for (const r of pool) {
    if (chosen.length >= 3) break;
    if (!chosen.includes(r)) chosen.push(r);
  }
  // Grouped by side, the better side first, quality before luck within it,
  // so the paragraph turns from one team to the other only once.
  chosen.sort((a, b) => (a.side === b.side ? Math.abs(b.lean ?? 0) - Math.abs(a.lean ?? 0) || b.weight - a.weight : a.side === better ? -1 : 1));

  const body = chosen.map((r, i) => {
    if (i === 0) return sentence(r.text);
    const same = r.side === chosen[i - 1]!.side;
    const text = same ? asThey(r.text, name(r.side as 'home' | 'away')) : lowerLead(r.text);
    const lead = same ? pick(['And', 'On top of that,'], seed + i) : pick(['Meanwhile,', 'As for the other side,'], seed + i);
    return `${lead} ${text.trim().replace(/[.\s]*$/, '.')}`;
  });

  const text = [take, ...body, close].join(' ');
  if (text.split(/\s+/).length < MIN_WORDS) return null;
  // Every read is already said in the pub's words; this only makes sure.
  if (findBannedInProse(text, [home, away, ...facts.map((f) => f.text)]).length) return null;
  return text;
}

/** The same side again: "they", not the name a second time. */
function asThey(t: string, team: string): string {
  if (t.startsWith(`${team} `)) return `they ${t.slice(team.length + 1)}`;
  const m = /^(At home|Away from home), /.exec(t);
  if (m && t.slice(m[0].length).startsWith(`${team} `)) return `${m[1]!.toLowerCase()}, they ${t.slice(m[0].length + team.length + 1)}`;
  return lowerLead(t);
}

/**
 * "At home, Scotland have..." after a connector reads "Meanwhile, at home,
 * Scotland have...". A read that opens with a team name keeps its capital.
 */
function lowerLead(t: string): string {
  return /^(At home|Away from home)\b/.test(t) ? t.charAt(0).toLowerCase() + t.slice(1) : t;
}
