import { adj, clamp, computed, effect, thin, unavailable } from '../ledger.ts';
import type { Claim, Factor } from '../types.ts';
import type { FixtureContext, ManagerInfo, SideContext } from './types.ts';

/**
 * §1 — the manager.
 *
 * §1.1 makes a point most models skip: a manager's record means nothing in
 * isolation. 1.8 points per match is excellent if the club was managing 1.0
 * before he arrived and alarming if it was managing 2.3. The provider computes
 * exactly that comparison — the club's form in the matches immediately before
 * the appointment against the same number immediately after — so the honest
 * measure is available directly and there is no excuse for using raw ppm.
 *
 * The other thing §1.1 insists on is that the new-manager bounce is real *and*
 * reverts. A side winning its first three under a new man is likely to regress
 * by game six. So the bounce is applied inside its window and deliberately not
 * outside it, rather than being smeared across a whole tenure.
 */

/** §1.1: the first few games, where the bounce lives. */
const BOUNCE_WINDOW = 5;
/** Through this many games the bounce has decayed and reversion is the read. */
const REVERSION_WINDOW = 15;
/** §1.3: long enough for tactical habits to be automatic. */
const SETTLED_DAYS = 730;
const SETTLED_MATCHES = 60;

export function managerFactors(ctx: FixtureContext): Factor[] {
  return [
    sideManagerFactor(ctx.home, 'home'),
    sideManagerFactor(ctx.away, 'away'),
  ];
}

