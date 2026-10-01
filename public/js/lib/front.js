/**
 * The front door's words: the landing page in the browser (viewLanding in
 * app.js) and the same page as the Worker sends it to a search engine
 * (homePage in worker/src/seo.ts), from one place so the two never say
 * different things. The FAQ also goes out as FAQPage structured data.
 *
 * House voice (offside-voice): opinionated, plain, no profit claims, no
 * internal vocabulary. engine/test/front.test.ts runs it through the rule.
 */

export const LANDING_HEADLINE = ['We call the big games.', 'Then we show our working.'];

export const LANDING_LEDE = 'One call on each match worth your time, with the reason in plain English: who’s missing, who’s flying, who needs the result. And every result stays on the record, the misses too.';

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
  ['How do I cancel?',
    'One tap on your account page. No form, no email, no “are you sure”. You keep what you paid for until it runs out.'],
  ['Who is it for?',
    'Over-18s who watch a lot of football and want a straight opinion on it. If betting has stopped being fun, BeGambleAware.org is free and confidential.'],
];
