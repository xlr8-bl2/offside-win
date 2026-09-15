import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toPgPlaceholders } from '../src/store.pg.ts';

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
