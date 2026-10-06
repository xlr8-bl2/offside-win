/**
 * What is happening underneath the results.
 *
 * The facts the writer had were the ones anybody can look up: who is
 * injured, who starts, how long the manager has been there, how many days
 * since the last game. A reader paying for analysis already knows all of it,
 * and the owner said so in as many words: the analysis has to be the thing
 * people come to the site for, the read underneath the results, the kind of
 * thing a data service shows rather than a fixtures page.
 *
 * Every match in our history carries the chances each side created (expected
 * goals), shots, shots on target, possession and corners. Over a side's last
 * dozen games that says things the results do not:
 *
 *   - whether they are creating the better chances, game after game;
 *   - whether their results are ahead of their football (winning games they
 *     were out-created in) or behind it (losing games they controlled),
 *     which is the most reliable thing in football to turn around;
 *   - whether they are finishing above or below the chances they make;
 *   - what they give up at the back, in shots and on-target efforts;
 *   - whether they shoot from anywhere or work good chances;
 *   - whether they have the ball, and whether it turns into anything;
 *   - which way the underlying numbers have moved lately;
 *   - how all of that changes home and away.
 *
 * Each read is said the way a supporter would say it -- counts, games, whole
 * numbers -- because the voice rules (vocabulary.ts) allow nothing else on the
 * page: no decimals, no percentages, no "expected goals". "Created the better
 * chances in eight of their last ten" is the same finding, said in a pub.
 *
 * A read is only offered when it is striking; an ordinary number is not
 * insight. Weights put these above the lookups, so the writer leads on them.
 */

import type { MatchRow } from '../types.ts';
import type { PubFact } from './facts.ts';

/** One match from one side's point of view. */
export interface TeamGame {
  kickoff: number;
  venue: 'home' | 'away';
  gf: number;
  ga: number;
  xf: number | null;
  xa: number | null;
  shots: number | null;
  shotsAgainst: number | null;
  sot: number | null;
  sotAgainst: number | null;
  poss: number | null;
}

export function teamGames(rows: MatchRow[], teamId: number): TeamGame[] {
  const out: TeamGame[] = [];
  for (const r of rows) {
    if (r.home_goals === null || r.away_goals === null) continue;
    const home = Number(r.home_team_id) === Number(teamId);
    if (!home && Number(r.away_team_id) !== Number(teamId)) continue;
    const pick = <T>(h: T, a: T) => (home ? [h, a] : [a, h]) as [T, T];
    const [gf, ga] = pick(Number(r.home_goals), Number(r.away_goals));
    const xg = r.home_xg !== null && r.away_xg !== null ? pick(Number(r.home_xg), Number(r.away_xg)) : [null, null];
    const sh = r.home_shots !== null && r.away_shots !== null ? pick(Number(r.home_shots), Number(r.away_shots)) : [null, null];
    const so = r.home_sot !== null && r.away_sot !== null ? pick(Number(r.home_sot), Number(r.away_sot)) : [null, null];
    const po = r.home_possession !== null ? pick(Number(r.home_possession), Number(r.away_possession ?? 100 - Number(r.home_possession))) : [null, null];
    out.push({
      kickoff: Number(r.kickoff), venue: home ? 'home' : 'away', gf, ga,
      xf: xg[0], xa: xg[1], shots: sh[0], shotsAgainst: sh[1], sot: so[0], sotAgainst: so[1], poss: po[0],
    });
  }
  return out.sort((a, b) => b.kickoff - a.kickoff);
}

const WORD = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
const w = (x: number) => WORD[Math.round(x)] ?? String(Math.round(x));
/** How far apart the chances have to be before one side "created the better chances". */
const CLEAR = 0.35;
/** And before a result is "against the run of the chances". */
const AGAINST = 0.6;

/** "eight of their last ten", "all six", "none of their last five". */
function share(k: number, of: number): string {
  if (k === of) return of === 2 ? 'both of their last two' : `all of their last ${w(of)}`;
  if (k === 0) return `none of their last ${w(of)}`;
  return `${w(k)} of their last ${w(of)}`;
}

