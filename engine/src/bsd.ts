import { config } from './config.ts';

/**
 * Client for Bzzoiro Sports Data.
 *
 * Two things it does that a thin fetch wrapper would not:
 *
 * 1. **Entitlement is data, not an exception.** Exactly one endpoint is gated
 *    behind the provider's paid tier (`/events/{id}/odds/comparison/`, which
 *    403s with `bookmakers_not_entitled`), and the `/wom/` money-flow routes
 *    are probably gated too. Those become a recorded absence the ledger can
 *    show, never a thrown error and never a fabricated number. If the tier is
 *    bought later the absence lifts on its own.
 *
 * 2. **Unknown shapes are expected.** Several fields are typed `any` in the
 *    provider's OpenAPI (`weather`, `head_to_head`, `unavailable_players`,
 *    `appointment_effect`). Everything downstream reads them through the
 *    coercion helpers at the bottom of this file rather than trusting a shape.
 */

export type FetchOutcome<T> =
  | { ok: true; data: T; status: number }
  | { ok: false; reason: 'not_entitled' | 'not_found' | 'error'; status: number; message: string };

let inFlight = 0;
const waiters: Array<() => void> = [];

async function acquire(): Promise<void> {
  if (inFlight < config.bsd.concurrency) {
    inFlight++;
    return;
  }
  await new Promise<void>((resolve) => waiters.push(resolve));
  inFlight++;
}

