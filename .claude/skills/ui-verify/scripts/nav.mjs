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

async function fresh(width = 390, { slow = 0, height = 800, touch = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, ...(touch ? { hasTouch: true, isMobile: true, deviceScaleFactor: 2 } : {}) });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // A slow network for the API, so a race between two navigations is real
  // rather than won by whichever cache answered first.
  if (slow) await page.route('**/api/**', async (r) => { await new Promise((ok) => setTimeout(ok, slow)); await r.continue(); });
  // Answer the cookie notice first: it is its own scenario, and here it
  // would sit over whatever is being measured.
  // The week's note (an international break) too, for the same reason; it
  // has its own scenario below.
  await page.addInitScript((ids) => { try { localStorage.setItem('ow.consent', 'declined'); localStorage.setItem('ow.promo', JSON.stringify({ seen: ids, closed: ids })); localStorage.setItem('ow.season', '["*"]'); localStorage.setItem('ow.moments', '["*"]'); } catch {} }, promoIds);
  return { ctx, page, errors };
}
const settle = (page, ms = 2500) => page.waitForTimeout(ms);
/** A finger dragged up the screen by `dy` from (x, y): real touch events, so the page scrolls as a phone's would. */
async function swipe(page, x, y, dy, steps = 16) {
  const cdp = await page.context().newCDPSession(page);
  const at = (yy) => [{ x, y: Math.round(yy), id: 1 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: at(y) });
  for (let i = 1; i <= steps; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: at(y - (dy * i) / steps) });
    await new Promise((ok) => setTimeout(ok, 16));
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}
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
    // The bar's words open it again; it never locks the page, and a scroll
    // takes it down and moves the page under the same gesture.
    await page.goto(`${BASE}/#/board`, { waitUntil: 'load' });
    await settle(page, 4000);
    const words = page.locator('#promo-bar .pb-text');
    if (await words.count()) {
      await words.click();
      await settle(page, 1800);
      const y0 = await page.evaluate(() => ({ y: scrollY, open: !!document.querySelector('.ofr-root'), overflow: getComputedStyle(document.documentElement).overflowY }));
      report('popup: the bar opens it, and the page behind is not locked', y0.open && y0.overflow !== 'hidden', JSON.stringify(y0));
      await page.mouse.move(20, 300);
      await page.mouse.wheel(0, 700);
      await settle(page, 1000);
      const y1 = await page.evaluate(() => ({ y: scrollY, open: !!document.querySelector('.ofr-root'), bar: !!document.getElementById('promo-bar') }));
      report('popup: a scroll takes it down, the page moves and the bar stays', !y1.open && y1.y > y0.y + 100 && y1.bar, JSON.stringify(y1));
    }
    await ctx.close();
  },

  /**
   * The week's note (an international break, the close season, a
   * tournament). It sits over a darkened page but never locks it: a swipe or
   * a wheel anywhere outside it folds it into its chip and the page moves
   * under the same gesture. Checked with a real touch screen at phone sizes.
   */
  async season() {
    // Wants the notes, so the shared setup's opt-out is undone. Cleared fully
    // on the first load only: the reload at the end checks what was remembered.
    const notes = async (page) => page.addInitScript(() => {
      try {
        if (!sessionStorage.getItem('nav.season')) { localStorage.removeItem('ow.season'); sessionStorage.setItem('nav.season', '1'); }
        else localStorage.setItem('ow.season', sessionStorage.getItem('nav.season.kept') ?? '[]');
        addEventListener('pagehide', () => sessionStorage.setItem('nav.season.kept', localStorage.getItem('ow.season') ?? '[]'));
      } catch {}
    });
    const state = (page) => page.evaluate(() => {
      const card = document.querySelector('#season-note .sn-card');
      const r = card?.getBoundingClientRect();
      return {
        note: !!document.getElementById('season-note'), chip: !!document.getElementById('season-chip'),
        y: Math.round(scrollY), overflow: getComputedStyle(document.documentElement).overflowY,
        locked: [...document.documentElement.classList].filter((c) => /lock|open/.test(c)),
        card: r ? { top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height), scroll: card.scrollHeight - card.clientHeight } : null,
        vh: innerHeight,
      };
    });

    const { ctx, page, errors } = await fresh(390, { height: 844, touch: true });
    await notes(page);
    await page.goto(`${BASE}/#/home`, { waitUntil: 'load' });
    const opened = await page.waitForSelector('#season-note', { timeout: 8000 }).then(() => true, () => false);
    if (!opened) { report('season: no break, close season or tournament on now, nothing to check', true); await ctx.close(); return; }
    await settle(page, 2600);
    const up = await state(page);
    const focus = await page.evaluate(() => !!document.activeElement?.closest('#season-note'));
    report('season: opens with the focus, and the page behind is not locked', focus && up.overflow !== 'hidden' && !up.locked.length, JSON.stringify(up));
    report('season: the whole card is on screen at 390x844', up.card && up.card.top >= 0 && up.card.bottom <= up.vh, JSON.stringify(up.card));

    // A swipe on the darkened page: the note folds away and the page scrolls.
    await swipe(page, 195, 120, 500);
    await settle(page, 900);
    const swiped = await state(page);
    report('season: a swipe outside the card folds it into the chip and scrolls the page', !swiped.note && swiped.chip && swiped.y > up.y + 100, `y ${up.y} to ${swiped.y}, note ${swiped.note}, chip ${swiped.chip}`);

    // The chip brings it back; a swipe that starts on the card does the same
    // when the card has nothing of its own to scroll.
    await page.tap('#season-chip .sn-chip-open');
    await settle(page, 1600);
    const again = await state(page);
    report('season: the chip opens it again, wherever the page is', again.note && !again.chip, JSON.stringify({ y: again.y, note: again.note }));
    if (again.card && again.card.scroll <= 1) {
      await swipe(page, 195, Math.round((again.card.top + again.card.bottom) / 2), 400);
      await settle(page, 900);
      const fromCard = await state(page);
      report('season: a swipe on a card that fits folds it too, and the page moves', !fromCard.note && fromCard.chip && fromCard.y > again.y + 80, `y ${again.y} to ${fromCard.y}`);
    }

    // A wheel (a laptop) does the same.
    const desk = await fresh(1280, { height: 800 });
    await notes(desk.page);
    await desk.page.goto(`${BASE}/#/home`, { waitUntil: 'load' });
    if (await desk.page.waitForSelector('#season-note', { timeout: 8000 }).then(() => true, () => false)) {
      await settle(desk.page, 2600);
      const d0 = await state(desk.page);
      await desk.page.mouse.move(80, 400);
      await desk.page.mouse.wheel(0, 600);
      await settle(desk.page, 900);
      const d1 = await state(desk.page);
      report('season: a mouse wheel over the page folds it and scrolls', !d1.note && d1.chip && d1.y > d0.y + 100, `y ${d0.y} to ${d1.y}, note ${d1.note}`);
      // Escape and the scrim, from the chip.
      await desk.page.click('#season-chip .sn-chip-open');
      await settle(desk.page, 1500);
      await desk.page.keyboard.press('Escape');
      await settle(desk.page, 900);
      const esc = await state(desk.page);
      report('season: Escape folds it into the chip', !esc.note && esc.chip, JSON.stringify(esc));
      await desk.page.click('#season-chip .sn-chip-open');
      await settle(desk.page, 1500);
      await desk.page.mouse.click(30, 30);
      await settle(desk.page, 900);
      report('season: a click on the darkened page folds it', !(await state(desk.page)).note);
      // Tab stays in the card.
      await desk.page.click('#season-chip .sn-chip-open');
      await settle(desk.page, 1500);
      let out = null;
      for (let i = 0; i < 8; i++) {
        await desk.page.keyboard.press('Tab');
        if (!(await desk.page.evaluate(() => !!document.activeElement?.closest('#season-note')))) { out = await desk.page.evaluate(() => document.activeElement?.outerHTML.slice(0, 60)); break; }
      }
      report('season: Tab stays inside the open note', !out, out ?? '');
      await desk.page.keyboard.press('Escape');
      report('season: no errors on the desktop page', !desk.errors.length, desk.errors.join(' | '));
    }
    await desk.ctx.close();

    // Opening under a moving thumb gets it swiped away unread, so it waits.
    const busy = await fresh(390, { height: 844, touch: true });
    await busy.page.addInitScript(() => { try { localStorage.removeItem('ow.season'); } catch {} });
    await busy.page.goto(`${BASE}/#/home`, { waitUntil: 'load' });
    await busy.page.waitForTimeout(600);
    let seenWhileMoving = false;
    const until = Date.now() + 4000;
    while (Date.now() < until) {
      await swipe(busy.page, 195, 600, 120).catch(() => {});
      if (await busy.page.evaluate(() => !!document.getElementById('season-note'))) { seenWhileMoving = true; break; }
    }
    const thenOpens = await busy.page.waitForSelector('#season-note', { timeout: 6000 }).then(() => true, () => false);
    report('season: it does not open mid-scroll, and opens once the page is still', !seenWhileMoving && thenOpens, `opened mid-scroll ${seenWhileMoving}, then ${thenOpens}`);
    await busy.ctx.close();

    // Seen once, it stays a chip on the next visit.
    await page.reload({ waitUntil: 'load' });
    await settle(page, 4000);
    const after = await state(page);
    report('season: seen once, it stays a chip on the next visit', !after.note && after.chip, JSON.stringify({ note: after.note, chip: after.chip }));
    report('season: no errors on the phone page', !errors.length, errors.join(' | '));
    await ctx.close();
  },

  /** The note at every phone size: the card fits or scrolls itself, the chip clears the offer bar. */
  async seasonsizes() {
    for (const [w, h] of [[320, 568], [360, 640], [375, 667], [390, 844], [414, 896], [768, 1024], [1440, 900]]) {
      const { ctx, page, errors } = await fresh(w, { height: h, touch: w < 700 });
      await page.addInitScript(() => { try { localStorage.removeItem('ow.season'); localStorage.removeItem('ow.promo'); } catch {} });
      await page.goto(`${BASE}/#/home`, { waitUntil: 'load' });
      if (!(await page.waitForSelector('#season-note', { timeout: 8000 }).then(() => true, () => false))) { report(`seasonsizes ${w}x${h}: no note on now`, true); await ctx.close(); continue; }
      await settle(page, 2800);
      const m = await page.evaluate(() => {
        const card = document.querySelector('.sn-card');
        const r = card.getBoundingClientRect();
        // The sweep overhangs on purpose, clipped by .sn-glow.
        const over = [...card.querySelectorAll(':scope > :not(.sn-glow), :scope > :not(.sn-glow) *')].filter((el) => {
          const b = el.getBoundingClientRect();
          return b.width && (b.right > r.right + 1 || b.left < r.left - 1);
        }).map((el) => el.className || el.tagName).slice(0, 3);
        const lead = getComputedStyle(card.querySelector('.sn-lead'));
        return {
          top: Math.round(r.top), bottom: Math.round(r.bottom), vh: innerHeight, vw: innerWidth,
          inner: card.scrollHeight - card.clientHeight, over, hscroll: document.documentElement.scrollWidth > innerWidth,
          lead: parseFloat(lead.fontSize), text: parseFloat(getComputedStyle(card.querySelector('.sn-text p')).fontSize),
          buttons: [...card.querySelectorAll('.sn-actions .btn')].map((b) => Math.round(b.getBoundingClientRect().height)),
        };
      });
      await page.screenshot({ path: `${process.env.SHOTS ?? '/tmp'}/season-${w}x${h}.png` });
      report(`seasonsizes ${w}x${h}: card on screen, nothing spills sideways`, m.top >= 0 && m.bottom <= m.vh && !m.over.length && !m.hscroll, JSON.stringify(m));
      report(`seasonsizes ${w}x${h}: readable (lead >= 18px, text >= 16px, buttons >= 44px)`, m.lead >= 18 && m.text >= 16 && m.buttons.every((b) => b >= 44), JSON.stringify({ lead: m.lead, text: m.text, buttons: m.buttons, inner: m.inner }));
      if (m.inner > 1 && w < 700) {
        // Too tall for this phone: the card scrolls itself and the note stays.
        await swipe(page, Math.round(w / 2), Math.round((m.top + m.bottom) / 2), Math.min(m.inner, 150));
        await settle(page, 600);
        const s = await page.evaluate(() => ({ note: !!document.getElementById('season-note'), inner: document.querySelector('.sn-card')?.scrollTop ?? 0, y: scrollY }));
        report(`seasonsizes ${w}x${h}: a tall card scrolls itself first, the note stays`, s.note && s.inner > 0 && s.y === 0, JSON.stringify(s));
      }
      // Folded: the chip sits clear of the offer bar and inside the screen.
      await page.keyboard.press('Escape');
      await settle(page, 1200);
      const c = await page.evaluate(() => {
        const chip = document.getElementById('season-chip')?.getBoundingClientRect();
        const bar = document.getElementById('promo-bar')?.getBoundingClientRect();
        const hit = (a, b) => a && b && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
        return { chip: chip && { top: Math.round(chip.top), bottom: Math.round(chip.bottom), right: Math.round(chip.right) }, bar: bar && { top: Math.round(bar.top) }, overlap: !!hit(chip, bar), vh: innerHeight, vw: innerWidth };
      });
      report(`seasonsizes ${w}x${h}: the chip is on screen and clear of the offer bar`, c.chip && !c.overlap && c.chip.bottom <= c.vh && c.chip.right <= c.vw, JSON.stringify(c));
      report(`seasonsizes ${w}x${h}: no errors`, !errors.length, errors.join(' | '));
      await ctx.close();
    }
  },

  /** The offer popup at phone sizes: no empty scroll in the card, a swipe outside takes it down and moves the page. */
  async popupsizes() {
    if (!promoIds.length) { report('popupsizes: no offer is running, nothing to check', true); return; }
    for (const [w, h] of [[320, 568], [375, 667], [390, 844], [1440, 900]]) {
      const { ctx, page, errors } = await fresh(w, { height: h, touch: w < 700 });
      // The bar wanted, the popup not opening by itself.
      await page.addInitScript((ids) => { try { localStorage.setItem('ow.promo', JSON.stringify({ seen: ids, closed: [] })); } catch {} }, promoIds);
      await page.goto(`${BASE}/#/board`, { waitUntil: 'load' });
      await settle(page, 4000);
      if (!(await page.locator('#promo-bar .pb-text').count())) { report(`popupsizes ${w}x${h}: no bar`, true); await ctx.close(); continue; }
      await page.locator('#promo-bar .pb-text').click();
      await settle(page, 2200);
      const m = await page.evaluate(() => {
        const card = document.querySelector('.ofr-card');
        const r = card.getBoundingClientRect();
        const inner = card.querySelector('.ofr-inner').getBoundingClientRect();
        return { top: Math.round(r.top), bottom: Math.round(r.bottom), vh: innerHeight, scroll: card.scrollHeight - card.clientHeight, content: Math.round(inner.height - r.height), overflow: getComputedStyle(document.documentElement).overflowY };
      });
      await page.screenshot({ path: `${process.env.SHOTS ?? '/tmp'}/popup-${w}x${h}.png` });
      // Whatever the card scrolls by is its own content, never decoration hanging off it.
      report(`popupsizes ${w}x${h}: on screen, page not locked, no empty scroll`, m.top >= 0 && m.bottom <= m.vh && m.overflow !== 'hidden' && m.scroll <= Math.max(0, m.content) + 2, JSON.stringify(m));
      const y0 = await page.evaluate(() => scrollY);
      if (w < 700) await swipe(page, Math.round(w / 2), Math.max(20, Math.round(m.top / 2)) || 20, 400);
      else { await page.mouse.move(40, 450); await page.mouse.wheel(0, 600); }
      await settle(page, 1000);
      const after = await page.evaluate(() => ({ open: !!document.querySelector('.ofr-root'), y: scrollY }));
      report(`popupsizes ${w}x${h}: a scroll outside takes it down and moves the page`, !after.open && after.y > y0 + 80, JSON.stringify({ y0, ...after }));
      report(`popupsizes ${w}x${h}: no errors`, !errors.length, errors.join(' | '));
      await ctx.close();
    }
  },

  /**
   * Every scrolling panel on the site scrolls only as far as its own content.
   * A decoration hanging off a card (a light beam, a sweep) counts as content
   * to the browser, and the card then scrolls into nothing and keeps the
   * swipe that should have gone to the page. Twice now.
   */
  async phantom() {
    const scan = (page) => page.evaluate(() => {
      const out = [];
      for (const el of document.querySelectorAll('body *')) {
        const cs = getComputedStyle(el);
        if (!/(auto|scroll)/.test(cs.overflowY) || el.scrollHeight <= el.clientHeight + 1 || !el.offsetParent && cs.position !== 'fixed') continue;
        const top = el.getBoundingClientRect().top - el.scrollTop;
        let bottom = 0;
        for (const d of el.querySelectorAll('*')) {
          if (d.closest('[aria-hidden="true"]') || getComputedStyle(d).position === 'absolute' && !d.textContent.trim()) continue;
          const b = d.getBoundingClientRect();
          if (b.height) bottom = Math.max(bottom, b.bottom - top);
        }
        const pad = parseFloat(cs.paddingBottom) || 0;
        const empty = Math.round(el.scrollHeight - bottom - pad);
        if (empty > 24) out.push(`${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]} ${empty}px`);
      }
      return out;
    });
    const { ctx, page } = await fresh(390, { height: 700, touch: true });
    const found = [];
    for (const r of ['#/home', '#/board', '#/results', '#/leagues', '#/pricing', `#/fixture/${FX[0]}`, '#/slip', '#/search']) {
      await page.goto(`${BASE}/${r}`, { waitUntil: 'load' });
      await settle(page, 2500);
      for (const x of await scan(page)) found.push(`${r} ${x}`);
    }
    // And the panels that only exist when opened.
    await page.goto(`${BASE}/#/board`, { waitUntil: 'load' });
    await settle(page, 3000);
    await page.tap('#burger');
    await settle(page, 600);
    for (const x of await scan(page)) found.push(`menu ${x}`);
    await page.tap('#burger');
    await settle(page, 400);
    const dd = page.locator('.dd-btn').first();
    if (await dd.count()) {
      await dd.tap().catch(() => {});
      await settle(page, 600);
      for (const x of await scan(page)) found.push(`dropdown ${x}`);
    }
    report('phantom: no panel scrolls into empty space', !found.length, found.join(' | '));
    await ctx.close();
  },

  /** A tap anywhere on the offer bar opens the whole offer; its cross only closes the bar. */
  async offerbar() {
    if (!promoIds.length) { report('offerbar: no offer is running, nothing to check', true); return; }
    for (const target of ['.pb-text', '.pb-clock', '.pb-cta']) {
      const { ctx, page } = await fresh(390, { touch: true });
      await page.addInitScript((ids) => { try { localStorage.setItem('ow.promo', JSON.stringify({ seen: ids, closed: [] })); } catch {} }, promoIds);
      await page.goto(`${BASE}/#/board`, { waitUntil: 'load' });
      await settle(page, 4000);
      const el = page.locator(`#promo-bar ${target}`).first();
      if (!(await el.count())) { report(`offerbar: no ${target} on the bar`, true); await ctx.close(); continue; }
      await el.tap();
      await settle(page, 1500);
      const r = await page.evaluate(() => ({ popup: !!document.querySelector('.ofr-root'), hash: location.hash }));
      report(`offerbar: tapping the bar's ${target.slice(4)} opens the offer, not checkout`, r.popup && r.hash === '#/board', JSON.stringify(r));
      await ctx.close();
    }
    const { ctx, page } = await fresh(390, { touch: true });
    await page.addInitScript((ids) => { try { localStorage.setItem('ow.promo', JSON.stringify({ seen: ids, closed: [] })); } catch {} }, promoIds);
    await page.goto(`${BASE}/#/board`, { waitUntil: 'load' });
    await settle(page, 4000);
    await page.locator('#promo-bar .pb-x').tap();
    await settle(page, 1000);
    const x = await page.evaluate(() => ({ popup: !!document.querySelector('.ofr-root'), bar: !!document.getElementById('promo-bar') }));
    report('offerbar: its cross closes the bar and opens nothing', !x.popup && !x.bar, JSON.stringify(x));
    await ctx.close();
  },

  /**
   * A big fixture on the board opens its card by itself, once; the week's
   * note and the offer wait their turn (attention.js). The board is faked
   * with El Clásico tomorrow so this runs on any day.
   */
  async moments() {
    const { ctx, page, errors } = await fresh(390, { height: 844, touch: true });
    await page.addInitScript((ids) => {
      try {
        if (!sessionStorage.getItem('nav.mo')) { localStorage.removeItem('ow.moments'); localStorage.removeItem('ow.season'); localStorage.removeItem('ow.attention'); localStorage.setItem('ow.promo', JSON.stringify({ seen: [], closed: [] })); sessionStorage.setItem('nav.mo', '1'); }
      } catch {}
    }, promoIds);
    await page.route('**/api/board?hours=72', async (route) => {
      const res = await route.fetch();
      const body = await res.json();
      const now = Math.floor(Date.now() / 1000);
      body.fixtures = [{ id: 990001, home: 'Real Madrid', away: 'FC Barcelona', home_id: 57, away_id: 44, league: 'La Liga', league_id: 3, kickoff: now + 20 * 3600, status: 'notstarted', locked: true, colors: { home: '#febe10', away: '#a50044' } }, ...(body.fixtures ?? [])];
      await route.fulfill({ response: res, json: body });
    });
    await page.goto(`${BASE}/#/home`, { waitUntil: 'load' });
    const opened = await page.waitForSelector('#moment', { timeout: 9000 }).then(() => true, () => false);
    await settle(page, 2600);
    const m = await page.evaluate(() => {
      const c = document.querySelector('.mo-card')?.getBoundingClientRect();
      return { title: document.getElementById('mo-title')?.getAttribute('aria-label'), top: c && Math.round(c.top), bottom: c && Math.round(c.bottom), vh: innerHeight,
        note: !!document.getElementById('season-note'), offer: !!document.querySelector('.ofr-root'), overflow: getComputedStyle(document.documentElement).overflowY,
        focus: !!document.activeElement?.closest('#moment') };
    });
    report('moments: El Clásico tomorrow opens its card by itself, alone, focused, page not locked', opened && m.title === 'El Clásico' && !m.note && !m.offer && m.overflow !== 'hidden' && m.focus, JSON.stringify(m));
    report('moments: the card is on screen at 390x844', m.top >= 0 && m.bottom <= m.vh, JSON.stringify(m));
    await page.screenshot({ path: `${process.env.SHOTS ?? '/tmp'}/moment-derby-auto.png` });
    const y0 = await page.evaluate(() => scrollY);
    await swipe(page, 195, 100, 450);
    await settle(page, 900);
    const away = await page.evaluate(() => ({ moment: !!document.getElementById('moment'), y: scrollY }));
    report('moments: a swipe takes it away and moves the page', !away.moment && away.y > y0 + 100, JSON.stringify(away));
    // The rest of the visit: the offer would normally open after a scroll a
    // third of the way down. It does not: one card a visit.
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight * 0.5));
    await settle(page, 9000);
    const rest = await page.evaluate(() => ({ offer: !!document.querySelector('.ofr-root'), note: !!document.getElementById('season-note') }));
    report('moments: nothing else opens by itself on the same visit', !rest.offer && !rest.note, JSON.stringify(rest));
    await page.reload({ waitUntil: 'load' });
    await settle(page, 5000);
    report('moments: seen once, it does not open again', !(await page.evaluate(() => !!document.getElementById('moment'))));
    report('moments: no errors', !errors.length, errors.join(' | '));
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
