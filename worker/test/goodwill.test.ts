import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { goodwill } from '../src/goodwill.ts';
import { goodwillEndMail, goodwillStartMail } from '../src/mail.ts';
import { findBannedInProse } from '../../engine/src/vocabulary.ts';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

const NOW = Date.UTC(2026, 9, 8, 7) / 1000;

function env(rpcs: Record<string, (body: any) => unknown>, calls: string[]) {
  globalThis.fetch = (async (input: any, init: any) => {
    const url = String(input.url ?? input);
    calls.push(url.replace(/^https?:\/\/[^/]+/, ''));
    const fn = url.match(/\/rpc\/(\w+)/)?.[1];
    if (fn && rpcs[fn]) return new Response(JSON.stringify(rpcs[fn]!(JSON.parse(init?.body ?? '{}'))), { status: 200 });
    if (url.includes('add_free_days')) return new Response(JSON.stringify({ id: 'mem_A', renewal_period_end: '2026-11-09T00:00:00Z' }), { status: 200 });
    if (url.includes('brevo')) return new Response('{}', { status: 201 });
    return new Response('null', { status: 200 });
  }) as any;
  return { SUPABASE_URL: 'https://db.example', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_KEY: 'svc', WHOP_API_KEY: 'whop', BREVO_API_KEY: 'k' };
}

test('a quiet day: Whop moves the renewal, the new period is recorded, the first email goes once', async () => {
  const calls: string[] = [];
  const applied: any[] = [];
  const noted = new Set<string>();
  const e = env({
    goodwill_credit: () => ({
      lean: true,
      pending: [{ day: 100, account: 'e:a@b.c', email: 'a@b.c', membership: 'mem_A' }],
      started: [{ account: 'u:1', email: 'c@d.e', stretch: 100, until: NOW + 20 * 86400, whop: false }],
    }),
    goodwill_whop_applied: (b) => { applied.push(b); return { ok: true }; },
    goodwill_noted: (b) => { const k = `${b.p_account}:${b.p_kind}`; const fresh = !noted.has(k); noted.add(k); return fresh; },
  }, calls);
  const out = await goodwill(e as any, NOW);
  assert.equal(out.lean, true);
  assert.equal(out.whop, 1);
  assert.equal(out.started, 1);
  assert.equal(applied[0].p_membership, 'mem_A');
  assert.equal(applied[0].p_until, Date.UTC(2026, 10, 9) / 1000);
  assert.ok(calls.some((c) => c.includes('/memberships/mem_A/add_free_days')));
  // A second run sends no second email.
  const again = await goodwill(e as any, NOW);
  assert.equal(again.started, 0);
});

test('an ordinary day after quiet ones sends the total, once', async () => {
  const calls: string[] = [];
  const noted = new Set<string>();
  const e = env({
    goodwill_credit: () => ({ lean: false }),
    goodwill_ended: () => [{ account: 'u:1', email: 'c@d.e', stretch: 90, days: 9, until: NOW + 30 * 86400, whop: false }],
    goodwill_noted: (b) => { const k = `${b.p_account}:${b.p_kind}`; const fresh = !noted.has(k); noted.add(k); return fresh; },
  }, calls);
  assert.equal((await goodwill(e as any, NOW)).ended, 1);
  assert.equal((await goodwill(e as any, NOW)).ended, 0);
});

test('without the service key nothing is touched', async () => {
  const calls: string[] = [];
  const e = { ...env({}, calls), SUPABASE_SERVICE_KEY: undefined };
  const out = await goodwill(e as any, NOW);
  assert.equal(out.lean, false);
  assert.equal(calls.length, 0);
});

test('the emails say what happened, plainly', () => {
  const s = goodwillStartMail({ until: NOW + 20 * 86400, whop: true });
  assert.match(s.text, /for every quiet day, we add a day/);
  assert.match(s.text, /next payment moves back/);
  const e = goodwillEndMail({ days: 9, until: NOW + 30 * 86400, whop: false });
  assert.match(e.subject, /We added 9 days/);
  assert.match(e.text, /one for every day the big leagues were off/);
  for (const m of [s, e]) assert.deepEqual(findBannedInProse(m.text.replace(/18\+/g, '')).map((v) => v.term), [], m.tag);
  // A membership that has since run out is not told it runs to a past date.
  assert.doesNotMatch(goodwillEndMail({ days: 2, until: Math.floor(Date.now() / 1000) - 86400, whop: false }).text, /Now runs to/);
});
