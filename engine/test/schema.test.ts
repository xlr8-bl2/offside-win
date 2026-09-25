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

// Tables with paid content in them, readable only through a serving function.
const SERVED = new Set(['fixture', 'pick', 'kv', 'slip', 'entitlement']);

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

    // The paid tables are read only through the serving functions. A direct
    // SELECT grant on any of them hands every open call to anyone holding the
    // public key, which ships to every browser -- confirmed against production
    // (thirty-two open calls from /rest/v1/pick) before this rule existed.
    if (SERVED.has(t)) {
      assert.doesNotMatch(sql, new RegExp(`GRANT SELECT ON ${t} TO`), `${t}: holds paid content and grants a direct read`);
      assert.doesNotMatch(sql, new RegExp(`CREATE POLICY \\w+ ON ${t} FOR SELECT`), `${t}: a read policy on a paid table`);
      assert.match(sql, new RegExp(`REVOKE ALL ON ${t} FROM anon, authenticated`), `${t}: default privileges not revoked`);
      return;
    }

    assert.match(sql, new RegExp(`CREATE POLICY ${t}_read ON ${t} FOR SELECT TO anon`), `${t}: no select policy`);
    assert.match(sql, new RegExp(`GRANT SELECT ON ${t} TO anon`), `${t}: no select grant`);

    // A write grant with no column list is a blanket write and is never allowed.
    // The `[^;(]*` either side is what draws the line: it cannot cross an
    // opening paren, so `GRANT UPDATE (a, b) ON t TO anon` does not match here
    // and is judged by the rule below instead.
    assert.doesNotMatch(
      sql,
      new RegExp(`GRANT\\s+[^;(]*\\b(INSERT|UPDATE|DELETE|ALL)\\b[^;(]*ON ${t} TO anon`, 'i'),
      `${t}: grants unrestricted write access to anon`,
    );
  });
}

