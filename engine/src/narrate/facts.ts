/**
 * The evidence, said the way a supporter would say it.
 *
 * This is the layer that fixes "numbers without any clear meaning". The factor
 * modules compute good, verified evidence and then hand over things like
 * `ppg: 1.17`, `goals_against: 1.83`, `yellows_per_match: 4.89`. Those are
 * spreadsheet numbers: correct, and not what anyone says out loud. Rendered
 * straight they produced "Sarpsborg are the better side at 1.78 to 1.15",
 * where the reader is never told what is being counted.
 *
 * So the translation happens here, in code, before any writing. A `record` of
 * "2-1-3" becomes "won two of their last six". A cruciate ligament injury
 * becomes a named player who is out. `days_rest: 4` becomes "four days since
 * they last played".
 *
 * The rule, applied throughout: **emit a number only if a supporter would say
 * it in a pub.** Counts, days, games, scorelines and league positions are all
 * fine. Anything with a decimal point is not, and where a decimal carries real
 * meaning it is turned into a comparison instead — "the referee books more than
 * most" rather than 4.89 against a league average of 4.03.
 *
 * The writer downstream only ever sees these lines, so it cannot reach for a
 * figure that is not here. That is deliberate: a prompt asking a model not to
 * use jargon competes with the jargon sitting in its input, and loses.
 */

import { absenceReason } from '../context/absence.ts';

export interface PubFact {
  /** The sayable line. */
  text: string;
  /** Who it is about. */
  side: 'home' | 'away' | 'match';
  /** How much it is worth leading on. Higher first. */
  weight: number;
}

interface LedgerEntry {
  id: string;
  state?: string;
  evidence?: Record<string, unknown>;
}

interface LineupPlayer { name?: string; position?: string | null; starting?: boolean }
interface LineupSide { formation?: string | null; players?: LineupPlayer[] }

interface Bundle {
  home: string;
  away: string;
  ledger?: LedgerEntry[];
  form?: { home?: Record<string, unknown> | null; away?: Record<string, unknown> | null } | null;
  h2h?: Record<string, unknown> | null;
  lineups?: { status?: string; home?: LineupSide | null; away?: LineupSide | null } | null;
  /** League table rows for the two sides, as the bundle carries them. */
  standings?: { home?: { position?: number } | null; away?: { position?: number } | null; size?: number } | null;
  /** The players the prediction market fancies to score, most fancied first. */
  goalscorers?: Array<{ player?: string; price?: number }> | null;
  /** Managers by name, when the feed has them. */
  managers?: { home?: string | null; away?: string | null } | null;
}

const WORD = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve'];

/** Small numbers read better as words; big ones do not. */
function n(v: number): string {
  const i = Math.round(v);
  return i >= 0 && i < WORD.length ? WORD[i]! : String(i);
}

const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;
const str = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() ? v.trim() : null;

/* ------------------------------------------------------------------- form */

/**
 * "2-1-3" over six games, plus the run and the venue split.
 *
 * Deliberately not points per game. A supporter says "won two of their last
 * six"; nobody has ever said "1.17 points a game" out loud.
 */
