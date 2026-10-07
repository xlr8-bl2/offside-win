/**
 * `db:verify`: does the site read the same from D1 as it did from Postgres?
 *
 * Every public endpoint used to be a Postgres function; worker/src/d1read.ts
 * rebuilds each one over SQLite. This loads the real export into both, a
 * Postgres (the workflow's service container, `VERIFY_PG_URL`) with
 * schema.pg.sql and a local SQLite with schema.sql and the very statements
 * the import sends to D1 (d1load.ts), then asks both the same questions and
 * compares the answers field by field: every fixture page, every competition,
 * every team on the board, the board itself over several windows, picks,
 * players, search, and the rest.
 *
 * Prints function names, counts and the paths of fields that differ, never a
 * value: the repository and its logs are public. Fails if anything differs
 * that the port does not mean to change.
 */

import postgres from 'postgres';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import * as read from '../../worker/src/d1read.ts';
import { exportRows, importStatements, localD1, readManifest } from './d1load.ts';

/** What Supabase provides that schema.pg.sql leans on: the auth schema, its helpers, the roles. */
const SUPABASE_STUB = `
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY, email text, created_at timestamptz DEFAULT now(),
  last_sign_in_at timestamptz, raw_app_meta_data jsonb, raw_user_meta_data jsonb, email_confirmed_at timestamptz);
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE OR REPLACE FUNCTION auth.email() RETURNS text LANGUAGE sql STABLE AS
  $$ SELECT nullif(current_setting('request.jwt.claim.email', true), '') $$;
DO $$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role NOLOGIN BYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
`;

type Json = unknown;

/** Paths where two values differ. Numbers agree to nine significant places. */
export function diff(a: Json, b: Json, path = '', out: string[] = [], limit = 20): string[] {
  if (out.length >= limit) return out;
  if (typeof a === 'number' && typeof b === 'number') {
    if (a !== b && Math.abs(a - b) > 1e-9 * Math.max(1, Math.abs(a), Math.abs(b))) out.push(path || '(root)');
    return out;
  }
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') {
    if (a !== b) out.push(`${path || '(root)'}${a === null || b === null ? ' (null on one side)' : typeof a !== typeof b ? ` (${typeof a} vs ${typeof b})` : ''}`);
    return out;
  }
  if (Array.isArray(a) !== Array.isArray(b)) { out.push(`${path} (array on one side)`); return out; }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) { out.push(`${path} (length ${a.length} vs ${b.length})`); return out; }
    a.forEach((x, i) => diff(x, b[i], `${path}[${i}]`, out, limit));
    return out;
  }
  const ao = a as Record<string, Json>;
  const bo = b as Record<string, Json>;
  for (const k of new Set([...Object.keys(ao), ...Object.keys(bo)])) {
    if (!(k in ao)) { out.push(`${path}.${k} (only in D1)`); continue; }
    if (!(k in bo)) { out.push(`${path}.${k} (only in Postgres)`); continue; }
    diff(ao[k], bo[k], `${path}.${k}`, out, limit);
  }
  return out;
}

/** The same JSON with object keys sorted, for comparing arrays as sets. */
function canon(v: Json): string {
  return JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x)
    ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, (x as Record<string, unknown>)[k]])) : x));
}
/** Every array with its items sorted: two answers that differ only in the order of ties compare equal. */
function sorted(v: Json): Json {
  if (Array.isArray(v)) return v.map(sorted).sort((x, y) => (canon(x) < canon(y) ? -1 : canon(x) > canon(y) ? 1 : 0));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, sorted(x)]));
  return v;
}

/** Fields that are the clock, not the data. */
const VOLATILE: Record<string, string[]> = {
  get_board: ['generated_at'],
  get_league: [],
  get_health: ['last_computed_minutes_ago'],
};
function strip(fn: string, v: Json): Json {
  const drop = VOLATILE[fn] ?? [];
  if (!drop.length || !v || typeof v !== 'object' || Array.isArray(v)) return v;
  return Object.fromEntries(Object.entries(v).filter(([k]) => !drop.includes(k)));
}

