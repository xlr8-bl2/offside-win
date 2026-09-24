import { settleSlips } from './slip.ts';
import { bsdOrNull, num } from './bsd.ts';
import { postMortem } from './postmortem.ts';
import { isQuarterLine } from './price.ts';
import { exec, insertMany, kvSetJSON, select } from './store.ts';
import { MARKET_FAMILY } from './types.ts';
import type { MarketCode, MarketFamily, Outcome } from './types.ts';

/**
 * Grading published picks, and feeding the result back into how much the model
 * is trusted next time.
 *
 * This is what separates a tipping service from an analyzer. Without it there is
 * no evidence the picks are any good, and no mechanism for the model to become
 * more careful about the markets it has been wrong on. §13's "never ignores the
 * market" cuts both ways: if our corner calls have been losing, the corner
 * shrinkage should rise on its own rather than waiting for someone to notice.
 */

export type Result = 'WON' | 'LOST' | 'PUSH' | 'HALF_WON' | 'HALF_LOST' | 'VOID';

interface FinalScore {
  homeGoals: number;
  awayGoals: number;
  homeCorners: number | null;
  awayCorners: number | null;
  reds: number | null;
}

/**
 * Settle one selection. Returns the result and the profit on a one-unit stake.
 *
 * Asian handicaps are the fiddly part and the reason this is not a one-liner:
 * a whole line refunds on the exact margin, a quarter line splits the stake, and
 * getting either wrong silently corrupts every performance number downstream.
 */
export function settleSelection(
  market: MarketCode,
  outcome: Outcome,
  line: number | null,
  odds: number,
  s: FinalScore,
): { result: Result; pnl: number } | null {
  const total = s.homeGoals + s.awayGoals;
  const win = (): { result: Result; pnl: number } => ({ result: 'WON', pnl: odds - 1 });
  const lose = (): { result: Result; pnl: number } => ({ result: 'LOST', pnl: -1 });
  const push = (): { result: Result; pnl: number } => ({ result: 'PUSH', pnl: 0 });
  const won = (b: boolean) => (b ? win() : lose());

  switch (market) {
    case '1x2':
      return won(
        (outcome === 'HOME' && s.homeGoals > s.awayGoals) ||
          (outcome === 'DRAW' && s.homeGoals === s.awayGoals) ||
          (outcome === 'AWAY' && s.homeGoals < s.awayGoals),
      );

    case 'double_chance':
      return won(
        (outcome === '1X' && s.homeGoals >= s.awayGoals) ||
          (outcome === '12' && s.homeGoals !== s.awayGoals) ||
          (outcome === 'X2' && s.homeGoals <= s.awayGoals),
      );

    case 'draw_no_bet':
      if (s.homeGoals === s.awayGoals) return push();
      return won(
        (outcome === 'HOME' && s.homeGoals > s.awayGoals) ||
          (outcome === 'AWAY' && s.homeGoals < s.awayGoals),
      );

    case 'btts':
      return won((outcome === 'yes') === (s.homeGoals >= 1 && s.awayGoals >= 1));

    case 'over_under_05':
    case 'over_under_15':
    case 'over_under_25':
    case 'over_under_35': {
      const l = line ?? Number(market.slice(-2)) / 10;
      return won((outcome === 'over') === (total > l));
    }

    case 'european_handicap': {
      if (line === null) return null;
      const adj = s.homeGoals + line;
      return won(
        (outcome === 'HOME' && adj > s.awayGoals) ||
          (outcome === 'DRAW' && adj === s.awayGoals) ||
          (outcome === 'AWAY' && adj < s.awayGoals),
      );
    }

    case 'asian_handicap': {
      if (line === null) return null;
      const legs = isQuarterLine(line) ? [line - 0.25, line + 0.25] : [line];
      let pnl = 0;
      let wins = 0;
      let losses = 0;
      let pushes = 0;
      for (const leg of legs) {
        const share = 1 / legs.length;
        const margin = outcome === 'HOME' ? s.homeGoals + leg - s.awayGoals : s.awayGoals - leg - s.homeGoals;
        if (margin > 0) {
          pnl += share * (odds - 1);
          wins++;
        } else if (margin < 0) {
          pnl -= share;
          losses++;
        } else {
          pushes++;
        }
      }
      const result: Result =
        wins === legs.length ? 'WON'
        : losses === legs.length ? 'LOST'
        : pushes === legs.length ? 'PUSH'
        : wins > 0 && pushes > 0 ? 'HALF_WON'
        : losses > 0 && pushes > 0 ? 'HALF_LOST'
        : 'PUSH';
      return { result, pnl };
    }

    case 'total_corners': {
      if (line === null || s.homeCorners === null || s.awayCorners === null) return null;
      const c = s.homeCorners + s.awayCorners;
      if (Number.isInteger(line) && c === line) return push();
      return won((outcome === 'over') === (c > line));
    }

    case 'corners_1x2': {
      if (s.homeCorners === null || s.awayCorners === null) return null;
      return won(
        (outcome === 'HOME' && s.homeCorners > s.awayCorners) ||
          (outcome === 'DRAW' && s.homeCorners === s.awayCorners) ||
          (outcome === 'AWAY' && s.homeCorners < s.awayCorners),
      );
    }

    case 'total_red_cards': {
      if (line === null || s.reds === null) return null;
      if (Number.isInteger(line) && s.reds === line) return push();
      return won((outcome === 'over') === (s.reds > line));
    }

    case 'red_card': {
      if (s.reds === null) return null;
      return won((outcome === 'yes') === (s.reds > 0));
    }

    default:
      return null;
  }
}

