/**
 * Render posters for real fixtures, from real provider art.
 *
 * Exists because a poster can only be judged by looking at it, and the
 * synthetic crests used in the unit tests are flat discs — they prove the
 * colour rules and tell you nothing about how an actual badge sits on a shield.
 *
 * Reads the live board, takes the most prominent fixtures on it, pulls the real
 * crests and competition marks, and writes PNGs. Run in Actions, where the
 * output lands as an artifact.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, type Browser } from 'playwright';
import { posterHTML, type PosterInput } from '../src/poster/template.ts';
import { choosePalette, pairPalettes, hex, type Sample } from '../src/poster/palette.ts';
import { occasionOf } from '../src/occasion.ts';

const SITE = process.env['SITE'] ?? 'https://offside-win.ashleymbaht.workers.dev';
const IMG = process.env['BSD_IMG_BASE'] ?? 'https://sports.bzzoiro.com/img';
const OUT = process.env['POSTER_OUT'] ?? 'poster-preview';
const COUNT = Number(process.env['POSTER_COUNT'] ?? 8);

/**
 * Where Chromium lives.
 *
 * CI runs `playwright install chromium` and Playwright finds its own build. The
 * dev container ships a pinned one that will not match whatever version the
 * package resolves to — 1.63 wants build 1243, the container carries 1194 — so
 * locally the path is handed in rather than discovered.
 */
const BROWSER = process.env['CHROMIUM_PATH'] || undefined;

/** A miss comes back as HTTP 200 with a 1x1 transparent PNG, not a 404. */
const BLANK_BYTES = 200;

async function art(kind: string, id: number | null | undefined): Promise<string | null> {
  if (!id) return null;
  try {
    const res = await fetch(`${IMG}/${kind}/${id}/`, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength <= BLANK_BYTES) return null;
    return `data:${res.headers.get('content-type') ?? 'image/png'};base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}

function when(epoch: number) {
  const d = new Date(epoch * 1000);
  return {
    date: d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }),
    time: d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }),
  };
}

/** "Regular season · Matchday 7" is the feed's phrasing; the poster wants the end of it. */
function roundLabel(s: string | null | undefined): string | null {
  const t = String(s ?? '').split('·').pop()?.trim();
  return t && t.length <= 24 ? t : null;
}

async function render(browser: Browser, input: PosterInput, file: string) {
  const page = await browser.newPage({
    viewport: { width: input.width ?? 1600, height: input.height ?? 900 },
    deviceScaleFactor: 2,
  });
  try {
    await page.setContent(posterHTML(input), { waitUntil: 'networkidle' });
    await page.waitForFunction('window.__fitted === true', null, { timeout: 25_000 });

    const samples = await page.evaluate('window.__samples') as { home: Sample[]; away: Sample[] };
    const [h, a] = pairPalettes(choosePalette(samples.home ?? []), choosePalette(samples.away ?? []));

    // A string body rather than a closure: the engine's tsconfig has no DOM
    // lib, and adding one to typecheck four lines that run in a browser would
    // let DOM globals leak into every other module here.
    await page.evaluate(`(() => {
      const s = document.body.style;
      s.setProperty('--home', ${JSON.stringify(hex(h.primary))});
      s.setProperty('--away', ${JSON.stringify(hex(a.primary))});
      s.setProperty('--home-ink', ${JSON.stringify(hex(h.ink))});
      s.setProperty('--away-ink', ${JSON.stringify(hex(a.ink))});
    })()`);
    await page.waitForTimeout(150);

    await page.screenshot({ path: `${OUT}/${file}.png` });
    return { home: hex(h.primary), away: hex(a.primary) };
  } finally {
    await page.close();
  }
}

async function main() {
  await mkdir(OUT, { recursive: true });

  const board = await (await fetch(`${SITE}/api/board`)).json() as { fixtures: any[] };
  // The board already sorts by day then prominence, so the head of it is what
  // the site would lead with.
  const picked = (board.fixtures ?? []).slice(0, COUNT);
  console.log(`board: ${board.fixtures?.length ?? 0} fixtures, rendering ${picked.length}`);

  const browser = await chromium.launch(BROWSER ? { executablePath: BROWSER } : {});
  const rows: string[] = [];

  try {
    for (const [i, f] of picked.entries()) {
      // The bundle carries form, head to head and the weather the strip needs.
      const bundle = await (await fetch(`${SITE}/api/fixture/${f.id}`)).json() as any;
      const weather = (bundle.ledger ?? [])
        .find((x: any) => x.id === 'environment.weather')?.evidence ?? null;

      const [homeCrest, awayCrest, compCrest] = await Promise.all([
        art('team', f.home_id), art('team', f.away_id), art('league', f.league_id),
      ]);

      const occ = occasionOf({
        home: f.home, away: f.away, league_id: f.league_id,
        round_label: bundle.round_label, local_derby: false, rank: f.rank ?? 6,
      });

      const t = when(f.kickoff);
      const colours = await render(browser, {
        home: { name: f.home, crest: homeCrest, form: bundle.form?.home?.sequence ?? null },
        away: { name: f.away, crest: awayCrest, form: bundle.form?.away?.sequence ?? null },
        kicker: occ.kicker,
        competition: f.league ?? '',
        competitionCrest: compCrest,
        date: t.date,
        time: t.time,
        round: roundLabel(bundle.round_label),
        stats: {
          h2h: bundle.h2h?.total_matches
            ? { home: bundle.h2h.home_wins ?? 0, draws: bundle.h2h.draws ?? 0, away: bundle.h2h.away_wins ?? 0 }
            : null,
          weather,
        },
      }, `${String(i + 1).padStart(2, '0')}-${f.home}-v-${f.away}`.replace(/[^a-zA-Z0-9-]+/g, '-').slice(0, 60));

      rows.push([
        `${f.home} v ${f.away}`.padEnd(46).slice(0, 46),
        (occ.kicker || f.league || '').padEnd(24).slice(0, 24),
        `crest ${homeCrest ? 'y' : 'N'}${awayCrest ? 'y' : 'N'}`,
        `comp ${compCrest ? 'y' : 'N'}`,
        `${colours.home} ${colours.away}`,
      ].join('  '));
    }
  } finally {
    await browser.close();
  }

  console.log('\n' + rows.join('\n'));
  await writeFile(`${OUT}/summary.txt`, rows.join('\n') + '\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
