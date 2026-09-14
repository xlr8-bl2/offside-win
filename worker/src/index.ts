/**
 * offside.win — the read side.
 *
 * This Worker computes nothing. Every number it serves was produced by the
 * engine on GitHub Actions and written to D1 as finished JSON, so a request is
 * one indexed row read and a string returned. That is what keeps it inside
 * Cloudflare's free tier, where the CPU limit is 10 ms for cron triggers exactly
 * as it is for HTTP requests — there is no longer-running free handler to hide
 * heavy work in.
 *
 * It also holds no secrets. The provider key and the D1 write token live in
 * Actions; the Worker has a read binding and nothing else, so there is nothing
 * here worth stealing.
 */

interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
}

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  // Short edge cache: the slate refreshes every 30 minutes, and a stale board
  // for a minute is better than a thundering herd on D1.
  'cache-control': 'public, max-age=60, stale-while-revalidate=300',
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

function fail(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

/** Rows store pre-rendered JSON; splice it into the response without parsing. */
function rawArray(values: string[]): string {
  return `[${values.join(',')}]`;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (!path.startsWith('/api/')) {
      return env.ASSETS.fetch(request);
    }

    try {
      if (path === '/api/board') return await board(url, env);
      if (path.startsWith('/api/fixture/')) return await fixture(path, env);
      if (path === '/api/picks') return await picks(url, env);
      if (path === '/api/model') return await model(env);
      if (path === '/api/health') return await health(env);
      return fail('not found', 404);
    } catch (err) {
      return fail(err instanceof Error ? err.message : 'internal error', 500);
    }
  },
} satisfies ExportedHandler<Env>;

async function board(url: URL, env: Env): Promise<Response> {
  const now = Math.floor(Date.now() / 1000);
  const hours = Math.min(240, Math.max(1, Number(url.searchParams.get('hours') ?? 72)));
  const league = url.searchParams.get('league');

  const from = now - 6 * 3600;
  const to = now + hours * 3600;

  const stmt = league
    ? env.DB.prepare(
        `SELECT board_json FROM fixture WHERE kickoff BETWEEN ? AND ? AND league_id = ?
         ORDER BY kickoff ASC LIMIT 300`,
      ).bind(from, to, Number(league))
    : env.DB.prepare(
        `SELECT board_json FROM fixture WHERE kickoff BETWEEN ? AND ?
         ORDER BY kickoff ASC LIMIT 300`,
      ).bind(from, to);

  const { results } = await stmt.all<{ board_json: string }>();
  const body = `{"generated_at":${now},"count":${results.length},"fixtures":${rawArray(
    results.map((r) => r.board_json),
  )}}`;
  return new Response(body, { headers: JSON_HEADERS });
}

async function fixture(path: string, env: Env): Promise<Response> {
  const id = Number(path.slice('/api/fixture/'.length));
  if (!Number.isFinite(id)) return fail('bad fixture id', 400);

  const row = await env.DB.prepare('SELECT bundle_json FROM fixture WHERE id = ?')
    .bind(id)
    .first<{ bundle_json: string }>();

  if (!row) return fail('fixture not found or not yet analysed', 404);
  return new Response(row.bundle_json, { headers: JSON_HEADERS });
}

async function picks(url: URL, env: Env): Promise<Response> {
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit') ?? 60)));
  const settled = url.searchParams.get('settled');

  const where =
    settled === 'true' ? 'WHERE settled_at IS NOT NULL'
    : settled === 'false' ? 'WHERE settled_at IS NULL'
    : '';

  const { results } = await env.DB.prepare(
    `SELECT p.id, p.fixture_id, p.kickoff, p.market, p.outcome, p.line, p.kind,
            p.model_prob, p.book_prob, p.edge, p.odds, p.bookmaker, p.kelly,
            p.confidence, p.provisional, p.narrative, p.result, p.pnl,
            f.home_team, f.away_team
     FROM pick p LEFT JOIN fixture f ON f.id = p.fixture_id
     ${where}
     ORDER BY p.kickoff DESC LIMIT ?`,
  )
    .bind(limit)
    .all();

  // Running totals over settled picks. Cheap here — a few hundred rows of
  // arithmetic, nowhere near the CPU budget — and it is the number a reader
  // actually wants to see first.
  const summary = await env.DB.prepare(
    `SELECT COUNT(*) AS n,
            SUM(CASE WHEN result IN ('WON','HALF_WON') THEN 1 ELSE 0 END) AS wins,
            SUM(pnl) AS pnl,
            AVG(odds) AS avg_odds
     FROM pick WHERE settled_at IS NOT NULL AND result != 'VOID'`,
  ).first();

  return json({ summary, picks: results });
}

async function model(env: Env): Promise<Response> {
  const [calibration, backtest, leagues, meta] = await Promise.all([
    env.DB.prepare('SELECT * FROM calibration ORDER BY market_family').all(),
    env.DB.prepare('SELECT label, report_json, created_at FROM backtest ORDER BY created_at DESC LIMIT 1').first<{
      label: string;
      report_json: string;
      created_at: number;
    }>(),
    env.DB.prepare(
      `SELECT rm.league_id, l.name, rm.home_adv, rm.rho, rm.xi, rm.mean_goals,
              rm.n_matches, rm.fitted_at
       FROM rating_meta rm LEFT JOIN league l ON l.id = rm.league_id
       ORDER BY rm.n_matches DESC`,
    ).all(),
    env.DB.prepare("SELECT k, v FROM kv WHERE k LIKE '%:last_run' OR k LIKE 'ratings:%'").all<{
      k: string;
      v: string;
    }>(),
  ]);

  return json({
    calibration: calibration.results,
    leagues: leagues.results,
    runs: Object.fromEntries(
      (meta.results ?? []).map((r) => [r.k, safeParse(r.v)]),
    ),
    backtest: backtest
      ? { label: backtest.label, created_at: backtest.created_at, report: safeParse(backtest.report_json) }
      : null,
  });
}

async function health(env: Env): Promise<Response> {
  const row = await env.DB.prepare(
    'SELECT COUNT(*) AS fixtures, MAX(computed_at) AS latest FROM fixture',
  ).first<{ fixtures: number; latest: number | null }>();

  const now = Math.floor(Date.now() / 1000);
  const ageMinutes = row?.latest ? Math.round((now - row.latest) / 60) : null;

  return json({
    ok: true,
    fixtures: row?.fixtures ?? 0,
    last_computed_minutes_ago: ageMinutes,
    // The slate runs every 30 minutes; much older than that means Actions is
    // not running, which is the failure this endpoint exists to surface.
    stale: ageMinutes === null || ageMinutes > 120,
  });
}

function safeParse(v: string): unknown {
  try {
    return JSON.parse(v);
  } catch {
    return v;
  }
}