export interface SettleReport {
  considered: number;
  settled: number;
  unresolved: number;
  pnl: number;
  /** Older picks given a post-mortem after the fact. */
  backfilled: number;
  /** Settled picks whose mark no longer matched the final score. */
  regraded: number;
  slips?: number;
}

/**
 * Post-mortems for picks that were settled before there was such a thing.
 *
 * They get the part the score alone answers -- how many goals would have had
 * to change -- and nothing else. The shape we published and the price at
 * kick-off were not being recorded when these were graded, so those stay null
 * and the page prints one fact instead of three rather than guessing at the
 * other two.
 *
 * Bounded per run because it walks the whole back record, and it is idempotent
 * because it only ever touches rows with no post-mortem on them.
 */
/**
 * Final scores for fixtures nothing else was going to fill in.
 *
 * `fixture.home_goals` was written from two places and both of them have a
 * blind spot. The slate only touches what is inside its window, and settlement
 * only looks at fixtures carrying an unsettled pick -- so a match we passed on
 * went to full time and kept an empty scoreline forever. On the board's Played
 * tab that is a row saying a game has finished and refusing to say how.
 *
 * The scores are already in `match`, put there by the nightly history job, so
 * this is a join rather than a fetch: no provider requests, and it only ever
 * touches rows that have none.
 */
export async function backfillScores(): Promise<void> {
  await exec(
    `UPDATE fixture SET
       home_goals = (SELECT m.home_goals FROM match m WHERE m.id = fixture.id),
       away_goals = (SELECT m.away_goals FROM match m WHERE m.id = fixture.id)
     WHERE fixture.home_goals IS NULL
       AND EXISTS (
         SELECT 1 FROM match m
         WHERE m.id = fixture.id AND m.home_goals IS NOT NULL AND m.away_goals IS NOT NULL
       )`,
    [],
  );
}

/**
 * Re-grade settled picks whose mark no longer matches the score.
 *
 * A pick is graded once, against whatever score was available three hours
 * after kick-off, and until now nothing ever looked at it again. The
 * authoritative final score arrives later -- the nightly history job writes it
 * to `match`, and it is the one the fixture column and the whole results page
 * are drawn from. When the two disagree, the page shows a green LANDED over a
 * scoreline that says the opposite.
 *
 * It was six picks in two hundred when this was written, five of them in our
 * favour, and that is the worst possible direction for the error to run on the
 * one page whose entire job is being believed. Two of them were the same 1-1:
 * "either team to win" marked landed and "home or draw" marked missed, a few
 * cards apart, both exactly backwards.
 *
 * So the grade follows the score rather than the other way round. This runs
 * every settlement, it is idempotent, and it moves the headline against us as
 * often as not -- which is the point.
 */
