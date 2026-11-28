import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pubFacts } from '../src/narrate/facts.ts';
import { chain, brief } from '../src/narrate/chain.ts';
import type { MatchRow } from '../src/types.ts';

const row = (i: number, us: number, opp: number, homeSide: boolean, gf: number, ga: number, xf: number, xa: number): MatchRow => ({
  id: i * 10 + us, league_id: 1, season_id: 1, kickoff: 1_790_000_000 - i * 604800,
  home_team_id: homeSide ? us : opp, away_team_id: homeSide ? opp : us,
  home_goals: homeSide ? gf : ga, away_goals: homeSide ? ga : gf,
  home_xg: homeSide ? xf : xa, away_xg: homeSide ? xa : xf, xg_estimated: 0,
  home_corners: 5, away_corners: 5, home_yellows: 1, away_yellows: 1, home_reds: 0, away_reds: 0,
  home_possession: 50, away_possession: 50, home_shots: 12, away_shots: 12, home_sot: 4, away_sot: 4, referee_id: null,
} as MatchRow);

// Bayern make the better chances every week; Lille are out-created.
const bayern = Array.from({ length: 10 }, (_, i) => row(i, 2, 100 + i, i % 2 === 0, 2, 0, 2.3, 0.6));
const lille = Array.from({ length: 10 }, (_, i) => row(i, 1, 200 + i, i % 2 === 1, 0, 1, 0.6, 1.6));
const kane = { name: 'Harry Kane', side: 'away', status: 'out', role: 'ATT', reason: 'Ankle Injury', tags: ['top_scorer'], importance: 0.4, season: { apps: 12, goals: 14, assists: 3 } };
const bundle = (players: unknown[], lineups: unknown = null) => ({
  home: 'LOSC Lille', away: 'FC Bayern München', players, lineups,
  matches: { home: lille, away: bayern, homeId: 1, awayId: 2 },
}) as never;

test('a chance-making record built with a player who is out is said to be, and stops leading', () => {
  // Lille 2-1 Bayern, 25 November: the write-up led on Bayern making the
  // better chances in eight of nine, with Kane, Olise and Díaz out.
  const facts = pubFacts(bundle([kane]));
  const link = facts.find((f) => /run of making the better chances came with Harry Kane/.test(f.text));
  assert.ok(link, facts.map((f) => f.text).join('\n'));
  assert.equal(link!.topic, 'missing');
  assert.ok(!facts.some((f) => f.decides === 'away'), 'the deciding line built on the record is gone');
  const lead = [...facts].sort((a, b) => b.weight - a.weight)[0]!;
  assert.equal(lead, link, `led on: ${lead.text}`);
  // Without the absence, the record stands and leads as before.
  const fit = pubFacts(bundle([{ ...kane, status: 'fit' }]));
  assert.ok(!fit.some((f) => /came with/.test(f.text)));
  assert.ok(fit.some((f) => f.decides === 'away'));
});

test("a confirmed eleven without a side's main man says so", () => {
  const xi = Array.from({ length: 11 }, (_, i) => ({ name: `Player ${'abcdefghijk'[i]}`, starting: true, position: 'M' }));
  const facts = pubFacts(bundle([{ ...kane, status: 'fit' }], { status: 'confirmed', home: { players: xi }, away: { players: xi } }));
  assert.ok(facts.some((f) => /Harry Kane, their top scorer, is not in the FC Bayern München eleven/.test(f.text)),
    facts.map((f) => f.text).join('\n'));
});

test('the brief is in the order of an argument, and no one kind of fact fills it', () => {
  const facts = pubFacts(bundle([kane]));
  const steps = chain(facts);
  assert.ok(steps.length >= 2);
  assert.match(steps[0]!.label, /^WHERE THEY ARE|^HOW THEY PLAY/);
  const play = steps.find((s) => /^HOW THEY PLAY/.test(s.label));
  if (play) {
    assert.ok(play.facts.length <= 4);
    for (const side of ['home', 'away'] as const) assert.ok(play.facts.filter((f) => f.side === side).length <= 2);
  }
  const text = brief(facts);
  assert.ok(text.indexOf('HOW THEY PLAY') < text.indexOf('WHO IS PLAYING'), text);
});
