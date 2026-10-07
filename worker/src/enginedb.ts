/**
 * The engine's way into D1: `POST /api/internal/db`.
 *
 * The engine runs on GitHub Actions and has no D1 binding. Cloudflare's REST
 * API would do, but it allows about 1,200 requests in five minutes per user,
 * and one slate pass makes close to 4,000 queries. So the engine sends its
 * statements here, a batch at a time, and this Worker runs them on its own
 * binding (HANDOFF.md, "The move to D1").
 *
 * The door is a shared key, `ENGINE_DB_KEY`: an HMAC of the Cloudflare API
 * token, which both sides already hold, so no new secret had to be created
 * (deploy.yml sets it; engine/src/store.d1.ts derives the same value). Without
 * the key nothing runs. With it, anything can: it is the engine's write access,
 * the same power the Postgres connection string had. It is never sent to a
 * browser and never logged.
 *
 * A batch runs as one D1 batch, which D1 executes as a single transaction: all
 * of it or none of it.
 */

export interface D1Result { results?: unknown[]; meta?: { changes?: number; last_row_id?: number; rows_read?: number; rows_written?: number } }
export interface D1Prepared { bind(...values: unknown[]): D1Prepared }
export interface D1Like {
  prepare(sql: string): D1Prepared;
  batch(statements: D1Prepared[]): Promise<D1Result[]>;
}

export interface EngineDbEnv {
  DB?: D1Like;
  ENGINE_DB_KEY?: string;
}

/** Statements a single request may carry; D1 allows 1,000 queries a Worker invocation. */
const MAX_STATEMENTS = 500;

function answer(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

/** Equal strings in time that does not depend on where they differ. */
function same(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function engineDb(request: Request, env: EngineDbEnv): Promise<Response> {
  if (request.method !== 'POST') return answer({ error: 'Not found.' }, 404);
  const key = env.ENGINE_DB_KEY ?? '';
  const given = request.headers.get('x-engine-key') ?? '';
  // No key configured is a closed door, not an open one.
  if (key.length < 32 || !same(given, key)) return answer({ error: 'Not found.' }, 404);
  if (!env.DB) return answer({ error: 'No database is bound to this Worker.' }, 503);

  let body: { statements?: Array<{ sql?: unknown; params?: unknown }> };
  try { body = await request.json(); } catch { return answer({ error: 'Expected JSON.' }, 400); }
  const list = Array.isArray(body?.statements) ? body.statements : [];
  if (!list.length || list.length > MAX_STATEMENTS) return answer({ error: `Send 1 to ${MAX_STATEMENTS} statements.` }, 400);

  const prepared: D1Prepared[] = [];
  for (const s of list) {
    if (typeof s?.sql !== 'string' || !s.sql.trim()) return answer({ error: 'Every statement needs sql.' }, 400);
    const params = Array.isArray(s.params) ? s.params : [];
    prepared.push(params.length ? env.DB.prepare(s.sql).bind(...params) : env.DB.prepare(s.sql));
  }
  try {
    const out = await env.DB.batch(prepared);
    return answer({
      results: out.map((r) => ({
        rows: r.results ?? [],
        changes: r.meta?.changes ?? 0,
        lastRowId: r.meta?.last_row_id ?? null,
        rowsRead: r.meta?.rows_read ?? 0,
        rowsWritten: r.meta?.rows_written ?? 0,
      })),
    });
  } catch (err) {
    // The engine prints this; the message is D1's own (a SQL error), never data.
    return answer({ error: err instanceof Error ? err.message : String(err) }, 422);
  }
}
