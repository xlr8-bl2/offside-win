/**
 * Pages a search engine can read.
 *
 * The site is one page with its routes after a `#` (`/#/fixture/212602`), and
 * to a search engine everything after a `#` is the same page: the front page
 * was the only thing Google could ever list. So every match, competition and
 * the day's board also has a real address, served from here:
 *
 *   /match/<id>/<home>-v-<away>   /league/<id>/<name>   /today   /results
 *   /leagues   /pricing   /sitemap.xml
 *
 * Each is the ordinary page (index.html) with its head and first screen
 * written for that address: a title and description that say what state the
 * match is in right now (to come, with or without a call; under way; the
 * result and how the call went), structured data, and a readable summary in
 * the page body. The app then boots on top and draws the full page as usual,
 * so a reader arriving from a search result gets the real thing.
 *
 * Everything here is read with the public key and so is the free copy. A call
 * that is for members is described as existing and nothing more; the one
 * free call a day and every settled call are public already and are named.
 * Prose written by the engine is not reused: it is written for the page, in
 * the site's voice, from the facts.
 */

import { describe as describeCall } from '../../public/js/lib/markets.js';
import { findBannedInProse } from '../../engine/src/vocabulary.ts';

export interface SeoEnv {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  SITE_URL?: string;
  ASSETS: { fetch(input: Request | string): Promise<Response> };
}

type Rec = Record<string, any>;

/* ------------------------------------------------------------------ helpers */

export function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

export function slug(s: unknown): string {
  return String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'match';
}

export const matchPath = (f: { id?: unknown; home?: unknown; away?: unknown }) =>
  `/match/${Number(f.id)}/${slug(f.home)}-v-${slug(f.away)}`;
export const leaguePath = (id: unknown, name: unknown) => `/league/${Number(id)}/${slug(name)}`;

