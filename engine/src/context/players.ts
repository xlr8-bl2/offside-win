/**
 * Who the players are, not just who is missing.
 *
 * The analysis used to know two things about a player: that he was out, and
 * what share of the league goals he had scored. So a first-choice centre-back
 * who had started every game registered as nobody, a creator with six assists
 * counted for nothing, and the write-up could say "Saka is out with a
 * hamstring problem" and nothing about why that mattered.
 *
 * A profile is built from the provider's per-match statistics for this season
 * (the league's own season, from its start date), the player's record, and
 * the side's scoring and assist charts:
 *
 *   - what he has done: games, starts, goals, assists, chances made, and for
 *     a keeper the clean sheets;
 *   - where he stands at his club: top scorer, chief creator, ever-present,
 *     first-choice keeper, one of their best performers;
 *   - one game that shows it: his best performance this season, against whom;
 *   - how he is going now: his last five games;
 *   - what he is good at, and when he is due back.
 *
 * Each of those is a fact a supporter would say out loud (counts, names,
 * dates), and the same measure of how much he matters sizes the absence in the
 * model, where it replaces the goal share alone.
 */

import { asArray, asRecord, bsdOrNull, num, str, toEpoch } from '../bsd.ts';
import { select } from '../store.ts';
import { classifyRole, nameKey } from './availability.ts';
import type { LineupInfo, ScorerRow, SideContext } from './types.ts';

export type Role = 'GK' | 'DEF' | 'MID' | 'ATT' | 'UNKNOWN';

export interface PlayerSeason {
  apps: number;
  starts: number;
  minutes: number;
  goals: number;
  assists: number;
  keyPasses: number;
  bigChances: number;
  shots: number;
  defensive: number;
  saves: number;
  cleanSheets: number;
  /** Mean match rating over rated appearances. Kept for ranking; never printed. */
  rating: number | null;
  /** The club's matches in the same window (those in our table), the denominator for "every game". */
  teamGames: number;
  /** The club's goals in those matches. */
  teamGoals: number;
  /** His appearances, starts, and goals plus assists within those same matches. */
  trackedApps: number;
  trackedStarts: number;
  trackedInvolvement: number;
}

export interface Standout {
  opponent: string | null;
  kickoff: number;
  goals: number;
  assists: number;
  /** "3-1", from this player's side's point of view. */
  score: string | null;
  won: boolean | null;
}

export type Tag = 'top_scorer' | 'top_creator' | 'ever_present' | 'first_choice_keeper' | 'best_performer'
  | 'in_form' | 'defensive_rock' | 'chance_creator';

export interface PlayerProfile {
  id: number;
  name: string;
  side: 'home' | 'away';
  team: string;
  /** The club the season's numbers were earned at, when that is not this side (a national team). */
  club: string | null;
  role: Role;
  position: string | null;
  status: 'out' | 'doubtful' | 'fit';
  reason: string | null;
  expectedReturn: string | null;
  season: PlayerSeason | null;
  recent: { apps: number; goals: number; assists: number; scoredIn: number } | null;
  standout: Standout | null;
  strengths: string[];
  tags: Tag[];
  /** 0..1: how much of the side goes with him. Sizes the absence in the model. */
  importance: number;
}

export interface StatRow {
  event_id: number;
  team_id: number | null;
  minutes: number;
  rating: number | null;
  goals: number;
  assists: number;
  keyPasses: number;
  bigChances: number;
  shots: number;
  defensive: number;
  saves: number;
  conceded: number | null;
  kickoff: number | null;
}

const n0 = (v: unknown) => num(v) ?? 0;

function parseStats(raw: unknown): StatRow[] {
  const list = asArray(asRecord(raw)?.['results'] ?? raw) ?? [];
  const out: StatRow[] = [];
  for (const r of list) {
    const x = asRecord(r);
    const ev = num(x?.['event_id']);
    if (!x || ev === undefined) continue;
    out.push({
      event_id: ev,
      team_id: num(x['team_id']) ?? null,
      minutes: n0(x['minutes_played']),
      rating: num(x['rating']) ?? null,
      goals: n0(x['goals']),
      assists: n0(x['goal_assist']),
      keyPasses: n0(x['key_pass']),
      bigChances: n0(x['big_chance_created']),
      shots: n0(x['total_shots']),
      defensive: n0(x['total_tackle']) + n0(x['interception']) + n0(x['total_clearance']),
      saves: n0(x['saves']),
      conceded: num(x['goals_conceded']) ?? null,
      kickoff: toEpoch(x['event_date'] ?? asRecord(x['event'])?.['event_date']) ?? null,
    });
  }
  return out;
}

