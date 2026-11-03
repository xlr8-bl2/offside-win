import { test } from 'node:test';
import assert from 'node:assert/strict';
import { transientD1 } from '../src/store.d1.ts';

test('D1 connection drops are retried, SQL errors are not', () => {
  assert.equal(transientD1('D1_ERROR: Network connection lost.'), true);
  assert.equal(transientD1('D1_ERROR: storage operation exceeded timeout which caused object to be reset.'), true);
  assert.equal(transientD1('D1_ERROR: near "SELECT": syntax error at offset 359: SQLITE_ERROR'), false);
  assert.equal(transientD1('D1_ERROR: UNIQUE constraint failed: rating.league_id'), false);
  assert.equal(transientD1('D1_ERROR: no such column: foo'), false);
});
