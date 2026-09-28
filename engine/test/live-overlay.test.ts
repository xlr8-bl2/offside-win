import { test } from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error -- plain browser module, no types
import { anchorClock, clockText, diffEvents, eachFixture, eventKey, ingest, inPlayWindow, overlay, signature } from '../../public/js/lib/live.js';

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

test('the clock ticks between polls, catches up with the provider, and never runs backwards', () => {
  const t0 = 1_000_000;
  let a = anchorClock(null, 67, '2nd_half', t0);
  assert.equal(clockText(a, t0), '67:00');
  assert.equal(clockText(a, t0 + 23_000), '67:23', 'seconds tick on the page');
  // Thirty seconds later the provider still says 67: the clock keeps going.
  a = anchorClock(a, 67, '2nd_half', t0 + 30_000);
  assert.equal(clockText(a, t0 + 30_000), '67:30');
  // Then 68: already inside it, so no jump.
  a = anchorClock(a, 68, '2nd_half', t0 + 61_000);
  assert.equal(clockText(a, t0 + 61_000), '68:01');
  // A provider minute ahead of the page pulls it forward.
  a = anchorClock(a, 71, '2nd_half', t0 + 70_000);
  assert.equal(clockText(a, t0 + 70_000), '71:00');
  // No word for a long time (a stoppage): the clock stops two minutes on, not runs away.
  assert.equal(clockText(a, t0 + 70_000 + 600_000), '72:59');
  // Half time, penalties and full time stop it.
  assert.equal(anchorClock(a, 45, 'halftime', t0), null);
  assert.equal(anchorClock(a, 90, 'finished', t0), null);
  // A new half starts its own clock rather than carrying the first half's on.
  const second = anchorClock(anchorClock(null, 47, '1st_half', t0), 46, '2nd_half', t0 + 900_000);
  assert.equal(clockText(second, t0 + 900_000), '46:00');
});

test('what happened between two polls: goals by side, whistles, and nothing on the first poll', () => {
  const before = ingest({ matches: [
    { id: 1, status: '1st_half', minute: 20, score: [0, 0] },
    { id: 2, status: '1st_half', minute: 44, score: [1, 1] },
    { id: 3, status: '2nd_half', minute: 89, score: [2, 0] },
  ] }).byId;
  const after = ingest({ matches: [
    { id: 1, status: '1st_half', minute: 21, score: [0, 1] },
    { id: 2, status: 'halftime', minute: 45, score: [1, 1] },
    { id: 3, status: 'finished', minute: 90, score: [2, 0] },
    { id: 4, status: '1st_half', minute: 2, score: [1, 0] },
  ] }).byId;
  const ev = diffEvents(before, after).map((e: { id: number; kind: string; side?: string }) => [e.id, e.kind, e.side ?? null]);
  assert.deepEqual(ev, [[1, 'goal', 'away'], [2, 'halftime', null], [3, 'fulltime', null]]);
  assert.deepEqual(diffEvents(new Map(), after), [], 'first poll of a visit: no announcements');
  assert.equal(eventKey({ t: 'goal', minute: 17, player: 'X' }), eventKey({ t: 'goal', minute: 17, player: 'X', score: [1, 0] }));
});