export async function d1Verify(dir = 'export'): Promise<void> {
  const url = process.env['VERIFY_PG_URL'];
  if (!url) throw new Error('VERIFY_PG_URL is not set');
  const manifest = readManifest(dir);
  const pgSchema = readFileSync(new URL('../../schema.pg.sql', import.meta.url), 'utf8');
  const liteSchema = readFileSync(new URL('../../schema.sql', import.meta.url), 'utf8');

  // ---- Postgres, as Supabase had it.
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  await sql.unsafe(SUPABASE_STUB);
  await sql.unsafe(pgSchema);
  for (const [key, t] of Object.entries(manifest.tables)) {
    if (t.schema !== 'public') continue;
    const [exists] = await sql`SELECT to_regclass(${key}) IS NOT NULL AS ok`;
    if (!exists?.ok) { console.log(`  postgres: ${key} not in schema.pg.sql, skipped`); continue; }
    await sql.unsafe(`DELETE FROM ${key}`);
    let chunk: Array<Record<string, unknown>> = [];
    const flush = async () => {
      if (!chunk.length) return;
      await sql.unsafe(`INSERT INTO ${key} OVERRIDING SYSTEM VALUE SELECT * FROM json_populate_recordset(NULL::${key}, $1::text::json)`, [JSON.stringify(chunk)]);
      chunk = [];
    };
    for await (const row of exportRows(dir, key)) { chunk.push(row); if (chunk.length >= 1000) await flush(); }
    await flush();
  }
  console.log('postgres loaded');

  // ---- SQLite, loaded with the import's own statements.
  const lite = new DatabaseSync(':memory:');
  lite.exec(liteSchema);
  const report = { tables: {} as Record<string, number>, skipped: [] as string[] };
  for await (const st of importStatements(dir, liteSchema, report)) lite.prepare(st.sql).run(...(st.params as never[]));
  console.log(`sqlite loaded: ${Object.values(report.tables).reduce((a, b) => a + b, 0)} rows`);
  for (const c of report.skipped) console.log(`  left out of D1: ${c}`);
  const db = localD1(lite);

  // ---- The questions.
  const now = Math.floor(Date.now() / 1000);
  const ids = (q: string) => (lite.prepare(q).all() as Array<{ id: number }>).map((r) => r.id);
  const fixtures = ids('SELECT id FROM fixture ORDER BY id');
  const schedule = ids('SELECT id FROM schedule ORDER BY kickoff LIMIT 40');
  const leagues = ids('SELECT id FROM league WHERE tracked = 1 ORDER BY id');
  const teams = ids(`SELECT DISTINCT home_team_id AS id FROM fixture WHERE home_team_id IS NOT NULL
    UNION SELECT DISTINCT away_team_id FROM fixture WHERE away_team_id IS NOT NULL ORDER BY 1`);
  const players = [...new Set((lite.prepare(`SELECT v FROM kv WHERE k LIKE 'league:%:scorers'`).all() as Array<{ v: string }>)
    .flatMap((r) => { try { return ((JSON.parse(r.v).rows ?? []) as Array<{ player_id?: unknown }>).map((x) => Number(x.player_id)); } catch { return []; } })
    .filter((x) => Number.isFinite(x) && x > 0))].slice(0, 150);

  type Ask = { fn: string; args: Record<string, string | number | undefined>; label: string };
  const asks: Ask[] = [
    { fn: 'get_board', args: { p_from: now - 24 * 3600, p_to: now + 72 * 3600 }, label: 'board, default window' },
    { fn: 'get_board', args: { p_from: now - 72 * 3600, p_to: now + 240 * 3600 }, label: 'board, widest window' },
    { fn: 'get_board', args: { p_from: now - 30 * 86400, p_to: now + 30 * 86400 }, label: 'board, two months' },
    ...leagues.map((id) => ({ fn: 'get_board', args: { p_from: now - 24 * 3600, p_to: now + 240 * 3600, p_league: id }, label: 'board, one league' })),
    ...fixtures.map((id) => ({ fn: 'get_fixture', args: { p_id: id }, label: 'fixture' })),
    ...schedule.map((id) => ({ fn: 'get_fixture', args: { p_id: id }, label: 'fixture preview' })),
    { fn: 'get_fixture', args: { p_id: 999999999 }, label: 'fixture, unknown' },
    { fn: 'get_picks', args: { p_limit: 60 }, label: 'picks' },
    { fn: 'get_picks', args: { p_limit: 200, p_settled: 'true' }, label: 'picks, settled' },
    { fn: 'get_picks', args: { p_limit: 200, p_settled: 'false' }, label: 'picks, open' },
    { fn: 'get_picks', args: { p_limit: 5 }, label: 'picks, five' },
    { fn: 'get_model', args: {}, label: 'model' },
    { fn: 'get_hero', args: {}, label: 'hero' },
    { fn: 'get_record', args: {}, label: 'record' },
    { fn: 'get_how_sure', args: {}, label: 'how sure' },
    { fn: 'get_leagues', args: {}, label: 'leagues' },
    ...leagues.map((id) => ({ fn: 'get_league', args: { p_id: id }, label: 'league' })),
    ...teams.map((id) => ({ fn: 'get_team', args: { p_id: id }, label: 'team' })),
    ...players.map((id) => ({ fn: 'get_player', args: { p_id: id }, label: 'player' })),
    ...players.slice(0, 20).map((id) => ({ fn: 'get_player', args: { p_id: id, p_league: leagues[0] }, label: 'player, from a league' })),
    ...['man', 'united', 'real', 'atletico', 'munchen', 'liga', 'cup', 'fc', 'city', 'premier', 'zz', 'a', 'sao', 'inter']
      .map((q) => ({ fn: 'search_games', args: { p_q: q }, label: 'search' })),
    { fn: 'get_health', args: {}, label: 'health' },
    { fn: 'get_plans', args: {}, label: 'plans' },
    { fn: 'get_promos', args: {}, label: 'promos' },
    { fn: 'get_pulled', args: { p_limit: 20 }, label: 'pulled' },
    { fn: 'get_pulled', args: { p_limit: 60 }, label: 'pulled, most' },
    { fn: 'get_slip', args: {}, label: 'slip' },
  ];

  const tally = new Map<string, { n: number; same: number; order: number; differ: number }>();
  const paths = new Map<string, number>();
  for (const a of asks) {
    const names = Object.keys(a.args).filter((k) => a.args[k] !== undefined);
    const call = `SELECT ${a.fn}(${names.map((k, i) => `${k} => $${i + 1}`).join(', ')}) AS v`;
    const [row] = await sql.unsafe(call, names.map((k) => a.args[k] as string | number));
    const want = strip(a.fn, row?.v ?? null);
    const got = strip(a.fn, JSON.parse(JSON.stringify(await read.serve(db, a.fn, a.args) ?? null)));
    const t = tally.get(a.label) ?? { n: 0, same: 0, order: 0, differ: 0 };
    t.n++;
    const d = diff(got, want);
    if (!d.length) t.same++;
    else if (!diff(sorted(got), sorted(want)).length) t.order++;
    else {
      t.differ++;
      for (const p of d) {
        const shape = `${a.fn} ${p.replace(/\[\d+\]/g, '[]')}`;
        paths.set(shape, (paths.get(shape) ?? 0) + 1);
      }
    }
    tally.set(a.label, t);
  }
  await sql.end();

  let bad = 0;
  for (const [label, t] of tally) {
    console.log(`${label}: ${t.n} asked, ${t.same} identical${t.order ? `, ${t.order} same rows in another order` : ''}${t.differ ? `, ${t.differ} DIFFER` : ''}`);
    bad += t.differ;
  }
  if (paths.size) {
    console.log('\nfields that differ (how many answers):');
    for (const [p, n] of [...paths].sort((x, y) => y[1] - x[1])) console.log(`  ${n}  ${p}`);
  }
  if (bad) throw new Error(`${bad} answers differ between Postgres and D1`);
  console.log('\nD1 answers every question as Postgres did.');
}
