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

/*
 * The vocabulary rule, from the one place it is written down.
 *
 * This file used to keep a hand-typed list of six terms while
 * engine/src/vocabulary.ts defined forty, which meant the check passed pages
 * carrying "our numbers", "de-vig", "§7.3" and "CLV" -- a checker enforcing a
 * sixth of the rule it claims to enforce, and quietly training everyone to
 * believe the other thirty-four were covered.
 *
 * public/js/lib/vocabulary.js is the browser's copy of that list, held to the
 * engine's character for character by engine/test/vocabulary-agreement.test.ts.
 * It is a plain ES module, so this can just import it.
 */
const { BANNED } = await import(
  new URL('../../../../public/js/lib/vocabulary.js', import.meta.url)
);

/** Every banned term on the page, not just the first -- fixing one should not
 *  be how you discover the next. */
const findAllBanned = (text) =>
  [...new Set(BANNED.map((p) => p.exec(text)?.[0]).filter(Boolean))];

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
      // Prices meant for everyone -- the free call's odds, a plan's price in
      // pounds, the wall's "from £3.49" -- are marked data-public-price and
      // left out of the leak check, which is about paid calls only.
      const scan = app ? app.cloneNode(true) : null;
      for (const el of scan?.querySelectorAll('[data-public-price]') ?? []) el.remove();
      const text = scan?.textContent ?? '';
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
        // Shapes inside an <svg> overlap each other by design -- a centre
        // circle sits on a halfway line sits inside a touchline rectangle --
        // so they are drawings, not layout. The <svg> element itself is still
        // checked against its siblings.
        if (parent.closest('svg')) continue;
        const kids = [...parent.children].filter((k) => {
          const cs = getComputedStyle(k);
          if (cs.position !== 'static' && cs.position !== 'relative') return false;
          // An inline element that wraps onto a second line reports a
          // bounding box spanning both lines' full width, so two <b>s in one
          // paragraph "overlap" by the width of the column. That is text
          // flowing, not layout failing; only boxes are measured.
          if (cs.display === 'inline') return false;
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
        // A finished match's page is history, like the results page: its
        // calls are public once the match is over (get_fixture unwalls them).
        finished: Boolean(document.querySelector('.fx-top .live-badge.done')),
        // As rendered, not lowercased: a third of the banned patterns are
        // case-sensitive on purpose -- CONFIDENT, xG, CLV, P/L are our filing
        // system shouting, and "confident" in a sentence is not.
        text,
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
    if (free && !PUBLIC_PRICES.test(route) && !r.finished && r.decimals.length) {
      say(`a price reached a free reader: ${r.decimals.join(', ')}`);
    }
    for (const term of findAllBanned(r.text ?? r.lowerText)) say(`banned term "${term}"`);
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
