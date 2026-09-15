import { test } from 'node:test';
import assert from 'node:assert/strict';
import { _internals } from '../src/context/form.ts';
import { RepetitionLedger, narrateConfident } from '../src/narrate/compose.ts';
import type { Candidate, Claim, Factor } from '../src/types.ts';

const { streakOf, readForm } = _internals;

// ------------------------------------------------------------------ streaks

test('three wins is reported as a winning run, not as unbeaten', () => {
  // "Unbeaten in three" is true of three wins and understates it.
  assert.deepEqual(streakOf(['W', 'W', 'W', 'D']), { kind: 'won', length: 3 });
});

test('two of anything is not a run', () => {
  assert.equal(streakOf(['W', 'W', 'L']).kind, 'none');
  assert.equal(streakOf(['L', 'L', 'W']).kind, 'none');
});

test('a run is counted from the most recent match back', () => {
  // Won three, but lost last week: the run is over and must not be claimed.
  assert.equal(streakOf(['L', 'W', 'W', 'W']).kind, 'none');
});

test('draws extend an unbeaten run but not a winning one', () => {
  assert.deepEqual(streakOf(['D', 'W', 'D', 'W', 'L']), { kind: 'unbeaten', length: 4 });
});

// --------------------------------------------------------------- form read

const match = (id: number, homeId: number, awayId: number, hg: number, ag: number) =>
  ({ id, league_id: 1, season_id: 1, kickoff: 1_700_000_000 - id * 86400,
     home_team_id: homeId, away_team_id: awayId, home_goals: hg, away_goals: ag }) as never;

const side = (recent: unknown[]) =>
  ({ team_id: 10, team_name: 'Test FC', squad: null, scorers: null, manager: null,
     standing: null, recent, lastLineupIds: null }) as never;

test('form is read from the side\'s own point of view, home or away', () => {
  // Won 3-0 at home, lost 0-2 away, drew 1-1 away, won 2-1 at home.
  const f = readForm(side([
    match(1, 10, 20, 3, 0), match(2, 20, 10, 2, 0),
    match(3, 21, 10, 1, 1), match(4, 10, 22, 2, 1),
  ]), true)!;
  assert.equal(f.played, 4);
  assert.equal(f.wins, 2);
  assert.equal(f.draws, 1);
  assert.equal(f.losses, 1);
  assert.ok(Math.abs(f.ppg - 7 / 4) < 1e-9, `ppg was ${f.ppg}`);
  assert.equal(f.cleanSheets, 1);
});

test('the venue split is what makes "they travel badly" sayable', () => {
  // Excellent at home, dreadful away. A season average would hide it.
  const rows = [
    match(1, 10, 20, 3, 0), match(2, 10, 21, 2, 0), match(3, 10, 22, 4, 1),
    match(4, 23, 10, 3, 0), match(5, 24, 10, 2, 0), match(6, 25, 10, 1, 0),
  ];
  const home = readForm(side(rows), true)!;
  const away = readForm(side(rows), false)!;
  assert.equal(home.venue!.ppg, 3, 'perfect at home');
  assert.equal(away.venue!.ppg, 0, 'pointless away');
  assert.ok(home.venue!.ppg > home.ppg && away.venue!.ppg < away.ppg,
    'the split has to differ from the overall record or it says nothing');
});

test('too few matches is no read at all rather than a thin one', () => {
  assert.equal(readForm(side([match(1, 10, 20, 1, 0), match(2, 10, 21, 1, 0)]), true), null);
});

test('unfinished matches are not counted', () => {
  const unplayed = { ...(match(9, 10, 30, 0, 0) as never as Record<string, unknown>), home_goals: null, away_goals: null };
  const f = readForm(side([
    match(1, 10, 20, 1, 0), match(2, 10, 21, 1, 0),
    match(3, 10, 22, 1, 0), match(4, 10, 23, 1, 0), unplayed,
  ]), true)!;
  assert.equal(f.played, 4);
});

// ----------------------------------------------------------- the narrative

const cand = (market: string, outcome: string, prob: number, odds: number) =>
  ({ market, outcome, line: null, push: null, model_prob: prob, book_prob: prob,
     edge: 0, shrunk_edge: 0, odds, bookmaker: 'Pinnacle', kelly: 0, family: 'result' }) as unknown as Candidate;

const formClaim = (team: string) =>
  ({ subject: team, predicate: 'form_run', polarity: 1, magnitude: 0.7,
     evidence: { team, matches: 6, wins: 4, draws: 1, losses: 1, ppg: 2.17,
                 goals_for: 2.3, goals_against: 0.8, clean_sheets: 3,
                 streak_kind: 'unbeaten', streak_length: 5, where: 'at home' },
     section: '§2.1', tier: 2 }) as unknown as Claim;

const factor = (claims: Claim[]) =>
  ({ id: 'form.home', section: '§2.1', tier: 2, state: 'COMPUTED', note: '',
     evidence: {}, adjustments: [], claims, strength: 0.7 }) as unknown as Factor;

test('an explanation opens on the team, not on a number', () => {
  // The whole reason form exists. Before this, every narrative began
  // "meaningfully the stronger side on expected goals, 1.60 to 0.89".
  const out = narrateConfident({
    candidate: cand('double_chance', '1X', 0.84, 1.22),
    drivers: [factor([formClaim('Arsenal')])],
    homeTeam: 'Arsenal', awayTeam: 'Everton', fixtureId: 1,
    expectedGoals: { home: 2.1, away: 0.78 },
    ledger: new RepetitionLedger(40, []),
  });
  // The lead names the bet and its price; the argument starts straight after it.
  // Splitting on the first '.' finds the decimal point in "1.22", not the lead.
  assert.match(out, /at \d+\.\d\d\. Arsenal have/, `did not open on the backed side: ${out}`);
});

test('and it closes on what we expect, before the price', () => {
  const out = narrateConfident({
    candidate: cand('double_chance', '1X', 0.84, 1.22),
    drivers: [factor([formClaim('Arsenal')])],
    homeTeam: 'Arsenal', awayTeam: 'Everton', fixtureId: 2,
    expectedGoals: { home: 2.1, away: 0.78 },
    ledger: new RepetitionLedger(40, []),
  });
  assert.match(out, /Arsenal avoiding defeat/, `never named the expectation: ${out}`);
});

test('a connective never leaves a fragment in front of a number', () => {
  // "And that is what makes 2.10 against 0.78." is not a sentence.
  const out = narrateConfident({
    candidate: cand('1x2', 'HOME', 0.8, 1.3),
    drivers: [factor([formClaim('Arsenal')])],
    homeTeam: 'Arsenal', awayTeam: 'Everton', fixtureId: 3,
    expectedGoals: { home: 2.4, away: 0.7 },
    ledger: new RepetitionLedger(40, []),
  });
  assert.doesNotMatch(out, /(Which is why|So|makes|because|It follows that) \d/,
    `joined a connective to a numeral: ${out}`);
});
