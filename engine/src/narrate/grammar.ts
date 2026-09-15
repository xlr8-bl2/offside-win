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

/**
 * Frames per predicate. Each entry is a distinct sentence shape, not a reworded
 * version of its neighbour — that is the whole point.
 */
export const FRAMES: Record<ClaimPredicate, Frame[]> = {
  absence: [
    (c) => {
      const pct = n(c.evidence.goal_share_pct);
      return `${c.subject} is out, and that is ${pct}% of ${s(c.evidence.team)}'s league goals removed from the side.`;
    },
    (c) => {
      const pct = n(c.evidence.goal_share_pct);
      return `${s(c.evidence.team)} are without ${c.subject}, who has supplied ${pct}% of their goals this season.`;
    },
    (c) => {
      const pct = n(c.evidence.goal_share_pct);
      const cover = n(c.evidence.cover_at_position);
      const role = ROLE_WORD[s(c.evidence.role, 'UNKNOWN')] ?? 'player';
      return `Take ${c.subject} out and ${s(c.evidence.team)} lose ${pct}% of their scoring, with ${cover} fit ${plural(cover, role)} left to cover the position.`;
    },
    (c) => {
      const pct = n(c.evidence.goal_share_pct);
      return `${pct}% of ${s(c.evidence.team)}'s goals this season have come from ${c.subject}, and ${c.subject} does not play here.`;
    },
    (c, rng) => {
      const pct = n(c.evidence.goal_share_pct);
      return `Losing ${c.subject} thins ${s(c.evidence.team)}'s attack ${intensity(c.magnitude, rng)} — ${pct}% of the season's goals sit with ${c.subject === 'the squad' ? 'them' : 'that name alone'}.`;
    },
    (c) => {
      const role = ROLE_WORD[s(c.evidence.role, 'UNKNOWN')] ?? 'player';
      const pct = n(c.evidence.goal_share_pct);
      return `The ${role} ${c.subject} misses out for ${s(c.evidence.team)}, and with ${c.subject} goes ${pct}% of their goal output.`;
    },
  ],

  suspension: [
    (c) => {
      const pct = n(c.evidence.goal_share_pct);
      return `${c.subject} is suspended, which takes ${pct}% of ${s(c.evidence.team)}'s goals out of the side.`;
    },
    (c) => {
      const pct = n(c.evidence.goal_share_pct);
      return `A suspension rules ${c.subject} out — ${pct}% of ${s(c.evidence.team)}'s scoring this season, unavailable by the letter of the rules rather than by choice.`;
    },
    (c) => {
      const cover = n(c.evidence.cover_at_position);
      const role = ROLE_WORD[s(c.evidence.role, 'UNKNOWN')] ?? 'player';
      return `${s(c.evidence.team)} serve a suspension for ${c.subject} here, leaving ${cover} fit ${plural(cover, role)} in the position.`;
    },
    (c) => {
      const pct = n(c.evidence.goal_share_pct);
      return `With ${c.subject} banned, ${s(c.evidence.team)} field a side missing ${pct}% of its goal contribution.`;
    },
    (c, rng) => {
      const pct = n(c.evidence.goal_share_pct);
      return `${c.subject}'s suspension ${intensity(c.magnitude, rng)} weakens ${s(c.evidence.team)}, removing ${pct}% of the goals they have scored this season.`;
    },
  ],

  return: [
    (c) => `${c.subject} is back available for ${s(c.evidence.team)}.`,
    (c) => `${s(c.evidence.team)} welcome ${c.subject} back into contention.`,
    (c) => `The return of ${c.subject} restores an option ${s(c.evidence.team)} have been without.`,
  ],

  rotation: [
    (c) => `The eleven is predicted rather than confirmed, at ${n(c.evidence.confidence_pct)}% confidence, so selection is still an open question.`,
    (c) => `Nobody has named a side yet; the projected lineup carries only ${n(c.evidence.confidence_pct)}% confidence.`,
    (c) => `Selection is unresolved — the lineup projection sits at ${n(c.evidence.confidence_pct)}% and rotation would change this read.`,
    (c) => `At ${n(c.evidence.confidence_pct)}% confidence in the projected eleven, this is a call made before the team news.`,
  ],

  fatigue: [
    (c) => {
      const rest = n(c.evidence.days_rest);
      const in7 = n(c.evidence.matches_in_7_days);
      return in7 >= 3
        ? `${c.subject} play their ${in7 + 1}th match in seven days, on ${rest.toFixed(1)} days' rest.`
        : `${c.subject} have had only ${rest.toFixed(1)} days since their last match.`;
    },
    (c, rng) => {
      const rest = n(c.evidence.days_rest);
      return `Coming in on ${rest.toFixed(1)} days' rest, ${c.subject} arrive ${intensity(c.magnitude, rng)} short of fresh.`;
    },
    (c) => {
      const in14 = n(c.evidence.matches_in_14_days);
      return `${in14} matches in a fortnight has left ${c.subject} running on reserves, and pressing is the first thing to go.`;
    },
    (c) => {
      const rest = n(c.evidence.days_rest);
      return `The schedule has given ${c.subject} ${rest.toFixed(1)} days to recover, below the three that sustain full intensity.`;
    },
    (c) => {
      const in7 = n(c.evidence.matches_in_7_days);
      const rest = n(c.evidence.days_rest);
      return `Congestion bites here: ${in7} matches already inside a week for ${c.subject}, and ${rest.toFixed(1)} days before this one.`;
    },
  ],

  travel: [
    (c) => `${c.subject} travel ${n(c.evidence.travel_km).toLocaleString('en-GB')} km to play this.`,
    (c) => `A ${n(c.evidence.travel_km).toLocaleString('en-GB')} km journey precedes this fixture for ${c.subject}.`,
    (c) => `${c.subject} cover ${n(c.evidence.travel_km).toLocaleString('en-GB')} km to get here, and the legs know it.`,
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
  ],

  regime_bounce: [
    (c) => `${c.subject} are riding the lift that follows a managerial change, which historically fades by around the sixth game.`,
    (c) => `The new-manager effect is still live at ${c.subject}, and it is a short-term factor rather than a structural one.`,
  ],

  regime_settled: [
    (c) => `${c.subject} have had the same manager for ${n(c.evidence.years)} years and ${n(c.evidence.matches)} matches, so their habits are deeply encoded and the sample behind them is large.`,
    (c) => `Nothing has changed at ${c.subject} in ${n(c.evidence.years)} years under the same manager — this is the easiest kind of side to read.`,
  ],

  stakes: [
    (c) => `${cap(c.subject)} arrive ${s(c.evidence.state)}, with ${n(c.evidence.games_left)} ${plural(n(c.evidence.games_left), 'game')} left.`,
    (c) => `With ${n(c.evidence.games_left)} ${plural(n(c.evidence.games_left), 'game')} remaining, ${c.subject} are ${s(c.evidence.state)} — and that shapes how this is played more than the team sheet does.`,
    (c) =>
      c.polarity < 0
        ? `There is nothing riding on this for ${c.subject}, and games with nothing riding on them are played at something short of full intensity.`
        : `${cap(c.subject)} need this: ${s(c.evidence.state)} with ${n(c.evidence.games_left)} to play.`,
    (c) => `The table puts ${c.subject} ${s(c.evidence.state)}, which is the strongest single influence on how cautious this becomes.`,
  ],

  derby: [
    (c) => `${s(c.evidence.home)} against ${s(c.evidence.away)} is a local derby, and derbies reliably produce cards even when they do not produce goals.`,
    (c) => `This is a derby, which lifts the card count and the chance of defensive error without lifting the goal total in any dependable way.`,
    (c) => `Local rivalry raises the temperature here: tackles get made that would be pulled out of in a regular fixture.`,
  ],

  revenge: [
    (c) => `${c.subject} lost the reverse fixture ${s(c.evidence.reverse_score)}, and sides beaten that heavily tend to turn up better than their form suggests.`,
    (c) => `The ${s(c.evidence.reverse_score)} defeat earlier in the season is the kind of result players remember and managers mention.`,
    (c) => `A ${n(c.evidence.margin)}-goal beating in the reverse meeting gives ${c.subject} a specific reason to be better than the numbers imply.`,
  ],

  form: [
    (c) => {
      const g = n(c.evidence.goals_minus_xg);
      return `${c.subject} have been ${g > 0 ? 'outscoring' : 'falling short of'} their expected goals by ${Math.abs(g).toFixed(2)} a game across ${n(c.evidence.matches)} matches — a gap that historically closes rather than holds.`;
    },
    (c) => {
      const g = n(c.evidence.goals_minus_xg);
      return `Over ${n(c.evidence.matches)} matches ${c.subject}'s finishing has run ${Math.abs(g).toFixed(2)} goals a game ${g > 0 ? 'ahead of' : 'behind'} the chances created, which is not a level that usually persists.`;
    },
    (c) => {
      const g = n(c.evidence.goals_minus_xg);
      return `The scoreline has flattered ${c.subject}${g > 0 ? '' : ' less than it should have'}: ${Math.abs(g).toFixed(2)} goals a game ${g > 0 ? 'above' : 'below'} what the chances were worth.`;
    },
  ],

  style_clash: [
    (c) => `${c.subject} average ${n(c.evidence.possession_gap)} points more possession than ${s(c.evidence.opponent)}, so expect one side with the ball and one chasing it.`,
    (c) => `The shape of this is lopsided: ${n(c.evidence.possession)}% possession for ${c.subject} against a side that does not want it.`,
    (c) => `${s(c.evidence.opponent)} will spend this match without the ball — ${c.subject} hold ${n(c.evidence.possession_gap)} points more of it than they do.`,
  ],

  set_piece: [
    (c) => `${c.subject} carry an unusual share of their threat from dead balls.`,
    (c) => `Set pieces are where ${c.subject} do their damage, which changes what a corner is worth here.`,
  ],

  weather: [
    (c) => {
      if (typeof c.evidence.rain_mm === 'number') return `${n(c.evidence.rain_mm)} mm of rain is forecast, and wet surfaces produce miscontrol, transitions and mistakes.`;
      if (typeof c.evidence.wind_kph === 'number') return `${n(c.evidence.wind_kph)} km/h of wind will blunt crossing accuracy and long-ball precision.`;
      return `Conditions are a factor here rather than a footnote.`;
    },
    (c) => {
      if (typeof c.evidence.temperature_c === 'number' && n(c.evidence.temperature_c) > 20) return `${n(c.evidence.temperature_c)}°C is hot enough that nobody presses for ninety minutes, and the second half usually closes up.`;
      if (typeof c.evidence.rain_mm === 'number') return `Heavy rain — ${n(c.evidence.rain_mm)} mm — favours the side that presses and punishes the side that wants to pass through it.`;
      if (typeof c.evidence.wind_kph === 'number') return `Wind at ${n(c.evidence.wind_kph)} km/h means more balls hit long and fewer of them landing where they were aimed.`;
      return `The forecast matters more than usual here.`;
    },
    (c) => {
      if (typeof c.evidence.wind_kph === 'number') return `Expect more corners and worse deliveries from them, with ${n(c.evidence.wind_kph)} km/h swirling about.`;
      if (typeof c.evidence.rain_mm === 'number') return `A wet pitch turns controlled possession into a series of loose second balls.`;
      return `Weather is doing some of the work here.`;
    },
  ],

  pitch: [
    (c) => `The surface is rated ${n(c.evidence.rating)} out of ${n(c.evidence.scale_max)}, heavy enough to slow the passing game.`,
    (c) => `A heavy pitch penalises combination play and rewards whoever is happier running at people.`,
  ],

  crowd: [
    (c) => `Played on neutral ground, so ${c.subject} do not get the advantage the model normally credits them at home.`,
    (c) => `There is no home crowd in this one, and the fitted home edge comes out of the numbers accordingly.`,
  ],

  referee: [
    (c) => `The referee averages ${n(c.evidence.yellows_per_match).toFixed(1)} bookings a game against a league average of ${n(c.evidence.league_average).toFixed(1)}, across ${n(c.evidence.matches)} matches.`,
    (c) => `Over ${n(c.evidence.matches)} games this official has run ${n(c.evidence.yellows_per_match).toFixed(1)} cards a match, ${n(c.evidence.yellows_per_match) > n(c.evidence.league_average) ? 'above' : 'below'} the ${n(c.evidence.league_average).toFixed(1)} norm.`,
    (c) => `Whoever is refereeing matters here: ${n(c.evidence.yellows_per_match).toFixed(1)} bookings a game over a ${n(c.evidence.matches)}-match sample.`,
  ],

  market_move: [
    (c) => `${s(c.evidence.outcome)} has ${s(c.evidence.direction) === 'SHORTENING' ? 'shortened' : 'drifted'} ${n(c.evidence.move_pct).toFixed(1)}% since the line opened.`,
    (c) => `Money has moved: ${n(c.evidence.move_pct).toFixed(1)}% on ${s(c.evidence.outcome)} between opening and now.`,
    (c) => `The line has not stood still — ${s(c.evidence.outcome)} is ${n(c.evidence.move_pct).toFixed(1)}% ${s(c.evidence.direction) === 'SHORTENING' ? 'shorter' : 'longer'} than it opened.`,
  ],

  market_sharp: [
    (c) => `The sharp book prices ${s(c.evidence.outcome)} ${n(c.evidence.gap_points).toFixed(1)} points away from the wider market, and when those two disagree the sharp one is usually right.`,
    (c) => `There is a ${n(c.evidence.gap_points).toFixed(1)}-point gap between the sharpest book and everyone else on ${s(c.evidence.outcome)}.`,
  ],

  market_crowd: [
    (c) => `The prediction market has ${s(c.evidence.outcome)} ${n(c.evidence.gap_points).toFixed(1)} points away from the bookmakers, past the threshold where one of them is wrong.`,
    (c) => `Traders and bookmakers disagree by ${n(c.evidence.gap_points).toFixed(1)} points on ${s(c.evidence.outcome)} here.`,
  ],

  rating_gap: [
    (c) => `Our own numbers make this ${n(c.evidence.model_pct).toFixed(1)}% against the ${n(c.evidence.book_pct).toFixed(1)}% the price implies.`,
    (c) => `We rate it ${n(c.evidence.model_pct).toFixed(1)}%; the market is at ${n(c.evidence.book_pct).toFixed(1)}%. That gap is the bet.`,
    (c) => `The ${n(c.evidence.edge_points).toFixed(1)}-point difference between our ${n(c.evidence.model_pct).toFixed(1)}% and the book's ${n(c.evidence.book_pct).toFixed(1)}% is what makes this worth taking.`,
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
      only(f - a < 0.7);
      return `${cap(s(c.evidence.team))} are the better side at ${f.toFixed(2)} to ${a.toFixed(2)}, though not by the margin the confidence number might suggest — the cushion here is the draw, not the win.`;
    },
    (c) => {
      const f = n(c.evidence.xg_for);
      const a = n(c.evidence.xg_against);
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
      const side = t > line ? 'above' : 'below';
      return `Expected goals total ${t.toFixed(2)} against a line of ${line.toFixed(1)}: ${side} it, which is the call.`;
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
