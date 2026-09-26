import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { matchPage, render, seoResponse, sitemap, slug, stateOf, todayPage } from '../src/seo.ts';
import { findBannedInProse } from '../../engine/src/vocabulary.ts';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

const SHELL = `<!doctype html><html><head><title>offside.win: x</title>
<meta name="description" content="old">
<link rel="canonical" href="https://offside.win/">
<meta property="og:title" content="old"><meta property="og:description" content="old">
<meta name="twitter:title" content="old"><meta name="twitter:description" content="old">
</head><body><main id="app"><div class="skeleton"></div></main></body></html>`;

const now = Math.floor(Date.now() / 1000);
const FIX: Record<string, any> = {
  id: 212602, home: 'Iceland', away: 'Estonia', league: 'UEFA Nations League', league_id: 64,
  kickoff: now + 7200, status: 'notstarted', venue: { name: 'Laugardalsvöllur', city: 'Reykjavík' },
  round_label: 'League C · Matchday 1', locked: true, locked_calls: 1, published: [],
  verdicts: [{ drivers: [] }],
  form: { home: { sequence: 'LLDDLL' }, away: { sequence: 'LDLDLW' } },
  h2h: { total_matches: 4, home_wins: 1, away_wins: 0, draws: 3, recent_matches: [{ home: 'Estonia', away: 'Iceland', score: '1-1', date: '2023-01-08T17:00:00Z' }] },
  standings: { home: { position: 8, group: 'Group 4' }, away: { position: 7, group: 'Group 4' } },
  lineup_status: 'confirmed',
  lineups: { home: { players: [{ name: 'A One', starting: true }] }, away: { players: [{ name: 'B Two', starting: true }] } },
};

function env(routes: Record<string, unknown>) {
  globalThis.fetch = (async (input: any) => {
    const url = String(input.url ?? input);
    for (const [k, v] of Object.entries(routes)) if (url.includes(k)) return new Response(JSON.stringify(v), { status: 200 });
    return new Response('null', { status: 200 });
  }) as any;
  return {
    SUPABASE_URL: 'https://db.example', SUPABASE_ANON_KEY: 'anon', SITE_URL: 'https://offside.win',
    ASSETS: { fetch: async () => new Response(SHELL) },
  };
}

test('a slug is plain ascii', () => {
  assert.equal(slug('Borussia Mönchengladbach'), 'borussia-monchengladbach');
  assert.equal(slug('Brighton & Hove Albion'), 'brighton-and-hove-albion');
});

test('a locked call is said to exist and nothing more, in words the site may use', async () => {
  const p = (await matchPage(env({ get_fixture: FIX }) as any, 212602, 'https://offside.win'))!;
  assert.equal(p.canonical, 'https://offside.win/match/212602/iceland-v-estonia');
  assert.match(p.title, /Iceland v Estonia prediction/);
  assert.match(p.description, /We have a call on this one/);
  assert.match(p.body, /without a win in six/);
  assert.match(p.body, /Four meetings between them/);
  assert.match(p.body, /8th and Estonia 7th in Group 4/);
  const text = (p.title + ' ' + p.description + ' ' + p.body.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ');
  assert.deepEqual(findBannedInProse(text).map((v) => v.term), [], 'banned vocabulary in the page');
  const ld = p.jsonLd[0] as any;
  assert.equal(ld['@type'], 'SportsEvent');
  assert.equal(ld.location.name, 'Laugardalsvöllur');
});

test('a played match leads with the score and how the call went', async () => {
  const f = { ...FIX, kickoff: now - 86400, status: 'finished', score: [0, 1], locked: false,
    published: [{ market: 'draw_no_bet', outcome: 'AWAY', line: null, odds: 1.14, bookmaker: 'Betano', result: 'WON' }],
    report: { events: [{ t: 'goal', side: 'away', player: 'K. Mbappé', minute: 54, kind: 'regular' }] } };
  const p = (await matchPage(env({ get_fixture: f }) as any, 212602, 'https://offside.win'))!;
  assert.match(p.title, /^Iceland 0–1 Estonia: result/);
  assert.match(p.description, /landed/);
  assert.match(p.body, /Mbappé 54'/);
  assert.equal((p.jsonLd[0] as any).eventStatus, 'https://schema.org/EventCompleted');
});

test('in play, the call is closed, not offered', async () => {
  const f = { ...FIX, kickoff: now - 1800, status: 'inprogress', live_score: [1, 0], live_minute: 31 };
  const p = (await matchPage(env({ get_fixture: f }) as any, 212602, 'https://offside.win'))!;
  assert.match(p.title, /live: 1–0/);
  assert.match(p.body, /closed at kick-off/);
  assert.doesNotMatch(p.body, /for <a href="\/pricing">members/);
  assert.equal(stateOf(f), 'live');
});

test('the shell gets this page\'s head and first screen, escaped', () => {
  const html = render(SHELL, { title: 'A <b> v B', description: 'd "q"', canonical: 'https://offside.win/x', body: '<p>hi</p>', jsonLd: [{ a: '</script>' }] });
  assert.match(html, /<title>A &lt;b&gt; v B \| offside.win<\/title>/);
  assert.match(html, /content="d &quot;q&quot;"/);
  assert.match(html, /<link rel="canonical" href="https:\/\/offside.win\/x">/);
  assert.match(html, /<main id="app"><p>hi<\/p><\/main>/);
  assert.doesNotMatch(html, /<\/script>"/, 'a closing tag inside structured data ends the script');
});

test('a stale name moves to the right address; an unknown match is a 404 kept out of search', async () => {
  const e = env({ get_fixture: FIX });
  let res = (await seoResponse(new Request('https://offside.win/match/212602/old-name'), e as any))!;
  assert.equal(res.status, 301);
  assert.equal(res.headers.get('location'), 'https://offside.win/match/212602/iceland-v-estonia');
  res = (await seoResponse(new Request('https://offside.win/match/212602/iceland-v-estonia'), e as any))!;
  assert.equal(res.status, 200);
  assert.match(await res.text(), /Iceland v Estonia prediction/);
  const e2 = env({});
  res = (await seoResponse(new Request('https://offside.win/match/1/x'), e2 as any))!;
  assert.equal(res.status, 404);
  assert.match(await res.text(), /noindex/);
  assert.equal(await seoResponse(new Request('https://offside.win/nothing-here'), e2 as any), null);
});

test('the sitemap lists the matches on the board and their competitions', async () => {
  const e = env({ get_board: { fixtures: [FIX, { ...FIX, id: 5, home: 'Real Madrid', away: 'Barcelona', league: 'La Liga', league_id: 3 }] } });
  const xml = await (await sitemap(e as any, 'https://offside.win')).text();
  assert.match(xml, /<loc>https:\/\/offside.win\/match\/5\/real-madrid-v-barcelona<\/loc>/);
  assert.match(xml, /<loc>https:\/\/offside.win\/league\/3\/la-liga<\/loc>/);
  assert.match(xml, /<loc>https:\/\/offside.win\/today<\/loc>/);
});

test('today\'s board counts what is on and names the free call', async () => {
  const free = { ...FIX, id: 9, free_call: true, locked: false, top_pick: { market: 'over_under_15', outcome: 'OVER', line: 1.5 } };
  const p = await todayPage(env({ get_board: { fixtures: [FIX, free] } }) as any, 'https://offside.win');
  assert.match(p.title, /2 calls/);
  assert.match(p.body, /Today's free call is/);
  assert.deepEqual(findBannedInProse(p.body.replace(/<[^>]+>/g, ' ')).map((v) => v.term), []);
});
