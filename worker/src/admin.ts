/**
 * The owner's dashboard, server side (/api/admin/*).
 *
 * Who may use it is decided here and nowhere else, and in this order:
 *
 *   1. GoTrue says whose token it is. The Worker does not verify JWTs itself;
 *      an expired or forged token stops at GoTrue (as in account.ts).
 *   2. That account's email, which GoTrue has confirmed, hashes to one of
 *      ADMIN_EMAIL_SHA256. The address is not written in this public
 *      repository: only its SHA-256 is, which confirms a guess and reveals
 *      nothing else.
 *   3. Only then is the database called, holding the service key, and the
 *      acting account passed to it is the one GoTrue named, never anything in
 *      the request body.
 *
 * The admin_ functions it calls grant the public key nothing (schema.pg.sql,
 * asserted in schema.test.ts), so a reader who finds these addresses gets a
 * 401 or a 403 here and a permission error beneath it. Every write is logged
 * by the database function that makes it.
 *
 * Nothing here is cached: every response is `no-store`, and none of these
 * paths is in the edge's list (edge.ts).
 */

import type { PayEnv } from './pay.ts';

export interface AdminEnv extends PayEnv {
  /** Comma-separated SHA-256 hex digests of the owner's lower-cased email. */
  ADMIN_EMAIL_SHA256?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function reply(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', vary: 'Authorization' },
  });
}
const refuse = (error: string, status: number) => reply({ error }, status);

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** The admin behind a token, or why not. */
export async function whoIsAdmin(env: AdminEnv, jwt: string | null): Promise<{ id: string; email: string } | { error: string; status: number }> {
  if (!jwt) return { error: 'Sign in first.', status: 401 };
  const allowed = (env.ADMIN_EMAIL_SHA256 ?? '').split(',').map((s) => s.trim().toLowerCase()).filter((s) => /^[0-9a-f]{64}$/.test(s));
  if (!allowed.length || !env.SUPABASE_SERVICE_KEY) return { error: 'The dashboard is not switched on.', status: 503 };
  const who = await fetch(new URL('/auth/v1/user', env.SUPABASE_URL), {
    headers: { apikey: env.SUPABASE_ANON_KEY, authorization: `Bearer ${jwt}` },
  });
  if (!who.ok) return { error: 'Your sign-in has expired. Sign in again.', status: 401 };
  const u = (await who.json()) as { id?: unknown; email?: unknown; email_confirmed_at?: unknown };
  const id = String(u.id ?? '');
  const email = String(u.email ?? '').trim().toLowerCase();
  if (!UUID.test(id) || !email || !u.email_confirmed_at) return { error: 'Your sign-in has expired. Sign in again.', status: 401 };
  if (!allowed.includes(await sha256Hex(email))) return { error: 'This account is not an admin.', status: 403 };
  return { id, email };
}

async function db(env: AdminEnv, fn: string, args: Record<string, unknown> = {}): Promise<Response> {
  const res = await fetch(new URL(`/rest/v1/rpc/${fn}`, env.SUPABASE_URL), {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_ANON_KEY,
      authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify(args),
  });
  const text = await res.text();
  if (!res.ok) {
    console.error(`admin ${fn}: database ${res.status}`);
    return refuse('The database refused. Nothing was changed.', 502);
  }
  let out: unknown = null;
  try { out = JSON.parse(text); } catch { /* an empty answer */ }
  // The writes answer {error} for a request they will not make; say it as a 400.
  if (out && typeof out === 'object' && 'error' in (out as Record<string, unknown>)) return reply(out, 400);
  return reply(out);
}

async function body(request: Request): Promise<Record<string, unknown>> {
  try {
    const b = await request.json();
    return b && typeof b === 'object' ? (b as Record<string, unknown>) : {};
  } catch { return {}; }
}

const int = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) ? v : typeof v === 'string' && /^-?\d+$/.test(v) ? Number(v) : null);

export async function admin(request: Request, env: AdminEnv, jwt: string | null, path: string): Promise<Response> {
  const who = await whoIsAdmin(env, jwt);
  if ('error' in who) return refuse(who.error, who.status);
  const url = new URL(request.url);
  const route = path.slice('/api/admin/'.length);
  const get = request.method === 'GET';
  const post = request.method === 'POST';

  if (get && route === 'me') return reply({ admin: true, email: who.email });
  if (get && route === 'overview') return db(env, 'admin_overview');
  if (get && route === 'users') {
    const q = (url.searchParams.get('q') ?? '').trim().slice(0, 80);
    const offset = Math.max(0, int(url.searchParams.get('offset')) ?? 0);
    return db(env, 'admin_users', { p_q: q || null, p_limit: 50, p_offset: offset });
  }
  if (get && route === 'user') {
    const id = url.searchParams.get('id') ?? '';
    if (!UUID.test(id)) return refuse('No such account.', 404);
    return db(env, 'admin_user', { p_user: id });
  }
  if (get && route === 'picks') return db(env, 'admin_picks');
  if (get && route === 'plans') return db(env, 'admin_plans');
  if (get && route === 'promos') return db(env, 'admin_promos');
  if (get && route === 'log') return db(env, 'admin_log_list', { p_limit: 100 });

  if (post && route === 'grant') {
    const b = await body(request);
    const user = String(b['user'] ?? '');
    const days = int(b['days']);
    if (!UUID.test(user) || days === null) return refuse('Pick an account and a number of days.', 400);
    return db(env, 'admin_grant', { p_actor: who.id, p_user: user, p_days: days });
  }
  if (post && route === 'end') {
    const b = await body(request);
    const user = String(b['user'] ?? '');
    if (!UUID.test(user)) return refuse('No such account.', 404);
    return db(env, 'admin_end', { p_actor: who.id, p_user: user });
  }
  if (post && route === 'plan') {
    const b = await body(request);
    const id = String(b['id'] ?? '');
    if (!/^[a-z0-9_-]{1,40}$/.test(id)) return refuse('No such plan.', 404);
    const active = b['active'] === undefined ? null : b['active'] ? 1 : 0;
    return db(env, 'admin_save_plan', {
      p_actor: who.id, p_id: id,
      p_name: typeof b['name'] === 'string' ? b['name'] : null,
      p_amount: int(b['amount_minor']),
      p_active: active,
    });
  }
  if (post && route === 'promo') {
    const b = await body(request);
    // Only the fields the function reads, as strings or numbers; it checks each.
    const keys = ['id', 'kind', 'title', 'body', 'cta', 'plan_id', 'price_minor', 'trial_days', 'audience', 'starts_at', 'ends_at', 'active'];
    // Whole numbers only: the function casts these, and "9.99" would reach it
    // as a database error rather than a sentence.
    const whole = new Set(['price_minor', 'trial_days', 'starts_at', 'ends_at']);
    const p: Record<string, string | number | null> = {};
    for (const k of keys) {
      const v = b[k];
      if (v === undefined || v === null || v === '') continue;
      if (whole.has(k)) {
        const n = int(v);
        if (n === null) return refuse('Prices in pence and days as whole numbers, dates as times.', 400);
        p[k] = n;
      } else if (typeof v === 'string') p[k] = v.slice(0, 400);
      else if (typeof v === 'number' && Number.isFinite(v)) p[k] = v;
      else if (typeof v === 'boolean') p[k] = v ? 1 : 0;
    }
    if (p['id'] !== undefined && !/^[a-z0-9_-]{1,40}$/i.test(String(p['id']))) return refuse('No such offer.', 404);
    return db(env, 'admin_save_promo', { p_actor: who.id, p });
  }
  return refuse('Not found.', 404);
}
