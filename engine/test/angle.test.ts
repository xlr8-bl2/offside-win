import { test } from 'node:test';
import assert from 'node:assert/strict';
import { angleOf, familyOf, focusFacts } from '../src/narrate/angle.ts';
import { buildPrompt, validate, type WriteRequest } from '../src/narrate/write.ts';
import type { MatchRow } from '../src/types.ts';
import type { PubFact } from '../src/narrate/facts.ts';

/** Ten finished games for team 1 (at home in the even ones) against team 9. */
function rows(score: Array<[number, number]>, extra: Partial<MatchRow> = {}): MatchRow[] {
  return score.map(([gf, ga], i) => {
    const home = i % 2 === 0;
    return {
      id: i + 1, league_id: 1, season_id: 1, kickoff: 1_000_000 - i * 1000,
      home_team_id: home ? 1 : 9, away_team_id: home ? 9 : 1,
      home_goals: home ? gf : ga, away_goals: home ? ga : gf,
      home_xg: null, away_xg: null, xg_estimated: null,
      home_corners: home ? 7 : 3, away_corners: home ? 3 : 7,
      home_yellows: 2, away_yellows: 2, home_reds: 0, away_reds: 0,
      home_possession: null, away_possession: null, home_shots: null, away_shots: null,
      home_sot: null, away_sot: null, referee_id: null, ...extra,
    };
  });
}

const CHANCES: PubFact = { text: 'Leeds have created the better chances in eight of their last ten games', side: 'home', weight: 96, lean: 1 };
const OTHER: PubFact = { text: 'Hull are without Smith up front', side: 'away', weight: 90 };

test('each market is argued as its own question', () => {
  assert.equal(familyOf('over_under_25'), 'goals');
  assert.equal(familyOf('btts'), 'btts');
  assert.equal(familyOf('total_corners'), 'corners');
  assert.equal(familyOf('red_card'), 'cards');
  assert.equal(familyOf('asian_handicap'), 'margin');
  assert.equal(familyOf('double_chance'), 'result');
  const corners = angleOf({ market: 'total_corners', outcome: 'over', line: 9.5 }, 'Leeds', 'Hull');
  const goals = angleOf({ market: 'over_under_25', outcome: 'under', line: 2.5 }, 'Leeds', 'Hull');
  assert.match(corners.question, /corners/);
  assert.match(goals.question, /goals/);
  assert.match(goals.argue, /two goals or fewer/);
  assert.match(angleOf({ market: 'double_chance', outcome: 'X2', line: null }, 'Leeds', 'Hull').argue, /Hull do not lose/);
});

test('a goals call leads on how many goals their games have had', () => {
  const home = rows([[3, 1], [2, 2], [4, 0], [1, 2], [3, 3], [2, 1], [0, 0], [3, 2]]);
  const out = focusFacts([CHANCES, OTHER], { market: 'over_under_25', outcome: 'over', line: 2.5 },
    { name: 'Leeds', id: 1, rows: home }, { name: 'Hull', id: 2, rows: [] });
  assert.match(out[0]!.text, /^Seven of Leeds's last eight games have had three goals or more$/);
  assert.ok(out.some((f) => /Leeds have scored 18 and conceded 11 in their last eight/.test(f.text)));
  // The caller's list is untouched.
  assert.equal(CHANCES.weight, 96);
});

test('a corners call puts corners first and the reads about chances last', () => {
  const home = rows([[1, 0], [2, 1], [0, 0], [1, 1], [2, 0], [1, 2]]);
  const out = focusFacts([CHANCES, OTHER], { market: 'total_corners', outcome: 'over', line: 9.5 },
    { name: 'Leeds', id: 1, rows: home }, { name: 'Hull', id: 2, rows: [] });
  assert.ok(out.slice(0, 3).every((f) => /corner/.test(f.text)), out.map((f) => f.text).join(' | '));
  assert.ok(out.some((f) => f.text === 'Leeds have won about seven corners a game and given away about three over their last six'));
  assert.ok(out.some((f) => f.text === 'All of Leeds\'s last six games have had 10 corners or more'));
  assert.equal(out[out.length - 1]!.text, CHANCES.text);
});

test('the facts it adds pass the writer\'s own number and vocabulary checks', () => {
  const home = rows([[3, 1], [2, 2], [4, 0], [1, 2], [3, 3], [2, 1], [0, 0], [3, 2], [1, 0], [0, 1]], { home_reds: 1 });
  const away = rows([[0, 1], [1, 1], [0, 2], [2, 0], [0, 0], [1, 3]]).map((r) => ({
    ...r, home_team_id: r.home_team_id === 1 ? 2 : r.home_team_id, away_team_id: r.away_team_id === 1 ? 2 : r.away_team_id,
  }));
  for (const c of [
    { market: 'over_under_25', outcome: 'over', line: 2.5 }, { market: 'btts', outcome: 'no', line: null },
    { market: '1x2', outcome: 'HOME', line: null }, { market: 'asian_handicap', outcome: 'HOME', line: -1.5 },
    { market: 'total_corners', outcome: 'over', line: 9.5 }, { market: 'red_card', outcome: 'no', line: null },
  ] as const) {
    const facts = focusFacts([], c, { name: 'Leeds', id: 1, rows: home }, { name: 'Hull', id: 2, rows: away });
    assert.ok(facts.length >= 2, c.market);
    const req: WriteRequest = { home: 'Leeds', away: 'Hull', competition: 'the Championship', call: 'x', facts };
    // A paragraph made of nothing but the facts' own words is backed throughout.
    const text = `Here is the read. ${facts.map((f) => f.text).join('. ')}. That is the game, and there is a lot more to say about it than this, so here are a few more plain words to make up the length of a real paragraph about the football.`;
    const problems = validate(text, req).filter((p) => p !== 'copied-fact' && p !== 'too-long');
    assert.deepEqual(problems, [], `${c.market}: ${text}`);
    assert.ok(!facts.some((f) => /\d\.\d/.test(f.text)), 'no decimals');
  }
});

test('the brief asks for the call\'s question, and the members\' paragraph for its own argument', () => {
  const angle = angleOf({ market: 'total_corners', outcome: 'over', line: 9.5 }, 'Leeds', 'Hull');
  const p = buildPrompt({ home: 'Leeds', away: 'Hull', competition: 'the Championship', call: 'over 9.5 corners', facts: [OTHER], odds: 1.4, angle });
  assert.match(p, /comes down to one question: how many corners/);
  assert.match(p, /Open with your take on how many corners this game produces, in one sentence/);
  assert.match(p, /Argue why the corners pile up/);
  assert.doesNotMatch(p, /Lead with what is happening underneath the results/);
  // Without an angle (a preview with no call), the brief is as it was.
  const plain = buildPrompt({ home: 'Leeds', away: 'Hull', competition: 'the Championship', call: '', facts: [OTHER], previewOnly: true });
  assert.match(plain, /Lead with what is happening underneath the results/);
});
