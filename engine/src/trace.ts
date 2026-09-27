/**
 * Whose account a leaked call came from.
 *
 * #/trace reads the invisible code a member's copied call carries: the first
 * eight characters of their account id. This finds the account. The log is
 * public, so it prints the email masked (a****@gmail.com), when the account
 * was made, its username and its membership: enough to match it in Whop and
 * act, and nothing that identifies a person to anyone else.
 */

import { select } from './store.ts';

function mask(email: string | null): string {
  if (!email) return 'no email';
  const [user, domain] = email.split('@');
  return `${(user ?? '').slice(0, 1)}${'*'.repeat(Math.max(3, (user ?? '').length - 1))}@${domain ?? ''}`;
}

export async function trace(code: string | undefined): Promise<void> {
  const c = String(code ?? '').toLowerCase().replace(/[^0-9a-f]/g, '');
  if (c.length < 6) throw new Error('trace needs the code #/trace shows: eight letters and numbers, 0-9 and a-f');
  const rows = await select<{ id: string; email: string | null; created_at: string | null; username: string | null;
    plan: string | null; until: number | null }>(
    `SELECT u.id::text AS id, u.email, u.created_at::text AS created_at, p.username,
            coalesce(m.plan_id, e.plan_id) AS plan, coalesce(m.expires_at, e.expires_at) AS until
     FROM auth.users u
     LEFT JOIN profile p ON p.user_id = u.id
     LEFT JOIN membership m ON m.user_id = u.id
     LEFT JOIN entitlement e ON lower(e.email) = lower(u.email)
     WHERE replace(u.id::text, '-', '') LIKE ?`,
    [`${c}%`],
  );
  if (!rows.length) { console.log(`No account's id starts ${c}.`); return; }
  for (const r of rows) {
    const until = r.until ? new Date(Number(r.until) * 1000).toISOString().slice(0, 10) : null;
    console.log(`account ${r.id.slice(0, 13)}…  email ${mask(r.email)}  username ${r.username ? `@${r.username}` : 'none'}  `
      + `joined ${String(r.created_at ?? '').slice(0, 10)}  membership ${r.plan ? `${r.plan} to ${until}` : 'none'}`);
  }
}
