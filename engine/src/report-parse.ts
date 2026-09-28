/**
 * The pure half of the match report: provider payloads in, report records
 * out. No network and no store, so the Worker's live layer (worker/src/live.ts)
 * parses a match in play with exactly the code that writes the full-time
 * report, and the two can never disagree about what a goal looks like.
 */

export function num(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const x = Number(v);
    if (Number.isFinite(x)) return x;
  }
  return undefined;
}

export function str(v: unknown): string | undefined {
  return typeof v === 'string' && v !== '' ? v : undefined;
}

export type Side = 'home' | 'away';

export interface GoalEvent {
  t: 'goal';
  minute: number | null;
  added: number | null;
  side: Side | null;
  player: string | null;
  player_id: number | null;
  assist: string | null;
  /** regular, penalty, own goal, and whatever else the feed says. */
  kind: string | null;
  score: [number, number] | null;
}
export interface CardEvent {
  t: 'card';
  minute: number | null;
  added: number | null;
  side: Side | null;
  player: string | null;
  player_id: number | null;
  card: 'yellow' | 'second_yellow' | 'red';
  reason: string | null;
}
export interface SubEvent {
  t: 'sub';
  minute: number | null;
  added: number | null;
  side: Side | null;
  in: string | null;
  in_id: number | null;
  out: string | null;
  out_id: number | null;
}
export type ReportEvent = GoalEvent | CardEvent | SubEvent;

export interface PlayerLine {
  id: number;
  team_id: number | null;
  minutes: number | null;
  rating: number | null;
  goals: number;
  assists: number;
  yellow: number;
  red: number;
  saves: number | null;
  shots: number | null;
  on_target: number | null;
  key_passes: number | null;
}

export interface TeamNumbers {
  possession: number | null;
  shots: number | null;
  on_target: number | null;
  corners: number | null;
  fouls: number | null;
  yellow: number | null;
  red: number | null;
  big_chances: number | null;
  passes: number | null;
  pass_pct: number | null;
  offsides: number | null;
  saves: number | null;
}

export interface ReportPlayer {
  id: number;
  name: string;
  position: string | null;
  number: number | null;
  captain: boolean;
  starting: boolean;
}

export interface MatchReport {
  fetched_at: number;
  ht: [number, number] | null;
  attendance: number | null;
  highlights: Array<{ kind: string | null; title: string | null; url: string; thumbnail: string | null }>;
  events: ReportEvent[];
  players: PlayerLine[];
  stats: { home: TeamNumbers; away: TeamNumbers } | null;
  lineups: {
    home: { formation: string | null; players: ReportPlayer[] } | null;
    away: { formation: string | null; players: ReportPlayer[] } | null;
  } | null;
}

const rec = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const arr = (v: unknown): unknown[] | null => (Array.isArray(v) ? v : null);
const sideOf = (v: unknown): Side | null => (v === true ? 'home' : v === false ? 'away' : null);
const n = (v: unknown): number | null => num(v) ?? null;
const s = (v: unknown): string | null => str(v) ?? null;

/** The incidents feed, as the timeline a page draws. */
export function parseIncidents(payload: unknown): { events: ReportEvent[]; ht: [number, number] | null } {
  const root = rec(payload);
  const list = arr(root?.['incidents']) ?? arr(root?.['results']) ?? arr(payload) ?? [];
  const events: ReportEvent[] = [];
  let ht: [number, number] | null = null;
  for (const raw of list) {
    const r = rec(raw);
    if (!r) continue;
    const type = String(r['type'] ?? r['incident_type'] ?? '').toLowerCase();
    const minute = n(r['minute']);
    const added = n(r['added_time']);
    const side = sideOf(r['is_home']);
    if (type === 'goal') {
      const hs = n(r['home_score']);
      const as = n(r['away_score']);
      events.push({
        t: 'goal', minute, added, side,
        player: s(r['player']), player_id: n(r['player_id']), assist: s(r['assist']),
        kind: s(r['goal_type']),
        score: hs !== null && as !== null ? [hs, as] : null,
      });
    } else if (type === 'card') {
      const ct = String(r['card_type'] ?? r['card'] ?? '').toLowerCase();
      events.push({
        t: 'card', minute, added, side,
        player: s(r['player']), player_id: n(r['player_id']),
        card: /yellowred|second/.test(ct) ? 'second_yellow' : /red/.test(ct) ? 'red' : 'yellow',
        reason: s(r['reason']),
      });
    } else if (type === 'substitution') {
      events.push({
        t: 'sub', minute, added, side,
        in: s(r['player_in']), in_id: n(r['player_in_id']),
        out: s(r['player_out']), out_id: n(r['player_out_id']),
      });
    } else if (type === 'period') {
      const text = String(r['text'] ?? '').toUpperCase();
      const hs = n(r['home_score']);
      const as = n(r['away_score']);
      if (text === 'HT' && hs !== null && as !== null) ht = [hs, as];
    }
  }
  events.sort((a, b) => (a.minute ?? 0) - (b.minute ?? 0) || (a.added ?? 0) - (b.added ?? 0));
  // A goal's side is the side whose score went up, which for an own goal is
  // not the scorer's team. The running score on each goal says which; the
  // is_home flag is only trusted where the feed carries no score.
  let prev: [number, number] = [0, 0];
  for (const e of events) {
    if (e.t !== 'goal' || !e.score) continue;
    if (e.score[0] > prev[0]) e.side = 'home';
    else if (e.score[1] > prev[1]) e.side = 'away';
    prev = e.score;
  }
  return { events, ht };
}

