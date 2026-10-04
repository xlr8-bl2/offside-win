/**
 * Set offside.win up to send email through Brevo, from a phone.
 *
 *   npm run mail:setup                      check the key, add and verify the
 *                                           domain, create the sender
 *   npm run mail:setup -- you@example.com   ...and send the confirmation email
 *                                           to that address as a test
 *
 * Brevo will only send "from" offside.win once it can see three DNS records
 * on the domain: its ownership code, the DKIM key that signs each message, and
 * a DMARC policy. It hands those out when the domain is added. This adds them
 * to Cloudflare's DNS itself when the Cloudflare token is allowed to (Zone,
 * DNS, Edit); otherwise it prints them to add by hand. DNS records are public
 * by nature, so printing them leaks nothing. The Brevo key is never printed,
 * and nor is the Brevo account's own email.
 *
 * Safe to run again: every step checks before it changes anything, and an
 * existing DMARC policy is left alone rather than replaced.
 */

import { membershipMail, sendMail } from '../../worker/src/mail.ts';

const DOMAIN = 'offside.win';
const FROM = 'hello@offside.win';
const BREVO = 'https://api.brevo.com/v3';
const CF = 'https://api.cloudflare.com/client/v4';

interface DnsRecord { host_name: string; type: string; value: string; status: boolean }

