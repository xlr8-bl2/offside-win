/**
 * What kind of week it is, and a note saying so.
 *
 * Some weeks are thin and it is nobody's fault. An international break takes
 * the big leagues away for a fortnight and leaves qualifiers and friendlies,
 * where squads are rotated and form tells you next to nothing, so the board
 * carries fewer calls. The close season is the same, for longer. A reader who
 * arrives then and finds a dozen calls where there were sixty thinks the site
 * is broken, unless something tells them it is the calendar.
 *
 * Other weeks are the opposite. A World Cup or a Euros is nothing but national
 * teams, and there is more to say about those games than about anything else
 * all year. Same national-team football, the reverse message.
 *
 * So the board itself decides, every time it is read, with nothing to switch
 * on or off:
 *   - a tournament is being played: show it off, the next games and a link;
 *   - no big-five or Champions League games and national teams playing: an
 *     international break, and how many days until the club game is back;
 *   - no big-five games, no national teams, and the Premier League more than
 *     ten days away: the close season.
 * Anything else is an ordinary week and says nothing.
 *
 * A reader sees each one once: a break once per break, the close season once
 * per close season, a tournament once a day (its games change daily).
 */

/** Champions League and the big five: when none of them plays, the club game is off. */
export const TOP_CLUB = new Set([7, 1, 3, 4, 5, 6]);

// The finals of national-team tournaments, not their qualifiers. The Club
// World Cup counts: it is a tournament with as much to say about it.
const TOURNAMENT = /\b(world cup|european championship|euro 20\d\d|copa am[eé]rica|africa cup of nations|afcon|asian cup|gold cup)\b/i;
const QUALIFIER = /qualif/i;
const NATIONAL = /nations league|international|world cup|european championship|euro 20\d\d|copa am[eé]rica|africa cup|asian cup|gold cup|qualif/i;
const CLUB_FRIENDLY = (f) => f.league_id === 79 || /club friendl/i.test(f.league ?? '');
const OVER = new Set(['finished', 'ended', 'aet', 'ap', 'postponed', 'canceled', 'cancelled', 'abandoned', 'unresolved']);
const isCall = (f) => Boolean(f.top_pick || f.locked);

const DAY = 86400;
/** Midnight, local, of the day an epoch falls on. */
const dayStart = (epoch) => { const d = new Date(epoch * 1000); d.setHours(0, 0, 0, 0); return d.getTime() / 1000; };
const dayKey = (epoch) => { const d = new Date(epoch * 1000); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };
/** Whole calendar days from one epoch's day to another's. */
export const daysBetween = (from, to) => Math.round((dayStart(to) - dayStart(from)) / DAY);

/** The competitions in a list of games, busiest first. */
function busiest(games) {
  const n = new Map();
  for (const f of games) {
    const k = f.league ?? '';
    if (!k) continue;
    const e = n.get(k) ?? { name: k, id: f.league_id ?? null, n: 0 };
    e.n++;
    n.set(k, e);
  }
  return [...n.values()].sort((a, b) => b.n - a.n);
}

/**
 * Read the week from the board.
 *
 * `nextTop` is asked only when the big leagues are absent: when the Premier
 * League plays next, as an epoch, or null. It is a callback so an ordinary
 * week costs no extra request.
 */
export async function readSeason({ fixtures = [], now = Date.now() / 1000, nextTop = async () => null } = {}) {
  const ahead = fixtures.filter((f) => f && f.kickoff >= now - 2.5 * 3600 && !OVER.has(String(f.status ?? '').toLowerCase()));
  const real = ahead.filter((f) => !CLUB_FRIENDLY(f));
  const tournament = real.filter((f) => TOURNAMENT.test(f.league ?? '') && !QUALIFIER.test(f.league ?? ''));

  if (tournament.length) {
    const lead = busiest(tournament)[0];
    const games = tournament.filter((f) => f.league === lead.name).sort((a, b) => a.kickoff - b.kickoff);
    return {
      kind: 'tournament',
      key: `t:${lead.id ?? lead.name}:${dayKey(now)}`,
      name: lead.name,
      leagueId: lead.id,
      count: games.length,
      calls: games.filter(isCall).length,
      games: games.slice(0, 3).map((f) => ({
        id: f.id, home: f.home, away: f.away, home_id: f.home_id, away_id: f.away_id,
        kickoff: f.kickoff, call: isCall(f), live: f.kickoff <= now,
      })),
    };
  }

  if (real.some((f) => TOP_CLUB.has(Number(f.league_id)))) return null;

  const national = real.filter((f) => NATIONAL.test(f.league ?? ''));
  const club = real.filter((f) => !NATIONAL.test(f.league ?? ''));
  const back = await nextTop().catch(() => null);
  const days = back ? daysBetween(now, back) : null;
  const base = {
    calls: real.filter(isCall).length,
    still: busiest(club).slice(0, 3).map((c) => c.name),
    back,
    days,
  };

  if (national.length >= 4) {
    return { kind: 'break', key: `b:${back ? dayKey(back) : weekKey(now)}`, national: busiest(national).slice(0, 2).map((c) => c.name), ...base };
  }
  if (days !== null && days > 10) {
    return { kind: 'offseason', key: `o:${dayKey(back)}`, ...base };
  }
  return null;
}

