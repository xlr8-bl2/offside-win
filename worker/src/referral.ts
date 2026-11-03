/**
 * Tell a friend.
 *
 * Every account has its own link, offside.win/?ref=<code>. A friend who
 * arrives on it and makes an account is remembered as theirs (one row in
 * `referral`, made only when the account is new). What each side gets:
 *
 *   the friend   their first FRIEND_DAYS free on a plan that renews, as a
 *                Whop trial at checkout. New members only, like every trial:
 *                an address that has had a membership before pays as usual.
 *   the sharer   REWARD_DAYS added to their own membership once the friend's
 *                first real payment lands (a trial ending into a payment
 *                counts; a trial alone does not). At most MAX_A_YEAR friends
 *                a year are rewarded, so the link cannot be farmed.
 *
 * The reward is applied by the ten-minute cron (rewards()): it finds friends
 * whose first payment is in the `payment` table, then adds the days the same
 * way the owner's "give free time" does, or, for a member Whop bills every
 * month, asks Whop to move the next payment back (add_free_days), recorded the
 * way goodwill.ts records it so the sweep does not read it as a payment.
 * Idempotent: rewarded_at is set in the statement that claims the row.
 */

import type { AuthDb } from './auth.ts';
import { sessionAccount } from './auth.ts';
import { referralRewardMail, sendMail, type MailEnv } from './mail.ts';

export { FRIEND_DAYS } from './d1read.ts';
import { FRIEND_DAYS } from './d1read.ts';
export const REWARD_DAYS = 14;
export const MAX_A_YEAR = 10;

const DAY = 86400;
const now = () => Math.floor(Date.now() / 1000);
// No 0/o, 1/l/i: a code read out loud or typed from a screenshot survives.
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
const CODE_RE = /^[a-hjkmnp-z2-9]{6}$/;

type Rec = Record<string, unknown>;

async function first<T = Rec>(db: AuthDb, sql: string, ...params: unknown[]): Promise<T | null> {
  return db.prepare(sql).bind(...params).first<T>();
}
async function all<T = Rec>(db: AuthDb, sql: string, ...params: unknown[]): Promise<T[]> {
  return (await db.prepare(sql).bind(...params).all<T>()).results ?? [];
}
async function run(db: AuthDb, sql: string, ...params: unknown[]): Promise<number> {
  return Number((await db.prepare(sql).bind(...params).run()).meta?.changes ?? 0);
}

/** A code as typed or pasted, or null when it cannot be one. */
export function cleanCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const c = raw.trim().toLowerCase();
  return CODE_RE.test(c) ? c : null;
}

function newCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join('');
}

/** This account's code, made the first time it is asked for. */
export async function codeFor(db: AuthDb, accountId: string): Promise<string> {
  const had = await first<{ code: string }>(db, 'SELECT code FROM referral_code WHERE account_id = ?', accountId);
  if (had) return had.code;
  for (let i = 0; i < 5; i++) {
    const code = newCode();
    // Unique on both columns: a clash on the code tries another; a race on the account reads the winner.
    await run(db, 'INSERT INTO referral_code (code, account_id, created_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING', code, accountId, now());
    const row = await first<{ code: string }>(db, 'SELECT code FROM referral_code WHERE account_id = ?', accountId);
    if (row) return row.code;
  }
  throw new Error('referral: no code');
}

/**
 * A new account that arrived on someone's link. Only ever for an account made
 * in this same sign-in, never for one that already existed, and never for the
 * sharer's own address. True when it was recorded.
 */
export async function recordReferral(db: AuthDb, rawCode: unknown, account: { id: string; email: string }): Promise<boolean> {
  const code = cleanCode(rawCode);
  if (!code) return false;
  const owner = await first<{ account_id: string; email: string }>(db,
    'SELECT c.account_id, a.email FROM referral_code c JOIN account a ON a.id = c.account_id WHERE c.code = ?', code);
  if (!owner || owner.account_id === account.id || owner.email.toLowerCase() === account.email.toLowerCase()) return false;
  return (await run(db, `INSERT INTO referral (referred_id, referrer_id, code, created_at) VALUES (?, ?, ?, ?)
    ON CONFLICT (referred_id) DO NOTHING`, account.id, owner.account_id, code, now())) > 0;
}

