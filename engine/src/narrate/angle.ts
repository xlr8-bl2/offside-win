/**
 * The angle: what this call is about, and the evidence for that question.
 *
 * Every write-up used to get the same list of facts in the same order,
 * whatever we had called. The reads underneath the results (insight.ts) weigh
 * 84 to 99, so they always led, and the brief told the writer to lead on
 * them. So a call on corners, on a red card, on under 2.5 goals or on a side
 * not losing all came out as the same paragraph about who makes the better
 * chances (owner, 3 November 2026: "it says the same thing every time ... it
 * doesn't really explain our call").
 *
 * Two things fix it, both here and both free (no extra requests to the
 * writer, no extra reads):
 *
 *   1. Facts for the market itself, from the recent matches the bundle
 *      already carries: how often each side's games go over the line, how
 *      often both score, how many corners they win and give up, how often
 *      they finish with ten men, how often they win by two or more. Said the
 *      way the rest of the facts are said, in whole numbers.
 *   2. The facts reordered for the call: the ones that speak to its question
 *      first, the rest after, so the eighteen the writer sees are the right
 *      eighteen.
 *
 * And `angleOf` gives the writer the question the paragraph is about and,
 * for members, the shape of the argument for this selection.
 */

import type { Candidate, MatchRow } from '../types.ts';
import type { PubFact } from './facts.ts';

export type Family = 'goals' | 'btts' | 'result' | 'margin' | 'corners' | 'cards';

export function familyOf(market: string): Family {
  if (market.startsWith('over_under_')) return 'goals';
  if (market === 'btts') return 'btts';
  if (market === 'asian_handicap' || market === 'european_handicap') return 'margin';
  if (market === 'total_corners' || market === 'corners_1x2') return 'corners';
  if (market === 'total_red_cards' || market === 'red_card') return 'cards';
  return 'result';
}

const WORD = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
const w = (x: number) => WORD[Math.round(x)] ?? String(Math.round(x));
/** "seven of their last ten", "all six of their last six", "none of their last eight". */
function share(k: number, of: number): string {
  if (k === of) return `all of their last ${w(of)}`;
  if (k === 0) return `none of their last ${w(of)}`;
  return `${w(k)} of their last ${w(of)}`;
}
/** The smallest whole count that clears a line: over 2.5 is "three or more". */
const clears = (line: number) => Math.floor(line) + 1;

/** One finished match from one side's point of view, with the counts the markets settle on. */
interface Game {
  venue: 'home' | 'away';
  gf: number; ga: number;
  cf: number | null; ca: number | null;
  reds: number | null; redsAgainst: number | null;
}

function gamesOf(rows: MatchRow[], teamId: number, max = 10): Game[] {
  const out: Array<Game & { k: number }> = [];
  for (const r of rows) {
    if (r.home_goals === null || r.away_goals === null) continue;
    const home = Number(r.home_team_id) === Number(teamId);
    if (!home && Number(r.away_team_id) !== Number(teamId)) continue;
    const pair = (h: number | null, a: number | null): [number | null, number | null] =>
      h === null || a === null ? [null, null] : home ? [Number(h), Number(a)] : [Number(a), Number(h)];
    const [gf, ga] = pair(r.home_goals, r.away_goals) as [number, number];
    const [cf, ca] = pair(r.home_corners, r.away_corners);
    const [rf, ra] = pair(r.home_reds, r.away_reds);
    out.push({ k: Number(r.kickoff), venue: home ? 'home' : 'away', gf, ga, cf, ca, reds: rf, redsAgainst: ra });
  }
  return out.sort((a, b) => b.k - a.k).slice(0, max);
}

interface Side { name: string; side: 'home' | 'away'; games: Game[] }

/** A fact about the call's question. They lead the list: this is what the paragraph is about. */
const fact = (text: string, side: PubFact['side'], weight = 100): PubFact => ({ text, side, weight: weight + 100 });
/** "Seven of Leeds's last ten", "All of Leeds's last ten", "None of Leeds's last ten". */
function ofTeams(k: number, of: number, team: string): string {
  const head = k === of ? 'All' : k === 0 ? 'None' : w(k).replace(/^./, (c) => c.toUpperCase());
  return `${head} of ${team}'s last ${w(of)} games`;
}

