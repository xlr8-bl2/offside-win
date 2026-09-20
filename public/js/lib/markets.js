/**
 * What a market actually means, in English.
 *
 * The board is dominated by Asian handicaps — they were 59% of every call in a
 * 39-fixture sample — and the site used to render one as the bare string
 * "Osasuna -1". That is unreadable to anyone who does not already bet, which
 * is most of the people we want reading it. Worse, the provider quotes quarter
 * lines (-0.25, -0.75, -1.25), where the stake splits across two handicaps and
 * half of it can win while the other half comes back. Nobody guesses that.
 *
 * So every market answers four questions, and the UI is not allowed to show a
 * pick without them:
 *
 *   name     "Osasuna -0.75"            — what a bookmaker calls it
 *   plain    "Osasuna, giving a start"  — what it is
 *   wins     "Osasuna win by two..."    — what has to happen
 *   returns  "£10 returns £23.50"       — what you get
 *
 * Nothing in here may use the private vocabulary; see engine/src/vocabulary.ts.
 */

const OVER_UNDER = { over: 'More than', under: 'Fewer than' };

/* ------------------------------------------------------------------ money */

/** Decimal odds to a returned amount, stake included, as a money string. */
export function returned(odds, stake = 10, currency = '£') {
  const total = stake * odds;
  const s = total % 1 === 0 ? total.toFixed(0) : total.toFixed(2);
  return `${currency}${s}`;
}

export function stakeLine(odds, stake = 10, currency = '£') {
  return `${currency}${stake} returns ${returned(odds, stake, currency)}`;
}

/* -------------------------------------------------------------- handicaps */

/**
 * How a handicap settles at each winning margin.
 *
 * `line` is negative and belongs to the named side: -0.75 means that side
 * gives away three quarters of a goal. A quarter line is two bets of half the
 * stake, one at each adjacent half-goal — so -0.75 is half at -0.5 and half at
 * -1, which is where "half your stake comes back" comes from.
 *
 * Returns one of: win, half-win, push, half-loss, loss.
 */
export function settleHandicap(line, margin) {
  const quarter = Math.abs(line * 4) % 2 === 1;   // .25 or .75
  const halves = quarter ? [line + 0.25, line - 0.25] : [line, line];

  const one = (l) => {
    const adj = margin + l;
    return adj > 0 ? 1 : adj === 0 ? 0.5 : 0;     // 1 win, 0.5 stake back, 0 loss
  };

  const score = (one(halves[0]) + one(halves[1])) / 2;
  return score === 1 ? 'win'
    : score === 0.75 ? 'half-win'
    : score === 0.5 ? 'push'
    : score === 0.25 ? 'half-loss'
    : 'loss';
}

const MARGIN_WORD = {
  win: 'Wins',
  'half-win': 'Half wins, half comes back',
  push: 'Stake comes back',
  'half-loss': 'Half your stake comes back',
  loss: 'Loses',
};

/**
 * A short table of what each result does — clearer than any sentence once a
 * quarter line is involved, and the reason this returns rows rather than prose.
 *
 * Consecutive margins that settle the same way are one band, so a reader sees
 * three or four rows rather than nine. Margins beyond +/-4 behave like the
 * band at the edge, so the outermost rows are open-ended.
 */
export function handicapOutcomes(line, team) {
  const TOP = 5;
  const bands = [];
  for (let m = TOP; m >= -TOP; m--) {
    const result = settleHandicap(line, m);
    const last = bands[bands.length - 1];
    if (last && last.result === result) last.lo = m;
    else bands.push({ hi: m, lo: m, result });
  }

  return bands.map(({ hi, lo, result }, i) => ({
    label: bandLabel(hi, lo, team, i === 0, i === bands.length - 1, TOP),
    result,
    effect: MARGIN_WORD[result],
  }));
}

