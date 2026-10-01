import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NAMED, namedFixture, normalise } from '../src/occasion.ts';
import * as browser from '../../public/js/lib/occasion.js';

/*
 * The site names the big fixtures itself (public/js/lib/occasion.js, for the
 * big-match moment) from a copy of the engine's list. Two lists drift, so this
 * holds them to each other.
 */

test('the browser has the same named fixtures as the engine', () => {
  assert.deepEqual(browser.NAMED, NAMED);
});

test('and reduces club names the same way', () => {
  for (const n of ['FC Barcelona', 'Fútbol Club Barcelona', 'Olympique de Marseille', 'Atlético Madrid', 'Sporting', 'Paris Saint-Germain', 'Inter', 'Real Betis Balompié', 'Bayern München']) {
    assert.equal(browser.normalise(n), normalise(n), n);
  }
});

test('and matches the same pairings, either way round', () => {
  const pairs: Array<[string, string]> = [
    ['Real Madrid', 'FC Barcelona'], ['Barcelona', 'Real Madrid CF'], ['Manchester City', 'Manchester United'],
    ['Arsenal', 'Tottenham Hotspur'], ['Celtic', 'Rangers'], ['Arsenal', 'Leeds United'], ['Rangers', 'Hibernian'],
  ];
  for (const [h, a] of pairs) assert.equal(browser.namedFixture(h, a)?.kicker ?? null, namedFixture(h, a)?.kicker ?? null, `${h} v ${a}`);
});
