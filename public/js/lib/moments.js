/**
 * The big moments, said when they arrive.
 *
 * Three of them, read off the board every time it loads, with nothing to
 * switch on:
 *
 *   - a named fixture within a day: El Clásico, the Manchester derby, the Old
 *     Firm (the list is engine/src/occasion.ts, copied to occasion.js). Two
 *     sets of colours slam together and the crests meet at the seam.
 *   - a big league back after ten days or more without a game: the Premier
 *     League after an international break, or on the first weekend of a
 *     season. The centre circle the break note counted down inside gets its
 *     ball back, and the fixtures come up on a vidiprinter.
 *   - a Champions League night: a ring of stars, and the night's games on the
 *     vidiprinter.
 *
 * One at a time, in that order, each shown once, and only when the site's
 * shared rules on interruptions (attention.js) say this visit has room. It
 * never locks the page: a scroll takes it away (scrollaway.js).
 */

import { namedFixture } from './occasion.js';
import { scrollAway, moving } from './scrollaway.js';

/** Club competitions whose return is news, in the order they are said. */
export const RETURNING = new Map([
  [1, 'the Premier League'],
  [3, 'La Liga'],
  [5, 'the Bundesliga'],
  [4, 'Serie A'],
  [6, 'Ligue 1'],
]);
export const UCL = 7;

const HOUR = 3600;
const DAY = 86400;
const OVER = new Set(['finished', 'ended', 'aet', 'ap', 'postponed', 'canceled', 'cancelled', 'abandoned', 'unresolved']);
const upcoming = (f, now) => f && f.kickoff > now && !OVER.has(String(f.status ?? '').toLowerCase());
const dayKey = (epoch) => { const d = new Date(epoch * 1000); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };
const sameDay = (a, b) => dayKey(a) === dayKey(b);
const hexOk = (c) => (typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c) ? c : null);
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const NUM = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve'];
const count = (n, one, many) => `${NUM[n] ?? n} ${n === 1 ? one : many}`;

/**
 * The moment on now, if there is one. `lastPlayed(leagueId)` answers when that
 * competition last had a game, as an epoch; it is only asked about a league
 * that is on the board in the next two days, so an ordinary day costs nothing.
 */
export async function findMoment({ fixtures = [], now = Date.now() / 1000, lastPlayed = async () => null } = {}) {
  const ahead = fixtures.filter((f) => upcoming(f, now)).sort((a, b) => a.kickoff - b.kickoff);

  // A named fixture within the day. The biggest, if two fall together.
  const named = ahead
    .filter((f) => f.kickoff - now <= 30 * HOUR)
    .map((f) => ({ f, n: namedFixture(f.home, f.away) }))
    .filter((x) => x.n)
    .sort((a, b) => b.n.weight - a.n.weight)[0];
  if (named) {
    const { f, n } = named;
    return {
      kind: 'derby',
      key: `n:${f.id}`,
      kicker: n.kicker,
      fixture: {
        id: f.id, home: f.home, away: f.away, home_id: f.home_id, away_id: f.away_id, kickoff: f.kickoff, league: f.league, league_id: f.league_id ?? null,
        colors: { home: hexOk(f.colors?.home), away: hexOk(f.colors?.away) },
        call: f.top_pick ? 'open' : f.locked ? 'members' : 'none',
      },
    };
  }

  // A big league back: on the board within two days, with ten clear days or
  // more since its last game.
  for (const [id, name] of RETURNING) {
    const games = ahead.filter((f) => Number(f.league_id) === id);
    if (!games.length || games[0].kickoff - now > 48 * HOUR) continue;
    const last = await lastPlayed(id).catch(() => null);
    if (!last || games[0].kickoff - last < 10 * DAY) continue;
    return {
      kind: 'return',
      key: `r:${id}:${dayKey(games[0].kickoff)}`,
      leagueId: id,
      league: games[0].league,
      name,
      gap: Math.floor((games[0].kickoff - last) / DAY),
      count: games.length,
      games: games.slice(0, 5).map(slim),
    };
  }

  // A Champions League night: two games or more still to come today.
  const tonight = ahead.filter((f) => Number(f.league_id) === UCL && sameDay(f.kickoff, now));
  if (tonight.length >= 2) {
    return { kind: 'ucl', key: `c:${dayKey(now)}`, leagueId: UCL, league: tonight[0].league, count: tonight.length, games: tonight.slice(0, 6).map(slim) };
  }
  return null;
}
const slim = (f) => ({ id: f.id, home: f.home, away: f.away, kickoff: f.kickoff });

