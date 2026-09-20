/**
 * The subscription engine.
 *
 * No processor is renting us this. Coinflow holds the card and charges it when
 * asked; every decision about when to ask, what happens on a decline, how long
 * somebody keeps access while their card is being sorted out, and when to stop
 * trying is made here, in about a hundred lines, because those are product
 * decisions and not billing infrastructure.
 *
 * It runs as a daily workflow on exactly the pattern the rest of the engine
 * already uses -- the same command shape, the same store layer, the same
 * credentials. GitHub Actions has been this project's cron since the beginning.
 *
 * TWO RULES THAT COST MONEY IF THEY ARE WRONG.
 *
 * Never charge twice. Every attempt writes its `payment` row first, under a
 * deterministic reference of `renew:<user>:<period end>`, so a workflow that
 * fires twice -- a manual dispatch racing the schedule, a retried job -- is
 * stopped by the unique index before the card is touched rather than after.
 *
 * Never cut someone off on the first decline. A card that expired on a Tuesday
 * should not cost somebody their Saturday. Access continues through the dunning
 * window; only when the window closes does the membership lapse, and it lapses
 * by simply running out rather than by being taken away.
 */

import { exec, select } from '../store.ts';

/** When to try again after a decline, in days since the first failure. */
const DUNNING_DAYS = [0, 2, 5] as const;

/** How long access continues while a payment is being retried. */
const GRACE_DAYS = 7;

/** Charge a card the reader authorised at checkout. */
export interface Charger {
  (args: { userId: string; originalPaymentId: string; amountMinor: number; currency: string }): Promise<string>;
}

interface Due {
  user_id: string;
  plan_id: string;
  expires_at: number;
  attempts: number;
  dunning_from: number | null;
  origin_ref: string | null;
  amount_minor: number;
  currency: string;
  days: number;
}

export interface RenewReport {
  due: number;
  renewed: number;
  declined: number;
  abandoned: number;
  skipped: number;
}

/**
 * Memberships worth charging today.
 *
 * Inside 24 hours of expiry, still renewing, not cancelled, and with a card on
 * file. A membership with no `origin_ref` cannot be charged at all -- it was
 * bought before the card was saved, or the processor never gave us a reference
 * -- so it is left alone to lapse rather than repeatedly failing.
 */
export async function findDue(now: number): Promise<Due[]> {
  return select<Due>(
    `SELECT m.user_id, m.plan_id, m.expires_at, m.attempts, m.dunning_from,
            pm.origin_ref, p.amount_minor, p.currency, p.days
     FROM membership m
     JOIN plan p ON p.id = m.plan_id AND p.active = 1
     LEFT JOIN payment_method pm ON pm.user_id = m.user_id
     WHERE m.auto_renew = 1
       AND m.cancelled_at IS NULL
       AND m.expires_at <= ?
       AND m.expires_at > ?`,
    [now + 86_400, now - GRACE_DAYS * 86_400],
  );
}

/** Is today a day we should be retrying this one? */
export function dueToday(row: Due, now: number): boolean {
  if (row.attempts === 0) return true;
  if (row.attempts >= DUNNING_DAYS.length) return false;
  const since = (now - (row.dunning_from ?? now)) / 86_400;
  return since >= DUNNING_DAYS[row.attempts]!;
}

/**
 * Run one pass.
 *
 * The charger is injected so this can be tested without a processor and so the
 * engine never learns a provider's name -- the same seam the Worker uses. A
 * failure against one member is logged and stepped over; one dead card must not
 * stop everybody else's renewal.
 */
