/**
 * Offers: a deal, a free trial or a notice, set up in the dashboard
 * (#/admin/offers) and served by /api/promos.
 *
 * Three ways one reaches a reader:
 *
 *   the popup   a deal or a trial, once per offer per browser, a few seconds
 *               into a visit or a third of the way down a page. Never on the
 *               pages where someone is already buying, signing in or reading
 *               the small print, and never to a member, who cannot use it.
 *   the bar     a slim line under the header with the deadline counting down,
 *               on every page until it is closed. A notice is only this.
 *   the plans   the plans page and checkout show the deal price and the
 *               clock (app.js), and the offer id travels with the payment so
 *               the Worker can check it is real and still running.
 *
 * The motion, the one place the site spends it: floodlights. The scrim
 * darkens, a gantry of four lamps strikes one after another the way sodium
 * lamps do, stuttering before they hold, the beams fall across the card as it
 * rises out of the dark on a spring, the headline comes up through a mask a
 * word at a time, the old price is struck through, and the clock's digits
 * roll over on the same spring every second. Closing turns the lights off.
 * All of it collapses to a plain fade for a reader who has asked for less
 * motion.
 *
 * What it keeps on the device: which offers were shown or closed
 * (`ow.promo`), so the same one is not pushed twice. Strictly necessary, and
 * listed in the cookie notice.
 */

import { scrollAway, moving } from './scrollaway.js';
import { firstVisit, mayInterrupt, noteInterruption, settled } from './attention.js';

const KEY = 'ow.promo';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const money = (minor, cur = 'GBP') => new Intl.NumberFormat('en-GB', { style: 'currency', currency: cur, minimumFractionDigits: minor % 100 ? 2 : 0 }).format((Number(minor) || 0) / 100);
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const PER = { matchday: 'for seven days', monthly: 'a month', quarter: 'every three months', season: 'a year' };

/* ------------------------------------------------------------- the curves */

/**
 * A real spring, sampled into CSS's linear() easing: a mass on a spring with
 * this much stiffness and damping, from rest to rest. Overshoots a touch and
 * settles, which a cubic-bezier cannot do. Falls back to an expo-out where
 * linear() is not supported.
 */
function springEasing(stiffness = 170, damping = 20, mass = 1) {
  const w0 = Math.sqrt(stiffness / mass);
  const zeta = damping / (2 * Math.sqrt(stiffness * mass));
  const wd = w0 * Math.sqrt(Math.max(1e-6, 1 - zeta * zeta));
  const x = (t) => (zeta < 1
    ? 1 - Math.exp(-zeta * w0 * t) * (Math.cos(wd * t) + ((zeta * w0) / wd) * Math.sin(wd * t))
    : 1 - Math.exp(-w0 * t) * (1 + w0 * t));
  // Long enough to settle inside a hundredth.
  let end = 0.1;
  while (end < 4 && Math.abs(1 - x(end)) + Math.abs(1 - x(end + 0.05)) > 0.002) end += 0.05;
  const n = 48;
  const pts = Array.from({ length: n + 1 }, (_, i) => +x((i / n) * end).toFixed(4));
  pts[n] = 1;
  return { easing: `linear(${pts.join(', ')})`, duration: Math.round(end * 1000) };
}
const LINEAR_OK = typeof CSS !== 'undefined' && CSS.supports?.('animation-timing-function', 'linear(0, 1)');
const EXPO = 'cubic-bezier(0.16, 1, 0.3, 1)';
const QUART_IN = 'cubic-bezier(0.5, 0, 0.75, 0)';
const spring = (k, d) => (LINEAR_OK ? springEasing(k, d) : { easing: EXPO, duration: 900 });
const RISE = spring(140, 16);
const ROLL = spring(260, 24);

/* --------------------------------------------------------------- the data */

let cache = null;
export async function livePromos() {
  if (cache) return cache;
  try {
    const res = await fetch('/api/promos');
    cache = res.ok ? await res.json() : [];
  } catch { cache = []; }
  return Array.isArray(cache) ? cache : [];
}

function memory() {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '{}') ?? {}; } catch { return {}; }
}
function remember(field, id) {
  const m = memory();
  m[field] = [...new Set([...(m[field] ?? []), id])].slice(-40);
  try { localStorage.setItem(KEY, JSON.stringify(m)); } catch { /* private mode: shown again next visit */ }
}

