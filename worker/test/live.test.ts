import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compactMatch, fixtureChanges, liveList, liveMatch, liveStatus, reduceChanges } from '../src/live.ts';

/**
 * Live scores and fixture changes: the one path that asks the provider
 * directly. Shapes are from probe:extras (September 2026).
 */

test('the provider\'s status and period become one word the page knows', () => {
  assert.equal(liveStatus('inprogress', '1st_half'), '1st_half');
  assert.equal(liveStatus('inprogress', '2nd_half'), '2nd_half');
  assert.equal(liveStatus('1st_half', '1T'), '1st_half');
  assert.equal(liveStatus('inprogress', 'halftime'), 'halftime');
  assert.equal(liveStatus('inprogress', 'extra_time'), 'extra_time');
  assert.equal(liveStatus('inprogress', 'penalties'), 'penalties');
  assert.equal(liveStatus('finished', ''), 'finished');
  assert.equal(liveStatus('postponed', ''), 'postponed');
  assert.equal(liveStatus('notstarted', ''), 'notstarted');
  assert.equal(liveStatus('inprogress', ''), 'live');
});

test('a live row is made compact, and nothing of the provider\'s extra rides along', () => {
  const m = compactMatch({
    id: 211587, league_id: 19, league_name: 'Liga MX Apertura', home_team_id: 311, home_team: 'Club Necaxa',
    away_team_id: 307, away_team: 'Club América', event_date: '2026-09-28T03:10:00Z', status: 'inprogress',
    period: '1st_half', current_minute: 12, home_score: 0, away_score: 1, penalty_shootout: null,
    home_score_ht: null, away_score_ht: null, live_websocket: true, last_updated: '2026-09-28T03:23:14Z',
  });
  assert.deepEqual(m, {
    id: 211587, league_id: 19, league: 'Liga MX Apertura', home: 'Club Necaxa', away: 'Club América',
    home_id: 311, away_id: 307, kickoff: Date.UTC(2026, 8, 28, 3, 10) / 1000, status: '1st_half', minute: 12,
    score: [0, 1], ht: null, pens: null,
  });
  assert.equal(compactMatch({ status: 'inprogress' }), null, 'no id, no row');
});

test('changes reduce to the latest of each kind per match, keeping where it started', () => {
  const out = reduceChanges([
    { change: 'broadcast_added', event_id: 1, changed_at: '2026-09-27T10:00:00Z', old_value: '', new_value: 'Sky' },
    { change: 'kickoff', event_id: 2, changed_at: '2026-09-27T10:00:00Z', event_date: '2026-09-29T19:00:00Z', old_value: '2026-09-29T17:00:00Z', new_value: '2026-09-29T18:00:00Z' },
    { change: 'kickoff', event_id: 2, changed_at: '2026-09-27T12:00:00Z', event_date: '2026-09-29T19:00:00Z', old_value: '2026-09-29T18:00:00Z', new_value: '2026-09-29T19:00:00Z' },
    { change: 'status', event_id: 3, changed_at: '2026-09-27T11:00:00Z', old_value: 'notstarted', new_value: 'postponed' },
  ]);
  assert.equal(out.length, 2, 'broadcasts are not the reader\'s business here');
  const k = out.find((c) => c.id === 2)!;
  assert.equal(k.from, '2026-09-29T17:00:00Z');
  assert.equal(k.to, '2026-09-29T19:00:00Z');
  assert.equal(out.find((c) => c.id === 3)!.to, 'postponed');
});

test('without the provider key, live says so rather than failing', async () => {
  const res = await liveList({});
  assert.equal(res.status, 200);
  assert.deepEqual((await res.json() as { enabled: boolean }).enabled, false);
  assert.equal(((await (await fixtureChanges({})).json()) as { enabled: boolean }).enabled, false);
});