/** One line per player from the per-player stats feed. */
export function parsePlayerStats(payload: unknown): PlayerLine[] {
  const root = rec(payload);
  const list = arr(root?.['player_stats']) ?? arr(root?.['results']) ?? arr(payload) ?? [];
  const out: PlayerLine[] = [];
  for (const raw of list) {
    const r = rec(raw);
    const id = num(r?.['player_id'] ?? r?.['id']);
    if (!r || id === undefined) continue;
    out.push({
      id,
      team_id: n(r['team_id']),
      minutes: n(r['minutes_played']),
      rating: n(r['rating']),
      goals: num(r['goals']) ?? 0,
      assists: num(r['goal_assist'] ?? r['assists']) ?? 0,
      yellow: num(r['yellow_card']) ?? 0,
      red: num(r['red_card']) ?? 0,
      saves: n(r['saves']),
      shots: n(r['total_shots']),
      on_target: n(r['shots_on_target']),
      key_passes: n(r['key_pass']),
    });
  }
  return out;
}

function teamNumbers(raw: unknown): TeamNumbers | null {
  const r = rec(raw);
  if (!r) return null;
  return {
    possession: n(r['ball_possession']),
    shots: n(r['total_shots']),
    on_target: n(r['shots_on_target']),
    corners: n(r['corner_kicks']),
    fouls: n(r['fouls']),
    yellow: n(r['yellow_cards']),
    red: n(r['red_cards']),
    big_chances: n(r['big_chances']),
    passes: n(r['passes']),
    pass_pct: n(r['pass_accuracy_pct']),
    offsides: n(r['offsides']),
    saves: n(r['goalkeeper_saves']),
  };
}

/** The team totals a fan looks at after the whistle. */
export function parseTeamStats(payload: unknown): { home: TeamNumbers; away: TeamNumbers } | null {
  const root = rec(payload);
  const st = rec(root?.['stats']) ?? root;
  const home = teamNumbers(st?.['home']);
  const away = teamNumbers(st?.['away']);
  return home && away ? { home, away } : null;
}

function reportSide(raw: unknown): { formation: string | null; players: ReportPlayer[] } | null {
  const r = rec(raw);
  if (!r) return null;
  const read = (list: unknown[] | null, starting: boolean): ReportPlayer[] =>
    (list ?? []).flatMap((p) => {
      const pr = rec(p);
      const id = num(pr?.['id'] ?? pr?.['player_id']);
      if (!pr || id === undefined) return [];
      return [{
        id,
        name: str(pr['name'] ?? pr['short_name']) ?? `#${id}`,
        position: s(pr['position']),
        number: n(pr['jersey_number'] ?? pr['number']),
        captain: pr['captain'] === true,
        starting,
      }];
    });
  const players = [...read(arr(r['players']), true), ...read(arr(r['substitutes']), false)];
  return players.length ? { formation: s(r['formation']), players } : null;
}

/** The confirmed team sheets, starters then the bench. */
export function parseReportLineups(payload: unknown): MatchReport['lineups'] {
  const root = rec(payload);
  const l = rec(root?.['lineups']);
  const home = reportSide(l?.['home']);
  const away = reportSide(l?.['away']);
  return home || away ? { home, away } : null;
}

