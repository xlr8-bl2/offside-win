import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scheduleRow } from '../src/schedule.ts';

const NOW = 1_800_000_000;
const covered = new Set([8]);
const ev = (o: Record<string, unknown>) => ({ id: 5, league_id: 8, event_date: new Date((NOW + 86400 * 5) * 1000).toISOString(), home_team: 'Arsenal', away_team: 'Chelsea', home_team_id: 1, away_team_id: 2, status: 'notstarted', ...o });

test('a future match in a covered competition is listed', () => {
  const r = scheduleRow(ev({}), covered, NOW)!;
  assert.equal(r.home_team, 'Arsenal');
  assert.equal(r.kickoff, NOW + 86400 * 5);
});

test('uncovered, past, postponed and nameless matches are not', () => {
  assert.equal(scheduleRow(ev({ league_id: 9 }), covered, NOW), null);
  assert.equal(scheduleRow(ev({ event_date: new Date((NOW - 60) * 1000).toISOString() }), covered, NOW), null);
  assert.equal(scheduleRow(ev({ status: 'postponed' }), covered, NOW), null);
  assert.equal(scheduleRow(ev({ away_team: '' }), covered, NOW), null);
});
