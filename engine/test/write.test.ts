import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pubFacts } from '../src/narrate/facts.ts';
import { buildPrompt, validate, write, type WriteRequest, type Writer } from '../src/narrate/write.ts';

const REQ: WriteRequest = {
  home: 'Sarpsborg 08',
  away: 'KFUM Oslo',
  competition: 'Eliteserien',
  call: 'Sarpsborg 08 to win or draw',
  facts: [
    { text: 'Sarpsborg 08 have lost two of their last six', side: 'home', weight: 75 },
    { text: 'KFUM Oslo have won three of their last six', side: 'away', weight: 70 },
    { text: 'the new manager has had four games in charge at KFUM Oslo', side: 'away', weight: 80 },
    { text: 'KFUM Oslo travel badly', side: 'away', weight: 60 },
  ],
};

const stub = (reply: string | (() => string)): Writer => ({
  name: 'stub',
  generate: async () => (typeof reply === 'function' ? reply() : reply),
});

/* ------------------------------------------------------------ translation */

test('the evidence arrives as lines a supporter would say', () => {
  const facts = pubFacts({
    home: 'Arsenal',
    away: 'Chelsea',
    form: {
      home: { record: '4-1-1', matches: 6, ppg: 2.17, venue_ppg: 2.5, clean_sheets: 4, streak: 'won', sequence: 'LWWWWW' },
      away: { record: '1-1-4', matches: 6, ppg: 0.67, venue_ppg: 0.4, clean_sheets: 0, streak: 'none', sequence: 'LLWLDL' },
    },
    ledger: [],
  });
  const text = facts.map((f) => f.text).join(' | ');

  assert.match(text, /Arsenal have won four of their last six/);
  assert.match(text, /Chelsea have lost four of their last six/);
  assert.match(text, /Arsenal have won five in a row/);
  assert.match(text, /Arsenal have kept four clean sheets in six/);

  // The figures those came from must not survive into the output.
  assert.ok(!/2\.17|0\.67|2\.5|0\.4/.test(text), `a spreadsheet number leaked: ${text}`);
});

test('a decimal never reaches a fact', () => {
  const facts = pubFacts({
    home: 'A', away: 'B',
    form: { home: { record: '2-1-3', matches: 6, ppg: 1.17, venue_ppg: 1.33 }, away: null },
    ledger: [
      { id: 'referee.tendency', state: 'COMPUTED', evidence: { matches: 37, yellow_ratio: 1.22, yellows_per_match: 4.89 } },
      { id: 'environment.weather', state: 'COMPUTED', evidence: { temperature_c: 2, wind_kph: 41, rain_mm: 5 } },
      { id: 'fatigue.home', state: 'COMPUTED', evidence: { days_rest: 3, matches_in_14_days: 4 } },
    ],
  });
  for (const f of facts) {
    assert.ok(!/\d+\.\d/.test(f.text), `decimal in: ${f.text}`);
  }
  // And the referee's tendency survived as a comparison rather than a rate.
  assert.match(facts.map((f) => f.text).join(' '), /books more players than most/);
});

test('only computed evidence is used', () => {
  const facts = pubFacts({
    home: 'A', away: 'B', ledger: [
      { id: 'fixture.derby', state: 'THIN', evidence: { derby: true } },
      { id: 'referee.tendency', state: 'UNAVAILABLE', evidence: { yellow_ratio: 9, matches: 99 } },
    ],
  });
  assert.equal(facts.length, 0);
});

test('an unknown injury reason is not named', () => {
  const facts = pubFacts({
    home: 'Sarpsborg 08', away: 'B', ledger: [{
      id: 'availability.home.absences', state: 'COMPUTED',
      evidence: { count: 1, players: [{ player: 'Frederik Carstensen', reason: 'Unknown', goal_share: 0 }] },
    }],
  });
  assert.equal(facts[0]?.text, 'Frederik Carstensen is out for Sarpsborg 08');
});