export async function regradeSettled(limit = 500): Promise<number> {
  const rows = await select<{
    id: number;
    market: MarketCode;
    outcome: Outcome;
    line: number | null;
    odds: number;
    result: Result;
    home_goals: number;
    away_goals: number;
    opening_odds: number | null;
    closing_odds: number | null;
    evidence_json: string | null;
  }>(
    `SELECT p.id, p.market, p.outcome, p.line, p.odds, p.result,
            p.opening_odds, p.closing_odds, p.evidence_json,
            f.home_goals, f.away_goals
     FROM pick p JOIN fixture f ON f.id = p.fixture_id
     WHERE p.settled_at IS NOT NULL
       AND p.result IS NOT NULL
       AND f.home_goals IS NOT NULL AND f.away_goals IS NOT NULL
     ORDER BY p.kickoff DESC LIMIT ?`,
    [limit],
  );

  let fixed = 0;
  for (const r of rows) {
    const graded = settleSelection(r.market, r.outcome, r.line, r.odds, {
      homeGoals: r.home_goals,
      awayGoals: r.away_goals,
      homeCorners: null,
      awayCorners: null,
      reds: null,
    });
    // No grade from goals alone: corners and cards keep the mark they have.
    if (!graded || graded.result === r.result) continue;

    let expected: { home?: number; away?: number } = {};
    try {
      expected = (JSON.parse(r.evidence_json ?? '{}') as { expected?: typeof expected }).expected ?? {};
    } catch { /* an older shape, or none */ }

    const pm = postMortem({
      market: r.market,
      outcome: r.outcome,
      line: r.line,
      result: graded.result,
      homeGoals: r.home_goals,
      awayGoals: r.away_goals,
      expectedHome: expected.home ?? null,
      expectedAway: expected.away ?? null,
      openingOdds: r.opening_odds,
      closingOdds: r.closing_odds,
    });

    await exec('UPDATE pick SET result = ?, pnl = ?, postmortem_json = ? WHERE id = ?', [
      graded.result,
      graded.pnl,
      JSON.stringify(pm),
      r.id,
    ]);
    console.log(
      `  re-graded pick ${r.id}: ${r.market} ${r.outcome} at ${r.home_goals}-${r.away_goals} ` +
        `was ${r.result}, is ${graded.result}`,
    );
    fixed++;
  }
  if (fixed) console.log(`Re-graded ${fixed} picks against the final score.`);
  return fixed;
}

export async function backfillPostMortems(limit = 400): Promise<number> {
  const rows = await select<{
    id: number;
    market: MarketCode;
    outcome: Outcome;
    line: number | null;
    result: Result;
    home_goals: number | null;
    away_goals: number | null;
    opening_odds: number | null;
    closing_odds: number | null;
    evidence_json: string | null;
  }>(
    `SELECT p.id, p.market, p.outcome, p.line, p.result, p.opening_odds, p.closing_odds,
            p.evidence_json, f.home_goals, f.away_goals
     FROM pick p JOIN fixture f ON f.id = p.fixture_id
     WHERE p.settled_at IS NOT NULL
       AND p.postmortem_json IS NULL
       AND p.result IS NOT NULL
       AND f.home_goals IS NOT NULL AND f.away_goals IS NOT NULL
     ORDER BY p.kickoff DESC LIMIT ?`,
    [limit],
  );

  let done = 0;
  for (const r of rows) {
    let expected: { home?: number; away?: number } = {};
    try {
      expected = (JSON.parse(r.evidence_json ?? '{}') as { expected?: typeof expected }).expected ?? {};
    } catch { /* an older shape, or none at all */ }

    const pm = postMortem({
      market: r.market,
      outcome: r.outcome,
      line: r.line,
      result: r.result,
      homeGoals: r.home_goals!,
      awayGoals: r.away_goals!,
      expectedHome: expected.home ?? null,
      expectedAway: expected.away ?? null,
      openingOdds: r.opening_odds,
      closingOdds: r.closing_odds,
    });
    await exec('UPDATE pick SET postmortem_json = ? WHERE id = ?', [JSON.stringify(pm), r.id]);
    done++;
  }
  if (done) console.log(`Wrote ${done} post-mortems for picks settled before there were any.`);
  return done;
}

