/**
 * The money side of the database, on D1 (HANDOFF.md, stage 2).
 *
 * These were Postgres functions the Worker called with Supabase's service key
 * (record_entitlement, revoke_entitlement, stop_entitlement_renewal,
 * record_payment, revoke_membership, record_consent, delete_account_data in
 * schema.pg.sql) and a handful of PostgREST table reads. Each keeps its old
 * answer shape, so pay.ts reads the result exactly as before.
 *
 * Idempotency still rests on unique keys rather than on checking first:
 * `entitlement_grant.ref` and `payment (provider, provider_ref)`. A retried
 * Whop delivery inserts nothing, and "nothing inserted" is what says it has
 * been seen.
 */

import type { AuthDb } from './auth.ts';
import { sha256Hex } from './d1read.ts';

type Rec = Record<string, unknown>;
const now = () => Math.floor(Date.now() / 1000);

async function first<T = Rec>(db: AuthDb, sql: string, ...params: unknown[]): Promise<T | null> {
  return db.prepare(sql).bind(...params).first<T>();
}
async function all<T = Rec>(db: AuthDb, sql: string, ...params: unknown[]): Promise<T[]> {
  return (await db.prepare(sql).bind(...params).all<T>()).results ?? [];
}
async function run(db: AuthDb, sql: string, ...params: unknown[]): Promise<number> {
  return Number((await db.prepare(sql).bind(...params).run()).meta?.changes ?? 0);
}

/* ---------------------------------------------------------------- kv */

export async function kvGet(db: AuthDb, k: string): Promise<string | null> {
  return (await first<{ v: string }>(db, 'SELECT v FROM kv WHERE k = ? AND (expires_at IS NULL OR expires_at > ?)', k, now()))?.v ?? null;
}
export async function kvGetJson<T = unknown>(db: AuthDb, k: string): Promise<T | null> {
  const v = await kvGet(db, k);
  if (v === null) return null;
  try { return JSON.parse(v) as T; } catch { return null; }
}
export async function kvSet(db: AuthDb, k: string, v: string): Promise<void> {
  await run(db, `INSERT INTO kv (k, v, updated_at) VALUES (?, ?, ?)
    ON CONFLICT (k) DO UPDATE SET v = excluded.v, expires_at = NULL, updated_at = excluded.updated_at`, k, v, now());
}

/* -------------------------------------------------------------- plans */

export interface PlanRow { id: string; name: string; amount_minor: number; currency: string; days: number; checkout_url: string | null }

export async function activePlan(db: AuthDb, id: string): Promise<PlanRow | null> {
  return first<PlanRow>(db, 'SELECT id, name, amount_minor, currency, days, checkout_url FROM plan WHERE id = ? AND active = 1', id);
}
export async function activePlans(db: AuthDb): Promise<PlanRow[]> {
  return all<PlanRow>(db, 'SELECT id, name, amount_minor, currency, days, checkout_url FROM plan WHERE active = 1');
}
export async function planDays(db: AuthDb): Promise<Record<string, number>> {
  const rows = await all<{ id: string; days: number }>(db, 'SELECT id, days FROM plan');
  return Object.fromEntries(rows.map((r) => [r.id, Number(r.days)]));
}

/* ----------------------------------------------------------- accounts */

/** An account's sign-in email, lower-cased. */
export async function accountEmail(db: AuthDb, id: string): Promise<string | null> {
  return (await first<{ email: string }>(db, 'SELECT email FROM account WHERE id = ?', id))?.email ?? null;
}

/** Whether an account, or a deleted one with the same email, has ever had a membership. */
export async function hadMembership(db: AuthDb, user: { id: string; email: string | null }): Promise<boolean> {
  const email = (user.email ?? '').trim().toLowerCase();
  const print = email ? await sha256Hex(email) : '';
  const r = await first<{ ok: number }>(db, `SELECT (
      EXISTS (SELECT 1 FROM membership WHERE user_id = ?)
      OR EXISTS (SELECT 1 FROM payment WHERE user_id = ?)
      OR EXISTS (SELECT 1 FROM entitlement WHERE email = ? AND ? <> '')
      OR EXISTS (SELECT 1 FROM former_member WHERE email_sha256 = ? AND ? <> '')) AS ok`,
  user.id, user.id, email, email, print, print);
  return Boolean(r?.ok);
}

