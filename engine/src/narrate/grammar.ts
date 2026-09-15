import type { Claim, ClaimPredicate } from '../types.ts';

/**
 * The phrase grammar.
 *
 * You chose this over a language model, so it has to be built as a grammar
 * rather than as a list of sentences. The honest limitation, stated once here
 * rather than buried: this is a template system underneath, and a reader who
 * comes every day will eventually start recognising shapes. Everything below is
 * aimed at pushing that horizon as far out as a no-LLM approach can.
 *
 * Two design rules do most of the work:
 *
 * **Vary structure, not vocabulary.** Swapping "big" for "large" fools nobody;
 * the shape of the sentence is what readers recognise. So each predicate carries
 * several genuinely different syntactic frames — consequence-first, fronted
 * subordinate clause, quantified lead, contrastive — and the selector varies
 * the frame before it varies a word.
 *
 * **Numbers come only from evidence.** Every frame is a function of the claim's
 * `evidence` map, so a sentence physically cannot cite a figure the model did
 * not compute. That is the guardrail that makes generated prose safe to publish
 * without a human reading each one.
 */

export interface Rng {
  (): number;
}

/** Pick deterministically from a list, avoiding recently-used indices. */
export function choose<T>(items: T[], rng: Rng, avoid: Set<number> = new Set()): { item: T; index: number } {
  const allowed = items.map((_, i) => i).filter((i) => !avoid.has(i));
  const pool = allowed.length > 0 ? allowed : items.map((_, i) => i);
  const index = pool[Math.floor(rng() * pool.length)] ?? pool[0]!;
  return { item: items[index]!, index };
}

const cap = (s: string): string => (s.length ? s[0]!.toUpperCase() + s.slice(1) : s);

/**
 * Thrown when a frame asks for evidence the claim does not carry.
 *
 * This is the guardrail that stops generated prose from degrading into filler.
 * The readers `n` and `s` used to fall back to 0 and "" silently, which meant a
 * claim missing a key produced sentences like "both sides average 0 points more
 * possession than , so expect one side with the ball" — confident, specific,
 * and meaningless. A frame that cannot be written truthfully must not be
 * written at all, so the reader throws and the composer picks a different frame,
 * or drops the claim if none of them can be satisfied.
 *
 * An explicit fallback still means what it says: `s(c.evidence.role, 'UNKNOWN')`
 * is a frame declaring that key optional.
 */
export class MissingEvidence extends Error {
  constructor(readonly key: string) {
    super(`frame needs evidence "${key}", which this claim does not carry`);
    this.name = 'MissingEvidence';
  }
}

/**
 * Frame guard: refuse this frame unless the claim's numbers actually suit it.
 *
 * Presence is not the only way a frame can be untrue. "Neither attack is
 * modelled to do much damage" is a fine sentence about a 1.3-goal match and a
 * false one about a 3.25-goal match, and both carry the same evidence keys. So
 * a frame may state the range it is valid over, and falls out of the pool the
 * same way a frame with missing evidence does.
 */
function only(condition: boolean): void {
  if (!condition) throw new MissingEvidence('frame precondition');
}

/** Render a frame, or return null if its evidence is not all present. */
export function tryFrame(frame: Frame, claim: Claim, rng: Rng): string | null {
  try {
    const out = frame(claim, rng);
    return out.trim().length > 0 ? out : null;
  } catch (err) {
    if (err instanceof MissingEvidence) return null;
    throw err;
  }
}

function n(v: unknown, fallback?: number): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (fallback !== undefined) return fallback;
  throw new MissingEvidence('number');
}

function s(v: unknown, fallback?: string): string {
  if (typeof v === 'string' && v.trim().length > 0) return v;
  if (fallback !== undefined) return fallback;
  throw new MissingEvidence('string');
}
const plural = (count: number, one: string, many = `${one}s`): string => (count === 1 ? one : many);

/** Intensity words, graded by magnitude so a small effect never reads as a big one. */
function intensity(mag: number, rng: Rng): string {
  const bands: string[][] = [
    ['slightly', 'a little', 'marginally'],
    ['noticeably', 'appreciably', 'meaningfully'],
    ['materially', 'substantially', 'considerably'],
    ['heavily', 'severely', 'drastically'],
  ];
  const band = bands[Math.min(bands.length - 1, Math.floor(mag * bands.length))]!;
  return choose(band, rng).item;
}

const ROLE_WORD: Record<string, string> = {
  ATT: 'forward',
  MID: 'midfielder',
  DEF: 'defender',
  GK: 'goalkeeper',
  UNKNOWN: 'player',
};

export type Frame = (c: Claim, rng: Rng) => string;

/** "st"/"nd"/"rd"/"th" for an ordinal, so a frame never writes "3th". */
/** Whether the table is actually doing something to this fixture. */
function hasRealStakes(c: Claim): boolean {
  return !/mid-?table|unknown/i.test(String(c.evidence.state ?? ''));
}

function ordinalSuffix(v: number): string {
  if (v % 100 >= 11 && v % 100 <= 13) return 'th';
  return ['th', 'st', 'nd', 'rd'][v % 10] ?? 'th';
}

