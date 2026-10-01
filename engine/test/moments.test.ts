import { test } from 'node:test';
import assert from 'node:assert/strict';

/**
 * The big moments (public/js/lib/moments.js), the shared rules on how often
 * anything may interrupt a reader (attention.js), and the offer's one second
 * showing (promo.js).
 */
// @ts-expect-error plain ES module from the site
const { findMoment, wordsFor } = await import('../../public/js/lib/moments.js');
// @ts-expect-error plain ES module from the site
const { mayInterrupt, noteInterruption, GAP } = await import('../../public/js/lib/attention.js');
// @ts-expect-error plain ES module from the site
const { lastCallDue } = await import('../../public/js/lib/promo.js');
const { findBannedInProse } = await import('../src/vocabulary.ts');

const NOW = Date.UTC(2026, 9, 10, 9) / 1000; // a Saturday morning
const H = 3600;
const D = 86400;
let id = 1;
const fx = (home: string, away: string, league_id: number, hoursAhead: number, extra: Record<string, unknown> = {}) =>
  ({ id: id++, home, away, league_id, league: `L${league_id}`, home_id: 1, away_id: 2, kickoff: NOW + hoursAhead * H, status: 'notstarted', ...extra });
const pl = (n: number, from = 3) => Array.from({ length: n }, (_, i) => fx(`Home ${i}`, `Away ${i}`, 1, from + i * 2));
const asked: number[] = [];
const lastPlayedAgo = (days: number) => async (league: number) => { asked.push(league); return NOW - days * D; };

/* -------------------------------------------------------------- moments */

test('El Clásico within the day is the moment, with its colours and its call', async () => {
  const m = await findMoment({
    now: NOW,
    fixtures: [...pl(6), fx('Real Madrid', 'FC Barcelona', 3, 20, { colors: { home: '#ffffff', away: '#a50044' }, locked: true })],
    lastPlayed: lastPlayedAgo(19),
  });
  assert.equal(m.kind, 'derby');
  assert.equal(m.kicker, 'El Clásico');
  assert.deepEqual(m.fixture.colors, { home: '#ffffff', away: '#a50044' });
  assert.equal(m.fixture.call, 'members');
  assert.match(m.key, /^n:\d+$/);
});

test('a named fixture more than a day away is not a moment yet', async () => {
  assert.equal(await findMoment({ now: NOW, fixtures: [fx('Manchester City', 'Manchester United', 1, 40)] }), null);
});

test('the bigger of two named fixtures on the same day leads', async () => {
  const m = await findMoment({ now: NOW, fixtures: [fx('Sevilla', 'Real Betis', 3, 5), fx('Liverpool', 'Everton', 1, 8)] });
  assert.equal(m.kicker, 'The Merseyside derby');
});

test('a colour that is not a plain hex never reaches a style attribute', async () => {
  const m = await findMoment({ now: NOW, fixtures: [fx('Celtic', 'Rangers', 9, 5, { colors: { home: 'red;background:url(x)', away: '#00ff00' } })] });
  assert.deepEqual(m.fixture.colors, { home: null, away: '#00ff00' });
});

test('the Premier League after a break is back; after a normal week it is not', async () => {
  const back = await findMoment({ now: NOW, fixtures: pl(10), lastPlayed: lastPlayedAgo(19) });
  assert.equal(back.kind, 'return');
  assert.equal(back.name, 'the Premier League');
  assert.equal(back.count, 10);
  assert.equal(back.games.length, 5);
  assert.equal(await findMoment({ now: NOW, fixtures: pl(10), lastPlayed: lastPlayedAgo(6) }), null);
});

test('a league is only asked about when it is on the board in the next two days', async () => {
  asked.length = 0;
  await findMoment({ now: NOW, fixtures: [fx('A', 'B', 3, 60), fx('C', 'D', 99, 2)], lastPlayed: lastPlayedAgo(19) });
  assert.deepEqual(asked, []);
});

test('a Champions League night needs two games or more today', async () => {
  const today = (h: number) => fx('X', 'Y', 7, h);
  const m = await findMoment({ now: NOW, fixtures: [today(9), today(10), today(11)] });
  assert.equal(m.kind, 'ucl');
  assert.equal(m.count, 3);
  assert.equal(await findMoment({ now: NOW, fixtures: [today(9)] }), null);
});

