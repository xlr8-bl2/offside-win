import { writeFileSync } from 'node:fs';
import { config } from './config.ts';
import { loadMatches, trackedLeagues } from './history.ts';
import { buildScoreMatrix, priceBtts, priceOverUnder, priceResult } from './price.ts';
import { defaultFitOptions, expectedGoals, fitDixonColes } from './ratings/dixoncoles.ts';
import { insertMany } from './store.ts';
import type { MatchRow, RatingSet } from './types.ts';

/**
 * Walk-forward evaluation.
 *
 * An analyzer that claims to be worth following has to show it, and the only
 * way to show it honestly is to never let the model see the match it is
 * predicting. So: fit on everything up to date t, predict the matches after it,
 * refit periodically, and never peek.
 *
 * What this measures is probabilistic accuracy against two baselines — a naive
 * independent-Poisson model with no shrinkage and no low-score correction, and
 * the league's own base rates. If the full model cannot beat both, the extra
 * machinery is decoration and should not ship.
 *
 * What it deliberately does *not* claim to measure is return on investment.
 * That needs historical closing prices, which we do not hold — the provider
 * gives current odds with an opening price, not a price history we can replay.
 * Reporting a backtested ROI from reconstructed odds would be the most
 * flattering and least trustworthy number on the page, so it is absent here and
 * comes instead from real settled picks in the calibration table.
 */

export interface MarketScore {
  n: number;
  logLoss: number;
  brier: number;
  /** Ten calibration bins: what we said, against what happened. */
  bins: Array<{ lo: number; hi: number; n: number; predicted: number; actual: number }>;
}

export interface BacktestReport {
  label: string;
  generated_at: number;
  leagues: number;
  matches: number;
  refits: number;
  models: Record<string, Record<string, MarketScore>>;
  /** Model minus baseline on log loss; positive means the model is better. */
  improvement: Record<string, number>;
  verdict: string;
}

function emptyScore(): MarketScore {
  return {
    n: 0,
    logLoss: 0,
    brier: 0,
    bins: Array.from({ length: 10 }, (_, i) => ({
      lo: i / 10,
      hi: (i + 1) / 10,
      n: 0,
      predicted: 0,
      actual: 0,
    })),
  };
}

/** Accumulate one prediction against its outcome. */
function score(acc: MarketScore, predicted: number, happened: boolean): void {
  const p = Math.min(1 - 1e-9, Math.max(1e-9, predicted));
  acc.n++;
  acc.logLoss += happened ? -Math.log(p) : -Math.log(1 - p);
  acc.brier += (p - (happened ? 1 : 0)) ** 2;
  const bin = acc.bins[Math.min(9, Math.floor(p * 10))]!;
  bin.n++;
  bin.predicted += p;
  bin.actual += happened ? 1 : 0;
}

function finalise(acc: MarketScore): MarketScore {
  if (acc.n === 0) return acc;
  return {
    n: acc.n,
    logLoss: acc.logLoss / acc.n,
    brier: acc.brier / acc.n,
    bins: acc.bins.map((b) => ({
      ...b,
      predicted: b.n ? b.predicted / b.n : 0,
      actual: b.n ? b.actual / b.n : 0,
    })),
  };
}

/** Every market a completed scoreline can settle, scored in one pass. */
function scoreMatch(
  scores: Record<string, MarketScore>,
  lh: number,
  la: number,
  rho: number,
  m: MatchRow,
): void {
  const matrix = buildScoreMatrix(lh, la, rho);
  const hg = m.home_goals!;
  const ag = m.away_goals!;

  const result = priceResult(matrix);
  score(scores['1x2_home']!, result.get('HOME')!, hg > ag);
  score(scores['1x2_draw']!, result.get('DRAW')!, hg === ag);
  score(scores['1x2_away']!, result.get('AWAY')!, hg < ag);

  score(scores['btts']!, priceBtts(matrix).get('yes')!, hg >= 1 && ag >= 1);

  for (const line of [1.5, 2.5, 3.5]) {
    score(scores[`over_${line}`]!, priceOverUnder(matrix, line).get('over')!, hg + ag > line);
  }
}