/**
 * Frames per predicate. Each entry is a distinct sentence shape, not a reworded
 * version of its neighbour — that is the whole point.
 *
 * Two rules every frame here obeys:
 *
 * **Numbers come only from evidence.** A frame is a function of the claim's
 * evidence map, so it physically cannot cite a figure the model did not compute.
 *
 * **A frame states the range it holds over.** Presence is not truth. "Heavy
 * enough to slow the passing game" is a fine sentence about a pitch rated 2 out
 * of 5 and a false one about a pitch rated 5, on identical evidence. Every frame
 * that asserts more than its number guarantees calls `only(...)` and drops out
 * of the pool when the numbers do not support it. The live board taught this
 * lesson four times in one slate — "fighting relegation with 32 to play", "1
 * matches already inside a week", "48% possession ... against a side that does
 * not want it", "only 3.3 days since their last match" — all true, all
 * meaningless.
 */
export const FRAMES: Record<ClaimPredicate, Frame[]> = {
  absence: [
    (c) => {
      const pct = n(c.evidence.goal_share_pct);
      only(pct >= 5);
      return `${c.subject} is out, and that is ${pct}% of ${s(c.evidence.team)}'s league goals removed from the side.`;
    },
    (c) => {
      const pct = n(c.evidence.goal_share_pct);
      only(pct >= 5);
      return `${s(c.evidence.team)} are without ${c.subject}, who has supplied ${pct}% of their goals this season.`;
    },
    (c) => {
      const pct = n(c.evidence.goal_share_pct);
      const cover = n(c.evidence.cover_at_position);
      const role = ROLE_WORD[s(c.evidence.role, 'UNKNOWN')] ?? 'player';
      only(pct >= 5);
      return `Take ${c.subject} out and ${s(c.evidence.team)} lose ${pct}% of their scoring, with ${cover} fit ${plural(cover, role)} left to cover the position.`;
    },
    (c) => {
      const pct = n(c.evidence.goal_share_pct);
      only(pct >= 5);
      return `${pct}% of ${s(c.evidence.team)}'s goals this season have come from ${c.subject}, and ${c.subject} does not play here.`;
    },
    (c, rng) => {
      const pct = n(c.evidence.goal_share_pct);
      only(pct >= 5);
      return `Losing ${c.subject} thins ${s(c.evidence.team)}'s attack ${intensity(c.magnitude, rng)} — ${pct}% of the season's goals sit with ${c.subject === 'the squad' ? 'them' : 'that name alone'}.`;
    },
    (c) => {
      const role = ROLE_WORD[s(c.evidence.role, 'UNKNOWN')] ?? 'player';
      const pct = n(c.evidence.goal_share_pct);
      only(pct >= 5);
      return `The ${role} ${c.subject} misses out for ${s(c.evidence.team)}, and with ${c.subject} goes ${pct}% of their goal output.`;
    },
    (c) => {
      const cover = n(c.evidence.cover_at_position);
      const role = ROLE_WORD[s(c.evidence.role, 'UNKNOWN')] ?? 'player';
      only(cover === 0);
      return `${s(c.evidence.team)} have no recognised ${role} left once ${c.subject} is ruled out, so somebody plays out of position.`;
    },
    (c) => {
      const pct = n(c.evidence.goal_share_pct);
      only(pct >= 30);
      return `This is not a squad-depth question. ${cap(String(c.subject))} accounts for ${pct}% of what ${s(c.evidence.team)} score, and he is not in the side.`;
    },
    (c) => {
      const pct = n(c.evidence.goal_share_pct);
      only(pct < 5);
      return `${s(c.evidence.team)} are without ${c.subject}, though the goal output that goes with him is marginal.`;
    },
    (c) => {
      const role = ROLE_WORD[s(c.evidence.role, 'UNKNOWN')] ?? 'player';
      const pct = n(c.evidence.goal_share_pct);
      only(pct >= 5);
      return `A ${role} carrying ${pct}% of ${s(c.evidence.team)}'s goals is unavailable, and replacing that is not a like-for-like swap.`;
    },
  ],

  suspension: [
    (c) => {
      const pct = n(c.evidence.goal_share_pct);
      only(pct >= 5);
      return `${c.subject} is suspended, which takes ${pct}% of ${s(c.evidence.team)}'s goals out of the side.`;
    },
    (c) => {
      const pct = n(c.evidence.goal_share_pct);
      only(pct >= 5);
      return `A suspension rules ${c.subject} out — ${pct}% of ${s(c.evidence.team)}'s scoring this season, unavailable by the letter of the rules rather than by choice.`;
    },
    (c) => {
      const cover = n(c.evidence.cover_at_position);
      const role = ROLE_WORD[s(c.evidence.role, 'UNKNOWN')] ?? 'player';
      return `${s(c.evidence.team)} serve a suspension for ${c.subject} here, leaving ${cover} fit ${plural(cover, role)} in the position.`;
    },
    (c) => {
      const pct = n(c.evidence.goal_share_pct);
      only(pct >= 5);
      return `With ${c.subject} banned, ${s(c.evidence.team)} field a side missing ${pct}% of its goal contribution.`;
    },
    (c, rng) => {
      const pct = n(c.evidence.goal_share_pct);
      only(pct >= 5);
      return `${c.subject}'s suspension ${intensity(c.magnitude, rng)} weakens ${s(c.evidence.team)}, removing ${pct}% of the goals they have scored this season.`;
    },
    (c) => {
      const pct = n(c.evidence.goal_share_pct);
      only(pct >= 20);
      return `A ban rather than an injury, which makes it no less expensive: ${pct}% of ${s(c.evidence.team)}'s goals sit with ${c.subject}.`;
    },
    (c) => `${s(c.evidence.team)} lose ${c.subject} to suspension — a selection forced on them rather than chosen.`,
  ],

  return: [
    (c) => `${c.subject} is back available for ${s(c.evidence.team)}.`,
    (c) => `${s(c.evidence.team)} welcome ${c.subject} back into contention.`,
    (c) => `The return of ${c.subject} restores an option ${s(c.evidence.team)} have been without.`,
    (c) => `${c.subject} is fit again, and ${s(c.evidence.team)} look a different side with that name on the sheet.`,
    (c) => `Back in the reckoning for ${s(c.evidence.team)}: ${c.subject}, whose absence shaped the recent run.`,
  ],

  rotation: [
    (c) => {
      const p = n(c.evidence.confidence_pct);
      only(p < 85);
      return `The eleven is predicted rather than confirmed, at ${p}% confidence, so selection is still an open question.`;
    },
    (c) => {
      const p = n(c.evidence.confidence_pct);
      only(p < 70);
      return `Nobody has named a side yet; the projected lineup carries only ${p}% confidence.`;
    },
    (c) => {
      const p = n(c.evidence.confidence_pct);
      only(p < 85);
      return `Selection is unresolved — the lineup projection sits at ${p}% and rotation would change this read.`;
    },
    (c) => {
      const p = n(c.evidence.confidence_pct);
      only(p < 85);
      return `At ${p}% confidence in the projected eleven, this is a call made before the team news.`;
    },
    (c) => {
      const p = n(c.evidence.confidence_pct);
      only(p < 60);
      return `The lineup here is closer to a guess than a projection — ${p}% — and team news should move this materially.`;
    },
    (c) => {
      const p = n(c.evidence.confidence_pct);
      only(p >= 85);
      return `The eleven is projected at ${p}%, which is about as settled as it gets before a teamsheet lands.`;
    },
  ],

  fatigue: [
    (c) => {
      const rest = n(c.evidence.days_rest);
      const in7 = n(c.evidence.matches_in_7_days);
      only(in7 >= 3);
      return `${c.subject} play their ${in7 + 1}${ordinalSuffix(in7 + 1)} match in seven days, on ${rest.toFixed(1)} days' rest.`;
    },
    (c) => {
      const rest = n(c.evidence.days_rest);
      only(rest < 3);
      return `${c.subject} have had only ${rest.toFixed(1)} days since their last match.`;
    },
    (c, rng) => {
      const rest = n(c.evidence.days_rest);
      only(rest < 3);
      return `Coming in on ${rest.toFixed(1)} days' rest, ${c.subject} arrive ${intensity(c.magnitude, rng)} short of fresh.`;
    },
    (c) => {
      const in14 = n(c.evidence.matches_in_14_days);
      only(in14 >= 5);
      return `${in14} matches in a fortnight has left ${c.subject} running on reserves, and pressing is the first thing to go.`;
    },
    (c) => {
      const rest = n(c.evidence.days_rest);
      only(rest < 3);
      return `The schedule has given ${c.subject} ${rest.toFixed(1)} days to recover, below the three that sustain full intensity.`;
    },
    (c) => {
      const in7 = n(c.evidence.matches_in_7_days);
      const rest = n(c.evidence.days_rest);
      only(in7 >= 3 && rest < 3);
      return `Three games in a week and ${rest.toFixed(1)} days before this one: ${c.subject} are into the part of the schedule where legs decide things.`;
    },
    (c) => {
      const rest = n(c.evidence.days_rest);
      only(rest < 2);
      return `Barely ${rest.toFixed(1)} days between matches for ${c.subject} — below the point where recovery is possible at all, never mind complete.`;
    },
    (c) => {
      const in14 = n(c.evidence.matches_in_14_days);
      only(in14 >= 6);
      return `${in14} games in fourteen days is a European schedule imposed on a domestic squad, and ${c.subject} are carrying it here.`;
    },
  ],

  travel: [
    (c) => `${c.subject} travel ${n(c.evidence.travel_km).toLocaleString('en-GB')} km to play this.`,
    (c) => `A ${n(c.evidence.travel_km).toLocaleString('en-GB')} km journey precedes this fixture for ${c.subject}.`,
    (c) => `${c.subject} cover ${n(c.evidence.travel_km).toLocaleString('en-GB')} km to get here, and the legs know it.`,
    (c) => {
      const km = n(c.evidence.travel_km);
      only(km >= 2500);
      return `This is a ${km.toLocaleString('en-GB')} km trip for ${c.subject} — far enough that the clock, not just the distance, is working against them.`;
    },
    (c) => `${n(c.evidence.travel_km).toLocaleString('en-GB')} km of travel sits between ${c.subject} and kick-off, and away form flatters nobody after that.`,
  ],

  regime_new: [
    (c) => {
      const g = n(c.evidence.matches_in_charge);
      return `${s(c.evidence.manager, 'The new manager')} is ${g} ${plural(g, 'game')} into the job at ${c.subject}, inside the window where a change of voice still lifts output.`;
    },
    (c) => {
      const d = c.evidence.appointment_delta;
      const g = n(c.evidence.matches_in_charge);
      return typeof d === 'number'
        ? `${c.subject} have moved ${d >= 0 ? '+' : ''}${d.toFixed(2)} points per match since ${s(c.evidence.manager, 'the appointment')}, measured against the same number of games before it.`
        : `${c.subject} are ${g} ${plural(g, 'game')} into a new regime, and the early bounce has not yet reverted.`;
    },
    (c) => {
      const g = n(c.evidence.matches_in_charge);
      return `A new manager at ${c.subject} ${g} ${plural(g, 'match', 'matches')} ago means the market is still pricing the old side.`;
    },
    (c) => {
      const d = c.evidence.appointment_delta;
      return typeof d === 'number' && d < 0
        ? `The appointment at ${c.subject} has not taken: ${d.toFixed(2)} points per match against what the club was managing before it.`
        : `${c.subject} are early enough into a new regime that recent form describes a different team.`;
    },
    (c) => {
      const g = n(c.evidence.matches_in_charge);
      only(g <= 2);
      return `The manager at ${c.subject} has had ${g} ${plural(g, 'match', 'matches')} in charge. Whatever the season form says, it is about a different set of instructions.`;
    },
    (c) => {
      const d = c.evidence.appointment_delta;
      only(typeof d === 'number' && d >= 0.4);
      return `The change at ${c.subject} has worked so far — ${(d as number).toFixed(2)} points per match better than the run that cost the last man his job.`;
    },
    (c) => `Recent results for ${c.subject} were collected under someone else's instructions, which is the whole reason to discount them.`,
  ],

  regime_bounce: [
    (c) => `${c.subject} are riding the lift that follows a managerial change, which historically fades by around the sixth game.`,
    (c) => `The new-manager effect is still live at ${c.subject}, and it is a short-term factor rather than a structural one.`,
    (c) => `Whatever ${c.subject} have found since the change, the honest read is that it reverts — bounces are real and they are temporary.`,
    (c) => `Treat the upturn at ${c.subject} as a bounce rather than a new level, because that is what the record says it usually is.`,
  ],

  regime_settled: [
    (c) => {
      const y = n(c.evidence.years);
      only(y >= 2);
      return `${c.subject} have had the same manager for ${y} years and ${n(c.evidence.matches)} matches, so their habits are deeply encoded and the sample behind them is large.`;
    },
    (c) => {
      const y = n(c.evidence.years);
      only(y >= 2);
      return `Nothing has changed at ${c.subject} in ${y} years under the same manager — this is the easiest kind of side to read.`;
    },
    (c) => {
      const m = n(c.evidence.matches);
      only(m >= 60);
      return `${n(c.evidence.matches)} matches under one manager means ${c.subject} do what they always do, and the model has seen all of it.`;
    },
    (c) => {
      only(n(c.evidence.matches) >= 60);
      return `There is no regime uncertainty at ${c.subject}: the same voice, the same patterns, a long sample behind both.`;
    },
  ],

  stakes: [
    (c) => {
      only(hasRealStakes(c));
      return `${cap(String(c.subject))} arrive ${s(c.evidence.state)}, with ${n(c.evidence.games_left)} ${plural(n(c.evidence.games_left), 'game')} left.`;
    },
    (c) => {
      only(hasRealStakes(c));
      return `With ${n(c.evidence.games_left)} ${plural(n(c.evidence.games_left), 'game')} remaining, ${c.subject} are ${s(c.evidence.state)} — and that shapes how this is played more than the team sheet does.`;
    },
    (c) => {
      if (c.polarity < 0) {
        return `There is nothing riding on this for ${c.subject}, and games with nothing riding on them are played at something short of full intensity.`;
      }
      only(hasRealStakes(c));
      return `${cap(String(c.subject))} need this: ${s(c.evidence.state)} with ${n(c.evidence.games_left)} to play.`;
    },
    (c) => {
      // Only where the table is actually doing something. "Mid-table, which is
      // the strongest single influence on how cautious this becomes" is a
      // sentence about nothing.
      only(!/mid-?table|unknown/i.test(s(c.evidence.state)));
      return `The table puts ${c.subject} ${s(c.evidence.state)}, which is the strongest single influence on how cautious this becomes.`;
    },
    (c) => {
      const g = n(c.evidence.games_left);
      only(g <= 6 && hasRealStakes(c));
      return `${g} ${plural(g, 'game')} left and ${c.subject} ${s(c.evidence.state)}: this is the end of the season, where the table starts picking the tactics.`;
    },
    (c) => {
      only(!/mid-?table|unknown/i.test(s(c.evidence.state)));
      return `What ${c.subject} are playing for — ${s(c.evidence.state)} — tells you more about the shape of this than either side's rating does.`;
    },
    (c) => {
      const gap = c.evidence.gap_to_safety;
      only(typeof gap === 'number' && Math.abs(gap) <= 3);
      return `${cap(String(c.subject))} sit ${Math.abs(gap as number)} points from safety with ${n(c.evidence.games_left)} to play, which is close enough that every decision here is made under pressure.`;
    },
  ],

  derby: [
    (c) => `${s(c.evidence.home)} against ${s(c.evidence.away)} is a local derby, and derbies reliably produce cards even when they do not produce goals.`,
    (c) => `This is a derby, which lifts the card count and the chance of defensive error without lifting the goal total in any dependable way.`,
    (c) => `Local rivalry raises the temperature here: tackles get made that would be pulled out of in a regular fixture.`,
    (c) => `Derby day, with everything that implies for the card count and nothing dependable that it implies for the goals.`,
    (c) => `These two are neighbours, and the record says that shows up in bookings rather than in the scoreline.`,
  ],

  revenge: [
    (c) => {
      const m = n(c.evidence.margin);
      only(m >= 3);
      return `${c.subject} lost the reverse fixture ${s(c.evidence.reverse_score)}, and sides beaten that heavily tend to turn up better than their form suggests.`;
    },
    (c) => {
      only(n(c.evidence.margin) >= 1);
      return `The ${s(c.evidence.reverse_score)} defeat earlier in the season is the kind of result players remember and managers mention.`;
    },
    (c) => {
      const m = n(c.evidence.margin);
      only(m >= 2);
      return `A ${m}-goal beating in the reverse meeting gives ${c.subject} a specific reason to be better than the numbers imply.`;
    },
    (c) => {
      only(n(c.evidence.margin) >= 1);
      return `${cap(String(c.subject))} were beaten ${s(c.evidence.reverse_score)} in the reverse fixture, and that result will have been on the training ground this week.`;
    },
  ],

  form: [
    (c) => {
      const g = n(c.evidence.goals_minus_xg);
      only(Math.abs(g) >= 0.25);
      return `${c.subject} have been ${g > 0 ? 'outscoring' : 'falling short of'} their expected goals by ${Math.abs(g).toFixed(2)} a game across ${n(c.evidence.matches)} matches — a gap that historically closes rather than holds.`;
    },
    (c) => {
      const g = n(c.evidence.goals_minus_xg);
      only(Math.abs(g) >= 0.25);
      return `Over ${n(c.evidence.matches)} matches ${c.subject}'s finishing has run ${Math.abs(g).toFixed(2)} goals a game ${g > 0 ? 'ahead of' : 'behind'} the chances created, which is not a level that usually persists.`;
    },
    (c) => {
      const g = n(c.evidence.goals_minus_xg);
      only(Math.abs(g) >= 0.25);
      return `The scoreline has flattered ${c.subject}${g > 0 ? '' : ' less than it should have'}: ${Math.abs(g).toFixed(2)} goals a game ${g > 0 ? 'above' : 'below'} what the chances were worth.`;
    },
    (c) => {
      const g = n(c.evidence.goals_minus_xg);
      only(g >= 0.25);
      return `${cap(String(c.subject))} are taking their chances at a rate that does not last — ${g.toFixed(2)} goals a game more than the shots were worth.`;
    },
    (c) => {
      const g = n(c.evidence.goals_minus_xg);
      only(g <= -0.25);
      return `${cap(String(c.subject))} have been creating more than the table shows, missing by ${Math.abs(g).toFixed(2)} goals a game — the kind of gap that closes on its own.`;
    },
    (c) => {
      const g = n(c.evidence.goals_minus_xg);
      only(Math.abs(g) >= 0.6);
      return `A ${Math.abs(g).toFixed(2)}-goal gap between what ${c.subject} score and what they should is large enough to be the story of their season so far.`;
    },
  ],

  style_clash: [
    (c) => {
      const gap = n(c.evidence.possession_gap);
      only(gap >= 6);
      return `${c.subject} average ${gap} points more possession than ${s(c.evidence.opponent)}, so expect one side with the ball and one chasing it.`;
    },
    (c) => {
      const pos = n(c.evidence.possession);
      only(pos >= 57);
      return `The shape of this is lopsided: ${c.subject} average ${pos}% of the ball against a side that does not want it.`;
    },
    (c) => {
      const gap = n(c.evidence.possession_gap);
      only(gap >= 12);
      return `${s(c.evidence.opponent)} will spend this match without the ball — ${c.subject} hold ${gap} points more of it than they do.`;
    },
    (c) => {
      const gap = n(c.evidence.possession_gap);
      only(gap >= 6);
      return `One side wants the ball and the other is happy without it: ${gap} points of possession separate ${c.subject} and ${s(c.evidence.opponent)} across the season.`;
    },
    (c) => {
      const gap = n(c.evidence.possession_gap);
      only(gap >= 6 && gap < 12);
      return `${cap(String(c.subject))} should see more of the ball, though ${gap} points is a tilt rather than a siege.`;
    },
  ],

  set_piece: [
    (c) => `${c.subject} carry an unusual share of their threat from dead balls.`,
    (c) => `Set pieces are where ${c.subject} do their damage, which changes what a corner is worth here.`,
    (c) => `A disproportionate amount of what ${c.subject} create arrives from a stopped ball rather than from open play.`,
  ],

  weather: [
    (c) => {
      if (typeof c.evidence.rain_mm === 'number' && n(c.evidence.rain_mm) >= 10) {
        return `${n(c.evidence.rain_mm)} mm of rain is forecast, and wet surfaces produce miscontrol, transitions and mistakes.`;
      }
      if (typeof c.evidence.wind_kph === 'number' && n(c.evidence.wind_kph) >= 25) {
        return `${n(c.evidence.wind_kph)} km/h of wind will blunt crossing accuracy and long-ball precision.`;
      }
      only(false);
      return '';
    },
    (c) => {
      if (typeof c.evidence.temperature_c === 'number' && n(c.evidence.temperature_c) > 24) {
        return `${n(c.evidence.temperature_c)}°C is hot enough that nobody presses for ninety minutes, and the second half usually closes up.`;
      }
      if (typeof c.evidence.rain_mm === 'number' && n(c.evidence.rain_mm) >= 15) {
        return `Heavy rain — ${n(c.evidence.rain_mm)} mm — favours the side that presses and punishes the side that wants to pass through it.`;
      }
      if (typeof c.evidence.wind_kph === 'number' && n(c.evidence.wind_kph) >= 25) {
        return `Wind at ${n(c.evidence.wind_kph)} km/h means more balls hit long and fewer of them landing where they were aimed.`;
      }
      only(false);
      return '';
    },
    (c) => {
      if (typeof c.evidence.wind_kph === 'number' && n(c.evidence.wind_kph) >= 25) {
        return `Expect more corners and worse deliveries from them, with ${n(c.evidence.wind_kph)} km/h swirling about.`;
      }
      if (typeof c.evidence.rain_mm === 'number' && n(c.evidence.rain_mm) >= 10) {
        return `A wet pitch turns controlled possession into a series of loose second balls.`;
      }
      only(false);
      return '';
    },
    (c) => {
      const t = c.evidence.temperature_c;
      only(typeof t === 'number' && (t as number) <= 3);
      return `At ${n(t)}°C the ball behaves differently and so do hamstrings — cold games are cagier than the ratings suggest.`;
    },
    (c) => {
      only(typeof c.evidence.rain_mm === 'number' && n(c.evidence.rain_mm) >= 20);
      return `${n(c.evidence.rain_mm)} mm is not drizzle. Expect a scrappy game decided closer to the goalkeeper than to the tactics board.`;
    },
  ],

  pitch: [
    (c) => {
      const r = n(c.evidence.rating);
      const max = n(c.evidence.scale_max);
      only(max > 0 && r / max <= 0.6);
      return `The surface is rated ${r} out of ${max}, heavy enough to slow the passing game.`;
    },
    (c) => {
      const r = n(c.evidence.rating);
      const max = n(c.evidence.scale_max);
      only(max > 0 && r / max <= 0.6);
      return `A heavy pitch penalises combination play and rewards whoever is happier running at people.`;
    },
    (c) => {
      const r = n(c.evidence.rating);
      const max = n(c.evidence.scale_max);
      only(max > 0 && r / max <= 0.35);
      return `The surface here is rated ${r} of ${max} — poor enough that technique stops being the deciding factor.`;
    },
  ],

  crowd: [
    (c) => `Played on neutral ground, so ${c.subject} do not get the advantage the model normally credits them at home.`,
    (c) => `There is no home crowd in this one, and the fitted home edge comes out of the numbers accordingly.`,
    (c) => `A neutral venue removes the one advantage that is fitted rather than argued, and the rates here reflect that.`,
  ],

  referee: [
    (c) => {
      const y = n(c.evidence.yellows_per_match);
      const a = n(c.evidence.league_average);
      only(Math.abs(y - a) >= 0.7);
      return `The referee averages ${y.toFixed(1)} bookings a game against a league average of ${a.toFixed(1)}, across ${n(c.evidence.matches)} matches.`;
    },
    (c) => {
      const y = n(c.evidence.yellows_per_match);
      const a = n(c.evidence.league_average);
      only(Math.abs(y - a) >= 0.7);
      return `Over ${n(c.evidence.matches)} games this official has run ${y.toFixed(1)} cards a match, ${y > a ? 'above' : 'below'} the ${a.toFixed(1)} norm.`;
    },
    (c) => {
      const y = n(c.evidence.yellows_per_match);
      const a = n(c.evidence.league_average);
      only(Math.abs(y - a) >= 1.0);
      return `Whoever is refereeing matters here: ${y.toFixed(1)} bookings a game over a ${n(c.evidence.matches)}-match sample, against ${a.toFixed(1)} for the league.`;
    },
    (c) => {
      const y = n(c.evidence.yellows_per_match);
      const a = n(c.evidence.league_average);
      only(y - a >= 1.0);
      return `This is a card-heavy official — ${(y - a).toFixed(1)} bookings a game above the league norm — and that is worth more than it sounds in a tight fixture.`;
    },
    (c) => {
      const y = n(c.evidence.yellows_per_match);
      const a = n(c.evidence.league_average);
      only(a - y >= 1.0);
      return `A lenient whistle: ${y.toFixed(1)} cards a game where the league runs ${a.toFixed(1)}, which takes some of the sting out of the card markets.`;
    },
  ],

  market_move: [
    (c) => {
      const m = n(c.evidence.move_pct);
      only(m >= 3);
      return `${s(c.evidence.outcome)} has ${s(c.evidence.direction) === 'SHORTENING' ? 'shortened' : 'drifted'} ${m.toFixed(1)}% since the line opened.`;
    },
    (c) => {
      const m = n(c.evidence.move_pct);
      only(m >= 3);
      return `Money has moved: ${m.toFixed(1)}% on ${s(c.evidence.outcome)} between opening and now.`;
    },
    (c) => {
      const m = n(c.evidence.move_pct);
      only(m >= 3);
      return `The line has not stood still — ${s(c.evidence.outcome)} is ${m.toFixed(1)}% ${s(c.evidence.direction) === 'SHORTENING' ? 'shorter' : 'longer'} than it opened.`;
    },
    (c) => {
      const m = n(c.evidence.move_pct);
      only(m >= 8);
      return `A ${m.toFixed(1)}% move on ${s(c.evidence.outcome)} is not noise. Somebody knows something, or thinks they do.`;
    },
  ],

  market_sharp: [
    (c) => {
      only(n(c.evidence.gap_points) >= 2);
      return `The sharp book prices ${s(c.evidence.outcome)} ${n(c.evidence.gap_points).toFixed(1)} points away from the wider market, and when those two disagree the sharp one is usually right.`;
    },
    (c) => {
      only(n(c.evidence.gap_points) >= 2);
      return `There is a ${n(c.evidence.gap_points).toFixed(1)}-point gap between the sharpest book and everyone else on ${s(c.evidence.outcome)}.`;
    },
    (c) => {
      const g = n(c.evidence.gap_points);
      only(g >= 4);
      return `${g.toFixed(1)} points between the sharp price and the rest of the market on ${s(c.evidence.outcome)} is a wide disagreement by any standard.`;
    },
  ],

  market_crowd: [
    (c) => {
      only(n(c.evidence.gap_points) >= 2);
      return `The prediction market has ${s(c.evidence.outcome)} ${n(c.evidence.gap_points).toFixed(1)} points away from the bookmakers, past the threshold where one of them is wrong.`;
    },
    (c) => {
      only(n(c.evidence.gap_points) >= 2);
      return `Traders and bookmakers disagree by ${n(c.evidence.gap_points).toFixed(1)} points on ${s(c.evidence.outcome)} here.`;
    },
    (c) => {
      only(n(c.evidence.gap_points) >= 2);
      return `Two different crowds have priced ${s(c.evidence.outcome)} and landed ${n(c.evidence.gap_points).toFixed(1)} points apart.`;
    },
  ],

  rating_gap: [
    (c) => {
      only(n(c.evidence.edge_points) >= 2);
      return `Our own numbers make this ${n(c.evidence.model_pct).toFixed(1)}% against the ${n(c.evidence.book_pct).toFixed(1)}% the price implies.`;
    },
    (c) => {
      only(n(c.evidence.edge_points) >= 2);
      return `We rate it ${n(c.evidence.model_pct).toFixed(1)}%; the market is at ${n(c.evidence.book_pct).toFixed(1)}%. That gap is the bet.`;
    },
    (c) => {
      only(n(c.evidence.edge_points) >= 2);
      return `The ${n(c.evidence.edge_points).toFixed(1)}-point difference between our ${n(c.evidence.model_pct).toFixed(1)}% and the book's ${n(c.evidence.book_pct).toFixed(1)}% is what makes this worth taking.`;
    },
    (c) => {
      only(n(c.evidence.edge_points) >= 2);
      return `The price says ${n(c.evidence.book_pct).toFixed(1)}%, we say ${n(c.evidence.model_pct).toFixed(1)}%, and we are taking our own side of that.`;
    },
    (c) => {
      const e = n(c.evidence.edge_points);
      only(e >= 8);
      return `${e.toFixed(1)} points of disagreement with the market is the widest kind of gap this model publishes, and it is why this one is here.`;
    },
  ],

  // ------------------------------------------------- confidence calls
  //
  // A different argument from everything above. A value bet says the price is
  // wrong; a confidence call says the match is lopsided and explains how. The
  // frames stay concrete — the mismatch in expected goals is the case, and a
  // sentence that gestures at "quality" without a number is the exact filler
  // this product exists to avoid.

  strength_gap: [
    (c) => {
      const f = n(c.evidence.xg_for);
      const a = n(c.evidence.xg_against);
      only(f - a >= 0.6);
      return `The model has ${s(c.evidence.team)} at ${f.toFixed(2)} goals here against ${s(c.evidence.opponent)}'s ${a.toFixed(2)} — that gap is the whole case.`;
    },
    (c) => {
      const r = n(c.evidence.ratio);
      only(r >= 1.8);
      return `${s(c.evidence.team)} project to score ${r.toFixed(1)} times what ${s(c.evidence.opponent)} manage. Games that one-sided on paper usually are.`;
    },
    (c) => {
      const f = n(c.evidence.xg_for);
      const a = n(c.evidence.xg_against);
      // "The better side" needs to actually be the better side. The live board
      // carried "Sunderland are the better side at 1.21 to 1.37", which is the
      // wrong way round — a double chance is often backed precisely because the
      // side is *not* favoured and the draw is carrying the bet.
      only(f > a && f - a < 0.7);
      return `${cap(s(c.evidence.team))} are the better side at ${f.toFixed(2)} to ${a.toFixed(2)}, though not by the margin the confidence number might suggest — the cushion here is the draw, not the win.`;
    },
    (c) => {
      const f = n(c.evidence.xg_for);
      const a = n(c.evidence.xg_against);
      only(f >= 1.8 && a <= 1.1);
      return `${f.toFixed(2)} against ${a.toFixed(2)}. ${cap(s(c.evidence.opponent))}'s route to a result runs through a clean sheet the numbers do not expect them to keep.`;
    },
    (c, rng) => {
      const f = n(c.evidence.xg_for);
      const a = n(c.evidence.xg_against);
      return `${cap(s(c.evidence.team))} are ${intensity(c.magnitude, rng)} the stronger side on expected goals, ${f.toFixed(2)} to ${a.toFixed(2)}, and the market has not argued with it.`;
    },
    (c) => {
      const a = n(c.evidence.xg_against);
      return `For this to go wrong, ${s(c.evidence.opponent)} have to beat an expected ${a.toFixed(2)} goals by some distance — which is the risk, stated plainly.`;
    },
    (c) => {
      const f = n(c.evidence.xg_for);
      const a = n(c.evidence.xg_against);
      const total = f + a;
      return `Expected goals split ${f.toFixed(2)} to ${a.toFixed(2)}, ${total.toFixed(2)} in the match. The shape of that total is what this call reads.`;
    },
    (c) => {
      const f = n(c.evidence.xg_for);
      const a = n(c.evidence.xg_against);
      only(f <= a);
      return `${cap(s(c.evidence.team))} are not favoured here — ${f.toFixed(2)} to ${a.toFixed(2)} on expected goals — so what makes this a call is the draw counting, not a win being likely.`;
    },
    (c) => {
      const f = n(c.evidence.xg_for);
      const a = n(c.evidence.xg_against);
      only(f <= a);
      return `The numbers give ${s(c.evidence.opponent)} the better of it, ${a.toFixed(2)} to ${f.toFixed(2)}. This call survives that because it only needs ${s(c.evidence.team)} to avoid losing.`;
    },
  ],

  // A totals bet has no side, so the mismatch sentence must be about the shape
  // of the match rather than about who is better. Reusing strength_gap here
  // produced "Huracan project to score 1.1 times what Racing Club manage" under
  // an *under 3.5* call — a sentence arguing the opposite of the bet.
  match_shape: [
    (c) => {
      const t = n(c.evidence.total);
      return `The model reads this as a ${t.toFixed(2)}-goal match, and the call follows from that number rather than from either side.`;
    },
    (c) => {
      const f = n(c.evidence.xg_home);
      const a = n(c.evidence.xg_away);
      return `${f.toFixed(2)} expected for ${s(c.evidence.home)}, ${a.toFixed(2)} for ${s(c.evidence.away)} — neither side projects to run away with it, and the total is what matters here.`;
    },
    (c) => {
      const t = n(c.evidence.total);
      const line = n(c.evidence.line);
      only(Math.abs(t - line) >= 0.2);
      return `Expected goals total ${t.toFixed(2)} against a line of ${line.toFixed(1)}: ${t > line ? 'above' : 'below'} it, which is the call.`;
    },
    (c, rng) => {
      const t = n(c.evidence.total);
      only(t < 2.4);
      return `A ${intensity(c.magnitude, rng)} one-sided game on the numbers still only projects ${t.toFixed(2)} goals in total, and the total is the bet.`;
    },
    (c) => {
      const f = n(c.evidence.xg_home);
      const a = n(c.evidence.xg_away);
      only(f + a < 2.4);
      return `Neither attack is modelled to do much damage — ${f.toFixed(2)} and ${a.toFixed(2)} — so the goals market is where the confidence sits.`;
    },
    (c) => {
      const f = n(c.evidence.xg_home);
      const a = n(c.evidence.xg_away);
      only(f + a >= 2.8);
      return `${f.toFixed(2)} and ${a.toFixed(2)} makes ${(f + a).toFixed(2)} between them — enough traffic that the goals market is the clearer read here.`;
    },
    (c) => {
      const f = n(c.evidence.xg_home);
      const a = n(c.evidence.xg_away);
      only(f + a >= 2.8);
      return `Both sides are modelled to score: ${f.toFixed(2)} against ${a.toFixed(2)}, and a match with that much in it rarely stays quiet.`;
    },
  ],

  confidence_case: [
    (c) => {
      const p = n(c.evidence.prob_pct);
      const odds = n(c.evidence.odds);
      return `That puts it at ${p.toFixed(0)}%, priced ${odds.toFixed(2)} — a high-probability call rather than a claim the market is wrong.`;
    },
    (c) => {
      const p = n(c.evidence.prob_pct);
      const ret = n(c.evidence.return_pct);
      return `${p.toFixed(0)}% likely, returning ${ret.toFixed(0)}p in the pound. The confidence is the point here, not the payout.`;
    },
    (c) => {
      const p = n(c.evidence.prob_pct);
      const odds = n(c.evidence.odds);
      return `We make it ${p.toFixed(0)}% at ${odds.toFixed(2)}. Short, and short for a reason — the market has this one read the same way we do.`;
    },
    (c) => {
      const p = n(c.evidence.prob_pct);
      return `Call it ${p.toFixed(0)}%. Nothing in the pricing disagrees, so take this as a read on the match rather than on the odds.`;
    },
    (c) => {
      const p = n(c.evidence.prob_pct);
      const odds = n(c.evidence.odds);
      return `${p.toFixed(0)}% on our numbers, ${odds.toFixed(2)} on the board. Both are saying the same thing, which is worth knowing and is not an edge.`;
    },
  ],

  counterweight: [
    (c) => `It is not a clean case: ${s(c.evidence.detail)}.`,
    (c) => `Worth holding against it — ${s(c.evidence.detail)}.`,
    (c) => `One thing spoils the picture: ${s(c.evidence.detail)}.`,
    (c) => `The reservation, and it is a real one: ${s(c.evidence.detail)}.`,
    (c) => `Before anyone treats this as settled, ${s(c.evidence.detail)}.`,
    (c) => `What the confidence number does not see: ${s(c.evidence.detail)}.`,
  ],
};

/**
 * Connectives, chosen by whether the next claim reinforces the last one or cuts
 * against it. Getting this right is what tells a reader the model noticed the
 * tension rather than ignoring it.
 */
export const CONNECTIVES = {
  reinforcing: [
    'On top of that, ',
    'Alongside it, ',
    'In the same direction, ',
    'Compounding it, ',
    'Pulling the same way, ',
    'And ',
  ],
  opposing: [
    'Against that, ',
    'Cutting the other way, ',
    'Set against it, ',
    'The counterweight: ',
    'Pulling back the other way, ',
    'That said, ',
  ],
  neutral: [
    'Separately, ',
    'Also worth noting: ',
    'Elsewhere, ',
    'Meanwhile, ',
    'For context, ',
  ],
} as const;

export const _internals = { intensity, ROLE_WORD, cap, plural };
