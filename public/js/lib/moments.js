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
 *   - a Champions League night: the competition's starball floats over a
 *     violet night, a dome clad in its stars glowing underneath, and the
 *     night's games come up on the vidiprinter.
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
/*
 * The cards are for the senior men's game the hype is written for. The
 * provider names a women's or youth side exactly like the men's, so Barcelona
 * v Real Madrid in Liga F read as El Clásico; the competition is how to tell.
 */
const NOT_SENIOR = /\bwomen|femen|fémin|feminin|frauen|\bliga f\b|\bwsl\b|\bu-?\d\d\b|under[- ]\d\d|youth|junior|primavera|reserve|\bii\b/i;
const senior = (f) => !NOT_SENIOR.test(String(f.league ?? ''));
const dayKey = (epoch) => { const d = new Date(epoch * 1000); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };
const sameDay = (a, b) => dayKey(a) === dayKey(b);
/** The Monday of the week an epoch falls in, as a day key. */
const weekOf = (epoch) => { const d = new Date(epoch * 1000); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return dayKey(d.getTime() / 1000); };
const hexOk = (c) => (typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c) ? c : null);
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const NUM = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen', 'Twenty'];
const Num = (n) => NUM[n] ?? String(n);
const num = (n) => (NUM[n] ? NUM[n].toLowerCase() : String(n));
const ordinal = (n) => { const s = ['th', 'st', 'nd', 'rd']; const v = n % 100; return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`; };

/*
 * Calls first. A card that shouts about a weekend we have not called is a
 * card selling nothing, so every moment waits for the calls:
 *
 *   - a named fixture shows once our call on it is in (open or members'). If
 *     we pass on it, it shows only on the day, and says so: no hype for a
 *     game we are not backing. Not looked at yet: it waits.
 *   - a league back, or a Champions League night, shows once most of those
 *     games have been looked at (three in five or more) and at least one has
 *     a call. It says how many, and the called games lead the list.
 *
 * Waiting costs nothing: nothing is remembered until a card is shown, and
 * the board is read again on every visit.
 */

/** Where a game stands with us: a call (open, or members'), a pass, or not looked at yet. */
export const callState = (f) => (f.top_pick || f.called ? 'open' : f.locked ? 'members' : f.pass ? 'pass' : 'pending');
const isCall = (s) => s === 'open' || s === 'members';

/** Whether a set of games is ready to be shouted about. */
export function readiness(games) {
  const states = games.map(callState);
  const decided = states.filter((x) => x !== 'pending').length;
  const calls = states.filter(isCall).length;
  return { total: games.length, decided, calls, ready: calls >= 1 && decided / Math.max(1, games.length) >= 0.6 };
}

/** The games for the card: called ones first, then by kick-off. */
const lineup = (games, n) => [...games].sort((a, b) => (isCall(callState(b)) - isCall(callState(a))) || a.kickoff - b.kickoff).slice(0, n).map(slim);

/**
 * The moment on now, if there is one. `league(id)` answers with that
 * competition's page data (/api/league/{id}: table, last results, scorers).
 * It is asked only about a league with a moment in it, so an ordinary day
 * costs nothing, and its answer is what the card talks about.
 */
export async function findMoment({ fixtures = [], now = Date.now() / 1000, league = async () => null } = {}) {
  const ahead = fixtures.filter((f) => upcoming(f, now) && senior(f)).sort((a, b) => a.kickoff - b.kickoff);
  const table = async (id) => {
    const d = await league(id).catch(() => null);
    return d ? { standings: d.standings ?? [], last: d.last ?? [], scorers: d.scorers ?? [], next: d.next ?? [] } : null;
  };

  // A named fixture within the day, with our call on it in (or, on the day
  // itself, a pass we can own). The biggest that qualifies.
  const named = ahead
    .filter((f) => f.kickoff - now <= 30 * HOUR)
    .map((f) => ({ f, n: namedFixture(f.home, f.away), state: callState(f) }))
    .filter((x) => x.n && (isCall(x.state) || (x.state === 'pass' && x.f.kickoff - now <= 12 * HOUR)))
    .sort((a, b) => b.n.weight - a.n.weight)[0];
  if (named) {
    const { f, n, state } = named;
    return {
      kind: 'derby',
      key: `n:${f.id}`,
      kicker: n.kicker,
      today: sameDay(f.kickoff, now),
      fixture: {
        id: f.id, home: f.home, away: f.away, home_id: f.home_id, away_id: f.away_id, kickoff: f.kickoff, league: f.league, league_id: f.league_id ?? null,
        colors: { home: hexOk(f.colors?.home), away: hexOk(f.colors?.away) },
        call: state,
      },
      table: f.league_id ? await table(f.league_id) : null,
    };
  }

  // A big league back: on the board within two days, ten clear days or more
  // since its last game, and the calls in.
  for (const [id, name] of RETURNING) {
    const games = ahead.filter((f) => Number(f.league_id) === id);
    if (!games.length || games[0].kickoff - now > 48 * HOUR) continue;
    const round = games.filter((f) => f.kickoff - games[0].kickoff <= 72 * HOUR);
    const r = readiness(round);
    if (!r.ready) continue;
    const t = await table(id);
    const last = Math.max(0, ...(t?.last ?? []).map((g) => Number(g.kickoff)).filter((k) => k < now));
    if (!last || games[0].kickoff - last < 10 * DAY) continue;
    return {
      kind: 'return',
      // One key for the whole comeback weekend, not one per league: the big
      // five come back within a day of each other, and four "is back" cards
      // in two days is three too many. The first in RETURNING's order that is
      // ready gets it.
      key: `r:${weekOf(games[0].kickoff)}`,
      leagueId: id,
      league: games[0].league,
      name,
      gap: Math.floor((games[0].kickoff - last) / DAY),
      count: round.length,
      calls: r.calls,
      games: lineup(round, 4),
      table: t,
    };
  }

  // A Champions League night: two games or more still to come today, and the calls in.
  const tonight = ahead.filter((f) => Number(f.league_id) === UCL && sameDay(f.kickoff, now));
  const r = readiness(tonight);
  if (tonight.length >= 2 && r.ready) {
    return { kind: 'ucl', key: `c:${dayKey(now)}`, leagueId: UCL, league: tonight[0].league, count: tonight.length, calls: r.calls, games: lineup(tonight, 4), table: await table(UCL) };
  }
  return null;
}
const slim = (f) => ({ id: f.id, home: f.home, away: f.away, home_id: f.home_id ?? null, away_id: f.away_id ?? null, kickoff: f.kickoff, call: callState(f) });

/* --------------------------------------------------------------- the talk */

/*
 * The brief, in the client's words: "where's the football, I want the real
 * deal", and "Let's gooo". So every card opens with a shout and then earns
 * it with the football: who is top and by how much, who has not won, who is
 * scoring, how each side got on last time out. Only pub numbers (positions,
 * points, scores, goals), never a rate or a decimal; offside-voice has the
 * rule and vocabulary.ts enforces it.
 */
const rowOf = (t, id, name) => (t?.standings ?? []).find((r) => (id != null && Number(r.team_id) === Number(id)) || r.team === name) ?? null;
const sorted = (t) => [...(t?.standings ?? [])].filter((r) => r.position).sort((a, b) => a.position - b.position);
const gapWords = (n) => (n === 0 ? 'level on points' : n === 1 ? 'a point between them' : `${num(n)} points between them`);

/** How a side's last game went, said from their side: "won 3–1 at Fulham". */
function lastOut(t, id, name) {
  const g = [...(t?.last ?? [])].filter((x) => Array.isArray(x.score) && ((id != null && (Number(x.home_id) === Number(id) || Number(x.away_id) === Number(id))) || x.home === name || x.away === name))
    .sort((a, b) => b.kickoff - a.kickoff)[0];
  if (!g) return null;
  const home = (id != null && Number(g.home_id) === Number(id)) || g.home === name;
  const [f, a] = home ? g.score : [g.score[1], g.score[0]];
  const opp = home ? g.away : g.home;
  const res = f > a ? 'won' : f < a ? 'lost' : 'drew';
  // The winner's score first, the way it is said: "lost 2–1 at Atlético".
  const score = f >= a ? `${f}–${a}` : `${a}–${f}`;
  return { res, f, a, opp, home, text: `${res} ${score} ${home ? 'at home to' : 'at'} ${opp}` };
}

function derbyTakes(m) {
  const f = m.fixture;
  const t = m.table;
  const out = [];
  const H = rowOf(t, f.home_id, f.home);
  const A = rowOf(t, f.away_id, f.away);
  if (H && A) {
    const [hi, lo] = H.position < A.position ? [H, A] : [A, H];
    const gap = hi.points - lo.points;
    if (hi.position === 1 && lo.position === 2) out.push(`Top against second, ${gapWords(gap)}. This is the title, early.`);
    else if (hi.position === 1) out.push(`${hi.team} top, ${lo.team} ${ordinal(lo.position)}, ${gapWords(gap)}.`);
    else if (gap === 0) out.push(`Level on points. Somebody blinks.`);
    else out.push(`${hi.team} ${ordinal(hi.position)}, ${lo.team} ${ordinal(lo.position)}, ${gapWords(gap)}.`);
    const perfect = [H, A].find((r) => r.played >= 3 && r.won === r.played);
    const winless = [H, A].find((r) => r.played >= 3 && r.won === 0);
    if (perfect) out.push(`${perfect.team} have won all ${num(perfect.played)}. This is where that gets tested.`);
    else if (winless) out.push(`${winless.team} haven’t won yet. Imagine the first one being this.`);
  }
  for (const [id, name] of [[f.home_id, f.home], [f.away_id, f.away]]) {
    if (out.length >= 3) break;
    const l = lastOut(t, id, name);
    if (l) out.push(`${name} ${l.text} last time out.`);
  }
  return out.slice(0, 3);
}

function returnTakes(m) {
  const t = m.table;
  const rows = sorted(t);
  const out = [];
  const top = rows[0];
  const second = rows[1];
  if (top) {
    const gap = top.points - (second?.points ?? top.points);
    if (top.played >= 3 && top.won === top.played) out.push(`${top.team} top, ${num(top.won)} from ${num(top.played)}. Nobody’s laid a glove on them.`);
    else if (gap >= 3) out.push(`${top.team} top and ${num(gap)} points clear already.`);
    else if (gap > 0) out.push(`${top.team} top, but only by ${gap === 1 ? 'a point' : `${num(gap)} points`}. It’s wide open.`);
    else out.push(`${top.team} top on goal difference. Wide open.`);
  }
  // The pick of the weekend: the game between the two highest-placed sides.
  const pos = (id, name) => rowOf(t, id, name)?.position ?? 99;
  const pick = m.games.map((g) => ({ g, a: pos(g.home_id, g.home), b: pos(g.away_id, g.away) })).filter((x) => x.a <= 8 && x.b <= 8).sort((x, y) => (x.a + x.b) - (y.a + y.b))[0];
  if (pick) out.push(`Pick of the weekend: ${pick.g.home} v ${pick.g.away}, ${ordinal(pick.a)} against ${ordinal(pick.b)}.`);
  const boot = (t?.scorers ?? [])[0];
  if (boot && boot.goals >= 3) out.push(`${boot.name}’s got ${num(boot.goals)} already. Somebody mark him.`);
  const winless = rows.filter((r) => r.played >= 3 && r.won === 0).map((r) => r.team);
  if (winless.length === 1) out.push(`${winless[0]} still haven’t won a game. Sort it out.`);
  return out.slice(0, 3);
}

function uclTakes(m) {
  const t = m.table;
  const out = [];
  const seen = m.games.flatMap((g) => [[g.home_id, g.home], [g.away_id, g.away]]).map(([id, name]) => ({ name, l: lastOut(t, id, name) })).filter((x) => x.l);
  const thrash = seen.filter((x) => x.l.res === 'won').sort((a, b) => (b.l.f - b.l.a) - (a.l.f - a.l.a))[0];
  if (thrash && thrash.l.f - thrash.l.a >= 2) out.push(`${thrash.name} put ${num(thrash.l.f)} past ${thrash.l.opp} last time. Again?`);
  const hurt = seen.find((x) => x.l.res === 'lost');
  if (hurt) out.push(`${hurt.name} lost last time out. Lose again and it gets ugly.`);
  return out.slice(0, 2);
}

/** How many of the games we have called: the reason the card is up at all. */
function callsLine(m) {
  if (!m.calls) return '';
  return m.calls === m.count ? `Our calls are in on all ${num(m.count)}.` : `Our calls are in on ${num(m.calls)} of the ${num(m.count)}.`;
}

/** What the card says, separate from how it moves, so it can be tested. */
export function wordsFor(m) {
  if (m.kind === 'derby') {
    const f = m.fixture;
    return {
      shout: m.today ? 'Matchday. Let’s gooo.' : 'Tomorrow. Clear your diary.',
      title: m.kicker,
      teams: [f.home, f.away],
      takes: derbyTakes(m),
      line: f.call === 'open' ? 'Our call’s up, reasons and all. Go and get it.'
        : f.call === 'members' ? 'Our call’s in. Members, you know where it is. The preview’s free.'
        : 'No call from us on this one, and we’re not going to pretend. The preview says why.',
      cta: { label: f.call === 'pass' ? 'Read the preview' : 'See our call', href: `#/fixture/${encodeURIComponent(f.id)}` },
    };
  }
  if (m.kind === 'return') {
    return {
      shout: 'Let’s gooo.',
      title: `${cap(m.name)} is back.`,
      lead: `${Num(m.gap)} days of international football. Done. Gone. Over.`,
      takes: returnTakes(m),
      calls: callsLine(m),
      cta: { label: 'Get the calls', href: `#/league/${m.leagueId}` },
    };
  }
  return {
    shout: 'Big night. Let’s go.',
    title: 'Champions League night.',
    lead: `${Num(m.count)} games under the lights. Anthem on, phones down.`,
    takes: uclTakes(m),
    calls: callsLine(m),
    cta: { label: 'Get tonight’s calls', href: `#/league/${m.leagueId}` },
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
          <p class="mo-shout">${esc(w.shout)}</p>
          <h2 class="mo-kicker" id="mo-title" aria-label="${esc(w.title)}"><span aria-hidden="true">${letters}</span></h2>
          <p class="mo-teams"><b>${esc(f.home)}</b><em>v</em><b>${esc(f.away)}</b></p>
          <p class="mo-when">${f.league ? `<span class="mo-comp">${f.league_id ? `<span class="mo-logo mo-logo-sm">${crest(f.league, 'sm', f.league_id, 'league')}</span>` : ''}${esc(f.league)}</span>` : ''}<span>${esc(shortWhen(f.kickoff, now, clock))}</span><span class="mo-clock" data-to="${f.kickoff}" aria-hidden="true"></span></p>
          ${w.takes.length ? `<ul class="mo-takes">${w.takes.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
          <p class="mo-line-text">${esc(w.line)}</p>
          ${actions}
        </div>
      </div>`;
  }
  if (m.kind === 'ucl') return nightHTML(m, w, { esc, clock, now, x, actions });
  const words = (t) => t.split(/\s+/).map((wd, i) => `<span class="mo-w"><span style="--i:${i}">${esc(wd)}</span></span>`).join(' ');
  return `
    <div class="mo-scrim" data-mo-close></div>
    <div class="mo-card" role="dialog" aria-modal="true" aria-labelledby="mo-title" tabindex="-1" data-kind="${esc(m.kind)}">
      <div class="mo-glow" aria-hidden="true"><div class="mo-sweep"></div></div>
      ${x}
      <p class="mo-shout">${esc(w.shout)}</p>
      <div class="mo-head">${emblem(m, crest)}<h2 class="mo-title" id="mo-title">${words(w.title)}</h2></div>
      ${body(m, w, { esc, clock, now })}
      ${actions}
    </div>`;
}

