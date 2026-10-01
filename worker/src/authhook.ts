/**
 * Supabase's send-email hook (POST /api/auth/email).
 *
 * With the hook switched on, Supabase Auth stops sending its own sign-in
 * emails and hands each one here instead: who it is for, what kind it is, and
 * the token that goes in the link. This builds the link, draws the email in
 * the site's own design (authMail in mail.ts) and sends it the same way as
 * every other message.
 *
 * Who may call it: Supabase signs each delivery the Standard Webhooks way
 * (`webhook-id`, `webhook-timestamp`, `webhook-signature`, HMAC-SHA256 over
 * `id.timestamp.body`). The secret is never typed anywhere: it is derived from
 * the service key, which both this Worker and the setup command
 * (engine/src/authmail.ts) already hold, so switching the hook on needs no new
 * secret. SEND_EMAIL_HOOK_SECRET, if set, wins over the derived one.
 *
 * Unlike every other email, failing here fails the thing it is for: a sign-in
 * with no email is a sign-in that cannot finish. So a send that nobody takes
 * is answered with an error, and Supabase shows the reader that the link was
 * not sent rather than "check your inbox" for an email that will never come.
 */

import { authMail, deliver, noticeMail, type MailEnv } from './mail.ts';

export interface HookEnv extends MailEnv {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_KEY?: string;
  /** `v1,whsec_<base64>`; optional, see above. */
  SEND_EMAIL_HOOK_SECRET?: string;
}

const enc = new TextEncoder();

const b64 = (bytes: ArrayBuffer | Uint8Array) => {
  const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (const b of u) s += String.fromCharCode(b);
  return btoa(s);
};
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function hmac(key: Uint8Array, msg: string): Promise<ArrayBuffer> {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', k, enc.encode(msg));
}

/** The hook secret, in the form Supabase takes it: `v1,whsec_<base64>`. */
export async function hookSecret(serviceKey: string): Promise<string> {
  return `v1,whsec_${b64(await hmac(enc.encode(serviceKey), 'offside.win send-email hook v1'))}`;
}

/** The raw key bytes behind a `v1,whsec_...` secret. */
const keyOf = (secret: string) => unb64(secret.replace(/^v1,/, '').replace(/^whsec_/, ''));

/** Constant-time comparison of two strings of base64. */
function same(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export type HookVerdict = { ok: true } | { ok: false; why: string };

/** Standard Webhooks verification, five minutes either way. */
export async function verifyHook(raw: string, headers: Headers, secret: string, now = Math.floor(Date.now() / 1000)): Promise<HookVerdict> {
  if (!secret) return { ok: false, why: 'hook not configured' };
  const id = headers.get('webhook-id');
  const ts = headers.get('webhook-timestamp');
  const sig = headers.get('webhook-signature');
  if (!id || !ts || !sig) return { ok: false, why: 'unsigned' };
  if (!/^\d+$/.test(ts) || Math.abs(now - Number(ts)) > 300) return { ok: false, why: 'stale' };
  let key: Uint8Array;
  try { key = keyOf(secret); } catch { return { ok: false, why: 'hook not configured' }; }
  const want = b64(await hmac(key, `${id}.${ts}.${raw}`));
  const given = sig.split(' ').map((s) => s.split(',')).filter(([v]) => v === 'v1').map(([, s]) => s ?? '');
  return given.some((s) => same(s, want)) ? { ok: true } : { ok: false, why: 'bad signature' };
}

interface HookPayload {
  user?: { email?: string; new_email?: string };
  email_data?: {
    token?: string; token_hash?: string; token_new?: string; token_hash_new?: string;
    redirect_to?: string; email_action_type?: string; site_url?: string;
  };
}

const answer = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
});
const refuse = (status: number, message: string) => answer({ error: { http_code: status, message } }, status);

export async function authEmailHook(request: Request, env: HookEnv): Promise<Response> {
  // Which ways out exist, by presence only, so the setup command can refuse
  // to switch the hook on while nothing could send what it hands over.
  if (request.method === 'GET') return answer({ cloudflare: Boolean(env.EMAIL), brevo: Boolean(env.BREVO_API_KEY) });
  if (request.method !== 'POST') return refuse(405, 'method not allowed');
  const raw = await request.text();
  const secret = env.SEND_EMAIL_HOOK_SECRET || (env.SUPABASE_SERVICE_KEY ? await hookSecret(env.SUPABASE_SERVICE_KEY) : '');
  const verdict = await verifyHook(raw, request.headers, secret);
  if (!verdict.ok) {
    console.error('auth hook: refused,', verdict.why);
    return refuse(401, verdict.why);
  }

  let body: HookPayload;
  try { body = JSON.parse(raw) as HookPayload; } catch { return refuse(400, 'not json'); }
  const d = body.email_data ?? {};
  const action = String(d.email_action_type ?? 'magiclink');
  const email = body.user?.email ?? '';
  const verify = (hash: string) => {
    const u = new URL('/auth/v1/verify', env.SUPABASE_URL);
    u.searchParams.set('token', hash);
    u.searchParams.set('type', action);
    if (d.redirect_to) u.searchParams.set('redirect_to', d.redirect_to);
    return u.toString();
  };

  // Who gets what. An email change sends the current address the *new* hash
  // and the new address the plain one; Supabase swapped them long ago and
  // kept it for compatibility.
  const out: Array<{ to: string; mail: ReturnType<typeof authMail> }> = [];
  if (/_notification$/.test(action)) {
    if (email) out.push({ to: email, mail: noticeMail(action) });
  } else if (action === 'email_change') {
    const fresh = body.user?.new_email ?? '';
    if (email && d.token_hash_new) out.push({ to: email, mail: authMail({ action: 'email_change_current', link: verify(d.token_hash_new), newEmail: fresh || null }) });
    if (fresh && d.token_hash) out.push({ to: fresh, mail: authMail({ action: 'email_change', link: verify(d.token_hash) }) });
  } else if (email) {
    const link = action === 'reauthentication' || !d.token_hash ? null : verify(d.token_hash);
    out.push({ to: email, mail: authMail({ action, link, code: d.token ?? null }) });
  }
  if (!out.length) return refuse(400, 'nothing to send');

  for (const { to, mail } of out) {
    const via = await deliver(env, to, mail);
    console.log('auth hook:', action, via ? `sent via ${via}` : 'not sent');
    if (!via) return refuse(500, 'The email could not be sent. Try again in a minute.');
  }
  return answer({});
}