function weekKey(epoch) {
  const d = new Date(epoch * 1000);
  const jan1 = new Date(d.getFullYear(), 0, 1);
  return `${d.getFullYear()}w${Math.ceil(((d - jan1) / 864e5 + jan1.getDay() + 1) / 7)}`;
}

/* ---------------------------------------------------------------- words */

/** "League One, League Two and the FA Cup". */
export function listOf(names) {
  const the = (n) => (/^(fa|efl|copa)\b|\b(cup|league|championship|trophy)$/i.test(n) && !/^the /i.test(n) ? `the ${n}` : n);
  const xs = names.map(the);
  if (xs.length <= 1) return xs.join('');
  return `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;
}

const plural = (n, one, many) => `${n === 0 ? 'No' : n} ${n === 1 ? one : many}`;

/** What the note says, separate from how it looks, so it can be tested. */
export function wordsFor(r) {
  if (r.kind === 'tournament') {
    const short = r.name.replace(/^(fifa|uefa|conmebol|caf|afc|concacaf)\s+/i, '');
    return {
      label: 'Tournament football',
      title: `The ${short} is on.`,
      text: [
        `${plural(r.count, 'game', 'games')} in the next three days, and every one gets the look a club game does: who is fit, who is being rested, who needs the result.`,
        r.calls ? `${plural(r.calls, 'call', 'calls')} on them so far.` : 'Calls go up as the line-ups firm up.',
      ],
      cta: { label: `All ${short} games`, href: r.leagueId ? `#/league/${encodeURIComponent(r.leagueId)}` : '#/board' },
    };
  }
  const still = r.still.length ? cap(`${listOf(r.still)} ${r.still.length === 1 ? 'carries' : 'carry'} on as normal.`) : '';
  const board = `${plural(r.calls, 'call', 'calls')} on the board right now.`;
  if (r.kind === 'break') {
    return {
      label: 'International break',
      title: 'Club football is on hold.',
      text: [
        'Qualifiers and friendlies mean rotated squads, half-fit stars and form that tells you next to nothing. So we call fewer games, not worse ones.',
        [board, still].filter(Boolean).join(' '),
      ],
      cta: { label: 'See what’s on', href: '#/board' },
    };
  }
  return {
    label: 'Close season',
    title: 'The big leagues are resting.',
    text: [
      'Pre-season friendlies tell you less than they look like they do, so most of them get no call.',
      [board, still].filter(Boolean).join(' '),
    ],
    cta: { label: 'See what’s on', href: '#/board' },
  };
}

/** "9 days until the Premier League is back", or "back tomorrow". */
export function countdownWords(days, league = 'the Premier League') {
  if (days === null || days === undefined) return null;
  if (days <= 0) return { n: null, text: `${cap(league)} is back today` };
  if (days === 1) return { n: null, text: `${cap(league)} is back tomorrow` };
  return { n: days, text: `days until ${league} is back` };
}
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/* ------------------------------------------------------------- the note */

const KEY = 'ow.season';
const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
function seen() { try { return JSON.parse(localStorage.getItem(KEY) ?? '[]') ?? []; } catch { return []; } }
function remember(key) {
  try { localStorage.setItem(KEY, JSON.stringify([...new Set([...seen(), key])].slice(-20))); } catch { /* shown again next visit */ }
}
export const dismissed = (key) => seen().includes(key);

/**
 * The days between now and the club game's return, one cell each, the last
 * one lit. More than a fortnight folds the middle into a gap.
 */
function daysStrip(now, back, days) {
  if (!back || days === null || days < 2) return '';
  const cells = [];
  const at = (i) => dayStart(now) + i * DAY + 12 * 3600;
  const cell = (i, cls = '') => {
    const d = new Date(at(i) * 1000);
    const wk = d.toLocaleDateString([], { weekday: 'narrow' });
    const label = i === days ? d.toLocaleDateString([], { day: 'numeric' }) : wk;
    return `<li class="${cls}" title="${d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })}"><i>${label}</i></li>`;
  };
  if (days <= 14) {
    for (let i = 0; i <= days; i++) cells.push(cell(i, i === 0 ? 'is-today' : i === days ? 'is-back' : ''));
  } else {
    for (let i = 0; i <= 10; i++) cells.push(cell(i, i === 0 ? 'is-today' : ''));
    cells.push('<li class="is-gap" aria-hidden="true"><i>…</i></li>');
    cells.push(cell(days, 'is-back'));
  }
  return `<ol class="season-days" aria-hidden="true">${cells.join('')}</ol>`;
}