test('the live list and a match are read from the provider with the key, and the key never reaches the body', async () => {
  const seen: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    seen.push(`${url} ${(init?.headers as Record<string, string>)?.['Authorization'] ?? ''}`);
    if (url.includes('/fixtures/changes/')) {
      return new Response(JSON.stringify({ truncated: false, changes: [
        { change: 'status', event_id: 12, changed_at: '2026-09-27T11:00:00Z', old_value: 'notstarted', new_value: 'postponed' },
      ] }), { headers: { 'content-type': 'application/json' } });
    }
    const body = url.includes('/events/live/')
      ? { count: 1, results: [{ id: 9, home_team: 'A', away_team: 'B', status: 'inprogress', period: '2nd_half', current_minute: 71, home_score: 2, away_score: 1 }] }
      : url.includes('/incidents/')
        ? { incidents: [{ type: 'goal', minute: 10, is_home: true, player: 'X', home_score: 1, away_score: 0 }, { type: 'card', minute: 30, is_home: false, player: 'Y', card_type: 'yellow' }] }
        : url.includes('/stats/')
          ? { stats: { home: { ball_possession: 55, total_shots: 9 }, away: { ball_possession: 45, total_shots: 4 } } }
          : { id: 9, home_team: 'A', away_team: 'B', status: '2nd_half', current_minute: 71, home_score: 2, away_score: 1 };
    return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  try {
    const env = { BSD_API_KEY: 'secret-key-123' };
    const list = await (await liveList(env)).text();
    assert.ok(!list.includes('secret-key-123'));
    const parsed = JSON.parse(list) as { matches: Array<{ status: string; minute: number; score: number[] }>; changes: Array<{ id: number; to: string }> };
    assert.deepEqual([parsed.matches[0]!.status, parsed.matches[0]!.minute, parsed.matches[0]!.score], ['2nd_half', 71, [2, 1]]);
    assert.deepEqual(parsed.changes.map((c) => [c.id, c.to]), [[12, 'postponed']], 'the changes ride in the same body');
    const one = JSON.parse(await (await liveMatch(env, 9)).text()) as { report: { events: Array<{ t: string }>; stats: { home: { possession: number } } } };
    assert.deepEqual(one.report.events.map((e) => e.t), ['goal', 'card']);
    assert.equal(one.report.stats.home.possession, 55);
    assert.ok(seen.every((s) => s.endsWith('Token secret-key-123')), 'every provider call carries the key');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('a changes feed that fails costs the changes, not the scores', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    if (String(input).includes('/fixtures/changes/')) return new Response('no', { status: 400 });
    return new Response(JSON.stringify({ results: [{ id: 5, status: 'inprogress', period: '1st_half', current_minute: 3, home_score: 0, away_score: 0 }] }));
  }) as typeof fetch;
  try {
    const body = await (await liveList({ BSD_API_KEY: 'k' })).json() as { matches: unknown[]; changes: unknown[] };
    assert.equal(body.matches.length, 1);
    assert.deepEqual(body.changes, []);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('a half-time score is not one until half time, and the live list is read under any of its usual keys', async () => {
  const first = compactMatch({ id: 1, status: 'inprogress', period: '1st_half', current_minute: 36, home_score: 1, away_score: 0, home_score_ht: 1, away_score_ht: 0 });
  assert.equal(first!.ht, null);
  const second = compactMatch({ id: 1, status: 'inprogress', period: '2nd_half', current_minute: 50, home_score: 1, away_score: 0, home_score_ht: 1, away_score_ht: 0 });
  assert.deepEqual(second!.ht, [1, 0]);
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => (String(input).includes('/events/live/')
    ? new Response(JSON.stringify({ count: 1, events: [{ id: 3, status: 'inprogress', period: '1st_half', current_minute: 3, home_score: 0, away_score: 0 }] }))
    : new Response(JSON.stringify({ changes: [] })))) as typeof fetch;
  try {
    const body = await (await liveList({ BSD_API_KEY: 'k' })).json() as { matches: Array<{ id: number }> };
    assert.deepEqual(body.matches.map((m) => m.id), [3]);
  } finally {
    globalThis.fetch = realFetch;
  }
});
