import { bsdList, num, stats as bsdStats, toEpoch } from './bsd.ts';
import { config } from './config.ts';
import { analyseFixture } from './context/index.ts';
import { checkComparisonEntitlement, gatherFixture } from './context/gather.ts';
import { RepetitionLedger, narrate, narratePass } from './narrate/compose.ts';
import { buildCandidates, driversFor, select, setAsideFor, type CalibrationMap } from './select.ts';
import { dbStats, insertMany, kvGetJSON, kvSetJSON, pickConflictTarget, select as dbSelect } from './store.ts';
import type { CalibrationRow } from './select.ts';
import type { Candidate, Factor, MarketFamily } from './types.ts';

/**
 * The slate: price the next few days, publish the board.
 *
 * Everything here runs on GitHub Actions and writes finished JSON to D1. The
 * Worker reads those rows and serves them, which is why it stays inside the free
 * tier's 10 ms of CPU — there is nothing left for it to compute.
 */

async function loadCalibration(): Promise<CalibrationMap> {
  const rows = await dbSelect<{ market_family: MarketFamily; n: number; shrink: number }>(
    'SELECT market_family, n, shrink FROM calibration',
  );
  return new Map(rows.map((r) => [r.market_family, r as CalibrationRow]));
}

/** Trim a factor for storage: the ledger is for reading, not for re-running. */
function forStorage(f: Factor) {
  return {
    id: f.id,
    section: f.section,
    tier: f.tier,
    state: f.state,
    note: f.note,
    evidence: f.evidence,
    strength: Number(f.strength.toFixed(3)),
    moves: f.adjustments
      .filter((a) => Math.abs(a.multiplier - 1) > 1e-4)
      .map((a) => ({ channel: a.channel, side: a.side, pct: Number(((a.multiplier - 1) * 100).toFixed(1)) })),
  };
}

function candidateForStorage(c: Candidate) {
  return {
    market: c.market,
    outcome: c.outcome,
    line: c.line,
    push: c.push,
    model_prob: Number(c.model_prob.toFixed(4)),
    book_prob: Number(c.book_prob.toFixed(4)),
    edge: Number(c.edge.toFixed(4)),
    shrunk_edge: Number(c.shrunk_edge.toFixed(4)),
    odds: c.odds,
    bookmaker: c.bookmaker,
    kelly: Number(c.kelly.toFixed(4)),
    confidence: Number(c.confidence.toFixed(3)),
    family: c.family,
  };
}

export interface SlateReport {
  fixtures: number;
  analysed: number;
  picks: number;
  passes: number;
  skipped: number;
  requests: number;
  d1Queries: number;
}

