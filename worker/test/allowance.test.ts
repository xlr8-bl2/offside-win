import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localD1 } from './d1.ts';
import { FLOOR, HOURLY, lastLeft, leftFrom, mayAsk, spent } from '../src/allowance.ts';
import { liveList } from '../src/live.ts';

/** The provider allowance: floors by priority, hourly budgets, and what is left shared. */

const T = 1_800_000_000;

test('results come first: each use stops at its own floor', async () => {
  const { db } = localD1();
  await spent(db, 'live', 1, 1000, T);
  assert.equal(await mayAsk(db, 'changes', T), false, 'the changes feed stops below 1,500');
  assert.equal(await mayAsk(db, 'live', T), true);
  await spent(db, 'live', 1, 300, T);
  assert.equal(await mayAsk(db, 'live', T), false, 'live scores stop below 400');
  assert.equal(await mayAsk(db, 'results', T), true, 'results have no floor');
  await spent(db, 'results', 1, 0, T);
  assert.equal(await mayAsk(db, 'results', T), false, 'nothing left at all');
  assert.ok(FLOOR.results < FLOOR.live && FLOOR.live < FLOOR.changes);
});

test('each use has an hourly budget for the whole site, and a new hour starts it again', async () => {
  const { db } = localD1();
  await spent(db, 'changes', HOURLY.changes, 7000, T);
  assert.equal(await mayAsk(db, 'changes', T), false);
  assert.equal(await mayAsk(db, 'live', T), true, 'one use spending its budget leaves the others theirs');
  assert.equal(await mayAsk(db, 'changes', T + 3600), true);
});

test('an old figure for what is left is not trusted', async () => {
  const { db } = localD1();
  await spent(db, 'live', 1, 10, T);
  assert.equal((await lastLeft(db, T))?.n, 10);
  assert.equal(await lastLeft(db, T + 31 * 60), null);
  assert.equal(await mayAsk(db, 'live', T + 31 * 60), true);
});

test('the figure comes from the RateLimit header, and a 429 means none left', () => {
  assert.equal(leftFrom(new Response('', { headers: { ratelimit: '"football";r=7213;t=52800' } })), 7213);
  assert.equal(leftFrom(new Response('', { status: 429 })), 0);
  assert.equal(leftFrom(new Response('')), null);
});

test('below the live floor the list is served from the last shared copy, with no request', async () => {
  const { sqlite, db } = localD1();
  const t = Math.floor(Date.now() / 1000);
  sqlite.prepare(`INSERT INTO fixture (id, league_id, kickoff, home_team, away_team, status, board_json, bundle_json, computed_at)
    VALUES (5, 1, ?, 'A', 'B', 'inprogress', '{}', '{}', 0)`).run(t - 1800);
  sqlite.prepare(`INSERT INTO kv (k, v, updated_at) VALUES ('live:list', ?, ?)`).run(JSON.stringify({ matches: [{ id: 5, status: '2nd_half', score: [1, 0] }], asked: true }), t - 300);
  await spent(db, 'live', 1, 100, t);
  const asked: string[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (u: string | URL) => { asked.push(String(u)); return new Response('{}'); }) as typeof fetch;
  try {
    const body = await (await liveList({ BSD_API_KEY: 'k', DB: db })).json() as { matches: Array<{ id: number }> };
    assert.deepEqual(body.matches.map((m) => m.id), [5]);
    assert.equal(asked.length, 0);
  } finally { globalThis.fetch = real; }
});