/** Every read worth making about one side. */
export function sideInsights(team: string, side: 'home' | 'away', games: TeamGame[], venue: 'home' | 'away'): PubFact[] {
  const out: PubFact[] = [];
  const last = games.slice(0, 10);
  const xg = last.filter((g) => g.xf !== null && g.xa !== null);

  // 1. Who creates the better chances, game after game.
  if (xg.length >= 5) {
    const better = xg.filter((g) => g.xf! - g.xa! >= CLEAR).length;
    const worse = xg.filter((g) => g.xa! - g.xf! >= CLEAR).length;
    if (better >= Math.ceil(xg.length * 0.7)) {
      out.push({ text: `${team} have created the better chances in ${share(better, xg.length)} games`, side, lean: 1, weight: 96 });
    } else if (worse >= Math.ceil(xg.length * 0.6)) {
      out.push({ text: `${team} have been out-created in ${share(worse, xg.length)} games`, side, lean: -1, weight: 96 });
    } else if (better <= 1 && worse <= 1 && xg.length >= 6) {
      out.push({ text: `${team}'s games are tight: neither side made clearly the better chances in ${share(xg.length - better - worse, xg.length)} games`, side, lean: 0, weight: 70 });
    }

    // 2. Results against the run of the chances.
    const stolen = xg.filter((g) => g.gf > g.ga && g.xa! - g.xf! >= AGAINST).length;
    const robbed = xg.filter((g) => g.gf <= g.ga && g.xf! - g.xa! >= AGAINST).length;
    const robbedLost = xg.filter((g) => g.gf < g.ga && g.xf! - g.xa! >= AGAINST).length;
    if (stolen >= 3) {
      out.push({
        text: `${team} have won ${w(stolen)} of their last ${w(xg.length)} games in which the other side made the better chances. Results like that rarely last`,
        side, lean: 0, weight: 98,
      });
    }
    if (robbed >= 3) {
      out.push({
        text: robbedLost >= 3
          ? `${team} have lost ${w(robbedLost)} of their last ${w(xg.length)} games in which they made the better chances. Their football is better than their results`
          : `${team} have failed to win ${w(robbed)} of their last ${w(xg.length)} games in which they made the better chances. Their football is better than their results`,
        side, lean: 0, weight: 98,
      });
    }

    // 3. Finishing against the chances, over the stretch.
    const goals = xg.reduce((a, g) => a + g.gf, 0);
    const chances = xg.reduce((a, g) => a + g.xf!, 0);
    const conceded = xg.reduce((a, g) => a + g.ga, 0);
    const allowed = xg.reduce((a, g) => a + g.xa!, 0);
    const span = `in their last ${w(xg.length)}`;
    if (goals - chances >= 4 && goals >= chances * 1.4) {
      out.push({ text: `${team} have scored ${goals} ${span} from chances that would usually bring about ${Math.round(chances)}. That finishing is running hot`, side, lean: 0, weight: 94 });
    } else if (chances - goals >= 4 && chances >= goals * 1.4) {
      out.push({ text: `${team} have scored only ${goals} ${span} from chances that would usually bring about ${Math.round(chances)}. The goals are coming`, side, lean: 0, weight: 94 });
    }
    if (conceded - allowed >= 4 && conceded >= allowed * 1.4) {
      out.push({ text: `${team} have conceded ${conceded} ${span} from chances that would usually cost about ${Math.round(allowed)}. They have been punished for very little`, side, lean: 0, weight: 90 });
    } else if (allowed - conceded >= 4 && allowed >= conceded * 1.4) {
      out.push({ text: `${team} have conceded only ${conceded} ${span} when the chances they allowed would usually cost about ${Math.round(allowed)}. Their goalkeeper and their luck have carried them`, side, lean: 0, weight: 92 });
    }

    // 7. Which way it is moving: the last four against the games before.
    if (xg.length >= 8) {
      const diff = (gs: TeamGame[]) => gs.reduce((a, g) => a + g.xf! - g.xa!, 0) / gs.length;
      const now = diff(xg.slice(0, 4));
      const before = diff(xg.slice(4));
      if (now - before >= 0.8 && now > 0) out.push({ text: `${team} are trending up: in their last four games they have made clearly better chances than in the games before`, side, lean: 1, weight: 84 });
      if (before - now >= 0.8 && now < 0.2) out.push({ text: `${team} are trending down: their last four games have been their poorest for the chances they make and allow`, side, lean: -1, weight: 84 });
    }

    // 8. The venue split, in the same terms.
    const here = xg.filter((g) => g.venue === venue);
    if (here.length >= 4) {
      const hb = here.filter((g) => g.xf! - g.xa! >= CLEAR).length;
      const hw = here.filter((g) => g.xa! - g.xf! >= CLEAR).length;
      const where = venue === 'home' ? 'At home' : 'Away from home';
      const kind = venue === 'home' ? 'home games' : 'away games';
      if (hb === here.length || (hb >= 4 && hb >= here.length - 1)) out.push({ text: `${where}, ${team} have made the better chances in ${share(hb, here.length)} ${kind}`, side, lean: 1, weight: 86 });
      else if (hw >= Math.ceil(here.length * 0.7)) out.push({ text: `${where}, ${team} have been out-created in ${share(hw, here.length)} ${kind}`, side, lean: -1, weight: 86 });
    }
  }

  // 4. What they give up at the back, in shots on target.
  const sotA = last.filter((g) => g.sotAgainst !== null).slice(0, 6);
  if (sotA.length >= 5) {
    const tight = sotA.filter((g) => g.sotAgainst! <= 2).length;
    const open = sotA.filter((g) => g.sotAgainst! >= 6).length;
    if (tight >= Math.ceil(sotA.length * 0.7)) out.push({ text: `${team} have let the other side put two or fewer efforts on target in ${share(tight, sotA.length)} games`, side, lean: 1, weight: 88 });
    else if (open >= Math.ceil(sotA.length * 0.6)) out.push({ text: `${team} have faced six or more efforts on target in ${share(open, sotA.length)} games. They are getting opened up`, side, lean: -1, weight: 88 });
  }

  // 5. Shooting from anywhere, or working good chances.
  const sh = last.filter((g) => g.shots !== null && g.sot !== null).slice(0, 6);
  if (sh.length >= 5) {
    const shots = sh.reduce((a, g) => a + g.shots!, 0);
    const sot = sh.reduce((a, g) => a + g.sot!, 0);
    if (shots >= 60 && sot * 4 <= shots) out.push({ text: `${team} shoot plenty but from poor positions: ${sot} on target from ${shots} shots in their last ${w(sh.length)}`, side, lean: -1, weight: 80 });
    else if (shots <= 60 && sot * 2 >= shots && shots >= 25) out.push({ text: `${team} do not shoot often but they make it count: ${sot} of their ${shots} shots in the last ${w(sh.length)} were on target`, side, lean: 1, weight: 80 });
  }

  // 6. The ball, and whether it turns into anything.
  const po = last.filter((g) => g.poss !== null && g.xf !== null && g.xa !== null).slice(0, 8);
  if (po.length >= 5) {
    const more = po.filter((g) => g.poss! >= 55);
    const sterile = more.filter((g) => g.xf! - g.xa! < CLEAR).length;
    if (more.length >= Math.ceil(po.length * 0.75)) {
      if (sterile >= Math.ceil(more.length * 0.6)) {
        out.push({ text: `${team} have most of the ball in nearly every game but it goes nowhere: in ${w(sterile)} of the ${w(more.length)} they dominated it, they did not make the better chances`, side, lean: -1, weight: 90 });
      } else {
        out.push({ text: `${team} have had most of the ball in ${share(more.length, po.length)} games, and they turn it into chances`, side, lean: 1, weight: 74 });
      }
    }
    const less = po.filter((g) => g.poss! <= 45);
    const counter = less.filter((g) => g.xf! - g.xa! >= CLEAR).length;
    if (less.length >= 4 && counter >= Math.ceil(less.length * 0.5)) {
      out.push({ text: `${team} are happy without the ball: in ${w(counter)} of the ${w(less.length)} games they had less of it, they still made the better chances`, side, lean: 1, weight: 88 });
    }
  }

  return out;
}

