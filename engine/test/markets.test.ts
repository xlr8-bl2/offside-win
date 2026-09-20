import { test } from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error — plain ES module shipped to the browser, no types.
import { describe as mkt, settleHandicap, returned } from '../../public/js/lib/markets.js';
import { findBanned } from '../src/vocabulary.ts';

/**
 * The handicap cases are the reason this file exists. A quarter line settles
 * as two half-stakes and the site has to say so, because nobody works it out
 * from "Osasuna -0.75".
 */

test('half lines settle cleanly', () => {
  assert.equal(settleHandicap(-0.5, 1), 'win');    // win by 1 beats a half-goal start
  assert.equal(settleHandicap(-0.5, 0), 'loss');   // a draw does not
  assert.equal(settleHandicap(-1.5, 2), 'win');
  assert.equal(settleHandicap(-1.5, 1), 'loss');
});

test('whole lines push on the exact margin', () => {
  assert.equal(settleHandicap(-1, 2), 'win');
  assert.equal(settleHandicap(-1, 1), 'push');     // stake back
  assert.equal(settleHandicap(-1, 0), 'loss');
});

test('quarter lines split the stake', () => {
  // -0.75 is half at -0.5, half at -1.
  assert.equal(settleHandicap(-0.75, 2), 'win');
  assert.equal(settleHandicap(-0.75, 1), 'half-win');  // -0.5 wins, -1 pushes
  assert.equal(settleHandicap(-0.75, 0), 'loss');

  // -0.25 is half at 0, half at -0.5.
  assert.equal(settleHandicap(-0.25, 1), 'win');
  assert.equal(settleHandicap(-0.25, 0), 'half-loss'); // 0 pushes, -0.5 loses
  assert.equal(settleHandicap(-0.25, -1), 'loss');

  assert.equal(settleHandicap(-1.25, 2), 'win');
  assert.equal(settleHandicap(-1.25, 1), 'half-loss'); // -1 pushes, -1.5 loses
});

test('the two quarter lines are told apart', () => {
  // The distinction the old UI never made, and the one that matters to anyone
  // who placed the bet: on -0.75 the partial band pays, on -1.25 it refunds.
  const good = mkt({ market: 'asian_handicap', outcome: 'HOME', line: -0.75, home: 'Osasuna', away: 'Elche', odds: 2.35 });
  assert.equal(good.name, 'Osasuna -0.75');
  assert.match(good.wins, /win by 2 or more/);
  assert.match(good.wins, /half your stake still wins/i);

  const bad = mkt({ market: 'asian_handicap', outcome: 'HOME', line: -1.25, home: 'Osasuna', away: 'Elche', odds: 2.35 });
  assert.match(bad.wins, /win by 2 or more/);
  assert.match(bad.wins, /half your stake comes back/i);
  assert.ok(!/still wins/.test(bad.wins), '-1.25 must not read as a half win');
});

test('the outcome table bands every result and never doubles a suffix', () => {
  const rows = mkt({ market: 'asian_handicap', outcome: 'HOME', line: -0.75, home: 'Osasuna', away: 'Elche', odds: 2.35 }).outcomes;
  assert.deepEqual(rows.map((r: { result: string }) => r.result), ['win', 'half-win', 'loss']);
  assert.equal(rows[0].label, 'Osasuna win by 2 or more');
  assert.equal(rows[2].label, 'Draw or defeat');
  for (const r of rows) assert.ok(!/or more or more/.test(r.label), `doubled suffix: ${r.label}`);
});

test('a whole line says the stake comes back', () => {
  const d = mkt({ market: 'asian_handicap', outcome: 'HOME', line: -1, home: 'Osasuna', away: 'Elche', odds: 2.35 });
  assert.match(d.wins, /win by 2 or more/);
  assert.match(d.wins, /your stake comes back/i);
});

test('the away side of a handicap is the mirror of the home one', () => {
  // `line` is the home handicap and belongs to the market: one -0.75 covers
  // both quotes. Printed against the away name it was saying "Elche -0.75"
  // when Elche were the side being given three quarters of a goal.
  const away = mkt({ market: 'asian_handicap', outcome: 'AWAY', line: -0.75, home: 'Osasuna', away: 'Elche', odds: 2.35 });
  assert.equal(away.name, 'Elche +0.75');
  assert.match(away.plain, /three-quarter-goal start/);
  // And the home side of the same market still reads the other way round.
  const home = mkt({ market: 'asian_handicap', outcome: 'HOME', line: -0.75, home: 'Osasuna', away: 'Elche', odds: 2.35 });
  assert.equal(home.name, 'Osasuna -0.75');
});

test('draw no bet explains the refund rather than naming itself', () => {
  const d = mkt({ market: 'draw_no_bet', outcome: 'HOME', home: 'Genoa', away: 'Sudtirol', odds: 1.5 });
  assert.equal(d.name, 'Genoa to win');
  assert.match(d.wins, /stake comes back/i);
  assert.ok(!/draw no bet/i.test(d.name), 'the jargon name must not survive');
});

test('the indefinite article agrees with the club name', () => {
  const a = (home: string, away: string) =>
    mkt({ market: 'double_chance', outcome: '1X', home, away, odds: 1.3 }).wins;
  assert.match(a('Genoa', 'Sudtirol'), /Only a Sudtirol/);
  assert.match(a('Chelsea', 'Arsenal'), /Only an Arsenal/);
  assert.match(a('Ajax', 'FC Porto'), /Only an FC Porto/);   // "eff-see", a vowel sound
  assert.match(a('Elche', 'AC Milan'), /Only an AC Milan/);
});

test('double chance names the teams', () => {
  const d = mkt({ market: 'double_chance', outcome: '1X', home: 'Genoa', away: 'Sudtirol', odds: 1.15 });
  assert.equal(d.name, 'Genoa to win or draw');
  assert.match(d.wins, /Only a Sudtirol win loses/);
});

test('goals markets say a whole number of goals', () => {
  const over = mkt({ market: 'over_under_25', outcome: 'over', line: 2.5, odds: 1.8 });
  assert.match(over.wins, /^3 goals or more/);
  const under = mkt({ market: 'over_under_35', outcome: 'under', line: 3.5, odds: 1.62 });
  assert.match(under.wins, /^3 goals or fewer/);
});

test('every market shows what a stake returns', () => {
  assert.equal(returned(2.35, 10), '£23.50');
  assert.equal(returned(2, 10), '£20');
  const d = mkt({ market: '1x2', outcome: 'HOME', home: 'Arsenal', away: 'Spurs', odds: 1.75 });
  assert.equal(d.returns, '£10 returns £17.50');
});

test('no description uses the private vocabulary', () => {
  const cases = [
    { market: 'asian_handicap', outcome: 'HOME', line: -0.75 },
    { market: 'asian_handicap', outcome: 'AWAY', line: -1.25 },
    { market: 'double_chance', outcome: '1X' },
    { market: 'draw_no_bet', outcome: 'HOME' },
    { market: 'over_under_25', outcome: 'over', line: 2.5 },
    { market: 'total_corners', outcome: 'under', line: 9.5 },
    { market: 'btts', outcome: 'yes' },
    { market: '1x2', outcome: 'DRAW' },
  ];
  for (const c of cases) {
    const d = mkt({ ...c, home: 'Arsenal', away: 'Chelsea', odds: 2.1 });
    const text = [d.name, d.plain, d.wins, d.returns].join(' ');
    const bad = findBanned(text);
    assert.equal(bad.length, 0, `${c.market}/${c.outcome}: ${JSON.stringify(bad)} in "${text}"`);
  }
});
