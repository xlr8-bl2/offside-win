/**
 * Email from Offside.win.
 *
 * Two ways out, tried in order:
 *   1. Cloudflare Email Service, through the Worker's `EMAIL` binding
 *      (`[[send_email]]` in wrangler.toml). Needs Workers Paid and offside.win
 *      onboarded under Email Service; until then the binding is absent.
 *   2. Brevo, with BREVO_API_KEY, which is what sent mail before.
 * Whichever answers first wins; a refusal from the first falls through to the
 * second, so switching providers is never a window with no mail.
 *
 * What gets sent, and from where:
 *   - sign-in, sign-up and email-change links: Supabase's send-email hook
 *     calls /api/auth/email (authhook.ts), so the sign-in email looks like
 *     the rest of the site rather than like Supabase's default;
 *   - "you're in": the confirmation after a membership switches on. The one
 *     the law needs: the Consumer Contracts Regulations 2013 (reg. 16 and 37)
 *     want what was bought and what was agreed on a durable medium, and an
 *     email is one where a web page is not;
 *   - renewed, renewal stopped, access ended (refund or chargeback);
 *   - free time given from the owner's dashboard;
 *   - account deleted.
 *
 * Sending never fails the thing it reports on, except the sign-in hook, where
 * the email is the whole job. No transport, a refusal or a network error is
 * logged by shape (never the address) and the membership stands.
 */

/** The parts of Cloudflare's send_email binding used here. */
export interface EmailBinding {
  send(message: {
    to: string;
    from: { email: string; name?: string };
    replyTo?: { email: string; name?: string };
    subject: string;
    html?: string;
    text?: string;
    headers?: Record<string, string>;
  }): Promise<{ messageId: string }>;
}

export interface MailEnv {
  EMAIL?: EmailBinding;
  BREVO_API_KEY?: string;
  MAIL_FROM?: string;
}

export const SUPPORT = 'support@offside.win';
const SITE = 'https://offside.win';
const FROM_NAME = 'Offside.win';

export interface Mail { subject: string; html: string; text: string; tag: string }

/** Which way a message went out, or null when neither would take it. */
export type Sent = 'cloudflare' | 'brevo' | null;

/** Send one email. Never throws. */
export async function deliver(env: MailEnv, to: string, mail: Mail): Promise<Sent> {
  const from = env.MAIL_FROM || 'hello@offside.win';
  if (env.EMAIL) {
    try {
      await env.EMAIL.send({
        to,
        from: { email: from, name: FROM_NAME },
        replyTo: { email: SUPPORT, name: FROM_NAME },
        subject: mail.subject,
        html: mail.html,
        text: mail.text,
      });
      return 'cloudflare';
    } catch (err) {
      // The code only: E_SENDER_NOT_VERIFIED means the domain is not onboarded
      // yet, E_RATE_LIMIT_EXCEEDED that it is. The message can echo the address.
      const code = (err as { code?: unknown })?.code;
      console.error('mail: cloudflare refused', typeof code === 'string' ? code : 'error', mail.tag);
    }
  }
  if (!env.BREVO_API_KEY) {
    if (!env.EMAIL) console.log('mail: no EMAIL binding and no BREVO_API_KEY, not sent', mail.tag);
    return null;
  }
  try {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': env.BREVO_API_KEY, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        sender: { name: FROM_NAME, email: from },
        to: [{ email: to }],
        replyTo: { email: SUPPORT, name: FROM_NAME },
        subject: mail.subject,
        htmlContent: mail.html,
        textContent: mail.text,
        tags: [mail.tag],
      }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null) as { code?: string } | null;
      console.error('mail: brevo refused', res.status, body?.code ?? '', mail.tag);
      return null;
    }
    return 'brevo';
  } catch (err) {
    console.error('mail: not sent', err instanceof Error ? err.name : 'error', mail.tag);
    return null;
  }
}

/** Send one email. True when something accepted it. */
export async function sendMail(env: MailEnv, to: string, mail: Mail): Promise<boolean> {
  return (await deliver(env, to, mail)) !== null;
}

/* ------------------------------------------------------------- the words */

const PLAN_NAME: Record<string, string> = {
  matchday: 'Matchday pass',
  monthly: 'Monthly membership',
  quarter: '3-month membership',
  season: 'Season ticket',
};
const planName = (plan: string) => PLAN_NAME[plan] ?? 'Membership';

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

export const longDate = (epoch: number) => new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
}).format(new Date(epoch * 1000));

const shortDate = (epoch: number) => new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London', day: 'numeric', month: 'long', year: 'numeric',
}).format(new Date(epoch * 1000));

/** "2026-09-27" as "27 September 2026"; anything else as it is. */
const termsDate = (v: string) => (/^\d{4}-\d{2}-\d{2}$/.test(v)
  ? new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(`${v}T00:00:00Z`))
  : v);

/* ------------------------------------------------------------- the look */

/*
 * One frame for every message, drawn the way the site is (public/tokens.css):
 * the near-black ground, chalk type, violet only where something can be tapped.
 * Tables and inline styles throughout, because that is what Outlook and Gmail
 * still read. Dark by design and declared as such, so a mail app in dark mode
 * leaves it alone rather than inverting it into grey.
 *
 * The one loud thing is the headline: big, tight, chalk. Everything under it
 * is quiet.
 */
