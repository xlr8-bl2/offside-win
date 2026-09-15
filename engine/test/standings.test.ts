import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseStandings } from '../src/context/gather.ts';

/** Field names exactly as the probe captured them from the live provider. */
const real = {
  league_id: 3,
  standings: [
    { position: 1, team_id: 10, team_name: 'A', played: 5, won: 4, drawn: 1, lost: 0, gf: 12, ga: 3, gd: 9, pts: 13 },
    { position: 2, team_id: 11, team_name: 'B', played: 5, won: 2, drawn: 1, lost: 2, gf: 6, ga: 7, gd: -1, pts: 7 },
  ],
};

test('abbreviated table fields are read', () => {
  const rows = parseStandings(real)!;
  assert.equal(rows[0]!.points, 13);
  assert.equal(rows[0]!.goal_diff, 9);
  assert.equal(rows[1]!.points, 7);
  assert.equal(rows[1]!.goal_diff, -1);
});

test('spelled-out names still work', () => {
  const rows = parseStandings({
    standings: [{ position: 1, team_id: 10, played: 5, points: 13, goal_difference: 9 }],
  })!;
  assert.equal(rows[0]!.points, 13);
  assert.equal(rows[0]!.goal_diff, 9);
});

test('goal difference falls back to gf minus ga', () => {
  const rows = parseStandings({ standings: [{ position: 1, team_id: 10, played: 5, pts: 13, gf: 12, ga: 3 }] })!;
  assert.equal(rows[0]!.goal_diff, 9);
});

test('a table with no points is not silently reported as all-square', () => {
  // The original failure: every row came back on 0 points and 0 goal
  // difference, which reads as a plausible table rather than a parse miss.
  const rows = parseStandings(real)!;
  assert.ok(rows.some((r) => r.points > 0), 'points should not all be zero');
});
