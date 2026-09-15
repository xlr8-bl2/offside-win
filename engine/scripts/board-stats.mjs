/**
 * What the board actually looks like, read straight from Postgres.
 *
 * Exists to measure factor coverage rather than assert it. Confidence is a
 * product of four sub-one terms, so a factor that can never compute silently
 * caps it for every fixture — the only way to know whether a parser fix helped
 * is to count the states before and after.
 */
import postgres from 'postgres';

const sql = postgres(process.env.SUPABASE_DB_URL, {
  prepare: false,
  ssl: new URL(process.env.SUPABASE_DB_URL).hostname.startsWith('localhost') ? false : 'require',
  max: 2,
  types: { bigint: { to: 20, from: [20], serialize: String, parse: Number } },
  onnotice: () => {},
});

const rows = await sql`SELECT board_json, bundle_json FROM fixture ORDER BY kickoff`;
if (!rows.length) {
  console.log('No fixtures on the board.');
  await sql.end();
  process.exit(0);
}

const boards = rows.map((r) => JSON.parse(r.board_json));
const conf = boards.map((b) => b.confidence ?? 0).sort((a, b) => a - b);
const q = (p) => conf[Math.floor(p * (conf.length - 1))];
const gate = Number(process.env.SEL_MIN_CONFIDENCE ?? 0.45);

console.log(`fixtures on board: ${boards.length}`);
console.log(
  `confidence  min ${q(0).toFixed(3)}  p25 ${q(0.25).toFixed(3)}  median ${q(0.5).toFixed(3)}  ` +
    `p75 ${q(0.75).toFixed(3)}  max ${q(1).toFixed(3)}  mean ${(conf.reduce((a, x) => a + x, 0) / conf.length).toFixed(3)}`,
);
console.log(`above the ${gate} gate: ${conf.filter((c) => c >= gate).length}/${conf.length}`);
console.log(`with a pick: ${boards.filter((b) => b.top_pick).length}`);

const tally = new Map();
for (const r of rows) {
  const b = JSON.parse(r.bundle_json);
  for (const f of b.ledger ?? []) {
    const t = tally.get(f.id) ?? { tier: f.tier, COMPUTED: 0, THIN: 0, UNAVAILABLE: 0 };
    t[f.state]++;
    tally.set(f.id, t);
  }
}
console.log('\nfactor'.padEnd(35) + 'tier  COMPUTED  THIN  UNAVAIL');
const ordered = [...tally].sort((a, b) => a[1].tier - b[1].tier || b[1].UNAVAILABLE - a[1].UNAVAILABLE);
for (const [id, t] of ordered) {
  console.log(
    id.padEnd(34) + String(t.tier).padEnd(6) + String(t.COMPUTED).padEnd(10) + String(t.THIN).padEnd(6) + t.UNAVAILABLE,
  );
}
const dark = ordered.filter(([, t]) => t.COMPUTED === 0);
console.log(`\nnever computed (${dark.length}), losing ${dark.reduce((a, [, t]) => a + (8 - t.tier), 0)} weight:`);
for (const [id, t] of dark) console.log(`  ${id}  (tier ${t.tier}, weight ${8 - t.tier})`);

await sql.end();
