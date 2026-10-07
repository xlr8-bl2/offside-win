import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { accountRows, epoch, upsertStatements } from '../src/d1accounts.ts';

test('Supabase users become accounts with their ids, Google linked from identities', () => {
  const rows = accountRows([
    { id: 'u1', email: 'A@Example.com', created_at: '2026-09-20 10:00:00.123+00', raw_user_meta_data: { full_name: 'Ash', avatar_url: 'https://x/a.png' }, raw_app_meta_data: { provider: 'google' } },
    { id: 'u2', email: 'b@example.com', created_at: '2026-09-21T10:00:00Z', raw_user_meta_data: '{}', raw_app_meta_data: '{"provider":"email"}' },
    { id: 'u3', email: null, created_at: '2026-09-21T10:00:00Z' },
  ], [{ provider: 'google', provider_id: 'g-1', user_id: 'u1' }, { provider: 'email', provider_id: 'u2', user_id: 'u2' }]);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], { id: 'u1', email: 'a@example.com', name: 'Ash', avatar_url: 'https://x/a.png', provider: 'google', google_sub: 'g-1', created_at: Date.parse('2026-09-20T10:00:00.123Z') / 1000 | 0, last_sign_in_at: null });
  assert.equal(rows[1]!.google_sub, null);
  assert.equal(epoch('2026-09-21T10:00:00Z'), Date.parse('2026-09-21T10:00:00Z') / 1000);
});

test('the upsert runs twice on the D1 schema without changing anything', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../../schema.sql', import.meta.url), 'utf8'));
  const rows = accountRows([{ id: 'u1', email: 'a@example.com', created_at: '2026-09-20T10:00:00Z' }], []);
  for (let i = 0; i < 2; i++) for (const s of upsertStatements(rows)) db.prepare(s.sql).run(...(s.params as never[]));
  assert.equal((db.prepare('SELECT count(*) AS n FROM account').get() as { n: number }).n, 1);
});
