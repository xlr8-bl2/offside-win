import { adj, clamp, computed, effect, thin, unavailable } from '../ledger.ts';
import { num } from '../bsd.ts';
import type { Claim, Factor } from '../types.ts';
import type { FixtureContext, SideContext } from './types.ts';

/**
 * §2.8 fatigue, §5.5 congestion, §6.4 travel.
 *
 * §2.8 gives the thresholds directly: three days' rest sustains full effort,
 * two days is where degradation starts, one day is measurably worse pressing,
 * slower defensive recovery and poorer decisions in the final third. §5.5 adds
 * that three matches in seven days degrades output from the third game onward.
 *
 * The schedule is read across every competition rather than from our own league
 * history, because the fixture that makes Saturday's legs heavy is usually the
 * midweek European tie — precisely the one a league-only view cannot see.
 *
 * Fatigue is applied to more than goals. §2.8 is specific that what degrades
 * first is pressing intensity and high-activity running, which shows up in
 * corner volume before it shows up in the scoreline, and in cards as tired
 * players mistime challenges.
 */

export interface RestProfile {
  daysRest: number | null;
  matchesIn7: number;
  matchesIn14: number;
}

export function restProfile(schedule: number[] | null, kickoff: number): RestProfile | null {
  if (!schedule || schedule.length === 0) return null;
  const past = schedule.filter((t) => t < kickoff - 3600).sort((a, b) => b - a);
  const last = past[0];
  return {
    daysRest: last === undefined ? null : (kickoff - last) / 86400,
    matchesIn7: past.filter((t) => t >= kickoff - 7 * 86400).length,
    matchesIn14: past.filter((t) => t >= kickoff - 14 * 86400).length,
  };
}

export function fatigueFactors(ctx: FixtureContext): Factor[] {
  return [
    sideFatigue(ctx, 'home'),
    sideFatigue(ctx, 'away'),
    travelFactor(ctx),
  ];
}