function sideManagerFactor(side: SideContext, which: 'home' | 'away'): Factor {
  const mgr = side.manager;

  if (!mgr) {
    return unavailable({
      id: `manager.${which}`,
      section: '§1.1',
      tier: 3,
      note: `No manager record for ${side.team_name}, so regime state cannot be read.`,
    });
  }

  if (!mgr.current || mgr.matchesInCharge === null) {
    return thin({
      id: `manager.${which}`,
      section: '§1.1',
      tier: 3,
      note: `${side.team_name}'s manager is identified but the tenure has no match record attached.`,
      evidence: { manager: mgr.name },
    });
  }

  const games = mgr.matchesInCharge;
  const days = mgr.tenureDays ?? 0;
  const ae = mgr.current.appointment_effect;
  // The provider fills before and after and often leaves the difference null
  // (Misiura at Motor: 1.2 before, 1.4 after, delta null). Without it the
  // settling read never knew which way the appointment had gone, and wrote
  // "an early lift usually fades" over Graham Alexander's Preston while they
  // were picking up more points every week.
  const delta: number | null =
    typeof ae?.delta === 'number'
      ? ae.delta
      : typeof ae?.after_ppm === 'number' && typeof ae?.before_ppm === 'number'
        ? ae.after_ppm - ae.before_ppm
        : null;
  const name = mgr.name ?? 'the manager';
  // Every note below opens on the manager, and the fallback is lowercase
  // because it also travels into claim evidence where frames use it
  // mid-sentence. The live board showed the consequence: "the manager is 1 game
  // into the job at Raków Częstochowa."
  const Name = name[0]!.toUpperCase() + name.slice(1);

  const evidence: Record<string, unknown> = {
    manager: name,
    matches_in_charge: games,
    tenure_days: Math.round(days),
    ppm: mgr.current.ppm,
    appointment_effect: ae,
  };

  // §1.1's bounce window.
  if (games <= BOUNCE_WINDOW) {
    const k = 1 - games / (BOUNCE_WINDOW + 1);
    // Three games in, the record says which way it is going; before that the
    // lift is the read. A side going backwards under the new man is not on a
    // bounce, whatever the window says.
    const goingBackwards = games >= 3 && delta !== null && delta <= -0.25;
    const claims: Claim[] = [
      {
        subject: side.team_name,
        predicate: 'regime_new',
        polarity: goingBackwards ? -1 : 1,
        magnitude: clamp(k, 0.3, 1),
        evidence: {
          manager: name,
          matches_in_charge: games,
          ...(delta !== null ? { appointment_delta: Number(delta.toFixed(2)) } : {}),
        },
        section: '§1.1',
        tier: 3,
      },
    ];

    return computed({
      id: `manager.${which}.bounce`,
      section: '§1.1',
      tier: 3,
      note:
        `${Name} is ${games} game${games === 1 ? '' : 's'} into the job at ${side.team_name}` +
        (delta !== null && games >= 3
          ? Math.abs(delta) < 0.25
            ? ', and results are much as they were before he came.'
            : delta > 0
              ? ', and the side are picking up more points than they were before he came.'
              : ', and the side are picking up fewer points than they were before he came.'
          : '. Early days, when a new voice usually lifts a side for a few games.'),
      evidence,
      // The bounce is a short-term lift, and §1.1 says it is most pronounced at
      // home against manageable opposition.
      adjustments: goingBackwards ? [] : [adj('goals', which, effect(0.35 * k * (which === 'home' ? 1.2 : 0.8)))],
      claims,
      strength: clamp(k * 0.7, 0.2, 0.8),
    });
  }

  // Past the bounce, into the window where §1.1 expects reversion.
  if (games <= REVERSION_WINDOW) {
    const appointmentDelta = delta;
    const claims: Claim[] =
      appointmentDelta !== null && Math.abs(appointmentDelta) > 0.25
        ? [
            {
              subject: side.team_name,
              predicate: 'regime_new',
              polarity: appointmentDelta > 0 ? 1 : -1,
              magnitude: clamp(Math.abs(appointmentDelta) / 1.2, 0.2, 1),
              evidence: {
                manager: name,
                matches_in_charge: games,
                appointment_delta: Number(appointmentDelta.toFixed(2)),
              },
              section: '§1.1',
              tier: 3,
            },
          ]
        : [];

    return computed({
      id: `manager.${which}.settling`,
      section: '§1.1',
      tier: 3,
      // Said from what has happened under him, not from a rule about game
      // counts: Aguirre's Valencia and Alexander's Preston were both written
      // off as a fading bounce while their results were going up.
      note:
        `${Name} is ${games} games into the job at ${side.team_name}` +
        (appointmentDelta === null
          ? ', long enough for the early lift to have worn off, so this is close to the side as it really is.'
          : appointmentDelta >= 0.25
            ? ', and they are picking up more points than they were before he came. That is past the point where it is only a bounce.'
            : appointmentDelta <= -0.25
              ? ', and they are picking up fewer points than they were before he came.'
              : ', and results are much as they were before he came.'),
      evidence,
      // No rate adjustment: the honest read here is uncertainty, not direction.
      claims,
      strength: 0.3,
    });
  }

  // §1.3: a settled regime is the easiest thing to model, and that certainty
  // is worth recording even though it moves no rate.
  if (days >= SETTLED_DAYS && games >= SETTLED_MATCHES) {
    return computed({
      id: `manager.${which}.settled`,
      section: '§1.3',
      tier: 3,
      note:
        `${Name} has been at ${side.team_name} for ${Math.round(days / 365)} years and ${games} matches: ` +
        `a settled regime with a large, stable sample behind it.`,
      evidence,
      claims: [
        {
          subject: side.team_name,
          predicate: 'regime_settled',
          polarity: 0,
          magnitude: 0.4,
          evidence: { manager: name, years: Math.round(days / 365), matches: games },
          section: '§1.3',
          tier: 3,
        },
      ],
      strength: 0.25,
    });
  }

  return computed({
    id: `manager.${which}.established`,
    section: '§1.1',
    tier: 3,
    note: `${Name} has ${games} matches in charge at ${side.team_name}, long enough that the side plays the way he wants it to.`,
    evidence,
    strength: 0.1,
  });
}

export const _internals = { BOUNCE_WINDOW, REVERSION_WINDOW, SETTLED_DAYS, SETTLED_MATCHES };
