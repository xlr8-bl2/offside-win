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
 */

import { exec, select } from './store.ts';

export async function grant(email: string, arg: string | undefined): Promise<void> {
  const target = String(email ?? '').trim().toLowerCase();
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
