/**
 * What today is.
 *
 * The old hero picker knew two things: a league's rank, and the provider's
 * `is_local_derby` flag, which it paid +180 for. In a 39-fixture sample that
 * flag fired exactly twice — on a Belgian under-23 reserve match and a
 * Bulgarian second-tier tie — so the bonus meant for the Manchester derby was
 * being spent on games nobody has heard of. Meanwhile El Clásico would score
 * nothing on it at all, because Madrid and Barcelona are not local to each
 * other and the flag is telling the literal truth.
 *
 * So the big fixtures are named here, by hand, because no feed has them.
 *
 * Matching is on team names rather than ids on purpose. The provider carries
 * more than one id for the same club — Barcelona appears as both 44 and 917 in
 * a single board — so an id table would silently miss half the meetings. The
 * safeguard against a name collision is that *both* sides must match: "Rangers"
 * alone is ambiguous between Glasgow, Enugu and Stafford, but "Celtic v
 * Rangers" is not, because the other three do not play Celtic.
 */

/** Tokens that are decoration on a club name rather than part of it. */
const NOISE = new Set([
  'fc', 'cf', 'afc', 'ac', 'as', 'ss', 'ssc', 'sv', 'sc', 'rc', 'rcd', 'cd', 'ud',
  'club', 'de', 'del', 'the', 'koninklijke', 'olympique', 'associazione', 'calcio',
  'sociedad', 'deportivo', 'futbol', 'fútbol', 'football', 'sporting',
]);

/**
 * A club name reduced to the part people actually say.
 *
 * "Olympique de Marseille" and "Marseille" have to land in the same place, and
 * so do "FC Barcelona" and "Fútbol Club Barcelona". Accents go because the feed
 * is inconsistent about them; "Atlético" and "Atletico" are the same club.
 *
 * Deliberately *not* stripped: Real, Athletic, Atletico, Inter, United, City.
 * Those distinguish clubs rather than decorate them, and dropping them is how
 * Real Madrid becomes Madrid and collides with Atletico Madrid.
 */
export function normalise(name: string): string {
  const flat = String(name)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ');

  const kept = flat.split(/\s+/).filter((w) => w && !NOISE.has(w));
  // Everything was noise (a club literally called "Sporting"): keep the original.
  return (kept.length ? kept : flat.split(/\s+/).filter(Boolean)).join(' ').trim();
}

export interface NamedFixture {
  /** Shown as the occasion kicker, in the product's voice. */
  kicker: string;
  /** How much this outranks an ordinary fixture. */
  weight: number;
  /** Normalised alternatives for each side. Order does not matter. */
  a: string[];
  b: string[];
}

/**
 * The fixtures that carry their own name.
 *
 * Weights are relative to the league-rank gap of 100 a tier, so a 300 here
 * means "worth three tiers of competition" — enough for El Clásico to lead a
 * Champions League night, which is correct.
 */
export const NAMED: NamedFixture[] = [
  // Spain
  { kicker: 'El Clásico', weight: 400, a: ['real madrid'], b: ['barcelona'] },
  { kicker: 'The Madrid derby', weight: 260, a: ['real madrid'], b: ['atletico madrid', 'atletico'] },
  { kicker: 'The Seville derby', weight: 180, a: ['sevilla'], b: ['real betis', 'betis'] },
  { kicker: 'The Basque derby', weight: 150, a: ['athletic', 'athletic bilbao'], b: ['real sociedad'] },

  // England
  { kicker: 'The Manchester derby', weight: 300, a: ['manchester united'], b: ['manchester city'] },
  { kicker: 'The Merseyside derby', weight: 260, a: ['liverpool'], b: ['everton'] },
  { kicker: 'The North London derby', weight: 260, a: ['arsenal'], b: ['tottenham hotspur', 'tottenham'] },
  { kicker: 'The North West derby', weight: 280, a: ['liverpool'], b: ['manchester united'] },
  { kicker: 'The Tyne-Wear derby', weight: 160, a: ['newcastle united'], b: ['sunderland'] },
  { kicker: 'The Steel City derby', weight: 140, a: ['sheffield united'], b: ['sheffield wednesday'] },

  // Italy
  { kicker: 'The Milan derby', weight: 290, a: ['milan'], b: ['inter', 'internazionale'] },
  { kicker: 'The Derby d’Italia', weight: 270, a: ['juventus'], b: ['inter', 'internazionale'] },
  { kicker: 'The Rome derby', weight: 220, a: ['roma'], b: ['lazio'] },
  { kicker: 'Juventus v Napoli', weight: 200, a: ['juventus'], b: ['napoli'] },

  // Germany
  { kicker: 'Der Klassiker', weight: 290, a: ['bayern munchen', 'bayern munich', 'bayern'], b: ['borussia dortmund', 'dortmund'] },
  { kicker: 'The Revierderby', weight: 200, a: ['borussia dortmund', 'dortmund'], b: ['schalke 04', 'schalke'] },

  // France
  { kicker: 'Le Classique', weight: 250, a: ['paris saint germain', 'paris saint-germain', 'psg'], b: ['marseille'] },

  // Scotland
  { kicker: 'The Old Firm', weight: 260, a: ['celtic'], b: ['rangers'] },

  // Netherlands, Portugal, Turkey, Greece, Serbia
  { kicker: 'De Klassieker', weight: 220, a: ['ajax'], b: ['feyenoord'] },
  { kicker: 'O Clássico', weight: 220, a: ['benfica'], b: ['porto'] },
  { kicker: 'The Lisbon derby', weight: 200, a: ['benfica'], b: ['cp', 'lisboa', 'sporting cp'] },
  { kicker: 'The Intercontinental derby', weight: 230, a: ['galatasaray'], b: ['fenerbahce'] },
  { kicker: 'The Derby of the Eternal Enemies', weight: 190, a: ['olympiacos', 'olympiakos'], b: ['panathinaikos'] },
  { kicker: 'The Eternal derby', weight: 180, a: ['crvena zvezda', 'red star belgrade', 'red star'], b: ['partizan'] },

  // South America
  { kicker: 'The Superclásico', weight: 280, a: ['boca juniors', 'boca'], b: ['river plate', 'river'] },
  { kicker: 'The Derby of the Millions', weight: 170, a: ['flamengo'], b: ['fluminense'] },
];

