/**
 * Signing in, without Supabase (HANDOFF.md, stage 2).
 *
 * Supabase Auth was blocked with the rest of the project in October 2026, so
 * the Worker issues sessions itself, from D1:
 *
 * - **Email link.** `POST /api/auth/link` with an address sends a one-use link
 *   that lasts an hour (authMail in mail.ts, the same design as before). The
 *   link opens the site with `?signin=<token>`, and the page redeems it with
 *   `POST /api/auth/verify`. Redeeming is a POST from the page, never the GET
 *   of the link, so a mail scanner that opens every link signs nobody in.
 * - **Google.** The page gets a signed ID token from Google (its button or the
 *   redirect, public/js/lib/auth.js) and sends it to `POST /api/auth/google`
 *   with the nonce it asked Google to sign. The token's signature is checked
 *   against Google's published keys, its audience against GOOGLE_CLIENT_ID,
 *   and the nonce against its hash, so a token lifted from elsewhere is no use.
 *
 * Either way the answer is a session: a random token the page keeps and sends
 * as `Authorization: Bearer`, exactly where Supabase's JWT went. Only its
 * SHA-256 is stored (`auth_session`), so a copy of the database signs nobody
 * in. Sessions last 60 days and are extended while they are used.
 *
 * Accounts are keyed by email. The six from Supabase keep their ids
 * (`db:accounts`, engine/src/d1accounts.ts), so their memberships, profiles
 * and follows are still theirs.
 */

import { authMail, deliver, type MailEnv } from './mail.ts';
import { hasMembership, sha256Hex, type D1Read, type Viewer } from './d1read.ts';

export interface AuthStmt {
  bind(...values: unknown[]): AuthStmt;
  all<T = Record<string, unknown>>(): Promise<{ results?: T[] }>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run(): Promise<{ meta?: { changes?: number } }>;
}
export interface AuthDb {
  prepare(sql: string): AuthStmt;
  batch(statements: AuthStmt[]): Promise<Array<{ results?: unknown[]; meta?: { changes?: number } }>>;
}

export interface AuthEnv extends MailEnv {
  DB?: AuthDb;
  GOOGLE_CLIENT_ID?: string;
  SITE_URL?: string;
}

const DAY = 86400;
/** How long a session lasts, and how close to its end a use extends it. */
export const SESSION_DAYS = 60;
const EXTEND_WITHIN = 30 * DAY;
const LINK_SECONDS = 3600;
/** Links one address may be sent in an hour, and the whole site. */
const LINKS_PER_EMAIL = 5;
const LINKS_PER_HOUR = 300;

const now = () => Math.floor(Date.now() / 1000);

function answer(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}
const refuse = (status: number, error: string) => answer({ error }, status);

