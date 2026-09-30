/**
 * Our own read of every match in the lab's history, as it would have been
 * made before kick-off.
 *
 * Only the fixtures the board carried have our model's probabilities frozen
 * in them (about one in nine of the history); the rest came back through the
 * odds backfill with the market's view alone. To ask "does our own analysis
 * add anything to the price?" on the whole history rather than on that
 * ninth, the ratings are refitted as of each week, per competition, on the
 * matches played strictly before it, exactly as the slate fits them (goals
 * and xG, blended). No match ever sees its own result.
 *
 * What this leaves out: the slate's context adjustments on top of the
 * ratings (absences, rest, the occasion). So it is our base read, not the
 * whole of it, and a test of it is a test of the ratings.
 */

import { loadMatches } from '../history.ts';
import { fitBlended } from '../ratings/blend.ts';
import { expectedGoals } from '../ratings/dixoncoles.ts';
import { config } from '../config.ts';
import type { MatchRow } from '../types.ts';
import type { HistRow } from './markets.ts';

export interface OwnRead { home: number; away: number; rho: number }

const WEEK = 7 * 86400;

/**
 * Our read of each history row that sits in a competition with enough played
 * matches to fit, keyed by fixture id. Refits once a week per competition;
 * a refit on every match is more exact and a hundred times slower, and the
 * ratings barely move inside a week.
 */
export async function ownReads(rows: HistRow[], log = console.log): Promise<Map<number, OwnRead>> {
  const out = new Map<number, OwnRead>();
  const byLeague = new Map<number, HistRow[]>();
  for (const r of rows) byLeague.set(r.league_id, [...(byLeague.get(r.league_id) ?? []), r]);
  let fits = 0, leagues = 0;
  const started = Date.now();
  for (const [leagueId, hist] of byLeague) {
    const all: MatchRow[] = (await loadMatches(leagueId)).filter((m) => m.home_goals !== null && m.away_goals !== null);
    const byId = new Map(all.map((m) => [m.id, m]));
    hist.sort((a, b) => a.kickoff - b.kickoff);
    let fit: ReturnType<typeof fitBlended> | null = null;
    let fitWeek = -1;
    let used = false;
    for (const r of hist) {
      const m = byId.get(r.id);
      if (!m) continue;
      const week = Math.floor(r.kickoff / WEEK);
      if (!fit || week !== fitWeek) {
        // Everything played before the start of this fixture's week: the fit
        // is shared by the week's matches, so it may see none of them.
        const cut = week * WEEK;
        const train = all.filter((x) => x.kickoff < cut);
        fitWeek = week;
        if (train.length < config.ratings.minMatches * 4) { fit = null; continue; }
        fit = fitBlended(train, leagueId, cut);
        fits++;
      }
      if (!fit) continue;
      const known = fit.teams.has(m.home_team_id) && fit.teams.has(m.away_team_id);
      // A side we have never seen is rated average, which says nothing; leave
      // the match out rather than score a guess as our read.
      if (!known) continue;
      const g = expectedGoals(fit, m.home_team_id, m.away_team_id);
      if (!(g.home > 0 && g.away > 0)) continue;
      out.set(r.id, { home: g.home, away: g.away, rho: fit.params.rho });
      used = true;
    }
    if (used) leagues++;
  }
  log(`own reads: ${out.size} of ${rows.length} fixtures, ${leagues} competitions, ${fits} weekly fits, ${((Date.now() - started) / 1000).toFixed(0)}s`);
  return out;
}
