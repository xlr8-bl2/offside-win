/**
 * Live: the scores, minutes, goals, cards and team numbers of matches being
 * played, at most thirty seconds old.
 *
 * Everything else the site serves is written by the engine on a schedule, and
 * a schedule is the wrong clock for a match in play: the board said LIVE
 * beside a score that was fifteen minutes out of date. So this one path goes
 * to the provider directly. The provider caches its live list for thirty
 * seconds; this caches our compact copy at the edge for the same, so however
 * many readers are watching, the provider is asked about twice a minute per
 * data centre.
 *
 * The provider key lives here as a Worker secret and never leaves: the browser
 * is only ever handed the compact shapes below. A match's timeline and team
 * numbers are not read live (owner, 3 November 2026): they come with the
 * full-time report.
 *
 * Fixture changes (a kick-off moved, a match postponed or abandoned) come the
 * same way, so a postponement shows within a minute instead of at the next
 * slate pass.
 */

import { leftFrom, mayAsk, spent, type Use } from './allowance.ts';

export interface LiveEnv {
  BSD_API_KEY?: string;
  BSD_BASE_URL?: string;
  DB?: { prepare(sql: string): { bind(...v: unknown[]): { first<T>(): Promise<T | null>; run(): Promise<unknown> } } };
}

/*
 * The provider's free plan is 7,500 requests a day for everything, the
 * engine included. Each answer is kept twice: in the data centre's own cache,
 * and once for the whole site in D1 (kv `live:<key>`), so a second data centre
 * takes the first one's copy instead of asking the provider again. Until
 * November 2026 only the first existed, and every data centre with a reader
 * in it asked for itself.
 *
 * The list is built at most every two minutes, the changes feed every
 * fifteen, and none of it is asked for while no match on the board could be in play (onNow).
 */
const LIST_TTL = 120;
const CHANGES_TTL = 900;
const MATCH_TTL = 120;

/** Whether any match on the board kicked off in the last two and a half hours or is about to. */
async function onNow(env: LiveEnv): Promise<boolean> {
  if (!env.DB) return true;
  const t = Math.floor(Date.now() / 1000);
  try {
    const r = await env.DB.prepare('SELECT 1 AS x FROM fixture WHERE kickoff BETWEEN ? AND ? LIMIT 1').bind(t - 9000, t + 300).first<{ x: number }>();
    return Boolean(r);
  } catch { return true; }
}

interface Ctx { waitUntil(p: Promise<unknown>): void }

const BASE = 'https://sports.bzzoiro.com';

const rec = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const numOr = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const strOr = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const epoch = (v: unknown): number | null => {
  const t = typeof v === 'string' ? Date.parse(v) : NaN;
  return Number.isFinite(t) ? Math.floor(t / 1000) : null;
};
const pair = (a: unknown, b: unknown): [number, number] | null => {
  const x = numOr(a), y = numOr(b);
  return x !== null && y !== null ? [x, y] : null;
};

/**
 * One status word the page understands, from the provider's status and
 * period. The live list says `inprogress` and puts the half in `period`; the
 * event detail puts the half in `status`. Both come out the same.
 */
export function liveStatus(status: unknown, period: unknown): string {
  const s = String(status ?? '').toLowerCase();
  const p = String(period ?? '').toLowerCase();
  if (/finish|ended|^ft$|^aet$|after|^ap$/.test(s)) return 'finished';
  if (/postpon/.test(s)) return 'postponed';
  if (/cancel/.test(s)) return 'cancelled';
  if (/abandon/.test(s)) return 'abandoned';
  if (/suspend|interrupt/.test(s)) return 'suspended';
  if (/half.?time|^ht$|break|pause/.test(s) || /half.?time|^ht$|break|pause/.test(p)) return 'halftime';
  if (/pen/.test(s) || /pen/.test(p)) return 'penalties';
  if (/extra/.test(s) || /extra/.test(p) || p === 'et' || p === 'ot') return 'extra_time';
  if (/2nd|second/.test(s) || /2nd|second|^2t$/.test(p)) return '2nd_half';
  if (/1st|first/.test(s) || /1st|first|^1t$/.test(p)) return '1st_half';
  if (/notstarted|not_started|scheduled|^ns$/.test(s)) return 'notstarted';
  return 'live';
}

