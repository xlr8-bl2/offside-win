import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLineups } from '../src/context/gather.ts';

/**
 * The shape the probe actually captured from the provider. `confidence` sits
 * inside each side, not at the root — reading the root returned undefined and
 * took §3.1 rotation risk, a tier-1 factor, THIN on every fixture ever priced.
 */
const real = {
  event_id: 207819,
  lineup_status: 'predicted',
  beta: true,
  lineups: {
    home: { team_id: 1, team_name: 'Rhode Island FC', formation: '4-2-3-1', confidence: 0.72, players: [{ id: 1, name: 'A' }], substitutes: [] },
    away: { team_id: 2, team_name: 'Miami FC', formation: '4-3-3', confidence: 0.41, players: [{ id: 2, name: 'B' }], substitutes: [] },
  },
  unavailable_players: { home: [], away: [] },
  updated_at: '2026-09-14T20:36:34Z',
};

test('per-side lineup confidence is read from where the provider puts it', () => {
  const out = parseLineups(real);
  assert.equal(out.status, 'predicted');
  assert.equal(out.home?.confidence, 0.72);
  assert.equal(out.away?.confidence, 0.41);
});

test('fixture confidence takes the less settled side', () => {
  // A fixture is only as settled as its least settled team; averaging would let
  // a confident home XI hide a rotating away one.
  assert.equal(parseLineups(real).confidence, 0.41);
});

test('one side missing still yields a confidence', () => {
  const oneSided = { ...real, lineups: { home: real.lineups.home } };
  assert.equal(parseLineups(oneSided).confidence, 0.72);
});

test('no confidence anywhere stays null rather than becoming zero', () => {
  // null means "could not read it" and keeps the factor THIN. Zero would mean
  // "certain the XI is wrong", which is a different and false claim.
  const none = {
    ...real,
    lineups: { home: { formation: '4-4-2', players: [{ id: 1 }] }, away: { formation: '4-3-3', players: [{ id: 2 }] } },
  };
  assert.equal(parseLineups(none).confidence, null);
});

test('a root-level confidence is not mistaken for a side one', () => {
  // Guard against re-introducing the original bug in reverse.
  const rooted = { ...real, confidence: 0.99 };
  assert.equal(parseLineups(rooted).confidence, 0.41);
});