function bandLabel(hi, lo, team, first, last, TOP) {
  const winBy = (n) => `${team} win by ${n}`;
  const loseBy = (n) => `${team} lose by ${n}`;

  // One margin wide.
  if (hi === lo) {
    if (hi > 0) return `${winBy(hi)}`;
    if (hi === 0) return 'Draw';
    return loseBy(-hi);
  }
  // Open at the top or the bottom of the range we walked.
  if (first && hi >= TOP) return lo > 0 ? `${winBy(lo)} or more` : lo === 0 ? `${team} win or draw` : `Anything above a ${-lo}-goal defeat`;
  if (last && lo <= -TOP) return hi < 0 ? `${loseBy(-hi)} or more` : hi === 0 ? 'Draw or defeat' : `${winBy(hi)} or worse`;

  // Closed band in the middle.
  if (lo > 0) return `${winBy(lo)} or ${hi}`;
  if (hi < 0) return `${loseBy(-hi)} to ${-lo}`;
  return hi === 0 ? `Draw, or ${loseBy(-lo)}` : `${winBy(hi)}, draw or ${loseBy(-lo)}`;
}

/**
 * One sentence covering the common case, for the card.
 *
 * Derived from settleHandicap rather than recomputed, because doing the
 * arithmetic twice is how the two quarter lines got conflated: on -0.75 the
 * partial band is a half *win* (the -0.5 half lands, the -1 half is void),
 * while on -1.25 it is a half *loss* (the -1 half is void, the -1.5 half
 * goes down). Same shape, opposite meaning to whoever placed the bet.
 */
function handicapWins(line, team) {
  const at = (m) => settleHandicap(line, m);

  // Smallest winning margin, and the partial band just below it if there is one.
  let full = null;
  for (let m = -4; m <= 6; m++) if (at(m) === 'win') { full = m; break; }
  if (full === null) return `${team} must win by ${Math.ceil(-line)} or more.`;

  const below = full - 1;
  const partial = at(below);
  const need = full <= 0
    ? `${team} must avoid defeat.`
    : full === 1 ? `${team} must win.` : `${team} must win by ${full} or more.`;

  const band = below === 0 ? 'A draw'
    : below > 0 ? `Win by exactly ${below}`
    : `Lose by ${-below}`;

  switch (partial) {
    case 'half-win':  return `${need} ${band} and half your stake still wins, half comes back.`;
    case 'push':      return `${need} ${band} and your stake comes back.`;
    case 'half-loss': return `${need} ${band} and half your stake comes back.`;
    default:          return need;
  }
}

/**
 * "a Chelsea win" but "an Arsenal win". Judged on the sound of the first
 * letter, which is wrong for a handful of clubs (an Hoffenheim) and right for
 * the overwhelming majority, including the initialisms — an AC Milan win, an
 * FC Porto win — where the letter name starts with a vowel sound.
 */
function article(name) {
  const first = String(name).trim().charAt(0).toUpperCase();
  const vowelSound = 'AEIOU'.includes(first) || 'FHLMNRSX'.includes(first) && isInitialism(name);
  return vowelSound ? 'an' : 'a';
}

function isInitialism(name) {
  const word = String(name).trim().split(/\s+/)[0] ?? '';
  return word.length <= 4 && word === word.toUpperCase();
}

/* ------------------------------------------------------------- dictionary */

/**
 * The whole point of this module.
 *
 * @returns {{name:string, plain:string, wins:string, returns:string, outcomes?:Array}}
 */
