import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchInsights, sideInsights, teamGames } from '../src/narrate/insight.ts';
import { findBannedInProse } from '../src/vocabulary.ts';
import type { MatchRow } from '../src/types.ts';

/**
 * The reads underneath the results (insight.ts): striking ones are said, in
 * words the site may use; ordinary ones are not said at all.
 */

const row = (i: number, us: number, opp: number, homeSide: boolean, gf: number, ga: number, xf: number, xa: number, extra: Partial<MatchRow> = {}): MatchRow => ({
  id: i, league_id: 1, season_id: 1, kickoff: 1_790_000_000 - i * 604800,
  home_team_id: homeSide ? us : opp, away_team_id: homeSide ? opp : us,
  home_goals: homeSide ? gf : ga, away_goals: homeSide ? ga : gf,
  home_xg: homeSide ? xf : xa, away_xg: homeSide ? xa : xf, xg_estimated: 0,
  home_corners: 5, away_corners: 5, home_yellows: 1, away_yellows: 1, home_reds: 0, away_reds: 0,
  home_possession: 50, away_possession: 50, home_shots: 12, away_shots: 12, home_sot: 4, away_sot: 4, referee_id: null,
  ...extra,
});

test('a side out-creating everyone, and one winning games it was out-created in', () => {
  const strong = Array.from({ length: 10 }, (_, i) => row(i, 1, 100 + i, i % 2 === 0, 2, 0, 2.1, 0.6));
  const lucky = Array.from({ length: 10 }, (_, i) => row(i, 2, 200 + i, i % 2 === 1, i < 4 ? 1 : 0, 0, 0.5, i < 4 ? 1.6 : 0.7));
  const facts = matchInsights({ name: 'England', games: teamGames(strong, 1) }, { name: 'Czechia', games: teamGames(lucky, 2) });
  const text = facts.map((f) => f.text).join(' | ');
  assert.match(text, /England have created the better chances in all of their last ten games/);
  assert.match(text, /Czechia have won four of their last ten games in which the other side made the better chances/);
  assert.match(text, /This is where it is decided/);
  for (const f of facts) assert.deepEqual(findBannedInProse(f.text, [f.text]).filter((v) => !/supporter/.test(v.instead)), [], f.text);
  for (const f of facts) assert.doesNotMatch(f.text, /\d\.\d|%|expected goals|xG/, f.text);
  // They lead: above every lookup the facts module makes (form tops out at 85).
  assert.ok(facts.every((f) => f.weight >= 70));
});

test('finishing far above the chances is called out with whole numbers', () => {
  const hot = Array.from({ length: 8 }, (_, i) => row(i, 3, 300 + i, true, 2, 1, 0.9, 0.9));
  const t = sideInsights('Croatia', 'home', teamGames(hot, 3), 'home').map((f) => f.text).join(' | ');
  assert.match(t, /Croatia have scored 16 in their last eight from chances that would usually bring about 7/);
});

test('an ordinary side gets nothing: no read is better than a dull one', () => {
  // Results in line with the chances, and the chances shared about evenly.
  const plain = Array.from({ length: 10 }, (_, i) => row(i, 4, 400 + i, i % 2 === 0, [1, 2, 0, 1, 1][i % 5]!, [1, 1, 1, 0, 2][i % 5]!, [1.2, 1.6, 0.6, 1.1, 0.9][i % 5]!, [1.0, 1.3, 1.1, 0.5, 1.6][i % 5]!));
  const t = sideInsights('Slovenia', 'away', teamGames(plain, 4), 'away');
  assert.ok(t.every((f) => !/better chances in|out-created in|rarely last|better than their results|running hot|coming/.test(f.text)), t.map((f) => f.text).join(' | '));
});

test('matches with no score yet, or of other teams, are left out', () => {
  const rows = [row(1, 5, 9, true, 1, 0, 1, 1), { ...row(2, 5, 9, true, 1, 0, 1, 1), home_goals: null }, row(3, 6, 9, true, 1, 0, 1, 1)];
  assert.equal(teamGames(rows, 5).length, 1);
});

