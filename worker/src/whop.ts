/**
 * Whop, behind the same small interface as Coinflow.
 *
 * Whop is a different shape of processor. It runs the checkout, the account
 * and the recurring billing on its own site, under whatever email the buyer
 * uses there, and tells us what happened by webhook. So there is no checkout
 * API to call -- each pricing plan in the Whop dashboard has a checkout link,
 * and that link lives on our `plan` row -- and no card to charge on renewal,
 * because Whop charges it. What is left for this file is the webhook: prove
 * it came from Whop, work out whose entitlement changed and to what, and hand
 * that to the database.
 *
 * Attribution is by email. Whop's events carry the buying user's email; we
 * grant an entitlement to that address, and has_membership() honours it once
 * somebody signs in here with the same address. The pricing page says so.
 *
 * Two signature schemes are accepted, because Whop's webhook signing has been
 * documented both ways and the dashboard does not say which a given endpoint
 * uses:
 *
 *   Standard Webhooks -- headers `webhook-id`, `webhook-timestamp`,
 *   `webhook-signature: v1,<base64>`; HMAC-SHA256 over
 *   `${id}.${timestamp}.${body}` with the secret after its `whsec_` prefix,
 *   base64-decoded.
 *
 *   A plain digest -- header `x-whop-signature` (or `whop-signature`), hex
 *   HMAC-SHA256 over the raw body with the secret as given.
 *
 * Either is checked in constant time against the raw body, and the verdict
 * says which one matched so the log shows what Whop actually sends. The
 * timestamp scheme also gets a replay window.
 */

import { MAX_SKEW_SECONDS, safeEqual } from './webhook.ts';

export type WhopVerdict =
  | { ok: true; via: 'standard-webhooks' | 'digest' }
  | { ok: false; why: 'no-secret' | 'no-proof' | 'malformed' | 'stale' | 'bad-signature' };

const enc = new TextEncoder();

async function hmacRaw(keyBytes: Uint8Array, message: string): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', key, enc.encode(message));
}
const hex = (buf: ArrayBuffer): string => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const b64 = (buf: ArrayBuffer): string => btoa(String.fromCharCode(...new Uint8Array(buf)));
const fromB64 = (s: string): Uint8Array => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export async function verifyWhop(
  rawBody: string,
  headers: Headers,
  secret: string,
  now: number = Math.floor(Date.now() / 1000),
): Promise<WhopVerdict> {
  if (!secret) return { ok: false, why: 'no-secret' };

  const id = headers.get('webhook-id');
  const ts = headers.get('webhook-timestamp');
  const sigs = headers.get('webhook-signature');
  if (id && ts && sigs) {
    const t = Number(ts);
    if (!Number.isFinite(t) || t <= 0) return { ok: false, why: 'malformed' };
    if (Math.abs(now - t) > MAX_SKEW_SECONDS) return { ok: false, why: 'stale' };
    // The secret is `whsec_<base64>`; a secret without the prefix is taken as
    // base64 already, and one that will not decode is used as raw bytes.
    const bare = secret.startsWith('whsec_') ? secret.slice(6) : secret;
    let keyBytes: Uint8Array;
    try { keyBytes = fromB64(bare); } catch { keyBytes = enc.encode(secret); }
    const expected = b64(await hmacRaw(keyBytes, `${id}.${t}.${rawBody}`));
    // The header may carry several space-separated `v1,<sig>` entries during a
    // secret rotation; any one matching is enough.
    for (const entry of sigs.split(/\s+/)) {
      const [version, sig] = entry.split(',');
      if (version !== 'v1' || !sig) continue;
      if (safeEqual(sig, expected)) return { ok: true, via: 'standard-webhooks' };
    }
    return { ok: false, why: 'bad-signature' };
  }

  const digest = headers.get('x-whop-signature') ?? headers.get('whop-signature');
  if (digest) {
    const expected = hex(await hmacRaw(enc.encode(secret), rawBody));
    const given = digest.trim().replace(/^sha256=/i, '').toLowerCase();
    return safeEqual(given, expected) ? { ok: true, via: 'digest' } : { ok: false, why: 'bad-signature' };
  }

  return { ok: false, why: 'no-proof' };
}

