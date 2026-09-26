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
import { createWhopCheckout, parseWhop, verifyWhop, whopAccountId, whopPeriodEnd } from './whop.ts';

export interface PayEnv {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  SUPABASE_SERVICE_KEY?: string;
  /**
   * Which processor is live: 'whop' or 'coinflow'. Whop runs its own checkout
   * and billing, so with it the checkout route hands back the plan's own
   * checkout link and the webhook grants entitlements by email.
   */
  PAY_PROVIDER?: string;
  WHOP_WEBHOOK_SECRET?: string;
  /** Secret. Creates the checkout configurations; never sent to a browser. */
  WHOP_API_KEY?: string;
  /** Public. The Whop business the plans are made under (`biz_...`). */
  WHOP_COMPANY_ID?: string;
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

/** Which processor is live. Whop needs only its webhook secret; the checkout
 *  links live on the plan rows. */
export const provider = (env: PayEnv): 'whop' | 'coinflow' =>
  (env.PAY_PROVIDER ?? '').toLowerCase() === 'whop' ? 'whop' : 'coinflow';

/** Whether there is a processor to talk to at all. */
export const paymentsConfigured = (env: PayEnv): boolean =>
  provider(env) === 'whop' ? Boolean(env.WHOP_WEBHOOK_SECRET) : Boolean(env.COINFLOW_API_KEY);

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
    new URL(`/rest/v1/plan?id=eq.${encodeURIComponent(planId)}&active=eq.1&select=id,name,amount_minor,currency,days,checkout_url`, env.SUPABASE_URL),
    { headers: { apikey: env.SUPABASE_ANON_KEY, authorization: `Bearer ${env.SUPABASE_ANON_KEY}`, accept: 'application/json' } },
  );
  const plans = rows.ok ? await rows.json() as any[] : [];
  const plan = plans[0];
  if (!plan) return json({ error: 'That plan is not available.' }, 404);

  if (provider(env) === 'whop') {
    const site = env.SITE_URL ?? new URL(request.url).origin;
    // The card form on our own page: a checkout configuration made here, with
    // the price from our plan row and the account id as metadata, which the
    // page hands to Whop's Checkout element.
    const companyId = env.WHOP_API_KEY ? (env.WHOP_COMPANY_ID || (await whopAccountId(env.WHOP_API_KEY)).id) : null;
    if (env.WHOP_API_KEY && companyId) {
      try {
        const made = await createWhopCheckout(env.WHOP_API_KEY, {
          companyId,
          plan: {
            id: String(plan.id),
            name: String(plan.name ?? plan.id),
            amountMinor: Number(plan.amount_minor),
            currency: String(plan.currency),
            days: Number(plan.days),
            // A matchday pass is a week and stops; the others renew until cancelled.
            renews: String(plan.id) !== 'matchday',
          },
          user: { id: user.id, email: user.email },
          returnUrl: `${site}/#/account?paid=1`,
        });
        return json({ checkout: made.id, link: made.link, returnUrl: `${site}/#/account?paid=1` });
      } catch (err) {
        console.error('whop checkout:', err instanceof Error ? err.message : String(err));
        if (!plan.checkout_url) return json({ error: 'The payment page could not be opened. Nothing has been charged. Try again in a minute.' }, 502);
      }
    }
    // No API key yet: the plan's own Whop checkout link, with the email on it
    // so the webhook can find the account.
    if (typeof plan.checkout_url !== 'string' || !plan.checkout_url) {
      return json({ error: 'That plan has no checkout yet.' }, 503);
    }
    const link = new URL(plan.checkout_url);
    if (user.email) link.searchParams.set('email', user.email);
    return json({ link: link.toString() });
  }

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
  if (provider(env) === 'whop') return whopWebhook(raw, request.headers, env);

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

/* ------------------------------------------------------------ Whop's webhook */

/**
 * Whop tells us a membership went valid, went invalid, or a payment landed.
 *
 * The plan is worked out from the delivery's plan reference against our plan
 * rows' checkout links, which carry Whop's plan ids; a delivery naming a plan
 * we do not sell falls back to the monthly one rather than being dropped,
 * because the money is real and a person is waiting.
 */
async function whopWebhook(raw: string, headers: Headers, env: PayEnv): Promise<Response> {
  const verdict = await verifyWhop(raw, headers, env.WHOP_WEBHOOK_SECRET ?? '');
  if (!verdict.ok) {
    await noteWebhook(env, { verified: false, why: verdict.why, type: eventTypeOf(raw) });
    return json({ error: verdict.why }, 401);
  }
  const res = await handleWhop(raw, verdict.via, env);
  let outcome: unknown = null;
  try { outcome = await res.clone().json(); } catch { /* not json */ }
  await noteWebhook(env, { verified: true, via: verdict.via, type: eventTypeOf(raw), status: res.status, outcome });
  return res;
}

const eventTypeOf = (raw: string): string | null => {
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    const t = o['type'] ?? o['action'] ?? o['event'];
    return typeof t === 'string' ? t.slice(0, 60) : null;
  } catch { return null; }
};

/**
 * The last delivery from Whop, kept so the status check can say whether Whop
 * is reaching the site and what came of it. The event type, whether the
 * signature held, and the outcome (applied or why not); never the payload,
 * which carries the buyer's details.
 */
