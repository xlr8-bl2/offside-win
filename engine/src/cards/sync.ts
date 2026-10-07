/**
 * Keep every match's share card current.
 *
 * Reads the board the way a signed-out reader sees it (so a card can never
 * carry anything a member paid for), works out what each card should say,
 * and redraws only the ones that changed since the last run: a new free call,
 * a call going up, the final score, how a call settled. The keys of the cards
 * already drawn are kept in kv, so a quiet run draws nothing.
 *
 * Cards go to the public images bucket at og/<fixture id>.jpg. The Worker
 * serves them from offside.win/og/<id>.jpg and every match page names that
 * address as its og:image.
 */

import { chromium } from 'playwright';
import { kvGetJSON, kvSetJSON } from '../store.ts';
import { ensureBucket, put } from '../images/store.ts';
import { renderCard, type CardFixture } from './card.ts';
// @ts-expect-error -- plain JS modules shared with the site
import { describe } from '../../../public/js/lib/markets.js';
// @ts-expect-error -- plain JS modules shared with the site
import { cardKey, cardPath } from '../../../public/js/lib/cards.js';

const SITE = (process.env['SITE'] ?? 'https://offside.win').replace(/\/$/, '');
const MAX = Number(process.env['CARDS_MAX'] ?? 120);
// The cards drawn, by the key of what each said. Its own name since the move
// to D1 (October 2026): the cards in the old store are not in the new one, so
// every card is drawn again once.
const KV = 'cards:keys:d1';

export async function syncCards(): Promise<{ seen: number; drawn: number; failed: number; kept: number }> {
  const res = await fetch(`${SITE}/api/board?hours=96`, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`board: ${res.status}`);
  const board = await res.json() as { fixtures?: CardFixture[] };
  const now = Date.now() / 1000;
  // What anyone might share: matches still to come, and ones played in the
  // last two days.
  const fixtures = (board.fixtures ?? []).filter((f) => f.id && f.home && f.away && f.kickoff > now - 48 * 3600);

  const keys: Record<string, string> = (await kvGetJSON<Record<string, string>>(KV)) ?? {};
  const todo = fixtures
    .map((f) => ({ f, key: String(cardKey(f, describe)) }))
    .filter(({ f, key }) => keys[String(f.id)] !== key)
    // Soonest first: the match kicking off tonight is the one being shared.
    .sort((a, b) => Math.abs(a.f.kickoff - now) - Math.abs(b.f.kickoff - now))
    .slice(0, MAX);

  console.log(`cards: ${fixtures.length} matches, ${todo.length} to draw`);
  if (!todo.length) return { seen: fixtures.length, drawn: 0, failed: 0, kept: Object.keys(keys).length };

  await ensureBucket();
  const browser = await chromium.launch(process.env['CHROMIUM_PATH'] ? { executablePath: process.env['CHROMIUM_PATH'] } : {});
  let drawn = 0;
  let failed = 0;
  try {
    for (const { f, key } of todo) {
      try {
        const jpg = await renderCard(f, browser as never);
        // Short-lived in the storage CDN: the same address is redrawn at full time.
        await put(String(cardPath(f.id)), new Uint8Array(jpg), 'image/jpeg', 'public, max-age=300');
        keys[String(f.id)] = key;
        drawn++;
      } catch (err) {
        failed++;
        console.log(`  ${f.id} ${f.home} v ${f.away}: failed (${err instanceof Error ? err.message.slice(0, 120) : String(err)})`);
      }
    }
  } finally {
    await browser.close();
  }

  // Forget cards for matches long gone, so the manifest does not grow forever.
  const live = new Set(fixtures.map((f) => String(f.id)));
  for (const id of Object.keys(keys)) if (!live.has(id)) delete keys[id];
  await kvSetJSON(KV, keys);
  console.log(`cards: drew ${drawn}, ${failed} failed`);
  return { seen: fixtures.length, drawn, failed, kept: Object.keys(keys).length };
}
