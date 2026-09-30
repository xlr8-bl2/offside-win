import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isFinishedStatus } from '../src/settle.ts';

test('only an ended match counts as finished; half-time is not full time', () => {
  for (const s of ['finished', 'Finished', 'FT', 'ended', 'aet', 'after_penalties', 'after extra time', 'full-time']) {
    assert.ok(isFinishedStatus(s), s);
  }
  for (const s of ['halftime', 'HT', '1st_half', '2nd_half', 'inprogress', 'live', 'notstarted', 'interrupted', 'postponed', 'break', '']) {
    assert.ok(!isFinishedStatus(s), s);
  }
});
