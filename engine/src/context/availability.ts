import { config } from '../config.ts';
import { adj, clamp, computed, effect, thin, unavailable } from '../ledger.ts';
import type { Claim, Factor } from '../types.ts';
import type { PlayerProfile } from './players.ts';
import type { FixtureContext, LineupInfo, ScorerRow, SideContext, SquadPlayer } from './types.ts';

/**
 * §2.4 availability, §3.1 rotation risk, §3.2 squad depth.
 *
 * §12 is unambiguous that this comes first and is non-negotiable: a team missing
 * its best player is a different team regardless of every other factor. Two
 * things follow that the doctrine is specific about and most models get wrong:
 *
 * **The market decides which injuries matter, not the other way round.** §2.4
 * says assessing an injury without first identifying the market is backwards.
 * A winger's absence moves corners and BTTS; a defensive midfielder's moves
 * cards; a goalkeeper's moves clean sheets and totals. So each absence is routed
 * to the channels its role actually touches, and left out of the ones it does
 * not.
 *
 * **The size comes from the player, not from a constant.** A "star out" flag
 * that subtracts a fixed amount treats a 25-goal striker and a squad forward
 * identically. Here the reduction is how much of the side goes with the player
 * (`importanceOf` in players.ts: his share of the goals and assists for a
 * forward or a creator, how much of the football he plays for a defender or a
 * keeper), damped for the fact that a replacement is not worth zero. Before
 * the profiles existed it was the goal share alone, which made a first-choice
 * centre-back or keeper count as nobody; that is still the fallback when no
 * profile could be built.
 */

/** Position groups, from whatever spelling the provider uses. */
type Role = 'GK' | 'DEF' | 'MID' | 'ATT' | 'UNKNOWN';

export function classifyRole(position: string | null): Role {
  if (!position) return 'UNKNOWN';
  const p = position.toUpperCase();
  if (/(^G$|GK|GOAL|KEEPER|PORTERO)/.test(p)) return 'GK';
  if (/(^D$|DEF|CB|LB|RB|LWB|RWB|BACK)/.test(p)) return 'DEF';
  if (/(^M$|MID|DM|CM|AM|CDM|CAM)/.test(p)) return 'MID';
  if (/(^F$|^W$|ATT|FOR|STR|ST|CF|LW|RW|WING)/.test(p)) return 'ATT';
  return 'UNKNOWN';
}

/**
 * How much a missing player of each role costs, and where.
 *
 * `ownGoals` scales their own side's scoring, `oppGoals` scales the opponent's
 * (a missing defender makes the other team more dangerous). The corner and card
 * entries are the §2.4 routing: wide and attacking players drive corner volume,
 * midfielders and defenders drive the cards market through their replacements'
 * positional discipline.
 */
const ROLE_IMPACT: Record<Role, { ownGoals: number; oppGoals: number; corners: number; cards: number }> = {
  ATT: { ownGoals: 1.0, oppGoals: 0.0, corners: 0.45, cards: 0.0 },
  MID: { ownGoals: 0.5, oppGoals: 0.2, corners: 0.2, cards: 0.35 },
  DEF: { ownGoals: 0.1, oppGoals: 0.7, corners: 0.0, cards: 0.25 },
  GK: { ownGoals: 0.0, oppGoals: 0.9, corners: 0.0, cards: 0.0 },
  UNKNOWN: { ownGoals: 0.3, oppGoals: 0.2, corners: 0.1, cards: 0.1 },
};

/** Availability strings that mean "not playing". */
function isOut(availability: string | null): boolean {
  if (!availability) return false;
  const a = availability.toLowerCase();
  return /injur|suspend|out|unavailable|doubt|ill|absent/.test(a);
}

function isSuspension(reason: string | null): boolean {
  return !!reason && /suspend|ban|card|accumul/i.test(reason);
}

export interface Absence {
  id: number;
  name: string;
  role: Role;
  reason: string | null;
  suspended: boolean;
  /** Share of the team's league goals, 0 when unknown. */
  goalShare: number;
  /** True when we could measure the share rather than assume it. */
  measured: boolean;
}