/* --------------------------------------------------------------- the event */

/** What the route needs out of a delivery, whatever Whop calls it. */
export interface WhopEvent {
  kind: 'valid' | 'invalid' | 'paid' | 'ignore';
  eventType: string;
  email: string | null;
  /** Whop's membership id, the stable reference for one buyer's subscription. */
  membershipId: string | null;
  paymentId: string | null;
  /** Whop's plan id, mapped to ours through `plan.checkout_url`. */
  planRef: string | null;
  /** When the current period ends, as Whop states it. */
  periodEnd: number | null;
  amountMinor: number | null;
  currency: string | null;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const num = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() && Number.isFinite(Number(v))) return Number(v);
  return null;
};
const rec = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const first = (...vals: unknown[]): unknown => vals.find((v) => v !== undefined && v !== null && v !== '');

/** A date Whop states as ISO text or as epoch seconds or milliseconds. */
function epoch(v: unknown): number | null {
  const n = num(v);
  if (n !== null) return n > 1e12 ? Math.floor(n / 1000) : Math.floor(n);
  const s = str(v);
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? Math.floor(t / 1000) : null;
}

/**
 * Read a delivery.
 *
 * Whop's envelope is `{ action | type | event, data }`, and the interesting
 * events are memberships going valid or invalid and payments succeeding. The
 * data block is a membership or a payment; either may nest the user, the plan
 * and the other object under its own key. Every plausible spelling is read
 * and an absent field is reported absent, never guessed.
 */
export function parseWhop(payload: unknown): WhopEvent {
  const root = rec(payload) ?? {};
  const eventType = str(first(root['action'], root['type'], root['event'])) ?? 'unknown';
  const data = rec(root['data']) ?? root;
  const membership = rec(data['membership']) ?? (str(data['id'])?.startsWith('mem_') ? data : null);
  const payment = rec(data['payment']) ?? (str(data['id'])?.startsWith('pay_') ? data : null);
  const user = rec(data['user']) ?? rec(membership?.['user']) ?? rec(payment?.['user']) ?? null;
  const plan = rec(data['plan']) ?? rec(membership?.['plan']) ?? rec(payment?.['plan']) ?? null;

  const t = eventType.toLowerCase();
  const kind: WhopEvent['kind'] =
    /membership[._]went[._]valid|membership[._]activated|membership[._]created/.test(t) ? 'valid'
    : /membership[._]went[._]invalid|membership[._]deactivated|membership[._]cancel|membership[._]expired|refund|chargeback|dispute/.test(t) ? 'invalid'
    : /payment[._]succeeded|payment[._]completed|payment[._]paid/.test(t) ? 'paid'
    : 'ignore';

  return {
    kind,
    eventType,
    email: str(first(user?.['email'], data['email'], data['user_email'], membership?.['email'], payment?.['email']))?.toLowerCase() ?? null,
    membershipId: str(first(membership?.['id'], data['membership_id'], data['membership'])) ?? null,
    paymentId: str(first(payment?.['id'], data['payment_id'], kind === 'paid' ? data['id'] : null)) ?? null,
    planRef: str(first(plan?.['id'], data['plan_id'], data['plan'])) ?? null,
    periodEnd: epoch(first(
      membership?.['renewal_period_end'], data['renewal_period_end'],
      membership?.['expires_at'], data['expires_at'],
      membership?.['current_period_end'], data['current_period_end'],
    )),
    amountMinor: (() => {
      // Whop states amounts in major units as a decimal ("9.00"); some
      // payloads carry cents under `amount_cents`/`subtotal_cents`.
      const cents = num(first(payment?.['amount_cents'], data['amount_cents'], payment?.['subtotal_cents']));
      if (cents !== null) return Math.round(cents);
      const major = num(first(payment?.['final_amount'], payment?.['amount'], payment?.['subtotal'], data['final_amount'], data['amount']));
      return major === null ? null : Math.round(major * 100);
    })(),
    currency: str(first(payment?.['currency'], data['currency']))?.toUpperCase() ?? null,
  };
}
