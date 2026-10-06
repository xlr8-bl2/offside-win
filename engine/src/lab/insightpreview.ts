/**
 * `lab` with the argument `deep insight`: the reads underneath the results
 * (narrate/insight.ts) on the biggest matches still to play, and the writer's
 * preview drafted from them beside the preview the site carries now.
 *
 * Read-only: nothing is stored, and only three previews are drafted, out of
 * the same daily allowance the slate writes from. Every match here is still
 * to be played, so only the free preview is drafted -- never a call.
 */

import { select } from '../store.ts';
import { pubFacts } from '../narrate/facts.ts';
import { matchInsights, teamGames } from '../narrate/insight.ts';
import { write } from '../narrate/write.ts';
import { geminiWriter } from '../narrate/gemini.ts';
import type { MatchRow } from '../types.ts';

async function recent(teamId: number, before: number): Promise<MatchRow[]> {
  return select<MatchRow>(
    `SELECT id, league_id, season_id, kickoff, home_team_id, away_team_id,
            home_goals, away_goals, home_xg, away_xg, xg_estimated,
            home_corners, away_corners, home_yellows, away_yellows,
            home_reds, away_reds, home_possession, away_possession,
            home_shots, away_shots, home_sot, away_sot, referee_id
       FROM match WHERE (home_team_id = $1 OR away_team_id = $1) AND kickoff < $2
      ORDER BY kickoff DESC LIMIT 12`,
    [teamId, before],
  );
}

export async function runInsightPreview(): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const fixtures = await select<{ id: number; kickoff: number; rank: number | null; home_team: string; away_team: string; home_team_id: number; away_team_id: number; bundle_json: string; league_id: number }>(
    `SELECT id, kickoff, rank, home_team, away_team, home_team_id, away_team_id, bundle_json, league_id
       FROM fixture WHERE kickoff > $1 AND kickoff < $2 AND home_team_id IS NOT NULL
      ORDER BY coalesce(rank, 9), kickoff LIMIT 10`,
    [now, now + 3 * 86400],
  );
  const key = process.env['GEMINI_API_KEY'];
  // The slate's own fallback order: the first model that answers writes.
  const models = [...new Set([process.env['GEMINI_MODEL']?.trim(), 'gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3-flash-preview'].filter(Boolean) as string[])];
  const writers = key ? models.map((model) => geminiWriter({ apiKey: key, model, ratePerMinute: 6 })) : [];
  const writer = writers.length ? writers[0]! : null;
  let drafted = 0;
  for (const f of fixtures) {
    const [hm, am] = await Promise.all([recent(Number(f.home_team_id), Number(f.kickoff)), recent(Number(f.away_team_id), Number(f.kickoff))]);
    const reads = matchInsights(
      { name: f.home_team, games: teamGames(hm, Number(f.home_team_id)) },
      { name: f.away_team, games: teamGames(am, Number(f.away_team_id)) },
    );
    const withXg = (rows: MatchRow[]) => rows.filter((r) => r.home_xg !== null && r.home_goals !== null).length;
    console.log(`\n=== ${f.home_team} v ${f.away_team} (rank ${f.rank ?? '-'}): ${withXg(hm)} and ${withXg(am)} recent games with chances recorded`);
    for (const r of reads) console.log(`  [${r.weight}] ${r.text}`);
    if (!reads.length) console.log('  (nothing striking underneath: the writer leads on the other facts)');

    let b: Record<string, unknown> = {};
    try { b = JSON.parse(f.bundle_json); } catch { /* no bundle yet */ }
    const before = typeof b['preview'] === 'string' ? b['preview'] as string : null;
    if (!writer || drafted >= 4 || reads.length < 2) continue;
    drafted++;
    const facts = pubFacts({
      home: f.home_team, away: f.away_team,
      ledger: b['ledger'] as never, form: b['form'] as never, h2h: b['h2h'] as never, lineups: b['lineups'] as never,
      players: b['players'] as never, extras: b['extras'] as never,
      matches: { home: hm, away: am, homeId: Number(f.home_team_id), awayId: Number(f.away_team_id) },
    });
    console.log('  facts the writer gets, in order:');
    for (const x of facts.slice(0, 18)) console.log(`    - ${x.text}`);
    let res = await write({ home: f.home_team, away: f.away_team, competition: String(b['league'] ?? 'this competition'), call: '', facts, previewOnly: true }, writer);
    for (const other of writers.slice(1)) {
      if (res.text || !res.error) break;
      res = await write({ home: f.home_team, away: f.away_team, competition: String(b['league'] ?? 'this competition'), call: '', facts, previewOnly: true }, other);
    }
    console.log(`  BEFORE: ${before ?? '(none stored)'}`);
    console.log(`  AFTER:  ${res.text ?? `(rejected: ${res.rejections.join(', ')}${res.error ? `; ${res.error}` : ''})`}`);
  }
}
