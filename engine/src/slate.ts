import { backsRotatedSide } from './context/xi.ts';
import { chanceInWords, openSlipLegs, refreshSlip } from './slip.ts';
import { bsdList, bsdOrNull, num, str, stats as bsdStats, toEpoch } from './bsd.ts';
import { config } from './config.ts';
import { analyseFixture } from './context/index.ts';
import { checkComparisonEntitlement, gatherFixture, parseScorers } from './context/gather.ts';
import { RepetitionLedger, narrate, narrateConfident, narratePass } from './narrate/compose.ts';
import { chooseHero, type HeroCandidate } from './feature.ts';
import { chooseFreeCall } from './free.ts';
import { chooseTrap, trapFor, type Trap } from './trap.ts';
import { callName, pullReason, QUIET_IF_YOUNGER_S, type PullContext } from './pulled.ts';
import { writeMissingReports } from './report.ts';
import { fillCrestColors } from './images/crest.ts';
import { fillVenues } from './context/venue.ts';
import { refreshSchedule } from './schedule.ts';
import { pubFacts } from './narrate/facts.ts';
import { forBundle } from './context/players.ts';
import { gatherExtras, type Extras } from './context/extras.ts';
import { refreshLeagueInfo } from './leagueinfo.ts';
import { geminiWriter } from './narrate/gemini.ts';
import { fromReads } from './narrate/rescue.ts';
import { budgeted, keyId, spent, todays, type BudgetState } from './narrate/budget.ts';
import { write, type Writer } from './narrate/write.ts';
import { freeBoard, freeBundle } from './membership/redact.ts';
import { parsePrediction, providerMarkets } from './provider-model.ts';
import { bucketOf, buildCandidates, confidentEligible, confidentHolds, DayMix, whyNoCall, type NoCallReason, driversFor, floorForRank, isLean, marketLabel, rankConfident, select, setAsideFor, type CalibrationMap } from './select.ts';
import { consensusMarkets } from './consensus.ts';
import { readOf } from './read.ts';
import { snapshotOf } from './odds.ts';
import { pushRuleFor } from './price.ts';
import { dbStats, exec as dbExec, insertMany, kvGetJSON, kvSetJSON, pickConflictTarget, select as dbSelect } from './store.ts';
import type { CalibrationRow } from './select.ts';
import { MARKET_FAMILY, type Candidate, type Factor, type MarketFamily } from './types.ts';

/**
 * The slate: price the next few days, publish the board.
 *
 * Everything here runs on GitHub Actions and writes finished JSON to D1. The
 * Worker reads those rows and serves them, which is why it stays inside the free
 * tier's 10 ms of CPU — there is nothing left for it to compute.
 */

export async function loadCalibration(): Promise<CalibrationMap> {
  const rows = await dbSelect<{
    market_family: MarketFamily;
    n: number;
    shrink: number;
    mean_model_p: number | null;
    mean_actual: number | null;
  }>('SELECT market_family, n, shrink, mean_model_p, mean_actual FROM calibration');
  const map = new Map(rows.map((r) => [r.market_family, { ...r } as CalibrationRow]));

  /*
   * The overclaim the confident floor charges is measured on published calls,
   * not on everything the engine ever considered.
   *
   * The calibration table is built from every verdict -- value leans at 55%,
   * handicaps nobody saw, the lot -- and those are far more overconfident than
   * the calls that clear an 80% floor. Charging that family-wide gap to the
   * floor made a result call need 93% before it could be published, which is
   * above the price ceiling, so from the 22nd onwards the slate analysed a
   * hundred and seventy fixtures a run and published nothing at all. Measured
   * on the calls themselves, result calls had been claiming 82.8% and landing
   * 81.4%: honest to within a point and a half, and being fined thirteen.
   *
   * `shrink` still comes from the full table -- it scales edges, which is a
   * question about every candidate. Only the floor's penalty is re-based.
   *
   * And only on calls the rule running now has made (config.confident.
   * overconfidenceSince). A family with none yet is not charged: falling back
   * to the family figure, or to calls from an earlier engine, is how
   * handicaps came to need 104% and stopped being called at all.
   */
  const called = await dbSelect<{ market: string; model_prob: number; result: string }>(
    `SELECT market, model_prob, result FROM pick
     WHERE kind = 'CONFIDENT' AND settled_at IS NOT NULL AND created_at >= ?
       AND result IN ('WON', 'LOST', 'HALF_WON', 'HALF_LOST')`,
    [config.confident.overconfidenceSince],
  );
  const acc = new Map<MarketFamily, { n: number; p: number; hit: number }>();
  for (const c of called) {
    const fam = MARKET_FAMILY[c.market as keyof typeof MARKET_FAMILY];
    if (!fam) continue;
    const a = acc.get(fam) ?? { n: 0, p: 0, hit: 0 };
    a.n++;
    a.p += c.model_prob;
    a.hit += c.result === 'WON' ? 1 : c.result === 'HALF_WON' ? 0.5 : 0;
    acc.set(fam, a);
  }
  for (const [fam, row] of map) {
    const a = acc.get(fam);
    row.n = a?.n ?? 0;
    row.mean_model_p = a ? a.p / a.n : null;
    row.mean_actual = a ? a.hit / a.n : null;
  }
  return map;
}

/** Trim a factor for storage: the ledger is for reading, not for re-running. */
function forStorage(f: Factor) {
  return {
    id: f.id,
    section: f.section,
    tier: f.tier,
    state: f.state,
    note: f.note,
    evidence: f.evidence,
    strength: Number(f.strength.toFixed(3)),
    moves: f.adjustments
      .filter((a) => Math.abs(a.multiplier - 1) > 1e-4)
      .map((a) => ({ channel: a.channel, side: a.side, pct: Number(((a.multiplier - 1) * 100).toFixed(1)) })),
  };
}

function candidateForStorage(c: Candidate) {
  return {
    market: c.market,
    outcome: c.outcome,
    line: c.line,
    push: c.push,
    model_prob: Number(c.model_prob.toFixed(4)),
    book_prob: Number(c.book_prob.toFixed(4)),
    edge: Number(c.edge.toFixed(4)),
    shrunk_edge: Number(c.shrunk_edge.toFixed(4)),
    odds: c.odds,
    bookmaker: c.bookmaker,
    prices: c.prices,
    kelly: Number(c.kelly.toFixed(4)),
    confidence: Number(c.confidence.toFixed(3)),
    family: c.family,
  };
}

export interface SlateReport {
  fixtures: number;
  analysed: number;
  picks: number;
  /** Of those picks, how many are high-confidence calls rather than value bets. */
  confident: number;
  passes: number;
  skipped: number;
  requests: number;
  d1Queries: number;
}

/** Lower is more prominent. Unlisted leagues sort behind every ranked one. */
export function leagueRank(leagueId: number): number {
  return config.leagueRank[leagueId] ?? config.unrankedLeague;
}

/**
 * A written narrative is keyed on the call, not on the fixture.
 *
 * This matters more than it looks. The slate runs every fifteen minutes --
 * ninety-six times a day -- and regenerating a paragraph on every pass would
 * mean thousands of requests a day to rewrite prose that has not changed,
 * which no free allowance survives and which was the plan's arithmetic being
 * quietly wrong by two orders of magnitude.
 *
 * So the key is the thing the writing is about: the fixture and the exact
 * selection. Reprice the same fixture and get the same call, and the paragraph
 * is reused. Change the call -- a different market, a different line, a
 * different side -- and it is written again, because it is now about something
 * else. Team news arriving hours later changes the evidence but not usually the
 * call, and re-reading a preview because a full-back is fit is not worth a
 * request.
 */
export function narrativeKey(fixtureId: number, c: Candidate, news = ''): string {
  return `narr:${fixtureId}:${c.market}:${c.outcome}:${c.line ?? ''}${news ? `:${fnv(news)}` : ''}`;
}

/**
 * The team news a paragraph was written against: who is out, and whether the
 * sheets are confirmed. A paragraph that says a striker is fit is wrong the
 * moment he is ruled out, so a change here is worth a rewrite; nothing else
 * about the fixture moves often enough to be.
 */
export function teamNews(lineups: { status?: string; unavailable?: Array<{ id: number }> } | null | undefined): string {
  const out = (lineups?.unavailable ?? []).map((u) => u.id).sort((a, b) => a - b);
  return `p2|${lineups?.status === 'confirmed' ? 'c' : 'p'}|${out.join(',')}`;
}

function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36);
}

/** Long enough to outlive a fixture's build-up, short enough to expire. */
const NARRATIVE_TTL = 14 * 86_400;
/** How far ahead a match with no call gets a preview: today, then tomorrow. */
const PREVIEW_AHEAD = 48 * 3600;
/** Requests a day never spent on previews, so a late call always has one. */
const PREVIEW_RESERVE = 60;

/**
 * The call, in words a person would use.
 *
 * marketLabel() speaks in market names because the ledger needs them to be
 * exact. The writer needs the opposite: it is told never to mention the call,
 * so this is only context, and context reads better without HOME and AWAY in
 * it.
 */
function plainCall(c: Candidate, home: string, away: string): string {
  return marketLabel(c)
    .replace(/\bhome\b/gi, home)
    .replace(/\baway\b/gi, away)
    .replace(/\bHOME\b/g, home)
    .replace(/\bAWAY\b/g, away);
}

/**
 * The writer, when there is a key for one.
 *
 * Absent means the grammar keeps writing, which is a worse product and a
 * working one. A slate that refused to run without an optional key would be a
 * site that stops publishing because a free quota lapsed.
 */
/*
 * The models, best first. Google's free tier gives each model its own twenty
 * requests a day, so the writer works down this list (see budgeted). All are
 * current Flash models the key could call on 26 September 2026 (gemini:check
 * lists them); a retired one answers 404 and is skipped for the day.
 * GEMINI_MODELS replaces the list; GEMINI_MODEL puts one model first.
 */