function formFacts(ev: Record<string, unknown> | null | undefined, team: string, side: 'home' | 'away'): PubFact[] {
  if (!ev) return [];
  const out: PubFact[] = [];

  const record = str(ev['record']);
  const matches = num(ev['matches']);
  if (record && matches) {
    const [w = 0, d = 0, l = 0] = record.split('-').map((x) => parseInt(x, 10) || 0);
    if (w >= l && w > 0) out.push({ text: `${team} have won ${n(w)} of their last ${n(matches)}`, side, weight: 70 });
    else if (l > w) out.push({ text: `${team} have lost ${n(l)} of their last ${n(matches)}`, side, weight: 75 });
    if (d >= 3) out.push({ text: `${team} have drawn ${n(d)} of their last ${n(matches)}`, side, weight: 45 });
  }

  const streak = str(ev['streak']);
  const seq = str(ev['sequence']) ?? '';
  if (streak && streak !== 'none') {
    // The run length is the tail of the sequence that matches the streak.
    const run = /^(w+|l+|d+)/i.exec([...seq].reverse().join(''))?.[0]?.length ?? 0;
    const word: Record<string, string> = {
      won: 'have won', lost: 'have lost',
      unbeaten: 'are unbeaten in', winless: 'have not won in',
    };
    if (run >= 3 && word[streak]) {
      out.push({
        text: streak === 'won' || streak === 'lost'
          ? `${team} ${word[streak]} ${n(run)} in a row`
          : `${team} ${word[streak]} ${n(run)}`,
        side,
        weight: 85,
      });
    }
  }

  const cs = num(ev['clean_sheets']);
  if (cs !== null && matches && cs >= 3) {
    out.push({ text: `${team} have kept ${n(cs)} clean sheets in ${n(matches)}`, side, weight: 65 });
  }

  // The venue split is the difference between "poor" and "poor away from home",
  // and it is the whole reason form.ts computes it. Stated as a comparison
  // rather than as two figures.
  const ppg = num(ev['ppg']);
  const vppg = num(ev['venue_ppg']);
  if (ppg !== null && vppg !== null && Math.abs(vppg - ppg) >= 0.45) {
    const better = vppg > ppg;
    out.push({
      text: side === 'home'
        ? `${team} are ${better ? 'a different side at home' : 'oddly poor at home'}`
        : `${team} ${better ? 'travel well' : 'travel badly'}`,
      side,
      weight: 60,
    });
  }

  return out;
}

/* ----------------------------------------------------------- availability */

const ROLE: Record<string, string> = { DEF: 'at the back', MID: 'in midfield', ATT: 'up front', GK: 'in goal' };

