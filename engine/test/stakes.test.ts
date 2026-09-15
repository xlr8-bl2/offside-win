import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifySide } from '../src/context/stakes.ts';
import type { StandingRow } from '../src/context/types.ts';

/** A 20-team table, bottom side first argument. */
function table(): StandingRow[] {
  return Array.from({ length: 20 }, (_, i) => ({
    team_id: i + 1,
    position: i + 1,
    played: 6,
    points: 40 - i * 2,
    goal_diff: 20 - i * 2,
  }));
}

const bottom = (t: StandingRow[]) => t[t.length - 1]!;
const top = (t: StandingRow[]) => t[0]!;

test('a side near the bottom in September is not fighting relegation', () => {
  // The bug that reached the live board: "Valencia need this: fighting
  // relegation with 32 to play" — game six of thirty-eight. Every other state
  // had a lateness gate and this one did not.
  const t = table();
  const s = classifySide(bottom(t), t, 32, 38);
  assert.notEqual(s.state, 'relegation_fight', `called it a relegation fight with 32 of 38 to play`);
});

test('the same side in March is', () => {
  const t = table();
  const s = classifySide(bottom(t), t, 10, 38);
  assert.equal(s.state, 'relegation_fight');
  assert.ok(s.intensity > 0, 'a real fight with no intensity');
});

test('halfway is still too early for a relegation fight', () => {
  const t = table();
  assert.notEqual(classifySide(bottom(t), t, 19, 38).state, 'relegation_fight');
});

test('the gate scales with the season, not with a magic number', () => {
  // A 19-round season is a third the length, so the same share of it remaining
  // has to count as late. Written as an absolute round count, an eight-game gate
  // never fires early enough in a short season and fires far too late in a long
  // one — and we track leagues from 18 rounds to 90.
  const t = table();
  // Seven left of nineteen is the back third — late, and an absolute
  // fifteen-game gate would have fired here from the opening whistle.
  assert.equal(classifySide(bottom(t), t, 7, 19).state, 'relegation_fight', 'never fires in a short season');
  // Seventy left of ninety is round twenty. Not late by any reading.
  assert.notEqual(classifySide(bottom(t), t, 70, 90).state, 'relegation_fight', 'fires far too early in a long one');
  // Thirty left of ninety is two thirds through, which is.
  assert.equal(classifySide(bottom(t), t, 30, 90).state, 'relegation_fight');
});

test('a title race still needs to be late', () => {
  const t = table();
  // Second place, two points back — but in September.
  const chaser = { ...t[1]!, points: top(t).points - 2 };
  assert.notEqual(classifySide(chaser, t, 32, 38).state, 'title_race');
  assert.equal(classifySide(chaser, t, 6, 38).state, 'title_race');
});

test('with no season length the absolute gates still apply', () => {
  // Cups and youth competitions do not always report a round count. Falling
  // back is fine; silently treating every fixture as late is not.
  const t = table();
  assert.notEqual(classifySide(bottom(t), t, 32, null).state, 'relegation_fight');
  assert.equal(classifySide(bottom(t), t, 10, null).state, 'relegation_fight');
});

test('a mid-table side in September is mid-table, not something dramatic', () => {
  const t = table();
  const s = classifySide(t[9]!, t, 32, 38);
  assert.ok(['mid_table', 'unknown'].includes(s.state), `invented stakes in September: ${s.state}`);
});