// A column-scoped UPDATE is the one write a reader may make, and only when two
// things hold: a policy that picks the row, and a column list that picks the
// field. Either alone is a hole -- a policy without a column list lets a member
// edit their own expiry date, and a column list without a policy lets them edit
// everyone's.
for (const m of sql.matchAll(/GRANT\s+UPDATE\s*\(([^)]*)\)\s*ON (\w+) TO anon/gi)) {
  const columns = m[1]!.split(',').map((c) => c.trim());
  const table = m[2]!;
  test(`${table}'s column-scoped update is bounded by a policy`, () => {
    assert.match(
      sql,
      new RegExp(`CREATE POLICY \\w+ ON ${table} FOR UPDATE TO anon[\\s\\S]*?WITH CHECK`),
      `${table}: an update grant with no FOR UPDATE ... WITH CHECK policy behind it`,
    );
    // The specific thing that must never be writable by the person it benefits.
    assert.ok(
      !columns.includes('expires_at'),
      `${table}: a reader who can write expires_at can grant themselves membership`,
    );
    assert.ok(!columns.includes('user_id'), `${table}: a writable user_id lets a row be reassigned`);
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

// Functions the webhook calls while holding a service key. They write, so the
// public key must not be able to reach them at all. SECURITY INVOKER means that
// even a mistaken grant would run them as anon, which has no write privilege on
// either table -- but "it would fail anyway" is not a reason to hand out the
// call, so the absence of a grant is asserted instead.
const PRIVATE_FUNCTIONS = new Set(['record_payment', 'revoke_membership', 'record_entitlement', 'revoke_entitlement']);

// The Worker's read path. The serving functions over the paid tables run as
// their owner, because those tables grant the public roles nothing -- so each
// one IS the wall, and every one that returns calls must apply it. Anything
// else runs as the caller: SECURITY DEFINER on a function that does not
// filter is the one way a read-only surface becomes a data leak.
const DEFINER = new Set(['get_board', 'get_fixture', 'get_picks', 'get_model', 'get_hero', 'get_health', 'get_slip', 'get_plans', 'get_account', 'has_membership', 'free_fixture_id', 'get_league']);
const WALLED = new Set(['get_board', 'get_fixture', 'get_picks', 'get_slip']);
for (const fn of [...sql.matchAll(/CREATE OR REPLACE FUNCTION (\w+)\(/g)].map((m) => m[1]!)) {
  test(`${fn} ${DEFINER.has(fn) ? 'runs as owner behind the wall' : 'runs as the caller'}${PRIVATE_FUNCTIONS.has(fn) ? ' and is not callable by anon' : ' and is callable by anon'}`, () => {
    const body = sql.slice(sql.indexOf(`CREATE OR REPLACE FUNCTION ${fn}(`));
    const decl = body.slice(0, body.indexOf('$fn$'));
    if (DEFINER.has(fn)) {
      assert.match(decl, /SECURITY\s+DEFINER/i, `${fn}: reads a table that grants the caller nothing`);
      if (WALLED.has(fn)) {
        const whole = body.slice(0, body.indexOf('$fn$;'));
        assert.match(whole, /has_membership\(\)/, `${fn}: returns calls as owner without checking membership`);
      }
    } else {
      assert.doesNotMatch(decl, /SECURITY\s+DEFINER/i, `${fn}: SECURITY DEFINER bypasses RLS`);
    }
    assert.match(decl, /SET search_path = public/, `${fn}: unpinned search_path`);

    if (PRIVATE_FUNCTIONS.has(fn)) {
      assert.doesNotMatch(
        sql,
        new RegExp(`GRANT EXECUTE ON FUNCTION ${fn}\\(`),
        `${fn}: writes memberships and must not be callable with the public key`,
      );
      return;
    }
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

test('a played match is not behind the wall', () => {
  // `get_picks` already publishes every settled call to everyone. A fixture or
  // board card that kept the same call walled after the match had been played
  // hid the evidence and sold the promise, and contradicted the results page
  // about the very same selection. Both serving functions take the full copy
  // once a final score exists.
  for (const fn of ['get_board', 'get_fixture']) {
    const body = sql.slice(sql.indexOf(`CREATE OR REPLACE FUNCTION ${fn}(`));
    assert.match(
      body.slice(0, body.indexOf('$fn$;')),
      /OR \(f\.home_goals IS NOT NULL AND f\.away_goals IS NOT NULL\)/,
      `${fn}: still walls a match that has been played`,
    );
  }
});

test('get_fixture overlays the score the way get_board does', () => {
  // The bundle is written before kick-off and never carries a result, so
  // everything the fixture page says about tense, about whether a price can
  // still be taken, and about whether the call came in hangs off this overlay.
  const body = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION get_fixture('));
  assert.match(
    body.slice(0, body.indexOf('$fn$;')),
    /jsonb_build_object\(\s*'score', jsonb_build_array\(f\.home_goals, f\.away_goals\),\s*'status', 'finished'\)/,
  );
});

// ------------------------------------------------- what the slate may rewrite

const slate = readFileSync(new URL('../src/slate.ts', import.meta.url), 'utf8');

test('the slate freezes a write-up at kick-off', () => {
  // The slate reaches back over played matches to collect their final scores,
  // and used to re-run the analysis over them on the way past. Prices have
  // moved and the line-ups are known by then, so the new selection is often a
  // different one -- which is how a fixture page came to say "we did not call
  // this one" about a match whose call is published, and won, on /results.
  //
  // Facts arriving keep updating. Opinions stop.
  const upsert = slate.slice(slate.indexOf("'ON CONFLICT (id) DO UPDATE SET '"));
  const clause = upsert.slice(0, upsert.indexOf('},'));
  for (const col of ['board_json', 'bundle_json', 'board_free_json', 'bundle_free_json']) {
    assert.match(
      clause,
      new RegExp(`${col} = CASE WHEN fixture\\.kickoff <= excluded\\.computed_at`),
      `${col}: a played match's write-up can still be rewritten`,
    );
  }
  for (const col of ['home_goals', 'away_goals', 'status']) {
    assert.match(clause, new RegExp(`${col} = excluded\\.${col}`), `${col}: stops updating after kick-off`);
  }
});

test('the fixture page and the board read calls from the record', () => {
  // A match showed "Landed" on the results page and "no call was made" on its
  // own page, because the page read a write-up that had been rewritten after
  // the match while the results page read the pick table. Both serving
  // functions now carry the pick table's view of the fixture.
  const fx = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION get_fixture('));
  assert.match(fx.slice(0, fx.indexOf('$fn$;')), /'published'[\s\S]*FROM pick pk[\s\S]*pk\.kind = 'CONFIDENT'/);
  const bd = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION get_board('));
  assert.match(bd.slice(0, bd.indexOf('$fn$;')), /'called'[\s\S]*FROM pick pk[\s\S]*pk\.kind = 'CONFIDENT'/);
});