export interface LiveMatch {
  id: number;
  league_id: number | null;
  league: string | null;
  home: string | null;
  away: string | null;
  home_id: number | null;
  away_id: number | null;
  kickoff: number | null;
  status: string;
  minute: number | null;
  score: [number, number] | null;
  ht: [number, number] | null;
  pens: [number, number] | null;
}

/** One row of the provider's live list (or an event detail), compact. */
export function compactMatch(raw: unknown): LiveMatch | null {
  const r = rec(raw);
  const id = numOr(r?.['id']);
  if (!r || id === null) return null;
  const pens = rec(r['penalty_shootout']);
  const status = liveStatus(r['status'], r['period']);
  return {
    id,
    league_id: numOr(r['league_id']),
    league: strOr(r['league_name']),
    home: strOr(r['home_team']),
    away: strOr(r['away_team']),
    home_id: numOr(r['home_team_id']),
    away_id: numOr(r['away_team_id']),
    kickoff: epoch(r['event_date']),
    status,
    minute: numOr(r['current_minute']),
    score: pair(r['home_score'], r['away_score']),
    // The provider fills the half-time score in as the first half goes on,
    // so it is only a half-time score once the first half is over.
    ht: status === '1st_half' || status === 'notstarted' ? null : pair(r['home_score_ht'], r['away_score_ht']),
    pens: pens ? pair(pens['home'] ?? pens['home_score'], pens['away'] ?? pens['away_score']) : null,
  };
}

export interface FixtureChange {
  id: number;
  kind: 'kickoff' | 'status';
  from: string | null;
  to: string | null;
  at: number | null;
  kickoff: number | null;
}

/**
 * The feed of changes, reduced to what the page needs: the latest change of
 * each kind per match. A kick-off moved twice is one line saying where it is
 * now and where it was first.
 */
export function reduceChanges(raw: unknown[]): FixtureChange[] {
  const byKey = new Map<string, FixtureChange>();
  for (const x of raw) {
    const r = rec(x);
    const id = numOr(r?.['event_id']);
    const kind = String(r?.['change'] ?? '');
    if (!r || id === null || (kind !== 'kickoff' && kind !== 'status')) continue;
    const at = epoch(r['changed_at']);
    const key = `${id}|${kind}`;
    const prev = byKey.get(key);
    const c: FixtureChange = {
      id, kind: kind as FixtureChange['kind'],
      // The earliest `from` and the latest `to`: where it was, where it is.
      from: prev ? prev.from : strOr(r['old_value']),
      to: strOr(r['new_value']),
      at,
      kickoff: epoch(r['event_date']),
    };
    if (prev && (prev.at ?? 0) > (at ?? 0)) {
      byKey.set(key, { ...prev, from: strOr(r['old_value']) ?? prev.from });
    } else {
      byKey.set(key, c);
    }
  }
  return [...byKey.values()].sort((a, b) => (b.at ?? 0) - (a.at ?? 0));
}

async function provider<T = unknown>(env: LiveEnv, use: Use, path: string, params: Record<string, string | number> = {}): Promise<T> {
  const url = new URL(path, env.BSD_BASE_URL || BASE);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Token ${env.BSD_API_KEY}`,
      Accept: 'application/json',
      'User-Agent': 'offside-win-live/1.0 (+https://offside.win)',
    },
  });
  // Counted against this use's hourly budget, and what is left shared with
  // the engine (allowance.ts).
  await spent(env.DB, use, 1, leftFrom(res));
  if (!res.ok) throw new Error(`provider ${res.status}`);
  return res.json() as Promise<T>;
}

const HEADERS = (maxAge: number) => ({
  'content-type': 'application/json; charset=utf-8',
  'cache-control': `public, max-age=${maxAge}`,
  'access-control-allow-origin': '*',
});

/**
 * A compact value, built at most once per `ttl` seconds per data centre. The
 * Cache API is a no-op on workers.dev, which only means the fallback address
 * asks the provider every time; offside.win itself is cached.
 */
async function cachedValue<T>(
  key: string, ttl: number, ctx: Ctx | undefined, build: () => Promise<T>,
  env?: LiveEnv, share: (v: T) => boolean = () => true,
): Promise<T> {
  const cacheKey = new Request(`https://offside-live.internal/${key}`);
  const cache = (globalThis as { caches?: { default?: Cache } }).caches?.default;
  if (cache) {
    const hit = await cache.match(cacheKey);
    if (hit) return await hit.json() as T;
  }
  const keepHere = (text: string) => {
    if (!cache) return;
    const put = cache.put(cacheKey, new Response(text, { headers: HEADERS(ttl) }));
    if (ctx) ctx.waitUntil(put); else return put;
  };
  const t = Math.floor(Date.now() / 1000);
  // Another data centre's copy, if it is young enough.
  if (env?.DB) {
    try {
      const row = await env.DB.prepare('SELECT v FROM kv WHERE k = ? AND updated_at > ?').bind(`live:${key}`, t - ttl).first<{ v: string }>();
      if (row?.v) {
        await keepHere(row.v);
        return JSON.parse(row.v) as T;
      }
    } catch { /* ask the provider instead */ }
  }
  const value = await build();
  const text = JSON.stringify(value);
  await keepHere(text);
  if (env?.DB && share(value)) {
    const write = env.DB.prepare(`INSERT INTO kv (k, v, expires_at, updated_at) VALUES (?, ?, ?, ?)
        ON CONFLICT(k) DO UPDATE SET v = excluded.v, expires_at = excluded.expires_at, updated_at = excluded.updated_at`)
      .bind(`live:${key}`, text, t + 86400, t).run().catch(() => { /* this data centre still has it */ });
    if (ctx) ctx.waitUntil(write); else await write;
  }
  return value;
}

