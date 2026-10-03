import { test } from 'node:test';
import assert from 'node:assert/strict';
import { leagueGame } from '../src/leagueinfo.ts';

/** A competition page's fixture list, read from the provider's events. */
test('a game to come has no score; a played one has its final score; junk is dropped', () => {
  const next = leagueGame({ id: 1, event_date: '2026-10-18T14:00:00Z', home_team: 'Arsenal', away_team: 'Chelsea', status: 'notstarted', home_score: null, away_score: null, round_label: 'Regular season · Matchday 8' });
  assert.deepEqual(next, { id: 1, kickoff: Date.UTC(2026, 9, 18, 14) / 1000, home: 'Arsenal', away: 'Chelsea', home_id: null, away_id: null, status: 'notstarted', score: null, round: 'Matchday 8' });
  const played = leagueGame({ id: 2, event_date: '2026-09-20T14:00:00Z', home_team: 'Spurs', away_team: 'Villa', status: 'finished', home_score: 2, away_score: 1 });
  assert.deepEqual(played?.score, [2, 1]);
  // A running score is not a result.
  assert.equal(leagueGame({ id: 3, event_date: '2026-09-28T14:00:00Z', home_team: 'A', away_team: 'B', status: 'inprogress', home_score: 1, away_score: 0 })?.score, null);
  assert.equal(leagueGame({ id: 4, home_team: 'A' }), null);
});

test('wholeDays keeps a whole matchday rather than stopping at a count', async () => {
  const { wholeDays } = await import('../src/leagueinfo.ts');
  const g = (id: number, day: number, hour = 19) => ({ id, kickoff: Date.UTC(2026, 9, day, hour) / 1000, home: 'H', away: 'A', home_id: null, away_id: null, status: 'notstarted', score: null, round: null });
  // A Champions League matchday: nine on the Tuesday, nine on the Wednesday,
  // then the next round three weeks on.
  const games = [...Array.from({ length: 9 }, (_, i) => g(i, 13)), ...Array.from({ length: 9 }, (_, i) => g(10 + i, 14)), g(30, 21), g(31, 21), g(32, 21), g(33, 21)];
  assert.equal(wholeDays(games, 20).length, 22, 'the 20th game is on the 21st, so the 21st is finished');
  assert.equal(wholeDays(games, 18).length, 18, 'stopping on a day boundary takes no more');
  assert.equal(wholeDays(games.slice(0, 5)).length, 5);
  assert.equal(wholeDays(Array.from({ length: 60 }, (_, i) => g(i, 13)), 20, 40).length, 40, 'never more than the ceiling');
});
