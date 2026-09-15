import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RepetitionLedger, narrateConfident } from '../src/narrate/compose.ts';
import { providerMarkets, parsePrediction } from '../src/provider-model.ts';
import { selectConfident } from '../src/select.ts';
import type { Candidate, Claim, Factor } from '../src/types.ts';

const ledger = () => new RepetitionLedger(40, []);

const cand = (market: string, outcome: string, line: number | null, prob: number, odds: number) =>
  ({
    market, outcome, line, push: null,
    model_prob: prob, book_prob: prob, edge: 0, shrunk_edge: 0,
    odds, bookmaker: 'pinnacle', kelly: 0,
    family: market.startsWith('over_under') ? 'goals' : 'result',
  }) as unknown as Candidate;

const claim = (predicate: string, subject: string, polarity: number, evidence: Record<string, unknown>) =>
  ({ subject, predicate, polarity, magnitude: 0.6, evidence, section: '§2.4', tier: 1 }) as unknown as Claim;

const factor = (claims: Claim[]) =>
  ({ id: 'x', section: '§2.4', tier: 1, state: 'COMPUTED', note: '', evidence: {}, adjustments: [], claims, strength: 0.8 }) as unknown as Factor;

const base = {
  homeTeam: 'IK Sirius',
  awayTeam: 'Degerfors IF',
  fixtureId: 1,
  expectedGoals: { home: 2.02, away: 0.82 },
};

