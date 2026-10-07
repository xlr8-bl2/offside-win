/**
 * `record:reset`: start the public record from now, with the engine that is
 * live, by setting the earlier calls aside.
 *
 * Before launch the owner chose not to carry the calls of the engines before
 * the one of 6 October 2026. Every page reads its record from three tables --
 * pick, pulled_call and slip -- so the earlier rows move, each in one
 * statement, into the private *_archive tables (schema.pg.sql), and every page
 * then shows only what the live engine has published since. Nothing is
 * deleted, and nothing is invented: the record that follows is the calls the
 * live engine actually makes.
 *
 *   record:reset dry     counts only
 *   record:reset         set aside everything that kicked off before now
 *   record:reset undo    put every archived row back
 *   record:reset undo-dry  counts what undo would put back (D1)
 *
 * Calls on games still to kick off stay where they are: they are standing
 * calls, which the live engine keeps or withdraws on its next pass. Prints
 * counts, never a call.
 */

import { exec, select } from './store.ts';
import { config } from './config.ts';

/** Each table, its archive, and which rows belong to the time before the cut. */
const SETS = [
  { table: 'pick', archive: 'pick_archive', before: 'kickoff < $1' },
  { table: 'pulled_call', archive: 'pulled_call_archive', before: 'kickoff < $1' },
  { table: 'slip', archive: 'slip_archive', before: 'first_kickoff < $1' },
] as const;

async function columns(table: string): Promise<Array<{ name: string; type: string }>> {
  return select<{ name: string; type: string }>(
    `SELECT a.attname AS name, format_type(a.atttypid, a.atttypmod) AS type
       FROM pg_attribute a
      WHERE a.attrelid = $1::regclass AND a.attnum > 0 AND NOT a.attisdropped
      ORDER BY a.attnum`,
    [table],
  );
}

/** The columns both share, after giving the archive any the table has grown since it was made. */
async function shared(table: string, archive: string): Promise<string> {
  const src = await columns(table);
  const have = new Set((await columns(archive)).map((c) => c.name));
  for (const c of src) {
    if (!have.has(c.name)) await exec(`ALTER TABLE ${archive} ADD COLUMN IF NOT EXISTS "${c.name}" ${c.type}`);
  }
  return src.map((c) => `"${c.name}"`).join(', ');
}

/**
 * D1 (SQLite) has no DELETE ... RETURNING into an INSERT in one statement, so
 * each move is a copy then a delete of what was copied, keyed on the id. A row
 * that would collide with one already there (the same call made again) is
 * left where it was and counted.
 */
async function d1Columns(table: string): Promise<string[]> {
  return (await select<{ name: string }>(`SELECT name FROM pragma_table_info('${table}')`)).map((c) => c.name);
}
async function d1Shared(table: string, archive: string): Promise<string> {
  const have = new Set(await d1Columns(archive));
  return (await d1Columns(table)).filter((c) => have.has(c)).map((c) => `"${c}"`).join(', ');
}
const count = async (sql: string, params: unknown[] = []) => Number((await select<{ n: number }>(sql, params))[0]?.n ?? 0);

async function recordResetD1(mode: string, now: number): Promise<void> {
  if (mode === 'undo' || mode === 'undo-dry') {
    for (const s of SETS) {
      const n = await count(`SELECT count(*) AS n FROM ${s.archive}`);
      if (mode === 'undo-dry') { console.log(`  ${s.table}: ${n} archived, would be put back`); continue; }
      const cols = await d1Shared(s.table, s.archive);
      await exec(`INSERT OR IGNORE INTO ${s.table} (${cols}) SELECT ${cols} FROM ${s.archive}`);
      await exec(`DELETE FROM ${s.archive} WHERE id IN (SELECT id FROM ${s.table})`);
      const left = await count(`SELECT count(*) AS n FROM ${s.archive}`);
      console.log(`  ${s.table}: ${n - left} put back${left ? `, ${left} left in the archive (the same call is live)` : ''}`);
    }
    return;
  }
  console.log(`record:reset ${mode === 'dry' ? '(dry run) ' : ''}from ${new Date(now * 1000).toISOString()}`);
  for (const s of SETS) {
    const before = s.before.replace('$1', '?');
    const n = await count(`SELECT count(*) AS n FROM ${s.table} WHERE ${before}`, [now]);
    const left = await count(`SELECT count(*) AS n FROM ${s.table} WHERE NOT (${before})`, [now]);
    const archived = await count(`SELECT count(*) AS n FROM ${s.archive}`);
    if (mode === 'dry') { console.log(`  ${s.table}: ${n} would be set aside, ${left} stay; ${archived} already archived`); continue; }
    const cols = await d1Shared(s.table, s.archive);
    await exec(`INSERT INTO ${s.archive} (${cols}, archived_at) SELECT ${cols}, ? FROM ${s.table} WHERE ${before}`, [now, now]);
    await exec(`DELETE FROM ${s.table} WHERE ${before}`, [now]);
    console.log(`  ${s.table}: ${n} set aside, ${left} stay`);
  }
}

export async function recordReset(arg: string): Promise<void> {
  const mode = arg.trim().toLowerCase() || 'now';
  const now = Math.floor(Date.now() / 1000);
  if (!['now', 'dry', 'undo', 'undo-dry'].includes(mode)) throw new Error(`record:reset takes "dry", "undo", "undo-dry" or nothing, not "${arg}"`);
  if (config.dbBackend === 'd1') return recordResetD1(mode, now);
  if (mode === 'undo-dry') throw new Error('undo-dry is for D1');

  if (mode === 'undo') {
    for (const s of SETS) {
      const cols = await shared(s.table, s.archive);
      const n = (await select<{ n: number }>(`SELECT count(*)::int AS n FROM ${s.archive}`))[0]?.n ?? 0;
      await exec(
        `WITH moved AS (DELETE FROM ${s.archive} RETURNING ${cols})
         INSERT INTO ${s.table} (${cols}) OVERRIDING SYSTEM VALUE SELECT ${cols} FROM moved`,
      );
      console.log(`  ${s.table}: ${n} put back`);
    }
    return;
  }

  console.log(`record:reset ${mode === 'dry' ? '(dry run) ' : ''}from ${new Date(now * 1000).toISOString()}`);
  for (const s of SETS) {
    const n = (await select<{ n: number }>(`SELECT count(*)::int AS n FROM ${s.table} WHERE ${s.before}`, [now]))[0]?.n ?? 0;
    const left = (await select<{ n: number }>(`SELECT count(*)::int AS n FROM ${s.table} WHERE NOT (${s.before})`, [now]))[0]?.n ?? 0;
    if (mode === 'dry') { console.log(`  ${s.table}: ${n} would be set aside, ${left} stay`); continue; }
    const cols = await shared(s.table, s.archive);
    await exec(
      `WITH moved AS (DELETE FROM ${s.table} WHERE ${s.before} RETURNING ${cols})
       INSERT INTO ${s.archive} (${cols}, archived_at) SELECT ${cols}, $2 FROM moved`,
      [now, now],
    );
    console.log(`  ${s.table}: ${n} set aside, ${left} stay`);
  }
}
