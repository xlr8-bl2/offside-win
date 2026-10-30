/**
 * `cf:usage`: what the site uses on Cloudflare, day by day, against the free
 * plan's limits (owner, 30 October: the Workers Paid plan lapsed).
 *
 * Reads the account's analytics (GraphQL) for the last seven days: Worker
 * requests and CPU time per request, and D1 rows read and written. Then the
 * database's size. Prints numbers only; nothing here is secret.
 */

import { config } from './config.ts';
import { d1Create } from './d1setup.ts';

const API = 'https://api.cloudflare.com/client/v4';

const FREE = { requests: 100_000, cpuMs: 10, rowsRead: 5_000_000, rowsWritten: 100_000, dbBytes: 500 * 1024 * 1024 };

async function gql(token: string, query: string, variables: Record<string, unknown>): Promise<any> {
  const res = await fetch(`${API}/graphql`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  const body = await res.json().catch(() => null) as any;
  if (!res.ok || body?.errors?.length) throw new Error(`analytics: ${res.status} ${JSON.stringify(body?.errors ?? []).slice(0, 300)}`);
  return body.data;
}

const pct = (v: number, lim: number) => `${Math.round((v / lim) * 100)}%`;

export async function cfUsage(): Promise<void> {
  const { accountId, token } = config.d1;
  if (!accountId || !token) throw new Error('CF_ACCOUNT_ID and CF_API_TOKEN must be set');
  const until = new Date();
  const since = new Date(until.getTime() - 7 * 86400_000);
  const day = (d: Date) => d.toISOString().slice(0, 10);

  const plan = await fetch(`${API}/accounts/${accountId}/workers/account-settings`, { headers: { authorization: `Bearer ${token}` } })
    .then((r) => r.json()).catch(() => null) as any;
  console.log(`workers account settings: ${JSON.stringify(plan?.result ?? plan?.errors ?? null).slice(0, 200)}`);

  const w = await gql(token, `query($a: String!, $s: Date!, $u: Date!) { viewer { accounts(filter: {accountTag: $a}) {
    workersInvocationsAdaptive(limit: 1000, filter: {date_geq: $s, date_leq: $u}) {
      sum { requests errors subrequests } quantiles { cpuTimeP50 cpuTimeP99 } dimensions { date scriptName status } } } } }`,
    { a: accountId, s: day(since), u: day(until) });
  const rows = (w?.viewer?.accounts?.[0]?.workersInvocationsAdaptive ?? []) as any[];
  const byDay = new Map<string, { req: number; err: number; p50: number[]; p99: number[]; status: Record<string, number> }>();
  for (const r of rows) {
    const d = byDay.get(r.dimensions.date) ?? { req: 0, err: 0, p50: [], p99: [], status: {} };
    d.req += r.sum.requests; d.err += r.sum.errors;
    d.p50.push(r.quantiles.cpuTimeP50); d.p99.push(r.quantiles.cpuTimeP99);
    d.status[r.dimensions.status] = (d.status[r.dimensions.status] ?? 0) + r.sum.requests;
    byDay.set(r.dimensions.date, d);
  }
  console.log('\nWorker, per day (free plan: 100,000 requests, 10 ms CPU each):');
  for (const [d, v] of [...byDay].sort()) {
    const p50 = Math.max(...v.p50) / 1000, p99 = Math.max(...v.p99) / 1000;
    console.log(`  ${d}  requests ${v.req} (${pct(v.req, FREE.requests)})  errors ${v.err}  CPU p50 ${p50.toFixed(1)} ms  p99 ${p99.toFixed(1)} ms  ${JSON.stringify(v.status)}`);
  }

  const dbId = await d1Create();
  const d = await gql(token, `query($a: String!, $s: Date!, $u: Date!, $db: String!) { viewer { accounts(filter: {accountTag: $a}) {
    d1AnalyticsAdaptiveGroups(limit: 100, filter: {date_geq: $s, date_leq: $u, databaseId: $db}) {
      sum { readQueries writeQueries rowsRead rowsWritten } dimensions { date } } } } }`,
    { a: accountId, s: day(since), u: day(until), db: dbId });
  console.log('\nD1, per day (free plan: 5,000,000 rows read, 100,000 rows written):');
  for (const g of ((d?.viewer?.accounts?.[0]?.d1AnalyticsAdaptiveGroups ?? []) as any[]).sort((a, b) => a.dimensions.date.localeCompare(b.dimensions.date))) {
    const s = g.sum;
    console.log(`  ${g.dimensions.date}  queries ${s.readQueries + s.writeQueries}  rows read ${s.rowsRead} (${pct(s.rowsRead, FREE.rowsRead)})  rows written ${s.rowsWritten} (${pct(s.rowsWritten, FREE.rowsWritten)})`);
  }

  const info = await fetch(`${API}/accounts/${accountId}/d1/database/${dbId}`, { headers: { authorization: `Bearer ${token}` } })
    .then((r) => r.json()).catch(() => null) as any;
  const bytes = Number(info?.result?.file_size ?? 0);
  console.log(`\nD1 size: ${(bytes / 1e6).toFixed(0)} MB (free plan: 500 MB a database, ${pct(bytes, FREE.dbBytes)})`);
}
