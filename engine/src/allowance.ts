import { config } from './config.ts';
import { quota } from './bsd.ts';
import { kvGetJSON, kvSetJSON } from './store.ts';

/**
 * The provider's allowance, shared with the Worker (worker/src/allowance.ts,
 * which has the whole order of priorities).
 *
 * Each job stops asking at its own floor (BSD_RESERVE), but it only learns
 * where the allowance stands from its own first answer, and the Worker never
 * learnt it at all. Now the last figure anyone saw is kept in kv `bsd:left`:
 * a job starts from it (so one starting below its floor asks for nothing),
 * and writes back what it saw when it is done.
 */

/** How long a figure is trusted. */
const FRESH = 30 * 60;

interface Left { n: number; at: number; by: string }

/** Start from the last figure anyone saw, when it is recent. */
export async function syncAllowance(now = Math.floor(Date.now() / 1000)): Promise<number | null> {
  const v = await kvGetJSON<Left>('bsd:left').catch(() => null);
  if (!v || !Number.isFinite(v.n) || now - Number(v.at) >= FRESH) return null;
  quota.remaining = v.n;
  // Above the floor again: the window rolls, so what was spent a day ago is back.
  if (v.n > config.bsd.reserve) quota.exhausted = false;
  return v.n;
}

/** Share what this job last saw. */
export async function shareAllowance(job: string, now = Math.floor(Date.now() / 1000)): Promise<void> {
  if (quota.remaining === null) return;
  await kvSetJSON('bsd:left', { n: quota.remaining, at: now, by: job } satisfies Left).catch(() => {});
}
