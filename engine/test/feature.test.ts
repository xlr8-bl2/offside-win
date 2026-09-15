import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chooseHero } from '../src/feature.ts';

const NOW = 1_700_000_000;
const fx = (o: Partial<Parameters<typeof chooseHero>[0][number]>) =>
  ({ id: 1, league_id: 1, league: 'Premier League', kickoff: NOW + 4 * 3600,
     home: 'A', away: 'B', ...o }) as Parameters<typeof chooseHero>[0][number];

test('a marquee competition leads over a more confident minor one', () => {
  // The complaint this answers: the page led with whatever the model liked best,
  // which on a Champions League night was a Polish cup tie.
  const hero = chooseHero([
    fx({ id: 1, league_id: 46, league: 'Puchar Polski', confidence: 0.94 }),
    fx({ id: 2, league_id: 7, league: 'Champions League', confidence: 0.55 }),
  ], NOW)!;
  assert.equal(hero.fixture_id, 2);
  assert.equal(hero.kicker, 'Champions League night');
});

test('a derby is an occasion in its own right', () => {
  const hero = chooseHero([
    fx({ id: 1, league_id: 1, confidence: 0.9 }),
    fx({ id: 2, league_id: 1, confidence: 0.6, derby: true, home: 'Everton', away: 'Liverpool' }),
  ], NOW)!;
  assert.equal(hero.fixture_id, 2);
  assert.equal(hero.kicker, 'Derby day');
});

test('tonight beats next week', () => {
  const hero = chooseHero([
    fx({ id: 1, league_id: 1, kickoff: NOW + 6 * 86400, confidence: 0.9 }),
    fx({ id: 2, league_id: 1, kickoff: NOW + 3 * 3600, confidence: 0.6 }),
  ], NOW)!;
  assert.equal(hero.fixture_id, 2);
});

test('a friendly never leads, however much the model likes it', () => {
  const hero = chooseHero([
    fx({ id: 1, league_id: 79, league: 'Club Friendlies', confidence: 0.97 }),
    fx({ id: 2, league_id: 91, league: 'National League', confidence: 0.5 }),
  ], NOW)!;
  assert.equal(hero.fixture_id, 2, 'led with a friendly');
});

test('a finished match is not the masthead', () => {
  const hero = chooseHero([
    fx({ id: 1, league_id: 7, kickoff: NOW - 5 * 3600, confidence: 0.9 }),
    fx({ id: 2, league_id: 91, kickoff: NOW + 2 * 3600, confidence: 0.5 }),
  ], NOW)!;
  assert.equal(hero.fixture_id, 2);
});

test('an empty board has no hero rather than a wrong one', () => {
  assert.equal(chooseHero([], NOW), null);
  assert.equal(chooseHero([fx({ kickoff: NOW - 86400 })], NOW), null);
});
