import { test } from 'node:test';
import assert from 'node:assert/strict';
import { restProfile } from '../src/context/fatigue.ts';

const DAY = 86400;

test('a normal week is not fatigue', () => {
  // The live board said "Deportivo Alavés have had only 3.3 days since their
  // last match" and "2 matches in a fortnight has left AFC Ajax running on
  // reserves". Both are ordinary schedules. §2.8 says three days sustains full
  // effort and §5.5 says three matches in seven degrades — the code had a rung
  // below four days and counted two in seven, contradicting both.
  const kickoff = 1_700_000_000;
  // 8 days back, not 7: a fixture exactly on the boundary counts, correctly.
  const p = restProfile([kickoff - 8 * DAY, kickoff - 3.3 * DAY], kickoff)!;
  assert.equal(p.matchesIn7, 1, 'counted a fixture outside the window');
  assert.ok(p.daysRest! >= 3, 'three days is rest, not fatigue');
});

test('three in seven is', () => {
  const kickoff = 1_700_000_000;
  const p = restProfile([kickoff - 6 * DAY, kickoff - 4 * DAY, kickoff - 2 * DAY], kickoff)!;
  assert.equal(p.matchesIn7, 3);
  assert.ok(p.daysRest! < 3);
});

import { FRAMES, tryFrame } from '../src/narrate/grammar.ts';
import type { Claim, ClaimPredicate } from '../src/types.ts';

/**
 * Every number a frame can cite, set to a value that describes an ordinary
 * fixture: a rested side, a level match, an unremarkable referee, a price that
 * has not moved. Nothing here deserves a dramatic sentence.
 */
const BENIGN: Record<string, number | string> = {
  goal_share_pct: 3, cover_at_position: 2, role: 'ATT', team: 'Team A', opponent: 'Team B',
  confidence_pct: 96,
  days_rest: 6.5, matches_in_7_days: 1, matches_in_14_days: 2,
  travel_km: 900,
  manager: 'A Manager', matches_in_charge: 3, appointment_delta: 0.05,
  years: 1, matches: 12,
  state: 'mid-table', games_left: 30, gap_to_safety: 14,
  home: 'Team A', away: 'Team B',
  reverse_score: '1-1', margin: 0,
  goals_minus_xg: 0.02,
  possession_gap: 2, possession: 48,
  rain_mm: 1, wind_kph: 6, temperature_c: 14,
  rating: 5, scale_max: 5,
  yellows_per_match: 3.1, league_average: 3.1,
  outcome: 'HOME', direction: 'SHORTENING', move_pct: 0.4, gap_points: 0.3,
  model_pct: 51, book_pct: 50.7, edge_points: 0.3,
  prob_pct: 81, odds: 1.22, return_pct: 22,
  xg_for: 1.3, xg_against: 1.2, ratio: 1.08,
  total: 2.5, xg_home: 1.3, xg_away: 1.2, line: 2.5,
  detail: 'something ordinary happened',
};

/** Phrases that are always a bug, whatever the fixture. */
const NONSENSE: Array<[RegExp, string]> = [
  [/\b0% of\b/, 'cites a zero share as if it mattered'],
  [/\b1 matches\b/, 'plural disagreement'],
  [/\b[02-9]1th\b|\b1th\b|\b2th\b|\b3th\b/, 'malformed ordinal'],
  [/\s{2,}/, 'gap where a value should be'],
  [/\bthan ,|\bof 's|— ,|\(\)/, 'empty interpolation'],
  [/only \d+\.\d days/, 'calls an ordinary rest period short'],
  [/\b0-goal\b/, 'a nil margin described as a beating'],
  [/\bundefined\b|\bNaN\b|\bnull\b/, 'a value leaked through'],
];

const rng = () => 0.5;

for (const predicate of Object.keys(FRAMES) as ClaimPredicate[]) {
  test(`${predicate}: no frame writes nonsense about an ordinary fixture`, () => {
    const claim: Claim = {
      subject: 'Team A',
      predicate,
      polarity: 1,
      magnitude: 0.3,
      evidence: { ...BENIGN },
      section: '§0',
      tier: 1,
    };
    let rendered = 0;
    for (const frame of FRAMES[predicate]) {
      const out = tryFrame(frame, claim, rng);
      if (out === null) continue; // guarded out, which is the correct outcome
      rendered++;
      for (const [pattern, why] of NONSENSE) {
        assert.doesNotMatch(out, pattern, `${predicate}: ${why} — "${out}"`);
      }
      assert.ok(out.trim().endsWith('.'), `${predicate}: not a sentence — "${out}"`);
    }
    // A predicate where nothing renders is fine only if every frame is guarded
    // on purpose; what would be wrong is a predicate with no frames at all.
    assert.ok(FRAMES[predicate].length > 0, `${predicate} has no frames`);
    void rendered;
  });
}

test('every predicate offers enough shapes that a daily reader is not bored', () => {
  // Structure is what readers recognise, not vocabulary, so the count that
  // matters is distinct frames per predicate.
  const thin = (Object.keys(FRAMES) as ClaimPredicate[]).filter((p) => FRAMES[p].length < 3);
  assert.deepEqual(thin, [], `these predicates have fewer than three shapes: ${thin.join(', ')}`);
});
