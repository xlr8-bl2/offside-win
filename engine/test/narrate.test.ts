import { test } from 'node:test';
import assert from 'node:assert/strict';
import { narrate, narratePass, RepetitionLedger, seededRng, selectClaims } from '../src/narrate/compose.ts';
import { FRAMES } from '../src/narrate/grammar.ts';
import type { Candidate, Claim, Factor } from '../src/types.ts';

function claim(over: Partial<Claim> = {}): Claim {
  return {
    subject: 'Foden',
    predicate: 'suspension',
    polarity: -1,
    magnitude: 0.6,
    evidence: { team: 'Manchester City', goal_share_pct: 21, role: 'ATT', cover_at_position: 2 },
    section: '§2.4',
    tier: 1,
    ...over,
  };
}

function factor(claims: Claim[]): Factor {
  return {
    id: 'test', section: '§2.4', tier: 1, state: 'COMPUTED',
    note: 'test', evidence: {}, adjustments: [], claims, strength: 0.8,
  };
}

function candidate(over: Partial<Candidate> = {}): Candidate {
  return {
    market: 'over_under_25', outcome: 'under', line: 2.5, push: null,
    model_prob: 0.58, book_prob: 0.52, edge: 0.06, shrunk_edge: 0.051,
    odds: 2.05, bookmaker: 'Pinnacle', prices: [{ slug: 'pinnacle', book: 'Pinnacle', odds: 2.05 }],
    kelly: 0.02, confidence: 0.7, family: 'goals',
    ...over,
  };
}

test('a narrative names the player, the number and the bet', () => {
  const text = narrate({
    candidate: candidate(),
    drivers: [factor([claim()])],
    homeTeam: 'Manchester City',
    awayTeam: 'Brighton',
    fixtureId: 101,
    ledger: new RepetitionLedger(),
  });

  assert.ok(text.includes('Foden'), 'should name the player');
  // The share is said as a fraction rather than as "21%": a bare percentage
  // standing in for an argument is the case the vocabulary rule covers, and a
  // supporter says a fifth of their goals and means the same thing.
  assert.match(text, /a fifth|a quarter|a sixth|a third|half|small share/i,
    'should cite the computed goal share');
  assert.ok(text.includes('Manchester City'), 'should name the team');
  assert.ok(/under 2\.5 goals/i.test(text), 'should state the market');
  assert.ok(text.includes('2.05'), 'should state the price');
});

test('every number printed traces back to evidence', () => {
  // The guardrail that makes generated prose safe to publish unread: a frame is
  // a function of `evidence`, so it cannot cite a figure the model never
  // computed.
  const c = claim({ evidence: { team: 'Arsenal', goal_share_pct: 33, role: 'ATT', cover_at_position: 1 } });
  const text = narrate({
    candidate: candidate({ model_prob: 0.61, book_prob: 0.5, edge: 0.11, odds: 1.95 }),
    drivers: [factor([c])],
    homeTeam: 'Arsenal', awayTeam: 'Spurs', fixtureId: 7,
    ledger: new RepetitionLedger(),
  });

  // Every figure must come from either the claim's evidence or the candidate
  // itself — the line and the price are facts about the bet being described.
  const allowed = new Set([
    '33', '1',           // claim evidence: goal share, cover at position
    '61.0', '50.0', '11.0', // model %, book %, edge points
    '2.5', '1.95',       // the candidate's own line and odds
  ]);
  const numbers = text.match(/\d+(?:\.\d+)?/g) ?? [];
  for (const num of numbers) {
    assert.ok(allowed.has(num), `number ${num} in "${text}" should come from evidence`);
  }
});

test('the same pick always reads the same way', () => {
  // Regenerating a slate must not silently rewrite yesterday's reasoning.
  const build = () =>
    narrate({
      candidate: candidate(),
      drivers: [factor([claim()])],
      homeTeam: 'City', awayTeam: 'Brighton', fixtureId: 55,
      ledger: new RepetitionLedger(),
    });
  assert.equal(build(), build());
});

test('different fixtures do not open with the same construction', () => {
  const ledger = new RepetitionLedger();
  const texts: string[] = [];
  for (let i = 0; i < 12; i++) {
    texts.push(
      narrate({
        candidate: candidate(),
        drivers: [factor([claim({ evidence: { team: `Team ${i}`, goal_share_pct: 15 + i, role: 'ATT', cover_at_position: 2 } })])],
        homeTeam: `Team ${i}`, awayTeam: 'Opponent', fixtureId: 1000 + i,
        ledger,
      }),
    );
  }

  // Compare the shape of each sentence rather than its content: two picks that
  // differ only in the team name are still the same sentence.
  const shapes = texts.map((t) =>
    t.replace(/[A-Z][a-z]+ ?\d*/g, 'X').replace(/\d+(\.\d+)?/g, 'N'),
  );
  const unique = new Set(shapes);
  assert.ok(
    unique.size >= 4,
    `12 picks produced only ${unique.size} distinct sentence shapes:\n${[...unique].join('\n')}`,
  );
});

test('consecutive picks never reuse a frame back to back', () => {
  const ledger = new RepetitionLedger();
  const frames = FRAMES.suspension;
  const seen: string[] = [];
  for (let i = 0; i < 8; i++) {
    const t = narrate({
      candidate: candidate(),
      drivers: [factor([claim()])],
      homeTeam: 'A', awayTeam: 'B', fixtureId: 2000 + i,
      ledger,
    });
    seen.push(t);
  }
  for (let i = 1; i < seen.length; i++) {
    assert.notEqual(seen[i], seen[i - 1], `pick ${i} repeats the previous one verbatim`);
  }
  assert.ok(frames.length >= 4, 'the suspension predicate should carry several frames');
});

