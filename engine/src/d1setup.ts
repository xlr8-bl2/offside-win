/**
 * `d1:create`: the site's D1 database, found or made.
 *
 * Looks for a database named `offside` on the account (CF_ACCOUNT_ID) and
 * creates it if there is none. Prints its id, which is not a secret: it
 * identifies the database to the account's own token and nothing else, and it
 * is committed in worker/wrangler.toml. Under Actions it is also written to
 * $GITHUB_ENV as CF_D1_DATABASE_ID, so the steps after it in the same job
 * (db:import) reach the same database.
 *
 * The September database (the CF_D1_DATABASE_ID secret) is left alone: it
 * holds a month-old copy in an older schema, and nothing reads it.
 */

import { appendFileSync } from 'node:fs';
import { config } from './config.ts';

export const D1_NAME = 'offside';
const API = 'https://api.cloudflare.com/client/v4';

export async function d1Create(): Promise<string> {
  const { accountId, token } = config.d1;
  if (!accountId || !token) throw new Error('CF_ACCOUNT_ID and CF_API_TOKEN must be set');
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  const list = await fetch(`${API}/accounts/${accountId}/d1/database?name=${D1_NAME}&per_page=50`, { headers });
  const body = await list.json().catch(() => null) as { success?: boolean; result?: Array<{ uuid: string; name: string }>; errors?: Array<{ message: string }> } | null;
  if (!list.ok || !body?.success) throw new Error(`cannot list D1 databases (${list.status}): ${JSON.stringify(body?.errors?.map((e) => e.message) ?? []).slice(0, 200)}. The token needs Account > D1 > Edit.`);
  let id = body.result?.find((d) => d.name === D1_NAME)?.uuid;
  if (id) console.log(`D1 database "${D1_NAME}" exists: ${id}`);
  else {
    const made = await fetch(`${API}/accounts/${accountId}/d1/database`, { method: 'POST', headers, body: JSON.stringify({ name: D1_NAME, primary_location_hint: 'weur' }) });
    const m = await made.json().catch(() => null) as { success?: boolean; result?: { uuid: string }; errors?: Array<{ message: string }> } | null;
    if (!made.ok || !m?.success || !m.result?.uuid) throw new Error(`cannot create the D1 database (${made.status}): ${JSON.stringify(m?.errors?.map((e) => e.message) ?? []).slice(0, 200)}`);
    id = m.result.uuid;
    console.log(`D1 database "${D1_NAME}" created: ${id}`);
  }
  if (process.env['GITHUB_ENV']) appendFileSync(process.env['GITHUB_ENV'], `CF_D1_DATABASE_ID=${id}\n`);
  return id;
}
