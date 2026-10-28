/** Render the channel's win and loss reactions into engine/assets (see src/social/reactions.ts). */
import { writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { renderReaction } from '../src/social/reactions.ts';

const browser = await chromium.launch({ executablePath: process.env['CHROMIUM_PATH'] || undefined });
for (const kind of ['win', 'loss'] as const) {
  const buf = await renderReaction(browser as never, kind);
  writeFileSync(new URL(`../assets/react-${kind}.mp4`, import.meta.url), buf);
  console.log(`${kind}: ${buf.byteLength} bytes`);
}
await browser.close();