function release(): void {
  inFlight--;
  const next = waiters.shift();
  if (next) next();
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Requests counted for the run log — useful when diagnosing a slow slate. */
export const stats = { requests: 0, retries: 0, errors: 0, notEntitled: 0, cacheHits: 0 };
/** Requests by kind of read ("/api/v2/events/:id/lineups/"), for the run log. */
export const byKind = new Map<string, number>();
export const kindOf = (url: URL) => url.pathname.replace(/\/\d+(?=\/)/g, '/:id');

/**
 * The provider's daily allowance, from its own headers (`RateLimit: ...;r=`).
 *
 * The free plan is 7,500 requests in any 24 hours (the window rolls: what
 * was spent a day ago comes back), across every job and the Worker's live
 * scores. A job stops asking once fewer than
 * `config.bsd.reserve` remain, leaving the rest for the others, and nothing
 * asks again once the provider says the day is spent (`taster_exhausted`):
 * retrying that was how a slate sat for hours waiting on midnight.
 */
export const quota = { remaining: null as number | null, exhausted: false };

/**
 * Response cache, with a lifetime per kind of read.
 *
 * Caching the outcome rather than the payload means a 403 or 404 is
 * remembered too. Transient errors are not cached. Entries live for as long
 * as the data cannot usefully change (`ttlFor`), across the passes of a
 * slate job, and across jobs when the workflow keeps the file (saveCache /
 * loadCache, BSD_CACHE_FILE): a squad or a table does not need asking for
 * every half hour, and on the free plan it cannot be.
 */
interface Entry { at: number; out: FetchOutcome<unknown> }
const cache = new Map<string, Entry>();
/** Identical concurrent requests share one flight rather than racing. */
const pending = new Map<string, Promise<FetchOutcome<unknown>>>();
const CACHE_MAX = 20000;

/**
 * Matches near kick-off (from a few hours before to the end): their prices,
 * line-ups and news are read fresh; everyone else's a few hours old. Set by
 * the slate from its window (setNearFixtures).
 */
let near = new Set<number>();
export function setNearFixtures(ids: Iterable<number>): void { near = new Set(ids); }

const MIN = 60;
const HOUR = 3600;
/** How long one answer stays good, in seconds. */
export function ttlFor(url: URL): number {
  const p = url.pathname;
  const eventParam = Number(url.searchParams.get('event_id'));
  const ev = /\/events\/(\d+)\//.exec(p);
  const id = ev ? Number(ev[1]) : eventParam;
  const isNear = Number.isFinite(id) && near.has(id);
  // Prices and team news move before kick-off; elsewhere twice a day is plenty.
  if (p === '/api/v2/odds/' || /\/events\/\d+\/(odds|lineups|availability)\//.test(p)) return isNear ? 45 * MIN : 6 * HOUR;
  if (/\/events\/\d+\/(prediction|polymarket|h2h|incidents|stats|player-stats)\//.test(p)) return 6 * HOUR;
  if (/^\/api\/v2\/events\/\d+\/$/.test(p)) return isNear ? 15 * MIN : 6 * HOUR;
  if (p === '/api/v2/events/' || p.startsWith('/api/v2/live')) return 30 * MIN;
  // Squads, managers, players, tables, grounds, referees: once a day.
  if (/^\/api\/v2\/(teams|managers|players|leagues|venues|referees)\//.test(p)) return 24 * HOUR;
  return HOUR;
}

function remember(key: string, out: FetchOutcome<unknown>): void {
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.delete(key);
  cache.set(key, { at: Date.now(), out });
}

export function clearCache(): void {
  cache.clear();
  pending.clear();
}

/** The cache to a file, live entries only, for the next job (BSD_CACHE_FILE). */
export async function saveCache(file: string): Promise<void> {
  const { writeFile } = await import('node:fs/promises');
  const now = Date.now();
  const live = [...cache].filter(([k, e]) => now - e.at < ttlFor(new URL(k)) * 1000);
  await writeFile(file, JSON.stringify(live));
}

export async function loadCache(file: string): Promise<number> {
  const { readFile } = await import('node:fs/promises');
  try {
    const rows = JSON.parse(await readFile(file, 'utf8')) as Array<[string, Entry]>;
    for (const [k, e] of rows) cache.set(k, e);
    return rows.length;
  } catch { return 0; }
}

const spent = (): FetchOutcome<never> => ({ ok: false, reason: 'error', status: 429, message: 'daily allowance spent' });

export async function bsdRaw<T = unknown>(
  path: string,
  params?: Record<string, string | number | undefined>,
): Promise<FetchOutcome<T>> {
  const url = new URL(path, config.bsd.base);
  for (const [k, v] of Object.entries(params ?? {})) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  }
  const key = url.toString();

  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlFor(url) * 1000) {
    stats.cacheHits++;
    return hit.out as FetchOutcome<T>;
  }
  const inFlightSame = pending.get(key);
  if (inFlightSame) {
    stats.cacheHits++;
    return inFlightSame as Promise<FetchOutcome<T>>;
  }
  // Out of allowance, or down to what is kept for the other jobs: an old
  // answer is better than none, and nothing is asked.
  if (quota.exhausted || (quota.remaining !== null && quota.remaining <= config.bsd.reserve)) {
    quota.exhausted = true;
    if (hit) { stats.cacheHits++; return hit.out as FetchOutcome<T>; }
    return spent();
  }

  const flight = fetchOnce<T>(url) as Promise<FetchOutcome<unknown>>;
  pending.set(key, flight);
  try {
    const out = (await flight) as FetchOutcome<T>;
    // A settled answer — including "you may not have this" — is worth keeping.
    // An 'error' is not: it may well succeed next time.
    if (out.ok || out.reason === 'not_entitled' || out.reason === 'not_found') {
      remember(key, out as FetchOutcome<unknown>);
    } else if (hit) {
      return hit.out as FetchOutcome<T>;
    }
    return out;
  } finally {
    pending.delete(key);
  }
}

async function fetchOnce<T = unknown>(url: URL): Promise<FetchOutcome<T>> {
  let lastMessage = '';
  let lastStatus = 0;
  let retryAfterMs = 0;

  for (let attempt = 0; attempt <= config.bsd.retries; attempt++) {
    if (attempt > 0) {
      stats.retries++;
      // Backoff happens *outside* the concurrency slot. Sleeping while holding
      // one is what turns a rate-limited run into a stalled one: with six slots
      // and a 2/4/8/16s backoff, six throttled requests are enough to stop
      // every other request in the process for half a minute at a time.
      // Jittered so parallel workers do not resynchronise, and never shorter
      // than a Retry-After the provider asked for.
      const backoff = 2 ** attempt * 1000 + Math.random() * 500;
      await sleep(Math.max(backoff, retryAfterMs));
      retryAfterMs = 0;
    }

    await acquire();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.bsd.timeoutMs);
    try {
      stats.requests++;
      byKind.set(kindOf(url), (byKind.get(kindOf(url)) ?? 0) + 1);
      const res = await fetch(url, {
        headers: {
          Authorization: `Token ${config.bsd.key}`,
          Accept: 'application/json',
          'User-Agent': 'offside-win/1.0 (+https://github.com/xlr8-bl/offside-win)',
        },
        signal: controller.signal,
      });
      lastStatus = res.status;
      // Where the day's allowance stands ("football";r=7213;t=52800). Absent
      // on a paid plan, which has none.
      const rl = /;r=(\d+)/.exec(res.headers.get('ratelimit') ?? '');
      if (rl) quota.remaining = Number(rl[1]);

      if (res.status === 403) {
        const body = await res.text();
        stats.notEntitled++;
        return { ok: false, reason: 'not_entitled', status: 403, message: body.slice(0, 300) };
      }
      if (res.status === 404) {
        return { ok: false, reason: 'not_found', status: 404, message: 'not found' };
      }
      // 429 and 5xx are worth another go; other 4xx are our bug, not theirs.
      if (res.status === 429 || res.status >= 500) {
        const text = await res.text();
        // The day's allowance is gone: it comes back at midnight UTC, so
        // asking again before then only wastes the run.
        if (res.status === 429 && /taster_exhausted/.test(text)) {
          quota.exhausted = true;
          quota.remaining = 0;
          stats.errors++;
          return spent();
        }
        const after = Number(res.headers.get('retry-after'));
        // Honour the provider's own number when it gives one, capped so a wild
        // value cannot park the run for the rest of the job.
        if (Number.isFinite(after) && after > 0) retryAfterMs = Math.min(after * 1000, 60_000);
        lastMessage = `${res.status} ${text.slice(0, 200)}`;
        continue;
      }
      if (!res.ok) {
        stats.errors++;
        return {
          ok: false,
          reason: 'error',
          status: res.status,
          message: (await res.text()).slice(0, 300),
        };
      }
      return { ok: true, data: (await res.json()) as T, status: res.status };
    } catch (err) {
      lastMessage = err instanceof Error ? err.message : String(err);
    } finally {
      clearTimeout(timer);
      release();
    }
  }

  stats.errors++;
  return { ok: false, reason: 'error', status: lastStatus, message: lastMessage };
}

/** Throwing variant, for callers where an absence genuinely is fatal. */
export async function bsd<T = unknown>(
  path: string,
  params?: Record<string, string | number | undefined>,
): Promise<T> {
  const out = await bsdRaw<T>(path, params);
  if (!out.ok) throw new Error(`BSD ${path} failed: ${out.status} ${out.message}`);
  return out.data;
}

/** Non-throwing variant returning null — the common case in factor modules. */
export async function bsdOrNull<T = unknown>(
  path: string,
  params?: Record<string, string | number | undefined>,
): Promise<T | null> {
  const out = await bsdRaw<T>(path, params);
  return out.ok ? out.data : null;
}

// ------------------------------------------------------------- pagination

interface Paged<T> {
  count?: number;
  next?: string | null;
  previous?: string | null;
  results?: T[];
}

/**
 * Walk a v2 list endpoint. The v2 wrapper is `{count,next,previous,results}`,
 * but a few routes answer with a bare array, so handle both. Uses keyset
 * (`cursor`) paging where the provider offers it — plain `offset` is capped at
 * 10000 and is the documented wrong way to walk a whole feed.
 */
export async function bsdList<T = unknown>(
  path: string,
  params: Record<string, string | number | undefined> = {},
  opts: { limit?: number; max?: number } = {},
): Promise<T[]> {
  const pageSize = opts.limit ?? 200;
  const max = opts.max ?? Infinity;
  const out: T[] = [];
  let cursor: string | undefined;
  let offset = 0;
  let guard = 0;

  while (out.length < max && guard++ < 500) {
    const page = await bsdOrNull<Paged<T> | T[]>(path, {
      ...params,
      limit: pageSize,
      ...(cursor ? { cursor } : offset ? { offset } : {}),
    });
    if (page === null) break;

    if (Array.isArray(page)) {
      out.push(...page);
      if (page.length < pageSize) break;
      offset += page.length;
      continue;
    }

    const rows = page.results ?? [];
    out.push(...rows);
    if (!page.next || rows.length === 0) break;

    const nextCursor = new URL(page.next, config.bsd.base).searchParams.get('cursor');
    if (nextCursor) {
      cursor = nextCursor;
    } else {
      offset += rows.length;
    }
  }

  return out.length > max ? out.slice(0, max) : out;
}

// ------------------------------------------------- defensive field access
//
// The provider's spec types several useful fields as `any`. Rather than guess a
// shape and crash on the first fixture that disagrees, every read goes through
// these. They return undefined rather than throwing, and callers turn that into
// an UNAVAILABLE factor — which is the honest answer anyway.

export function asRecord(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
}

export function asArray(v: unknown): unknown[] | undefined {
  return Array.isArray(v) ? v : undefined;
}

export function num(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

export function str(v: unknown): string | undefined {
  return typeof v === 'string' && v !== '' ? v : undefined;
}

export function bool(v: unknown): boolean | undefined {
  if (typeof v === 'boolean') return v;
  if (v === 'true' || v === 1) return true;
  if (v === 'false' || v === 0) return false;
  return undefined;
}

/**
 * Pull a value from a nested object by trying several key paths. Providers
 * rename fields; this lets one call site accept `precipitation`, `rain_mm` or
 * `precip` without a cascade of ifs at every use.
 */
export function pick(obj: unknown, ...paths: string[]): unknown {
  const rec = asRecord(obj);
  if (!rec) return undefined;
  for (const path of paths) {
    let cur: unknown = rec;
    let ok = true;
    for (const seg of path.split('.')) {
      const r = asRecord(cur);
      if (!r || !(seg in r)) {
        ok = false;
        break;
      }
      cur = r[seg];
    }
    if (ok && cur !== null && cur !== undefined) return cur;
  }
  return undefined;
}

export function pickNum(obj: unknown, ...paths: string[]): number | undefined {
  return num(pick(obj, ...paths));
}

export function pickStr(obj: unknown, ...paths: string[]): string | undefined {
  return str(pick(obj, ...paths));
}

export function pickBool(obj: unknown, ...paths: string[]): boolean | undefined {
  return bool(pick(obj, ...paths));
}

/** ISO-8601 (or epoch) to unix seconds. */
export function toEpoch(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v > 1e11 ? Math.floor(v / 1000) : v;
  const s = str(v);
  if (!s) return undefined;
  const t = Date.parse(s);
  return Number.isFinite(t) ? Math.floor(t / 1000) : undefined;
}
