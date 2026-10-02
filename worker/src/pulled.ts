/**
 * Pulled-call alerts.
 *
 * The slate takes a call down when late news changes our mind and keeps it,
 * with the reason, in `pulled_call` (engine/src/pulled.ts). Every ten
 * minutes, from the Worker's cron, this emails the members who want to know:
 * one email each, however many calls came down. `pulled_claim()` does the
 * bookkeeping in one step (schema.pg.sql), so a second run, or two runs at
 * once, never sends the same alert twice.
 */

import { pulledMail, sendMail, type MailEnv } from './mail.ts';
import { matchPath } from './seo.ts';

export interface PulledEnv extends MailEnv {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  SUPABASE_SERVICE_KEY?: string;
}

type Rec = Record<string, any>;
const SITE = 'https://offside.win';

export interface PulledOutcome { members: number; sent: number; failed: number }

export async function pulledAlerts(env: PulledEnv): Promise<PulledOutcome> {
  const out: PulledOutcome = { members: 0, sent: 0, failed: 0 };
  if (!env.SUPABASE_SERVICE_KEY) return out;
  // No way to send mail yet: leave them unclaimed rather than mark them sent.
  if (!env.EMAIL && !env.BREVO_API_KEY) return out;
  const res = await fetch(new URL('/rest/v1/rpc/pulled_claim', env.SUPABASE_URL), {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_ANON_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      'content-type': 'application/json', accept: 'application/json',
    },
    body: '{}',
  });
  if (!res.ok) throw new Error(`pulled_claim: database ${res.status}`);
  const bundles = (await res.json()) as Rec[];
  for (const b of Array.isArray(bundles) ? bundles : []) {
    const calls = (Array.isArray(b['calls']) ? b['calls'] : []) as Rec[];
    if (typeof b['email'] !== 'string' || !calls.length) continue;
    out.members++;
    const mail = pulledMail(calls.map((c) => ({
      home: String(c['home']), away: String(c['away']), kickoff: Number(c['kickoff']),
      label: String(c['label']), odds: Number(c['odds']), bookmaker: c['bookmaker'] ?? null,
      reason: String(c['reason']), replaced_by: c['replaced_by'] ?? null,
      href: `${SITE}${matchPath({ id: c['fixture_id'], home: c['home'], away: c['away'] })}`,
    })));
    if (await sendMail(env, b['email'], mail)) out.sent++; else out.failed++;
  }
  // Shapes only: never an address.
  if (out.members) console.log('pulled:', JSON.stringify(out));
  return out;
}
