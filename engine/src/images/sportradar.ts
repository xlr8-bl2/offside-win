/**
 * Sportradar's Images API — where the football photography comes from.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 *
 * The site already had images and they were the wrong kind. The odds provider
 * serves club crests, league badges and stadium photographs, and the stadium
 * photographs are architectural: a daylight aerial of an empty ground. Put one
 * behind a masthead and the page is a building. Every reference this product
 * is measured against — a club site, a broadcaster's campaign — leads on a
 * player, close, at night, mid-celebration. That is the asset class we did not
 * have, and Getty through Sportradar is where it comes from.
 *
 * ---------------------------------------------------------------------------
 * THE TWO CONSTRAINTS THAT SHAPE EVERYTHING BELOW
 *
 * 1. EVERY REQUEST NEEDS THE KEY, INCLUDING THE IMAGE ITSELF. There is no
 *    signed public URL. An `<img src>` pointing at api.sportradar.com would
 *    have to carry the key, and this repository is public, so the key would be
 *    in the page source and in the git history within the hour. Images are
 *    therefore fetched here, server-side, and re-hosted. Sportradar's own FAQ
 *    expects exactly that: "the intention is for you to save each image on your
 *    end as requests are made."
 *
 * 2. THE IDS DO NOT MATCH. Sportradar identifies teams by UUID; our fixtures
 *    carry the odds provider's small integers (`home_id: 87`). There is no
 *    mapping between them and no endpoint that offers one. So assets are
 *    matched by NAME, through the same normaliser the occasion engine uses to
 *    recognise "Fútbol Club Barcelona" as Barcelona. That is why this module
 *    imports from occasion.ts rather than growing a second normaliser: two
 *    normalisers disagree eventually, and the disagreement is silent.
 *
 * Docs: https://developer.sportradar.com/images-and-editorials/reference/images-overview
 */

import { config } from '../config.ts';
import { normalise } from '../occasion.ts';

const BASE = 'https://api.sportradar.com';

/**
 * Our league names to Sportradar's slugs.
 *
 * Keyed on the normalised NAME rather than on the provider's league id. Ids
 * belong to the odds provider and can be renumbered; a name that changes is a
 * rebrand we would notice. Leagues absent here simply have no photography, and
 * the callers all treat that as ordinary.
 *
 * Slugs are from the action-shot manifest reference. Not every slug carries
 * logos as well — that list is shorter — but this module only asks for what a
 * given endpoint supports.
 */
const LEAGUE_SLUG: Record<string, string> = {
  'premier league': 'epl',
  'la liga': 'la-liga',
  'serie a': 'serie-a',
  bundesliga: 'bundesliga',
  'ligue 1': 'ligue-1',
  eredivisie: 'ned-eredivisie',
  'liga portugal betclic': 'prt-primeira-liga',
  'primeira liga': 'prt-primeira-liga',
  'trendyol super lig': 'tur-super-lig',
  'super lig': 'tur-super-lig',
  'scottish premiership': 'sco-premiership',
  'pro league': 'bel-first-division-a',
  'jupiler pro league': 'bel-first-division-a',
  'uefa champions league': 'uefa-champions-league',
  'champions league': 'uefa-champions-league',
  'uefa europa league': 'europa-league',
  'europa league': 'europa-league',
  'major league soccer': 'us-national-soccer',
  mls: 'us-national-soccer',
  'liga mx': 'liga-mx',
  'brasileirao serie a': 'bra-serie-a',
  'serie a betano': 'bra-serie-a',
};

export function leagueSlug(leagueName: string | null | undefined): string | null {
  if (!leagueName) return null;
  return LEAGUE_SLUG[normalise(leagueName)] ?? null;
}

/** Every league we can ask for photography from, deduplicated. */
export function coveredSlugs(): string[] {
  return [...new Set(Object.values(LEAGUE_SLUG))];
}

export interface AssetLink {
  width: number;
  height: number;
  href: string;
}

export interface AssetRef {
  name?: string;
  type?: string;
  sportradar_id?: string;
}

export interface Asset {
  id: string;
  title?: string;
  description?: string;
  copyright?: string;
  created?: string;
  links: AssetLink[];
  refs: AssetRef[];
}

export interface Manifest {
  provider?: string;
  league?: string;
  type?: string;
  trial?: boolean;
  assetlist: Asset[];
}

/** `https://api.sportradar.com/soccer-images-t3/getty/epl` — the league root. */
function root(slug: string, provider: string): string {
  return `${BASE}/soccer-images-${config.images.level}3/${provider}/${slug}`;
}