/** "A, B and C". */
function list(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

function absenceFacts(ev: Record<string, unknown>, team: string, side: 'home' | 'away'): PubFact[] {
  const players = Array.isArray(ev['players']) ? ev['players'] as Record<string, unknown>[] : [];
  const count = num(ev['count']) ?? players.length;
  const out: PubFact[] = [];
  if (!count) return out;

  /*
   * Everyone who is out, by name and by where they play.
   *
   * It used to name one player and then say "missing four players", which is
   * a headcount, not team news. Grouped by line so the sentence says what the
   * absences do to the side: "without Mendy and Bombito at the back, and
   * Abergel in midfield".
   */
  const byLine = new Map<string, string[]>();
  for (const p of players) {
    const name = str(p['player']);
    if (!name) continue;
    const where = ROLE[String(p['role'] ?? '')] ?? '';
    byLine.set(where, [...(byLine.get(where) ?? []), name]);
  }
  const clauses = [...byLine.entries()]
    .sort((a, b) => (a[0] === 'up front' ? -1 : b[0] === 'up front' ? 1 : 0))
    .map(([where, names]) => `${list(names.slice(0, 3))}${where ? ` ${where}` : ''}`);
  if (clauses.length) {
    out.push({ text: `${team} are without ${list(clauses.slice(0, 3))}`, side, weight: 90 });
  }

  // A named player out is worth more than a headcount, so it leads.
  const named = players
    .map((p) => ({ name: str(p['player']), reason: str(p['reason']), share: num(p['goal_share']) ?? 0 }))
    .filter((p) => p.name)
    .sort((a, b) => b.share - a.share);

  const top = named[0];
  if (top) {
    // The feed says "Unknown" when it has no reason, which read as "out with a
    // unknown problem" -- wrong article, and naming a non-reason at all.
    // The feed's reasons arrive as "Hamstring Injury" but also as raw codes
    // ("national_team", "red_card_suspension"); absenceReason turns both into
    // words, and each kind of absence gets the sentence a person would use.
    const why = absenceReason(top.reason);
    const injury = why && !/^(With the national team|Suspended|Ill$|Personal reasons|Paternity leave|Left out|Rested|Not eligible|Doubtful)/.test(why)
      ? why.toLowerCase().replace(/\s*injury$/, '').trim() : null;
    const article = injury && /^[aeiou]/.test(injury) ? 'an' : 'a';
    const text = !why ? `${top.name} is out for ${team}`
      : why === 'With the national team' ? `${top.name} is away with the national team and misses this one for ${team}`
      : why === 'Suspended (red card)' ? `${top.name} is suspended for ${team} after a red card`
      : why === 'Suspended (bookings)' ? `${top.name} is suspended for ${team} after too many bookings`
      : why === 'Suspended' ? `${top.name} is suspended for ${team}`
      : why === 'Ill' ? `${top.name} is out ill for ${team}`
      : injury ? `${top.name} is out for ${team} with ${article} ${injury} problem`
      : `${top.name} is out for ${team} (${why.toLowerCase()})`;
    out.push({
      text,
      side,
      weight: top.share > 0.15 ? 95 : 70,
    });
  }

  if (count >= 4) {
    out.push({ text: `${team} are missing ${n(count)} players in all`, side, weight: 55 });
  }

  const share = num(ev['combined_goal_share']) ?? 0;
  if (share >= 0.2) {
    out.push({ text: `${team} are without a big chunk of their goals`, side, weight: 80 });
  }

  return out;
}

/* ---------------------------------------------------------------- manager */

function managerFacts(id: string, ev: Record<string, unknown>, team: string, side: 'home' | 'away'): PubFact[] {
  const games = num(ev['matches_in_charge']);
  const name = str(ev['manager']);
  const who = name && name !== 'the manager' ? name : 'the new manager';
  if (games === null) return [];

  if (id.includes('.bounce') && games <= 6) {
    return [{ text: `${who} has had ${n(games)} games in charge at ${team}`, side, weight: 80 }];
  }
  if (id.includes('.settling') && games <= 14) {
    return [{ text: `${who} is still settling in at ${team}`, side, weight: 50 }];
  }
  return [];
}

/* ---------------------------------------------------------------- fatigue */

function fatigueFacts(ev: Record<string, unknown>, team: string, side: 'home' | 'away'): PubFact[] {
  const out: PubFact[] = [];
  const rest = num(ev['days_rest']) ?? num(ev['daysRest']);
  const in14 = num(ev['matches_in_14_days']) ?? num(ev['matchesIn14']);

  if (rest !== null && rest <= 3) {
    out.push({ text: `${team} played only ${n(rest)} days ago`, side, weight: 70 });
  }
  if (in14 !== null && in14 >= 4) {
    out.push({ text: `${team} are into their ${n(in14)}th game in a fortnight`, side, weight: 65 });
  }
  return out;
}

/* ------------------------------------------------------------ the fixture */

function stakesFacts(ev: Record<string, unknown>, home: string, away: string): PubFact[] {
  const out: PubFact[] = [];
  const state = (s: unknown): string | null => {
    const v = str((s as Record<string, unknown>)?.['state']);
    return v && v !== 'mid_table' && v !== 'unknown' ? v : null;
  };
  const phrase: Record<string, string> = {
    title_race: 'are in the title race',
    chasing_europe: 'are chasing Europe',
    relegation: 'are fighting relegation',
    fighting_relegation: 'are fighting relegation',
    dead_rubber: 'have nothing left to play for',
    nothing_to_play_for: 'have nothing left to play for',
  };
  for (const [side, team] of [['home', home], ['away', away]] as const) {
    const s = state(ev[side]);
    if (s && phrase[s]) out.push({ text: `${team} ${phrase[s]}`, side, weight: 75 });
  }
  if (ev['six_pointer'] === true) {
    out.push({ text: 'this is a six-pointer', side: 'match', weight: 85 });
  }
  return out;
}

function weatherFacts(ev: Record<string, unknown>): PubFact[] {
  const out: PubFact[] = [];
  const rain = num(ev['rain_mm']);
  const wind = num(ev['wind_kph']);
  const temp = num(ev['temperature_c']);
  if (rain !== null && rain >= 2) out.push({ text: 'rain is forecast', side: 'match', weight: 40 });
  if (wind !== null && wind >= 30) out.push({ text: 'it will be windy', side: 'match', weight: 40 });
  if (temp !== null && temp <= 3) out.push({ text: 'it will be freezing', side: 'match', weight: 35 });
  return out;
}

/**
 * The referee, as a tendency rather than as a rate.
 *
 * "4.89 against a league average of 4.03" is precise and unsayable. A fan says
 * he is card-happy, so that is what comes out.
 */
function refereeFacts(ev: Record<string, unknown>): PubFact[] {
  const ratio = num(ev['yellow_ratio']);
  const games = num(ev['matches']);
  if (ratio === null || games === null || games < 30) return [];
  if (ratio >= 1.2) return [{ text: 'the referee books more players than most', side: 'match', weight: 45 }];
  if (ratio <= 0.8) return [{ text: 'the referee lets a lot go', side: 'match', weight: 40 }];
  return [];
}

function h2hFacts(h2h: Record<string, unknown> | null | undefined, home: string, away: string): PubFact[] {
  if (!h2h) return [];
  const total = num(h2h['total_matches']) ?? 0;
  if (total < 3) return [];
  const hw = num(h2h['home_wins']) ?? 0;
  const aw = num(h2h['away_wins']) ?? 0;
  const out: PubFact[] = [];

  if (hw >= total * 0.6) out.push({ text: `${home} have won ${n(hw)} of the last ${n(total)} meetings`, side: 'home', weight: 60 });
  else if (aw >= total * 0.6) out.push({ text: `${away} have won ${n(aw)} of the last ${n(total)} meetings`, side: 'away', weight: 60 });

  const recent = Array.isArray(h2h['recent_matches']) ? h2h['recent_matches'] as Record<string, unknown>[] : [];
  const last = recent[0];
  const score = last ? str(last['score']) : null;
  if (score) out.push({ text: `the last meeting finished ${score}`, side: 'match', weight: 50 });

  return out;
}

/* ------------------------------------------------------------ the people */

const ORD = (v: number): string => {
  const t = v % 100;
  if (t >= 11 && t <= 13) return `${v}th`;
  return `${v}${({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[v % 10] ?? 'th'}`;
};

/** Where they sit. A league position is a number every supporter says. */
function tableFacts(b: Bundle): PubFact[] {
  const out: PubFact[] = [];
  const size = num(b.standings?.size);
  for (const [side, team] of [['home', b.home], ['away', b.away]] as const) {
    const pos = num(b.standings?.[side]?.position);
    if (!pos) continue;
    const where = size && pos === size ? 'bottom of the table'
      : pos === 1 ? 'top of the table'
      : size && pos > size - 3 ? `${ORD(pos)}, in the bottom three`
      : `${ORD(pos)} in the table`;
    out.push({ text: `${team} are ${where}`, side, weight: pos === 1 || (size && pos > size - 3) ? 78 : 55 });
  }
  return out;
}

/**
 * Who is playing.
 *
 * The forwards and the keeper, named, because those are the players an
 * argument about goals or clean sheets is really about. "Expected to start"
 * when the sheet is predicted rather than confirmed -- the difference matters
 * and a reader should be told which one they are getting.
 */
function lineupFacts(b: Bundle): PubFact[] {
  const out: PubFact[] = [];
  const confirmed = b.lineups?.status === 'confirmed';
  const verb = confirmed ? 'start' : 'are expected to start';
  const verb1 = confirmed ? 'starts' : 'is expected to start';
  for (const [side, team] of [['home', b.home], ['away', b.away]] as const) {
    const s = b.lineups?.[side];
    const xi = (s?.players ?? []).filter((p) => p.starting && p.name);
    if (xi.length < 9) continue;
    const fwd = xi.filter((p) => p.position === 'F').map((p) => p.name!);
    if (fwd.length === 1) out.push({ text: `${fwd[0]} ${verb1} up front for ${team}`, side, weight: 72 });
    else if (fwd.length > 1) out.push({ text: `${list(fwd.slice(0, 3))} ${verb} up front for ${team}`, side, weight: 72 });
    const gk = xi.find((p) => p.position === 'G')?.name;
    if (gk) out.push({ text: `${gk} ${verb1} in goal for ${team}`, side, weight: 40 });
    const shape = str(s?.formation);
    if (shape && /^\d(-\d){2,4}$/.test(shape)) out.push({ text: `${team} line up ${shape}`, side, weight: 35 });
  }
  return out;
}

/**
 * Who is likeliest to score, as a name and never as the price.
 *
 * The prediction market's goalscorer book is the best single read of who the
 * dangerous players are this weekend, and it is the sort of thing a pundit
 * knows without looking up. The number behind it is ours to keep.
 */
function scorerFacts(b: Bundle): PubFact[] {
  const list0 = (b.goalscorers ?? [])
    .filter((g) => str(g.player) && num(g.price) !== null)
    .sort((a, c) => (c.price ?? 0) - (a.price ?? 0));
  if (!list0.length) return [];
  // Attribute a scorer to a side through the team sheets where possible.
  const sideOf = (name: string): 'home' | 'away' | null => {
    for (const side of ['home', 'away'] as const) {
      if ((b.lineups?.[side]?.players ?? []).some((p) => p.name === name)) return side;
    }
    return null;
  };
  const out: PubFact[] = [];
  const top = list0.slice(0, 2).map((g) => g.player!);
  const who = top.map((name) => {
    const side = sideOf(name);
    return side ? `${name} for ${side === 'home' ? b.home : b.away}` : name;
  });
  out.push({ text: `the players most fancied to score are ${list(who)}`, side: 'match', weight: 76 });
  return out;
}

function managerNameFacts(b: Bundle): PubFact[] {
  const out: PubFact[] = [];
  for (const [side, team] of [['home', b.home], ['away', b.away]] as const) {
    const name = str(b.managers?.[side]);
    if (name && name !== 'the manager') out.push({ text: `${name} manages ${team}`, side, weight: 30 });
  }
  return out;
}

/* ------------------------------------------------------------------ entry */

/**
 * Everything worth saying about a fixture, in descending order of interest.
 *
 * Only COMPUTED factors are read: THIN and UNAVAILABLE ones are the engine
 * recording that it looked and found nothing, which is a note to us and not a
 * fact about the football.
 */
export function pubFacts(bundle: Bundle): PubFact[] {
  const { home, away } = bundle;
  const out: PubFact[] = [];

  out.push(...formFacts(bundle.form?.home, home, 'home'));
  out.push(...formFacts(bundle.form?.away, away, 'away'));

  for (const entry of bundle.ledger ?? []) {
    if (entry.state !== 'COMPUTED') continue;
    const ev = entry.evidence ?? {};
    const id = entry.id;
    const side: 'home' | 'away' = id.includes('.away') ? 'away' : 'home';
    const team = side === 'home' ? home : away;

    if (id.endsWith('.absences')) out.push(...absenceFacts(ev, team, side));
    else if (id.startsWith('manager.')) out.push(...managerFacts(id, ev, team, side));
    else if (id.startsWith('fatigue.') && !id.includes('travel')) out.push(...fatigueFacts(ev, team, side));
    else if (id === 'stakes.season') out.push(...stakesFacts(ev, home, away));
    else if (id === 'environment.weather') out.push(...weatherFacts(ev));
    else if (id === 'referee.tendency') out.push(...refereeFacts(ev));
    else if (id === 'fixture.derby' && ev['derby'] === true) {
      out.push({ text: 'this is a local derby', side: 'match', weight: 80 });
    }
  }

  out.push(...h2hFacts(bundle.h2h, home, away));
  out.push(...tableFacts(bundle));
  out.push(...lineupFacts(bundle));
  out.push(...scorerFacts(bundle));
  out.push(...managerNameFacts(bundle));

  if (bundle.lineups?.status === 'confirmed') {
    out.push({ text: 'the team sheets are confirmed', side: 'match', weight: 20 });
  }

  // Deduplicate, keeping the highest-weighted phrasing of anything repeated.
  const seen = new Map<string, PubFact>();
  for (const f of out.sort((a, b) => b.weight - a.weight)) {
    if (!seen.has(f.text)) seen.set(f.text, f);
  }
  return [...seen.values()];
}
