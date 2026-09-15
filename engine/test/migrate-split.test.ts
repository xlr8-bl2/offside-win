import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { splitStatements } from '../src/store.ts';

const isDDL = (s: string) => /^(CREATE|ALTER|DROP|GRANT|COMMENT|INSERT|DELETE)/i.test(s);

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
