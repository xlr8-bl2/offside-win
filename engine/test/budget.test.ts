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
  assert.equal(s2.exhausted, true, 'the next run would ask again');
  assert.ok(spent(s2, 100));
});