function newScoreSet(): Record<string, MarketScore> {
  const keys = ['1x2_home', '1x2_draw', '1x2_away', 'btts', 'over_1.5', 'over_2.5', 'over_3.5'];
  return Object.fromEntries(keys.map((k) => [k, emptyScore()]));
}

export interface BacktestOptions {
  /** Matches to fit on before making the first prediction. */
  burnIn?: number;
  /** Refit this often, in days. Refitting per match is accurate and far too slow. */
  refitDays?: number;
  label?: string;
}

export async function runBacktest(opts: BacktestOptions = {}): Promise<BacktestReport> {
  const burnIn = opts.burnIn ?? 200;
  const refitDays = opts.refitDays ?? 14;
  const leagues = await trackedLeagues();

  const models: Record<string, Record<string, MarketScore>> = {
    full: newScoreSet(),
    naive_poisson: newScoreSet(),
    base_rate: newScoreSet(),
  };

  let totalMatches = 0;
  let refits = 0;
  let leaguesUsed = 0;

  for (const league of leagues) {
    const all = (await loadMatches(league.id)).filter(
      (m) => m.home_goals !== null && m.away_goals !== null,
    );
    if (all.length < burnIn + 50) {
      console.log(`  ${league.name}: ${all.length} matches — too few for a walk-forward, skipping`);
      continue;
    }
    leaguesUsed++;

    let fitFull: RatingSet | null = null;
    let fitNaive: RatingSet | null = null;
    let lastFit = 0;
    let baseHome = 1.4;
    let baseAway = 1.1;

    for (let i = burnIn; i < all.length; i++) {
      const m = all[i]!;

      // Refit on a cadence, using only matches strictly before this one.
      if (fitFull === null || m.kickoff - lastFit > refitDays * 86400) {
        const train = all.slice(0, i);
        const optsFull = defaultFitOptions(m.kickoff);
        fitFull = fitDixonColes(train, league.id, optsFull);

        // Baseline: no decay, no shrinkage, no low-score correction. This is
        // the "textbook Poisson" the full model has to justify itself against.
        const optsNaive = defaultFitOptions(m.kickoff);
        optsNaive.xi = 0;
        optsNaive.priorMatches = 0;
        optsNaive.fitRho = false;
        optsNaive.rho = 0;
        fitNaive = fitDixonColes(train, league.id, optsNaive);

        // Base rate: the league's average scoreline, ignoring who is playing.
        const played = train.slice(-400);
        baseHome = played.reduce((s, x) => s + (x.home_goals ?? 0), 0) / Math.max(1, played.length);
        baseAway = played.reduce((s, x) => s + (x.away_goals ?? 0), 0) / Math.max(1, played.length);

        lastFit = m.kickoff;
        refits++;
      }

      const full = expectedGoals(fitFull!, m.home_team_id, m.away_team_id);
      scoreMatch(models.full!, full.home, full.away, fitFull!.params.rho, m);

      const naive = expectedGoals(fitNaive!, m.home_team_id, m.away_team_id);
      scoreMatch(models.naive_poisson!, naive.home, naive.away, 0, m);

      scoreMatch(models.base_rate!, baseHome, baseAway, 0, m);

      totalMatches++;
    }

    console.log(`  ${league.name}: ${all.length - burnIn} matches evaluated`);
  }

  for (const key of Object.keys(models)) {
    for (const market of Object.keys(models[key]!)) {
      models[key]![market] = finalise(models[key]![market]!);
    }
  }

  const meanLogLoss = (set: Record<string, MarketScore>): number => {
    const vals = Object.values(set).filter((s) => s.n > 0);
    return vals.length ? vals.reduce((a, b) => a + b.logLoss, 0) / vals.length : Number.NaN;
  };

  const fullLL = meanLogLoss(models.full!);
  const naiveLL = meanLogLoss(models.naive_poisson!);
  const baseLL = meanLogLoss(models.base_rate!);

  const improvement = {
    vs_naive_poisson: naiveLL - fullLL,
    vs_base_rate: baseLL - fullLL,
  };

  // Lower log loss is better, so a positive improvement means the model wins.
  const beatsNaive = improvement.vs_naive_poisson > 0;
  const beatsBase = improvement.vs_base_rate > 0;

  // A run that scored nothing has no opinion. Every comparison above is NaN,
  // and `NaN > 0` is false, so without this the empty case falls straight into
  // the failure branch and publishes "the model does NOT beat the naive
  // Poisson" on the strength of zero matches. That is not the honest reading of
  // no data, it is a different claim entirely — and it is the one the model
  // page would have shown.
  const evaluated =
    totalMatches > 0 && Number.isFinite(fullLL) && Number.isFinite(naiveLL) && Number.isFinite(baseLL);

  const verdict = !evaluated
    ? `No verdict: the backtest scored ${totalMatches} matches across ${leaguesUsed} leagues, ` +
      `so there is no evidence either way. This is a broken run rather than a result — it does ` +
      `not mean the model failed, and must not be read as though it did.`
    : beatsNaive && beatsBase
      ? `Model beats both baselines on log loss (${fullLL.toFixed(4)} vs naive ${naiveLL.toFixed(4)}, base rate ${baseLL.toFixed(4)}).`
      : `Model does NOT beat ${!beatsNaive ? 'the naive Poisson' : 'the league base rate'} ` +
        `(${fullLL.toFixed(4)} vs naive ${naiveLL.toFixed(4)}, base rate ${baseLL.toFixed(4)}). ` +
        `On this evidence the extra machinery is not earning its place and should not be trusted.`;

  const report: BacktestReport = {
    label: opts.label ?? process.env.BACKTEST_LABEL ?? 'manual',
    generated_at: Math.floor(Date.now() / 1000),
    leagues: leaguesUsed,
    matches: totalMatches,
    refits,
    models,
    improvement,
    verdict,
  };

  console.log(`\n${verdict}`);
  console.log(`Evaluated ${totalMatches} matches across ${leaguesUsed} leagues with ${refits} refits.`);
  for (const [market, s] of Object.entries(models.full!)) {
    if (s.n === 0) continue;
    console.log(`  ${market.padEnd(12)} n=${String(s.n).padStart(6)} logloss=${s.logLoss.toFixed(4)} brier=${s.brier.toFixed(4)}`);
  }

  // Written relative to the engine workspace, because `npm -w engine run
  // backtest` sets the working directory there — the old 'engine/…' path
  // resolved to engine/engine/… , threw, and was swallowed by this catch, so
  // the workflow's upload step never found a report and only warned.
  try {
    writeFileSync('backtest-report.json', JSON.stringify(report, null, 2));
  } catch (err) {
    console.log(`  could not write backtest-report.json (${err instanceof Error ? err.message : err}) — the D1 copy is the durable one`);
  }

  await insertMany(
    'backtest',
    ['label', 'report_json', 'created_at'],
    [{ label: report.label, report_json: JSON.stringify(report), created_at: report.generated_at }],
  );

  // Record the run, then fail: a backtest that scored nothing has not done its
  // job, and going green would leave "no verdict" sitting on the model page
  // with nothing drawing attention to it.
  if (!evaluated) {
    throw new Error(
      `Backtest scored no matches (${leaguesUsed} leagues, ${refits} refits). ` +
        `Usually this means no league is marked tracked, or none has enough finished matches ` +
        `for a walk-forward. The report is stored with an explicit "no verdict".`,
    );
  }

  return report;
}

export const _internals = { score, finalise, emptyScore, scoreMatch };