async function brevo(key: string, path: string, init: RequestInit = {}) {
  const res = await fetch(`${BREVO}${path}`, {
    ...init,
    headers: { 'api-key': key, accept: 'application/json', 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
  const body = await res.json().catch(() => null) as any;
  return { status: res.status, ok: res.ok, body };
}

async function cloudflare(token: string, path: string, init: RequestInit = {}) {
  const res = await fetch(`${CF}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
  const body = await res.json().catch(() => null) as any;
  return { status: res.status, ok: res.ok && body?.success !== false, body };
}

/** Brevo writes "@" for the domain itself and a bare label for the rest. */
const fqdn = (host: string) => (!host || host === '@' ? DOMAIN : host.endsWith(DOMAIN) ? host : `${host}.${DOMAIN}`);

/**
 * Can mail clients fetch the email pictures? Gmail never fetches them from the
 * reader's phone: Google's image proxy does, from Google's own addresses, and
 * a zone setting that challenges automated traffic blanks every hero. Reads
 * the settings that can do that and the last day of requests for
 * /brand/mail/, grouped by status and, for Google's fetchers only, the agent.
 * Nothing about a person is printed.
 */
async function imageCheck(): Promise<void> {
  const token = process.env['CF_API_TOKEN'] ?? '';
  if (!token) throw new Error('CF_API_TOKEN is not set');
  const z = await cloudflare(token, `/zones?name=${DOMAIN}`);
  const zone = z.ok ? z.body?.result?.[0]?.id ?? null : null;
  console.log('cloudflare zone:', z.status, zone ? 'found' : 'not visible to this token');
  if (!zone) return;
  for (const s of ['security_level', 'hotlink_protection', 'browser_check', 'challenge_ttl']) {
    const r = await cloudflare(token, `/zones/${zone}/settings/${s}`);
    console.log(`  ${s}:`, r.ok ? JSON.stringify(r.body?.result?.value) : `cannot read (${r.status})`);
  }
  const bm = await cloudflare(token, `/zones/${zone}/bot_management`);
  console.log('  bot management:', bm.ok ? JSON.stringify(bm.body?.result) : `cannot read (${bm.status})`);
  const since = new Date(Date.now() - 86400_000).toISOString();
  const until = new Date().toISOString();
  const gql = async (query: string) => {
    const r = await fetch(`${CF}/graphql`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ query }) });
    return r.json().catch(() => null) as Promise<any>;
  };
  const reqs = await gql(`{ viewer { zones(filter: {zoneTag: "${zone}"}) {
    httpRequestsAdaptiveGroups(limit: 50, filter: {datetime_geq: "${since}", datetime_leq: "${until}", clientRequestPath_like: "/brand/mail/%"}) {
      count dimensions { edgeResponseStatus userAgent securityAction } } } } }`);
  if (reqs?.errors?.length) console.log('requests:', JSON.stringify(reqs.errors.map((e: any) => e.message)).slice(0, 300));
  for (const g of reqs?.data?.viewer?.zones?.[0]?.httpRequestsAdaptiveGroups ?? []) {
    const ua = String(g.dimensions.userAgent ?? '');
    const who = /google/i.test(ua) ? ua.slice(0, 120) : 'other agent';
    console.log(`  ${g.count} x status ${g.dimensions.edgeResponseStatus} action ${g.dimensions.securityAction || '-'} from ${who}`);
  }
  const fw = await gql(`{ viewer { zones(filter: {zoneTag: "${zone}"}) {
    firewallEventsAdaptiveGroups(limit: 20, filter: {datetime_geq: "${since}", datetime_leq: "${until}"}) {
      count dimensions { action source clientRequestPath } } } } }`);
  if (fw?.errors?.length) console.log('firewall:', JSON.stringify(fw.errors.map((e: any) => e.message)).slice(0, 300));
  for (const g of fw?.data?.viewer?.zones?.[0]?.firewallEventsAdaptiveGroups ?? []) {
    console.log(`  firewall: ${g.count} x ${g.dimensions.action} by ${g.dimensions.source} on ${String(g.dimensions.clientRequestPath).slice(0, 60)}`);
  }
}

export async function mailSetup(testTo?: string): Promise<void> {
  if (testTo === 'images') return imageCheck();
  const key = process.env['BREVO_API_KEY'] ?? '';
  if (!key) throw new Error('BREVO_API_KEY is not set in Actions secrets. Add it in the repo settings, then run this again.');

  // 1. The key, and what the account may do.
  const acct = await brevo(key, '/account');
  console.log('brevo account:', acct.status, acct.ok ? 'key works' : JSON.stringify(acct.body?.code ?? acct.body).slice(0, 200));
  if (!acct.ok) return;
  const plans = Array.isArray(acct.body?.plan) ? acct.body.plan : [];
  console.log('  plan:', plans.map((p: any) => `${p.type}${p.credits != null ? ` (${p.credits} ${p.creditsType ?? 'credits'})` : ''}`).join(', ') || 'unknown');
  console.log('  transactional sending enabled:', acct.body?.relay?.enabled ?? 'unknown');

  // 2. The domain: added once, then its records.
  const list = await brevo(key, '/senders/domains');
  const known = (list.body?.domains ?? []).some((d: any) => d.domain_name === DOMAIN);
  if (!known) {
    const made = await brevo(key, '/senders/domains', { method: 'POST', body: JSON.stringify({ name: DOMAIN }) });
    console.log('add domain:', made.status, made.ok ? 'added' : JSON.stringify(made.body).slice(0, 300));
    if (!made.ok) return;
  } else {
    console.log('add domain: already added');
  }
  const conf = await brevo(key, `/senders/domains/${DOMAIN}`);
  if (!conf.ok) { console.log('domain config:', conf.status, JSON.stringify(conf.body).slice(0, 300)); return; }
  console.log('domain:', `verified=${conf.body.verified}`, `authenticated=${conf.body.authenticated}`);
  const records = Object.entries((conf.body.dns_records ?? {}) as Record<string, DnsRecord>);

  // 3. The records into Cloudflare, if the token may.
  const token = process.env['CF_API_TOKEN'] ?? '';
  let zone: string | null = null;
  if (token) {
    const z = await cloudflare(token, `/zones?name=${DOMAIN}`);
    zone = z.ok ? z.body?.result?.[0]?.id ?? null : null;
    console.log('cloudflare zone:', z.status, zone ? 'found' : 'not visible to this token');
  } else {
    console.log('cloudflare: CF_API_TOKEN not set');
  }
  const manual: string[] = [];
  for (const [kind, r] of records) {
    const name = fqdn(r.host_name);
    if (r.status) { console.log(`  ${kind}: ${r.type} ${name} already seen by Brevo`); continue; }
    if (!zone) { manual.push(`${r.type}  ${r.host_name}  ${r.value}`); continue; }
    const have = await cloudflare(token, `/zones/${zone}/dns_records?type=${r.type}&name=${encodeURIComponent(name)}`);
    const existing: any[] = have.ok ? have.body.result ?? [] : [];
    const clean = (v: string) => String(v).replace(/^"|"$/g, '');
    if (existing.some((e) => clean(e.content) === clean(r.value))) { console.log(`  ${kind}: ${r.type} ${name} already in DNS`); continue; }
    if (kind === 'dmarc_record' && existing.some((e) => /^"?v=DMARC1/i.test(e.content))) {
      console.log(`  ${kind}: a DMARC policy already exists on ${name}; left as it is`);
      continue;
    }
    if (r.type === 'CNAME' && existing.length) { console.log(`  ${kind}: ${name} already has a CNAME pointing elsewhere; not touched`); continue; }
    const add = await cloudflare(token, `/zones/${zone}/dns_records`, {
      method: 'POST',
      body: JSON.stringify({ type: r.type, name, content: r.value, ttl: 1, proxied: false, comment: 'Brevo email (mail:setup)' }),
    });
    console.log(`  ${kind}: ${r.type} ${name}`, add.ok ? 'added to Cloudflare' : `could not add (${add.status} ${JSON.stringify(add.body?.errors ?? '').slice(0, 160)})`);
    if (!add.ok) manual.push(`${r.type}  ${r.host_name}  ${r.value}`);
  }
  if (manual.length) {
    console.log('\nAdd these in Cloudflare > offside.win > DNS > Records (proxy off), then run this again:');
    for (const m of manual) console.log('  ' + m);
  }

  // 4. Ask Brevo to look. DNS can take a few minutes to be seen.
  const auth = await brevo(key, `/senders/domains/${DOMAIN}/authenticate`, { method: 'PUT' });
  console.log('authenticate:', auth.status, JSON.stringify(auth.body?.message ?? auth.body ?? '').slice(0, 200));
  const after = await brevo(key, `/senders/domains/${DOMAIN}`);
  const authenticated = Boolean(after.body?.authenticated);
  console.log('domain now:', `verified=${after.body?.verified}`, `authenticated=${authenticated}`);
  if (!authenticated) console.log('  Not authenticated yet. DNS can take up to an hour to be seen; run mail:setup again later.');

  // 5. The sender everything goes out as.
  const senders = await brevo(key, '/senders');
  const have = (senders.body?.senders ?? []).find((x: any) => String(x.email).toLowerCase() === FROM);
  if (have) {
    console.log('sender:', FROM, have.active ? 'active' : 'exists, not active yet');
  } else {
    const made = await brevo(key, '/senders', { method: 'POST', body: JSON.stringify({ name: 'Offside.win', email: FROM }) });
    console.log('sender:', FROM, made.ok ? 'created' : `not created (${made.status} ${JSON.stringify(made.body).slice(0, 200)})`);
  }

  // 6. A real one, to a real inbox.
  if (testTo) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(testTo)) { console.log('test email: that is not an email address'); return; }
    const now = Math.floor(Date.now() / 1000);
    const ok = await sendMail({ BREVO_API_KEY: key }, testTo, membershipMail({ plan: 'monthly', until: now + 30 * 86400, consent: { at: now, terms: '2026-09-27' } }));
    const [user, host] = testTo.split('@');
    console.log('test email to', `${user!.slice(0, 1)}***@${host}:`, ok ? 'accepted by Brevo, check the inbox (and spam)' : 'refused, see above');
  }
}
