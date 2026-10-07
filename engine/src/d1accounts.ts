/**
 * `db:accounts`: the Supabase accounts (auth.users, auth.identities in the
 * export) loaded into D1's `account` table, for sign-in without Supabase
 * (worker/src/auth.ts, HANDOFF.md stage 2).
 *
 * Each account keeps its Supabase id, so the membership, profile, follow and
 * payment rows already in D1 still point at it. Only the `account` table is
 * touched, and only by upsert: unlike `db:import` this is safe to run while the
 * engine is writing to D1, and running it twice changes nothing.
 *
 * Prints counts, never values: the rows are email addresses.
 */

import { exportRows } from './d1load.ts';
import { batch, migrate, select } from './store.d1.ts';
import { config } from './config.ts';
import { d1Create } from './d1setup.ts';
import { readFileSync } from 'node:fs';

type Rec = Record<string, unknown>;

export interface AccountRow {
  id: string;
  email: string;
  name: string | null;
  avatar_url: string | null;
  provider: string;
  google_sub: string | null;
  created_at: number;
  last_sign_in_at: number | null;
}

/** A Postgres timestamp as exported (ISO or `2026-09-20 10:00:00.1+00`) to unix seconds. */
export function epoch(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Math.floor(v > 1e12 ? v / 1000 : v);
  let s = String(v).trim().replace(' ', 'T');
  if (/[+-]\d{2}$/.test(s)) s += ':00';
  const ms = Date.parse(s);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

const obj = (v: unknown): Rec => {
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch { return {}; } }
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Rec) : {};
};
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** The export's users and identities as `account` rows. Users with no email are left out. */
export function accountRows(users: Rec[], identities: Rec[]): AccountRow[] {
  const google = new Map<string, string>();
  for (const i of identities) {
    if (i.provider !== 'google') continue;
    const sub = str(i.provider_id) ?? str(obj(i.identity_data).sub);
    const user = str(i.user_id);
    if (sub && user) google.set(user, sub);
  }
  const out: AccountRow[] = [];
  const seen = new Set<string>();
  for (const u of users) {
    const id = str(u.id);
    const email = str(u.email)?.toLowerCase() ?? null;
    if (!id || !email || seen.has(email)) continue;
    seen.add(email);
    const meta = obj(u.raw_user_meta_data);
    const app = obj(u.raw_app_meta_data);
    const avatar = str(meta.avatar_url) ?? str(meta.picture);
    out.push({
      id,
      email,
      name: str(meta.full_name) ?? str(meta.name),
      avatar_url: avatar && /^https:\/\//.test(avatar) ? avatar : null,
      provider: str(app.provider) ?? 'email',
      google_sub: google.get(id) ?? null,
      created_at: epoch(u.created_at) ?? Math.floor(Date.now() / 1000),
      last_sign_in_at: epoch(u.last_sign_in_at),
    });
  }
  return out;
}

const COLS = ['id', 'email', 'name', 'avatar_url', 'provider', 'google_sub', 'created_at', 'last_sign_in_at'] as const;

export function upsertStatements(rows: AccountRow[]): Array<{ sql: string; params: unknown[] }> {
  return rows.map((r) => ({
    sql: `INSERT INTO account (${COLS.join(', ')}) VALUES (${COLS.map(() => '?').join(', ')})
          ON CONFLICT (id) DO UPDATE SET
            email = excluded.email,
            name = coalesce(account.name, excluded.name),
            avatar_url = coalesce(account.avatar_url, excluded.avatar_url),
            google_sub = coalesce(account.google_sub, excluded.google_sub),
            last_sign_in_at = max(coalesce(account.last_sign_in_at, 0), coalesce(excluded.last_sign_in_at, 0))`,
    params: COLS.map((c) => r[c]),
  }));
}

export async function d1Accounts(dir = 'export'): Promise<void> {
  if (!config.d1.gateway) (config.d1 as { databaseId: string }).databaseId = await d1Create();
  // The account tables are new; make sure they exist before writing to them.
  await migrate(readFileSync(new URL('../../schema.sql', import.meta.url), 'utf8'));
  const users: Rec[] = [];
  const identities: Rec[] = [];
  for await (const r of exportRows(dir, 'auth.users')) users.push(r);
  for await (const r of exportRows(dir, 'auth.identities')) identities.push(r);
  const rows = accountRows(users, identities);
  console.log(`export: ${users.length} users, ${identities.length} identities; ${rows.length} accounts with an email (${rows.filter((r) => r.google_sub).length} with Google)`);
  if (rows.length) await batch(upsertStatements(rows));
  const [n] = await select<{ n: number }>('SELECT count(*) AS n FROM account');
  // Which accounts' membership rows have an account to sign in to.
  const [orphans] = await select<{ n: number }>(
    'SELECT count(*) AS n FROM membership m WHERE NOT EXISTS (SELECT 1 FROM account a WHERE a.id = m.user_id)');
  console.log(`D1: ${n?.n ?? '?'} accounts; memberships with no account: ${orphans?.n ?? '?'}`);
}
