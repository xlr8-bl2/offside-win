import { readFileSync } from 'node:fs';
import { runBacktest } from './backtest.ts';
import { clearCache, stats as bsdStats } from './bsd.ts';
import { config, requireEnv } from './config.ts';
import { backfillHistory, repairCards } from './history.ts';
import { probe, probeExtras, probePlayers, probeProfiles, probeReds, probeReport } from './probe.ts';
import { grant, plans } from './grant.ts';
import { whopCheck } from './whopcheck.ts';
import { geminiCheck } from './geminicheck.ts';
import { mailSetup } from './mailsetup.ts';
import { authMail } from './authmail.ts';
import { syncCards } from './cards/sync.ts';
import { probeHistoricOdds, runLab } from './lab/run.ts';
import { backfillSnapshots } from './lab/backfill.ts';
import { trace } from './trace.ts';
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

  async 'probe:profile'() {
    requireEnv();
    const ids = [process.env['GRANT_EMAIL'], process.env['GRANT_ARG'], ...process.argv.slice(3)]
      .map((v) => Number(v)).filter((v) => Number.isInteger(v) && v > 0);
    return probeProfiles(ids);
  },

  async 'probe:extras'() {
    requireEnv();
    return probeExtras();
  },

  async 'probe:reds'() {
    requireEnv();
    return probeReds();
  },

  async 'probe:report'() {
    if (!config.bsd.key) throw new Error('BSD_API_KEY is required to probe.');
    return probeReport();
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
    // Card renewals here were built for Coinflow, which was set aside for
    // Whop, and Whop renews its own memberships. With no Coinflow key there
    // is nothing to charge with, so say so and stop, rather than fail the
    // job every morning. Set the key and this runs as before.
    if (!process.env['COINFLOW_API_KEY']) {
      console.log('Renewals: no card processor set (COINFLOW_API_KEY). Whop renews its own memberships, so there is nothing to charge here.');
      return { skipped: 'no card processor' };
    }
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

  // Card counts the provider's stats left blank because nothing was shown.
  async 'history:cards'() {
    requireEnv();
    await ensureSchema();
    const days = Number(process.env['GRANT_EMAIL']) || 400;
    const r = await repairCards(days);
    console.log(`Cards: ${r.checked} matches without a count in the last ${days} days; ${r.repaired} read from the incidents, ${r.unpublished} still unpublished.`);
    return r;
  },

  /**
   * One slate pass that chooses every call still to kick off again, as if
   * none had been made, and rebuilds a slip that has not started. For after a
   * change to the engine. See runSlate.
   */
  async 'slate:fresh'() {
    requireEnv();
    await ensureSchema();
    const report = await runSlate({ fresh: true });
    await pruneBoard();
    return report;
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

  /**
   * The slate, every fifteen minutes, for most of a job's six hours.
   *
   * GitHub runs a fifteen-minute schedule when it has capacity to, which in
   * practice was every three to six hours: the board said "re-analysed every
   * fifteen minutes" and was often an afternoon old. One job that keeps
   * going, started again by the schedule when it ends, is the cadence the
   * board promises. Each pass starts from a clean provider cache, so it sees
   * the prices and team news as they are now.
   */
  async 'slate:loop'() {
    requireEnv();
    await ensureSchema();
    const every = config.slate.loopEveryMinutes * 60_000;
    const end = Date.now() + config.slate.loopForMinutes * 60_000;
    // Leave room for one more pass to finish inside the job's limit.
    const lastStart = end - 25 * 60_000;
    let pass = 0;
    let failures = 0;
    for (;;) {
      const t0 = Date.now();
      pass++;
      clearCache();
      try {
        await commands.slate!();
        failures = 0;
      } catch (err) {
        // One bad pass (a provider outage, a dropped connection) is not a
        // reason to stop the board updating; three in a row is.
        failures++;
        console.error(`slate:loop: pass ${pass} failed:`, err instanceof Error ? err.message : err);
        if (failures >= 3) throw err;
      }
      // And grade what has finished, every pass. The settle workflow is
      // scheduled hourly and GitHub ran it every four or five hours, so a
      // match could be over for half a day before its call reached the
      // results. Here it is graded within a pass of full time. A failure is
      // logged and does not stop the board.
      try {
        const s = await runSettle();
        if (s.settled) console.log(`slate:loop: graded ${s.settled} call${s.settled === 1 ? '' : 's'}`);
      } catch (err) {
        console.error('slate:loop: settle failed:', err instanceof Error ? err.message : err);
      }
      console.log(`slate:loop: pass ${pass} took ${((Date.now() - t0) / 60_000).toFixed(1)} min`);
      const next = t0 + every;
      if (next > lastStart) break;
      if (next > Date.now()) await new Promise((r) => setTimeout(r, next - Date.now()));
    }
    console.log(`slate:loop: ${pass} passes`);
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

  async 'whop:check'() {
    return whopCheck();
  },

  async 'gemini:check'() {
    return geminiCheck();
  },

  // The market lab: which probability is most accurate and which selection
  // rule earns, replayed on the prices we actually saw. See lab/markets.ts.
  async lab() {
    requireEnv({ provider: false });
    // A named study instead of the whole report: `deep` (lab/deep.ts).
    const study = (process.env['ARG'] ?? '').trim();
    if (study === 'deep' || study === 'deep anatomy') {
      const { loadHistory } = await import('./lab/run.ts');
      const { runDeep, runAnatomy } = await import('./lab/deep.ts');
      const { kvSetJSON } = await import('./store.ts');
      const rows = await loadHistory();
      const report = study === 'deep' ? runDeep(rows) : runAnatomy(rows);
      await kvSetJSON(study === 'deep' ? 'lab:deep' : 'lab:anatomy', { at: Math.floor(Date.now() / 1000), ...report });
      return;
    }
    await runLab();
  },

  // Search for the rule that lands most and still earns, on a three-way split.
  async 'lab:tune'() {
    requireEnv({ provider: false });
    const { loadHistory } = await import('./lab/run.ts');
    const { runTune } = await import('./lab/tune.ts');
    const { kvSetJSON } = await import('./store.ts');
    const report = runTune(await loadHistory());
    await kvSetJSON('lab:tune', { at: Math.floor(Date.now() / 1000), ...report });
  },

  // Can anything beat the price? Our own analysis (the ratings refitted week
  // by week), the money since the open and the rest, each tested against
  // production on matches nothing was tuned on (lab/learned.ts).
  async 'lab:model'() {
    requireEnv({ provider: false });
    const { loadHistory } = await import('./lab/run.ts');
    const { ownReads } = await import('./lab/own.ts');
    const { runModel } = await import('./lab/learned.ts');
    const { kvSetJSON } = await import('./store.ts');
    const rows = await loadHistory();
    const own = await ownReads(rows);
    for (const r of rows) r.own = own.get(r.id) ?? null;
    const report = runModel(rows);
    await kvSetJSON('lab:model', { at: Math.floor(Date.now() / 1000), ...report });
  },

  // The production rule and the sources, one kind of match at a time:
  // leagues, cups, continental club football, internationals, friendlies.
  async 'lab:slices'() {
    requireEnv({ provider: false });
    const { loadHistory } = await import('./lab/run.ts');
    const { runSlices } = await import('./lab/slices.ts');
    await runSlices(await loadHistory());
  },

  // Correct the price's known biases family by family, and judge it on
  // matches the correction never saw (lab/calib.ts).
  async 'lab:calib'() {
    requireEnv({ provider: false });
    const { loadHistory } = await import('./lab/run.ts');
    const { runCalib } = await import('./lab/calib.ts');
    runCalib(await loadHistory());
  },

  // The lab's replay of the production rule against what the live engine
  // actually published, over the period it has run that rule (lab/live.ts).
  async 'lab:live'() {
    requireEnv({ provider: false });
    const { loadHistory } = await import('./lab/run.ts');
    const { runLive } = await import('./lab/live.ts');
    await runLive(await loadHistory());
  },

  // The front page's record from the newest engine: the production rule
  // replayed on the games already played, stored in kv (lab/record.ts).
  async 'lab:record'() {
    requireEnv();
    const { loadHistory } = await import('./lab/run.ts');
    const { runRecord } = await import('./lab/record.ts');
    await runRecord(await loadHistory());
  },

  // Every settled call beside what the match turned out to be, and the
  // argument behind each loss (lab/losses.ts).
  async 'lab:losses'() {
    requireEnv();
    const { runLosses } = await import('./lab/losses.ts');
    await runLosses();
  },

  // Leans: for the fixtures the rule passes on, the best read at a lower
  // floor, graded on their own (lab/tune.ts, runLeans).
  async 'lab:leans'() {
    requireEnv({ provider: false });
    const { loadHistory } = await import('./lab/run.ts');
    const { runLeans } = await import('./lab/tune.ts');
    const { kvSetJSON } = await import('./store.ts');
    const report = runLeans(await loadHistory());
    await kvSetJSON('lab:leans', { at: Math.floor(Date.now() / 1000), ...report });
  },

  // Every competition's table, scorers, next games and results, now rather
  // than at the next three-hourly pass (leagueinfo.ts).
  async 'leagues:refresh'() {
    requireEnv();
    await ensureSchema();
    const { refreshLeagueInfo } = await import('./leagueinfo.ts');
    await refreshLeagueInfo(Math.floor(Date.now() / 1000), true);
  },

  async 'lab:backfill'() {
    requireEnv();
    await ensureSchema();
    await backfillSnapshots();
  },

  async 'lab:odds'() {
    requireEnv();
    await probeHistoricOdds();
  },

  // The share card of every match on the board, redrawn when it changes.
  async cards() {
    requireEnv({ provider: false });
    await syncCards();
  },

  // Brevo: the key, the domain's DNS records, the sender, and a test email.
  async 'mail:setup'() {
    return mailSetup(process.argv[3] ?? (process.env['GRANT_EMAIL'] || undefined));
  },

  // Sign-in emails: from the Worker in the site's design, or back to Supabase's.
  async 'mail:auth'() {
    return authMail(process.argv[3] ?? (process.env['GRANT_EMAIL'] || 'status'));
  },

  // The account a leaked call came from, by the code #/trace reads out of it.
  async trace() {
    requireEnv({ provider: false });
    return trace(process.argv[3] ?? (process.env['GRANT_EMAIL'] || undefined));
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
