/**
 * Quiet days, given back.
 *
 * When the club game stops (an international break, the close season) the
 * board thins out, and a member paying by the month gets fewer calls for the
 * same money. So every paying member gets a day added for every quiet day,
 * without asking. Once a day, from the Worker's cron, for the day before:
 *
 *   1. goodwill_credit(day) decides whether it was quiet (schema.pg.sql:
 *      inside a run of four or more days with no Champions League or big-five
 *      match) and credits it, once. Card memberships are extended there.
 *   2. A Whop subscription that renews is billed by Whop, so extending our
 *      date alone would be undone at the next renewal: Whop is asked to move
 *      the renewal back a day (add_free_days), and the new period is recorded
 *      so the sweep does not take it for a payment.
 *   3. The first quiet day of a run gets an email saying what is happening;
 *      the first ordinary day after it, one with the total.
 *
 * Everything here is idempotent: run it twice and nothing is credited twice.
 */

import { goodwillEndMail, goodwillStartMail, sendMail, type MailEnv } from './mail.ts';
import { ukMidnight } from './landing.ts';

export interface GoodwillEnv extends MailEnv {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  SUPABASE_SERVICE_KEY?: string;
  WHOP_API_KEY?: string;
}

type Rec = Record<string, any>;

async function rpc(env: GoodwillEnv, fn: string, args: Record<string, unknown>): Promise<any> {
  const res = await fetch(new URL(`/rest/v1/rpc/${fn}`, env.SUPABASE_URL), {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_ANON_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      'content-type': 'application/json', accept: 'application/json',
    },
    body: JSON.stringify(args),
  });
  if (!res.ok) throw new Error(`${fn}: database ${res.status}`);
  return res.json();
}

const toEpoch = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return v > 1e12 ? Math.floor(v / 1000) : Math.floor(v);
  if (typeof v === 'string' && v.trim()) {
    if (/^\d+$/.test(v.trim())) return toEpoch(Number(v));
    const t = Date.parse(v);
    return Number.isFinite(t) ? Math.floor(t / 1000) : null;
  }
  return null;
};

/** Ask Whop to move a membership's renewal back a day. The new period end, or null. */
export async function whopAddDay(apiKey: string, membership: string): Promise<number | null> {
  const res = await fetch(`https://api.whop.com/api/v1/memberships/${encodeURIComponent(membership)}/add_free_days`, {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ free_days: 1 }),
  });
  if (!res.ok) {
    console.error('goodwill: whop refused', res.status);
    return null;
  }
  const m = await res.json().catch(() => null) as Rec | null;
  return toEpoch(m?.['renewal_period_end']) ?? toEpoch(m?.['expires_at']) ?? 0;
}

export interface GoodwillOutcome { day: number; lean: boolean; whop: number; started: number; ended: number; errors: number }

/** Credit yesterday (UK), move Whop renewals, send the emails. */
export async function goodwill(env: GoodwillEnv, now = Math.floor(Date.now() / 1000)): Promise<GoodwillOutcome> {
  const day = ukMidnight(now, -1);
  const out: GoodwillOutcome = { day, lean: false, whop: 0, started: 0, ended: 0, errors: 0 };
  if (!env.SUPABASE_SERVICE_KEY) return out;

  const r = await rpc(env, 'goodwill_credit', { p_day: day });
  out.lean = Boolean(r?.lean);

  if (out.lean) {
    // Whop renewals, this day's and any from the last week that failed.
    for (const p of (Array.isArray(r.pending) ? r.pending : []) as Rec[]) {
      if (!env.WHOP_API_KEY || typeof p['membership'] !== 'string' || !/^mem_/.test(p['membership'])) continue;
      const until = await whopAddDay(env.WHOP_API_KEY, p['membership']);
      if (until === null) { out.errors++; continue; }
      await rpc(env, 'goodwill_whop_applied', { p_day: p['day'], p_account: p['account'], p_membership: p['membership'], p_until: until || null })
        .then(() => { out.whop++; }, () => { out.errors++; });
    }
    for (const s of (Array.isArray(r.started) ? r.started : []) as Rec[]) {
      if (!s['email'] || !(await rpc(env, 'goodwill_noted', { p_account: s['account'], p_stretch: s['stretch'], p_kind: 'start' }))) continue;
      if (await sendMail(env, s['email'], goodwillStartMail({ until: toEpoch(s['until']), whop: Boolean(s['whop']) }))) out.started++;
    }
  } else {
    // An ordinary day after quiet ones: the total, once per run.
    for (const e of (await rpc(env, 'goodwill_ended', { p_day: day })) as Rec[]) {
      if (!e['email'] || !(await rpc(env, 'goodwill_noted', { p_account: e['account'], p_stretch: e['stretch'], p_kind: 'end' }))) continue;
      if (await sendMail(env, e['email'], goodwillEndMail({ days: Number(e['days']) || 1, until: toEpoch(e['until']), whop: Boolean(e['whop']) }))) out.ended++;
    }
  }
  console.log('goodwill:', JSON.stringify(out));
  return out;
}