function goalsFacts(s: Side, line: number, outcome: string): PubFact[] {
  const g = s.games;
  if (g.length < 5) return [];
  const out: PubFact[] = [];
  const need = clears(line);
  const over = g.filter((x) => x.gf + x.ga >= need).length;
  const under = g.length - over;
  if (outcome === 'over' ? over >= Math.ceil(g.length * 0.5) : over >= Math.ceil(g.length * 0.7)) {
    out.push(fact(`${ofTeams(over, g.length, s.name)} have had ${w(need)} goals or more`, s.side));
  } else if (under >= Math.ceil(g.length * 0.5)) {
    out.push(fact(`${ofTeams(under, g.length, s.name)} have had ${need - 1 === 0 ? 'no goals' : `${w(need - 1)} goals or fewer`}`, s.side));
  }
  const scored = g.reduce((a, x) => a + x.gf, 0);
  const conceded = g.reduce((a, x) => a + x.ga, 0);
  out.push(fact(`${s.name} have scored ${scored} and conceded ${conceded} in their last ${w(g.length)}`, s.side, 97));
  const blank = g.filter((x) => x.gf === 0).length;
  if (blank >= 3) out.push(fact(`${s.name} have failed to score in ${share(blank, g.length)}`, s.side, 95));
  return out;
}

function bttsFacts(s: Side): PubFact[] {
  const g = s.games;
  if (g.length < 5) return [];
  const out: PubFact[] = [];
  const both = g.filter((x) => x.gf > 0 && x.ga > 0).length;
  out.push(fact(`Both sides have scored in ${ofTeams(both, g.length, s.name).replace(/^./, (c) => c.toLowerCase())}`, s.side));
  const blank = g.filter((x) => x.gf === 0).length;
  const shut = g.filter((x) => x.ga === 0).length;
  if (blank >= 2) out.push(fact(`${s.name} have failed to score in ${share(blank, g.length)}`, s.side, 98));
  if (shut >= 2) out.push(fact(`${s.name} have kept a clean sheet in ${share(shut, g.length)}`, s.side, 98));
  if (blank <= 1) out.push(fact(`${s.name} have scored in ${share(g.length - blank, g.length)}`, s.side, 98));
  return out;
}

function resultFacts(s: Side): PubFact[] {
  const out: PubFact[] = [];
  const here = s.games.filter((x) => x.venue === s.side);
  if (here.length >= 4) {
    const won = here.filter((x) => x.gf > x.ga).length;
    const lost = here.filter((x) => x.gf < x.ga).length;
    const where = s.side === 'home' ? 'home' : 'away';
    out.push(fact(`${s.name} have won ${w(won)} and lost ${w(lost)} of their last ${w(here.length)} ${where} games`, s.side));
  }
  const g = s.games;
  if (g.length >= 5) {
    const lost = g.filter((x) => x.gf < x.ga).length;
    if (lost <= 1) out.push(fact(`${s.name} have lost ${lost === 0 ? 'none' : 'only one'} of their last ${w(g.length)}`, s.side, 98));
    const drawn = g.filter((x) => x.gf === x.ga).length;
    if (drawn >= 3) out.push(fact(`${s.name} have drawn ${share(drawn, g.length)}`, s.side, 96));
  }
  return out;
}

function marginFacts(s: Side): PubFact[] {
  const g = s.games;
  if (g.length < 5) return [];
  const out: PubFact[] = [];
  const big = g.filter((x) => x.gf - x.ga >= 2).length;
  const heavy = g.filter((x) => x.ga - x.gf >= 2).length;
  const won = g.filter((x) => x.gf > x.ga).length;
  if (won) out.push(fact(`${s.name} have won ${w(won)} of their last ${w(g.length)}, ${big === 0 ? 'none of them' : big === won ? 'all of them' : w(big)} by two goals or more`, s.side));
  out.push(fact(`${s.name} have lost by two goals or more in ${share(heavy, g.length)}`, s.side, 98));
  return out;
}

