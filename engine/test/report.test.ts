import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseIncidents, parsePlayerStats, parseReportLineups, parseTeamStats } from '../src/report.ts';

/**
 * Shapes as the probe printed them for Valencia v Real Sociedad, September
 * 2026 (npm run probe:report). Values are made up; the field names are not.
 */
const incidents = {
  event_id: 1,
  incidents: [
    { type: 'period', text: 'FT', minute: 90, is_live: false, home_score: 2, away_score: 3 },
    { type: 'substitution', minute: 61, is_home: true, player_in: 'L. Rioja', player_out: 'A. Danjuma', player_in_id: 5, player_out_id: 6, added_time: null },
    { type: 'card', minute: 88, player: 'O. S. Óskarsson', reason: 'Argument', is_home: false, card_type: 'yellowRed', player_id: 9, added_time: null },
    { type: 'goal', assist: 'C. Soler', minute: 12, player: 'A. Barrenetxea', is_home: false, goal_type: 'regular', player_id: 7, added_time: null, home_score: 0, away_score: 1 },
    { type: 'period', text: 'HT', minute: 45, is_live: false, home_score: 1, away_score: 1 },
    { type: 'goal', assist: null, minute: 45, player: 'H. Duro', is_home: true, goal_type: 'penalty', player_id: 8, added_time: 2, home_score: 1, away_score: 1 },
    // An own goal: the feed marks the scorer's team, the score says who it
    // counted for.
    { type: 'goal', assist: null, minute: 70, player: 'C. Mosquera', is_home: true, goal_type: 'ownGoal', player_id: 10, added_time: null, home_score: 1, away_score: 2 },
    { type: 'injuryTime', length: 4, minute: 90 },
    { type: 'card', minute: 30, player: 'J. Guerra', reason: 'Foul', is_home: true, card_type: 'yellow', player_id: 11, added_time: null },
  ],
};

test('incidents become a timeline in match order, with the half-time score', () => {
  const { events, ht } = parseIncidents(incidents);
  assert.deepEqual(ht, [1, 1]);
  assert.deepEqual(events.map((e) => `${e.t}@${e.minute}${e.added ? `+${e.added}` : ''}`),
    ['goal@12', 'card@30', 'goal@45+2', 'sub@61', 'goal@70', 'card@88']);
  const first = events[0];
  assert.ok(first && first.t === 'goal');
  assert.equal(first.player, 'A. Barrenetxea');
  assert.equal(first.assist, 'C. Soler');
  assert.equal(first.side, 'away');
  assert.deepEqual(first.score, [0, 1]);
});

test('an own goal is credited to the side whose score went up', () => {
  const { events } = parseIncidents(incidents);
  const og = events.find((e) => e.t === 'goal' && e.kind === 'ownGoal');
  assert.ok(og && og.t === 'goal');
  assert.equal(og.side, 'away', 'Mosquera put it in his own net, so it is an away goal');
});

test('cards tell a second yellow from a straight red, and a sub carries both names', () => {
  const { events } = parseIncidents(incidents);
  const cards = events.filter((e) => e.t === 'card');
  assert.deepEqual(cards.map((c) => c.t === 'card' && c.card), ['yellow', 'second_yellow']);
  const sub = events.find((e) => e.t === 'sub');
  assert.ok(sub && sub.t === 'sub');
  assert.equal(sub.in, 'L. Rioja');
  assert.equal(sub.out, 'A. Danjuma');
  assert.equal(sub.side, 'home');
});

test('player stats keep the fields a line-up shows and nothing else', () => {
  const rows = parsePlayerStats({
    event_id: 1, count: 1,
    player_stats: [{ id: 99, player_id: 7, event_id: 1, team_id: 20, minutes_played: 90, rating: 8.1, goals: 1, goal_assist: 0,
      yellow_card: 0, red_card: 0, saves: 0, total_shots: 3, shots_on_target: 2, key_pass: 1, touches: 50 }],
  });
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], { id: 7, team_id: 20, minutes: 90, rating: 8.1, goals: 1, assists: 0, yellow: 0, red: 0, saves: 0, shots: 3, on_target: 2, key_passes: 1 });
});

test('team totals come out under plain names', () => {
  const st = parseTeamStats({ event_id: 1, stats: {
    home: { ball_possession: 58, total_shots: 14, shots_on_target: 5, corner_kicks: 7, fouls: 11, yellow_cards: 2, red_cards: null, big_chances: 3, passes: 500, pass_accuracy_pct: 84, offsides: 1, goalkeeper_saves: 2 },
    away: { ball_possession: 42, total_shots: 9, shots_on_target: 4, corner_kicks: 3, fouls: 14, yellow_cards: 3, red_cards: 1, big_chances: 2, passes: 360, pass_accuracy_pct: 78, offsides: 2, goalkeeper_saves: 3 },
  } });
  assert.ok(st);
  assert.equal(st.home.possession, 58);
  assert.equal(st.away.red, 1);
  assert.equal(st.home.red, null);
  assert.equal(parseTeamStats({ event_id: 1 }), null);
});

test('the confirmed sheet lists starters then the bench', () => {
  const l = parseReportLineups({ lineups: {
    home: { formation: '4-3-3', players: [{ id: 1, name: 'A', position: 'G', jersey_number: 1, captain: true }],
      substitutes: [{ id: 2, name: 'B', position: 'F', jersey_number: 9, captain: false }] },
    away: { formation: null, players: [], substitutes: [] },
  } });
  assert.ok(l);
  assert.equal(l.home?.formation, '4-3-3');
  assert.deepEqual(l.home?.players.map((p) => [p.name, p.starting, p.number, p.captain]), [['A', true, 1, true], ['B', false, 9, false]]);
  assert.equal(l.away, null, 'a side with nobody on it is absent, not an empty list');
});