export class ImagesError extends Error {
  constructor(readonly status: number, readonly url: string, body: string) {
    super(`Sportradar images ${status} for ${url}: ${body.slice(0, 300)}`);
  }
}

/**
 * A breaker, because a refused key must not be ground against for an hour.
 *
 * The fifth live run made ninety-eight calls, every one of them refused, and
 * took twenty-two minutes to do it. Worse, each refusal was retried three
 * times, so ninety-eight rejections actually cost close to four hundred
 * requests against a trial key whose budget is the scarce thing here. A sweep
 * that is being turned away should stop, not persevere.
 *
 * Counted consecutively rather than in total: one 429 in the middle of an
 * otherwise healthy sweep is a blip, fifteen in a row is an answer.
 */
let consecutiveRefusals = 0;
let open = false;
let spent = 0;

export function budgetReport(): { spent: number; open: boolean } {
  return { spent, open };
}

export function resetBudget(): void {
  consecutiveRefusals = 0;
  open = false;
  spent = 0;
}

/** Sportradar states the plan's quota on every response. Worth reading. */
function quotaHeaders(res: Response): string {
  const keys = [
    'x-plan-quota-allotted', 'x-plan-quota-current', 'x-plan-quota-expires',
    'x-plan-qps-allotted', 'x-plan-qps-current', 'retry-after',
  ];
  return keys.map((k) => `${k}=${res.headers.get(k) ?? '-'}`).join(' ');
}

/**
 * One request at a time, with a floor on the gap between them.
 *
 * A trial key is one request a second. Firing twenty leagues times seven days
 * at it as fast as Node can open sockets got 74 rejections out of 98 calls on
 * the first live run — the key was fine, the manners were not. Serialising and
 * spacing the calls turns a burst that mostly fails into a sweep that mostly
 * works, and the job has forty minutes to do it in.
 */
let chain: Promise<unknown> = Promise.resolve();
let last = 0;

function throttle<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(async () => {
    const wait = config.images.minGapMs - (Date.now() - last);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    last = Date.now();
    return fn();
  });
  // Keep the chain alive even when a link rejects, or one failure stops the
  // sweep dead for every league behind it.
  chain = run.catch(() => undefined);
  return run as Promise<T>;
}

async function get(url: string): Promise<Response> {
  if (!config.images.key) throw new Error('SPORTRADAR_GETTY_KEY is not set.');
  if (open) {
    throw new ImagesError(429, url, 'not sent: the key is out of quota or refusing every call');
  }
  if (spent >= config.images.budget) {
    throw new ImagesError(0, url, `not sent: this run's budget of ${config.images.budget} requests is spent`);
  }

  const res = await throttle(() => fetch(url, {
    headers: { 'x-api-key': config.images.key, accept: 'application/json' },
  }));
  spent++;

  if (res.status === 429) {
    /*
     * Sportradar says 429 for two unrelated things, and they want opposite
     * responses:
     *
     *   {"message":"Too Many Requests"}  the per-second limit. Transient.
     *                                    Waiting a moment fixes it.
     *   {"message":"Limit Exceeded"}     the plan's request quota is gone.
     *                                    Waiting does nothing; only the
     *                                    billing period turning over helps.
     *
     * Five runs treated both as pacing, retried each one three times, and so
     * spent roughly four hundred requests of a finished quota discovering that
     * the quota was finished. Reading the body is the whole difference.
     */
    const body = (await res.text().catch(() => '')).trim();
    const exhausted = /limit exceeded/i.test(body);

    if (exhausted) {
      open = true;
    } else {
      consecutiveRefusals++;
      if (consecutiveRefusals >= config.images.tripAfter) open = true;
    }
    throw new ImagesError(429, url, `${body || '(empty body)'} | ${quotaHeaders(res)}`);
  }

  consecutiveRefusals = 0;
  return res;
}

/**
 * A manifest, or null when the league simply has nothing for that day.
 *
 * A 404 is the normal answer for a date with no fixtures in that competition,
 * so it is not an error and must not stop a sweep of twenty leagues. A 403 is,
 * because it means the key does not cover what we asked for — and on a trial
 * key that is the single most likely failure, so it says so in as many words.
 */
async function manifest(url: string): Promise<Manifest | null> {
  const res = await get(url);
  if (res.status === 404) return null;
  if (res.status === 403) {
    throw new ImagesError(403, url, 'key rejected — check the trial covers soccer images');
  }
  if (!res.ok) throw new ImagesError(res.status, url, await res.text());
  const body = (await res.json()) as Manifest;
  return { ...body, assetlist: body.assetlist ?? [] };
}

