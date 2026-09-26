/**
 * offside.win — the read side.
 *
 * This Worker computes nothing. Every number it serves was produced by the
 * engine on GitHub Actions and written to Postgres as finished JSON, and every
 * endpoint here is one call to a STABLE function that returns the whole
 * response body as a single json value. The body is streamed through
 * untouched — never parsed, never rebuilt — which is what keeps a 300-fixture
 * board inside Cloudflare's free-tier budget of 10 ms of CPU per request.
 *
 * It holds no secret worth stealing. The provider key and the database
 * credentials live in Actions; what ships here is Supabase's anon key, which is
 * public by design and is confined to reading by row-level security and
 * SELECT-only grants declared in schema.pg.sql. The site is public, so public
 * reads of the serving tables change nothing.
 *
 * Since memberships, one more thing passes through: a reader's own Supabase
 * JWT. It is still not verified here. It is swapped into the header this file
 * already sets on the PostgREST call, in place of the anon key, and Postgres
 * checks it -- which is what keeps a paywall inside a 10ms budget. The cost of
 * telling one reader from another is one header.
 */

import { bearer, jsonHeaders } from './http.ts';
import { checkout, renewal, webhook, type PayEnv } from './pay.ts';
import { deleteAccount } from './account.ts';

interface Env extends PayEnv {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  GOOGLE_CLIENT_ID?: string;
  ASSETS: Fetcher;
}

function fail(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

/**
 * Call one of the serving functions over PostgREST.
 *
 * GET rather than POST because every function is STABLE, which PostgREST
 * requires before it will accept one over GET, and which in turn lets
 * Cloudflare's cache do its job. Arguments are named exactly as the function
 * declares them; an omitted argument takes the function's default, which is how
 * `league` and `settled` express "no filter" without a second query.
 */
async function rpc(
  env: Env,
  fn: string,
  args: Record<string, string | number | undefined>,
  jwt: string | null = null,
): Promise<Response> {
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    return fail('database is not configured', 503);
  }

  const url = new URL(`/rest/v1/rpc/${fn}`, env.SUPABASE_URL);
  for (const [k, v] of Object.entries(args)) {
    if (v !== undefined) url.searchParams.set(k, String(v));
  }

  const res = await fetch(url, {
    headers: {
      // `apikey` stays the anon key -- it identifies the project, not the
      // caller. `authorization` is what says who is asking, and swapping a
      // reader's own token in there is the entire membership mechanism: the
      // serving functions are SECURITY INVOKER, so auth.uid() resolves and the
      // RLS policies do the rest.
      apikey: env.SUPABASE_ANON_KEY,
      authorization: `Bearer ${jwt ?? env.SUPABASE_ANON_KEY}`,
      accept: 'application/json',
    },
  });

  // An expired or malformed token should cost a reader their membership for one
  // request, not the page. Retrying as anonymous can only ever return less than
  // the token would have, so the failure mode is a board that looks signed-out
  // rather than a board that does not load.
  if ((res.status === 401 || res.status === 403) && jwt) {
    return rpc(env, fn, args, null);
  }

  if (!res.ok) {
    // PostgREST's own error body names the constraint or the missing function,
    // which is exactly what a reader debugging this needs and nothing an
    // attacker gains from — the schema is in a public repo.
    return fail(`database error (${res.status}): ${await res.text()}`, 502);
  }
  return res;
}

/** The common case: hand the database's bytes to the client unchanged. */
async function passthrough(
  env: Env,
  fn: string,
  args: Record<string, string | number | undefined>,
  jwt: string | null = null,
): Promise<Response> {
  const res = await rpc(env, fn, args, jwt);
  if (!res.ok) return res;
  return new Response(res.body, { headers: jsonHeaders(jwt !== null) });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // One address for readers. Sign-in sessions live in the browser per
    // address, so a reader split between workers.dev and offside.win would be
    // signed in on one and not the other. Pages move permanently; the API
    // keeps answering on both, because payment webhooks and already-open tabs
    // still call the old one. Cloudflare serves static files before this code
    // runs, so index.html does the same move itself; this catches the rest.
    if (!path.startsWith('/api/') && (url.hostname.endsWith('.workers.dev') || url.hostname.startsWith('www.')) && env.SITE_URL?.startsWith('https://')) {
      const to = new URL(url.pathname + url.search, env.SITE_URL);
      return Response.redirect(to.toString(), 301);
    }

    if (!path.startsWith('/api/')) {
      return env.ASSETS.fetch(request);
    }

    const jwt = bearer(request);

    try {
      if (path === '/api/config') return config(env);

      // Deleting an account: the reader's token names the account, GoTrue
      // vouches for it, and the service key does the removing. account.ts.
      if (path === '/api/account/delete') return await deleteAccount(request, env, jwt);

      // The write side. Kept together and kept POST-only: a payment route that
      // answers a GET is a payment route that can be triggered by a link.
      if (path.startsWith('/api/pay/') || path === '/api/account') {
        if (path === '/api/account') {
          return await passthrough(env, 'get_account', {}, jwt);
        }
        if (request.method !== 'POST') return fail('method not allowed', 405);
        if (path === '/api/pay/checkout') return await checkout(request, env, jwt);
        if (path === '/api/pay/renewal') return await renewal(request, env, jwt);
        if (path === '/api/pay/webhook') return await webhook(request, env);
        return fail('not found', 404);
      }
      // A page view, from a reader who accepted analytics. Anonymous by
      // construction: the reader's token is not forwarded, and only a page
      // kind from a fixed list is passed on.
      if (path === '/api/hit') return await hit(request, env);
      if (path === '/api/board') return await board(url, env, jwt);
      if (path.startsWith('/api/fixture/')) return await fixture(path, env, jwt);
      // A competition's page. The token goes with it because the fixtures
      // inside are walled exactly as the board is.
      // A player's page: scorers, recent reports, next games. Nothing walled.
      if (path.startsWith('/api/player/')) {
        const id = Number(path.slice('/api/player/'.length));
        if (!Number.isFinite(id)) return fail('bad player id', 400);
        const lg = Number(url.searchParams.get('league'));
        return await passthrough(env, 'get_player', { p_id: id, p_league: Number.isFinite(lg) && lg > 0 ? lg : undefined });
      }
      if (path.startsWith('/api/league/')) {
        const id = Number(path.slice('/api/league/'.length));
        if (!Number.isFinite(id)) return fail('bad league id', 400);
        return await passthrough(env, 'get_league', { p_id: id }, jwt);
      }
      if (path === '/api/picks') return await picks(url, env, jwt);
      if (path === '/api/model') return await passthrough(env, 'get_model', {});
      if (path === '/api/hero') return await passthrough(env, 'get_hero', {});
      if (path === '/api/health') return await passthrough(env, 'get_health', {});
      // The bet slip. The caller's token goes with it: the legs of an open
      // slip are members-only, and get_slip decides that from the token.
      if (path === '/api/slip') return await passthrough(env, 'get_slip', {}, jwt);
      if (path === '/api/plans') return await passthrough(env, 'get_plans', {});
      return fail('not found', 404);
    } catch (err) {
      return fail(err instanceof Error ? err.message : 'internal error', 500);
    }
  },
} satisfies ExportedHandler<Env>;

