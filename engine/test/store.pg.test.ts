import { test } from 'node:test';
import assert from 'node:assert/strict';
import { conflictColumns, dedupeByConflictKey, toPgPlaceholders } from '../src/store.pg.ts';

test('placeholders become $n in order', () => {
  assert.equal(
    toPgPlaceholders('UPDATE pick SET settled_at = ?, result = ?, pnl = ? WHERE id = ?'),
    'UPDATE pick SET settled_at = $1, result = $2, pnl = $3 WHERE id = $4',
  );
});

test('a question mark inside a string literal is left alone', () => {
  assert.equal(
    toPgPlaceholders("SELECT * FROM kv WHERE v = 'what? really' AND k = ?"),
    "SELECT * FROM kv WHERE v = 'what? really' AND k = $1",
  );
});

test('escaped quotes do not end the literal', () => {
  assert.equal(
    toPgPlaceholders("SELECT 'it''s a ? here' , ?"),
    "SELECT 'it''s a ? here' , $1",
  );
});

test('a question mark in a comment is left alone', () => {
  assert.equal(
    toPgPlaceholders('SELECT ? -- why? because\nFROM t WHERE x = ?'),
    'SELECT $1 -- why? because\nFROM t WHERE x = $2',
  );
});

test('LIKE patterns survive', () => {
  assert.equal(
    toPgPlaceholders("SELECT k, v FROM kv WHERE k LIKE '%:last_run' OR k LIKE ?"),
    "SELECT k, v FROM kv WHERE k LIKE '%:last_run' OR k LIKE $1",
  );
});

test('conflict columns are read from either spelling', () => {
  assert.deepEqual(conflictColumns({ conflictTarget: 'id' }), ['id']);
  assert.deepEqual(conflictColumns({ conflictTarget: 'league_id, team_id' }), ['league_id', 'team_id']);
  assert.deepEqual(
    conflictColumns({ onConflict: 'ON CONFLICT (fixture_id, market, outcome, line, kind) DO UPDATE SET x = 1' }),
    ['fixture_id', 'market', 'outcome', 'line', 'kind'],
  );
  assert.equal(conflictColumns({}), null);
  // An expression target is not a column list; refusing to parse is the safe
  // answer, since the only consequence is that nothing gets collapsed.
  assert.equal(conflictColumns({ onConflict: 'ON CONFLICT (COALESCE(line, -1e9)) DO NOTHING' }), null);
});

test('rows sharing a conflict key collapse to the last one', () => {
  // Postgres rejects a VALUES list that hits the same key twice; SQLite lets
  // the later row win. Match SQLite, so the backends agree.
  const rows = [
    { id: 1, name: 'first' },
    { id: 2, name: 'other' },
    { id: 1, name: 'last' },
  ];
  assert.deepEqual(dedupeByConflictKey(rows, ['id']), [
    { id: 1, name: 'last' },
    { id: 2, name: 'other' },
  ]);
});

test('composite keys only collapse when every part matches', () => {
  const rows = [
    { league_id: 1, team_id: 5, v: 'a' },
    { league_id: 1, team_id: 6, v: 'b' },
    { league_id: 1, team_id: 5, v: 'c' },
  ];
  assert.equal(dedupeByConflictKey(rows, ['league_id', 'team_id']).length, 2);
});

test('nulls are distinguished from the string "null"', () => {
  const rows = [
    { a: null, b: 1 },
    { a: 'null', b: 2 },
  ];
  assert.equal(dedupeByConflictKey(rows, ['a']).length, 2);
});

test('rows are returned untouched when there is nothing to collapse', () => {
  const rows = [{ id: 1 }, { id: 2 }];
  assert.equal(dedupeByConflictKey(rows, ['id']), rows);
  assert.equal(dedupeByConflictKey(rows, null), rows);
});