/** A shared copy (cachedValue's kv `live:<key>`) up to `maxAge` seconds old, for when asking is not allowed. */
async function lastShared<T>(env: LiveEnv, key: string, maxAge: number): Promise<T | null> {
  if (!env.DB) return null;
  try {
    const row = await env.DB.prepare('SELECT v FROM kv WHERE k = ? AND updated_at > ?').bind(`live:${key}`, Math.floor(Date.now() / 1000) - maxAge).first<{ v: string }>();
    return row?.v ? (JSON.parse(row.v) as T) : null;
  } catch { return null; }
}

// The browser may keep a copy for a little under the refresh interval.
const json = (body: unknown, ttl: number) => new Response(JSON.stringify(body), { headers: HEADERS(Math.max(5, Math.floor(ttl / 2))) });

const off = () => new Response(JSON.stringify({ enabled: false, at: Math.floor(Date.now() / 1000), matches: [], changes: [] }), {
  headers: HEADERS(60),
});

/**
 * The rows of a list response. The provider's lists are not uniform about the
 * key (`results`, `events`, `changes`, ...), and the live one's is not written
 * down, so the named key is tried first and then the usual ones.
 */
function listOf(raw: unknown, key: string): unknown[] {
  if (Array.isArray(raw)) return raw;
  const r = rec(raw);
  for (const k of [key, 'results', 'events', 'matches', 'data']) {
    if (Array.isArray(r?.[k])) return r[k] as unknown[];
  }
  return [];
}

interface ListValue { matches: LiveMatch[]; unread?: string[]; asked?: boolean }

const matchesNow = (env: LiveEnv, ctx?: Ctx) => cachedValue<ListValue>('list', LIST_TTL, ctx, async () => {
  if (!await onNow(env)) return { matches: [], unread: undefined, asked: false };
  // Below its floor or over its hour's budget: the last shared list, if it
  // is under a quarter of an hour old, rather than a new request.
  if (!await mayAsk(env.DB, 'live')) return { matches: (await lastShared<ListValue>(env, 'list', 900))?.matches ?? [], asked: false };
  const raw = await provider(env, 'live', '/api/v2/events/live/', { limit: 500 });
  const matches = listOf(raw, 'results').map(compactMatch).filter((m): m is LiveMatch => m !== null);
  const count = numOr(rec(raw)?.['count']);
  // The provider says matches are on and none were read: the list's key has
  // changed. Its field names (never values) go out with the body so that is
  // visible from a phone, rather than a board that silently stops moving.
  const unread = count && !matches.length ? Object.keys(rec(raw) ?? {}) : undefined;
  return { matches, unread, asked: true };
  // "Nothing in play" is not written: every data centre can work that out
  // from its own board.
}, env, (v) => v.asked !== false);