export async function renewDue(charge: Charger, now = Math.floor(Date.now() / 1000)): Promise<RenewReport> {
  const rows = await findDue(now);
  const report: RenewReport = { due: rows.length, renewed: 0, declined: 0, abandoned: 0, skipped: 0 };

  for (const row of rows) {
    if (!row.origin_ref || !dueToday(row, now)) { report.skipped++; continue; }

    // The period this attempt is paying for. Part of the reference, so a second
    // run on the same day collides and a genuine renewal next month does not.
    const periodEnd = row.expires_at;
    const ref = `renew:${row.user_id}:${periodEnd}`;

    // Claimed before the card is touched. If this insert loses a race it throws
    // on the unique index, and the catch below treats that as "somebody else is
    // already doing it" rather than as a decline.
    try {
      await exec(
        `INSERT INTO payment (provider, provider_ref, user_id, plan_id, amount_minor, currency, status, raw_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ['coinflow', ref, row.user_id, row.plan_id, row.amount_minor, row.currency, 'pending', '{}', now],
      );
    } catch {
      report.skipped++;
      continue;
    }

    try {
      const paymentId = await charge({
        userId: row.user_id,
        originalPaymentId: row.origin_ref,
        amountMinor: row.amount_minor,
        currency: row.currency,
      });

      await exec(`UPDATE payment SET status = ?, raw_json = ? WHERE provider_ref = ?`,
        ['paid', JSON.stringify({ paymentId }), ref]);
      await exec(
        `UPDATE membership
         SET expires_at = ? , attempts = 0, dunning_from = NULL, updated_at = ?
         WHERE user_id = ?`,
        [Math.max(periodEnd, now) + row.days * 86_400, now, row.user_id],
      );
      report.renewed++;
    } catch (err) {
      const attempts = row.attempts + 1;
      const done = attempts >= DUNNING_DAYS.length;

      await exec(`UPDATE payment SET status = ?, raw_json = ? WHERE provider_ref = ?`,
        ['declined', JSON.stringify({ error: String(err).slice(0, 300) }), ref]);

      // Giving up switches renewal off and leaves the expiry where it is. The
      // membership then lapses on its own, which is a different thing from
      // being cut off and reads that way on the account page.
      await exec(
        `UPDATE membership
         SET attempts = ?, dunning_from = ?, auto_renew = ?, updated_at = ?
         WHERE user_id = ?`,
        [attempts, row.dunning_from ?? now, done ? 0 : 1, now, row.user_id],
      );

      if (done) report.abandoned++; else report.declined++;
      console.warn(`renew: ${row.user_id} declined (attempt ${attempts}${done ? ', giving up' : ''})`);
    }
  }

  return report;
}

/**
 * The provider call.
 *
 * Deliberately a near-copy of worker/src/coinflow.ts rather than a shared
 * module. The two run on different runtimes with different build setups, and
 * the contract being duplicated is one endpoint and four fields -- which is a
 * smaller cost than a cross-workspace import that only one of the two
 * toolchains understands. If a third caller ever appears, extract it then.
 */
export function coinflowCharger(): Charger {
  const apiKey = process.env['COINFLOW_API_KEY'] ?? '';
  const base = process.env['COINFLOW_BASE_URL'] ?? 'https://api-sandbox.coinflow.cash';
  const wallet = process.env['COINFLOW_WALLET'] ?? '';
  const blockchain = process.env['COINFLOW_BLOCKCHAIN'] ?? 'solana';
  if (!apiKey) throw new Error('COINFLOW_API_KEY is required to charge a card.');

  return async ({ userId, originalPaymentId, amountMinor, currency }) => {
    const res = await fetch(`${base}/api/checkout/merchant-initiated-transaction`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: apiKey,
        'x-coinflow-auth-user-id': userId,
        'x-coinflow-auth-wallet': wallet,
        'x-coinflow-auth-blockchain': blockchain,
      },
      body: JSON.stringify({
        subtotal: { cents: amountMinor, currency },
        originalPaymentId,
        statementDescriptor: 'offside.win',
      }),
      signal: AbortSignal.timeout(30_000),
    });

    const text = await res.text();
    if (!res.ok) throw new Error(`coinflow ${res.status}: ${text.slice(0, 200)}`);
    const id = (JSON.parse(text) as { paymentId?: string }).paymentId;
    if (!id) throw new Error('coinflow returned no payment id');
    return id;
  };
}