/** The lead, the takes, how many are called, and the games on the vidiprinter. */
function body(m, w, { esc, clock, now }) {
  return `<p class="mo-lead">${esc(w.lead)}</p>
      ${w.takes.length ? `<ul class="mo-takes">${w.takes.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
      ${w.calls ? `<p class="mo-calls">${esc(w.calls)}</p>` : ''}
      <ol class="mo-vidi">${m.games.map((g) => {
        const text = `${g.home} v ${g.away}`;
        return `<li><a href="#/fixture/${encodeURIComponent(g.id)}" data-mo-go>
          <span class="visually-hidden">${esc(text)}, ${esc(shortWhen(g.kickoff, now, clock))}${g.call === 'open' || g.call === 'members' ? ', we have a call on it' : ''}</span>
          <span class="mo-type" aria-hidden="true" data-text="${esc(text)}">${esc(text)}</span>
          <time aria-hidden="true">${g.call === 'open' || g.call === 'members' ? '<i class="mo-called" title="We have a call on this"></i>' : ''}${esc(shortWhen(g.kickoff, now, clock))}</time></a></li>`;
      }).join('')}</ol>`;
}

/*
 * A Champions League night, drawn after the competition's own artwork: its
 * starball floating over a violet night, and under it a stadium roof clad in
 * the same stars, its skyline glowing. The scene is one still
 * (/brand/ucl-night.webp, rendered by scripts/hero); the starball is the
 * competition's logo, the one the site shows beside its name everywhere,
 * traced and filled white for the dark (/brand/ucl-emblem.svg).
 */
function nightHTML(m, w, { esc, clock, now, x, actions }) {
  const words = (t) => t.split(/\s+/).map((wd, i) => `<span class="mo-w"><span style="--i:${i}">${esc(wd)}</span></span>`).join(' ');
  return `
    <div class="mo-scrim" data-mo-close></div>
    <div class="mo-card" role="dialog" aria-modal="true" aria-labelledby="mo-title" tabindex="-1" data-kind="ucl">
      <div class="mo-night">
        <img class="mo-night-sky" src="/brand/ucl-night.webp" alt="" aria-hidden="true" decoding="async">
        <div class="mo-night-top">
          <div class="mo-night-ball" aria-hidden="true"><span class="mo-ripple"></span><img class="mo-logo" src="/brand/ucl-emblem.svg" alt="" decoding="async"></div>
          <p class="mo-shout">${esc(w.shout)}</p>
          <h2 class="mo-title" id="mo-title">${words(w.title)}</h2>
        </div>
      </div>
      ${x}
      <div class="mo-night-body">
      ${body(m, w, { esc, clock, now })}
      ${actions}
      </div>
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

  // The shout slams on: big and tilted, down hard, a kick of light.
  const stamp = (delay) => {
    go(root.querySelector('.mo-shout'), [
      { transform: 'scale(2.6) rotate(-8deg)', opacity: 0, filter: 'blur(6px)' },
      { transform: 'scale(0.92) rotate(1deg)', opacity: 1, filter: 'blur(0)', offset: 0.55 },
      { transform: 'scale(1.04) rotate(-1deg)', offset: 0.75 },
      { transform: 'none', opacity: 1, filter: 'blur(0)' }], { duration: 620, delay, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' });
    card.animate([{ translate: '0 0' }, { translate: '0 4px' }, { translate: '0 -2px' }, { translate: '0 0' }], { duration: 260, delay: delay + 330, easing: 'ease-out' });
  };
  const takes = (delay) => all('.mo-takes li').forEach((li, i) =>
    go(li, [{ opacity: 0, transform: 'translateX(-14px)' }, { opacity: 1, transform: 'none' }], { duration: 600, delay: delay + i * 140, easing: EXPO }));

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
    stamp(HIT + 40);
    const after = HIT + 220 + all('.mo-kicker span[style]').length * 32;
    [['.mo-teams', 0], ['.mo-when', 120], ['.mo-line-text', 260 + all('.mo-takes li').length * 140], ['.mo-actions', 360 + all('.mo-takes li').length * 140]].forEach(([sel, d]) =>
      go(root.querySelector(sel), [{ opacity: 0, transform: 'translateY(12px)' }, { opacity: 1, transform: 'none' }], { duration: 700, delay: after + d, easing: EXPO }));
    takes(after + 220);
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
    // The night comes up: the stadium rises a touch into place and its
    // skyline brightens, then the starball spins in out of the dark and
    // lands with a pulse of light.
    go(root.querySelector('.mo-night-sky'), [{ transform: 'translateY(18px) scale(1.08)', filter: 'brightness(0.4)' }, { transform: 'none', filter: 'none' }], { duration: 1500, delay: 120, easing: EXPO });
    go(logo, [
      { transform: 'rotate(-220deg) scale(0.2)', opacity: 0, filter: 'blur(6px)' },
      { opacity: 1, offset: 0.35 },
      { transform: 'rotate(12deg) scale(1.1)', filter: 'blur(0)', offset: 0.75 },
      { transform: 'none', opacity: 1, filter: 'blur(0)' }], { duration: 1200, delay: 260, easing: EXPO });
    go(ripple, [{ transform: 'scale(0.8)', opacity: 0.9 }, { transform: 'scale(2.4)', opacity: 0 }], { duration: 1000, delay: 1050, easing: EXPO, iterations: 2 });
  }
  const ws = all('.mo-w > span');
  ws.forEach((w, i) => go(w, [{ transform: 'translateY(105%) rotate(4deg)' }, { transform: 'none' }], { duration: 900, delay: 420 + i * 60, easing: EXPO }));
  stamp(240);
  const tail = 520 + ws.length * 60;
  go(root.querySelector('.mo-lead'), [{ opacity: 0, transform: 'translateY(12px)' }, { opacity: 1, transform: 'none' }], { duration: 700, delay: tail, easing: EXPO });
  takes(tail + 160);
  const n = all('.mo-takes li').length + (root.querySelector('.mo-calls') ? 1 : 0);
  go(root.querySelector('.mo-calls'), [{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: 600, delay: tail + 160 + all('.mo-takes li').length * 140, easing: EXPO });
  vidiprinter(root, tail + 260 + n * 140);
  go(root.querySelector('.mo-actions'), [{ opacity: 0, transform: 'translateY(12px)' }, { opacity: 1, transform: 'none' }], { duration: 700, delay: tail + 400 + n * 140, easing: EXPO });
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
