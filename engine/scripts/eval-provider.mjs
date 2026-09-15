/**
 * Score the provider's own prediction endpoint against real results.
 *
 * Exists because "87% accuracy" is not a claim about money. A market that lands
 * 87% of the time is priced near 1.15, and betting it blind loses. The only
 * questions worth answering are: how well calibrated are these probabilities
 * (log loss, against the same baselines our own model is held to), and do they
 * say anything the market has not already said.
 */
import postgres from 'postgres';
import { bsdOrNull, stats } from '../src/bsd.ts';

const LIMIT = Number(process.env.EVAL_LIMIT ?? 400);

const sql = postgres(process.env.SUPABASE_DB_URL, {
  prepare: false,
  ssl: new URL(process.env.SUPABASE_DB_URL).hostname.startsWith('localhost') ? false : 'require',
  max: 2,
  types: { bigint: { to: 20, from: [20], serialize: String, parse: Number } },
  onnotice: () => {},
});

const matches = await sql`
  SELECT id, home_goals, away_goals, league_id
  FROM match
  WHERE home_goals IS NOT NULL AND away_goals IS NOT NULL
  ORDER BY kickoff DESC
  LIMIT ${LIMIT}`;
console.log(`sampling ${matches.length} finished matches`);

const ln = (p) => Math.log(Math.min(1 - 1e-9, Math.max(1e-9, p)));
const acc = {
  n: 0, served: 0,
  fav: { hit: 0, n: 0 },
  r: { ll: 0, n: 0 },
  o25: { hit: 0, n: 0, ll: 0 },
  btts: { hit: 0, n: 0, ll: 0 },
  recs: { winner: { n: 0, hit: 0 }, over25: { n: 0, hit: 0 }, btts: { n: 0, hit: 0 } },
};

const queue = [...matches];
await Promise.all(Array.from({ length: 12 }, async () => {
  for (;;) {
    const m = queue.shift();
    if (!m) break;
    acc.n++;
    const p = await bsdOrNull(`/api/v2/events/${m.id}/prediction/`);
    if (!p?.markets) continue;
    acc.served++;

    const hg = m.home_goals, ag = m.away_goals;
    const res = hg > ag ? 'H' : hg < ag ? 'A' : 'D';
    const tot = hg + ag;
    const bothScored = hg > 0 && ag > 0;

    const mr = p.markets.match_result;
    if (mr && typeof mr.prob_home === 'number') {
      const probs = { H: mr.prob_home, D: mr.prob_draw, A: mr.prob_away };
      const s = probs.H + probs.D + probs.A;
      acc.r.ll += -ln(probs[res] / (s || 1));
      acc.r.n++;
      if (mr.predicted) { acc.fav.n++; if (mr.predicted === res) acc.fav.hit++; }
    }
    const ou = p.markets.over_under;
    if (ou && typeof ou.prob_over_25 === 'number') {
      const over = tot > 2.5;
      acc.o25.n++; if ((ou.prob_over_25 >= 0.5) === over) acc.o25.hit++;
      acc.o25.ll += -ln(over ? ou.prob_over_25 : 1 - ou.prob_over_25);
    }
    const bt = p.markets.btts;
    if (bt && typeof bt.prob_yes === 'number') {
      acc.btts.n++; if ((bt.prob_yes >= 0.5) === bothScored) acc.btts.hit++;
      acc.btts.ll += -ln(bothScored ? bt.prob_yes : 1 - bt.prob_yes);
    }
    // The "picks" a tipster would actually publish.
    const rec = p.recommendations ?? {};
    if (rec.winner === true && mr?.predicted) { acc.recs.winner.n++; if (mr.predicted === res) acc.recs.winner.hit++; }
    if (rec.over_25 === true) { acc.recs.over25.n++; if (tot > 2.5) acc.recs.over25.hit++; }
    if (rec.btts === true) { acc.recs.btts.n++; if (bothScored) acc.recs.btts.hit++; }
  }
}));

const pct = (h, n) => (n ? ((100 * h) / n).toFixed(1) + '%' : '—');
console.log(`\nprediction served for ${acc.served}/${acc.n} finished matches`);
if (!acc.served) {
  console.log('The endpoint does not answer for finished matches, so it cannot be scored retrospectively.');
  await sql.end();
  process.exit(0);
}
console.log(`\n--- calibration (lower log loss is better) ---`);
console.log(`  1x2        n=${acc.r.n}  logloss=${(acc.r.ll / acc.r.n).toFixed(4)}`);
console.log(`  over 2.5   n=${acc.o25.n}  logloss=${(acc.o25.ll / acc.o25.n).toFixed(4)}  accuracy=${pct(acc.o25.hit, acc.o25.n)}`);
console.log(`  btts       n=${acc.btts.n}  logloss=${(acc.btts.ll / acc.btts.n).toFixed(4)}  accuracy=${pct(acc.btts.hit, acc.btts.n)}`);
console.log(`\n--- "accuracy", the headline number ---`);
console.log(`  favourite wins:            ${pct(acc.fav.hit, acc.fav.n)}  (n=${acc.fav.n})`);
console.log(`  recommended winner bets:   ${pct(acc.recs.winner.hit, acc.recs.winner.n)}  (n=${acc.recs.winner.n})`);
console.log(`  recommended over 2.5 bets: ${pct(acc.recs.over25.hit, acc.recs.over25.n)}  (n=${acc.recs.over25.n})`);
console.log(`  recommended btts bets:     ${pct(acc.recs.btts.hit, acc.recs.btts.n)}  (n=${acc.recs.btts.n})`);
console.log(`\nprovider requests: ${stats.requests} (${stats.errors} errors)`);
await sql.end();