const C = {
  pitch: '#0a0a0c',
  stand: '#16171b',
  terrace: '#202329',
  line: '#2a2d34',
  chalk: '#f4f6fa',
  chalk2: '#c3c8d2',
  chalk3: '#8d94a3',
  violet: '#7a5af8',
  violetHi: '#9e86ff',
};
const SANS = `-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif`;
const DISPLAY = `'Big Shoulders Display','Arial Narrow',${SANS}`;

/** A line of body copy. `html` is trusted markup; everything else is escaped. */
type Part =
  | { p: string; small?: boolean }
  | { html: string }
  | { button: string; href: string }
  | { facts: Array<[string, string]> }
  | { note: string }
  | { code: string }
  | { link: string; href: string }
  | { chip: string };

function part(x: Part): string {
  if ('p' in x) {
    const size = x.small ? '14px/1.6' : '16px/1.65';
    const color = x.small ? C.chalk3 : C.chalk2;
    return `<p style="margin:0 0 18px;font:${size} ${SANS};color:${color}">${esc(x.p)}</p>`;
  }
  if ('html' in x) return x.html;
  if ('button' in x) {
    return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:6px 0 26px"><tr>
<td style="border-radius:999px;background:${C.violet}"><a href="${esc(x.href)}" style="display:inline-block;padding:16px 30px;font:700 16px/1 ${SANS};color:#ffffff;text-decoration:none;border-radius:999px">${esc(x.button)}</a></td>
</tr></table>`;
  }
  if ('facts' in x) {
    const rows = x.facts.map(([k, v], i) => `<tr>
<td style="padding:13px 16px;${i ? `border-top:1px solid ${C.line};` : ''}font:14px/1.4 ${SANS};color:${C.chalk3};white-space:nowrap;text-align:left">${esc(k)}</td>
<td style="padding:13px 16px;${i ? `border-top:1px solid ${C.line};` : ''}font:600 14px/1.4 ${SANS};color:${C.chalk};text-align:right">${esc(v)}</td>
</tr>`).join('');
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;background:${C.terrace};border-radius:10px">${rows}</table>`;
  }
  if ('note' in x) {
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 22px"><tr>
<td style="border-left:3px solid ${C.violet};padding:2px 0 2px 14px;font:14px/1.6 ${SANS};color:${C.chalk2}">${esc(x.note)}</td></tr></table>`;
  }
  if ('chip' in x) {
    // A line that matters, in a tinted block (Hello Klean's green bar, in violet).
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:2px 0 22px"><tr>
<td align="center" style="padding:13px 16px;border-radius:12px;background:#231c46;font:700 14px/1.45 ${SANS};color:${C.violetHi};text-align:center">${esc(x.chip)}</td></tr></table>`;
  }
  if ('code' in x) {
    return `<p style="margin:0 0 24px;font:800 38px/1 ${DISPLAY};letter-spacing:.18em;color:${C.chalk}">${esc(x.code)}</p>`;
  }
  return `<p style="margin:0 0 18px;font:13px/1.5 ${SANS};color:${C.chalk3};word-break:break-all">${esc(x.link)}<br><a href="${esc(x.href)}" style="color:${C.violetHi}">${esc(x.href)}</a></p>`;
}

/** The text-only twin of a part, for the plain-text alternative. */
function plain(x: Part): string {
  if ('p' in x) return x.p;
  if ('html' in x) return '';
  if ('button' in x) return `${x.button}: ${x.href}`;
  if ('facts' in x) return x.facts.map(([k, v]) => `${k}: ${v}`).join('\n');
  if ('note' in x) return x.note;
  if ('code' in x) return x.code;
  if ('chip' in x) return x.chip;
  return `${x.link}\n${x.href}`;
}

interface Frame {
  tag: string;
  subject: string;
  /** The line a mail app shows beside the subject. */
  preheader: string;
  heading: string;
  parts: Part[];
  /** Account and legal links under the body. Off for sign-in mail. */
  links?: boolean;
  /** The gambling line. Off for mail about the account itself. */
  gamble?: boolean;
  /**
   * The campaign look, after the emails the owner pointed at (Hello Klean,
   * Candy Creams, NYCFC): a ticker along the top, a hero picture with our
   * products floating round the headline (scripts/mail-art.mjs), a rounded
   * card that overlaps it, then coloured feature cards. The heading becomes
   * the hero's alt text; the card leads with `lead` in its place.
   */
  look?: Look;
}

export interface Look {
  /** Said along the ticker, twice. No ticker without it. */
  ticker?: string;
  /** public/brand/mail/<hero>.jpg, 600 wide (scripts/mail-art.mjs). */
  hero: string;
  /** The card's first line, under the hero. The hero's headline is enough without it. */
  lead?: string;
  /** Feature cards under the card, public/brand/mail/feature-<name>.png. */
  features?: Array<{ name: string; alt: string; href: string }>;
  /** Small print kept under the features rather than in the card. */
  after?: Part[];
}

