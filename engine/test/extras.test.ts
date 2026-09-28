import { test } from 'node:test';
import assert from 'node:assert/strict';
import { miniMatches, nationalTeam, parseBestXi, recentSigning, recordVs } from '../src/context/extras.ts';

/**
 * The pub knowledge around a match (context/extras.ts): shapes are the
 * provider's, from probe:extras.
 */

const NOW = Date.UTC(2026, 8, 28) / 1000;

test('a manager\'s record against an opponent counts every job, from their side of each game', () => {
  const rows = miniMatches([
    // At club 10, beat 20 at home.
    { event_date: '2026-03-01T15:00:00Z', status: 'finished', home_team_id: 10, away_team_id: 20, home_score: 2, away_score: 0 },
    // At club 30 (an earlier job), lost away at 20.
    { event_date: '2024-10-01T15:00:00Z', status: 'finished', home_team_id: 20, away_team_id: 30, home_score: 3, away_score: 1 },
    // Drew at home to 20.
    { event_date: '2025-02-01T15:00:00Z', status: 'finished', home_team_id: 10, away_team_id: 20, home_score: 1, away_score: 1 },
    // Somebody else entirely.
    { event_date: '2026-04-01T15:00:00Z', status: 'finished', home_team_id: 10, away_team_id: 40, home_score: 5, away_score: 0 },
    // Not played yet.
    { event_date: '2026-11-01T15:00:00Z', status: 'notstarted', home_team_id: 20, away_team_id: 10, home_score: null, away_score: null },
  ]);
  const r = recordVs(rows, 20, NOW)!;
  assert.deepEqual([r.w, r.d, r.l], [1, 1, 1]);
  assert.deepEqual(r.last, { kickoff: Date.UTC(2026, 2, 1, 15) / 1000, score: '2-0', result: 'W' }, 'the last meeting, from the manager\'s side');
  assert.equal(recordVs(rows, 99, NOW), null, 'never met');
  assert.equal(recordVs(rows, 20, Date.UTC(2024, 0, 1) / 1000), null, 'nothing before the fixture');
});

test('a signing is the recent paid move into this club, and nothing else', () => {
  const raw = { transfers: [
    { transfer_date: '2026-07-01', from_team_name: 'Borussia Dortmund', to_team_id: 12, fee_eur: 60_000_000 },
    { transfer_date: '2024-01-01', from_team_name: 'Red Bull Salzburg', to_team_id: 92, fee_eur: 20_000_000 },
  ] };
  assert.deepEqual(recentSigning(raw, 12, NOW), { from: 'Borussia Dortmund', fee: 60_000_000, at: Date.UTC(2026, 6, 1) / 1000 });
  assert.equal(recentSigning(raw, 92, NOW), null, 'too long ago');
  const loan = { transfers: [{ transfer_date: '2026-08-01', from_team_name: 'X', to_team_id: 12, fee_eur: null }] };
  assert.equal(recentSigning(loan, 12, NOW), null, 'a loan or a free has no figure');
});

test('caps and goals for a country, when there are any', () => {
  assert.deepEqual(nationalTeam({ player_id: 852, national_team_id: 488, caps: 51, goals: 55 }), { caps: 51, goals: 55, team_id: 488 });
  assert.equal(nationalTeam({ player_id: 1, national_team_id: null, caps: 0, goals: 0 }), null);
});

test('the team of the season, kept to these two sides', () => {
  const raw = { lineup: {
    G: [{ player_id: 482, player_name: 'Bart Verbruggen', team_id: 5, matches: 5, goals: 0, assists: 0 }],
    D: [{ player_id: 425, player_name: 'Marc Guéhi', team_id: 12, matches: 5, goals: 1, assists: 1 }],
    F: [{ player_id: 852, player_name: 'Erling Haaland', team_id: 12, matches: 5, goals: 9, assists: 1 }],
  } };
  const best = parseBestXi(raw, [12, 9]);
  assert.deepEqual(best.map((b) => [b.name, b.position]), [['Marc Guéhi', 'D'], ['Erling Haaland', 'F']]);
});

