/**
 * Support: mail to support@ and hello@ kept as tickets, answered as support@.
 *
 * In. Cloudflare Email Routing hands every message for those two addresses to
 * this Worker (the `email` handler in index.ts). It is parsed, kept as a ticket
 * (support_inbound in schema.pg.sql), and then forwarded, untouched, to the
 * owner's own inbox, so a new message still arrives on their phone the way any
 * email does. Keeping and forwarding are independent: if the database cannot
 * take it, the forward still goes; if the forward fails, the ticket is there.
 * Nothing is ever bounced back to the sender.
 *
 * Out. The owner answers from the dashboard (#/admin/support). The reply goes
 * out through the same Cloudflare Email Service the site's own mail uses, from
 * support@offside.win, with the ticket's number in the subject and the
 * In-Reply-To and References headers set, so it threads in the customer's
 * mail app and their answer comes back to the same ticket.
 *
 * What a stranger sends is kept as plain text only and never rendered as HTML.
 * Automatic mail (out-of-office, bounces, mailing lists) is forwarded but not
 * made a ticket, so an autoresponder cannot reopen a closed one forever.
 */

import PostalMime from 'postal-mime';
import type { AdminEnv } from './admin.ts';

export const SUPPORT_FROM = 'support@offside.win';
const FROM_NAME = 'Offside.win support';
/** Where the owner's copies go: written by `mail:route` (engine/src/mailroute.ts). */
const FORWARD_KEY = 'support:forward';
/** Larger than this is kept as a ticket from its headers alone; the forward still carries all of it. */
const MAX_PARSE = 8 * 1024 * 1024;
const MAX_BODY = 20_000;

export interface InboundMessage {
  readonly from: string;
  readonly to: string;
  readonly headers: Headers;
  readonly raw: ReadableStream<Uint8Array>;
  readonly rawSize: number;
  forward(rcptTo: string, headers?: Headers): Promise<unknown>;
}

async function rpc(env: AdminEnv, fn: string, args: Record<string, unknown>): Promise<{ ok: boolean; body: any }> {
  const res = await fetch(new URL(`/rest/v1/rpc/${fn}`, env.SUPABASE_URL), {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_ANON_KEY,
      authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify(args),
  });
  const body = await res.json().catch(() => null);
  return { ok: res.ok, body };
}

