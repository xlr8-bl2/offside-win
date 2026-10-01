/**
 * The fixtures that carry their own name, for the browser.
 *
 * engine/src/occasion.ts is the definition: it decides which game leads the
 * front page, and its comments say why matching is on names rather than ids
 * and why both sides must match. This is the same list and the same matcher,
 * so the site can tell El Clásico from an ordinary Sunday without asking the
 * server. engine/test/occasion-agreement.test.ts fails if the two drift.
 */

const NOISE = new Set([
  'fc', 'cf', 'afc', 'ac', 'as', 'ss', 'ssc', 'sv', 'sc', 'rc', 'rcd', 'cd', 'ud',
  'club', 'de', 'del', 'the', 'koninklijke', 'olympique', 'associazione', 'calcio',
  'sociedad', 'deportivo', 'futbol', 'fútbol', 'football', 'sporting',
]);

/** A club name reduced to the part people actually say ("FC Barcelona" is "barcelona"). */
export function normalise(name) {
  const flat = String(name ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ');
  const kept = flat.split(/\s+/).filter((w) => w && !NOISE.has(w));
  return (kept.length ? kept : flat.split(/\s+/).filter(Boolean)).join(' ').trim();
}

export const NAMED = [
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
export function namedFixture(home, away) {
  const h = normalise(home);
  const a = normalise(away);
  const hit = (list, v) => list.some((n) => v === n || v.endsWith(` ${n}`) || v.startsWith(`${n} `));
  for (const f of NAMED) {
    if ((hit(f.a, h) && hit(f.b, a)) || (hit(f.b, h) && hit(f.a, a))) return f;
  }
  return null;
}