/**
 * The one second showing an offer gets: in its last day, to a reader who
 * scrolled past it the first time rather than closing it, has not closed the
 * bar either, and has not had a second showing already. Anyone who said no
 * is not asked again.
 */
export function lastCallDue(p, mem, now = Date.now() / 1000) {
  const has = (field) => (mem[field] ?? []).includes(p.id);
  return Boolean(p.ends_at) && p.ends_at - now > 0 && p.ends_at - now < 86400
    && has('seen') && has('soft') && !has('dismissed') && !has('closed') && !has('lastcall');
}

/**
 * Whether a reader could use an offer at all. A member cannot use a deal or a
 * trial, and a free trial is for new members only: checkout refuses it to an
 * account that has had a membership before (`returning`), so it is never
 * dangled in front of one.
 */
export function usable(p, { member, returning }) {
  if (p.kind === 'notice') return true;
  if (member) return false;
  if (p.kind === 'trial' && returning) return false;
  return true;
}

/** Who an offer is shown to: those who could use it, narrowed by its audience. */
export function eligible(p, { signedIn, member, returning = false }) {
  if (!usable(p, { member, returning })) return false;
  if (p.audience === 'signed_out' && signedIn) return false;
  if (p.audience === 'free' && member) return false;
  return true;
}

/**
 * The offer checkout applies. The one the reader clicked (`promoId`, carried
 * through sign-in) when it is still running on this plan and they can use it:
 * its audience decided who was shown it, and a reader who was shown it
 * signed out has signed in to take it. Otherwise whatever this reader would
 * be shown on the plan.
 */
export async function offerForPlan(planId, who, promoId = null) {
  const all = await livePromos();
  const picked = promoId ? all.find((p) => p.id === promoId && p.plan_id === planId && p.kind !== 'notice') : null;
  if (picked && usable(picked, who)) return picked;
  return all.find((p) => p.plan_id === planId && p.kind !== 'notice' && eligible(p, who)) ?? null;
}

/** What the offer means in money, said once, the same everywhere. */
export function terms(p) {
  const plan = p.plan;
  if (!plan) return '';
  const per = PER[plan.id] ?? '';
  if (p.kind === 'deal') {
    return plan.id === 'matchday'
      ? `${money(p.price_minor, plan.currency)} for the seven days, one payment.`
      : `${money(p.price_minor, plan.currency)} ${per} for as long as you keep it, instead of ${money(plan.amount_minor, plan.currency)}. Cancel any time.`;
  }
  if (p.kind === 'trial') {
    return `${p.trial_days} days free, then ${money(plan.amount_minor, plan.currency)} ${per} unless you cancel. A card is needed to start, and nothing is taken until the free days are up.`;
  }
  return '';
}

export const checkoutHref = (p) => `#/checkout?plan=${encodeURIComponent(p.plan_id)}&promo=${encodeURIComponent(p.id)}`;

/* -------------------------------------------------------- the price spots */

/*
 * Every place the site quotes its price outside the plans page carries
 * data-sell: the "From £3.49" under a locked call, the line beside the
 * landing page's button, the promo stub, the landing plans. While a deal or a
 * free trial is running that this reader may have, those spots say so and
 * lead to it, so a visitor is never told "from £3.49" on the same screen as a
 * free week. Each spot keeps what it said, and goes back to it when the offer
 * is gone or the reader turns out to be a member.
 *
 *   data-sell="go"        a link or button: its words, and where it leads
 *   data-sell="alt"       the quiet "or see membership" line
 *   data-sell="head"      a heading that names the price
 *   data-sell="line"      a sentence that names the price
 *   data-sell="stub"      the promo stub: from, price, per, button
 *   data-sell-plan="id"   a landing plan card: price, note, button
 */

/** The offer the price spots should show this reader: a trial first, then the cheapest deal. */
export function bestOffer(list, who) {
  const mine = (list ?? []).filter((p) => p.kind !== 'notice' && p.plan && eligible(p, who));
  return mine.find((p) => p.kind === 'trial')
    ?? mine.filter((p) => p.kind === 'deal').sort((a, b) => a.price_minor - b.price_minor)[0]
    ?? null;
}