/** The owner's inbox for the copies, or null when none is set. */
export async function forwardAddress(env: AdminEnv): Promise<string | null> {
  if (!env.SUPABASE_SERVICE_KEY) return null;
  try {
    const res = await fetch(new URL(`/rest/v1/kv?k=eq.${encodeURIComponent(FORWARD_KEY)}&select=v`, env.SUPABASE_URL), {
      headers: { apikey: env.SUPABASE_ANON_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`, accept: 'application/json' },
    });
    const rows = res.ok ? (await res.json()) as Array<{ v: string }> : [];
    const v = rows[0] ? JSON.parse(rows[0].v) as { to?: unknown } : null;
    return typeof v?.to === 'string' && /^[^@\s]+@[^@\s]+$/.test(v.to) ? v.to : null;
  } catch {
    return null;
  }
}

/**
 * Mail no person wrote: out-of-office replies, bounces, lists and newsletters.
 * RFC 3834's Auto-Submitted, the older X-Autoreply and Precedence, and the
 * addresses that only ever send automatically. Mail from our own domain is
 * included, so a reply of ours that loops back is never a new ticket.
 */
export function automatic(headers: Headers, from: string): boolean {
  const auto = (headers.get('auto-submitted') ?? '').trim().toLowerCase();
  if (auto && auto !== 'no') return true;
  if (headers.has('x-autoreply') || headers.has('x-autorespond')) return true;
  if (/^(bulk|junk|list|auto_reply)$/i.test((headers.get('precedence') ?? '').trim())) return true;
  if (headers.has('list-id') || headers.has('list-unsubscribe')) return true;
  const f = from.toLowerCase();
  if (/^(mailer-daemon|postmaster|no-?reply|do-?not-?reply|bounces?)([+@])/.test(f)) return true;
  return f.endsWith('@offside.win');
}

/** HTML as readable text, for a message with no plain part. Tags out, entities decoded, breaks kept. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6]|blockquote)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Every Message-ID this one refers to, angle brackets kept, space-separated. */
function refsOf(headers: Headers, parsed?: { inReplyTo?: string; references?: string }): string {
  return [parsed?.inReplyTo ?? headers.get('in-reply-to') ?? '', parsed?.references ?? headers.get('references') ?? '']
    .join(' ').replace(/\s+/g, ' ').trim();
}

/** One email in: kept as a ticket, then forwarded to the owner. Never throws. */
export async function inbound(message: InboundMessage, env: AdminEnv): Promise<void> {
  const forwardTo = await forwardAddress(env);
  let ticket: number | null = null;
  try {
    let from = message.from;
    let name: string | null = null;
    let subject = message.headers.get('subject') ?? '';
    let body = '';
    let mid = message.headers.get('message-id') ?? '';
    let refs = refsOf(message.headers);
    let attachments = 0;
    if (message.rawSize <= MAX_PARSE) {
      const email = await PostalMime.parse(message.raw);
      from = email.from?.address || from;
      name = email.from?.name || null;
      subject = email.subject ?? subject;
      body = (email.text?.trim() ? email.text : htmlToText(email.html ?? '')).replace(/\r\n?/g, '\n').trim();
      mid = email.messageId || mid;
      refs = refsOf(message.headers, email);
      attachments = email.attachments?.length ?? 0;
    } else {
      body = '(This email was too large to keep here. It is in your inbox.)';
    }
    if (automatic(message.headers, from)) {
      console.log('support: automatic mail, forwarded only');
    } else if (env.SUPABASE_SERVICE_KEY) {
      const r = await rpc(env, 'support_inbound', {
        p_from: from, p_name: name, p_to: message.to, p_subject: subject,
        p_body: body.slice(0, MAX_BODY) || '(No text in this email.)',
        p_message_id: mid, p_refs: refs, p_attachments: attachments,
      });
      ticket = r.ok && Number.isFinite(Number(r.body?.ticket)) ? Number(r.body.ticket) : null;
      console.log('support: kept', ticket !== null ? (r.body?.new ? 'new ticket' : 'on an existing ticket') : `no (${r.ok ? 'refused' : 'database error'})`);
    }
  } catch (err) {
    // The type only: a message can echo the sender.
    console.error('support: could not read the email', err instanceof Error ? err.name : 'error');
  }
  if (forwardTo) {
    try {
      const h = new Headers();
      if (ticket !== null) h.set('X-Offside-Ticket', String(ticket));
      await message.forward(forwardTo, h);
    } catch (err) {
      console.error('support: forward failed', err instanceof Error ? err.name : 'error');
    }
  }
}

/* ------------------------------------------------------------------ out */

const escHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** The subject a reply carries: "Re: …" once, and the ticket number once. */
export function replySubject(subject: string, ticket: number): string {
  const base = subject.replace(/\s*\[#\d+\]\s*/g, ' ').trim() || 'Your message';
  return `${/^re:/i.test(base) ? base : `Re: ${base}`} [#${ticket}]`;
}

/** The part of a message that is new: everything above "On … wrote:" or the first quoted line. */
export function newPart(body: string): string {
  const lines = body.replace(/\r\n?/g, '\n').split('\n');
  const cut = lines.findIndex((l, i) => /^>/.test(l) || (/^On .+wrote:\s*$/.test(l)) || (/^-{2,}\s*Original Message/i.test(l))
    || (/^On .+$/.test(l) && /wrote:\s*$/.test(lines[i + 1] ?? '')));
  return (cut > 0 ? lines.slice(0, cut) : lines).join('\n').trim();
}

/** A reply: what was written, signed, with their last message quoted under it. */
export function composeReply(text: string, quote?: { at: number; name: string | null; email: string; body: string }) {
  const sign = '\n\nOffside.win\nhttps://offside.win';
  const quoted = quote
    ? `\n\nOn ${new Date(quote.at * 1000).toUTCString().replace(/:\d\d GMT$/, ' GMT')}, ${quote.name || quote.email} wrote:\n`
      + newPart(quote.body).split('\n').slice(0, 40).map((l) => `> ${l}`).join('\n')
    : '';
  const plain = `${text.trim()}${sign}${quoted}`;
  const paras = text.trim().split(/\n{2,}/).map((p) => `<p style="margin:0 0 14px">${escHtml(p).replace(/\n/g, '<br>')}</p>`).join('');
  const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;font-size:15px;line-height:1.5;color:#1d1b17">${paras}`
    + `<p style="margin:18px 0 0;color:#5f5a50">Offside.win<br><a href="https://offside.win" style="color:#5b3fd9">offside.win</a></p>`
    + (quote ? `<blockquote style="margin:18px 0 0;padding-left:12px;border-left:3px solid #ddd;color:#6b665c">${escHtml(newPart(quote.body).split('\n').slice(0, 40).join('\n')).replace(/\n/g, '<br>')}</blockquote>` : '')
    + '</div>';
  return { text: plain, html };
}

const SEND_REFUSED: Record<string, string> = {
  E_SENDER_NOT_VERIFIED: 'Cloudflare will not send from offside.win yet. In Cloudflare: Compute, Email Service, Email Sending, then add offside.win.',
  E_RATE_LIMIT_EXCEEDED: 'Cloudflare’s sending limit is reached for now. Try again in a few minutes.',
};

/** Send one support email. The id Cloudflare gave it, or why it did not go. */
export async function sendSupport(env: AdminEnv & { EMAIL?: any }, m: {
  to: string; subject: string; text: string; html: string; inReplyTo?: string | null; references?: string | null;
}): Promise<{ id: string | null } | { error: string }> {
  if (!env.EMAIL) return { error: 'Sending is not switched on for the site yet.' };
  const headers: Record<string, string> = {};
  if (m.inReplyTo) headers['In-Reply-To'] = `<${m.inReplyTo.replace(/^<|>$/g, '')}>`;
  if (m.references) headers['References'] = m.references;
  const base = { to: m.to, from: { email: SUPPORT_FROM, name: FROM_NAME }, replyTo: { email: SUPPORT_FROM, name: FROM_NAME }, subject: m.subject, text: m.text, html: m.html };
  try {
    const r = await env.EMAIL.send(Object.keys(headers).length ? { ...base, headers } : base);
    return { id: r?.messageId ?? null };
  } catch (err) {
    const code = String((err as { code?: unknown })?.code ?? '');
    // Threading headers are a nicety. If they are what was refused, send without them.
    if (Object.keys(headers).length && !SEND_REFUSED[code]) {
      try {
        const r = await env.EMAIL.send(base);
        return { id: r?.messageId ?? null };
      } catch (again) {
        const c2 = String((again as { code?: unknown })?.code ?? '');
        console.error('support: send refused', c2 || 'error');
        return { error: SEND_REFUSED[c2] ?? 'Cloudflare refused to send it. Nothing was sent.' };
      }
    }
    console.error('support: send refused', code || 'error');
    return { error: SEND_REFUSED[code] ?? 'Cloudflare refused to send it. Nothing was sent.' };
  }
}