/** What the card says, separate from how it moves, so it can be tested. */
export function wordsFor(m) {
  if (m.kind === 'derby') {
    const f = m.fixture;
    return {
      title: m.kicker,
      teams: [f.home, f.away],
      line: f.call === 'open' ? 'Our call is up, and the reasons with it.'
        : f.call === 'members' ? 'Our call is up, for members. The preview is free.'
        : 'Our call goes up once the team news is in. The preview is up now.',
      cta: { label: 'Read the preview', href: `#/fixture/${encodeURIComponent(f.id)}` },
    };
  }
  if (m.kind === 'return') {
    return {
      title: `${cap(m.name)} is back.`,
      lead: `${count(m.count, 'game', 'games')} in the next three days, after ${m.gap} days without one.`,
      cta: { label: 'See the calls', href: `#/league/${m.leagueId}` },
    };
  }
  return {
    title: 'Champions League night.',
    lead: `${count(m.count, 'game', 'games')} tonight.`,
    cta: { label: 'See tonight’s games', href: `#/league/${m.leagueId}` },
  };
}

/* ------------------------------------------------------------- memory */

const KEY = 'ow.moments';
function seenList() { try { const v = JSON.parse(localStorage.getItem(KEY) ?? '[]'); return Array.isArray(v) ? v : []; } catch { return []; } }
/** Shown already. '*' turns them off altogether (the ui-verify checks set it). */
export const seen = (key) => { const s = seenList(); return s.includes(key) || s.includes('*'); };
function remember(key) { try { localStorage.setItem(KEY, JSON.stringify([...new Set([...seenList(), key])].slice(-40))); } catch { /* shown again */ } }

/** Whether now is a bad moment: the reader is moving the page. */
export const readerMoving = () => moving();

/* ------------------------------------------------------------- drawing */

const EXPO = 'cubic-bezier(0.16, 1, 0.3, 1)';
const QUART_IN = 'cubic-bezier(0.5, 0, 0.75, 0)';
const OVERSHOOT = 'cubic-bezier(0.34, 1.56, 0.64, 1)';
const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

const plainEsc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const plainCrest = (name, size) => `<span class="crest crest-${size} noimg" aria-hidden="true"><i>${plainEsc(String(name).split(/\s+/).map((w) => w[0]).join('').slice(0, 3))}</i></span>`;
const hhmm = (epoch, clock) => (clock ? clock(new Date(epoch * 1000)) : new Date(epoch * 1000).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }));
function shortWhen(epoch, now, clock) {
  const t = hhmm(epoch, clock);
  if (sameDay(epoch, now)) return t;
  if (sameDay(epoch, now + DAY)) return `Tomorrow ${t}`;
  return `${new Date(epoch * 1000).toLocaleDateString('en-GB', { weekday: 'short' })} ${t}`;
}

/*
 * The competition's own logo, on a white disc (the provider's logos are dark
 * marks on nothing, and the card is dark). For a league coming back it drops
 * onto the centre spot of the pitch the break note counted down inside; on a
 * Champions League night it spins in on its own.
 */
const PITCH = `<svg class="mo-pitch" viewBox="0 0 120 120" aria-hidden="true">
  <path class="mo-line" d="M0 60H120"/><circle class="mo-line" cx="60" cy="60" r="40"/></svg>`;
