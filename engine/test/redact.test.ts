import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freeBoard, freeBundle, freeProse, scrub, PAID_KEYS } from '../src/membership/redact.ts';

/** Every key in the payload, at any depth, so a leak cannot hide in a nest. */
function keysAnywhere(value: unknown, found = new Set<string>()): Set<string> {
  if (Array.isArray(value)) { for (const v of value) keysAnywhere(v, found); return found; }
  if (value === null || typeof value !== 'object') return found;
  for (const [k, v] of Object.entries(value)) { found.add(k); keysAnywhere(v, found); }
  return found;
}

/** Every primitive in the payload, for checking a price has not survived as a value. */
function valuesAnywhere(value: unknown, found: unknown[] = []): unknown[] {
  if (Array.isArray(value)) { for (const v of value) valuesAnywhere(v, found); return found; }
  if (value === null || typeof value !== 'object') { found.push(value); return found; }
  for (const v of Object.values(value)) valuesAnywhere(v, found);
  return found;
}

const BOARD = {
  id: 7, league: 'Eliteserien', home: 'Sarpsborg 08', away: 'KFUM Oslo',
  kickoff: 1700000000, rank: 4, confidence: 0.81,
  top_pick: { market: 'double_chance', outcome: '1X', line: null, odds: 1.18, bookmaker: '1xBet' },
  confident: [{ market: 'double_chance', outcome: '1X', odds: 1.18, bookmaker: '1xBet', caveat: false }],
  odds_1x2: { HOME: 0.56, DRAW: 0.25, AWAY: 0.19 },
  flags: [{ id: 'form.home', section: 'form', note: 'won four of six' }],
};

const BUNDLE = {
  ...BOARD,
  lineups: { status: 'confirmed', home: ['a', 'b'] },
  h2h: [{ date: 1, score: '2-1' }],
  form: { home: { record: '4-1-1' }, away: { record: '1-1-4' } },
  ledger: [
    { id: 'form.home', note: 'won four of six', evidence: { record: '4-1-1' } },
    { id: 'market.movement', note: 'the price has shortened', evidence: { open: 1.31, current: 1.18 } },
    { id: 'referee.tendency', note: 'books more players than most', evidence: { matches: 37 } },
  ],
  markets: [{ market: '1x2', best: { HOME: { odds: 1.78, bookmaker: 'bet365' } } }],
  candidates: [{ market: '1x2', outcome: 'HOME', odds: 1.78, bookmaker: 'bet365', edge: 0.06 }],
  verdicts: [{
    candidate: { market: 'double_chance', outcome: '1X', odds: 1.18, bookmaker: '1xBet', kelly: 0.03 },
    narrative: 'KFUM Oslo travel badly and the new manager has not fixed it.',
    drivers: [
      { id: 'form.away', note: 'lost four of six' },
      { id: 'market.sharp_reference', note: 'the sharp books agree' },
    ],
    set_aside: [{ id: 'fatigue.home', note: 'a normal week' }],
  }],
};

/* ------------------------------------------------------------- the board */

test('the free board keeps the fixture and loses the call', () => {
  const free = freeBoard(BOARD);
  assert.equal(free['home'], 'Sarpsborg 08');
  assert.equal(free['league'], 'Eliteserien');
  assert.equal(free['locked'], true);
  assert.equal(free['plan'], 'monthly');
  assert.ok(Array.isArray(free['flags']), 'the signal flags are analysis and stay');
  for (const k of ['top_pick', 'confident', 'odds_1x2']) {
    assert.ok(!(k in free), `${k} survived on the board card`);
  }
});

/* ------------------------------------------------------------ the bundle */

