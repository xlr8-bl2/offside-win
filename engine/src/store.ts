import { config } from './config.ts';

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

export const d1Stats = { queries: 0, rowsWritten: 0, rowsRead: 0 };

async function request<T>(sql: string, params: unknown[]): Promise<T[]> {
  const url = `${API}/accounts/${config.d1.accountId}/d1/database/${config.d1.databaseId}/query`;

  let lastErr = '';
  for (let attempt = 0; attempt <= 3; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 2 ** attempt * 750));
    try {
      d1Stats.queries++;
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
      d1Stats.rowsRead += rows.length;
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

  let written = 0;
  for (let i = 0; i < rows.length; i += chunkRows) {
    const chunk = rows.slice(i, i + chunkRows);
    const sql =
      `INSERT INTO ${table} (${colList}) VALUES ` +
      chunk.map(() => placeholders).join(', ') +
      (conflict ? ` ${conflict}` : '');
    const params = chunk.flatMap((row) =>
      columns.map((c) => {
        const v = row[c];
        if (v === undefined) return null;
        if (typeof v === 'boolean') return v ? 1 : 0;
        return v;
      }),
    );
    await request(sql, params);
    written += chunk.length;
    d1Stats.rowsWritten += chunk.length;
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
    `INSERT INTO kv (k, v, expires_at, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(k) DO UPDATE SET v = excluded.v, expires_at = excluded.expires_at, updated_at = excluded.updated_at`,
    [key, value, ttlSeconds ? now + ttlSeconds : null, now],
  );
}

export function kvSetJSON(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
  return kvSet(key, JSON.stringify(value), ttlSeconds);
}

/** Apply schema.sql. Idempotent — every statement is CREATE ... IF NOT EXISTS. */
export async function migrate(schemaSql: string): Promise<void> {
  const statements = schemaSql
    .split(';')
    .map((s) => s.replace(/^\s*--.*$/gm, '').trim())
    .filter((s) => s.length > 0);
  for (const stmt of statements) await exec(stmt);
}
