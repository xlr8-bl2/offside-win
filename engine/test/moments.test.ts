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
  ({ id: id++, home, away, league_id, league: `L${league_id}`, home_id: 1, away_id: 2, kickoff: NOW + hoursAhead * H, status: 'notstarted', top_pick: { x: 1 }, ...extra });
const NO_CALL = { top_pick: null };
const pl = (n: number, from = 3) => Array.from({ length: n }, (_, i) => fx(`Home ${i}`, `Away ${i}`, 1, from + i * 2));
const asked: number[] = [];
/* A league's page data as /api/league/{id} sends it: the table, the last
   round's results, the scorers. */
const row = (team: string, team_id: number, position: number, played: number, won: number, drawn: number, points: number) =>
  ({ team, team_id, position, played, won, drawn, lost: played - won - drawn, points });
const TABLE = [
  row('Manchester City', 12, 1, 5, 5, 0, 15), row('Liverpool', 13, 2, 5, 4, 0, 12), row('Arsenal', 18, 3, 5, 3, 1, 10),
  row('Chelsea', 14, 4, 5, 3, 0, 9), row('Wolves', 20, 20, 5, 0, 2, 2),
];
const leagueAgo = (days: number) => async (league: number) => {
  asked.push(league);
  return {
    standings: TABLE,
    last: [{ home: 'Fulham', away: 'Arsenal', home_id: 6, away_id: 18, kickoff: NOW - days * D, score: [1, 3] },
      { home: 'Liverpool', away: 'Wolves', home_id: 13, away_id: 20, kickoff: NOW - days * D, score: [0, 0] }],
    scorers: [{ name: 'Erling Haaland', goals: 5 }],
  };
};
const lastPlayedAgo = leagueAgo;

/* -------------------------------------------------------------- moments */

