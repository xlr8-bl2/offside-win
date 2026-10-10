/**
 * The pages people search for by name, beyond a match or a competition.
 *
 *   /tomorrow                     football predictions for tomorrow
 *   /weekend                      the weekend's matches, Friday to Monday
 *   /free-prediction              today's free call, in full
 *   /predictions                  every kind of prediction we make
 *   /predictions/<kind>           over 1.5 goals, double chance, draw no bet...
 *   /team/<id>/<name>             a team's next games and recent results
 *   /search?q=                    find a game, for a reader or an agent
 *   /cookies /refunds /contact /responsible-gambling
 *
 * Each says what a searcher typed in its title and first heading, and is
 * built from the same reads as the rest of the site, so it is true right now
 * and changes as the football does. Nothing here shows a member's call: the
 * open calls are described as existing, the free call and settled calls are
 * named, exactly as on every other page.
 *
 * In the app these pages are fetched and shown as written here (viewServerPage
 * in public/app.js), so a crawler and a reader see the same page.
 */

import { LEGAL, legalHTML } from '../../public/js/lib/legal.js';
import { leagueTitle } from '../../public/js/lib/titles.js';
import { findBannedInProse } from '../../engine/src/vocabulary.ts';
import {
  MOVES, RESULT_WORD, byDayAndLeague, callName, clip, crumbs, esc, leaguePath, listHTML, matchPath, read, slug,
  stateOf, ukTime, word, type Page, type SeoEnv,
} from './seo.ts';

type Rec = Record<string, any>;
const SITE = 'Offside.win';
const DAY = 86400;

export const teamPath = (id: unknown, name: unknown) => `/team/${Number(id)}/${slug(name)}`;

/* ------------------------------------------------------------- UK days */

