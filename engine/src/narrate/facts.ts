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
  /** Profiles of the absentees and the danger men (players.ts, forBundle). */
  players?: BundlePlayer[] | null;
}

/** What `forBundle` stores. Everything optional: older bundles have none of it. */
export interface BundlePlayer {
  id?: number;
  name?: string;
  side?: 'home' | 'away';
  team?: string;
  club?: string | null;
  role?: string;
  status?: 'out' | 'doubtful' | 'fit';
  reason?: string | null;
  expected_return?: string | null;
  season?: {
    apps?: number; starts?: number; goals?: number; assists?: number; clean_sheets?: number;
    team_games?: number; tracked_apps?: number; tracked_starts?: number;
  } | null;
  recent?: { apps?: number; goals?: number; assists?: number; scoredIn?: number } | null;
  standout?: { opponent?: string | null; kickoff?: number; goals?: number; assists?: number; score?: string | null; won?: boolean | null } | null;
  strengths?: string[];
  tags?: string[];
  importance?: number;
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
    .map((p) => ({ name: str(p['player']), reason: str(p['reason']), share: num(p['importance']) ?? num(p['goal_share']) ?? 0 }))
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
  if (share >= 0.25) {
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

  // A count of games in charge is only news while it is tiny; after that the
  // point is simply that the manager is new, and it is not a lead.
  if (id.includes('.bounce') && games <= 3) {
    return [{ text: games <= 1 ? `${who} has only just taken over at ${team}` : `${who} took over at ${team} only ${n(games)} games ago`, side, weight: 62 }];
  }
  if ((id.includes('.bounce') || id.includes('.settling')) && games <= 14) {
    return [{ text: `${who} is still settling in at ${team}`, side, weight: 45 }];
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


/* ---------------------------------------------------------------- players */

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
  'September', 'October', 'November', 'December'];

/** "14 September": a date as a supporter says it. */
function day(epoch: number): string {
  const d = new Date(epoch * 1000);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

function goalsWord(g: number): string {
  return g === 1 ? 'one goal' : `${n(g)} goals`;
}

function assistsWord(a: number): string {
  return a === 1 ? 'one assist' : `${n(a)} assists`;
}

/** "scored twice", "scored and set up another", "set up two". */
function didWhat(goals: number, assists: number): string | null {
  const g = goals === 1 ? 'scored' : goals === 2 ? 'scored twice' : goals === 3 ? 'scored a hat-trick' : goals > 3 ? `scored ${n(goals)}` : '';
  const a = assists === 0 ? '' : goals > 0
    ? (assists === 1 ? 'set up another' : `set up ${n(assists)} more`)
    : (assists === 1 ? 'set up a goal' : `set up ${n(assists)}`);
  if (!g && !a) return null;
  return g && a ? `${g} and ${a}` : g || a;
}

/**
 * Who the players are, not just who is missing.
 *
 * The analysis used to know two things about an absentee: the name, and the
 * reason. So "Saka is out" arrived with nothing about why that matters. These
 * lines say it the way a pundit would: what the player has done this season,
 * where that stands at the club, a game that shows it, how the player is
 * going, when they are back. Every number is a count, a scoreline or a date.
 *
 * The fit danger men get the same treatment, so the preview can say who
 * carries the threat as well as who is missing.
 */
export function playerFacts(b: Bundle): PubFact[] {
  const out: PubFact[] = [];
  const players = (b.players ?? []).filter((p) => str(p.name) && (p.side === 'home' || p.side === 'away'));
  const bySide = (side: 'home' | 'away', fit: boolean) => players
    .filter((p) => p.side === side && (p.status === 'fit') === fit)
    .sort((x, y) => (y.importance ?? 0) - (x.importance ?? 0));

  for (const side of ['home', 'away'] as const) {
    const team = side === 'home' ? b.home : b.away;
    // A return date that half the list shares is the feed's placeholder for
    // "not in the squad", not a date anyone gave. Said once it misleads.
    const dates = new Map<string, number>();
    for (const p of bySide(side, false)) {
      const d = str(p.expected_return);
      if (d) dates.set(d, (dates.get(d) ?? 0) + 1);
    }
    const shared = new Set([...dates].filter(([, k]) => k >= 3).map(([d]) => d));
    // The three absentees who matter most, and the threats still standing:
    // the one who matters most, and a second only if the season says so.
    const fit = bySide(side, true);
    const threats = fit.slice(0, 1).concat(fit.slice(1, 2).filter((p) => (num(p.season?.goals) ?? 0) >= 3));
    for (const p of [...bySide(side, false).slice(0, 3), ...threats]) {
      out.push(...onePlayer(shared.has(str(p.expected_return) ?? '') ? { ...p, expected_return: null } : p, team, side));
    }
  }
  return out;
}

function onePlayer(p: BundlePlayer, team: string, side: 'home' | 'away'): PubFact[] {
  const out: PubFact[] = [];
  const name = str(p.name)!;
  const absent = p.status !== 'fit';
  const tags = new Set(p.tags ?? []);
  const imp = num(p.importance) ?? 0;
  const s = p.season ?? null;
  const g = num(s?.goals) ?? 0;
  const a = num(s?.assists) ?? 0;
  const apps = num(s?.apps) ?? 0;
  const club = str(p.club);
  // "for Arsenal" when the numbers were earned somewhere other than this side.
  const at = club ? ` for ${club}` : '';
  // How much a line about this player is worth leading on: an absentee who
  // matters outranks almost anything; one who does not is background.
  const lead = absent ? 70 + Math.round(Math.min(imp, 0.5) * 56) : 64 + Math.round(Math.min(imp, 0.5) * 24);

  // 1. What the player has done this season, and where that stands.
  if (s && apps >= 3) {
    const games = num(s.team_games) ?? 0;
    const started = num(s.tracked_starts) ?? 0;
    if (p.role === 'GK') {
      const cs = num(s.clean_sheets) ?? 0;
      if (tags.has('first_choice_keeper')) {
        out.push({
          text: cs >= 2
            ? `${name} has been first choice in goal${club ? ` at ${club}` : ` for ${team}`}, with ${n(cs)} clean sheets this season`
            : `${name} has been first choice in goal${club ? ` at ${club}` : ` for ${team}`} this season`,
          side, weight: lead,
        });
      }
    } else if (g + a > 0 && (p.role !== 'DEF' || g + a >= 2)) {
      const what = g && a ? `${goalsWord(g)} and ${assistsWord(a)}` : g ? goalsWord(g) : assistsWord(a);
      // The rank comes from the side's own chart, so it is said as the chart
      // says it, not as "more than anyone", which the season total may not be.
      const rank = !club && tags.has('top_scorer') ? ` and is ${team}'s top scorer`
        : !club && tags.has('top_creator') ? ` and has set up more than anyone at ${team}`
        : '';
      out.push({ text: `${name} has ${what}${at} this season${rank}`, side, weight: lead + (rank ? 4 : 0) });
    }
    if (p.role !== 'GK' && games >= 5 && (tags.has('ever_present') || tags.has('defensive_rock'))) {
      out.push({
        text: started >= games
          ? `${name} has started every one of ${club ?? team}'s ${n(games)} games this season`
          : `${name} has started ${n(started)} of ${club ?? team}'s ${n(games)} games this season`,
        side, weight: lead - 6,
      });
    }
  }

  // 2. What losing the player does, said as football rather than as a figure.
  if (absent && imp >= (club ? 0.18 : 0.12)) {
    const role = p.role;
    const line = role === 'GK' ? `${team} have to change their keeper`
      : role === 'DEF' ? `${team} lose a regular from the back line`
      : tags.has('top_creator') || tags.has('chance_creator') ? `${team} lose the player who makes their chances`
      : role === 'ATT' || tags.has('top_scorer') ? `a big part of ${team}'s goals goes missing with ${name}`
      : `${team} lose one of their most important players in ${name}`;
    out.push({ text: line, side, weight: lead + 2 });
  }

  // 3. One game that shows it.
  const so = p.standout;
  const opp = str(so?.opponent);
  const did = so ? didWhat(num(so.goals) ?? 0, num(so.assists) ?? 0) : null;
  if (so && opp && did && num(so.kickoff)) {
    const score = str(so.score);
    const res = score ? (so.won === true ? `the ${score} win over ${opp}`
      : so.won === false && score.split('-')[0] !== score.split('-')[1] ? `the ${score} defeat to ${opp}`
      : `the ${score} draw with ${opp}`) : `the game against ${opp}`;
    out.push({ text: `${name} ${did} in ${res} on ${day(so.kickoff!)}`, side, weight: lead - 10 });
  }

  // 4. How the player is going.
  const r = p.recent;
  const scoredIn = num(r?.scoredIn) ?? 0;
  const rg = num(r?.goals) ?? 0;
  if (scoredIn >= 3) {
    out.push({ text: `${name} ${absent ? 'had' : 'has'} scored in each of the last ${n(scoredIn)} games`, side, weight: lead - 2 });
  } else if (rg >= 3 && (num(r?.apps) ?? 0) >= 4) {
    out.push({ text: `${name} ${absent ? 'had' : 'has'} ${n(rg)} goals in the last ${n(num(r?.apps) ?? 5)} games`, side, weight: lead - 4 });
  }

  // 5. When the player is back, and whether it is really an absence at all.
  if (p.status === 'doubtful') {
    out.push({ text: `${name} is a doubt for ${team}`, side, weight: Math.max(lead, 72) });
  }
  const back = str(p.expected_return);
  const t = back ? Date.parse(back) : NaN;
  if (absent && Number.isFinite(t) && t > Date.now() + 86400_000 && t < Date.now() + 200 * 86400_000) {
    out.push({ text: `${name} is not expected back until ${day(Math.floor(t / 1000))}`, side, weight: lead - 14 });
  }

  // 6. What kind of player, when the feed knows.
  const strengths = (p.strengths ?? []).map((x) => String(x).toLowerCase().trim()).filter((x) => /^[a-z ]{3,30}$/.test(x));
  if (strengths.length && imp >= 0.1) {
    out.push({ text: `${name} is known for ${list(strengths.slice(0, 2))}`, side, weight: 38 });
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
  out.push(...playerFacts(bundle));
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
