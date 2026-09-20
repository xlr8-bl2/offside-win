/**
 * Which bookmaker a price gets shown as, given where the reader is.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS ON THE CLIENT
 *
 * The engine takes prices from every book it can see, and it should: the fair
 * price comes from de-vigging a weighted consensus, and the sharpest books —
 * Pinnacle above all — carry the heaviest weight in it. Dropping them would
 * make the model worse.
 *
 * But the best price in the world is regularly at a book the reader cannot
 * open an account with. Pinnacle takes nobody in Britain. 1xBet holds no
 * Gambling Commission licence. Naming those as "the book offering it" is two
 * failures at once: a price nobody reading can take, and an unlicensed
 * operator advertised to an audience it is not licensed for.
 *
 * Which books those are is a fact about the reader, not about the fixture — so
 * it cannot be decided when the slate runs. The card carries every book's
 * price and the resolving happens here, against the device.
 *
 * ---------------------------------------------------------------------------
 * THIS TABLE NEEDS CHECKING AND IT IS NOT MINE TO CERTIFY
 *
 * Each list is the mainstream operators in that market, most-used first.
 * Operators enter and leave markets and licences lapse. Where I was not
 * confident an operator currently holds a local licence it is left OUT,
 * because the cost of wrongly excluding a book is one fewer price and the cost
 * of wrongly including one is a regulatory breach.
 *
 * Verify each market against its own regulator's public register before
 * launch, and again whenever a new book appears in the board's price lists.
 */

/** Books that take customers almost anywhere, used when a country is unlisted. */
const INT = ['bet365', '1xbet', '22bet', 'betwinner', 'melbet', 'megapari', 'bwin', 'betway', 'pinnacle'];

/**
 * Country -> the books that matter there, in rough order of how many people
 * actually hold an account. Order breaks ties; it is not a ranking of price.
 */
const BOOKS = {
  GB: ['bet365', 'skybet', 'williamhill', 'ladbrokes', 'coral', 'paddypower', 'betfair',
       'betfred', 'betvictor', 'unibet', 'boylesports', '888sport', 'betway', 'virginbet',
       'smarkets', 'matchbook', 'spreadex', 'midnite', 'talksportbet', 'quinnbet', 'leovegas'],
  IE: ['paddypower', 'bet365', 'boylesports', 'betfair', 'ladbrokes', 'skybet', 'williamhill',
       'betvictor', 'unibet', 'betfred', '888sport'],
  DE: ['bwin', 'tipico', 'bet365', 'interwetten', 'betano', 'winamax', 'merkurbets', 'betway', 'happybet'],
  AT: ['bwin', 'interwetten', 'tipico', 'bet365', 'betano', 'admiralbet'],
  ES: ['bet365', 'codere', 'sportium', 'williamhill', 'betfair', 'luckia', 'winamax', 'retabet', 'bwin', 'marathonbet'],
  IT: ['sisal', 'snai', 'eurobet', 'bet365', 'lottomatica', 'goldbet', 'betflag', 'planetwin365', 'betfair', 'bwin'],
  FR: ['winamax', 'betclic', 'unibet', 'pmu', 'parionssport', 'zebet', 'netbet', 'vbet'],
  NL: ['tototo', 'toto', 'unibet', 'betcity', 'jacks', 'holland casino', 'bet365', 'betnation'],
  BE: ['unibet', 'ladbrokes', 'bwin', 'betfirst', 'golden palace', 'napoleon sports', 'circus'],
  PT: ['betano', 'betclic', 'bet365', 'solverde', 'placard', 'esc online'],
  GR: ['stoiximan', 'bet365', 'novibet', 'betano', 'pamestoixima', 'winmasters', 'fonbet'],
  PL: ['sts', 'fortuna', 'betclic', 'superbet', 'totalbet', 'etoto', 'lvbet', 'forbet'],
  RO: ['superbet', 'betano', 'unibet', 'fortuna', 'netbet', 'maxbet', 'betfair'],
  SE: ['svenska spel', 'unibet', 'betsson', 'leovegas', 'bet365', 'expekt', 'nordicbet'],
  DK: ['danske spil', 'bet365', 'unibet', 'betsson', 'leovegas', 'nordicbet', 'expekt'],
  NO: ['norsk tipping', 'unibet', 'betsson', 'bet365', 'nordicbet'],
  FI: ['veikkaus', 'unibet', 'betsson', 'bet365', 'nordicbet'],
  CH: ['bet365', 'interwetten', 'bwin', 'jouez sport', 'sporttip'],
  BR: ['betano', 'bet365', 'sportingbet', 'betfair', 'kto', 'superbet', 'novibet', 'betnacional', 'estrelabet'],
  AR: ['bplay', 'betano', 'bet365', 'codere', 'betsson'],
  MX: ['caliente', 'bet365', 'codere', 'betano', 'betway', 'strendus'],
  CL: ['betano', 'bet365', 'betsson', 'coolbet'],
  CO: ['wplay', 'betplay', 'codere', 'bet365', 'betsson', 'rushbet'],
  CA: ['bet365', 'betway', 'fanduel', 'draftkings', 'betrivers', 'pointsbet', 'betano', 'proline'],
  AU: ['sportsbet', 'tab', 'ladbrokes', 'neds', 'bet365', 'pointsbet', 'betr', 'unibet', 'palmerbet'],
  NZ: ['tab'],
  IN: ['1xbet', 'parimatch', '10cric', 'betway', 'dafabet', 'bet365', 'megapari'],
  NG: ['sportybet', 'bet9ja', 'betking', '1xbet', 'betano', 'msport', 'nairabet', 'merrybet', 'bangbet', 'betway'],
  GH: ['sportybet', 'betway', '1xbet', 'betpawa', 'msport', 'soccarbet'],
  KE: ['sportpesa', 'betika', 'odibets', '1xbet', 'betpawa', 'mozzartbet', 'shabiki'],
  TZ: ['betpawa', 'sportpesa', 'premierbet', 'meridianbet', 'betway', 'mozzartbet'],
  UG: ['betpawa', 'sportpesa', 'fortebet', '1xbet', 'betway', 'gal sport'],
  ZM: ['betpawa', 'premierbet', 'betway', 'gal sport'],
  CM: ['1xbet', 'premierbet', 'betpawa', 'supergooal'],
  CI: ['premierbet', '1xbet', 'betpawa', 'supergooal'],
  SN: ['premierbet', '1xbet', 'betpawa', 'lonase'],
  ZA: ['hollywoodbets', 'betway', 'supabets', 'sunbet', 'easybet', 'worldsportbetting', 'gbets', '10bet'],
  EG: ['1xbet', 'betwinner', 'melbet', '22bet'],
  MA: ['1xbet', 'betwinner', 'melbet', '22bet'],
  TR: ['nesine', 'bilyoner', 'iddaa', 'misli', 'tuttur'],
  JP: [],
  US: ['draftkings', 'fanduel', 'betmgm', 'caesars', 'betrivers', 'espn bet', 'fanatics', 'bet365'],
};

