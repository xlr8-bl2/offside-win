import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bearer, jsonHeaders, PRIVATE_CACHE, PUBLIC_CACHE } from '../src/http.ts';

/* ----------------------------------------------------------- reading a token */

const req = (headers: Record<string, string> = {}) =>
  new Request('https://offside.win/api/board', { headers });

test('a bearer token is read from the Authorization header', () => {
  assert.equal(bearer(req({ authorization: 'Bearer abc.def.ghi' })), 'abc.def.ghi');
  assert.equal(bearer(req({ authorization: 'bearer abc.def.ghi' })), 'abc.def.ghi', 'scheme is case-insensitive');
  assert.equal(bearer(req({ authorization: '  Bearer   abc.def.ghi  ' })), 'abc.def.ghi');
});

test('anything that is not a bearer token reads as no token', () => {
  // Passing these through to PostgREST would turn a malformed header into a
  // database error with a 502, which tells a reader nothing and us less.
  assert.equal(bearer(req()), null);
  assert.equal(bearer(req({ authorization: '' })), null);
  assert.equal(bearer(req({ authorization: 'Basic dXNlcjpwYXNz' })), null);
  assert.equal(bearer(req({ authorization: 'Bearer' })), null);
  assert.equal(bearer(req({ authorization: 'Bearer ' })), null);
  assert.equal(bearer(req({ authorization: 'Bearer a b' })), null, 'a token has no spaces in it');
});

test('a token is never read from the query string', () => {
  // Query strings reach logs, proxies and Referer headers. If this ever starts
  // passing, a session token is being written somewhere it cannot be recalled.
  const url = new Request('https://offside.win/api/board?access_token=abc.def.ghi');
  assert.equal(bearer(url), null);
});

/* ------------------------------------------------------------- cacheability */

test('an anonymous response may be cached at the edge', () => {
  const h = jsonHeaders(false);
  assert.equal(h['cache-control'], PUBLIC_CACHE);
  assert.match(h['cache-control']!, /public/);
});

test('a response produced for an identified reader is never stored', () => {
  // The bug this exists for: Cloudflare caches a member's board under
  // `public, max-age=60` and serves it to the next anonymous visitor. Nothing
  // in a browser shows it and the window is a whole minute wide.
  const h = jsonHeaders(true);
  assert.equal(h['cache-control'], PRIVATE_CACHE);
  assert.match(h['cache-control']!, /no-store/);
  assert.doesNotMatch(h['cache-control']!, /(^|[^-])public/, 'a member response was marked publicly cacheable');
  assert.doesNotMatch(h['cache-control']!, /max-age=[1-9]/, 'a member response was given a non-zero lifetime');
});

test('both directions declare Vary: Authorization', () => {
  // Without it an intermediary may hand a cached anonymous body to a request
  // that carried a token, which is the same bug pointing the other way and
  // considerably harder to notice.
  assert.equal(jsonHeaders(false)['vary'], 'Authorization');
  assert.equal(jsonHeaders(true)['vary'], 'Authorization');
});

test('cacheability follows the presence of a token, not its validity', () => {
  // Deciding on the outcome instead would mean an expired session silently
  // repopulating the public cache with whatever the retry returned.
  const identified = bearer(req({ authorization: 'Bearer expired.rubbish' })) !== null;
  assert.equal(jsonHeaders(identified)['cache-control'], PRIVATE_CACHE);
});

test('every JSON response says it is JSON', () => {
  for (const h of [jsonHeaders(false), jsonHeaders(true)]) {
    assert.equal(h['content-type'], 'application/json; charset=utf-8');
  }
});
