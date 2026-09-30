/**
 * `npm run lab:live`: does the lab replay what the engine actually did?
 *
 * The lab says the production rule lands about 82% at +6% a call; the live
 * record says about 82% at -5%. Everything tuned in the lab is only as good
 * as its replay of the live engine, so this lines the two up fixture by
 * fixture over the period the live engine has run the production rule
 * (consensus source, from 27 September 2026 17:18 UTC): which calls both
 * made, which only one made and why, and at what price each was graded.
 *
 * Read-only. Prints ids, markets, prices and results; every fixture here has
 * finished.
 */

import { select } from '../store.ts';
import { chooseDay, grade, optionsFor, probOf, type HistRow, type Option } from './markets.ts';
import { PROD } from './tune.ts';

const SWITCH = 1790529496;
const dayOf = (t: number) => Math.floor((t + 3600) / 86400);
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const key = (m: string, o: string, l: number | null) => `${m}|${o}|${l ?? ''}`;

interface LivePick {
  fixture_id: number; kickoff: number; market: string; outcome: string; line: number | null;
  odds: number; opening_odds: number | null; model_prob: number; book_prob: number; result: string; created_at: number;
}

export async function runLive(rows: HistRow[]): Promise<void> {
  const live = await select<LivePick>(
    `SELECT fixture_id, kickoff, market, outcome, line, odds, opening_odds, model_prob, book_prob, result, created_at
       FROM pick WHERE kind = 'CONFIDENT' AND settled_at IS NOT NULL AND kickoff >= ? AND result IN ('WON', 'LOST', 'PUSH', 'HALF_WON', 'HALF_LOST', 'VOID')`,
    [SWITCH],
  );
  const period = rows.filter((r) => r.kickoff >= SWITCH);
  const byId = new Map(period.map((r) => [r.id, r]));
  const cache = new Map(period.map((r) => [r.id, optionsFor(r, PROD.modelWeight)] as [number, Option[]]));

  // The lab's choices, day by day as simulate makes them.
  const days = new Map<number, HistRow[]>();
  for (const r of period) days.set(dayOf(r.kickoff), [...(days.get(dayOf(r.kickoff)) ?? []), r]);
  const lab = new Map<number, { o: Option; p: number }>();
  for (const rs of days.values()) for (const pk of chooseDay(PROD, rs, cache)) lab.set(pk.row.id, { o: pk.option, p: pk.p });

  const liveBy = new Map<number, LivePick>();
  for (const p of live) if (!liveBy.has(Number(p.fixture_id))) liveBy.set(Number(p.fixture_id), p);

  console.log(`lab:live: ${period.length} finished fixtures since the switch in the lab's history; ${liveBy.size} with a live call; ${lab.size} the lab would call`);
  const missingRow = [...liveBy.keys()].filter((id) => !byId.has(id));
  console.log(`  live calls whose fixture the lab has no snapshot of: ${missingRow.length}`);

  const tally = (label: string, xs: Array<{ won: boolean | null; odds: number }>) => {
    const g = xs.filter((x) => x.won !== null);
    const w = g.filter((x) => x.won).length;
    const pnl = g.reduce((s, x) => s + (x.won ? x.odds - 1 : -1), 0);
    const odds = g.reduce((s, x) => s + x.odds, 0) / (g.length || 1);
    console.log(`  ${label.padEnd(46)} ${String(g.length).padStart(4)} calls  ${pct(g.length ? w / g.length : 0).padStart(6)} landed  odds ${odds.toFixed(2)}  return ${pct(g.length ? pnl / g.length : 0).padStart(7)}`);
  };
  const liveWon = (p: LivePick) => (p.result === 'WON' ? true : p.result === 'LOST' ? false : null);
  const labWon = (id: number, o: Option) => {
    const g = grade(byId.get(id)!, o);
    return g?.result === 'WON' ? true : g?.result === 'LOST' ? false : null;
  };

  console.log('\nThe same period, both ways:');
  tally('live, as published and graded', [...liveBy.values()].map((p) => ({ won: liveWon(p), odds: Number(p.odds) })));
  tally('lab, the production rule replayed', [...lab].map(([id, x]) => ({ won: labWon(id, x.o), odds: x.o.odds })));

  const both = [...liveBy.keys()].filter((id) => lab.has(id));
  const same = both.filter((id) => { const p = liveBy.get(id)!; const o = lab.get(id)!.o; return key(p.market, String(p.outcome), p.line) === key(o.market, String(o.outcome), o.line); });
  const onlyLive = [...liveBy.keys()].filter((id) => byId.has(id) && !lab.has(id));
  const onlyLab = [...lab.keys()].filter((id) => !liveBy.has(id));
  console.log(`\nAgreement: ${same.length} same call, ${both.length - same.length} different call on the same fixture, ${onlyLive.length} live only, ${onlyLab.length} lab only`);

  // Same call: is the price the lab grades at the price the live engine got?
  const diffs = same.map((id) => { const p = liveBy.get(id)!; return lab.get(id)!.o.odds - Number(p.odds); });
  if (diffs.length) {
    const mean = diffs.reduce((a, b) => a + b, 0) / diffs.length;
    console.log(`  same call: lab's price minus live's, mean ${mean.toFixed(3)}; lab higher on ${diffs.filter((d) => d > 0.005).length}, lower on ${diffs.filter((d) => d < -0.005).length}, equal on ${diffs.filter((d) => Math.abs(d) <= 0.005).length}`);
  }
  tally('same call, live price', same.map((id) => ({ won: liveWon(liveBy.get(id)!), odds: Number(liveBy.get(id)!.odds) })));
  tally('same call, lab price', same.map((id) => ({ won: labWon(id, lab.get(id)!.o), odds: lab.get(id)!.o.odds })));
  tally('live only (lab would not call)', onlyLive.map((id) => ({ won: liveWon(liveBy.get(id)!), odds: Number(liveBy.get(id)!.odds) })));
  tally('lab only (live did not call)', onlyLab.map((id) => ({ won: labWon(id, lab.get(id)!.o), odds: lab.get(id)!.o.odds })));
  tally('different call, live', both.filter((id) => !same.includes(id)).map((id) => ({ won: liveWon(liveBy.get(id)!), odds: Number(liveBy.get(id)!.odds) })));
  tally('different call, lab', both.filter((id) => !same.includes(id)).map((id) => ({ won: labWon(id, lab.get(id)!.o), odds: lab.get(id)!.o.odds })));

  // Why the live-only calls were not the lab's: the live option as the lab sees it.
  console.log('\nLive only, as the lab sees the same option (lab prob / lab price / live prob / live price / result):');
  for (const id of onlyLive.slice(0, 40)) {
    const p = liveBy.get(id)!;
    const o = cache.get(id)!.find((x) => key(x.market, String(x.outcome), x.line) === key(p.market, String(p.outcome), p.line));
    const lp = o ? probOf(PROD, o) : null;
    console.log(`  ${id} rank ${byId.get(id)!.rank} ${p.market} ${p.outcome} ${p.line ?? ''}: ${lp === null ? 'no prob' : lp.toFixed(3)} / ${o ? o.odds.toFixed(2) : 'not in snapshot'} / ${Number(p.model_prob).toFixed(3)} / ${Number(p.odds).toFixed(2)} / ${p.result}`
      + (o ? `  sharp ${o.sharp?.toFixed(3) ?? '-'} open ${o.open?.toFixed(3) ?? '-'} book ${o.book.toFixed(3)}` : ''));
  }
  console.log('\nDifferent call on the same fixture (live | lab):');
  for (const id of both.filter((x) => !same.includes(x)).slice(0, 30)) {
    const p = liveBy.get(id)!; const o = lab.get(id)!;
    console.log(`  ${id} ${p.market} ${p.outcome} ${p.line ?? ''} ${Number(p.odds).toFixed(2)} ${p.result} | ${o.o.market} ${o.o.outcome} ${o.o.line ?? ''} ${o.o.odds.toFixed(2)} p ${o.p.toFixed(3)} ${labWon(id, o.o) ? 'WON' : 'LOST'}`);
  }
}
