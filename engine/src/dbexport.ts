/**
 * `db:export`: every row of the database, written out to leave Supabase.
 *
 * On 7 October 2026 Supabase restricted the project for going over the free
 * plan's monthly transfer (exceed_egress_quota): its REST API, which the site
 * and sign-in read through, answers 402 to everything. The direct Postgres
 * connection the engine uses still works, so this reads every table over it
 * and writes one gzipped JSON-lines file per table, plus a manifest of columns
 * and row counts, for the move to Cloudflare D1 (HANDOFF.md, "The move to D1").
 *
 * The workflow (pg.yml) encrypts the folder with a key held only in Actions
 * secrets before it is uploaded, because the repository and its artifacts are
 * public and the rows include accounts' email addresses and payment records.
 * This prints table names and counts, never values.
 *
 * Reads in cursors of 2,000 rows, so a large table never sits in memory.
 */

import postgres from 'postgres';
import { createWriteStream, mkdirSync, writeFileSync } from 'node:fs';
import { createGzip } from 'node:zlib';
import { once } from 'node:events';

const OUT = 'export';

/** The tables worth keeping: everything in public, and the accounts in auth. */
const AUTH_TABLES = ['users', 'identities'];

export async function dbExport(): Promise<void> {
  const url = process.env['SUPABASE_DB_URL'];
  if (!url) throw new Error('SUPABASE_DB_URL is not set');
  const sql = postgres(url, { max: 1, prepare: false, ssl: 'require', idle_timeout: 20 });
  mkdirSync(OUT, { recursive: true });
  const manifest: Record<string, { schema: string; rows: number; columns: Array<{ name: string; type: string; nullable: boolean }> }> = {};
  try {
    const tables = await sql<{ table_schema: string; table_name: string }[]>`
      SELECT table_schema, table_name FROM information_schema.tables
      WHERE table_type = 'BASE TABLE'
        AND (table_schema = 'public' OR (table_schema = 'auth' AND table_name = ANY(${AUTH_TABLES})))
      ORDER BY table_schema, table_name`;
    let total = 0;
    for (const t of tables) {
      const cols = await sql<{ column_name: string; data_type: string; is_nullable: string }[]>`
        SELECT column_name, data_type, is_nullable FROM information_schema.columns
        WHERE table_schema = ${t.table_schema} AND table_name = ${t.table_name} ORDER BY ordinal_position`;
      const file = `${OUT}/${t.table_schema}.${t.table_name}.jsonl.gz`;
      const gz = createGzip({ level: 6 });
      const out = createWriteStream(file);
      gz.pipe(out);
      let rows = 0;
      const cursor = sql`SELECT * FROM ${sql(t.table_schema)}.${sql(t.table_name)}`.cursor(2000);
      for await (const batch of cursor) {
        for (const r of batch) {
          if (!gz.write(`${JSON.stringify(r)}\n`)) await once(gz, 'drain');
          rows++;
        }
      }
      gz.end();
      await once(out, 'finish');
      manifest[`${t.table_schema}.${t.table_name}`] = {
        schema: t.table_schema,
        rows,
        columns: cols.map((c) => ({ name: c.column_name, type: c.data_type, nullable: c.is_nullable === 'YES' })),
      };
      total += rows;
      console.log(`  ${t.table_schema}.${t.table_name}: ${rows} rows`);
    }
    const [size] = await sql<{ bytes: string }[]>`SELECT pg_database_size(current_database())::text AS bytes`;
    writeFileSync(`${OUT}/manifest.json`, JSON.stringify({ at: new Date().toISOString(), databaseBytes: Number(size?.bytes ?? 0), tables: manifest }, null, 1));
    console.log(`exported ${tables.length} tables, ${total} rows; database on disk ${(Number(size?.bytes ?? 0) / 1e6).toFixed(0)} MB`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}