/** When this league's season started; a year back when the feed does not say. */
const seasonStarts = new Map<number, Promise<number>>();
export function seasonStart(leagueId: number, kickoff: number): Promise<number> {
  let p = seasonStarts.get(leagueId);
  if (!p) {
    p = (async () => {
      const raw = asRecord(await bsdOrNull(`/api/v2/leagues/${leagueId}/season/`));
      const s = asRecord(raw?.['season']);
      const start = toEpoch(s?.['start_date']);
      return start && start < kickoff ? start : kickoff - 330 * 86400;
    })();
    seasonStarts.set(leagueId, p);
  }
  return p;
}

export interface MatchMeta { id: number; kickoff: number; home_team_id: number; away_team_id: number; home_goals: number | null; away_goals: number | null; home: string | null; away: string | null; tracked?: boolean }

async function matchMeta(ids: number[]): Promise<Map<number, MatchMeta>> {
  if (!ids.length) return new Map();
  const rows = await select<MatchMeta>(
    `SELECT m.id, m.kickoff, m.home_team_id, m.away_team_id, m.home_goals, m.away_goals,
            th.name AS home, ta.name AS away
       FROM match m
       LEFT JOIN team th ON th.id = m.home_team_id
       LEFT JOIN team ta ON ta.id = m.away_team_id
      WHERE m.id IN (${ids.map(() => '?').join(',')})`,
    ids,
  );
  return new Map(rows.map((r) => [Number(r.id), r]));
}

/**
 * The club's games and goals over the same window as the player's numbers, all
 * competitions, so "every game" and "most of their goals" are measured against
 * like for like rather than against the league table alone.
 */
async function teamRecord(teamId: number, from: number, to: number): Promise<{ games: number; goals: number }> {
  const r = await select<{ n: number; g: number | null }>(
    `SELECT COUNT(*) AS n,
            SUM(CASE WHEN home_team_id = ? THEN home_goals ELSE away_goals END) AS g
       FROM match WHERE (home_team_id = ? OR away_team_id = ?) AND kickoff >= ? AND kickoff < ? AND home_goals IS NOT NULL`,
    [teamId, teamId, teamId, from, to],
  );
  return { games: Number(r[0]?.n ?? 0), goals: Number(r[0]?.g ?? 0) };
}

export interface ProfileRequest {
  id: number;
  name: string;
  side: 'home' | 'away';
  team: string;
  teamId: number;
  position: string | null;
  status: 'out' | 'doubtful' | 'fit';
  reason: string | null;
}

/**
 * Where a club's season began, for a player on international duty. The club's
 * league from our own match table when we hold it; otherwise the first of July
 * (the European calendar), a year back when that is too recent to say anything.
 */
async function clubSeasonStart(clubId: number, kickoff: number): Promise<number> {
  const r = await select<{ league_id: number }>(
    `SELECT league_id FROM match WHERE (home_team_id = ? OR away_team_id = ?) AND kickoff < ? ORDER BY kickoff DESC LIMIT 1`,
    [clubId, clubId, kickoff],
  ).catch(() => []);
  if (r[0]) return seasonStart(Number(r[0].league_id), kickoff);
  const y = new Date(kickoff * 1000).getUTCFullYear();
  const july = Date.UTC(y, 6, 1) / 1000;
  return kickoff - july >= 45 * 86400 ? july : Date.UTC(y - 1, 6, 1) / 1000;
}

/**
 * Build one profile.
 *
 * For a player on international duty (the side is his national team, not his
 * club) the season that tells you about him is the one at his club: caps are a
 * handful of games against anyone and say little about how he is playing.
 */
