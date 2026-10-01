import { test } from 'node:test';
import assert from 'node:assert/strict';

/**
 * The week's note (public/js/lib/season.js): read from the board, so it says
 * "international break" during one, shows off a World Cup during one, and
 * says nothing on an ordinary weekend.
 */
// @ts-expect-error plain ES module from the site
const { readSeason, wordsFor, countdownWords, listOf, daysBetween } = await import('../../public/js/lib/season.js');
const { findBannedInProse } = await import('../src/vocabulary.ts');

const NOW = Date.UTC(2026, 9, 1, 12) / 1000;
let id = 1;
const fx = (league: string, league_id: number, hoursAhead: number, extra: Record<string, unknown> = {}) =>
  ({ id: id++, league, league_id, home: 'Home', away: 'Away', home_id: 1, away_id: 2, kickoff: NOW + hoursAhead * 3600, status: 'notstarted', ...extra });
const many = (n: number, league: string, league_id: number, extra: Record<string, unknown> = {}) =>
  Array.from({ length: n }, (_, i) => fx(league, league_id, 2 + i, extra));
const at = (days: number) => async () => NOW + days * 86400;

test('an international break: no big-five games, national teams playing', async () => {
  const r = await readSeason({
    now: NOW,
    nextTop: at(9),
    fixtures: [
      ...many(8, 'UEFA Nations League', 64),
      ...many(4, 'International Friendly Games', 31),
      ...many(6, 'League One', 86, { top_pick: { x: 1 } }),
      ...many(3, 'FA Cup', 39, { locked: true }),
      ...many(20, 'Club Friendlies', 79, { top_pick: { x: 1 } }),
    ],
  });
  assert.equal(r.kind, 'break');
  assert.equal(r.days, 9);
  // Club friendlies are not counted as football that is on.
  assert.equal(r.calls, 9);
  assert.deepEqual(r.still, ['League One', 'FA Cup']);
  const w = wordsFor(r);
  assert.match(w.text.join(' '), /League One and the FA Cup carry on as normal/);
});

test('the same week is one note, keyed to when the club game returns', async () => {
  const base = { now: NOW, nextTop: at(9), fixtures: Array.from({ length: 6 }, (_, i) => fx('UEFA Nations League', 64, 30 + i)) };
  const a = await readSeason(base);
  const b = await readSeason({ ...base, now: NOW + 86400 });
  assert.equal(a.key, b.key);
});

test('a big-five game anywhere in the window means an ordinary week', async () => {
  let asked = false;
  const r = await readSeason({
    now: NOW,
    nextTop: async () => { asked = true; return null; },
    fixtures: [...many(10, 'UEFA Nations League', 64), fx('Premier League', 1, 40)],
  });
  assert.equal(r, null);
  assert.equal(asked, false, 'an ordinary week asks for nothing more');
});

test('a World Cup is shown off, its next games first', async () => {
  const r = await readSeason({
    now: NOW,
    fixtures: [
      fx('FIFA World Cup', 500, 30, { home: 'Brazil', away: 'Croatia' }),
      fx('FIFA World Cup', 500, 5, { home: 'England', away: 'Senegal', top_pick: { x: 1 } }),
      fx('FIFA World Cup', 500, 50),
      fx('FIFA World Cup', 500, 60),
      ...many(4, 'International Friendly Games', 31),
    ],
  });
  assert.equal(r.kind, 'tournament');
  assert.equal(r.count, 4);
  assert.equal(r.calls, 1);
  assert.equal(r.games.length, 3);
  assert.equal(r.games[0].home, 'England');
  assert.equal(wordsFor(r).title, 'The World Cup is on.');
});

test('qualifiers are a break, not a tournament', async () => {
  const r = await readSeason({ now: NOW, nextTop: at(10), fixtures: many(6, 'World Cup Qualification UEFA', 400) });
  assert.equal(r.kind, 'break');
});

test('the close season: nothing big, no national teams, the league weeks away', async () => {
  const fixtures = [...many(6, 'MLS', 18), ...many(5, 'Brasileirão Serie A', 9)];
  const r = await readSeason({ now: NOW, nextTop: at(30), fixtures });
  assert.equal(r.kind, 'offseason');
  // A quiet midweek with the league back on Saturday is not the close season.
  assert.equal(await readSeason({ now: NOW, nextTop: at(3), fixtures }), null);
});

test('games already over are not counted as on', async () => {
  const r = await readSeason({ now: NOW, nextTop: at(9), fixtures: many(6, 'UEFA Nations League', 64, { status: 'finished' }) });
  assert.equal(r, null);
});

test('the countdown says days a fan would say', () => {
  assert.deepEqual(countdownWords(9), { n: 9, text: 'days till the Premier League is back' });
  assert.equal(countdownWords(1).text, 'The Premier League is back tomorrow. Let’s gooo.');
  assert.equal(countdownWords(0).text, 'The Premier League is back today');
  assert.equal(countdownWords(null), null);
  assert.equal(daysBetween(NOW, NOW + 9 * 86400), 9);
});

test('lists read as English', () => {
  assert.equal(listOf(['MLS']), 'MLS');
  assert.equal(listOf(['League One', 'FA Cup']), 'League One and the FA Cup');
  assert.equal(listOf(['MLS', 'National League', 'Copa del Rey']), 'MLS, the National League and the Copa del Rey');
});

test('nothing the note says breaks the vocabulary rule', async () => {
  const readings = [
    await readSeason({ now: NOW, nextTop: at(9), fixtures: [...many(6, 'UEFA Nations League', 64), ...many(3, 'League One', 86)] }),
    await readSeason({ now: NOW, fixtures: many(3, 'UEFA European Championship', 501, { top_pick: { x: 1 } }) }),
    await readSeason({ now: NOW, nextTop: at(30), fixtures: many(4, 'MLS', 18) }),
  ];
  for (const r of readings) {
    const w = wordsFor(r);
    const prose = [w.label, w.title, w.lead, w.chip, ...w.text, w.cta.label].join(' ');
    const bad = findBannedInProse(prose);
    assert.ok(!bad || (Array.isArray(bad) && !bad.length), `${r.kind}: ${JSON.stringify(bad)}`);
  }
});