async function noteWebhook(env: PayEnv, note: Record<string, unknown>): Promise<void> {
  if (!env.SUPABASE_SERVICE_KEY) return;
  const now = Math.floor(Date.now() / 1000);
  const o = note['outcome'] as Record<string, unknown> | null | undefined;
  const safe = { ...note, at: now, outcome: o ? { ok: o['ok'], applied: o['applied'], reason: o['reason'], ignored: o['ignored'], skipped: o['skipped'], error: o['error'] } : null };
  try {
    await fetch(new URL('/rest/v1/kv', env.SUPABASE_URL), {
      method: 'POST',
      headers: {
        apikey: env.SUPABASE_ANON_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
        'content-type': 'application/json', prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify({ k: 'pay:last_webhook', v: JSON.stringify(safe), updated_at: now }),
    });
  } catch { /* the delivery still gets its answer */ }
}

async function handleWhop(raw: string, via: string, env: PayEnv): Promise<Response> {
  const verdict = { via };

  let payload: unknown;
  try { payload = JSON.parse(raw); } catch { return json({ error: 'not json' }, 400); }
  const event = parseWhop(payload);
  if (event.kind === 'ignore') return json({ ok: true, ignored: event.eventType, via: verdict.via });
  // A checkout we made carries the account id: the entitlement goes to that
  // account's own email, whatever address the buyer typed into Whop's form.
  if (event.userId) {
    const own = await accountEmail(env, event.userId);
    if (own) event.email = own;
  }
  if (!event.email) {
    console.error('whop: event with no email', event.eventType, event.membershipId ?? event.paymentId);
    return json({ ok: true, skipped: 'no email' });
  }

  if (event.kind === 'invalid') {
    const out = await rpcAsService(env, 'revoke_entitlement', { p_email: event.email, p_status: event.eventType });
    return json({ ok: true, ...(out ?? {}) });
  }

  // A payment names its membership but not when the period ends; ask Whop, so
  // the payment and the membership event set the same date rather than two.
  if (event.kind === 'paid' && event.periodEnd === null && event.membershipId && env.WHOP_API_KEY) {
    event.periodEnd = await whopPeriodEnd(env.WHOP_API_KEY, event.membershipId);
  }
  const planId = event.ourPlan && /^[a-z0-9_-]{1,40}$/.test(event.ourPlan) ? event.ourPlan : await planForWhop(env, event.planRef);
  const out = await rpcAsService(env, 'record_entitlement', {
    p_source: 'whop',
    // A payment id when there is one, else the membership id plus the period
    // end, so each renewal is its own receipt and a retried delivery is not.
    p_ref: event.paymentId ?? (event.membershipId ? `${event.membershipId}:${event.periodEnd ?? 'open'}` : null),
    p_email: event.email,
    p_plan: planId,
    p_expires: event.periodEnd,
    p_amount: event.amountMinor,
    p_currency: event.currency ?? 'GBP',
    p_raw: raw.slice(0, 20_000),
    p_manage_url: event.manageUrl,
  });
  if (out && out.applied === false) console.error('whop: not applied —', out.reason, event.email);
  return json({ ok: true, via: verdict.via, ...(out ?? {}) });
}

/** The sign-in email of an account, asked of GoTrue with the service key. */
async function accountEmail(env: PayEnv, userId: string): Promise<string | null> {
  if (!env.SUPABASE_SERVICE_KEY) return null;
  const res = await fetch(new URL(`/auth/v1/admin/users/${userId}`, env.SUPABASE_URL), {
    headers: { apikey: env.SUPABASE_SERVICE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}` },
  });
  if (!res.ok) return null;
  const u = await res.json() as { email?: unknown };
  return typeof u.email === 'string' && u.email ? u.email.toLowerCase() : null;
}

/** Our plan id for Whop's, matched on the checkout link the plan row carries. */
async function planForWhop(env: PayEnv, planRef: string | null): Promise<string> {
  if (!planRef) return 'monthly';
  const res = await fetch(
    new URL('/rest/v1/plan?active=eq.1&select=id,checkout_url', env.SUPABASE_URL),
    { headers: { apikey: env.SUPABASE_ANON_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_KEY ?? env.SUPABASE_ANON_KEY}`, accept: 'application/json' } },
  );
  const plans = res.ok ? await res.json() as Array<{ id: string; checkout_url: string | null }> : [];
  const hit = plans.find((p) => typeof p.checkout_url === 'string' && p.checkout_url.includes(planRef));
  return hit?.id ?? 'monthly';
}

/* ---------------------------------------------------------------- status */

/**
 * Whether payments are wired up, without saying anything secret: which
 * secrets are present, whether Whop accepts the key, and the business id
 * (public, it is in every Whop checkout link).
 */
export async function payStatus(env: PayEnv): Promise<Response> {
  const whop = env.WHOP_API_KEY ? await whopAccountId(env.WHOP_API_KEY) : { id: null, status: 0 };
  return json({
    provider: provider(env),
    whop: {
      api_key: Boolean(env.WHOP_API_KEY),
      api_key_accepted: whop.status === 200,
      api_key_status: whop.status || null,
      business: env.WHOP_COMPANY_ID || whop.id,
      webhook_secret: Boolean(env.WHOP_WEBHOOK_SECRET),
      webhook_secret_format: env.WHOP_WEBHOOK_SECRET ? (env.WHOP_WEBHOOK_SECRET.startsWith('ws_') ? 'ws_' : env.WHOP_WEBHOOK_SECRET.startsWith('whsec_') ? 'whsec_' : 'other') : null,
    },
    service_key: Boolean(env.SUPABASE_SERVICE_KEY),
    last_webhook: await lastWebhook(env),
  });
}

async function lastWebhook(env: PayEnv): Promise<unknown> {
  if (!env.SUPABASE_SERVICE_KEY) return null;
  try {
    const res = await fetch(new URL('/rest/v1/kv?k=eq.pay:last_webhook&select=v', env.SUPABASE_URL), {
      headers: { apikey: env.SUPABASE_ANON_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`, accept: 'application/json' },
    });
    const rows = res.ok ? await res.json() as Array<{ v: string }> : [];
    return rows[0] ? JSON.parse(rows[0].v) : null;
  } catch { return null; }
}
