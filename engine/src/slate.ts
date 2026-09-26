import { chanceInWords, refreshSlip } from './slip.ts';
import { bsdList, bsdOrNull, num, str, stats as bsdStats, toEpoch } from './bsd.ts';
import { config } from './config.ts';
import { analyseFixture } from './context/index.ts';
import { checkComparisonEntitlement, gatherFixture, parseScorers } from './context/gather.ts';
import { RepetitionLedger, narrate, narrateConfident, narratePass } from './narrate/compose.ts';
import { chooseHero, type HeroCandidate } from './feature.ts';
import { chooseFreeCall } from './free.ts';
import { writeMissingReports } from './report.ts';
import { fillCrestColors } from './images/crest.ts';
import { fillVenues } from './context/venue.ts';
import { refreshSchedule } from './schedule.ts';
import { pubFacts } from './narrate/facts.ts';
import { geminiWriter } from './narrate/gemini.ts';
import { budgeted, keyId, spent, todays, type BudgetState } from './narrate/budget.ts';
import { write, type Writer } from './narrate/write.ts';
import { freeBoard, freeBundle } from './membership/redact.ts';
import { parsePrediction, providerMarkets } from './provider-model.ts';
import { buildCandidates, driversFor, floorForRank, isLean, marketLabel, select, selectConfident, setAsideFor, type CalibrationMap } from './select.ts';
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