/** Free days this reader's friend link gives them at checkout: FRIEND_DAYS, or 0. */
export async function friendDays(db: AuthDb, user: { id: string }, isReturning: boolean): Promise<number> {
  if (isReturning) return 0;
  const r = await first(db, 'SELECT 1 AS x FROM referral WHERE referred_id = ?', user.id);
  return r ? FRIEND_DAYS : 0;
}

/** What the invite tab shows: the link and how it is going. */
export async function summary(db: AuthDb, accountId: string, site: string): Promise<Rec> {
  const code = await codeFor(db, accountId);
  const r = await first<{ joined: number; paid: number; days: number }>(db, `SELECT count(*) AS joined,
      sum(CASE WHEN paid_at IS NOT NULL THEN 1 ELSE 0 END) AS paid,
      sum(CASE WHEN rewarded_at IS NOT NULL THEN coalesce(reward_days, 0) ELSE 0 END) AS days
    FROM referral WHERE referrer_id = ?`, accountId);
  return {
    code,
    link: `${site.replace(/\/$/, '')}/?ref=${code}`,
    joined: Number(r?.joined ?? 0),
    paid: Number(r?.paid ?? 0),
    days_earned: Number(r?.days ?? 0),
    friend_days: FRIEND_DAYS,
    reward_days: REWARD_DAYS,
    max_a_year: MAX_A_YEAR,
  };
}

/** GET /api/referral: the signed-in reader's link and counts. */
export async function referralRoute(request: Request, env: { DB?: AuthDb; SITE_URL?: string }, token: string | null): Promise<Response> {
  const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'private, no-store' };
  if (request.method !== 'GET') return new Response(JSON.stringify({ error: 'method not allowed' }), { status: 405, headers });
  if (!env.DB) return new Response(JSON.stringify({ error: 'Not available at the moment.' }), { status: 503, headers });
  const a = await sessionAccount(env.DB, token);
  if (!a) return new Response(JSON.stringify({ error: 'Sign in first.' }), { status: 401, headers });
  const body = await summary(env.DB, a.id, env.SITE_URL || new URL(request.url).origin);
  return new Response(JSON.stringify(body), { headers });
}

/* ------------------------------------------------------------- rewards */

export interface RewardEnv extends MailEnv { DB?: AuthDb; WHOP_API_KEY?: string }

/** Ask Whop to move a membership's next payment back. The new period end, or null. */
async function whopAddDays(apiKey: string, membership: string, days: number): Promise<number | null> {
  const res = await fetch(`https://api.whop.com/api/v1/memberships/${encodeURIComponent(membership)}/add_free_days`, {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ free_days: days }),
  });
  if (!res.ok) { console.error('referral: whop refused', res.status); return null; }
  const m = await res.json().catch(() => null) as Rec | null;
  const end = m?.['renewal_period_end'] ?? m?.['expires_at'];
  const t = typeof end === 'number' ? end : typeof end === 'string' ? Date.parse(end) / 1000 : NaN;
  return Number.isFinite(t) ? Math.floor(t > 1e12 ? t / 1000 : t) : 0;
}

/**
 * Days onto the sharer's membership. Whop renewing: Whop moves the payment
 * back. Otherwise the days go on a membership of ours, after anything already
 * paid for, the way the owner's "give free time" does. The new end, or null
 * when it could not be done this time (tried again on the next run).
 */
