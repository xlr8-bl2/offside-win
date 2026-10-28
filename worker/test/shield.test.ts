import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.ts';
import { readFileSync } from 'node:fs';
import { BLOCKED_AGENTS, SEARCH_ENGINES, shield, type RateLimit } from '../src/shield.ts';

/**
 * Bots kept out (shield.ts): search engines and link previews in, AI and SEO
 * crawlers out, one address limited, and the engine's door and the webhooks
 * never touched.
 */

const GOOGLE = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';
const GPT = 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.2; +https://openai.com/gptbot';
const PHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1';

const req = (path: string, ua: string | null, ip = '203.0.113.7') =>
  new Request(`https://offside.win${path}`, { headers: { ...(ua ? { 'user-agent': ua } : {}), 'cf-connecting-ip': ip } });

/** A limiter that allows `n` requests per key. */
function limiter(n: number): RateLimit & { seen: string[] } {
  const counts = new Map<string, number>();
  const seen: string[] = [];
  return {
    seen,
    async limit({ key }) { seen.push(key); const c = (counts.get(key) ?? 0) + 1; counts.set(key, c); return { success: c <= n }; },
  };
}

test('AI and SEO crawlers are refused; search engines, link previews and people are not', async () => {
  for (const ua of [GPT, 'ClaudeBot/1.0', 'Mozilla/5.0 (compatible; AhrefsBot/7.0)', 'python-requests/2.32', 'CCBot/2.0']) {
    assert.equal((await shield(req('/api/board', ua), {}))?.status, 403, ua);
  }
  for (const ua of [GOOGLE, 'Mozilla/5.0 (compatible; bingbot/2.0)', 'facebookexternalhit/1.1', 'WhatsApp/2.23', 'Twitterbot/1.0', 'TelegramBot', PHONE, 'curl/8.5.0', null]) {
    assert.equal(await shield(req('/api/board', ua), {}), null, String(ua));
  }
});

test('no search engine is on the blocked list', () => {
  for (const s of SEARCH_ENGINES) assert.ok(!BLOCKED_AGENTS.some((b) => s.includes(b) || b.includes(s)), s);
});

test('one address asking too fast waits; another address and Google do not', async () => {
  const RATE_LIMIT = limiter(2);
  assert.equal(await shield(req('/api/board', PHONE), { RATE_LIMIT }), null);
  assert.equal(await shield(req('/api/hero', PHONE), { RATE_LIMIT }), null);
  const third = await shield(req('/api/board', PHONE), { RATE_LIMIT });
  assert.equal(third?.status, 429);
  assert.equal(third?.headers.get('retry-after'), '60');
  assert.equal(await shield(req('/api/board', PHONE, '198.51.100.2'), { RATE_LIMIT }), null);
  for (let i = 0; i < 5; i++) assert.equal(await shield(req('/match/1/a-v-b', GOOGLE), { RATE_LIMIT }), null);
  assert.deepEqual(RATE_LIMIT.seen, ['203.0.113.7', '203.0.113.7', '203.0.113.7', '198.51.100.2']);
});

test('the engine door and the webhooks are never refused or counted', async () => {
  const RATE_LIMIT = limiter(0);
  for (const path of ['/api/internal/db', '/api/pay/webhook', '/api/auth/email']) {
    assert.equal(await shield(req(path, 'python-requests/2.32'), { RATE_LIMIT }), null, path);
  }
  assert.deepEqual(RATE_LIMIT.seen, []);
});

test('a broken limiter lets the reader through', async () => {
  const RATE_LIMIT = { limit: async () => { throw new Error('down'); } };
  assert.equal(await shield(req('/api/board', PHONE), { RATE_LIMIT }), null);
});

test('the Worker refuses before any route runs, with the security headers', async () => {
  let reached = false;
  const env = { ASSETS: { fetch: async () => { reached = true; return new Response('page'); } } } as any;
  const res = await worker.fetch(req('/', GPT), env);
  assert.equal(res.status, 403);
  assert.equal(reached, false);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
});

test('robots.txt names every blocked crawler it can and keeps Google in', () => {
  const robots = readFileSync(new URL('../../public/robots.txt', import.meta.url), 'utf8');
  const groups = robots.split(/\n\s*\n/);
  const google = groups.find((g) => /^User-agent: Googlebot$/m.test(g))!;
  assert.match(google, /^Allow: \/$/m);
  assert.doesNotMatch(google, /^Disallow: \/$/m);
  const blocked = groups.find((g) => /^User-agent: GPTBot$/m.test(g))!;
  assert.match(blocked, /^Disallow: \/$/m);
  assert.doesNotMatch(blocked, /^User-agent: (Googlebot|Bingbot)$/m);
});