/** The frame's body without the campaign look: the wordmark, then the card. */
function plainBody(f: Frame, linkRow: string, foot: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.pitch}"><tr><td align="center" style="padding:28px 0 36px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">
<tr><td class="pad" style="padding:0 30px 18px">
<a href="${SITE}" style="text-decoration:none;font:700 24px/1 ${SANS};letter-spacing:-1px;color:${C.chalk}">offside<span style="display:inline-block;width:6px;height:6px;margin:0 2px 0 2px;border-radius:3px;background:${C.violetHi};vertical-align:baseline"></span><span style="color:${C.chalk3}">win</span></a>
</td></tr>
<tr><td class="card" style="background:${C.stand};border:1px solid ${C.line};border-radius:16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
<tr><td style="height:3px;line-height:3px;font-size:0;background:${C.violet};border-radius:16px 16px 0 0">&nbsp;</td></tr>
<tr><td class="pad" style="padding:34px 30px 12px">
<h1 class="h1" style="margin:0 0 22px;font:800 40px/1 ${DISPLAY};letter-spacing:.005em;color:${C.chalk}">${esc(f.heading)}</h1>
${f.parts.map(part).join('\n')}
${linkRow}
</td></tr>
<tr><td class="pad" style="padding:22px 30px 28px">
<p style="margin:0;padding-top:20px;border-top:1px solid ${C.line};font:12px/1.6 ${SANS};color:${C.chalk3}">${foot}</p>
</td></tr>
</table></td></tr>
<tr><td class="pad" style="padding:18px 30px 0;font:12px/1.5 ${SANS};color:${C.chalk3}">Offside.win &nbsp; <a href="${SITE}" style="color:${C.chalk3}">offside.win</a></td></tr>
</table></td></tr></table>`;
}

/*
 * The campaign look. Everything that sits over the hero picture is drawn
 * into it (the card's rounded top included), so the overlap holds in every
 * mail app; the card below is 93.33% wide to meet that drawn top exactly
 * (560 of 600) at any size the email is shown.
 */
function lookBody(f: Frame, look: Look, linkRow: string, foot: string): string {
  // Twice, and allowed to wrap: a line that will not wrap sets the email's
  // width, and widened it past a phone's screen.
  const ticker = look.ticker ? [esc(look.ticker), esc(look.ticker)].join(' &nbsp;&bull;&nbsp; ') : '';
  const features = (look.features ?? []).map((x) => `<tr><td align="center" style="padding:0 0 18px"><a href="${esc(x.href)}" style="text-decoration:none"><img src="${SITE}/brand/mail/feature-${esc(x.name)}.png" width="560" alt="${esc(x.alt)}" style="display:block;width:100%;max-width:560px;height:auto;border:0;color:${C.chalk};font:600 16px/1.4 ${SANS}"></a></td></tr>`).join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.pitch}"><tr><td align="center" style="padding:0 0 36px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px">
${ticker ? `<tr><td style="background:${C.violet};padding:9px 12px;font:800 11px/1.3 ${SANS};letter-spacing:.12em;text-transform:uppercase;color:#ffffff;text-align:center">${ticker}</td></tr>` : ''}
<tr><td style="font-size:0;line-height:0;background:#1a1145"><a href="${SITE}" style="text-decoration:none"><img src="${SITE}/brand/mail/${esc(look.hero)}.jpg" width="600" alt="${esc(f.heading)}" style="display:block;width:100%;max-width:600px;height:auto;border:0;background:#1a1145;color:${C.chalk};font:800 40px/1.1 ${DISPLAY}"></a></td></tr>
<tr><td align="center" style="background:${C.pitch}">
<table role="presentation" width="93.33%" cellpadding="0" cellspacing="0" style="width:93.33%;background:${C.stand};border:1px solid ${C.line};border-top:0;border-radius:0 0 26px 26px">
<tr><td class="pad" align="center" style="padding:4px 30px 30px;text-align:center">
${look.lead ? `<h1 style="margin:0 0 14px;font:800 30px/1.08 ${DISPLAY};color:${C.chalk}">${esc(look.lead)}</h1>` : '<div style="height:10px;line-height:10px;font-size:0">&nbsp;</div>'}
${f.parts.map(part).join('\n').replace(/<table role="presentation" cellpadding="0" cellspacing="0" style="margin:6px 0 26px">/g, '<table role="presentation" align="center" cellpadding="0" cellspacing="0" style="margin:6px auto 26px">')}
</td></tr>
</table></td></tr>
${features ? `<tr><td align="center" style="padding:34px 0 8px;font:800 12px/1 ${SANS};letter-spacing:.12em;text-transform:uppercase;color:${C.chalk3}">What’s open to you now</td></tr>
<tr><td align="center" style="padding:10px 0 0"><table role="presentation" width="93.33%" cellpadding="0" cellspacing="0" style="width:93.33%">${features}</table></td></tr>` : ''}
${look.after?.length ? `<tr><td class="pad" style="padding:14px 30px 0">${look.after.map(part).join('\n')}</td></tr>` : ''}
<tr><td class="pad" align="center" style="padding:26px 30px 0;text-align:center">
<a href="${SITE}" style="text-decoration:none;font:700 22px/1 ${SANS};letter-spacing:-1px;color:${C.chalk}">offside<span style="display:inline-block;width:5px;height:5px;margin:0 2px;border-radius:3px;background:${C.violetHi};vertical-align:baseline"></span><span style="color:${C.chalk3}">win</span></a>
${linkRow ? linkRow.replace('margin:4px 0 0', 'margin:14px 0 0') : ''}
<p style="margin:18px 0 0;padding-top:18px;border-top:1px solid ${C.line};font:12px/1.6 ${SANS};color:${C.chalk3}">${foot}</p>
</td></tr>
</table></td></tr></table>`;
}

