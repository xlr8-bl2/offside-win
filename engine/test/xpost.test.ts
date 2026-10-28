import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authHeader, xLength, xText } from '../src/xpost.ts';
import { clean, fallbackHook } from '../src/social/copy.ts';

test('the OAuth 1.0a signature matches the worked example in X\'s own documentation', () => {
  const k = {
    apiKey: 'xvz1evFS4wEEPTGEFPHBog', apiSecret: 'kAcSOqF21Fu85e7zjz7ZN2U4ZRhfV3WpwPAoE3Z7kBw',
    token: '370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb', tokenSecret: 'LswwdoUaIvS8ltyTt5jkRh4J50vUPVVHtR2YPi5kE',
  };
  const url = 'https://api.twitter.com/1.1/statuses/update.json?include_entities=true&status=' + encodeURIComponent('Hello Ladies + Gentlemen, a signed OAuth request!');
  const h = authHeader(k, 'POST', url, 'kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg', 1318622958);
  assert.equal(decodeURIComponent(/oauth_signature="([^"]+)"/.exec(h)![1]!), 'hCtSmYh+iHYCEqBWrE7C7hYmtUk=');
});

test('a post headline never promises a result or talks money', () => {
  for (const bad of ['An absolute lock tonight', 'Guaranteed winner', 'Free money on Numancia', 'Back them for profit', 'Sure thing, this one', 'Nailed on for the win']) {
    assert.equal(clean(bad), false, bad);
  }
  assert.equal(clean('Oviedo turn up depleted. Numancia keep it tight.'), true);
});

test('every fallback headline passes the same checks', () => {
  const base = { home: 'Numancia', away: 'Real Oviedo', backed: 'Numancia', other: 'Real Oviedo' };
  const cases = [
    { market: '1x2', outcome: 'HOME', line: null }, { market: '1x2', outcome: 'DRAW', line: null },
    { market: 'asian_handicap', outcome: 'HOME', line: 2.5 }, { market: 'asian_handicap', outcome: 'HOME', line: -1 },
    { market: 'over_under_15', outcome: 'over', line: null }, { market: 'over_under_35', outcome: 'under', line: null },
    { market: 'double_chance', outcome: '1X', line: null }, { market: 'draw_no_bet', outcome: 'HOME', line: null },
  ];
  for (const c of cases) {
    const h = fallbackHook({ ...base, ...c });
    assert.ok(clean(h.replace(/\*/g, '')), h);
  }
});

test('the X version of a post fits in 280, keeps the link and the 18+ line, and drops Telegram-only lines', () => {
  const caption = ['🚨 FREE CALL · Numancia v Real Oviedo', '', 'Write Numancia off? Not a chance.', '', '🎯 Numancia +2.5 (Asian Handicap), odds of 1.16 at Bet365',
    'Only loses if Numancia lose by 3 or more.', '⏰ 19:00 UK · Copa del Rey', '', 'A long paragraph of analysis that will not fit. '.repeat(6), '', 'Members get every call 👇', '', '18+ · BeGambleAware.org'].join('\n');
  const t = xText(caption, 'https://offside.win/match/606008/numancia-v-real-oviedo');
  assert.doesNotMatch(xText(caption), /https?:/);
  assert.ok(xLength(t) <= 280, String(xLength(t)));
  assert.match(t, /odds of 1\.16/);
  assert.match(t, /offside\.win\/match\/606008/);
  assert.match(t, /18\+ BeGambleAware\.org$/);
  assert.doesNotMatch(t, /👇|analysis that will not fit/);
});
