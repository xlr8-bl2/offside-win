/**
 * Deciding whether a webhook really came from the processor.
 *
 * This is the only unauthenticated route on the site, and what it does on
 * success is grant somebody a paid membership. Everything here is written on
 * the assumption that the caller is hostile until proven otherwise.
 *
 * Coinflow offers two ways to prove it. A signature -- `Coinflow-Signature:
 * t=<unix>,v1=<hex>`, HMAC-SHA256 over `${t}.${rawBody}` -- and, as their
 * fallback for hosts that rewrite headers, an `Authorization` header holding
 * the validation key outright. The signature is preferred because it covers the
 * body: a bearer token proves the sender knew a secret, while a signature also
 * proves the payload has not been edited on the way.
 *
 * Three details that are easy to get wrong and expensive to get wrong:
 *
 *   THE RAW BODY. The signature is over the bytes as sent. Parsing the JSON and
 *   re-serialising it changes key order and whitespace, and the signature then
 *   never matches for reasons that look like a platform bug.
 *
 *   TIMING. Comparing digests with === leaks the position of the first wrong
 *   byte, which is enough to forge one given patience. crypto.subtle.verify is
 *   constant-time; the key comparison uses an XOR accumulator for the same
 *   reason.
 *
 *   REPLAY. Their documentation defines no replay window, so we impose one. A
 *   delivery captured in transit is otherwise valid forever, and "valid
 *   forever" on a route that grants memberships is a free membership.
 */

/** How far out of date a delivery may be. Their retries are much slower than
 *  this, but a retry is re-signed; only a captured copy keeps its old stamp. */
export const MAX_SKEW_SECONDS = 300;

export type WebhookVerdict =
  | { ok: true; via: 'signature' | 'validation-key' }
  | { ok: false; why: 'no-secret' | 'no-proof' | 'malformed' | 'stale' | 'bad-signature' | 'bad-key' };

/** Constant-time string comparison. Length is allowed to leak; content is not. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Parse `t=1700000000,v1=abc…` in either order, tolerating spaces. */
export function parseSignature(header: string): { t: number; v1: string } | null {
  const parts = new Map<string, string>();
  for (const piece of header.split(',')) {
    const at = piece.indexOf('=');
    if (at < 1) continue;
    parts.set(piece.slice(0, at).trim(), piece.slice(at + 1).trim());
  }
  const t = Number(parts.get('t'));
  const v1 = parts.get('v1');
  if (!v1 || !Number.isFinite(t) || t <= 0) return null;
  return { t, v1 };
}

const hex = (buf: ArrayBuffer): string =>
  [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

async function hmac(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message)));
}

/**
 * Verify a delivery.
 *
 * `now` is injectable so the staleness rule can be tested without waiting five
 * minutes, which is the only reason it is a parameter.
 */
export async function verifyWebhook(
  rawBody: string,
  headers: Headers,
  secret: string,
  now: number = Math.floor(Date.now() / 1000),
): Promise<WebhookVerdict> {
  // An unset secret must never mean "allow". A deploy that forgets the secret
  // should break the webhook loudly, not open it to the world quietly.
  if (!secret) return { ok: false, why: 'no-secret' };

  const signature = headers.get('coinflow-signature');
  if (signature) {
    const parsed = parseSignature(signature);
    if (!parsed) return { ok: false, why: 'malformed' };
    if (Math.abs(now - parsed.t) > MAX_SKEW_SECONDS) return { ok: false, why: 'stale' };

    const expected = await hmac(secret, `${parsed.t}.${rawBody}`);
    return safeEqual(parsed.v1.toLowerCase(), expected)
      ? { ok: true, via: 'signature' }
      : { ok: false, why: 'bad-signature' };
  }

  // Their documented fallback. Weaker -- it says nothing about the body -- so
  // it is only consulted when no signature was offered at all.
  const auth = headers.get('authorization');
  if (auth) {
    return safeEqual(auth.trim(), secret)
      ? { ok: true, via: 'validation-key' }
      : { ok: false, why: 'bad-key' };
  }

  return { ok: false, why: 'no-proof' };
}
