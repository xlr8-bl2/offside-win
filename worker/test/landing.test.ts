import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { cleanLinks, render, seoResponse, sitemap } from '../src/seo.ts';
import { KINDS, kindPage, predictionsHub, searchPage, teamPage, ukMidnight, weekendWindow } from '../src/landing.ts';
import { findBannedInProse } from '../../engine/src/vocabulary.ts';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

const SHELL = `<!doctype html><html><head><title>x</title><meta name="description" content="old">
<meta name="robots" content="index, follow"><link rel="canonical" href="https://offside.win/">
<meta property="og:title" content="old"><meta property="og:description" content="old">
<meta name="twitter:title" content="old"><meta name="twitter:description" content="old"></head><body>
<nav><a href="#/home" data-route="home"><span class="nl">Home</span></a><a href="#/board" data-route="board">Picks</a>
<a href="#/league/1">Premier League</a><a href="#/page/tomorrow">Tomorrow's predictions</a><a href="#/signin">Sign in</a>
<a href="#/legal/responsible">Responsible gambling</a></nav>
<main id="app"><div class="skeleton"></div></main></body></html>`;

const now = Math.floor(Date.now() / 1000);
function env(routes: Record<string, unknown>) {
  globalThis.fetch = (async (input: any) => {
    const url = String(input.url ?? input);
    for (const [k, v] of Object.entries(routes)) if (url.includes(k)) return new Response(JSON.stringify(v), { status: 200 });
    return new Response('null', { status: 200 });
  }) as any;
  return { SUPABASE_URL: 'https://db.example', SUPABASE_ANON_KEY: 'anon', SITE_URL: 'https://offside.win', ASSETS: { fetch: async () => new Response(SHELL) } };
}
// A market's name ("Over 1.5 goals") and a price ("at 1.20") are labels the
// whole site uses; the rule is about the prose around them.
const prose = (s: string) => s.replace(/<[^>]+>/g, ' ').replace(/\b(over|under) \d\.5 goals\b/gi, '$1 goals').replace(/\bat \d+\.\d{2}\b/g, '').replace(/£\d+\.\d{2}/g, 'money').replace(/\s+/g, ' ');
const pick = (i: number, market: string, outcome: string, result: string, pnl: number) => ({
  id: i, fixture_id: 100 + i, kickoff: now - i * 86400, market, outcome, line: null, odds: 1.2, result, pnl,
  home_team: `Home ${i}`, away_team: `Away ${i}`, home_goals: 2, away_goals: 1,
});
const PICKS = [
  pick(1, 'over_under_15', 'over', 'WON', 0.2), pick(2, 'over_under_15', 'over', 'LOST', -1), pick(3, 'over_under_15', 'over', 'WON', 0.2),
  pick(4, 'draw_no_bet', 'HOME', 'WON', 0.2),
];

test('the menu is written at real addresses, with the route kept for a tap', () => {
  const html = cleanLinks(SHELL);
  assert.match(html, /<a href="\/" data-hash="#\/home" data-route="home">/);
  assert.match(html, /href="\/today" data-hash="#\/board"/);
  assert.match(html, /href="\/league\/1\/premier-league" data-hash="#\/league\/1"/);
  assert.match(html, /href="\/tomorrow" data-hash="#\/page\/tomorrow"/);
  assert.match(html, /href="\/responsible-gambling" data-hash="#\/legal\/responsible"/);
  // Sign-in is not a page for a search engine; it stays a route.
  assert.match(html, /<a href="#\/signin">/);
  // Run twice, nothing changes.
  assert.equal(cleanLinks(html), html);
});

test('every page served carries the real addresses', async () => {
  const res = (await seoResponse(new Request('https://offside.win/predictions'), env({ get_picks: { picks: PICKS } }) as any))!;
  const html = await res.text();
  assert.doesNotMatch(html, /href="#\/(home|board|league)/);
});

test('UK midnight is midnight in London, summer and winter', () => {
  const fmt = (t: number) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(t * 1000));
  for (const t of [Date.UTC(2026, 6, 15, 12) / 1000, Date.UTC(2026, 11, 15, 23, 30) / 1000]) {
    assert.equal(fmt(ukMidnight(t)), '00:00');
    assert.equal(fmt(ukMidnight(t, 1)), '00:00');
    assert.ok(ukMidnight(t, 1) > t);
  }
});

test('the weekend is Friday to Monday: this one from Friday on, the next from Tuesday', () => {
  const day = (t: number) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', weekday: 'short' }).format(new Date(t * 1000));
  const wed = Date.UTC(2026, 9, 7, 12) / 1000;
  const sat = Date.UTC(2026, 9, 10, 12) / 1000;
  const a = weekendWindow(wed);
  assert.equal(day(a.from), 'Fri');
  assert.equal(day(a.to), 'Tue');
  const b = weekendWindow(sat);
  assert.ok(b.from <= sat && b.to > sat);
  assert.equal(day(b.to), 'Tue');
});

