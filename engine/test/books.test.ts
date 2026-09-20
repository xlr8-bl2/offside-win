import { test } from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error — plain ES module shipped to the browser, no types.
import { COUNTRY_NAMES, countryOptions, localPrice } from '../../public/js/lib/books.js';

/**
 * The rule this file defends: the price printed beside a call is a price the
 * reader can get on. The engine deliberately keeps every book's number because
 * the model wants the sharpest one — so the only thing standing between a
 * British reader and a Pinnacle price they cannot take is this resolution.
 */

const quotes = [
  { slug: 'pinnacle', book: 'Pinnacle', odds: 2.24 },
  { slug: '1xbet', book: '1xBet', odds: 2.20 },
  { slug: 'bet365', book: 'Bet365', odds: 2.10 },
  { slug: 'williamhill', book: 'William Hill', odds: 2.05 },
  { slug: 'betano', book: 'Betano', odds: 2.15 },
];

test('the best price in the world is not the price a British reader is shown', () => {
  const p = localPrice(quotes, 'GB');
  assert.equal(p.local, true);
  assert.equal(p.book, 'Bet365');
  assert.equal(p.odds, 2.10);
});

test('the same call resolves to a different book in a different country', () => {
  assert.equal(localPrice(quotes, 'PT').book, 'Betano');
  assert.equal(localPrice(quotes, 'NG').book, '1xBet');
});

test('no local book is said so rather than papered over', () => {
  const p = localPrice([{ slug: 'pinnacle', book: 'Pinnacle', odds: 2.24 }], 'GB');
  assert.equal(p.local, false);
  assert.equal(p.book, 'Pinnacle');
});

test('a book is matched on its display name when the slug is missing', () => {
  const p = localPrice([{ slug: '', book: 'Sky Bet', odds: 1.9 }], 'GB');
  assert.equal(p.local, true);
});

test('an unlisted country falls back to books that take anyone', () => {
  assert.equal(localPrice(quotes, 'XX').local, true);
});

test('nothing quoted is null, not a zero price', () => {
  assert.equal(localPrice([], 'GB'), null);
  assert.equal(localPrice(undefined, 'GB'), null);
});

test('a price of 1.00 or less is not a price', () => {
  assert.equal(localPrice([{ slug: 'bet365', book: 'Bet365', odds: 1 }], 'GB'), null);
});

test('every country the picker offers has a name to show', () => {
  for (const c of countryOptions()) {
    assert.ok(COUNTRY_NAMES[c], `${c} has no display name`);
  }
});
