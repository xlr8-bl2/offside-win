import { test } from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error -- plain JS shared with the site
import { cardKey, cardLine, cardState } from '../../public/js/lib/cards.js';
// @ts-expect-error -- plain JS shared with the site
import { describe } from '../../public/js/lib/markets.js';

const base = { id: 1, home: 'Germany', away: 'Greece', kickoff: 1790000000 };
const pick = { market: '1x2', outcome: 'HOME', line: null, odds: 1.45 };

test('the card only says what is public', () => {
  assert.equal(cardLine({ ...base, free_call: true, top_pick: pick }, describe).side, 'odds of 1.45');
  const locked = cardLine({ ...base, locked: true }, describe);
  assert.equal(locked.tag, 'we have a call');
  assert.doesNotMatch(JSON.stringify(locked), /Germany to win|1\.45/);
  // A members' call the signed-out board still carries is never named.
  assert.doesNotMatch(JSON.stringify(cardLine({ ...base, top_pick: pick }, describe)), /1\.45/);
  assert.equal(cardLine(base, describe).tag, 'preview');
});

test('full time names the settled call and how it went', () => {
  const ft = { ...base, score: [2, 1], called: { ...pick, result: 'WON' } };
  assert.equal(cardState(ft), 'ft-2-1');
  const l = cardLine(ft, describe);
  assert.equal(l.side, 'Landed');
  assert.equal(l.tone, 'won');
  assert.equal(cardLine({ ...ft, called: { ...pick, result: 'LOST' } }, describe).side, 'Missed');
});

test('the key changes exactly when the picture would', () => {
  const a = cardKey({ ...base, locked: true }, describe);
  assert.equal(cardKey({ ...base, locked: true, confidence: 0.9 }, describe), a, 'nothing drawn changed');
  assert.notEqual(cardKey({ ...base, locked: true, score: [0, 0] }, describe), a, 'full time');
  assert.notEqual(cardKey({ ...base, free_call: true, top_pick: pick }, describe), a, 'became the free call');
});
