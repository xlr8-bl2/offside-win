import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.ts';
import { sha256Hex } from '../src/admin.ts';
import { automatic, composeReply, htmlToText, inbound, newPart, replySubject } from '../src/support.ts';

/**
 * Support (support.ts): mail in becomes a ticket and still reaches the owner;
 * replies go out as support@ and thread. PostgREST, GoTrue and Cloudflare's
 * sending are stubbed.
 */

const OWNER = 'owner@example.com';
const OWNER_ID = '11111111-1111-1111-1111-111111111111';
const realFetch = globalThis.fetch;
let ENV: any;
let rpcs: Array<{ fn: string; args: any }> = [];
let answers: Record<string, unknown> = {};
let sent: any[] = [];

beforeEach(async () => {
  rpcs = []; sent = []; answers = {};
  ENV = {
    SUPABASE_URL: 'https://project.supabase.co', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_KEY: 'service',
    ADMIN_EMAIL_SHA256: await sha256Hex(OWNER),
    ASSETS: { fetch: async () => new Response('page') },
    EMAIL: { send: async (m: any) => { sent.push(m); return { messageId: `<out${sent.length}@offside.win>` }; } },
  };
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = String(input);
    if (url.includes('/auth/v1/user')) return new Response(JSON.stringify({ id: OWNER_ID, email: OWNER, email_confirmed_at: 'x' }));
    if (url.includes('/rest/v1/kv')) return new Response(JSON.stringify([{ v: JSON.stringify({ to: 'me@icloud.com' }) }]));
    const m = /\/rest\/v1\/rpc\/(\w+)/.exec(url);
    if (m) {
      const args = JSON.parse(init?.body ?? '{}');
      rpcs.push({ fn: m[1]!, args });
      return new Response(JSON.stringify(answers[m[1]!] ?? { ok: true }));
    }
    return new Response('not stubbed', { status: 500 });
  }) as typeof fetch;
});
afterEach(() => { globalThis.fetch = realFetch; });

function message(raw: string, headers: Record<string, string> = {}, to = 'support@offside.win') {
  const forwarded: Array<{ to: string; headers?: Headers }> = [];
  const h = new Headers(headers);
  return {
    forwarded,
    msg: {
      from: 'jo@example.com', to, headers: h,
      raw: new Response(raw).body!, rawSize: raw.length,
      forward: async (rcpt: string, hh?: Headers) => { forwarded.push({ to: rcpt, headers: hh }); },
    },
  };
}

const RAW = [
  'From: Jo Bloggs <jo@example.com>',
  'To: support@offside.win',
  'Subject: Refund please',
  'Message-ID: <abc@mail.example>',
  'Content-Type: text/plain; charset=utf-8',
  '',
  'Hi, I paid twice.',
  '',
].join('\r\n');

test('an email in becomes a ticket, and the original still reaches the owner', async () => {
  answers['support_inbound'] = { ticket: 7, new: true };
  const { msg, forwarded } = message(RAW);
  await inbound(msg, ENV);
  assert.equal(rpcs.length, 1);
  assert.equal(rpcs[0]!.fn, 'support_inbound');
  assert.equal(rpcs[0]!.args.p_from, 'jo@example.com');
  assert.equal(rpcs[0]!.args.p_name, 'Jo Bloggs');
  assert.equal(rpcs[0]!.args.p_subject, 'Refund please');
  assert.match(rpcs[0]!.args.p_body, /paid twice/);
  assert.match(rpcs[0]!.args.p_message_id, /abc@mail\.example/);
  assert.equal(forwarded.length, 1);
  assert.equal(forwarded[0]!.to, 'me@icloud.com');
  assert.equal(forwarded[0]!.headers?.get('X-Offside-Ticket'), '7');
});

test('the forward still goes when the database is down', async () => {
  globalThis.fetch = (async (input: any) => {
    const url = String(input);
    if (url.includes('/rest/v1/kv')) return new Response(JSON.stringify([{ v: JSON.stringify({ to: 'me@icloud.com' }) }]));
    return new Response('down', { status: 503 });
  }) as typeof fetch;
  const { msg, forwarded } = message(RAW);
  await inbound(msg, ENV);
  assert.equal(forwarded.length, 1);
  assert.equal(forwarded[0]!.headers?.has('X-Offside-Ticket'), false);
});

test('an out-of-office reply is forwarded but never made a ticket', async () => {
  const { msg, forwarded } = message(RAW.replace('Subject:', 'Auto-Submitted: auto-replied\r\nSubject:'), { 'auto-submitted': 'auto-replied' });
  await inbound(msg, ENV);
  assert.equal(rpcs.length, 0);
  assert.equal(forwarded.length, 1);
  assert.ok(automatic(new Headers({ 'list-id': '<news.example>' }), 'news@example.com'));
  assert.ok(automatic(new Headers(), 'MAILER-DAEMON@mx.example'));
  assert.ok(automatic(new Headers(), 'support@offside.win'), 'our own mail looping back');
  assert.ok(!automatic(new Headers({ 'auto-submitted': 'no' }), 'jo@example.com'));
});

