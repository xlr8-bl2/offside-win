/**
 * Who may crawl the site, and how fast anyone may ask.
 *
 * After a surge of bot traffic (October 2026) the owner chose: search engines
 * in (Google, Bing, Apple, DuckDuckGo), AI crawlers and SEO scrapers out.
 * Link previews (WhatsApp, X, Telegram and the like) are neither, and stay in:
 * they are how a shared call shows its card.
 *
 * Three layers, each one catching what the last cannot:
 *
 *   - robots.txt asks. The well-behaved crawlers listen.
 *   - Cloudflare's WAF (engine/src/shield.ts, `edge:shield`) refuses the
 *     agents below on every address, static files included, and refuses
 *     anything calling itself Googlebot that Cloudflare cannot verify as Google.
 *   - This file, for what the Worker serves (the API and the readable pages):
 *     the same refusal, and a per-address rate limit, so a scraper that lies
 *     about its name still cannot run the database's reads up.
 *
 * The lists are lower-case substrings of the User-Agent header. The WAF rules
 * are built from the same lists, so the two layers cannot drift apart.
 */

/** Search engines, never refused or limited here. Spoofers are the WAF's job: it checks with Cloudflare that a "Googlebot" really is Google. */
export const SEARCH_ENGINES = [
  'googlebot', 'google-inspectiontool', 'google-site-verification', 'storebot-google', 'apis-google', 'feedfetcher-google',
  'bingbot', 'bingpreview', 'adidxbot',
  'applebot',
  'duckduckbot',
];

/** The names in SEARCH_ENGINES a scraper most often borrows. */
export const SPOOFED = ['googlebot', 'bingbot', 'applebot', 'duckduckbot'];

/** AI crawlers and assistants, SEO crawlers, and bare scraping libraries. */
export const BLOCKED_AGENTS = [
  // AI training and AI search
  'gptbot', 'oai-searchbot', 'chatgpt-user', 'claudebot', 'claude-searchbot', 'claude-user', 'claude-web', 'anthropic-ai',
  'perplexitybot', 'perplexity-user', 'ccbot', 'bytespider', 'amazonbot', 'meta-externalagent', 'meta-externalfetcher',
  'facebookbot', 'googleother', 'google-cloudvertexbot', 'cohere-ai', 'cohere-training-data-crawler', 'diffbot',
  'imagesiftbot', 'timpibot', 'youbot', 'omgili', 'duckassistbot', 'mistralai-user', 'ai2bot', 'pangubot',
  'petalbot', 'img2dataset', 'webzio', 'iaskspider', 'kangaroo bot',
  // SEO and backlink crawlers
  'ahrefsbot', 'semrushbot', 'mj12bot', 'dotbot', 'dataforseobot', 'blexbot', 'barkrowler', 'seekportbot',
  'megaindex', 'serpstatbot', 'awariobot',
  // scraping libraries that never say who is behind them
  'scrapy', 'python-requests', 'python-urllib', 'python-httpx', 'aiohttp', 'go-http-client', 'libwww-perl', 'colly',
];

/**
 * Addresses no rule here may touch: the engine's door (GitHub Actions writes
 * through it, in bursts), and the webhooks that payments and sign-in mail
 * arrive by. Each checks its own key.
 */
export const EXEMPT_PATHS = ['/api/internal/db', '/api/pay/webhook', '/api/auth/email'];

/**
 * Requests a minute from one address before the Worker says wait. Generous on
 * purpose: a phone network can put many readers behind one address, and a
 * reader moving quickly through the board makes a few dozen reads a minute.
 * A scraper makes thousands. Set in wrangler.toml ([[ratelimits]]); this is
 * only what it says.
 */
export const PER_MINUTE = 300;

export interface RateLimit { limit(o: { key: string }): Promise<{ success: boolean }> }
export interface ShieldEnv { RATE_LIMIT?: RateLimit }

const has = (ua: string, list: string[]) => list.some((name) => ua.includes(name));

export function isSearchEngine(userAgent: string | null): boolean {
  return has((userAgent ?? '').toLowerCase(), SEARCH_ENGINES);
}

export function isBlockedAgent(userAgent: string | null): boolean {
  return has((userAgent ?? '').toLowerCase(), BLOCKED_AGENTS);
}

/** A refusal, or null to carry on. */
export async function shield(request: Request, env: ShieldEnv): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (EXEMPT_PATHS.includes(path)) return null;
  const ua = request.headers.get('user-agent');
  if (isBlockedAgent(ua)) {
    return new Response('Automated access to this site is not allowed. See /robots.txt.\n', {
      status: 403,
      headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
    });
  }
  if (isSearchEngine(ua) || !env.RATE_LIMIT) return null;
  const key = request.headers.get('cf-connecting-ip') ?? 'unknown';
  // A limiter that fails lets the request through: a slow reader beats a blank page.
  const { success } = await env.RATE_LIMIT.limit({ key }).catch(() => ({ success: true }));
  if (success) return null;
  return new Response(JSON.stringify({ error: 'Too many requests. Wait a minute and try again.' }), {
    status: 429,
    headers: { 'content-type': 'application/json; charset=utf-8', 'retry-after': '60', 'cache-control': 'no-store' },
  });
}