/*
 * Gmail on the iPhone, in dark mode, turns every email's colours over,
 * a dark one included: ours came out grey and white with dark type. Two fixes
 * it does respect:
 *   - a background drawn as a gradient image is left alone, so every flat
 *     background is given one of the same colour;
 *   - type wrapped in a screen-then-difference blend comes back as it was
 *     written (Rémi Parmentier's fix). The blend classes are reached only
 *     through `u + .body`, which matches nowhere but Gmail (it puts a <u>
 *     before the body), so every other app sees the email untouched.
 */
function gmailDark(html: string): string {
  // Spans, shown as blocks: a <div> inside a <p> closes the paragraph, and
  // the type falls out of its style.
  const wrap = (inner: string) => `<span class="gb-s" style="display:block"><span class="gb-d" style="display:block">${inner}</span></span>`;
  const head = html.slice(0, html.indexOf('<body'));
  let body = html.slice(html.indexOf('<body'));
  body = body.replace(/background:(#[0-9a-fA-F]{6})(?=[;"])/g, 'background:$1;background-image:linear-gradient($1,$1)');
  // Type: the inside of every paragraph and heading, and of every cell that
  // holds words rather than a table or a picture.
  body = body.replace(/(<(p|h1)\b[^>]*>)([\s\S]*?)(<\/\2>)/g, (_, open, _t, inner, close) => `${open}${wrap(inner)}${close}`);
  body = body.replace(/(<td\b[^>]*>)((?:(?!<td\b|<\/td>|<table\b|<img\b|<p\b|<h1\b)[\s\S])*?\S(?:(?!<td\b|<\/td>|<table\b|<img\b|<p\b|<h1\b)[\s\S])*?)(<\/td>)/g,
    (_, open, inner, close) => `${open}${wrap(inner)}${close}`);
  return head + body;
}

function compose(f: Frame): Mail {
  const links = f.links !== false;
  const gamble = f.gamble !== false;
  const foot = [
    gamble ? `18+. Offside.win gives opinions about football matches, not advice to bet. Only bet what you can afford to lose. <a href="https://www.begambleaware.org" style="color:${C.chalk3}">BeGambleAware.org</a>` : '',
    `Questions? Reply to this email or write to <a href="mailto:${SUPPORT}" style="color:${C.chalk3}">${SUPPORT}</a>.`,
  ].filter(Boolean).join('<br><br>');
  const linkRow = links
    ? `<p style="margin:4px 0 0;font:14px/1.6 ${SANS}"><a href="${SITE}/#/account" style="color:${C.violetHi};text-decoration:none">Your account</a>&nbsp;&nbsp;&nbsp;<a href="${SITE}/terms" style="color:${C.violetHi};text-decoration:none">Terms</a>&nbsp;&nbsp;&nbsp;<a href="${SITE}/privacy" style="color:${C.violetHi};text-decoration:none">Privacy</a></p>`
    : '';

  const html = `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark"><meta name="supported-color-schemes" content="dark">
<title>${esc(f.subject)}</title>
<link href="https://fonts.googleapis.com/css2?family=Big+Shoulders+Display:wght@700;800&display=swap" rel="stylesheet">
<style>:root{color-scheme:dark;supported-color-schemes:dark}u + .body .gb-s{background:#000;mix-blend-mode:screen}u + .body .gb-d{background:#000;mix-blend-mode:difference}a{color:${C.violetHi}}@media (max-width:480px){.card{border-radius:0!important}.pad{padding-left:22px!important;padding-right:22px!important}.h1{font-size:30px!important}}</style>
</head>
<body class="body" style="margin:0;padding:0;background:${C.pitch};-webkit-text-size-adjust:100%">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${C.pitch}">${esc(f.preheader)}&#8203;&nbsp;&#8203;&nbsp;&#8203;&nbsp;&#8203;&nbsp;&#8203;&nbsp;&#8203;&nbsp;&#8203;&nbsp;&#8203;&nbsp;</div>
${f.look ? lookBody(f, f.look, linkRow, foot) : plainBody(f, linkRow, foot)}
</body></html>`;

  const text = [
    f.heading, '',
    ...(f.look?.lead ? [f.look.lead, ''] : []),
    ...f.parts.map(plain).filter(Boolean).flatMap((t) => [t, '']),
    ...(f.look?.after ?? []).map(plain).filter(Boolean).flatMap((t) => [t, '']),
    ...(links ? [`Your account: ${SITE}/#/account`, `Terms: ${SITE}/terms`, ''] : []),
    `Questions? Reply to this email or write to ${SUPPORT}.`,
    ...(gamble ? ['', '18+. Offside.win gives opinions about football matches, not advice to bet. BeGambleAware.org'] : []),
  ].join('\n');

  return { subject: f.subject, html: gmailDark(html), text, tag: f.tag };
}

/* --------------------------------------------------------- the messages */

/** What a membership opens, as the coloured cards under the joining emails. */
const FEATURES: NonNullable<Look['features']> = [
  { name: 'calls', alt: 'Every call, and why: the pick, the odds, the bookmaker, and the reasons in plain football.', href: `${SITE}/#/board` },
  { name: 'slip', alt: 'The slip, built for you: our surest calls of the day, put together.', href: `${SITE}/#/board` },
  { name: 'alerts', alt: 'Told the minute it changes: team news turns a call, we pull it and email you.', href: `${SITE}/#/account` },
];

export interface MembershipMailInput {
  plan: string;
  /** When the paid period ends, epoch seconds. */
  until: number;
  /** What the buyer confirmed at checkout, if they did (purchases before the boxes existed did not). */
  consent?: { at: number; terms: string } | null;
}

/** "You're in": the membership confirmation, and the record of what was agreed. */
export function membershipMail({ plan, until, consent }: MembershipMailInput): Mail {
  const name = planName(plan);
  const renews = plan !== 'matchday';
  const when = longDate(until);
  const parts: Part[] = [
    { p: 'Every call, every leg of the bet slip and the reasons behind each one are open to you now.' },
    { chip: renews
      ? `Renews on ${shortDate(until)} at the same price. Stopping it takes one tap.`
      : `Runs to ${shortDate(until)}, then ends by itself. Nothing renews.` },
    { button: "See today's calls", href: `${SITE}/#/board` },
    { facts: [
      ['Plan', name],
      [renews ? 'Paid to' : 'Runs to', shortDate(until)],
      ['Renews', renews ? 'Yes, until you stop it' : 'No, it ends by itself'],
    ] },
  ];
  const after: Part[] = [
    { p: renews
      ? `It renews at the same price on ${when} unless you stop it. Stopping takes one tap on your account page, and you keep everything you have paid for until then.`
      : `It ends by itself on ${when}. Nothing renews and nothing more is charged.`, small: true },
  ];
  if (consent) {
    after.push({ note: `What you agreed: at checkout on ${longDate(consent.at)} you confirmed you are 18 or over and agreed to our terms of use (the version in force from ${termsDate(consent.terms)}). You asked for your membership to start straight away and accepted that, once it started, you lose the 14-day right to cancel for a change of mind. If anything of ours fails, you still get it put right or your money back.` });
  }
  after.push({ p: 'Members’ calls are for you alone. Don’t post, sell or pass them on.', small: true });

  return compose({
    tag: 'membership',
    subject: renews ? `You're in: your ${name.toLowerCase()} is on` : `You're in: your ${name.toLowerCase()} runs to ${shortDate(until)}`,
    preheader: renews ? `Everything is open. It renews on ${shortDate(until)} unless you stop it.` : `Everything is open until ${when}.`,
    heading: "You're in.",
    parts,
    look: {
      ticker: 'Every call is open',
      hero: 'hero-joined',
      lead: `Your ${name.toLowerCase()} is on.`,
      features: FEATURES,
      after,
    },
  });
}

export interface ReceiptInput {
  /** The payment's own id, from the processor: the receipt number is made from it. */
  paymentId: string;
  /** When it was paid, epoch seconds. */
  at: number;
  plan: string;
  amountMinor: number;
  currency: string;
  /** When the paid period runs to, epoch seconds, if known. */
  until?: number | null;
}

/**
 * Our receipt number for a payment: OW- and eight characters, the same every
 * time for the same payment, so a resent receipt carries the same number and
 * support can find it. FNV-1a over the processor's id, in base 36.
 */
export function receiptNumber(paymentId: string): string {
  // Two FNV-1a passes (forwards and backwards) for 64 bits, written in an
  // alphabet with no look-alikes (no 0/O, no 1/I/L), so it reads out cleanly.
  const ABC = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  let h = 0x811c9dc5, g = 0x2f6b9a31;
  for (let i = 0; i < paymentId.length; i++) { h ^= paymentId.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  for (let i = paymentId.length - 1; i >= 0; i--) { g ^= paymentId.charCodeAt(i); g = Math.imul(g, 0x01000193) >>> 0; }
  let out = '';
  for (let i = 0; i < 8; i++) {
    const src = i < 4 ? h : g;
    out += ABC[(src >>> ((i % 4) * 8)) % ABC.length];
  }
  return `OW-${out}`;
}

const money = (minor: number, currency: string) => new Intl.NumberFormat('en-GB', {
  style: 'currency', currency: /^[A-Z]{3}$/.test(currency) ? currency : 'GBP',
}).format(minor / 100);

/**
 * The receipt: ours, for every payment, sent as soon as the payment lands.
 * What was bought, what it cost, when, and the number to quote; the record a
 * buyer keeps, so it says nothing about who processed the card.
 */
export function receiptMail({ paymentId, at, plan, amountMinor, currency, until }: ReceiptInput): Mail {
  const name = planName(plan);
  const no = receiptNumber(paymentId);
  const paid = money(amountMinor, currency);
  const facts: Array<[string, string]> = [
    ['Receipt', no],
    ['Date', shortDate(at)],
    ['For', name],
    ...(until ? [['Covers', `To ${shortDate(until)}`] as [string, string]] : []),
    ['Paid', paid],
  ];
  return compose({
    tag: 'receipt',
    subject: `Your receipt from Offside.win, ${no}`,
    preheader: `${paid} for your ${name.toLowerCase()}. Keep this one.`,
    heading: 'Paid.',
    look: { ticker: 'Your receipt', hero: 'hero-receipt', lead: `${paid}, paid.` },
    parts: [
      { p: `Thanks. This is your receipt for your ${name.toLowerCase()}. Keep it for your records.` },
      { facts },
      { p: `Seller: Offside.win, offside.win. Questions about this payment? Reply to this email and quote ${no}.`, small: true },
      { button: 'Open your account', href: `${SITE}/#/account` },
    ],
  });
}

/** A renewing membership took its next payment. */
export function renewedMail({ plan, until }: { plan: string; until: number }): Mail {
  const name = planName(plan);
  return compose({
    tag: 'renewal',
    subject: `Renewed: you're in until ${shortDate(until)}`,
    preheader: 'Your membership renewed. Nothing to do.',
    heading: 'Renewed. Still in.',
    look: { ticker: 'Renewed', hero: 'hero-renewed', lead: `Your ${name.toLowerCase()} renewed.` },
    parts: [
      { p: `Your ${name.toLowerCase()} renewed, so nothing changes: every call stays open to you.` },
      { facts: [['Plan', name], ['Paid to', shortDate(until)], ['Next renewal', shortDate(until)]] },
      { p: 'Your receipt comes in its own email. Want it to stop renewing? One tap on your account page, and you keep the time you have paid for.' },
      { button: 'Open your account', href: `${SITE}/#/account` },
    ],
  });
}

/** Renewal switched off: nothing more will be charged. */
export function renewalStoppedMail({ plan, until }: { plan?: string | null; until?: number | null }): Mail {
  const name = plan ? planName(plan) : 'Membership';
  const facts: Array<[string, string]> = [['Plan', name], ['Renews', 'No']];
  if (until) facts.splice(1, 0, ['Open until', shortDate(until)]);
  return compose({
    tag: 'renewal-stopped',
    subject: until ? `Renewal stopped. You're in until ${shortDate(until)}` : 'Renewal stopped',
    preheader: 'Nothing more will be charged.',
    heading: 'Renewal stopped.',
    look: { ticker: 'Nothing more to pay', hero: 'hero-stopped' },
    parts: [
      { p: until
        ? `Done. Nothing more will be charged, and everything stays open to you until ${longDate(until)}. After that the site goes back to the free view.`
        : 'Done. Nothing more will be charged. You keep everything until the end of the time you have paid for.' },
      { facts },
      { p: 'Changed your mind? Pick a plan again from the pricing page whenever you like.' },
      { button: 'See plans', href: `${SITE}/#/pricing` },
    ],
  });
}

/** The money went back, so the access it bought ends now. */
export function accessEndedMail({ reason }: { reason: 'refund' | 'chargeback' | 'other' }): Mail {
  const why = reason === 'refund'
    ? 'Your payment was refunded, so the membership it paid for has ended today.'
    : reason === 'chargeback'
      ? 'Your bank reversed the payment, so the membership it paid for has ended today.'
      : 'Your membership has ended today.';
  return compose({
    tag: 'access-ended',
    subject: 'Your membership has ended',
    preheader: 'The free view stays open to you.',
    heading: 'Membership ended.',
    look: { hero: 'hero-ended' },
    parts: [
      { p: why },
      { p: 'Your account stays, and so does everything free: the day’s free call, every match page and the full results record, losses included.' },
      { p: 'Think this is a mistake? Reply to this email and it gets looked at by a person.', small: true },
      { button: 'Open the site', href: `${SITE}/#/home` },
    ],
  });
}

/** Free time from the owner's dashboard. */
export function freeTimeMail({ days, until }: { days: number; until: number }): Mail {
  const span = days === 1 ? 'a day' : days === 7 ? 'a week' : `${days} days`;
  return compose({
    tag: 'free-time',
    subject: `${span[0]!.toUpperCase()}${span.slice(1)} on us`,
    preheader: `Everything is open until ${shortDate(until)}. Nothing to pay.`,
    heading: `${span[0]!.toUpperCase()}${span.slice(1)} on us.`,
    look: { ticker: 'Free time on us', hero: 'hero-free', lead: `${span[0]!.toUpperCase()}${span.slice(1)} on us.`, features: FEATURES },
    parts: [
      { p: `Every call, every leg of the bet slip and the reasons behind each one are open to you until ${longDate(until)}.` },
      { facts: [['Open until', shortDate(until)], ['Cost', 'Nothing'], ['Renews', 'No']] },
      { p: 'No card is taken and nothing renews. When it ends the site goes back to the free view by itself.' },
      { button: "See today's calls", href: `${SITE}/#/board` },
    ],
  });
}

/** The account and what was held about it are gone. */
export function accountDeletedMail({ stoppedRenewal }: { stoppedRenewal: boolean }): Mail {
  return compose({
    tag: 'account-deleted',
    subject: 'Your Offside.win account is deleted',
    preheader: 'Your sign-in and your details are gone.',
    heading: 'Account deleted.',
    look: { hero: 'hero-deleted' },
    links: false,
    gamble: false,
    parts: [
      { p: 'Your sign-in, profile, follows and membership are gone. This email address can no longer sign in to Offside.win.' },
      ...(stoppedRenewal ? [{ p: 'Your renewal was stopped first, so nothing more will be charged.' } as Part] : []),
      { p: 'Payment records stay, because tax law requires it. Nothing else of yours is kept.', small: true },
      { p: 'You can make a new account with this address whenever you like. It starts from scratch.', small: true },
    ],
  });
}

/* ------------------------------------------------------- sign-in emails */

/** What Supabase's send-email hook asks for, by email_action_type. */
export type AuthAction =
  | 'magiclink' | 'signup' | 'invite' | 'recovery' | 'email' | 'email_change' | 'email_change_current'
  | 'reauthentication' | string;

/**
 * A sign-in or confirmation link, or a code.
 *
 * The site signs people in with a link only, so recovery (there are no
 * passwords) reads as a sign-in, and the six-digit code is shown only where
 * Supabase sends nothing else.
 */
export function authMail({ action, link, code, newEmail }: { action: AuthAction; link: string | null; code?: string | null; newEmail?: string | null }): Mail {
  const tail: Part[] = [
    { p: 'It works once, and only for the next hour. Open it on the phone or computer you want to be signed in on.', small: true },
    { p: 'Didn’t ask for this? Ignore it. Nobody gets in without this email.', small: true },
  ];
  const fallback: Part[] = link ? [{ link: 'Button not working? Paste this into your browser:', href: link }] : [];

  if (action === 'reauthentication' || !link) {
    return compose({
      tag: 'auth-code', links: false, gamble: false,
      subject: `Your Offside.win code: ${code ?? ''}`.trim(),
      preheader: 'Type this code where you were asked for it.',
      heading: 'Your code.',
      look: { hero: 'hero-code' },
      parts: [
        { p: 'Type this where Offside.win asked for it.' },
        { code: code ?? '' },
        { p: 'It runs out within the hour. Didn’t ask for this? Ignore it.', small: true },
      ],
    });
  }
  if (action === 'signup') {
    return compose({
      tag: 'auth-signup', links: false, gamble: false,
      subject: 'Confirm your email for Offside.win',
      preheader: 'One tap and your account is ready.',
      heading: 'One tap and you’re set.',
      look: { hero: 'hero-confirm' },
      parts: [
        { p: 'Confirm this is your email and your Offside.win account is ready. You’ll be signed in straight away.' },
        { button: 'Confirm and sign in', href: link },
        ...tail, ...fallback,
      ],
    });
  }
  if (action === 'invite') {
    return compose({
      tag: 'auth-invite', links: false, gamble: false,
      subject: 'You’ve been invited to Offside.win',
      preheader: 'Tap to accept and sign in.',
      heading: 'You’re invited.',
      look: { hero: 'hero-invite' },
      parts: [
        { p: 'An Offside.win account has been set up for this email. Tap to accept it and sign in.' },
        { button: 'Accept and sign in', href: link },
        ...tail, ...fallback,
      ],
    });
  }
  if (action === 'email_change') {
    return compose({
      tag: 'auth-email-change', links: false, gamble: false,
      subject: 'Confirm your new email for Offside.win',
      preheader: 'Tap to move your account to this address.',
      heading: 'Confirm your new email.',
      look: { hero: 'hero-confirm', lead: 'Confirm your new email.' },
      parts: [
        { p: 'Tap to move your Offside.win account to this address. Until you do, nothing changes.' },
        { button: 'Confirm new email', href: link },
        ...tail, ...fallback,
      ],
    });
  }
  if (action === 'email_change_current') {
    return compose({
      tag: 'auth-email-change', links: false, gamble: false,
      subject: 'Your Offside.win email is changing',
      preheader: newEmail ? `To ${newEmail}. Tap to confirm.` : 'Tap to confirm.',
      heading: 'Your email is changing.',
      look: { hero: 'hero-account', lead: 'Your email is changing.' },
      parts: [
        { p: newEmail
          ? `Someone asked to move your Offside.win account to ${newEmail}. If that was you, confirm it here too.`
          : 'Someone asked to move your Offside.win account to a new address. If that was you, confirm it here too.' },
        { button: 'Confirm the change', href: link },
        { p: 'Wasn’t you? Ignore this and the change does not happen. Then write to us.', small: true },
        ...fallback,
      ],
    });
  }
  // magiclink, recovery, email, and anything new: a sign-in link.
  return compose({
    tag: 'auth-signin', links: false, gamble: false,
    subject: 'Your sign-in link for Offside.win',
    preheader: 'Tap to sign in. The link works once.',
    heading: 'Tap to sign in.',
    look: { hero: 'hero-signin' },
    parts: [
      { p: 'Here’s your link to Offside.win. No password, nothing to remember.' },
      { button: 'Sign in to Offside.win', href: link },
      ...tail, ...fallback,
    ],
  });
}

/** Supabase's security notices (password changed, identity linked and so on). */
export function noticeMail(action: string): Mail {
  const what: Record<string, string> = {
    email_changed_notification: 'The email address on your Offside.win account was changed.',
    identity_linked_notification: 'A new way of signing in was linked to your Offside.win account.',
    identity_unlinked_notification: 'A way of signing in was removed from your Offside.win account.',
    password_changed_notification: 'The password on your Offside.win account was changed.',
  };
  return compose({
    tag: 'auth-notice', gamble: false,
    subject: 'A change to your Offside.win account',
    preheader: 'If this was you, there is nothing to do.',
    heading: 'Your account changed.',
    look: { hero: 'hero-account' },
    parts: [
      { p: what[action] ?? 'A sign-in setting on your Offside.win account was changed.' },
      { p: 'If this was you, there is nothing to do. If it wasn’t, reply to this email straight away.' },
    ],
  });
}

/* --------------------------------------------------------- quiet days */

/**
 * The club game has stopped (an international break, the close season), so
 * the membership stops counting down: a day added for every quiet day, done
 * for them (goodwill.ts). Sent once, when it starts.
 */
export function goodwillStartMail({ until, whop }: { until: number | null; whop: boolean }): Mail {
  return compose({
    tag: 'goodwill-start',
    subject: 'Quiet spell: a day added to your membership for every day of it',
    preheader: 'Nothing to do. We will tell you the total when the football is back.',
    heading: 'Your membership is on pause too.',
    look: { ticker: 'Quiet days, given back', hero: 'hero-quiet', lead: 'Your membership is on pause too.' },
    parts: [
      { p: 'The big leagues have stopped for a few days. Fewer matches means fewer calls, and that is not what you paid for.' },
      { p: `So for every quiet day, we add a day to your membership. Automatically, nothing to claim, nothing extra to pay${whop ? ', and your next payment moves back by the same' : ''}.` },
      ...(until ? [{ facts: [['Added so far', '1 day'], [whop ? 'Next payment' : 'Now runs to', shortDate(until)]] as Array<[string, string]> } as Part] : []),
      { p: 'We will email you the total when the football is back. The calls that are on carry on as normal in the meantime.' },
      { button: 'See what is on', href: `${SITE}/today` },
    ],
  });
}

/** The quiet spell is over: how many days were added, and the new date. */
export function goodwillEndMail({ days, until, whop }: { days: number; until: number | null; whop: boolean }): Mail {
  const n = days === 1 ? 'a day' : `${days} days`;
  const live = until !== null && until > Date.now() / 1000;
  return compose({
    tag: 'goodwill-end',
    subject: `The football is back. We added ${n} to your membership`,
    preheader: live ? `${whop ? 'Next payment' : 'Now runs to'} ${shortDate(until!)}.` : 'One for every quiet day.',
    heading: `${n[0]!.toUpperCase()}${n.slice(1)} added.`,
    look: { ticker: 'The football is back', hero: 'hero-back', lead: `${n[0]!.toUpperCase()}${n.slice(1)} added.` },
    parts: [
      { p: `The quiet spell is over. We added ${n} to your membership, one for every day the big leagues were off.` },
      ...(live ? [{ facts: [['Days added', String(days)], [whop ? 'Next payment' : 'Now runs to', shortDate(until!)]] as Array<[string, string]> } as Part] : []),
      { p: 'Nothing to do. It happens by itself every break, and every close season.' },
      { button: "See today's calls", href: `${SITE}/today` },
    ],
  });
}

/* ------------------------------------------------------ pulled calls */

export interface PulledMailCall {
  home: string;
  away: string;
  kickoff: number;
  /** The call in words, as the site names it. */
  label: string;
  odds: number;
  bookmaker?: string | null;
  /** Why, in the house voice (engine/src/pulled.ts). */
  reason: string;
  /** The call that replaced it, if one did. */
  replaced_by?: string | null;
  /** The match page. */
  href: string;
}

const kickoffUk = (epoch: number) => new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
}).format(new Date(epoch * 1000)).replace(',', '');

const NUMBER = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];