function emblem(m, crest) {
  const logo = `<span class="mo-logo">${crest(m.league ?? '', 'xl', m.leagueId, 'league')}</span>`;
  return `<div class="mo-emblem" data-kind="${m.kind}" aria-hidden="true">${m.kind === 'return' ? PITCH : ''}<span class="mo-ripple"></span>${logo}</div>`;
}

function cardHTML(m, { crest = plainCrest, esc = plainEsc, clock, now }) {
  const w = wordsFor(m);
  const actions = `<div class="mo-actions">
      <a class="btn btn-primary" href="${w.cta.href}" data-mo-go>${esc(w.cta.label)}</a>
      <button class="btn btn-ghost" type="button" data-mo-close>Not now</button>
    </div>`;
  const x = `<button class="mo-x" type="button" data-mo-close aria-label="Close"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>`;
  if (m.kind === 'derby') {
    const f = m.fixture;
    const colours = `--home-c:${f.colors.home ?? '#5b4ad6'};--away-c:${f.colors.away ?? '#c9334a'}`;
    const letters = [...w.title].map((ch, i) => (ch === ' ' ? ' ' : `<span style="--i:${i}">${esc(ch)}</span>`)).join('');
    return `
      <div class="mo-scrim" data-mo-close></div>
      <div class="mo-card" role="dialog" aria-modal="true" aria-labelledby="mo-title" tabindex="-1" data-kind="derby" style="${colours}">
        <div class="mo-stage" aria-hidden="true">
          <div class="mo-half mo-home"></div>
          <div class="mo-half mo-away"></div>
          <div class="mo-flare"></div>
          <div class="mo-seam"></div>
          <div class="mo-shock"></div>
          <div class="mo-side mo-side-home">${crest(f.home, 'xl', f.home_id)}</div>
          <div class="mo-side mo-side-away">${crest(f.away, 'xl', f.away_id)}</div>
        </div>
        ${x}
        <div class="mo-body">
          <h2 class="mo-kicker" id="mo-title" aria-label="${esc(w.title)}"><span aria-hidden="true">${letters}</span></h2>
          <p class="mo-teams"><b>${esc(f.home)}</b><em>v</em><b>${esc(f.away)}</b></p>
          <p class="mo-when">${f.league ? `<span class="mo-comp">${f.league_id ? `<span class="mo-logo mo-logo-sm">${crest(f.league, 'sm', f.league_id, 'league')}</span>` : ''}${esc(f.league)}</span>` : ''}<span>${esc(shortWhen(f.kickoff, now, clock))}</span><span class="mo-clock" data-to="${f.kickoff}" aria-hidden="true"></span></p>
          <p class="mo-line-text">${esc(w.line)}</p>
          ${actions}
        </div>
      </div>`;
  }
  const words = (t) => t.split(/\s+/).map((wd, i) => `<span class="mo-w"><span style="--i:${i}">${esc(wd)}</span></span>`).join(' ');
  return `
    <div class="mo-scrim" data-mo-close></div>
    <div class="mo-card" role="dialog" aria-modal="true" aria-labelledby="mo-title" tabindex="-1" data-kind="${esc(m.kind)}">
      <div class="mo-glow" aria-hidden="true"><div class="mo-sweep"></div></div>
      ${x}
      <div class="mo-head">${emblem(m, crest)}<h2 class="mo-title" id="mo-title">${words(w.title)}</h2></div>
      <p class="mo-lead">${esc(w.lead)}</p>
      <ol class="mo-vidi">${m.games.map((g) => {
        const text = `${g.home} v ${g.away}`;
        return `<li><a href="#/fixture/${encodeURIComponent(g.id)}" data-mo-go>
          <span class="visually-hidden">${esc(text)}, ${esc(shortWhen(g.kickoff, now, clock))}</span>
          <span class="mo-type" aria-hidden="true" data-text="${esc(text)}">${esc(text)}</span>
          <time aria-hidden="true">${esc(shortWhen(g.kickoff, now, clock))}</time></a></li>`;
      }).join('')}</ol>
      ${actions}
    </div>`;
}