function sellWords(p) {
  const plan = p.plan;
  const full = money(plan.amount_minor, plan.currency);
  const per = PER[plan.id] ?? '';
  if (p.kind === 'trial') {
    const free = `${p.trial_days} days free`;
    return {
      go: `Start ${free}`, alt: `or start ${free}`, head: `Every call, ${free}`,
      line: `One call a day is free. Try every call free for ${p.trial_days} days, then ${full} ${per}.`,
      stub: ['Free for', `${p.trial_days} days`, `then ${full} ${per}`, `Start ${free}`],
      card: [`${p.trial_days} days free`, `then ${full} ${per}`, `Start ${free}`],
    };
  }
  const now = money(p.price_minor, plan.currency);
  return {
    go: `${plan.name} for ${now}`, alt: `or get ${plan.name} for ${now}`, head: null,
    line: `One call a day is free. ${plan.name} is ${now} ${per} right now, instead of ${full}.`,
    stub: [plan.name, now, `${per}, instead of ${full}`, `Get ${plan.name} for ${now}`],
    card: [now, `${per}, instead of ${full}`, `Get ${plan.name} for ${now}`],
  };
}

/** What a spot said before it was dressed, kept on the element so it can be put back. */
function keep(el) {
  if (el.dataset.sellWas === undefined) {
    el.dataset.sellWas = el.innerHTML;
    if (el.hasAttribute('href')) el.dataset.sellHref = el.getAttribute('href');
  }
}

export function dressSellers(root, p) {
  if (!root) return;
  for (const el of root.querySelectorAll('[data-sell-was]')) {
    // Back to its own words: no offer now, or a different one.
    if (p && el.dataset.sellFor === p.id) continue;
    el.innerHTML = el.dataset.sellWas;
    if (el.dataset.sellHref) el.setAttribute('href', el.dataset.sellHref);
    delete el.dataset.sellWas; delete el.dataset.sellHref; delete el.dataset.sellFor;
  }
  if (!p) return;
  const w = sellWords(p);
  const to = checkoutHref(p);
  const set = (el, html, href) => {
    if (el.dataset.sellFor === p.id) return;
    keep(el);
    el.innerHTML = html;
    if (href && el.hasAttribute('href')) el.setAttribute('href', href);
    el.dataset.sellFor = p.id;
  };
  for (const el of root.querySelectorAll('[data-sell="go"]')) set(el, esc(w.go), to);
  for (const el of root.querySelectorAll('[data-sell="alt"]')) set(el, esc(w.alt), to);
  for (const el of root.querySelectorAll('[data-sell="line"]')) set(el, esc(w.line));
  if (w.head) for (const el of root.querySelectorAll('[data-sell="head"]')) set(el, esc(w.head));
  for (const el of root.querySelectorAll('[data-sell="stub"]')) {
    const [from, price, per, go] = w.stub;
    set(el, `<span class="promo-from">${esc(from)}</span><b class="promo-price">${esc(price)}</b><span class="promo-per">${esc(per)}</span><a class="btn btn-accent" href="${esc(to)}">${esc(go)}</a>`);
  }
  for (const el of root.querySelectorAll(`[data-sell-plan="${CSS.escape(p.plan_id)}"]`)) {
    const [price, note, go] = w.card;
    const name = el.querySelector('b')?.outerHTML ?? '';
    const blurb = el.querySelector('.ld-blurb')?.outerHTML ?? '';
    set(el, `${name}<span class="ld-price">${esc(price)}</span><span class="ld-week">${esc(note)}</span>${blurb}<a class="btn btn-primary" href="${esc(to)}">${esc(go)}</a>`);
  }
}

/* ---------------------------------------------------------------- styles */

/** Load promo.css once; resolves when it has applied (or failed), so nothing is drawn unstyled. */
let stylesReady = null;
export function ensureStyles() {
  if (stylesReady) return stylesReady;
  const existing = document.getElementById('promo-css');
  if (existing?.sheet) return (stylesReady = Promise.resolve());
  const l = existing ?? document.createElement('link');
  stylesReady = new Promise((ok) => { l.addEventListener('load', ok, { once: true }); l.addEventListener('error', ok, { once: true }); });
  if (!existing) {
    l.id = 'promo-css';
    l.rel = 'stylesheet';
    l.href = '/promo.css';
    document.head.append(l);
  }
  return stylesReady;
}

/* ----------------------------------------------------------- the clock */

