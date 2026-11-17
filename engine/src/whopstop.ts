/**
 * `whop:stop` — stop every Whop membership renewing, now that the site is free
 * (owner, 17 November 2026). Nobody should be charged again for a free site.
 *
 * Each renewing membership is cancelled at the end of the time already paid
 * for (Whop's `at_period_end`), so nobody loses anything they paid for and
 * nobody is charged again. Nothing is refunded and nothing is deleted.
 *
 * Without the argument `confirm` it only counts. Prints counts and Whop's
 * status codes, never names, emails or ids: the logs are public.
 */

type Rec = Record<string, unknown>;
const asRec = (v: unknown): Rec | null => (v && typeof v === 'object' && !Array.isArray(v) ? v as Rec : null);

const BASE = 'https://api.whop.com/api/v1';

async function allMemberships(key: string, company: string): Promise<Rec[]> {
  const out: Rec[] = [];
  let after: string | null = null;
  for (let page = 0; page < 50; page++) {
    const q = new URLSearchParams({ account_id: company, first: '100' });
    if (after) q.set('after', after);
    const res = await fetch(`${BASE}/memberships?${q}`, { headers: { authorization: `Bearer ${key}`, accept: 'application/json' } });
    if (!res.ok) throw new Error(`Whop refused the membership list (${res.status})`);
    const body = asRec(await res.json()) ?? {};
    for (const m of Array.isArray(body['data']) ? body['data'] : []) { const r = asRec(m); if (r) out.push(r); }
    const info = asRec(body['page_info']);
    after = info?.['has_next_page'] && typeof info['end_cursor'] === 'string' ? info['end_cursor'] : null;
    if (!after) break;
  }
  return out;
}

/** Still going to take money: live, and not already set to stop. */
export function renewing(m: Rec): boolean {
  return /^(active|trialing|past_due)$/.test(String(m['status'] ?? '').toLowerCase()) && m['cancel_at_period_end'] !== true;
}

export async function whopStop(arg: string): Promise<void> {
  const key = process.env['WHOP_API_KEY'] ?? '';
  const company = process.env['WHOP_COMPANY_ID'] ?? '';
  if (!key) throw new Error('WHOP_API_KEY is not set in Actions secrets');
  if (!company) throw new Error('WHOP_COMPANY_ID is not set');
  const all = await allMemberships(key, company);
  const due = all.filter(renewing);
  const byStatus = new Map<string, number>();
  for (const m of all) byStatus.set(String(m['status'] ?? 'unknown'), (byStatus.get(String(m['status'] ?? 'unknown')) ?? 0) + 1);
  console.log(`Whop memberships: ${all.length} in all (${[...byStatus].map(([s, n]) => `${n} ${s}`).join(', ') || 'none'}).`);
  console.log(`Still set to renew: ${due.length}.`);
  if (arg.trim() !== 'confirm') {
    console.log('Counted only. Run again with the argument "confirm" to stop them renewing.');
    return;
  }
  let stopped = 0;
  const failed = new Map<number, number>();
  for (const m of due) {
    const res = await fetch(`${BASE}/memberships/${encodeURIComponent(String(m['id']))}/cancel`, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ cancellation_mode: 'at_period_end' }),
    });
    if (res.ok) stopped++;
    else failed.set(res.status, (failed.get(res.status) ?? 0) + 1);
  }
  console.log(`Stopped renewing: ${stopped} of ${due.length}. Each runs to the end of the time already paid for.`);
  if (failed.size) {
    console.log(`Refused: ${[...failed].map(([s, n]) => `${n} with ${s}`).join(', ')}.`);
    process.exitCode = 1;
  }
}
