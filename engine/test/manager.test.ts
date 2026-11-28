import { test } from 'node:test';
import assert from 'node:assert/strict';
import { managerFactors } from '../src/context/manager.ts';

const side = (team: string, games: number | null, before: number | null, after: number | null) => ({
  team_name: team,
  manager: games === null ? null : {
    name: 'Graham Alexander',
    matchesInCharge: games,
    tenureDays: games * 7,
    current: { ppm: after, appointment_effect: { before_ppm: before, after_ppm: after, delta: null } },
  },
});
const run = (home: any) => managerFactors({ home, away: side('Cardiff', null, null, null) } as any)[0]!;

test('past the first games, the read says what has happened under him', () => {
  // Preston, 24 November: written off as "past the bounce window, where an early
  // lift usually fades" while picking up more points every week. The provider
  // left the difference null and gave before and after.
  const up = run(side('Preston', 9, 0.8, 1.6));
  assert.match(up.note, /more points than they were before he came/);
  assert.doesNotMatch(up.note, /fades/);
  assert.equal(up.claims[0]?.polarity, 1, 'the improvement is a claim');
  assert.equal(up.claims[0]?.evidence.appointment_delta, 0.8);

  const down = run(side('Preston', 9, 1.6, 0.8));
  assert.match(down.note, /fewer points/);
  assert.equal(down.claims[0]?.polarity, -1);

  const flat = run(side('Preston', 9, 1.2, 1.3));
  assert.match(flat.note, /much as they were/);
  assert.equal(flat.claims.length, 0);
});

test('a new man going backwards is not on a bounce', () => {
  const f = run(side('Śląsk', 4, 1.5, 0.5));
  assert.equal(f.claims[0]?.polarity, -1);
  assert.equal(f.adjustments.length, 0, 'no bounce lift on a side going the wrong way');
  assert.match(f.note, /fewer points/);
  // One game in, the record says nothing yet and the lift is the read.
  const one = run(side('Śląsk', 1, 1.5, 0));
  assert.equal(one.claims[0]?.polarity, 1);
});
