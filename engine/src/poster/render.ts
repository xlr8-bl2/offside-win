/**
 * Turning a fixture into a PNG.
 *
 * Crests are fetched here rather than by the page so that a miss is handled in
 * one place and so the canvas that samples them is same-origin. The provider's
 * image service answers without auth but is not reliably CORS-friendly, and a
 * tainted canvas throws on getImageData — which would silently cost every
 * poster its colour.
 *
 * It also has one failure mode worth knowing: a missing image comes back as
 * HTTP 200 with a 1x1 transparent PNG, not a 404. So "did this work" is a
 * question about the bytes, not the status code.
 */

import { posterHTML, type PosterInput, type PosterTeam } from './template.ts';
import { choosePalette, pairPalettes, hex, type Sample } from './palette.ts';

const IMG_BASE = process.env['BSD_IMG_BASE'] ?? 'https://sports.bzzoiro.com/img';

/** Anything at or under this many bytes is the provider's blank placeholder. */
const BLANK_PNG_BYTES = 200;

export async function fetchCrest(teamId: number | null | undefined): Promise<string | null> {
  if (!teamId) return null;
  try {
    const res = await fetch(`${IMG_BASE}/team/${teamId}/`, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    // The 1x1 placeholder, which arrives with a 200 and would otherwise render
    // as an empty badge that looks like a bug rather than a missing crest.
    if (buf.byteLength <= BLANK_PNG_BYTES) return null;
    const type = res.headers.get('content-type') ?? 'image/png';
    return `data:${type};base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}

export interface RenderOptions {
  /** A Playwright Browser. Passed in so one browser serves a whole slate. */
  browser: { newPage: (o?: unknown) => Promise<PosterPage> };
  width?: number;
  height?: number;
}

interface PosterPage {
  setContent: (html: string, o?: unknown) => Promise<void>;
  waitForFunction: (fn: string, arg?: unknown, o?: unknown) => Promise<unknown>;
  evaluate: <T>(fn: string) => Promise<T>;
  screenshot: (o?: unknown) => Promise<Buffer>;
  close: () => Promise<void>;
}

export interface RenderInput extends Omit<PosterInput, 'home' | 'away'> {
  home: { name: string; id?: number | null };
  away: { name: string; id?: number | null };
}

/**
 * Render one poster.
 *
 * Two passes over the same page: the first paints the layout and samples the
 * crests, the second applies the colours those samples imply. Doing it in one
 * page rather than two keeps the fonts and the fitted type exactly as measured.
 */
export async function renderPoster(input: RenderInput, opts: RenderOptions): Promise<Buffer> {
  const width = opts.width ?? input.width ?? 1200;
  const height = opts.height ?? input.height ?? 630;

  const [homeCrest, awayCrest] = await Promise.all([
    fetchCrest(input.home.id),
    fetchCrest(input.away.id),
  ]);

  const home: PosterTeam = { name: input.home.name, crest: homeCrest };
  const away: PosterTeam = { name: input.away.name, crest: awayCrest };

  const page = await opts.browser.newPage({
    viewport: { width, height },
    deviceScaleFactor: 2,
  });

  try {
    await page.setContent(posterHTML({ ...input, home, away, width, height }), {
      waitUntil: 'networkidle',
    });
    await page.waitForFunction('window.__fitted === true', undefined, { timeout: 15_000 });

    const samples = await page.evaluate<{ home: Sample[]; away: Sample[] }>('window.__samples');
    const pair = pairPalettes(choosePalette(samples.home ?? []), choosePalette(samples.away ?? []));

    await page.evaluate<void>(`(() => {
      const s = document.body.style;
      s.setProperty('--home', ${JSON.stringify(hex(pair[0].primary))});
      s.setProperty('--away', ${JSON.stringify(hex(pair[1].primary))});
      s.setProperty('--home-ink', ${JSON.stringify(hex(pair[0].ink))});
      s.setProperty('--away-ink', ${JSON.stringify(hex(pair[1].ink))});
    })()`);

    return await page.screenshot({ type: 'png' });
  } finally {
    await page.close();
  }
}
