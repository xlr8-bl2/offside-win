import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ukDay } from '../src/free.ts';

test('the free call works on the UK calendar day', () => {
  // 23:30 UTC on 24 September is 00:30 on the 25th in London (BST).
  assert.equal(ukDay(Date.UTC(2026, 8, 24, 23, 30) / 1000), '2026-09-25');
  assert.equal(ukDay(Date.UTC(2026, 8, 24, 22, 30) / 1000), '2026-09-24');
  // In winter London is on UTC, so the day turns at midnight UTC.
  assert.equal(ukDay(Date.UTC(2026, 11, 1, 23, 30) / 1000), '2026-12-01');
});
