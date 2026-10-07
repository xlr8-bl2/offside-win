import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

/**
 * A local SQLite built from schema.sql, behind the same small interface the
 * Worker uses for its D1 binding: prepare/bind/all/first/run and batch (one
 * transaction). For the tests of the D1 code paths.
 */
export function localD1(): { sqlite: DatabaseSync; db: any } {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../../schema.sql', import.meta.url), 'utf8'));
  const clean = (vs: unknown[]) => vs.map((v) => (typeof v === 'boolean' ? (v ? 1 : 0) : v === undefined ? null : v));
  const make = (sql: string, params: unknown[]): any => ({
    sql,
    bind: (...values: unknown[]) => make(sql, clean(values)),
    async all() { return { results: sqlite.prepare(sql).all(...(params as never[])), meta: {} }; },
    async first() { return sqlite.prepare(sql).get(...(params as never[])) ?? null; },
    async run() {
      const r = sqlite.prepare(sql).run(...(params as never[]));
      return { meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
    },
  });
  const db = {
    prepare: (sql: string) => make(sql, []),
    async batch(sts: any[]) {
      sqlite.exec('BEGIN');
      try {
        const out = [];
        for (const s of sts) {
          if (/^\s*(SELECT|WITH)\b/i.test(s.sql)) out.push(await s.all());
          else out.push(await s.run());
        }
        sqlite.exec('COMMIT');
        return out;
      } catch (e) { sqlite.exec('ROLLBACK'); throw e; }
    },
  };
  return { sqlite, db };
}
