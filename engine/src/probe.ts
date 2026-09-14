import { mkdirSync, writeFileSync } from 'node:fs';
import { bsdRaw, bsdList, bsdOrNull } from './bsd.ts';
import { config } from './config.ts';

/**
 * Shape prober.
 *
 * The provider's OpenAPI types several of the fields this model leans on hardest
 * as `any` — `weather`, `head_to_head`, `unavailable_players`, `appointment_effect`,
 * prediction `markets`. Guessing at those shapes and finding out on the first
 * odd fixture is how parsers rot, so this walks a real fixture end to end with a
 * live key and writes both the raw payloads and an inferred type sketch to
 * `probe-output/`.
 *
 * Run it once after setting BSD_API_KEY, read the sketch, and tighten the
 * coercions in the factor modules against what actually comes back.
 *
 *   BSD_API_KEY=... npm run probe
 */

const OUT = 'probe-output';

/** Describe a value's structure without dumping megabytes of it. */
function sketch(v: unknown, depth = 0): unknown {
  if (v === null) return 'null';
  if (Array.isArray(v)) {
    if (v.length === 0) return ['<empty>'];
    if (depth >= 4) return [`<array of ${v.length}>`];
    return [sketch(v[0], depth + 1), `…${v.length} items`];
  }
  if (typeof v === 'object') {
    if (depth >= 4) return '<object>';
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      out[k] = sketch(val, depth + 1);
    }
    return out;
  }
  if (typeof v === 'string') {
    // Keep short strings verbatim — enum-ish values are the interesting ones.
    return v.length <= 40 ? `string(${JSON.stringify(v)})` : 'string';
  }
  return typeof v;
}

async function probeOne(label: string, path: string, params?: Record<string, string | number>) {
  const res = await bsdRaw(path, params);
  if (!res.ok) {
    console.log(`  ${label.padEnd(28)} ${res.status} ${res.reason} ${res.message.slice(0, 90)}`);
    return { label, path, ok: false, status: res.status, reason: res.reason, message: res.message };
  }
  writeFileSync(`${OUT}/${label}.raw.json`, JSON.stringify(res.data, null, 2));
  const s = sketch(res.data);
  writeFileSync(`${OUT}/${label}.sketch.json`, JSON.stringify(s, null, 2));
  console.log(`  ${label.padEnd(28)} ok`);
  return { label, path, ok: true, status: res.status, sketch: s };
}

