/**
 * The sports provider's allowance, shared: who may ask, in what order, and
 * how much an hour.
 *
 * The free plan is 7,500 requests in any 24 hours, for the engine's jobs and
 * this Worker together. On 3 November 2026 it ran out at about 19:50 UTC,
 * before the evening's games ended, so nothing could read their final scores
 * and every call that night stayed ungraded. Each engine job already stopped
 * at its own floor (BSD_RESERVE); the Worker had none, and did not know what
 * the engine had seen.
 *
 * Now every user of the allowance has a priority, written as a floor: it asks
 * only while more than that many requests are left. Results come first and
 * have no floor; nothing else may spend the last few hundred.
 *
 *   results  0      full-time scores (fulltime.ts; the engine's settle score reads)
 *   live     400    the live scores list (live.ts)
 *   changes  1,500  kick-offs moved and matches called off (live.ts)
 *   slate    1,800  the engine's analysis (slate.yml BSD_RESERVE)
 *   other    2,500  history, reports and the rest (engine default)
 *   ratings  3,000  the nightly refit (ratings.yml)
 *
 * The Worker's uses also have an hourly budget (HOURLY), counted for the
 * whole site in kv `bsd:worker`, so no feature can run away with the
 * allowance however many readers or data centres there are.
 *
 * What is left is shared in kv `bsd:left` ({n, at, by}): every provider
 * answer carries the figure (`RateLimit: ...;r=<n>`), and whichever side saw
 * it last writes it, so the Worker knows what the engine has spent and the
 * engine's jobs start from what the Worker saw (engine/src/allowance.ts).
 */

export type Use = 'results' | 'live' | 'changes';

/** Asks only while more than this many requests are left. */
export const FLOOR: Record<Use, number> = { results: 0, live: 400, changes: 1500 };
/** At most this many requests an hour, for the whole site. */
export const HOURLY: Record<Use, number> = { results: 45, live: 40, changes: 30 };
/** How long a figure for what is left is trusted. */
const FRESH = 30 * 60;

export interface AllowanceDb {
  prepare(sql: string): { bind(...v: unknown[]): { first<T>(): Promise<T | null>; run(): Promise<unknown> } };
}

export interface Left { n: number; at: number; by: string }
interface Ledger { hour: number; used: Partial<Record<Use, number>> }

const hourOf = (t: number) => Math.floor(t / 3600);

async function kvGet<T>(db: AllowanceDb, k: string): Promise<T | null> {
  try {
    const r = await db.prepare('SELECT v FROM kv WHERE k = ?').bind(k).first<{ v: string }>();
    return r?.v ? (JSON.parse(r.v) as T) : null;
  } catch { return null; }
}
function kvPut(db: AllowanceDb, k: string, v: unknown, t: number): Promise<unknown> {
  return db.prepare(`INSERT INTO kv (k, v, expires_at, updated_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(k) DO UPDATE SET v = excluded.v, expires_at = excluded.expires_at, updated_at = excluded.updated_at`)
    .bind(k, JSON.stringify(v), t + 2 * 86400, t).run();
}

/** What is left, as last seen by anyone, or null when nobody has looked in the last half hour. */
export async function lastLeft(db: AllowanceDb, t = Math.floor(Date.now() / 1000)): Promise<Left | null> {
  const v = await kvGet<Left>(db, 'bsd:left');
  return v && Number.isFinite(v.n) && t - Number(v.at) < FRESH ? v : null;
}

/** Whether `use` may ask the provider now: above its floor, and inside its hour's budget. */
export async function mayAsk(db: AllowanceDb | undefined, use: Use, t = Math.floor(Date.now() / 1000)): Promise<boolean> {
  if (!db) return true;
  const left = await lastLeft(db, t);
  if (left && left.n <= FLOOR[use]) return false;
  const ledger = await kvGet<Ledger>(db, 'bsd:worker');
  const used = ledger && ledger.hour === hourOf(t) ? Number(ledger.used[use] ?? 0) : 0;
  return used < HOURLY[use];
}

/** The figure from one provider answer's headers, or null when it carried none. */
export function leftFrom(res: { status: number; headers: { get(k: string): string | null } }): number | null {
  const r = /;r=(\d+)/.exec(res.headers.get('ratelimit') ?? '');
  if (r) return Number(r[1]);
  return res.status === 429 ? 0 : null;
}

/** Count `n` requests made for `use`, and share what the provider said is left. */
export async function spent(db: AllowanceDb | undefined, use: Use, n: number, left: number | null, t = Math.floor(Date.now() / 1000)): Promise<void> {
  if (!db || n <= 0) return;
  try {
    const ledger = await kvGet<Ledger>(db, 'bsd:worker');
    const now: Ledger = ledger && ledger.hour === hourOf(t) ? ledger : { hour: hourOf(t), used: {} };
    now.used[use] = Number(now.used[use] ?? 0) + n;
    await kvPut(db, 'bsd:worker', now, t);
    if (left !== null) await kvPut(db, 'bsd:left', { n: left, at: t, by: `worker:${use}` } satisfies Left, t);
  } catch { /* counting is best effort; the floors still hold */ }
}
