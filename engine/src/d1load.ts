/**
 * The export (dbexport.ts) turned into SQL that D1 can run, and a local
 * SQLite standing in for D1.
 *
 * `importStatements` turns the whole public schema's rows into INSERTs with
 * bound values, in the types `schema.sql` declares: Postgres's bigint arrives
 * from the export as text and goes in as a number, a boolean as 0 or 1, and
 * JSON as its text. Columns the live database had and `schema.sql` does not
 * are left out and named. The accounts (auth.users, auth.identities) are not
 * loaded: they come back with sign-in in stage 2, from the same export.
 *
 * The statements start by emptying every table they fill, so running them
 * twice gives the same database. The import (d1import.ts) sends them to D1 and
 * the verifier (d1verify.ts) runs the very same ones on a local SQLite.
 *
 * Prints table names and counts, never values: the rows hold email addresses.
 */

import { createReadStream, existsSync, readFileSync } from 'node:fs';
import { createGunzip } from 'node:zlib';
import { createInterface } from 'node:readline';
import { DatabaseSync } from 'node:sqlite';
import type { D1Read, D1Stmt } from '../../worker/src/d1read.ts';

export interface Manifest {
  tables: Record<string, { schema: string; rows: number; columns: Array<{ name: string; type: string; nullable: boolean }> }>;
}

export function readManifest(dir: string): Manifest {
  return JSON.parse(readFileSync(`${dir}/manifest.json`, 'utf8')) as Manifest;
}

/** Every row of one exported table, one at a time. */
export async function* exportRows(dir: string, key: string): AsyncGenerator<Record<string, unknown>> {
  const file = `${dir}/${key}.jsonl.gz`;
  if (!existsSync(file)) return;
  const lines = createInterface({ input: createReadStream(file).pipe(createGunzip()), crlfDelay: Infinity });
  for await (const line of lines) if (line.trim()) yield JSON.parse(line) as Record<string, unknown>;
}

/** Each table's columns and declared types, read from schema.sql itself. */
export function sqliteColumns(schemaSql: string): Map<string, Map<string, string>> {
  const db = new DatabaseSync(':memory:');
  db.exec(schemaSql);
  const out = new Map<string, Map<string, string>>();
  const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`).all() as Array<{ name: string }>;
  for (const t of tables) {
    const cols = db.prepare(`PRAGMA table_info(${JSON.stringify(t.name)})`).all() as Array<{ name: string; type: string }>;
    out.set(t.name, new Map(cols.map((c) => [c.name, c.type.toUpperCase()])));
  }
  db.close();
  return out;
}

/** One value as D1 takes it, in the column's declared type. */
export function value(v: unknown, type: string): unknown {
  if (v === null || v === undefined) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'object') return JSON.stringify(v);
  const s = String(v);
  if ((type === 'INTEGER' || type === 'REAL') && /^-?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(s)) {
    const n = Number(s);
    // A bigint past 2^53 would lose digits as a number; kept as text, SQLite's
    // INTEGER affinity still stores it exactly.
    return Number.isSafeInteger(n) || type === 'REAL' || s.includes('.') ? n : s;
  }
  if (type === 'INTEGER' && (s === 'true' || s === 'false')) return s === 'true' ? 1 : 0;
  return s;
}

export interface Statement { sql: string; params: unknown[] }

/** D1 allows 100 bound parameters a statement. */
const MAX_PARAMS = 100;

/**
 * The import as statements: empty every table it fills, then multi-row
 * INSERTs with bound values. `report` is filled with per-table counts and the
 * columns left out.
 */
export async function* importStatements(dir: string, schemaSql: string, report: { tables: Record<string, number>; skipped: string[] }): AsyncGenerator<Statement> {
  const manifest = readManifest(dir);
  const cols = sqliteColumns(schemaSql);
  const publicTables = Object.entries(manifest.tables).filter(([, t]) => t.schema === 'public');
  for (const [key] of publicTables) {
    const name = key.slice('public.'.length);
    if (cols.has(name)) yield { sql: `DELETE FROM ${name}`, params: [] };
  }
  for (const [key, t] of publicTables) {
    const name = key.slice('public.'.length);
    const target = cols.get(name);
    if (!target) { report.skipped.push(`${key} (no such table in schema.sql)`); continue; }
    const keep = t.columns.map((c) => c.name).filter((c) => target.has(c));
    for (const c of t.columns) if (!target.has(c.name)) report.skipped.push(`${key}.${c.name}`);
    const per = Math.max(1, Math.floor(MAX_PARAMS / keep.length));
    const one = `(${keep.map(() => '?').join(', ')})`;
    let batch: unknown[][] = [];
    let n = 0;
    const make = (): Statement => ({
      sql: `INSERT INTO ${name} (${keep.map((c) => `"${c}"`).join(', ')}) VALUES ${batch.map(() => one).join(', ')}`,
      params: batch.flat(),
    });
    for await (const row of exportRows(dir, key)) {
      batch.push(keep.map((c) => value(row[c], target.get(c) ?? '')));
      n++;
      if (batch.length >= per) { yield make(); batch = []; }
    }
    if (batch.length) yield make();
    report.tables[name] = n;
  }
}

/** node:sqlite behind the same small interface the Worker uses for D1. */
export function localD1(db: DatabaseSync): D1Read {
  const clean = (vs: unknown[]) => vs.map((v) => (typeof v === 'boolean' ? (v ? 1 : 0) : v === undefined ? null : v));
  const make = (sql: string, params: unknown[]): D1Stmt => ({
    bind: (...values: unknown[]) => make(sql, clean(values)),
    async all<T>() { return { results: db.prepare(sql).all(...(params as never[])) as T[] }; },
    async first<T>() { return (db.prepare(sql).get(...(params as never[])) ?? null) as T | null; },
  });
  return {
    prepare: (sql: string) => make(sql, []),
    async batch(statements: D1Stmt[]) { return Promise.all(statements.map((s) => s.all())); },
  };
}
