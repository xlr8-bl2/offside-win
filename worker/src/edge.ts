/**
 * The edge's copy of the public reads.
 *
 * Every read the site makes (the board, the masthead, a match, a
 * competition) went to Postgres on every request: 300ms to a second each,
 * before the page could draw. The responses are identical for every
 * signed-out visitor and change at most every fifteen minutes, when the slate
 * runs, so the Worker keeps one copy per address in Cloudflare's cache at the
 * edge nearest the reader:
 *
 *   - under 30 seconds old, it is served as it is;
 *   - up to five minutes old, it is served at once and a fresh one is fetched
 *     behind it, so the next reader gets that;
 *   - older, or absent, the reader waits for the database once.
 *
 * Only for a request with no token. A reader's own board (a member's, with the
 * calls in it) is never stored here: that is the leak http.ts exists to
 * prevent, and the caller checks it before this is reached.
 */

const FRESH_S = 30;
const KEEP_S = 300;
const STAMP = 'x-edge-stored';

export interface Ctx { waitUntil(p: Promise<unknown>): void }

/** The public reads, by path. Nothing signed-in, nothing that writes. */
export const EDGE_PATHS = /^\/api\/(?:board|hero|picks|slip|plans|model|health|search|(?:fixture|league|player)\/\d+)$/;

function cacheOf(): Cache | null {
  const c = (globalThis as { caches?: { default?: Cache } }).caches;
  return c?.default ?? null;
}

/** What the reader gets: the stored bytes, the original headers, and how. */
function served(res: Response, how: 'hit' | 'stale' | 'miss'): Response {
  const headers = new Headers(res.headers);
  headers.delete(STAMP);
  // The copy was stored with a long edge lifetime; the browser gets the
  // site's own short one back.
  headers.set('cache-control', res.headers.get('x-edge-client-cache') ?? 'public, max-age=30');
  headers.delete('x-edge-client-cache');
  headers.set('x-edge', how);
  return new Response(res.body, { status: res.status, headers });
}

async function store(cache: Cache, key: Request, res: Response, now: number): Promise<void> {
  const headers = new Headers(res.headers);
  headers.set('x-edge-client-cache', res.headers.get('cache-control') ?? 'public, max-age=30');
  headers.set('cache-control', `public, max-age=${KEEP_S}`);
  headers.set(STAMP, String(now));
  await cache.put(key, new Response(res.body, { status: res.status, headers }));
}

export async function edgeCached(request: Request, ctx: Ctx | undefined, build: () => Promise<Response>, now = Date.now()): Promise<Response> {
  const cache = cacheOf();
  if (!cache || !ctx || request.method !== 'GET') return build();
  const key = new Request(new URL(request.url).toString(), { method: 'GET' });

  const hit = await cache.match(key);
  if (hit) {
    const age = (now - Number(hit.headers.get(STAMP) ?? 0)) / 1000;
    if (age < FRESH_S) return served(hit, 'hit');
    if (age < KEEP_S) {
      ctx.waitUntil((async () => {
        const next = await build();
        if (next.ok) await store(cache, key, next, Date.now());
      })().catch(() => { /* the stale copy stays */ }));
      return served(hit, 'stale');
    }
  }

  const res = await build();
  if (!res.ok) return res;
  const [mine, theirs] = res.body ? res.body.tee() : [null, null];
  const keep = new Response(theirs, { status: res.status, headers: res.headers });
  ctx.waitUntil(store(cache, key, keep, now).catch(() => { /* uncached, not broken */ }));
  const out = new Response(mine, { status: res.status, headers: res.headers });
  out.headers.set('x-edge', 'miss');
  return out;
}