const WORDS = ['none', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const word = (n: number) => (n >= 0 && n <= 10 ? WORDS[n] : String(n));
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** What a result page shows of a description, cut at a word. */
export function clip(s: string, n = 158): string {
  if (s.length <= n) return s;
  const cut = s.slice(0, n - 1);
  return `${cut.slice(0, cut.lastIndexOf(' ')).replace(/[,.:;]$/, '')}…`;
}

function ukTime(epoch: number): { day: string; time: string; iso: string } {
  const d = new Date(epoch * 1000);
  return {
    day: new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', weekday: 'long', day: 'numeric', month: 'long' }).format(d),
    time: new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit' }).format(d),
    iso: d.toISOString(),
  };
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}

async function read<T>(env: SeoEnv, fn: string, args: Record<string, string | number | undefined>): Promise<T | null> {
  const url = new URL(`/rest/v1/rpc/${fn}`, env.SUPABASE_URL);
  for (const [k, v] of Object.entries(args)) if (v !== undefined) url.searchParams.set(k, String(v));
  const res = await fetch(url, {
    headers: { apikey: env.SUPABASE_ANON_KEY, authorization: `Bearer ${env.SUPABASE_ANON_KEY}`, accept: 'application/json' },
  });
  if (!res.ok) return null;
  const text = await res.text();
  if (!text || text === 'null') return null;
  try { return JSON.parse(text) as T; } catch { return null; }
}

/** What state a match is in, from the same fields the app reads. */
export function stateOf(f: Rec, now = Date.now() / 1000): 'upcoming' | 'live' | 'ft' | 'off' {
  const st = String(f.status ?? '').toLowerCase();
  if (Array.isArray(f.score) && f.score.length === 2) return 'ft';
  if (['finished', 'ended', 'aet', 'ap'].includes(st)) return 'ft';
  if (['postponed', 'cancelled', 'canceled'].includes(st)) return 'off';
  if (['inprogress', 'live', '1h', '2h', 'ht', 'halftime', 'et', 'pen'].includes(st)) return 'live';
  const since = now - Number(f.kickoff ?? 0);
  if (since > 3 * 3600) return 'ft';
  if (since > 0) return 'live';
  return 'upcoming';
}

const RESULT_WORD: Record<string, string> = { WON: 'landed', LOST: 'missed', HALF_WON: 'half landed', HALF_LOST: 'half lost', PUSH: 'stakes back', VOID: 'void' };

function callName(p: Rec, home: string, away: string): string {
  try { return describeCall({ market: p.market, outcome: p.outcome, line: p.line, home, away, odds: null, stake: 10 }).name; }
  catch { return 'our call'; }
}

/** "won two, drew one and lost three of their last six" */
function formLine(team: string, form: Rec | null | undefined): string | null {
  const seq = String(form?.sequence ?? '').toUpperCase().replace(/[^WDL]/g, '');
  if (seq.length < 3) return null;
  const w = [...seq].filter((c) => c === 'W').length;
  const d = [...seq].filter((c) => c === 'D').length;
  const l = [...seq].filter((c) => c === 'L').length;
  const n = seq.length;
  if (w === 0 && d === 0) return `${team} have lost all ${word(n)} of their last ${word(n)}.`;
  if (l === 0 && d === 0) return `${team} have won all ${word(n)} of their last ${word(n)}.`;
  if (w === 0) return `${team} are without a win in ${word(n)}: ${word(d)} drawn, ${word(l)} lost.`;
  if (l === 0) return `${team} are unbeaten in ${word(n)}: ${word(w)} won, ${word(d)} drawn.`;
  return `${team} have won ${word(w)}, drawn ${word(d)} and lost ${word(l)} of their last ${word(n)}.`;
}

function h2hLine(home: string, away: string, h2h: Rec | null | undefined): string | null {
  const n = Number(h2h?.total_matches) || 0;
  if (!n) return null;
  const hw = Number(h2h?.home_wins) || 0;
  const aw = Number(h2h?.away_wins) || 0;
  const d = Number(h2h?.draws) || 0;
  const parts = [hw ? `${home} won ${word(hw)}` : null, aw ? `${away} won ${word(aw)}` : null, d ? `${word(d)} ${d === 1 ? 'was' : 'were'} drawn` : null].filter(Boolean);
  const last = Array.isArray(h2h?.recent_matches) ? h2h!.recent_matches[0] : null;
  const lastLine = last?.home && last?.away && last?.score
    ? ` Last time: ${last.home} ${String(last.score).replace('-', '–')} ${last.away}${last.date ? `, ${new Date(last.date).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'Europe/London' })}` : ''}.`
    : '';
  return `${cap(word(n))} ${n === 1 ? 'meeting' : 'meetings'} between them: ${parts.join(', ')}.${lastLine}`;
}

function tableLine(home: string, away: string, st: Rec | null | undefined): string | null {
  const h = Number(st?.home?.position) || 0;
  const a = Number(st?.away?.position) || 0;
  if (!h || !a) return null;
  const group = st?.home?.group && st.home.group === st?.away?.group ? ` in ${st.home.group}` : '';
  return `${home} are ${ordinal(h)} and ${away} ${ordinal(a)}${group}.`;
}

function starters(side: Rec | null | undefined): string[] {
  const players = Array.isArray(side?.players) ? side!.players : [];
  return players.filter((p: Rec) => p?.starting && p?.name).map((p: Rec) => String(p.name)).slice(0, 11);
}

/* -------------------------------------------------------------- the pages */

export interface Page {
  title: string;
  description: string;
  canonical: string;
  body: string;
  jsonLd: unknown[];
  status?: number;
  /** A match gone from the database, or an address that will never exist. */
  noindex?: boolean;
}

const SITE = 'offside.win';
const MOVES = 'Calls are looked at again every fifteen minutes until kick-off, so one can change or come down, and each closes when the match starts.';

function crumbs(items: Array<[string, string]>, site: string): { html: string; ld: unknown } {
  return {
    html: `<p class="seo-crumbs">${items.map(([name, href]) => `<a href="${esc(href)}">${esc(name)}</a>`).join(' <span aria-hidden="true">/</span> ')}</p>`,
    ld: {
      '@context': 'https://schema.org', '@type': 'BreadcrumbList',
      itemListElement: items.map(([name, href], i) => ({ '@type': 'ListItem', position: i + 1, name, item: `${site}${href}` })),
    },
  };
}