export async function buildProfile(
  req: ProfileRequest,
  ctx: { leagueId: number; kickoff: number; scorers: ScorerRow[] | null; assists: ScorerRow[] | null; teamGoals: number | null },
): Promise<PlayerProfile> {
  const d = asRecord(await bsdOrNull(`/api/v2/players/${req.id}/`));
  const currentId = num(d?.['current_team_id'] ?? asRecord(d?.['current_team'])?.['id']) ?? null;
  const nationalId = num(d?.['national_team_id'] ?? asRecord(d?.['national_team'])?.['id']) ?? null;
  const national = nationalId !== null && nationalId === req.teamId && currentId !== req.teamId;
  const clubId = national ? currentId : req.teamId;
  const since = national
    ? (clubId ? await clubSeasonStart(clubId, ctx.kickoff) : ctx.kickoff - 330 * 86400)
    : await seasonStart(ctx.leagueId, ctx.kickoff);
  const statsRaw = clubId
    ? await bsdOrNull(`/api/v2/players/${req.id}/stats/`, {
      team_id: clubId,
      date_from: new Date(since * 1000).toISOString(),
      date_to: new Date(ctx.kickoff * 1000).toISOString(),
      limit: 80,
    })
    : null;
  let rows = parseStats(statsRaw).filter((r) => r.minutes > 0 && (r.team_id === null || r.team_id === clubId));

  const meta = await matchMeta(rows.map((r) => r.event_id));
  // Cup ties and games outside the leagues we track are not in our table, and
  // without a date "his last five" and "his best game" would be in the wrong
  // order. The provider's own record fills them in.
  const missing = rows.filter((r) => !meta.has(r.event_id)).slice(0, 20);
  await Promise.all(missing.map(async (r) => {
    const e = asRecord(await bsdOrNull(`/api/v2/events/${r.event_id}/`));
    const k = toEpoch(e?.['event_date']);
    if (!e || k === undefined) return;
    meta.set(r.event_id, {
      id: r.event_id, kickoff: k,
      home_team_id: num(e['home_team_id']) ?? 0, away_team_id: num(e['away_team_id']) ?? 0,
      home_goals: num(e['home_score']) ?? null, away_goals: num(e['away_score']) ?? null,
      home: str(e['home_team']) ?? null, away: str(e['away_team']) ?? null,
      tracked: false,
    });
  }));
  for (const r of rows) r.kickoff ??= meta.get(r.event_id)?.kickoff ?? null;
  rows = rows.filter((r) => r.kickoff !== null);
  rows.sort((a, b) => (b.kickoff ?? 0) - (a.kickoff ?? 0));
  // The best game's opponent by name, which our table lacks for a club it
  // does not hold (a player abroad, a cup tie against a lower division side).
  const best = bestGame(rows);
  const bm = best ? meta.get(best.event_id) : undefined;
  if (best && (!bm || !bm.home || !bm.away)) {
    const e = asRecord(await bsdOrNull(`/api/v2/events/${best.event_id}/`));
    if (e) {
      meta.set(best.event_id, {
        ...(bm ?? { id: best.event_id, kickoff: best.kickoff ?? 0, tracked: false }),
        home_team_id: num(e['home_team_id']) ?? bm?.home_team_id ?? 0, away_team_id: num(e['away_team_id']) ?? bm?.away_team_id ?? 0,
        home_goals: num(e['home_score']) ?? bm?.home_goals ?? null, away_goals: num(e['away_score']) ?? bm?.away_goals ?? null,
        home: str(e['home_team']) ?? bm?.home ?? null, away: str(e['away_team']) ?? bm?.away ?? null,
      } as MatchMeta);
    }
  }
  const club$ = clubId ? await teamRecord(clubId, since, ctx.kickoff) : { games: 0, goals: 0 };
  return assembleProfile(req, d ?? {}, rows, meta, club$, { ...ctx, national, clubId });
}

/** The game that shows it: most goal involvements, then the best rating. */
function bestGame(rows: StatRow[]): StatRow | undefined {
  const b = [...rows].sort((a, c) =>
    (c.goals * 2 + c.assists) - (a.goals * 2 + a.assists) || (c.rating ?? 0) - (a.rating ?? 0))[0];
  return b && (b.goals + b.assists > 0 || (b.rating ?? 0) >= 8) ? b : undefined;
}

/**
 * The arithmetic of a profile, from what the provider and our table returned.
 * Pure, so the tests can hand it a season and read back what it concludes.
 * `rows` are newest first and dated.
 */
