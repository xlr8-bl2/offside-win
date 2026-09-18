import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { splitStatements } from '../src/sql-split.ts';

const sql = readFileSync(new URL('../../schema.pg.sql', import.meta.url), 'utf8');

const tables = [...sql.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map((m) => m[1]!);

test('postgres schema declares tables', () => {
  assert.ok(tables.length >= 12, `expected the full schema, found ${tables.length} tables`);
});

// Tables the public key must never reach at all, however the policy is worded.
//
// A column-level REVOKE does not narrow a table-level GRANT -- Postgres treats
// table SELECT as satisfying every column, so the revoke is silently a no-op.
// That is why these are not "granted and then narrowed": the only way to keep a
// vault token or a raw processor payload away from a browser is to grant
// nothing. Readers get the payment_receipt view, which names its columns.
//
// Listing a table here is a decision, and the test below turns it into one that
// cannot be undone by accident.
const PRIVATE = new Set(['payment', 'payment_method']);

// The anon key is public. RLS plus a SELECT-only grant is the only thing
// standing between it and write access, so a table added without both is a hole
// that no amount of careful reading reliably catches.
for (const t of tables) {
  test(`${t} is not writable through the public anon key`, () => {
    assert.match(sql, new RegExp(`ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY`), `${t}: RLS not enabled`);

    if (PRIVATE.has(t)) {
      // Nothing at all, not even SELECT. A policy would be harmless but
      // misleading, since without a grant it can never be consulted.
      assert.doesNotMatch(
        sql,
        new RegExp(`GRANT[^;]*ON ${t} TO anon`, 'i'),
        `${t}: is meant to be private but grants something to anon`,
      );
      return;
    }

    assert.match(sql, new RegExp(`CREATE POLICY ${t}_read ON ${t} FOR SELECT TO anon`), `${t}: no select policy`);
    assert.match(sql, new RegExp(`GRANT SELECT ON ${t} TO anon`), `${t}: no select grant`);
    assert.doesNotMatch(
      sql,
      new RegExp(`GRANT[^;]*\\b(INSERT|UPDATE|DELETE|ALL)\\b[^;]*ON ${t} TO anon`, 'i'),
      `${t}: grants write access to anon`,
    );
  });
}

// The view that exists so `payment` does not have to be readable. It is not
// RLS-aware -- it runs with its owner's rights -- so the filter inside it is
// the whole mechanism, and losing it would expose every member's payments to
// every other member.
test('payment_receipt filters to the caller and exposes no raw payload', () => {
  const view = sql.slice(sql.indexOf('CREATE OR REPLACE VIEW payment_receipt'));
  const body = view.slice(0, view.indexOf(';'));
  assert.match(body, /WHERE p\.user_id = auth\.uid\(\)/, 'payment_receipt is not filtered to the caller');
  assert.doesNotMatch(body, /raw_json/, 'payment_receipt exposes the raw processor payload');
  assert.match(sql, /GRANT SELECT ON payment_receipt TO anon/);
});

test('migrate() sends whole statements, function bodies included', () => {
  for (const s of splitStatements(sql)) {
    assert.ok(/^(CREATE|ALTER|DROP|GRANT|REVOKE|COMMENT|INSERT|DELETE|NOTIFY)/i.test(s), `unexpected statement: ${s.slice(0, 60)}`);
    // A body torn at an interior semicolon arrives with an opening $tag$ and no
    // closing one, which Postgres reports as an unterminated string a long way
    // from the cause.
    const tags = s.match(/\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/g) ?? [];
    assert.equal(tags.length % 2, 0, `unbalanced dollar quote — body was split: ${s.slice(0, 60)}`);
  }
});

// The Worker's entire read path. SECURITY DEFINER here would run these as the
// owner and hand the public anon key whatever the owner can see, which is the
// one way a read-only surface becomes a data leak.
for (const fn of [...sql.matchAll(/CREATE OR REPLACE FUNCTION (\w+)\(/g)].map((m) => m[1]!)) {
  test(`${fn} runs as the caller and is callable by anon`, () => {
    const body = sql.slice(sql.indexOf(`CREATE OR REPLACE FUNCTION ${fn}(`));
    const decl = body.slice(0, body.indexOf('$fn$'));
    assert.doesNotMatch(decl, /SECURITY\s+DEFINER/i, `${fn}: SECURITY DEFINER bypasses RLS`);
    assert.match(decl, /SET search_path = public/, `${fn}: unpinned search_path`);
    assert.match(sql, new RegExp(`GRANT EXECUTE ON FUNCTION ${fn}\\(`), `${fn}: anon cannot call it`);
  });
}

test('picks are unique even when the market has no line', () => {
  // The SQLite bug this replaces: NULLs compare distinct in a unique index, so
  // every 1x2 pick duplicated on each rerun.
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS pick_unique_line[\s\S]*?NULLS NOT DISTINCT/);
});

test('decay-weighted counts are floating point, not integer', () => {
  // rating.matches and team_rate.matches are *effective* match counts: the sum
  // of per-match decay weights, so 12.859... is a normal value. SQLite accepted
  // that in a column it called INTEGER; Postgres rejects it outright, which is
  // how the mistake finally surfaced. Both the definition and the ALTER matter —
  // CREATE TABLE IF NOT EXISTS will not retype a table that already exists.
  assert.match(sql, /CREATE TABLE IF NOT EXISTS rating \([\s\S]*?matches\s+double precision NOT NULL/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS team_rate \([\s\S]*?matches\s+double precision NOT NULL/);
  assert.match(sql, /ALTER TABLE rating ALTER COLUMN matches TYPE double precision/);
  assert.match(sql, /ALTER TABLE team_rate ALTER COLUMN matches TYPE double precision/);
});

test('true counts stay integer', () => {
  // referee_rate.matches counts `+= 1` and rating_meta.n_matches is obs.length.
  // Widening these too would hide a real type error behind a float.
  assert.match(sql, /CREATE TABLE IF NOT EXISTS referee_rate \([\s\S]*?matches\s+bigint NOT NULL/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS rating_meta \([\s\S]*?n_matches\s+bigint NOT NULL/);
});
