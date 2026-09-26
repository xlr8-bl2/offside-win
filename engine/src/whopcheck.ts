/**
 * Ask Whop to open the same checkout the site opens, and print what Whop
 * says. For when the pricing page reports "The payment page could not be
 * opened": the Worker's logs are not reachable from a phone, this is.
 *
 * Prints the HTTP status and Whop's error type and message, never the key.
 * On success it prints the checkout id, which is public (it is in the
 * checkout's own address).
 */

import { whopCheckoutBody, whopPaymentBody } from '../../worker/src/whop.ts';

export async function whopCheck(): Promise<void> {
  const key = process.env['WHOP_API_KEY'] ?? '';
  const company = process.env['WHOP_COMPANY_ID'] ?? '';
  if (!key) throw new Error('WHOP_API_KEY is not set in Actions secrets');
  if (!company) throw new Error('WHOP_COMPANY_ID is not set');
  const body = whopCheckoutBody({
    companyId: company,
    plan: { id: 'matchday', name: 'Matchday pass', amountMinor: 100, currency: 'GBP', days: 7, renews: false },
    user: { id: '00000000-0000-4000-8000-000000000000', email: null },
    returnUrl: 'https://offside.win/#/account?paid=1',
  });
  console.log('request shape:', JSON.stringify(body, (k, v) => (k === 'user_id' ? '<test>' : v)));
  const res = await fetch('https://api.whop.com/api/v1/checkout_configurations', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let out: any = null;
  try { out = JSON.parse(text); } catch { /* not json */ }
  console.log('whop status:', res.status);
  if (res.ok) console.log('checkout id:', out?.id, 'purchase url:', out?.purchase_url);
  else console.log('whop error:', JSON.stringify(out?.error ?? out ?? text.slice(0, 500)));

  // Can the key read a membership? After a payment the webhook asks Whop when
  // the membership ends. 404 for a made-up id means the key may read
  // memberships; 403 means it may not.
  const m = await fetch('https://api.whop.com/api/v1/memberships/mem_doesnotexist000', {
    headers: { authorization: `Bearer ${key}`, accept: 'application/json' },
  });
  const mt = await m.text();
  let me: any = null;
  try { me = JSON.parse(mt); } catch { /* not json */ }
  console.log('membership read:', m.status, m.status === 403 ? 'NOT ALLOWED - add member:basic:read' : 'allowed', JSON.stringify(me?.error ?? '').slice(0, 200));

  // Can the key take a payment from our own checkout page? A made-up token
  // cannot charge anything: 403 means the key lacks payment:charge (the page
  // then falls back to Whop's checkout), anything else means it has it.
  const pay = await fetch('https://api.whop.com/api/v1/payments', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(whopPaymentBody({
      companyId: company,
      plan: { id: 'matchday', name: 'Matchday pass', amountMinor: 100, currency: 'GBP', days: 7, renews: false },
      user: { id: '00000000-0000-4000-8000-000000000000', email: null },
      returnUrl: 'https://offside.win/#/account?paid=1',
    }, 'ctok_doesnotexist000')),
  });
  const pt = await pay.text();
  let pj: any = null;
  try { pj = JSON.parse(pt); } catch { /* not json */ }
  console.log('own checkout charge:', pay.status, pay.status === 403 || pay.status === 401
    ? 'NOT ALLOWED - add payment:charge, plan:basic:read, access_pass:basic:read' : 'allowed (the fake token is refused, as it should be)',
    JSON.stringify(pj?.error ?? '').slice(0, 300));

  // The last few days' memberships, as the site's sweep will see them: id,
  // status, whether our account id rode along, the plan, the dates. No emails.
  const since = new Date(Date.now() - 3 * 86400_000).toISOString();
  const l = await fetch(`https://api.whop.com/api/v1/memberships?${new URLSearchParams({ account_id: company, first: '20', created_after: since })}`, {
    headers: { authorization: `Bearer ${key}`, accept: 'application/json' },
  });
  const lt = await l.text();
  let lj: any = null;
  try { lj = JSON.parse(lt); } catch { /* not json */ }
  console.log('memberships list:', l.status, l.ok ? `${lj?.data?.length ?? 0} found` : JSON.stringify(lj?.error ?? lt.slice(0, 200)));
  for (const m of lj?.data ?? []) {
    console.log('  membership', m.id, 'status', m.status, 'account id on it', /^[0-9a-f-]{36}$/i.test(m.metadata?.user_id ?? '') ? 'yes' : 'no',
      'plan', m.metadata?.plan ?? '-', 'created', m.created_at, 'period end', m.renewal_period_end, 'manage url', Boolean(m.manage_url), 'buyer email present', Boolean(m.user?.email));
  }
}