export async function probe(): Promise<void> {
  if (!config.bsd.key) throw new Error('BSD_API_KEY is required to probe.');
  mkdirSync(OUT, { recursive: true });

  console.log('Coverage (public endpoint, confirms reachability):');
  await probeOne('coverage', '/api/v2/coverage/');

  console.log('\nLeagues:');
  const leagues = await bsdList<Record<string, unknown>>('/api/v2/leagues/', {}, { limit: 100, max: 100 });
  writeFileSync(`${OUT}/leagues.raw.json`, JSON.stringify(leagues, null, 2));
  console.log(`  ${leagues.length} leagues`);
  for (const l of leagues.slice(0, 40)) {
    console.log(`    ${String(l.id).padStart(6)}  ${String(l.name ?? '')}  ${String(l.country ?? '')}`);
  }

  // Find a fixture with odds in the next few days — a priced one exercises the
  // most code paths.
  const from = new Date().toISOString().slice(0, 10);
  const to = new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 10);
  const events = await bsdList<Record<string, unknown>>(
    '/api/v2/events/',
    { date_from: from, date_to: to },
    { limit: 200, max: 400 },
  );
  writeFileSync(`${OUT}/events.raw.json`, JSON.stringify(events.slice(0, 50), null, 2));
  console.log(`\n${events.length} events in the next 5 days`);

  // Prefer one that already has odds, then one with weather populated.
  let target = events.find((e) => e.weather != null) ?? events[0];
  if (!target) {
    console.log('No upcoming events found — cannot probe fixture-scoped endpoints.');
    return;
  }
  const id = Number(target.id);
  const home = String(target.home_team ?? '');
  const away = String(target.away_team ?? '');
  console.log(`\nFixture-scoped probe on ${id}: ${home} v ${away}`);
  writeFileSync(`${OUT}/event.raw.json`, JSON.stringify(target, null, 2));
  writeFileSync(`${OUT}/event.sketch.json`, JSON.stringify(sketch(target), null, 2));

  const results = [];
  results.push(await probeOne('event_detail', `/api/v2/events/${id}/`));
  results.push(await probeOne('lineups', `/api/v2/events/${id}/lineups/`));
  results.push(await probeOne('odds_event', '/api/v2/odds/', { event_id: id, market: '1x2', limit: 50 }));
  results.push(await probeOne('odds_all_markets', '/api/v2/odds/', { event_id: id, limit: 200 }));
  results.push(await probeOne('odds_comparison', `/api/v2/events/${id}/odds/comparison/`));
  results.push(await probeOne('polymarket', `/api/v2/events/${id}/polymarket/`));
  results.push(await probeOne('prediction', `/api/v2/events/${id}/prediction/`));
  results.push(await probeOne('event_stats', `/api/v2/events/${id}/stats/`));
  results.push(await probeOne('h2h', `/api/v2/events/${id}/h2h/`));
  results.push(await probeOne('incidents', `/api/v2/events/${id}/incidents/`));
  results.push(await probeOne('metadata', `/api/v2/events/${id}/metadata/`));
  results.push(await probeOne('player_stats_event', `/api/v2/events/${id}/player-stats/`));

  const homeId = Number(target.home_team_id);
  const leagueId = Number(target.league_id);
  const coachId = Number(target.home_coach_id);
  const refId = Number(target.referee_id);

  if (Number.isFinite(homeId)) {
    results.push(await probeOne('team_squad', `/api/v2/teams/${homeId}/squad/`));
    results.push(await probeOne('team_fixtures', `/api/v2/teams/${homeId}/fixtures/`, {
      date_from: new Date(Date.now() - 60 * 864e5).toISOString().slice(0, 10),
      date_to: to,
    }));
  }
  if (Number.isFinite(leagueId)) {
    results.push(await probeOne('standings', `/api/v2/leagues/${leagueId}/standings/`));
    results.push(await probeOne('league_season', `/api/v2/leagues/${leagueId}/season/`));
    results.push(await probeOne('league_seasons', `/api/v2/leagues/${leagueId}/seasons/`));
  }
  if (Number.isFinite(coachId) && coachId > 0) {
    results.push(await probeOne('manager', `/api/v2/managers/${coachId}/`));
    results.push(await probeOne('manager_career', `/api/v2/managers/${coachId}/career/`));
  }
  if (Number.isFinite(refId) && refId > 0) {
    results.push(await probeOne('referee', `/api/v2/referees/${refId}/`));
  }

  // Money-flow endpoints: documented as visible to any token at /coverage/ so a
  // caller can judge whether to subscribe. Probe to learn which tier we hold.
  console.log('\nMoney-flow (WOM) entitlement:');
  results.push(await probeOne('wom_coverage', '/wom/api/coverage/'));
  results.push(await probeOne('wom_markets', '/wom/api/markets/'));
  results.push(await probeOne('wom_event', `/wom/api/events/${id}/`));
  results.push(await probeOne('wom_history', `/wom/api/events/${id}/history/`));
  results.push(await probeOne('wom_movers', '/wom/api/movers/'));

  // A finished match, so the stats shape used for fitting is captured too —
  // upcoming fixtures carry none.
  const finished = await bsdList<Record<string, unknown>>(
    '/api/v2/events/',
    {
      date_from: new Date(Date.now() - 10 * 864e5).toISOString().slice(0, 10),
      date_to: new Date(Date.now() - 1 * 864e5).toISOString().slice(0, 10),
      ...(Number.isFinite(leagueId) ? { league_id: leagueId } : {}),
    },
    { limit: 100, max: 100 },
  );
  const done = finished.find((e) => e.home_score != null);
  if (done) {
    console.log(`\nFinished match probe on ${done.id}:`);
    results.push(await probeOne('finished_event', `/api/v2/events/${Number(done.id)}/`));
    results.push(await probeOne('finished_stats', `/api/v2/events/${Number(done.id)}/stats/`));
    results.push(await probeOne('finished_incidents', `/api/v2/events/${Number(done.id)}/incidents/`));
  }

  writeFileSync(`${OUT}/_summary.json`, JSON.stringify(results, null, 2));

  const entitled = results.filter((r) => !r.ok && r.reason === 'not_entitled').map((r) => r.label);
  const missing = results.filter((r) => !r.ok && r.reason !== 'not_entitled').map((r) => r.label);

  console.log('\n--- summary ---');
  console.log(`wrote ${OUT}/ — raw payloads and inferred shape sketches`);
  if (entitled.length) console.log(`behind a paid tier: ${entitled.join(', ')}`);
  if (missing.length) console.log(`unavailable/errored: ${missing.join(', ')}`);
  console.log('\nThe fields to read carefully in the sketches, all typed `any` upstream:');
  console.log('  event.weather, event.head_to_head, event.pitch_condition');
  console.log('  lineups.lineups, lineups.unavailable_players');
  console.log('  manager_career.tenures[].appointment_effect');
  console.log('  prediction.markets, prediction.recommendations');
  console.log('  event_stats.stats, event_stats.shotmap, event_stats.xg_per_minute');
}