function body(r, { crest, esc, kickoff, now }) {
  const w = wordsFor(r);
  let feature = '';
  if (r.kind === 'tournament') {
    feature = `<ul class="season-games">${r.games.map((g) => `
      <li><a href="#/fixture/${encodeURIComponent(g.id)}">
        <span class="season-teams">${crest(g.home, 'xs', g.home_id)}<b>${esc(g.home)}</b><em>v</em>${crest(g.away, 'xs', g.away_id)}<b>${esc(g.away)}</b></span>
        <span class="season-when">${g.live ? '<span class="live-badge"><i></i>Live</span>' : esc(kickoff(g.kickoff))}${g.call ? '<span class="season-called" title="We have a call on this one"><span class="visually-hidden">We have a call on this one</span></span>' : ''}</span>
      </a></li>`).join('')}</ul>`;
  } else {
    const c = countdownWords(r.days);
    if (c) {
      feature = `<div class="season-gap">
        <p class="season-count">${c.n !== null ? `<b>${c.n}</b>` : ''}<span>${esc(c.text)}</span></p>
        ${daysStrip(now, r.back, r.days)}
      </div>`;
    }
  }
  return `
    <button class="season-x" type="button" data-season-close aria-label="Close"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
    <p class="season-label">${esc(w.label)}</p>
    <h2 class="season-title" id="season-title">${esc(w.title)}</h2>
    ${feature}
    ${w.text.filter(Boolean).map((t) => `<p class="season-text">${esc(t)}</p>`).join('')}
    <div class="season-actions">
      <a class="btn btn-primary btn-sm" href="${w.cta.href}" data-season-go>${esc(w.cta.label)}</a>
      <button class="btn btn-ghost btn-sm" type="button" data-season-close>Got it</button>
    </div>`;
}

let current = null;

/** Take the note down. `keep` remembers it as seen. */
export function closeSeason({ keep = false, quick = false } = {}) {
  const el = document.getElementById('season-note');
  if (!el) return;
  if (keep && current) remember(current.key);
  current = null;
  removeEventListener('keydown', onKey);
  if (quick || reduced()) { el.remove(); return; }
  el.animate([{ opacity: 1, transform: 'translateY(0)' }, { opacity: 0, transform: 'translateY(16px)' }], { duration: 220, easing: 'cubic-bezier(0.5, 0, 0.75, 0)', fill: 'forwards' })
    .finished.then(() => el.remove(), () => el.remove());
}
function onKey(e) { if (e.key === 'Escape') closeSeason({ keep: true }); }

/**
 * Show the note for this reading, or bring an open one up to date. Nothing
 * when it has been seen already.
 */
export function showSeason(r, helpers) {
  const open = document.getElementById('season-note');
  if (!r) { if (open) closeSeason({ quick: true }); return; }
  if (dismissed(r.key)) { if (open) closeSeason({ quick: true }); return; }
  const html = body(r, { ...helpers, now: helpers.now ?? Date.now() / 1000 });
  current = r;
  if (open) { open.dataset.kind = r.kind; open.innerHTML = html; return; }

  const el = document.createElement('aside');
  el.id = 'season-note';
  el.className = 'season';
  el.dataset.kind = r.kind;
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-labelledby', 'season-title');
  el.innerHTML = html;
  el.addEventListener('click', (e) => {
    const t = e.target.closest?.('[data-season-close], [data-season-go], .season-games a');
    if (t) closeSeason({ keep: true, quick: !t.hasAttribute('data-season-close') });
  });
  document.body.append(el);
  addEventListener('keydown', onKey);
  if (reduced()) return;
  // One entrance: the card rises, then the days light up one by one to the
  // day the club game is back.
  el.animate([{ opacity: 0, transform: 'translateY(24px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 520, easing: 'cubic-bezier(0.16, 1, 0.3, 1)', fill: 'backwards' });
  [...el.querySelectorAll('.season-days li, .season-games li')].forEach((li, i) => {
    li.animate([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 320, delay: 260 + i * 45, easing: 'cubic-bezier(0.16, 1, 0.3, 1)', fill: 'backwards' });
  });
}
