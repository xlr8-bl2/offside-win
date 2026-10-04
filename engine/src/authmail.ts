/**
 * Switch Supabase's sign-in emails over to the site's own (or back), from a phone.
 *
 *   npm run mail:auth            what is set now
 *   npm run mail:auth -- on      sign-in emails come from the Worker, designed
 *   npm run mail:auth -- off     back to Supabase's own sender and templates
 *   npm run mail:auth -- limits  raise how many sign-in emails go out an hour
 *
 * "On" points Supabase Auth's send-email hook at /api/auth/email
 * (worker/src/authhook.ts) with a signing secret derived from the service
 * key, which the Worker derives the same way, so no new secret is created or
 * printed. It refuses while the Worker has no way to send, because with the
 * hook on and nothing sending, nobody could sign in.
 *
 * Needs SUPABASE_ACCESS_TOKEN (a personal access token from the Supabase
 * dashboard, Account, Access tokens) in Actions secrets: Supabase's
 * settings are changed through its Management API, which the service key
 * does not open.
 */

import { hookSecret } from '../../worker/src/authhook.ts';

const SITE = process.env['SITE_URL'] ?? 'https://offside.win';
const HOOK = `${SITE}/api/auth/email`;
const EMAILS_AN_HOUR = 500;

function projectRef(): string {
  const explicit = process.env['SUPABASE_PROJECT_REF'];
  if (explicit) return explicit;
  const host = new URL(process.env['SUPABASE_URL'] ?? 'https://invalid').hostname;
  const m = host.match(/^([a-z0-9]{20})\.supabase\.co$/);
  if (!m) throw new Error('Cannot tell the project from SUPABASE_URL. Set SUPABASE_PROJECT_REF.');
  return m[1]!;
}

async function management(token: string, path: string, init: RequestInit = {}) {
  const res = await fetch(`https://api.supabase.com/v1${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json', ...(init.headers ?? {}) },
  });
  const body = await res.json().catch(() => null) as Record<string, unknown> | null;
  return { status: res.status, ok: res.ok, body };
}

export async function authMail(mode = 'status'): Promise<void> {
  const token = process.env['SUPABASE_ACCESS_TOKEN'] ?? '';
  if (!token) {
    throw new Error('SUPABASE_ACCESS_TOKEN is not in Actions secrets. Make one in the Supabase dashboard (Account, Access tokens), add it as SUPABASE_ACCESS_TOKEN, then run this again.');
  }
  const ref = projectRef();

  const sending = await fetch(HOOK).then((r) => r.json()).catch(() => null) as { cloudflare?: boolean; brevo?: boolean } | null;
  console.log('worker can send via:', sending ? [sending.cloudflare && 'cloudflare', sending.brevo && 'brevo'].filter(Boolean).join(', ') || 'nothing' : 'unreachable');

  const now = await management(token, `/projects/${ref}/config/auth`);
  if (!now.ok) { console.log('supabase config:', now.status, JSON.stringify(now.body).slice(0, 200)); process.exitCode = 1; return; }
  console.log('hook now:', now.body?.['hook_send_email_enabled'] ? `on, ${now.body?.['hook_send_email_uri']}` : 'off (Supabase sends its own emails)');
  console.log('limits now:', `${now.body?.['rate_limit_email_sent'] ?? '?'} emails an hour across the site,`,
    `one per address every ${now.body?.['smtp_max_frequency'] ?? '?'}s`);
  if (mode === 'status') return;

  // The site-wide hourly cap is what a launch runs into: every new reader's
  // first sign-in is one email, and the default was set for a test project.
  // The once-a-minute rule per address stays: it is what stops someone
  // filling a stranger's inbox from our sign-in box.
  if (mode === 'limits') {
    const set = await management(token, `/projects/${ref}/config/auth`, {
      method: 'PATCH', body: JSON.stringify({ rate_limit_email_sent: EMAILS_AN_HOUR }),
    });
    console.log('raise limit:', set.status, set.ok ? `${set.body?.['rate_limit_email_sent'] ?? EMAILS_AN_HOUR} sign-in emails an hour` : JSON.stringify(set.body).slice(0, 300));
    if (!set.ok) process.exitCode = 1;
    return;
  }

  if (mode === 'on') {
    if (!sending?.cloudflare && !sending?.brevo) {
      console.log('Not switched on: the Worker has no way to send email yet, so sign-in would stop working.');
      process.exitCode = 1;
      return;
    }
    const key = process.env['SUPABASE_SERVICE_KEY'] ?? '';
    if (!key) throw new Error('SUPABASE_SERVICE_KEY is not set.');
    const set = await management(token, `/projects/${ref}/config/auth`, {
      method: 'PATCH',
      body: JSON.stringify({ hook_send_email_enabled: true, hook_send_email_uri: HOOK, hook_send_email_secrets: await hookSecret(key) }),
    });
    console.log('switch on:', set.status, set.ok ? `sign-in emails now come from ${HOOK}` : JSON.stringify(set.body).slice(0, 300));
    if (!set.ok) process.exitCode = 1;
    return;
  }
  if (mode === 'off') {
    const set = await management(token, `/projects/${ref}/config/auth`, {
      method: 'PATCH', body: JSON.stringify({ hook_send_email_enabled: false }),
    });
    console.log('switch off:', set.status, set.ok ? 'Supabase sends its own sign-in emails again' : JSON.stringify(set.body).slice(0, 300));
    if (!set.ok) process.exitCode = 1;
    return;
  }
  throw new Error(`mail:auth takes on, off, limits or nothing, not "${mode}"`);
}
