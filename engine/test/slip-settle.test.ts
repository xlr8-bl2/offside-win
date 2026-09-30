import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Settling a slip whose leg was withdrawn before kick-off, against a real
 * Postgres. Skips itself without RENEW_TEST_DB (a throwaway cluster, never
 * Supabase), like renew.test.ts.
 *
 * The case: Belgium v France, 28 September 2026. The leg was on the slip, the
 * engine fell below its bar for it by kick-off, and it is now withdrawn from
 * the board. The slip was already posted, so the leg must still grade on the
 * score -- a loss stays a loss -- rather than drop out as void.
 */

const URL_ = process.env['RENEW_TEST_DB'];
const enabled = Boolean(URL_);

let store: typeof import('../src/store.ts');
let slip: typeof import('../src/slip.ts');

const K = 1_790_000_000;
const leg = (fixture_id: number, market: string, outcome: string, line: number | null, odds: number) => ({
  fixture_id, kickoff: K, home: 'H', away: 'A', league: null, market, outcome, line, odds, bookmaker: null, model_prob: 0.85,
});

before(async () => {
  if (!enabled) return;
  process.env['DB_BACKEND'] = 'postgres';
  process.env['SUPABASE_DB_URL'] = URL_!;
  store = await import('../src/store.ts');
  slip = await import('../src/slip.ts');
});

after(async () => { if (enabled) await store.closeDb(); });

beforeEach(async () => {
  if (!enabled) return;
  await store.exec('DELETE FROM slip');
  await store.exec('DELETE FROM pick WHERE fixture_id IN (1, 2, 3)');
  await store.exec('DELETE FROM fixture WHERE id IN (1, 2, 3)');
});

async function fixture(id: number, hg: number | null, ag: number | null, status = 'finished') {
  await store.exec(
    `INSERT INTO fixture (id, league_id, kickoff, home_team, away_team, status, board_json, bundle_json, computed_at, home_goals, away_goals)
     VALUES (?, 64, ?, 'H', 'A', ?, '{}', '{}', ?, ?, ?)`,
    [id, K, status, K, hg, ag],
  );
}

async function graded(id: number, market: string, outcome: string, line: number | null, result: string) {
  await store.exec(
    `INSERT INTO pick (fixture_id, kickoff, market, outcome, line, kind, model_prob, book_prob, edge, shrunk_edge, odds,
                       confidence, provisional, narrative, evidence_json, created_at, settled_at, result, pnl)
     VALUES (?, ?, ?, ?, ?, 'CONFIDENT', 0.85, 0.85, 0, 0, 1.15, 1, 0, '', '{}', ?, ?, ?, 0)`,
    [id, K, market, outcome, line, K, K + 7200, result],
  );
}

async function post(legs: ReturnType<typeof leg>[]) {
  await store.exec('INSERT INTO slip (created_at, first_kickoff, legs_json, odds, chance) VALUES (?, ?, ?, ?, ?)',
    [K - 86400, K, JSON.stringify(legs), 2.2, 0.45]);
}

const result = async () => (await store.select<{ result: string | null }>('SELECT result FROM slip'))[0]?.result ?? null;

test('a withdrawn leg that lost on the score loses the slip; it is not voided', { skip: !enabled }, async () => {
  await fixture(1, 2, 0); await graded(1, 'double_chance', '1X', null, 'WON');
  await fixture(2, 0, 1); // Belgium 0-1 France: the over 1.5 leg, withdrawn before kick-off
  await post([leg(1, 'double_chance', '1X', null, 1.15), leg(2, 'over_under_15', 'over', 1.5, 1.14)]);
  await slip.settleSlips(K + 10_000);
  assert.equal(await result(), 'LOST');
});

test('a withdrawn leg that landed counts as landed', { skip: !enabled }, async () => {
  await fixture(1, 2, 0); await graded(1, 'double_chance', '1X', null, 'WON');
  await fixture(2, 2, 1);
  await post([leg(1, 'double_chance', '1X', null, 1.15), leg(2, 'over_under_15', 'over', 1.5, 1.14)]);
  await slip.settleSlips(K + 10_000);
  assert.equal(await result(), 'WON');
});

test('a withdrawn leg waits for its score, and a match never played voids it', { skip: !enabled }, async () => {
  await fixture(1, 2, 0); await graded(1, 'double_chance', '1X', null, 'WON');
  await fixture(2, null, null, 'inprogress');
  await post([leg(1, 'double_chance', '1X', null, 1.15), leg(2, 'over_under_15', 'over', 1.5, 1.14)]);
  await slip.settleSlips(K + 10_000);
  assert.equal(await result(), null, 'still open while the withdrawn leg is being played');

  await store.exec('DELETE FROM slip');
  await store.exec('DELETE FROM fixture WHERE id = 2');
  await fixture(2, null, null, 'postponed');
  await post([leg(1, 'double_chance', '1X', null, 1.15), leg(2, 'over_under_15', 'over', 1.5, 1.14)]);
  await slip.settleSlips(K + 10_000);
  assert.equal(await result(), 'WON', 'the postponed leg drops out and the rest stands');
});

test('regrading takes the finished record over the fixture\'s own copy, and reaches calls whose fixture is gone', { skip: !enabled }, async () => {
  const settle = await import('../src/settle.ts');
  await store.exec('DELETE FROM match WHERE id IN (1, 2)');
  // New England 4-2 Orlando, graded at half-time (1-0) as over 1.5 lost; the fixture row was pruned since.
  await graded(1, 'over_under_15', 'over', 1.5, 'LOST');
  await store.exec(`INSERT INTO match (id, league_id, kickoff, home_team_id, away_team_id, home_goals, away_goals, updated_at)
                    VALUES (1, 18, ?, 10, 11, 4, 2, ?)`, [K, K]);
  // A second one whose fixture still holds the half-time score it was graded on.
  await fixture(2, 0, 1); await graded(2, 'over_under_15', 'over', 1.5, 'LOST');
  await store.exec(`INSERT INTO match (id, league_id, kickoff, home_team_id, away_team_id, home_goals, away_goals, updated_at)
                    VALUES (2, 18, ?, 12, 13, 1, 2, ?)`, [K, K]);
  await settle.regradeSettled();
  const marks = await store.select<{ fixture_id: number; result: string }>('SELECT fixture_id, result FROM pick WHERE fixture_id IN (1, 2) ORDER BY fixture_id');
  assert.deepEqual(marks.map((m) => m.result), ['WON', 'WON']);
  const [f] = await store.select<{ home_goals: number; away_goals: number }>('SELECT home_goals, away_goals FROM fixture WHERE id = 2');
  assert.deepEqual([f!.home_goals, f!.away_goals], [1, 2], 'the fixture shows the final score too');
  await store.exec('DELETE FROM match WHERE id IN (1, 2)');
});
