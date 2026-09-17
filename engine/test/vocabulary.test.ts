import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findBanned, findBannedInProse, isClean } from '../src/vocabulary.ts';

/**
 * These cases are taken from what the live site actually published, so a
 * regression here means the old vocabulary has come back rather than that a
 * hypothetical has been missed.
 */

test('catches the pick classes', () => {
  assert.ok(findBanned('HIGH-CONFIDENCE CALL').length > 0);
  assert.ok(findBanned('A confidence, not a tip — this one agrees').length > 0);
});

test('catches the scores that were shown instead of reasons', () => {
  assert.ok(findBanned('confidence 83%').length > 0);
  assert.ok(findBanned('81% on our numbers, 1.18 on the board').length > 0);
  assert.ok(findBanned('returns 15p in the pound').length > 0);
  assert.ok(findBanned('the price says 59.4%').length > 0);
});

test('catches pricing internals', () => {
  assert.ok(findBanned('1.46 expected goals for Grasshopper').length > 0);
  assert.ok(findBanned('de-vigged with Shin\'s method').length > 0);
  assert.ok(findBanned('have taken 2.17 points a game').length > 0);
});

test('catches measurement internals and debug output', () => {
  assert.ok(findBanned('closing line value').length > 0);
  assert.ok(findBanned('§2.8 fatigue').length > 0);
  assert.ok(findBanned('state: COMPUTED').length > 0);
  assert.ok(findBanned('down 6.99 units').length > 0);
});

test('"confident" survives — it is the voice, "confidence" is the score', () => {
  assert.equal(findBanned('We are confident Arsenal win this').length, 0);
  assert.ok(findBanned('confidence 83%').length > 0);
});

test('football English is not a false positive', () => {
  // Every one of these was broken by an earlier, broader version of the rules.
  for (const line of [
    'Saka cut in from the edge of the box and buried it.',
    'Arsenal are likely to win this one.',
    'It was a good call from the referee.',
    'They beat them 4-0 in April and have not lost since.',
    'Haaland has scored in every home game this season.',
    'Unbeaten in twelve, and it shows.',
  ]) {
    assert.equal(findBanned(line).length, 0, `false positive on: ${line}`);
  }
});

test('prose rejects a spreadsheet number that was never in the evidence', () => {
  const facts = ['won four of their last six', 'beat them 4-0 in April'];
  assert.ok(!isClean('Sarpsborg are the better side at 1.78 to 1.15.', facts));
  assert.ok(isClean('Sarpsborg won four of their last six and beat them 4-0 in April.', facts));
});

test('prose rejects a bare percentage', () => {
  assert.ok(!isClean('That puts it at 83%, which is worth knowing.', []));
});

test('a scoreline is not a spreadsheet number', () => {
  assert.ok(isClean('They won 4-0 and nobody laid a glove on them.', ['They won 4-0']));
});

test('a price is allowed on the page but not inside the prose', () => {
  // The page shows 2.35 as the odds; the writer must not narrate it.
  assert.equal(findBanned('2.35').length, 0);
  assert.ok(!isClean('Take the 2.35 and thank us later.', []));
  assert.ok(isClean('Take the 2.35 and thank us later.', ['2.35']));
});

test('reports what to write instead', () => {
  const hits = findBanned('confidence 83%');
  assert.ok(hits.length > 0);
  assert.match(hits[0]!.instead, /say why/i);
});
