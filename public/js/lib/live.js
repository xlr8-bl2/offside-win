/**
 * Live: what the page does with /api/live.
 *
 * Every other read on this site is something the engine wrote on a schedule,
 * and a fifteen-minute schedule is the wrong clock for a match in play. The
 * Worker asks the provider for the matches being played and the week's
 * fixture changes at most twice a minute (worker/src/live.ts); this lays that
 * over whatever the page already has, so a goal, a half-time whistle, a
 * postponement or a kick-off moved shows within thirty seconds on every page
 * that mentions the match, without any of them knowing about it.
 *
 * Pure functions over plain objects, so the rules are testable without a
 * browser (engine/test/live-overlay.test.ts).
 */

/** A match that will not be played as scheduled, or has stopped. */
export const OFF = new Set(['postponed', 'cancelled', 'abandoned', 'suspended']);
/** A match being played, in the words the Worker hands back. */
export const PLAYING = new Set(['1st_half', '2nd_half', 'halftime', 'extra_time', 'penalties', 'live', 'inprogress']);
const FINISHED = /^(finished|ended|ft|aet|ap|after.*)$/;

/** The provider's word for a fixture change, in the page's vocabulary. */
export function normStatus(v) {
  const s = String(v ?? '').toLowerCase().trim();
  if (/postpon/.test(s)) return 'postponed';
  if (/cancel/.test(s)) return 'cancelled';
  if (/abandon/.test(s)) return 'abandoned';
  if (/suspend|interrupt/.test(s)) return 'suspended';
  if (FINISHED.test(s)) return 'finished';
  if (/notstarted|not_started|scheduled|^ns$/.test(s)) return 'notstarted';
  return s;
}

const epoch = (iso) => {
  const t = typeof iso === 'string' ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? Math.floor(t / 1000) : null;
};
const pairOk = (v) => Array.isArray(v) && v.length === 2 && v.every((x) => Number.isInteger(x));

/**
 * The Worker's body, folded into what the page keeps between polls.
 *
 * A match that drops out of the live list has usually finished, and the
 * slate will not say so for up to fifteen minutes. So a match last seen in its
 * last few minutes, or in extra time or penalties, is taken as over at the
 * score it was last seen at. Any other disappearance keeps the last row as it
 * was: a stale score is no worse than the slate's, and better than inventing
 * a result. Rows are forgotten four hours after kick-off.
 */
export function ingest(body, prev = new Map(), now = Date.now() / 1000) {
  const byId = new Map();
  for (const m of Array.isArray(body?.matches) ? body.matches : []) {
    if (m && Number.isInteger(m.id)) byId.set(m.id, { ...m, gone: false });
  }
  for (const [id, m] of prev) {
    if (byId.has(id)) continue;
    if (m.kickoff && now - m.kickoff > 4 * 3600) continue;
    const late = (m.status === '2nd_half' && (m.minute ?? 0) >= 88)
      || m.status === 'extra_time' || m.status === 'penalties';
    byId.set(id, { ...m, gone: true, status: late ? 'finished' : m.status });
  }
  const changes = new Map();
  for (const c of Array.isArray(body?.changes) ? body.changes : []) {
    if (!c || !Number.isInteger(c.id) || (c.kind !== 'kickoff' && c.kind !== 'status')) continue;
    const had = changes.get(c.id) ?? {};
    changes.set(c.id, { ...had, [c.kind]: c });
  }
  return { byId, changes };
}

const started = (f) => {
  const s = String(f?.status ?? '').toLowerCase();
  return PLAYING.has(s) || FINISHED.test(s) || pairOk(f?.score);
};

/** A kick-off moved or a match called off, laid over one fixture. */
function applyChange(f, c) {
  const k = c.kickoff;
  if (k && !started(f)) {
    const to = epoch(k.to);
    const from = epoch(k.from);
    if (to !== null && Number.isFinite(Number(f.kickoff))) {
      if (Math.abs(to - Number(f.kickoff)) > 60) {
        // The page has the old time: move it, and remember where it was.
        f.moved_from = Number(f.kickoff);
        f.kickoff = to;
      } else if (from !== null && Math.abs(from - to) > 60) {
        // The slate has caught up; still worth saying it moved.
        f.moved_from = from;
      }
    }
  }
  const s = c.status;
  if (s) {
    const to = normStatus(s.to);
    if (OFF.has(to) && !pairOk(f.score)) f.status = to;
    // Called off, then put back on: the fixture is a fixture again.
    else if (to === 'notstarted' && OFF.has(normStatus(f.status))) f.status = 'notstarted';
  }
}

/** The running state of a match in play, laid over one fixture. */
function applyMatch(f, m) {
  // The record has the result: nothing live overrides a full-time score.
  if (FINISHED.test(String(f.status ?? '').toLowerCase()) && pairOk(f.score)) return;
  if (m.status === 'notstarted') return;
  if (m.status === 'finished') {
    f.status = 'finished';
    if (!pairOk(f.score) && pairOk(m.score)) f.score = m.score;
    if (pairOk(m.score)) f.live_score = m.score;
    f.live_minute = null;
    return;
  }
  f.status = m.status;
  if (pairOk(m.score)) f.live_score = m.score;
  // At half time the clock has stopped; HT says it, not "45'".
  f.live_minute = m.status === 'halftime' ? null : (Number.isFinite(m.minute) ? m.minute : null);
  if (pairOk(m.ht)) f.live_ht = m.ht;
  if (pairOk(m.pens)) f.live_pens = m.pens;
}

/** The id a row is about: a pick row's fixture, else the row's own. */
export const fixtureIdOf = (f) => Number(f?.fixture_id ?? f?.id);

/** Everything known live about one fixture, laid over it in place. */
export function overlay(f, live) {
  const id = fixtureIdOf(f);
  if (!Number.isInteger(id)) return f;
  const c = live.changes.get(id);
  if (c) applyChange(f, c);
  const m = live.byId.get(id);
  if (m) applyMatch(f, m);
  return f;
}

/**
 * Every fixture-shaped object in a response: something with a kick-off, an
 * id and a home side. Board rows, pick rows, the headline and the match page
 * all have that shape, which is what lets one overlay serve every page.
 */
export function eachFixture(data, fn, depth = 0) {
  if (!data || typeof data !== 'object' || depth > 6) return;
  if (Array.isArray(data)) {
    for (const x of data) eachFixture(x, fn, depth + 1);
    return;
  }
  if (Number.isFinite(Number(data.kickoff)) && data.kickoff !== null
    && (data.fixture_id != null || data.id != null) && (data.home || data.home_team)) fn(data);
  for (const v of Object.values(data)) if (v && typeof v === 'object') eachFixture(v, fn, depth + 1);
}

/** Whether a fixture is being played or about to be: the poll's reason to run. */
export function inPlayWindow(f, now = Date.now() / 1000) {
  const s = String(f?.status ?? '').toLowerCase();
  if (FINISHED.test(s) || OFF.has(s)) return false;
  if (PLAYING.has(s)) return true;
  const k = Number(f?.kickoff);
  return Number.isFinite(k) && k > 0 && now > k - 600 && now < k + 3.5 * 3600;
}

/**
 * What the page drew for one fixture, as far as live data goes. When it
 * differs after a poll, the page is redrawn; when only the minute moved, the
 * minute is patched in place instead.
 */
export function signature(id, live) {
  const m = live.byId.get(id);
  const c = live.changes.get(id);
  return JSON.stringify([
    m?.status ?? null, m?.score ?? null, m?.minute == null, m?.pens ?? null,
    c?.kickoff?.to ?? null, c?.status?.to ?? null,
  ]);
}