test('a kind of prediction: what it means, how ours have gone in money, the latest', async () => {
  const p = (await kindPage(env({ get_picks: { picks: PICKS } }) as any, 'over-1-5-goals', 'https://offside.win'))!;
  assert.match(p.title, /^Over 1.5 goals predictions/);
  assert.match(p.body, /Of our last 3 over 1.5 goals calls, 2 landed. £10 on every one would have left you £6.00 down/);
  assert.match(p.body, /Two goals or more/);
  assert.deepEqual(findBannedInProse(prose(p.title + ' ' + p.description + ' ' + p.body)).map((v) => v.term), []);
  // Too few settled to stand as a page, or not a kind at all.
  assert.equal(await kindPage(env({ get_picks: { picks: PICKS } }) as any, 'draw-no-bet', 'https://offside.win'), null);
  assert.equal(await kindPage(env({ get_picks: { picks: PICKS } }) as any, 'nonsense', 'https://offside.win'), null);
});

test('the hub lists only the kinds with a page behind them', async () => {
  const p = await predictionsHub(env({ get_picks: { picks: PICKS } }) as any, 'https://offside.win');
  assert.match(p.body, /\/predictions\/over-1-5-goals/);
  assert.doesNotMatch(p.body, /\/predictions\/draw-no-bet"/);
});

test('no kind says anything the vocabulary rule forbids', () => {
  for (const k of KINDS) assert.deepEqual(findBannedInProse(k.what).map((v) => v.term), [], k.slug);
});

test('a team: next game in the title, form in words, walled cards as given', async () => {
  const team = {
    id: 18, name: 'Arsenal', member: false,
    games: [
      { id: 10, home: 'Arsenal', away: 'Chelsea', home_id: 18, away_id: 20, league: 'Premier League', league_id: 1, kickoff: now - 4 * 86400, status: 'finished', score: [2, 0] },
      { id: 11, home: 'Fulham', away: 'Arsenal', home_id: 6, away_id: 18, league: 'Premier League', league_id: 1, kickoff: now - 9 * 86400, status: 'finished', score: [1, 1] },
      { id: 12, home: 'Arsenal', away: 'Spurs', home_id: 18, away_id: 21, league: 'Premier League', league_id: 1, kickoff: now - 14 * 86400, status: 'finished', score: [0, 1] },
      { id: 13, home: 'Leeds United', away: 'Arsenal', home_id: 19, away_id: 18, league: 'Premier League', league_id: 1, kickoff: now + 2 * 86400, status: 'notstarted', locked: true },
    ],
    later: [{ id: 14, home: 'Arsenal', away: 'Everton', home_id: 18, away_id: 22, league: 'Premier League', league_id: 1, kickoff: now + 9 * 86400 }],
  };
  const p = (await teamPage(env({ get_team: team }) as any, 18, 'https://offside.win'))!;
  assert.equal(p.canonical, 'https://offside.win/team/18/arsenal');
  assert.match(p.title, /^Arsenal prediction: Leeds United v Arsenal/);
  assert.match(p.body, /won one, drawn one and lost one/);
  assert.match(p.body, /We have a call on this one/);
  assert.match(p.body, /Analysed closer to kick-off/);
  assert.equal(p.json, 'https://offside.win/api/team/18');
  assert.equal(await teamPage(env({}) as any, 999, 'https://offside.win'), null);
});

test('a team address with the wrong name moves to the right one', async () => {
  const res = (await seoResponse(new Request('https://offside.win/team/18/gunners'), env({ get_team: { id: 18, name: 'Arsenal', games: [{ id: 1, home: 'Arsenal', away: 'X', kickoff: now + 3600 }], later: [] } }) as any))!;
  assert.equal(res.status, 301);
  assert.equal(res.headers.get('location'), 'https://offside.win/team/18/arsenal');
});

test('search works as a plain form and is kept out of the index', async () => {
  const p = await searchPage(env({ search_games: { analysed: [], later: [{ id: 5, home: 'Arsenal', away: 'Everton', kickoff: now + 86400 }], leagues: [] } }) as any, 'arsenal', 'https://offside.win');
  assert.equal(p.noindex, true);
  assert.match(p.body, /<form action="\/search" method="get" role="search"/);
  assert.match(p.body, /<label for="seo-q">/);
  assert.match(p.body, /Arsenal v Everton/);
  const html = render(SHELL, p);
  assert.match(html, /<meta name="robots" content="noindex">/);
});

test('the legal pages have addresses of their own, written out in full', async () => {
  const res = (await seoResponse(new Request('https://offside.win/responsible-gambling'), env({}) as any))!;
  const html = await res.text();
  assert.equal(res.status, 200);
  assert.match(html, /<link rel="canonical" href="https:\/\/offside.win\/responsible-gambling">/);
  assert.match(html, /class="doc/);
});

test('the sitemap lists the new pages and every team on the board', async () => {
  const res = await sitemap(env({
    get_board: { fixtures: [{ id: 1, home: 'Arsenal', away: 'Leeds United', home_id: 18, away_id: 19, league: 'Premier League', league_id: 1, kickoff: now + 3600 }] },
    get_picks: { picks: PICKS },
  }) as any, 'https://offside.win');
  const xml = await res.text();
  for (const u of ['/tomorrow', '/weekend', '/free-prediction', '/predictions', '/predictions/over-1-5-goals', '/team/18/arsenal', '/team/19/leeds-united', '/cookies']) {
    assert.ok(xml.includes(`https://offside.win${u}<`), u);
  }
  assert.ok(!xml.includes('/predictions/draw-no-bet<'));
});

test('pages name their JSON for agents', async () => {
  const res = (await seoResponse(new Request('https://offside.win/today'), env({ get_board: { fixtures: [] } }) as any))!;
  assert.match(await res.text(), /<link rel="alternate" type="application\/json" href="https:\/\/offside.win\/api\/board\?hours=48">/);
});