test('a draft that strings the fact lines together is sent back', async () => {
  const { copiedFact, validate } = await import('../src/narrate/write.ts');
  const facts = [{ text: 'Czechia have been out-created in all of their last eight games', side: 'away' as const, weight: 96 }];
  assert.ok(copiedFact('England will dominate. Czechia have been out-created in all of their last eight games, and it shows.', facts));
  assert.equal(copiedFact('Czechia have not made the better chances once in two months, and England should dominate.', facts), null);
  const req = { home: 'England', away: 'Czechia', competition: 'x', call: '', facts, previewOnly: true };
  const long = 'England should dominate this. ' + 'Czechia have been out-created in all of their last eight games. '.repeat(1) + 'word '.repeat(60);
  assert.ok(validate(long, req).includes('copied-fact'));
});

test("the model's working is not taken for its answer", async () => {
  const { notProse } = await import('../src/narrate/write.ts');
  assert.ok(notProse('in five of their last eight outings. Iceland struggled to create.'));
  assert.ok(notProse('Iceland look the better side. Yes, starts with results. * *Join them into an argument* about it.'));
  assert.ok(notProse('Spain should win. This uses the facts listed above, as the brief asked.'));
  assert.ok(!notProse('Spain should comfortably dominate a fading Croatia side. Croatia have won three of their last six, but those results hide a decline.'));
  assert.ok(!notProse('"Spain" is a word here, and 2-1 was the score last time.'));
});

test('with no writer, the reads become a paragraph that takes a side', async () => {
  const { fromReads } = await import('../src/narrate/rescue.ts');
  const strong = Array.from({ length: 10 }, (_, i) => row(i, 1, 100 + i, i % 2 === 0, 2, 0, 2.1, 0.6));
  const weak = Array.from({ length: 10 }, (_, i) => row(i, 2, 200 + i, i % 2 === 1, 0, 2, 0.5, 1.9));
  const facts = [
    { text: 'Spain have won four of their last six', side: 'away' as const, weight: 85 },
    ...matchInsights({ name: 'Croatia', games: teamGames(weak, 2) }, { name: 'Spain', games: teamGames(strong, 1) }),
  ];
  const text = fromReads('Croatia', 'Spain', facts)!;
  assert.ok(text, 'a paragraph');
  assert.match(text, /Spain/);
  assert.match(text, /^(Look past|Everything underneath|The results only)/, text);
  assert.match(text, /This is where it is decided/);
  // Only the reads: the lookup is not one of them.
  assert.doesNotMatch(text, /won four of their last six/);
  assert.deepEqual(findBannedInProse(text, facts.map((f) => f.text)), []);
  assert.equal(text, fromReads('Croatia', 'Spain', facts), 'the same words every run');
});

test('one read is not an argument: the grammar keeps it', async () => {
  const { fromReads } = await import('../src/narrate/rescue.ts');
  assert.equal(fromReads('A', 'B', [{ text: 'A have been out-created in all of their last eight games', side: 'home', weight: 96, lean: -1 }]), null);
  assert.equal(fromReads('A', 'B', [{ text: 'A have won four of their last six', side: 'home', weight: 85 }]), null);
});

test('fromReads never says the deciding line after the reads it is made of', async () => {
  const { fromReads } = await import('../src/narrate/rescue.ts');
  const facts = [
    { text: 'Inter have created the better chances in seven of their last nine games', side: 'home', lean: 1, weight: 10 },
    { text: 'Parma have been out-created in five of their last seven games', side: 'away', lean: -1, weight: 9 },
    { text: 'Inter have kept four clean sheets in a row', side: 'home', lean: 1, weight: 5 },
    { text: 'This is where it is decided: Inter make the better chances almost every week, and Parma have been out-created in most of their recent games', side: 'match', lean: 1, weight: 99, decides: 'home' },
  ] as any;
  const t = fromReads('Inter', 'Parma', facts);
  if (t) assert.doesNotMatch(t, /This is where it is decided/);
});