/* -------------------------------------------------------------- the brief */

test('the prompt carries the facts and forbids the vocabulary', () => {
  const p = buildPrompt(REQ);
  assert.match(p, /Sarpsborg 08 have lost two of their last six/);
  assert.match(p, /ONLY the facts listed/);
  assert.match(p, /expected goals/);
  assert.ok(!/1\.78|83%/.test(p), 'a spreadsheet number reached the prompt');
});

/* ---------------------------------------------------------- the validator */

test('a good draft passes', () => {
  const draft = 'KFUM Oslo are not the side their record suggests, and away from home they are a '
    + 'different proposition entirely. They travel badly, and a manager four games into the job '
    + 'has not fixed that yet. Sarpsborg have lost two of their last six and are hardly flying, '
    + 'but they do not need to be. At home, against a team this poor on the road, avoiding defeat '
    + 'should be the least of it.';
  assert.deepEqual(validate(draft, REQ), []);
});

test('an invented number is rejected', () => {
  // "seven" is nowhere in the facts. This is the failure that matters: it is a
  // false statement about a real club, not a style problem.
  const draft = 'KFUM Oslo have lost seven of their last eight and travel badly, which is the whole '
    + 'story here. The new manager has had four games in charge and nothing has changed. Sarpsborg '
    + 'have lost two of their last six but at home they should be far too strong for this.';
  assert.ok(validate(draft, REQ).includes('invented-number'));
});

test('the banned vocabulary is rejected', () => {
  const draft = 'KFUM Oslo travel badly and the new manager has had four games in charge. Our model '
    + 'makes this a clear edge, and the confidence is high. Sarpsborg have lost two of their last '
    + 'six but they are still the better side here by some distance on these numbers.';
  assert.ok(validate(draft, REQ).includes('banned-term'));
});

test('length is bounded at both ends', () => {
  assert.ok(validate('KFUM Oslo travel badly.', REQ).includes('too-short'));
  assert.ok(validate('KFUM Oslo travel badly. '.repeat(60), REQ).includes('too-long'));
});

/* ------------------------------------------------------------- the writer */

test('a valid draft is returned and tidied', async () => {
  const good = '"KFUM Oslo travel badly, and that is the whole story. The new manager has had four '
    + 'games in charge and it has changed nothing on the road. Sarpsborg have lost two of their last '
    + 'six, so nobody is claiming they are flying. They do not have to be. At home against this, '
    + 'avoiding defeat is the floor rather than the ceiling."';
  const r = await write(REQ, stub(good));
  assert.ok(r.text);
  assert.ok(!r.text!.startsWith('"'), 'the quote wrapper survived');
  assert.deepEqual(r.rejections, []);
});

test('a bad draft is retried once, then given up on', async () => {
  let calls = 0;
  const r = await write(REQ, stub(() => { calls++; return 'Our model says this is a clear edge with high confidence and real value in it.'; }));
  assert.equal(calls, 2, 'should try exactly twice');
  assert.equal(r.text, null);
  assert.ok(r.rejections.includes('banned-term'));
});

test('a second attempt can succeed', async () => {
  let calls = 0;
  const r = await write(REQ, {
    name: 'stub',
    generate: async () => {
      calls++;
      return calls === 1
        ? 'Our model has an edge here.'
        : 'KFUM Oslo travel badly and it is not close. The new manager has had four games in charge '
          + 'and the away form has not shifted an inch. Sarpsborg have lost two of their last six, '
          + 'which is nothing to shout about, but at home against a side this poor on their travels '
          + 'they only need to not lose. That is a low bar.';
    },
  });
  assert.equal(calls, 2);
  assert.ok(r.text, 'the second draft should have been accepted');
});

test('a provider failure falls back rather than throwing', async () => {
  const r = await write(REQ, {
    name: 'stub',
    generate: async () => { throw new Error('429 quota exhausted'); },
  });
  assert.equal(r.text, null);
  assert.deepEqual(r.rejections, ['error']);
});
