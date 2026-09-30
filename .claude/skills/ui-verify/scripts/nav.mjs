/**
 * Navigation, in a real browser: what the reader ends up looking at after
 * moving around, rather than what one page looks like on arrival.
 *
 * check.mjs measures pages one at a time. The bugs here only exist between
 * pages -- two navigations racing, a Back that loses the place, an overlay
 * left open over the next page -- so they need their own driver.
 *
 *   node nav.mjs              # every scenario
 *   node nav.mjs race back    # just those
 *
 * Each scenario prints PASS or FAIL with what it saw. Exit code is the number
 * of failures.
 */
import { chromium } from 'playwright';

const CHROME = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BASE = process.env.BASE ?? 'http://127.0.0.1:8788';
const only = new Set(process.argv.slice(2));

const board = await (await fetch(`${BASE}/api/board`)).json();
// Offers running now, marked as already shown: the popup is its own scenario
// and would otherwise take focus and sit over whatever is being measured.
const promos = await (await fetch(`${BASE}/api/promos`)).json().catch(() => []);
const promoIds = Array.isArray(promos) ? promos.map((p) => p.id) : [];
const fixtures = (board.fixtures ?? board ?? []).filter((f) => f && f.id);
const FX = fixtures.map((f) => f.id);
if (FX.length < 2) { console.error('the board has fewer than two fixtures; nothing to navigate'); process.exit(1); }