export async function runSettle(): Promise<SettleReport> {
  const now = Math.floor(Date.now() / 1000);
  // Give a match time to finish and the provider time to publish final stats.
  const cutoff = now - 3 * 3600;

  const pending = await select<{
    id: number;
    fixture_id: number;
    market: MarketCode;
    outcome: Outcome;
    line: number | null;
    odds: number;
    opening_odds: number | null;
    closing_odds: number | null;
    evidence_json: string | null;
  }>(
    `SELECT id, fixture_id, market, outcome, line, odds, opening_odds, closing_odds, evidence_json
     FROM pick WHERE settled_at IS NULL AND kickoff < ? ORDER BY kickoff ASC LIMIT 500`,
    [cutoff],
  );

  const report: SettleReport = { considered: pending.length, settled: 0, unresolved: 0, pnl: 0, backfilled: 0, regraded: 0 };
  if (pending.length === 0) {
    console.log('Nothing to settle.');
    await backfillScores();
    report.regraded = await regradeSettled();
    report.slips = await settleSlips();
    report.backfilled = await backfillPostMortems();
    await kvSetJSON('settle:last_run', { at: now, ...report });
    return report;
  }

  // One lookup per fixture, not per pick.
  const fixtureIds = [...new Set(pending.map((p) => p.fixture_id))];
  const scores = new Map<number, FinalScore>();

  for (const id of fixtureIds) {
    const local = await select<{
      home_goals: number | null;
      away_goals: number | null;
      home_corners: number | null;
      away_corners: number | null;
      home_reds: number | null;
      away_reds: number | null;
    }>(
      `SELECT home_goals, away_goals, home_corners, away_corners, home_reds, away_reds
       FROM match WHERE id = ?`,
      [id],
    );

    let row = local[0];
    // Not in our history yet — the backfill runs nightly and settlement hourly,
    // so ask the provider directly rather than waiting a day to grade a pick.
    if (!row || row.home_goals === null) {
      const ev = await bsdOrNull<Record<string, unknown>>(`/api/v2/events/${id}/`);
      const hg = num(ev?.['home_score']);
      const ag = num(ev?.['away_score']);
      const status = String(ev?.['status'] ?? '').toLowerCase();
      if (hg === undefined || ag === undefined || !/finish|ft|ended|after/.test(status)) {
        report.unresolved++;
        continue;
      }
      row = {
        home_goals: hg,
        away_goals: ag,
        home_corners: null,
        away_corners: null,
        home_reds: null,
        away_reds: null,
      };
    }

    // The scoreline the grade was made against, written back onto the fixture
    // so the results page can print it beside the mark. Settlement is the
    // authoritative source: the slate writes a running score every quarter of
    // an hour and stops caring once a match falls out of its window, and a
    // half-time score left behind as final would make every page that reads it
    // quietly wrong.
    await exec('UPDATE fixture SET home_goals = ?, away_goals = ? WHERE id = ?', [
      row.home_goals,
      row.away_goals,
      id,
    ]);

    scores.set(id, {
      homeGoals: row.home_goals!,
      awayGoals: row.away_goals!,
      homeCorners: row.home_corners,
      awayCorners: row.away_corners,
      reds:
        row.home_reds === null && row.away_reds === null
          ? null
          : (row.home_reds ?? 0) + (row.away_reds ?? 0),
    });
  }

  const updates: Array<{
    id: number;
    result: Result;
    pnl: number;
    clv: number | null;
    postmortem: string | null;
  }> = [];

  /*
   * The shape we published for the fixture, dug back out of the evidence the
   * pick was stored with. Absent on everything settled before the post-mortem
   * existed, which is why every field it feeds is nullable rather than the
   * page demanding it.
   */
  const expectedOf = (raw: string | null): { home?: number; away?: number } => {
    if (!raw) return {};
    try {
      const parsed = JSON.parse(raw) as { expected?: { home?: number; away?: number } };
      return parsed.expected ?? {};
    } catch {
      return {};
    }
  };
  for (const p of pending) {
    const s = scores.get(p.fixture_id);
    if (!s) {
      report.unresolved++;
      continue;
    }
    const graded = settleSelection(p.market, p.outcome, p.line, p.odds, s);
    if (!graded) {
      // The match finished but the data needed to grade this market never
      // arrived. Void it rather than guess — a wrong grade corrupts calibration
      // permanently, and calibration is what the model steers by.
      updates.push({ id: p.id, result: 'VOID', pnl: 0, clv: null, postmortem: null });
      continue;
    }

    // What the result says about the call. See engine/src/postmortem.ts for
    // what it is allowed to claim and, more to the point, what it is not.
    const expected = expectedOf(p.evidence_json);
    const pm = postMortem({
      market: p.market,
      outcome: p.outcome,
      line: p.line,
      result: graded.result,
      homeGoals: s.homeGoals,
      awayGoals: s.awayGoals,
      expectedHome: expected.home ?? null,
      expectedAway: expected.away ?? null,
      openingOdds: p.opening_odds,
      closingOdds: p.closing_odds,
    });

    // Where the price finished against where we called it. Recorded as a
    // number because calibration averages it; said in words on the page.
    const clv =
      p.opening_odds && p.closing_odds && p.opening_odds > 1 && p.closing_odds > 1
        ? Number((p.opening_odds / p.closing_odds - 1).toFixed(4))
        : null;

    updates.push({
      id: p.id,
      result: graded.result,
      pnl: graded.pnl,
      clv,
      postmortem: JSON.stringify(pm),
    });
    report.pnl += graded.pnl;
    report.settled++;
  }

  for (const u of updates) {
    await exec(
      'UPDATE pick SET settled_at = ?, result = ?, pnl = ?, clv = ?, postmortem_json = ? WHERE id = ?',
      [now, u.result, u.pnl, u.clv, u.postmortem, u.id],
    );
  }

  await backfillScores();
  report.regraded = await regradeSettled();
  report.slips = await settleSlips();
  report.backfilled = await backfillPostMortems();
  await refreshCalibration();
  await kvSetJSON('settle:last_run', { at: now, ...report });

  console.log(
    `Settled ${report.settled} picks (${report.pnl >= 0 ? '+' : ''}${report.pnl.toFixed(2)} units), ` +
      `${report.unresolved} still unresolved.`,
  );
  return report;
}

