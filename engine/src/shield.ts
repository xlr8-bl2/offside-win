/**
 * Bots kept out at Cloudflare's edge, before they reach a file or the Worker.
 *
 *   npm run edge:shield         what is set up now
 *   npm run edge:shield -- on   put the rules in (or bring them up to date)
 *   npm run edge:shield -- off  take them out again
 *
 * Two WAF custom rules and one rate-limiting rule on the offside.win zone,
 * built from the lists in worker/src/shield.ts so the edge and the Worker
 * refuse the same agents:
 *
 *   1. AI crawlers, SEO crawlers and scraping libraries: blocked.
 *   2. Anything calling itself Googlebot, Bingbot, Applebot or DuckDuckBot
 *      that Cloudflare does not verify as the real one: blocked. That is what
 *      lets the real search engines through everything else untouched.
 *   3. One address making more than 150 requests in ten seconds: blocked for
 *      ten seconds. Verified bots (Google among them) are not counted.
 *
 * Setup, not dev tooling: it stays at launch. Safe to run again: the rules are
 * found by their "offside:" description and replaced; rules anyone else added
 * on the zone are kept as they are.
 */

import { BLOCKED_AGENTS, EXEMPT_PATHS, SPOOFED } from '../../worker/src/shield.ts';

const DOMAIN = 'offside.win';
const CF = 'https://api.cloudflare.com/client/v4';
const TAG = 'offside:';
const CUSTOM = 'http_request_firewall_custom';
const RATE = 'http_ratelimit';

const PERMISSIONS = 'The Cloudflare token (CF_API_TOKEN) needs Zone > Zone WAF > Edit for this. In the Cloudflare app: '
  + 'My Profile > API Tokens > edit the token, add it for offside.win, save, then run this again.';

async function cf(token: string, path: string, init: RequestInit = {}) {
  const res = await fetch(`${CF}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
  const body = await res.json().catch(() => null) as any;
  return { status: res.status, ok: res.ok && body?.success !== false, body };
}

const why = (r: { status: number; body: any }) =>
  `${r.status} ${JSON.stringify((r.body?.errors ?? []).map((e: any) => e.message)).slice(0, 300)}`;

const anyOf = (names: string[]) => names.map((n) => `lower(http.user_agent) contains "${n}"`).join(' or ');
const exempt = `http.request.uri.path in {${EXEMPT_PATHS.map((p) => `"${p}"`).join(' ')}}`;

export interface Rule {
  description: string;
  expression: string;
  action: string;
  enabled: boolean;
  ratelimit?: Record<string, unknown>;
}

/** The WAF custom rules, in order. */
export function customRules(): Rule[] {
  return [
    {
      description: `${TAG} AI crawlers, SEO crawlers and scrapers`,
      expression: `(${anyOf(BLOCKED_AGENTS)}) and not ${exempt}`,
      action: 'block',
      enabled: true,
    },
    {
      description: `${TAG} fake search engines`,
      expression: `(${anyOf(SPOOFED)}) and not cf.client.bot`,
      action: 'block',
      enabled: true,
    },
  ];
}

/**
 * The rate-limiting rule, best first. Cloudflare's free plan allows fewer
 * fields in a rate-limiting rule than the paid ones; if it turns the first
 * down, the second leaves out the verified-bot check (Googlebot spreads its
 * requests over many addresses, far under the limit, either way).
 */
export function rateRules(): Rule[] {
  const ratelimit = { characteristics: ['cf.colo.id', 'ip.src'], period: 10, requests_per_period: 150, mitigation_timeout: 10 };
  const description = `${TAG} one address asking too fast`;
  return [
    { description, expression: `not cf.client.bot and not ${exempt}`, action: 'block', enabled: true, ratelimit },
    { description, expression: `not ${exempt}`, action: 'block', enabled: true, ratelimit },
  ];
}

const ours = (r: any) => typeof r?.description === 'string' && r.description.startsWith(TAG);

/** A rule as read back, cut to what a PUT accepts. */
function keep(r: any): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of ['id', 'ref', 'action', 'action_parameters', 'expression', 'description', 'enabled', 'logging', 'ratelimit']) {
    if (r[k] !== undefined) out[k] = r[k];
  }
  return out;
}

async function rulesIn(token: string, zone: string, phase: string): Promise<{ ok: boolean; rules: any[]; why?: string }> {
  const r = await cf(token, `/zones/${zone}/rulesets/phases/${phase}/entrypoint`);
  if (r.status === 404) return { ok: true, rules: [] };
  if (!r.ok) return { ok: false, rules: [], why: why(r) };
  return { ok: true, rules: (r.body?.result?.rules ?? []) as any[] };
}

async function put(token: string, zone: string, phase: string, rules: object[]) {
  return cf(token, `/zones/${zone}/rulesets/phases/${phase}/entrypoint`, { method: 'PUT', body: JSON.stringify({ rules }) });
}

export async function edgeShield(arg?: string): Promise<void> {
  const token = process.env['CF_API_TOKEN'] ?? '';
  if (!token) throw new Error('CF_API_TOKEN is not set in Actions secrets.');
  const mode = arg === 'on' || arg === 'off' ? arg : 'status';

  const z = await cf(token, `/zones?name=${DOMAIN}`);
  const zone = z.ok ? z.body?.result?.[0] : null;
  if (!zone) { console.log('zone: not visible to this token', why(z)); return; }
  console.log(`zone: found (plan: ${zone.plan?.name ?? 'unknown'})`);

  for (const [phase, label, wanted] of [[CUSTOM, 'WAF custom rules', customRules()], [RATE, 'rate limiting', rateRules()]] as const) {
    const now = await rulesIn(token, zone.id, phase);
    if (!now.ok) { console.log(`${label}: cannot read (${now.why})`); console.log(PERMISSIONS); continue; }
    const others = now.rules.filter((r) => !ours(r)).map(keep);
    const mine = now.rules.filter(ours);
    console.log(`${label}: ${mine.length} of ours${mine.map((r) => `\n  - ${r.description} (${r.enabled ? r.action : 'off'})`).join('')}, ${others.length} other${others.length === 1 ? '' : 's'} kept as they are`);
    if (mode === 'status') continue;

    if (mode === 'off') {
      if (!mine.length) continue;
      const r = await put(token, zone.id, phase, others);
      console.log(`  ${r.ok ? 'taken out' : `could not take out (${why(r)})`}`);
      continue;
    }

    // The custom rules all go in together; the rate rule is one of a ladder.
    const tries = phase === CUSTOM ? [wanted as Rule[]] : (wanted as Rule[]).map((rule) => [rule]);
    let done = false;
    for (const set of tries) {
      const r = await put(token, zone.id, phase, [...set, ...others]);
      if (r.ok) {
        console.log(`  in place: ${set.map((s) => s.description).join('; ')}${phase === RATE && set !== tries[0] ? ' (without the verified-bot check, which this plan does not allow)' : ''}`);
        done = true;
        break;
      }
      console.log(`  refused: ${why(r)}`);
      if (r.status === 403) { console.log(PERMISSIONS); break; }
    }
    if (!done) console.log(`  ${label}: not changed`);
  }
}
