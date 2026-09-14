import { config } from '../config.ts';
import { adj, clamp, computed, effect, gate, unavailable } from '../ledger.ts';
import type { Factor } from '../types.ts';
import type { FixtureContext } from './types.ts';

/**
 * Referee tendency.
 *
 * §13 uses this as its worked example of thin data: "a referee with eleven games
 * of sample gets no tendency assessment." So the gate is enforced here rather
 * than left to judgement, and a referee below it is reported with his sample
 * size and excluded — which is more useful to a reader than silence, because it
 * explains why the cards market has no read.
 */
export function refereeFactors(ctx: FixtureContext): Factor[] {
  const ref = ctx.referee;

  if (!ref) {
    return [
      unavailable({
        id: 'referee.tendency',
        section: '§13',
        tier: 5,
        note: 'No referee appointed or recorded for this fixture yet.',
      }),
    ];
  }

  const leagueReds = ctx.model.rates.reds.leagueMean * 2;
  const leagueYellows = ctx.model.rates.yellows.leagueMean * 2;
  const redRatio = leagueReds > 0 ? ref.reds_per / leagueReds : 1;
  const yellowRatio = leagueYellows > 0 ? ref.yellows_per / leagueYellows : 1;

  // Yellow tendency is the stable signal — reds are too rare for even a
  // well-sampled referee to separate from noise on their own.
  const signal = clamp((yellowRatio - 1) * 1.5, -1, 1);

  return [
    gate(ref.matches, config.gates.refereeMatches, {
      id: 'referee.tendency',
      section: '§13',
      tier: 5,
      note:
        `The referee averages ${ref.yellows_per.toFixed(1)} yellows and ${ref.reds_per.toFixed(2)} reds ` +
        `per match across ${ref.matches} games, against a league average of ${leagueYellows.toFixed(1)} ` +
        `and ${leagueReds.toFixed(2)}.`,
      evidence: {
        matches: ref.matches,
        yellows_per_match: Number(ref.yellows_per.toFixed(2)),
        reds_per_match: Number(ref.reds_per.toFixed(3)),
        league_yellows_per_match: Number(leagueYellows.toFixed(2)),
        league_reds_per_match: Number(leagueReds.toFixed(3)),
        yellow_ratio: Number(yellowRatio.toFixed(2)),
        red_ratio: Number(redRatio.toFixed(2)),
      },
      adjustments: Math.abs(signal) > 0.1 ? [adj('cards', 'both', effect(signal))] : [],
      claims:
        Math.abs(signal) > 0.25
          ? [
              {
                subject: 'the referee',
                predicate: 'referee',
                polarity: signal > 0 ? 1 : -1,
                magnitude: clamp(Math.abs(signal), 0.2, 1),
                evidence: {
                  yellows_per_match: Number(ref.yellows_per.toFixed(1)),
                  league_average: Number(leagueYellows.toFixed(1)),
                  matches: ref.matches,
                },
                section: '§13',
                tier: 5,
              },
            ]
          : [],
      strength: clamp(Math.abs(signal) * 0.6, 0.1, 0.6),
    }),
  ];
}
