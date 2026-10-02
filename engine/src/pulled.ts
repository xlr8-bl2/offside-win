/**
 * Pulled calls: what we say when we take one down before kick-off.
 *
 * The slate looks at every match again each fifteen minutes and withdraws a
 * call it no longer stands behind (slate.ts, after the pick upsert). It used to
 * delete the row and say nothing, so a member who had seen the call, and
 * perhaps backed it, found it gone with no word why. Most tipsters stay quiet
 * when they change their mind; telling people straight away is the point.
 *
 * This writes the reason, in the same voice as everything else on the site,
 * from what changed: the side has been rotated, or someone who matters is out.
 * Failing those, it says so plainly rather than inventing a cause. The reason
 * never names the call itself, because everyone can read it on the match page
 * and the call was a members' one; the call's name and what replaced it are
 * kept apart and shown to members only (schema.pg.sql, get_fixture).
 */

// @ts-expect-error -- plain JS module shared with the site
import { describe } from '../../public/js/lib/markets.js';
import { ROTATED_AT, sideBacked, type XiChanges } from './context/xi.ts';
import { findBannedInProse } from './vocabulary.ts';
import type { Factor } from './types.ts';

export interface PullContext {
  home: string;
  away: string;
  changes: XiChanges | null | undefined;
  /** The availability factors from this run. */
  factors: Factor[];
}

export interface PulledCall {
  market: string;
  outcome: string;
  line: number | null;
  /** The pick's stored evidence from when it was published, raw. */
  evidence_json?: string | null;
}

/** A call published this recently is churn, not news: no email for it. */
export const QUIET_IF_YOUNGER_S = 30 * 60;

const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven'];
const say = (n: number) => WORDS[n] ?? String(n);
const listOf = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

/** The call in words, as the site names it ("France to win", "Two or more goals"). */
export function callName(c: { market: string; outcome: string; line: number | null }, home: string, away: string): string {
  return String(describe({ market: c.market, outcome: c.outcome, line: c.line, home, away, odds: null }).name);
}

/**
 * Why the call came down, without naming it.
 *
 * Only news the call did not already have counts: a player who was out when
 * we published it is not a reason for pulling it now, so a name already in
 * the call's own evidence is passed over.
 */
export function pullReason(c: PulledCall, ctx: PullContext, replaced: boolean): string {
  const backed = sideBacked(c.market, String(c.outcome));
  const sides: Array<'home' | 'away'> = backed ? [backed] : ['home', 'away'];
  const team = (s: 'home' | 'away') => (s === 'home' ? ctx.home : ctx.away);
  const before = String(c.evidence_json ?? '');

  // The side on the sheet is not the one that was expected.
  for (const s of sides) {
    const ch = ctx.changes?.[s];
    if (!ch || ch.n < ROTATED_AT) continue;
    const names = ch.out.slice(0, 3);
    const line = names.length
      ? `${team(s)} have made ${say(ch.n)} changes from the side expected. ${listOf(names)} ${names.length === 1 ? 'doesn’t' : 'don’t'} start.`
      : `${team(s)} have made ${say(ch.n)} changes from the side expected.`;
    if (!findBannedInProse(line).length) return line;
  }

  // Someone who matters is out, and wasn't when we made the call.
  for (const s of sides) {
    const f = ctx.factors.find((x) => x.id === `availability.${s}.absences` && x.state === 'COMPUTED');
    const m = /, and (.+?) (?:is a real loss|are real losses)\.$/.exec(f?.note ?? '');
    if (!m) continue;
    const names = m[1]!.split(/, | and /).map((n) => n.trim()).filter(Boolean);
    const fresh = names.filter((n) => !before.includes(n));
    if (!fresh.length) continue;
    const line = `${team(s)} are without ${listOf(fresh)}.`;
    if (!findBannedInProse(line).length) return line;
  }

  return replaced
    ? 'The latest team news and prices point to a better call on this match.'
    : 'With the latest team news and prices, it’s no longer one we’d back.';
}
