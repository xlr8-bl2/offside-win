import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

/**
 * The renewal job, against a real Postgres.
 *
 * This is money, and every interesting case here is a query behaving the way a
 * query does rather than the way a mock was told to. Selecting the wrong rows,
 * a unique index not firing, an UPDATE touching more than it should -- none of
 * those are visible against a stub, and all of them cost either a customer or a
 * charge.
 *
 * Skips itself when no database is configured, so `npm test` stays green on a
 * machine without one. RENEW_TEST_DB is a throwaway cluster, never Supabase.
 */

const URL_ = process.env['RENEW_TEST_DB'];
const enabled = Boolean(URL_);

let store: typeof import('../src/store.ts');
let renew: typeof import('../src/membership/renew.ts');

const NOW = 1_800_000_000;
const user = (n: number) => `00000000-0000-0000-0000-00000000000${n}`;

before(async () => {
  if (!enabled) return;
  process.env['DB_BACKEND'] = 'postgres';
  process.env['SUPABASE_DB_URL'] = URL_!;
  store = await import('../src/store.ts');
  renew = await import('../src/membership/renew.ts');
});

after(async () => { if (enabled) await store.closeDb(); });

beforeEach(async () => {
  if (!enabled) return;
  await store.exec('DELETE FROM payment');
  await store.exec('DELETE FROM payment_method');
  await store.exec('DELETE FROM membership');
});

/** A member whose access runs out in twelve hours, with a card on file. */
async function member(n: number, over: Partial<Record<string, unknown>> = {}) {
  const row = {
    expires_at: NOW + 12 * 3600, auto_renew: 1, attempts: 0,
    dunning_from: null as number | null, cancelled_at: null as number | null, card: true, ...over,
  };
  await store.exec(
    `INSERT INTO membership (user_id, plan_id, expires_at, auto_renew, attempts, dunning_from, cancelled_at, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [user(n), 'monthly', row.expires_at, row.auto_renew, row.attempts, row.dunning_from, row.cancelled_at, 1, 1],
  );
  if (row.card) {
    await store.exec(
      `INSERT INTO payment_method (user_id, provider, vault_token, origin_ref, consent_at, consent_terms, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?)`,
      [user(n), 'coinflow', '', `cit-${n}`, 1, 'v1', 1, 1],
    );
  }
}

const state = async (n: number) => (await store.select<any>(
  'SELECT expires_at, auto_renew, attempts, dunning_from FROM membership WHERE user_id = ?', [user(n)]))[0];

// The driver returns a Result, which extends Array -- compare contents, not shape.
const payments = async () => [...await store.select<any>('SELECT provider_ref, status FROM payment ORDER BY provider_ref')];

const ok = () => async () => 'pay-new';
const declines = () => async () => { throw new Error('card declined'); };

test('charges a membership falling due and extends it by the plan length', { skip: !enabled }, async () => {
  await member(1);
  const r = await renew.renewDue(ok(), NOW);
  assert.equal(r.renewed, 1);

  const m = await state(1);
  // Extended from the period end, not from today, so nothing is lost by the
  // job running a few hours early.
  assert.equal(Number(m.expires_at), NOW + 12 * 3600 + 30 * 86_400);
  assert.equal(Number(m.attempts), 0);
  assert.deepEqual((await payments()).map((p) => p.status), ['paid']);
});

test('leaves alone anything not actually due', { skip: !enabled }, async () => {
  await member(1, { expires_at: NOW + 40 * 3600 });   // still a day and a half away
  await member(2, { auto_renew: 0 });                  // renewal turned off
  await member(3, { cancelled_at: NOW - 100 });        // cancelled
  await member(4, { card: false });                    // nothing to charge

  let charged = 0;
  const r = await renew.renewDue(async () => { charged++; return 'x'; }, NOW);
  assert.equal(charged, 0, 'charged a card it had no business charging');
  assert.equal(r.renewed, 0);
  assert.equal((await payments()).length, 0);
});

test('two runs on the same day charge once', { skip: !enabled }, async () => {
  // The realistic version of this is a manual dispatch racing the schedule.
  await member(1);
  let charged = 0;
  const count = async () => { charged++; return 'pay-new'; };

  await renew.renewDue(count, NOW);
  const second = await renew.renewDue(count, NOW + 60);

  assert.equal(charged, 1, 'the card was charged twice');
  assert.equal(second.renewed, 0);
  assert.equal((await payments()).length, 1);
});

test('a decline keeps access and schedules a retry', { skip: !enabled }, async () => {
  await member(1);
  const before = await state(1);
  const r = await renew.renewDue(declines(), NOW);

  assert.equal(r.declined, 1);
  assert.equal(r.abandoned, 0);
  const m = await state(1);
  assert.equal(Number(m.expires_at), Number(before.expires_at), 'a decline must not shorten access');
  assert.equal(Number(m.auto_renew), 1, 'still trying');
  assert.equal(Number(m.attempts), 1);
  assert.ok(m.dunning_from, 'the retry clock did not start');
  assert.deepEqual((await payments()).map((p) => p.status), ['declined']);
});

test('a retry waits for its day rather than hammering the card', { skip: !enabled }, async () => {
  await member(1, { attempts: 1, dunning_from: NOW });
  let charged = 0;
  const count = async () => { charged++; return 'x'; };

  await renew.renewDue(count, NOW + 86_400);       // one day later: too early
  assert.equal(charged, 0);

  await renew.renewDue(count, NOW + 2 * 86_400);   // day two: the schedule says now
  assert.equal(charged, 1);
});

test('the third decline gives up and lets the membership lapse', { skip: !enabled }, async () => {
  await member(1, { attempts: 2, dunning_from: NOW - 5 * 86_400 });
  const before = await state(1);
  const r = await renew.renewDue(declines(), NOW);

  assert.equal(r.abandoned, 1);
  const m = await state(1);
  assert.equal(Number(m.auto_renew), 0, 'it should stop trying');
  assert.equal(Number(m.expires_at), Number(before.expires_at),
    'giving up must let the membership run out, not cut it short');
});

test('one dead card does not stop everybody else renewing', { skip: !enabled }, async () => {
  await member(1);
  await member(2);
  await member(3);
  let n = 0;
  const flaky = async () => { n++; if (n === 2) throw new Error('declined'); return 'pay-' + n; };

  const r = await renew.renewDue(flaky, NOW);
  assert.equal(r.renewed, 2);
  assert.equal(r.declined, 1);
});

test('a membership already past the grace window is left to lapse', { skip: !enabled }, async () => {
  // Eight days overdue: the dunning window closed and nobody should be charged
  // for a period that has long since gone by.
  await member(1, { expires_at: NOW - 8 * 86_400, attempts: 1, dunning_from: NOW - 8 * 86_400 });
  let charged = 0;
  await renew.renewDue(async () => { charged++; return 'x'; }, NOW);
  assert.equal(charged, 0);
});

/* The scheduling rule on its own, which needs no database. */

test('the dunning schedule is 0, +2, +5 and then stop', async () => {
  const { dueToday } = await import('../src/membership/renew.ts');
  const row = (attempts: number, since: number) =>
    ({ attempts, dunning_from: NOW - since * 86_400 }) as any;

  assert.equal(dueToday(row(0, 0), NOW), true, 'the first attempt is always today');
  assert.equal(dueToday(row(1, 1), NOW), false);
  assert.equal(dueToday(row(1, 2), NOW), true);
  assert.equal(dueToday(row(2, 4), NOW), false);
  assert.equal(dueToday(row(2, 5), NOW), true);
  assert.equal(dueToday(row(3, 30), NOW), false, 'after three attempts it stops for good');
});
