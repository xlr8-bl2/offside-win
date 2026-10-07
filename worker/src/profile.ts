/**
 * The account's own settings, over D1: `POST /api/account/<fn>`.
 *
 * These were Postgres functions the page called straight through Supabase
 * (save_profile, set_follow, set_call_alerts in schema.pg.sql), each pinned to
 * auth.uid(). Here the session names the account (auth.ts) and every statement
 * is pinned to it, so a reader can only ever change their own rows. The checks
 * and the answers are the same as the functions'; the page cannot tell.
 */

import { sessionAccount, type AuthDb } from './auth.ts';

type Rec = Record<string, unknown>;

export class ProfileError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

const now = () => Math.floor(Date.now() / 1000);
const squash = (v: unknown, max: number) => {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max).trim();
  return s || null;
};

const RESERVED = new Set(['admin', 'administrator', 'offside', 'offsidewin', 'support', 'help', 'staff', 'moderator', 'mod', 'root', 'system', 'official']);

const PROFILE_SQL = `SELECT display_name, odds_format, avatar_style, avatar_color, club_id, club_name, clock, username
  FROM profile WHERE user_id = ?`;

/** save_profile(): NULL leaves a field as it is, '' clears the name or username, a club of 0 clears the club. */
export async function saveProfile(db: AuthDb, me: string, a: Rec): Promise<Rec | null> {
  const nul = (k: string) => a[k] === undefined || a[k] === null;
  const odds = nul('p_odds') ? null : String(a.p_odds);
  const avatar = nul('p_avatar') ? null : String(a.p_avatar);
  const color = nul('p_color') ? null : String(a.p_color);
  const clock = nul('p_clock') ? null : String(a.p_clock);
  const clubId = nul('p_club_id') ? null : Number(a.p_club_id);
  const handle = nul('p_username') ? null : String(a.p_username).trim().replace(/^@+|@+$/g, '').trim().toLowerCase();
  if (!['decimal', 'fractional', 'american'].includes(odds ?? 'decimal')) throw new ProfileError('unknown odds format');
  if (avatar !== null && !['auto', 'photo', 'initials', 'crest'].includes(avatar)) throw new ProfileError('unknown picture style');
  if (color !== null && !/^c[1-8]$/.test(color)) throw new ProfileError('unknown colour');
  if (clock !== null && !['24', '12'].includes(clock)) throw new ProfileError('unknown clock');
  if (clubId !== null && (!Number.isInteger(clubId) || clubId < 0)) throw new ProfileError('unknown club');
  if (handle) {
    if (!/^[a-z0-9_]{3,20}$/.test(handle)) throw new ProfileError('username: 3 to 20 letters, numbers or underscores');
    const taken = RESERVED.has(handle)
      || await db.prepare('SELECT 1 AS x FROM profile WHERE lower(username) = ? AND user_id <> ?').bind(handle, me).first();
    if (taken) throw new ProfileError('username: that one is taken', 409);
  }
  const name = squash(a.p_name, 60);
  const club = squash(a.p_club_name, 80);
  const t = now();
  try {
    await db.prepare(`INSERT INTO profile (user_id, display_name, odds_format, avatar_style, avatar_color, club_id, club_name, clock, username, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (user_id) DO UPDATE SET
          display_name = CASE WHEN ?12 THEN profile.display_name ELSE excluded.display_name END,
          odds_format = coalesce(?13, profile.odds_format),
          avatar_style = coalesce(?14, profile.avatar_style),
          avatar_color = coalesce(?15, profile.avatar_color),
          club_id = CASE WHEN ?16 IS NULL THEN profile.club_id ELSE nullif(?16, 0) END,
          club_name = CASE WHEN ?16 IS NULL THEN profile.club_name WHEN ?16 = 0 THEN NULL ELSE excluded.club_name END,
          clock = coalesce(?17, profile.clock),
          username = CASE WHEN ?18 IS NULL THEN profile.username ELSE nullif(?18, '') END,
          updated_at = excluded.updated_at`)
      .bind(me, name, odds ?? 'decimal', avatar ?? 'auto', color,
        clubId === 0 ? null : clubId, !clubId ? null : club, clock ?? '24', handle ? handle : null, t, t,
        nul('p_name') ? 1 : 0, odds, avatar, color, clubId, clock, handle)
      .run();
  } catch (err) {
    // Two people choosing the same name in the same instant: the index decides.
    if (/UNIQUE/i.test(String(err))) throw new ProfileError('username: that one is taken', 409);
    throw err;
  }
  return db.prepare(PROFILE_SQL).bind(me).first<Rec>();
}