let current = null;
function closeMoment({ quick = false } = {}) {
  const c = current;
  if (!c) return;
  current = null;
  c.stopAway();
  c.stopClock();
  removeEventListener('keydown', c.onKey, true);
  const { root } = c;
  const gone = () => root.remove();
  if (quick || reduced()) { gone(); return; }
  root.querySelector('.mo-card').animate([{ transform: 'none', opacity: 1 }, { transform: 'translateY(28px) scale(0.96)', opacity: 0 }], { duration: 320, easing: QUART_IN, fill: 'forwards' });
  root.querySelector('.mo-scrim').animate([{ opacity: 1 }, { opacity: 0 }], { duration: 360, delay: 60, easing: 'ease-in', fill: 'forwards' }).finished.then(gone, gone);
}
export const removeMoment = () => closeMoment({ quick: true });

/** A ticking clock to kick-off, under a day and a half away; nothing further out. */
function mountClock(el, now) {
  if (!el) return () => {};
  const to = Number(el.dataset.to);
  const tick = () => {
    const s = Math.max(0, Math.round(to - Date.now() / 1000));
    if (s > 36 * HOUR || !s) { el.textContent = ''; return; }
    const h = Math.floor(s / HOUR), mi = Math.floor((s % HOUR) / 60), se = s % 60;
    el.textContent = `Kick-off in ${h}:${String(mi).padStart(2, '0')}:${String(se).padStart(2, '0')}`;
  };
  tick();
  const t = setInterval(tick, 1000);
  return () => clearInterval(t);
}

/**
 * Open it. `preview` is the dashboard's: shown as a reader would see it,
 * remembered as nothing.
 */
export function openMoment(m, helpers = {}, { preview = false } = {}) {
  if (!m) return;
  closeMoment({ quick: true });
  const now = helpers.now ?? Date.now() / 1000;
  const root = document.createElement('div');
  root.id = 'moment';
  root.className = 'mo-root';
  root.innerHTML = cardHTML(m, { ...helpers, now });
  document.body.append(root);
  if (!preview) remember(m.key);
  const card = root.querySelector('.mo-card');
  const before = document.activeElement;

  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); closeMoment(); return; }
    if (e.key !== 'Tab') return;
    const f = [...root.querySelectorAll('a[href], button')];
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  addEventListener('keydown', onKey, true);
  root.addEventListener('click', (e) => {
    const t = e.target.closest?.('[data-mo-close], [data-mo-go]');
    if (!t) return;
    if (t.hasAttribute('data-mo-go') && preview) { e.preventDefault(); }
    closeMoment({ quick: t.hasAttribute('data-mo-go') && !preview });
    if (t.hasAttribute('data-mo-close') && before?.isConnected) before.focus?.({ preventScroll: true });
  });
  current = { root, onKey, stopAway: scrollAway(card, () => closeMoment()), stopClock: mountClock(root.querySelector('.mo-clock'), now) };
  card.focus({ preventScroll: true });
  if (!reduced()) animate(root, m);
}

/* --------------------------------------------------------------- motion */

