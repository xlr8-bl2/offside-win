/**
 * The site's reads, served from D1.
 *
 * Until October 2026 every public endpoint was one call to a Postgres function
 * (`get_board`, `get_fixture`, ... in schema.pg.sql) that returned the whole
 * response as JSON, and the Worker streamed its bytes untouched. Supabase
 * restricted the project for going over its free transfer allowance, and the
 * site moved to Cloudflare D1 (HANDOFF.md, "The move to D1"). SQLite has no
 * stored functions, so each one is rebuilt here: plain queries for the rows,
 * and the JSON assembled in the Worker, which Workers Paid gives the CPU for.
 *
 * Each function below names the Postgres one it replaces and returns the same
 * value. `engine/test/d1read.test.ts` and the d1-verify workflow hold them to
 * that: the same rows go into both, and the outputs are compared field by
 * field.
 *
 * Who is reading arrives as a `Viewer` (worker/src/auth.ts resolves the
 * session): `member` is has_membership(), decided once per request. Without
 * one, open calls are walled exactly as they were for a signed-out reader.
 * Settled calls, the free call of the day and finished matches stay public.
 */

export interface D1Stmt {
  bind(...values: unknown[]): D1Stmt;
  all<T = Record<string, unknown>>(): Promise<{ results?: T[] }>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
}
export interface D1Read {
  prepare(sql: string): D1Stmt;
  batch(statements: D1Stmt[]): Promise<Array<{ results?: unknown[] }>>;
}

type Rec = Record<string, any>;

const now = () => Math.floor(Date.now() / 1000);

/** try_json(): the parsed value, or the text itself when it is not JSON. SQL null stays null. */
export function tryJson(raw: unknown): unknown {
  if (raw === null || raw === undefined) return null;
  try { return JSON.parse(String(raw)); } catch { return String(raw); }
}

