import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalise, namedFixture, stageOf, occasionOf, statureOf } from '../src/occasion.ts';

/**
 * The club names below are taken verbatim from a live board, spelling and all,
 * because the feed's names are the thing this has to survive — not the names a
 * person would type.
 */

test('normalise strips decoration but keeps the distinguishing word', () => {
  assert.equal(normalise('FC Barcelona'), 'barcelona');
  assert.equal(normalise('Fútbol Club Barcelona'), 'barcelona');
  assert.equal(normalise('Olympique de Marseille'), 'marseille');
  assert.equal(normalise('AFC Ajax'), 'ajax');
  assert.equal(normalise('FC Bayern München'), 'bayern munchen');
  assert.equal(normalise('AS Roma'), 'roma');

  // These words distinguish a club rather than decorate it.
  assert.match(normalise('Real Madrid'), /^real madrid$/);
  assert.match(normalise('Club Atlético de Madrid'), /atletico madrid/);
  assert.notEqual(normalise('Real Madrid'), normalise('Club Atlético de Madrid'));
});

test('El Clasico is found under either spelling and either way round', () => {
  assert.equal(namedFixture('Real Madrid', 'FC Barcelona')?.kicker, 'El Clásico');
  assert.equal(namedFixture('Fútbol Club Barcelona', 'Real Madrid')?.kicker, 'El Clásico');
});

test('the Madrid derby is not mistaken for El Clasico', () => {
  assert.equal(namedFixture('Real Madrid', 'Club Atlético de Madrid')?.kicker, 'The Madrid derby');
});

test('both sides must match, so an ambiguous name cannot fire alone', () => {
  // Three clubs in one live board normalise to something containing "rangers".
  assert.equal(namedFixture('Celtic', 'Rangers')?.kicker, 'The Old Firm');
  assert.equal(namedFixture('Celtic', 'Enugu Rangers International'), null);
  assert.equal(namedFixture('Stafford Rangers', 'Queens Park Rangers'), null);
});

test('a club that is only noise words still normalises to something', () => {
  assert.ok(normalise('Sporting CP').length > 0);
  assert.equal(namedFixture('Benfica', 'Sporting CP')?.kicker, 'The Lisbon derby');
});

test('stage is read off the round label the provider already sends', () => {
  assert.equal(stageOf('Quarterfinals')?.kicker, 'Quarter-final');
  assert.equal(stageOf('Semifinals')?.kicker, 'Semi-final');
  assert.equal(stageOf('Final')?.kicker, 'The final');
  assert.equal(stageOf('League phase · Matchday 1'), null);
  assert.equal(stageOf('Regular season · Matchday 9'), null);
  assert.equal(stageOf(null), null);
});

test('a semi-final is not read as a final', () => {
  assert.equal(stageOf('Semifinals')?.kicker, 'Semi-final');
  assert.equal(stageOf('Quarterfinals')?.kicker, 'Quarter-final');
});

test('the provider derby flag can break a tie but never leads', () => {
  // The exact shape that put a reserve-team derby on the front page.
  const reserves = occasionOf({
    home: 'Club NXT U23', away: 'KAA Gent Reserve U23',
    league_id: 999, rank: 6, local_derby: true,
  });
  assert.equal(reserves.weight, 25);

  const laLiga = occasionOf({
    home: 'Real Betis', away: 'Getafe', league_id: 3, rank: 2, local_derby: false,
  });
  // An ordinary La Liga game scores nothing here, but rank is what separates
  // them in the picker — the point is that the flag alone cannot outweigh it.
  assert.ok(reserves.weight < 100, 'a reserve derby must not be worth a tier of competition');
  assert.equal(laLiga.kicker, '');
});

test('El Clasico outranks a Champions League night', () => {
  const clasico = occasionOf({ home: 'Real Madrid', away: 'FC Barcelona', league_id: 3, rank: 2 });
  const ucl = occasionOf({ home: 'Sparta Praha', away: 'Club Brugge', league_id: 7, rank: 1 });
  assert.ok(clasico.weight > ucl.weight, `${clasico.weight} should beat ${ucl.weight}`);
  assert.equal(clasico.kicker, 'El Clásico');
});

test('the biggest final outranks even a named fixture', () => {
  // A Clasico in the Champions League final is the final first.
  const o = occasionOf({ home: 'Real Madrid', away: 'FC Barcelona', league_id: 7, rank: 1, round_label: 'Final' });
  assert.equal(o.kicker, 'The final');
});

test('but a named fixture wins a smaller one', () => {
  // A Clasico in the Copa del Rey final is still the Clasico — that is the
  // headline anyone would write, and "THE FINAL" throws away the better one.
  const o = occasionOf({ home: 'Real Madrid', away: 'FC Barcelona', league_id: 12, rank: 4, round_label: 'Final' });
  assert.equal(o.kicker, 'El Clásico');
});

test('the Europa League does not outrank a big-league fixture on weight alone', () => {
  const uel = occasionOf({ home: 'OFI Crete', away: 'TSG Hoffenheim', league_id: 8, rank: 3 });
  const derby = occasionOf({ home: 'Liverpool', away: 'Everton', league_id: 1, rank: 2 });
  assert.ok(derby.weight > uel.weight, 'the Merseyside derby must beat a Europa League tie');
});

test('an ordinary fixture is named nothing rather than named badly', () => {
  const o = occasionOf({ home: 'Raków Częstochowa', away: 'Zagłębie Lubin', league_id: 34, rank: 5 });
  assert.equal(o.kicker, '');
  assert.equal(o.weight, 0);
});

test('stature: a national side or big club counts wherever it plays', () => {
  assert.ok(statureOf('Portugal') > statureOf('Wales'), 'Portugal outrank Wales');
  assert.ok(statureOf('Wales') > 0, 'Wales are still somebody');
  assert.ok(statureOf('Real Madrid') > statureOf('Girona'), 'Real Madrid outrank Girona');
  assert.equal(statureOf('Nashville SC'), 0, 'an MLS side carries no stature');
  assert.equal(statureOf('Toronto FC'), 0);
});

test('stature matches whole words, not fragments', () => {
  // "Wales" must not match "New South Wales"-style substrings inside another
  // word, and a club that merely contains a country name is not that country.
  assert.equal(statureOf('Walesby Town'), 0);
  assert.ok(statureOf('Portugal U21') > 0, 'the U21s still carry the name');
});