const UNITS = [['days', 86400], ['hrs', 3600], ['min', 60], ['sec', 1]];
function parts(left) {
  let rest = Math.max(0, Math.floor(left));
  return UNITS.map(([label, size]) => {
    const n = Math.floor(rest / size);
    rest -= n * size;
    return [label, String(n).padStart(2, '0')];
  });
}

/**
 * A clock that counts down to `endsAt`, each digit its own slot so only the
 * ones that change move, rolling up on the spring. Days are dropped once
 * there are none left. Returns a function that stops it.
 */
export function mountClock(el, endsAt, { onEnd, compact = false } = {}) {
  el.classList.add('pc', ...(compact ? ['pc-compact'] : []));
  const draw = (initial) => {
    const left = endsAt - Date.now() / 1000;
    const units = parts(left).filter(([label, v], i) => i > 0 || v !== '00');
    if (initial || el.dataset.units !== String(units.length)) {
      el.dataset.units = String(units.length);
      el.innerHTML = units.map(([label, v]) => `
        <span class="pc-unit" data-u="${label}">
          <span class="pc-digits">${[...v].map((d) => `<span class="pc-slot"><span class="pc-d">${d}</span></span>`).join('')}</span>
          ${compact ? '' : `<small>${label}</small>`}
        </span>`).join(compact ? '<i class="pc-colon">:</i>' : '');
      return;
    }
    units.forEach(([label, v]) => {
      const slots = el.querySelectorAll(`[data-u="${label}"] .pc-slot`);
      [...v].forEach((d, i) => {
        const slot = slots[i];
        const cur = slot?.querySelector('.pc-d:last-child');
        if (!slot || !cur || cur.textContent === d) return;
        const next = document.createElement('span');
        next.className = 'pc-d';
        next.textContent = d;
        slot.append(next);
        if (reduced()) { cur.remove(); return; }
        cur.animate([{ transform: 'translateY(0)', opacity: 1 }, { transform: 'translateY(-100%)', opacity: 0 }],
          { duration: 360, easing: QUART_IN, fill: 'forwards' }).finished.then(() => cur.remove()).catch(() => cur.remove());
        next.animate([{ transform: 'translateY(100%)', opacity: 0 }, { transform: 'translateY(0)', opacity: 1 }],
          { duration: ROLL.duration, easing: ROLL.easing, fill: 'backwards' });
      });
    });
  };
  draw(true);
  const t = setInterval(() => {
    if (!el.isConnected) { clearInterval(t); return; }
    if (Date.now() / 1000 >= endsAt) { clearInterval(t); onEnd?.(); return; }
    draw(false);
  }, 1000);
  return () => clearInterval(t);
}

/* --------------------------------------------------------------- the popup */

function wordsOf(title) {
  return esc(title).split(/\s+/).map((w, i) => `<span class="ofr-w"><span style="--i:${i}">${w}</span></span>`).join(' ');
}

function popupHTML(p, { previewing }) {
  const plan = p.plan;
  const cur = plan?.currency ?? 'GBP';
  const price = p.kind === 'deal'
    ? `<p class="ofr-price"><s>${money(plan?.amount_minor, cur)}<i aria-hidden="true"></i></s><b>${money(p.price_minor, cur)}</b><span>${esc(PER[plan?.id] ?? '')}</span></p>`
    : p.kind === 'trial'
      ? `<p class="ofr-price"><b>${esc(p.trial_days)} days free</b><span>then ${money(plan?.amount_minor, cur)} ${esc(PER[plan?.id] ?? '')}</span></p>`
      : '';
  return `
    <div class="ofr-scrim" data-close></div>
    <div class="ofr" role="dialog" aria-modal="true" aria-labelledby="ofr-title" aria-describedby="ofr-body">
      <div class="ofr-card" tabindex="-1">
        <div class="ofr-gantry" aria-hidden="true">
          ${[0, 1, 2, 3].map((i) => `<span class="ofr-lamp" style="--n:${i}"></span>`).join('')}
        </div>
        <div class="ofr-beams" aria-hidden="true">
          ${[0, 1, 2, 3].map((i) => `<span class="ofr-beam" style="--n:${i}"></span>`).join('')}
        </div>
        <div class="ofr-haze" aria-hidden="true"></div>
        <button class="ofr-x" type="button" data-close aria-label="Close">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
        </button>
        <div class="ofr-inner">
          ${plan ? `<p class="ofr-plan">${esc(plan.name)}</p>` : ''}
          <h2 class="ofr-title" id="ofr-title">${wordsOf(p.title)}</h2>
          ${p.body ? `<p class="ofr-body" id="ofr-body">${esc(p.body)}</p>` : '<p class="ofr-body" id="ofr-body" hidden></p>'}
          ${price}
          <div class="ofr-clock-wrap">
            <p class="ofr-ends">Ends in</p>
            <div class="ofr-clock" aria-hidden="true"></div>
            <p class="visually-hidden">Ends ${esc(new Date(p.ends_at * 1000).toLocaleString('en-GB', { weekday: 'long', hour: '2-digit', minute: '2-digit' }))}</p>
          </div>
          <a class="btn btn-primary btn-lg ofr-cta" href="${previewing ? '#' : esc(checkoutHref(p))}" data-cta>${esc(p.cta || (p.kind === 'trial' ? 'Start the free days' : 'Get the deal'))}</a>
          <p class="ofr-terms">${esc(terms(p))}</p>
          <button class="ofr-later" type="button" data-close>Not now</button>
        </div>
      </div>
    </div>`;
}

