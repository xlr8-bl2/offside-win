/**
 * The site's dropdown, in place of the browser's own.
 *
 * A native <select> is drawn by the platform: a grey wheel on an iPhone, a
 * white Windows list on a laptop, a Material sheet on Android, none of them
 * anything to do with this site and all of them in the wrong colours. This
 * draws one of our own over the top of it and leaves the <select> where it
 * was, hidden, as the thing holding the value: whatever a page already reads
 * from it or listens to on it (`value`, `change`) carries on unchanged.
 *
 * On a wide screen it opens as a list under the button. On a phone it rises
 * from the bottom of the screen, where a thumb already is, with room for a
 * finger on every row. A list longer than ten gets a box to type into.
 *
 * Markup hints, all optional, on the <select>:
 *   data-icon   clock | cup | shirt   a small glyph in the button
 *   data-title  the heading on the phone's sheet (else its aria-label)
 * and on an <option>:
 *   data-meta   quiet text at the row's right edge (a count, say)
 */

const ICONS = {
  clock: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>',
  cup: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7.5 4.5h9v4a4.5 4.5 0 0 1-9 0z"/><path d="M7.5 6H5a2.5 2.5 0 0 0 2.6 3.6M16.5 6H19a2.5 2.5 0 0 1-2.6 3.6M12 13v3.5M8.5 19.5h7M9.5 19.5c0-1.7 1.1-3 2.5-3s2.5 1.3 2.5 3"/></svg>',
  shirt: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4.5 4.5 7l1.8 3.6L8 9.8v9.7h8V9.8l1.7.8L19.5 7 15 4.5a3 3 0 0 1-6 0z"/></svg>',
};
const CHEVRON = '<svg class="dd-chev" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 4.5 6 8l3.5-3.5"/></svg>';
const TICK = '<svg class="dd-tick" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5 6.5 11.5 12.5 4.5"/></svg>';
const SEARCH_AT = 10;

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const asSheet = () => matchMedia('(max-width: 620px)').matches;
let seq = 0;
let openOne = null;

function close({ focus = false } = {}) {
  const o = openOne;
  if (!o) return;
  openOne = null;
  o.button.setAttribute('aria-expanded', 'false');
  o.panel.remove();
  o.scrim?.remove();
  removeEventListener('resize', o.place);
  removeEventListener('scroll', o.place, true);
  document.documentElement.classList.remove('dd-locked');
  if (focus) o.button.focus({ preventScroll: true });
}

