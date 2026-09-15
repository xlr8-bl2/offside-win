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

/**
 * Per-run response cache.
 *
 * Every read here is a GET of immutable-enough data, and a slate asks for the
 * same things repeatedly: one standings table serves every fixture in its
 * league, one squad serves both of a team's fixtures. Caching the *outcome*
 * rather than the payload means a 403 or 404 is remembered too — the provider
 * is asked once whether we are entitled to a route, not once per fixture.
 *
 * Transient errors are deliberately not cached: retrying those is the whole
 * point of the retry loop, and freezing one would turn a blip into a run-long
 * absence. The cache lives for the process, which is one job, so staleness
 * cannot outlive the run that created it.
 */
const cache = new Map<string, FetchOutcome<unknown>>();
/** Identical concurrent requests share one flight rather than racing. */
const pending = new Map<string, Promise<FetchOutcome<unknown>>>();

/**
 * Bounded, because a backfill walks thousands of per-match stats payloads it
 * will never ask for twice — caching those is pure memory cost. Oldest out
 * first: the repeat-heavy reads (standings, squads, entitlement) are asked for
 * often enough to keep re-entering, while a one-shot payload falls out.
 */
const CACHE_MAX = 2000;

function remember(key: string, out: FetchOutcome<unknown>): void {
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, out);
}

export function clearCache(): void {
  cache.clear();
  pending.clear();
}

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
  if (hit) {
    stats.cacheHits++;
    return hit as FetchOutcome<T>;
  }
  const inFlightSame = pending.get(key);
  if (inFlightSame) {
    stats.cacheHits++;
    return inFlightSame as Promise<FetchOutcome<T>>;
  }

  const flight = fetchOnce<T>(url) as Promise<FetchOutcome<unknown>>;
  pending.set(key, flight);
  try {
    const out = (await flight) as FetchOutcome<T>;
    // A settled answer — including "you may not have this" — is worth keeping.
    // An 'error' is not: it may well succeed next time.
    if (out.ok || out.reason === 'not_entitled' || out.reason === 'not_found') {
      remember(key, out as FetchOutcome<unknown>);
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
      const res = await fetch(url, {
        headers: {
          Authorization: `Token ${config.bsd.key}`,
          Accept: 'application/json',
          'User-Agent': 'offside-win/1.0 (+https://github.com/xlr8-bl/offside-win)',
        },
        signal: controller.signal,
      });
      lastStatus = res.status;

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
        const after = Number(res.headers.get('retry-after'));
        // Honour the provider's own number when it gives one, capped so a wild
        // value cannot park the run for the rest of the job.
        if (Number.isFinite(after) && after > 0) retryAfterMs = Math.min(after * 1000, 60_000);
        lastMessage = `${res.status} ${(await res.text()).slice(0, 200)}`;
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
