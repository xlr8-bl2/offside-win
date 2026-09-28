import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crossForm, type MatchMeta, type StatRow } from '../src/context/players.ts';
import { pubFacts } from '../src/narrate/facts.ts';

/**
 * A player's form across club and country (players.ts, crossForm). The case
 * is Lukaku's shape in the autumn after a World Cup: a club season at
 * Fenerbahce, five games at the World Cup in the summer, and a Nations League
 * double-header in the October break.
 */

const DAY = 86400;
const at = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d, 19) / 1000;
const FENER = 100, BELGIUM = 488;
let ev = 1;
const meta = new Map<number, MatchMeta>();
const game = (team: number, kickoff: number, goals: number, league: string, assists = 0, minutes = 90): StatRow => {
  const id = ev++;
  meta.set(id, {
    id, kickoff, home_team_id: team, away_team_id: 999, home_goals: goals, away_goals: 0,
    home: team === BELGIUM ? 'Belgium' : 'Fenerbahce', away: 'Someone', league,
  });
  return { event_id: id, team_id: team, minutes, rating: 7, goals, assists, keyPasses: 0, bigChances: 0, shots: 2, defensive: 0, saves: 0, conceded: 0, kickoff };
};

const rows: StatRow[] = [
  // The World Cup, June and July.
  game(BELGIUM, at(2026, 6, 15), 1, 'FIFA World Cup 2026'),
  game(BELGIUM, at(2026, 6, 20), 0, 'FIFA World Cup 2026'),
  game(BELGIUM, at(2026, 6, 25), 1, 'FIFA World Cup 2026'),
  game(BELGIUM, at(2026, 7, 1), 0, 'FIFA World Cup 2026'),
  game(BELGIUM, at(2026, 7, 5), 0, 'FIFA World Cup 2026'),
  // The club season from mid-August.
  game(FENER, at(2026, 8, 16), 1, 'Super Lig'),
  game(FENER, at(2026, 8, 23), 2, 'Super Lig'),
  game(FENER, at(2026, 8, 30), 0, 'Super Lig'),
  game(FENER, at(2026, 9, 13), 1, 'Super Lig'),
  game(FENER, at(2026, 9, 20), 0, 'Super Lig'),
  game(FENER, at(2026, 9, 27), 1, 'Super Lig'),
  game(FENER, at(2026, 10, 4), 0, 'Super Lig'),
  // The October break.
  game(BELGIUM, at(2026, 10, 9), 1, 'UEFA Nations League'),
];
const since = at(2026, 8, 1);

test('in a Belgium match: the Fenerbahce season, the caps, the World Cup, all read together', () => {
  const x = crossForm(rows, meta, { clubId: FENER, nationalId: BELGIUM, since, kickoff: at(2026, 10, 12), national: true });
  assert.equal(x.club.length, 7, 'the club season is the club\'s games only');
  assert.equal(x.club.reduce((a, r) => a + r.goals, 0), 5);
  assert.equal(x.country?.team, 'Belgium');
  assert.equal(x.country?.apps, 6);
  assert.deepEqual([x.country?.tournament?.name, x.country?.tournament?.apps, x.country?.tournament?.goals], ['FIFA World Cup 2026', 5, 2]);
  assert.deepEqual(x.country?.lately, { apps: 1, goals: 1, assists: 0 }, 'the break so far');
  // The last five run across the break: one for Belgium, four for the club.
  assert.equal(x.recent.length, 5);
  assert.equal(x.recentCountry, 1);
  assert.deepEqual(x.load, { games: 2, minutes: 180, country: 1 });
});

test('back at the club after the break: the break is what is new', () => {
  const x = crossForm(rows, meta, { clubId: FENER, nationalId: BELGIUM, since, kickoff: at(2026, 10, 18), national: false });
  assert.equal(x.club.length, 7);
  assert.deepEqual(x.country?.lately, { apps: 1, goals: 1, assists: 0 });
  const facts = pubFacts({
    home: 'Fenerbahce', away: 'Besiktas', now: at(2026, 10, 18),
    players: [{
      id: 1, name: 'Romelu Lukaku', side: 'home', status: 'fit', role: 'ATT', importance: 0.4,
      season: { apps: 7, goals: 5 },
      recent: { apps: 5, goals: 3, assists: 0, scoredIn: 1, country: 1 },
      country: x.country, load: x.load,
    }],
  }).map((f) => f.text);
  assert.ok(facts.includes('Romelu Lukaku has three goals in the last five games for club and country'), facts.join(' | '));
});

test('in the country\'s match the writer is told both, and a national side never pays a fee', () => {
  const x = crossForm(rows, meta, { clubId: FENER, nationalId: BELGIUM, since, kickoff: at(2026, 10, 12), national: true });
  const lukaku = {
    id: 1, name: 'Romelu Lukaku', side: 'home' as const, status: 'fit' as const, role: 'ATT', importance: 0.3,
    club: 'Fenerbahce', season: { apps: 7, goals: 5, team_games: 7 },
    recent: { apps: 5, goals: 3, assists: 0, scoredIn: 1, country: 1 },
    country: x.country, load: x.load,
  };
  const facts = pubFacts({
    home: 'Belgium', away: 'France', now: at(2026, 10, 12),
    players: [lukaku],
    extras: {
      teams: { home: BELGIUM, away: 2 }, referee: null, managers: { home: null, away: null }, best_xi: [],
      // Bad data on purpose: a fee pinned to the national side.
      players: { '1': { caps: 119, goals: 85, country: 'Belgium', signed: { from: 'Chelsea', fee: 30_000_000, at: at(2026, 7, 1) } } },
    },
  }).map((f) => f.text);
  const all = facts.join(' | ');
  assert.ok(facts.includes('Romelu Lukaku has five goals for Fenerbahce this season'), all);
  assert.ok(facts.includes('Romelu Lukaku has three goals in the last six games for Belgium'), all);
  assert.ok(facts.includes('Romelu Lukaku scored twice in five games at the World Cup in the summer'), all);
  assert.ok(!/paid|€/.test(all), 'no transfer fee against a national side');
});

test('the country is named even when the match table does not know the national team', () => {
  const bare = new Map([...meta].map(([k, v]) => [k, { ...v, home: null, away: null }]));
  const x = crossForm(rows, bare, { clubId: FENER, nationalId: BELGIUM, since, kickoff: at(2026, 10, 18), national: false, countryName: 'Belgium' });
  assert.equal(x.country?.team, 'Belgium');
});