function open(select, button) {
  if (openOne?.select === select) { close({ focus: true }); return; }
  close();
  const id = `dd${++seq}`;
  const sheet = asSheet();
  const opts = [...select.options].filter((o) => !o.hidden);
  const title = select.dataset.title || select.getAttribute('aria-label') || '';
  const searchable = opts.length > SEARCH_AT;

  const panel = document.createElement('div');
  panel.className = `dd-panel${sheet ? ' is-sheet' : ''}`;
  panel.innerHTML = `
    ${sheet ? `<div class="dd-grip" aria-hidden="true"></div><div class="dd-head"><b>${esc(title)}</b>
      <button type="button" class="dd-x" aria-label="Close"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg></button></div>` : ''}
    ${searchable ? `<div class="dd-find"><input type="search" autocomplete="off" spellcheck="false"
      placeholder="Type to find" aria-label="Find in ${esc(title.toLowerCase())}" aria-controls="${id}"></div>` : ''}
    <ul class="dd-list" id="${id}" role="listbox" tabindex="-1" aria-label="${esc(title)}">
      ${opts.map((o, i) => `<li class="dd-opt${o.dataset.dim !== undefined ? ' is-dim' : ''}" role="option" id="${id}-${i}" data-i="${i}" aria-selected="${o.selected}">
        ${TICK}<span class="dd-text">${esc(o.textContent.trim())}</span>${o.dataset.meta ? `<small>${esc(o.dataset.meta)}</small>` : ''}</li>`).join('')}
    </ul>
    <p class="dd-none" hidden>Nothing matches that.</p>`;

  let scrim = null;
  if (sheet) {
    scrim = document.createElement('div');
    scrim.className = 'dd-scrim';
    document.body.append(scrim);
    document.documentElement.classList.add('dd-locked');
  }
  document.body.append(panel);

  const list = panel.querySelector('.dd-list');
  const find = panel.querySelector('.dd-find input');
  const items = [...list.children];
  let active = Math.max(0, opts.findIndex((o) => o.selected));

  const visible = () => items.filter((li) => !li.hidden);
  const setActive = (li, scroll = true) => {
    for (const x of items) x.classList.toggle('is-active', x === li);
    if (!li) { list.removeAttribute('aria-activedescendant'); find?.removeAttribute('aria-activedescendant'); return; }
    active = Number(li.dataset.i);
    list.setAttribute('aria-activedescendant', li.id);
    find?.setAttribute('aria-activedescendant', li.id);
    if (scroll) li.scrollIntoView({ block: 'nearest' });
  };
  const choose = (li) => {
    const o = opts[Number(li.dataset.i)];
    const changed = select.value !== o.value;
    select.value = o.value;
    sync(select, button);
    close({ focus: !sheet });
    if (changed) select.dispatchEvent(new Event('change', { bubbles: true }));
  };

  // Where it goes: under the button, or above it when the page runs out.
  const place = () => {
    if (sheet) return;
    const r = button.getBoundingClientRect();
    const w = Math.max(r.width, Math.min(320, innerWidth - 32));
    // Lined up with the button's left edge, or its right one when a wider
    // list would run off that side of the screen.
    const left = r.left + w > innerWidth - 16 ? Math.max(16, r.right - w) : Math.max(16, r.left);
    panel.style.width = `${w}px`;
    panel.style.left = `${left}px`;
    const below = innerHeight - r.bottom - 16;
    const up = below < 240 && r.top > below;
    panel.style.maxHeight = `${Math.max(180, Math.min(400, (up ? r.top : below) - 8))}px`;
    panel.style.top = up ? '' : `${r.bottom + 6}px`;
    panel.style.bottom = up ? `${innerHeight - r.top + 6}px` : '';
    panel.classList.toggle('is-up', up);
  };
  place();
  addEventListener('resize', place);
  addEventListener('scroll', place, true);

  openOne = { select, button, panel, scrim, place };
  button.setAttribute('aria-expanded', 'true');
  button.setAttribute('aria-controls', id);
  setActive(items[active]);
  // A keyboard on a phone would cover the list it is meant to narrow, so the
  // box waits for a tap there; on a laptop typing goes straight into it.
  if (sheet) { panel.tabIndex = -1; panel.focus({ preventScroll: true }); }
  else (find ?? list).focus({ preventScroll: true });

  list.addEventListener('click', (e) => { const li = e.target.closest('.dd-opt'); if (li) choose(li); });
  list.addEventListener('pointermove', (e) => { const li = e.target.closest('.dd-opt'); if (li && !li.classList.contains('is-active')) setActive(li, false); });
  panel.querySelector('.dd-x')?.addEventListener('click', () => close({ focus: !sheet }));
  if (sheet) dragToClose(panel, list, scrim);
  scrim?.addEventListener('click', () => close());

  find?.addEventListener('input', () => {
    const q = find.value.trim().toLowerCase();
    for (const li of items) li.hidden = !!q && !li.textContent.toLowerCase().includes(q);
    const shown = visible();
    panel.querySelector('.dd-none').hidden = shown.length > 0;
    setActive(shown[0] ?? null);
  });

  let typed = '';
  let typedAt = 0;
  panel.addEventListener('keydown', (e) => {
    const shown = visible();
    const at = shown.findIndex((li) => li.classList.contains('is-active'));
    const go = (i) => { if (shown.length) setActive(shown[(i + shown.length) % shown.length]); };
    if (e.key === 'ArrowDown') { e.preventDefault(); go(at + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); go(at - 1); }
    else if (e.key === 'Home' && e.target !== find) { e.preventDefault(); go(0); }
    else if (e.key === 'End' && e.target !== find) { e.preventDefault(); go(shown.length - 1); }
    else if (e.key === 'Enter' || (e.key === ' ' && e.target !== find)) {
      e.preventDefault();
      if (shown[at]) choose(shown[at]);
    } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close({ focus: true }); }
    else if (e.key === 'Tab') close();
    else if (!find && e.key.length === 1 && !e.metaKey && !e.ctrlKey) {
      // Typing a letter on a short list jumps to the first row it starts.
      const now = Date.now();
      typed = now - typedAt > 700 ? e.key.toLowerCase() : typed + e.key.toLowerCase();
      typedAt = now;
      const hit = shown.find((li) => li.textContent.trim().toLowerCase().startsWith(typed));
      if (hit) setActive(hit);
    }
  });
}

/**
 * A sheet goes the way it came: pulled down by its handle or its heading, or
 * by the list once the list is at its top, it follows the finger, and let go
 * a third of the way down (or flicked) it closes. Short of that it settles
 * back. The same gesture every phone's own sheets answer to.
 */
