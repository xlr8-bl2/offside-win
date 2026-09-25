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

test('a group stage keeps each row in its group', async () => {
  const { parseStandings } = await import('../src/context/gather.ts');
  const rows = parseStandings({ groups: {
    'Group 2': { standings: [{ team_id: 3, position: 1, pts: 6 }, { team_id: 4, position: 2, pts: 3 }] },
    'Group 1': { standings: [{ team_id: 1, position: 1, pts: 4 }, { team_id: 2, position: 2, pts: 1 }] },
  } });
  assert.ok(rows);
  assert.deepEqual(rows.map((r) => [r.group, r.position, r.team_id]),
    [['Group 1', 1, 1], ['Group 1', 2, 2], ['Group 2', 1, 3], ['Group 2', 2, 4]]);
});
