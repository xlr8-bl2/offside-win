/**
 * Header decisions, kept out of the request handler so they can be tested.
 *
 * Both functions here exist because of the same hazard. The Worker sits behind
 * Cloudflare's edge cache, every response until now was identical for every
 * visitor, and `public, max-age=60` was therefore free performance. The moment
 * one reader can see something another cannot, that header becomes a way to
 * hand a paying member's board to the next anonymous visitor who asks for it.
 *
 * Nothing in a browser would show that. It needs a test, so it needs to be a
 * function.
 */

/** The short edge cache, for a response every visitor would get identically. */
export const PUBLIC_CACHE = 'public, max-age=60, stale-while-revalidate=300';

/**
 * No cache at all, anywhere, for a response that is specific to one reader.
 *
 * `private` alone would stop Cloudflare storing it but still allow the browser
 * to, which would keep serving a member's board after they signed out. `Vary`
 * is belt and braces: it should never be reached given no-store, and it is the
 * thing that saves us if some intermediary ignores no-store.
 */
export const PRIVATE_CACHE = 'private, no-store, max-age=0';

/**
 * Pull a bearer token off a request.
 *
 * Deliberately narrow. Anything that is not exactly `Bearer <something>` is
 * treated as no token at all rather than passed along to PostgREST to argue
 * with, and a token is never read from a query parameter -- those end up in
 * logs, proxies and Referer headers.
 */
export function bearer(request: Request): string | null {
  const raw = request.headers.get('authorization');
  if (!raw) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(raw.trim());
  return match ? match[1]! : null;
}

/**
 * The response headers for a JSON body, given whether a reader was identified.
 *
 * The rule is the presence of a token, not whether it turned out to be valid.
 * A response produced while holding a token is potentially reader-specific, and
 * deciding cacheability on the outcome would mean an expired session quietly
 * repopulating the public cache.
 */
export function jsonHeaders(identified: boolean): Record<string, string> {
  return {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': identified ? PRIVATE_CACHE : PUBLIC_CACHE,
    // Named even on the public response: without it an intermediary may serve a
    // cached anonymous body to a request that carried a token, which is the
    // same bug in the other direction and much harder to notice.
    vary: 'Authorization',
  };
}
