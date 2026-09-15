import { config } from './config.ts';
import * as d1 from './store.d1.ts';
import * as pg from './store.pg.ts';

/**
 * Database access, dispatched to a backend.
 *
 * Both backends expose the same surface — `?` placeholders, SQLite-shaped SQL —
 * so nothing upstream knows which one it is talking to. The indirection exists
 * so D1 can keep serving the live site while Postgres is proven against it, and
 * so the cutover is one environment variable rather than a deploy of rewritten
 * call sites. Once Postgres has reproduced the board and the backtest, the D1
 * backend can go.
 */

const backend = () => (config.dbBackend === 'postgres' ? pg : d1);

/** Counters for the run log. Reads through to whichever backend is active. */
export const dbStats = {
  get queries() {
    return backend().dbStats.queries;
  },
  get rowsWritten() {
    return backend().dbStats.rowsWritten;
  },
  get rowsRead() {
    return backend().dbStats.rowsRead;
  },
};

export function select<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  return backend().select<T>(sql, params);
}

export function exec(sql: string, params: unknown[] = []): Promise<void> {
  return backend().exec(sql, params);
}

export function selectOne<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T | null> {
  return backend().selectOne<T>(sql, params);
}

export function insertMany(
  table: string,
  columns: string[],
  rows: Array<Record<string, unknown>>,
  opts: { onConflict?: string; conflictTarget?: string } = {},
): Promise<number> {
  return backend().insertMany(table, columns, rows, opts);
}

export function kvGet(key: string): Promise<string | null> {
  return backend().kvGet(key);
}

export function kvGetJSON<T>(key: string): Promise<T | null> {
  return backend().kvGetJSON<T>(key);
}

export function kvSet(key: string, value: string, ttlSeconds?: number): Promise<void> {
  return backend().kvSet(key, value, ttlSeconds);
}

export function kvSetJSON(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
  return backend().kvSetJSON(key, value, ttlSeconds);
}

export function migrate(schemaSql: string): Promise<void> {
  return backend().migrate(schemaSql);
}

export { splitStatements } from './sql-split.ts';

/** Release any pooled connections so a finished job exits promptly. */
export async function closeDb(): Promise<void> {
  if (config.dbBackend === 'postgres') await pg.closeDb();
}

/**
 * The conflict target that identifies a pick.
 *
 * Same intent, two spellings. Postgres indexes the plain columns with NULLS NOT
 * DISTINCT, so a missing line collides as it should. SQLite has no such option,
 * so its index is on COALESCE(line, -1e9) and the upsert must name the very
 * same expression or it matches no index and silently inserts a duplicate.
 */
export function pickConflictTarget(): string {
  return config.dbBackend === 'postgres'
    ? 'fixture_id, market, outcome, line, kind'
    : 'fixture_id, market, outcome, COALESCE(line, -1e9), kind';
}

/** Which schema file the active backend expects. */
export function schemaFile(): string {
  return config.dbBackend === 'postgres' ? 'schema.pg.sql' : 'schema.sql';
}