/**
 * Recompute per-family calibration from settled history.
 *
 * `shrink` is the multiplier selection applies to a raw edge. A family whose
 * predictions have been well calibrated keeps most of its edge; one that has
 * been overconfident has it cut. This is the loop that makes the model more
 * careful where it has actually been wrong, rather than where someone guessed
 * it might be.
 */
export async function refreshCalibration(): Promise<void> {
  const rows = await select<{
    market: MarketCode;
    model_prob: number;
    result: string;
    pnl: number;
    odds: number;
  }>(
    `SELECT market, model_prob, result, pnl, odds FROM pick
     WHERE settled_at IS NOT NULL AND result IS NOT NULL AND result != 'VOID'`,
  );

  const byFamily = new Map<MarketFamily, typeof rows>();
  for (const r of rows) {
    const fam = MARKET_FAMILY[r.market];
    if (!fam) continue;
    byFamily.set(fam, [...(byFamily.get(fam) ?? []), r]);
  }

  const now = Math.floor(Date.now() / 1000);
  const out: Array<Record<string, unknown>> = [];

  for (const [family, list] of byFamily) {
    const n = list.length;
    let brier = 0;
    let logLoss = 0;
    let meanP = 0;
    let meanActual = 0;
    let pnl = 0;

    for (const r of list) {
      // Half-wins and half-losses are partial outcomes; score them as such
      // rather than rounding to a win or a loss.
      const actual =
        r.result === 'WON' ? 1 : r.result === 'HALF_WON' ? 0.75 : r.result === 'HALF_LOST' ? 0.25 : 0;
      const p = Math.min(1 - 1e-9, Math.max(1e-9, r.model_prob));
      brier += (p - actual) ** 2;
      logLoss += -(actual * Math.log(p) + (1 - actual) * Math.log(1 - p));
      meanP += p;
      meanActual += actual;
      pnl += r.pnl ?? 0;
    }

    brier /= n;
    logLoss /= n;
    meanP /= n;
    meanActual /= n;

    // Overconfidence is the gap between what we said and what happened. Cut the
    // edge in proportion to it, floored so a bad run never silences a family
    // entirely and capped so a good one never earns more than its raw edge.
    const overconfidence = Math.max(0, meanP - meanActual);
    const shrink = Math.max(0.2, Math.min(1, 1 - overconfidence * 3));

    out.push({
      market_family: family,
      n,
      brier,
      log_loss: logLoss,
      mean_model_p: meanP,
      mean_actual: meanActual,
      roi: pnl / n,
      clv_mean: null,
      shrink,
      updated_at: now,
    });
  }

  if (out.length > 0) {
    await insertMany(
      'calibration',
      [
        'market_family', 'n', 'brier', 'log_loss', 'mean_model_p',
        'mean_actual', 'roi', 'clv_mean', 'shrink', 'updated_at',
      ],
      out,
      { conflictTarget: 'market_family' },
    );
    for (const r of out) {
      console.log(
        `  ${String(r.market_family).padEnd(9)} n=${String(r.n).padStart(4)} ` +
          `said ${(Number(r.mean_model_p) * 100).toFixed(1)}% got ${(Number(r.mean_actual) * 100).toFixed(1)}% ` +
          `roi ${(Number(r.roi) * 100).toFixed(1)}% shrink ${Number(r.shrink).toFixed(2)}`,
      );
    }
  }
}
