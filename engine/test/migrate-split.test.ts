import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { splitStatements } from '../src/store.ts';

const isDDL = (s: string) => /^(CREATE|ALTER|DROP|GRANT|COMMENT|INSERT|DELETE|NOTIFY)/i.test(s);

test('a mid-line semicolon in a comment does not leak SQL', () => {
  // The exact shape that broke the Postgres schema: splitting before stripping
  // left "a table left" behind as a statement.
  const sql = `
-- Every table must be covered; a table left
-- out of this list is writable.
CREATE TABLE a (id int);
`;
  const out = splitStatements(sql);
  assert.deepEqual(out, ['CREATE TABLE a (id int)']);
});

test('an end-of-line semicolon in a comment does not leak SQL either', () => {
  const sql = `
-- sample gate cleared;
-- a referee below it stays absent.
CREATE TABLE b (id int);
`;
  assert.deepEqual(splitStatements(sql), ['CREATE TABLE b (id int)']);
});

for (const file of ['../../schema.sql', '../../schema.pg.sql']) {
  test(`${file} splits into DDL only`, () => {
    const sql = readFileSync(new URL(file, import.meta.url), 'utf8');
    const out = splitStatements(sql);
    assert.ok(out.length > 10, `expected a real schema, got ${out.length} statements`);
    for (const s of out) assert.ok(isDDL(s), `non-DDL fragment would be executed: ${s.slice(0, 70)}`);
  });
}

test('a dollar-quoted body is one statement, semicolons and all', () => {
  const sql = `
CREATE FUNCTION f() RETURNS json LANGUAGE plpgsql AS $fn$
BEGIN
  RETURN '{}'::json;
EXCEPTION WHEN others THEN
  RETURN NULL;
END;
$fn$;
CREATE TABLE after_it (id int);
`;
  const out = splitStatements(sql);
  assert.equal(out.length, 2, `body was torn into ${out.length} pieces`);
  assert.ok(out[0]!.includes('EXCEPTION WHEN others'), 'body lost its tail');
  assert.equal(out[1], 'CREATE TABLE after_it (id int)');
});

test('a semicolon inside a string literal does not terminate a statement', () => {
  const out = splitStatements(`INSERT INTO t (v) VALUES ('a;b'); CREATE TABLE u (id int);`);
  assert.deepEqual(out, [`INSERT INTO t (v) VALUES ('a;b')`, 'CREATE TABLE u (id int)']);
});

test('an escaped quote does not open a literal that swallows the file', () => {
  const out = splitStatements(`INSERT INTO t (v) VALUES ('it''s'); CREATE TABLE u (id int);`);
  assert.deepEqual(out, [`INSERT INTO t (v) VALUES ('it''s')`, 'CREATE TABLE u (id int)']);
});

test('a block comment is removed without joining the tokens around it', () => {
  const out = splitStatements(`CREATE TABLE/* a; comment */t (id int);`);
  assert.deepEqual(out, ['CREATE TABLE t (id int)']);
});
