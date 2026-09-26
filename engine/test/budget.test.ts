import { test } from 'node:test';
import assert from 'node:assert/strict';
import { budgeted, pacificDay, spent, todays } from '../src/narrate/budget.ts';
import { QuotaExhausted } from '../src/narrate/gemini.ts';

test('the day is Pacific, because that is when Google resets the quota', () => {
  // 06:30 UTC on 27 September is still 26 September in California (UTC-7).
  assert.equal(pacificDay(Date.UTC(2026, 8, 27, 6, 30)), '2026-09-26');
  assert.equal(pacificDay(Date.UTC(2026, 8, 27, 7, 30)), '2026-09-27');
});

test('yesterday\'s count does not carry over', () => {
  assert.deepEqual(todays({ day: '2026-09-25', used: 180, exhausted: true }, '2026-09-26'), { day: '2026-09-26', used: 0, exhausted: false });
  assert.deepEqual(todays({ day: '2026-09-26', used: 12, exhausted: false }, '2026-09-26'), { day: '2026-09-26', used: 12, exhausted: false });
});

test('no request is sent past the allowance, and Google saying no is remembered', async () => {
  let sent = 0;
  const state = todays(null, '2026-09-26');
  const w = budgeted({ name: 'x', generate: async () => { sent++; return 'ok'; } }, state, 2);
  await w.generate('a'); await w.generate('b');
  await assert.rejects(w.generate('c'), QuotaExhausted);
  assert.equal(sent, 2);
  assert.ok(spent(state, 2));

  const s2 = todays(null, '2026-09-26');
  const w2 = budgeted({ name: 'x', generate: async () => { throw new QuotaExhausted('daily'); } }, s2, 100);
  await assert.rejects(w2.generate('a'));
  assert.equal(s2.exhausted, true);
  assert.ok(spent(s2, 100), 'the next run would ask again straight away');
  // Two hours on, one request is allowed to find out.
  assert.ok(!spent({ ...s2, pausedUntil: Math.floor(Date.now() / 1000) - 1 }, 100));
});

test('a new key starts the day fresh, even after the old one was spent', async () => {
  const { keyId } = await import('../src/narrate/budget.ts');
  const a = await keyId('old-key');
  const b = await keyId('new-key');
  assert.notEqual(a, b);
  assert.equal(a.length, 12);
  const spentOld = { day: '2026-09-26', key: a, used: 11, exhausted: true };
  assert.deepEqual(todays(spentOld, '2026-09-26', b), { day: '2026-09-26', key: b, used: 0, exhausted: false });
  assert.equal(todays(spentOld, '2026-09-26', a).exhausted, true, 'the same key keeps its record');
  // A count saved before keys were recorded is someone else's.
  assert.equal(todays({ day: '2026-09-26', used: 11, exhausted: true }, '2026-09-26', b).exhausted, false);
  // A refusal recorded with no pause (before pauses existed) stops nothing.
  assert.ok(!spent(todays({ day: '2026-09-26', key: b, used: 1, exhausted: true }, '2026-09-26', b), 200));
});
