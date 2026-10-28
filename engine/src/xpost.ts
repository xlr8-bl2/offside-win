/**
 * Posting to X as the site's own account, with the four keys the owner made in
 * X's developer portal (Actions secrets X_API_KEY, X_API_SECRET,
 * X_ACCESS_TOKEN, X_ACCESS_SECRET). Requests are signed with OAuth 1.0a,
 * which is what a single account posting for itself uses.
 *
 * `x:check` asks X who the keys belong to and whether they can write. It posts
 * nothing. Prints yes/no answers and X's own error words, never a key.
 */

import { createHmac, randomBytes } from 'node:crypto';

interface Keys { apiKey: string; apiSecret: string; token: string; tokenSecret: string }

export function keys(): Keys | null {
  const k = {
    apiKey: (process.env['X_API_KEY'] ?? '').trim(),
    apiSecret: (process.env['X_API_SECRET'] ?? '').trim(),
    token: (process.env['X_ACCESS_TOKEN'] ?? '').trim(),
    tokenSecret: (process.env['X_ACCESS_SECRET'] ?? '').trim(),
  };
  return Object.values(k).every(Boolean) ? k : null;
}

const pct = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/** The OAuth 1.0a Authorization header for one request. Query parameters are signed; a JSON body is not. */
export function authHeader(k: Keys, method: string, url: string, nonce = randomBytes(16).toString('hex'), ts = Math.floor(Date.now() / 1000)): string {
  const u = new URL(url);
  const oauth: Record<string, string> = {
    oauth_consumer_key: k.apiKey, oauth_nonce: nonce, oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: String(ts), oauth_token: k.token, oauth_version: '1.0',
  };
  const params = [...Object.entries(oauth), ...[...u.searchParams.entries()]]
    .map(([a, b]) => [pct(a), pct(b)] as const).sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : 1) : a[0] < b[0] ? -1 : 1))
    .map(([a, b]) => `${a}=${b}`).join('&');
  const base = [method.toUpperCase(), pct(`${u.origin}${u.pathname}`), pct(params)].join('&');
  const signature = createHmac('sha1', `${pct(k.apiSecret)}&${pct(k.tokenSecret)}`).update(base).digest('base64');
  return 'OAuth ' + Object.entries({ ...oauth, oauth_signature: signature }).map(([a, b]) => `${pct(a)}="${pct(b)}"`).join(', ');
}

async function x(k: Keys, method: string, url: string, body?: unknown) {
  const res = await fetch(url, {
    method,
    headers: { authorization: authHeader(k, method, url), ...(body ? { 'content-type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const j = await res.json().catch(() => null) as any;
  return { status: res.status, body: j, access: res.headers.get('x-access-level') };
}

export async function xCheck(): Promise<void> {
  const k = keys();
  if (!k) {
    const missing = ['X_API_KEY', 'X_API_SECRET', 'X_ACCESS_TOKEN', 'X_ACCESS_SECRET'].filter((n) => !(process.env[n] ?? '').trim());
    throw new Error(`not set in Actions secrets: ${missing.join(', ')}`);
  }
  const me = await x(k, 'GET', 'https://api.x.com/2/users/me');
  if (me.status !== 200) {
    const why = me.body?.detail ?? me.body?.title ?? me.body?.errors?.[0]?.message ?? 'no answer';
    throw new Error(`X refused the keys: ${me.status} ${String(why).slice(0, 200)}`);
  }
  console.log('keys: work');
  // The account name is public anyway, and it shows the keys are for the right account.
  console.log(`  account: @${me.body?.data?.username ?? '?'}`);
  const level = me.access ?? 'unknown';
  console.log(`  access level: ${level}`);
  if (!/write/.test(level)) {
    throw new Error('the access token can only read. Set the app to "Read and write" under User authentication settings, then regenerate the Access Token and Secret and save them again');
  }
  console.log('all good: the keys can post (nothing was posted)');
}
