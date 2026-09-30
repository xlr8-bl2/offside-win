import { config } from './config.ts';
import { exec, select } from './store.ts';
import { settleSelection } from './settle.ts';
import type { MarketCode, Outcome } from './types.ts';

/**
 * The bet slip: our most confident calls, combined to a total the owner asked for.
 *
 * The brief, in the owner's words: "the most probable to enter, the highest
 * confidence to reach, like two or three odds combined", and then, plainly,
 * "the top most confident picks should be there". So the slip is built from
 * the top of the board down: the most confident call goes on first, then the
 * next, until the total odds reach 2.00. A call that would push the total
 * past 3.00 is skipped and the next one tried. The call we are surest of is
 * always on the slip.
 *
 * An earlier version searched every combination for the best joint chance
 * inside the band, which is a sound objective and the wrong product: it would
 * leave the top call off in favour of four slightly longer ones, and a slip
 * that does not carry the day's best call is not the slip anyone asked for.
 *
 * What it will not do is pretend. Multiplying legs multiplies the risk, and the
 * slip says how often a slip like it comes in, in words, next to the odds.
 */

export interface Leg {
  fixture_id: number;
  kickoff: number;
  home: string;
  away: string;
  league: string | null;
  market: string;
  outcome: string;
  line: number | null;
  odds: number;
  bookmaker: string | null;
  /** Our chance of this leg landing. */
  model_prob: number;
}

export interface Slip {
  legs: Leg[];
  /** The legs' odds multiplied together. */
  odds: number;
  /** Our chance of every leg landing: the legs' chances multiplied. */
  chance: number;
  first_kickoff: number;
}

export interface SlipOptions {
  minOdds: number;
  maxOdds: number;
  minLegs: number;
  maxLegs: number;
  /** How many of the most likely calls to search over. */
  pool: number;
}

export const SLIP_DEFAULTS: SlipOptions = { minOdds: 2, maxOdds: 3, minLegs: 2, maxLegs: 6, pool: 14 };

/**
 * The combination of calls with the best chance of all landing, whose total
 * odds fall inside the band. Null when no combination does -- a quiet day with
 * three calls at odds of 1.15 cannot make 2.00, and inventing a slip from
 * weaker calls to fill the space is exactly what this is not for.
 */
export function buildSlip(candidates: Leg[], opts: SlipOptions = SLIP_DEFAULTS): Slip | null {
  // One leg per match: two calls on the same game are not independent, and a
  // slip that needs both is a slip on one game.
  const best = new Map<number, Leg>();
  for (const c of candidates) {
    if (!(c.odds > 1) || !(c.model_prob > 0 && c.model_prob < 1)) continue;
    const prev = best.get(c.fixture_id);
    if (!prev || c.model_prob > prev.model_prob) best.set(c.fixture_id, c);
  }
  const pool = [...best.values()].sort((a, b) => b.model_prob - a.model_prob).slice(0, opts.pool);

  // Top of the board down. A leg that would take the total past the band is
  // skipped, not the end of the search: the next most confident call may
  // still fit.
  const picked: Leg[] = [];
  let odds = 1;
  let chance = 1;
  for (const leg of pool) {
    if (picked.length >= opts.maxLegs) break;
    if (odds >= opts.minOdds) break;
    if (odds * leg.odds > opts.maxOdds) continue;
    picked.push(leg);
    odds *= leg.odds;
    chance *= leg.model_prob;
  }
  if (picked.length < opts.minLegs || odds < opts.minOdds || odds > opts.maxOdds) return null;

  const legs = [...picked].sort((a, b) => a.kickoff - b.kickoff);
  return {
    legs,
    odds: Number(odds.toFixed(2)),
    chance: Number(chance.toFixed(4)),
    first_kickoff: legs[0]!.kickoff,
  };
}

/**
 * How often a slip like this comes in, the way a person says it.
 *
 * "About four times in ten" rather than 41%: a percentage is a spreadsheet
 * number on this site, and "in ten" is how anybody would actually put it.
 */
export function chanceInWords(chance: number): string {
  const tenths = Math.round(chance * 10);
  if (tenths <= 0) return 'less than once in ten';
  if (tenths >= 10) return 'almost every time';
  const WORD = ['', 'once', 'twice', 'three times', 'four times', 'five times', 'six times',
    'seven times', 'eight times', 'nine times'];
  return `about ${WORD[tenths]} in ten`;
}

/* --------------------------------------------------------------- storage */


interface SlipRow { id: number; first_kickoff: number; legs_json: string }

/** The calls in the open slip, by fixture: the slate keeps these as posted. */
export async function openSlipLegs(): Promise<Map<number, { market: string; outcome: string; line: number | null }>> {
  const [current] = await select<SlipRow>(
    'SELECT id, first_kickoff, legs_json FROM slip WHERE settled_at IS NULL ORDER BY created_at DESC LIMIT 1',
  );
  const out = new Map<number, { market: string; outcome: string; line: number | null }>();
  if (!current) return out;
  try {
    for (const l of JSON.parse(current.legs_json) as Leg[]) {
      out.set(Number(l.fixture_id), { market: l.market, outcome: String(l.outcome), line: l.line === null ? null : Number(l.line) });
    }
  } catch { /* an unreadable slip pins nothing */ }
  return out;
}

/**
 * Post a slip when there is none open.
 *
 * A posted slip is fixed. It used to follow the board until its first
 * kick-off and then lose legs whenever a call on it was taken down, which is
 * no use to anyone: a slip is for placing as one bet, and a bet, once placed,
 * does not change. So it is built once, from the strongest calls of the next
 * day, stands as posted, and is graded on exactly those legs; the next one is
 * built when it has settled. The slate keeps the calls in it on the board as
 * well (see openSlipLegs), so the slip and the match pages always agree.
 */