test('opposing claims are joined by a contrastive connective', () => {
  const positive = claim({
    subject: 'Brighton', predicate: 'stakes', polarity: 1, tier: 2,
    evidence: { state: 'fighting relegation', games_left: 5 },
  });
  const negative = claim({
    subject: 'Manchester City', predicate: 'suspension', polarity: -1, tier: 1,
  });

  const text = narrate({
    candidate: candidate(),
    drivers: [factor([negative, positive])],
    homeTeam: 'Manchester City', awayTeam: 'Brighton', fixtureId: 9,
    ledger: new RepetitionLedger(),
  });

  // The reader should be able to tell the model noticed the tension.
  assert.ok(
    /against that|cutting the other way|set against|counterweight|pulling back|that said/i.test(text),
    `expected a contrastive connective in:\n${text}`,
  );
});

test('claim selection prefers variety of subject over piling on one theme', () => {
  const claims = [
    claim({ predicate: 'suspension', tier: 1, magnitude: 0.9 }),
    claim({ predicate: 'suspension', tier: 1, magnitude: 0.85, subject: 'Rodri' }),
    claim({ predicate: 'fatigue', tier: 4, magnitude: 0.5, evidence: { days_rest: 2.1, matches_in_7_days: 3, matches_in_14_days: 5 } }),
  ];
  const chosen = selectClaims(claims, 2);
  assert.equal(chosen.length, 2);
  assert.notEqual(chosen[0]!.predicate, chosen[1]!.predicate, 'should not pick two of the same predicate');
  // §12's hierarchy still decides which comes first.
  assert.equal(chosen[0]!.tier, 1);
});

test('a proper noun after a connective keeps its capital', () => {
  // "Alongside it, brighton play their fourth match" reads as a typo and undoes
  // the credibility the specificity was there to buy.
  const absence = claim({ predicate: 'suspension', tier: 1, polarity: -1 });
  const fatigue = claim({
    subject: 'Brighton', predicate: 'fatigue', tier: 4, polarity: -1, magnitude: 0.5,
    evidence: { days_rest: 2.4, matches_in_7_days: 3, matches_in_14_days: 5 },
  });

  // Sweep seeds so every frame ordering gets exercised, not just one.
  for (let i = 0; i < 40; i++) {
    const text = narrate({
      candidate: candidate(),
      drivers: [factor([absence, fatigue])],
      homeTeam: 'Manchester City', awayTeam: 'Brighton', fixtureId: 4000 + i,
      ledger: new RepetitionLedger(),
    });
    assert.ok(!/\bbrighton\b/.test(text), `lowercased a team name: ${text}`);
    assert.ok(!/\bfoden\b/.test(text), `lowercased a player name: ${text}`);
    assert.ok(
      !/\bmanchester\b/.test(text),
      `lowercased a club name: ${text}`,
    );
  }
});

test('a pass gets a real explanation rather than an empty state', () => {
  const text = narratePass(
    'Nothing is mispriced enough to call.',
    'Everton',
    'Fulham',
    42,
  );
  assert.ok(text.includes('Everton') && text.includes('Fulham'));
  // An explanation, in the reader's words rather than the engine's.
  assert.ok(/about right, so there is nothing to take/.test(text), text);
});

test('a pick with no contextual claims says so rather than inventing one', () => {
  const text = narrate({
    candidate: candidate(),
    drivers: [],
    homeTeam: 'A', awayTeam: 'B', fixtureId: 3,
    ledger: new RepetitionLedger(),
  });
  assert.ok(/pricing disagreement/i.test(text), `expected an honest fallback, got:\n${text}`);
  assert.ok(text.includes('2.05'), 'should still state the price');
});

test('seeded rng is deterministic and spreads across the unit interval', () => {
  const a = seededRng('abc');
  const b = seededRng('abc');
  const values: number[] = [];
  for (let i = 0; i < 200; i++) {
    const x = a();
    assert.equal(x, b());
    assert.ok(x >= 0 && x < 1);
    values.push(x);
  }
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  assert.ok(Math.abs(mean - 0.5) < 0.08, `mean ${mean} should be near 0.5`);
});

test('every predicate in the grammar has at least two frames', () => {
  for (const [predicate, frames] of Object.entries(FRAMES)) {
    assert.ok(frames.length >= 2, `${predicate} has only ${frames.length} frame(s)`);
  }
});

test('a pass is explained in plain words, never in the engine\'s', async () => {
  const { plainPass } = await import('../src/narrate/compose.ts');
  const technical = [
    'Nothing is mispriced enough to call. The closest was double chance X2 at 2.15, where the edge of 20.5 points does not clear the 58.1 needed against a 109.1% margin.',
    'Nothing is mispriced enough to call. The closest was 1x2 HOME at 1.40, where the model confidence of 17% is below the threshold.',
    'Only 1 of the dispositive factors — availability, stakes and regime — could be computed for this fixture.',
  ];
  for (const t of technical) {
    const out = plainPass(t);
    assert.ok(!/\d/.test(out), `a number survived: ${out}`);
    assert.ok(!/edge|margin|model|threshold|dispositive/i.test(out), `jargon survived: ${out}`);
  }
});