/** Action shots taken on one day in one competition. */
export function actionShotsByDate(slug: string, when: Date, provider = 'getty'): Promise<Manifest | null> {
  const y = when.getUTCFullYear();
  const m = String(when.getUTCMonth() + 1).padStart(2, '0');
  const d = String(when.getUTCDate()).padStart(2, '0');
  return manifest(`${root(slug, provider)}/actionshots/events/${y}/${m}/${d}/manifest.json`);
}

/**
 * Turn a manifest `href` into something fetchable.
 *
 * The href is relative to the league root, not to the API root — the docs show
 * `/actionshots/events/2023/5/16/<id>/h1000-max-resize.jpg` hanging off
 * `/soccer-images-t3/getty/epl`. Joining it to the wrong one gives a 404 that
 * looks exactly like "no photographs today", which is the confusing failure
 * worth spending a line of comment on.
 */
export function assetUrl(slug: string, href: string, provider = 'getty'): string {
  return `${root(slug, provider)}${href.startsWith('/') ? href : `/${href}`}`;
}

/**
 * The smallest rendition that is still big enough.
 *
 * Not the largest: a masthead is at most 1400px wide and Getty will happily
 * hand back a 5000px original, which costs a slow download here and a slow page
 * for a reader. Landscape only, because every place this is used is a wide
 * plate and a portrait crop into one is a photograph of somebody's shorts.
 */
export function bestLink(links: AssetLink[], minWidth = 1000): AssetLink | null {
  const usable = (links ?? [])
    .filter((l) => l.width >= minWidth && l.width >= l.height)
    .sort((a, b) => a.width - b.width);
  if (usable.length) return usable[0] ?? null;
  // Nothing wide enough: take the biggest landscape there is rather than none.
  const landscape = (links ?? []).filter((l) => l.width >= l.height).sort((a, b) => b.width - a.width);
  return landscape[0] ?? null;
}

/**
 * The club an asset is of — which is in the TITLE, not in the refs.
 *
 * Two live runs matched zero of five hundred assets between them before anyone
 * looked at the payload. The `refs` array holds PLAYERS and nothing else:
 *
 *   title="SV Elversberg - Single Player Action 2026/27 for Bundesliga"
 *   refs=[profile:Futkeu, Noel]
 *
 *   title="Heart of Midlothian Training & Press Conference"
 *   refs=[profile:Guendouz, Sabri]
 *
 * Getty's convention is that the title OPENS with the club, so the match is on
 * leading word-groups of the title: take the first six words, then the first
 * five, and so on, and the longest one that is a team we know wins. Longest
 * first matters — "Heart of Midlothian" has to beat a bare "Heart", and a club
 * whose name is one common word must not win against a longer one that starts
 * with it.
 *
 * Only leading groups are tried. The club is at the front or it is not the
 * subject of the photograph, and searching the whole string would match the
 * competition at the end of every Bundesliga title.
 */
export function clubCandidates(asset: Asset): string[] {
  const title = normalise(String(asset.title ?? '').split(/\s+[-–—]\s+/)[0] ?? '');
  if (!title) return [];
  const words = title.split(' ').filter(Boolean);
  const out: string[] = [];
  for (let n = Math.min(6, words.length); n >= 1; n--) out.push(words.slice(0, n).join(' '));
  return out;
}

/** Everything about one asset, for working out why a sweep matched nothing. */
export function describe(asset: Asset): string {
  const refs = (asset.refs ?? []).map((r) => `${r.type ?? '?'}:${r.name ?? '?'}`).join(' | ');
  return `${asset.id} title=${JSON.stringify(asset.title ?? '')} refs=[${refs}]`;
}

/**
 * The credit line, which is not optional decoration.
 *
 * Agency photography carries a copyright string and it travels with the image.
 * Storing it next to the file is the only way the page can show it later, and a
 * photograph published without its credit is the kind of thing that ends a
 * trial key rather than renews it.
 */
export function creditOf(asset: Asset): string {
  return (asset.copyright ?? '').trim() || 'Getty Images';
}

export async function fetchImage(url: string): Promise<{ body: Uint8Array; type: string }> {
  const res = await get(url);
  if (!res.ok) throw new ImagesError(res.status, url, await res.text());
  return {
    body: new Uint8Array(await res.arrayBuffer()),
    type: res.headers.get('content-type') ?? 'image/jpeg',
  };
}