function cornerFacts(s: Side, line: number | null): PubFact[] {
  const g = s.games.filter((x) => x.cf !== null && x.ca !== null);
  if (g.length < 5) return [];
  const out: PubFact[] = [];
  const won = Math.round(g.reduce((a, x) => a + x.cf!, 0) / g.length);
  const gave = Math.round(g.reduce((a, x) => a + x.ca!, 0) / g.length);
  if (won >= 1 && gave >= 1) out.push(fact(`${s.name} have won about ${w(won)} corners a game and given away about ${w(gave)} over their last ${w(g.length)}`, s.side));
  const more = g.filter((x) => x.cf! > x.ca!).length;
  out.push(fact(`${s.name} have won more corners than the other side in ${w(more)} of their last ${w(g.length)}`, s.side, 99));
  if (line !== null) {
    const need = clears(line);
    const busy = g.filter((x) => x.cf! + x.ca! >= need).length;
    out.push(fact(`${ofTeams(busy, g.length, s.name)} have had ${need} corners or more`, s.side, 99));
  }
  return out;
}

function cardFacts(s: Side): PubFact[] {
  const g = s.games.filter((x) => x.reds !== null && x.redsAgainst !== null);
  if (g.length < 5) return [];
  const out: PubFact[] = [];
  const own = g.filter((x) => x.reds! > 0).length;
  const any = g.filter((x) => x.reds! + x.redsAgainst! > 0).length;
  out.push(fact(`${s.name} have had a player sent off in ${share(own, g.length)}`, s.side));
  out.push(fact(`There has been a red card for one side or the other in ${ofTeams(any, g.length, s.name).replace(/^./, (c) => c.toLowerCase())}`, s.side, 99));
  return out;
}

/** What the existing facts say that bears on each question. */
const RELEVANT: Record<Family, RegExp> = {
  goals: /\bgoals?\b|\bscor|\bconced|clean sheet|on target|finishing|chances|opened up|meeting finished/i,
  btts: /\bscor|\bconced|clean sheet|on target|without .* up front|finishing|meeting finished/i,
  result: /\bwon\b|\blost\b|\bunbeaten\b|\bnot won\b|\bdrawn\b|\btable\b|\bplace\b|\bposition\b|\bat home\b|\btravel|decided|better chances|out-created|without|meetings/i,
  margin: /\bwon\b|\blost\b|\bby two\b|\btable\b|\bplace\b|\bposition\b|decided|better chances|out-created|opened up|without|scored/i,
  corners: /corner|most of the ball|without the ball|shoot|cross|wide/i,
  cards: /referee|book|card|sent off|derby|suspend|ban|rivals?\b|stakes|relegat|title/i,
};

/**
 * The facts for this call: its own first, then the ones that speak to its
 * question, then the rest. Weights are adjusted on copies, so the list the
 * caller holds is untouched.
 */
export function focusFacts(facts: PubFact[], c: Pick<Candidate, 'market' | 'outcome' | 'line'>, home: { name: string; id: number; rows: MatchRow[] }, away: { name: string; id: number; rows: MatchRow[] }): PubFact[] {
  const family = familyOf(c.market);
  const sides: Side[] = [
    { name: home.name, side: 'home', games: gamesOf(home.rows, home.id) },
    { name: away.name, side: 'away', games: gamesOf(away.rows, away.id) },
  ];
  const own: PubFact[] = [];
  for (const s of sides) {
    if (family === 'goals') own.push(...goalsFacts(s, c.line ?? 2.5, c.outcome));
    else if (family === 'btts') own.push(...bttsFacts(s));
    else if (family === 'result') own.push(...resultFacts(s));
    else if (family === 'margin') own.push(...marginFacts(s));
    else if (family === 'corners') own.push(...cornerFacts(s, c.market === 'total_corners' ? c.line : null));
    else own.push(...cardFacts(s));
  }
  const rel = RELEVANT[family];
  // The reads about chances are the right support for goals and results, and
  // beside the point for corners and cards: there they go below the rest.
  const offTopic = family === 'corners' || family === 'cards';
  const rest = facts.map((f) => ({
    ...f,
    weight: rel.test(f.text) ? f.weight + 20 : offTopic && f.lean !== undefined ? f.weight - 40 : f.weight,
  }));
  const seen = new Set<string>();
  return [...own, ...rest]
    .sort((a, b) => b.weight - a.weight)
    .filter((f) => (seen.has(f.text) ? false : (seen.add(f.text), true)));
}