/**
 * We've taken a call down before kick-off: what it was, why, and what
 * replaced it. Several in one email when a run of team news takes down more
 * than one, so a busy Saturday is one message, not five.
 */
export function pulledMail(calls: PulledMailCall[]): Mail {
  const one = calls.length === 1;
  const first = calls[0]!;
  const tie = (c: PulledMailCall) => `${c.home} v ${c.away}`;
  const odds = (c: PulledMailCall) => (Number.isFinite(c.odds) && c.odds > 1 ? ` at odds of ${c.odds.toFixed(2)}` : '');
  const parts: Part[] = [
    { p: one
      ? 'Late news changed our mind before kick-off, so we’re telling you straight away.'
      : 'Late news changed our mind on these before kick-off, so we’re telling you straight away.' },
  ];
  for (const c of calls) {
    parts.push({ facts: [['Match', tie(c)], ['Kick-off', kickoffUk(c.kickoff)], ['We were on', `${c.label}${odds(c)}`]] });
    parts.push({ note: c.reason });
    if (c.replaced_by) parts.push({ p: `We’ve switched to ${c.replaced_by}. It’s on the match page.` });
    if (!one) parts.push({ html: `<p style="margin:-6px 0 26px;font:600 15px/1.4 ${SANS}"><a href="${esc(c.href)}" style="color:${C.violetHi};text-decoration:none">See ${esc(tie(c))}</a></p>` });
  }
  if (one) parts.push({ button: 'See the match', href: first.href });
  parts.push({ p: 'You get these because you’re a member. You can turn them off on your account page.', small: true });
  return compose({
    tag: 'pulled',
    subject: one ? `Call pulled: ${tie(first)}` : `${calls.length} calls pulled before kick-off`,
    preheader: one ? first.reason : calls.map(tie).join(', '),
    heading: one ? 'We’ve pulled a call.' : `We’ve pulled ${NUMBER[calls.length] ?? calls.length} calls.`,
    look: { ticker: 'Team news', hero: 'hero-pulled', lead: one ? `${first.home} v ${first.away}` : `${NUMBER[calls.length] ?? calls.length} calls changed` },
    parts,
  });
}
