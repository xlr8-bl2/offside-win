import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localD1 } from './d1.ts';
import { addRecent, ASK_EVERY, EARLIEST, gradePick, settleFinished } from '../src/fulltime.ts';

/**
 * Full time (fulltime.ts): calls graded by the Worker within minutes of the
 * whistle, on a local SQLite from schema.sql, with the provider faked.
 */

const NOW = 1_800_000_000;

function seed(sqlite: any) {
  const fx = sqlite.prepare(`INSERT INTO fixture (id, league_id, kickoff, home_team, away_team, status, board_json, bundle_json, computed_at)
    VALUES (?, 1, ?, ?, ?, '2nd_half', '{}', '{}', 0)`);
  fx.run(10, NOW - 2 * 3600, 'Home FC', 'Away FC');
  fx.run(11, NOW - 30 * 60, 'Early', 'Kick');
  fx.run(12, NOW - 2 * 3600, 'Corner', 'Side');
  const pk = sqlite.prepare(`INSERT INTO pick (fixture_id, kickoff, market, outcome, line, kind, model_prob, book_prob, edge, shrunk_edge,
      odds, confidence, provisional, narrative, evidence_json, created_at, opening_odds, closing_odds)
    VALUES (?, ?, ?, ?, ?, 'CONFIDENT', 0.7, 0.6, 0.1, 0.1, ?, 0.7, 0, '', ?, 0, ?, ?)`);
  pk.run(10, NOW - 2 * 3600, 'over_under_25', 'over', 2.5, 1.9, '{"expected":{"home":1.6,"away":1.2}}', 1.95, 1.8);
  pk.run(10, NOW - 2 * 3600, 'btts', 'yes', null, 1.7, '{}', null, null);
  // Kicked off half an hour ago: not asked about.
  pk.run(11, NOW - 30 * 60, '1x2', 'HOME', null, 1.5, '{}', null, null);
  // A corners call: the score cannot grade it, so the engine keeps it.
  pk.run(12, NOW - 2 * 3600, 'total_corners', 'over', 9.5, 1.8, '{}', null, null);
  sqlite.prepare(`INSERT INTO slip (created_at, first_kickoff, legs_json, odds, chance) VALUES (0, ?, ?, 3.2, 0.4)`).run(
    NOW - 2 * 3600,
    JSON.stringify([
      { fixture_id: 10, market: 'over_under_25', outcome: 'over', line: 2.5, kickoff: NOW - 2 * 3600 },
      { fixture_id: 10, market: 'btts', outcome: 'yes', line: null, kickoff: NOW - 2 * 3600 },
    ]),
  );
}

