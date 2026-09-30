/**
 * Our read on a match we have no call on.
 *
 * The strict rule passes on most matches, and a lean at a lower floor was
 * tested and did not earn (lab:leans: roughly even, losing in one period at
 * every floor from 60% to 75%). So a match we pass on gets a read, not a
 * pick: what we think happens, in words, free, with no price and no
 * bookmaker, because it is not something we would bet. It never enters the
 * record.
 *
 * From the bookmakers' view only (the de-vigged result market, and the 2.5
 * goals line where it is priced). Our own goal rates are not used: on
 * national sides, which play a handful of times a year, they rated
 * Liechtenstein level with Azerbaijan. No market, no read.
 *
 * Words only: no number reaches the page.
 */

export interface Read { text: string; side: 'home' | 'away' | null }

export function readOf(input: {
  home: string;
  away: string;
  /** The result market, de-vigged: HOME, DRAW, AWAY. */
  result: { HOME?: number; DRAW?: number; AWAY?: number } | null;
  /** The chance of three goals or more, where the line is priced. */
  over25?: number | null;
}): Read | null {
  const r = input.result;
  const h = Number(r?.HOME), d = Number(r?.DRAW), a = Number(r?.AWAY);
  if (![h, d, a].every((x) => Number.isFinite(x) && x > 0)) return null;
  const t = h + d + a;
  const home = h / t, draw = d / t, away = a / t;
  const side = home >= away ? 'home' : 'away';
  const fav = side === 'home' ? home : away;
  const team = side === 'home' ? input.home : input.away;
  const over = typeof input.over25 === 'number' && Number.isFinite(input.over25) ? input.over25 : null;

  if (fav >= 0.6) {
    const text = over !== null && over >= 0.6 ? `${team} to win, with goals`
      : over !== null && over <= 0.4 ? `${team} to win a tight one`
      : `${team} to win`;
    return { text, side };
  }
  if (fav >= 0.47) return { text: over !== null && over >= 0.6 ? `${team} to edge it, with goals` : `${team} to edge it`, side };
  return { text: draw >= 0.3 ? 'Too close to call. A draw is live' : 'Too close to call', side: null };
}
