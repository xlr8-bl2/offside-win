import { readFileSync } from 'node:fs';
import { runBacktest } from './backtest.ts';
import { stats as bsdStats } from './bsd.ts';
import { config, requireEnv } from './config.ts';
import { backfillHistory } from './history.ts';
import { probe, probePlayers } from './probe.ts';
import { grant, plans } from './grant.ts';
import { fitAllLeagues } from './ratings/fit.ts';
import { syncTeamShots } from './images/sync.ts';
import { coinflowCharger, renewDue } from './membership/renew.ts';
import { runSettle } from './settle.ts';
import { pruneBoard, runSlate } from './slate.ts';
import { closeDb, dbStats, migrate, schemaFile, select } from './store.ts';

/**
 * Entry points for the scheduled workflows.
 *
 *   probe     — walk a real fixture and dump the provider's actual shapes
 *   migrate   — apply schema.sql (idempotent)
 *   history   — backfill finished matches and their stats
 *   ratings   — refit Dixon-Coles and the corner/card models
 *   slate     — reprice the next few days and publish the board
 *   settle    — grade finished picks and refresh calibration
 *   renew     — charge the memberships falling due today
 *   images    — find a photograph for each team and re-host it
 *   backtest  — walk-forward evaluation
 *
 * Every entry point applies the schema first and the slate cold-starts itself,
 * so the only manual act in bringing this up is setting four secrets. Requiring
 * someone to press buttons in a fixed order is a setup step that can be got
 * wrong, and a system that can bootstrap itself should.
 */

/** CREATE TABLE IF NOT EXISTS throughout, so this is safe to run every time. */
async function ensureSchema(): Promise<void> {
  // The two backends take different dialects, so the active one names its file.
  const sql = readFileSync(new URL(`../../${schemaFile()}`, import.meta.url), 'utf8');
  await migrate(sql);
}

const commands: Record<string, () => Promise<unknown>> = {
  async probe() {
    if (!config.bsd.key) throw new Error('BSD_API_KEY is required to probe.');
    return probe();
  },

  async 'probe:players'() {
    if (!config.bsd.key) throw new Error('BSD_API_KEY is required to probe.');
    return probePlayers();
  },

  async migrate() {
    requireEnv({ provider: false });
    await ensureSchema();
    console.log('Schema applied.');
  },

  /**
   * Charge the memberships falling due, and chase the ones that decline.
   *
   * No provider key is needed to run it; it is needed to charge anything. A run
   * with nothing due does nothing and says so, which is the normal case and
   * should stay quiet rather than look like a failure.
   */
  async renew() {
    requireEnv({ provider: false });
    await ensureSchema();
    const report = await renewDue(coinflowCharger());
    console.log(
      `Renewals: ${report.due} due, ${report.renewed} renewed, `
      + `${report.declined} declined, ${report.abandoned} given up on, ${report.skipped} skipped.`,
    );
    return report;
  },

  /**
   * Football photography, which the odds provider does not sell.
   *
   * It gives crests, league badges and stadium architecture. What it has no
   * equivalent of is a player mid-celebration, and that is the whole difference
   * between a page that looks like a fixture list and a page that looks like
   * football. Needs SPORTRADAR_GETTY_KEY; without it this is a no-op that says
   * so rather than a failure.
   */
  async images() {
    requireEnv({ provider: false });
    await ensureSchema();
    const r = await syncTeamShots();
    console.log(
      `Photography: swept ${r.leagues} competitions, ${r.manifests} manifests, `
      + `${r.assets} assets seen, ${r.matched} matched to our teams, `
      + `${r.stored} stored, ${r.skipped} ambiguous, ${r.failed} failed.`,
    );
    return r;
  },

  async history() {
    requireEnv();
    await ensureSchema();
    return backfillHistory({ full: process.env.FULL_BACKFILL === 'true' });
  },

  async ratings() {
    requireEnv();
    await ensureSchema();
    console.log('Fitting ratings...');
    return fitAllLeagues();
  },

  async slate() {
    requireEnv();
    await ensureSchema();

    // Cold start. With no fitted ratings the slate would publish nothing, and
    // would go on publishing nothing every half hour until a human noticed. So
    // it builds what it needs instead of waiting to be told.
    //
    // The first pass is deliberately shallow — one season, and a capped stats
    // fetch — so it finishes inside a scheduled run rather than colliding with
    // the next one. The nightly ratings job deepens it from there.
    const fitted = await select<{ n: number }>('SELECT COUNT(*) AS n FROM rating_meta');
    if ((fitted[0]?.n ?? 0) === 0) {
      console.log('No fitted ratings found — cold-starting before pricing anything.\n');
      await backfillHistory({ full: false, seasons: 1, statsWindowDays: 200, statsLimit: 1200 });
      await fitAllLeagues();
      console.log('\nCold start complete. Tonight\'s ratings run will deepen the history.\n');
    }

    const report = await runSlate();
    await pruneBoard();
    return report;
  },

  async settle() {
    requireEnv();
    await ensureSchema();
    return runSettle();
  },

  async plans() {
    requireEnv({ provider: false });
    await ensureSchema();
    const [id, value] = process.argv.slice(3);
    return plans(id ?? (process.env['GRANT_EMAIL'] || undefined), value ?? (process.env['GRANT_ARG'] || undefined));
  },

  async grant() {
    requireEnv({ provider: false });
    await ensureSchema();
    const [email, arg] = process.argv.slice(3);
    return grant(email ?? process.env['GRANT_EMAIL'] ?? '', arg ?? (process.env['GRANT_ARG'] || undefined));
  },

  async backtest() {
    requireEnv();
    await ensureSchema();
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
        `(${bsdStats.retries} retries, ${bsdStats.errors} errors, ${bsdStats.notEntitled} not entitled, ` +
        `${bsdStats.cacheHits} served from cache), ` +
        `${dbStats.queries} DB queries, ${dbStats.rowsWritten} rows written.`,
    );
  } catch (err) {
    console.error(`\n${name} failed:`, err instanceof Error ? err.stack ?? err.message : err);
    await closeDb();
    process.exit(1);
  }
  // Postgres holds a pooled socket open, which would keep the process alive
  // after the work is done and turn a finished job into a job that hangs.
  await closeDb();
}

void main();
