import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compactPlayers, sideLineup } from '../src/deep.ts';

test('the eleven, formation and missing players from /lineups/', () => {
  const raw = { lineups: { home: { formation: '4-3-3', players: [{ id: 1, starting: true }, { id: 2 }], substitutes: [{ id: 9 }] } },
    unavailable_players: { home: [{ id: 7, name: 'Kane', status: 'injured', reason: 'Ankle Injury' }] } };
  const s = sideLineup(raw, 'home');
  assert.equal(s.formation, '4-3-3');
  assert.deepEqual(s.xi, [1, 2]);
  assert.deepEqual(s.out, [{ id: 7, name: 'Kane', reason: 'Ankle Injury' }]);
  assert.deepEqual(sideLineup(null, 'away'), { formation: null, xi: [], out: [] });
});

test('player numbers compact, sided by team, unused substitutes left out', () => {
  const raw = { player_stats: [
    { player_id: 1, team_id: 50, minutes_played: 90, expected_goals: 0.456, expected_assists: 0.1, total_shots: 4, shots_on_target: 2, key_pass: 3, big_chance_created: 1, progressive_ball_carries_count: 5, accurate_cross: 2, touches: 60, accurate_opposition_half_passes: 30, rating: 7.4 },
    { player_id: 2, team_id: 60, minutes_played: 0 },
    { player_id: 3, team_id: 60, minutes_played: 20, rating: null },
  ] };
  const p = compactPlayers(raw, 50, new Set([1]));
  assert.equal(p.length, 2);
  assert.deepEqual(p[0], [1, 0, 1, 90, 0.46, 0.1, 4, 2, 3, 1, 5, 2, 60, 30, 7.4]);
  assert.equal(p[1]![1], 1);
  assert.equal(p[1]![2], 0);
});