test('the free bundle keeps the argument and loses the conclusion', () => {
  const free = freeBundle(BUNDLE);

  // The analysis is the product being advertised. It must survive intact.
  const verdict = (free['verdicts'] as any[])[0]!;
  assert.equal(verdict.narrative, BUNDLE.verdicts[0]!.narrative);
  assert.deepEqual(verdict.drivers, [{ id: 'form.away', note: 'lost four of six' }]);
  assert.ok(free['lineups'], 'the team sheet stays');
  assert.ok(free['h2h'], 'head-to-head stays');
  assert.ok(free['form'], 'form stays');

  // The call does not.
  assert.ok(!('candidate' in verdict), 'the selection survived inside the verdict');
  for (const k of ['markets', 'candidates', 'top_pick', 'confident', 'odds_1x2']) {
    assert.ok(!(k in free), `${k} survived on the bundle`);
  }
});

test('factors about the price wait behind the wall, factors about football do not', () => {
  const free = freeBundle(BUNDLE);
  const ids = (free['ledger'] as any[]).map((f) => f.id);
  assert.deepEqual(ids, ['form.home', 'referee.tendency']);
  assert.ok(!ids.includes('market.movement'), 'a price factor reached a free reader');
});

/* --------------------------------------------------- the sweep behind it */

test('no paid key survives at any depth', () => {
  for (const [name, free] of [['board', freeBoard(BOARD)], ['bundle', freeBundle(BUNDLE)]] as const) {
    const present = [...keysAnywhere(free)].filter((k) => PAID_KEYS.has(k));
    assert.deepEqual(present, [], `${name} leaked: ${present.join(', ')}`);
  }
});

test('no price survives as a value either', () => {
  // The keys could be renamed and the numbers still be there. These are the
  // actual prices from the fixture above; none of them may appear anywhere.
  const prices = [1.18, 1.78, 1.31];
  for (const [name, free] of [['board', freeBoard(BOARD)], ['bundle', freeBundle(BUNDLE)]] as const) {
    const values = valuesAnywhere(free);
    for (const p of prices) {
      assert.ok(!values.includes(p), `${name} still carries the price ${p}`);
    }
  }
});

test('the sweep catches a key nobody remembered to list', () => {
  // The case this exists for: a field added to the bundle later that carries a
  // price, with no corresponding edit to freeBundle().
  const withNewField = { ...BUNDLE, live: { minute: 55, odds: 2.4, bookmaker: 'bet365' } };
  const free = freeBundle(withNewField) as any;
  assert.equal(free.live.minute, 55, 'the sweep took the whole object rather than the paid keys');
  assert.ok(!('odds' in free.live), 'a price added later reached a free reader');
  assert.ok(!('bookmaker' in free.live), 'a bookmaker added later reached a free reader');
});

test('scrub leaves anything without a paid key alone', () => {
  const plain = { a: 1, b: { c: [1, 2, { d: 'x' }] }, e: null };
  assert.deepEqual(scrub(plain), plain);
});

test('the free copy is still valid JSON and carries no undefined', () => {
  for (const free of [freeBoard(BOARD), freeBundle(BUNDLE)]) {
    const round = JSON.parse(JSON.stringify(free));
    assert.deepEqual(round, free, 'something did not survive a JSON round trip');
  }
});

/* ------------------------------------------------- prose, judged on content */

test('prose naming the call is withheld, however the keys are arranged', () => {
  // Measured from the live site: every narrative the template grammar writes
  // opens exactly like this. A key-based sweep cannot see it.
  const leaky = {
    ...BUNDLE,
    verdicts: [{ ...BUNDLE.verdicts[0]!, narrative: 'Over 1.5 goals at 1.13. Both sides are modelled to score.' }],
  };
  const free = freeBundle(leaky) as any;
  assert.equal(free.verdicts[0].narrative, null, 'a narrative naming the price reached a free reader');
});

test('prose that says nothing internal travels', () => {
  const clean = {
    ...BUNDLE,
    verdicts: [{ ...BUNDLE.verdicts[0]!, narrative: 'KFUM Oslo travel badly and a new manager has not fixed it yet.' }],
  };
  const free = freeBundle(clean) as any;
  assert.equal(free.verdicts[0].narrative, 'KFUM Oslo travel badly and a new manager has not fixed it yet.');
});

