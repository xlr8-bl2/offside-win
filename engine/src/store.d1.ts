import { createHmac } from 'node:crypto';
import { config } from './config.ts';
import { splitStatements } from './sql-split.ts';

/**
 * D1 access over Cloudflare's REST API.
 *
 * The engine runs on GitHub Actions, not inside a Worker, so it has no D1
 * binding — it talks to the same database over HTTP. The Worker gets the
 * binding and only ever reads.
 *
 * Bulk writes go through `insertMany`, which builds chunked multi-row
 * parameterised INSERTs. Everything is bound rather than interpolated: the
 * rows come from a third-party API and are never trusted as SQL.
 */

const API = 'https://api.cloudflare.com/client/v4';

interface D1Response<T> {
  success: boolean;
  errors: Array<{ code: number; message: string }>;
  result: Array<{ results?: T[]; success: boolean; meta?: Record<string, unknown> }>;
}

export const dbStats = { queries: 0, rowsWritten: 0, rowsRead: 0 };

/**
 * The key the Worker's engine door checks (worker/src/enginedb.ts): an HMAC of
 * the Cloudflare API token under a fixed label. deploy.yml derives the same
 * value with openssl and stores it as the Worker secret ENGINE_DB_KEY.
 */
export function engineDbKey(token = config.d1.token): string {
  return createHmac('sha256', token).update('offside-engine-db-v1').digest('hex');
}

/**
 * Statements through the Worker (`ENGINE_DB_URL`), as one D1 batch: one
 * transaction, one round trip. The REST API allows about 1,200 requests in
 * five minutes per user; a slate pass makes close to 4,000 queries.
 */
async function viaWorker<T>(statements: Array<{ sql: string; params: unknown[] }>): Promise<T[][]> {
  let lastErr = '';
  for (let attempt = 0; attempt <= 4; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 2 ** attempt * 500));
    try {
      dbStats.queries += statements.length;
      const res = await fetch(config.d1.gateway, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-engine-key': engineDbKey() },
        body: JSON.stringify({ statements }),
      });
      if (res.status === 429 || res.status >= 500) {
        lastErr = `${res.status} ${(await res.text()).slice(0, 200)}`;
        continue;
      }
      const body = await res.json().catch(() => null) as { results?: Array<{ rows: T[] }>; error?: string } | null;
      if (!res.ok || !body?.results) {
        // A SQL error will not succeed on retry.
        throw new Error(`D1 error: ${body?.error ?? res.status}\nSQL: ${statements[0]?.sql.slice(0, 400)}`);
      }
      const out = body.results.map((r) => r.rows ?? []);
      for (const rows of out) dbStats.rowsRead += rows.length;
      return out;
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('D1 error:')) throw err;
      lastErr = err instanceof Error ? err.message : String(err);
    }
  }
  throw new Error(`D1 request failed after retries: ${lastErr}`);
}

/** D1 wants plain values: booleans as 0/1, undefined as null, objects as JSON text. */
function bindable(params: unknown[]): unknown[] {
  return params.map((v) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0)
    : v !== null && typeof v === 'object' && !(v instanceof Uint8Array) ? JSON.stringify(v) : v));
}

async function request<T>(sql: string, params: unknown[]): Promise<T[]> {
  if (config.d1.gateway) return (await viaWorker<T>([{ sql, params: bindable(params) }]))[0] ?? [];
  const url = `${API}/accounts/${config.d1.accountId}/d1/database/${config.d1.databaseId}/query`;

  let lastErr = '';
  for (let attempt = 0; attempt <= 3; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 2 ** attempt * 750));
    try {
      dbStats.queries++;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.d1.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ sql, params }),
      });

      if (res.status === 429 || res.status >= 500) {
        lastErr = `${res.status} ${(await res.text()).slice(0, 200)}`;
        continue;
      }

      const body = (await res.json()) as D1Response<T>;
      if (!res.ok || !body.success) {
        const msg = body.errors?.map((e) => `${e.code}: ${e.message}`).join('; ') ?? res.statusText;
        // A malformed statement will never succeed on retry — fail loudly.
        throw new Error(`D1 error: ${msg}\nSQL: ${sql.slice(0, 400)}`);
      }

      const rows = body.result.flatMap((r) => r.results ?? []);
      dbStats.rowsRead += rows.length;
      return rows;
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('D1 error:')) throw err;
      lastErr = err instanceof Error ? err.message : String(err);
    }
  }
  throw new Error(`D1 request failed after retries: ${lastErr}`);
}

