import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql = readFileSync(new URL('../../schema.pg.sql', import.meta.url), 'utf8');

/** Statements as migrate() will see them: split on ';', comments stripped. */
function statements(src: string): string[] {
  return src
    .split(';')
    .map((s) => s.replace(/^\s*--.*$/gm, '').trim())
    .filter((s) => s.length > 0);
}

const tables = [...sql.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map((m) => m[1]!);

test('postgres schema declares tables', () => {
  assert.ok(tables.length >= 12, `expected the full schema, found ${tables.length} tables`);
});

// The anon key is public. RLS plus a SELECT-only grant is the only thing
// standing between it and write access, so a table added without both is a hole
// that no amount of careful reading reliably catches.
for (const t of tables) {
  test(`${t} is not writable through the public anon key`, () => {
    assert.match(sql, new RegExp(`ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY`), `${t}: RLS not enabled`);
    assert.match(sql, new RegExp(`CREATE POLICY ${t}_read ON ${t} FOR SELECT TO anon`), `${t}: no select policy`);
    assert.match(sql, new RegExp(`GRANT SELECT ON ${t} TO anon`), `${t}: no select grant`);
    assert.doesNotMatch(
      sql,
      new RegExp(`GRANT[^;]*\\b(INSERT|UPDATE|DELETE|ALL)\\b[^;]*ON ${t} TO anon`, 'i'),
      `${t}: grants write access to anon`,
    );
  });
}

test('migrate() can split every statement — no dollar-quoted bodies', () => {
  // migrate() splits naively on ';'. A $$ ... $$ body containing a semicolon
  // would be torn in half and fail at runtime rather than here. Check the
  // statements rather than the raw file: prose in a comment may say "$$"
  // (the header does, explaining this very rule) and is stripped before running.
  for (const s of statements(sql)) {
    assert.ok(!s.includes('$$'), `dollar-quoted body would be split wrongly: ${s.slice(0, 60)}`);
    assert.ok(/^(CREATE|ALTER|DROP|GRANT|COMMENT|INSERT|DELETE)/i.test(s), `unexpected statement: ${s.slice(0, 60)}`);
  }
  // And no comment may contain a semicolon: migrate() splits before it strips.
  for (const line of sql.split('\n')) {
    const c = line.indexOf('--');
    if (c >= 0) assert.ok(!line.slice(c).includes(';'), `comment contains ';', which splits a statement: ${line.trim().slice(0, 60)}`);
  }
});

test('picks are unique even when the market has no line', () => {
  // The SQLite bug this replaces: NULLs compare distinct in a unique index, so
  // every 1x2 pick duplicated on each rerun.
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS pick_unique_line[\s\S]*?NULLS NOT DISTINCT/);
});