/**
 * Timezone -> country. `Intl.Locale(navigator.language).region` is the obvious
 * source and it is wrong constantly: half the phones in Lagos and Dublin are
 * set to en-US because that is the default. The timezone is set by where the
 * device actually is, so it goes first and the locale is the fallback.
 *
 * Only zones for countries the table above knows about are listed — anything
 * else lands on the international list, which is the same answer a longer map
 * would have given.
 */
const ZONE_COUNTRY = {
  'Europe/London': 'GB', 'Europe/Belfast': 'GB', 'Europe/Guernsey': 'GB', 'Europe/Jersey': 'GB',
  'Europe/Isle_of_Man': 'GB', 'Europe/Dublin': 'IE',
  'Europe/Berlin': 'DE', 'Europe/Busingen': 'DE', 'Europe/Vienna': 'AT', 'Europe/Zurich': 'CH',
  'Europe/Madrid': 'ES', 'Atlantic/Canary': 'ES', 'Africa/Ceuta': 'ES',
  'Europe/Rome': 'IT', 'Europe/Vatican': 'IT', 'Europe/San_Marino': 'IT',
  'Europe/Paris': 'FR', 'Europe/Monaco': 'FR',
  'Europe/Amsterdam': 'NL', 'Europe/Brussels': 'BE',
  'Europe/Lisbon': 'PT', 'Atlantic/Madeira': 'PT', 'Atlantic/Azores': 'PT',
  'Europe/Athens': 'GR', 'Europe/Warsaw': 'PL', 'Europe/Bucharest': 'RO',
  'Europe/Stockholm': 'SE', 'Europe/Copenhagen': 'DK', 'Europe/Oslo': 'NO', 'Europe/Helsinki': 'FI',
  'Europe/Istanbul': 'TR',
  'America/Sao_Paulo': 'BR', 'America/Bahia': 'BR', 'America/Fortaleza': 'BR', 'America/Recife': 'BR',
  'America/Belem': 'BR', 'America/Manaus': 'BR', 'America/Cuiaba': 'BR', 'America/Campo_Grande': 'BR',
  'America/Argentina/Buenos_Aires': 'AR', 'America/Argentina/Cordoba': 'AR', 'America/Argentina/Mendoza': 'AR',
  'America/Mexico_City': 'MX', 'America/Monterrey': 'MX', 'America/Tijuana': 'MX', 'America/Cancun': 'MX',
  'America/Santiago': 'CL', 'America/Bogota': 'CO',
  'America/Toronto': 'CA', 'America/Vancouver': 'CA', 'America/Edmonton': 'CA', 'America/Winnipeg': 'CA',
  'America/Halifax': 'CA', 'America/St_Johns': 'CA', 'America/Montreal': 'CA', 'America/Regina': 'CA',
  'Australia/Sydney': 'AU', 'Australia/Melbourne': 'AU', 'Australia/Brisbane': 'AU',
  'Australia/Perth': 'AU', 'Australia/Adelaide': 'AU', 'Australia/Hobart': 'AU', 'Australia/Darwin': 'AU',
  'Pacific/Auckland': 'NZ',
  'Asia/Kolkata': 'IN', 'Asia/Calcutta': 'IN',
  'Africa/Lagos': 'NG', 'Africa/Accra': 'GH', 'Africa/Nairobi': 'KE',
  'Africa/Dar_es_Salaam': 'TZ', 'Africa/Kampala': 'UG', 'Africa/Lusaka': 'ZM',
  'Africa/Douala': 'CM', 'Africa/Abidjan': 'CI', 'Africa/Dakar': 'SN',
  'Africa/Johannesburg': 'ZA', 'Africa/Cairo': 'EG', 'Africa/Casablanca': 'MA',
  'America/New_York': 'US', 'America/Chicago': 'US', 'America/Denver': 'US',
  'America/Los_Angeles': 'US', 'America/Phoenix': 'US', 'America/Detroit': 'US', 'America/Anchorage': 'US',
};

