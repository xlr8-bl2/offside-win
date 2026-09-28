import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ahead } from '../src/slate.ts';

test('fetches ahead in parallel, hands results out in order, and surfaces a failure on its turn', async () => {
  let running = 0;
  let peak = 0;
  const fn = async (x: number) => {
    running++;
    peak = Math.max(peak, running);
    await new Promise((r) => setTimeout(r, 5));
    running--;
    if (x === 3) throw new Error('boom');
    return x * 10;
  };
  const at = ahead([0, 1, 2, 3, 4], fn, 3);
  assert.equal(await at(0), 0);
  assert.equal(await at(1), 10);
  assert.equal(await at(2), 20);
  await assert.rejects(at(3), /boom/);
  assert.equal(await at(4), 40);
  assert.ok(peak >= 2 && peak <= 3, `peak ${peak}`);
});
