import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chooseTrap, trapFor, type TrapInput } from '../src/trap.ts';
import { findBannedInProse } from '../src/vocabulary.ts';
import type { BookMarket, Factor, ModelMarket, Outcome } from '../src/types.ts';

/*
 * The trap is a free warning on the front page, so the cases that matter are
 * the ones where it must stay quiet: a favourite we agree with, and any match
 * where it would give a members' call away.
 */

const book = (h: number, d: number, a: number, extra: Partial<BookMarket> = {}): BookMarket => ({
  market: '1x2', line: null,
  fair: new Map<Outcome, number>([['HOME', h], ['DRAW', d], ['AWAY', a]]),
  best: new Map(), quotes: new Map(), overround: 1.05, method: 'shin', movement: new Map(),
  ...extra,
});
const model = (h: number, d: number, a: number): ModelMarket => ({
  market: '1x2', line: null, confidence: 0.6, probs: new Map<Outcome, number>([['HOME', h], ['DRAW', d], ['AWAY', a]]),
});
const factor = (note: string, side: 'home' | 'away', multiplier: number, strength = 0.5): Factor => ({
  id: `t.${note.length}`, section: '§0', tier: 1 as Factor['tier'], state: 'COMPUTED' as Factor['state'], note, evidence: {},
  adjustments: [{ channel: 'goals', side, multiplier }], claims: [], strength,
});

const base = (over: Partial<TrapInput> = {}): TrapInput => ({
  fixture_id: 1, kickoff: 2_000_000_000, league: 'Premier League', league_id: 1, rank: 2,
  home: 'Arsenal', away: 'Brentford', home_id: 10, away_id: 20,
  book: [book(0.68, 0.19, 0.13)], model: [model(0.58, 0.24, 0.18)],
  factors: [factor('Saka is out, and he has had a hand in most of their goals.', 'home', 0.9)],
  changes: null, calls: [],
  ...over,
});

test('a big favourite we rate well below the bookies is a trap, with reasons', () => {
  const t = trapFor(base());
  assert.ok(t);
  assert.equal(t.side, 'home');
  assert.equal(t.team, 'Arsenal');
  assert.equal(t.against, 'Brentford');
  assert.deepEqual(t.reasons, ['Saka is out, and he has had a hand in most of their goals.']);
});

test('a favourite we agree with is not', () => {
  assert.equal(trapFor(base({ model: [model(0.67, 0.2, 0.13)] })), null);
});

test('a match without a clear favourite is not', () => {
  assert.equal(trapFor(base({ book: [book(0.5, 0.27, 0.23)] })), null);
});

test('a members’ call on the result keeps it off the front page', () => {
  assert.equal(trapFor(base({ calls: [{ market: 'double_chance', outcome: 'X2' }] })), null);
  assert.equal(trapFor(base({ calls: [{ market: '1x2', outcome: 'HOME' }] })), null);
  // A goals call says nothing about the favourite.
  assert.ok(trapFor(base({ calls: [{ market: 'over_under_25', outcome: 'over' }] })));
});

test('no reason we can say out loud, no trap', () => {
  assert.equal(trapFor(base({ factors: [factor('They take 1.78 points a game on the road.', 'home', 0.9)] })), null);
  assert.equal(trapFor(base({ factors: [] })), null);
});

test('only factors that pull against the favourite count', () => {
  const t = trapFor(base({ factors: [
    factor('Arsenal are flying.', 'home', 1.1, 0.9),
    factor('Brentford have scored in every away game.', 'away', 1.1, 0.4),
    factor('Saka is out.', 'home', 0.9, 0.6),
  ] }));
  assert.deepEqual(t?.reasons, ['Saka is out.', 'Brentford have scored in every away game.']);
});

test('a rotated side is a trap on the sheet alone, and the names are said', () => {
  const t = trapFor(base({
    model: [model(0.67, 0.2, 0.13)], factors: [],
    changes: { home: { n: 5, out: ['Saka', 'Ødegaard', 'Rice', 'Saliba', 'White'], in: [] }, away: null },
  }));
  assert.ok(t);
  assert.equal(t.reasons[0], 'Arsenal have made five changes from the side everyone expected. Saka, Ødegaard and Rice don’t start.');
});

test('the away favourite', () => {
  const t = trapFor(base({ book: [book(0.14, 0.2, 0.66)], model: [model(0.2, 0.25, 0.55)],
    factors: [factor('City have lost three of their last four away.', 'away', 0.92)] }));
  assert.equal(t?.side, 'away');
  assert.equal(t?.team, 'Brentford');
});

test('a drifting price is said without a number', () => {
  const b = book(0.66, 0.2, 0.14, { movement: new Map([['HOME', { opening: 1.4, current: 1.55, dir: 'DRIFTING' as const }]]) });
  const t = trapFor(base({ book: [b], model: [model(0.64, 0.21, 0.15)], factors: [] }));
  assert.ok(t);
  assert.equal(t.reasons[0], 'The bookies have been pushing Arsenal out since the first prices went up.');
});

test('every reason the trap writes itself passes the vocabulary gate', () => {
  const b = book(0.66, 0.2, 0.14, { movement: new Map([['HOME', { opening: 1.4, current: 1.55, dir: 'DRIFTING' as const }]]) });
  const t = trapFor(base({ book: [b], changes: { home: { n: 4, out: ['Saka'], in: [] }, away: null } }));
  assert.ok(t);
  for (const r of t.reasons) assert.deepEqual(findBannedInProse(r), [], r);
  assert.ok(t.reasons.length <= 3);
});

test('choosing: in the window, the strongest, and the one already up holds', () => {
  const now = 1_000_000;
  const mk = (id: number, kickoff: number, score: number) => ({ ...trapFor(base())!, fixture_id: id, kickoff, score });
  const ts = [mk(1, now + 3600, 2), mk(2, now + 7200, 3), mk(3, now + 50 * 3600, 9), mk(4, now - 60, 9)];
  assert.equal(chooseTrap(ts, now)?.fixture_id, 2);
  // Held: not clearly beaten.
  assert.equal(chooseTrap(ts, now, 1)?.fixture_id, 1);
  // Beaten clearly.
  assert.equal(chooseTrap([mk(1, now + 3600, 1), mk(2, now + 7200, 3)], now, 1)?.fixture_id, 2);
  assert.equal(chooseTrap([], now), null);
});
