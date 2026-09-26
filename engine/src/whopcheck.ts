/**
 * Ask Whop to open the same checkout the site opens, and print what Whop
 * says. For when the pricing page reports "The payment page could not be
 * opened": the Worker's logs are not reachable from a phone, this is.
 *
 * Prints the HTTP status and Whop's error type and message, never the key.
 * On success it prints the checkout id, which is public (it is in the
 * checkout's own address).
 */

import { whopCheckoutBody } from '../../worker/src/whop.ts';

export async function whopCheck(): Promise<void> {
  const key = process.env['WHOP_API_KEY'] ?? '';
  const company = process.env['WHOP_COMPANY_ID'] ?? '';
  if (!key) throw new Error('WHOP_API_KEY is not set in Actions secrets');
  if (!company) throw new Error('WHOP_COMPANY_ID is not set');
  const body = whopCheckoutBody({
    companyId: company,
    plan: { id: 'matchday', name: 'Matchday pass', amountMinor: 50, currency: 'GBP', days: 7, renews: false },
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
}
