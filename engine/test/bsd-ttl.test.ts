import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setNearFixtures, ttlFor } from '../src/bsd.ts';

/** How long each kind of provider answer is kept (the free plan's 7,500 a day). */
const u = (p: string) => new URL(p, 'https://sports.bzzoiro.com');

test('prices and news are fresh near kick-off, a few hours old otherwise; squads last a day', () => {
  setNearFixtures([42]);
  assert.equal(ttlFor(u('/api/v2/odds/?event_id=42')), 45 * 60);
  assert.equal(ttlFor(u('/api/v2/odds/?event_id=7')), 6 * 3600);
  assert.equal(ttlFor(u('/api/v2/events/42/lineups/')), 45 * 60);
  assert.equal(ttlFor(u('/api/v2/events/7/lineups/')), 6 * 3600);
  assert.equal(ttlFor(u('/api/v2/events/42/')), 15 * 60);
  assert.equal(ttlFor(u('/api/v2/teams/18/squad/')), 24 * 3600);
  assert.equal(ttlFor(u('/api/v2/events/')), 30 * 60);
});