export async function refreshSlip(now = Math.floor(Date.now() / 1000)): Promise<Slip | null> {
  const [current] = await select<SlipRow>(
    'SELECT id, first_kickoff, legs_json FROM slip WHERE settled_at IS NULL ORDER BY created_at DESC LIMIT 1',
  );
  if (current) return null;

  const rows = await select<Leg & { home_team: string; away_team: string }>(
    `SELECT p.fixture_id, p.kickoff, f.home_team, f.away_team, l.name AS league,
            p.market, p.outcome, p.line, p.odds, p.bookmaker, p.model_prob
     FROM pick p JOIN fixture f ON f.id = p.fixture_id
     LEFT JOIN league l ON l.id = f.league_id
     WHERE p.kind = 'CONFIDENT' AND p.settled_at IS NULL
       AND p.kickoff > ? AND p.kickoff < ?
       AND p.model_prob >= ?`,
    // The next day only. It was the next two days, so a slip that locked on
    // a Friday evening could have its last leg on Sunday, stay open until
    // then, and stop Saturday's slip being built at all.
    // Never a lean (a marquee game answered under the normal bar, which the
    // page frames as a read on a tight game): every leg of a slip has to land.
    [now + 15 * 60, now + 24 * 3600, config.confident.floor],
  );
  const slip = buildSlip(rows.map((r) => ({
    fixture_id: Number(r.fixture_id), kickoff: Number(r.kickoff), home: r.home_team, away: r.away_team,
    league: r.league ?? null, market: r.market, outcome: String(r.outcome), line: r.line === null ? null : Number(r.line),
    odds: Number(r.odds), bookmaker: r.bookmaker ?? null, model_prob: Number(r.model_prob),
  })));

  // Nothing reaches the band yet: no slip today, rather than a weak one.
  if (!slip) return null;
  await exec('INSERT INTO slip (created_at, first_kickoff, legs_json, odds, chance) VALUES (?, ?, ?, ?, ?)',
    [now, slip.first_kickoff, JSON.stringify(slip.legs), slip.odds, slip.chance]);
  return slip;
}

/** A withdrawn leg's result from the final score; null until there is one, VOID if never played. */
async function gradeWithdrawn(l: Leg): Promise<string | null> {
  const [f] = await select<{ home_goals: number | null; away_goals: number | null; status: string | null }>(
    'SELECT home_goals, away_goals, status FROM fixture WHERE id = ?', [l.fixture_id],
  );
  if (!f) return 'VOID';
  if (/postpon|cancel|abandon|suspend/i.test(String(f.status ?? ''))) return 'VOID';
  if (f.home_goals === null || f.away_goals === null) return null;
  const out = settleSelection(l.market as MarketCode, l.outcome as Outcome, l.line, Number(l.odds),
    { homeGoals: Number(f.home_goals), awayGoals: Number(f.away_goals), homeCorners: null, awayCorners: null, reds: null });
  return out?.result ?? 'VOID';
}

/**
 * Grade the slips whose legs have been graded.
 *
 * A slip is lost the moment one leg is; won when every leg is in and none
 * lost. A leg with a stake back (or a call withdrawn before its kick-off) drops
 * out, the way a bookmaker settles a void leg; a slip whose every leg dropped
 * out is void.
 */
export async function settleSlips(now = Math.floor(Date.now() / 1000)): Promise<number> {
  const open = await select<SlipRow>(
    'SELECT id, first_kickoff, legs_json FROM slip WHERE settled_at IS NULL AND first_kickoff <= ?', [now],
  );
  let settled = 0;
  for (const s of open) {
    const legs = JSON.parse(s.legs_json) as Leg[];
    const results: Array<string | null> = [];
    const states: string[] = [];
    for (const l of legs) {
      // Written out rather than `IS NOT DISTINCT FROM ?`: a null parameter
      // there has no type Postgres can infer.
      const [row] = await select<{ result: string | null; settled_at: number | null }>(
        `SELECT result, settled_at FROM pick WHERE fixture_id = ? AND kind = 'CONFIDENT'
           AND market = ? AND outcome = ? AND ${l.line === null ? 'line IS NULL' : 'line = ?'}`,
        l.line === null ? [l.fixture_id, l.market, l.outcome] : [l.fixture_id, l.market, l.outcome, l.line],
      );
      // A leg whose call was withdrawn before kick-off (the engine fell below
      // its bar for it) is still graded on the score: the slip was posted, and
      // a slip once posted is a bet someone may have placed. Voiding it would
      // quietly take a losing leg out of the record. Only a match that was
      // never played voids a leg.
      const r = row ? (row.settled_at ? row.result : null) : await gradeWithdrawn(l);
      results.push(r);
      // Kick-off time and state only: the log is public, and a later leg may
      // not have kicked off yet.
      states.push(`${new Date(l.kickoff * 1000).toISOString().slice(5, 16).replace('T', ' ')} ${r ?? (l.kickoff <= now ? 'waiting' : 'to play')}`);
    }
    const lost = results.some((r) => r === 'LOST' || r === 'HALF_LOST');
    const pending = results.some((r) => r === null);
    if (!lost && pending) {
      console.log(`  slip ${s.id} still open: ${states.join('; ')}`);
      continue;
    }
    const counted = results.filter((r) => r === 'WON' || r === 'HALF_WON');
    const result = lost ? 'LOST' : counted.length ? 'WON' : 'VOID';
    await exec('UPDATE slip SET result = ?, settled_at = ? WHERE id = ?', [result, now, s.id]);
    settled++;
  }
  return settled;
}