export function collectAbsences(
  side: SideContext,
  lineups: LineupInfo,
  teamId: number,
  which: 'home' | 'away' | null = null,
): Absence[] {
  const byId = new Map<number, Absence>();
  const squadById = new Map<number, SquadPlayer>((side.squad ?? []).map((p) => [p.id, p]));

  const shares = goalShares(side.scorers, side.squad);
  const byName = new Map<string, number>();
  for (const sc of side.scorers ?? []) {
    const share = shares.get(sc.player_id);
    if (share !== undefined) byName.set(nameKey(sc.name), share);
  }

  const push = (
    id: number,
    name: string,
    position: string | null,
    reason: string | null,
  ) => {
    if (byId.has(id)) return;
    // By id, then by name: the scorers list and the absence list come from
    // different endpoints and do not always agree on the id.
    const share = shares.get(id) ?? byName.get(nameKey(name));
    byId.set(id, {
      id,
      name,
      role: classifyRole(position),
      reason,
      suspended: isSuspension(reason),
      goalShare: share ?? 0,
      measured: share !== undefined,
    });
  };

  // The provider's own out-list for this fixture is the most specific source.
  for (const u of lineups.unavailable) {
    // Attribution, most specific first: the half of the split list it came
    // from, then a team id on the entry, then squad membership.
    if (u.side && which) {
      if (u.side !== which) continue;
    } else if (u.team_id !== null) {
      if (u.team_id !== teamId) continue;
    } else if (!squadById.has(u.id)) {
      continue;
    }
    const sq = squadById.get(u.id);
    push(u.id, u.name, sq?.position ?? null, u.reason);
  }

  // Squad availability flags catch anyone the fixture list missed.
  for (const p of side.squad ?? []) {
    if (isOut(p.availability)) {
      push(p.id, p.name, p.position, p.injury_type ?? p.availability);
    }
  }

  return [...byId.values()];
}

/** Accent- and case-blind, so "Tárrega" and "Tarrega" are one player. */
export function nameKey(name: string): string {
  return String(name ?? '').toLowerCase().normalize('NFD').replace(/[^a-z]/g, '');
}

/**
 * A player's share of their team's league goals.
 *
 * Only this team's scorers count. The endpoint is asked for one team, but a
 * league-wide list coming back would otherwise put every club's goals in the
 * denominator and make the team's own top scorer look like a bit-part player.
 * A scorer is this team's if the squad has them by id or by name; with no
 * squad to check against, the list is taken as sent.
 */
function goalShares(scorers: ScorerRow[] | null, squad: SquadPlayer[] | null = null): Map<number, number> {
  const out = new Map<number, number>();
  if (!scorers || scorers.length === 0) return out;
  const ids = new Set((squad ?? []).map((p) => p.id));
  const names = new Set((squad ?? []).map((p) => nameKey(p.name)));
  const ours = squad && squad.length
    ? scorers.filter((s) => ids.has(s.player_id) || names.has(nameKey(s.name)))
    : scorers;
  const total = ours.reduce((a, s) => a + s.goals, 0);
  if (total <= 0) return out;
  for (const s of ours) out.set(s.player_id, s.goals / total);
  return out;
}

/**
 * Replacement level. A missing player is not worth zero — someone else plays,
 * and in a deep squad that someone is nearly as good. §3.2: a squad with one
 * genuine striker suffers far more than a squad with three.
 */
function depthDamping(side: SideContext, role: Role): { damping: number; cover: number } {
  const squad = side.squad ?? [];
  const available = squad.filter((p) => !isOut(p.availability) && classifyRole(p.position) === role);
  const cover = available.length;
  if (squad.length === 0) return { damping: 0.6, cover: 0 };
  // Thin cover means the drop-off is close to the full loss; deep cover means
  // most of the output is replaced.
  const target = role === 'GK' ? 2 : 4;
  return { damping: clamp(1 - (cover - 1) / target, 0.3, 1), cover };
}