/** The named fixture for this pairing, if there is one. */
export function namedFixture(home: string, away: string): NamedFixture | null {
  const h = normalise(home);
  const a = normalise(away);
  const hit = (list: string[], v: string) => list.some((n) => v === n || v.endsWith(` ${n}`) || v.startsWith(`${n} `));

  for (const f of NAMED) {
    if ((hit(f.a, h) && hit(f.b, a)) || (hit(f.b, h) && hit(f.a, a))) return f;
  }
  return null;
}

/* ------------------------------------------------------------------ stage */

/**
 * How far into a competition this is, read off the round label the provider
 * already sends — "Quarterfinals", "League phase · Matchday 1", "Final".
 *
 * A final is the one fixture that outranks everything, including El Clásico,
 * because it only happens once.
 */
export interface Stage {
  kicker: string;
  weight: number;
}

export function stageOf(roundLabel: string | null | undefined): Stage | null {
  const r = String(roundLabel ?? '').toLowerCase();
  if (!r) return null;
  if (/\bfinal\b/.test(r) && !/semi|quarter|1\/|eighth/.test(r)) return { kicker: 'The final', weight: 500 };
  if (/semi.?final/.test(r)) return { kicker: 'Semi-final', weight: 260 };
  if (/quarter.?final/.test(r)) return { kicker: 'Quarter-final', weight: 190 };
  if (/round of 16|last 16|eighth.?final/.test(r)) return { kicker: 'Last 16', weight: 150 };
  if (/play.?off/.test(r)) return { kicker: 'Play-off', weight: 130 };
  return null;
}

/* ------------------------------------------------------- competition night */

/**
 * Competition weighting. Kept tight on purpose: a flat marquee bonus is what
 * put the Europa League above Barcelona once already, and the user had warned
 * about exactly that before it happened.
 */
export const COMPETITION: Record<number, { kicker: string; weight: number }> = {
  7: { kicker: 'Champions League night', weight: 220 },
  8: { kicker: 'Europa League night', weight: 60 },
  83: { kicker: 'Conference League night', weight: 30 },
};

/* ------------------------------------------------------------- the choice */

export interface OccasionInput {
  home: string;
  away: string;
  league_id: number;
  round_label?: string | null;
  /** The provider's flag. A tiebreak now, not a headline. */
  local_derby?: boolean;
  /** Lower is a bigger competition. */
  rank: number;
}

export interface Occasion {
  kicker: string;
  weight: number;
  /** Why this was chosen, so the pick can be audited rather than guessed at. */
  reason: string;
}

/**
 * What to call this fixture, and how much it matters today.
 *
 * The named fixture wins over the stage only when it is worth more — a cup
 * final between two clubs with a name for each other is still the final.
 */
export function occasionOf(f: OccasionInput): Occasion {
  const candidates: Occasion[] = [];

  const named = namedFixture(f.home, f.away);
  if (named) candidates.push({ kicker: named.kicker, weight: named.weight, reason: 'named fixture' });

  // A final is worth what the competition it ends is worth. Unscaled, a 500
  // for "THE FINAL" put the Estonian Cup final above Arsenal v Liverpool,
  // which is the same mistake as the flat derby bonus in a different costume.
  const stage = stageOf(f.round_label);
  if (stage) {
    const prominence = Math.max(0.35, (9 - f.rank) / 7);
    candidates.push({
      kicker: stage.kicker,
      weight: Math.round(stage.weight * prominence),
      reason: 'competition stage',
    });
  }

  const comp = COMPETITION[f.league_id];
  if (comp) candidates.push({ kicker: comp.kicker, weight: comp.weight, reason: 'competition' });

  // The provider's flag, worth a nudge and no more. It is true of a reserve-team
  // fixture as readily as a real derby, so it can break a tie and never lead.
  if (f.local_derby) candidates.push({ kicker: 'A local derby', weight: 25, reason: 'provider derby flag' });

  if (candidates.length === 0) return { kicker: '', weight: 0, reason: 'ordinary fixture' };

  candidates.sort((x, y) => y.weight - x.weight);
  return candidates[0]!;
}
