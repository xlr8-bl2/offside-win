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
 * is only ever handed the compact shapes below. The parsing of a match in play
 * is the engine's own (engine/src/report-parse.ts), so a goal reads the same
 * during the match as in the full-time report.
 *
 * Fixture changes (a kick-off moved, a match postponed or abandoned) come the
 * same way, so a postponement shows within a minute instead of at the next
 * slate pass.
 */

import { parseIncidents, parseTeamStats } from '../../engine/src/report-parse.ts';

export interface LiveEnv {
  BSD_API_KEY?: string;
  BSD_BASE_URL?: string;
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

async function provider<T = unknown>(env: LiveEnv, path: string, params: Record<string, string | number> = {}): Promise<T> {
  const url = new URL(path, env.BSD_BASE_URL || BASE);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Token ${env.BSD_API_KEY}`,
      Accept: 'application/json',
      'User-Agent': 'offside-win-live/1.0 (+https://offside.win)',
    },
  });
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
async function cachedValue<T>(key: string, ttl: number, ctx: Ctx | undefined, build: () => Promise<T>): Promise<T> {
  const cacheKey = new Request(`https://offside-live.internal/${key}`);
  const cache = (globalThis as { caches?: { default?: Cache } }).caches?.default;
  if (cache) {
    const hit = await cache.match(cacheKey);
    if (hit) return await hit.json() as T;
  }
  const value = await build();
  if (cache) {
    const put = cache.put(cacheKey, new Response(JSON.stringify(value), { headers: HEADERS(ttl) }));
    if (ctx) ctx.waitUntil(put); else await put;
  }
  return value;
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

const matchesNow = (env: LiveEnv, ctx?: Ctx) => cachedValue('list', 25, ctx, async () => {
  const raw = await provider(env, '/api/v2/events/live/', { limit: 500 });
  const matches = listOf(raw, 'results').map(compactMatch).filter((m): m is LiveMatch => m !== null);
  const count = numOr(rec(raw)?.['count']);
  // The provider says matches are on and none were read: the list's key has
  // changed. Its field names (never values) go out with the body so that is
  // visible from a phone, rather than a board that silently stops moving.
  const unread = count && !matches.length ? Object.keys(rec(raw) ?? {}) : undefined;
  return { matches, unread };
});

const changesNow = (env: LiveEnv, ctx?: Ctx) => cachedValue('changes', 60, ctx, async () => {
  let since = new Date(Date.now() - 7 * 86400e3 + 60e3).toISOString();
  const all: unknown[] = [];
  // The feed pages by time: when a page is cut short, ask again from the
  // last change received rather than moving on, or the rest is skipped.
  for (let i = 0; i < 6; i++) {
    const page = await provider<Record<string, unknown>>(env, '/api/v2/fixtures/changes/', { change: 'kickoff,status', since, limit: 500 });
    const rows = listOf(page, 'changes');
    all.push(...rows);
    if (page?.['truncated'] !== true || !rows.length) break;
    const last = rec(rows[rows.length - 1])?.['changed_at'];
    if (typeof last !== 'string' || last === since) break;
    since = last;
  }
  return reduceChanges(all);
});

/**
 * GET /api/live: every match in play, and the week's fixture changes, in one
 * body -- one request every thirty seconds from a reader watching a match,
 * rather than two. A changes feed that fails costs the changes, not the
 * scores.
 */
export async function liveList(env: LiveEnv, ctx?: Ctx): Promise<Response> {
  if (!env.BSD_API_KEY) return off();
  const [{ matches, unread }, changes] = await Promise.all([
    matchesNow(env, ctx),
    changesNow(env, ctx).catch(() => [] as FixtureChange[]),
  ]);
  return json({ enabled: true, at: Math.floor(Date.now() / 1000), matches, changes, ...(unread ? { unread } : {}) }, 25);
}

/** GET /api/live/:id: one match in play, with its timeline and numbers. */
export async function liveMatch(env: LiveEnv, id: number, ctx?: Ctx): Promise<Response> {
  if (!env.BSD_API_KEY) return off();
  return json(await cachedValue(`match/${id}`, 25, ctx, async () => {
    const [event, incidents, stats] = await Promise.all([
      provider(env, `/api/v2/events/${id}/`).catch(() => null),
      provider(env, `/api/v2/events/${id}/incidents/`).catch(() => null),
      provider(env, `/api/v2/events/${id}/stats/`).catch(() => null),
    ]);
    const m = compactMatch(event);
    const inc = parseIncidents(incidents);
    return {
      enabled: true,
      at: Math.floor(Date.now() / 1000),
      match: m,
      report: {
        events: inc.events,
        ht: m?.status === '1st_half' ? null : inc.ht ?? m?.ht ?? null,
        stats: parseTeamStats(stats),
      },
    };
  }), 25);
}

/** GET /api/changes: kick-offs moved and matches postponed, the last week. */
export async function fixtureChanges(env: LiveEnv, ctx?: Ctx): Promise<Response> {
  if (!env.BSD_API_KEY) return off();
  return json({ enabled: true, at: Math.floor(Date.now() / 1000), changes: await changesNow(env, ctx) }, 60);
}
