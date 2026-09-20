/**
 * Drive the real pages in a real browser and report what is actually wrong.
 *
 * Every check here exists because it caught something that reading the diff
 * did not. Add to it rather than writing a one-off each time.
 *
 *   node check.mjs '#/board' '#/fixture/213698'
 *   WIDTHS=1440,390,320 node check.mjs '#/pricing'
 */
import { chromium } from 'playwright';

const CHROME = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BASE = process.env.BASE ?? 'http://127.0.0.1:8788';
const WIDTHS = (process.env.WIDTHS ?? '1440,390').split(',').map(Number);
const ROUTES = process.argv.slice(2).length ? process.argv.slice(2) : ['#/home', '#/board'];

// Routes whose decimals are settled history rather than the thing being sold.
const PUBLIC_PRICES = /^#\/results/;

// Words the vocabulary rule bans outright, in either view.
const BANNED = ['expected goals', 'points a game', 'confidence', ' edge', 'xG', 'per match'];

/**
 * Whether a decimal on the page is a problem depends on who is looking.
 *
 * A price is the product: 1.14 and a stake return of 11.40 are exactly what a
 * member is paying to see. A spreadsheet number is banned everywhere. The two
 * are the same shape, so the check asks which view it is in rather than
 * guessing — and the answer is decided by the API, not by a flag somebody has
 * to remember to pass.
 *
 * In the free view no price may appear at all, so any decimal is a finding.
 * In the paid view the decimal check is off and the banned words still apply.
 *
 * Written the blunt way first, which flagged the odds on the board as
 * violations. A checker that cries wolf gets ignored, which is worse than not
 * having one.
 */
async function isFreeView(base) {
  try {
    const board = await (await fetch(`${base}/api/board?hours=6`)).json();
    const withCall = (board.fixtures ?? []).find((f) => f.top_pick || f.locked);
    return withCall ? !withCall.top_pick : false;
  } catch {
    return false;
  }
}

const free = await isFreeView(BASE);
console.log(`checking the ${free ? 'FREE' : 'paid'} view — decimals ${free ? 'are' : 'are not'} findings\n`);

const browser = await chromium.launch({ executablePath: CHROME });
const problems = [];