test('the extras become lines a supporter would say, with no decimal and no pronoun', async () => {
  const { pubFacts, feeWord, windowWord } = await import('../src/narrate/facts.ts');
  const { findBanned } = await import('../src/vocabulary.ts');
  assert.equal(feeWord(60_000_000), '€60m');
  assert.equal(feeWord(8_500_000), '€9m', 'rounded, never a decimal');
  assert.equal(windowWord(Date.UTC(2026, 6, 1) / 1000, NOW), 'in the summer');
  assert.equal(windowWord(Date.UTC(2026, 0, 20) / 1000, NOW), 'in January');
  assert.equal(windowWord(Date.UTC(2025, 7, 1) / 1000, NOW), 'in the summer of 2025');
  const facts = pubFacts({
    home: 'Manchester City', away: 'Arsenal', now: NOW,
    players: [
      { id: 852, name: 'Erling Haaland', side: 'home', status: 'fit' },
      { id: 425, name: 'Marc Guéhi', side: 'home', status: 'out' },
    ],
    extras: {
      teams: { home: 12, away: 42 },
      referee: { name: 'Michael Oliver', matches: 20, yellows: 70, usual: 72, reds: 1 },
      managers: {
        home: { id: 1, name: 'Pep Guardiola', vs: { w: 9, d: 2, l: 1, last: null } },
        away: { id: 2, name: 'Mikel Arteta', vs: { w: 0, d: 2, l: 6, last: null } },
      },
      best_xi: [
        { id: 425, name: 'Marc Guéhi', team_id: 12, position: 'D', matches: 5, goals: 1, assists: 1 },
        { id: 852, name: 'Erling Haaland', team_id: 12, position: 'F', matches: 5, goals: 9, assists: 1 },
      ],
      players: { '852': { caps: 51, goals: 55, country: 'Norway', signed: { from: 'Borussia Dortmund', fee: 60_000_000, at: Date.UTC(2026, 6, 1) / 1000 } } },
    },
  });
  const text = facts.map((f) => f.text);
  assert.ok(text.includes('Pep Guardiola has won nine of twelve games against Arsenal'), text.join(' | '));
  assert.ok(text.includes('Mikel Arteta has never beaten Manchester City in eight attempts'));
  assert.ok(text.includes('Marc Guéhi, in the league\'s team of the season so far, is out'));
  assert.ok(text.includes('Erling Haaland is in the league\'s team of the season so far'));
  assert.ok(text.includes('Manchester City paid €60m to bring Erling Haaland from Borussia Dortmund in the summer'));
  assert.ok(text.includes('Erling Haaland has 55 goals in 51 games for Norway'));
  assert.ok(text.includes('Michael Oliver has the whistle'));
  for (const t of text) {
    assert.equal(findBanned(t).length, 0, `banned in: ${t}`);
    assert.ok(!/\b(he|his|him|she|her)\b/i.test(t), `pronoun in: ${t}`);
    assert.ok(!/\d\.\d/.test(t), `decimal in: ${t}`);
  }
});

test('form against the table: the split the provider gives, said only when it is a story', async () => {
  const { parseTableSplit } = await import('../src/context/extras.ts');
  const { pubFacts } = await import('../src/narrate/facts.ts');
  const split = parseTableSplit({ vs_stronger: { won: 0, drawn: 1, lost: 4 }, vs_weaker: { won: 4, drawn: 1, lost: 0 } });
  assert.deepEqual(split, { above: { w: 0, d: 1, l: 4 }, below: { w: 4, d: 1, l: 0 } });
  assert.equal(parseTableSplit({ vs_stronger: { won: 0, drawn: 0, lost: 0 } }), null);
  const base = { teams: { home: 1, away: 2 }, referee: null, managers: { home: null, away: null }, best_xi: [], players: {} };
  // Necaxa (14th) host Club América (2nd): América are above them.
  const text = pubFacts({
    home: 'Club Necaxa', away: 'Club América',
    standings: { home: { position: 14 }, away: { position: 2 }, size: 18 },
    extras: { ...base, split: { home: split, away: { above: null, below: { w: 5, d: 0, l: 0 } } } },
  }).map((f) => f.text);
  assert.ok(text.includes('Club Necaxa have won none of their last five against sides above them in the table'), text.join(' | '));
  assert.ok(text.includes('Club América have won five of their last five against sides below them in the table'));
});