export function describe({ market, outcome, line, home, away, odds, stake = 10 }) {
  const H = home || 'the home side';
  const A = away || 'the away side';
  const money = odds ? stakeLine(odds, stake) : '';
  const out = (name, plain, wins, extra) => ({ name, plain, wins, returns: money, ...extra });

  switch (market) {
    case '1x2':
      if (outcome === 'HOME') return out(`${H} to win`, `${H} to win the match`, `${H} must win. A draw loses.`);
      if (outcome === 'AWAY') return out(`${A} to win`, `${A} to win the match`, `${A} must win. A draw loses.`);
      return out('Draw', 'The match to end level', 'The match must finish level.');

    case 'double_chance':
      if (outcome === '1X') return out(`${H} to win or draw`, `Two results out of three`, `${H} must win or draw. Only ${article(A)} ${A} win loses.`);
      if (outcome === 'X2') return out(`${A} to win or draw`, `Two results out of three`, `${A} must win or draw. Only ${article(H)} ${H} win loses.`);
      return out('Either team to win', 'Anything but a draw', 'Someone must win. A draw loses.');

    case 'draw_no_bet': {
      const t = outcome === 'HOME' ? H : A;
      const o = outcome === 'HOME' ? A : H;
      return out(`${t} to win`, `${t} to win, with a draw refunded`,
        `${t} must win. If it finishes level your stake comes back, so only ${article(o)} ${o} win loses.`);
    }

    case 'asian_handicap': {
      const t = outcome === 'HOME' ? H : A;
      // `line` is the home handicap, market-wide -- one -0.5 covers both
      // quotes and the away side of it is +0.5. Printing the home number
      // against the away name said "Elche -0.75" when Elche were getting
      // three quarters of a goal, which is the bet backwards.
      const own = outcome === 'HOME' ? line : -line;
      const start = -own;
      return out(
        `${t} ${own > 0 ? '+' : ''}${own}`,
        start > 0 ? `${t}, giving a ${fmtStart(start)} start` : `${t}, with a ${fmtStart(-start)} start`,
        handicapWins(own, t),
        { outcomes: handicapOutcomes(own, t) },
      );
    }

    case 'over_under_05':
    case 'over_under_15':
    case 'over_under_25':
    case 'over_under_35': {
      const n = line ?? 0.5;
      const isOver = String(outcome).toLowerCase() === 'over';
      const need = isOver ? Math.ceil(n) : Math.floor(n);
      return out(
        `${OVER_UNDER[String(outcome).toLowerCase()]} ${n} goals`,
        `Total goals by both sides`,
        isOver
          ? `${need} goals or more in the match, either side.`
          : `${need} goals or fewer in the match, either side.`,
      );
    }

    case 'total_corners': {
      const n = line ?? 0;
      const isOver = String(outcome).toLowerCase() === 'over';
      return out(
        `${OVER_UNDER[String(outcome).toLowerCase()]} ${n} corners`,
        `Corners taken by both sides`,
        isOver ? `${Math.ceil(n)} corners or more in total.` : `${Math.floor(n)} corners or fewer in total.`,
      );
    }

    case 'btts': {
      const yes = String(outcome).toLowerCase() === 'yes';
      return out(
        yes ? 'Both teams to score' : 'Both teams to score — no',
        yes ? 'Each side scores at least once' : 'At least one side fails to score',
        yes ? 'Both sides must score. 1-0 either way loses.' : 'One side must be kept out. 1-1 loses.',
      );
    }

    case 'total_red_cards': {
      const n = line ?? 0.5;
      const isOver = String(outcome).toLowerCase() === 'over';
      return out(
        `${OVER_UNDER[String(outcome).toLowerCase()]} ${n} red cards`,
        'Red cards shown in the match',
        isOver ? `${Math.ceil(n)} red card${Math.ceil(n) === 1 ? '' : 's'} or more.` : 'No red card shown.',
      );
    }

    case 'red_card':
      return out(
        String(outcome).toLowerCase() === 'yes' ? 'A red card' : 'No red card',
        'Whether anyone is sent off',
        String(outcome).toLowerCase() === 'yes' ? 'Someone must be sent off.' : 'Nobody is sent off.',
      );

    case 'european_handicap': {
      const t = outcome === 'HOME' ? H : A;
      return out(
        `${t} ${line > 0 ? '+' : ''}${line}`,
        `${t}, with the score adjusted before kick-off`,
        `${t} must come out ahead once the ${fmtStart(Math.abs(line))} adjustment is applied. Finishing level after it loses.`,
      );
    }

    default:
      return out(String(outcome ?? market), '', '');
  }
}

function fmtStart(n) {
  if (n === 0.25) return 'quarter-goal';
  if (n === 0.5) return 'half-goal';
  if (n === 0.75) return 'three-quarter-goal';
  if (n === 1) return 'one-goal';
  if (n === 1.5) return 'goal-and-a-half';
  if (n === 2) return 'two-goal';
  return `${n}-goal`;
}

