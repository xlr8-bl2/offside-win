import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assembleProfile, forBundle, importanceOf, type MatchMeta, type PlayerSeason, type StatRow } from '../src/context/players.ts';
import { availabilityFactors } from '../src/context/availability.ts';
import { playerFacts, pubFacts } from '../src/narrate/facts.ts';
import { inventedNumber } from '../src/narrate/write.ts';
import { findBannedInProse } from '../src/vocabulary.ts';

/**
 * Who the players are, not just who is missing.
 *
 * The complaint this answers: the analysis read out a manager's games in
 * charge and a list of names, and never said why a missing player mattered.
 * These pin the three layers: the measure of how much a side loses, the facts
 * a pundit would say about the player, and the model's use of the measure.
 */

const DAY = 86400;
const KO = Date.UTC(2026, 8, 27, 15) / 1000;

function season(over: Partial<PlayerSeason> = {}): PlayerSeason {
  return {
    apps: 10, starts: 10, minutes: 900, goals: 0, assists: 0, keyPasses: 0, bigChances: 0, shots: 0,
    defensive: 0, saves: 0, cleanSheets: 0, rating: 7, teamGames: 10, teamGoals: 20,
    trackedApps: 10, trackedStarts: 10, trackedInvolvement: 0, ...over,
  };
}

test('a twenty-goal striker at a forty-goal club matters far more than a squad forward', () => {
  const star = importanceOf('ATT', season({ goals: 20, trackedInvolvement: 20, teamGoals: 40 }), 40);
  const squad = importanceOf('ATT', season({ apps: 8, trackedApps: 8, starts: 1, trackedStarts: 1, goals: 1, trackedInvolvement: 1, teamGoals: 40 }), 40);
  assert.ok(star > 0.4 && star <= 0.6, `star ${star}`);
  assert.ok(squad < 0.06, `squad ${squad}`);
});

test('a centre-back who starts every week counts, though he never scores', () => {
  const cb = importanceOf('DEF', season(), 20);
  assert.ok(cb >= 0.09 && cb <= 0.15, `cb ${cb}`);
  // The old measure, the goal share alone, made him nobody.
  assert.ok(cb > 0);
});

test('a first-choice keeper counts; a reserve keeper barely does', () => {
  const first = importanceOf('GK', season(), 20);
  const reserve = importanceOf('GK', season({ apps: 1, trackedApps: 1, starts: 1, trackedStarts: 1 }), 20);
  assert.ok(first >= 0.12, `first ${first}`);
  assert.ok(reserve < 0.03, `reserve ${reserve}`);
});

test('three games are not a season', () => {
  const early = importanceOf('ATT', season({ apps: 2, trackedApps: 2, starts: 2, trackedStarts: 2, goals: 2, trackedInvolvement: 2, teamGoals: 3, teamGames: 2 }), 3);
  const later = importanceOf('ATT', season({ apps: 10, trackedApps: 10, goals: 10, trackedInvolvement: 10, teamGoals: 15 }), 15);
  assert.ok(early < later, `${early} vs ${later}`);
});

test('no season, no importance', () => {
  assert.equal(importanceOf('ATT', null, 30), 0);
});

/* ------------------------------------------------------------ assembly */

const CLUB = 10;
function row(i: number, over: Partial<StatRow> = {}): StatRow {
  return {
    event_id: 100 + i, team_id: CLUB, minutes: 90, rating: 7.4, goals: 0, assists: 0, keyPasses: 2,
    bigChances: 0, shots: 2, defensive: 1, saves: 0, conceded: 1, kickoff: KO - (i + 1) * 7 * DAY, ...over,
  };
}
function metaFor(rows: StatRow[], opponent = (i: number) => `Opp ${i}`): Map<number, MatchMeta> {
  return new Map(rows.map((r, i) => [r.event_id, {
    id: r.event_id, kickoff: r.kickoff!, home_team_id: CLUB, away_team_id: 99, home_goals: 3, away_goals: 1,
    home: 'Arsenal', away: opponent(i),
  }]));
}

test('a profile finds the top scorer, the form, and the game that shows it', () => {
  const rows = Array.from({ length: 10 }, (_, i) => row(i, {
    goals: i < 3 ? 1 : i === 6 ? 2 : i % 2, assists: i === 6 ? 1 : 0,
  }));
  const p = assembleProfile(
    { id: 7, name: 'Bukayo Saka', side: 'home', team: 'Arsenal', teamId: CLUB, position: 'F', status: 'out', reason: 'Hamstring Injury' },
    { name: 'Bukayo Saka', position: 'F', strengths: ['Dribbling', 'Key passes'], injury_expected_return: '2026-10-18' },
    rows, metaFor(rows, (i) => (i === 6 ? 'Chelsea' : `Opp ${i}`)), { games: 10, goals: 22 },
    { scorers: [{ player_id: 7, name: 'Bukayo Saka', goals: 9, assists: 0 }, { player_id: 8, name: 'Other', goals: 4, assists: 0 }],
      assists: null, teamGoals: 22, national: false, clubId: CLUB },
  );
  assert.equal(p.season?.goals, 9);
  assert.ok(p.tags.includes('top_scorer'));
  assert.ok(p.tags.includes('ever_present'));
  assert.ok(p.tags.includes('in_form'), 'scored in the last four');
  assert.equal(p.recent?.scoredIn, 4);
  assert.equal(p.standout?.opponent, 'Chelsea');
  assert.equal(p.standout?.goals, 2);
  assert.equal(p.standout?.score, '3-1');
  assert.equal(p.standout?.won, true);
  assert.ok(p.importance > 0.25, `importance ${p.importance}`);
});