/** Names, so the page can say where it thinks the reader is in plain words. */
export const COUNTRY_NAMES = {
  GB: 'United Kingdom', IE: 'Ireland', DE: 'Germany', AT: 'Austria', CH: 'Switzerland',
  ES: 'Spain', IT: 'Italy', FR: 'France', NL: 'Netherlands', BE: 'Belgium', PT: 'Portugal',
  GR: 'Greece', PL: 'Poland', RO: 'Romania', SE: 'Sweden', DK: 'Denmark', NO: 'Norway',
  FI: 'Finland', TR: 'Türkiye', BR: 'Brazil', AR: 'Argentina', MX: 'Mexico', CL: 'Chile',
  CO: 'Colombia', CA: 'Canada', AU: 'Australia', NZ: 'New Zealand', IN: 'India',
  NG: 'Nigeria', GH: 'Ghana', KE: 'Kenya', TZ: 'Tanzania', UG: 'Uganda', ZM: 'Zambia',
  CM: 'Cameroon', CI: "Côte d'Ivoire", SN: 'Senegal', ZA: 'South Africa', EG: 'Egypt',
  MA: 'Morocco', US: 'United States', JP: 'Japan',
  XX: 'Anywhere else',
};

/** The countries the picker offers, sorted by name with the catch-all last. */
export function countryOptions() {
  return Object.keys(BOOKS)
    .filter((c) => BOOKS[c].length)
    .sort((a, b) => COUNTRY_NAMES[a].localeCompare(COUNTRY_NAMES[b]))
    .concat('XX');
}

const STORE = 'offside.country';

/** A reader who corrects us is right; the correction outlives the session. */
export function setCountry(code) {
  try {
    if (code) localStorage.setItem(STORE, code);
    else localStorage.removeItem(STORE);
  } catch { /* private mode: the guess still works, it just will not stick */ }
  detected = null;
}

let detected = null;

/** The reader's country: their choice, else the device's timezone, else locale. */
export function country() {
  if (detected) return detected;
  try {
    const saved = localStorage.getItem(STORE);
    if (saved && (saved === 'XX' || BOOKS[saved])) return (detected = saved);
  } catch { /* unreadable storage is the same as no preference */ }

  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (ZONE_COUNTRY[zone]) return (detected = ZONE_COUNTRY[zone]);
  } catch { /* ancient browser */ }

  try {
    const region = new Intl.Locale(navigator.language).region;
    if (region && BOOKS[region]) return (detected = region);
  } catch { /* navigator.language can be a bare "en" */ }

  return (detected = 'XX');
}

/** Whether we are guessing or the reader told us. */
export function countryIsGuess() {
  try {
    return !localStorage.getItem(STORE);
  } catch {
    return true;
  }
}

const key = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** Matching is on slug AND display name — the provider fills in either. */
function matches(price, wanted) {
  const a = key(price.slug);
  const b = key(price.book);
  return wanted.has(a) || wanted.has(b);
}

/**
 * The price to print, given a call's full list of quotes.
 *
 * Returns the best price among the books available where the reader is, with
 * `local: false` when no such book quotes it — in which case the caller shows
 * the global best and says plainly that it is not available locally, rather
 * than silently printing a price that cannot be taken.
 */
export function localPrice(prices, code = country()) {
  const list = Array.isArray(prices) ? prices.filter((p) => p && p.odds > 1) : [];
  if (!list.length) return null;

  const names = BOOKS[code] ?? INT;
  const wanted = new Set(names.map(key));
  const here = list.filter((p) => matches(p, wanted));

  if (here.length) {
    const top = here.reduce((a, b) => (b.odds > a.odds ? b : a));
    return { odds: top.odds, book: top.book, slug: top.slug, local: true, count: here.length };
  }

  const top = list.reduce((a, b) => (b.odds > a.odds ? b : a));
  return { odds: top.odds, book: top.book, slug: top.slug, local: false, count: 0 };
}