function sideFatigue(ctx: FixtureContext, which: 'home' | 'away'): Factor {
  const side: SideContext = ctx[which];
  const profile = restProfile(side.schedule, ctx.kickoff);

  if (!profile) {
    return unavailable({
      id: `fatigue.${which}`,
      section: '§2.8',
      tier: 4,
      note: `No fixture schedule available for ${side.team_name}, so rest and congestion cannot be read.`,
    });
  }

  if (profile.daysRest === null) {
    return thin({
      id: `fatigue.${which}`,
      section: '§2.8',
      tier: 4,
      note: `${side.team_name} have no prior fixture on record in the window, so days of rest cannot be computed.`,
      evidence: profile as unknown as Record<string, unknown>,
    });
  }

  const rest = profile.daysRest;

  // §2.8's ladder. Three days is the baseline that sustains full effort; below
  // that the degradation is real, and it steepens rather than falling linearly.
  //
  // There used to be a fourth rung here — a 0.25 penalty below four days — which
  // contradicted the doctrine written at the top of this file and put a fatigue
  // caveat on any side playing a normal midweek fixture. The live board carried
  // "Deportivo Alavés have had only 3.3 days since their last match" and
  // "coming in on 3.0 days' rest, Grasshopper arrive slightly short of fresh",
  // both on schedules that are simply what a league season looks like.
  let restPenalty = 0;
  if (rest < 2) restPenalty = 1.0;
  else if (rest < 3) restPenalty = 0.6;

  // §5.5: three in seven, or five in fourteen, degrades from that match on.
  //
  // Two in seven is a Saturday and a Wednesday — the ordinary week of any side
  // in a cup or in Europe, and not congestion by the doctrine's own definition.
  // Counting it produced "2 matches in a fortnight has left AFC Ajax running on
  // reserves", which describes a lighter schedule than a normal league month.
  const congestion = profile.matchesIn7 >= 3 ? 0.7 : 0;
  const deepCongestion = profile.matchesIn14 >= 5 ? 0.4 : 0;

  const load = clamp(restPenalty + congestion + deepCongestion, 0, 1.6);

  if (load < 0.2) {
    return computed({
      id: `fatigue.${which}`,
      section: '§2.8',
      tier: 4,
      note: `${side.team_name} come in on ${rest.toFixed(1)} days' rest with a normal schedule behind them.`,
      evidence: { ...profile, days_rest: Number(rest.toFixed(1)) },
      strength: 0.1,
    });
  }

  const claims: Claim[] = [
    {
      subject: side.team_name,
      predicate: 'fatigue',
      polarity: -1,
      magnitude: clamp(load / 1.6, 0.2, 1),
      evidence: {
        days_rest: Number(rest.toFixed(1)),
        matches_in_7_days: profile.matchesIn7,
        matches_in_14_days: profile.matchesIn14,
      },
      section: profile.matchesIn7 >= 3 ? '§5.5' : '§2.8',
      tier: 4,
    },
  ];

  return computed({
    id: `fatigue.${which}`,
    section: profile.matchesIn7 >= 3 ? '§5.5' : '§2.8',
    tier: 4,
    note:
      `${side.team_name} have had ${rest.toFixed(1)} days' rest` +
      (profile.matchesIn7 >= 3
        ? ` and this is their ${profile.matchesIn7 + 1}${ordinal(profile.matchesIn7 + 1)} match in seven days.`
        : profile.matchesIn14 >= 5
          ? ` with ${profile.matchesIn14} matches behind them in a fortnight.`
          : '.'),
    evidence: {
      days_rest: Number(rest.toFixed(1)),
      matches_in_7_days: profile.matchesIn7,
      matches_in_14_days: profile.matchesIn14,
      load: Number(load.toFixed(2)),
    },
    adjustments: [
      adj('goals', which, effect(-0.35 * load)),
      // Pressing and high-activity running degrade before finishing does, and
      // corner volume is the visible consequence.
      adj('corners', which, effect(-0.5 * load)),
      // Tired players mistime challenges.
      adj('cards', 'both', effect(0.25 * load)),
    ],
    claims,
    strength: clamp(load / 1.6, 0.2, 0.9),
  });
}

function ordinal(n: number): string {
  if (n % 100 >= 11 && n % 100 <= 13) return 'th';
  return ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th';
}

/**
 * §6.4 travel. The doctrine is careful that the effect is largest for genuinely
 * long trips into different time zones and modest for routine domestic travel,
 * so the threshold sits high rather than penalising every away day.
 */
function travelFactor(ctx: FixtureContext): Factor {
  const km = num(ctx.event['travel_distance_km']);

  if (km === undefined) {
    return unavailable({
      id: 'fatigue.travel',
      section: '§6.4',
      tier: 6,
      note: 'No travel distance reported for this fixture.',
    });
  }

  if (km < 800) {
    return computed({
      id: 'fatigue.travel',
      section: '§6.4',
      tier: 6,
      note: `Routine trip of ${Math.round(km)} km for ${ctx.away.team_name}.`,
      evidence: { travel_km: Math.round(km) },
      strength: 0,
    });
  }

  const k = clamp((km - 800) / 2500, 0, 1);
  return computed({
    id: 'fatigue.travel',
    section: '§6.4',
    tier: 6,
    note: `${ctx.away.team_name} travel ${Math.round(km)} km for this fixture.`,
    evidence: { travel_km: Math.round(km) },
    adjustments: [adj('goals', 'away', effect(-0.3 * k)), adj('corners', 'away', effect(-0.3 * k))],
    claims: [
      {
        subject: ctx.away.team_name,
        predicate: 'travel',
        polarity: -1,
        magnitude: k,
        evidence: { travel_km: Math.round(km) },
        section: '§6.4',
        tier: 6,
      },
    ],
    strength: clamp(k * 0.5, 0.1, 0.5),
  });
}

export const _internals = { ordinal };