test('someone else leading the chart is not the top scorer, whatever the season total', () => {
  const rows = Array.from({ length: 8 }, (_, i) => row(i, { goals: i < 5 ? 1 : 0 }));
  const p = assembleProfile(
    { id: 7, name: 'A Player', side: 'home', team: 'Arsenal', teamId: CLUB, position: 'M', status: 'out', reason: null },
    {}, rows, metaFor(rows), { games: 8, goals: 15 },
    { scorers: [{ player_id: 8, name: 'Other', goals: 6, assists: 0 }, { player_id: 7, name: 'A Player', goals: 4, assists: 0 }],
      assists: null, teamGoals: 15, national: false, clubId: CLUB },
  );
  assert.ok(!p.tags.includes('top_scorer'));
});

test('on international duty the numbers are the club\'s and nobody is ranked', () => {
  const rows = Array.from({ length: 8 }, (_, i) => row(i, { goals: 1 }));
  const p = assembleProfile(
    { id: 9, name: 'Erling Haaland', side: 'home', team: 'Norway', teamId: 500, position: 'F', status: 'fit', reason: null },
    { current_team: { id: CLUB, name: 'Manchester City' } }, rows, metaFor(rows), { games: 8, goals: 20 },
    { scorers: [{ player_id: 9, name: 'Erling Haaland', goals: 5, assists: 0 }], assists: null, teamGoals: 9, national: true, clubId: CLUB },
  );
  assert.equal(p.club, 'Manchester City');
  assert.ok(!p.tags.includes('top_scorer'));
  const facts = playerFacts({ home: 'Norway', away: 'Portugal', players: [forBundle(p)] });
  assert.ok(facts.some((f) => f.text === 'Erling Haaland has eight goals for Manchester City this season'), facts.map((f) => f.text).join('\n'));
});

/* --------------------------------------------------------------- facts */

const saka = {
  id: 7, name: 'Bukayo Saka', side: 'home' as const, team: 'Arsenal', club: null, role: 'ATT', status: 'out' as const,
  reason: 'Hamstring Injury', expected_return: new Date(Date.now() + 20 * DAY * 1000).toISOString().slice(0, 10),
  season: { apps: 10, starts: 10, goals: 8, assists: 5, clean_sheets: 0, team_games: 10, tracked_apps: 10, tracked_starts: 10 },
  recent: { apps: 5, goals: 3, assists: 1, scoredIn: 3 },
  standout: { opponent: 'Chelsea', kickoff: Date.UTC(2026, 8, 14) / 1000, goals: 2, assists: 1, score: '3-1', won: true },
  strengths: ['Dribbling', 'Key passes'], tags: ['top_scorer', 'ever_present', 'in_form'], importance: 0.42,
};

test('an absent star is explained, not just named', () => {
  const texts = playerFacts({ home: 'Arsenal', away: 'Spurs', players: [saka] }).map((f) => f.text);
  const want = [
    'Bukayo Saka has eight goals and five assists this season and is Arsenal\'s top scorer',
    'Bukayo Saka scored twice and set up another in the 3-1 win over Chelsea on 14 September',
    'Bukayo Saka had scored in each of the last three games',
    'Bukayo Saka has started every one of Arsenal\'s ten games this season',
    'a big part of Arsenal\'s goals goes missing with Bukayo Saka',
  ];
  for (const w of want) assert.ok(texts.includes(w), `missing: ${w}\n${texts.join('\n')}`);
  assert.ok(texts.some((t) => /^Bukayo Saka is not expected back until \d+ \w+$/.test(t)));
});

test('player facts lead the absences, and every one is sayable', () => {
  const facts = pubFacts({
    home: 'Arsenal', away: 'Spurs', players: [saka],
    ledger: [{ id: 'manager.away.bounce', state: 'COMPUTED', evidence: { matches_in_charge: 5, manager: 'Thomas Frank' } }],
  });
  const text = facts.map((f) => f.text);
  // A manager's games in charge is not the lead any more.
  assert.ok(!text.some((t) => /games in charge/.test(t)));
  assert.equal(facts[0]!.text.startsWith('Bukayo Saka'), true, text.join('\n'));
  for (const t of text) {
    assert.deepEqual(findBannedInProse(t), [], t);
    assert.ok(!/\d\.\d/.test(t), `decimal in: ${t}`);
    assert.ok(!/\b(he|his|him|she|her)\b/i.test(t), `pronoun in: ${t}`);
  }
});