/** record_consent(): what the buyer confirmed at checkout, kept. */
export async function recordConsent(db: AuthDb, userId: string, planId: string, terms: string): Promise<void> {
  await run(db, `INSERT INTO purchase_consent (user_id, plan_id, terms_version, adult, waived, created_at)
    VALUES (?, ?, ?, 1, 1, ?)`, userId, planId, terms, now());
}

export async function latestConsent(db: AuthDb, userId: string): Promise<{ at: number; terms: string } | null> {
  const r = await first<{ created_at: number; terms_version: string }>(db,
    'SELECT created_at, terms_version FROM purchase_consent WHERE user_id = ? ORDER BY created_at DESC LIMIT 1', userId);
  return r ? { at: Number(r.created_at), terms: String(r.terms_version) } : null;
}

/* --------------------------------------------------------- entitlements */

export interface EntitlementArgs {
  p_source: string; p_ref: string | null; p_email: string | null; p_plan: string; p_expires: number | null;
  p_amount: number | null; p_currency: string | null; p_raw: string; p_manage_url?: string | null; p_user?: string | null;
}

/** record_entitlement(): grant or extend an entitlement by email, once per reference. */
export async function recordEntitlement(db: AuthDb, a: EntitlementArgs): Promise<Rec> {
  const email = (a.p_email ?? '').trim().toLowerCase();
  if (!email) return { applied: false, reason: 'no email' };
  const plan = await first<{ days: number }>(db, 'SELECT days FROM plan WHERE id = ?', a.p_plan);
  if (!plan) return { applied: false, reason: 'unknown plan' };
  const t = now();
  if (a.p_ref) {
    // Claimed first, by the unique key: of two deliveries racing, one inserts.
    if (await first(db, 'SELECT 1 AS x FROM entitlement WHERE email = ? AND source_ref = ?', email, a.p_ref)) {
      return { applied: false, reason: 'already recorded' };
    }
    if (!await run(db, 'INSERT INTO entitlement_grant (ref, email, plan_id, created_at) VALUES (?, ?, ?, ?) ON CONFLICT (ref) DO NOTHING', a.p_ref, email, a.p_plan, t)) {
      return { applied: false, reason: 'already recorded' };
    }
  }
  try {
    // The receipt, when there is an account to hang it on and money changed hands.
    if (a.p_ref && a.p_user && a.p_amount !== null && a.p_amount !== undefined) {
      await run(db, `INSERT INTO payment (provider, provider_ref, user_id, plan_id, amount_minor, currency, status, raw_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, 'succeeded', ?, ?) ON CONFLICT (provider, provider_ref) DO NOTHING`,
      a.p_source, a.p_ref, a.p_user, a.p_plan, a.p_amount ?? 0, a.p_currency ?? 'GBP', a.p_raw, t);
    }
    const cur = await first<{ expires_at: number }>(db, 'SELECT expires_at FROM entitlement WHERE email = ?', email);
    const until = a.p_expires ?? Math.max(t, cur?.expires_at ?? t) + Number(plan.days) * 86400;
    await run(db, `INSERT INTO entitlement (email, plan_id, expires_at, source, source_ref, status, created_at, updated_at, manage_url)
      VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?)
      ON CONFLICT (email) DO UPDATE SET
        plan_id = CASE WHEN entitlement.status <> 'active' OR excluded.expires_at >= entitlement.expires_at
                       THEN excluded.plan_id ELSE entitlement.plan_id END,
        source = CASE WHEN entitlement.status <> 'active' OR excluded.expires_at >= entitlement.expires_at
                      THEN excluded.source ELSE entitlement.source END,
        manage_url = CASE WHEN entitlement.status <> 'active' OR excluded.expires_at >= entitlement.expires_at
                          THEN coalesce(excluded.manage_url, entitlement.manage_url) ELSE entitlement.manage_url END,
        expires_at = CASE WHEN entitlement.status <> 'active' THEN excluded.expires_at
                          ELSE max(entitlement.expires_at, excluded.expires_at) END,
        source_ref = coalesce(excluded.source_ref, entitlement.source_ref),
        renew_stopped_at = CASE WHEN excluded.expires_at > entitlement.expires_at THEN NULL ELSE entitlement.renew_stopped_at END,
        status = 'active', updated_at = excluded.updated_at`,
    email, a.p_plan, until, a.p_source, a.p_ref, t, t, a.p_manage_url ?? null);
    return { applied: true, expires_at: until };
  } catch (err) {
    // Not applied, so not remembered as applied: the next delivery or sweep tries again.
    if (a.p_ref) await run(db, 'DELETE FROM entitlement_grant WHERE ref = ?', a.p_ref).catch(() => 0);
    throw err;
  }
}