let open = null;

/** The popup. `previewing` shows it from the dashboard, with the button going nowhere. */
export function showPopup(p, { previewing = false } = {}) {
  ensureStyles();
  if (open) open.close(true);
  const root = document.createElement('div');
  root.className = 'ofr-root';
  root.innerHTML = popupHTML(p, { previewing });
  document.body.append(root);
  const card = root.querySelector('.ofr-card');
  const scrim = root.querySelector('.ofr-scrim');
  const before = document.activeElement;
  const stopClock = mountClock(root.querySelector('.ofr-clock'), p.ends_at, { onEnd: () => close() });

  const still = reduced();
  const run = [];
  const go = (el, frames, opts) => { if (el) run.push(el.animate(frames, { fill: 'both', ...opts })); };

  if (still) {
    go(scrim, [{ opacity: 0 }, { opacity: 1 }], { duration: 200 });
    go(card, [{ opacity: 0 }, { opacity: 1 }], { duration: 200 });
  } else {
    // The dark falls first.
    go(scrim, [{ opacity: 0, backdropFilter: 'blur(0px)' }, { opacity: 1, backdropFilter: 'blur(6px)' }], { duration: 520, easing: EXPO });
    // The card rises out of it on the spring, opening from a slit.
    go(card, [
      { transform: 'translateY(56px) scale(0.94) rotateX(10deg)', clipPath: 'inset(46% 8% 46% 8% round 20px)', opacity: 0 },
      { opacity: 1, offset: 0.25 },
      { transform: 'translateY(0) scale(1) rotateX(0deg)', clipPath: 'inset(0% 0% 0% 0% round 20px)', opacity: 1 },
    ], { duration: RISE.duration, easing: RISE.easing, delay: 140 });
    // The lamps strike one after another, stuttering before they hold.
    root.querySelectorAll('.ofr-lamp').forEach((lamp, i) => {
      const beam = root.querySelectorAll('.ofr-beam')[i];
      const strike = [
        { opacity: 0 }, { opacity: 0.9, offset: 0.08 }, { opacity: 0.1, offset: 0.16 }, { opacity: 0.75, offset: 0.26 },
        { opacity: 0.3, offset: 0.34 }, { opacity: 1, offset: 0.5 }, { opacity: 1 },
      ];
      go(lamp, strike, { duration: 900, delay: 380 + i * 120, easing: 'linear' });
      go(beam, strike.map((f) => ({ ...f, opacity: f.opacity * 0.9 })), { duration: 900, delay: 400 + i * 120, easing: 'linear' });
    });
    // The haze drifts in behind the type once the lights are up.
    go(root.querySelector('.ofr-haze'), [{ opacity: 0, transform: 'scale(1.2)' }, { opacity: 1, transform: 'scale(1)' }], { duration: 1600, delay: 700, easing: EXPO });
    // The headline, a word at a time, up through its mask.
    root.querySelectorAll('.ofr-w > span').forEach((w, i) => {
      go(w, [{ transform: 'translateY(105%) rotate(4deg)' }, { transform: 'translateY(0) rotate(0deg)' }], { duration: 900, delay: 560 + i * 55, easing: EXPO });
    });
    const tail = 620 + root.querySelectorAll('.ofr-w').length * 55;
    for (const [sel, extra] of [['.ofr-plan', -80], ['.ofr-body', 60], ['.ofr-price', 140], ['.ofr-clock-wrap', 220], ['.ofr-cta', 300], ['.ofr-terms', 360], ['.ofr-later', 380]]) {
      go(root.querySelector(sel), [{ opacity: 0, transform: 'translateY(14px)', filter: 'blur(4px)' }, { opacity: 1, transform: 'translateY(0)', filter: 'blur(0)' }],
        { duration: 800, delay: tail + extra, easing: EXPO });
    }
    // The old price struck through, left to right.
    go(root.querySelector('.ofr-price s i'), [{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], { duration: 520, delay: tail + 420, easing: 'cubic-bezier(0.65, 0, 0.35, 1)' });
    // The clock's tiles drop in, one after another.
    root.querySelectorAll('.ofr-clock .pc-unit').forEach((u, i) => {
      go(u, [{ opacity: 0, transform: 'translateY(-10px) rotateX(60deg)' }, { opacity: 1, transform: 'translateY(0) rotateX(0deg)' }],
        { duration: ROLL.duration, easing: ROLL.easing, delay: tail + 260 + i * 70 });
    });
  }

  /*
   * How it went is remembered, because it decides whether the offer may ask
   * once more on its last day: a reader who scrolled past it ("soft") might
   * not have read it; one who closed it ("hard") has answered. Leaving the
   * page or taking the deal is neither.
   */
  const close = (instant = false, how = 'nav') => {
    if (!root.isConnected) return;
    if (!previewing && how === 'soft') remember('soft', p.id);
    if (!previewing && how === 'hard') remember('dismissed', p.id);
    stopClock();
    stopAway();
    document.removeEventListener('keydown', onKey, true);
    open = null;
    const gone = () => { root.remove(); before?.focus?.({ preventScroll: true }); };
    if (instant || still) { gone(); return; }
    for (const a of run) a.cancel();
    // The lights go off first, then the card drops back into the dark.
    root.querySelectorAll('.ofr-lamp, .ofr-beam').forEach((el) => el.animate([{ opacity: 1 }, { opacity: 0.4, offset: 0.2 }, { opacity: 0 }], { duration: 220, fill: 'forwards' }));
    card.animate([{ transform: 'translateY(0) scale(1)', opacity: 1 }, { transform: 'translateY(24px) scale(0.97)', opacity: 0 }], { duration: 320, easing: QUART_IN, fill: 'forwards', delay: 80 });
    scrim.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 380, easing: 'ease-in', fill: 'forwards', delay: 120 }).finished.then(gone, gone);
  };
  open = { close };
  // The page behind is never locked: scrolling it takes the popup down and
  // the page moves under the same gesture. The bar still has the offer.
  const stopAway = scrollAway(card, () => close(false, 'soft'));

  // Focus stays inside while it is open; Escape and the scrim close it.
  const focusables = () => [...root.querySelectorAll('a[href], button')];
  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); close(false, 'hard'); return; }
    if (e.key !== 'Tab') return;
    const f = focusables();
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
  document.addEventListener('keydown', onKey, true);
  root.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) { close(false, 'hard'); return; }
    const cta = e.target.closest('[data-cta]');
    if (cta) {
      if (previewing) { e.preventDefault(); close(); return; }
      close(true);
    }
  });
  // Focus goes to the dialog itself, so a screen reader starts at its
  // headline and a keyboard is one Tab from the button, without a focus ring
  // drawn round the button before anyone has pressed a key.
  card.focus({ preventScroll: true });
  return { close };
}

