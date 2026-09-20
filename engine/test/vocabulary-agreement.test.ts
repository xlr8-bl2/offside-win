import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BANNED, PERCENTAGE, SPREADSHEET_NUMBER } from '../src/vocabulary.ts';
// @ts-expect-error — plain ES module shipped to the browser, no types.
import { BANNED as PAGE_BANNED, cleanProse, findBanned as findInPage, PERCENTAGE as PAGE_PERCENTAGE, SPREADSHEET_NUMBER as PAGE_SPREADSHEET } from '../../public/js/lib/vocabulary.js';

/**
 * The browser's copy of the banned-term list, held to the engine's.
 *
 * The rule has one definition -- engine/src/vocabulary.ts -- and two consumers
 * that cannot share a module: the writer's validator runs in Node, and the
 * results page applies the same test to stored narratives at render time, in a
 * browser, with no build step to compile TypeScript for it.
 *
 * Two lists that drift would quietly reopen the gap the rule closes. A term
 * added to the engine and not to the page fails this the moment it is added,
 * which is the only reason a second copy is tolerable at all.
 */
test('the two lists are the same list', () => {
  const fingerprint = (p: RegExp) => `${p.source}/${p.flags}`;
  assert.deepEqual(
    (PAGE_BANNED as RegExp[]).map(fingerprint),
    BANNED.map((b) => fingerprint(b.pattern)),
    'public/js/lib/vocabulary.js has drifted from engine/src/vocabulary.ts',
  );
});

test('the number rules are the same rules', () => {
  const fingerprint = (p: RegExp) => `${p.source}/${p.flags}`;
  assert.equal(fingerprint(PAGE_SPREADSHEET as RegExp), fingerprint(SPREADSHEET_NUMBER));
  assert.equal(fingerprint(PAGE_PERCENTAGE as RegExp), fingerprint(PERCENTAGE));
});

test('a spreadsheet figure withholds the passage, but the call price does not', () => {
  // Verbatim from a narrative on record. "1.87 expected" and "82%" are exactly
  // what the rule exists to keep off the page; the 1.17 is the price the
  // sentence is about.
  const real =
    'Over 1.5 goals at 1.17. 1.87 for Kaiserslautern, 1.57 for Braunschweig — ' +
    'neither side projects to run away with it. Call it 82%.';
  assert.equal(cleanProse(real, ['1.17', '1.5']), null);

  // The call's own price and line are the two figures the sentence is about.
  const clean = 'Over 1.5 goals at 1.17. Neither side has kept a clean sheet in six.';
  assert.equal(cleanProse(clean, ['1.17', '1.5']), clean);
  // Without being told either, the same sentence is withheld.
  assert.equal(cleanProse(clean, []), null);
  // And a figure past the first one does not slip through behind an allowed one.
  assert.equal(cleanProse('Over 1.5 goals at 1.17, on a run of 2.31 a game.', ['1.17', '1.5']), null);
});

test('ordinary football writing is not caught', () => {
  for (const ok of [
    'Arsenal have won four of their last six, and kept three clean sheets doing it.',
    'Saka is fit again after a fortnight out, which changes the left side of this.',
    'Brighton beat them 4-0 here in April and have not lost at home since.',
    'It finished level at 1-1, so the stake came back.',
    'Both sides are missing a first-choice centre-back, and neither has scored in three.',
  ]) {
    assert.equal(findInPage(ok), null, `false positive on: ${ok}`);
  }
});

test('the private vocabulary is caught in real stored narratives', () => {
  for (const bad of [
    'Expected goals total 3.01 against a line of 1.5: above it, which is the call.',
    'The model reads this as a 3.01-goal match.',
    '83% on our numbers, 1.17 on the board.',
    'The confidence is the point here, not the payout.',
    'A high-probability call rather than a claim the market is wrong, per §7.3.',
  ]) {
    assert.ok(findInPage(bad), `let through: ${bad}`);
  }
});

test('empty and missing prose is withheld rather than printed', () => {
  assert.equal(cleanProse(''), null);
  assert.equal(cleanProse(null), null);
  assert.equal(cleanProse('   '), null);
  assert.equal(cleanProse('They have kept two clean sheets in a row.'), 'They have kept two clean sheets in a row.');
});