async function addDays(env: RewardEnv, db: AuthDb, accountId: string, days: number): Promise<number | null> {
  const a = await first<{ email: string }>(db, 'SELECT email FROM account WHERE id = ?', accountId);
  if (!a) return 0;
  const email = a.email.toLowerCase();
  const t = now();
  const w = await first<{ plan_id: string; expires_at: number; renews: number; membership: string | null }>(db, `
    SELECT plan_id, expires_at, (plan_id <> 'matchday' AND renew_stopped_at IS NULL) AS renews,
           (SELECT substr(eg.ref, 1, instr(eg.ref, ':') - 1) FROM entitlement_grant eg
             WHERE eg.email = entitlement.email AND eg.ref LIKE 'mem\\_%' ESCAPE '\\' AND instr(eg.ref, ':') > 0
             ORDER BY eg.created_at DESC LIMIT 1) AS membership
      FROM entitlement WHERE email = ? AND status = 'active' AND expires_at > ?`, email, t);
  if (w?.renews) {
    if (!env.WHOP_API_KEY || !w.membership) return null;
    const until = await whopAddDays(env.WHOP_API_KEY, w.membership, days);
    if (until === null) return null;
    const end = until || Number(w.expires_at) + days * DAY;
    await run(db, 'UPDATE entitlement SET expires_at = max(expires_at, ?), updated_at = ? WHERE email = ?', end, t, email);
    await run(db, `INSERT INTO entitlement_grant (ref, email, plan_id, created_at) VALUES (?, ?, ?, ?) ON CONFLICT (ref) DO NOTHING`,
      `${w.membership}:${end}`, email, w.plan_id, t);
    return end;
  }
  const paidTo = Math.max(t, Number(w?.expires_at ?? t));
  const plan = await first<{ id: string }>(db, `SELECT id FROM plan WHERE active = 1 AND id <> 'matchday' ORDER BY sort DESC LIMIT 1`);
  await run(db, `INSERT INTO membership (user_id, plan_id, expires_at, created_at, updated_at, card_brand)
    VALUES (?, ?, ?, ?, ?, 'complimentary')
    ON CONFLICT (user_id) DO UPDATE SET
      expires_at = max(membership.expires_at, ?) + ?,
      card_brand = CASE WHEN membership.expires_at > ? THEN membership.card_brand ELSE 'complimentary' END,
      updated_at = excluded.updated_at`,
  accountId, plan?.id ?? 'monthly', paidTo + days * DAY, t, t, paidTo, days * DAY, t);
  return (await first<{ expires_at: number }>(db, 'SELECT expires_at FROM membership WHERE user_id = ?', accountId))?.expires_at ?? null;
}

export interface RewardOutcome { paid: number; rewarded: number; errors: number }

/** The cron's step: friends who have paid, and the days they earn their sharer. */
export async function rewards(env: RewardEnv, at = now()): Promise<RewardOutcome> {
  const out: RewardOutcome = { paid: 0, rewarded: 0, errors: 0 };
  const db = env.DB;
  if (!db) return out;
  // Friends whose first real payment has landed. The cap is counted per
  // sharer over the last year; past it the friend still counts, for nothing.
  const fresh = await all<{ referred_id: string; referrer_id: string }>(db, `
    SELECT r.referred_id, r.referrer_id FROM referral r
     WHERE r.paid_at IS NULL
       AND EXISTS (SELECT 1 FROM payment p WHERE p.user_id = r.referred_id AND p.amount_minor > 0 AND p.status = 'succeeded')
     LIMIT 50`);
  for (const f of fresh) {
    const earned = await first<{ n: number }>(db, `SELECT count(*) AS n FROM referral
      WHERE referrer_id = ? AND paid_at > ? AND reward_days > 0`, f.referrer_id, at - 365 * DAY);
    const days = Number(earned?.n ?? 0) >= MAX_A_YEAR ? 0 : REWARD_DAYS;
    out.paid += await run(db, 'UPDATE referral SET paid_at = ?, reward_days = ?, rewarded_at = CASE WHEN ? = 0 THEN ? END WHERE referred_id = ? AND paid_at IS NULL',
      at, days, days, at, f.referred_id);
  }
  const due = await all<{ referred_id: string; referrer_id: string; reward_days: number }>(db, `
    SELECT referred_id, referrer_id, reward_days FROM referral
     WHERE paid_at IS NOT NULL AND rewarded_at IS NULL AND reward_days > 0 LIMIT 20`);
  for (const d of due) {
    // Claimed before the days go on, so two runs never both give them.
    if (!await run(db, 'UPDATE referral SET rewarded_at = ? WHERE referred_id = ? AND rewarded_at IS NULL', at, d.referred_id)) continue;
    let until: number | null = null;
    try { until = await addDays(env, db, d.referrer_id, Number(d.reward_days)); } catch (err) {
      console.error('referral:', err instanceof Error ? err.message : String(err));
    }
    if (until === null) {
      await run(db, 'UPDATE referral SET rewarded_at = NULL WHERE referred_id = ?', d.referred_id);
      out.errors++;
      continue;
    }
    out.rewarded++;
    const who = await first<{ email: string }>(db, 'SELECT email FROM account WHERE id = ?', d.referrer_id);
    if (who?.email && until) {
      const sent = await sendMail(env, who.email, referralRewardMail({ days: Number(d.reward_days), until }));
      console.log('mail: referral reward', sent ? 'sent' : 'not sent');
    }
  }
  return out;
}