export function availabilityFactors(ctx: FixtureContext): Factor[] {
  const out: Factor[] = [];

  if (ctx.lineups.status === 'unavailable' && !ctx.home.squad && !ctx.away.squad) {
    return [
      unavailable({
        id: 'availability.none',
        section: '§2.4',
        tier: 1,
        note: 'No lineup or squad availability published yet, so who is actually playing is unknown.',
      }),
    ];
  }

  for (const which of ['home', 'away'] as const) {
    const side = ctx[which];
    const other = which === 'home' ? 'away' : 'home';
    const absences = collectAbsences(side, ctx.lineups, side.team_id, which);

    if (absences.length === 0) {
      out.push(
        computed({
          id: `availability.${which}.full_strength`,
          section: '§2.4',
          tier: 1,
          note: `${side.team_name} report no absentees.`,
          evidence: { absences: 0 },
          strength: 0.2,
        }),
      );
      continue;
    }

    // How much of the side goes with each player: the profile's measure when
    // there is one, the goal share when not. A doubt counts for half, since he
    // may well play.
    const profiles = (ctx.players ?? []).filter((p) => p.side === which && p.status !== 'fit');
    const profileOf = (a: Absence): PlayerProfile | undefined =>
      profiles.find((p) => p.id === a.id) ?? profiles.find((p) => nameKey(p.name) === nameKey(a.name));
    const sized = absences.map((a) => {
      const p = profileOf(a);
      const measured = !!p?.season || a.measured;
      const base = p?.season ? p.importance : a.goalShare;
      const doubt = p?.status === 'doubtful' || /doubt/i.test(a.reason ?? '');
      return { a, p, measured, weight: base * (doubt ? 0.5 : 1), doubt };
    });
    // Leads with the player who actually matters, not whoever the list
    // happened to put first.
    sized.sort((x, y) => y.weight - x.weight);

    let ownGoalsEffect = 0;
    let oppGoalsEffect = 0;
    let cornersEffect = 0;
    let cardsEffect = 0;
    const claims: Claim[] = [];
    const detail: Array<Record<string, unknown>> = [];

    for (const { a, p, measured, weight: w, doubt } of sized) {
      const role = p && p.role !== 'UNKNOWN' ? p.role : a.role;
      const impact = ROLE_IMPACT[role];
      const { damping, cover } = depthDamping(side, role);

      // An unmeasured absence still counts for something, but only a little:
      // assuming an unknown player is a star is exactly the error §13 warns off.
      const weight = measured ? w : 0.05;
      const scaled = weight * damping;

      ownGoalsEffect += scaled * impact.ownGoals;
      oppGoalsEffect += scaled * impact.oppGoals;
      cornersEffect += scaled * impact.corners;
      cardsEffect += scaled * impact.cards;

      detail.push({
        player: a.name,
        role,
        reason: a.reason,
        goal_share: Number(a.goalShare.toFixed(3)),
        importance: Number(weight.toFixed(3)),
        measured,
        doubtful: doubt,
        cover_at_position: cover,
        ...(p?.tags.length ? { tags: p.tags } : {}),
      });

      // Only the absences big enough to change a price are worth a sentence.
      if (measured && weight >= 0.1) {
        claims.push({
          subject: a.name,
          predicate: a.suspended ? 'suspension' : 'absence',
          polarity: -1,
          magnitude: clamp(weight * 2.2, 0.2, 1),
          evidence: {
            team: side.team_name,
            goal_share_pct: Math.round(a.goalShare * 100),
            role,
            cover_at_position: cover,
            ...(a.reason ? { reason: a.reason } : {}),
            ...(p?.season ? { goals: p.season.goals, assists: p.season.assists, apps: p.season.apps } : {}),
            ...(p?.tags.length ? { tags: p.tags.join(',') } : {}),
          },
          section: '§2.4',
          tier: 1,
        });
      }
    }

    const adjustments = [
      adj('goals', which, effect(-ownGoalsEffect * 2.2)),
      adj('goals', other, effect(oppGoalsEffect * 2.2)),
      adj('corners', which, effect(-cornersEffect * 2.5)),
      adj('cards', 'both', effect(cardsEffect * 2.0)),
    ].filter((a) => Math.abs(a.multiplier - 1) > 1e-4);

    const measuredCount = sized.filter((x) => x.measured).length;
    const totalShare = absences.reduce((s, a) => s + a.goalShare, 0);
    const totalWeight = sized.reduce((s, x) => s + (x.measured ? x.weight : 0), 0);
    // Said in words: the players who matter, by name. No share, no percentage.
    const key = sized.filter((x) => x.measured && x.weight >= 0.1).map((x) => x.a.name);

    out.push(
      computed({
        id: `availability.${which}.absences`,
        section: '§2.4',
        tier: 1,
        note:
          `${side.team_name} are without ${absences.length} player${absences.length === 1 ? '' : 's'}` +
          (key.length
            ? `, and ${key.length === 1 ? `${key[0]} is a real loss.` : `${key.slice(0, -1).join(', ')} and ${key[key.length - 1]} are real losses.`}`
            : measuredCount > 0
              ? ', none of them central to how the side plays.'
              : ', none of whom register in the scoring records.'),
        evidence: {
          count: absences.length,
          measured: measuredCount,
          combined_goal_share: Number(totalShare.toFixed(3)),
          combined_importance: Number(totalWeight.toFixed(3)),
          players: detail,
        },
        adjustments,
        claims,
        strength: clamp(totalWeight * 2.5, 0.15, 1),
      }),
    );
  }

  out.push(rotationFactor(ctx));
  return out;
}