const changesNow = (env: LiveEnv, ctx?: Ctx) => cachedValue('changes', CHANGES_TTL, ctx, async () => {
  if (!await mayAsk(env.DB, 'changes')) return (await lastShared<FixtureChange[]>(env, 'changes', 6 * 3600)) ?? [];
  let since = new Date(Date.now() - 7 * 86400e3 + 60e3).toISOString();
  const all: unknown[] = [];
  // The feed pages by time: when a page is cut short, ask again from the
  // last change received rather than moving on, or the rest is skipped.
  for (let i = 0; i < 6; i++) {
    const page = await provider<Record<string, unknown>>(env, 'changes', '/api/v2/fixtures/changes/', { change: 'kickoff,status', since, limit: 500 });
    const rows = listOf(page, 'changes');
    all.push(...rows);
    if (page?.['truncated'] !== true || !rows.length) break;
    const last = rec(rows[rows.length - 1])?.['changed_at'];
    if (typeof last !== 'string' || last === since) break;
    since = last;
  }
  return reduceChanges(all);
}, env);

/**
 * GET /api/live: every match in play, and the week's fixture changes, in one
 * body -- one request every thirty seconds from a reader watching a match,
 * rather than two. A changes feed that fails costs the changes, not the
 * scores.
 */
export async function liveList(env: LiveEnv, ctx?: Ctx): Promise<Response> {
  if (!env.BSD_API_KEY) return off();
  const [{ matches, unread }, changes, settled] = await Promise.all([
    matchesNow(env, ctx),
    changesNow(env, ctx).catch(() => [] as FixtureChange[]),
    settledNow(env, ctx).catch(() => null),
  ]);
  return json({ enabled: true, at: Math.floor(Date.now() / 1000), matches, changes, ...(settled ? { settled } : {}), ...(unread ? { unread } : {}) }, LIST_TTL);
}

/** How long a data centre keeps its copy of `settled:recent`. */
const SETTLED_TTL = 60;

/**
 * The matches whose calls were graded in the last six hours, and when
 * (`settled:recent`, written by fulltime.ts and the engine's settlement). The
 * page reads again any page that shows one of them and was drawn from a copy
 * older than that (public/app.js). Read from D1 at most once a minute per data
 * centre: it is one small row, and it is not shared back.
 */
const settledNow = (env: LiveEnv, ctx?: Ctx) => cachedValue<{ at: number; ids: number[] } | null>('settled', SETTLED_TTL, ctx, async () => {
  if (!env.DB) return null;
  const row = await env.DB.prepare('SELECT v FROM kv WHERE k = ?').bind('settled:recent').first<{ v: string }>();
  if (!row?.v) return null;
  const v = JSON.parse(row.v) as { at?: unknown; ids?: Record<string, unknown> };
  const at = numOr(v.at);
  if (!at) return null;
  return { at, ids: Object.keys(v.ids ?? {}).map(Number).filter(Number.isInteger) };
});

/** GET /api/live/:id: one match in play, its score and minute. No provider request of its own. */
export async function liveMatch(env: LiveEnv, id: number, ctx?: Ctx): Promise<Response> {
  if (!env.BSD_API_KEY) return off();
  // The score and minute from the live list, already asked for once for
  // every match. The match's own timeline and team numbers used to be asked
  // for too, up to ninety requests an hour for every match someone had open,
  // and on 3 November that spent the provider's allowance before full time.
  // The owner chose to drop them (3 November 2026): the full report, goals,
  // cards and numbers, goes up after the match (engine/src/report.ts).
  const listed = (await matchesNow(env, ctx).catch(() => null))?.matches.find((x) => x.id === id) ?? null;
  return json({ enabled: true, at: Math.floor(Date.now() / 1000), match: listed, report: null }, MATCH_TTL);
}

/** The shared copies of matches long over (cachedValue), cleared by the ten-minute cron. */
export async function liveCleanup(env: LiveEnv): Promise<void> {
  if (!env.DB) return;
  const t = Math.floor(Date.now() / 1000);
  await env.DB.prepare("DELETE FROM kv WHERE k >= 'live:' AND k < 'live;' AND updated_at < ?").bind(t - 86400).run();
}

/** GET /api/changes: kick-offs moved and matches postponed, the last week. */
export async function fixtureChanges(env: LiveEnv, ctx?: Ctx): Promise<Response> {
  if (!env.BSD_API_KEY) return off();
  return json({ enabled: true, at: Math.floor(Date.now() / 1000), changes: await changesNow(env, ctx) }, 60);
}