function animate(root, m) {
  const go = (el, frames, opts) => el?.animate(frames, { fill: 'both', ...opts });
  const all = (sel) => [...root.querySelectorAll(sel)];
  const card = root.querySelector('.mo-card');
  go(root.querySelector('.mo-scrim'), [{ opacity: 0, backdropFilter: 'blur(0px)' }, { opacity: 1, backdropFilter: 'blur(8px)' }], { duration: 520, easing: EXPO });

  if (m.kind === 'derby') {
    // The card arrives empty and dark; the two sides come in from either
    // edge and hit at the seam.
    go(card, [{ transform: 'translateY(40px) scale(0.96)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 600, easing: EXPO });
    const HIT = 760;
    go(root.querySelector('.mo-home'), [{ transform: 'translateX(-105%)' }, { transform: 'none' }], { duration: 640, delay: HIT - 640, easing: 'cubic-bezier(0.7, 0, 0.84, 0)' });
    go(root.querySelector('.mo-away'), [{ transform: 'translateX(105%)' }, { transform: 'none' }], { duration: 640, delay: HIT - 640, easing: 'cubic-bezier(0.7, 0, 0.84, 0)' });
    go(root.querySelector('.mo-side-home'), [{ transform: 'translateX(-220%) scale(1.5)', filter: 'blur(10px)', opacity: 0 }, { opacity: 1, offset: 0.4 }, { transform: 'none', filter: 'blur(0)', opacity: 1 }], { duration: 760, delay: HIT - 300, easing: OVERSHOOT });
    go(root.querySelector('.mo-side-away'), [{ transform: 'translateX(220%) scale(1.5)', filter: 'blur(10px)', opacity: 0 }, { opacity: 1, offset: 0.4 }, { transform: 'none', filter: 'blur(0)', opacity: 1 }], { duration: 760, delay: HIT - 300, easing: OVERSHOOT });
    // The hit: the seam flares white, a shock ring goes out, the card jolts.
    go(root.querySelector('.mo-seam'), [{ opacity: 0, transform: 'scaleY(0)' }, { opacity: 1, transform: 'scaleY(1)', offset: 0.15 }, { opacity: 0.6, transform: 'scaleY(1)' }], { duration: 900, delay: HIT, easing: 'ease-out' });
    go(root.querySelector('.mo-flare'), [{ opacity: 0 }, { opacity: 1, offset: 0.12 }, { opacity: 0 }], { duration: 1200, delay: HIT, easing: 'ease-out' });
    go(root.querySelector('.mo-shock'), [{ transform: 'translate(-50%, -50%) scale(0.1)', opacity: 0.9 }, { transform: 'translate(-50%, -50%) scale(3.2)', opacity: 0 }], { duration: 900, delay: HIT, easing: EXPO });
    card.animate([{ translate: '0 0' }, { translate: '-6px 2px' }, { translate: '5px -2px' }, { translate: '-3px 1px' }, { translate: '1px 0' }, { translate: '0 0' }], { duration: 420, delay: HIT, easing: 'ease-out' });
    // The name, a letter at a time, like boards going up round a ground.
    all('.mo-kicker span[style]').forEach((s, i) => go(s, [{ transform: 'translateY(70%) rotateX(80deg)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 640, delay: HIT + 140 + i * 32, easing: EXPO }));
    const after = HIT + 220 + all('.mo-kicker span[style]').length * 32;
    [['.mo-teams', 0], ['.mo-when', 120], ['.mo-line-text', 220], ['.mo-actions', 320]].forEach(([sel, d]) =>
      go(root.querySelector(sel), [{ opacity: 0, transform: 'translateY(12px)' }, { opacity: 1, transform: 'none' }], { duration: 700, delay: after + d, easing: EXPO }));
    return;
  }

  // The competition cards open out of a slit, like the offer.
  go(card, [{ transform: 'translateY(48px) scale(0.95)', clipPath: 'inset(46% 6% 46% 6% round 20px)', opacity: 0 }, { opacity: 1, offset: 0.25 }, { transform: 'none', clipPath: 'inset(0% 0% 0% 0% round 20px)', opacity: 1 }], { duration: 900, delay: 80, easing: EXPO });
  go(root.querySelector('.mo-sweep'), [{ transform: 'translateX(-120%) skewX(-18deg)', opacity: 0 }, { opacity: 1, offset: 0.2 }, { transform: 'translateX(240%) skewX(-18deg)', opacity: 0 }], { duration: 1400, delay: 500, easing: 'cubic-bezier(0.65, 0, 0.35, 1)' });

  const logo = root.querySelector('.mo-logo');
  const ripple = root.querySelector('.mo-ripple');
  if (m.kind === 'return') {
    // The pitch draws itself, then the league's logo drops onto the centre
    // spot like a ball, squashes, settles, and the game is back on.
    all('.mo-pitch .mo-line').forEach((l, i) => {
      const len = l.getTotalLength?.() ?? 250;
      l.style.strokeDasharray = String(len);
      go(l, [{ strokeDashoffset: len }, { strokeDashoffset: 0 }], { duration: 900, delay: 260 + i * 140, easing: EXPO });
    });
    go(logo, [
      { transform: 'translateY(-90px) scale(0.7) rotate(-25deg)', opacity: 0 }, { opacity: 1, offset: 0.2 },
      { transform: 'translateY(0) scale(1.12, 0.86) rotate(0)', offset: 0.55 }, { transform: 'translateY(-12px) scale(0.96, 1.04)', offset: 0.75 },
      { transform: 'none', opacity: 1 }], { duration: 950, delay: 820, easing: 'ease-in-out' });
    go(ripple, [{ transform: 'scale(0.6)', opacity: 0.9 }, { transform: 'scale(2.4)', opacity: 0 }], { duration: 1000, delay: 1330, easing: EXPO, iterations: 2 });
  } else {
    // The starball spins in out of the dark and lands with a pulse of light.
    go(logo, [
      { transform: 'rotate(-220deg) scale(0.2)', opacity: 0, filter: 'blur(6px)' },
      { opacity: 1, offset: 0.35 },
      { transform: 'rotate(12deg) scale(1.1)', filter: 'blur(0)', offset: 0.75 },
      { transform: 'none', opacity: 1, filter: 'blur(0)' }], { duration: 1200, delay: 260, easing: EXPO });
    go(ripple, [{ transform: 'scale(0.8)', opacity: 0.9 }, { transform: 'scale(2.4)', opacity: 0 }], { duration: 1000, delay: 1050, easing: EXPO, iterations: 2 });
  }
  const ws = all('.mo-w > span');
  ws.forEach((w, i) => go(w, [{ transform: 'translateY(105%) rotate(4deg)' }, { transform: 'none' }], { duration: 900, delay: 420 + i * 60, easing: EXPO }));
  const tail = 520 + ws.length * 60;
  go(root.querySelector('.mo-lead'), [{ opacity: 0, transform: 'translateY(12px)' }, { opacity: 1, transform: 'none' }], { duration: 700, delay: tail, easing: EXPO });
  vidiprinter(root, tail + 200);
  go(root.querySelector('.mo-actions'), [{ opacity: 0, transform: 'translateY(12px)' }, { opacity: 1, transform: 'none' }], { duration: 700, delay: tail + 400, easing: EXPO });
}

/*
 * The vidiprinter: the fixtures typed out a character at a time with a block
 * cursor, the way results used to come in on a Saturday teatime. The words
 * are on the page from the start (and in a hidden copy for screen readers);
 * only what is drawn is typed.
 */
function vidiprinter(root, delay) {
  const lines = [...root.querySelectorAll('.mo-type')];
  const PER = 16;
  let start = delay;
  for (const el of lines) {
    const text = el.dataset.text ?? '';
    const li = el.closest('li');
    const time = li.querySelector('time');
    el.textContent = '';
    li.style.opacity = '0';
    if (time) time.style.opacity = '0';
    const begin = start;
    setTimeout(() => {
      if (!el.isConnected) return;
      li.style.opacity = '1';
      el.classList.add('is-typing');
      const t0 = performance.now();
      const step = (t) => {
        if (!el.isConnected) return;
        const n = Math.min(text.length, Math.floor((t - t0) / PER));
        el.textContent = text.slice(0, n);
        if (n < text.length) { requestAnimationFrame(step); return; }
        el.classList.remove('is-typing');
        if (!time) return;
        time.style.opacity = '';
        time.animate([{ opacity: 0, transform: 'translateX(-6px)' }, { opacity: 1, transform: 'none' }], { duration: 360, easing: EXPO });
      };
      requestAnimationFrame(step);
    }, begin);
    start += Math.min(text.length * PER, 520) * 0.7;
  }
}