export async function matchPage(env: SeoEnv, id: number, site: string): Promise<Page | null> {
  const f = await read<Rec>(env, 'get_fixture', { p_id: id });
  if (!f?.home || !f?.away) return null;
  const home = String(f.home);
  const away = String(f.away);
  const league = String(f.league ?? '');
  const when = ukTime(Number(f.kickoff));
  const state = stateOf(f);
  const canonical = `${site}${matchPath(f)}`;
  const venue = f.venue?.name ? `${f.venue.name}${f.venue.city ? `, ${f.venue.city}` : ''}` : null;
  const round = String(f.round_label ?? '').split(/\s*·\s*/).filter(Boolean).join(', ');

  const published: Rec[] = Array.isArray(f.published) ? f.published : [];
  const settledCall = published.find((p) => p?.market && p?.result) ?? null;
  const openCall = published.find((p) => p?.market && !p?.result) ?? null;
  const locked = Boolean(f.locked) || (Number(f.locked_calls) || 0) > 0;
  const hasCall = Boolean(openCall || settledCall || locked || (Array.isArray(f.verdicts) && f.verdicts.length));

  const score: number[] | null = Array.isArray(f.score) && f.score.length === 2 ? f.score : null;
  const live: number[] | null = Array.isArray(f.live_score) && f.live_score.length === 2 ? f.live_score : null;
  const vs = score ? `${home} ${score[0]}–${score[1]} ${away}` : `${home} v ${away}`;

  let title: string;
  let description: string;
  let callHTML: string;
  if (state === 'ft' && score) {
    title = `${vs}: result, scorers and our call`;
    description = settledCall
      ? `${vs} in the ${league}. Our call, ${callName(settledCall, home, away)}, ${RESULT_WORD[settledCall.result] ?? 'was settled'}. Scorers, the stats and how it went.`
      : `${vs} in the ${league}: the result, the scorers and the stats.${hasCall ? '' : ' We did not have a call on this one.'}`;
    callHTML = settledCall
      ? `<p>Our call was <b>${esc(callName(settledCall, home, away))}</b>, at odds of ${esc(Number(settledCall.odds).toFixed(2))}${settledCall.bookmaker ? ` with ${esc(settledCall.bookmaker)}` : ''}. It ${esc(RESULT_WORD[settledCall.result] ?? 'was settled')}. Every settled call is on <a href="/results">the record</a>, the misses included.</p>`
      : `<p>We did not have a call on this match.</p>`;
  } else if (state === 'live') {
    title = `${home} v ${away} live${live ? `: ${live[0]}–${live[1]}` : ''}`;
    description = `${home} v ${away} is under way in the ${league}${live ? `, ${live[0]}–${live[1]}${f.live_minute ? ` after ${f.live_minute} minutes` : ''}` : ''}. ${hasCall ? 'Our call closed at kick-off and goes up with how it went at full time.' : 'Team news, form and the head-to-head.'}`;
    callHTML = hasCall
      ? `<p>We have a call on this match. It closed at kick-off: calls are not sold once a match is on, and this one is shown here at full time with whether it landed.</p>`
      : `<p>We passed on this match before kick-off.</p>`;
  } else {
    title = `${home} v ${away} prediction, preview and team news`;
    if (openCall) {
      const name = callName(openCall, home, away);
      description = `${home} v ${away}, ${when.day} ${when.time} UK. Today's free call: ${name}. The reasoning, team news, form and head-to-head.`;
      callHTML = `<p>This is today's free call, open to everyone: <b>${esc(name)}</b>, at odds of ${esc(Number(openCall.odds).toFixed(2))}${openCall.bookmaker ? ` with ${esc(openCall.bookmaker)}` : ''}. ${esc(MOVES)}</p>`;
    } else if (hasCall) {
      description = `${home} v ${away}, ${league}, ${when.day} ${when.time} UK. We have a call on this one. Team news, form and the head-to-head.`;
      callHTML = `<p>We have a call on this match. Which market, the odds and the book are for <a href="/pricing">members</a>; the reading of the match is free. ${esc(MOVES)}</p>`;
    } else {
      description = `${home} v ${away}, ${league}, ${when.day} ${when.time} UK. We looked and passed on this one. Team news, form, the table and the head-to-head.`;
      callHTML = `<p>We looked at this match and did not find a call worth making. That can change as team news comes in: ${esc(MOVES.toLowerCase())}</p>`;
    }
  }

  const facts = [
    formLine(home, f.form?.home),
    formLine(away, f.form?.away),
  ].filter(Boolean) as string[];
  const h2h = h2hLine(home, away, f.h2h);
  const table = tableLine(home, away, f.standings);
  const hs = starters(f.lineups?.home);
  const as = starters(f.lineups?.away);
  const sheets = hs.length && as.length
    ? `<h2>${f.lineup_status === 'confirmed' ? 'Line-ups' : 'Expected line-ups'}</h2>
       <p><b>${esc(home)}:</b> ${esc(hs.join(', '))}.</p>
       <p><b>${esc(away)}:</b> ${esc(as.join(', '))}.</p>` : '';

  const goals: Rec[] = (Array.isArray(f.report?.events) ? f.report.events : []).filter((e: Rec) => e?.t === 'goal' && e?.player);
  const scorers = score && goals.length
    ? `<h2>Goals</h2><ul>${goals.map((g) => `<li>${esc(g.player)} ${esc(g.minute)}'${g.kind === 'penalty' ? ' (penalty)' : g.kind === 'own' ? ' (own goal)' : ''}, ${esc(g.side === 'home' ? home : away)}</li>`).join('')}</ul>` : '';

  // The engine's own sentence on a pass, only when it passes the same gate
  // as every other piece of free prose.
  const pass = !hasCall && state === 'upcoming' && typeof f.pass === 'string' && findBannedInProse(f.pass).length === 0
    ? `<p>${esc(f.pass)}</p>` : '';

  const c = crumbs([[SITE, '/'], ...(f.league_id && league ? [[league, leaguePath(f.league_id, league)] as [string, string]] : []), [`${home} v ${away}`, matchPath(f)]], site);

  const body = `
  <article class="wrap section narrow seo">
    ${c.html}
    <h1 class="display">${esc(state === 'ft' && score ? vs : `${home} v ${away}`)}</h1>
    <p class="seo-meta">${esc([league, round].filter(Boolean).join(', '))}. ${state === 'ft' ? 'Played' : 'Kick-off'} ${esc(when.day)}, ${esc(when.time)} UK time${venue ? `, at ${esc(venue)}` : ''}.</p>
    <h2>Our call</h2>
    ${callHTML}
    ${pass}
    ${scorers}
    ${facts.length ? `<h2>Form</h2><ul>${facts.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
    ${h2h ? `<h2>Head to head</h2><p>${esc(h2h)}</p>` : ''}
    ${table ? `<h2>The table</h2><p>${esc(table)}</p>` : ''}
    ${sheets}
    <p><a href="/today">Every match on today's board</a>${f.league_id ? ` <span aria-hidden="true">/</span> <a href="${esc(leaguePath(f.league_id, league))}">More from the ${esc(league)}</a>` : ''}</p>
  </article>`;

  const status = state === 'ft' ? 'https://schema.org/EventCompleted'
    : state === 'off' ? 'https://schema.org/EventPostponed' : 'https://schema.org/EventScheduled';
  const event: Rec = {
    '@context': 'https://schema.org', '@type': 'SportsEvent',
    name: `${home} v ${away}`, sport: 'Football', url: canonical, description,
    startDate: when.iso, eventStatus: status, eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    homeTeam: { '@type': 'SportsTeam', name: home }, awayTeam: { '@type': 'SportsTeam', name: away },
    competitor: [{ '@type': 'SportsTeam', name: home }, { '@type': 'SportsTeam', name: away }],
    location: venue ? { '@type': 'Place', name: f.venue.name, address: f.venue.city ?? f.venue.name } : { '@type': 'Place', name: `${home} v ${away}` },
    ...(league ? { superEvent: { '@type': 'SportsEvent', name: league } } : {}),
    organizer: { '@type': 'Organization', name: league || SITE },
  };

  return { title, description: clip(description), canonical, body, jsonLd: [event, c.ld] };
}

function rowStatus(f: Rec): string {
  const state = stateOf(f);
  if (state === 'ft' && Array.isArray(f.score)) {
    const r = f.called?.result ? ` Our call ${RESULT_WORD[f.called.result] ?? 'was settled'}.` : '';
    return `Full time, ${f.score[0]}–${f.score[1]}.${r}`;
  }
  if (state === 'live') return f.locked || f.top_pick ? 'Under way. Our call closed at kick-off.' : 'Under way.';
  if (f.top_pick && f.free_call) return `Today's free call: ${callName(f.top_pick, f.home, f.away)}.`;
  if (f.top_pick || f.locked) return 'We have a call on this one.';
  return 'No call.';
}

function listHTML(fixtures: Rec[]): string {
  return `<ul class="seo-list">${fixtures.map((f) => {
    const t = ukTime(Number(f.kickoff));
    const vs = stateOf(f) === 'ft' && Array.isArray(f.score) ? `${f.home} ${f.score[0]}–${f.score[1]} ${f.away}` : `${f.home} v ${f.away}`;
    return `<li><a href="${esc(matchPath(f))}">${esc(vs)}</a>, ${esc(t.time)}. ${esc(rowStatus(f))}</li>`;
  }).join('')}</ul>`;
}

function byDayAndLeague(fixtures: Rec[]): string {
  const days = new Map<string, Rec[]>();
  for (const f of [...fixtures].sort((a, b) => a.kickoff - b.kickoff)) {
    const d = ukTime(Number(f.kickoff)).day;
    days.set(d, [...(days.get(d) ?? []), f]);
  }
  return [...days].map(([day, list]) => {
    const leagues = new Map<string, Rec[]>();
    for (const f of list) leagues.set(String(f.league ?? ''), [...(leagues.get(String(f.league ?? '')) ?? []), f]);
    // The biggest competitions first, the way the board orders them.
    const top = (fs: Rec[]) => Math.min(...fs.map((f) => Number(f.rank) || 99));
    const ordered = [...leagues].sort((a, b) => top(a[1]) - top(b[1]));
    return `<h2>${esc(day)}</h2>${ordered.map(([name, fs]) => `
      <h3>${fs[0]?.league_id ? `<a href="${esc(leaguePath(fs[0].league_id, name))}">${esc(name)}</a>` : esc(name)}</h3>${listHTML(fs)}`).join('')}`;
  }).join('');
}

export async function todayPage(env: SeoEnv, site: string): Promise<Page> {
  const now = Math.floor(Date.now() / 1000);
  const b = await read<Rec>(env, 'get_board', { p_from: now - 12 * 3600, p_to: now + 48 * 3600 });
  const fixtures: Rec[] = Array.isArray(b?.fixtures) ? b!.fixtures : [];
  const calls = fixtures.filter((f) => f.top_pick || f.locked || f.called).length;
  const comps = new Set(fixtures.map((f) => f.league)).size;
  const day = ukTime(now).day;
  const free = fixtures.find((f) => f.free_call && f.top_pick);
  const c = crumbs([[SITE, '/'], ["Today's board", '/today']], site);
  return {
    title: `Football predictions today, ${day}: ${calls} ${calls === 1 ? 'call' : 'calls'}`,
    description: clip(`${calls} calls across ${fixtures.length} matches in ${comps} competitions.${free ? ` Today's free call: ${free.home} v ${free.away}.` : ''} Team news, form and the reason behind every call.`),
    canonical: `${site}/today`,
    body: `
  <article class="wrap section narrow seo">
    ${c.html}
    <h1 class="display">Today's board</h1>
    <p>${esc(`${fixtures.length} matches across ${comps} competitions, with ${calls} calls.`)} ${esc(MOVES)} One call a day is free; members get the rest.</p>
    ${free ? `<p>Today's free call is <a href="${esc(matchPath(free))}">${esc(`${free.home} v ${free.away}`)}</a>: ${esc(callName(free.top_pick, free.home, free.away))}.</p>` : ''}
    ${byDayAndLeague(fixtures)}
  </article>`,
    jsonLd: [c.ld, {
      '@context': 'https://schema.org', '@type': 'ItemList', name: "Today's board",
      itemListElement: fixtures.slice(0, 100).map((f, i) => ({ '@type': 'ListItem', position: i + 1, url: `${site}${matchPath(f)}`, name: `${f.home} v ${f.away}` })),
    }],
  };
}

export async function leaguePage(env: SeoEnv, id: number, site: string): Promise<Page | null> {
  const d = await read<Rec>(env, 'get_league', { p_id: id });
  if (!d?.league?.name) return null;
  const name = String(d.league.name);
  const now = Date.now() / 1000;
  const fixtures: Rec[] = Array.isArray(d.fixtures) ? d.fixtures : [];
  const ahead = fixtures.filter((f) => stateOf(f, now) !== 'ft').sort((a, b) => a.kickoff - b.kickoff);
  const played = fixtures.filter((f) => stateOf(f, now) === 'ft').sort((a, b) => b.kickoff - a.kickoff).slice(0, 12);
  const rows: Rec[] = Array.isArray(d.standings) ? d.standings : [];
  const rec = d.record && Number(d.record.n) ? `Our calls in the ${name}: ${word(Number(d.record.wins))} of ${word(Number(d.record.n))} landed.` : '';
  const groups = new Map<string, Rec[]>();
  for (const r of rows) groups.set(String(r.group ?? ''), [...(groups.get(String(r.group ?? '')) ?? []), r]);
  const tables = [...groups].map(([g, rs]) => `
    ${g ? `<h3>${esc(g)}</h3>` : ''}
    <table class="tbl"><thead><tr><th>Pos</th><th>Team</th><th>Played</th><th>Points</th></tr></thead><tbody>
      ${rs.map((r) => `<tr><td>${esc(r.position)}</td><td>${esc(r.team)}</td><td>${esc(r.played)}</td><td>${esc(r.points)}</td></tr>`).join('')}
    </tbody></table>`).join('');
  const c = crumbs([[SITE, '/'], ['Leagues', '/leagues'], [name, leaguePath(id, name)]], site);
  const leader = rows.find((r) => Number(r.position) === 1 && !r.group);
  return {
    title: `${name} predictions, fixtures, results and table`,
    description: clip(`${name}: ${ahead.length} matches coming up${ahead[0] ? `, next ${ahead[0].home} v ${ahead[0].away}` : ''}. Our call on each, the latest results${leader ? `, and the table, led by ${leader.team}` : ' and the table'}.`),
    canonical: `${site}${leaguePath(id, name)}`,
    body: `
  <article class="wrap section narrow seo">
    ${c.html}
    <h1 class="display">${esc(name)}</h1>
    <p>${esc(`Every ${name} match we cover, with our call on each, the results and the table.`)} ${esc(rec)}</p>
    ${ahead.length ? `<h2>Coming up</h2>${listHTML(ahead)}` : ''}
    ${played.length ? `<h2>Results</h2>${listHTML(played)}` : ''}
    ${rows.length ? `<h2>The table</h2>${tables}` : ''}
  </article>`,
    jsonLd: [c.ld],
  };
}

export async function resultsPage(env: SeoEnv, site: string): Promise<Page> {
  const d = await read<Rec>(env, 'get_picks', { p_limit: 60, p_settled: 'true' });
  const picks: Rec[] = Array.isArray(d?.picks) ? d!.picks : [];
  const graded = picks.filter((p) => p.result && p.result !== 'VOID');
  const won = graded.filter((p) => p.result === 'WON' || p.result === 'HALF_WON').length;
  // In money, never units, and the sign as it is.
  const pnl = picks.reduce((s, p) => s + (Number.isFinite(Number(p.pnl)) && p.pnl !== null ? Number(p.pnl)
    : p.result === 'WON' ? Number(p.odds) - 1 : p.result === 'LOST' ? -1 : 0), 0) * 10;
  const money = `£${Math.abs(pnl).toFixed(2)} ${pnl < 0 ? 'down' : 'up'}`;
  const c = crumbs([[SITE, '/'], ['Results', '/results']], site);
  return {
    title: 'Our record: every call and how it went',
    description: `Of the last ${graded.length} calls, ${won} landed. £10 on every one would have left you ${money}. Every settled call, the misses included.`,
    canonical: `${site}/results`,
    body: `
  <article class="wrap section narrow seo">
    ${c.html}
    <h1 class="display">The record</h1>
    <p>${esc(`Of the last ${graded.length} calls, ${won} landed. £10 on every one would have left you ${money}.`)} The record is public and stays that way, including when it has gone badly. Nothing here is a promise of profit.</p>
    <ul class="seo-list">${picks.map((p) => {
      const home = String(p.home_team ?? p.home ?? '');
      const away = String(p.away_team ?? p.away ?? '');
      const t = ukTime(Number(p.kickoff));
      const sc = p.home_goals != null && p.away_goals != null ? `${home} ${p.home_goals}–${p.away_goals} ${away}` : `${home} v ${away}`;
      return `<li><a href="${esc(matchPath({ id: p.fixture_id, home, away }))}">${esc(home && away ? sc : 'Match')}</a>, ${esc(t.day)}: ${esc(callName(p, home, away))}, ${esc(RESULT_WORD[p.result] ?? 'settled')}.</li>`;
    }).join('')}</ul>
  </article>`,
    jsonLd: [c.ld],
  };
}

function staticPage(path: string, site: string): Page | null {
  if (path === '/pricing') {
    return {
      title: 'Membership: every call, from £3.49 for the weekend',
      description: 'One call a day is free. Members get every call the moment it goes up, the legs of the bet slip and the reason behind each call. Cancel in one tap.',
      canonical: `${site}/pricing`,
      body: `<article class="wrap section narrow seo"><h1 class="display">One call a day is free. Members get all of them.</h1>
        <p>Every preview, every team sheet and the whole record stay free. Membership is every open call the moment it goes up, the legs of the bet slip, and the reason behind each call. ${esc(MOVES)}</p>
        <p><a href="/today">Today's board</a> <span aria-hidden="true">/</span> <a href="/results">The record</a></p></article>`,
      jsonLd: [],
    };
  }
  if (path === '/leagues') {
    return {
      title: 'Leagues and competitions we cover',
      description: 'Eighty-eight competitions, from the Premier League and the Champions League down. Fixtures, results, tables and our call on every match.',
      canonical: `${site}/leagues`,
      body: `<article class="wrap section narrow seo"><h1 class="display">Leagues</h1>
        <p>Eighty-eight competitions, with fixtures, results, the table and our call on every match. <a href="/today">Today's board</a> has every match on right now.</p></article>`,
      jsonLd: [],
    };
  }
  return null;
}

/* ---------------------------------------------------------- the response */

/** The page the app lives in, with its head and first screen written for this address. */
export function render(shell: string, page: Page): string {
  const t = `${page.title} | ${SITE}`;
  const ld = page.jsonLd.map((x) => `<script type="application/ld+json">${JSON.stringify(x).replace(/</g, '\\u003c')}</script>`).join('\n');
  let html = shell
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(t)}</title>`)
    .replace(/<meta name="description" content="[^"]*">/, `<meta name="description" content="${esc(page.description)}">`)
    .replace(/<link rel="canonical" href="[^"]*">/, `<link rel="canonical" href="${esc(page.canonical)}">`)
    .replace(/<meta property="og:title" content="[^"]*">/, `<meta property="og:title" content="${esc(page.title)}">`)
    .replace(/<meta property="og:description" content="[^"]*">/, `<meta property="og:description" content="${esc(page.description)}">`)
    .replace(/<meta name="twitter:title" content="[^"]*">/, `<meta name="twitter:title" content="${esc(page.title)}">`)
    .replace(/<meta name="twitter:description" content="[^"]*">/, `<meta name="twitter:description" content="${esc(page.description)}">`)
    .replace('</head>', `<meta property="og:url" content="${esc(page.canonical)}">\n${page.noindex ? '<meta name="robots" content="noindex">\n' : ''}${ld}\n</head>`);
  html = html.replace(/<main id="app">[\s\S]*?<\/main>/, `<main id="app">${page.body}</main>`);
  return html;
}

async function shellHTML(env: SeoEnv, origin: string): Promise<string> {
  const res = await env.ASSETS.fetch(new Request(`${origin}/index.html`));
  return res.text();
}

/**
 * The page for this address, or null when the address is not one of ours
 * (the caller then serves the asset, or its 404).
 */
export async function seoResponse(request: Request, env: SeoEnv): Promise<Response | null> {
  const url = new URL(request.url);
  const site = (env.SITE_URL ?? url.origin).replace(/\/$/, '');
  const path = url.pathname.replace(/\/+$/, '') || '/';
  let page: Page | null = null;

  const m = path.match(/^\/match\/(\d+)(?:\/([^/]*))?$/);
  const l = path.match(/^\/league\/(\d+)(?:\/([^/]*))?$/);
  if (m) {
    page = await matchPage(env, Number(m[1]), site);
    // One address per match: a missing or stale name moves to the right one.
    if (page && new URL(page.canonical).pathname !== path) return Response.redirect(page.canonical, 301);
    if (!page) page = gone(site, 'That match is not on the board', 'It may be too far off to have been analysed yet, or too long ago to still be kept.');
  } else if (l) {
    page = await leaguePage(env, Number(l[1]), site);
    if (page && new URL(page.canonical).pathname !== path) return Response.redirect(page.canonical, 301);
    if (!page) page = gone(site, 'That competition is not one we cover', 'The competitions we cover are on the leagues page.');
  } else if (path === '/today') {
    page = await todayPage(env, site);
  } else if (path === '/results') {
    page = await resultsPage(env, site);
  } else {
    page = staticPage(path, site);
  }
  if (!page) return null;

  const html = render(await shellHTML(env, url.origin), page);
  return new Response(html, {
    status: page.status ?? 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      // Short: a match's state changes through the day, and so does its title.
      'cache-control': 'public, max-age=300, stale-while-revalidate=600',
    },
  });
}

function gone(site: string, head: string, why: string): Page {
  return {
    title: head, description: why, canonical: `${site}/today`, status: 404, noindex: true, jsonLd: [],
    body: `<article class="wrap section narrow seo"><h1 class="display">${esc(head)}</h1><p>${esc(why)}</p><p><a href="/today">Today's board</a></p></article>`,
  };
}

