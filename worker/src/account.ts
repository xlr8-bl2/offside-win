/**
 * Deleting an account, from the account page.
 *
 * The one account write that cannot be a database function called with the
 * reader's own token: removing the sign-in itself needs Supabase's admin API,
 * which takes the service key. So the order is strict and each step gates the
 * next --
 *
 *   1. Ask GoTrue who the token belongs to. The Worker does not verify JWTs
 *      itself; GoTrue does, and an expired or forged token stops here.
 *   2. Stop any Whop subscription renewing, or stop here: it would carry on
 *      charging an account that no longer exists.
 *   3. Remove what we hold about that id (delete_account_data: profile,
 *      follows, stored card reference, membership, the Whop entitlement and
 *      the email on it). Payment records stay,
 *      because tax law requires them and the privacy policy says so.
 *   4. Remove the sign-in, so the email can no longer log in to anything.
 *
 * The id comes only from step 1, never from the request body, so nobody can
 * name someone else's account to delete.
 */

import { provider, stopRenewals, type PayEnv } from './pay.ts';

interface Env extends PayEnv {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
}

function say(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function deleteAccount(request: Request, env: Env, jwt: string | null): Promise<Response> {
  if (request.method !== 'POST') return say('method not allowed', 405);
  if (!jwt) return say('Sign in first.', 401);
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) return say('The database is not configured.', 503);
  if (!env.SUPABASE_SERVICE_KEY) {
    return say('Deleting an account from the site is not switched on yet. Write to support@offside.win and it will be done by hand.', 503);
  }

  const who = await fetch(new URL('/auth/v1/user', env.SUPABASE_URL), {
    headers: { apikey: env.SUPABASE_ANON_KEY, authorization: `Bearer ${jwt}` },
  });
  if (!who.ok) return say('Your sign-in has expired. Sign in again, then delete the account.', 401);
  const me = (await who.json()) as { id?: unknown; email?: unknown };
  const id = String(me.id ?? '');
  const email = typeof me.email === 'string' && me.email ? me.email.toLowerCase() : null;
  if (!UUID.test(id)) return say('Your sign-in has expired. Sign in again, then delete the account.', 401);

  // A Whop subscription bills whether or not the account exists, so it is
  // stopped before anything is removed. Deleting first left members paying
  // every month for a membership they could no longer sign in to.
  if (provider(env) === 'whop' && env.WHOP_API_KEY && !(await stopRenewals(env, { id, email }))) {
    return say('Nothing was deleted: your membership with Whop could not be stopped just now, and deleting would leave it charging. Try again in a minute.', 503);
  }

  const admin = { apikey: env.SUPABASE_SERVICE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}` };
  const data = await fetch(new URL('/rest/v1/rpc/delete_account_data', env.SUPABASE_URL), {
    method: 'POST',
    headers: { ...admin, 'content-type': 'application/json' },
    body: JSON.stringify({ p_user: id, p_email: email }),
  });
  if (!data.ok) return say('Nothing was deleted: the database refused. Try again in a minute.', 502);

  const gone = await fetch(new URL(`/auth/v1/admin/users/${id}`, env.SUPABASE_URL), { method: 'DELETE', headers: admin });
  // A 404 means the sign-in was already gone, which is the outcome asked for.
  if (!gone.ok && gone.status !== 404) {
    return say('Your details were removed but the sign-in was not. Try again, or write to support@offside.win.', 502);
  }
  return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
}