/* ----------------------------------------------------------------- the bar */

function barHTML(p) {
  const plan = p.plan;
  const lead = p.kind === 'deal' && plan ? `${money(p.price_minor, plan.currency)} ${PER[plan.id] ?? ''}`
    : p.kind === 'trial' ? `${p.trial_days} days free` : '';
  return `
    <div class="pb-inner">
      <p class="pb-text"><b>${esc(p.title)}</b>${lead ? `<span class="pb-lead">${esc(lead)}</span>` : ''}${p.kind === 'notice' && p.body ? `<span class="pb-note">${esc(p.body)}</span>` : ''}</p>
      ${p.kind !== 'notice' ? `<span class="pb-clock" aria-label="Time left"></span><button class="pb-cta" type="button" aria-haspopup="dialog">${p.kind === 'trial' ? 'See the free days' : 'See the deal'}</button>` : ''}
      <button class="pb-x" type="button" aria-label="Close">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
      </button>
    </div>`;
}

/** The line across the top: the offer, its clock and its button, until closed. */
export function showBar(p, { anchor }) {
  ensureStyles();
  document.getElementById('promo-bar')?.remove();
  const bar = document.createElement('div');
  bar.id = 'promo-bar';
  bar.className = `pb pb-${p.kind}`;
  bar.setAttribute('role', 'region');
  bar.setAttribute('aria-label', p.kind === 'notice' ? 'Notice' : 'Offer');
  bar.innerHTML = barHTML(p);
  // Over the foot of the screen (promo.css): it is laid over the page, never
  // put into it, so nothing the reader is looking at moves when it arrives.
  const room = () => document.documentElement.style.setProperty('--pb-h', bar.isConnected ? `${Math.ceil(bar.getBoundingClientRect().height)}px` : '0px');
  const gone = () => { bar.remove(); room(); removeEventListener('resize', room); };
  // The clock is drawn before the bar goes on screen: anchored at the bottom,
  // anything that made it taller afterwards moved its top edge up, which
  // counts as the page shifting.
  const clock = bar.querySelector('.pb-clock');
  if (clock) mountClock(clock, p.ends_at, { compact: true, onEnd: gone });
  document.body.append(bar);
  // One thing at a time along the foot of the screen: with the offer bar up,
  // the week's chip stands down (season.js checks for the bar as well).
  document.getElementById('season-chip')?.remove();
  room();
  addEventListener('resize', room);
  if (!reduced()) {
    // Up from below, on a transform: moving it moves nothing else.
    bar.animate([{ transform: 'translateY(100%)' }, { transform: 'translateY(0)' }], { duration: 700, easing: EXPO, fill: 'both' });
    bar.querySelector('.pb-inner').animate([{ backgroundPosition: '-60% 0' }, { backgroundPosition: '160% 0' }], { duration: 1600, delay: 300, easing: 'cubic-bezier(0.65, 0, 0.35, 1)' });
  }
  // The bar is the offer folded away. A tap anywhere on it but the cross
  // opens the whole offer, the way it first appeared; checkout is one more
  // tap from there, on the popup's own button. The bar's button used to go
  // straight to checkout, which is not what a reader tapping a bar expects.
  if (p.kind !== 'notice') {
    bar.classList.add('pb-opens');
    bar.querySelector('.pb-inner').addEventListener('click', (e) => {
      if (e.target.closest('.pb-x')) return;
      showPopup(p);
    });
  }
  bar.querySelector('.pb-x').onclick = () => {
    remember('closed', p.id);
    if (reduced()) { gone(); return; }
    bar.animate([{ transform: 'translateY(0)' }, { transform: 'translateY(100%)' }], { duration: 360, easing: QUART_IN, fill: 'forwards' })
      .finished.then(gone, gone);
  };
  bar.remove = ((remove) => () => { remove.call(bar); document.documentElement.style.setProperty('--pb-h', '0px'); })(bar.remove);
  return bar;
}