function fakeProvider(byId: Record<number, Record<string, unknown>>) {
  const asked: number[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL) => {
    const id = Number(String(url).match(/events\/(\d+)\//)?.[1]);
    asked.push(id);
    const body = byId[id];
    return new Response(body ? JSON.stringify(body) : '{}', { status: body ? 200 : 404 });
  }) as typeof fetch;
  return { asked, restore: () => { globalThis.fetch = real; } };
}

test('a finished match: its calls graded, its score and state written, the slip settled, the page told', async () => {
  const { sqlite, db } = localD1();
  seed(sqlite);
  const p = fakeProvider({ 10: { status: 'finished', home_score: 2, away_score: 1 }, 12: { status: 'finished', home_score: 0, away_score: 0 } });
  try {
    const r = await settleFinished({ DB: db, BSD_API_KEY: 'k' }, NOW);
    assert.deepEqual(p.asked.sort(), [10, 12], 'only matches past 100 minutes are asked about');
    assert.equal(r.settled, 2);
    assert.deepEqual(r.matches, [10]);
    assert.equal(r.slips, 1);
  } finally { p.restore(); }

  const picks = sqlite.prepare('SELECT fixture_id, market, result, pnl, clv, settled_at, postmortem_json FROM pick ORDER BY id').all() as any[];
  assert.equal(picks[0].result, 'WON');
  assert.ok(Math.abs(picks[0].pnl - 0.9) < 1e-9);
  assert.equal(picks[0].clv, Number((1.95 / 1.8 - 1).toFixed(4)));
  assert.equal(picks[0].settled_at, NOW);
  assert.ok(JSON.parse(picks[0].postmortem_json), 'a post-mortem, as settlement writes');
  assert.equal(picks[1].result, 'WON');
  assert.equal(picks[2].settled_at, null, 'not yet due');
  assert.equal(picks[3].settled_at, null, 'corners left for the engine');

  const f = sqlite.prepare('SELECT home_goals, away_goals, status FROM fixture WHERE id = 10').get() as any;
  assert.deepEqual({ ...f }, { home_goals: 2, away_goals: 1, status: 'finished' });
  const slip = sqlite.prepare('SELECT result, settled_at FROM slip').get() as any;
  assert.deepEqual({ ...slip }, { result: 'WON', settled_at: NOW });
  const recent = JSON.parse((sqlite.prepare("SELECT v FROM kv WHERE k = 'settled:recent'").get() as any).v);
  assert.deepEqual(recent, { at: NOW, ids: { 10: NOW } });
});

test('a match still being played is asked about again only after four minutes, and nothing is written', async () => {
  const { sqlite, db } = localD1();
  seed(sqlite);
  const p = fakeProvider({ 10: { status: 'inprogress', home_score: 1, away_score: 1 }, 12: { status: 'halftime', home_score: 0, away_score: 0 } });
  try {
    await settleFinished({ DB: db, BSD_API_KEY: 'k' }, NOW);
    await settleFinished({ DB: db, BSD_API_KEY: 'k' }, NOW + 120);
    assert.equal(p.asked.length, 2, 'the second run, two minutes on, asks nobody');
    await settleFinished({ DB: db, BSD_API_KEY: 'k' }, NOW + ASK_EVERY + 1);
    assert.equal(p.asked.length, 4);
  } finally { p.restore(); }
  const n = (sqlite.prepare('SELECT count(*) AS n FROM pick WHERE settled_at IS NOT NULL').get() as any).n;
  assert.equal(n, 0, '"halftime" contains "ft" and is not the end');
  assert.equal((sqlite.prepare('SELECT home_goals FROM fixture WHERE id = 10').get() as any).home_goals, null);
});

test('nothing due: one read, no provider, no writes', async () => {
  const { db } = localD1();
  const p = fakeProvider({});
  try {
    const r = await settleFinished({ DB: db, BSD_API_KEY: 'k' }, NOW);
    assert.equal(r.candidates, 0);
    assert.equal(p.asked.length, 0);
  } finally { p.restore(); }
  assert.ok(EARLIEST >= 95 * 60, 'never asks before a match can be over');
});

test('a slip with a lost leg settles lost even while another leg is to play', async () => {
  const { sqlite, db } = localD1();
  seed(sqlite);
  sqlite.prepare('DELETE FROM slip').run();
  sqlite.prepare(`INSERT INTO slip (created_at, first_kickoff, legs_json, odds, chance) VALUES (0, ?, ?, 3.2, 0.4)`).run(
    NOW - 2 * 3600,
    JSON.stringify([
      { fixture_id: 10, market: 'btts', outcome: 'yes', line: null },
      { fixture_id: 11, market: '1x2', outcome: 'HOME', line: null },
    ]),
  );
  const p = fakeProvider({ 10: { status: 'finished', home_score: 3, away_score: 0 } });
  try { await settleFinished({ DB: db, BSD_API_KEY: 'k' }, NOW); } finally { p.restore(); }
  assert.equal((sqlite.prepare('SELECT result FROM slip').get() as any).result, 'LOST');
});

test('the grade is the engine\'s: a quarter line splits', () => {
  const g = gradePick({ id: 1, market: 'asian_handicap', outcome: 'HOME', line: -0.75, odds: 2, opening_odds: null, closing_odds: null, evidence_json: null }, 1, 0);
  assert.equal(g?.result, 'HALF_WON');
  assert.equal(gradePick({ id: 1, market: 'total_corners', outcome: 'over', line: 9.5, odds: 2, opening_odds: null, closing_odds: null, evidence_json: null }, 1, 0), null);
});

test('recently graded matches are kept six hours', () => {
  const r = addRecent({ at: 5, ids: { 1: NOW - 7 * 3600, 2: NOW - 3600 } }, [3], NOW);
  assert.deepEqual(r, { at: NOW, ids: { 2: NOW - 3600, 3: NOW } });
  assert.deepEqual(addRecent(null, [], NOW), { at: 0, ids: {} });
});

test('the owner\'s final score grades a match\'s calls like the provider\'s would, and is logged', async () => {
  const { adminCall } = await import('../src/admindb.ts');
  const { sqlite, db } = localD1();
  seed(sqlite);
  const real = Math.floor(Date.now() / 1000);
  sqlite.prepare('UPDATE fixture SET kickoff = ? WHERE id IN (10, 12)').run(real - 2 * 3600);
  sqlite.prepare('UPDATE fixture SET kickoff = ? WHERE id = 11').run(real - 30 * 60);
  const r = await adminCall(db, 'admin_score', { p_actor: 'owner', p_fixture: 10, p_home: 0, p_away: 0 }) as any;
  assert.equal(r.ok, true);
  assert.equal(r.settled, 2);
  const res = sqlite.prepare('SELECT result FROM pick WHERE fixture_id = 10 ORDER BY id').all().map((x: any) => x.result);
  assert.deepEqual(res, ['LOST', 'LOST']);
  assert.equal((sqlite.prepare("SELECT action FROM admin_log").get() as any).action, 'final_score');
  assert.ok(JSON.parse((sqlite.prepare("SELECT v FROM kv WHERE k = 'settled:recent'").get() as any).v).ids['10']);
  assert.match((await adminCall(db, 'admin_score', { p_actor: 'owner', p_fixture: 10, p_home: 1, p_away: 0 }) as any).error, /already graded/);
  assert.match((await adminCall(db, 'admin_score', { p_actor: 'owner', p_fixture: 11, p_home: 1, p_away: 0 }) as any).error, /not had time/);
  assert.match((await adminCall(db, 'admin_score', { p_actor: 'owner', p_fixture: 12, p_home: -1, p_away: 0 }) as any).error, /whole numbers/);
});