test('an HTML-only email is kept as text, never as HTML', async () => {
  const raw = RAW.replace('text/plain', 'text/html').replace('Hi, I paid twice.', '<p>Hi <b>there</b></p><script>alert(1)</script><p>Line two</p>');
  const { msg } = message(raw);
  await inbound(msg, ENV);
  assert.equal(rpcs[0]!.args.p_body, 'Hi there\nLine two');
  assert.equal(htmlToText('a&amp;b<br>c'), 'a&b\nc');
});

test('reply subjects: Re once, the ticket number once', () => {
  assert.equal(replySubject('Refund please', 7), 'Re: Refund please [#7]');
  assert.equal(replySubject('Re: Refund please [#7]', 7), 'Re: Refund please [#7]');
  assert.equal(replySubject('', 3), 'Re: Your message [#3]');
});

test('only the new part of a message is quoted', () => {
  assert.equal(newPart('Thanks!\n\nOn Mon, 6 Oct 2026, Offside wrote:\n> old'), 'Thanks!');
  assert.equal(newPart('Thanks!\n> old'), 'Thanks!');
  const r = composeReply('Sorted <now>.', { at: 0, name: 'Jo', email: 'jo@example.com', body: 'Hi\n> older' });
  assert.match(r.text, /^Sorted <now>\.\n\nOffside\.win/);
  assert.match(r.text, /Jo wrote:\n> Hi$/);
  assert.match(r.html, /Sorted &lt;now&gt;\./);
  assert.doesNotMatch(r.html, /<now>/);
});

async function adminCall(path: string, body?: unknown) {
  const res = await worker.fetch(new Request(`https://offside.win/api/admin/${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { authorization: 'Bearer t', 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  }), ENV);
  return { status: res.status, body: await res.json().catch(() => null) as any };
}

test('a reply goes out as support@, threaded, and is kept on the ticket', async () => {
  answers['admin_support_ticket'] = {
    ticket: { id: 7, email: 'jo@example.com', name: 'Jo', subject: 'Refund please', status: 'open' },
    messages: [{ direction: 'in', at: 1, body: 'Hi, I paid twice.', message_id: 'abc@mail.example', from_email: 'jo@example.com' }],
  };
  const r = await adminCall('support/reply', { id: 7, body: 'Refunded today.', close: true });
  assert.equal(r.status, 200);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'jo@example.com');
  assert.equal(sent[0].from.email, 'support@offside.win');
  assert.equal(sent[0].subject, 'Re: Refund please [#7]');
  assert.equal(sent[0].headers['In-Reply-To'], '<abc@mail.example>');
  const saved = rpcs.find((c) => c.fn === 'admin_support_reply')!;
  assert.equal(saved.args.p_actor, OWNER_ID);
  assert.equal(saved.args.p_body, 'Refunded today.');
  assert.equal(saved.args.p_message_id, '<out1@offside.win>');
  assert.equal(saved.args.p_close, true);
});

test('a reply Cloudflare refuses is not recorded as sent', async () => {
  ENV.EMAIL = { send: async () => { throw Object.assign(new Error('x'), { code: 'E_SENDER_NOT_VERIFIED' }); } };
  answers['admin_support_ticket'] = { ticket: { id: 7, email: 'jo@example.com', subject: 's' }, messages: [] };
  const r = await adminCall('support/reply', { id: 7, body: 'Hello' });
  assert.equal(r.status, 502);
  assert.match(r.body.error, /Email Sending/);
  assert.equal(rpcs.some((c) => c.fn === 'admin_support_reply'), false);
});

test('a new email gets a ticket number first, and loses the ticket if it never went', async () => {
  answers['admin_support_new'] = { id: 12 };
  const ok = await adminCall('support/new', { to: 'Sam@Example.com', subject: 'Your refund', body: 'Done.' });
  assert.equal(ok.status, 200);
  assert.equal(sent[0].subject, 'Your refund [#12]');
  assert.equal(sent[0].to, 'sam@example.com');
  ENV.EMAIL = { send: async () => { throw new Error('nope'); } };
  rpcs = [];
  const bad = await adminCall('support/new', { to: 'sam@example.com', subject: 'Again', body: 'x' });
  assert.equal(bad.status, 502);
  assert.ok(rpcs.some((c) => c.fn === 'admin_support_drop' && c.args.p_id === 12));
  assert.equal((await adminCall('support/new', { to: 'not an address', subject: 's', body: 'b' })).status, 400);
});

test('the inbox and its states are only for the owner', async () => {
  globalThis.fetch = (async (input: any) => String(input).includes('/auth/v1/user')
    ? new Response(JSON.stringify({ id: OWNER_ID, email: 'someone@else.com', email_confirmed_at: 'x' }))
    : new Response('[]')) as typeof fetch;
  assert.equal((await adminCall('support?status=open')).status, 403);
  assert.equal((await adminCall('support/reply', { id: 1, body: 'x' })).status, 403);
});