/** Seconds London is ahead of UTC at a moment: 0 or 3600. */
function londonOffset(t: number): number {
  const h = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', hourCycle: 'h23' }).format(new Date(t * 1000)));
  return ((h - new Date(t * 1000).getUTCHours() + 24) % 24) * 3600;
}
/** Midnight in London of the day `plus` days after the one `t` falls on. */
export function ukMidnight(t: number, plus = 0): number {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date(t * 1000)).map((x) => [x.type, x.value]));
  const utc = Date.UTC(Number(p['year']), Number(p['month']) - 1, Number(p['day']) + plus) / 1000;
  return utc - londonOffset(utc);
}
/** 0 Sunday to 6 Saturday, in London. */
const ukWeekday = (t: number) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  .indexOf(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', weekday: 'short' }).format(new Date(t * 1000)));

/**
 * The weekend: Friday to Monday night. From Friday to Monday it is this one,
 * what is left of it; from Tuesday it is the next.
 */
export function weekendWindow(now: number): { from: number; to: number } {
  const wd = ukWeekday(now);
  const back = { 5: 0, 6: 1, 0: 2, 1: 3 }[wd as 5 | 6 | 0 | 1];
  const friday = back !== undefined ? ukMidnight(now, -back) : ukMidnight(now, (5 - wd + 7) % 7);
  return { from: Math.max(friday, now - 3 * 3600), to: ukMidnight(friday, 4) };
}

/* ------------------------------------------------------------ the kinds */

/**
 * The predictions we make, by what people search for. Each is a market the
 * engine publishes; the sentence says what has to happen for it to land, in
 * a supporter's words.
 */
export const KINDS: Array<{ slug: string; name: string; match: (p: Rec) => boolean; what: string }> = [
  { slug: 'over-1-5-goals', name: 'Over 1.5 goals', match: (p) => p.market === 'over_under_15' && /over/i.test(p.outcome),
    what: 'Two goals or more in the match, from either side. 1–1, 2–0 and anything bigger lands it; 1–0 and 0–0 do not.' },
  { slug: 'over-2-5-goals', name: 'Over 2.5 goals', match: (p) => p.market === 'over_under_25' && /over/i.test(p.outcome),
    what: 'Three goals or more in the match. 2–1 lands it; 1–1 does not.' },
  { slug: 'under-2-5-goals', name: 'Under 2.5 goals', match: (p) => p.market === 'over_under_25' && /under/i.test(p.outcome),
    what: 'Two goals or fewer in the match. 1–1 lands it; 2–1 does not.' },
  { slug: 'under-3-5-goals', name: 'Under 3.5 goals', match: (p) => p.market === 'over_under_35' && /under/i.test(p.outcome),
    what: 'Three goals or fewer in the match. 2–1 lands it; 2–2 does not.' },
  { slug: 'both-teams-to-score', name: 'Both teams to score', match: (p) => p.market === 'btts',
    what: 'Each side scores at least once. 1–1 lands it; 1–0 either way does not.' },
  { slug: 'double-chance', name: 'Double chance', match: (p) => p.market === 'double_chance',
    what: 'Two of the three results covered: a side to win or draw, or either side to win. Only the one result left out loses.' },
  { slug: 'draw-no-bet', name: 'Draw no bet', match: (p) => p.market === 'draw_no_bet',
    what: 'A side to win, with the stake back if it finishes level. Only the other side winning loses.' },
  { slug: 'match-result', name: 'Match result', match: (p) => p.market === '1x2',
    what: 'Home win, draw or away win, settled on the ninety minutes and stoppage time.' },
  { slug: 'asian-handicap', name: 'Asian handicap', match: (p) => p.market === 'asian_handicap',
    what: 'A side gives or gets a head start in goals, and the result is settled with it added on.' },
];

/** Settled calls of a kind are worth a page once there are a few to show. */
const ENOUGH = 3;

/**
 * How many landed, as a count. No staking sum: "£10 on every one" invents a
 * plan nobody follows and put a loss in every search snippet (owner, 10
 * October). The full record, every call and its score, is on /results.
 */
function record(picks: Rec[]): { n: number; won: number } {
  const graded = picks.filter((p) => p.result && p.result !== 'VOID' && p.result !== 'PUSH');
  const won = graded.filter((p) => p.result === 'WON' || p.result === 'HALF_WON').length;
  return { n: graded.length, won };
}

/* --------------------------------------------------- the links between */

/** Where else to go, on every one of these pages: the site's main sections in words. */
export function moreHTML(kinds: Array<{ slug: string; name: string }> = []): string {
  return `
    <nav class="seo-more" aria-label="More predictions">
      <h2>More predictions</h2>
      <ul class="seo-list">
        <li><a href="/today">Football predictions today</a></li>
        <li><a href="/tomorrow">Football predictions tomorrow</a></li>
        <li><a href="/weekend">Weekend football predictions</a></li>
        <li><a href="/free-prediction">Free football prediction of the day</a></li>
        <li><a href="/slip">Today's bet slip</a></li>
        ${kinds.map((k) => `<li><a href="/predictions/${k.slug}">${esc(k.name)} predictions</a></li>`).join('')}
        <li><a href="/league/1/premier-league">Premier League predictions</a></li>
        <li><a href="/league/7/champions-league">Champions League predictions</a></li>
        <li><a href="/leagues">Every competition we cover</a></li>
        <li><a href="/results">Our record, every call</a></li>
      </ul>
    </nav>`;
}

async function settledPicks(env: SeoEnv): Promise<Rec[]> {
  const d = await read<Rec>(env, 'get_picks', { p_limit: 200, p_settled: 'true' });
  return Array.isArray(d?.picks) ? d!.picks : [];
}

/** The kinds with enough settled calls behind them to stand as pages. */
function liveKinds(picks: Rec[]) {
  return KINDS.filter((k) => picks.filter(k.match).length >= ENOUGH);
}

function boardList(fixtures: Rec[], name: string, site: string) {
  return {
    '@context': 'https://schema.org', '@type': 'ItemList', name,
    itemListElement: fixtures.slice(0, 100).map((f, i) => ({ '@type': 'ListItem', position: i + 1, url: `${site}${matchPath(f)}`, name: `${f.home} v ${f.away}` })),
  };
}

const callsIn = (fixtures: Rec[]) => fixtures.filter((f) => f.top_pick || f.locked || f.called).length;

/* --------------------------------------------------------- the pages */

async function windowPage(env: SeoEnv, site: string, o: {
  path: string; from: number; to: number; crumb: string; h1: string; title: string; when: string; empty: string;
}): Promise<Page> {
  const [b, picks] = await Promise.all([read<Rec>(env, 'get_board', { p_from: o.from, p_to: o.to }), settledPicks(env)]);
  const fixtures: Rec[] = (Array.isArray(b?.fixtures) ? b!.fixtures : []).filter((f: Rec) => f.kickoff >= o.from && f.kickoff < o.to);
  const calls = callsIn(fixtures);
  const comps = new Set(fixtures.map((f) => f.league)).size;
  const free = fixtures.find((f) => f.free_call && f.top_pick);
  const c = crumbs([[SITE, '/'], [o.crumb, o.path]], site);
  const lead = fixtures.length
    ? `${fixtures.length} matches ${o.when} across ${comps} competitions, with ${calls} ${calls === 1 ? 'call' : 'calls'} so far.`
    : o.empty;
  return {
    title: `${o.title}${fixtures.length ? `: ${calls} ${calls === 1 ? 'call' : 'calls'}` : ''}`,
    description: clip(`${lead} The reason behind every call, team news and form, and every result kept on the record.`),
    canonical: `${site}${o.path}`,
    body: `
  <article class="wrap section narrow seo">
    ${c.html}
    <h1 class="display">${esc(o.h1)}</h1>
    <p>${esc(lead)} ${esc(MOVES)} One call a day is free; <a href="/pricing">members</a> get the rest.</p>
    ${free ? `<p>The free call is <a href="${esc(matchPath(free))}">${esc(`${free.home} v ${free.away}`)}</a>: ${esc(callName(free.top_pick, free.home, free.away))}.</p>` : ''}
    ${byDayAndLeague(fixtures)}
    ${moreHTML(liveKinds(picks))}
  </article>`,
    jsonLd: [c.ld, boardList(fixtures, o.h1, site)],
  };
}

export function tomorrowPage(env: SeoEnv, site: string): Promise<Page> {
  const now = Math.floor(Date.now() / 1000);
  const from = ukMidnight(now, 1);
  const day = ukTime(from + 12 * 3600).day;
  return windowPage(env, site, {
    path: '/tomorrow', from, to: ukMidnight(now, 2), crumb: 'Tomorrow',
    h1: `Football predictions for tomorrow, ${day}`, title: `Football predictions tomorrow, ${day}`, when: 'tomorrow',
    empty: 'Tomorrow\'s matches go up here as they are analysed, usually by the evening before.',
  });
}

export function weekendPage(env: SeoEnv, site: string): Promise<Page> {
  const now = Math.floor(Date.now() / 1000);
  const w = weekendWindow(now);
  const fri = ukTime(w.to - 4 * DAY + 12 * 3600).day;
  const mon = ukTime(w.to - DAY + 12 * 3600).day;
  return windowPage(env, site, {
    path: '/weekend', from: w.from, to: w.to, crumb: 'This weekend',
    h1: 'Weekend football predictions', title: `Weekend football predictions, ${fri} to ${mon}`, when: 'this weekend',
    empty: 'The weekend\'s matches go up here as they are analysed, from midweek on.',
  });
}

/** Today's free call, in full: the call, the odds, the book and the reason. */
export async function freePage(env: SeoEnv, site: string): Promise<Page> {
  const hero = await read<Rec>(env, 'get_hero', {});
  const id = Number(hero?.free_fixture_id);
  const f = Number.isFinite(id) && id > 0 ? await read<Rec>(env, 'get_fixture', { p_id: id }) : null;
  const pub: Rec | undefined = (Array.isArray(f?.published) ? f!.published : []).find((p: Rec) => p?.market);
  const c = crumbs([[SITE, '/'], ['Free prediction', '/free-prediction']], site);
  const picks = await settledPicks(env);
  if (!f?.home || !pub) {
    return {
      title: 'Free football prediction of the day',
      description: 'One call a day is free, with the reason behind it. Today\'s goes up as soon as the matches are analysed.',
      canonical: `${site}/free-prediction`,
      body: `<article class="wrap section narrow seo">${c.html}<h1 class="display">Free football prediction of the day</h1>
        <p>One call a day is free, the one we are surest of, with the reason behind it. Today's goes up as soon as the matches are analysed. <a href="/today">Today's board</a> has every match on.</p>
        ${moreHTML(liveKinds(picks))}</article>`,
      jsonLd: [c.ld],
    };
  }
  const home = String(f.home);
  const away = String(f.away);
  const name = callName(pub, home, away);
  const when = ukTime(Number(f.kickoff));
  const odds = Number(pub.odds);
  const why = [pub.why, pub.narrative].find((t) => typeof t === 'string' && t.trim() && findBannedInProse(t).length === 0) as string | undefined;
  const result = pub.result ? ` It ${RESULT_WORD[pub.result] ?? 'was settled'}.` : '';
  return {
    title: `Free football prediction today: ${home} v ${away}, ${name}`,
    description: clip(`Today's free call: ${name} in ${home} v ${away}, ${when.day} ${when.time} UK${Number.isFinite(odds) ? `, at odds of ${odds.toFixed(2)}` : ''}. The reason behind it, in full.${result}`),
    canonical: `${site}/free-prediction`,
    body: `
  <article class="wrap section narrow seo">
    ${c.html}
    <h1 class="display">Free football prediction of the day</h1>
    <p class="seo-meta">${esc(String(f.league ?? ''))}. Kick-off ${esc(when.day)}, ${esc(when.time)} UK time.</p>
    <h2><a href="${esc(matchPath(f))}">${esc(`${home} v ${away}`)}</a>: ${esc(name)}</h2>
    <p>${Number.isFinite(odds) ? `At odds of ${esc(odds.toFixed(2))}${pub.bookmaker ? ` with ${esc(pub.bookmaker)}` : ''}.` : ''}${esc(result)} ${esc(MOVES)}</p>
    ${why ? `<h2>Why</h2><p>${esc(why)}</p>` : ''}
    <p>This one is free every day: the call we are surest of. <a href="/pricing">Members</a> get every call the moment it goes up. <a href="/results">Every result is on the record</a>.</p>
    ${moreHTML(liveKinds(picks))}
  </article>`,
    jsonLd: [c.ld],
  };
}

/** Every kind of prediction, each with how it has gone. */
export async function predictionsHub(env: SeoEnv, site: string): Promise<Page> {
  const picks = await settledPicks(env);
  const kinds = liveKinds(picks);
  const c = crumbs([[SITE, '/'], ['Predictions', '/predictions']], site);
  return {
    title: 'Football predictions by type: goals, double chance, draw no bet and more',
    description: clip(`Every kind of football prediction we make, what has to happen for each to land, and how each has gone: ${kinds.map((k) => k.name.toLowerCase()).join(', ')}.`),
    canonical: `${site}/predictions`,
    body: `
  <article class="wrap section narrow seo">
    ${c.html}
    <h1 class="display">Football predictions by type</h1>
    <p>Every call we make is one of these. Each page says what has to happen for it to land, and how our calls of that kind have gone.</p>
    <ul class="seo-list">${kinds.map((k) => {
      const r = record(picks.filter(k.match));
      return `<li><a href="/predictions/${k.slug}">${esc(k.name)} predictions</a>: ${esc(k.what)} Of our last ${esc(word(r.n))}, ${esc(word(r.won))} landed.</li>`;
    }).join('')}</ul>
    ${moreHTML()}
  </article>`,
    jsonLd: [c.ld, {
      '@context': 'https://schema.org', '@type': 'ItemList', name: 'Football predictions by type',
      itemListElement: kinds.map((k, i) => ({ '@type': 'ListItem', position: i + 1, url: `${site}/predictions/${k.slug}`, name: `${k.name} predictions` })),
    }],
  };
}

/** One kind: what it means, how ours have gone, and the latest of them. */
export async function kindPage(env: SeoEnv, slugName: string, site: string): Promise<Page | null> {
  const kind = KINDS.find((k) => k.slug === slugName);
  if (!kind) return null;
  const picks = await settledPicks(env);
  const mine = picks.filter(kind.match);
  if (mine.length < ENOUGH) return null;
  const r = record(mine);
  const c = crumbs([[SITE, '/'], ['Predictions', '/predictions'], [kind.name, `/predictions/${kind.slug}`]], site);
  const line = `${r.won} of our last ${r.n} ${kind.name.toLowerCase()} calls landed.`;
  return {
    title: `${kind.name} predictions today, and how ours have gone`,
    description: clip(`${kind.name} predictions: ${kind.what} ${line}`),
    canonical: `${site}/predictions/${kind.slug}`,
    body: `
  <article class="wrap section narrow seo">
    ${c.html}
    <h1 class="display">${esc(kind.name)} predictions</h1>
    <p>${esc(kind.what)}</p>
    <p>${esc(line)} Every one of them is on <a href="/results">the results page</a> with the score that settled it.</p>
    <p>Today's ${esc(kind.name.toLowerCase())} calls are on <a href="/today">today's board</a>: one call a day is free, and <a href="/pricing">members</a> get the rest the moment they go up. ${esc(MOVES)}</p>
    <h2>The latest ${esc(kind.name.toLowerCase())} calls, settled</h2>
    <ul class="seo-list">${mine.slice(0, 30).map((p) => {
      const home = String(p.home_team ?? '');
      const away = String(p.away_team ?? '');
      const sc = p.home_goals != null && p.away_goals != null ? `${home} ${p.home_goals}–${p.away_goals} ${away}` : `${home} v ${away}`;
      return `<li><a href="${esc(matchPath({ id: p.fixture_id, home, away }))}">${esc(sc)}</a>, ${esc(ukTime(Number(p.kickoff)).day)}: ${esc(callName(p, home, away))} at ${esc(Number(p.odds).toFixed(2))}, ${esc(RESULT_WORD[p.result] ?? 'settled')}.</li>`;
    }).join('')}</ul>
    ${moreHTML(liveKinds(picks).filter((k) => k.slug !== kind.slug))}
  </article>`,
    jsonLd: [c.ld],
  };
}

/** A team: its next games, its last ones, and our calls on them. */
export async function teamPage(env: SeoEnv, id: number, site: string): Promise<Page | null> {
  const d = await read<Rec>(env, 'get_team', { p_id: id });
  if (!d?.name) return null;
  const name = String(d.name);
  const now = Date.now() / 1000;
  const games: Rec[] = Array.isArray(d.games) ? d.games : [];
  const later: Rec[] = Array.isArray(d.later) ? d.later : [];
  const ahead = [...games.filter((f) => stateOf(f, now) !== 'ft'), ...later.map((x): Rec => ({ ...x, later: true }))].sort((a, b) => a.kickoff - b.kickoff);
  const played = games.filter((f) => stateOf(f, now) === 'ft').sort((a, b) => b.kickoff - a.kickoff).slice(0, 10);
  const next = ahead[0];
  const leagues = new Map<number, string>();
  for (const f of [...games, ...later]) if (f.league_id && f.league) leagues.set(Number(f.league_id), String(f.league));
  const results = played.filter((f) => Array.isArray(f.score)).map((f) => {
    const home = f.home_id === id || f.home === name;
    const [a, b] = home ? [f.score[0], f.score[1]] : [f.score[1], f.score[0]];
    return a > b ? 'W' : a < b ? 'L' : 'D';
  });
  const w = results.filter((x) => x === 'W').length;
  const dr = results.filter((x) => x === 'D').length;
  const l = results.filter((x) => x === 'L').length;
  const form = results.length >= 3 ? `${name} have won ${word(w)}, drawn ${word(dr)} and lost ${word(l)} of the last ${word(results.length)} we have.` : '';
  const nextLine = next ? `Next: ${next.home} v ${next.away}, ${ukTime(Number(next.kickoff)).day} at ${ukTime(Number(next.kickoff)).time} UK${next.league ? `, ${next.league}` : ''}.` : 'No match in the next few weeks that we know of.';
  const c = crumbs([[SITE, '/'], ...(leagues.size ? [[[...leagues.values()][0]!, leaguePath([...leagues.keys()][0], [...leagues.values()][0])] as [string, string]] : []), [name, teamPath(id, name)]], site);
  return {
    title: `${name} prediction${next ? `: ${next.home} v ${next.away}` : ''}, fixtures and results`,
    description: clip(`${nextLine} ${form} Our call on every ${name} match we cover, team news, and every result.`),
    canonical: `${site}${teamPath(id, name)}`,
    json: `${site}/api/team/${id}`,
    body: `
  <article class="wrap section narrow seo">
    ${c.html}
    <h1 class="display">${esc(name)} predictions</h1>
    <p>${esc(nextLine)} ${esc(form)}</p>
    ${ahead.length ? `<h2>Coming up</h2>${listHTML(ahead)}` : ''}
    ${played.length ? `<h2>Results</h2>${listHTML(played)}` : ''}
    ${leagues.size ? `<h2>Competitions</h2><ul class="seo-list">${[...leagues].map(([lid, ln]) => `<li><a href="${esc(leaguePath(lid, ln))}">${esc(leagueTitle(ln))}</a></li>`).join('')}</ul>` : ''}
    ${moreHTML()}
  </article>`,
    jsonLd: [c.ld, {
      '@context': 'https://schema.org', '@type': 'SportsTeam', name, sport: 'Football', url: `${site}${teamPath(id, name)}`,
      ...(leagues.size ? { memberOf: [...leagues.values()].map((ln) => ({ '@type': 'SportsOrganization', name: ln })) } : {}),
    }],
  };
}

/** Find a game: a form that works without the app, and the results of one. */
export async function searchPage(env: SeoEnv, q: string, site: string): Promise<Page> {
  const term = q.trim().slice(0, 60);
  const d = term.length >= 2 ? await read<Rec>(env, 'search_games', { p_q: term }) : null;
  const found: Rec[] = [...(Array.isArray(d?.analysed) ? d!.analysed : []), ...(Array.isArray(d?.later) ? d!.later.map((x: Rec) => ({ ...x, later: true })) : [])];
  const leagues: Rec[] = Array.isArray(d?.leagues) ? d!.leagues : [];
  const c = crumbs([[SITE, '/'], ['Find a game', '/search']], site);
  return {
    title: term ? `${term}: games and predictions` : 'Find a game',
    description: 'Search every match and competition we cover by team or competition name.',
    canonical: `${site}/search`,
    // A page of search results is not a page to list in search results.
    noindex: true,
    body: `
  <article class="wrap section narrow seo">
    ${c.html}
    <h1 class="display">Find a game</h1>
    <form action="/search" method="get" role="search" class="seo-search">
      <label for="seo-q">Team or competition</label>
      <input id="seo-q" name="q" type="search" value="${esc(term)}" minlength="2" maxlength="60" autocomplete="off">
      <button class="btn btn-primary btn-sm" type="submit">Search</button>
    </form>
    ${term ? (found.length || leagues.length ? `
      ${leagues.length ? `<h2>Competitions</h2><ul class="seo-list">${leagues.map((l) => `<li><a href="${esc(leaguePath(l.id, l.name))}">${esc(l.name)}</a></li>`).join('')}</ul>` : ''}
      ${found.length ? `<h2>Matches</h2>${listHTML(found)}` : ''}`
      : `<p>Nothing matches “${esc(term)}” in the next two weeks. Try a team's name as it is usually written, or <a href="/leagues">browse the competitions</a>.</p>`) : ''}
  </article>`,
    jsonLd: [c.ld],
  };
}

/** The legal pages at their own addresses, written out in full. */
export const LEGAL_PATHS: Record<string, string> = {
  '/cookies': 'cookies', '/refunds': 'refunds', '/contact': 'contact', '/responsible-gambling': 'responsible',
};
export function legalPage(path: string, site: string): Page | null {
  const which = LEGAL_PATHS[path];
  const doc = which ? (LEGAL as Record<string, { title: string; standfirst?: string }>)[which] : null;
  if (!which || !doc) return null;
  return {
    title: doc.title,
    description: clip(String(doc.standfirst ?? `${doc.title} for Offside.win.`).replace(/<[^>]+>/g, '')),
    canonical: `${site}${path}`,
    body: `<div class="wrap section narrow">${legalHTML(which)}</div>`,
    jsonLd: [],
  };
}
