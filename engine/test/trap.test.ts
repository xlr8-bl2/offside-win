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

const ev = (id: string, evidence: Record<string, unknown>, note = ''): Factor => ({
  id, section: '§0', tier: 1 as Factor['tier'], state: 'COMPUTED' as Factor['state'], note, evidence,
  adjustments: [], claims: [], strength: 0.5,
});
const absences = (side: 'home' | 'away', note: string) => ev(`availability.${side}.absences`, { count: 2 }, note);
const form = (side: 'home' | 'away', sequence: string) => ev(`form.${side}`, { sequence });
const bounce = (side: 'home' | 'away', games: number) =>
  ev(`manager.${side}.bounce`, { matches_in_charge: games }, `X is ${games} games into the job. The new-manager bounce window is live but reverts by around game six.`);

const base = (over: Partial<TrapInput> = {}): TrapInput => ({
  fixture_id: 1, kickoff: 2_000_000_000, league: 'Premier League', league_id: 1, rank: 2,
  home: 'Arsenal', away: 'Brentford', home_id: 10, away_id: 20,
  book: [book(0.68, 0.19, 0.13)], model: [model(0.58, 0.24, 0.18)],
  factors: [absences('home', 'Arsenal are without 2 players, and Saka is a real loss.'), form('home', 'WDLDWL')],
  changes: null, calls: [],
  ...over,
});

test('a big favourite we rate well below the bookies is a trap, with reasons in our words', () => {
  const t = trapFor(base());
  assert.ok(t);
  assert.equal(t.side, 'home');
  assert.equal(t.team, 'Arsenal');
  assert.equal(t.against, 'Brentford');
  assert.deepEqual(t.reasons, ['Arsenal are without Saka.', 'Arsenal have won two of their last six.']);
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

test('Brazil away at India in a friendly: not a trap', () => {
  // The first live trap. A friendly, and the model a class below the bookies
  // on Brazil because it has no real read on either side.
  const friendly = base({ league: 'International Friendly Games', league_id: 31, rank: 9,
    home: 'India', away: 'Brazil', book: [book(0.08, 0.12, 0.8)], model: [model(0.3, 0.3, 0.4)],
    factors: [bounce('home', 5), absences('away', 'Brazil are without 1 player, none of them central to how the side plays.'), form('away', 'WWLDLL')] });
  assert.equal(trapFor(friendly), null);
  // Not in a league either, with a gap that wide.
  assert.equal(trapFor({ ...friendly, rank: 2 }), null);
});

test('the engine’s own prose never reaches the reasons', () => {
  const t = trapFor(base({ factors: [
    absences('home', 'Arsenal are without 1 player, none of them central to how the side plays.'),
    bounce('away', 3), form('home', 'WWLLDL'),
  ] }));
  assert.ok(t);
  assert.deepEqual(t.reasons, ['Arsenal have won two of their last six.', 'Brentford have a new manager, three games in, and sides usually lift for one.']);
  for (const r of t.reasons) assert.doesNotMatch(r, /window|reverts|central to how/);
});

test('form that cuts against them, either way round', () => {
  const t = trapFor(base({ factors: [form('home', 'WWWDLL'), form('away', 'LWDWWD')] }));
  assert.deepEqual(t?.reasons, ['Arsenal have lost their last two.', 'Brentford are unbeaten in five.']);
  // Good form for the favourite is no reason at all.
  assert.equal(trapFor(base({ factors: [form('home', 'WWWWDW')] })), null);
});

test('one thin reason is not enough', () => {
  assert.equal(trapFor(base({ factors: [form('home', 'WDLDWL')] })), null);
  assert.equal(trapFor(base({ factors: [] })), null);
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
    factors: [absences('away', 'Brentford are without 3 players, and Mbeumo and Wissa are real losses.'), form('away', 'LLWDWL')] }));
  assert.equal(t?.side, 'away');
  assert.equal(t?.team, 'Brentford');
  assert.deepEqual(t?.reasons, ['Brentford are without Mbeumo and Wissa.', 'Brentford have won two of their last six.']);
});

test('a drifting price is said without a number', () => {
  const b = book(0.66, 0.2, 0.14, { movement: new Map([['HOME', { opening: 1.4, current: 1.55, dir: 'DRIFTING' as const }]]) });
  const t = trapFor(base({ book: [b], model: [model(0.64, 0.21, 0.15)] }));
  assert.ok(t);
  assert.equal(t.reasons[0], 'The bookies have been pushing Arsenal out since the first prices went up.');
});

test('every reason the trap writes passes the vocabulary gate', () => {
  const b = book(0.66, 0.2, 0.14, { movement: new Map([['HOME', { opening: 1.4, current: 1.55, dir: 'DRIFTING' as const }]]) });
  const t = trapFor(base({ book: [b], changes: { home: { n: 4, out: ['Saka'], in: [] }, away: null },
    factors: [absences('home', 'Arsenal are without 2 players, and Saka is a real loss.'), form('home', 'WLLDLL'), form('away', 'WWDWWW'), bounce('away', 2)] }));
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
