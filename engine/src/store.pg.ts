import postgres from 'postgres';
import { config } from './config.ts';

/**
 * Postgres (Supabase) access, over the transaction pooler.
 *
 * Deliberately exposes the same surface as the D1 backend so no caller changes:
 * `?` placeholders, SQLite-shaped SQL, the same helpers. The two things that
 * genuinely differ are handled here rather than spread across the engine.
 *
 * 1. **Placeholders.** Callers write `?`; Postgres wants `$1`. Converted below,
 *    respecting quoted strings so a `?` inside a literal is left alone.
 * 2. **bigint.** Postgres reports int8 to the driver as a string, to protect
 *    precision the engine does not need — every id and epoch here is far inside
 *    Number.MAX_SAFE_INTEGER. Left alone, `kickoff` would arrive as "1789587000"
 *    and every comparison and subtraction against it would quietly misbehave, so
 *    int8 is parsed to a number at the driver.
 */

export const dbStats = { queries: 0, rowsWritten: 0, rowsRead: 0 };

/**
 * Rewrite `?` placeholders to `$n`, skipping anything inside a string literal
 * or a comment. A naive replace would corrupt a query containing a literal
 * question mark; none does today, and this stops that being a landmine.
 */
export function toPgPlaceholders(sql: string): string {
  let out = '';
  let n = 0;
  let inSingle = false;
  let inDouble = false;
  let inLineComment = false;
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i]!;
    const next = sql[i + 1];
    if (inLineComment) {
      out += c;
      if (c === '\n') inLineComment = false;
      continue;
    }
    if (!inSingle && !inDouble && c === '-' && next === '-') {
      inLineComment = true;
      out += c;
      continue;
    }
    if (!inDouble && c === "'") {
      // '' is an escaped quote inside a literal, not a close.
      if (inSingle && next === "'") {
        out += "''";
        i++;
        continue;
      }
      inSingle = !inSingle;
      out += c;
      continue;
    }
    if (!inSingle && c === '"') {
      inDouble = !inDouble;
      out += c;
      continue;
    }
    if (c === '?' && !inSingle && !inDouble) {
      out += `$${++n}`;
      continue;
    }
    out += c;
  }
  return out;
}

let client: postgres.Sql | null = null;

function db(): postgres.Sql {
  if (client) return client;
  if (!config.pg.url) {
    throw new Error('SUPABASE_DB_URL is not set. The Postgres backend cannot connect without it.');
  }
  // Supabase requires TLS; a local Postgres used for tests does not speak it at
  // all, and forcing it there fails as an opaque socket reset. Decide from the
  // host rather than adding a knob someone has to remember to set.
  const host = (() => {
    try {
      return new URL(config.pg.url).hostname;
    } catch {
      return '';
    }
  })();
  const isLocal = host === 'localhost' || host === '127.0.0.1' || host === '::1';

  client = postgres(config.pg.url, {
    // The pooler multiplexes connections, so server-side prepared statements
    // cannot be relied on between round trips.
    prepare: false,
    ssl: isLocal ? false : 'require',
    max: config.pg.poolSize,
    connect_timeout: 30,
    idle_timeout: 20,
    types: {
      bigint: {
        to: 20,
        from: [20],
        serialize: (v: number | bigint) => String(v),
        parse: (v: string) => Number(v),
      },
    },
    onnotice: () => {},
  });
  return client;
}

/** Close the pool so a finished job exits instead of idling on an open socket. */
export async function closeDb(): Promise<void> {
  if (!client) return;
  const c = client;
  client = null;
  await c.end({ timeout: 5 });
}

async function run<T>(sql: string, params: unknown[]): Promise<T[]> {
  dbStats.queries++;
  const rows = (await db().unsafe(toPgPlaceholders(sql), params as never[])) as unknown as T[];
  dbStats.rowsRead += rows.length;
  return rows;
}

export function select<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  return run<T>(sql, params);
}

export async function exec(sql: string, params: unknown[] = []): Promise<void> {
  await run(sql, params);
}

export async function selectOne<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T | null> {
  const rows = await run<T>(sql, params);
  return rows[0] ?? null;
}

/**
 * Chunked multi-row upsert.
 *
 * Postgres allows 65535 bound parameters per statement against D1's 100, which
 * is the single biggest reason this backend exists: a 22-column stats row went
 * four to a statement and now goes a thousand. Capped well under the ceiling so
 * a wide table cannot silently cross it.
 */
export async function insertMany(
  table: string,
  columns: string[],
  rows: Array<Record<string, unknown>>,
  opts: { onConflict?: string; conflictTarget?: string } = {},
): Promise<number> {
  if (rows.length === 0) return 0;

  const perRow = columns.length;
  const chunkRows = Math.max(1, Math.min(1000, Math.floor(config.pg.maxParams / perRow)));
  const colList = columns.map((c) => `"${c}"`).join(', ');

  const conflict =
    opts.onConflict ??
    (opts.conflictTarget
      ? `ON CONFLICT (${opts.conflictTarget}) DO UPDATE SET ${columns
          .filter((c) => !opts.conflictTarget!.split(',').map((s) => s.trim()).includes(c))
          .map((c) => `"${c}" = excluded."${c}"`)
          .join(', ')}`
      : '');

  let written = 0;
  for (let i = 0; i < rows.length; i += chunkRows) {
    const chunk = rows.slice(i, i + chunkRows);
    let p = 0;
    const values = chunk
      .map(() => `(${columns.map(() => `$${++p}`).join(', ')})`)
      .join(', ');
    const params = chunk.flatMap((row) =>
      columns.map((c) => {
        const v = row[c];
        if (v === undefined) return null;
        if (typeof v === 'boolean') return v ? 1 : 0;
        return v;
      }),
    );
    dbStats.queries++;
    await db().unsafe(
      `INSERT INTO ${table} (${colList}) VALUES ${values}${conflict ? ` ${conflict}` : ''}`,
      params as never[],
    );
    written += chunk.length;
    dbStats.rowsWritten += chunk.length;
  }
  return written;
}

// ------------------------------------------------------------------- kv

export async function kvGet(key: string): Promise<string | null> {
  const row = await selectOne<{ v: string; expires_at: number | null }>(
    'SELECT v, expires_at FROM kv WHERE k = ?',
    [key],
  );
  if (!row) return null;
  if (row.expires_at && row.expires_at < Math.floor(Date.now() / 1000)) return null;
  return row.v;
}

export async function kvGetJSON<T>(key: string): Promise<T | null> {
  const raw = await kvGet(key);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function kvSet(key: string, value: string, ttlSeconds?: number): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await exec(
    'INSERT INTO kv (k, v, expires_at, updated_at) VALUES (?, ?, ?, ?) ' +
      'ON CONFLICT (k) DO UPDATE SET v = excluded.v, expires_at = excluded.expires_at, updated_at = excluded.updated_at',
    [key, value, ttlSeconds ? now + ttlSeconds : null, now],
  );
}

export function kvSetJSON(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
  return kvSet(key, JSON.stringify(value), ttlSeconds);
}

// --------------------------------------------------------------- migrate

/**
 * Comments are stripped before the split, not after: splitting first tears a
 * comment containing a semicolon in two and executes its tail as SQL.
 */
export function splitStatements(schemaSql: string): string[] {
  return schemaSql
    .replace(/^\s*--.*$/gm, '')
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export async function migrate(schemaSql: string): Promise<void> {
  for (const stmt of splitStatements(schemaSql)) await exec(stmt);
}
