import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractCardsFromIncidents } from '../src/history.ts';

/**
 * The provider leaves card counters out of a match's stats when nothing was
 * shown, so the incidents are where a zero comes from. Storing "unknown"
 * instead kept only matches with cards, and the history read as if four in
 * ten had a red.
 */

test('cards are read from card_type, and a second yellow is a red', () => {
  const c = extractCardsFromIncidents({ incidents: [
    { type: 'card', is_home: true, card_type: 'yellow' },
    { type: 'card', is_home: false, card_type: 'yellowRed' },
    { type: 'card', is_home: false, card_type: 'red' },
    { type: 'goal', is_home: true },
  ] }, 1);
  assert.deepEqual(c, { home_yellows: 1, away_yellows: 0, home_reds: 0, away_reds: 2 });
});

test('a published match with no card is zero, not unknown', () => {
  const c = extractCardsFromIncidents({ incidents: [{ type: 'goal', is_home: true }, { type: 'period', text: 'FT' }] }, 1);
  assert.deepEqual(c, { home_yellows: 0, away_yellows: 0, home_reds: 0, away_reds: 0 });
});

test('an unpublished list is unknown', () => {
  assert.equal(extractCardsFromIncidents({ incidents: [] }, 1), null);
  assert.equal(extractCardsFromIncidents(null, 1), null);
});