/**
 * §3.1 rotation risk.
 *
 * The doctrine's point is that rotation collapses a team's quality for one game
 * and the bookmaker does not know the XI any more than we do at pricing time.
 * Before the lineup is confirmed this is a risk, not a fact, and it is recorded
 * that way — a predicted lineup's own confidence is the honest measure of how
 * much to lean on it.
 */
function rotationFactor(ctx: FixtureContext): Factor {
  const { lineups } = ctx;

  if (lineups.status === 'confirmed') {
    // Who was picked against who was expected (context/xi.ts). Several
    // expected starters out of the eleven is a rotated side, which a call
    // backing it is set aside for; the note says so in the reader's words.
    const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven'];
    const said: string[] = [];
    for (const [side, team] of [['home', ctx.home.team_name], ['away', ctx.away.team_name]] as const) {
      const ch = lineups.changes?.[side];
      if (!ch || ch.n < 3) continue;
      const names = ch.out.slice(0, 3);
      const who = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0];
      said.push(`${team} have made ${WORDS[ch.n] ?? ch.n} changes from the side expected, with ${who} out of the eleven.`);
    }
    return computed({
      id: 'availability.lineup_confirmed',
      section: '§3.1',
      tier: 1,
      note: said.length ? `The starting elevens are confirmed. ${said.join(' ')}`
        : 'The starting elevens are confirmed, so selection is known rather than guessed.',
      evidence: { lineup_status: 'confirmed', changes: lineups.changes ?? null },
      strength: said.length ? 0.8 : 0.3,
    });
  }

  if (lineups.status === 'unavailable') {
    return unavailable({
      id: 'availability.rotation_risk',
      section: '§3.1',
      tier: 1,
      note:
        'No lineup published yet. Rotation risk is unresolved and every price here is provisional ' +
        'until the eleven is named.',
      evidence: { lineup_status: 'unavailable' },
    });
  }

  const confidence = lineups.confidence;
  if (confidence === null) {
    return thin({
      id: 'availability.rotation_risk',
      section: '§3.1',
      tier: 1,
      note: 'A predicted lineup exists but carries no confidence figure, so it cannot be weighted.',
      evidence: { lineup_status: 'predicted' },
    });
  }

  // Low confidence in the predicted eleven is itself the rotation signal.
  const uncertainty = 1 - confidence;
  const isCup = String(ctx.event['stage'] ?? '').toLowerCase().includes('cup');

  return computed({
    id: 'availability.rotation_risk',
    section: '§3.1',
    tier: 1,
    note:
      `Nobody has named a side yet, so this eleven is a projection` +
      (isCup ? ' in a cup tie, where rotation is likeliest.' : '.'),
    evidence: {
      lineup_status: 'predicted',
      confidence,
      cup_tie: isCup,
    },
    claims:
      uncertainty > 0.35
        ? [
            {
              subject: 'the selection',
              predicate: 'rotation',
              polarity: 0,
              magnitude: clamp(uncertainty, 0, 1),
              evidence: { confidence_pct: Math.round(confidence * 100) },
              section: '§3.1',
              tier: 1,
            },
          ]
        : [],
    // Rotation does not push goals one way; it widens what we do not know. The
    // effect belongs in confidence, which selection reads, not in the rate.
    strength: clamp(uncertainty * (isCup ? 1.3 : 1), 0, 1),
  });
}

export const _internals = { goalShares, depthDamping, isOut, isSuspension, ROLE_IMPACT };