/**
 * What happened, once it has.
 *
 * `describe()` explains a call before kick-off. This is the other half: the
 * same call read back against the scoreline, in the voice a supporter would
 * use in the pub rather than the one a settlement engine would use in a log.
 *
 * The rule it follows is the rule the whole record follows -- a loss is said
 * as plainly as a win, and neither gets an excuse. "We were unlucky" is not
 * available here. The nearest it comes is naming how close it was, which is a
 * fact about the score and not a plea.
 *
 * Returns null when the score cannot answer the market. Corners and cards are
 * settled from stats the front end never receives, so rather than invent a
 * sentence about them this says nothing and the page prints the mark alone.
 */
/** A score, or null. `Number(null)` is 0, which would grade an unplayed match. */
function goals(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

export function recap({ market, outcome, line, result, homeGoals, awayGoals, home, away }) {
  const hg = goals(homeGoals);
  const ag = goals(awayGoals);
  if (hg === null || ag === null) return null;

  const H = home || 'the home side';
  const A = away || 'the away side';
  const total = hg + ag;
  const won = result === 'WON' || result === 'HALF_WON';
  const back = result === 'PUSH' || result === 'VOID';
  const o = String(outcome ?? '').toLowerCase();

  /*
   * The grade and the scoreline have to agree before either is described.
   *
   * They come from different places -- `result` was written by the settle job
   * against the stats feed, the goals are a column on the fixture -- and a
   * fixture corrected after settlement, or a provider that revises a score,
   * leaves the two saying different things. Writing prose from both then
   * produces sentences that are not merely wrong but impossible: "four goals,
   * one short of what we needed" on a line of 1.5.
   *
   * So when they disagree this says nothing and the page prints the mark on
   * its own. An unexplained mark is a gap; an explained wrong one is a lie.
   */
  const fromScore = didItLand({ market, outcome, line, homeGoals: hg, awayGoals: ag });
  const fromGrade = won ? 'won' : back ? 'back' : result === 'LOST' ? 'lost' : 'part';
  if (fromScore && fromScore !== fromGrade && !(fromScore === 'part' || fromGrade === 'part')) return null;

  // Numbers as words, because this is prose and "1 goal, 2 short" is a
  // scoreboard, not a sentence. Anything past ten is a typo or a cricket score.
  const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
  const by = (n) => WORDS[n] ?? String(n);
  const Cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);

  const winner = hg > ag ? H : ag > hg ? A : null;
  const score = `${hg}-${ag}`;
  const flip = `${ag}-${hg}`;

  switch (market) {
    case '1x2':
    case 'draw_no_bet':
    case 'european_handicap': {
      if (back) return `It finished level at ${score}, so the stake came back.`;
      if (!winner) return won ? `It finished ${score}, which is what we said.` : `It finished level at ${score}.`;
      if (won) return `${winner} won it ${winner === H ? score : flip}.`;
      return `${winner} won it ${winner === H ? score : flip}, and we were on the other one.`;
    }

    case 'double_chance': {
      if (won) return winner ? `${winner} won it ${winner === H ? score : flip}.` : `It finished level at ${score}.`;
      return winner
        ? `${winner} won it ${winner === H ? score : flip}, which was the one result that beat us.`
        : `It finished level at ${score}.`;
    }

    case 'asian_handicap': {
      const t = o === 'home' ? H : A;
      const margin = o === 'home' ? hg - ag : ag - hg;
      const need = -line;
      if (back) return `${t} finished exactly on the line at ${score}, so the stake came back.`;
      const cushion = Math.abs(margin - need);
      if (won) return `${t} came out on the right side of it at ${score}.`;
      return cushion <= 0.5
        ? `${score}, and ${t} missed the line by the smallest margin there is.`
        : `${score}, and ${t} was never on the right side of it.`;
    }

    case 'over_under_05':
    case 'over_under_15':
    case 'over_under_25':
    case 'over_under_35': {
      const n = line ?? 0.5;
      const goals = `${by(total)} goal${total === 1 ? '' : 's'}`;
      if (o === 'over') {
        if (won) return `${Cap(goals)} in it, finishing ${score}.`;
        const short = Math.ceil(n) - total;
        if (total === 0) return `Goalless, and we wanted ${by(Math.ceil(n))}.`;
        return `${score}. Only ${goals}, ${by(short)} short of what we needed.`;
      }
      if (won) return `${score}, and it stayed quiet enough.`;
      const over = total - Math.floor(n);
      return `${score}. ${Cap(by(over))} more than we left room for.`;
    }

    case 'btts': {
      const both = hg >= 1 && ag >= 1;
      if (o === 'yes') {
        return won
          ? `Both scored, ${score}.`
          : `${score} — ${hg === 0 && ag === 0 ? 'neither side scored' : `${hg === 0 ? H : A} never got going`}.`;
      }
      return both
        ? `${score}, and both of them found one.`
        : `${score}, and ${hg === 0 ? H : A} was kept out.`;
    }

    default:
      // Corners, cards: settled from numbers this page does not have.
      return null;
  }
}