for (const width of WIDTHS) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    // The sandbox proxy re-terminates TLS, so external hosts always fail here.
    // That is the environment, not the page.
    if (m.type() === 'error' && !/ERR_CERT|Failed to load resource/.test(m.text())) errors.push(m.text());
  });

  for (const route of ROUTES) {
    errors.length = 0;
    await page.goto(`${BASE}/${route}`, { waitUntil: 'load' });
    // Long enough for the board to arrive. A short wait reads as "rendered
    // nothing" and sends you looking for a bug that is not there.
    await page.waitForTimeout(2500);

    const r = await page.evaluate(() => {
      const app = document.getElementById('app');
      const text = app?.textContent ?? '';
      const cs = getComputedStyle(document.documentElement);

      // A var() that resolves to nothing invalidates the whole declaration
      // silently. This is the check that would have caught .odds rendering at
      // inherited weight.
      const unresolved = [];
      for (const sheet of [...document.styleSheets]) {
        let rules;
        try { rules = [...sheet.cssRules]; } catch { continue; }
        for (const rule of rules) {
          const css = rule.cssText ?? '';
          for (const m of css.matchAll(/var\(\s*(--[a-z0-9-]+)\s*\)/g)) {
            if (!cs.getPropertyValue(m[1]).trim()) unresolved.push(m[1]);
          }
        }
      }

      /*
       * Siblings sitting on top of each other.
       *
       * The checker measured the page for sideways scroll and never looked
       * inside a container, so a grid whose tracks collapsed under their own
       * content passed clean while it rendered two team sheets in the same
       * place, names over names. Horizontal overflow was zero the whole time,
       * because the overlap was contained.
       *
       * Only in-flow element siblings are compared: anything positioned is
       * overlapping on purpose, and a scroll container's children legitimately
       * sit outside it. Two pixels of tolerance keeps sub-pixel rounding and
       * deliberate 1px rule overlaps out of the report.
       */
      /*
       * Everything behind a tab, too.
       *
       * The checker only ever saw the pane that happens to open first, so a
       * layout fault on the line-ups tab — two team sheets rendered on top of
       * each other — passed clean for as long as it existed. A hidden element
       * has a zero-size rect, so it cannot overlap anything and cannot be
       * measured at all.
       *
       * The panes are revealed for the measurement only. The page is thrown
       * away straight afterwards, and this is scoped to `.tabpane` rather than
       * everything `[hidden]`, which would light up dialogs and menus that are
       * hidden for good reasons.
       */
      for (const pane of document.querySelectorAll('.tabpane[hidden]')) pane.hidden = false;

      const overlaps = [];
      const describe = (el) =>
        el.tagName.toLowerCase() + (el.className && typeof el.className === 'string'
          ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '');
      for (const parent of app?.querySelectorAll('*') ?? []) {
        const kids = [...parent.children].filter((k) => {
          const cs = getComputedStyle(k);
          if (cs.position !== 'static' && cs.position !== 'relative') return false;
          // A negative margin is an instruction to overlap — stacked crests,
          // a pulled-up panel. Overlap the author asked for is not a finding;
          // overlap from content bursting out of its track is.
          return !['marginLeft', 'marginRight', 'marginTop', 'marginBottom']
            .some((m) => parseFloat(cs[m]) < 0);
        });
        if (kids.length < 2 || kids.length > 24) continue;
        for (let i = 0; i < kids.length && overlaps.length < 6; i++) {
          for (let j = i + 1; j < kids.length; j++) {
            const a = kids[i].getBoundingClientRect();
            const b = kids[j].getBoundingClientRect();
            if (!a.width || !a.height || !b.width || !b.height) continue;
            const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
            const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
            if (ox > 2 && oy > 2) {
              overlaps.push(`${describe(kids[i])} over ${describe(kids[j])} by ${Math.round(ox)}x${Math.round(oy)}px`);
              break;
            }
          }
        }
      }

      return {
        chars: text.trim().length,
        overlaps: [...new Set(overlaps)],
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        unresolved: [...new Set(unresolved)],
        decimals: [...new Set(text.match(/\b\d+\.\d{1,2}\b/g) ?? [])].slice(0, 5),
        lowerText: text.toLowerCase(),
      };
    });

    const say = (msg) => problems.push(`${width}px ${route}: ${msg}`);
    if (r.chars < 80) say(`rendered almost nothing (${r.chars} chars)`);
    if (r.overflow > 0) say(`scrolls sideways by ${r.overflow}px`);
    for (const o of r.overlaps) say(`elements overlap: ${o}`);
    if (r.unresolved.length) say(`undefined tokens: ${r.unresolved.join(', ')}`);
    // A price is legitimate for a member and forbidden for everyone else --
    // except on the settled record, which is public and unfiltered forever,
    // losses included, because that page being believable is the whole
    // marketing strategy. A price there is history, not the product. Without
    // this the checker reports the results page as a paywall leak on every
    // run, and a checker that cries wolf gets ignored.
    if (free && !PUBLIC_PRICES.test(route) && r.decimals.length) {
      say(`a price reached a free reader: ${r.decimals.join(', ')}`);
    }
    for (const w of BANNED) if (r.lowerText.includes(w.toLowerCase())) say(`banned term "${w.trim()}"`);
    if (errors.length) say(`console: ${errors.slice(0, 3).join(' | ')}`);

    if (width === WIDTHS[0]) {
      console.log(`  ${route.padEnd(24)} ${String(r.chars).padStart(6)} chars  overflow ${r.overflow}px`);
    }
  }
  await page.close();
}

await browser.close();
console.log('');
if (problems.length) {
  console.log('PROBLEMS:');
  for (const p of problems) console.log('  ' + p);
  process.exitCode = 1;
} else {
  console.log('clean at ' + WIDTHS.join('px, ') + 'px');
}
