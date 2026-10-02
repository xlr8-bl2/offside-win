/**
 * The sweat: how a call is doing while the match is on, in the words you'd
 * use watching it.
 *
 * "On track" and "Not yet" were true and told a reader nothing they could
 * not see from the score. What they want to know is what has to happen now:
 * is it already in, does it need a goal, would one goal against kill it, and
 * how much time is there. All of that is in the score, the clock and the
 * grader, so this asks them.
 *
 *  - What has to happen: the fewest goals that would change how the call
 *    settles, searched against the same grader the board uses on a finished
 *    match (markets.js didItLand), so it can never disagree with the result.
 *    And whose goals: a home goal, an away goal, either, or one at each end.
 *  - How it looks: the chance it lands from here, from our expected goals
 *    for each side scaled to the time left. Said in words, never as a
 *    number (offside-voice: no bare percentages).
 *  - Settled early: a call no further goal can change says so. Over 1.5 at
 *    2-0 is in; under 2.5 at 2-1 is one more goal from gone; under 2.5 at
 *    3-0 is gone.
 *
 * Markets the score cannot grade (corners, cards) get nothing.
 */

import { didItLand } from './markets.js';

// Goals searched past the current score, per side. Nine in what is left of a
// match is beyond anything the grader needs to tell the cases apart.
const MAX = 8;
// Our expected goals when a fixture carries none: a league-average match.
const DEFAULT_RATE = [1.45, 1.15];

const VALUE = { won: 1, part: 0.5, back: 0.5, lost: 0 };

function poisson(rate) {
  const out = [];
  let p = Math.exp(-rate);
  for (let k = 0; k <= MAX; k++) {
    out.push(p);
    p = (p * rate) / (k + 1);
  }
  return out;
}

/** Minutes of football left, from the clock and the state of play. */
export function minutesLeft(minute, status) {
  const s = String(status ?? '').toLowerCase();
  if (s === 'halftime') return 45;
  const m = Number.isFinite(minute) ? minute : (s.includes('2nd') ? 60 : 20);
  // Stoppage time and the last few minutes still hold a goal or two.
  return Math.max(3, 90 - m);
}

/**
 * Where the call stands. Returns null for a market the score cannot grade.
 *
 * `who` names the sides for the sentences ({ home: 'Bury', away: 'Bromsgrove' }).
 */
export function sweat({ market, outcome, line, score, minute = null, status = null, rates = null, who = {} }) {
  if (!Array.isArray(score) || score.length !== 2) return null;
  const [h, a] = score.map(Number);
  if (!Number.isInteger(h) || !Number.isInteger(a)) return null;
  const grade = (x, y) => didItLand({ market, outcome, line, homeGoals: x, awayGoals: y });
  const now = grade(h, a);
  if (!now) return null;

  const left = minutesLeft(minute, status);
  const [rh, ra] = Array.isArray(rates) && rates.every((r) => Number.isFinite(Number(r)) && Number(r) > 0)
    ? rates.map(Number) : DEFAULT_RATE;
  const ph = poisson((rh * left) / 90);
  const pa = poisson((ra * left) / 90);

  let chance = 0;
  let locked = true;
  for (let x = 0; x <= MAX; x++) {
    for (let y = 0; y <= MAX; y++) {
      const g = grade(h + x, a + y);
      chance += ph[x] * pa[y] * (VALUE[g] ?? 0);
      if (g !== now) locked = false;
    }
  }

  // The fewest further goals that change things, and whose they would be.
  const landing = now === 'won';
  const target = landing ? (g) => g !== 'won' : (g) => g === 'won';
  let fewest = null;
  const ways = [];
  for (let n = 1; n <= MAX && fewest === null; n++) {
    for (let x = 0; x <= n; x++) {
      const y = n - x;
      if (target(grade(h + x, a + y))) { fewest = n; ways.push([x, y]); }
    }
  }
  const home = who.home || 'the home side';
  const away = who.away || 'the away side';
  const whose = !ways.length ? null
    : ways.every(([, y]) => y === 0) ? home
      : ways.every(([x]) => x === 0) ? away
        : ways.every(([x, y]) => x > 0 && y > 0) ? 'each end' : 'either';

  const NUM = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'];
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  let need = '';
  if (locked) {
    need = landing ? 'Already in. Nothing that happens now can change it.' : now === 'lost' ? 'Nothing left that can bring it back.' : 'Settled where it stands.';
  } else if (landing && fewest !== null) {
    const spare = fewest - 1;
    if (spare === 0) {
      need = whose === 'either' ? 'One more goal from anyone and it’s gone.'
        : whose === 'each end' ? 'A goal at each end and it’s gone.'
          : `One ${whose} goal and it’s gone.`;
    } else {
      need = `${cap(NUM[spare] ?? String(spare))} goal${spare === 1 ? '' : 's'} to spare.`;
    }
  } else if (fewest !== null) {
    const lead = now === 'back' ? 'Level, so the stake is safe for now. ' : '';
    if (whose === 'each end') need = `${lead}Needs a goal at each end.`;
    else if (whose === 'either') need = fewest === 1 ? `${lead}One more goal and it’s in.` : `${lead}Needs ${NUM[fewest] ?? fewest} more goals.`;
    else need = fewest === 1 ? `${lead}Needs a ${whose} goal.` : `${lead}Needs ${NUM[fewest] ?? fewest} ${whose} goals.`;
  }

  // The headline, from the chance, without ever printing it.
  let headline;
  let tone;
  if (locked) {
    headline = landing ? 'Landed already' : now === 'lost' ? 'Gone' : 'Settled';
    tone = landing ? 'won' : now === 'lost' ? 'lost' : 'off';
  } else if (landing) {
    headline = chance >= 0.88 ? 'Cruising' : chance >= 0.65 ? 'On course' : 'Hanging on';
    tone = 'on';
  } else {
    headline = chance >= 0.45 ? 'Still live' : chance >= 0.15 ? 'Up against it' : 'Needs a miracle';
    tone = 'off';
  }

  const s = String(status ?? '').toLowerCase();
  const time = s === 'halftime' ? 'Half time.'
    : left <= 5 ? 'Into the last few minutes.'
      : `About ${Math.max(5, Math.round(left / 5) * 5)} minutes left.`;

  return { on: landing, locked, tone, headline, need, time, score: `${h}–${a}`, now };
}
