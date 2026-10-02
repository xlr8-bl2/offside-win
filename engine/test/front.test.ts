import { test } from 'node:test';
import assert from 'node:assert/strict';

/*
 * The landing page's words (public/js/lib/front.js), shown to every visitor
 * who is not a member and sent to search engines as the front page. The
 * house rules apply: nothing banned, no promise of money, no shouting.
 */
// @ts-expect-error plain ES module from the site
const front = await import('../../public/js/lib/front.js');
const { findBannedInProse } = await import('../src/vocabulary.ts');

const all: string[] = [
  ...front.LANDING_HEADLINE, front.LANDING_LEDE,
  ...front.LANDING_STEPS.flat(), ...front.LANDING_GETS.flat(), ...front.LANDING_FAQ.flat(),
];

test('the landing copy passes the vocabulary rule', () => {
  for (const t of all) assert.deepEqual(findBannedInProse(t), [], t);
});

test('it never promises money, and says so where it matters', () => {
  for (const t of all) assert.doesNotMatch(t, /profit|guaranteed win|sure thing|easy money|beat the bookies/i, t);
  assert.ok(front.LANDING_FAQ.some(([q]: [string]) => /always come in/.test(q)), 'the misses question is answered');
  assert.ok(front.LANDING_FAQ.some(([, a]: [string, string]) => /BeGambleAware/.test(a)), 'the help line is there');
});

test('no template tells: no middle dots, no arrows, no all-caps', () => {
  for (const t of all) assert.doesNotMatch(t, /·|→|\b[A-Z]{4,}\b/, t);
});

test('the front door sells the football, not the way out', () => {
  // Cancelling is one tap and says so on the pricing, checkout and account
  // pages, where a buyer reads the terms. The landing page is the pitch.
  for (const t of all) assert.doesNotMatch(t, /cancel/i, t);
});
