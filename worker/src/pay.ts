/**
 * The three routes that are not reads.
 *
 * Everything else in this Worker is a GET that streams a STABLE function's
 * bytes through without parsing. These write, so they are kept apart rather
 * than bolted onto `rpc()`, and each one is small enough to read in full.
 *
 * The service key appears here and nowhere else. It bypasses row-level security
 * entirely, which is precisely why the only things it is ever pointed at are
 * two functions that take named arguments and do one job each. The alternative
 * -- letting the webhook write tables directly -- would mean any mistake in
 * this file is a mistake against the whole database.
 */

import { createCheckoutLink, parseWebhook, type CoinflowConfig } from './coinflow.ts';
import { verifyWebhook } from './webhook.ts';

export interface PayEnv {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  SUPABASE_SERVICE_KEY?: string;
  COINFLOW_API_KEY?: string;
  COINFLOW_WEBHOOK_SECRET?: string;
  COINFLOW_BASE_URL?: string;
  COINFLOW_WALLET?: string;
  COINFLOW_BLOCKCHAIN?: string;
  SITE_URL?: string;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'private, no-store' },
  });

/**
 * Call one of the two write functions as the service role.
 *
 * Service-role only, deliberately: nothing else in this file needs it, and a
 * parameter offering a weaker mode is a parameter somebody eventually passes by
 * mistake. Reads go through the Worker's ordinary path with the reader's own
 * token; this exists for the webhook, which has no reader.
 */
async function rpcAsService(env: PayEnv, fn: string, args: Record<string, unknown>) {
  if (!env.SUPABASE_SERVICE_KEY) throw new Error('no service credentials configured');

  const res = await fetch(new URL(`/rest/v1/rpc/${fn}`, env.SUPABASE_URL), {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_ANON_KEY,
      authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(args),
  });

  const text = await res.text();
  if (!res.ok) throw new Error(`database ${res.status}: ${text.slice(0, 200)}`);
  try { return JSON.parse(text); } catch { return null; }
}

/** Whether there is a processor to talk to at all. */
export const paymentsConfigured = (env: PayEnv): boolean => Boolean(env.COINFLOW_API_KEY);

function coinflow(env: PayEnv): CoinflowConfig {
  if (!env.COINFLOW_API_KEY) throw new Error('payments are not configured');
  return {
    apiKey: env.COINFLOW_API_KEY,
    baseUrl: env.COINFLOW_BASE_URL ?? 'https://api-sandbox.coinflow.cash',
    wallet: env.COINFLOW_WALLET ?? '',
    blockchain: env.COINFLOW_BLOCKCHAIN ?? 'solana',
  };
}

/**
 * Who is asking, according to Supabase.
 *
 * The Worker never decodes a JWT itself. It asks the issuer, so a forged token
 * gets the answer "nobody" rather than whatever the forger wrote inside it.
 * That is one extra round trip, on a route that runs when somebody presses a
 * button rather than on every board request, which is why it is affordable here
 * and would not be on the read path.
 */
export async function identify(env: PayEnv, jwt: string | null): Promise<{ id: string; email: string | null } | null> {
  if (!jwt) return null;
  const res = await fetch(new URL('/auth/v1/user', env.SUPABASE_URL), {
    headers: { apikey: env.SUPABASE_ANON_KEY, authorization: `Bearer ${jwt}` },
  });
  if (!res.ok) return null;
  const user = await res.json() as { id?: string; email?: string };
  return user.id ? { id: user.id, email: user.email ?? null } : null;
}

/* ------------------------------------------------------------- the checkout */

/**
 * Open a checkout for the signed-in reader.
 *
 * The body names a plan. It never names a price: the amount is read from the
 * `plan` table on this side, so a client asking to pay a penny is quoted nine
 * pounds like everybody else.
 */