export async function revokeEntitlement(db: AuthDb, email: string, status: string | null): Promise<Rec> {
  const t = now();
  const n = await run(db, 'UPDATE entitlement SET status = ?, expires_at = min(expires_at, ?), updated_at = ? WHERE email = ?',
    status ?? 'ended', t, t, email.trim().toLowerCase());
  return { applied: n > 0 };
}

export async function stopEntitlementRenewal(db: AuthDb, email: string): Promise<Rec> {
  const t = now();
  await run(db, `UPDATE entitlement SET renew_stopped_at = ?, updated_at = ?
    WHERE email = ? AND status = 'active' AND renew_stopped_at IS NULL`, t, t, email.trim().toLowerCase());
  return { ok: true };
}

/** Whether an earlier period of a Whop membership was granted (refs are `<membership>:<period end>`). */
export async function grantedBefore(db: AuthDb, membershipId: string, current: string): Promise<boolean> {
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(membershipId)) return false;
  return Boolean(await first(db, 'SELECT 1 AS x FROM entitlement_grant WHERE ref LIKE ? AND ref <> ? LIMIT 1', `${membershipId}:%`, current));
}

/* ------------------------------------------- card memberships (Coinflow) */

export interface PaymentArgs {
  p_provider: string; p_ref: string; p_user: string; p_plan: string; p_amount: number; p_currency: string | null;
  p_status: string; p_raw: string; p_origin_ref?: string | null; p_brand?: string | null; p_last4?: string | null;
}

/** record_payment(): a card payment, and the membership it extends. Once per payment. */
export async function recordPayment(db: AuthDb, a: PaymentArgs): Promise<Rec> {
  const t = now();
  const n = await run(db, `INSERT INTO payment (provider, provider_ref, user_id, plan_id, amount_minor, currency, status, raw_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (provider, provider_ref) DO NOTHING`,
  a.p_provider, a.p_ref, a.p_user, a.p_plan, a.p_amount, a.p_currency ?? 'GBP', a.p_status, a.p_raw, t);
  if (!n) return { applied: false, reason: 'already recorded' };
  const plan = await first<{ days: number }>(db, 'SELECT days FROM plan WHERE id = ?', a.p_plan);
  if (!plan) return { applied: false, reason: 'unknown plan' };
  const add = Number(plan.days) * 86400;
  await run(db, `INSERT INTO membership (user_id, plan_id, expires_at, created_at, updated_at, card_brand, card_last4)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (user_id) DO UPDATE SET
      plan_id = excluded.plan_id, expires_at = max(membership.expires_at, ?) + ?,
      cancelled_at = NULL, dunning_from = NULL, attempts = 0,
      card_brand = coalesce(excluded.card_brand, membership.card_brand),
      card_last4 = coalesce(excluded.card_last4, membership.card_last4), updated_at = excluded.updated_at`,
  a.p_user, a.p_plan, t + add, t, t, a.p_brand ?? null, a.p_last4 ?? null, t, add);
  if (a.p_origin_ref) {
    await run(db, `INSERT INTO payment_method (user_id, provider, vault_token, origin_ref, brand, last4, consent_at, consent_terms, created_at, updated_at)
      VALUES (?, ?, '', ?, ?, ?, ?, 'v1', ?, ?)
      ON CONFLICT (user_id) DO UPDATE SET origin_ref = excluded.origin_ref,
        brand = coalesce(excluded.brand, payment_method.brand), last4 = coalesce(excluded.last4, payment_method.last4),
        updated_at = excluded.updated_at`,
    a.p_user, a.p_provider, a.p_origin_ref, a.p_brand ?? null, a.p_last4 ?? null, t, t, t);
  }
  const m = await first<{ expires_at: number }>(db, 'SELECT expires_at FROM membership WHERE user_id = ?', a.p_user);
  return { applied: true, expires_at: m?.expires_at ?? null };
}

