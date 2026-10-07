/**
 * The front door's words: the landing page in the browser (viewLanding in
 * app.js) and the same page as the Worker sends it to a search engine
 * (homePage in worker/src/seo.ts), from one place so the two never say
 * different things. The FAQ also goes out as FAQPage structured data.
 *
 * House voice (offside-voice): opinionated, plain, no profit claims, no
 * internal vocabulary. engine/test/front.test.ts runs it through the rule.
 */

export const LANDING_HEADLINE = ['Football predictions,', 'argued properly.'];

export const LANDING_LEDE = 'Team news, form and what’s riding on it, for every big game. We make a call when we’d back it ourselves, say why when we wouldn’t, and keep every result on the record. The misses too.';

/** What every match page gives you: the landing page's three, in order. */
export const LANDING_GETS = [
  ['Team news that matters', 'Who’s out, who’s back, and whether it changes anything. A missing centre-back matters more than a missing third-choice keeper, and we say so.'],
  ['Form you’d quote down the pub', 'The last six, home and away, clean sheets and goals. Nothing from a spreadsheet.'],
  ['A call, or a straight pass', 'Only when we’d back it ourselves, with the reason in plain English. Most games get no call, and the page tells you why. Read again every fifteen minutes up to kick-off.'],
];

export const LANDING_STEPS = [
  ['Read the game.', 'Team news, who’s injured and who actually matters, form home and away, the table, what’s riding on it. Looked at again every fifteen minutes until kick-off.'],
  ['Make the call. Or don’t.', 'Only when we’d back it ourselves. Most games get no call, and when we pass we say why, on the match page, for free.'],
  ['Put it on the record.', 'Won, lost or void, it stays on the results page for good. Nothing gets quietly deleted. Ever.'],
];

export const LANDING_FAQ = [
  ['Is this a tipping service?',
    'It’s analysis with a call on the end. We read the game, say what we think happens and why, and leave the rest to you. Nobody here will ever tell you to place a bet.'],
  ['Do your calls always come in?',
    'No, and nobody’s do. Every call we’ve made is on the results page with how it went, the misses included. If someone promises you winners, close the tab.'],
  ['What’s free?',
    'Every match preview, the full record, and one call a day: the one we’re surest of. Members get every call the moment it goes up, the bet slip, and the reasons behind all of them.'],
  ['Which games do you cover?',
    'The Premier League, the Champions League and the rest of Europe’s big leagues, plus eighty-odd competitions behind them. Every game gets a preview. The ones worth backing get a call.'],
  ['Who is it for?',
    'Over-18s who watch a lot of football and want a straight opinion on it. If betting has stopped being fun, BeGambleAware.org is free and confidential.'],
];