const isObj = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
/** `x->'key'` on a value that may not be an object. */
const field = (v: unknown, k: string): unknown => (isObj(v) ? (v[k] ?? null) : null);
/** `x->>'key'`: the text of a field, as Postgres prints it. */
function text(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  return typeof v === 'string' ? v : JSON.stringify(v);
}
/** `(x->>'key')::int` and friends: a number or null. */
function num(v: unknown): number | null {
  const t = text(v);
  if (t === null || t.trim() === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}
const digits = (v: unknown) => /^[0-9]+$/.test(text(v) ?? '');

/** Postgres's round() on a double: half to even. */
function roundEven(x: number): number {
  const r = Math.round(x);
  return Math.abs(x % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r;
}

/** Ascending, nulls first: Postgres's `ORDER BY x NULLS FIRST`. */
const ascNullsFirst = (a: number | null, b: number | null) =>
  a === b ? 0 : a === null ? -1 : b === null ? 1 : a - b;

async function rows<T = Rec>(db: D1Read, sql: string, ...params: unknown[]): Promise<T[]> {
  const st = params.length ? db.prepare(sql).bind(...params) : db.prepare(sql);
  return ((await st.all<T>()).results ?? []) as T[];
}
async function one<T = Rec>(db: D1Read, sql: string, ...params: unknown[]): Promise<T | null> {
  return (await rows<T>(db, sql, ...params))[0] ?? null;
}
/** One kv value, parsed, with whether the row was there at all. */
async function kv(db: D1Read, k: string): Promise<{ found: boolean; value: unknown; expires_at?: number | null }> {
  const r = await one<{ v: string; expires_at: number | null }>(db, 'SELECT v, expires_at FROM kv WHERE k = ?', k);
  return r ? { found: true, value: tryJson(r.v), expires_at: r.expires_at } : { found: false, value: null };
}
const inList = (n: number) => Array.from({ length: n }, () => '?').join(',');

/** report_goals(): the goals out of a match report, or null. */
export function reportGoals(raw: unknown): unknown[] | null {
  if (raw === null || raw === undefined) return null;
  const events = field(tryJson(raw), 'events');
  const goals = (Array.isArray(events) ? events : []).filter((e) => text(field(e, 't')) === 'goal');
  if (!goals.length) return null;
  return goals
    .map((e, i) => ({ e, i }))
    .sort((a, b) => ascNullsFirst(num(field(a.e, 'minute')), num(field(b.e, 'minute')))
      || ascNullsFirst(num(field(a.e, 'added')), num(field(b.e, 'added'))) || a.i - b.i)
    .map((x) => x.e);
}

/** free_fixture_id(): the free call the slate chose today, if any. */
export async function freeFixtureId(db: D1Read): Promise<number | null> {
  const { value } = await kv(db, 'free:today');
  return num(field(value, 'fixture_id'));
}

/** Each team's colour, for the mastheads; '' counts as none. */
async function colorsFor(db: D1Read, ids: Array<number | null | undefined>): Promise<Map<number, string>> {
  const want = [...new Set(ids.filter((x): x is number => typeof x === 'number'))];
  const out = new Map<number, string>();
  for (let i = 0; i < want.length; i += 90) {
    const chunk = want.slice(i, i + 90);
    for (const r of await rows<{ team_id: number; color: string }>(db, `SELECT team_id, color FROM team_color WHERE team_id IN (${inList(chunk.length)})`, ...chunk)) {
      if (r.color) out.set(r.team_id, r.color);
    }
  }
  return out;
}

/** The record's call on each finished fixture: the strongest CONFIDENT pick. */
async function calledFor(db: D1Read, ids: number[]): Promise<Map<number, Rec>> {
  const out = new Map<number, Rec>();
  for (let i = 0; i < ids.length; i += 90) {
    const chunk = ids.slice(i, i + 90);
    const got = await rows(db, `SELECT fixture_id, market, outcome, line, odds, bookmaker, result, model_prob
      FROM pick WHERE kind = 'CONFIDENT' AND fixture_id IN (${inList(chunk.length)})
      ORDER BY fixture_id, model_prob DESC`, ...chunk);
    for (const r of got) {
      if (out.has(r.fixture_id)) continue;
      out.set(r.fixture_id, { market: r.market, outcome: r.outcome, line: r.line, odds: r.odds, bookmaker: r.bookmaker, result: r.result });
    }
  }
  return out;
}

/** The columns board_card() reads; never the bundle, which is tens of kilobytes a row. */
const CARD_COLS = `f.id, f.kickoff, f.rank, f.league_id, f.status, f.board_json, f.board_free_json,
  f.home_goals, f.away_goals, f.live_home, f.live_away, f.live_minute, f.home_team_id, f.away_team_id, f.report_json`;

const finished = (f: Rec) => f.home_goals !== null && f.home_goals !== undefined && f.away_goals !== null && f.away_goals !== undefined;

/** board_card() for a set of fixtures, with the lookups done once for all of them. */
async function boardCards(db: D1Read, fixtures: Rec[], member: boolean, freeId: number | null): Promise<Rec[]> {
  if (!fixtures.length) return [];
  const colors = await colorsFor(db, fixtures.flatMap((f) => [f.home_team_id, f.away_team_id]));
  const called = await calledFor(db, fixtures.filter(finished).map((f) => f.id));
  return fixtures.map((f) => {
    const open = member || finished(f) || f.id === freeId;
    const base = tryJson(open ? f.board_json : (f.board_free_json ?? f.board_json));
    const card: Rec = isObj(base) ? { ...base } : {};
    if (f.id === freeId) card.free_call = true;
    card.colors = { home: colors.get(f.home_team_id) ?? null, away: colors.get(f.away_team_id) ?? null };
    card.status = f.status;
    if (!finished(f) && f.live_home !== null && f.live_away !== null) {
      card.live_score = [f.live_home, f.live_away];
      card.live_minute = f.live_minute;
    }
    if (finished(f)) {
      card.score = [f.home_goals, f.away_goals];
      card.status = 'finished';
      card.called = called.get(f.id) ?? null;
      card.goals = reportGoals(f.report_json);
    }
    return card;
  });
}

/**
 * get_board(p_from, p_to, p_league). Ties in the order (same day, rank and
 * kick-off) are broken by id here; Postgres broke them however it liked.
 */
export async function getBoard(db: D1Read, from: number, to: number, league?: number | null, member = false): Promise<Rec> {
  const freeId = await freeFixtureId(db);
  const fx = league
    ? await rows(db, `SELECT ${CARD_COLS} FROM fixture f WHERE f.kickoff BETWEEN ? AND ? AND f.league_id = ?
        ORDER BY f.kickoff / 86400, f.rank, f.kickoff, f.id LIMIT 300`, from, to, league)
    : await rows(db, `SELECT ${CARD_COLS} FROM fixture f WHERE f.kickoff BETWEEN ? AND ?
        ORDER BY f.kickoff / 86400, f.rank, f.kickoff, f.id LIMIT 300`, from, to);
  return { generated_at: now(), count: fx.length, member, fixtures: await boardCards(db, fx, member, freeId) };
}

/** fold(): lower case, accents off. */
const FOLD_FROM = 'áàâäãåāçćčéèêëēęíìîïīñńóòôöõøōúùûüūýÿšśžźżđłőűğışțß';
const FOLD_TO = 'aaaaaaaccceeeeeeiiiiinnoooooooouuuuuyysszzzdlougistb';
export function fold(s: unknown): string {
  const from = [...FOLD_FROM];
  const to = [...FOLD_TO];
  let out = '';
  for (const c of String(s ?? '').toLowerCase()) {
    const i = from.indexOf(c);
    out += i < 0 ? c : (to[i] ?? '');
  }
  return out;
}

/** Postgres's name order: case and accents set aside first, as en_US collation does. */
const byName = (a: unknown, b: unknown) => String(a ?? '').localeCompare(String(b ?? ''), 'en');

const laterRow = (x: Rec) => ({
  id: x.id, league_id: x.league_id, league: x.league ?? null, kickoff: x.kickoff,
  home: x.home_team, away: x.away_team, home_id: x.home_team_id, away_id: x.away_team_id,
});

/** search_games(p_q). */
export async function searchGames(db: D1Read, q: string, member = false): Promise<Rec> {
  const term = (q ?? '').trim();
  const n = [...term].length;
  const pat = fold(term);
  const t = now();
  const hit = (...xs: unknown[]) => xs.some((x) => x !== null && x !== undefined && fold(x).includes(pat));
  let analysed: Rec[] = [];
  let later: Rec[] = [];
  let leagues: Rec[] = [];
  if (n >= 2 && n <= 60) {
    const cand = await rows(db, `SELECT id, home_team, away_team, json_extract(board_json, '$.league') AS league
      FROM fixture WHERE kickoff BETWEEN ? AND ? ORDER BY kickoff, id`, t - 3 * 86400, t + 14 * 86400);
    const ids = cand.filter((f) => hit(f.home_team, f.away_team, f.league)).slice(0, 60).map((f) => f.id as number);
    if (ids.length) {
      const freeId = await freeFixtureId(db);
      const fx = await rows(db, `SELECT ${CARD_COLS} FROM fixture f WHERE f.id IN (${inList(ids.length)}) ORDER BY f.kickoff, f.id`, ...ids);
      analysed = await boardCards(db, fx, member, freeId);
    }
    const sched = await rows(db, `SELECT s.*, l.name AS league FROM schedule s LEFT JOIN league l ON l.id = s.league_id
      WHERE s.kickoff > ? AND s.kickoff <= ? AND NOT EXISTS (SELECT 1 FROM fixture f WHERE f.id = s.id)
      ORDER BY s.kickoff, s.id`, t, t + 14 * 86400);
    later = sched.filter((s) => hit(s.home_team, s.away_team, s.league)).slice(0, 60).map(laterRow);
    const lg = await rows(db, `SELECT l.id, l.name, l.country FROM league l
      WHERE EXISTS (SELECT 1 FROM schedule s WHERE s.league_id = l.id)
         OR EXISTS (SELECT 1 FROM fixture f WHERE f.league_id = l.id AND f.kickoff > ?)`, t - 3 * 86400);
    leagues = lg.filter((l) => hit(l.name)).sort((a, b) => byName(a.name, b.name)).slice(0, 6)
      .map((l) => ({ id: l.id, name: l.name, country: l.country }));
  }
  return { q: term, member, analysed, later, leagues };
}

/** get_team(p_id). */
export async function getTeam(db: D1Read, id: number, member = false): Promise<Rec | null> {
  const t = now();
  const games = await rows(db, `SELECT ${CARD_COLS}, f.home_team, f.away_team FROM fixture f
    WHERE (f.home_team_id = ? OR f.away_team_id = ?) AND f.kickoff BETWEEN ? AND ?
    ORDER BY f.kickoff DESC, f.id LIMIT 30`, id, id, t - 60 * 86400, t + 21 * 86400);
  const later = await rows(db, `SELECT s.*, l.name AS league FROM schedule s LEFT JOIN league l ON l.id = s.league_id
    WHERE (s.home_team_id = ? OR s.away_team_id = ?) AND s.kickoff > ? AND s.kickoff <= ?
      AND NOT EXISTS (SELECT 1 FROM fixture f WHERE f.id = s.id)
    ORDER BY s.kickoff, s.id LIMIT 10`, id, id, t, t + 45 * 86400);
  const latest = [...games, ...later].sort((a, b) => b.kickoff - a.kickoff)[0];
  if (!latest) return null;
  const freeId = await freeFixtureId(db);
  const asc = [...games].sort((a, b) => a.kickoff - b.kickoff);
  return {
    id,
    name: latest.home_team_id === id ? latest.home_team : latest.away_team,
    member,
    games: await boardCards(db, asc, member, freeId),
    later: later.map(laterRow),
  };
}

/** fixture_preview(p_id): a match we know of but have not analysed. */
export async function fixturePreview(db: D1Read, id: number): Promise<Rec | null> {
  let g: Rec | null = null;
  const s = await one(db, 'SELECT * FROM schedule WHERE id = ?', id);
  if (s) {
    g = { id: s.id, league_id: s.league_id, kickoff: s.kickoff, home: s.home_team, away: s.away_team,
      home_id: s.home_team_id, away_id: s.away_team_id, hg: null, ag: null };
  } else {
    // The id must appear in the text for a row to hold it, which keeps this to the lists that matter.
    const lists = await rows<{ k: string; v: string }>(db, `SELECT k, v FROM kv
      WHERE (k LIKE 'league:%:next' OR k LIKE 'league:%:last') AND instr(v, ?) > 0`, String(id));
    for (const k of lists) {
      const list = field(tryJson(k.v), 'rows');
      const r = (Array.isArray(list) ? list : []).find((x) => text(field(x, 'id')) === String(id));
      if (!r) continue;
      const score = field(r, 'score');
      const at = (i: number) => (Array.isArray(score) && digits(score[i]) ? Number(score[i]) : null);
      g = { id: num(field(r, 'id')), league_id: num(k.k.split(':')[1]), kickoff: num(field(r, 'kickoff')),
        home: text(field(r, 'home')), away: text(field(r, 'away')),
        home_id: digits(field(r, 'home_id')) ? Number(text(field(r, 'home_id'))) : null,
        away_id: digits(field(r, 'away_id')) ? Number(text(field(r, 'away_id'))) : null,
        hg: at(0), ag: at(1) };
      break;
    }
  }
  if (!g) return null;
  const league = g.league_id === null ? null : await one<{ name: string }>(db, 'SELECT name FROM league WHERE id = ?', g.league_id);
  const colors = await colorsFor(db, [g.home_id, g.away_id]);
  const played = g.hg !== null && g.ag !== null;
  return {
    id: g.id, league_id: g.league_id, league: league?.name ?? null, kickoff: g.kickoff,
    home: g.home, away: g.away, home_id: g.home_id, away_id: g.away_id,
    status: played ? 'finished' : 'notstarted',
    score: played ? [g.hg, g.ag] : null,
    unanalysed: true, verdicts: [], markets: [], published: [], pulled: [],
    colors: { home: colors.get(g.home_id) ?? null, away: colors.get(g.away_id) ?? null },
  };
}

/** get_fixture(p_id): the whole match page, or the preview, or null. */
export async function getFixture(db: D1Read, id: number, member = false): Promise<Rec | null> {
  const f = await one(db, 'SELECT * FROM fixture WHERE id = ?', id);
  if (!f) return fixturePreview(db, id);
  const freeId = await freeFixtureId(db);
  const done = finished(f);
  const open = member || done || f.id === freeId;
  const full = tryJson(f.bundle_json);
  const base = open ? full : tryJson(f.bundle_free_json ?? f.bundle_json);
  const b: Rec = isObj(base) ? { ...base } : {};
  b.status = f.status;
  if (!done && f.live_home !== null && f.live_away !== null) {
    b.live_score = [f.live_home, f.live_away];
    b.live_minute = f.live_minute;
  }
  if (done) { b.score = [f.home_goals, f.away_goals]; b.status = 'finished'; }
  if (f.report_json !== null) b.report = tryJson(f.report_json);
  if (f.id === freeId) b.free_call = true;
  const colors = await colorsFor(db, [f.home_team_id, f.away_team_id]);
  b.colors = { home: colors.get(f.home_team_id) ?? null, away: colors.get(f.away_team_id) ?? null };
  const venueId = field(full, 'venue_id');
  const v = digits(venueId)
    ? await one(db, `SELECT name, city, capacity FROM venue WHERE id = ? AND name <> ''`, Number(text(venueId)))
    : null;
  b.venue = v ? { name: v.name, city: v.city || null, capacity: v.capacity } : null;
  const reveal = member || f.id === freeId || f.kickoff < now();
  const pulled = await rows(db, `SELECT * FROM pulled_call WHERE fixture_id = ? AND restored_at IS NULL ORDER BY pulled_at DESC`, id);
  b.pulled = pulled.map((pc) => ({
    pulled_at: pc.pulled_at, reason: pc.reason, after_result: pc.after_result, after_home: pc.after_home, after_away: pc.after_away,
    ...(reveal ? { label: pc.label, odds: pc.odds, bookmaker: pc.bookmaker, replaced_by: pc.replaced_by } : {}),
  }));
  const picks = open
    ? await rows(db, `SELECT * FROM pick WHERE fixture_id = ? AND kind = 'CONFIDENT' ORDER BY model_prob DESC`, id)
    : await rows(db, `SELECT * FROM pick WHERE fixture_id = ? AND kind = 'CONFIDENT' AND settled_at IS NOT NULL ORDER BY model_prob DESC`, id);
  b.published = picks.map((pk) => ({
    market: pk.market, outcome: pk.outcome, line: pk.line, odds: pk.odds, bookmaker: pk.bookmaker,
    model_prob: pk.model_prob, narrative: pk.narrative, why: pk.why, result: pk.result,
    settled: pk.settled_at !== null, postmortem: tryJson(pk.postmortem_json),
  }));
  return b;
}

/** get_picks(p_limit, p_settled). */
export async function getPicks(db: D1Read, limit = 60, settled?: string | null, member = false): Promise<Rec> {
  const freeId = await freeFixtureId(db);
  const sum = await one(db, `SELECT count(*) AS n, sum(CASE WHEN result IN ('WON', 'HALF_WON') THEN 1 ELSE 0 END) AS wins,
      sum(pnl) AS pnl, avg(odds) AS avg_odds
    FROM pick WHERE settled_at IS NOT NULL AND result IS NOT 'VOID' AND kind = 'CONFIDENT'`);
  const which = settled === 'true' ? 'AND pk.settled_at IS NOT NULL' : settled === 'false' ? 'AND pk.settled_at IS NULL' : '';
  const got = await rows(db, `SELECT pk.id, pk.fixture_id, coalesce(f.kickoff, pk.kickoff) AS kickoff, pk.market, pk.outcome, pk.line, pk.kind,
        pk.model_prob, pk.book_prob, pk.edge, pk.odds, pk.bookmaker, pk.kelly,
        pk.confidence, pk.provisional, pk.narrative, pk.result, pk.pnl,
        f.home_team, f.away_team, f.home_goals, f.away_goals, f.status, f.league_id,
        f.home_team_id, f.away_team_id, pk.postmortem_json, pk.opening_odds, pk.closing_odds, pk.why,
        f.report_json AS _report
      FROM pick pk LEFT JOIN fixture f ON f.id = pk.fixture_id
      WHERE pk.kind = 'CONFIDENT' AND (pk.settled_at IS NOT NULL OR ? = 1 OR pk.fixture_id IS ?) ${which}
      ORDER BY pk.kickoff DESC LIMIT ?`, member ? 1 : 0, freeId, Math.max(1, Math.min(200, limit)));
  const picks = got.map(({ _report, ...p }): Rec => ({ ...p, goals: reportGoals(_report) }))
    .sort((a, b) => b.kickoff - a.kickoff);
  return {
    summary: { n: sum?.n ?? 0, wins: sum?.n ? sum.wins : 0, pnl: sum?.pnl ?? null, avg_odds: sum?.avg_odds ?? null },
    picks,
  };
}

/** get_model(). */
export async function getModel(db: D1Read): Promise<Rec> {
  const [cal, lg, runs, bt] = await db.batch([
    db.prepare('SELECT * FROM calibration ORDER BY market_family'),
    db.prepare(`SELECT rm.league_id, l.name, rm.home_adv, rm.rho, rm.xi, rm.mean_goals, rm.n_matches, rm.fitted_at
      FROM rating_meta rm LEFT JOIN league l ON l.id = rm.league_id ORDER BY rm.n_matches DESC`),
    db.prepare(`SELECT k, v FROM kv WHERE k LIKE '%:last_run' OR k LIKE 'ratings:%'`),
    db.prepare('SELECT label, created_at, report_json FROM backtest ORDER BY created_at DESC LIMIT 1'),
  ]);
  const r: Rec = {};
  for (const x of (runs?.results ?? []) as Rec[]) r[x.k] = tryJson(x.v);
  const b = (bt?.results ?? [])[0] as Rec | undefined;
  return {
    calibration: cal?.results ?? [],
    leagues: lg?.results ?? [],
    runs: r,
    backtest: b ? { label: b.label, created_at: b.created_at, report: tryJson(b.report_json) } : null,
  };
}

/** get_hero(). */
export async function getHero(db: D1Read): Promise<Rec> {
  const t = now();
  const over = await kv(db, 'hero:override');
  const live = over.found && (over.expires_at === null || over.expires_at === undefined || over.expires_at > t);
  const hero = live ? over.value : (await kv(db, 'hero:today')).value;
  const out: Rec = isObj(hero) ? { ...hero } : {};
  out.free_fixture_id = await freeFixtureId(db);
  const trap = (await kv(db, 'trap:today')).value;
  out.trap = isObj(trap) && digits(trap.kickoff) && Number(text(trap.kickoff)) > t ? trap : null;
  return out;
}

/** get_record(). */
export async function getRecord(db: D1Read): Promise<unknown> {
  const r = await kv(db, 'record:engine');
  return r.found ? r.value : { rows: [] };
}

/** get_how_sure(). */
export async function getHowSure(db: D1Read): Promise<Rec> {
  const s = await rows<{ p: number; result: string; kickoff: number }>(db, `SELECT model_prob AS p, result, kickoff FROM pick
    WHERE kind = 'CONFIDENT' AND settled_at IS NOT NULL
      AND result IN ('WON', 'HALF_WON', 'LOST', 'HALF_LOST') AND model_prob > 0 AND model_prob <= 1`);
  const landed = (x: { result: string }) => x.result === 'WON' || x.result === 'HALF_WON';
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const bands = new Map<number, Array<{ p: number; result: string }>>();
  for (const x of s) {
    const k = Math.min(10, Math.max(5, roundEven(x.p * 10)));
    bands.set(k, [...(bands.get(k) ?? []), x]);
  }
  return {
    n: s.length,
    landed: s.filter(landed).length,
    said: avg(s.map((x) => x.p)),
    from: s.length ? Math.min(...s.map((x) => x.kickoff)) : null,
    to: s.length ? Math.max(...s.map((x) => x.kickoff)) : null,
    bands: [...bands.entries()].sort((a, b) => b[0] - a[0])
      .map(([tenths, xs]) => ({ tenths, n: xs.length, landed: xs.filter(landed).length, said: avg(xs.map((x) => x.p)) })),
  };
}

/** get_leagues(): every competition we cover, and when each next plays. */
export async function getLeagues(db: D1Read): Promise<Rec[]> {
  const t = now();
  const [lg, sched, nexts] = await db.batch([
    db.prepare('SELECT id, name, country FROM league WHERE tracked = 1'),
    db.prepare('SELECT league_id, min(kickoff) AS next FROM schedule WHERE kickoff > ? GROUP BY league_id').bind(t),
    db.prepare(`SELECT k, v FROM kv WHERE k LIKE 'league:%:next'`),
  ]);
  const fromSchedule = new Map<number, number>();
  for (const r of (sched?.results ?? []) as Rec[]) fromSchedule.set(r.league_id, r.next);
  const fromList = new Map<string, number>();
  for (const r of (nexts?.results ?? []) as Rec[]) {
    const list = field(tryJson(r.v), 'rows');
    let best: number | null = null;
    for (const x of Array.isArray(list) ? list : []) {
      const k = field(x, 'kickoff');
      if (!digits(k)) continue;
      const v = Number(text(k));
      if (v > t && (best === null || v < best)) best = v;
    }
    if (best !== null) fromList.set(r.k, best);
  }
  const year = new Date(t * 1000).getUTCFullYear();
  const out: Rec[] = [];
  for (const l of (lg?.results ?? []) as Rec[]) {
    const m = /\s((?:19|20)[0-9]{2})$/.exec(l.name);
    const yr = m ? Number(m[1]) : null;
    const cands = [fromSchedule.get(l.id), fromList.get(`league:${l.id}:next`)].filter((x): x is number => typeof x === 'number');
    const next = cands.length ? Math.min(...cands) : null;
    if (yr !== null && next === null && yr < year) continue;
    const name = yr !== null && next !== null && yr < new Date(next * 1000).getUTCFullYear()
      ? l.name.replace(/\s+(19|20)[0-9]{2}$/, '') : l.name;
    out.push({ id: l.id, name, country: l.country || null, next });
  }
  return out.sort((a, b) => byName(a.name, b.name));
}

/** get_league(p_id): a competition's own page. */
export async function getLeague(db: D1Read, id: number, member = false): Promise<Rec> {
  const t = now();
  const [lg, st, sc, nx, ls, rec, recent] = await db.batch([
    db.prepare('SELECT id, name, country FROM league WHERE id = ?').bind(id),
    db.prepare('SELECT v FROM kv WHERE k = ?').bind(`league:${id}:standings`),
    db.prepare('SELECT v FROM kv WHERE k = ?').bind(`league:${id}:scorers`),
    db.prepare('SELECT v FROM kv WHERE k = ?').bind(`league:${id}:next`),
    db.prepare('SELECT v FROM kv WHERE k = ?').bind(`league:${id}:last`),
    db.prepare(`SELECT count(*) AS n, coalesce(sum(CASE WHEN pk.result IN ('WON', 'HALF_WON') THEN 1 ELSE 0 END), 0) AS wins
      FROM pick pk JOIN fixture f ON f.id = pk.fixture_id
      WHERE f.league_id = ? AND pk.kind = 'CONFIDENT' AND pk.settled_at IS NOT NULL AND pk.result IS NOT 'VOID'`).bind(id),
    db.prepare(`SELECT pk.fixture_id, f.kickoff, pk.market, pk.outcome, pk.line, pk.odds, pk.bookmaker, pk.result,
        f.home_team, f.away_team, f.home_goals, f.away_goals, f.home_team_id, f.away_team_id, f.report_json AS _report
      FROM pick pk JOIN fixture f ON f.id = pk.fixture_id
      WHERE f.league_id = ? AND pk.kind = 'CONFIDENT' AND pk.settled_at IS NOT NULL
      ORDER BY f.kickoff DESC LIMIT 24`).bind(id),
  ]);
  const val = (r: { results?: unknown[] } | undefined) => {
    const row = (r?.results ?? [])[0] as Rec | undefined;
    return row ? { found: true, value: tryJson(row.v) } : { found: false, value: null };
  };
  const rowsOf = (r: { results?: unknown[] } | undefined) => {
    const x = val(r);
    const list = field(x.value, 'rows');
    return x.found && list !== null ? list : [];
  };
  const standings = val(st);
  const srows = field(standings.value, 'rows');
  const table = Array.isArray(srows) ? srows : [];
  const teamIds = [...new Set(table.map((r) => num(field(r, 'team_id'))).filter((x): x is number => x !== null))];
  const names = new Map<number, string>();
  for (let i = 0; i < teamIds.length; i += 90) {
    const chunk = teamIds.slice(i, i + 90);
    for (const r of await rows<{ id: number; name: string }>(db, `SELECT id, name FROM team WHERE id IN (${inList(chunk.length)})`, ...chunk)) names.set(r.id, r.name);
  }
  const standingRows = table.map((r) => {
    const teamId = num(field(r, 'team_id'));
    return {
      team_id: teamId,
      team: (teamId !== null ? names.get(teamId) : undefined) ?? text(field(r, 'team_name')),
      position: num(field(r, 'position')), played: num(field(r, 'played')),
      won: num(field(r, 'won')), drawn: num(field(r, 'drawn')), lost: num(field(r, 'lost')),
      goals_for: num(field(r, 'goals_for')), goals_against: num(field(r, 'goals_against')),
      goal_diff: num(field(r, 'goal_diff')), points: num(field(r, 'points')),
      group: text(field(r, 'group')),
    };
  }).sort((a, b) => {
    if (a.group !== b.group) {
      if (a.group === null) return -1;
      if (b.group === null) return 1;
      return byName(a.group, b.group);
    }
    return (a.position ?? Infinity) - (b.position ?? Infinity);
  });
  const l = (lg?.results ?? [])[0] as Rec | undefined;
  const r = ((rec?.results ?? [])[0] ?? { n: 0, wins: 0 }) as Rec;
  const board = await getBoard(db, t - 3 * 86400, t + 10 * 86400, id, member);
  return {
    league: l ? { id: l.id, name: l.name, country: l.country } : null,
    standings: standingRows,
    standings_at: num(field(standings.value, 'updated_at')),
    scorers: rowsOf(sc),
    fixtures: board.fixtures,
    next: rowsOf(nx),
    last: rowsOf(ls),
    record: { n: r.n, wins: r.wins },
    recent: ((recent?.results ?? []) as Rec[]).map(({ _report, ...p }) => ({ ...p, goals: reportGoals(_report) })),
  };
}

/** get_player(p_id, p_league): built from the scorers lists and the match reports. */
export async function getPlayer(db: D1Read, id: number, leagueArg?: number | null): Promise<Rec> {
  const t = now();
  const key = String(id);
  const [lists, reports] = await db.batch([
    db.prepare(`SELECT k, v FROM kv WHERE k LIKE 'league:%:scorers' AND instr(v, ?) > 0`).bind(key),
    db.prepare(`SELECT f.id, f.kickoff, f.league_id, l.name AS league, f.home_team, f.away_team, f.home_team_id, f.away_team_id,
        f.home_goals, f.away_goals, f.report_json
      FROM fixture f LEFT JOIN league l ON l.id = f.league_id
      WHERE f.report_json IS NOT NULL AND f.home_goals IS NOT NULL AND f.kickoff > ? AND instr(f.report_json, ?) > 0`).bind(t - 240 * 86400, key),
  ]);
  const scorer: Array<{ league_id: number | null; rank: number; row: Rec }> = [];
  for (const k of (lists?.results ?? []) as Rec[]) {
    const m = /^league:(\d+):scorers$/.exec(k.k);
    if (!m) continue;
    const list = field(tryJson(k.v), 'rows');
    const all = Array.isArray(list) ? list : [];
    for (const e of all) {
      if (num(field(e, 'player_id')) !== id) continue;
      const g = num(field(e, 'goals')) ?? 0;
      scorer.push({ league_id: Number(m[1]), rank: 1 + all.filter((o) => (num(field(o, 'goals')) ?? 0) > g).length, row: e as Rec });
    }
  }
  const app: Rec[] = [];
  for (const f of (reports?.results ?? []) as Rec[]) {
    const r = tryJson(f.report_json);
    const players = field(r, 'players');
    if (!Array.isArray(players)) continue;
    const lineups = field(r, 'lineups');
    const side = (s: string) => { const p = field(field(lineups, s), 'players'); return Array.isArray(p) ? p : []; };
    const sheets = [...side('home'), ...side('away')];
    const sheet = sheets.find((sh) => num(field(sh, 'id')) === id) ?? null;
    for (const line of players) {
      if (num(field(line, 'id')) !== id) continue;
      app.push({ ...f, line, sheet });
    }
  }
  app.sort((a, b) => b.kickoff - a.kickoff);
  const withSheet = app.find((a) => a.sheet !== null);
  const theirId = num(field(app.find((a) => field(a.line, 'team_id') !== null)?.line, 'team_id'))
    ?? num(field(scorer.find((s) => field(s.row, 'team_id') !== null)?.row, 'team_id'));
  const byRank = [...scorer].sort((a, b) => a.rank - b.rank)[0];
  const lead = leagueArg ?? byRank?.league_id ?? app[0]?.league_id ?? null;

  const leagueIds = [...new Set([...scorer.map((s) => s.league_id), lead].filter((x): x is number => x !== null))];
  const leagueNames = new Map<number, string>();
  if (leagueIds.length) {
    for (const r of await rows<{ id: number; name: string }>(db, `SELECT id, name FROM league WHERE id IN (${inList(leagueIds.length)})`, ...leagueIds)) leagueNames.set(r.id, r.name);
  }
  let team: Rec | null = null;
  if (theirId !== null) {
    const a = app.find((x) => x.home_team_id === theirId || x.away_team_id === theirId);
    const fromScorer = text(field(scorer.find((s) => field(s.row, 'team_name') !== null)?.row, 'team_name'));
    const fromTable = a || fromScorer ? null : (await one<{ name: string }>(db, 'SELECT name FROM team WHERE id = ?', theirId))?.name ?? null;
    team = { id: theirId, name: a ? (a.home_team_id === theirId ? a.home_team : a.away_team) : (fromScorer ?? fromTable) };
  }
  const leadRows = lead === null ? { found: false, value: null } : await kv(db, `league:${lead}:scorers`);
  const leadList = field(leadRows.value, 'rows');
  const next = theirId === null ? [] : await rows(db, `SELECT f.id AS fixture_id, f.kickoff, f.home_team AS home, f.away_team AS away,
      f.home_team_id AS home_id, f.away_team_id AS away_id, l.name AS league
    FROM fixture f LEFT JOIN league l ON l.id = f.league_id
    WHERE (f.home_team_id = ? OR f.away_team_id = ?) AND f.kickoff > ? ORDER BY f.kickoff LIMIT 3`, theirId, theirId, t);
  const desc = (a: number | null, b: number | null) => (a === b ? 0 : a === null ? -1 : b === null ? 1 : b - a);
  const starting = (sheet: unknown) => {
    const s = text(field(sheet, 'starting'));
    return s === null ? true : ['true', 't', 'yes', 'y', 'on', '1'].includes(s.toLowerCase());
  };
  return {
    id,
    name: withSheet ? text(field(withSheet.sheet, 'name')) : text(field(scorer[0]?.row, 'name')),
    position: withSheet ? text(field(withSheet.sheet, 'position')) : null,
    number: withSheet ? num(field(withSheet.sheet, 'number')) : null,
    team,
    competitions: [...scorer]
      .sort((a, b) => (lead === null ? 0 : Number(b.league_id === lead) - Number(a.league_id === lead))
        || desc(num(field(a.row, 'goals')), num(field(b.row, 'goals'))))
      .map((s) => ({
        league_id: s.league_id, league: (s.league_id !== null ? leagueNames.get(s.league_id) : null) ?? null, rank: s.rank,
        goals: num(field(s.row, 'goals')), assists: num(field(s.row, 'assists')),
      })),
    lead_league: lead !== null && leagueNames.has(lead) ? { id: lead, name: leagueNames.get(lead) } : null,
    lead_scorers: leadRows.found && leadList !== null ? leadList : [],
    matches: app.slice(0, 12).map((a) => ({
      fixture_id: a.id, kickoff: a.kickoff, league: a.league, league_id: a.league_id,
      home: a.home_team, away: a.away_team, home_id: a.home_team_id, away_id: a.away_team_id,
      score: [a.home_goals, a.away_goals],
      minutes: num(field(a.line, 'minutes')), rating: num(field(a.line, 'rating')),
      goals: num(field(a.line, 'goals')), assists: num(field(a.line, 'assists')),
      yellow: num(field(a.line, 'yellow')), red: num(field(a.line, 'red')),
      started: starting(a.sheet),
    })),
    next,
  };
}

/** get_health(). */
export async function getHealth(db: D1Read): Promise<Rec> {
  const s = await one(db, `SELECT count(*) AS fixtures, sum(CASE WHEN board_free_json IS NULL THEN 1 ELSE 0 END) AS without_free_copy,
    max(computed_at) AS last FROM fixture`);
  const age = s?.last === null || s?.last === undefined ? null : Math.round((Date.now() / 1000 - s.last) / 60);
  return {
    ok: true,
    fixtures: s?.fixtures ?? 0,
    last_computed_minutes_ago: age,
    stale: age === null || age > 120,
    unwalled: s?.without_free_copy ?? 0,
  };
}

/** get_plans(). */
export async function getPlans(db: D1Read): Promise<Rec[]> {
  return rows(db, 'SELECT id, name, days, amount_minor, currency, checkout_url FROM plan WHERE active = 1 ORDER BY sort');
}

/** get_promos(). */
export async function getPromos(db: D1Read): Promise<Rec[]> {
  const t = now();
  const got = await rows(db, `SELECT p.*, pl.id AS pl_id, pl.name AS pl_name, pl.days AS pl_days, pl.amount_minor AS pl_amount, pl.currency AS pl_currency
    FROM promo p LEFT JOIN plan pl ON pl.id = p.plan_id AND pl.active = 1
    WHERE p.active = 1 AND p.starts_at <= ? AND p.ends_at > ?
      AND (p.plan_id IS NULL OR pl.id IS NOT NULL)
      AND (p.kind <> 'deal' OR p.price_minor < pl.amount_minor)
    ORDER BY p.starts_at DESC`, t, t);
  return got.map((p) => ({
    id: p.id, kind: p.kind, title: p.title, body: p.body, cta: p.cta,
    plan_id: p.plan_id, price_minor: p.price_minor, trial_days: p.trial_days,
    audience: p.audience, ends_at: p.ends_at,
    plan: p.pl_id === null ? null : { id: p.pl_id, name: p.pl_name, days: p.pl_days, amount_minor: p.pl_amount, currency: p.pl_currency },
  }));
}

/** get_pulled(p_limit): calls pulled before kick-off, the latest pull of each. */
export async function getPulled(db: D1Read, limit = 20): Promise<Rec[]> {
  return rows(db, `SELECT fixture_id, kickoff, home, away, home_team_id, away_team_id, label, odds, bookmaker, reason, pulled_at,
      after_result, after_home, after_away FROM (
      SELECT pc.fixture_id, coalesce(f.kickoff, pc.kickoff) AS kickoff, pc.home, pc.away,
             f.home_team_id, f.away_team_id, pc.label, pc.odds, pc.bookmaker, pc.reason, pc.pulled_at,
             pc.after_result, pc.after_home, pc.after_away,
             row_number() OVER (PARTITION BY pc.fixture_id, pc.market, pc.outcome, pc.line ORDER BY pc.pulled_at DESC) AS nth
        FROM pulled_call pc LEFT JOIN fixture f ON f.id = pc.fixture_id
       WHERE pc.restored_at IS NULL AND coalesce(f.kickoff, pc.kickoff) < ?
         AND NOT EXISTS (SELECT 1 FROM pick p WHERE p.fixture_id = pc.fixture_id AND p.kind = 'CONFIDENT'
               AND p.market = pc.market AND p.outcome = pc.outcome AND p.line IS pc.line))
    WHERE nth = 1 ORDER BY kickoff DESC LIMIT ?`, now(), Math.max(1, Math.min(limit || 20, 60)));
}

/** slip_legs(): each leg as its match stands now. */
async function slipLegs(db: D1Read, legsJson: unknown): Promise<Rec[]> {
  const legs = tryJson(legsJson);
  if (!Array.isArray(legs) || !legs.length) return [];
  const ids = [...new Set(legs.map((l) => num(field(l, 'fixture_id'))).filter((x): x is number => x !== null))];
  const fx = new Map<number, Rec>();
  const picks: Rec[] = [];
  if (ids.length) {
    for (const f of await rows(db, `SELECT id, status, home_goals, away_goals, live_home, live_away, live_minute FROM fixture WHERE id IN (${inList(ids.length)})`, ...ids)) fx.set(f.id, f);
    picks.push(...await rows(db, `SELECT fixture_id, market, outcome, line, result, settled_at FROM pick WHERE kind = 'CONFIDENT' AND fixture_id IN (${inList(ids.length)})`, ...ids));
  }
  return legs.map((leg) => {
    const fid = num(field(leg, 'fixture_id'));
    const f = fid === null ? undefined : fx.get(fid);
    const line = num(field(leg, 'line'));
    const same = (pk: Rec) => pk.market === text(field(leg, 'market')) && pk.outcome === text(field(leg, 'outcome'))
      && (pk.line === null ? line === null : line !== null && pk.line === line);
    const done = f && f.home_goals !== null && f.away_goals !== null;
    return {
      ...(isObj(leg) ? leg : {}),
      status: f?.status ?? null,
      score: done ? [f.home_goals, f.away_goals] : null,
      live_score: f && !done && f.live_home !== null && f.live_away !== null ? [f.live_home, f.live_away] : null,
      live_minute: f?.live_minute ?? null,
      result: f ? (picks.find((pk) => pk.fixture_id === f.id && pk.settled_at !== null && same(pk))?.result ?? null) : null,
      withdrawn: !picks.some((pk) => pk.fixture_id === fid && same(pk)),
    };
  });
}

/** get_slip(). */
export async function getSlip(db: D1Read, member = false): Promise<Rec> {
  const [cur, recent, rec] = await db.batch([
    db.prepare('SELECT id, odds, chance, first_kickoff, legs_json FROM slip WHERE settled_at IS NULL ORDER BY created_at DESC LIMIT 1'),
    db.prepare('SELECT id, odds, chance, result, first_kickoff, legs_json FROM slip WHERE settled_at IS NOT NULL ORDER BY first_kickoff DESC LIMIT 10'),
    db.prepare(`SELECT count(*) AS n, coalesce(sum(CASE WHEN result = 'WON' THEN 1 ELSE 0 END), 0) AS won FROM slip WHERE settled_at IS NOT NULL AND result IN ('WON', 'LOST')`),
  ]);
  const c = (cur?.results ?? [])[0] as Rec | undefined;
  const legs = c ? tryJson(c.legs_json) : null;
  const r = ((rec?.results ?? [])[0] ?? { n: 0, won: 0 }) as Rec;
  return {
    member,
    current: c ? {
      id: c.id, odds: c.odds, chance: c.chance, first_kickoff: c.first_kickoff,
      legs_count: Array.isArray(legs) ? legs.length : null,
      legs: member ? await slipLegs(db, c.legs_json) : null,
    } : null,
    recent: await Promise.all(((recent?.results ?? []) as Rec[]).map(async (s) => ({
      id: s.id, odds: s.odds, chance: s.chance, result: s.result, first_kickoff: s.first_kickoff, legs: await slipLegs(db, s.legs_json),
    }))),
    record: { n: r.n, won: r.won },
  };
}

/** get_account() for a reader with no account, which in stage 1 is every reader. */
export function getAccountSignedOut(): Rec {
  return { email: null, membership: null, returning: false, whop: null, receipts: [], profile: null, follows: [] };
}

export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

/** has_membership() for one account: a live card membership, or a live entitlement on its email. */
export async function hasMembership(db: D1Read, id: string, email: string): Promise<boolean> {
  const t = now();
  const r = await one<{ ok: number }>(db, `SELECT (
      EXISTS (SELECT 1 FROM membership WHERE user_id = ? AND expires_at > ?)
      OR EXISTS (SELECT 1 FROM entitlement WHERE lower(email) = lower(?) AND status = 'active' AND expires_at > ?)
    ) AS ok`, id, t, email, t);
  return Boolean(r?.ok);
}

const PROFILE_COLS = `display_name, odds_format, avatar_style, avatar_color, club_id, club_name, clock, username, call_alerts`;

/** get_account() for a signed-in reader. */
export async function getAccount(db: D1Read, v: { id: string; email: string }): Promise<Rec> {
  const t = now();
  const email = v.email.toLowerCase();
  const [live, card, whop, receipts, profile, follows, back] = await db.batch([
    db.prepare(`SELECT plan_id, expires_at, auto_renew, cancelled_at, card_brand, card_last4, via, manage_url FROM (
        SELECT plan_id, expires_at, auto_renew, cancelled_at, card_brand, card_last4, 'card' AS via, NULL AS manage_url
          FROM membership WHERE user_id = ? AND expires_at > ?
        UNION ALL
        SELECT plan_id, expires_at,
               CASE WHEN renew_stopped_at IS NULL AND plan_id <> 'matchday' THEN 1 ELSE 0 END,
               renew_stopped_at, source, NULL, source, manage_url
          FROM entitlement WHERE lower(email) = ? AND status = 'active' AND expires_at > ?)
      ORDER BY expires_at DESC LIMIT 1`).bind(v.id, t, email, t),
    db.prepare(`SELECT plan_id, expires_at, auto_renew, cancelled_at, card_brand, card_last4, 'card' AS via
      FROM membership WHERE user_id = ?`).bind(v.id),
    db.prepare(`SELECT manage_url, expires_at FROM entitlement
      WHERE lower(email) = ? AND status = 'active' AND source = 'whop' AND plan_id <> 'matchday'
        AND renew_stopped_at IS NULL AND expires_at > ? LIMIT 1`).bind(email, t),
    db.prepare(`SELECT created_at, plan_id, amount_minor, currency, status FROM payment
      WHERE user_id = ? ORDER BY created_at DESC LIMIT 24`).bind(v.id),
    db.prepare(`SELECT ${PROFILE_COLS} FROM profile WHERE user_id = ?`).bind(v.id),
    db.prepare('SELECT kind, ref_id AS id, label FROM follow WHERE user_id = ? ORDER BY created_at').bind(v.id),
    db.prepare(`SELECT (
        EXISTS (SELECT 1 FROM membership WHERE user_id = ?)
        OR EXISTS (SELECT 1 FROM payment WHERE user_id = ?)
        OR EXISTS (SELECT 1 FROM entitlement WHERE email = ?)
        OR EXISTS (SELECT 1 FROM former_member WHERE email_sha256 = ?)) AS ok`)
      .bind(v.id, v.id, email, await sha256Hex(email.trim())),
  ]);
  const first = (r: { results?: unknown[] } | undefined) => ((r?.results ?? [])[0] as Rec | undefined) ?? null;
  const w = first(whop);
  const p = first(profile);
  return {
    email: v.email,
    membership: first(live) ?? first(card),
    returning: Boolean(first(back)?.ok),
    whop: w ? { renewing: true, manage_url: w.manage_url, until: w.expires_at } : null,
    receipts: (receipts?.results ?? []) as Rec[],
    profile: p ? { ...p, call_alerts: p.call_alerts === null ? null : Boolean(p.call_alerts) } : null,
    follows: (follows?.results ?? []) as Rec[],
  };
}

/** record_view(): one more view of a page today, London time. */
export async function recordView(db: D1Read, page: string): Promise<void> {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  await db.batch([db.prepare(`INSERT INTO page_view (day, page, n) VALUES (?, ?, 1)
    ON CONFLICT (day, page) DO UPDATE SET n = n + 1`).bind(day, page)]);
}

type Args = Record<string, string | number | undefined>;

/** Who is reading: an account and whether it holds a live membership. */
export interface Viewer { id: string; email: string; member: boolean }
const int = (v: unknown) => (v === undefined || v === null || v === '' ? null : Number(v));

/**
 * The Postgres function name and its PostgREST arguments, answered from D1.
 * Undefined means this function is not served from D1 (yet), and the caller
 * should say so rather than guess.
 */
export async function serve(db: D1Read, fn: string, args: Args, viewer: Viewer | null = null): Promise<unknown> {
  const member = viewer?.member ?? false;
  switch (fn) {
    case 'get_board': return getBoard(db, Number(args.p_from), Number(args.p_to), int(args.p_league), member);
    case 'get_fixture': return getFixture(db, Number(args.p_id), member);
    case 'get_picks': return getPicks(db, int(args.p_limit) ?? 60, args.p_settled === undefined ? null : String(args.p_settled), member);
    case 'get_model': return getModel(db);
    case 'get_hero': return getHero(db);
    case 'get_record': return getRecord(db);
    case 'get_how_sure': return getHowSure(db);
    case 'get_leagues': return getLeagues(db);
    case 'get_league': return getLeague(db, Number(args.p_id), member);
    case 'get_player': return getPlayer(db, Number(args.p_id), int(args.p_league));
    case 'get_team': return getTeam(db, Number(args.p_id), member);
    case 'search_games': return searchGames(db, String(args.p_q ?? ''), member);
    case 'get_health': return getHealth(db);
    case 'get_plans': return getPlans(db);
    case 'get_promos': return getPromos(db);
    case 'get_pulled': return getPulled(db, int(args.p_limit) ?? 20);
    case 'get_slip': return getSlip(db, member);
    case 'get_account': return viewer ? getAccount(db, viewer) : getAccountSignedOut();
    case 'fixture_preview': return fixturePreview(db, Number(args.p_id));
    default: return undefined;
  }
}

/** Every function `serve` answers, for the verifier. */
export const SERVED = ['get_board', 'get_fixture', 'get_picks', 'get_model', 'get_hero', 'get_record', 'get_how_sure',
  'get_leagues', 'get_league', 'get_player', 'get_team', 'search_games', 'get_health', 'get_plans', 'get_promos',
  'get_pulled', 'get_slip', 'fixture_preview'] as const;