export async function revokeMembership(db: AuthDb, provider: string, ref: string, status: string): Promise<Rec> {
  const p = await first<{ user_id: string }>(db, 'SELECT user_id FROM payment WHERE provider = ? AND provider_ref = ?', provider, ref);
  if (!p) return { revoked: false, reason: 'no such payment' };
  const t = now();
  await db.batch([
    db.prepare('UPDATE payment SET status = ? WHERE provider = ? AND provider_ref = ?').bind(status, provider, ref),
    db.prepare(`UPDATE membership SET expires_at = min(expires_at, ?), auto_renew = 0, cancelled_at = ?, updated_at = ?
      WHERE user_id = ?`).bind(t, t, t, p.user_id),
  ]);
  return { revoked: true };
}

/** The card membership's renewal switch, for the account's own row only. */
export async function setAutoRenew(db: AuthDb, userId: string, on: boolean): Promise<void> {
  const t = now();
  await run(db, 'UPDATE membership SET auto_renew = ?, cancelled_at = ?, updated_at = ? WHERE user_id = ?', on ? 1 : 0, on ? null : t, t, userId);
}

/* ------------------------------------------------------ deleting an account */

/**
 * delete_account_data() plus the account itself: everything held about one
 * account removed. Payment records stay for tax, with the processor's payload
 * taken off; the grant ledger keeps its references with the address removed.
 */
export async function deleteAccountData(db: AuthDb, userId: string, email: string | null): Promise<void> {
  const e = (email ?? '').trim().toLowerCase();
  const t = now();
  const had = e && await hadMembership(db, { id: userId, email: e });
  const sts = [
    db.prepare('DELETE FROM follow WHERE user_id = ?').bind(userId),
    db.prepare('DELETE FROM profile WHERE user_id = ?').bind(userId),
    db.prepare('DELETE FROM payment_method WHERE user_id = ?').bind(userId),
    db.prepare('DELETE FROM membership WHERE user_id = ?').bind(userId),
    db.prepare(`UPDATE payment SET raw_json = '{"redacted": true}' WHERE user_id = ?`).bind(userId),
    db.prepare('DELETE FROM auth_session WHERE account_id = ?').bind(userId),
    db.prepare('DELETE FROM account_session WHERE account_id = ?').bind(userId),
    db.prepare('DELETE FROM account WHERE id = ?').bind(userId),
  ];
  if (e) {
    if (had) {
      sts.unshift(db.prepare(`INSERT INTO former_member (email_sha256, at) VALUES (?, ?)
        ON CONFLICT (email_sha256) DO UPDATE SET at = excluded.at`).bind(await sha256Hex(e), t));
    }
    sts.push(
      db.prepare('DELETE FROM entitlement WHERE email = ?').bind(e),
      db.prepare(`UPDATE entitlement_grant SET email = 'deleted' WHERE email = ?`).bind(e),
      db.prepare('DELETE FROM auth_link WHERE email = ?').bind(e),
    );
  }
  await db.batch(sts);
}
