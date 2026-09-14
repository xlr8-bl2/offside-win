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
const n = (v: unknown, fallback = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const s = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);
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
