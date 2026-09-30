/**
 * `npm run lab:losses`: every settled call, with what the match turned out to
 * be, so a loss can be read against the game rather than against the price.
 *
 * One line per call (teams, competition, score, shots and chances created,
 * reds, the price we called and where it closed, what we and the market made
 * of it), then the argument behind each call that lost: the drivers the
 * engine leaned on and what it set aside. Everything here is already public
 * on the results page except the drivers, which are our own notes.
 *
 * Read-only.
 */

import { select } from '../store.ts';

interface Row {
  id: number;
  fixture_id: number;
  kickoff: number;
  market: string;
  outcome: string;
  line: number | null;
  kind: string;
  odds: number;
  opening_odds: number | null;
  closing_odds: number | null;
  model_prob: number;
  book_prob: number;
  result: string;
  evidence_json: string | null;
  home: string | null;
  away: string | null;
  league: string | null;
  league_id: number | null;
  rank: number | null;
  hg: number | null;
  ag: number | null;
  hxg: number | null;
  axg: number | null;
  hs: number | null;
  as_: number | null;
  hsot: number | null;
  asot: number | null;
  hr: number | null;
  ar: number | null;
  hpos: number | null;
}

const f2 = (x: number | null | undefined) => (x === null || x === undefined || !Number.isFinite(Number(x)) ? '-' : Number(x).toFixed(2));

export async function runLosses(): Promise<void> {
  const rows = await select<Row>(
    `SELECT p.id, p.fixture_id, p.kickoff, p.market, p.outcome, p.line, p.kind, p.odds, p.opening_odds, p.closing_odds,
            p.model_prob, p.book_prob, p.result, p.evidence_json,
            coalesce(f.home_team, th.name, sh.home_team) AS home, coalesce(f.away_team, ta.name, sh.away_team) AS away,
            l.name AS league, coalesce(f.league_id, m.league_id, s.league_id) AS league_id,
            coalesce(f.rank, (try_json(s.snapshot)::jsonb->>'rank')::int) AS rank,
            coalesce(f.home_goals, m.home_goals, s.home_goals) AS hg, coalesce(f.away_goals, m.away_goals, s.away_goals) AS ag,
            m.home_xg AS hxg, m.away_xg AS axg, m.home_shots AS hs, m.away_shots AS as_, m.home_sot AS hsot, m.away_sot AS asot,
            m.home_reds AS hr, m.away_reds AS ar, m.home_possession AS hpos
       FROM pick p
       LEFT JOIN fixture f ON f.id = p.fixture_id
       LEFT JOIN match m ON m.id = p.fixture_id
       LEFT JOIN market_snapshot s ON s.fixture_id = p.fixture_id
       LEFT JOIN schedule sh ON sh.id = p.fixture_id
       LEFT JOIN team th ON th.id = m.home_team_id
       LEFT JOIN team ta ON ta.id = m.away_team_id
       LEFT JOIN league l ON l.id = coalesce(f.league_id, m.league_id, s.league_id)
      WHERE p.result IS NOT NULL
      ORDER BY p.kickoff`,
  );
  const settled = rows.filter((r) => r.result === 'WON' || r.result === 'LOST');
  console.log(`lab:losses: ${rows.length} settled calls, ${settled.length} won or lost, ${settled.filter((r) => r.result === 'LOST').length} lost`);

  // Every call, one line each, so the losses can be read against the wins.
  console.log('\nALL: id|date|kind|comp(rank)|home v away|score|xg|shots(sot)|reds|market outcome line|odds open>close|model book|result|top drivers');
  for (const r of rows) {
    let drivers: Array<{ id: string; strength: number }> = [];
    try { drivers = (JSON.parse(r.evidence_json ?? '{}').drivers ?? []) as typeof drivers; } catch { /* old row */ }
    const top = drivers.slice().sort((a, b) => Math.abs(b.strength) - Math.abs(a.strength)).slice(0, 4).map((d) => `${d.id}:${d.strength}`).join(',');
    console.log([
      r.id,
      new Date(Number(r.kickoff) * 1000).toISOString().slice(0, 16),
      r.kind,
      `${r.league ?? r.league_id}(${r.rank ?? '-'})`,
      `${r.home ?? '?'} v ${r.away ?? '?'}`,
      `${r.hg ?? '?'}-${r.ag ?? '?'}`,
      `${f2(r.hxg)}-${f2(r.axg)}`,
      `${r.hs ?? '-'}(${r.hsot ?? '-'})-${r.as_ ?? '-'}(${r.asot ?? '-'})`,
      `${r.hr ?? '-'}/${r.ar ?? '-'}`,
      `${r.market} ${r.outcome} ${r.line ?? ''}`.trim(),
      `${f2(r.odds)} ${f2(r.opening_odds)}>${f2(r.closing_odds)}`,
      `${f2(r.model_prob)} ${f2(r.book_prob)}`,
      r.result,
      top,
    ].join('|'));
  }

  // The fixture table keeps a week, so older calls have lost their team names;
  // the provider still has the event.
  const { bsdOrNull } = await import('../bsd.ts');
  console.log('\nNAMES: pick|fixture|home|away|competition|round|date');
  for (const r of rows.filter((x) => x.kind === 'CONFIDENT' && x.result === 'LOST' && !x.home)) {
    const e = await bsdOrNull<Record<string, unknown>>(`/api/v2/events/${r.fixture_id}/`).catch(() => null);
    if (!e) { console.log(`${r.id}|${r.fixture_id}|?|?|${r.league ?? ''}||`); continue; }
    r.home = String(e['home_team'] ?? '?');
    r.away = String(e['away_team'] ?? '?');
    console.log([r.id, r.fixture_id, r.home, r.away, String(e['league_name'] ?? r.league ?? ''), String(e['round_label'] ?? ''),
      new Date(Number(r.kickoff) * 1000).toISOString().slice(0, 16)].join('|'));
  }

  // The argument behind each loss.
  console.log('\nLOSSES IN DETAIL');
  for (const r of rows.filter((x) => x.result === 'LOST')) {
    let ev: { drivers?: Array<Record<string, any>>; set_aside?: Array<Record<string, any>>; expected?: { home: number; away: number } } = {};
    try { ev = JSON.parse(r.evidence_json ?? '{}'); } catch { /* old row */ }
    console.log(`\n# ${r.id} ${r.home ?? '?'} v ${r.away ?? '?'} ${r.hg ?? '?'}-${r.ag ?? '?'} (${r.league ?? r.league_id}) ${r.market} ${r.outcome} ${r.line ?? ''} at ${f2(r.odds)}; expected ${ev.expected ? `${ev.expected.home}-${ev.expected.away}` : '-'}`);
    for (const d of (ev.drivers ?? []).slice(0, 8)) {
      const moves = (d['moves'] ?? []).map((m: any) => `${m.channel}/${m.side}${m.pct > 0 ? '+' : ''}${m.pct}%`).join(' ');
      console.log(`  + ${d['id']} ${d['state'] ?? ''} s=${d['strength']} ${moves} :: ${String(d['note'] ?? '').replace(/\s+/g, ' ').slice(0, 220)}`);
    }
    for (const d of (ev.set_aside ?? []).slice(0, 5)) {
      console.log(`  - ${d['id']} s=${d['strength']} :: ${String(d['note'] ?? '').replace(/\s+/g, ' ').slice(0, 160)}`);
    }
  }
}
