/**
 * Mail sent to the site's own addresses, forwarded to the owner's inbox.
 *
 *   npm run mail:route                    what is set up now
 *   npm run mail:route -- you@example.com forward support@ and hello@ there
 *
 * support@offside.win is the reply-to on every email the site sends, and the
 * contact in the privacy policy, the terms and the refunds page. Until this
 * ran there was no mail server behind the domain at all, so every reply and
 * every refund request bounced. Cloudflare Email Routing receives the mail and
 * forwards it; the owner answers from their own inbox.
 *
 * Cloudflare will only forward to an address that has confirmed it wants the
 * mail, so the first run sends a confirmation email there. Forwarding starts
 * once its link is tapped; nothing here needs running again.
 *
 * Safe to run again: every step looks before it changes anything. The
 * destination address is never printed (the repository and its logs are
 * public); only its domain is.
 */

const DOMAIN = 'offside.win';
const CF = 'https://api.cloudflare.com/client/v4';
/** The addresses the site gives out, and so the ones that must reach a person. */
const ROUTED = ['support@offside.win', 'hello@offside.win'];

async function cf(token: string, path: string, init: RequestInit = {}) {
  const res = await fetch(`${CF}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
  const body = await res.json().catch(() => null) as any;
  return { status: res.status, ok: res.ok && body?.success !== false, body };
}

const why = (r: { status: number; body: any }) =>
  `${r.status} ${JSON.stringify((r.body?.errors ?? []).map((e: any) => e.message)).slice(0, 200)}`;

const shape = (email: string) => `an address at ${email.split('@')[1] ?? '?'}`;

const PERMISSIONS = 'The Cloudflare token (CF_API_TOKEN) needs three more permissions: Zone > Email Routing Rules > Edit, '
  + 'Zone > Zone Settings > Edit, and Account > Email Routing Addresses > Edit. In the Cloudflare app: My Profile > API Tokens > '
  + 'edit the token, add those three, save, then run this again.';

export async function mailRoute(to?: string): Promise<void> {
  const token = process.env['CF_API_TOKEN'] ?? '';
  if (!token) throw new Error('CF_API_TOKEN is not set in Actions secrets.');
  if (to && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) throw new Error('That is not an email address.');

  const z = await cf(token, `/zones?name=${DOMAIN}`);
  const zone = z.ok ? z.body?.result?.[0] : null;
  if (!zone) { console.log('zone: not visible to this token', why(z)); return; }
  const account = zone.account?.id as string | undefined;
  console.log('zone: found');

  // 1. Routing on the zone: the MX records that make the domain receive mail.
  let st = await cf(token, `/zones/${zone.id}/email/routing`);
  if (!st.ok) { console.log('email routing: cannot read', why(st)); console.log(PERMISSIONS); return; }
  console.log('email routing:', st.body?.result?.enabled ? 'on' : 'off', `(${st.body?.result?.status ?? 'unknown'})`);
  if (!st.body?.result?.enabled) {
    if (!to) { console.log('Give an address to forward to and this switches it on.'); return; }
    // Adds Cloudflare's MX and SPF records, and switches routing on.
    let on = await cf(token, `/zones/${zone.id}/email/routing/dns`, { method: 'POST', body: '{}' });
    if (!on.ok) on = await cf(token, `/zones/${zone.id}/email/routing/enable`, { method: 'POST', body: '{}' });
    if (!on.ok) {
      console.log('could not switch routing on:', why(on));
      await diagnose(token, zone.id, account);
      console.log(PERMISSIONS);
      return;
    }
    st = await cf(token, `/zones/${zone.id}/email/routing`);
    console.log('email routing: switched on', `(${st.body?.result?.status ?? 'unknown'})`);
  }
  const dns = await cf(token, `/zones/${zone.id}/email/routing/dns`);
  if (dns.ok) {
    const recs = (dns.body?.result?.records ?? dns.body?.result ?? []) as any[];
    const missing = (dns.body?.result?.errors ?? []) as any[];
    console.log(`  DNS: ${Array.isArray(recs) ? recs.length : 0} records expected${missing.length ? `, problems: ${JSON.stringify(missing.map((e: any) => e.code ?? e)).slice(0, 200)}` : ', all in place'}`);
  }

  // 2. The destination, which must confirm before anything is forwarded to it.
  if (!account) { console.log('account: not visible to this token'); return; }
  const list = await cf(token, `/accounts/${account}/email/routing/addresses?per_page=50`);
  if (!list.ok) { console.log('destinations: cannot read', why(list)); console.log(PERMISSIONS); return; }
  const dests = (list.body?.result ?? []) as Array<{ email: string; verified: string | null }>;
  console.log(`destinations: ${dests.length} on the account, ${dests.filter((d) => d.verified).length} confirmed`);
  if (to) {
    let d = dests.find((x) => x.email.toLowerCase() === to.toLowerCase());
    if (!d) {
      const made = await cf(token, `/accounts/${account}/email/routing/addresses`, { method: 'POST', body: JSON.stringify({ email: to }) });
      if (!made.ok) { console.log('could not add the destination:', why(made)); console.log(PERMISSIONS); return; }
      d = made.body?.result;
      console.log(`  added ${shape(to)}: Cloudflare has emailed it a confirmation link`);
    }
    console.log(`  ${shape(to)}: ${d?.verified ? 'confirmed' : 'NOT confirmed yet. Tap the link in the email from Cloudflare (check junk too). Forwarding starts the moment it is tapped.'}`);
  }

  // 3. One rule per address the site gives out.
  const rules = await cf(token, `/zones/${zone.id}/email/routing/rules?per_page=50`);
  if (!rules.ok) { console.log('rules: cannot read', why(rules)); console.log(PERMISSIONS); return; }
  const have = (rules.body?.result ?? []) as any[];
  for (const addr of ROUTED) {
    const rule = have.find((r) => (r.matchers ?? []).some((m: any) => m.type === 'literal' && m.field === 'to' && String(m.value).toLowerCase() === addr));
    const target = rule?.actions?.find((a: any) => a.type === 'forward')?.value?.[0] as string | undefined;
    if (!to) {
      console.log(`${addr}: ${rule ? `forwards to ${target ? shape(target) : 'nowhere'}${rule.enabled ? '' : ' (switched off)'}` : 'no rule: mail to it bounces'}`);
      continue;
    }
    const body = JSON.stringify({
      name: `${addr} to the owner`, enabled: true,
      matchers: [{ type: 'literal', field: 'to', value: addr }],
      actions: [{ type: 'forward', value: [to] }],
    });
    if (rule && target?.toLowerCase() === to.toLowerCase() && rule.enabled) { console.log(`${addr}: already forwards there`); continue; }
    const r = rule
      ? await cf(token, `/zones/${zone.id}/email/routing/rules/${rule.id ?? rule.tag}`, { method: 'PUT', body })
      : await cf(token, `/zones/${zone.id}/email/routing/rules`, { method: 'POST', body });
    const unconfirmed = !r.ok && /not verified/i.test(JSON.stringify(r.body?.errors ?? ''));
    console.log(`${addr}: ${r.ok ? `now forwards to ${shape(to)}` : unconfirmed
      ? 'waiting: Cloudflare will not forward to the address until its confirmation link is tapped. Tap it, then run this again.'
      : `could not set (${why(r)})`}`);
    if (!r.ok && !unconfirmed) console.log(PERMISSIONS);
  }
}

/**
 * What this token can and cannot do, one call per permission, so a refusal
 * says which permission is missing rather than only that one is. Prints
 * yes/no and status codes only.
 */
async function diagnose(token: string, zone: string, account?: string): Promise<void> {
  const v = await cf(token, '/user/tokens/verify');
  console.log(`  token: ${v.ok ? `valid (${v.body?.result?.status ?? '?'})` : `cannot verify (${v.status})`}`);
  const checks: Array<[string, string]> = [
    ['Zone Settings (read)', `/zones/${zone}/settings/ssl`],
    ['DNS (read)', `/zones/${zone}/dns_records?per_page=1`],
    ['Email Routing Rules (read)', `/zones/${zone}/email/routing/rules?per_page=1`],
    ['Email Routing settings (read)', `/zones/${zone}/email/routing`],
    ...(account ? [['Email Routing Addresses (read)', `/accounts/${account}/email/routing/addresses?per_page=1`] as [string, string]] : []),
  ];
  for (const [label, path] of checks) {
    const r = await cf(token, path);
    console.log(`  ${label}: ${r.ok ? 'yes' : `no (${r.status})`}`);
  }
  // A write that changes nothing: the same value back, to test Zone Settings > Edit.
  const cur = await cf(token, `/zones/${zone}/settings/always_use_https`);
  if (cur.ok) {
    const w = await cf(token, `/zones/${zone}/settings/always_use_https`, { method: 'PATCH', body: JSON.stringify({ value: cur.body?.result?.value }) });
    console.log(`  Zone Settings (edit): ${w.ok ? 'yes' : `no (${w.status})`}`);
  }
}