async function loadCalibration(): Promise<CalibrationMap> {
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
   * question about every candidate. Only the floor's penalty is re-based, and
   * only where there are published calls to base it on; otherwise it keeps the
   * family figure, which errs strict rather than loose.
   */
  const called = await dbSelect<{ market: string; model_prob: number; result: string }>(
    `SELECT market, model_prob, result FROM pick
     WHERE kind = 'CONFIDENT' AND settled_at IS NOT NULL
       AND result IN ('WON', 'LOST', 'HALF_WON', 'HALF_LOST')`,
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
  for (const [fam, a] of acc) {
    const row = map.get(fam);
    if (!row) continue;
    row.n = a.n;
    row.mean_model_p = a.p / a.n;
    row.mean_actual = a.hit / a.n;
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
export function narrativeKey(fixtureId: number, c: Candidate): string {
  return `narr:${fixtureId}:${c.market}:${c.outcome}:${c.line ?? ''}`;
}

/** Long enough to outlive a fixture's build-up, short enough to expire. */
const NARRATIVE_TTL = 14 * 86_400;

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
function buildWriter(): Writer | null {
  const apiKey = process.env['GEMINI_API_KEY'];
  if (!apiKey) return null;
  return geminiWriter({
    apiKey,
    model: process.env['GEMINI_MODEL'] || undefined,
    // Gentle enough for the free tier's per-minute limit on any flash model.
    ratePerMinute: Number(process.env['GEMINI_RPM'] || 8),
  });
}

export async function runSlate(): Promise<SlateReport> {
  const now = Math.floor(Date.now() / 1000);

  // The day's allowance, across every run (see narrate/budget.ts). Set
  // GEMINI_PER_DAY to the model's free requests-per-day, less some headroom.
  const perDay = Number(process.env['GEMINI_PER_DAY'] || 200);
  const geminiKey = process.env['GEMINI_API_KEY'];
  const budget: BudgetState = todays(await kvGetJSON<BudgetState>('gemini:budget'), undefined,
    geminiKey ? await keyId(geminiKey) : undefined);
  const rawWriter = buildWriter();
  const writer = rawWriter && !spent(budget, perDay) ? budgeted(rawWriter, budget, perDay) : null;
  if (rawWriter && !writer) {
    console.log(`Narratives: today's ${rawWriter.name} allowance is spent (${budget.used}/${perDay}`
      + `${budget.pausedUntil ? `, paused after Google refused until ${new Date(budget.pausedUntil * 1000).toISOString().slice(11, 16)} UTC` : ''}). The grammar writes until then.`);
  }

  // Counted rather than assumed. A silent drift back to template prose is
  // exactly the failure worth noticing, and it is invisible on the page --
  // the old voice still reads like writing, just worse.
  let narrateAttempts = 0;
  let narrateWritten = 0;
  const narrateRejections: Record<string, number> = {};

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
  const heroCandidates: HeroCandidate[] = [];

  // The grounds on this slate, named once each after the loop.
  const venueIds = new Set<number>();

  for (const event of candidates) {
    const venueId = num(event['venue_id']);
    if (venueId) venueIds.add(venueId);
    try {
      const ctx = await gatherFixture(event);
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
      const confidentVerdicts = (() => {
        if (!prediction) return [];
        const theirCands = buildCandidates(providerMarkets(prediction), analysis.book, calibration);
        // A game people came to the site for is answered even when it is close.
        // Champions League and the big five drop to the marquee floor; the call
        // then carries `lean` and the page frames it as a read on a tight game
        // rather than a strong call.
        return selectConfident(
          theirCands,
          floorForRank(leagueRank(analysis.league_id)),
          calibration,
        ).map((candidate) => {
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
              expectedGoals: prediction.expected_goals,
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
      if (writer && !writerGaveUp) {
        for (const v of confidentVerdicts) {
          // Written once per call, not once per run.
          const key = narrativeKey(analysis.fixture_id, v.candidate);
          // Stored as { text, why } now; older entries are a bare string and
          // are rewritten, since they have no members' paragraph.
          const cached = await kvGetJSON<string | { text: string; why: string | null }>(key);
          if (cached && typeof cached === 'object' && cached.text) {
            v.narrative = cached.text;
            v.why = cached.why ?? null;
            narrateReused++;
            continue;
          }

          if (narrateAttempts >= perRun) break;
          if (spent(budget, perDay)) {
            writerGaveUp = budget.pausedUntil ? 'Google refused for quota; trying again in two hours' : `today's allowance of ${perDay} is spent`;
            break;
          }
          narrateAttempts++;
          const result = await write({
            home: analysis.home_team,
            away: analysis.away_team,
            competition: ctx.league_name ?? 'this competition',
            call: plainCall(v.candidate, analysis.home_team, analysis.away_team),
            facts: pubFacts({
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
            }),
            odds: v.candidate.odds,
          }, writer);
          // Kept after every write, not only at the end, so a run that dies
          // halfway still leaves the day's count right for the next one.
          await kvSetJSON('gemini:budget', budget);

          if (result.text) {
            v.narrative = result.text;
            v.why = result.why ?? null;
            narrateWritten++;
            consecutiveErrors = 0;
            await kvSetJSON(key, { text: result.text, why: v.why }, NARRATIVE_TTL);
          } else {
            for (const r of result.rejections) narrateRejections[r] = (narrateRejections[r] ?? 0) + 1;
            // A rejected draft is the writer working. A thrown request is the
            // writer not being reachable, and only the second kind repeats.
            if (result.error && spent(budget, perDay)) {
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

      // What a reader is actually shown. The split exists because the two
      // audiences want different things: the ledger wants everything the model
      // said so it can be marked, the page wants only the calls we stand behind.
      const publishedVerdicts = confidentVerdicts;

      // No pass note on a match we have called. The value selector passes
      // independently of the confident calls, so 28 of 34 locked cards carried
      // "Nothing to take on Netherlands v Germany ... the closest was double
      // chance 1X at 1.47" -- a sentence that contradicts the card, and one
      // that named a market and its odds to readers who had not paid.
      const passNarrative = selection.passReason && publishedVerdicts.length === 0
        ? narratePass(selection.passReason, analysis.home_team, analysis.away_team, analysis.fixture_id)
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
          book: Object.fromEntries(
            [...(analysis.book.find((b) => b.market === m.market && b.line === m.line)?.fair ?? new Map())]
              .map(([k, v]) => [k, Number((v as number).toFixed(4))]),
          ),
          best: Object.fromEntries(
            [...(analysis.book.find((b) => b.market === m.market && b.line === m.line)?.best ?? new Map())]
              .map(([k, v]) => [k, v]),
          ),
          overround: Number(
            (analysis.book.find((b) => b.market === m.market && b.line === m.line)?.overround ?? 1).toFixed(4),
          ),
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
        pass_reason: publishedVerdicts.length ? null : selection.passReason,
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
        standing.set(analysis.fixture_id, confidentVerdicts.map((v) => ({
          market: v.candidate.market, outcome: v.candidate.outcome, line: v.candidate.line ?? null,
        })));
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
    const rows = await dbSelect<{ id: number; market: string; outcome: string; line: number | null }>(
      `SELECT id, market, outcome, line FROM pick
       WHERE fixture_id = ? AND kind = 'CONFIDENT' AND settled_at IS NULL AND kickoff > ?`,
      [fixtureId, now],
    );
    for (const r of rows) {
      const kept = keep.some((k) => k.market === r.market && String(k.outcome) === String(r.outcome)
        && (k.line ?? null) === (r.line ?? null));
      if (kept) continue;
      await dbExec('DELETE FROM pick WHERE id = ?', [r.id]);
      withdrawn++;
    }
  }
  if (withdrawn) console.log(`  withdrew ${withdrawn} call${withdrawn === 1 ? '' : 's'} replaced before kick-off`);

  // The bet slip follows the board until its first leg kicks off.
  const slip = await refreshSlip();
  if (slip) console.log(`  slip: ${slip.legs.length} legs at total odds of ${slip.odds.toFixed(2)}, ${chanceInWords(slip.chance)}`);

  // What the site leads with today. Written whether or not anything special is
  // on — a quiet Tuesday still needs a masthead, it just gets a quieter one.
  const hero = chooseHero(heroCandidates);
  if (hero) {
    await kvSetJSON('hero:today', hero);
    console.log(`  hero: ${hero.kicker} — ${hero.headline} (${hero.reason})`);
  } else {
    // No called fixture ahead: clear it, rather than leave yesterday's match
    // leading the front page. The page has a masthead for this case.
    await kvSetJSON('hero:today', null);
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

  await kvSetJSON('narrate:ledger', ledger.snapshot());
  await kvSetJSON('slate:last_run', { at: now, ...report });

  if (writer) console.log(`Narratives: ${budget.used} of today's ${perDay} Gemini requests used.`);
  if (writer && writerGaveUp) {
    console.log(
      `Narratives: ${narrateReused} reused, ${narrateWritten}/${narrateAttempts} written before ${writer.name} stopped answering `
      + `(${writerGaveUp}). The rest are the template grammar's.`,
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

  report.requests = bsdStats.requests;
  report.d1Queries = dbStats.queries;

  console.log(
    `Analysed ${report.analysed}, published ${report.picks} picks, ${report.passes} passes, ` +
      `skipped ${report.skipped}. ${report.requests} provider requests, ${report.d1Queries} D1 queries.`,
  );
  return report;
}

/** Drop fixtures that have fallen out of the board window. */
export async function pruneBoard(): Promise<void> {
  const cutoff = Math.floor(Date.now() / 1000) - 7 * 86400;
  await dbSelect('DELETE FROM fixture WHERE kickoff < ?', [cutoff]);
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