/**
 * Did it land, read straight off the scoreline.
 *
 * The record's marks come from the engine, which grades three hours after
 * kick-off and writes `result` onto the pick. This is for the gap before that:
 * a match that has just finished sits on the board for six more hours, and
 * leaving it unmarked for most of that is the difference between a board that
 * knows what happened and one that has not caught up.
 *
 * It is a second implementation of settlement, which is a thing worth being
 * nervous about -- two graders that disagree would put a mark on the board the
 * record then contradicts. engine/test/settle-agreement.test.ts runs both over
 * every market and every plausible scoreline and fails if they ever differ.
 *
 * Returns 'won', 'lost', 'part' (some of the stake back), 'back' (all of it),
 * or null where the score cannot answer -- corners and cards, which settle from
 * numbers no page receives.
 */
export function didItLand({ market, outcome, line, homeGoals, awayGoals }) {
  const hg = goals(homeGoals);
  const ag = goals(awayGoals);
  if (hg === null || ag === null) return null;
  const o = String(outcome ?? '');
  const lo = o.toLowerCase();
  const total = hg + ag;
  const yes = (b) => (b ? 'won' : 'lost');

  switch (market) {
    case '1x2':
      return yes((o === 'HOME' && hg > ag) || (o === 'DRAW' && hg === ag) || (o === 'AWAY' && hg < ag));

    case 'double_chance':
      return yes((o === '1X' && hg >= ag) || (o === '12' && hg !== ag) || (o === 'X2' && hg <= ag));

    case 'draw_no_bet':
      if (hg === ag) return 'back';
      return yes((o === 'HOME' && hg > ag) || (o === 'AWAY' && hg < ag));

    case 'btts':
      return yes((lo === 'yes') === (hg >= 1 && ag >= 1));

    case 'over_under_05':
    case 'over_under_15':
    case 'over_under_25':
    case 'over_under_35': {
      const n = line ?? Number(market.slice(-2)) / 10;
      return yes((lo === 'over') === (total > n));
    }

    case 'european_handicap': {
      if (line === null || line === undefined) return null;
      const adj = hg + line;
      return yes((o === 'HOME' && adj > ag) || (o === 'DRAW' && adj === ag) || (o === 'AWAY' && adj < ag));
    }

    case 'asian_handicap': {
      if (line === null || line === undefined) return null;
      // `line` is the HOME handicap and belongs to the market, not to a side:
      // one -0.5 covers both quotes, and the away side of it is +0.5. Both the
      // margin and the line mirror for AWAY, and mirroring only one of them is
      // how you grade a losing bet as a winner.
      const side = o === 'HOME' ? 1 : -1;
      const r = settleHandicap(line * side, (hg - ag) * side);
      return r === 'win' ? 'won'
        : r === 'loss' ? 'lost'
        : r === 'push' ? 'back'
        : 'part';
    }

    default:
      return null;
  }
}
