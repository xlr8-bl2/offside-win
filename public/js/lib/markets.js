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
      const start = -line;
      return out(
        `${t} ${line > 0 ? '+' : ''}${line}`,
        start > 0 ? `${t}, giving a ${fmtStart(start)} start` : `${t}, with a ${fmtStart(-start)} start`,
        handicapWins(line, t),
        { outcomes: handicapOutcomes(line, t) },
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
