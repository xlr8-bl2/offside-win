/**
 * What a supporter knows about a match that is not about the price.
 *
 * Who is refereeing and whether they reach for a card. How each manager has
 * done against this opponent over their whole career, not just at this club.
 * Which of these players are in the league's team of the season so far. Who
 * cost big money in the last window, and who scores for their country. None of
 * it moves a price much; all of it is what gets said in the pub before the
 * game, and a sports site without it reads like a betting feed.
 *
 * Everything here is slow-moving, so everything is cached in kv: a player's
 * caps and transfers for a week, a manager's record for three days, a league's
 * team of the season for a day. The first pass over a new board asks the
 * provider a few thousand questions; every pass after it asks almost none.
 *
 * The parsers are pure and tested (engine/test/extras.test.ts). The numbers
 * they keep are counts, never rates: "won three of eleven against City", not
 * a percentage.
 */

import { bsdList, bsdOrNull } from '../bsd.ts';
import { kvGetJSON, kvSetJSON } from '../store.ts';

const rec = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const arr = (v: unknown): unknown[] | null => (Array.isArray(v) ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const epoch = (v: unknown): number | null => {
  const t = typeof v === 'string' ? Date.parse(v) : NaN;
  return Number.isFinite(t) ? Math.floor(t / 1000) : null;
};

const DAY = 86400;

/* ---------------------------------------------------------------- types */

export interface Record3 { w: number; d: number; l: number }

export interface ManagerLine {
  id: number;
  name: string | null;
  /** Against this opponent, in every job the manager has had. */
  vs: (Record3 & { last: { kickoff: number; score: string; result: 'W' | 'D' | 'L' } | null }) | null;
}

export interface PlayerExtra {
  /** For their country, as the provider counts them (a floor, not the federation's number). */
  caps: number | null;
  goals: number | null;
  country: string | null;
  /** The move that brought them to this club, when it was recent and cost money. */
  signed: { from: string; fee: number; at: number } | null;
}

export interface BestXiRow {
  id: number;
  name: string;
  team_id: number;
  position: 'G' | 'D' | 'M' | 'F';
  matches: number;
  goals: number;
  assists: number;
}

export interface RefereeLine {
  name: string;
  matches: number;
  /** Counted over `matches`, and what this league would usually show over as many. */
  yellows: number;
  usual: number;
  reds: number;
}

export interface Extras {
  /** The two sides' team ids, so a player row can be put on the right side. */
  teams: { home: number; away: number };
  referee: RefereeLine | null;
  managers: { home: ManagerLine | null; away: ManagerLine | null };
  /** This league's team of the season so far, the members from these two sides. */
  best_xi: BestXiRow[];
  /** Keyed by player id. */
  players: Record<string, PlayerExtra>;
}

/* -------------------------------------------------------------- parsers */

/** A compact finished match, as kept in the manager cache. */
export type MiniMatch = [kickoff: number, homeId: number, awayId: number, homeGoals: number, awayGoals: number];

export function miniMatches(raw: unknown[]): MiniMatch[] {
  const out: MiniMatch[] = [];
  for (const x of raw) {
    const r = rec(x);
    const k = epoch(r?.['event_date']);
    const h = num(r?.['home_team_id']), a = num(r?.['away_team_id']);
    const hg = num(r?.['home_score']), ag = num(r?.['away_score']);
    if (!r || k === null || h === null || a === null || hg === null || ag === null) continue;
    if (!/finish|ended|^ft$|after/i.test(String(r['status'] ?? 'finished'))) continue;
    out.push([k, h, a, hg, ag]);
  }
  return out.sort((x, y) => y[0] - x[0]);
}

/**
 * A manager's record against one opponent, from their side of each game.
 * The manager's side is whichever team in the match was not the opponent.
 */
export function recordVs(matches: MiniMatch[], opponentId: number, before: number): ManagerLine['vs'] {
  let w = 0, d = 0, l = 0;
  let last: NonNullable<ManagerLine['vs']>['last'] = null;
  for (const [k, h, a, hg, ag] of matches) {
    if (k >= before || (h !== opponentId && a !== opponentId) || h === a) continue;
    const mine = a === opponentId ? hg : ag;
    const theirs = a === opponentId ? ag : hg;
    const result = mine > theirs ? 'W' : mine < theirs ? 'L' : 'D';
    if (result === 'W') w++; else if (result === 'L') l++; else d++;
    // Newest first, so the first one seen is the last meeting.
    last ??= { kickoff: k, score: `${mine}-${theirs}`, result };
  }
  return w + d + l ? { w, d, l, last } : null;
}

/**
 * The move that brought a player to this club: the newest transfer into it,
 * when it happened in the last fifteen months and a fee was published. A
 * free, a loan or an undisclosed fee carries no figure, and is not a story
 * told with a number.
 */
export function recentSigning(raw: unknown, teamId: number, now: number): PlayerExtra['signed'] {
  const list = arr(rec(raw)?.['transfers']) ?? arr(raw) ?? [];
  const moves = list
    .map((x) => rec(x))
    .filter((r): r is Record<string, unknown> => !!r)
    .map((r) => ({ at: epoch(r['transfer_date']), to: num(r['to_team_id']), from: str(r['from_team_name']), fee: num(r['fee_eur']) }))
    .filter((m) => m.at !== null)
    .sort((a, b) => b.at! - a.at!);
  const into = moves.find((m) => m.to === teamId);
  if (!into || into.at! > now || now - into.at! > 460 * DAY || !into.from || !into.fee || into.fee < 1_000_000) return null;
  return { from: into.from, fee: into.fee, at: into.at! };
}

export function nationalTeam(raw: unknown): { caps: number | null; goals: number | null; team_id: number | null } | null {
  const r = rec(raw);
  if (!r) return null;
  const caps = num(r['caps']), goals = num(r['goals']);
  if (!caps && !goals) return null;
  return { caps, goals, team_id: num(r['national_team_id']) };
}

export function parseBestXi(raw: unknown, teamIds: number[]): BestXiRow[] {
  const lineup = rec(rec(raw)?.['lineup']);
  if (!lineup) return [];
  const out: BestXiRow[] = [];
  for (const pos of ['G', 'D', 'M', 'F'] as const) {
    for (const x of arr(lineup[pos]) ?? []) {
      const r = rec(x);
      const id = num(r?.['player_id']), team = num(r?.['team_id']), name = str(r?.['player_name']);
      if (!r || id === null || team === null || !name || !teamIds.includes(team)) continue;
      out.push({ id, name, team_id: team, position: pos, matches: num(r['matches']) ?? 0, goals: num(r['goals']) ?? 0, assists: num(r['assists']) ?? 0 });
    }
  }
  return out;
}

/* ------------------------------------------------------------- fetching */

/**
 * A value from kv, or built and kept for `ttl` seconds. A failed build keeps
 * a null for a tenth of the time, so a provider hiccup is retried soon
 * rather than remembered for a week.
 */
async function cached<T>(key: string, ttl: number, build: () => Promise<T | null>): Promise<T | null> {
  const hit = await kvGetJSON<{ v: T | null }>(key);
  if (hit) return hit.v;
  let v: T | null = null;
  try { v = await build(); } catch { v = null; }
  await kvSetJSON(key, { v }, v === null ? Math.ceil(ttl / 10) : ttl);
  return v;
}

const managerHistory = (id: number) => cached<MiniMatch[]>(`x:mgr:${id}`, 3 * DAY, async () =>
  miniMatches(await bsdList<Record<string, unknown>>(`/api/v2/managers/${id}/matches/`, { status: 'finished' }, { limit: 200, max: 600 })));

const teamName = (id: number) => cached<string>(`x:team:${id}`, 60 * DAY, async () => {
  const r = rec(await bsdOrNull(`/api/v2/teams/${id}/`));
  return str(r?.['name']) ?? str(r?.['short_name']);
});

const playerExtra = (id: number, teamId: number, now: number) => cached<PlayerExtra>(`x:pl:${id}:${teamId}`, 7 * DAY, async () => {
  const [nt, tr] = await Promise.all([
    bsdOrNull(`/api/v2/players/${id}/national-team/`),
    bsdOrNull(`/api/v2/players/${id}/transfers/`),
  ]);
  const n = nationalTeam(nt);
  const country = n?.team_id ? await teamName(n.team_id) : null;
  const signed = recentSigning(tr, teamId, now);
  if (!n && !signed) return { caps: null, goals: null, country: null, signed: null };
  return { caps: n?.caps ?? null, goals: n?.goals ?? null, country, signed };
});

const bestXi = (leagueId: number, seasonId: number) => cached<unknown>(`x:bxi:${leagueId}:${seasonId}`, DAY, () =>
  bsdOrNull(`/api/v2/leagues/${leagueId}/bestxi/${seasonId}/`));

export interface ExtrasInput {
  kickoff: number;
  now: number;
  leagueId: number;
  seasonId: number | null;
  home: { id: number; coachId: number | null; coachName: string | null };
  away: { id: number; coachId: number | null; coachName: string | null };
  /** The players the bundle already profiles, with their side's team id. */
  players: Array<{ id: number; teamId: number }>;
  referee: { name: string | null; matches: number; yellows_per: number; reds_per: number } | null;
  /** This league's yellow cards in a usual match (both sides together). */
  leagueYellows: number | null;
}

export async function gatherExtras(x: ExtrasInput): Promise<Extras> {
  const manager = async (side: ExtrasInput['home'], opp: number): Promise<ManagerLine | null> => {
    if (!side.coachId) return null;
    const hist = await managerHistory(side.coachId);
    return { id: side.coachId, name: side.coachName, vs: hist ? recordVs(hist, opp, x.kickoff) : null };
  };
  const [home, away, bxiRaw] = await Promise.all([
    manager(x.home, x.away.id),
    manager(x.away, x.home.id),
    x.seasonId ? bestXi(x.leagueId, x.seasonId) : Promise.resolve(null),
  ]);
  const best = bxiRaw ? parseBestXi(bxiRaw, [x.home.id, x.away.id]) : [];

  // The profiled players and the team-of-the-season members, one lookup each.
  const who = new Map<number, number>();
  for (const p of x.players) who.set(p.id, p.teamId);
  for (const b of best) who.set(b.id, b.team_id);
  const players: Record<string, PlayerExtra> = {};
  await Promise.all([...who].slice(0, 16).map(async ([id, teamId]) => {
    const e = await playerExtra(id, teamId, x.now);
    if (e && (e.caps || e.goals || e.signed)) players[String(id)] = e;
  }));

  const r = x.referee;
  const referee: RefereeLine | null = r?.name && r.matches > 0
    ? {
        name: r.name,
        matches: r.matches,
        yellows: Math.round(r.yellows_per * r.matches),
        usual: x.leagueYellows ? Math.round(x.leagueYellows * r.matches) : 0,
        reds: Math.round(r.reds_per * r.matches),
      }
    : null;

  return { teams: { home: x.home.id, away: x.away.id }, referee, managers: { home, away }, best_xi: best, players };
}