export async function checkout(request: Request, env: PayEnv, jwt: string | null): Promise<Response> {
  // There is a real window where the code is deployed and the merchant account
  // is not. Saying so plainly beats a 500 that reads like the site is broken.
  if (!paymentsConfigured(env)) {
    return json({ error: 'Memberships are not open yet. Nothing has been charged.' }, 503);
  }

  const user = await identify(env, jwt);
  if (!user) return json({ error: 'Sign in first.' }, 401);

  let planId = 'monthly';
  try {
    const body = await request.json() as { plan?: unknown };
    if (typeof body?.plan === 'string' && body.plan) planId = body.plan;
  } catch { /* an empty body means the default plan */ }

  const rows = await fetch(
    new URL(`/rest/v1/plan?id=eq.${encodeURIComponent(planId)}&active=eq.1&select=id,amount_minor,currency,days`, env.SUPABASE_URL),
    { headers: { apikey: env.SUPABASE_ANON_KEY, authorization: `Bearer ${env.SUPABASE_ANON_KEY}`, accept: 'application/json' } },
  );
  const plans = rows.ok ? await rows.json() as any[] : [];
  const plan = plans[0];
  if (!plan) return json({ error: 'That plan is not available.' }, 404);

  const site = env.SITE_URL ?? new URL(request.url).origin;
  const link = await createCheckoutLink(coinflow(env), {
    userId: user.id,
    email: user.email,
    amountMinor: Number(plan.amount_minor),
    currency: String(plan.currency),
    planId: String(plan.id),
    returnUrl: `${site}/#/account`,
  });

  return json({ link });
}

/* -------------------------------------------------------------- the renewal */

/**
 * Turn renewal on or off.
 *
 * Done with the reader's own token rather than the service key, because
 * Postgres already enforces exactly the right thing: a policy picks the row and
 * a column-scoped grant picks the field, so the worst a forged request achieves
 * is updating nobody.
 */
export async function renewal(request: Request, env: PayEnv, jwt: string | null): Promise<Response> {
  if (!jwt) return json({ error: 'Sign in first.' }, 401);

  let on = false;
  try {
    const body = await request.json() as { auto_renew?: unknown };
    on = body?.auto_renew === true;
  } catch { /* default off, which is the safe direction */ }

  const now = Math.floor(Date.now() / 1000);
  const res = await fetch(new URL('/rest/v1/membership', env.SUPABASE_URL), {
    method: 'PATCH',
    headers: {
      apikey: env.SUPABASE_ANON_KEY,
      authorization: `Bearer ${jwt}`,
      'content-type': 'application/json',
      prefer: 'return=minimal',
    },
    body: JSON.stringify({ auto_renew: on ? 1 : 0, cancelled_at: on ? null : now, updated_at: now }),
  });

  if (!res.ok) return json({ error: 'Could not change that just now.' }, 502);
  return json({ auto_renew: on });
}

/* -------------------------------------------------------------- the webhook */

/**
 * The only unauthenticated route on the site, and the one that grants access.
 *
 * Answer within five seconds or the processor retries, up to sixteen times over
 * eighteen hours. So: verify, one round trip, 200. A delivery that is genuine
 * but unusable still gets a 200 -- retrying it would not make it any more
 * usable, and sixteen copies of the same complaint in the log is worse than
 * one.
 */
export async function webhook(request: Request, env: PayEnv): Promise<Response> {
  const raw = await request.text();

  const verdict = await verifyWebhook(raw, request.headers, env.COINFLOW_WEBHOOK_SECRET ?? '');
  if (!verdict.ok) {
    // 401 rather than 200: this one really should be retried, and if it is us
    // that is misconfigured we want it to keep knocking.
    return json({ error: verdict.why }, 401);
  }

  let payload: unknown;
  try { payload = JSON.parse(raw); } catch { return json({ error: 'not json' }, 400); }

  const event = parseWebhook(payload);
  if (event.kind === 'ignore') return json({ ok: true, ignored: event.eventType });

  if (!event.paymentId) return json({ ok: true, skipped: 'no payment id' });

  if (event.kind === 'reversed') {
    const out = await rpcAsService(env, 'revoke_membership', {
      p_provider: 'coinflow', p_ref: event.paymentId, p_status: event.eventType,
    });
    return json({ ok: true, ...(out ?? {}) });
  }

  if (!event.userId) {
    // Attribution failed. Recording a payment against nobody would be worse
    // than saying so -- the money is real and needs a person found for it.
    console.error('coinflow: paid event with no user id', event.eventType, event.paymentId);
    return json({ ok: true, skipped: 'unattributed' });
  }

  const out = await rpcAsService(env, 'record_payment', {
    p_provider: 'coinflow',
    p_ref: event.paymentId,
    p_user: event.userId,
    p_plan: event.planId ?? 'monthly',
    p_amount: event.amountMinor ?? 0,
    p_currency: event.currency,
    p_status: 'paid',
    p_raw: raw.slice(0, 20_000),
    p_origin_ref: event.paymentId,
    p_brand: event.brand,
    p_last4: event.last4,
  });

  if (out && out.applied === false) console.error('coinflow: not applied —', out.reason, event.paymentId);
  return json({ ok: true, ...(out ?? {}) });
}
