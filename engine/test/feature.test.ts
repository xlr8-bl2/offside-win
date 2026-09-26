import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chooseHero } from '../src/feature.ts';

const NOW = 1_700_000_000;
const fx = (o: Partial<Parameters<typeof chooseHero>[0][number]>) =>
  ({ id: 1, league_id: 1, league: 'Premier League', kickoff: NOW + 4 * 3600,
     home: 'A', away: 'B', called: true, ...o }) as Parameters<typeof chooseHero>[0][number];

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

test('a derby that has a name is called by it', () => {
  const hero = chooseHero([
    fx({ id: 1, league_id: 1, confidence: 0.9 }),
    fx({ id: 2, league_id: 1, confidence: 0.6, derby: true, home: 'Everton', away: 'Liverpool' }),
  ], NOW)!;
  assert.equal(hero.fixture_id, 2);
  assert.equal(hero.kicker, 'The Merseyside derby');
});

test('a derby the provider flags but nobody has named does not lead', () => {
  // The two fixtures the flag actually fired on in a live sample. Under the old
  // flat +180 this reserve tie beat a Premier League game outright.
  const hero = chooseHero([
    fx({ id: 1, league_id: 1, league: 'Premier League', confidence: 0.6 }),
    fx({ id: 2, league_id: 99, league: 'U23 Reserve League', confidence: 0.9,
         derby: true, home: 'Club NXT U23', away: 'KAA Gent Reserve U23' }),
  ], NOW)!;
  assert.equal(hero.fixture_id, 1, 'a reserve derby led the page');
});

test('a major cup final leads over an ordinary league game', () => {
  const hero = chooseHero([
    fx({ id: 1, league_id: 1, league: 'Premier League', confidence: 0.9 }),
    fx({ id: 2, league_id: 12, league: 'FA Cup', confidence: 0.5, round_label: 'Final' }),
  ], NOW)!;
  assert.equal(hero.fixture_id, 2);
  assert.equal(hero.kicker, 'The final');
});

test('a minor cup final does not', () => {
  // A final is worth what the competition it ends is worth. Unscaled, this was
  // the Estonian Cup final leading over Arsenal.
  const hero = chooseHero([
    fx({ id: 1, league_id: 1, league: 'Premier League', confidence: 0.6 }),
    fx({ id: 2, league_id: 999, league: 'Esiliiga Cup', confidence: 0.9, round_label: 'Final' }),
  ], NOW)!;
  assert.equal(hero.fixture_id, 1, 'a minor final led the page');
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

test('a top-five league game outranks a Europa League tie in the same window', () => {
  // The live board did exactly this the wrong way round: Anderlecht v Lyon led
  // over Barcelona kicking off two hours later, because a flat marquee bonus was
  // bigger than the gap between league tiers.
  const hero = chooseHero([
    fx({ id: 1, league_id: 8, league: 'Europa League', kickoff: NOW + 2 * 3600, confidence: 0.7 }),
    fx({ id: 2, league_id: 3, league: 'La Liga', kickoff: NOW + 2 * 3600, confidence: 0.6,
         home: 'FC Barcelona', away: 'Real Racing Club' }),
  ], NOW)!;
  assert.equal(hero.fixture_id, 2, 'Europa League led over La Liga');
});

test('but a Europa League night still leads when nothing bigger is on', () => {
  const hero = chooseHero([
    fx({ id: 1, league_id: 8, league: 'Europa League', kickoff: NOW + 2 * 3600, confidence: 0.6 }),
    fx({ id: 2, league_id: 91, league: 'National League', kickoff: NOW + 2 * 3600, confidence: 0.9 }),
  ], NOW)!;
  assert.equal(hero.fixture_id, 1);
  assert.equal(hero.kicker, 'Europa League night');
});

test('the Champions League still leads over anything', () => {
  const hero = chooseHero([
    fx({ id: 1, league_id: 1, league: 'Premier League', kickoff: NOW + 2 * 3600, confidence: 0.9 }),
    fx({ id: 2, league_id: 7, league: 'Champions League', kickoff: NOW + 2 * 3600, confidence: 0.4 }),
  ], NOW)!;
  assert.equal(hero.fixture_id, 2);
});

test('a bigger game with no call does not lead over a smaller one we called', () => {
  // The masthead's call was read as the call on the masthead's match. A match
  // we passed on is not the front page, however big.
  const hero = chooseHero([
    fx({ id: 1, league_id: 7, league: 'Champions League', confidence: 0.4, called: false }),
    fx({ id: 2, league_id: 91, league: 'National League', confidence: 0.8 }),
  ], NOW)!;
  assert.equal(hero.fixture_id, 2);
  assert.equal(chooseHero([fx({ called: false })], NOW), null, 'nothing called: no hero');
});