/* ------------------------------------------------------------ the running */

/** Whether the reader is in the middle of something a popup would interrupt. */
function busy() {
  const menu = document.getElementById('acct-menu');
  return document.hidden
    || document.getElementById('nav')?.classList.contains('open')
    || (menu && !menu.hidden)
    || !!document.activeElement?.closest?.('input, textarea, select, [contenteditable]')
    || document.documentElement.classList.contains('dd-locked')
    || !!document.querySelector('[aria-haspopup][aria-expanded="true"]')
    || !!document.querySelector('[aria-modal="true"]');
}

// Moving page takes the popup down with the page it was opened on: Back from
// under it used to leave it standing over the next page.
if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', () => open?.close(true));
  window.addEventListener('popstate', () => open?.close(true));
}

const NO_POPUP = new Set(['pricing', 'checkout', 'signin', 'account', 'admin', 'legal', 'trace', 'dev']);
const NO_BAR = new Set(['checkout', 'admin']);
let armed = false;
let waiting = false;

/**
 * Called after every route. Puts up the bar for the running offer and, once a
 * visit, arms the popup for a deal or trial this reader has not been shown.
 */
export async function runPromos({ route, signedIn, member, returning = false, anchor, promos }) {
  if (Array.isArray(promos)) cache = promos;
  const all = await livePromos();
  const mem = memory();
  const mine = all.filter((p) => eligible(p, { signedIn, member, returning }));
  // Only a notice runs as a bar. A deal or a trial with a clock ticking down
  // along the foot of every page read as a pressure tactic (owner, October
  // 2026); those offers are still made, in the popup and at checkout.
  const bar = mine.find((p) => p.kind === 'notice' && !(mem.closed ?? []).includes(p.id));
  const shown = document.getElementById('promo-bar');
  // On a phone the cookie question is a sheet along the bottom edge, and the
  // bar would stack on it. It waits for the answer, then comes up as usual.
  const asking = !!document.getElementById('cookie-notice') && matchMedia('(max-width: 700px)').matches;
  if (asking && bar && !NO_BAR.has(route)) {
    if (!waiting) {
      waiting = true;
      addEventListener('ow:consent', () => { waiting = false; runPromos({ route, signedIn, member, returning, anchor }); }, { once: true });
    }
  } else if (NO_BAR.has(route) || !bar) shown?.remove();
  else if (!shown || shown.dataset.id !== bar.id) {
    // After the faces have loaded: a font arriving under a bar already on
    // screen changes its height, and a bar anchored at the bottom then moves.
    // And after its own stylesheet: unstyled, it sat in the page for a frame
    // before the stylesheet pinned it to the foot of the screen.
    await Promise.race([Promise.all([document.fonts?.ready, ensureStyles()]), new Promise((ok) => setTimeout(ok, 2500))]).catch(() => {});
    if (!document.getElementById('promo-bar')) showBar(bar, { anchor }).dataset.id = bar.id;
  }

  if (armed || NO_POPUP.has(route)) return;
  const pop = mine.find((p) => p.kind !== 'notice' && (!(mem.seen ?? []).includes(p.id) || lastCallDue(p, mem)));
  if (!pop) return;
  const lastCall = (mem.seen ?? []).includes(pop.id);
  armed = true;
  let fired = false;
  const fire = () => {
    if (fired) return;
    // Never over something the reader is in the middle of: an open menu, a
    // field being typed in (the popup took the focus out of the search box
    // mid-word), another dialog, or a tab they are not looking at. It waits
    // and tries again rather than giving up the visit's one showing.
    if (busy()) { setTimeout(fire, 4000); return; }
    // It used to open mid-scroll, a third of the way down, under a moving
    // thumb. It waits for the page to come to rest.
    if (moving()) { setTimeout(fire, 700); return; }
    fired = true;
    removeEventListener('scroll', onScroll);
    const here = (location.hash.slice(2).split(/[/?]/)[0]) || 'home';
    if (NO_POPUP.has(here) || document.querySelector('.ofr-root, #cookie-notice, #season-note, #moment')) { armed = false; return; }
    // Never over the landing page, never on a first visit (the bar carries
    // the offer), and not until the reader has settled in (attention.js).
    // Turned down here, it is not marked as seen and asks on a later page.
    if (document.querySelector('.ld-hero') || firstVisit()) { armed = false; return; }
    if (!settled({ ms: 30e3 })) { fired = false; setTimeout(fire, 4000); return; }
    // The site's shared rules on interruptions (attention.js): one card a
    // visit, two a day, and the offer only after twelve quiet hours. Turned
    // down, it is not marked as seen and asks again on a later visit.
    if (!mayInterrupt('offer')) return;
    noteInterruption('offer');
    remember(lastCall ? 'lastcall' : 'seen', pop.id);
    showPopup(pop);
  };
  const onScroll = () => {
    const depth = scrollY / Math.max(1, document.documentElement.scrollHeight - innerHeight);
    if (depth > 0.35) { removeEventListener('scroll', onScroll); fire(); }
  };
  addEventListener('scroll', onScroll, { passive: true });
  setTimeout(fire, 6000);
}

/** From the dashboard: the popup and the bar as a reader would see them. */
export function preview(p) {
  showPopup({ ...p, ends_at: p.ends_at || Math.floor(Date.now() / 1000) + 3 * 86400 }, { previewing: true });
}
