/**
 * Every page title, in one place.
 *
 * The Worker (worker/src/seo.ts) writes these into the page a search engine
 * reads, and the app writes the same ones into the tab as a reader moves
 * around. They used to be two lists: a match was "Iceland v Estonia
 * prediction, preview and team news" in Google and "Iceland v Estonia" once
 * the app booted, and Google renders the app, so the shorter one could win.
 *
 * The page comes first and the name last, so a tab and a result both show
 * what the page is before they run out of room.
 */

export const SITE_NAME = 'Offside.win';
export const HOME_TITLE = "Offside.win: football predictions for today's biggest games";
export const HOME_DESCRIPTION = "Football predictions for today's biggest games: our call on every match, the reason behind it, team news, and every result, misses included.";

/** A page's title with the name after it; the front page has its own. */
export const fullTitle = (t) => (t ? `${t} | ${SITE_NAME}` : HOME_TITLE);

/**
 * A match, by where it stands: to come, under way, played or off.
 * `score` is the final score, `live` the running one.
 * @param {{ home: string, away: string, state: string, score?: number[] | null, live?: number[] | null }} m
 */
export function matchTitle({ home, away, state, score = null, live = null }) {
  if (state === 'ft' && Array.isArray(score)) return `${home} ${score[0]}–${score[1]} ${away}: result, scorers and our call`;
  if (state === 'live') return `${home} v ${away} live${Array.isArray(live) ? `: ${live[0]}–${live[1]}` : ''}`;
  if (state === 'off') return `${home} v ${away}: postponed`;
  return `${home} v ${away} prediction, preview and team news`;
}

export const leagueTitle = (name) => `${name} predictions, fixtures and table`;

/** "Saturday 27 September", the day in the UK, as the pages say it. */
export const ukDay = (epoch) => new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London', weekday: 'long', day: 'numeric', month: 'long',
}).format(new Date(epoch * 1000));

export const todayTitle = (day, calls) => `Football predictions today, ${day}: ${calls} ${calls === 1 ? 'call' : 'calls'}`;

export function slipTitle(slip) {
  const n = Number(slip?.legs_count ?? slip?.legs?.length ?? 0);
  const odds = Number(slip?.odds);
  return n && odds ? `Today's bet slip: ${n} legs at total odds of ${odds.toFixed(2)}` : "Today's bet slip";
}

export const TITLES = {
  admin: 'Admin',
  results: 'Our record: every call and how it went',
  'how-sure': 'When we’re confident, are we right? Our calls checked',
  leagues: 'Leagues and competitions we cover',
  pricing: 'Membership: every call, from £3.49 for seven days',
  signin: 'Sign in',
  account: 'Your account',
  search: 'Find a game',
  checkout: 'Checkout',
  legal: 'Legal',
  trace: 'Trace a leak',
};