test('El Clásico within the day is the moment, with its colours and its call', async () => {
  const m = await findMoment({
    now: NOW,
    fixtures: [...pl(6), fx('Real Madrid', 'FC Barcelona', 3, 20, { colors: { home: '#ffffff', away: '#a50044' }, locked: true, ...NO_CALL })],
    league: lastPlayedAgo(19),
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
  const back = await findMoment({ now: NOW, fixtures: pl(10), league: lastPlayedAgo(19) });
  assert.equal(back.kind, 'return');
  assert.equal(back.name, 'the Premier League');
  assert.equal(back.count, 10);
  assert.equal(back.games.length, 4);
  assert.equal(await findMoment({ now: NOW, fixtures: pl(10), league: lastPlayedAgo(6) }), null);
});

test('a league is only asked about when it is on the board in the next two days', async () => {
  asked.length = 0;
  await findMoment({ now: NOW, fixtures: [fx('A', 'B', 3, 60), fx('C', 'D', 99, 2)], league: lastPlayedAgo(19) });
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
  assert.equal((await findMoment({ now: NOW, fixtures: both, league: lastPlayedAgo(19) })).kind, 'derby');
  const noDerby = both.filter((f) => f.home !== 'Arsenal');
  assert.equal((await findMoment({ now: NOW, fixtures: noDerby, league: lastPlayedAgo(19) })).kind, 'return');
});

test('finished and postponed games are not moments', async () => {
  const m = await findMoment({ now: NOW, fixtures: [fx('Real Madrid', 'Barcelona', 3, 5, { status: 'postponed' })] });
  assert.equal(m, null);
});

test('every card is in the house voice: no banned words, no middle dots, no shouting', async () => {
  const cards = [
    await findMoment({ now: NOW, fixtures: [fx('Real Madrid', 'FC Barcelona', 3, 20, { top_pick: { x: 1 } })] }),
    await findMoment({ now: NOW, fixtures: [fx('Real Madrid', 'FC Barcelona', 3, 20)] }),
    await findMoment({ now: NOW, fixtures: pl(10), league: lastPlayedAgo(19) }),
    await findMoment({ now: NOW, fixtures: [fx('X', 'Y', 7, 9), fx('X', 'Y', 7, 10)] }),
  ];
  for (const m of cards) {
    const w = wordsFor(m);
    const text = [w.shout, w.title, w.lead, w.line, w.calls, ...(w.takes ?? []), w.cta.label].filter(Boolean).join(' ');
    assert.deepEqual(findBannedInProse(text), [], text);
    assert.doesNotMatch(text, /·|undefined|NaN/, text);
    assert.doesNotMatch(text, /\b[A-Z]{4,}\b/, text);
  }
});

test('the league card talks football: who is top, the pick of the weekend, who is scoring', async () => {
  const m = await findMoment({
    now: NOW,
    fixtures: [fx('Liverpool', 'Chelsea', 1, 20, { home_id: 13, away_id: 14 }), fx('Arsenal', 'Leeds United', 1, 22, { home_id: 18, away_id: 19 })],
    league: leagueAgo(19),
  });
  const w = wordsFor(m);
  assert.equal(w.shout, 'Let’s gooo.');
  assert.match(w.lead, /^Nineteen days of international football/);
  assert.equal(w.takes[0], 'Manchester City top, five from five. Nobody’s laid a glove on them.');
  assert.equal(w.takes[1], 'Pick of the weekend: Liverpool v Chelsea, 2nd against 4th.');
  assert.match(w.takes[2], /Erling Haaland’s got five already/);
});

test('the derby card says where they stand and how they got on last time', async () => {
  const m = await findMoment({ now: NOW, fixtures: [fx('Liverpool', 'Arsenal', 1, 6, { home_id: 13, away_id: 18 })], league: leagueAgo(6) });
  assert.equal(m, null, 'Liverpool v Arsenal is not a named fixture');
  const d = await findMoment({ now: NOW, fixtures: [fx('Arsenal', 'Tottenham Hotspur', 1, 6, { home_id: 18, away_id: 99 })], league: leagueAgo(6) });
  const w = wordsFor(d);
  assert.equal(w.shout, 'Matchday. Let’s gooo.');
  assert.ok(w.takes.some((t: string) => t === 'Arsenal won 3–1 at Fulham last time out.'), w.takes.join(' | '));
});

test('one comeback card a weekend, whichever big league is back first', async () => {
  const pl1 = await findMoment({ now: NOW, fixtures: pl(4), league: leagueAgo(19) });
  const liga = await findMoment({ now: NOW, fixtures: Array.from({ length: 4 }, (_, i) => fx(`H${i}`, `A${i}`, 3, 3 + i)), league: leagueAgo(19) });
  assert.equal(pl1.key, liga.key, 'the same weekend shares one key, so it is shown once');
});

test('women’s and youth competitions are not hyped as the men’s game', async () => {
  const liga = fx('Fútbol Club Barcelona', 'Real Madrid', 140, 10, { league: 'Liga F' });
  assert.equal(await findMoment({ now: NOW, fixtures: [liga] }), null);
  assert.equal(await findMoment({ now: NOW, fixtures: [fx('Real Madrid', 'RCD Espanyol de Barcelona', 3, 10)] }), null, 'not El Clásico');
});

test('calls first: a derby waits for our call', async () => {
  const pending = fx('Manchester City', 'Manchester United', 1, 10, NO_CALL);
  assert.equal(await findMoment({ now: NOW, fixtures: [pending] }), null, 'not looked at yet: wait');
  const passed = (h: number) => fx('Manchester City', 'Manchester United', 1, h, { ...NO_CALL, pass: 'Nothing to take on it.' });
  assert.equal(await findMoment({ now: NOW, fixtures: [passed(20)] }), null, 'a pass the day before: no hype');
  const onTheDay = await findMoment({ now: NOW, fixtures: [passed(6)] });
  assert.equal(onTheDay.fixture.call, 'pass');
  assert.match(wordsFor(onTheDay).line, /No call from us on this one/);
  const called = await findMoment({ now: NOW, fixtures: [fx('Manchester City', 'Manchester United', 1, 20, { ...NO_CALL, locked: true })] });
  assert.equal(wordsFor(called).cta.label, 'See our call');
});

test('calls first: a league back waits until most games are looked at and one is called', async () => {
  const undecided = Array.from({ length: 5 }, (_, i) => fx(`H${i}`, `A${i}`, 1, 10 + i, NO_CALL));
  assert.equal(await findMoment({ now: NOW, fixtures: undecided, league: leagueAgo(19) }), null, 'nothing looked at');
  const allPassed = undecided.map((f) => ({ ...f, pass: 'No.' }));
  assert.equal(await findMoment({ now: NOW, fixtures: allPassed, league: leagueAgo(19) }), null, 'looked at, nothing called');
  const ready = [...allPassed.slice(0, 2), { ...undecided[2], top_pick: { x: 1 } }, { ...undecided[3], locked: true }, undecided[4]];
  const m = await findMoment({ now: NOW, fixtures: ready, league: leagueAgo(19) });
  assert.equal(m.kind, 'return');
  assert.equal(m.calls, 2);
  assert.deepEqual(m.games.slice(0, 2).map((g: { call: string }) => g.call), ['open', 'members'], 'the called games lead');
  assert.equal(wordsFor(m).calls, 'Our calls are in on two of the five.');
});

test('calls first: a Champions League night waits for its calls', async () => {
  const night = [fx('X', 'Y', 7, 9, NO_CALL), fx('Z', 'W', 7, 10, NO_CALL)];
  assert.equal(await findMoment({ now: NOW, fixtures: night }), null);
  const m = await findMoment({ now: NOW, fixtures: [{ ...night[0]!, pass: 'No.' }, { ...night[1]!, top_pick: { x: 1 } }] });
  assert.equal(m.kind, 'ucl');
  assert.equal(wordsFor(m).calls, 'Our calls are in on one of the two.');
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
