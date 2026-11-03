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

test('an unchanged schedule row is not rewritten, so it costs no D1 writes', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const { scheduleConflict } = await import('../src/schedule.ts');
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE schedule (id INTEGER PRIMARY KEY, league_id INTEGER NOT NULL, kickoff INTEGER NOT NULL, home_team TEXT NOT NULL, away_team TEXT NOT NULL, home_team_id INTEGER, away_team_id INTEGER, updated_at INTEGER NOT NULL)');
  const put = (kickoff: number, at: number) => db.prepare(`INSERT INTO schedule (id, league_id, kickoff, home_team, away_team, home_team_id, away_team_id, updated_at)
    VALUES (1, 39, ?, 'A', 'B', 10, NULL, ?) ${scheduleConflict(3600)}`).run(kickoff, at).changes;
  assert.equal(put(5000, 100), 1, 'new row');
  assert.equal(put(5000, 200), 0, 'same row, seen again soon: left alone');
  assert.equal(put(6000, 300), 1, 'kick-off moved: written');
  assert.equal(put(6000, 300 + 3601), 1, 'unchanged but old: touched so the day-old sweep keeps it');
  const row = db.prepare('SELECT kickoff, updated_at FROM schedule WHERE id = 1').get() as { kickoff: number; updated_at: number };
  assert.deepEqual([row.kickoff, row.updated_at], [6000, 3901]);
});