export function assembleProfile(
  req: ProfileRequest,
  d: Record<string, unknown>,
  rows: StatRow[],
  meta: Map<number, MatchMeta>,
  club$: { games: number; goals: number },
  ctx: { scorers: ScorerRow[] | null; assists: ScorerRow[] | null; teamGoals: number | null; national: boolean; clubId: number | null },
): PlayerProfile {
  const { national, clubId } = ctx;
  const role = classifyRole(str(d['position']) ?? req.position) as Role;
  const club = national ? str(asRecord(d['current_team'])?.['name']) ?? null : null;
  // Like for like: the games of his that are in our table, against the club's
  // games in our table over the same window.
  const tracked = rows.filter((r) => meta.get(r.event_id)?.tracked !== false);

  const rated = rows.filter((r) => r.rating !== null && r.minutes >= 30);
  const season: PlayerSeason | null = rows.length ? {
    apps: rows.length,
    starts: rows.filter((r) => r.minutes >= 60).length,
    minutes: rows.reduce((a, r) => a + r.minutes, 0),
    goals: rows.reduce((a, r) => a + r.goals, 0),
    assists: rows.reduce((a, r) => a + r.assists, 0),
    keyPasses: rows.reduce((a, r) => a + r.keyPasses, 0),
    bigChances: rows.reduce((a, r) => a + r.bigChances, 0),
    shots: rows.reduce((a, r) => a + r.shots, 0),
    defensive: rows.reduce((a, r) => a + r.defensive, 0),
    saves: rows.reduce((a, r) => a + r.saves, 0),
    cleanSheets: rows.filter((r) => r.minutes >= 60 && r.conceded === 0).length,
    rating: rated.length ? rated.reduce((a, r) => a + (r.rating ?? 0), 0) / rated.length : null,
    teamGames: club$.games,
    teamGoals: club$.goals,
    trackedApps: tracked.length,
    trackedStarts: tracked.filter((r) => r.minutes >= 60).length,
    trackedInvolvement: tracked.reduce((a, r) => a + r.goals + 0.7 * r.assists, 0),
  } : null;

  const last5 = rows.slice(0, 5);
  const recent = last5.length ? {
    apps: last5.length,
    goals: last5.reduce((a, r) => a + r.goals, 0),
    assists: last5.reduce((a, r) => a + r.assists, 0),
    // Consecutive games with a goal, most recent first.
    scoredIn: (() => { let k = 0; for (const r of last5) { if (r.goals > 0) k++; else break; } return k; })(),
  } : null;

  const best = bestGame(rows);
  let standout: Standout | null = null;
  if (best) {
    const m = meta.get(best.event_id);
    const teamId = best.team_id ?? clubId;
    const isHome = m && teamId ? m.home_team_id === teamId : null;
    const opp = m ? (isHome ? m.away : m.home) : null;
    const us = m && isHome !== null ? (isHome ? m.home_goals : m.away_goals) : null;
    const them = m && isHome !== null ? (isHome ? m.away_goals : m.home_goals) : null;
    standout = {
      opponent: opp ?? null,
      kickoff: best.kickoff ?? m?.kickoff ?? 0,
      goals: best.goals,
      assists: best.assists,
      score: us !== null && them !== null ? `${us}-${them}` : null,
      won: us !== null && them !== null ? us > them : null,
    };
  }

  const tags: Tag[] = [];
  const s = season;
  if (s) {
    // Top of the side's own chart, or level with whoever is. The charts are
    // this competition's, so they say nothing about a club season: a player on
    // international duty is measured on his own numbers and never ranked.
    const leads = (list: ScorerRow[] | null, value: (x: ScorerRow) => number) => {
      const top = Math.max(0, ...(list ?? []).map(value));
      const me = (list ?? []).find((x) => x.player_id === req.id || nameKey(x.name) === nameKey(req.name));
      return top >= 3 && !!me && value(me) >= top;
    };
    if (!national && leads(ctx.scorers, (x) => x.goals)) tags.push('top_scorer');
    if (!national && leads(ctx.assists, (x) => x.assists)) tags.push('top_creator');
    if (role === 'GK' && s.teamGames >= 4 && s.trackedStarts >= 0.7 * s.teamGames) tags.push('first_choice_keeper');
    else if (s.teamGames >= 5 && s.trackedStarts >= 0.8 * s.teamGames) tags.push('ever_present');
    if (s.rating !== null && rated.length >= 5 && s.rating >= 7.2) tags.push('best_performer');
    const per90 = (v: number) => (s.minutes > 0 ? (v * 90) / s.minutes : 0);
    if (role !== 'GK' && s.minutes >= 450 && (per90(s.keyPasses) >= 2.2 || s.bigChances >= 5)) tags.push('chance_creator');
    if (role === 'DEF' && s.minutes >= 450 && per90(s.defensive) >= 8 && s.trackedStarts >= 0.6 * Math.max(1, s.teamGames)) tags.push('defensive_rock');
  }
  if (recent && (recent.goals + recent.assists >= 4 || recent.scoredIn >= 3)) tags.push('in_form');

  return {
    id: req.id,
    name: str(d['name']) ?? req.name,
    side: req.side,
    team: req.team,
    club,
    role,
    position: str(d['specific_position']) ?? null,
    status: req.status,
    reason: req.reason,
    expectedReturn: str(d['injury_expected_return']) ?? null,
    season,
    recent,
    standout,
    strengths: (asArray(d['strengths']) ?? []).map((x) => String(x)).filter(Boolean).slice(0, 3),
    tags,
    // A club's share is not a country's: a player who carries Como carries
    // less of Croatia, where the squad is picked from every club's best.
    importance: Math.round(importanceOf(role, season, club$.goals || (national ? null : ctx.teamGoals)) * (national ? 0.6 : 1) * 1000) / 1000,
  };
}