/** The question a paragraph is about, and how the members' paragraph argues this selection. */
export interface Angle {
  /** The question, without its answer: safe for the free paragraph. */
  question: string;
  /** How to argue this selection, for the members' paragraph. */
  argue: string;
}

export function angleOf(c: Pick<Candidate, 'market' | 'outcome' | 'line'>, home: string, away: string): Angle {
  const side = c.outcome === 'HOME' || c.outcome === '1X' ? home : c.outcome === 'AWAY' || c.outcome === 'X2' ? away : null;
  const other = side === home ? away : side === away ? home : null;
  const family = familyOf(c.market);
  switch (family) {
    case 'goals': {
      const need = clears(c.line ?? 2.5);
      return {
        question: 'how many goals this game has in it: what each side creates, what each gives up, and whether the scoring has been running hot or cold',
        argue: c.outcome === 'over'
          ? `Argue why there will be ${w(need)} goals or more: how often their games get there, who scores freely and who concedes. Say where the goals come from.`
          : `Argue why it stays at ${w(need - 1)} goals or fewer: how rarely their games open up, who struggles to score and who keeps it tight. Say why the chances will be scarce.`,
      };
    }
    case 'btts':
      return {
        question: 'whether both sides find the net: who scores in every game, and who keeps the door shut',
        argue: c.outcome === 'yes'
          ? 'Argue why both will score: each side scores regularly and each leaves chances at the back.'
          : 'Argue why one side will not score: who keeps clean sheets, who has been failing to score, and which of the two it is.',
      };
    case 'margin':
      return {
        question: `how big the gap between ${home} and ${away} really is on the day: how often each wins well and how often each is beaten heavily`,
        argue: `Argue the margin, not just the winner: how often ${side ?? 'the backed side'} win by two or more, or why ${other ?? 'the other side'} cannot keep it close. Say how the game gets away from the weaker side.`,
      };
    case 'corners':
      return {
        question: c.market === 'corners_1x2'
          ? 'which side spends the game in the other half and wins the corners'
          : 'how many corners this game produces: who attacks, who sits deep, and who wins corners week after week',
        argue: c.market === 'corners_1x2'
          ? `Argue why ${side ?? 'that side'} win the corner count: who has the ball in the other half, who wins more corners than they give away.`
          : c.outcome === 'over'
            ? 'Argue why the corners pile up: both sides\' corner counts, and who will be camped in the other half.'
            : 'Argue why the corners stay low: who rarely gets forward, and how few corners their games produce.',
      };
    case 'cards':
      return {
        question: 'how heated it gets: how these sides behave, what is riding on it, and how the referee handles a game',
        argue: c.outcome === 'yes' || c.outcome === 'over'
          ? 'Argue why someone is sent off: the sides\' records for red cards, the stakes, and the referee.'
          : 'Argue why it stays at eleven against eleven: how rarely these sides see red, and why there is little to boil over.',
      };
    default:
      if (c.outcome === 'DRAW') {
        return {
          question: `whether either side can win it: how evenly matched ${home} and ${away} are, and who draws a lot`,
          argue: 'Argue why neither side wins: how evenly matched they are, how often they draw, and why neither can break the other.',
        };
      }
      if (c.outcome === '12') {
        return {
          question: 'whether this one has a winner: who goes for it and who cannot hold on',
          argue: 'Argue why one side wins it: how rarely their games end level and who has to go for it.',
        };
      }
      return {
        question: `who gets something out of this game: what ${home} are like at home, what ${away} are like away, and where the result is decided`,
        argue: c.market === 'double_chance'
          ? `Argue why ${side} do not lose: how rarely they are beaten, and why ${other} cannot hurt them.`
          : c.market === 'draw_no_bet'
            ? `Argue why ${side} come out on top if there is a winner, and why ${other} are unlikely to beat them.`
            : `Argue why ${side} win: their record at ${side === home ? 'home' : 'away from home'}, what ${other} are like, and where ${side} hurt them.`,
      };
  }
}
