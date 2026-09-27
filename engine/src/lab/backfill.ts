/**
 * `npm run lab:backfill`: recover the market snapshots the weekly prune threw
 * away, for as far back as the provider still holds prices.
 *
 * The provider keeps odds for played matches for roughly two weeks in full and
 * patchily to a month (measured with lab:odds). This walks the finished
 * matches in that window that have no snapshot yet, rebuilds each one's
 * consensus and best prices exactly as the live engine does, adds the
 * provider's own prediction, and archives it in market_snapshot beside the
 * ones pruneBoard now keeps. Our model's view is not reconstructed (that would
 * need ratings as they stood on the day), so these rows carry the market and
 * the provider only; the lab scores the model on the rows that have it.
 *
 * Matches still on the board are included: their market goes in now, and
 * the board's own snapshot replaces it when pruneBoard archives the match.
 *
 * Spends at most `LAB_BUDGET` provider requests (default 20000; the plan has
 * no daily cap, so this only bounds a runaway), eight matches at a time.
 */

import { bsdOrNull, stats as bsdStats } from '../bsd.ts';
import { buildBookMarkets, fetchQuotes, snapshotOf } from '../odds.ts';
import { exec, select } from '../store.ts';

export async function backfillSnapshots(): Promise<void> {
  const budget = Number(process.env['LAB_BUDGET'] ?? 20000);
  // pg.yml's free-text argument, when it is a number of days.
  const days = Number(process.env['LAB_DAYS'] ?? (Number(process.env['GRANT_EMAIL']) || 35));
  const now = Math.floor(Date.now() / 1000);
  const rows = await select<{
    id: number; league_id: number; kickoff: number; home_goals: number; away_goals: number;
    home_corners: number | null; away_corners: number | null; home_reds: number | null; away_reds: number | null;
  }>(
    `SELECT m.id, m.league_id, m.kickoff, m.home_goals, m.away_goals,
            m.home_corners, m.away_corners, m.home_reds, m.away_reds
       FROM match m
      WHERE m.home_goals IS NOT NULL AND m.away_goals IS NOT NULL
        AND m.kickoff BETWEEN $1 AND $2
        AND NOT EXISTS (SELECT 1 FROM market_snapshot s WHERE s.fixture_id = m.id)
      ORDER BY m.kickoff DESC`,
    [now - days * 86400, now - 3 * 3600],
  );
  console.log(`lab:backfill: ${rows.length} played matches without a snapshot in the last ${days} days; budget ${budget} requests`);

  const start = bsdStats.requests;
  let kept = 0;
  let empty = 0;
  const one = async (m: (typeof rows)[number]): Promise<void> => {
    if (bsdStats.requests - start >= budget) return;
    const quotes = await fetchQuotes(m.id, '2015-01-01T00:00:00Z');
    // A handful of quotes from one book is not a market.
    if (quotes.length < 12) { empty++; return; }
    const book = buildBookMarkets(quotes);
    const markets = book.map((b) => ({ market: b.market, line: b.line, model: {}, ...snapshotOf(b) }));
    if (!markets.some((x) => x.market === '1x2')) { empty++; return; }
    const prediction = await bsdOrNull<Record<string, unknown>>(`/api/v2/events/${m.id}/prediction/`);
    const corners = m.home_corners !== null && m.away_corners !== null ? [m.home_corners, m.away_corners] : null;
    const reds = m.home_reds !== null && m.away_reds !== null ? m.home_reds + m.away_reds : null;
    await exec(
      `INSERT INTO market_snapshot (fixture_id, league_id, kickoff, home_goals, away_goals, snapshot, archived_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (fixture_id) DO NOTHING`,
      [m.id, m.league_id, m.kickoff, m.home_goals, m.away_goals,
        JSON.stringify({ source: 'backfill', markets, lambda: null, confidence: 0, provider: prediction ?? null, corners, reds }),
        now],
    );
    kept++;
  };
  // Eight at a time: the provider answers in parallel and a serial walk of a
  // month of football took ten minutes for a fifth of it.
  let next = 0;
  await Promise.all(Array.from({ length: 8 }, async () => {
    while (next < rows.length && bsdStats.requests - start < budget) await one(rows[next++]!);
  }));
  console.log(`lab:backfill: archived ${kept}, ${empty} had no usable market; ${bsdStats.requests - start} requests spent`);

  // Snapshots archived before the sharp book's view and the book count were
  // kept: fetched again while the provider still holds their prices, and the
  // markets rewritten with both. What the slate stored of our own model's view
  // is kept as it was.
  const stale = await select<{ fixture_id: number; snapshot: string }>(
    `SELECT fixture_id, snapshot FROM market_snapshot
      WHERE kickoff BETWEEN $1 AND $2 AND snapshot NOT LIKE '%"sharp"%'
      ORDER BY kickoff DESC`,
    [now - days * 86400, now - 3 * 3600],
  );
  let refreshed = 0;
  let gone = 0;
  let nextStale = 0;
  const redo = async (r: (typeof stale)[number]): Promise<void> => {
    let snap: Record<string, any>;
    try { snap = JSON.parse(r.snapshot); } catch { return; }
    const quotes = await fetchQuotes(Number(r.fixture_id), '2015-01-01T00:00:00Z');
    if (quotes.length < 12) { gone++; return; }
    const fresh = new Map(buildBookMarkets(quotes).map((b) => [`${b.market}|${b.line}`, b]));
    const old: Array<Record<string, any>> = Array.isArray(snap['markets']) ? snap['markets'] : [];
    const seen = new Set<string>();
    const markets = old.map((m) => {
      const k = `${m['market']}|${m['line'] ?? null}`;
      seen.add(k);
      const b = fresh.get(k);
      return b ? { ...m, ...snapshotOf(b) } : m;
    });
    for (const [k, b] of fresh) if (!seen.has(k)) markets.push({ market: b.market, line: b.line, model: {}, ...snapshotOf(b) });
    await exec('UPDATE market_snapshot SET snapshot = $1 WHERE fixture_id = $2', [JSON.stringify({ ...snap, markets }), r.fixture_id]);
    refreshed++;
  };
  await Promise.all(Array.from({ length: 8 }, async () => {
    while (nextStale < stale.length && bsdStats.requests - start < budget) await redo(stale[nextStale++]!);
  }));
  console.log(`lab:backfill: ${stale.length} older snapshots lacked the sharp view; refreshed ${refreshed}, ${gone} no longer held by the provider`);
}
