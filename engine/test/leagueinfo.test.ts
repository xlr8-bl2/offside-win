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
