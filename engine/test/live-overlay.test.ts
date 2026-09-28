import { test } from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error -- plain browser module, no types
import { eachFixture, ingest, inPlayWindow, overlay, signature } from '../../public/js/lib/live.js';

/**
 * The site's live overlay (public/js/lib/live.js): what a page shows once the
 * thirty-second poll lands on top of what the slate wrote.
 */

type F = Record<string, unknown>;
const KO = Date.UTC(2026, 8, 28, 15, 0) / 1000;
const row = (over: F = {}): F => ({ id: 7, home: 'Arsenal', away: 'Chelsea', kickoff: KO, status: 'notstarted', score: null, live_score: null, live_minute: null, ...over });

test('a goal in play reaches the row: status, running score and minute', () => {
  const live = ingest({ matches: [{ id: 7, status: '2nd_half', minute: 63, score: [1, 0], ht: [0, 0], pens: null }] });
  const f = overlay(row(), live);
  assert.equal(f['status'], '2nd_half');
  assert.deepEqual(f['live_score'], [1, 0]);
  assert.equal(f['live_minute'], 63);
  assert.equal(f['score'], null, 'a running score is never printed as the result');
});

test('half time stops the clock rather than showing a minute', () => {
  const f = overlay(row(), ingest({ matches: [{ id: 7, status: 'halftime', minute: 45, score: [0, 0] }] }));
  assert.equal(f['status'], 'halftime');
  assert.equal(f['live_minute'], null);
});

test('a finished match takes its score, but never overrides the record', () => {
  const done = ingest({ matches: [{ id: 7, status: 'finished', minute: 90, score: [2, 1] }] });
  assert.deepEqual(overlay(row(), done)['score'], [2, 1]);
  const recorded = overlay(row({ status: 'finished', score: [3, 1] }), done);
  assert.deepEqual(recorded['score'], [3, 1], 'the slate\'s full-time score stands');
});

test('a match that drops out of the live list late on is over; earlier, it keeps its last state', () => {
  const now = KO + 2 * 3600;
  const first = ingest({ matches: [
    { id: 1, status: '2nd_half', minute: 90, score: [1, 1], kickoff: KO },
    { id: 2, status: '1st_half', minute: 20, score: [0, 0], kickoff: KO },
  ] }, new Map(), now);
  const next = ingest({ matches: [] }, first.byId, now + 30);
  assert.equal(next.byId.get(1).status, 'finished');
  assert.equal(next.byId.get(2).status, '1st_half');
  assert.equal(ingest({ matches: [] }, next.byId, KO + 5 * 3600).byId.size, 0, 'forgotten four hours after kick-off');
});

test('a postponement and a moved kick-off show before the next slate pass', () => {
  const live = ingest({ matches: [], changes: [
    { id: 7, kind: 'status', from: 'notstarted', to: 'postponed', at: KO - 86400, kickoff: KO },
    { id: 8, kind: 'kickoff', from: '2026-09-28T15:00:00Z', to: '2026-09-28T17:30:00Z', at: KO - 86400, kickoff: KO + 9000 },
  ] });
  assert.equal(overlay(row(), live)['status'], 'postponed');
  const moved = overlay(row({ id: 8 }), live);
  assert.equal(moved['kickoff'], KO + 9000);
  assert.equal(moved['moved_from'], KO);
  // The slate caught up: the time is right already, and the move is still said.
  const caught = overlay(row({ id: 8, kickoff: KO + 9000 }), live);
  assert.equal(caught['kickoff'], KO + 9000);
  assert.equal(caught['moved_from'], KO);
});

test('a kick-off change never moves a match that has started', () => {
  const live = ingest({ matches: [], changes: [
    { id: 7, kind: 'kickoff', from: '2026-09-28T15:00:00Z', to: '2026-09-28T17:30:00Z', at: 0, kickoff: 0 },
  ] });
  const f = overlay(row({ status: '1st_half' }), live);
  assert.equal(f['kickoff'], KO);
  assert.equal(f['moved_from'], undefined);
});

test('pick rows are matched on their fixture, and every fixture in a body is found', () => {
  const body = { fixtures: [row(), row({ id: 9 })], hero: { fixture_id: 9, home: 'A', away: 'B', kickoff: KO }, picks: [{ id: 555, fixture_id: 7, home_team: 'Arsenal', kickoff: KO }] };
  const seen: number[] = [];
  eachFixture(body, (f: F) => seen.push(Number(f['fixture_id'] ?? f['id'])));
  assert.deepEqual(seen.sort(), [7, 7, 9, 9]);
  const live = ingest({ matches: [{ id: 7, status: '1st_half', minute: 5, score: [0, 0] }] });
  eachFixture(body, (f: F) => overlay(f, live));
  assert.equal((body.picks[0] as F)['status'], '1st_half', 'a pick row follows its fixture, not its own id');
});

test('the poll runs only around a match being played', () => {
  assert.equal(inPlayWindow(row(), KO - 3600), false, 'an hour before');
  assert.equal(inPlayWindow(row(), KO - 300), true, 'five minutes before');
  assert.equal(inPlayWindow(row(), KO + 5400), true);
  assert.equal(inPlayWindow(row({ status: 'finished' }), KO + 5400), false);
  assert.equal(inPlayWindow(row({ status: 'postponed' }), KO + 60), false);
  assert.equal(inPlayWindow(row({ status: '2nd_half' }), KO + 5 * 3600), true, 'the provider says it is on');
});

test('a minute ticking over is not a redraw; a goal is', () => {
  const a = ingest({ matches: [{ id: 7, status: '2nd_half', minute: 60, score: [0, 0] }] });
  const b = ingest({ matches: [{ id: 7, status: '2nd_half', minute: 61, score: [0, 0] }] });
  const c = ingest({ matches: [{ id: 7, status: '2nd_half', minute: 61, score: [1, 0] }] });
  assert.equal(signature(7, a), signature(7, b));
  assert.notEqual(signature(7, b), signature(7, c));
});
