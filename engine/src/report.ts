import { bsdOrNull, num, str } from './bsd.ts';
import { exec, select } from './store.ts';

/**
 * The match report: what happened, once it has.
 *
 * Who scored and when, from whose pass, who was booked and why, who came on
 * for whom, how each player was rated, and the team numbers a fan looks at
 * after the whistle. All of it is on the provider after full time, spread
 * over four feeds, and none of it reached a page: the fixture's write-up is
 * frozen at kick-off, so anything that happens during the match has to live
 * in its own column. This module reads the four feeds into one compact
 * record, `fixture.report_json`, written once per finished match.
 *
 * Shapes are from the probe (`npm run probe:report`, September 2026):
 *
 *   incidents: { type: 'goal', minute, added_time, is_home, player, player_id,
 *                assist, goal_type, home_score, away_score }
 *              { type: 'card', minute, added_time, is_home, player, player_id,
 *                card_type: 'yellow' | 'yellowRed' | 'red', reason }
 *              { type: 'substitution', minute, added_time, is_home,
 *                player_in, player_in_id, player_out, player_out_id }
 *              { type: 'period', text: 'HT' | 'FT', minute, home_score, away_score }
 *   player-stats: rows of { player_id, team_id, minutes_played, rating, goals,
 *                goal_assist, yellow_card, red_card, saves, total_shots,
 *                shots_on_target, key_pass, ... }
 *   stats: { home: { ball_possession, total_shots, shots_on_target,
 *                corner_kicks, fouls, yellow_cards, red_cards, big_chances,
 *                passes, pass_accuracy_pct, offsides, goalkeeper_saves, ... },
 *            away: { ... } }
 *   lineups: { lineups: { home: { formation, players[], substitutes[] } } }
 *
 * Everything is read defensively and an absent field is absent in the
 * record, never guessed.
 */

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

/** Read the four feeds for one finished match. Null when none answered. */
export async function fetchReport(fixtureId: number, now = Math.floor(Date.now() / 1000)): Promise<MatchReport | null> {
  const [event, incidents, playerStats, stats, lineups] = await Promise.all([
    bsdOrNull<Record<string, unknown>>(`/api/v2/events/${fixtureId}/`),
    bsdOrNull(`/api/v2/events/${fixtureId}/incidents/`),
    bsdOrNull(`/api/v2/events/${fixtureId}/player-stats/`),
    bsdOrNull(`/api/v2/events/${fixtureId}/stats/`),
    bsdOrNull(`/api/v2/events/${fixtureId}/lineups/`),
  ]);
  if (!event && !incidents && !playerStats && !stats) return null;

  const inc = parseIncidents(incidents);
  const hth = num(event?.['home_score_ht']);
  const ath = num(event?.['away_score_ht']);
  const highlights = (arr(event?.['highlights']) ?? []).flatMap((h) => {
    const r = rec(h);
    const url = str(r?.['url']);
    return r && url ? [{ kind: s(r['kind']), title: s(r['title']), url, thumbnail: s(r['thumbnail']) }] : [];
  });

  return {
    fetched_at: now,
    ht: inc.ht ?? (hth !== undefined && ath !== undefined ? [hth, ath] : null),
    attendance: n(event?.['attendance']),
    highlights,
    events: inc.events,
    players: parsePlayerStats(playerStats),
    stats: parseTeamStats(stats),
    lineups: parseReportLineups(lineups),
  };
}

/**
 * Write reports for the finished fixtures that have none.
 *
 * `ids` narrows it to fixtures a caller already knows are over (the slate's
 * window); without it the recent past is swept, which is how the settle pass
 * catches anything the slate did not see finish. Bounded per call so one run
 * cannot spend its whole budget on the provider.
 */
export async function writeMissingReports(opts: { ids?: number[]; sinceDays?: number; limit?: number } = {}): Promise<number> {
  const limit = opts.limit ?? 40;
  const now = Math.floor(Date.now() / 1000);
  let rows: Array<{ id: number }>;
  if (opts.ids) {
    if (!opts.ids.length) return 0;
    rows = await select<{ id: number }>(
      `SELECT id FROM fixture WHERE report_json IS NULL AND home_goals IS NOT NULL
         AND id IN (${opts.ids.map(() => '?').join(',')}) LIMIT ?`,
      [...opts.ids, limit],
    );
  } else {
    rows = await select<{ id: number }>(
      `SELECT id FROM fixture WHERE report_json IS NULL AND home_goals IS NOT NULL
         AND kickoff > ? ORDER BY kickoff DESC LIMIT ?`,
      [now - (opts.sinceDays ?? 7) * 86400, limit],
    );
  }
  let written = 0;
  for (const r of rows) {
    const id = Number(r.id);
    const report = await fetchReport(id, now);
    // A match with nothing on any feed gets an empty record rather than
    // being asked for again every run; the feeds are re-read only if the
    // record is cleared by hand.
    await exec('UPDATE fixture SET report_json = ? WHERE id = ?', [
      JSON.stringify(report ?? { fetched_at: now, ht: null, attendance: null, highlights: [], events: [], players: [], stats: null, lineups: null }),
      id,
    ]);
    if (report) written++;
  }
  return written;
}