const MODELS = ['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash',
  'gemini-3-flash-preview', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'];

function buildWriters(): Array<{ model: string; writer: Writer }> | null {
  const apiKey = process.env['GEMINI_API_KEY'];
  if (!apiKey) return null;
  const listed = (process.env['GEMINI_MODELS'] || '').split(',').map((m) => m.trim()).filter(Boolean);
  const first = process.env['GEMINI_MODEL']?.trim();
  const models = [...new Set([...(first ? [first] : []), ...(listed.length ? listed : MODELS)])];
  return models.map((model) => ({
    model,
    writer: geminiWriter({
      apiKey,
      model,
      // Gentle enough for the free tier's per-minute limit on any flash model.
      ratePerMinute: Number(process.env['GEMINI_RPM'] || 8),
    }),
  }));
}

/**
 * Run `fn` over `items` up to `window` ahead of the one being asked for.
 * Each result is handed out once, in order; a failure surfaces when its turn
 * comes, not before.
 */
export function ahead<T, R>(items: T[], fn: (t: T) => Promise<R>, window: number): (i: number) => Promise<R> {
  const started = new Map<number, Promise<R>>();
  const start = (i: number) => {
    if (i >= items.length || started.has(i)) return;
    const p = fn(items[i]!);
    p.catch(() => undefined); // observed when its turn comes
    started.set(i, p);
  };
  return (i: number) => {
    for (let k = i; k < i + Math.max(1, window); k++) start(k);
    const p = started.get(i)!;
    started.delete(i);
    return p;
  };
}

/**
 * `fresh` chooses every call still to kick off again from nothing: the calls
 * standing from earlier runs get no say in the choice, and a slip whose first
 * game has not started is taken down so one is built from the new calls. For
 * a change of engine, when the calls should be the new engine's own. A match
 * that has been called off still keeps what it had, and so does a slip
 * already under way.
 */
export async function runSlate({ fresh = false }: { fresh?: boolean } = {}): Promise<SlateReport> {
  const now = Math.floor(Date.now() / 1000);

  // The day's allowance, across every run (see narrate/budget.ts). Set
  // GEMINI_PER_DAY to the model's free requests-per-day, less some headroom.
  const perDay = Number(process.env['GEMINI_PER_DAY'] || 200);
  const geminiKey = process.env['GEMINI_API_KEY'];
  const budget: BudgetState = todays(await kvGetJSON<BudgetState>('gemini:budget'), undefined,
    geminiKey ? await keyId(geminiKey) : undefined);
  // Twenty a day per model on the free tier, in Google's own words.
  const perModel = Number(process.env['GEMINI_PER_MODEL'] || 20);
  const chain = buildWriters();
  const models = chain?.map((c) => c.model) ?? [];
  const rawWriter = chain ? { name: `gemini (${models.join(', ')})` } : null;
  const writer = chain && !spent(budget, perDay, models, perModel) ? budgeted(chain, budget, perDay, perModel) : null;
  if (rawWriter && !writer) {
    console.log(`Narratives: today's Gemini allowance is spent on every model (${budget.used}/${perDay}`
      + `${budget.pausedUntil ? `, paused after Google refused until ${new Date(budget.pausedUntil * 1000).toISOString().slice(11, 16)} UTC` : ''}). The grammar writes until then.`);
  }

  // Counted rather than assumed. A silent drift back to template prose is
  // exactly the failure worth noticing, and it is invisible on the page --
  // the old voice still reads like writing, just worse.
  let narrateAttempts = 0;
  let narrateWritten = 0;
  const narrateRejections: Record<string, number> = {};
  // Which numbers the drafts reached for that no fact carried: what the
  // writer's brief or the idiom list should learn from next.
  const narrateUnbacked: Record<string, number> = {};

  // A bad key, a wrong model name or a spent quota fails every call in exactly
  // the same way, and the limiter paces them four seconds apart -- so without
  // this, a misconfigured run spends eight minutes discovering the same thing
  // a hundred and twenty times. Three provider errors in a row and the run
  // stops asking, says why once, and lets the grammar finish the slate.
  let consecutiveErrors = 0;
  let narrateReused = 0;
  let writerGaveUp: string | null = null;
  /*
   * New write-ups per run. The slate runs every quarter of an hour and a
   * write-up is kept for the life of the call, so a dozen a run is well over
   * a hundred a day: every call on the board gets one within a few runs,
   * without a single run spending the free tier's daily allowance in one go.
   * Soonest kick-offs are written first (see the candidate order), so the
   * matches about to be read are the ones that get the writing.
   */
  const perRun = Number(process.env['GEMINI_PER_RUN'] || 12);
  // Previews of matches with no call: a few a run, from what the calls leave.
  const previewsPerRun = Number(process.env['GEMINI_PREVIEWS_PER_RUN'] || 6);
  let previewAttempts = 0;
  let previewsWritten = 0;
  let previewsReused = 0;
  // Built from the reads (narrate/rescue.ts) where the writer could not help.
  let narrateRescued = 0;
  let previewsRescued = 0;
  const previewRejections: Record<string, number> = {};
  const from = new Date((now - config.slate.lookbackHours * 3600) * 1000).toISOString();
  const to = new Date((now + config.slate.horizonHours * 3600) * 1000).toISOString();

  const events = await bsdList<Record<string, unknown>>(
    '/api/v2/events/',
    { date_from: from, date_to: to },
    { limit: 200, max: 2000 },
  );

  // Only fixtures in leagues we have actually fitted; an unfitted league means
  // no opinion of our own, and an opinion is the entire product.
  const fitted = new Set(
    (await dbSelect<{ league_id: number }>('SELECT league_id FROM rating_meta')).map((r) => r.league_id),
  );

  const candidates = events.filter((e) => {
    const lid = num(e['league_id']);
    return lid !== undefined && fitted.has(lid);
  });

  console.log(
    `${events.length} fixtures in window, ${candidates.length} in leagues with fitted ratings`,
  );

  if (candidates.length === 0) {
    return { fixtures: events.length, analysed: 0, picks: 0, confident: 0, passes: 0, skipped: events.length, requests: bsdStats.requests, d1Queries: dbStats.queries };
  }

  // Probe the paid-tier entitlement once per run rather than per fixture.
  const sampleId = num(candidates[0]!['id']);
  const entitled = sampleId !== undefined ? await checkComparisonEntitlement(sampleId) : false;

  const calibration = await loadCalibration();

  // The anti-repetition ledger spans the whole slate and persists between runs,
  // so two fixtures on the same day cannot open with the same construction and
  // neither can today's board and yesterday's.
  const ledgerSeed = (await kvGetJSON<string[]>('narrate:ledger')) ?? [];
  const ledger = new RepetitionLedger(config.narrate.ledgerSize, ledgerSeed);
  // Fit players named as the threat in a write-up, and when. A name stays
  // rested for six days so the same star is not every preview's danger man.
  const threatsSeen = (await kvGetJSON<Record<string, number>>('narrate:threats')) ?? {};
  const THREAT_REST = 6 * 86400;
  const recentThreats = () => Object.entries(threatsSeen).filter(([, t]) => now - t < THREAT_REST).map(([k]) => k);

  const report: SlateReport = {
    fixtures: events.length,
    analysed: 0,
    picks: 0,
    confident: 0,
    passes: 0,
    skipped: events.length - candidates.length,
    requests: 0,
    d1Queries: 0,
  };

  const fixtureRows: Array<Record<string, unknown>> = [];
  const pickRows: Array<Record<string, unknown>> = [];
  // Matches this pass saw finished, so their reports can be written below.
  const finishedIds: number[] = [];
  // Leagues whose table and scorers this pass has already written.
  const leagueSeen = new Set<number>();
  // Each competition's scoring chart, for the fixtures in it: the players
  // worth a link on a match page are the ones in this list.
  const leagueScorers = new Map<number, Array<{ player_id: number; name: string; goals: number; team_name?: string | null }>>();
  // The confident calls each fixture carries as of this run, for fixtures
  // that have not kicked off. See the withdrawal after the pick upsert.
  const standing = new Map<number, Array<{ market: string; outcome: string; line: number | null }>>();
  // What each of those matches looks like now, for saying why a call came down.
  const pullCtx = new Map<number, PullContext>();
  // The calls in the open bet slip. A posted slip does not change, so on its
  // matches the slate keeps the slip's call (at a fresh price) instead of
  // choosing again, and never takes it down.
  if (fresh) {
    await dbExec('DELETE FROM slip WHERE settled_at IS NULL AND first_kickoff > ?', [now]);
    console.log('Fresh: every call still to kick off is chosen again, and a slip not yet under way is rebuilt.');
  }
  const pinned = await openSlipLegs();
  // The stored call behind each slip leg still to kick off: a leg is held
  // even when its market drops out of the feed, and the write-up then has
  // nothing fresh to describe it with (see `held` below).
  const legRows = new Map<number, {
    market: string; outcome: string; line: number | null; odds: number; bookmaker: string | null;
    model_prob: number; book_prob: number; edge: number; shrunk_edge: number; kelly: number | null; confidence: number;
  }>();
  if (pinned.size) {
    for (const r of await dbSelect<{
      fixture_id: number; market: string; outcome: string; line: number | null; odds: number; bookmaker: string | null;
      model_prob: number; book_prob: number; edge: number; shrunk_edge: number; kelly: number | null; confidence: number;
    }>(
      `SELECT fixture_id, market, outcome, line, odds, bookmaker, model_prob, book_prob, edge, shrunk_edge, kelly, confidence
         FROM pick WHERE kind = 'CONFIDENT' AND settled_at IS NULL AND kickoff > ?`,
      [now],
    )) {
      const leg = pinned.get(Number(r.fixture_id));
      if (leg && leg.market === r.market && String(leg.outcome) === String(r.outcome)
        && (leg.line ?? null) === (r.line === null ? null : Number(r.line))) legRows.set(Number(r.fixture_id), r);
    }
  }
  // The calls standing on fixtures still to kick off, and the day's market
  // mix they make, so this run keeps what still holds and varies the rest.
  const incumbents = new Map<number, { market: string; outcome: string; line: number | null }>();
  for (const r of await dbSelect<{ fixture_id: number; market: string; outcome: string; line: number | null }>(
    `SELECT fixture_id, market, outcome, line FROM pick
      WHERE kind = 'CONFIDENT' AND settled_at IS NULL AND kickoff > ?`,
    [now],
  )) incumbents.set(Number(r.fixture_id), { market: r.market, outcome: r.outcome, line: r.line === null ? null : Number(r.line) });
  const fixturesByDay = new Map<string, number>();
  for (const e of candidates) {
    const k = toEpoch(e['event_date']);
    if (k !== undefined) fixturesByDay.set(DayMix.dayOf(k), (fixturesByDay.get(DayMix.dayOf(k)) ?? 0) + 1);
  }
  const mix = new DayMix(fixturesByDay);
  for (const e of candidates) {
    const id = num(e['id']);
    const k = toEpoch(e['event_date']);
    const inc = id !== undefined && !fresh ? incumbents.get(id) : undefined;
    if (inc && k !== undefined) mix.add(DayMix.dayOf(k), bucketOf(inc));
  }
  const heroCandidates: HeroCandidate[] = [];
  const traps: Trap[] = [];

  // The grounds on this slate, named once each after the loop.
  const venueIds = new Set<number>();

  // Gathering is nearly all waiting on the provider, and one fixture at a
  // time made a pass of a hundred-odd fixtures take twenty minutes, longer
  // than the fifteen between passes. So the next few fixtures' data is
  // fetched while this one is being analysed; everything after the fetch
  // stays in order, because the day mix, the writer's budget and the
  // repetition ledger all depend on it.
  const gatherAt = ahead(candidates, (e) => gatherFixture(e), config.slate.gatherAhead);
  for (const [index, event] of candidates.entries()) {
    const venueId = num(event['venue_id']);
    if (venueId) venueIds.add(venueId);
    try {
      const ctx = await gatherAt(index);
      if (!ctx) {
        report.skipped++;
        continue;
      }
      ctx.comparisonEntitled = entitled;

      // The competition's table and top scorers, once per run per league, for
      // its own page. The table is already in hand; the scorers are one
      // request, cached for the run.
      const leagueId = num(event['league_id']);
      if (leagueId !== undefined && !leagueSeen.has(leagueId)) {
        leagueSeen.add(leagueId);
        if (ctx.standings?.length) await kvSetJSON(`league:${leagueId}:standings`, { updated_at: now, rows: ctx.standings });
        const scorers = parseScorers(await bsdOrNull(`/api/v2/leagues/${leagueId}/top/scorers/`, { limit: 15 }));
        if (scorers?.length) {
          await kvSetJSON(`league:${leagueId}:scorers`, { updated_at: now, rows: scorers });
          leagueScorers.set(leagueId, scorers);
        }
      }

      const { analysis, factors, confidence } = analyseFixture(ctx);
      const players = ctx.players ? ctx.players.map(forBundle) : null;
      // The pub knowledge around the match: the referee, each manager against
      // this opponent, the league's team of the season, big signings, goals
      // for their country (context/extras.ts). For the next two days' games
      // only, and cached in kv, so after the first pass it costs almost
      // nothing. A failure costs the panel, never the fixture.
      let extras: Extras | null = null;
      if (analysis.kickoff - now < 48 * 3600) {
        extras = await gatherExtras({
          kickoff: analysis.kickoff,
          now,
          leagueId: analysis.league_id,
          seasonId: num(event['season_id']) ?? null,
          home: { id: ctx.home.team_id, coachId: ctx.home.manager?.id || null, coachName: ctx.home.manager?.name ?? null },
          away: { id: ctx.away.team_id, coachId: ctx.away.manager?.id || null, coachName: ctx.away.manager?.name ?? null },
          players: (ctx.players ?? []).map((p) => ({ id: p.id, teamId: p.side === 'home' ? ctx.home.team_id : ctx.away.team_id })),
          referee: ctx.referee ? { name: ctx.referee.name ?? null, matches: ctx.referee.matches, yellows_per: ctx.referee.yellows_per, reds_per: ctx.referee.reds_per } : null,
          leagueYellows: ctx.model.rates.yellows.leagueMean * 2 || null,
        }).catch(() => null);
      }
      const cands = buildCandidates(analysis.model, analysis.book, calibration);
      const selection = select(cands, analysis.book, factors, confidence);

      const verdicts = selection.picks.map(({ kind, candidate }) => {
        const drivers = driversFor(candidate, factors);
        return {
          kind,
          candidate,
          narrative: narrate({
            candidate,
            drivers,
            homeTeam: analysis.home_team,
            awayTeam: analysis.away_team,
            fixtureId: analysis.fixture_id,
            ledger,
          }),
          drivers,
          set_aside: setAsideFor(candidate, factors, drivers),
        };
      });

      // High-confidence calls, from the provider's probabilities rather than our
      // own. The prediction is already in the context — the gatherer fetches it
      // for the market factors — so this costs no extra request.
      //
      // Deliberately independent of `select` above. That asks whether the price
      // is wrong and passes when it is not; this asks what is likely and has no
      // view on the price, so a fixture can produce a confident call, a value
      // bet, both, or neither, and each is stored with its own kind.
      const prediction = parsePrediction(ctx.prediction);
      // The probability calls are chosen on: the consensus (consensus.ts) or,
      // if configured back, the provider's. See config.confident.source.
      const consensus = consensusMarkets(analysis.book, { home: analysis.lambda_home, away: analysis.lambda_away });
      // Set when this fixture's slip leg is still priced but no longer clears
      // its bar, so the leg is withdrawn rather than held (see below).
      let slipLegDropped = false;
      // Why this match has no call, from the rule that makes the calls.
      let noCall: NoCallReason | null = null;
      const confidentVerdicts = (() => {
        const useProvider = config.confident.source === 'provider';
        if (useProvider && !prediction) return [];
        const theirCands = buildCandidates(
          useProvider ? providerMarkets(prediction!) : consensus.markets, analysis.book, calibration);
        // A game people came to the site for is answered even when it is close.
        // Champions League and the big five drop to the marquee floor; the call
        // then carries `lean` and the page frames it as a read on a tight game
        // rather than a strong call.
        // A match called off (postponed, cancelled, abandoned, suspended)
        // gets no new call. One made before it was called off stays exactly
        // as it was, in the record, where settle voids it the way a bookmaker
        // does; taking it down would read as a result quietly removed.
        const calledOff = /postpon|cancel|abandon|suspend|interrupt/i.test(String(event['status'] ?? ''));
        const NOTHING = { market: '', outcome: '', line: null };
        const floor = floorForRank(leagueRank(analysis.league_id));
        const matchesPin = (p: { market: string; outcome: string; line: number | null }) => (c: Candidate) =>
          c.market === p.market && String(c.outcome) === p.outcome && (c.line ?? null) === p.line;
        const slipLeg = calledOff ? undefined : pinned.get(analysis.fixture_id);
        // A slip leg holds its call on the board only while the engine still
        // stands behind it. Belgium v France (28 September 2026) was on the
        // slip at 85%+ the day before; by kick-off, with France rotated and
        // Mbappé out, our read was 76% against a Nations League bar of 85%,
        // and the pin kept it up anyway. It lost. A leg the engine has fallen
        // off is withdrawn like any other call; the slip still grades it on
        // the score (slip.ts), because a slip once posted is a bet placed.
        const pin = calledOff
          ? (incumbents.get(analysis.fixture_id) ?? NOTHING)
          : slipLeg && theirCands.some((c) => matchesPin(slipLeg)(c) && confidentEligible(c, floor, calibration))
            ? slipLeg : undefined;
        if (slipLeg && !pin && theirCands.some(matchesPin(slipLeg))) slipLegDropped = true;
        /*
         * A leg held while its market has gone quiet (no book prices it now)
         * stays in the record -- see the withdrawal, which keeps it -- so the
         * write-up says it too, from the call as it was stored. Without this
         * Ebbsfleet v Sholing (3 October 2026), a leg and the day's free call,
         * carried its call in the record and "Nothing to take" on the board,
         * and the free call dropped off the front page.
         */
        const row = slipLeg && !pin && !slipLegDropped ? legRows.get(analysis.fixture_id) : undefined;
        const held: Candidate | undefined = row ? {
          market: row.market as Candidate['market'], outcome: row.outcome as Candidate['outcome'],
          line: row.line === null ? null : Number(row.line),
          push: row.line !== null && row.market === 'asian_handicap' ? pushRuleFor(Number(row.line)) : null,
          model_prob: Number(row.model_prob), book_prob: Number(row.book_prob), edge: Number(row.edge),
          shrunk_edge: Number(row.shrunk_edge), odds: Number(row.odds), bookmaker: row.bookmaker ?? '',
          prices: row.bookmaker ? [{ slug: '', book: row.bookmaker, odds: Number(row.odds) }] : [],
          kelly: Number(row.kelly ?? 0), confidence: Number(row.confidence),
          family: MARKET_FAMILY[row.market as keyof typeof MARKET_FAMILY],
        } : undefined;
        const chosen = pin
          ? theirCands.filter(matchesPin(pin)).slice(0, 1)
          : held ? [held] : (() => {
            // A call backing a side that has been rotated (several expected
            // starters out of the confirmed eleven) is set aside: the price
            // may well have been made before the sheet was out (context/xi.ts).
            const unrotated = theirCands.filter((c) => !backsRotatedSide(c, ctx.lineups.changes));
            const ranked = rankConfident(unrotated, floor, calibration);
            // A call already up stays up while it still holds (config.confident.hold):
            // a price twitch or the sharp book missing for one pass is not a
            // reason to pull it. Rotation is: `unrotated` has already left it out.
            const standingCall = fresh ? undefined : incumbents.get(analysis.fixture_id);
            if (standingCall && !ranked.some(matchesPin(standingCall))) {
              const still = unrotated.find(matchesPin(standingCall));
              if (still && confidentHolds(still, floor, calibration)) ranked.unshift(still);
            }
            noCall = ranked.length ? 'mix'
              : rankConfident(theirCands, floor, calibration).length ? 'rotated'
              : whyNoCall(unrotated, floor, calibration);
            // Matches under way keep whatever they had; the mix is for calls
            // still to be made.
            if (analysis.kickoff <= Math.floor(Date.now() / 1000)) return ranked.slice(0, 1);
            const one = mix.choose(ranked, analysis.kickoff, fresh ? null : incumbents.get(analysis.fixture_id) ?? null);
            return one ? [one] : [];
          })();
        return chosen.map((candidate) => {
          const drivers = driversFor(candidate, factors);
          return {
            kind: 'CONFIDENT' as const,
            candidate,
            narrative: narrateConfident({
              candidate,
              drivers,
              homeTeam: analysis.home_team,
              awayTeam: analysis.away_team,
              fixtureId: analysis.fixture_id,
              ledger,
              expectedGoals: prediction?.expected_goals ?? consensus.rates,
            }),
            drivers,
            set_aside: setAsideFor(candidate, factors, drivers),
            why: null as string | null,
          };
        });
      })();

      // Every verdict, for the pick ledger and the calibration that depends on
      // it. Nothing here is user-facing on its own.
      const allVerdicts = [...verdicts, ...confidentVerdicts];

      // The narrative, written rather than assembled.
      //
      // The grammar above says of itself that it is a template system, and it
      // reads like one: one sentence per claim, joined with a space, opening
      // with the call and its price because marketLabel() builds that lead in
      // at generation time. Measured against the live site, fifteen of fifteen
      // narratives named the market and the odds in their first six words --
      // which is also why none of them can be shown to a reader who has not
      // paid.
      //
      // So the grammar becomes the fact source and a model does the writing.
      // It only ever sees pub facts, so it cannot reach for a spreadsheet
      // number that is not in its input, and anything it writes is checked
      // against the same vocabulary rule the free copy is filtered by.
      //
      // A rejection keeps the grammar's version. That path is load-bearing
      // rather than tidy: the free tier this runs on has had its quotas cut
      // sharply and without notice before, and the site has to keep publishing
      // when it happens -- in the old voice, with the run saying how often.
      // The pub facts the writer works from, for a call or a preview.
      const factsFor = () => pubFacts({
            home: analysis.home_team,
            away: analysis.away_team,
            ledger: factors.map(forStorage),
            form: {
              home: (factors.find((f) => f.id === 'form.home')?.evidence ?? null) as Record<string, unknown> | null,
              away: (factors.find((f) => f.id === 'form.away')?.evidence ?? null) as Record<string, unknown> | null,
            },
            h2h: (ctx.h2h ?? null) as Record<string, unknown> | null,
            // Everything with a name on it. The writer used to get the
            // lineup *status* and nothing else, so it could say the sheets
            // were confirmed and not who was on them.
            lineups: ctx.lineups
              ? { status: ctx.lineups.status, home: ctx.lineups.home, away: ctx.lineups.away }
              : null,
            standings: ctx.standings
              ? { home: ctx.home.standing ?? null, away: ctx.away.standing ?? null, size: ctx.standings.length }
              : null,
            goalscorers: ((analysis.external as { polymarket?: { goalscorers?: unknown } } | null)
              ?.polymarket?.goalscorers ?? null) as Array<{ player?: string; price?: number }> | null,
            managers: { home: ctx.home.manager?.name ?? null, away: ctx.away.manager?.name ?? null },
            players: players ?? null,
            extras,
            recentThreats: recentThreats(),
            matches: { home: ctx.styleMatches.home, away: ctx.styleMatches.away, homeId: ctx.home.team_id, awayId: ctx.away.team_id },
          });
      // Calls the writer answered for, this run or an earlier one.
      const written = new Set<object>();
      if (writer && !writerGaveUp) {
        for (const v of confidentVerdicts) {
          // Written once per call, not once per run.
          const key = narrativeKey(analysis.fixture_id, v.candidate, teamNews(ctx.lineups));
          // Stored as { text, why } now; older entries are a bare string and
          // are rewritten, since they have no members' paragraph.
          const cached = await kvGetJSON<string | { text: string; why: string | null }>(key);
          if (cached && typeof cached === 'object' && cached.text) {
            v.narrative = cached.text;
            v.why = cached.why ?? null;
            written.add(v);
            narrateReused++;
            continue;
          }

          if (narrateAttempts >= perRun) break;
          if (spent(budget, perDay, models, perModel)) {
            writerGaveUp = budget.pausedUntil ? 'Google refused for quota; trying again in two hours' : `today's allowance of ${perDay} is spent`;
            break;
          }
          narrateAttempts++;
          const facts = factsFor();
          const result = await write({
            home: analysis.home_team,
            away: analysis.away_team,
            competition: ctx.league_name ?? 'this competition',
            call: plainCall(v.candidate, analysis.home_team, analysis.away_team),
            facts,
            odds: v.candidate.odds,
          }, writer);
          // Kept after every write, not only at the end, so a run that dies
          // halfway still leaves the day's count right for the next one.
          await kvSetJSON('gemini:budget', budget);

          if (result.text) {
            v.narrative = result.text;
            v.why = result.why ?? null;
            written.add(v);
            narrateWritten++;
            // The threats this write-up could have named, rested from now.
            for (const f of facts.slice(0, 18)) {
              for (const k of (f.threat ?? '').split('|').filter(Boolean)) threatsSeen[k] = now;
            }
            for (const [k, t] of Object.entries(threatsSeen)) if (now - t > 4 * THREAT_REST) delete threatsSeen[k];
            await kvSetJSON('narrate:threats', threatsSeen);
            consecutiveErrors = 0;
            await kvSetJSON(key, { text: result.text, why: v.why }, NARRATIVE_TTL);
          } else {
            for (const r of result.rejections) narrateRejections[r] = (narrateRejections[r] ?? 0) + 1;
            for (const n of result.unbacked ?? []) narrateUnbacked[n] = (narrateUnbacked[n] ?? 0) + 1;
            // A rejected draft is the writer working. A thrown request is the
            // writer not being reachable, and only the second kind repeats.
            if (result.error && spent(budget, perDay, models, perModel)) {
              writerGaveUp = result.error;
              break;
            }
            if (result.error) {
              consecutiveErrors++;
              if (consecutiveErrors >= 3) {
                writerGaveUp = result.error;
                console.warn(`Narratives: giving up on ${writer.name} for this run — ${result.error}`);
                break;
              }
            } else {
              consecutiveErrors = 0;
            }
          }
        }
      }

      // A call the writer could not reach -- the day's allowance gone, or two
      // drafts that failed -- gets the paragraph built from the reads rather
      // than the grammar's, when there are reads enough to argue from
      // (narrate/rescue.ts). Not cached: the writer replaces it when it can.
      for (const v of confidentVerdicts) {
        if (written.has(v)) continue;
        const r = fromReads(analysis.home_team, analysis.away_team, factsFor());
        if (r) { v.narrative = r; narrateRescued++; }
      }

      // What a reader is actually shown. The split exists because the two
      // audiences want different things: the ledger wants everything the model
      // said so it can be marked, the page wants only the calls we stand behind.
      const publishedVerdicts = confidentVerdicts;

      /*
       * A preview for a match we passed on, from the day's spare allowance.
       *
       * The calls use a fraction of the free tier's requests (about twenty-five
       * of two hundred on an ordinary day), so once they are written the rest
       * goes on the matches with no call: written the same way, to the same
       * rules, and free to everyone, because a match page with no call should
       * still read like somebody who watches football wrote it.
       *
       * Calls always come first. A reserve of the allowance is never spent on
       * previews, a run writes only a few, and only real competitions within
       * the next two days get one. The candidates are in kick-off order, so
       * today's matches are written before tomorrow's without being told.
       */
      let preview: string | null = null;
      if (publishedVerdicts.length === 0 && !/postpon|cancel|abandon|suspend/i.test(String(event['status'] ?? ''))
        && analysis.kickoff > now && analysis.kickoff - now < PREVIEW_AHEAD && leagueRank(analysis.league_id) <= 5) {
        const key = `prev:${analysis.fixture_id}:${fnv(teamNews(ctx.lineups))}`;
        const cached = await kvGetJSON<{ text: string }>(key);
        if (cached?.text) {
          preview = cached.text;
          previewsReused++;
        } else if (writer && !writerGaveUp && previewAttempts < previewsPerRun
          && budget.used < perDay - PREVIEW_RESERVE && !spent(budget, perDay, models, perModel)) {
          previewAttempts++;
          const result = await write({
            home: analysis.home_team,
            away: analysis.away_team,
            competition: ctx.league_name ?? 'this competition',
            call: '',
            facts: factsFor(),
            previewOnly: true,
          }, writer);
          await kvSetJSON('gemini:budget', budget);
          if (result.text) {
            preview = result.text;
            previewsWritten++;
            await kvSetJSON(key, { text: result.text }, NARRATIVE_TTL);
          } else {
            for (const r of result.rejections) previewRejections[r] = (previewRejections[r] ?? 0) + 1;
          }
        }
        if (!preview) {
          preview = fromReads(analysis.home_team, analysis.away_team, factsFor());
          if (preview) previewsRescued++;
        }
      }

      // No pass note on a match we have called. The value selector passes
      // independently of the confident calls, so 28 of 34 locked cards carried
      // "Nothing to take on Netherlands v Germany ... the closest was double
      // chance 1X at 1.47" -- a sentence that contradicts the card, and one
      // that named a market and its odds to readers who had not paid.
      //
      // And the reason is the call rule's own (select.ts, whyNoCall). It was
      // the old value selector's, which judges something else: a mismatch
      // read "too close to call", and a match where that selector found
      // something read nothing at all.
      const passNarrative = publishedVerdicts.length === 0 && noCall
        ? narratePass(noCall, analysis.home_team, analysis.away_team, analysis.fixture_id)
        : null;

      /*
       * The score, but only once it is the final one.
       *
       * The provider carries a *running* score on the event, so a match on the
       * hour mark reports 0-0 and means "nothing yet", not "it finished
       * goalless". Writing that to the fixture published a live scoreline as a
       * result: the board showed a game marked full time at the score it held
       * when the slate last ran, and the results page printed "0-0" beside a
       * call on fewer than 3.5 goals and marked it missed -- the settle job
       * having graded the same pick against the real final score.
       *
       * So a score is only recorded once the provider says the match is over.
       * Until then the column stays null and the page says nothing, which is
       * the honest state for a game still being played.
       */
      const finished = /finish|ended|\bft\b|after|aet|\bap\b/i.test(String(event['status'] ?? ''));
      if (finished && num(event['id']) !== undefined) finishedIds.push(num(event['id'])!);
      const homeGoals = finished ? num(event['home_score']) : undefined;
      const awayGoals = finished ? num(event['away_score']) : undefined;
      // The running score is still worth showing -- a board that says LIVE and
      // nothing else is a board that has not caught up. It travels on the card
      // under its own name so no page can mistake it for a result.
      const liveScore = !finished && num(event['home_score']) !== undefined && num(event['away_score']) !== undefined
        ? [num(event['home_score'])!, num(event['away_score'])!]
        : null;

      // The board card: small, because the board loads all of them at once.
      const board = {
        id: analysis.fixture_id,
        league_id: analysis.league_id,
        league: ctx.league_name,
        kickoff: analysis.kickoff,
        home: analysis.home_team,
        away: analysis.away_team,
        // The provider runs an image service keyed by these same ids —
        // /img/team/{id}/ and /img/league/{id}/, no auth — so carrying them on
        // the card is what lets the front end show real crests instead of a
        // generated monogram. They were already on the analysis and simply
        // never travelled.
        home_id: analysis.home_team_id,
        away_id: analysis.away_team_id,
        // The provider's image service also serves grounds — /img/venue/{id}/
        // returns a real photograph of the stadium this match is played at.
        // That is the matchday imagery the site is built on, so the id travels
        // with the fixture rather than the page reaching for stock.
        venue_id: num(event['venue_id']) ?? null,
        // How prominent this competition is, so the board can lead with the
        // games people came for rather than with whatever kicks off first.
        rank: leagueRank(analysis.league_id),
        status: analysis.status,
        provisional: analysis.provisional,
        lineup_status: analysis.lineup_status,
        confidence: Number(confidence.toFixed(3)),
        // What actually happened, where it already has. The board reaches six
        // hours back, and a row that says FT without a scoreline is the least
        // useful thing a results-carrying board can print.
        score: homeGoals === undefined || awayGoals === undefined ? null : [homeGoals, awayGoals],
        live_score: liveScore,
        lambda: [Number(analysis.lambda_home.toFixed(2)), Number(analysis.lambda_away.toFixed(2))],
        odds_1x2: Object.fromEntries(
          (analysis.book.find((b) => b.market === '1x2')?.fair ?? new Map()).entries(),
        ),
        // Our read, on a match with no call: what we think happens, in words,
        // from the bookmakers' own view. Free, no price, never in the record
        // (read.ts).
        read: publishedVerdicts.length ? null : readOf({
          home: analysis.home_team,
          away: analysis.away_team,
          result: Object.fromEntries((analysis.book.find((b) => b.market === '1x2')?.fair ?? new Map()).entries()),
          over25: analysis.book.find((b) => b.market === 'over_under_25')?.fair.get('over') ?? null,
        }),
        // The board card's headline, and the only kind of call that reaches a
        // reader. Settled results said the other two buckets lose money while
        // this one is about level, so they keep being computed — they are how
        // we judge the model — and they stop being published.
        //
        // `bookmaker` travels with it because a price without the book offering
        // it is not a usable price. It was on the candidate all along and was
        // simply dropped here, so the board showed a number with no source.
        top_pick: ((v) =>
          v
            ? {
                market: v.candidate.market,
                outcome: v.candidate.outcome,
                line: v.candidate.line,
                odds: v.candidate.odds,
                bookmaker: v.candidate.bookmaker ?? null,
                prices: v.candidate.prices ?? [],
                prob: Number(v.candidate.model_prob.toFixed(3)),
                // Cleared the marquee floor but not the normal one. The page
                // says so rather than presenting a close game as a strong call.
                lean: isLean(v.candidate),
              }
            : null)(publishedVerdicts[0]),
        pass: passNarrative,
        // The confident calls, compact: the board loads every fixture at once,
        // so the reasoning stays in the bundle and only the call travels here.
        confident: confidentVerdicts.map((v) => ({
          market: v.candidate.market,
          outcome: v.candidate.outcome,
          line: v.candidate.line,
          prob: Number(v.candidate.model_prob.toFixed(3)),
          odds: v.candidate.odds,
          bookmaker: v.candidate.bookmaker ?? null,
          prices: v.candidate.prices ?? [],
          lean: isLean(v.candidate),
          // Whether anything in our context argues against it. This is the
          // differentiator, so it belongs where a reader sees it first.
          caveat: v.drivers.some((d) => d.claims.some((c) => c.polarity < 0)),
        })),
        // Signals worth an icon on the card without opening the fixture.
        flags: factors
          .filter((f) => f.state === 'COMPUTED' && f.strength >= 0.5)
          .slice(0, 4)
          .map((f) => ({ id: f.id, section: f.section, note: f.note })),
      };

      // The full bundle: everything the fixture page shows, including the
      // factors we could not compute. A fixture we know little about should
      // look like one.
      const bundle = {
        ...board,
        lambda_home: analysis.lambda_home,
        lambda_away: analysis.lambda_away,
        corner_rate: Number(analysis.corner_rate.toFixed(2)),
        card_rate: Number(analysis.card_rate.toFixed(3)),
        // The team sheet, which was computed for the factors and then thrown
        // away. It is the panel the analysis keeps referring to — "without two
        // players, none of whom register in the scoring records" means more
        // next to the eleven that is actually playing.
        lineups: ctx.lineups
          ? {
              status: ctx.lineups.status,
              confidence: ctx.lineups.confidence,
              home: ctx.lineups.home,
              away: ctx.lineups.away,
              unavailable: ctx.lineups.unavailable,
            }
          : null,
        // Every player the write-up might name, with the id that links to
        // their page: both squads, both team sheets, the absentees and the
        // league's scorers for each side. The page turns a name in the
        // analysis into a link by looking it up here, so a name the writer
        // uses that is not in this list simply stays text.
        people: peopleOf(ctx),
        // Who the absentees and the danger men are: season numbers, standing
        // at the club, a game that shows it, current form. The writer's player
        // lines come from here; kept so the page can show them too.
        players: players ?? null,
        // The referee, the managers against this opponent, the team of the
        // season, signings and caps (context/extras.ts), for the page's
        // "Who's who" panel and the writer's facts.
        extras,
        // The players worth a link: the competition's top scorers. A name in
        // the analysis links only if it is one of these, and the link opens
        // the competition's chart at that name.
        notable: (leagueScorers.get(analysis.league_id) ?? []).map((sc, i) => ({
          id: sc.player_id, name: sc.name, goals: sc.goals, rank: i + 1,
        })),
        // Everything the match page shows in its own panels. All of it was
        // gathered for the factors already and then dropped on the floor.
        round_label: str(event['round_label']) || null,
        neutral: event['is_neutral_ground'] === true,
        h2h: ctx.h2h ?? null,
        standings: ctx.standings
          ? {
              home: ctx.home.standing ?? null,
              away: ctx.away.standing ?? null,
              size: ctx.standings.length,
            }
          : null,
        form: {
          home: factors.find((f) => f.id === 'form.home')?.evidence ?? null,
          away: factors.find((f) => f.id === 'form.away')?.evidence ?? null,
        },
        ledger: factors.map(forStorage),
        markets: analysis.model.map((m) => ({
          market: m.market,
          line: m.line,
          confidence: Number(m.confidence.toFixed(3)),
          model: Object.fromEntries([...m.probs].map(([k, v]) => [k, Number(v.toFixed(4))])),
          ...snapshotOf(analysis.book.find((b) => b.market === m.market && b.line === m.line)),
        })),
        candidates: [...cands]
          .sort((a, b) => b.shrunk_edge - a.shrunk_edge)
          .slice(0, 25)
          .map(candidateForStorage),
        // The fixture page reads this, so it carries published calls only. The
        // kind is deliberately absent: it is our filing system, not something a
        // reader has the vocabulary for, and printing it was half of why the
        // old page read like a debug view.
        verdicts: publishedVerdicts.map((v) => ({
          candidate: candidateForStorage(v.candidate),
          lean: isLean(v.candidate),
          narrative: v.narrative,
          // Members only: the argument for this call at its odds. The free
          // copy drops it along with the candidate (membership/redact.ts).
          why: v.why ?? null,
          drivers: v.drivers.map(forStorage),
          set_aside: v.set_aside.map(forStorage),
        })),
        pass_reason: publishedVerdicts.length ? null : noCall ? `call rule: ${noCall}` : selection.passReason,
        // Written for a match with no call (above); free, like the rest of it.
        preview,
        external: analysis.external,
        computed_at: analysis.computed_at,
      };

      fixtureRows.push({
        id: analysis.fixture_id,
        league_id: analysis.league_id,
        kickoff: analysis.kickoff,
        home_team: analysis.home_team,
        away_team: analysis.away_team,
        status: analysis.status,
        provisional: analysis.provisional ? 1 : 0,
        // Columns rather than fields inside the blob, because everything that
        // reads backwards -- the results record, the recap -- is built from
        // `pick` joined to `fixture` and cannot see inside board_json.
        home_goals: homeGoals ?? null,
        away_goals: awayGoals ?? null,
        // The running score, as columns, because the card it also sits on is
        // frozen from kick-off and these are not.
        live_home: liveScore?.[0] ?? null,
        live_away: liveScore?.[1] ?? null,
        live_minute: liveScore ? (num(event['current_minute']) ?? null) : null,
        home_team_id: analysis.home_team_id,
        away_team_id: analysis.away_team_id,
        // Also a column, not just a field inside board_json, because the board
        // has to sort on it and SQL cannot see inside the blob.
        rank: leagueRank(analysis.league_id),
        board_json: JSON.stringify(board),
        bundle_json: JSON.stringify(bundle),
        // The same fixture with the call taken out, written here rather than
        // derived at request time: the Worker has 10ms and parses nothing, so
        // the free copy has to be a column the serving function can choose.
        board_free_json: JSON.stringify(freeBoard(board)),
        bundle_free_json: JSON.stringify(freeBundle(bundle)),
        computed_at: analysis.computed_at,
      });

      /*
       * Nothing is added to the record once the match has started.
       *
       * The slate reaches back over matches already under way and finished --
       * that is how scores arrive -- and it was upserting picks for them as it
       * went. A call that first appears after kick-off is a call made with the
       * answer in view, and settlement would grade it like any other. The
       * fixture's write-up was frozen at kick-off for the same reason; the
       * record needed it more.
       */
      const started = analysis.kickoff <= Math.floor(Date.now() / 1000);
      if (!started) {
        const keep = confidentVerdicts.map((v) => ({
          market: v.candidate.market, outcome: v.candidate.outcome, line: v.candidate.line ?? null,
        }));
        // A slip's call is not taken down because its market has gone quiet;
        // it is when the engine, still seeing the price, has fallen below its
        // bar for it (slipLegDropped, above).
        const pin = pinned.get(analysis.fixture_id);
        if (pin && !slipLegDropped) keep.push(pin as (typeof keep)[number]);
        standing.set(analysis.fixture_id, keep);
        pullCtx.set(analysis.fixture_id, {
          home: analysis.home_team, away: analysis.away_team,
          changes: ctx.lineups?.changes ?? null,
          factors: factors.filter((f) => f.id.startsWith('availability.')),
        });
      }
      for (const v of started ? [] : allVerdicts) {
        pickRows.push({
          fixture_id: analysis.fixture_id,
          kickoff: analysis.kickoff,
          market: v.candidate.market,
          outcome: v.candidate.outcome,
          line: v.candidate.line,
          kind: v.kind,
          model_prob: v.candidate.model_prob,
          book_prob: v.candidate.book_prob,
          edge: v.candidate.edge,
          shrunk_edge: v.candidate.shrunk_edge,
          odds: v.candidate.odds,
          bookmaker: v.candidate.bookmaker,
          kelly: v.candidate.kelly,
          confidence: v.candidate.confidence,
          provisional: analysis.provisional ? 1 : 0,
          // The price when we first said it. `odds` is overwritten every run
          // because the board has to show a price somebody can still get, so
          // this is the only record of what we actually called it at -- and
          // the difference between the two is the one honest answer to "was
          // the market with us or against us" after a loss.
          opening_odds: v.candidate.odds,
          narrative: v.narrative,
          why: 'why' in v ? v.why : null,
          evidence_json: JSON.stringify({
            drivers: v.drivers.map(forStorage),
            set_aside: v.set_aside.map(forStorage),
            // The shape we published for the match, so settlement can ask
            // whether the game looked like we said it would.
            expected: {
              home: Number(analysis.lambda_home.toFixed(2)),
              away: Number(analysis.lambda_away.toFixed(2)),
            },
          }),
          created_at: analysis.computed_at,
        });
      }

      // Collected for the masthead. The best-rated starter per side is the face
      // the composite uses, which is why the lineup is read here rather than
      // guessed at from the squad.
      const bestStarter = (which: 'home' | 'away'): number | null => {
        const players = ctx.lineups?.[which]?.players ?? [];
        const starters = players.filter((pl) => pl.starting && pl.ai_score !== null);
        if (!starters.length) return null;
        return starters.reduce((a, b) => ((b.ai_score ?? 0) > (a.ai_score ?? 0) ? b : a)).id;
      };
      heroCandidates.push({
        id: analysis.fixture_id,
        league_id: analysis.league_id,
        league: ctx.league_name ?? '',
        kickoff: analysis.kickoff,
        home: analysis.home_team,
        away: analysis.away_team,
        home_id: analysis.home_team_id,
        away_id: analysis.away_team_id,
        venue_id: num(event['venue_id']) ?? null,
        confidence,
        derby: factors.some((f) => f.id === 'fixture.derby' && f.strength > 0.3),
        // Needed to spot a final, which is the one thing that outranks a
        // Champions League night.
        round_label: str(event['round_label']) || null,
        star_home: bestStarter('home'),
        star_away: bestStarter('away'),
        called: confidentVerdicts.length > 0,
      });

      // The favourite we'd leave alone, if this match has one (trap.ts).
      const trap = trapFor({
        fixture_id: analysis.fixture_id, kickoff: analysis.kickoff,
        league: ctx.league_name ?? '', league_id: analysis.league_id, rank: leagueRank(analysis.league_id),
        home: analysis.home_team, away: analysis.away_team,
        home_id: analysis.home_team_id, away_id: analysis.away_team_id,
        book: analysis.book, model: analysis.model, factors,
        changes: ctx.lineups?.changes ?? null,
        calls: confidentVerdicts.map((v) => ({ market: v.candidate.market, outcome: String(v.candidate.outcome) })),
      });
      if (trap) traps.push(trap);

      report.analysed++;
      if (allVerdicts.length > 0) report.picks += allVerdicts.length;
      report.confident += confidentVerdicts.length;
      if (selection.passReason) report.passes++;
    } catch (err) {
      console.error(`  fixture ${event['id']} failed: ${err instanceof Error ? err.message : String(err)}`);
      report.skipped++;
    }
  }

  if (fixtureRows.length > 0) {
    await insertMany(
      'fixture',
      [
        'id', 'league_id', 'kickoff', 'home_team', 'away_team', 'status',
        'provisional', 'home_goals', 'away_goals', 'live_home', 'live_away', 'live_minute',
        'home_team_id', 'away_team_id',
        'rank', 'board_json', 'bundle_json',
        'board_free_json', 'bundle_free_json', 'computed_at',
      ],
      fixtureRows,
      {
        /*
         * What we said about a match is frozen at kick-off, exactly as a
         * settled pick is.
         *
         * The slate reaches back over matches that have already been played --
         * it has to, because that is how the final score and status arrive --
         * and it was re-running the whole analysis over them and overwriting
         * the write-up with a fresh one. Prices have moved by then and the
         * line-ups are known, so the new selection is frequently a different
         * one, and the fixture page ended up contradicting the results page:
         * "we did not call this one" over a match whose call is published, won,
         * on /results. A record that rewrites itself after the fact is not a
         * record.
         *
         * So the four write-up columns stop updating the moment the match
         * kicks off. Everything the match itself produces -- the score, the
         * status, the confirmed team names -- keeps updating, because those are
         * facts arriving rather than opinions being revised.
         */
        onConflict:
          'ON CONFLICT (id) DO UPDATE SET ' +
          'league_id = excluded.league_id, kickoff = excluded.kickoff, ' +
          'home_team = excluded.home_team, away_team = excluded.away_team, ' +
          'status = excluded.status, provisional = excluded.provisional, ' +
          'home_goals = excluded.home_goals, away_goals = excluded.away_goals, ' +
          'live_home = excluded.live_home, live_away = excluded.live_away, live_minute = excluded.live_minute, ' +
          'home_team_id = excluded.home_team_id, away_team_id = excluded.away_team_id, ' +
          'rank = excluded.rank, computed_at = excluded.computed_at, ' +
          'board_json = CASE WHEN fixture.kickoff <= excluded.computed_at ' +
          'THEN fixture.board_json ELSE excluded.board_json END, ' +
          'bundle_json = CASE WHEN fixture.kickoff <= excluded.computed_at ' +
          'THEN fixture.bundle_json ELSE excluded.bundle_json END, ' +
          'board_free_json = CASE WHEN fixture.kickoff <= excluded.computed_at ' +
          'THEN fixture.board_free_json ELSE excluded.board_free_json END, ' +
          'bundle_free_json = CASE WHEN fixture.kickoff <= excluded.computed_at ' +
          'THEN fixture.bundle_free_json ELSE excluded.bundle_free_json END',
      },
    );
  }

  // The match report for anything that finished since the last pass: written
  // once, on the first pass after full time, so the fixture page has the
  // scorers and the ratings within a quarter of an hour of the whistle.
  if (finishedIds.length > 0) {
    const reports = await writeMissingReports({ ids: finishedIds, limit: 40 });
    if (reports) console.log(`  wrote ${reports} match report${reports === 1 ? '' : 's'}`);
  }

  if (pickRows.length > 0) {
    // A pick is identified by fixture, market, outcome, line and kind. Rerunning
    // a slate must refresh the same row rather than publish a duplicate, but a
    // settled pick is history and is never overwritten.
    await insertMany(
      'pick',
      [
        'fixture_id', 'kickoff', 'market', 'outcome', 'line', 'kind', 'model_prob',
        'book_prob', 'edge', 'shrunk_edge', 'odds', 'opening_odds', 'bookmaker', 'kelly',
        'confidence', 'provisional', 'narrative', 'why', 'evidence_json', 'created_at',
      ],
      pickRows,
      {
        onConflict:
          // Must match pick_unique_line for the active backend exactly, or the
          // upsert matches no index and every rerun inserts a duplicate rather
          // than refreshing. See pickConflictTarget.
          `ON CONFLICT (${pickConflictTarget()}) DO UPDATE SET ` +
          'model_prob = excluded.model_prob, book_prob = excluded.book_prob, ' +
          'edge = excluded.edge, shrunk_edge = excluded.shrunk_edge, odds = excluded.odds, ' +
          'bookmaker = excluded.bookmaker, kelly = excluded.kelly, ' +
          'confidence = excluded.confidence, provisional = excluded.provisional, ' +
          'narrative = excluded.narrative, why = excluded.why, evidence_json = excluded.evidence_json, ' +
          // A rescheduled match moves its call with it; the results page was
          // printing the old date.
          'kickoff = excluded.kickoff, ' +
          // Deliberately NOT opening_odds: it is set once, on the insert that
          // first published the call, and never again. The last price this
          // loop writes before the match starts is the closing one.
          'closing_odds = excluded.odds ' +
          'WHERE pick.settled_at IS NULL',
      },
    );
  }

  /*
   * One standing call per fixture, and a replaced one is withdrawn.
   *
   * A later run before kick-off can change its mind -- team news lands, the
   * price moves -- and publish a different call on the same match. The old
   * pick row was never removed, so both stayed in the record and both were
   * graded: Inter Miami 2-2 San Diego carries "1X, landed" and "12, missed"
   * side by side, which is two calls that cover each other and reads to any
   * punter as padding the strike rate. Before kick-off nothing is known about
   * the result, so withdrawing a call the engine no longer stands behind is
   * honest; after kick-off nothing is touched (see `started` above).
   */
  let withdrawn = 0;
  for (const [fixtureId, keep] of standing) {
    const rows = await dbSelect<{
      id: number; market: string; outcome: string; line: number | null; kickoff: number;
      odds: number; bookmaker: string | null; created_at: number; evidence_json: string | null;
    }>(
      `SELECT id, market, outcome, line, kickoff, odds, bookmaker, created_at, evidence_json FROM pick
       WHERE fixture_id = ? AND kind = 'CONFIDENT' AND settled_at IS NULL AND kickoff > ?`,
      [fixtureId, now],
    );
    for (const r of rows) {
      const kept = keep.some((k) => k.market === r.market && String(k.outcome) === String(r.outcome)
        && (k.line ?? null) === (r.line ?? null));
      if (kept) continue;
      /*
       * Kept, with the reason, before it goes (pulled.ts). The Worker emails
       * members about it and the match page says so. A call that was only up
       * for a few minutes is recorded but marked as already handled: that is
       * the engine settling, not news anyone needs an email about.
       */
      const pc = pullCtx.get(fixtureId);
      if (pc) {
        const replaced = keep[0] ?? null;
        await dbExec(
          `INSERT INTO pulled_call (pick_id, fixture_id, kickoff, home, away, market, outcome, line, label, odds, bookmaker,
                                    reason, replaced_by, published_at, pulled_at, alerted_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (pick_id) DO NOTHING`,
          [r.id, fixtureId, r.kickoff, pc.home, pc.away, r.market, r.outcome, r.line,
            callName(r, pc.home, pc.away), r.odds, r.bookmaker,
            pullReason(r, pc, replaced !== null),
            replaced ? callName(replaced, pc.home, pc.away) : null,
            r.created_at, now, now - Number(r.created_at) < QUIET_IF_YOUNGER_S ? now : null],
        );
      }
      await dbExec('DELETE FROM pick WHERE id = ?', [r.id]);
      withdrawn++;
    }
  }
  if (withdrawn) console.log(`  withdrew ${withdrawn} call${withdrawn === 1 ? '' : 's'} replaced before kick-off`);
  // A call that came back before kick-off is no longer pulled.
  await dbExec(
    `UPDATE pulled_call SET restored_at = ?
      WHERE restored_at IS NULL AND kickoff > ?
        AND EXISTS (SELECT 1 FROM pick p
                     WHERE p.fixture_id = pulled_call.fixture_id AND p.kind = 'CONFIDENT' AND p.settled_at IS NULL
                       AND p.market = pulled_call.market AND p.outcome = pulled_call.outcome
                       AND p.line IS NOT DISTINCT FROM pulled_call.line)`,
    [now, now],
  );

  // The bet slip follows the board until its first leg kicks off.
  const slip = await refreshSlip();
  if (slip) console.log(`  slip: ${slip.legs.length} legs at total odds of ${slip.odds.toFixed(2)}, ${chanceInWords(slip.chance)}`);

  // What the site leads with today. Written whether or not anything special is
  // on — a quiet Tuesday still needs a masthead, it just gets a quieter one.
  const hero = chooseHero(heroCandidates);
  if (hero) {
    hero.shot_venue_id = await firstVenuePhoto([hero.venue_id, ...heroCandidates.map((c) => c.venue_id)]);
    await kvSetJSON('hero:today', hero);
    console.log(`  hero: ${hero.kicker} — ${hero.headline} (${hero.reason})`);
  } else {
    // No called fixture ahead: clear it, rather than leave yesterday's match
    // leading the front page. The page has a masthead for this case.
    await kvSetJSON('hero:today', null);
  }

  // The trap of the day: free, on the front page, no price on it.
  const wasTrap = await kvGetJSON<Trap>('trap:today').catch(() => null);
  const trap = chooseTrap(traps, now, wasTrap?.fixture_id ?? null);
  if (trap) {
    await kvSetJSON('trap:today', { ...trap, made_at: now });
    // Kept so the traps can be marked against the results one day, the way
    // the calls are. The latest reading of each match wins.
    const log = (await kvGetJSON<Array<Trap & { made_at: number }>>('trap:history').catch(() => null)) ?? [];
    const next = [{ ...trap, made_at: now }, ...log.filter((t) => t.fixture_id !== trap.fixture_id)].slice(0, 120);
    await kvSetJSON('trap:history', next);
    console.log(`  trap: ${trap.team} (${trap.home} v ${trap.away}), ${trap.reasons.length} reason${trap.reasons.length === 1 ? '' : 's'}`);
  } else {
    // Nothing worth naming: take down whatever was up, rather than leave a
    // trap the engine no longer stands behind on the front page.
    if (wasTrap) await kvSetJSON('trap:today', null);
    console.log(`  trap: none (${traps.length} candidate${traps.length === 1 ? '' : 's'})`);
  }

  // The one call a day everyone can read: the strongest open call, not the
  // headline fixture's. See free.ts for how it locks.
  const free = await chooseFreeCall(now);
  if (free) console.log(`  free call: fixture ${free.fixture_id}, kicks off ${new Date(free.kickoff * 1000).toISOString()}`);
  else console.log('  free call: none open');

  // The clubs' colours for the match page, from their crests. Once per team,
  // and never allowed to fail the slate: a masthead without them falls back
  // to its own wash.
  try {
    const colored = await fillCrestColors({ limit: 250 });
    if (colored) console.log(`  read ${colored} crest colour${colored === 1 ? '' : 's'}`);
  } catch (err) {
    console.log(`  crest colours skipped: ${err instanceof Error ? err.message : String(err)}`);
  }

  // The next two weeks of matches, for search. Never allowed to fail the slate.
  try {
    const listed = await refreshSchedule(fitted);
    console.log(`  listed ${listed} upcoming match${listed === 1 ? '' : 'es'} for search`);
  } catch (err) {
    console.log(`  schedule skipped: ${err instanceof Error ? err.message : String(err)}`);
  }

  // The grounds by name, for the match page. Same terms as the colours.
  try {
    const named = await fillVenues(venueIds);
    if (named) console.log(`  named ${named} ground${named === 1 ? '' : 's'}`);
  } catch (err) {
    console.log(`  grounds skipped: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Every competition's page, kept full between its games (leagueinfo.ts):
  // at most every three hours, and never at the cost of the pass.
  try {
    await refreshLeagueInfo(now);
  } catch (err) {
    console.log(`  competition pages skipped: ${err instanceof Error ? err.message : String(err)}`);
  }

  await kvSetJSON('narrate:ledger', ledger.snapshot());
  await kvSetJSON('slate:last_run', { at: now, ...report });

  if (writer) {
    const per = Object.entries(budget.models ?? {})
      .map(([m, st]) => `${m} ${st.used}${st.gone ? ' (retired)' : st.pausedUntil && st.pausedUntil > Date.now() / 1000 ? ' (refused, paused)' : ''}`);
    console.log(`Narratives: ${budget.used} of today's ${perDay} Gemini requests used${per.length ? `: ${per.join(', ')}` : ''}.`);
  }
  if (writer && writerGaveUp) {
    console.log(
      `Narratives: ${narrateReused} reused, ${narrateWritten}/${narrateAttempts} written before ${writer.name} stopped answering `
      + `(${writerGaveUp}). The rest are the template grammar's.`
      + (Object.keys(narrateRejections).length
        ? ` Drafts thrown away: ${Object.entries(narrateRejections).map(([k, v]) => `${k} ${v}`).join(', ')}.`
        : ''),
    );
  } else if (writer) {
    const fellBack = narrateAttempts - narrateWritten;
    console.log(
      `Narratives: ${narrateReused} reused, ${narrateWritten}/${narrateAttempts} written by ${writer.name}`
      + (fellBack > 0
        ? `, ${fellBack} fell back to the grammar (${Object.entries(narrateRejections)
            .map(([k, v]) => `${k} ${v}`).join(', ')})`
        : ''),
    );
  } else if (!rawWriter) {
    console.log('Narratives: no GEMINI_API_KEY, so the template grammar wrote them all.');
  }
  if (previewAttempts || previewsReused) {
    console.log(`Previews of matches with no call: ${previewsReused} reused, ${previewsWritten}/${previewAttempts} written`
      + (Object.keys(previewRejections).length ? ` (thrown away: ${Object.entries(previewRejections).map(([k, v]) => `${k} ${v}`).join(', ')})` : '') + '.');
  }
  if (narrateRescued || previewsRescued) {
    console.log(`Narratives built from the reads, not the grammar: ${narrateRescued} calls, ${previewsRescued} previews.`);
  }
  if (Object.keys(narrateUnbacked).length) {
    console.log(`Narratives: numbers the drafts used that no fact carried: ${Object.entries(narrateUnbacked)
      .sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => `"${k}" ${v}`).join(', ')}.`);
  }

  report.requests = bsdStats.requests;
  report.d1Queries = dbStats.queries;

  console.log(
    `Analysed ${report.analysed}, published ${report.picks} picks, ${report.passes} passes, ` +
      `skipped ${report.skipped}. ${report.requests} provider requests, ${report.d1Queries} D1 queries.`,
  );
  return report;
}

/**
 * Drop fixtures that have fallen out of the board window, keeping the market
 * snapshot of every finished one first (see market_snapshot in the schema):
 * the prices, our probabilities, the provider's and the result are the lab's
 * whole history, and this used to delete them every week.
 */
/**
 * The first of these grounds with a real photograph, in order. The image
 * service answers a ground it has no picture of with a blank of 70 bytes, so
 * anything much bigger is a photograph. Checked here, a few requests every
 * fifteen minutes, rather than by every visitor's phone one request at a time.
 * Null when none has one or the service cannot be reached: the page then
 * falls back to trying them itself.
 */
export async function firstVenuePhoto(ids: Array<number | null | undefined>, fetcher: typeof fetch = fetch): Promise<number | null> {
  const seen = new Set<number>();
  for (const id of ids) {
    if (!Number.isFinite(id) || seen.has(id as number)) continue;
    seen.add(id as number);
    if (seen.size > 14) break;
    try {
      const res = await fetcher(new URL(`/img/venue/${id}/`, config.bsd.base), { signal: AbortSignal.timeout(5000) });
      if (!res.ok) continue;
      const bytes = (await res.arrayBuffer()).byteLength;
      if (bytes > 1000) return id as number;
    } catch { /* unreachable: try the next, or give up quietly */ }
  }
  return null;
}

export async function pruneBoard(): Promise<void> {
  const cutoff = Math.floor(Date.now() / 1000) - 7 * 86400;
  await archiveSnapshots(cutoff);
  // A match with a published call stays, for good. The call is in the record
  // forever, and the record links to the match: deleting it left the results
  // page showing "? v ?" with no score and a match link that said "not found"
  // for every call more than a week old. Every other reader of this table
  // asks for a window of dates, so old rows kept here reach nothing else.
  await dbSelect(
    `DELETE FROM fixture WHERE kickoff < ?
       AND NOT EXISTS (SELECT 1 FROM pick p WHERE p.fixture_id = fixture.id AND p.kind = 'CONFIDENT')`,
    [cutoff],
  );
  await restoreCalledFixtures();
  // Deleted accounts' fingerprints go after the six years the privacy policy gives them.
  if (config.dbBackend === 'postgres') await dbExec('DELETE FROM former_member WHERE at < ?', [Math.floor(Date.now() / 1000) - 6 * 365 * 86400]);
}

/**
 * Called matches deleted before pruneBoard started keeping them, put back.
 *
 * The schema restores what the match and schedule tables still name, but
 * most of the deleted ones -- friendlies, national sides, smaller leagues --
 * were never in either, and their names now live only with the provider (as
 * lab/record.ts found). A few per pass, newest first, so the backlog clears
 * in an hour or two without the provider noticing. A match the provider
 * cannot name is remembered and not asked about again.
 */
export async function restoreCalledFixtures(perPass = 12): Promise<number> {
  if (config.dbBackend !== 'postgres') return 0;
  const skip = new Set<number>(((await kvGetJSON<number[]>('restore:unnamed')) ?? []).map(Number));
  const gone = await dbSelect<{ fixture_id: number; kickoff: number }>(
    `SELECT p.fixture_id, max(p.kickoff) AS kickoff FROM pick p
      WHERE p.kind = 'CONFIDENT' AND p.settled_at IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM fixture f WHERE f.id = p.fixture_id)
      GROUP BY p.fixture_id ORDER BY max(p.kickoff) DESC`,
    [],
  );
  const todo = gone.filter((g) => !skip.has(Number(g.fixture_id))).slice(0, perPass);
  let put = 0;
  for (const g of todo) {
    const id = Number(g.fixture_id);
    const e = await bsdOrNull<Record<string, unknown>>(`/api/v2/events/${id}/`).catch(() => null);
    const home = str(e?.['home_team']);
    const away = str(e?.['away_team']);
    const leagueId = num(e?.['league_id']);
    if (!e || !home || !away || leagueId === undefined) { skip.add(id); continue; }
    const [snap] = await dbSelect<{ home_goals: number; away_goals: number }>(
      'SELECT home_goals, away_goals FROM market_snapshot WHERE fixture_id = ?', [id]);
    const hg = snap?.home_goals ?? num(e['home_score']) ?? null;
    const ag = snap?.away_goals ?? num(e['away_score']) ?? null;
    const [lg] = await dbSelect<{ name: string }>('SELECT name FROM league WHERE id = ?', [leagueId]);
    const homeId = num(e['home_team_id']) ?? null;
    const awayId = num(e['away_team_id']) ?? null;
    const kickoff = Number(g.kickoff);
    const card = JSON.stringify({
      id, league_id: leagueId, league: lg?.name ?? null, kickoff, home, away,
      home_id: homeId, away_id: awayId, verdicts: [], markets: [], restored: true,
    });
    await dbExec(
      `INSERT INTO fixture (id, league_id, kickoff, home_team, away_team, status, provisional,
                            board_json, bundle_json, board_free_json, bundle_free_json, computed_at,
                            home_goals, away_goals, home_team_id, away_team_id, rank)
       VALUES (?, ?, ?, ?, ?, 'finished', 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, 9)
       ON CONFLICT (id) DO NOTHING`,
      [id, leagueId, kickoff, home, away, card, card, card, card, Math.floor(Date.now() / 1000),
        hg, ag, homeId, awayId],
    );
    put++;
  }
  if (todo.length) {
    await kvSetJSON('restore:unnamed', [...skip]);
    console.log(`  put back ${put} called match${put === 1 ? '' : 'es'} the board had let go of (${gone.length - put - skip.size} still to look up)`);
  }
  return put;
}

/** Copy finished fixtures' snapshots older than `before` into market_snapshot. */
export async function archiveSnapshots(before: number): Promise<void> {
  if (config.dbBackend !== 'postgres') return;
  await dbExec(
    `INSERT INTO market_snapshot (fixture_id, league_id, kickoff, home_goals, away_goals, snapshot, archived_at)
     SELECT f.id, f.league_id, f.kickoff, f.home_goals, f.away_goals,
            jsonb_build_object(
              'rank', f.rank,
              'markets', b.j->'markets',
              'lambda', jsonb_build_array(b.j->'lambda_home', b.j->'lambda_away'),
              'confidence', b.j->'confidence',
              'provider', b.j->'external'->'bsd_prediction',
              'corners', CASE WHEN r.j->'stats'->'home'->>'corners' IS NOT NULL AND r.j->'stats'->'away'->>'corners' IS NOT NULL
                              THEN jsonb_build_array((r.j->'stats'->'home'->>'corners')::int, (r.j->'stats'->'away'->>'corners')::int) END,
              'reds', CASE WHEN r.j->'stats'->'home' IS NOT NULL
                           THEN coalesce((r.j->'stats'->'home'->>'red')::int, 0) + coalesce((r.j->'stats'->'away'->>'red')::int, 0) END
            )::text,
            floor(extract(epoch FROM now()))::bigint
       FROM fixture f
       CROSS JOIN LATERAL (SELECT try_json(f.bundle_json)::jsonb AS j) b
       CROSS JOIN LATERAL (SELECT try_json(f.report_json)::jsonb AS j) r
      WHERE f.kickoff < $1 AND f.home_goals IS NOT NULL AND f.away_goals IS NOT NULL
        AND jsonb_typeof(b.j->'markets') = 'array'
        -- Matches kept for their call (pruneBoard) are archived once, not
        -- read again on every pass.
        AND NOT EXISTS (SELECT 1 FROM market_snapshot s WHERE s.fixture_id = f.id
                          AND s.snapshot NOT LIKE '%"source":"backfill"%')
     -- A backfilled row (the market only) gives way to the board's own,
     -- which carries our model's view too.
     ON CONFLICT (fixture_id) DO UPDATE SET snapshot = EXCLUDED.snapshot, archived_at = EXCLUDED.archived_at
      WHERE market_snapshot.snapshot LIKE '%"source":"backfill"%'`,
    [before],
  );
}


/** Who might be named on a fixture page: id, name, and which side. */
function peopleOf(ctx: {
  home: { squad: Array<{ id: number; name: string }> | null; scorers: Array<{ player_id: number; name: string }> | null };
  away: { squad: Array<{ id: number; name: string }> | null; scorers: Array<{ player_id: number; name: string }> | null };
  lineups: { home: { players: Array<{ id: number; name: string }> } | null; away: { players: Array<{ id: number; name: string }> } | null;
             unavailable: Array<{ id: number; name: string; side: 'home' | 'away' | null }> } | null;
}): Array<{ id: number; name: string; side: 'home' | 'away' | null }> {
  const out = new Map<number, { id: number; name: string; side: 'home' | 'away' | null }>();
  const add = (id: unknown, name: unknown, side: 'home' | 'away' | null) => {
    const n = typeof name === 'string' ? name.trim() : '';
    if (typeof id !== 'number' || !Number.isFinite(id) || !n || n.startsWith('#')) return;
    // A full name beats an abbreviated one ("Erling Haaland" over "E. Haaland").
    const prev = out.get(id);
    if (!prev || (/^\p{L}\.\s/u.test(prev.name) && !/^\p{L}\.\s/u.test(n))) out.set(id, { id, name: n, side: side ?? prev?.side ?? null });
  };
  for (const side of ['home', 'away'] as const) {
    for (const p of ctx.lineups?.[side]?.players ?? []) add(p.id, p.name, side);
    for (const p of ctx[side].squad ?? []) add(p.id, p.name, side);
    for (const p of ctx[side].scorers ?? []) add(p.player_id, p.name, side);
  }
  for (const u of ctx.lineups?.unavailable ?? []) add(u.id, u.name, u.side);
  return [...out.values()];
}