test('a claim missing the evidence its frames cite is dropped, not rendered with zeros', () => {
  // The failure this prevents: "both sides average 0 points more possession
  // than , so expect one side with the ball" — confident, specific, meaningless.
  const out = narrateConfident({
    ...base,
    candidate: cand('double_chance', '1X', null, 0.86, 1.16),
    drivers: [factor([claim('style_clash', 'both sides', 1, {})])],
    ledger: ledger(),
  });
  assert.doesNotMatch(out, / 0 /, `rendered a zero from absent evidence: ${out}`);
  assert.doesNotMatch(out, /than ,|of 's|— ,/, `rendered an empty name: ${out}`);
  assert.doesNotMatch(out, /\s{2,}/, `left a gap where a value should be: ${out}`);
});

test('every sentence still appears when the evidence is there', () => {
  const out = narrateConfident({
    ...base,
    candidate: cand('double_chance', '1X', null, 0.86, 1.16),
    drivers: [factor([
      claim('absence', 'Gustafson', -1, { team: 'Degerfors IF', goal_share_pct: 34, cover_at_position: 1, role: 'ATT' }),
    ])],
    ledger: ledger(),
  });
  assert.match(out, /1\.16/, 'the price is missing');
  // Any strength_gap frame is fine — they cite the rates, the ratio, or the
  // opponent's number. Pinning one spelling makes this fail whenever a frame is
  // added, which is not a regression.
  assert.match(out, /2\.02|0\.82|2\.5 times|stronger side|better of it/, 'the mismatch is missing');
  assert.match(out, /86%/, 'the confidence is missing');
  assert.match(out, /34%/, 'the context is missing');
});

test('a bet that wins on less reads suppressing context as support', () => {
  // Rain suppresses goals, which argues FOR an under. Introducing it with
  // "Cutting the other way" would tell the reader the model missed the point.
  const out = narrateConfident({
    ...base,
    candidate: cand('over_under_35', 'under', 3.5, 0.84, 1.18),
    drivers: [factor([claim('weather', 'the pitch', -1, { temp_c: 2, wind_kph: 38, rain_mm: 9 })])],
    expectedGoals: { home: 1.02, away: 0.91 },
    ledger: ledger(),
  });
  assert.doesNotMatch(out, /Against that|Cutting the other way|counterweight|not a clean case/i,
    `suppressing context was framed as opposing an under: ${out}`);
});

test('a goals total is described as a total, not as a mismatch', () => {
  // strength_gap under an under-3.5 produced "Huracan project to score 1.1
  // times what Racing Club manage" — an argument for the opposite bet.
  const out = narrateConfident({
    ...base,
    candidate: cand('over_under_35', 'under', 3.5, 0.84, 1.18),
    drivers: [],
    expectedGoals: { home: 1.02, away: 0.91 },
    ledger: ledger(),
  });
  assert.doesNotMatch(out, /project to score|stronger side|whole case/i, `argued about sides on a totals bet: ${out}`);
  // Any of the match_shape frames is fine; what they share is that the subject
  // is the match rather than a team.
  assert.match(out, /goals market|total|goal match|between them/i, `never framed it as a total: ${out}`);
});

test('a frame never describes a high-scoring match as quiet', () => {
  const out = narrateConfident({
    ...base,
    candidate: cand('over_under_15', 'over', 1.5, 0.83, 1.2),
    drivers: [],
    expectedGoals: { home: 1.94, away: 1.31 },
    ledger: ledger(),
  });
  assert.doesNotMatch(out, /neither attack|do much damage|only projects/i, `undersold a 3.25-goal match: ${out}`);
});

test('context pulling against the call is said out loud', () => {
  const out = narrateConfident({
    ...base,
    candidate: cand('double_chance', '1X', null, 0.86, 1.16),
    drivers: [factor([
      claim('absence', 'Kalmar', -1, { team: 'IK Sirius', goal_share_pct: 29, cover_at_position: 0, role: 'ATT' }),
    ])],
    ledger: ledger(),
  });
  // The backed side losing a striker cuts against 1X, and saying so is the only
  // reason to read ours rather than the provider's bare number.
  assert.match(out, /not a clean case|holding against|spoils|reservation|before anyone|does not see/i,
    `swallowed a contradiction: ${out}`);
});

test('no context at all is stated rather than padded', () => {
  const out = narrateConfident({
    ...base,
    candidate: cand('1x2', 'HOME', null, 0.81, 1.22),
    drivers: [],
    expectedGoals: null,
    ledger: ledger(),
  });
  assert.match(out, /no contextual factor cleared/i, `invented a case from nothing: ${out}`);
});

test('two calls on one slate do not open with the same construction', () => {
  const shared = ledger();
  const drivers = [factor([
    claim('absence', 'A', -1, { team: 'X', goal_share_pct: 30, cover_at_position: 1, role: 'ATT' }),
  ])];
  const a = narrateConfident({ ...base, candidate: cand('1x2', 'HOME', null, 0.85, 1.17), drivers, ledger: shared });
  const b = narrateConfident({ ...base, fixtureId: 2, candidate: cand('1x2', 'HOME', null, 0.85, 1.17), drivers, ledger: shared });
  assert.notEqual(a, b, 'two calls read identically');
});

// ------------------------------------------------------- provider mapping

const payload = {
  markets: {
    match_result: { prob_home: 64.6, prob_draw: 21.3, prob_away: 14, predicted: 'H' },
    expected_goals: { home: 2.02, away: 0.82 },
    over_under: { prob_over_15: 77.4, prob_over_25: 55, prob_over_35: 33.2 },
    btts: { prob_yes: 49.6 },
  },
  model: { confidence: 0.6465, version: 'dc-blend-v1' },
};

test('percentages are read as percentages', () => {
  const p = parsePrediction(payload)!;
  const m = providerMarkets(p);
  const r = m.find((x) => x.market === '1x2')!;
  assert.ok(Math.abs(r.probs.get('HOME')! - 0.646) < 0.005, `home came back ${r.probs.get('HOME')}`);
  assert.ok(Math.abs([...r.probs.values()].reduce((a, b) => a + b, 0) - 1) < 1e-9, 'does not sum to one');
});

test('double chance is derived from the 1x2, so it cannot contradict it', () => {
  const m = providerMarkets(parsePrediction(payload)!);
  const r = m.find((x) => x.market === '1x2')!;
  const dc = m.find((x) => x.market === 'double_chance')!;
  assert.ok(Math.abs(dc.probs.get('1X')! - (r.probs.get('HOME')! + r.probs.get('DRAW')!)) < 1e-9);
  assert.ok(Math.abs(dc.probs.get('X2')! - (r.probs.get('DRAW')! + r.probs.get('AWAY')!)) < 1e-9);
});

test('over and under are complements', () => {
  const m = providerMarkets(parsePrediction(payload)!);
  const ou = m.find((x) => x.market === 'over_under_25')!;
  assert.ok(Math.abs(ou.probs.get('over')! + ou.probs.get('under')! - 1) < 1e-9);
  assert.equal(ou.line, 2.5);
});

test('a payload with no markets is refused rather than half-read', () => {
  assert.equal(parsePrediction({ model: { confidence: 1 } }), null);
  assert.equal(parsePrediction(null), null);
});

test('a counterweight clause never lowercases a team name', () => {
  // The live board produced "deportivo Alavés have had only 3.3 days" and
  // "aFC Ajax have had only 3.0 days" — a blind toLowerCase on the first
  // character of the clause.
  for (const [home, away] of [
    ['Deportivo Alavés', 'Valencia'],
    ['AFC Ajax', 'Willem II Tilburg'],
  ] as const) {
    const out = narrateConfident({
      candidate: cand('double_chance', '1X', null, 0.86, 1.16),
      drivers: [factor([
        claim('fatigue', home, -1, { team: home, rest_days: 3, opponent_rest_days: 7, matches_in_7: 2 }),
      ])],
      homeTeam: home, awayTeam: away, fixtureId: 9,
      expectedGoals: { home: 2.0, away: 0.9 },
      ledger: ledger(),
    });
    assert.doesNotMatch(out, /deportivo|aFC|willem/, `mangled a proper noun: ${out}`);
  }
});

test('a 94% call at 1.04 is not published', () => {
  // Correct, unusable, and it makes every other call on the page look like
  // padding. The live board offered exactly this.
  const short = cand('double_chance', '1X', null, 0.94, 1.04);
  const usable = cand('over_under_15', 'over', 1.5, 0.83, 1.18);
  const out = selectConfident([short, usable]);
  assert.deepEqual(out.map((c) => c.odds), [1.18], 'published a call at 1.04');
});

test('the backed side is never called "the better side" when it is not', () => {
  // Live board: "Sunderland are the better side at 1.21 to 1.37". A double
  // chance is often backed precisely because the side is not favoured and the
  // draw is carrying the bet.
  const out = narrateConfident({
    candidate: cand('double_chance', '1X', null, 0.8, 1.2),
    drivers: [],
    homeTeam: 'Sunderland', awayTeam: 'Leeds United', fixtureId: 77,
    expectedGoals: { home: 1.21, away: 1.37 },
    ledger: ledger(),
  });
  assert.doesNotMatch(out, /better side at 1\.21|stronger side on expected goals, 1\.21/,
    `called the weaker side the better one: ${out}`);
});