test('a keeper and a defender get the lines that fit them', () => {
  const texts = playerFacts({
    home: 'Arsenal', away: 'Spurs',
    players: [
      { ...saka, id: 1, name: 'David Raya', role: 'GK', season: { ...saka.season, goals: 0, assists: 0, clean_sheets: 5 }, tags: ['first_choice_keeper'], standout: null, recent: null, importance: 0.15 },
      { ...saka, id: 2, name: 'William Saliba', role: 'DEF', season: { ...saka.season, goals: 1, assists: 0 }, tags: ['ever_present', 'defensive_rock'], standout: null, recent: null, importance: 0.13 },
    ],
  }).map((f) => f.text);
  assert.ok(texts.includes('David Raya has been first choice in goal for Arsenal, with five clean sheets this season'), texts.join('\n'));
  assert.ok(texts.includes('Arsenal have to change their keeper'));
  assert.ok(texts.includes('Arsenal lose a regular from the back line'));
  // One goal from a centre-back is not a season line.
  assert.ok(!texts.some((t) => /William Saliba has one goal/.test(t)));
});

test('a draw and a defeat are said as a draw and a defeat', () => {
  const d = playerFacts({ home: 'A', away: 'B', players: [{ ...saka, standout: { ...saka.standout, score: '2-2', won: false } }] });
  assert.ok(d.some((f) => f.text.includes('in the 2-2 draw with Chelsea')));
  const l = playerFacts({ home: 'A', away: 'B', players: [{ ...saka, standout: { ...saka.standout, score: '1-2', won: false } }] });
  assert.ok(l.some((f) => f.text.includes('in the 1-2 defeat to Chelsea')));
});

test('older bundles without profiles still produce facts', () => {
  assert.deepEqual(playerFacts({ home: 'A', away: 'B' }), []);
  assert.deepEqual(playerFacts({ home: 'A', away: 'B', players: [{ name: 'X' } as never] }), []);
});

/* --------------------------------------------------------------- model */

function ctxWith(players: unknown[]) {
  const side = (id: number, name: string) => ({
    team_id: id, team_name: name, squad: [
      { id: 1, name: 'David Raya', position: 'G', availability: 'injured', injury_type: 'Knee', injury_expected_return: null },
      { id: 3, name: 'Keeper Two', position: 'G', availability: null, injury_type: null, injury_expected_return: null },
    ], scorers: [], manager: null, standing: null, recent: [], lastLineupIds: null, schedule: null,
  });
  return {
    home: side(10, 'Arsenal'), away: side(20, 'Spurs'),
    lineups: { status: 'predicted', confidence: 0.8, home: null, away: null, unavailable: [] },
    players, event: {},
  } as never;
}

test('a first-choice keeper out moves the price; an unmeasured name barely does', () => {
  const keeper = { id: 1, name: 'David Raya', side: 'home', team: 'Arsenal', club: null, role: 'GK', position: null, status: 'out', reason: 'Knee', expectedReturn: null, season: season(), recent: null, standout: null, strengths: [], tags: ['first_choice_keeper'], importance: 0.15 };
  const withProfile = availabilityFactors(ctxWith([keeper])).find((f) => f.id === 'availability.home.absences')!;
  const without = availabilityFactors(ctxWith([])).find((f) => f.id === 'availability.home.absences')!;
  const opp = (f: typeof withProfile) => f.adjustments?.find((a) => a.channel === 'goals' && a.side === 'away')?.multiplier ?? 1;
  assert.ok(opp(withProfile) > opp(without), `${opp(withProfile)} vs ${opp(without)}`);
  assert.equal(withProfile.claims?.length, 1);
  assert.match(withProfile.note, /David Raya is a real loss/);
  assert.ok(!/%/.test(withProfile.note));
});

test('the number check is blind to spelling but not to invention', () => {
  const facts = ['Arsenal have won four of their last six', 'the last meeting finished 3-1'];
  assert.equal(inventedNumber('Arsenal have won 4 of their last 6.', facts), false);
  assert.equal(inventedNumber('It finished 3–1 last time.', facts), false);
  assert.equal(inventedNumber('Arsenal have won five of their last six.', facts), true);
  assert.equal(inventedNumber('It finished 3-2 last time.', facts), true);
});

test('a return date half the list shares is a placeholder, and is not said', () => {
  const later = new Date(Date.now() + 23 * DAY * 1000).toISOString().slice(0, 10);
  const out = (id: number, name: string) => ({ ...saka, id, name, expected_return: later, standout: null, recent: null, importance: 0.05, tags: [] });
  const texts = playerFacts({ home: 'England', away: 'Czechia', players: [out(1, 'A One'), out(2, 'B Two'), out(3, 'C Three')] }).map((f) => f.text);
  assert.ok(!texts.some((t) => /not expected back/.test(t)), texts.join('\n'));
  const one = playerFacts({ home: 'England', away: 'Czechia', players: [out(1, 'A One')] }).map((f) => f.text);
  assert.ok(one.some((t) => /A One is not expected back until/.test(t)));
});
