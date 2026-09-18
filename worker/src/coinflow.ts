/**
 * Coinflow, behind one small interface.
 *
 * Card in, USDC out. Two calls are used: one to open a checkout, and one to
 * charge a card the reader has already authorised. Both take the same four
 * headers, and both are deliberately the only place in this codebase that knows
 * the processor's name -- if their answer on eligibility ever changes, what
 * needs rewriting is this file.
 *
 * The webhook parser below is written the way engine/src/history.ts reads the
 * football provider: alias lists, returning null on a miss rather than guessing
 * or zeroing. Their documentation gives the event names and the envelope shape
 * -- `{ eventType, category, created, data }`, amounts in cents -- but not which
 * field carries back the merchant's own user id. Rather than assume one, every
 * plausible spelling is tried and an absent id is reported as absent, so the
 * route can say so instead of attributing a payment to nobody.
 */

export interface CoinflowConfig {
  apiKey: string;
  /** api-sandbox.coinflow.cash until KYB is done, api.coinflow.cash after. */
  baseUrl: string;
  /** Where the USDC lands. Required on every call, even a read. */
  wallet: string;
  blockchain: string;
}

const headers = (cfg: CoinflowConfig, userId: string) => ({
  'content-type': 'application/json',
  authorization: cfg.apiKey,
  'x-coinflow-auth-user-id': userId,
  'x-coinflow-auth-wallet': cfg.wallet,
  'x-coinflow-auth-blockchain': cfg.blockchain,
});

async function call(cfg: CoinflowConfig, path: string, userId: string, body: unknown): Promise<any> {
  const res = await fetch(`${cfg.baseUrl}${path}`, {
    method: 'POST',
    headers: headers(cfg, userId),
    body: JSON.stringify(body),
    // Their five-second webhook budget is theirs; this is ours. A checkout that
    // hangs should fail while the reader is still looking at the button.
    signal: AbortSignal.timeout(12_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`coinflow ${res.status}: ${text.slice(0, 200)}`);
  try { return JSON.parse(text); } catch { throw new Error('coinflow returned a body that was not JSON'); }
}

/**
 * Open a checkout and get back a URL to send the reader to.
 *
 * The amount is passed in minor units and never comes from the browser -- the
 * caller reads it from the `plan` table first. `settlementType: 'USDC'` is what
 * makes the money arrive as stablecoin rather than as a bank transfer.
 */
export async function createCheckoutLink(cfg: CoinflowConfig, args: {
  userId: string;
  email: string | null;
  amountMinor: number;
  currency: string;
  returnUrl: string;
  planId: string;
}): Promise<string> {
  const out = await call(cfg, '/api/checkout/link', args.userId, {
    subtotal: { cents: args.amountMinor, currency: args.currency },
    email: args.email ?? undefined,
    settlementType: 'USDC',
    // Saves the card so the renewal job has something to charge. Without it a
    // subscription is a button someone has to remember to press.
    zeroAuthorizationConfig: { enabled: true },
    // A quote does not stay valid forever and neither should the page.
    expiresIn: 3600,
    standaloneLinkConfig: { callbackUrl: args.returnUrl },
    webhookInfo: { planId: args.planId, userId: args.userId },
  });

  const link = out?.link ?? out?.url;
  if (typeof link !== 'string' || !link) throw new Error('coinflow returned no checkout link');
  return link;
}

/**
 * Charge a card the reader has already authorised.
 *
 * `originalPaymentId` is not optional and not replaceable: the card networks
 * require a merchant-initiated charge to cite the customer-initiated one that
 * carried CVV and 3DS, and Coinflow enforce it -- "this endpoint can only be
 * used if the customer has once before authorized their card to be charged on
 * your platform."
 */
export async function chargeSavedCard(cfg: CoinflowConfig, args: {
  userId: string;
  originalPaymentId: string;
  amountMinor: number;
  currency: string;
}): Promise<string> {
  const out = await call(cfg, '/api/checkout/merchant-initiated-transaction', args.userId, {
    subtotal: { cents: args.amountMinor, currency: args.currency },
    originalPaymentId: args.originalPaymentId,
    statementDescriptor: 'offside.win',
  });

  const id = out?.paymentId ?? out?.id;
  if (typeof id !== 'string' || !id) throw new Error('coinflow returned no payment id');
  return id;
}

/* ------------------------------------------------------------- the webhook */

/** What the routes need out of a delivery, whatever the processor calls it. */
export interface WebhookEvent {
  kind: 'paid' | 'reversed' | 'ignore';
  eventType: string;
  /** Our own user id, if it came back. Null means we cannot attribute it. */
  userId: string | null;
  paymentId: string | null;
  planId: string | null;
  amountMinor: number | null;
  currency: string;
  brand: string | null;
  last4: string | null;
}

/** Depth-first search for the first key that is present and not empty. */
function pick(source: unknown, names: readonly string[], depth = 0): unknown {
  if (depth > 4 || source === null || typeof source !== 'object') return undefined;
  const obj = source as Record<string, unknown>;
  for (const n of names) {
    const v = obj[n];
    if (v !== undefined && v !== null && v !== '') return v;
  }
  for (const v of Object.values(obj)) {
    const found = pick(v, names, depth + 1);
    if (found !== undefined) return found;
  }
  return undefined;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

/**
 * Which events mean money moved, and which way.
 *
 * Anything unrecognised is `ignore` rather than an error: the processor
 * publishes twenty-eight event types and will add more, and a route that 500s
 * on an event it does not care about earns sixteen retries of the same.
 */
function classify(eventType: string): WebhookEvent['kind'] {
  const e = eventType.toLowerCase();
  if (/(charge\s*back|chargeback|refund|dispute)/.test(e)) return 'reversed';
  if (/(settled|authorized|succeeded|payment\s*success|usdc payment received)/.test(e)) return 'paid';
  return 'ignore';
}

export function parseWebhook(payload: unknown): WebhookEvent {
  const root = (payload ?? {}) as Record<string, unknown>;
  const eventType = str(root['eventType'] ?? root['type'] ?? root['event']) ?? '';
  const data = root['data'] ?? root;

  const cents = pick(data, ['cents', 'amount', 'subtotal', 'total']);
  const amount = typeof cents === 'number' ? Math.round(cents)
    : typeof cents === 'object' && cents !== null ? (() => {
        const inner = pick(cents, ['cents', 'amount']);
        return typeof inner === 'number' ? Math.round(inner) : null;
      })()
    : null;

  return {
    kind: classify(eventType),
    eventType,
    // Every spelling their docs and SDKs use for the merchant's own id, plus
    // the two we send ourselves in webhookInfo. Absent is reported as absent.
    userId: str(pick(data, ['userId', 'user_id', 'externalUserId', 'merchantUserId', 'customerId'])),
    paymentId: str(pick(data, ['paymentId', 'payment_id', 'id', 'transactionId'])),
    planId: str(pick(data, ['planId', 'plan_id'])),
    amountMinor: amount,
    currency: str(pick(data, ['currency']))?.toUpperCase() ?? 'GBP',
    brand: str(pick(data, ['brand', 'cardBrand', 'network'])),
    last4: str(pick(data, ['last4', 'lastFour', 'last_four'])),
  };
}
