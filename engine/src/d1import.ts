/**
 * `db:import`: the export (dbexport.ts) loaded into D1.
 *
 * pg.yml decrypts the export into engine/export first. The schema is applied,
 * every table the export fills is emptied, and the rows go in as bound
 * INSERTs, many to a batch (d1load.ts builds them). Safe to run again: it
 * replaces what is there with the export, so run it again after a fresh
 * `db:export` and before the engine starts writing to D1, not after.
 *
 * Prints table names and counts, never values.
 */

import { readFileSync } from 'node:fs';
import { importStatements, type Statement } from './d1load.ts';
import { batch, migrate, select } from './store.d1.ts';
import { config } from './config.ts';
import { d1Create } from './d1setup.ts';

/** Statements to a batch, and bytes: a batch is one request and one transaction. */
const MAX_STATEMENTS = 200;
const MAX_BYTES = 4_000_000;

export async function d1Import(dir = 'export'): Promise<void> {
  // The database by name, so this needs no id handed to it (d1setup.ts).
  if (!config.d1.gateway) (config.d1 as { databaseId: string }).databaseId = await d1Create();
  const schemaSql = readFileSync(new URL('../../schema.sql', import.meta.url), 'utf8');
  await migrate(schemaSql);
  console.log('schema applied');
  const report = { tables: {} as Record<string, number>, skipped: [] as string[] };
  let pending: Statement[] = [];
  let bytes = 0;
  let sent = 0;
  const flush = async () => {
    if (!pending.length) return;
    await batch(pending);
    sent += pending.length;
    pending = [];
    bytes = 0;
  };
  for await (const st of importStatements(dir, schemaSql, report)) {
    const size = st.sql.length + JSON.stringify(st.params).length;
    if (pending.length && (pending.length >= MAX_STATEMENTS || bytes + size > MAX_BYTES)) await flush();
    pending.push(st);
    bytes += size;
  }
  await flush();
  console.log(`sent ${sent} statements`);
  for (const c of report.skipped) console.log(`  left out: ${c}`);
  // Read the counts back from D1, so the log shows what landed, not what was sent.
  let bad = 0;
  for (const [table, n] of Object.entries(report.tables)) {
    const [row] = await select<{ n: number }>(`SELECT count(*) AS n FROM ${table}`);
    const ok = row?.n === n;
    if (!ok) bad++;
    console.log(`  ${table}: ${n} exported, ${row?.n ?? '?'} in D1${ok ? '' : '  MISMATCH'}`);
  }
  if (bad) throw new Error(`${bad} tables did not land in full`);
  console.log('import complete');
}
