/**
 * `lab` with the argument `deep pulls`: calls on matches still to play that
 * the slate has taken down, why, and which of the bar's tests each one now
 * fails at today's prices.
 *
 * Prints teams, the published reason (which never names the call) and the
 * names of tests. Never the call, its market or its price: these matches are
 * still to be played.
 */

import { select } from '../store.ts';
import { optionsFor, toHistRow, type Option } from './markets.ts';
import { PROD } from './tune.ts';
import { failedGate } from './deep.ts';

export async function runPulls(): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const rows = await select<{ fixture_id: number; home: string; away: string; market: string; outcome: string; line: number | null; reason: string; published_at: number; pulled_at: number; replaced_by: string | null }>(
    `SELECT fixture_id, home, away, market, outcome, line, reason, published_at, pulled_at, replaced_by
       FROM pulled_call WHERE kickoff > $1 AND restored_at IS NULL ORDER BY pulled_at DESC LIMIT 60`, [now]);
  console.log(`${rows.length} calls on matches still to play have been taken down`);
  const hold = { ...PROD, name: 'hold', minProb: PROD.minProb - 0.01, rankFloor: Object.fromEntries(Object.entries(PROD.rankFloor ?? {}).map(([k, v]) => [k, v - 0.01])), minEv: PROD.minEv - 0.02, minSharpEv: (PROD.minSharpEv ?? 0) - 0.02, maxDrift: (PROD.maxDrift ?? 0.01) + 0.02 };
  for (const r of rows) {
    const [f] = await select<{ bundle_json: string; rank: number | null; league_id: number; kickoff: number }>(
      'SELECT bundle_json, rank, league_id, kickoff FROM fixture WHERE id = $1', [r.fixture_id]);
    let gate = 'no snapshot', held = '';
    if (f) {
      try {
        const b = JSON.parse(f.bundle_json);
        const row = toHistRow({ ...b, id: r.fixture_id, league_id: f.league_id, rank: f.rank, kickoff: f.kickoff, score: [0, 0] });
        const o: Option | undefined = row ? optionsFor(row, PROD.modelWeight).find((x) => x.market === r.market && String(x.outcome) === String(r.outcome) && (x.line ?? null) === (r.line === null ? null : Number(r.line))) : undefined;
        if (!row || !o) gate = 'market no longer priced';
        else {
          gate = failedGate(PROD, row, o) ?? 'passes now';
          held = failedGate(hold, row, o) ?? 'would hold';
        }
      } catch { gate = 'unreadable snapshot'; }
    }
    const age = ((r.pulled_at - r.published_at) / 3600).toFixed(1);
    console.log(`  ${r.home} v ${r.away}: up ${age}h, pulled ${new Date(r.pulled_at * 1000).toISOString().slice(11, 16)} | now fails: ${gate}${held ? ` | with the hold slack: ${held}` : ''} | replaced: ${r.replaced_by ? 'yes' : 'no'} | "${r.reason}"`);
  }
}