/**
 * How much of a side goes with a player, 0..1.
 *
 * Forwards and midfielders by their share of the side's goals and assists;
 * defenders and keepers by how much of the side's football they play, since a
 * centre-back who starts every week scores nothing and still matters. Scaled
 * so a twenty-goal striker at a forty-goal club is about 0.45 and a regular
 * centre-back about 0.12.
 */
export function importanceOf(role: Role, s: PlayerSeason | null, teamGoals: number | null): number {
  if (!s || s.apps === 0) return 0;
  // Like for like where our table has the club's games; the raw season when not.
  const like = s.teamGames > 0 && s.trackedApps > 0;
  const startShare = like
    ? Math.min(1, s.trackedStarts / s.teamGames)
    : Math.min(1, s.starts / Math.max(s.apps, 1));
  const involvement = like && s.teamGoals > 0
    ? Math.min(1, s.trackedInvolvement / s.teamGoals)
    : Math.min(1, (s.goals + 0.7 * s.assists) / Math.max(teamGoals ?? 0, s.goals + s.assists, 1));
  // A regular in a side does not become a star by having played three games.
  const sample = Math.min(1, s.apps / 5);
  const quality = s.rating === null ? 1 : Math.min(1.3, Math.max(0.7, 1 + (s.rating - 6.9) * 0.5));
  let v: number;
  switch (role) {
    case 'GK': v = 0.14 * startShare * quality; break;
    case 'DEF': v = (0.1 * startShare + 0.5 * involvement) * quality; break;
    case 'MID': v = (0.06 * startShare + 0.8 * involvement) * quality; break;
    case 'ATT': v = (0.04 * startShare + 0.9 * involvement) * quality; break;
    default: v = (0.05 * startShare + 0.6 * involvement) * quality;
  }
  return Math.round(Math.min(0.6, Math.max(0, v * sample)) * 1000) / 1000;
}

/**
 * Profiles for a fixture: everyone reported out or doubtful (the five who
 * look to matter most per side), and each side's chief goal threat who is
 * fit, so the write-up can say who carries the danger as well as who is
 * missing.
 */