test('a factor whose note is withheld is dropped rather than emptied', () => {
  // A heading with nothing under it reads as a broken page, not a locked one.
  const withJargon = {
    ...BUNDLE,
    ledger: [
      { id: 'form.home', note: 'won four of their last six' },
      { id: 'form.away', note: 'have taken 1.83 points a game from their last 6' },
    ],
  };
  const ids = ((freeBundle(withJargon) as any).ledger as any[]).map((f) => f.id);
  assert.deepEqual(ids, ['form.home'], 'a spreadsheet number survived into the free copy');
});

test('freeProse rejects the empty and the absent rather than passing them on', () => {
  assert.equal(freeProse(''), null);
  assert.equal(freeProse('   '), null);
  assert.equal(freeProse(undefined), null);
  assert.equal(freeProse(null), null);
  assert.equal(freeProse(42), null);
});

/* ------------------------------------------------- the wall only where there is one */

test('a fixture with no call is not advertised as locked', () => {
  // Forty-four per cent of the board has no call on it. Marking those locked
  // would sell a reader something that does not exist, and they would find out
  // after paying.
  const noCall = { ...BOARD, top_pick: undefined, confident: [] };
  delete (noCall as any).top_pick;
  assert.equal(freeBoard(noCall as any)['locked'], false);

  const bundleNoCall = { ...BUNDLE, verdicts: [] };
  assert.equal(freeBundle(bundleNoCall)['locked'], false);
});

test('a fixture with a call is locked and names the plan that opens it', () => {
  assert.equal(freeBoard(BOARD)['locked'], true);
  assert.equal(freeBoard(BOARD)['plan'], 'monthly');
  assert.equal(freeBundle(BUNDLE)['locked'], true);
});

/* ------------------------------------- the two gates have to agree */

test('what the writer accepts is what a free reader may read', () => {
  // The free tier depends on this agreement. The writer's validator decides
  // whether a narrative is published at all; freeProse decides whether it may
  // be read without paying. If the first is looser than the second, every
  // narrative gets published and then silently withheld, and the free tier is
  // empty for reasons nothing reports.
  const good = 'KFUM Oslo are not the side their league position suggests, and away from home '
    + 'they are a different proposition entirely. They have lost four of their last six and a '
    + 'manager four games into the job has not fixed it. Sarpsborg are hardly flying either, but '
    + 'at home against this they do not need to be.';
  assert.ok(freeProse(good), 'a well-written narrative was withheld from free readers');

  // And the shape the template grammar actually produces, measured live.
  const template = 'Over 1.5 goals at 1.13. Expected goals total 3.23 against a line of 1.5.';
  assert.equal(freeProse(template), null, 'a narrative naming the call reached a free reader');
});

test('the members-only "why this call" never reaches the free copy', () => {
  // The preview is written to be shown to everyone and never names the call.
  // The why is the opposite: it names the call and its odds, and it is the
  // thing a member pays to read.
  const withWhy = {
    ...BUNDLE,
    verdicts: [{
      candidate: { market: 'over_under_15', outcome: 'OVER', line: 1.5, odds: 1.29 },
      narrative: 'Nice cannot keep anyone out.',
      why: 'Over 1.5 goals at odds of 1.29 because Amoura starts.',
      drivers: [], set_aside: [],
    }],
  };
  const free = JSON.stringify(freeBundle(withWhy));
  assert.ok(!free.includes('odds of 1.29'), 'the why leaked into the free copy');
  assert.ok(!free.includes('"why"'), 'the why key survived');
});

test('a locked card carries no pass note', () => {
  // The note names the nearest market and its odds, and on a called match it
  // contradicts the lock.
  const board = { ...BOARD, top_pick: { market: 'btts', odds: 1.5 }, pass: 'the closest was double chance 1X at 1.47' };
  assert.ok(!JSON.stringify(freeBoard(board)).includes('1.47'));
  const bundle = { ...BUNDLE, pass: 'the closest was double chance 1X at 1.47', pass_reason: 'x at 1.47',
    verdicts: [{ candidate: { market: 'btts' }, narrative: 'n', drivers: [], set_aside: [] }] };
  assert.ok(!JSON.stringify(freeBundle(bundle)).includes('1.47'));
});
