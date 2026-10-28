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

/** Upload one picture; its media id, or null when X refuses (the post then goes out with the link alone). */
export async function uploadImage(k: Keys, bytes: Buffer): Promise<string | null> {
  const url = 'https://api.x.com/2/media/upload';
  const fd = new FormData();
  fd.append('media', new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' }), 'post.jpg');
  fd.append('media_category', 'tweet_image');
  const res = await fetch(url, { method: 'POST', headers: { authorization: authHeader(k, 'POST', url) }, body: fd });
  const j = await res.json().catch(() => null) as any;
  const id = j?.data?.id ?? j?.media_id_string ?? null;
  if (!id) console.log(`x media upload: ${res.status} ${String(j?.detail ?? j?.title ?? j?.errors?.[0]?.message ?? '').slice(0, 200)}`);
  return id;
}

/** Post one tweet as the site's account; its id. */
export async function tweet(k: Keys, text: string, mediaId?: string | null): Promise<string> {
  const r = await x(k, 'POST', 'https://api.x.com/2/tweets', { text, ...(mediaId ? { media: { media_ids: [mediaId] } } : {}) });
  if (r.status !== 201 && r.status !== 200) {
    throw new Error(`X refused the post: ${r.status} ${String(r.body?.detail ?? r.body?.title ?? r.body?.errors?.[0]?.message ?? '').slice(0, 200)}`);
  }
  return String(r.body?.data?.id ?? '');
}

/** X counts every link as 23 characters, and most emoji as two. */
export function xLength(s: string): number {
  return [...s.replace(/https?:\/\/\S+|\b[\w-]+\.(?:org|win|com)\b/g, 'x'.repeat(23))].reduce((n, ch) => n + (ch.codePointAt(0)! > 0x2fff ? 2 : 1), 0);
}

/**
 * The X version of a Telegram post: its opening lines, as many as fit, then
 * the link and the 18+ line. Lines that only make sense in Telegram (the
 * notifications nudge, "below") are dropped.
 */
export function xText(caption: string, link: string | null = null): string {
  // X charges far more for a post with a link in it (2026 pay-per-use), so by
  // default the link lives in the bio. X_POST_LINKS=1 puts it back.
  const tail = link ? `\n\n${link}\n18+ BeGambleAware.org` : '\n\nFull case: link in bio\n18+ BeGambleAware.org';
  const lines = caption.split('\n').filter((l) => !/18\+|BeGambleAware|notifications|👇/.test(l));
  while (lines.length && !lines[lines.length - 1]!.trim()) lines.pop();
  const kept: string[] = [];
  for (const l of lines) {
    if (xLength([...kept, l].join('\n').trim() + tail) > 280) break;
    kept.push(l);
  }
  return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim() + tail;
}
