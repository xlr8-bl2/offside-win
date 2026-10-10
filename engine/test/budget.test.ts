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

test('no request is sent past the allowance, and a refused model is paused', async () => {
  let sent = 0;
  const ok = { name: 'x', generate: async () => { sent++; return 'ok'; } };
  const state = todays(null, '2026-09-26');
  const w = budgeted([{ model: 'a', writer: ok }], state, 2);
  await w.generate('p'); await w.generate('p');
  await assert.rejects(w.generate('p'), QuotaExhausted);
  assert.equal(sent, 2);
  assert.ok(spent(state, 2, ['a']));

  const s2 = todays(null, '2026-09-26');
  const w2 = budgeted([{ model: 'a', writer: { name: 'x', generate: async () => { throw new QuotaExhausted('daily'); } } }], s2, 100);
  await assert.rejects(w2.generate('p'), QuotaExhausted);
  assert.equal(s2.exhausted, true);
  assert.ok(spent(s2, 100, ['a']), 'the next run would ask again straight away');
  // Two hours on, one request is allowed to find out.
  s2.models!['a']!.pausedUntil = Math.floor(Date.now() / 1000) - 1;
  assert.ok(!spent(s2, 100, ['a']));
});

test('the writer moves down the models as each one runs out, as Google counts them', async () => {
  const calls: string[] = [];
  const mk = (m: string, fail?: 'quota' | 'gone' | 'busy' | 'slow') => ({
    model: m,
    writer: { name: m, generate: async () => {
      calls.push(m);
      if (fail === 'quota') throw new QuotaExhausted('GenerateRequestsPerDayPerProjectPerModel-FreeTier = 20');
      if (fail === 'gone') throw new Error('gemini 404: no longer available');
      if (fail === 'busy') throw new Error('gemini is busy — the model did not answer after three tries');
      if (fail === 'slow') throw new Error('The operation was aborted due to timeout');
      return m;
    } },
  });
  const state = todays(null, '2026-09-26');
  const w = budgeted([mk('best', 'quota'), mk('retired', 'gone'), mk('busy', 'busy'), mk('slow', 'slow'), mk('next'), mk('last')], state, 100, 2);
  assert.equal(await w.generate('p'), 'next', 'a refused, a retired, a busy and a slow model are passed over');
  assert.ok((state.models!['busy']!.pausedUntil ?? 0) > Date.now() / 1000, 'the busy one waits a while');
  assert.equal(await w.generate('p'), 'next');
  // Twenty a day each (two here): the third goes to the one after.
  assert.equal(await w.generate('p'), 'last');
  assert.equal(state.models!['retired']!.gone, true);
  assert.deepEqual(calls, ['best', 'retired', 'busy', 'slow', 'next', 'next', 'last']);
  assert.ok(!spent(state, 100, ['best', 'retired', 'busy', 'slow', 'next', 'last'], 2), 'last has one left');
  await w.generate('p');
  assert.ok(spent(state, 100, ['best', 'retired', 'busy', 'slow', 'next', 'last'], 2), 'every model spent or waiting');
  await assert.rejects(w.generate('p'), QuotaExhausted);
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

test('left: the reserve is counted against what the models can still take, not the daily limit', async () => {
  const { left } = await import('../src/narrate/budget.ts');
  const models = ['a', 'b', 'c'];
  const state = { day: 'd', used: 30, models: { a: { used: 20 }, b: { used: 10 } } } as any;
  // 200 a day says 170 left; three models at twenty with thirty used say 30.
  assert.equal(left(state, 200, models, 20), 30);
  state.models.b.pausedUntil = Date.now() + 60_000;
  assert.equal(left(state, 200, models, 20), 20, 'a paused model counts as nothing');
  assert.equal(left({ day: 'd', used: 190 } as any, 200, [], Infinity), 10);
});