export async function runSlate(): Promise<SlateReport> {
  const now = Math.floor(Date.now() / 1000);
  const from = new Date((now - config.slate.lookbackHours * 3600) * 1000).toISOString();
  const to = new Date((now + config.slate.horizonHours * 3600) * 1000).toISOString();

  const events = await bsdList<Record<string, unknown>>(
    '/api/v2/events/',
    { date_from: from, date_to: to },
    { limit: 200, max: 2000 },
  );

  // Only fixtures in leagues we have actually fitted; an unfitted league means
  // no opinion of our own, and an opinion is the entire product.
  const fitted = new Set(
    (await dbSelect<{ league_id: number }>('SELECT league_id FROM rating_meta')).map((r) => r.league_id),
  );

  const candidates = events.filter((e) => {
    const lid = num(e['league_id']);
    return lid !== undefined && fitted.has(lid);
  });

  console.log(
    `${events.length} fixtures in window, ${candidates.length} in leagues with fitted ratings`,
  );

  if (candidates.length === 0) {
    return { fixtures: events.length, analysed: 0, picks: 0, passes: 0, skipped: events.length, requests: bsdStats.requests, d1Queries: dbStats.queries };
  }

  // Probe the paid-tier entitlement once per run rather than per fixture.
  const sampleId = num(candidates[0]!['id']);
  const entitled = sampleId !== undefined ? await checkComparisonEntitlement(sampleId) : false;

  const calibration = await loadCalibration();

  // The anti-repetition ledger spans the whole slate and persists between runs,
  // so two fixtures on the same day cannot open with the same construction and
  // neither can today's board and yesterday's.
  const ledgerSeed = (await kvGetJSON<string[]>('narrate:ledger')) ?? [];
  const ledger = new RepetitionLedger(config.narrate.ledgerSize, ledgerSeed);

  const report: SlateReport = {
    fixtures: events.length,
    analysed: 0,
    picks: 0,
    passes: 0,
    skipped: events.length - candidates.length,
    requests: 0,
    d1Queries: 0,
  };

  const fixtureRows: Array<Record<string, unknown>> = [];
  const pickRows: Array<Record<string, unknown>> = [];

  for (const event of candidates) {
    try {
      const ctx = await gatherFixture(event);
      if (!ctx) {
        report.skipped++;
        continue;
      }
      ctx.comparisonEntitled = entitled;

      const { analysis, factors, confidence } = analyseFixture(ctx);
      const cands = buildCandidates(analysis.model, analysis.book, calibration);
      const selection = select(cands, analysis.book, factors, confidence);

      const verdicts = selection.picks.map(({ kind, candidate }) => {
        const drivers = driversFor(candidate, factors);
        return {
          kind,
          candidate,
          narrative: narrate({
            candidate,
            drivers,
            homeTeam: analysis.home_team,
            awayTeam: analysis.away_team,
            fixtureId: analysis.fixture_id,
            ledger,
          }),
          drivers,
          set_aside: setAsideFor(candidate, factors, drivers),
        };
      });

      const passNarrative = selection.passReason
        ? narratePass(selection.passReason, analysis.home_team, analysis.away_team, analysis.fixture_id)
        : null;

      // The board card: small, because the board loads all of them at once.
      const board = {
        id: analysis.fixture_id,
        league_id: analysis.league_id,
        league: ctx.league_name,
        kickoff: analysis.kickoff,
        home: analysis.home_team,
        away: analysis.away_team,
        status: analysis.status,
        provisional: analysis.provisional,
        lineup_status: analysis.lineup_status,
        confidence: Number(confidence.toFixed(3)),
        lambda: [Number(analysis.lambda_home.toFixed(2)), Number(analysis.lambda_away.toFixed(2))],
        odds_1x2: Object.fromEntries(
          (analysis.book.find((b) => b.market === '1x2')?.fair ?? new Map()).entries(),
        ),
        top_pick: verdicts[0]
          ? {
              kind: verdicts[0].kind,
              market: verdicts[0].candidate.market,
              outcome: verdicts[0].candidate.outcome,
              line: verdicts[0].candidate.line,
              odds: verdicts[0].candidate.odds,
              edge: Number(verdicts[0].candidate.edge.toFixed(4)),
            }
          : null,
        pass: passNarrative,
        // Signals worth an icon on the card without opening the fixture.
        flags: factors
          .filter((f) => f.state === 'COMPUTED' && f.strength >= 0.5)
          .slice(0, 4)
          .map((f) => ({ id: f.id, section: f.section, note: f.note })),
      };

      // The full bundle: everything the fixture page shows, including the
      // factors we could not compute. A fixture we know little about should
      // look like one.
      const bundle = {
        ...board,
        lambda_home: analysis.lambda_home,
        lambda_away: analysis.lambda_away,
        corner_rate: Number(analysis.corner_rate.toFixed(2)),
        card_rate: Number(analysis.card_rate.toFixed(3)),
        ledger: factors.map(forStorage),
        markets: analysis.model.map((m) => ({
          market: m.market,
          line: m.line,
          confidence: Number(m.confidence.toFixed(3)),
          model: Object.fromEntries([...m.probs].map(([k, v]) => [k, Number(v.toFixed(4))])),
          book: Object.fromEntries(
            [...(analysis.book.find((b) => b.market === m.market && b.line === m.line)?.fair ?? new Map())]
              .map(([k, v]) => [k, Number((v as number).toFixed(4))]),
          ),
          best: Object.fromEntries(
            [...(analysis.book.find((b) => b.market === m.market && b.line === m.line)?.best ?? new Map())]
              .map(([k, v]) => [k, v]),
          ),
          overround: Number(
            (analysis.book.find((b) => b.market === m.market && b.line === m.line)?.overround ?? 1).toFixed(4),
          ),
        })),
        candidates: [...cands]
          .sort((a, b) => b.shrunk_edge - a.shrunk_edge)
          .slice(0, 25)
          .map(candidateForStorage),
        verdicts: verdicts.map((v) => ({
          kind: v.kind,
          candidate: candidateForStorage(v.candidate),
          narrative: v.narrative,
          drivers: v.drivers.map(forStorage),
          set_aside: v.set_aside.map(forStorage),
        })),
        pass_reason: selection.passReason,
        external: analysis.external,
        computed_at: analysis.computed_at,
      };

      fixtureRows.push({
        id: analysis.fixture_id,
        league_id: analysis.league_id,
        kickoff: analysis.kickoff,
        home_team: analysis.home_team,
        away_team: analysis.away_team,
        status: analysis.status,
        provisional: analysis.provisional ? 1 : 0,
        board_json: JSON.stringify(board),
        bundle_json: JSON.stringify(bundle),
        computed_at: analysis.computed_at,
      });

      for (const v of verdicts) {
        pickRows.push({
          fixture_id: analysis.fixture_id,
          kickoff: analysis.kickoff,
          market: v.candidate.market,
          outcome: v.candidate.outcome,
          line: v.candidate.line,
          kind: v.kind,
          model_prob: v.candidate.model_prob,
          book_prob: v.candidate.book_prob,
          edge: v.candidate.edge,
          shrunk_edge: v.candidate.shrunk_edge,
          odds: v.candidate.odds,
          bookmaker: v.candidate.bookmaker,
          kelly: v.candidate.kelly,
          confidence: v.candidate.confidence,
          provisional: analysis.provisional ? 1 : 0,
          narrative: v.narrative,
          evidence_json: JSON.stringify({
            drivers: v.drivers.map(forStorage),
            set_aside: v.set_aside.map(forStorage),
          }),
          created_at: analysis.computed_at,
        });
      }

      report.analysed++;
      if (verdicts.length > 0) report.picks += verdicts.length;
      if (selection.passReason) report.passes++;
    } catch (err) {
      console.error(`  fixture ${event['id']} failed: ${err instanceof Error ? err.message : String(err)}`);
      report.skipped++;
    }
  }

  if (fixtureRows.length > 0) {
    await insertMany(
      'fixture',
      [
        'id', 'league_id', 'kickoff', 'home_team', 'away_team', 'status',
        'provisional', 'board_json', 'bundle_json', 'computed_at',
      ],
      fixtureRows,
      { conflictTarget: 'id' },
    );
  }

  if (pickRows.length > 0) {
    // A pick is identified by fixture, market, outcome, line and kind. Rerunning
    // a slate must refresh the same row rather than publish a duplicate, but a
    // settled pick is history and is never overwritten.
    await insertMany(
      'pick',
      [
        'fixture_id', 'kickoff', 'market', 'outcome', 'line', 'kind', 'model_prob',
        'book_prob', 'edge', 'shrunk_edge', 'odds', 'bookmaker', 'kelly',
        'confidence', 'provisional', 'narrative', 'evidence_json', 'created_at',
      ],
      pickRows,
      {
        onConflict:
          // Must match pick_unique_line for the active backend exactly, or the
          // upsert matches no index and every rerun inserts a duplicate rather
          // than refreshing. See pickConflictTarget.
          `ON CONFLICT (${pickConflictTarget()}) DO UPDATE SET ` +
          'model_prob = excluded.model_prob, book_prob = excluded.book_prob, ' +
          'edge = excluded.edge, shrunk_edge = excluded.shrunk_edge, odds = excluded.odds, ' +
          'bookmaker = excluded.bookmaker, kelly = excluded.kelly, ' +
          'confidence = excluded.confidence, provisional = excluded.provisional, ' +
          'narrative = excluded.narrative, evidence_json = excluded.evidence_json ' +
          'WHERE pick.settled_at IS NULL',
      },
    );
  }

  await kvSetJSON('narrate:ledger', ledger.snapshot());
  await kvSetJSON('slate:last_run', { at: now, ...report });

  report.requests = bsdStats.requests;
  report.d1Queries = dbStats.queries;

  console.log(
    `Analysed ${report.analysed}, published ${report.picks} picks, ${report.passes} passes, ` +
      `skipped ${report.skipped}. ${report.requests} provider requests, ${report.d1Queries} D1 queries.`,
  );
  return report;
}

/** Drop fixtures that have fallen out of the board window. */
export async function pruneBoard(): Promise<void> {
  const cutoff = Math.floor(Date.now() / 1000) - 7 * 86400;
  await dbSelect('DELETE FROM fixture WHERE kickoff < ?', [cutoff]);
}