/* ------------------------------------------------------------ the sitemap */

export async function sitemap(env: SeoEnv, origin: string): Promise<Response> {
  const site = (env.SITE_URL ?? origin).replace(/\/$/, '');
  const now = Math.floor(Date.now() / 1000);
  const b = await read<Rec>(env, 'get_board', { p_from: now - 5 * 86400, p_to: now + 5 * 86400 });
  const fixtures: Rec[] = Array.isArray(b?.fixtures) ? b!.fixtures : [];
  const today = new Date().toISOString().slice(0, 10);
  const day = (e: number) => new Date(e * 1000).toISOString().slice(0, 10);
  const urls: Array<[string, string, string]> = [
    [`${site}/`, today, 'hourly'],
    [`${site}/today`, today, 'hourly'],
    [`${site}/results`, today, 'daily'],
    [`${site}/leagues`, today, 'weekly'],
    [`${site}/pricing`, today, 'monthly'],
  ];
  const leagues = new Map<number, string>();
  for (const f of fixtures) {
    if (f.league_id && f.league) leagues.set(Number(f.league_id), String(f.league));
    // A match to come changes until kick-off; a played one settles the day after.
    const upcoming = stateOf(f) !== 'ft';
    urls.push([`${site}${matchPath(f)}`, upcoming ? today : day(Number(f.kickoff) + 86400 > now ? now : Number(f.kickoff) + 86400), upcoming ? 'hourly' : 'weekly']);
  }
  for (const [id, name] of leagues) urls.push([`${site}${leaguePath(id, name)}`, today, 'daily']);
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(([loc, lastmod, freq]) => `  <url><loc>${esc(loc)}</loc><lastmod>${lastmod}</lastmod><changefreq>${freq}</changefreq></url>`).join('\n')}
</urlset>`;
  return new Response(xml, { headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=900' } });
}