test('a derby outranks a return, which outranks a Champions League night', async () => {
  const both = [...pl(6), fx('Arsenal', 'Tottenham Hotspur', 1, 6), fx('X', 'Y', 7, 9), fx('X', 'Y', 7, 10)];
  assert.equal((await findMoment({ now: NOW, fixtures: both, lastPlayed: lastPlayedAgo(19) })).kind, 'derby');
  const noDerby = both.filter((f) => f.home !== 'Arsenal');
  assert.equal((await findMoment({ now: NOW, fixtures: noDerby, lastPlayed: lastPlayedAgo(19) })).kind, 'return');
});

test('finished and postponed games are not moments', async () => {
  const m = await findMoment({ now: NOW, fixtures: [fx('Real Madrid', 'Barcelona', 3, 5, { status: 'postponed' })] });
  assert.equal(m, null);
});

test('every card is in the house voice: no banned words, no middle dots, no shouting', async () => {
  const cards = [
    await findMoment({ now: NOW, fixtures: [fx('Real Madrid', 'FC Barcelona', 3, 20, { top_pick: { x: 1 } })] }),
    await findMoment({ now: NOW, fixtures: [fx('Real Madrid', 'FC Barcelona', 3, 20)] }),
    await findMoment({ now: NOW, fixtures: pl(10), lastPlayed: lastPlayedAgo(19) }),
    await findMoment({ now: NOW, fixtures: [fx('X', 'Y', 7, 9), fx('X', 'Y', 7, 10)] }),
  ];
  for (const m of cards) {
    const w = wordsFor(m);
    const text = [w.title, w.lead, w.line, w.cta.label].filter(Boolean).join(' ');
    assert.deepEqual(findBannedInProse(text), [], text);
    assert.doesNotMatch(text, /·|undefined|NaN/, text);
    assert.doesNotMatch(text, /\b[A-Z]{4,}\b/, text);
  }
});

/* ------------------------------------------------------------ attention */

function store() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
}
const T = Date.UTC(2026, 9, 10, 9);

test('one card a visit: nothing else for half an hour after one opens', () => {
  const s = store();
  assert.equal(mayInterrupt('moment', { now: T, store: s }), true);
  noteInterruption('moment', { now: T, store: s });
  assert.equal(mayInterrupt('season', { now: T + 10 * 60e3, store: s }), false);
  assert.equal(mayInterrupt('season', { now: T + GAP.season, store: s }), true);
});

test('the offer waits twelve quiet hours after any card', () => {
  const s = store();
  noteInterruption('season', { now: T, store: s });
  assert.equal(mayInterrupt('offer', { now: T + 2 * 3600e3, store: s }), false);
  assert.equal(mayInterrupt('offer', { now: T + 12 * 3600e3, store: s }), true);
});

test('never more than two cards a day', () => {
  const s = store();
  noteInterruption('moment', { now: T, store: s });
  noteInterruption('season', { now: T + 3600e3, store: s });
  assert.equal(mayInterrupt('moment', { now: T + 5 * 3600e3, store: s }), false);
  assert.equal(mayInterrupt('moment', { now: T + 24 * 3600e3 + 1, store: s }), true);
});

test('with no storage, football may speak and offers may not', () => {
  assert.equal(mayInterrupt('moment', { now: T, store: null }), true);
  assert.equal(mayInterrupt('offer', { now: T, store: null }), false);
});

/* ------------------------------------------------- the offer's last call */

test('an offer asks once more on its last day, only of a reader who scrolled past it', () => {
  const now = 1_800_000_000;
  const p = { id: 'd1', ends_at: now + 6 * 3600 };
  assert.equal(lastCallDue(p, { seen: ['d1'], soft: ['d1'] }, now), true);
  assert.equal(lastCallDue(p, { seen: ['d1'], soft: ['d1'], dismissed: ['d1'] }, now), false, 'said no');
  assert.equal(lastCallDue(p, { seen: ['d1'], soft: ['d1'], closed: ['d1'] }, now), false, 'closed the bar');
  assert.equal(lastCallDue(p, { seen: ['d1'], soft: ['d1'], lastcall: ['d1'] }, now), false, 'had it already');
  assert.equal(lastCallDue({ ...p, ends_at: now + 3 * 86400 }, { seen: ['d1'], soft: ['d1'] }, now), false, 'not the last day');
  assert.equal(lastCallDue(p, { seen: ['d1'] }, now), false, 'never scrolled past it');
});
