/**
 * The share card of a match: the image a link to it unfurls into on WhatsApp,
 * X, iMessage and the rest.
 *
 * Shared by the engine, which draws and stores the card, and the Worker, which
 * points each match page's og:image at it. One definition of what the card
 * says, so the two can never disagree about when it has changed.
 */

/** Bump to redraw every card after a design change. */
export const CARD_VERSION = 1;

/** Where the card is kept, in the public images bucket. */
export const cardPath = (id) => `og/${Number(id)}.jpg`;

/**
 * Where the match stands, as far as the picture goes: 'pre' until there is a
 * final score, then 'ft-2-1'. The page's og:image carries it as a query, so a
 * platform that cached the preview card fetches the new one after full time.
 */
export function cardState(f) {
  const s = Array.isArray(f?.score) && f.score.length === 2 ? f.score : null;
  return s ? `ft-${Number(s[0])}-${Number(s[1])}` : 'pre';
}

const RESULT = { WON: ['Landed', 'won'], HALF_WON: ['Half landed', 'won'], LOST: ['Missed', 'lost'], HALF_LOST: ['Half lost', 'lost'], PUSH: ['Stake back', 'void'], VOID: ['Void', 'void'] };

/**
 * The line along the foot of the card. Only what is public already: the free
 * call is named, a members' call is only said to exist, and a settled call is
 * named with how it went. `describe` is markets.js's, passed in so this module
 * has no imports and loads anywhere.
 */
export function cardLine(f, describe) {
  const name = (p) => {
    try { return describe({ market: p.market, outcome: p.outcome, line: p.line, home: f.home, away: f.away, odds: p.odds }).name; } catch { return null; }
  };
  if (cardState(f) !== 'pre') {
    const c = f.called;
    if (c?.market && c.result && RESULT[c.result]) {
      const [word, tone] = RESULT[c.result];
      return { tag: 'our call', main: name(c) ?? 'Our call', side: word, tone };
    }
    return { tag: 'full time', main: 'The report, the scorers and the ratings', side: '', tone: 'none' };
  }
  if (f.free_call && f.top_pick?.market) {
    const odds = Number(f.top_pick.odds);
    return { tag: 'today’s free call', main: name(f.top_pick) ?? 'Today’s free call', side: Number.isFinite(odds) ? `odds of ${odds.toFixed(2)}` : '', tone: 'accent' };
  }
  if (f.locked || f.top_pick || f.called) {
    return { tag: 'we have a call', main: 'The call and the reasons behind it', side: '', tone: 'accent' };
  }
  return { tag: 'preview', main: 'Team news, form and the head-to-head', side: '', tone: 'none' };
}

/** Everything the card depends on, as one string: a change means a redraw. */
export function cardKey(f, describe) {
  const l = cardLine(f, describe);
  return [CARD_VERSION, cardState(f), f.kickoff, l.tag, l.main, l.side].join('|');
}
