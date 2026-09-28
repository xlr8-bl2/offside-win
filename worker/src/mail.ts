/**
 * Email from Offside.win, sent through Brevo.
 *
 * One message so far, and the one the law needs: the confirmation after a
 * membership is switched on. It restates what was bought, until when, whether
 * it renews and how to stop it, and -- when the buyer ticked the boxes at
 * checkout -- that they asked for it to start at once and accepted that this
 * ends the 14-day right to cancel. The Consumer Contracts Regulations 2013
 * (reg. 16 and 37) want that confirmation on a durable medium; an email is
 * one, a web page is not.
 *
 * Sending never fails the thing it reports on. No key, a refusal or a network
 * error is logged by shape and the membership stands.
 */

export interface MailEnv {
  BREVO_API_KEY?: string;
  MAIL_FROM?: string;
}

export const SUPPORT = 'support@offside.win';
const SITE = 'https://offside.win';

export interface Mail { subject: string; html: string; text: string; tag: string }

/** Send one email. True when Brevo accepted it. */
export async function sendMail(env: MailEnv, to: string, mail: Mail): Promise<boolean> {
  if (!env.BREVO_API_KEY) { console.log('mail: no BREVO_API_KEY, not sent'); return false; }
  try {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': env.BREVO_API_KEY, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        sender: { name: 'Offside.win', email: env.MAIL_FROM || 'hello@offside.win' },
        to: [{ email: to }],
        replyTo: { email: SUPPORT, name: 'Offside.win' },
        subject: mail.subject,
        htmlContent: mail.html,
        textContent: mail.text,
        tags: [mail.tag],
      }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null) as { code?: string } | null;
      console.error('mail: refused', res.status, body?.code ?? '');
      return false;
    }
    return true;
  } catch (err) {
    console.error('mail: not sent', err instanceof Error ? err.message : String(err));
    return false;
  }
}

const PLAN_NAME: Record<string, string> = {
  matchday: 'Matchday pass',
  monthly: 'Monthly membership',
  quarter: '3-month membership',
  season: 'Season ticket',
};

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

const longDate = (epoch: number) => new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
}).format(new Date(epoch * 1000));

/** "2026-09-27" as "27 September 2026"; anything else as it is. */
const termsDate = (v: string) => (/^\d{4}-\d{2}-\d{2}$/.test(v)
  ? new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(`${v}T00:00:00Z`))
  : v);

export interface MembershipMailInput {
  plan: string;
  /** When the paid period ends, epoch seconds. */
  until: number;
  /** What the buyer confirmed at checkout, if they did (purchases before the boxes existed did not). */
  consent?: { at: number; terms: string } | null;
}

/** "You're in": the membership confirmation, and the record of what was agreed. */
export function membershipMail({ plan, until, consent }: MembershipMailInput): Mail {
  const name = PLAN_NAME[plan] ?? 'Membership';
  const renews = plan !== 'matchday';
  const when = longDate(until);
  const lines: string[] = [
    `Your ${name.toLowerCase()} is on. Every call, the bet slip's legs and the reasons behind every call are open to you${renews ? '' : ` until ${when}`}.`,
    renews
      ? `It runs to ${when} and then renews at the same price until you cancel. Cancel any time, in one step, from your account page or your Whop account; you keep access to the end of the period you have paid for.`
      : `It ends by itself on ${when}. Nothing renews and nothing more is charged.`,
  ];
  const agreed = consent
    ? `At checkout on ${longDate(consent.at)} you confirmed you are 18 or over and agreed to our terms of use (the version in force from ${termsDate(consent.terms)}). You asked for your membership to start straight away and accepted that, once it started, you lose the 14-day right to cancel for a change of mind. If anything of ours fails, you still get it put right or your money back.`
    : null;
  const own = 'Members’ calls are for you alone. Please don’t post, sell or pass them on.';
  const help = `Questions, or something not working? Reply to this email or write to ${SUPPORT}.`;

  const text = [
    `You're in.`, '', ...lines, '', ...(agreed ? [agreed, ''] : []), own, '',
    `Your account: ${SITE}/#/account`, `Terms of use: ${SITE}/terms`, '', help, '',
    '18+. Offside.win gives opinions about football matches, not advice to bet. BeGambleAware.org',
  ].join('\n');

  const p = (s: string, extra = '') => `<p style="margin:0 0 16px;font:16px/1.6 -apple-system,'Segoe UI',Helvetica,Arial,sans-serif;color:#1d1f24;${extra}">${s}</p>`;
  const html = `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<meta name="color-scheme" content="light only"><title>${esc(name)}</title></head>
<body style="margin:0;padding:0;background:#f1f2f5">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f2f5"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden">
<tr><td style="background:#0a0a0c;padding:22px 28px;font:700 22px/1 'Arial Narrow',Arial,sans-serif;letter-spacing:.01em;color:#f4f6fa">off<span style="color:#7a5af8">|</span>side<span style="color:#8d94a3">.win</span></td></tr>
<tr><td style="padding:32px 28px 12px">
<h1 style="margin:0 0 20px;font:700 30px/1.1 'Arial Narrow',Arial,sans-serif;color:#0a0a0c">You're in.</h1>
${lines.map((l) => p(esc(l))).join('\n')}
<p style="margin:8px 0 24px"><a href="${SITE}/#/board" style="display:inline-block;background:#7a5af8;color:#ffffff;text-decoration:none;font:600 15px/1 -apple-system,'Segoe UI',Helvetica,Arial,sans-serif;padding:14px 22px;border-radius:8px">See today's calls</a></p>
${agreed ? `<div style="border-left:3px solid #7a5af8;background:#f6f4ff;padding:14px 16px;margin:0 0 20px">${p(esc(agreed), 'margin:0;font-size:14px;color:#3a3d45;')}</div>` : ''}
${p(esc(own), 'font-size:14px;color:#3a3d45;')}
${p(`<a href="${SITE}/#/account" style="color:#5b3fe0">Your account</a> &nbsp; <a href="${SITE}/terms" style="color:#5b3fe0">Terms of use</a> &nbsp; <a href="${SITE}/privacy" style="color:#5b3fe0">Privacy</a>`, 'font-size:14px;')}
${p(esc(help), 'font-size:14px;color:#3a3d45;')}
</td></tr>
<tr><td style="padding:16px 28px 24px;border-top:1px solid #e6e7eb;font:12px/1.5 -apple-system,'Segoe UI',Helvetica,Arial,sans-serif;color:#6b7080">
18+. Offside.win gives opinions about football matches, not advice to bet. Only bet what you can afford to lose. <a href="https://www.begambleaware.org" style="color:#6b7080">BeGambleAware.org</a>
</td></tr></table></td></tr></table></body></html>`;

  return { subject: renews ? `You're in: your ${name.toLowerCase()} is on` : `You're in: your ${name.toLowerCase()} runs to ${when}`, html, text, tag: 'membership' };
}
