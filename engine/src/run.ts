import { readFileSync } from 'node:fs';
import { runBacktest } from './backtest.ts';
import { stats as bsdStats } from './bsd.ts';
import { config, requireEnv } from './config.ts';
import { backfillHistory } from './history.ts';
import { probe } from './probe.ts';
import { fitAllLeagues } from './ratings/fit.ts';
import { runSettle } from './settle.ts';
import { pruneBoard, runSlate } from './slate.ts';
import { d1Stats, migrate } from './store.ts';

/**
 * Entry points for the scheduled workflows.
 *
 *   probe     — walk a real fixture and dump the provider's actual shapes
 *   migrate   — apply schema.sql (idempotent)
 *   history   — backfill finished matches and their stats
 *   ratings   — refit Dixon-Coles and the corner/card models
 *   slate     — reprice the next few days and publish the board
 *   settle    — grade finished picks and refresh calibration
 *   backtest  — walk-forward evaluation
 */

const commands: Record<string, () => Promise<unknown>> = {
  async probe() {
    if (!config.bsd.key) throw new Error('BSD_API_KEY is required to probe.');
    return probe();
  },

  async migrate() {
    requireEnv();
    const sql = readFileSync(new URL('../../schema.sql', import.meta.url), 'utf8');
    await migrate(sql);
    console.log('Schema applied.');
  },

  async history() {
    requireEnv();
    return backfillHistory({ full: process.env.FULL_BACKFILL === 'true' });
  },

  async ratings() {
    requireEnv();
    console.log('Fitting ratings...');
    return fitAllLeagues();
  },

  async slate() {
    requireEnv();
    const report = await runSlate();
    await pruneBoard();
    return report;
  },

  async settle() {
    requireEnv();
    return runSettle();
  },

  async backtest() {
    requireEnv();
    return runBacktest();
  },
};

async function main(): Promise<void> {
  const name = process.argv[2];
  if (!name || !(name in commands)) {
    console.error(`Usage: tsx src/run.ts <${Object.keys(commands).join('|')}>`);
    process.exit(1);
  }

  const started = Date.now();
  try {
    await commands[name]!();
    const secs = ((Date.now() - started) / 1000).toFixed(1);
    console.log(
      `\n${name} finished in ${secs}s — ${bsdStats.requests} provider requests ` +
        `(${bsdStats.retries} retries, ${bsdStats.errors} errors, ${bsdStats.notEntitled} not entitled), ` +
        `${d1Stats.queries} D1 queries, ${d1Stats.rowsWritten} rows written.`,
    );
  } catch (err) {
    console.error(`\n${name} failed:`, err instanceof Error ? err.stack ?? err.message : err);
    process.exit(1);
  }
}

void main();
