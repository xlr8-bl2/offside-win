import { bsdList, num, str, stats as bsdStats, toEpoch } from './bsd.ts';
import { config } from './config.ts';
import { analyseFixture } from './context/index.ts';
import { checkComparisonEntitlement, gatherFixture } from './context/gather.ts';
import { RepetitionLedger, narrate, narrateConfident, narratePass } from './narrate/compose.ts';
import { chooseHero, type HeroCandidate } from './feature.ts';
import { pubFacts } from './narrate/facts.ts';
import { geminiWriter } from './narrate/gemini.ts';
import { write, type Writer } from './narrate/write.ts';
import { freeBoard, freeBundle } from './membership/redact.ts';
import { parsePrediction, providerMarkets } from './provider-model.ts';
import { buildCandidates, driversFor, marketLabel, select, selectConfident, setAsideFor, type CalibrationMap } from './select.ts';
import { dbStats, insertMany, kvGetJSON, kvSetJSON, pickConflictTarget, select as dbSelect } from './store.ts';
import type { CalibrationRow } from './select.ts';
import type { Candidate, Factor, MarketFamily } from './types.ts';

/**
 * The slate: price the next few days, publish the board.
 *
 * Everything here runs on GitHub Actions and writes finished JSON to D1. The
 * Worker reads those rows and serves them, which is why it stays inside the free
 * tier's 10 ms of CPU — there is nothing left for it to compute.
 */

async function loadCalibration(): Promise<CalibrationMap> {
  const rows = await dbSelect<{ market_family: MarketFamily; n: number; shrink: number }>(
    'SELECT market_family, n, shrink FROM calibration',
  );
  return new Map(rows.map((r) => [r.market_family, r as CalibrationRow]));
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
    ratePerMinute: Number(process.env['GEMINI_RPM'] ?? 15),
  });
}

export async function runSlate(): Promise<SlateReport> {
  const now = Math.floor(Date.now() / 1000);
  const writer = buildWriter();

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
  let writerGaveUp: string | null = null;
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
  const heroCandidates: HeroCandidate[] = [];

  for (const event of candidates) {
    try {
      const ctx = await gatherFixture(event);
      if (!ctx) {
        report.skipped++;
        continue;
      }
      ctx.comparisonEntitled = entitled;

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
        return selectConfident(theirCands).map((candidate) => {
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
              lineups: ctx.lineups ? { status: ctx.lineups.status } : null,
            }),
          }, writer);

          if (result.text) {
            v.narrative = result.text;
            narrateWritten++;
            consecutiveErrors = 0;
          } else {
            for (const r of result.rejections) narrateRejections[r] = (narrateRejections[r] ?? 0) + 1;
            // A rejected draft is the writer working. A thrown request is the
            // writer not being reachable, and only the second kind repeats.
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

      const passNarrative = selection.passReason
        ? narratePass(selection.passReason, analysis.home_team, analysis.away_team, analysis.fixture_id)
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
                prob: Number(v.candidate.model_prob.toFixed(3)),
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
          narrative: v.narrative,
          drivers: v.drivers.map(forStorage),
          set_aside: v.set_aside.map(forStorage),
        })),
        pass_reason: selection.passReason,
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

      for (const v of allVerdicts) {
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
          narrative: v.narrative,
          evidence_json: JSON.stringify({
            drivers: v.drivers.map(forStorage),
            set_aside: v.set_aside.map(forStorage),
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
        'provisional', 'rank', 'board_json', 'bundle_json',
        'board_free_json', 'bundle_free_json', 'computed_at',
      ],
      fixtureRows,
      { conflictTarget: 'id' },
    );
  }

  if (pickRows.length > 0) {
    // A pick is identified by fixture, market, outcome, line and kind. Rerunning
    // a slate must refresh the same row rather than publish a duplicate, but a
    // settled pick is history and is never overwritten.
    await insertMany(
      'pick',
      [
        'fixture_id', 'kickoff', 'market', 'outcome', 'line', 'kind', 'model_prob',
        'book_prob', 'edge', 'shrunk_edge', 'odds', 'bookmaker', 'kelly',
        'confidence', 'provisional', 'narrative', 'evidence_json', 'created_at',
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
          'narrative = excluded.narrative, evidence_json = excluded.evidence_json ' +
          'WHERE pick.settled_at IS NULL',
      },
    );
  }

  // What the site leads with today. Written whether or not anything special is
  // on — a quiet Tuesday still needs a masthead, it just gets a quieter one.
  const hero = chooseHero(heroCandidates);
  if (hero) {
    await kvSetJSON('hero:today', hero);
    console.log(`  hero: ${hero.kicker} — ${hero.headline} (${hero.reason})`);
  }

  await kvSetJSON('narrate:ledger', ledger.snapshot());
  await kvSetJSON('slate:last_run', { at: now, ...report });

  if (writer && writerGaveUp) {
    console.log(
      `Narratives: ${narrateWritten}/${narrateAttempts} written before ${writer.name} stopped answering `
      + `(${writerGaveUp}). The rest are the template grammar's.`,
    );
  } else if (writer) {
    const fellBack = narrateAttempts - narrateWritten;
    console.log(
      `Narratives: ${narrateWritten}/${narrateAttempts} written by ${writer.name}`
      + (fellBack > 0
        ? `, ${fellBack} fell back to the grammar (${Object.entries(narrateRejections)
            .map(([k, v]) => `${k} ${v}`).join(', ')})`
        : ''),
    );
  } else {
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