function dragToClose(panel, list, scrim) {
  let from = null;
  let dy = 0;
  let lastY = 0;
  let lastT = 0;
  let speed = 0;
  const begin = (y) => {
    from = y; dy = 0; speed = 0; lastY = y; lastT = performance.now();
    panel.style.transition = 'none';
    scrim.style.transition = 'none';
  };
  const move = (y) => {
    if (from === null) return;
    dy = Math.max(0, y - from);
    const t = performance.now();
    speed = (y - lastY) / Math.max(1, t - lastT);
    lastY = y; lastT = t;
    panel.style.transform = `translateY(${dy}px)`;
    scrim.style.opacity = String(Math.max(0, 1 - dy / panel.offsetHeight));
  };
  const end = () => {
    if (from === null) return;
    from = null;
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    panel.style.transition = reduce ? 'none' : 'transform 200ms cubic-bezier(0.2, 0.8, 0.2, 1)';
    scrim.style.transition = reduce ? 'none' : 'opacity 200ms linear';
    if (dy > panel.offsetHeight * 0.3 || (dy > 24 && speed > 0.5)) {
      panel.style.transform = 'translateY(100%)';
      scrim.style.opacity = '0';
      setTimeout(() => { if (openOne?.panel === panel) close(); }, reduce ? 0 : 190);
    } else {
      panel.style.transform = '';
      scrim.style.opacity = '';
    }
  };

  // The handle and the heading: a pointer, any kind.
  for (const el of panel.querySelectorAll('.dd-grip, .dd-head')) {
    el.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.dd-x') || (e.pointerType === 'mouse' && e.button !== 0)) return;
      el.setPointerCapture(e.pointerId);
      begin(e.clientY);
    });
    el.addEventListener('pointermove', (e) => move(e.clientY));
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }

  // The list: only a pull downwards from its very top, so scrolling it still
  // scrolls it.
  let touchY = null;
  list.addEventListener('touchstart', (e) => { touchY = list.scrollTop <= 0 ? e.touches[0].clientY : null; }, { passive: true });
  list.addEventListener('touchmove', (e) => {
    if (touchY === null) return;
    const y = e.touches[0].clientY;
    if (from === null) {
      if (y - touchY < 6) { if (y < touchY) touchY = null; return; }
      begin(touchY);
    }
    e.preventDefault();
    move(y);
  }, { passive: false });
  list.addEventListener('touchend', () => { touchY = null; end(); });
  list.addEventListener('touchcancel', () => { touchY = null; end(); });
}

/** The button's face: the chosen option's words. */
function sync(select, button) {
  const o = select.options[select.selectedIndex];
  const text = o ? o.textContent.trim() : '';
  button.querySelector('.dd-value').textContent = text;
  const label = select.getAttribute('aria-label');
  button.setAttribute('aria-label', label ? `${label}: ${text}` : text);
}

/** Draw one <select> as the site's dropdown. Safe to call twice. */
export function enhanceSelect(select) {
  if (select.dataset.dd || select.dataset.native !== undefined || select.multiple) return;
  select.dataset.dd = '1';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'dd-btn';
  button.setAttribute('aria-haspopup', 'listbox');
  button.setAttribute('aria-expanded', 'false');
  button.innerHTML = `${ICONS[select.dataset.icon] ?? ''}<span class="dd-value"></span>${CHEVRON}`;
  if (select.disabled) button.disabled = true;
  select.classList.add('dd-native');
  select.tabIndex = -1;
  select.setAttribute('aria-hidden', 'true');
  select.after(button);
  sync(select, button);
  button.addEventListener('click', () => open(select, button));
  button.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); open(select, button); }
  });
  // A page that sets the value itself (a reset, a saved choice, options
  // rebuilt) is followed: 'change' when it says so, 'sync' when it only
  // redrew the options.
  select.addEventListener('change', () => sync(select, button));
  select.addEventListener('sync', () => sync(select, button));
  // A <label for> pointing at the hidden select opens this instead.
  if (select.id) for (const l of document.querySelectorAll(`label[for="${CSS.escape(select.id)}"]`)) {
    l.addEventListener('click', (e) => { e.preventDefault(); button.focus(); });
  }
}

/** Every <select> under `root`, except any marked data-native. */
export function enhanceSelects(root = document) {
  for (const s of root.querySelectorAll('select')) enhanceSelect(s);
}

// Anything else on the page, a new page, or Escape from outside closes it.
document.addEventListener('pointerdown', (e) => {
  if (openOne && !openOne.panel.contains(e.target) && !openOne.button.contains(e.target) && e.target !== openOne.scrim) close();
}, true);
addEventListener('hashchange', () => close());
