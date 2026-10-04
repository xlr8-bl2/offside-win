/**
 * Comp a membership.
 *
 * The owner's way of seeing the paid side of the site from their own account,
 * and later the way to give one to a friend, a reviewer or a refund case. No
 * payment row, because none happened; the account page says "complimentary"
 * where it would say the card.
 *
 *   npm run grant -- someone@example.com            (ten years)
 *   npm run grant -- someone@example.com 30          (thirty days)
 *   npm run grant -- someone@example.com off         (revoke)
 *   npm run grant -- all off                          (revoke every membership)
 */

import { cancelWhopAtPeriodEnd } from '../../worker/src/whop.ts';
import { exec, select } from './store.ts';

/**
 * End every membership on the site, however it was given, and stop every Whop
 * subscription renewing so none of them takes money or comes back. For clearing
 * the owner's test accounts before launch. Prints counts only: the repo is
 * public, so its logs never carry an email.
 */
async function endAll(): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const comp = await select(
    `UPDATE membership SET expires_at = ?, auto_renew = 0, cancelled_at = coalesce(cancelled_at, ?), updated_at = ?
      WHERE expires_at > ? RETURNING 1`,
    [now, now, now, now],
  );
  const bought = await select(
    `UPDATE entitlement SET status = 'ended', expires_at = least(expires_at, ?), renew_stopped_at = coalesce(renew_stopped_at, ?), updated_at = ?
      WHERE status = 'active' AND expires_at > ? RETURNING 1`,
    [now, now, now, now],
  );
  console.log(`Memberships ended: ${comp.length} on the site, ${bought.length} bought through checkout.`);

  const key = process.env['WHOP_API_KEY'] ?? '';
  const company = process.env['WHOP_COMPANY_ID'] ?? '';
  if (!key || !company) { console.log('Whop not configured; no subscriptions to stop.'); return; }
  let after: string | null = null, live = 0, stopped = 0, failed = 0;
  for (let page = 0; page < 20; page++) {
    const q = new URLSearchParams({ account_id: company, first: '100', created_after: '2020-01-01T00:00:00Z' });
    if (after) q.set('after', after);
    const res = await fetch(`https://api.whop.com/api/v1/memberships?${q}`, { headers: { authorization: `Bearer ${key}`, accept: 'application/json' } });
    if (!res.ok) throw new Error(`Whop memberships list: ${res.status}. The site's memberships are ended; Whop's are not.`);
    const body = await res.json() as { data?: Array<Record<string, unknown>>; page_info?: { has_next_page?: boolean; end_cursor?: string } };
    for (const m of body.data ?? []) {
      if (!/^(active|trialing|past_due)$/i.test(String(m['status'] ?? ''))) continue;
      live++;
      if (m['cancel_at_period_end'] === true || typeof m['id'] !== 'string') continue;
      const code = await cancelWhopAtPeriodEnd(key, m['id']);
      if (code < 400) stopped++; else { failed++; console.log('  could not stop one:', code); }
    }
    after = body.page_info?.has_next_page ? body.page_info.end_cursor ?? null : null;
    if (!after) break;
  }
  console.log(`Whop: ${live} still running, ${stopped} stopped from renewing now${failed ? `, ${failed} failed` : ''}.`);
  if (failed) throw new Error('Some Whop subscriptions are still renewing.');
}

export async function grant(email: string, arg: string | undefined): Promise<void> {
  const target = String(email ?? '').trim().toLowerCase();
  if (target === 'all') {
    if (arg !== 'off') throw new Error('Only "all off" works on every account: comping everyone is not a thing.');
    return endAll();
  }
  if (!target.includes('@')) throw new Error('grant needs an email address: npm run grant -- you@example.com');

  const [user] = await select<{ id: string }>(
    'SELECT id FROM auth.users WHERE lower(email) = ? LIMIT 1',
    [target],
  );
  if (!user) throw new Error(`No account has signed in as ${target} yet. Sign in on the site once, then run this again.`);

  const now = Math.floor(Date.now() / 1000);
  if (arg === 'off') {
    await exec('UPDATE membership SET expires_at = ?, auto_renew = 0, updated_at = ? WHERE user_id = ?', [now, now, user.id]);
    console.log(`Membership for ${target} ended.`);
    return;
  }

  const days = arg && /^\d+$/.test(arg) ? Number(arg) : 3650;
  const [plan] = await select<{ id: string }>('SELECT id FROM plan WHERE active = 1 ORDER BY sort LIMIT 1');
  await exec(
    `INSERT INTO membership (user_id, plan_id, expires_at, created_at, updated_at, card_brand, card_last4)
     VALUES (?, ?, ?, ?, ?, 'complimentary', NULL)
     ON CONFLICT (user_id) DO UPDATE SET
       expires_at = greatest(membership.expires_at, excluded.expires_at),
       cancelled_at = NULL, dunning_from = NULL, attempts = 0,
       card_brand = 'complimentary', updated_at = excluded.updated_at`,
    [user.id, plan?.id ?? 'monthly', now + days * 86400, now, now],
  );
  console.log(`Membership for ${target}: ${days} days, complimentary.`);
}

/**
 * Attach a checkout link to a plan, or change a price, from the pg workflow.
 *
 *   npm run plans -- matchday https://whop.com/checkout/plan_xxx
 *   npm run plans -- season 4900
 *   npm run plans                                  (list what is for sale)
 */
export async function plans(id: string | undefined, value: string | undefined): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  if (id && value) {
    if (/^https?:\/\//.test(value)) {
      await exec('UPDATE plan SET checkout_url = ?, updated_at = ? WHERE id = ?', [value, now, id]);
    } else if (/^\d+$/.test(value)) {
      await exec('UPDATE plan SET amount_minor = ?, updated_at = ? WHERE id = ?', [Number(value), now, id]);
    } else {
      throw new Error('plans takes a plan id and either a checkout URL or a price in pence: "season https://whop.com/checkout/plan_x" or "season 4900"');
    }
  }
  const rows = await select<{ id: string; name: string; days: number; amount_minor: number; currency: string; checkout_url: string | null }>(
    'SELECT id, name, days, amount_minor, currency, checkout_url FROM plan WHERE active = 1 ORDER BY sort',
  );
  for (const r of rows) {
    console.log(`${r.id.padEnd(9)} ${r.name.padEnd(14)} ${String(r.days).padStart(3)} days  ${(r.amount_minor / 100).toFixed(2)} ${r.currency}  ${r.checkout_url ?? '(no checkout link yet)'}`);
  }
}
