import { test } from 'node:test';
import assert from 'node:assert/strict';
import { callName, pullReason, type PullContext } from '../src/pulled.ts';
import { findBannedInProse } from '../src/vocabulary.ts';
import type { Factor } from '../src/types.ts';

/*
 * What a member reads when we take a call down. The reason has to be true,
 * has to be news (not something the call already knew), and must never name
 * the call, because non-members can read it on the match page.
 */

const absences = (side: 'home' | 'away', note: string): Factor => ({
  id: `availability.${side}.absences`, section: '§2.4', tier: 1 as Factor['tier'], state: 'COMPUTED' as Factor['state'],
  note, evidence: {}, adjustments: [], claims: [], strength: 0.5,
});
const ctx = (over: Partial<PullContext> = {}): PullContext => ({ home: 'France', away: 'Belgium', changes: null, factors: [], ...over });
const win = { market: '1x2', outcome: 'HOME', line: null };

test('the call in words, as the site names it', () => {
  assert.equal(callName(win, 'France', 'Belgium'), 'France to win');
  assert.match(callName({ market: 'over_under_15', outcome: 'over', line: 1.5 }, 'France', 'Belgium'), /goals/i);
});

test('a rotated side is the reason, with the names', () => {
  const r = pullReason(win, ctx({ changes: { home: { n: 5, out: ['Mbappé', 'Griezmann', 'Kanté', 'Saliba'], in: [] }, away: null } }), false);
  assert.equal(r, 'France have made five changes from the side expected. Mbappé, Griezmann and Kanté don’t start.');
});

test('the other side being rotated is not a reason to pull a call on France', () => {
  const r = pullReason(win, ctx({ changes: { home: null, away: { n: 6, out: ['De Bruyne'], in: [] } } }), false);
  assert.equal(r, 'With the latest team news and prices, it’s no longer one we’d back.');
});

test('goals calls look at both sides', () => {
  const r = pullReason({ market: 'over_under_25', outcome: 'over', line: 2.5 },
    ctx({ factors: [absences('away', 'Belgium are without 2 players, and De Bruyne and Lukaku are real losses.')] }), false);
  assert.equal(r, 'Belgium are without De Bruyne and Lukaku.');
});

test('an absence the call already knew about is not news', () => {
  const r = pullReason({ ...win, evidence_json: JSON.stringify({ drivers: [{ note: 'France are without 1 player, and Mbappé is a real loss.' }] }) },
    ctx({ factors: [absences('home', 'France are without 2 players, and Mbappé and Kanté are real losses.')] }), false);
  assert.equal(r, 'France are without Kanté.');
  const none = pullReason({ ...win, evidence_json: '{"note":"Mbappé is a real loss"}' },
    ctx({ factors: [absences('home', 'France are without 1 player, and Mbappé is a real loss.')] }), true);
  assert.equal(none, 'The latest team news and prices point to a better call on this match.');
});

test('the reason never names the call, and always passes the vocabulary gate', () => {
  const cases = [
    pullReason(win, ctx(), false),
    pullReason(win, ctx(), true),
    pullReason(win, ctx({ changes: { home: { n: 4, out: [], in: [] }, away: null } }), false),
  ];
  for (const r of cases) {
    assert.doesNotMatch(r, /to win|goals|odds|\d\.\d/);
    assert.deepEqual(findBannedInProse(r), [], r);
  }
});