/**
 * What the browser needs to talk to Supabase Auth directly.
 *
 * Neither value is a secret. The anon key is Supabase's public client key and
 * already ships in this file's own environment; serving it here simply saves a
 * second substitution step in the deploy, and sign-in happens browser-to-GoTrue
 * without the Worker in the path at all.
 */
function config(env: Env): Response {
  return new Response(
    JSON.stringify({ supabaseUrl: env.SUPABASE_URL ?? '', anonKey: env.SUPABASE_ANON_KEY ?? '', googleClientId: env.GOOGLE_CLIENT_ID ?? '' }),
    {
      headers: {
        'content-type': 'application/json; charset=utf-8',
        // Same for everyone, but checked every time: an hour's cache kept
        // phones on a copy from before the Google client ID was added, and
        // the sign-in page fell back to the old Google flow without saying.
        'cache-control': 'public, no-cache',
      },
    },
  );
}

function board(url: URL, env: Env, jwt: string | null): Promise<Response> {
  const now = Math.floor(Date.now() / 1000);
  const hours = Math.min(240, Math.max(1, Number(url.searchParams.get('hours') ?? 72)));
  const league = Number(url.searchParams.get('league'));

  /*
   * How far back the board reaches.
   *
   * Six hours was enough to keep a match on the board while it was being
   * played and nothing more: by the evening, everything that kicked off at
   * lunchtime had vanished, so the page could say what was coming and could
   * not say what had happened. A day back means the board answers both
   * questions, which is what a board is for.
   */
  const back = Math.min(72, Math.max(6, Number(url.searchParams.get('back') ?? 24)));

  return passthrough(env, 'get_board', {
    p_from: now - back * 3600,
    p_to: now + hours * 3600,
    p_league: Number.isFinite(league) && league > 0 ? league : undefined,
  }, jwt);
}

async function fixture(path: string, env: Env, jwt: string | null): Promise<Response> {
  const id = Number(path.slice('/api/fixture/'.length));
  if (!Number.isFinite(id)) return fail('bad fixture id', 400);

  const res = await rpc(env, 'get_fixture', { p_id: id }, jwt);
  if (!res.ok) return res;

  // The one endpoint that cannot stream: an unknown id comes back as the four
  // bytes `null` with a 200, and the difference between that and a bundle is
  // the difference between 404 and 200. Compared as text rather than parsed —
  // a bundle is tens of kilobytes and reassembling it would cost more CPU than
  // the whole rest of the request.
  const text = await res.text();
  if (text === 'null' || text === '') return fail('fixture not found or not yet analysed', 404);
  return new Response(text, { headers: jsonHeaders(jwt !== null) });
}

function picks(url: URL, env: Env, jwt: string | null): Promise<Response> {
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit') ?? 60)));
  const settled = url.searchParams.get('settled');

  return passthrough(env, 'get_picks', {
    p_limit: limit,
    p_settled: settled === 'true' || settled === 'false' ? settled : undefined,
  }, jwt);
}


const PAGES = new Set(['home', 'board', 'fixture', 'league', 'leagues', 'results', 'slip',
  'pricing', 'signin', 'account', 'legal', 'player']);

/**
 * Count one page view. POST only, answered 204 whatever happens: a counter
 * that fails must never be something a reader notices. The body is sent with
 * navigator.sendBeacon, so it arrives as text.
 */
async function hit(request: Request, env: Env): Promise<Response> {
  const done = new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
  if (request.method !== 'POST') return fail('method not allowed', 405);
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) return done;
  let page = '';
  try { page = String((JSON.parse(await request.text()) as { p?: unknown }).p ?? ''); } catch { return done; }
  if (!PAGES.has(page)) return done;
  try {
    await fetch(new URL('/rest/v1/rpc/record_view', env.SUPABASE_URL), {
      method: 'POST',
      headers: {
        apikey: env.SUPABASE_ANON_KEY,
        authorization: `Bearer ${env.SUPABASE_ANON_KEY}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ p_page: page }),
    });
  } catch { /* a lost count is not worth an error */ }
  return done;
}