const browser = await chromium.launch({ executablePath: CHROME });
let failures = 0;
const report = (name, ok, detail) => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `: ${detail}` : ''}`);
};

async function fresh(width = 390, { slow = 0 } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: 800 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // A slow network for the API, so a race between two navigations is real
  // rather than won by whichever cache answered first.
  if (slow) await page.route('**/api/**', async (r) => { await new Promise((ok) => setTimeout(ok, slow)); await r.continue(); });
  // Answer the cookie notice first: it is its own scenario, and here it
  // would sit over whatever is being measured.
  await page.addInitScript((ids) => { try { localStorage.setItem('ow.consent', 'declined'); localStorage.setItem('ow.promo', JSON.stringify({ seen: ids, closed: ids })); } catch {} }, promoIds);
  return { ctx, page, errors };
}
const settle = (page, ms = 2500) => page.waitForTimeout(ms);
const where = (page) => page.evaluate(() => ({
  hash: location.hash, path: location.pathname, y: Math.round(scrollY),
  title: document.title,
  // What the page actually drew: the first heading and the view's own marker.
  h1: document.querySelector('#app h1')?.textContent?.trim().slice(0, 60) ?? null,
  view: document.querySelector('#app [data-view]')?.dataset.view ?? null,
  text: document.getElementById('app')?.innerText.slice(0, 120).replace(/\s+/g, ' ') ?? '',
}));

const scenarios = {
  /** Tap a match, then another page before the match has loaded: the second page must win. */
  async race() {
    const { ctx, page } = await fresh(390, { slow: 1500 });
    await page.goto(`${BASE}/#/home`, { waitUntil: 'load' });
    await settle(page, 4000);
    await page.evaluate((id) => { location.hash = `#/fixture/${id}`; }, FX[0]);
    await page.waitForTimeout(200);
    await page.evaluate(() => { location.hash = '#/results'; });
    await settle(page, 6000);
    const w = await where(page);
    const onResults = w.hash === '#/results' && /record/i.test(w.title) && !/fixture|match/.test(w.path);
    report('race: the last page asked for is the one shown', onResults && /results/i.test(w.h1 ?? ''), JSON.stringify({ hash: w.hash, path: w.path, title: w.title, h1: w.h1 }));
    await ctx.close();
  },

  /** Back from a match returns to the board where the reader left it. */
  async back() {
    const { ctx, page } = await fresh(390);
    await page.goto(`${BASE}/#/board`, { waitUntil: 'load' });
    await settle(page, 4000);
    await page.evaluate(() => scrollTo(0, 1600));
    await page.waitForTimeout(300);
    const before = (await where(page)).y;
    const link = page.locator('#app a[href*="/match/"], #app a[href^="#/fixture/"]').nth(8);
    await link.scrollIntoViewIfNeeded();
    const y = (await where(page)).y;
    await link.click();
    await settle(page, 3000);
    await page.goBack();
    await settle(page, 3000);
    const after = await where(page);
    report('back: the board comes back where it was left', after.hash.startsWith('#/board') && Math.abs(after.y - y) < 60,
      `left at ${y} (scrolled to ${before}), came back at ${after.y}, ${after.hash}`);
    await ctx.close();
  },

  /** A filter or tab changed on a page is part of where the reader was: Back comes to it, scrolled as it was. */
  async backfiltered() {
    const { ctx, page } = await fresh(390);
    await page.goto(`${BASE}/#/board`, { waitUntil: 'load' });
    await settle(page, 4000);
    // The day tab, which rewrites the address in place.
    const tab = page.locator('button[data-when="played"]');
    if (await tab.count()) { await tab.click(); await settle(page, 1500); }
    const hash = (await where(page)).hash;
    const link = page.locator('#app a[href*="/match/"], #app a[href^="#/fixture/"]').nth(6);
    await link.scrollIntoViewIfNeeded();
    await page.evaluate(() => scrollBy(0, -100));
    await page.waitForTimeout(300);
    const y = (await where(page)).y;
    await link.click();
    await settle(page, 3000);
    await page.goBack();
    await settle(page, 3000);
    const after = await where(page);
    report('backfiltered: Back returns to the filtered board, where it was', after.hash === hash && Math.abs(after.y - y) < 60, `${hash} at ${y}; came back to ${after.hash} at ${after.y}`);
    await ctx.close();
  },

  /** A match page and the front page keep their own places. */
  async backmatch() {
    const { ctx, page } = await fresh(390);
    await page.goto(`${BASE}/#/home`, { waitUntil: 'load' });
    await settle(page, 3000);
    await page.evaluate(() => scrollTo(0, 700));
    await page.waitForTimeout(300);
    await page.evaluate((id) => { location.hash = `#/fixture/${id}`; }, FX[1]);
    await settle(page, 3000);
    await page.evaluate(() => scrollTo(0, 1500));
    await page.waitForTimeout(300);
    const matchY = (await where(page)).y;
    await page.evaluate(() => { location.hash = '#/results'; });
    await settle(page, 2500);
    await page.goBack();
    await settle(page, 3000);
    const back1 = await where(page);
    report('backmatch: Back to a match page returns to its own place', /match|fixture/.test(back1.path + back1.hash) && Math.abs(back1.y - matchY) < 60, `left at ${matchY}, back at ${back1.y} (${back1.path}${back1.hash})`);
    await ctx.close();
  },

  /** Signing in from a match page comes back to the match, not the front page. */
  async signinreturn() {
    const { ctx, page } = await fresh(1440);
    await page.goto(`${BASE}/#/fixture/${FX[1]}`, { waitUntil: 'load' });
    await settle(page, 3000);
    await page.evaluate(() => { location.hash = '#/signin'; });
    await settle(page, 2000);
    const intent = await page.evaluate(() => { try { return JSON.parse(localStorage.getItem('ow.after-signin') ?? 'null')?.v ?? null; } catch { return null; } });
    report('signinreturn: signing in from a match returns to it', intent === `#/fixture/${FX[1]}`, `after sign-in: ${intent}`);
    await ctx.close();
  },

  /** A row of tabs answers the arrow keys, as its markup promises. */
  async tabkeys() {
    const { ctx, page } = await fresh(1440);
    await page.goto(`${BASE}/#/board`, { waitUntil: 'load' });
    await settle(page, 3000);
    await page.locator('button[data-when][aria-selected="true"]').focus();
    await page.keyboard.press('End');
    await page.waitForTimeout(800);
    const now = await page.evaluate(() => ({ focus: document.activeElement?.dataset?.when, selected: document.querySelector('button[data-when][aria-selected="true"]')?.dataset.when, hash: location.hash }));
    report('tabkeys: End moves to the last tab and opens it', now.focus === 'played' && now.selected === 'played', JSON.stringify(now));
    await ctx.close();
  },

  /** A new page starts at the top, and the keyboard's place moves with it. */
  async top() {
    const { ctx, page } = await fresh(390);
    await page.goto(`${BASE}/#/board`, { waitUntil: 'load' });
    await settle(page, 4000);
    await page.evaluate(() => scrollTo(0, 2000));
    await page.locator('#app a[href*="/match/"], #app a[href^="#/fixture/"]').nth(10).click();
    await settle(page, 3000);
    const w = await where(page);
    const focus = await page.evaluate(() => {
      const a = document.activeElement;
      return a === document.body ? 'body' : `${a.tagName.toLowerCase()}${a.id ? `#${a.id}` : ''}${a.className ? `.${String(a.className).split(' ')[0]}` : ''}`;
    });
    report('top: a new page opens at the top', w.y < 5, `y ${w.y}`);
    report('top: focus moves to the new page\'s heading', /^h1\b/.test(focus), `focus on ${focus}`);
    await ctx.close();
  },

  /** An address that does not exist says so, with a way out. */
  async missing() {
    const { ctx, page } = await fresh(390);
    for (const bad of ['#/nope', '#/fixture/1', '#/league/999999', '#/player/1', '#/legal/nothing']) {
      await page.goto(`${BASE}/${bad}`, { waitUntil: 'load' });
      await settle(page, 3000);
      const w = await where(page);
      const links = await page.locator('#app a').count();
      const empty = w.text.trim().length < 20;
      report(`missing: ${bad} explains itself`, !empty && links > 0 && !/loading/i.test(w.text), `${JSON.stringify(w.text.slice(0, 90))}, ${links} links`);
    }
    await ctx.close();
  },

  /** The menu, the account menu and the offer popup never outlive the page they were opened on. */
  async overlays() {
    const { ctx, page } = await fresh(390);
    await page.goto(`${BASE}/#/home`, { waitUntil: 'load' });
    await settle(page, 3000);
    await page.click('#burger');
    await page.waitForTimeout(300);
    const open = await page.evaluate(() => document.getElementById('nav').classList.contains('open'));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    const closed = await page.evaluate(() => !document.getElementById('nav').classList.contains('open'));
    const focus = await page.evaluate(() => document.activeElement?.id);
    report('overlays: Escape closes the menu and gives focus back to its button', open && closed && focus === 'burger', `opened ${open}, closed ${closed}, focus ${focus}`);
    await page.click('#burger');
    await page.waitForTimeout(300);
    await page.locator('#nav a').filter({ hasText: /results/i }).first().click();
    await settle(page, 2500);
    const after = await page.evaluate(() => ({ open: document.getElementById('nav').classList.contains('open'), overflow: getComputedStyle(document.documentElement).overflow, lock: document.documentElement.classList.contains('menu-lock'), hash: location.hash }));
    report('overlays: following a menu link closes the menu and frees the page', !after.open && !after.lock && after.overflow !== 'hidden', JSON.stringify(after));
    await ctx.close();
  },

  /** The offer popup waits while the reader is typing, and goes when they move page. */
  async popup() {
    if (!promoIds.length) { report('popup: no offer is running, nothing to check', true); return; }
    const { ctx, page } = await fresh(390);
    // This one wants the popup, so the offers are not marked as seen.
    await page.addInitScript(() => { try { localStorage.setItem('ow.promo', JSON.stringify({ seen: [], closed: [] })); } catch {} });
    await page.goto(`${BASE}/#/search`, { waitUntil: 'load' });
    await settle(page, 1500);
    await page.locator('#search-q').focus();
    await page.keyboard.type('arse', { delay: 120 });
    await page.waitForTimeout(8000);
    const whileTyping = await page.evaluate(() => ({ popup: !!document.querySelector('.ofr-root'), focus: document.activeElement?.id }));
    report('popup: never opens over a field being typed in', !whileTyping.popup && whileTyping.focus === 'search-q', JSON.stringify(whileTyping));
    await page.evaluate(() => document.activeElement?.blur());
    await page.waitForTimeout(6000);
    const later = await page.evaluate(() => !!document.querySelector('.ofr-root'));
    report('popup: opens once the reader stops', later, `open ${later}`);
    await page.goBack();
    await settle(page, 1500);
    const gone = await page.evaluate(() => ({ popup: !!document.querySelector('.ofr-root'), lock: document.documentElement.classList.contains('ofr-lock') }));
    report('popup: Back takes it down and frees the page', !gone.popup && !gone.lock, JSON.stringify(gone));
    await ctx.close();
  },

  /** The phone menu holds the page still behind it and keeps the keyboard inside. */
  async menulock() {
    const { ctx, page } = await fresh(390);
    await page.goto(`${BASE}/#/board`, { waitUntil: 'load' });
    await settle(page, 3000);
    await page.click('#burger');
    await page.waitForTimeout(400);
    const y0 = (await where(page)).y;
    await page.mouse.move(200, 600);
    await page.mouse.wheel(0, 900);
    await page.waitForTimeout(500);
    const y1 = (await where(page)).y;
    report('menulock: the page behind the open menu does not scroll', Math.abs(y1 - y0) < 5, `from ${y0} to ${y1}`);
    const escaped = [];
    for (let i = 0; i < 20; i++) {
      await page.keyboard.press('Tab');
      const inside = await page.evaluate(() => !!document.activeElement?.closest?.('#nav, #burger'));
      if (!inside) { escaped.push(await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 60))); break; }
    }
    report('menulock: Tab stays in the open menu', escaped.length === 0, escaped[0] ?? '');
    await ctx.close();
  },

  /** Every page names itself in the tab, so the history list and a screen reader can tell them apart. */
  async titles() {
    const { ctx, page } = await fresh(1440);
    const seen = new Map();
    for (const r of ['#/home', '#/board', '#/results', '#/leagues', '#/pricing', '#/search', `#/fixture/${FX[1]}`, '#/signin', '#/legal/privacy', '#/slip']) {
      await page.goto(`${BASE}/${r}`, { waitUntil: 'load' });
      await settle(page, 2500);
      seen.set(r, (await where(page)).title);
    }
    const titles = [...seen.values()];
    const dupes = titles.filter((t, i) => titles.indexOf(t) !== i);
    report('titles: every page has its own title', dupes.length === 0, [...seen].map(([r, t]) => `${r} = ${t}`).join(' | '));
    await ctx.close();
  },
};

for (const [name, run] of Object.entries(scenarios)) {
  if (only.size && !only.has(name)) continue;
  try { await run(); } catch (err) { report(name, false, `threw: ${err.message.split('\n')[0]}`); }
}
await browser.close();
process.exit(failures);