async function follows(db: AuthDb, me: string): Promise<Rec[]> {
  return ((await db.prepare('SELECT kind, ref_id AS id, label FROM follow WHERE user_id = ? ORDER BY created_at').bind(me).all<Rec>()).results ?? []);
}

/** set_follow(): follow or unfollow one team or competition; the whole list back. At most a hundred. */
export async function setFollow(db: AuthDb, me: string, a: Rec): Promise<Rec[]> {
  const kind = String(a.p_kind ?? '');
  const ref = Number(a.p_ref);
  if (!['team', 'league'].includes(kind) || !Number.isInteger(ref)) throw new ProfileError('unknown follow');
  if (a.p_on === true) {
    const n = await db.prepare('SELECT count(*) AS n FROM follow WHERE user_id = ?').bind(me).first<{ n: number }>();
    if ((n?.n ?? 0) >= 100) throw new ProfileError('follow limit reached');
    const label = squash(a.p_label, 80) ?? `${kind} ${ref}`;
    await db.prepare(`INSERT INTO follow (user_id, kind, ref_id, label, created_at) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT (user_id, kind, ref_id) DO UPDATE SET label = excluded.label`)
      .bind(me, kind, ref, label, now()).run();
  } else {
    await db.prepare('DELETE FROM follow WHERE user_id = ? AND kind = ? AND ref_id = ?').bind(me, kind, ref).run();
  }
  return follows(db, me);
}

/** set_call_alerts(): emails when a member's call is pulled, on or off. */
export async function setCallAlerts(db: AuthDb, me: string, a: Rec): Promise<boolean> {
  const on = a.p_on === false ? false : true;
  const t = now();
  await db.prepare(`INSERT INTO profile (user_id, created_at, updated_at, call_alerts) VALUES (?, ?, ?, ?)
      ON CONFLICT (user_id) DO UPDATE SET call_alerts = excluded.call_alerts, updated_at = excluded.updated_at`)
    .bind(me, t, t, on ? 1 : 0).run();
  return on;
}

const ROUTES: Record<string, (db: AuthDb, me: string, a: Rec) => Promise<unknown>> = {
  save_profile: saveProfile,
  set_follow: setFollow,
  set_call_alerts: setCallAlerts,
};

/** `POST /api/account/<fn>` with the function's arguments as JSON. */
export async function accountWrite(request: Request, db: AuthDb | undefined, fn: string, token: string | null): Promise<Response> {
  const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
  const run = ROUTES[fn];
  if (!run) return reply({ error: 'not found' }, 404);
  if (request.method !== 'POST') return reply({ error: 'method not allowed' }, 405);
  if (!db) return reply({ error: 'Accounts are not available at the moment.' }, 503);
  const a = await sessionAccount(db, token);
  if (!a) return reply({ error: 'sign in first' }, 401);
  let args: Rec = {};
  try { const b = await request.json(); if (b && typeof b === 'object') args = b as Rec; } catch { /* no arguments */ }
  try {
    return reply(await run(db, a.id, args));
  } catch (err) {
    if (err instanceof ProfileError) return reply({ error: err.message }, err.status);
    throw err;
  }
}
