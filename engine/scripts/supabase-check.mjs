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
  console.log(`  port      ${u.port}  ${u.port === '6543' ? '(transaction pooler)' : u.port === '5432' ? '(session pooler, or direct)' : '(unexpected)'}`);
  // The single most likely setup mistake, and it fails as an opaque network
  // error: Supabase serves *direct* connections (db.<ref>.supabase.co) over
  // IPv6 only unless you buy the IPv4 add-on, and GitHub's runners are
  // IPv4-only, so the engine can never reach it. The pooler hosts are IPv4.
  if (/^db\..*\.supabase\.co$/.test(u.hostname)) {
    console.error(
      '\n  This is the DIRECT connection string. It resolves to IPv6 only, and GitHub Actions\n' +
        '  runners have no IPv6 route, so this will always fail with ENETUNREACH.\n' +
        '  Use the pooler instead: Supabase > Connect > Transaction pooler, which looks like\n' +
        '    postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres',
    );
    process.exit(1);
  }
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

console.log('\n--- postgrest (the Worker read path) ---');
const key = process.env.SUPABASE_ANON_KEY;
console.log(`  key looks like: ${key.startsWith('eyJ') ? 'a JWT (legacy anon key)' : key.startsWith('sb_publishable_') ? 'a new publishable key' : key.startsWith('sb_secret_') ? 'a SECRET key — do not use this in the Worker' : 'an unrecognised format'}`);

// Try each header style separately. A 401 on all three means the key is wrong
// or disabled; a 401 on one but not another means the Worker just needs to send
// a different header, which is a one-line fix rather than a new key.
const attempts = {
  'apikey only': { apikey: key },
  'bearer only': { Authorization: `Bearer ${key}` },
  'both': { apikey: key, Authorization: `Bearer ${key}` },
};
let anyOk = false;
for (const [label, headers] of Object.entries(attempts)) {
  try {
    const r = await fetch(`${process.env.SUPABASE_URL}/rest/v1/league?select=id&limit=1`, { headers });
    console.log(`  ${label.padEnd(12)} -> ${r.status} ${r.statusText}`);
    if (r.ok) anyOk = true;
    else if (r.status === 401) {
      const body = await r.text();
      const hint = body.slice(0, 160).replace(/\s+/g, ' ');
      if (hint) console.log(`               ${hint}`);
    }
  } catch (e) {
    console.log(`  ${label.padEnd(12)} -> request failed: ${e.message}`);
  }
}

if (!anyOk) {
  // Deliberately not fatal. The engine writes through Postgres, which is
  // already proven above; only the Worker reads through PostgREST, and the
  // migration should not be held up by a key the engine never uses.
  console.log(
    '\n  WARNING: no header style was accepted. The engine can still migrate and write —\n' +
      '  this only affects the Worker read path. Check Supabase > Project Settings > API Keys:\n' +
      '  copy the anon / publishable key (never the secret or service_role one).',
  );
} else {
  console.log('\n  PostgREST reachable.');
}

console.log('\nPostgres is usable. That is what the engine needs.');
