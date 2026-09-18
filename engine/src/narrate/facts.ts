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

interface Bundle {
  home: string;
  away: string;
  ledger?: LedgerEntry[];
  form?: { home?: Record<string, unknown> | null; away?: Record<string, unknown> | null } | null;
  h2h?: Record<string, unknown> | null;
  lineups?: { status?: string } | null;
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

function absenceFacts(ev: Record<string, unknown>, team: string, side: 'home' | 'away'): PubFact[] {
  const players = Array.isArray(ev['players']) ? ev['players'] as Record<string, unknown>[] : [];
  const count = num(ev['count']) ?? players.length;
  const out: PubFact[] = [];
  if (!count) return out;

  // A named player out is worth more than a headcount, so it leads.
  const named = players
    .map((p) => ({ name: str(p['player']), reason: str(p['reason']), share: num(p['goal_share']) ?? 0 }))
    .filter((p) => p.name)
    .sort((a, b) => b.share - a.share);

  const top = named[0];
  if (top) {
    // The feed says "Unknown" when it has no reason, which read as "out with a
    // unknown problem" -- wrong article, and naming a non-reason at all.
    const raw = top.reason?.toLowerCase().replace(/\s*injury$/, '').trim();
    const reason = raw && !/^(unknown|other|undisclosed|n\/a)$/.test(raw) ? raw : null;
    const article = reason && /^[aeiou]/.test(reason) ? 'an' : 'a';
    out.push({
      text: reason
        ? `${top.name} is out for ${team} with ${article} ${reason} problem`
        : `${top.name} is out for ${team}`,
      side,
      weight: top.share > 0.15 ? 95 : 70,
    });
  }

  if (count >= 3) {
    out.push({ text: `${team} are missing ${n(count)} players`, side, weight: 60 });
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