/** 32 random bytes as base64url: the session or link token. */
export function randomToken(): string {
  const b = crypto.getRandomValues(new Uint8Array(32));
  let s = '';
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** A plausible address, lower-cased, or null. Deliberately loose: the email itself is the test. */
export function cleanEmail(raw: unknown): string | null {
  const e = String(raw ?? '').trim().toLowerCase();
  if (e.length < 3 || e.length > 254) return null;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : null;
}

export interface Account {
  id: string; email: string; name: string | null; avatar_url: string | null;
  provider: string; created_at: number;
}

/** What the page shows about the person (currentUser in public/js/lib/auth.js). */
export const userOf = (a: Account) => ({
  id: a.id, email: a.email, name: a.name, avatar: a.avatar_url, provider: a.provider,
  since: new Date(a.created_at * 1000).toISOString(),
});

const ACCOUNT_COLS = 'a.id, a.email, a.name, a.avatar_url, a.provider, a.created_at';

/** The account behind a session token, or null for an unknown or expired one. */
export async function sessionAccount(db: AuthDb, token: string | null): Promise<(Account & { expires_at: number }) | null> {
  if (!token || token.length < 20 || token.length > 100) return null;
  return db.prepare(`SELECT ${ACCOUNT_COLS}, s.expires_at FROM auth_session s JOIN account a ON a.id = s.account_id
      WHERE s.token_sha256 = ? AND s.expires_at > ?`)
    .bind(await sha256Hex(token), now()).first<Account & { expires_at: number }>();
}

/** Who is reading, for the walled reads: null when signed out. */
export async function viewerFor(db: AuthDb, token: string | null): Promise<Viewer | null> {
  const a = await sessionAccount(db, token);
  if (!a) return null;
  return { id: a.id, email: a.email, member: await hasMembership(db as unknown as D1Read, a.id, a.email) };
}

async function startSession(db: AuthDb, accountId: string): Promise<{ token: string; expires_at: number }> {
  const token = randomToken();
  const t = now();
  const expires = t + SESSION_DAYS * DAY;
  await db.batch([
    db.prepare('INSERT INTO auth_session (token_sha256, account_id, created_at, expires_at, seen_at) VALUES (?, ?, ?, ?, ?)')
      .bind(await sha256Hex(token), accountId, t, expires, t),
    db.prepare('UPDATE account SET last_sign_in_at = ? WHERE id = ?').bind(t, accountId),
  ]);
  return { token, expires_at: expires };
}

/** The account for an address, made on first sign-in. */
async function accountFor(db: AuthDb, email: string, extra: { name?: string | null; avatar?: string | null; provider?: string; googleSub?: string | null } = {}): Promise<Account> {
  const found = await db.prepare(`SELECT ${ACCOUNT_COLS}, a.google_sub FROM account a WHERE a.email = ?`).bind(email)
    .first<Account & { google_sub: string | null }>();
  if (found) {
    // Google fills in what an email sign-in never had, and never overwrites.
    if ((extra.googleSub && !found.google_sub) || (extra.name && !found.name) || (extra.avatar && !found.avatar_url)) {
      await db.prepare(`UPDATE account SET google_sub = coalesce(google_sub, ?), name = coalesce(name, ?),
          avatar_url = coalesce(avatar_url, ?) WHERE id = ?`)
        .bind(extra.googleSub ?? null, extra.name ?? null, extra.avatar ?? null, found.id).run();
    }
    return { ...found, name: found.name ?? extra.name ?? null, avatar_url: found.avatar_url ?? extra.avatar ?? null };
  }
  const a: Account = {
    id: crypto.randomUUID(), email, name: extra.name ?? null, avatar_url: extra.avatar ?? null,
    provider: extra.provider ?? 'email', created_at: now(),
  };
  // Two first sign-ins racing: the unique email decides, and the loser reads the winner's row.
  await db.prepare(`INSERT INTO account (id, email, name, avatar_url, provider, google_sub, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (email) DO NOTHING`)
    .bind(a.id, a.email, a.name, a.avatar_url, a.provider, extra.googleSub ?? null, a.created_at).run();
  const row = await db.prepare(`SELECT ${ACCOUNT_COLS} FROM account a WHERE a.email = ?`).bind(email).first<Account>();
  return row ?? a;
}

async function body(request: Request): Promise<Record<string, unknown>> {
  try {
    const b = await request.json();
    return b && typeof b === 'object' ? b as Record<string, unknown> : {};
  } catch { return {}; }
}

/** Where a link lands: a path on this site, never another one. */
export function landing(site: string, back: unknown): URL {
  const u = new URL('/', site);
  if (typeof back === 'string' && back) {
    try {
      const b = new URL(back, site);
      if (b.origin === u.origin) return new URL(b.pathname, site);
    } catch { /* the home page */ }
  }
  return u;
}

/* ------------------------------------------------------------ email link */

async function sendLink(request: Request, env: AuthEnv, db: AuthDb): Promise<Response> {
  const b = await body(request);
  const email = cleanEmail(b.email);
  if (!email) return refuse(400, 'That email address does not look right.');
  const t = now();
  const [mine, all] = await db.batch([
    db.prepare('SELECT count(*) AS n FROM auth_link WHERE email = ? AND created_at > ?').bind(email, t - 3600),
    db.prepare('SELECT count(*) AS n FROM auth_link WHERE created_at > ?').bind(t - 3600),
  ]);
  const n = (r: { results?: unknown[] } | undefined) => Number(((r?.results ?? [])[0] as { n?: number } | undefined)?.n ?? 0);
  if (n(mine) >= LINKS_PER_EMAIL) return refuse(429, 'Too many links asked for that address. Try again in an hour.');
  if (n(all) >= LINKS_PER_HOUR) return refuse(429, 'Sign-in is busy. Try again in a few minutes.');

  const token = randomToken();
  await db.prepare('INSERT INTO auth_link (token_sha256, email, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .bind(await sha256Hex(token), email, t, t + LINK_SECONDS).run();
  const link = landing(env.SITE_URL || 'https://offside.win', b.redirect);
  link.searchParams.set('signin', token);
  const via = await deliver(env, email, authMail({ action: 'magiclink', link: link.toString() }));
  console.log('auth link:', via ? `sent via ${via}` : 'not sent');
  if (!via) return refuse(502, 'The email could not be sent. Try again in a minute.');
  return answer({ sent: true });
}

async function verifyLink(request: Request, db: AuthDb): Promise<Response> {
  const token = String((await body(request)).token ?? '');
  if (token.length < 20 || token.length > 100) return refuse(400, 'That sign-in link is not complete.');
  const hash = await sha256Hex(token);
  const t = now();
  // Used in the same statement that checks it, so two tabs cannot both redeem it.
  const used = await db.prepare('UPDATE auth_link SET used_at = ? WHERE token_sha256 = ? AND used_at IS NULL AND expires_at > ?')
    .bind(t, hash, t).run();
  if (!used.meta?.changes) return refuse(401, 'That sign-in link has been used or has run out. Ask for a new one.');
  const link = await db.prepare('SELECT email FROM auth_link WHERE token_sha256 = ?').bind(hash).first<{ email: string }>();
  if (!link) return refuse(401, 'That sign-in link has been used or has run out. Ask for a new one.');
  const account = await accountFor(db, link.email);
  const s = await startSession(db, account.id);
  return answer({ session: s.token, expires_at: s.expires_at, user: userOf(account) });
}

/* ---------------------------------------------------------------- Google */

const GOOGLE_KEYS = 'https://www.googleapis.com/oauth2/v3/certs';
const GOOGLE_ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);

const unb64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
const json64 = (s: string) => JSON.parse(new TextDecoder().decode(unb64url(s))) as Record<string, unknown>;

export interface GoogleClaims { sub: string; email: string; email_verified: boolean; name: string | null; picture: string | null }

type Keys = (kid: string) => Promise<JsonWebKey | null>;

/** Google's signing keys, from the edge's cache for as long as Google says they hold. */
const googleKeys: Keys = async (kid) => {
  const res = await fetch(GOOGLE_KEYS, { cf: { cacheTtl: 3600, cacheEverything: true } } as RequestInit);
  if (!res.ok) return null;
  const { keys } = await res.json() as { keys?: Array<JsonWebKey & { kid?: string }> };
  return keys?.find((k) => k.kid === kid) ?? null;
};

/** A Google ID token checked: signature, issuer, audience, time and nonce. Null when any fails. */
export async function verifyGoogle(token: string, clientId: string, nonce: string, keys: Keys = googleKeys, at = now()): Promise<GoogleClaims | null> {
  const parts = token.split('.');
  if (parts.length !== 3 || !clientId || !nonce) return null;
  const [h, p, sig] = parts as [string, string, string];
  let header: Record<string, unknown>;
  let claims: Record<string, unknown>;
  try { header = json64(h); claims = json64(p); } catch { return null; }
  if (header.alg !== 'RS256' || typeof header.kid !== 'string') return null;
  const jwk = await keys(header.kid);
  if (!jwk) return null;
  const key = await crypto.subtle.importKey('jwk', { ...jwk, alg: 'RS256', ext: true }, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, unb64url(sig), new TextEncoder().encode(`${h}.${p}`));
  if (!ok) return null;
  if (!GOOGLE_ISSUERS.has(String(claims.iss))) return null;
  const aud = claims.aud;
  if (!(aud === clientId || (Array.isArray(aud) && aud.includes(clientId)))) return null;
  if (typeof claims.exp !== 'number' || claims.exp < at - 60) return null;
  if (claims.nonce !== await sha256Hex(nonce)) return null;
  const email = cleanEmail(claims.email);
  if (!email || claims.email_verified !== true || typeof claims.sub !== 'string') return null;
  const picture = typeof claims.picture === 'string' && /^https:\/\//.test(claims.picture) ? claims.picture : null;
  return { sub: claims.sub, email, email_verified: true, name: typeof claims.name === 'string' ? claims.name.slice(0, 80) : null, picture };
}

async function google(request: Request, env: AuthEnv, db: AuthDb): Promise<Response> {
  const b = await body(request);
  const claims = await verifyGoogle(String(b.id_token ?? ''), env.GOOGLE_CLIENT_ID ?? '', String(b.nonce ?? ''));
  if (!claims) return refuse(401, 'Google sign-in did not go through. Try again.');
  // The Google account already linked wins; else the address.
  const linked = await db.prepare('SELECT email FROM account WHERE google_sub = ?').bind(claims.sub).first<{ email: string }>();
  const account = await accountFor(db, linked?.email ?? claims.email, {
    name: claims.name, avatar: claims.picture, provider: 'google', googleSub: claims.sub,
  });
  const s = await startSession(db, account.id);
  return answer({ session: s.token, expires_at: s.expires_at, user: userOf(account) });
}

/* ------------------------------------------------------------- the rest */

async function me(db: AuthDb, token: string | null): Promise<Response> {
  const a = await sessionAccount(db, token);
  if (!a) return refuse(401, 'signed out');
  const t = now();
  let expires = a.expires_at;
  if (expires - t < EXTEND_WITHIN) {
    expires = t + SESSION_DAYS * DAY;
    await db.prepare('UPDATE auth_session SET expires_at = ?, seen_at = ? WHERE token_sha256 = ?')
      .bind(expires, t, await sha256Hex(token ?? '')).run();
  }
  return answer({ user: userOf(a), expires_at: expires });
}

async function signOut(request: Request, db: AuthDb, token: string | null): Promise<Response> {
  const a = await sessionAccount(db, token);
  if (a) {
    const everywhere = (await body(request)).everywhere === true;
    if (everywhere) await db.prepare('DELETE FROM auth_session WHERE account_id = ?').bind(a.id).run();
    else await db.prepare('DELETE FROM auth_session WHERE token_sha256 = ?').bind(await sha256Hex(token ?? '')).run();
  }
  return answer({ signed_out: true });
}

/** `/api/auth/*`. */
export async function auth(request: Request, env: AuthEnv, path: string, token: string | null): Promise<Response> {
  const db = env.DB;
  if (!db) return refuse(503, 'Sign-in is not available at the moment.');
  if (path === '/api/auth/me' && request.method === 'GET') return me(db, token);
  if (request.method !== 'POST') return refuse(405, 'method not allowed');
  if (path === '/api/auth/link') return sendLink(request, env, db);
  if (path === '/api/auth/verify') return verifyLink(request, db);
  if (path === '/api/auth/google') return google(request, env, db);
  if (path === '/api/auth/signout') return signOut(request, db, token);
  return refuse(404, 'not found');
}

/** Spent links and sessions, cleared out by the Worker's cron. */
export async function authCleanup(db: AuthDb | undefined): Promise<void> {
  if (!db) return;
  const t = now();
  await db.batch([
    db.prepare('DELETE FROM auth_session WHERE expires_at < ?').bind(t),
    db.prepare('DELETE FROM auth_link WHERE created_at < ?').bind(t - 2 * DAY),
  ]);
}