/**
 * Both sides, and the read that only exists when the two are put together:
 * one side's strength against the other's weakness.
 */
export function matchInsights(
  home: { name: string; games: TeamGame[] },
  away: { name: string; games: TeamGame[] },
): PubFact[] {
  const out = [
    ...sideInsights(home.name, 'home', home.games, 'home'),
    ...sideInsights(away.name, 'away', away.games, 'away'),
  ];
  const create = (gs: TeamGame[]) => { const x = gs.slice(0, 8).filter((g) => g.xf !== null && g.xa !== null); return x.length >= 5 ? x.filter((g) => g.xf! - g.xa! >= CLEAR).length / x.length : null; };
  const leak = (gs: TeamGame[]) => { const x = gs.slice(0, 8).filter((g) => g.xf !== null && g.xa !== null); return x.length >= 5 ? x.filter((g) => g.xa! - g.xf! >= CLEAR).length / x.length : null; };
  const hc = create(home.games), ac = create(away.games), hl = leak(home.games), al = leak(away.games);
  if (hc !== null && al !== null && hc >= 0.7 && al >= 0.5) {
    out.push({ text: `This is where it is decided: ${home.name} make the better chances almost every week, and ${away.name} have been out-created in most of their recent games`, side: 'match', lean: 1, weight: 99, decides: 'home' });
  } else if (ac !== null && hl !== null && ac >= 0.7 && hl >= 0.5) {
    out.push({ text: `This is where it is decided: ${away.name} make the better chances almost every week, and ${home.name} have been out-created in most of their recent games`, side: 'match', lean: 1, weight: 99, decides: 'away' });
  }
  return out;
}
