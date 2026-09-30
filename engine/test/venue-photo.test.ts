import { test } from 'node:test';
import assert from 'node:assert/strict';
import { firstVenuePhoto } from '../src/slate.ts';

/**
 * The masthead's photograph, found by the engine rather than by every
 * visitor's phone. The image service answers a ground it has no picture of
 * with a 70-byte blank; the page used to discover that one request at a time,
 * which put the front page's largest paint at eight seconds.
 */
const service = (photos: Record<number, number>) => (async (url: URL | string) => {
  const id = Number(String(url).match(/venue\/(\d+)/)?.[1]);
  if (id === 99) throw new Error('unreachable');
  return new Response(new Uint8Array(photos[id] ?? 70), { status: 200 });
}) as unknown as typeof fetch;

test('the first ground with a real photograph, in order, skipping blanks and repeats', async () => {
  assert.equal(await firstVenuePhoto([1, 1, 2, 3, 4], service({ 3: 180_000, 4: 90_000 })), 3);
});

test('a ground that cannot be reached is passed over, and none at all is null', async () => {
  assert.equal(await firstVenuePhoto([99, null, 5], service({ 5: 50_000 })), 5);
  assert.equal(await firstVenuePhoto([1, 2], service({})), null);
});
