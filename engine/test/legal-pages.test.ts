import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
// @ts-expect-error -- a plain .mjs script, no types
import { render } from '../../scripts/legal-pages.mjs';

/**
 * The privacy policy and terms exist twice: in the app (#/legal/...) and as
 * real pages at /privacy and /terms for Google's brand verification. Both come
 * from public/js/lib/legal.js; this fails if the real pages were not
 * regenerated after an edit.
 */
for (const [which, file] of [['privacy', 'privacy.html'], ['terms', 'terms.html']] as const) {
  test(`public/${file} matches the legal text`, async () => {
    const onDisk = readFileSync(join(import.meta.dirname ?? '.', '../../public', file), 'utf8');
    assert.equal(onDisk, await render(which), `run node scripts/legal-pages.mjs`);
  });
}