export async function profilesFor(ctx: {
  leagueId: number;
  kickoff: number;
  lineups: LineupInfo;
  home: SideContext;
  away: SideContext;
}): Promise<PlayerProfile[]> {
  const jobs: Array<Promise<PlayerProfile | null>> = [];
  for (const which of ['home', 'away'] as const) {
    const side = ctx[which];
    const assistsRaw = await bsdOrNull(`/api/v2/leagues/${ctx.leagueId}/top/assists/`, { team_id: side.team_id, limit: 20 });
    const assists = parseLeaders(assistsRaw);
    const teamGoals = side.standing?.goals_for ?? ((side.scorers ?? []).reduce((a, x) => a + x.goals, 0) || null);
    const common = { leagueId: ctx.leagueId, kickoff: ctx.kickoff, scorers: side.scorers, assists, teamGoals };
    const squad = new Map((side.squad ?? []).map((p) => [p.id, p]));

    const out = new Map<number, ProfileRequest>();
    for (const u of ctx.lineups.unavailable) {
      if (u.side ? u.side !== which : (u.team_id !== null ? u.team_id !== side.team_id : !squad.has(u.id))) continue;
      const doubtful = /doubt/i.test(u.reason ?? '');
      out.set(u.id, { id: u.id, name: u.name, side: which, team: side.team_name, teamId: side.team_id, position: squad.get(u.id)?.position ?? null, status: doubtful ? 'doubtful' : 'out', reason: u.reason });
    }
    for (const p of side.squad ?? []) {
      const a = (p.availability ?? '').toLowerCase();
      if (!/injur|suspend|doubt|out|unavailable/.test(a) || out.has(p.id)) continue;
      out.set(p.id, { id: p.id, name: p.name, side: which, team: side.team_name, teamId: side.team_id, position: p.position, status: /doubt/.test(a) ? 'doubtful' : 'out', reason: p.injury_type ?? p.availability });
    }
    // The five that look to matter most, by what the charts already say.
    const weight = (r: ProfileRequest) => {
      const sc = (side.scorers ?? []).find((x) => x.player_id === r.id || nameKey(x.name) === nameKey(r.name));
      const as = assists?.find((x) => x.player_id === r.id);
      return (sc?.goals ?? 0) * 2 + (as?.assists ?? 0) + (/^(g|gk|goalkeeper)$/i.test(r.position ?? '') ? 3 : 0) + 1;
    };
    for (const r of [...out.values()].sort((a, b) => weight(b) - weight(a)).slice(0, 5)) jobs.push(buildProfile(r, common).catch(() => null));

    // The fit danger men: the side's top scorer when he is not out, and the
    // forwards on the team sheet. A national side's competition chart has a
    // goal or two in it, so for them the sheet is the only way to find who
    // carries the threat; for a club it adds the striker who is not top of
    // the chart this year.
    const fit = new Map<number, ProfileRequest>();
    const top = [...(side.scorers ?? [])].sort((a, b) => b.goals - a.goals)[0];
    if (top && top.goals >= 2 && !out.has(top.player_id)) {
      fit.set(top.player_id, { id: top.player_id, name: top.name, side: which, team: side.team_name, teamId: side.team_id, position: squad.get(top.player_id)?.position ?? null, status: 'fit', reason: null });
    }
    const sheet = ctx.lineups[which]?.players ?? [];
    for (const pl of sheet.filter((x) => x.starting && /^(F|ATT|FW|ST|CF|LW|RW)$/i.test(x.position ?? '')).sort((a, b) => (b.ai_score ?? 0) - (a.ai_score ?? 0)).slice(0, 2)) {
      if (!out.has(pl.id) && !fit.has(pl.id)) fit.set(pl.id, { id: pl.id, name: pl.name, side: which, team: side.team_name, teamId: side.team_id, position: pl.position, status: 'fit', reason: null });
    }
    for (const r of fit.values()) jobs.push(buildProfile(r, common).catch(() => null));
  }
  return (await Promise.all(jobs)).filter((p): p is PlayerProfile => p !== null);
}

function parseLeaders(raw: unknown): ScorerRow[] | null {
  const list = asArray(asRecord(raw)?.['leaders'] ?? asRecord(raw)?.['results'] ?? raw);
  if (!list) return null;
  const out: ScorerRow[] = [];
  for (const r of list) {
    const x = asRecord(r);
    const id = num(x?.['player_id'] ?? asRecord(x?.['player'])?.['id']);
    if (id === undefined) continue;
    const v = num(x?.['assists'] ?? x?.['value'] ?? x?.['total'] ?? x?.['count']) ?? 0;
    out.push({ player_id: id, name: str(x?.['name'] ?? x?.['player_name'] ?? asRecord(x?.['player'])?.['name']) ?? `#${id}`, goals: 0, assists: v });
  }
  return out.length ? out : null;
}

/** The compact form stored on the bundle and read by the facts layer. */
export function forBundle(p: PlayerProfile) {
  return {
    id: p.id, name: p.name, side: p.side, team: p.team, club: p.club, role: p.role, position: p.position,
    status: p.status, reason: p.reason, expected_return: p.expectedReturn,
    season: p.season ? {
      apps: p.season.apps, starts: p.season.starts, goals: p.season.goals, assists: p.season.assists,
      big_chances: p.season.bigChances, clean_sheets: p.season.cleanSheets,
      team_games: p.season.teamGames, tracked_apps: p.season.trackedApps, tracked_starts: p.season.trackedStarts,
    } : null,
    recent: p.recent, standout: p.standout, strengths: p.strengths, tags: p.tags, importance: p.importance,
  };
}