/** Run a statement and return its rows. */
export function select<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  return request<T>(sql, params);
}

/** Run a statement for effect. */
export async function exec(sql: string, params: unknown[] = []): Promise<void> {
  await request(sql, params);
}

export async function selectOne<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T | null> {
  const rows = await select<T>(sql, params);
  return rows[0] ?? null;
}

/**
 * Chunked multi-row upsert.
 *
 * D1 caps bound parameters per statement — at 100, far below SQLite's own
 * limit — so chunk on total parameters rather than row count: a 20-column table
 * and a 4-column table need very different row limits to stay under one ceiling.
 */
export async function insertMany(
  table: string,
  columns: string[],
  rows: Array<Record<string, unknown>>,
  opts: { onConflict?: string; conflictTarget?: string } = {},
): Promise<number> {
  if (rows.length === 0) return 0;

  const MAX_PARAMS = config.d1.maxParams;
  const perRow = columns.length;
  const chunkRows = Math.max(1, Math.floor(MAX_PARAMS / perRow));

  const colList = columns.map((c) => `"${c}"`).join(', ');
  const placeholders = `(${columns.map(() => '?').join(', ')})`;

  // Default: upsert on the primary key, overwriting every non-key column. The
  // engine is idempotent by design — rerunning a slate must converge, not
  // duplicate.
  const conflict =
    opts.onConflict ??
    (opts.conflictTarget
      ? `ON CONFLICT(${opts.conflictTarget}) DO UPDATE SET ${columns
          .filter((c) => !opts.conflictTarget!.split(',').map((s) => s.trim()).includes(c))
          .map((c) => `"${c}" = excluded."${c}"`)
          .join(', ')}`
      : '');

  const statements: Array<{ sql: string; params: unknown[] }> = [];
  for (let i = 0; i < rows.length; i += chunkRows) {
    const chunk = rows.slice(i, i + chunkRows);
    const sql =
      `INSERT INTO ${table} (${colList}) VALUES ` +
      chunk.map(() => placeholders).join(', ') +
      (conflict ? ` ${conflict}` : '');
    const params = chunk.flatMap((row) => bindable(columns.map((c) => row[c])));
    statements.push({ sql, params });
  }
  // Through the Worker, many chunks to a request; over REST, one at a time.
  if (config.d1.gateway) {
    for (let i = 0; i < statements.length; i += config.d1.batchSize) await viaWorker(statements.slice(i, i + config.d1.batchSize));
  } else {
    for (const st of statements) await request(st.sql, st.params);
  }
  dbStats.rowsWritten += rows.length;
  return rows.length;
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
    `INSERT INTO kv (k, v, expires_at, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(k) DO UPDATE SET v = excluded.v, expires_at = excluded.expires_at, updated_at = excluded.updated_at`,
    [key, value, ttlSeconds ? now + ttlSeconds : null, now],
  );
}

export function kvSetJSON(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
  return kvSet(key, JSON.stringify(value), ttlSeconds);
}

/**
 * Apply the schema. Idempotent — every statement is CREATE ... IF NOT EXISTS.
 *
 * Comments are stripped *before* the split, not after. Splitting first means a
 * comment containing a semicolon is torn in two, and the tail — no longer
 * preceded by `--` — survives comment-stripping and is executed as SQL. The
 * live schema has two such comments and gets away with it only because the
 * semicolons happen to sit at end of line, where the leftover fragment starts
 * with a newline and the continuation lines are still whole comments. Reflow
 * one of those lines and the migration breaks. Stripping first removes the
 * whole class rather than relying on where the punctuation lands.
 */

export async function migrate(schemaSql: string): Promise<void> {
  for (const stmt of splitStatements(schemaSql)) await exec(stmt);
}
