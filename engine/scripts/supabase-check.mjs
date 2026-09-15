/**
 * Connectivity preflight for the Supabase migration.
 *
 * Checks the three secrets independently so a failure names which one is wrong,
 * rather than failing somewhere deep in a backfill. Prints no secret values —
 * presence, lengths and server-side facts only.
 */
import postgres from 'postgres';

const need = ['SUPABASE_DB_URL', 'SUPABASE_URL', 'SUPABASE_ANON_KEY'];
let bad = false;

console.log('--- secrets present? ---');
for (const k of need) {
  const v = process.env[k] ?? '';
  console.log(`  ${k.padEnd(20)} ${v ? `set (${v.length} chars)` : 'MISSING'}`);
  if (!v) bad = true;
}
if (bad) {
  console.error('\nOne or more secrets are missing. Set them under Settings > Secrets and variables > Actions.');
  process.exit(1);
}

// Shape check without printing the value: the pooler host and a real password.
const dbUrl = process.env.SUPABASE_DB_URL;
console.log('\n--- connection string shape ---');
try {
  const u = new URL(dbUrl);
  console.log(`  host      ${u.hostname}`);
  console.log(`  port      ${u.port}  ${u.port === '6543' ? '(transaction pooler)' : u.port === '5432' ? '(session/direct)' : '(unexpected)'}`);
  console.log(`  user      ${u.username.split('.')[0]}...`);
  console.log(`  password  ${u.password ? `set (${u.password.length} chars)` : 'MISSING'}`);
  if (/\[|\]|YOUR-PASSWORD|PASSWORD/i.test(decodeURIComponent(u.password || ''))) {
    console.error('  ^ that looks like the placeholder, not a real password');
    process.exit(1);
  }
} catch (e) {
  console.error(`  could not parse SUPABASE_DB_URL as a URL: ${e.message}`);
  process.exit(1);
}

console.log('\n--- postgres ---');
const sql = postgres(dbUrl, { prepare: false, ssl: 'require', connect_timeout: 20, max: 1 });
try {
  const [{ version }] = await sql`select version()`;
  console.log(`  ${version.split(',')[0]}`);
  const [{ now }] = await sql`select now()`;
  console.log(`  server time ${now.toISOString()}`);
  const tables = await sql`
    select table_name from information_schema.tables
    where table_schema = 'public' order by table_name`;
  console.log(`  public tables: ${tables.length ? tables.map((t) => t.table_name).join(', ') : '(none yet)'}`);
  const [{ writable }] = await sql`select pg_is_in_recovery() = false as writable`;
  console.log(`  writable: ${writable}`);
} catch (e) {
  console.error(`  FAILED: ${e.message}`);
  process.exit(1);
} finally {
  await sql.end({ timeout: 5 });
}

console.log('\n--- postgrest (anon key, what the Worker will use) ---');
const res = await fetch(`${process.env.SUPABASE_URL}/rest/v1/`, {
  headers: { apikey: process.env.SUPABASE_ANON_KEY },
});
console.log(`  GET /rest/v1/ -> ${res.status} ${res.statusText}`);
if (!res.ok) {
  console.error('  anon key or project URL is wrong');
  process.exit(1);
}
console.log('\nAll three secrets work.');
