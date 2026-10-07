/**
 * The Worker's scheduled jobs' database steps, on D1 (HANDOFF.md, stage 2).
 *
 * goodwill_credit, goodwill_whop_applied, goodwill_noted, goodwill_ended and
 * pulled_claim were Postgres functions in schema.pg.sql; each is rebuilt here
 * with the same answer, for goodwill.ts and pulled.ts. Account emails come
 * from D1's `account` table where Postgres read auth.users.
 */

import type { AuthDb } from './auth.ts';

type Rec = Record<string, any>;
const now = () => Math.floor(Date.now() / 1000);
const DAY = 86400;

async function all<T = Rec>(db: AuthDb, sql: string, ...params: unknown[]): Promise<T[]> {
  return (await db.prepare(sql).bind(...params).all<T>()).results ?? [];
}
async function first<T = Rec>(db: AuthDb, sql: string, ...params: unknown[]): Promise<T | null> {
  return db.prepare(sql).bind(...params).first<T>();
}
async function run(db: AuthDb, sql: string, ...params: unknown[]): Promise<number> {
  return Number((await db.prepare(sql).bind(...params).run()).meta?.changes ?? 0);
}

/* -------------------------------------------------------------- goodwill */

const TOP = '(7, 1, 3, 4, 5, 6)';

/** goodwill_lean(): a UK day with a full board and no top-flight football around it. */
export async function goodwillLean(db: AuthDb, day: number): Promise<boolean> {
  const n = await first<{ n: number }>(db, 'SELECT count(*) AS n FROM fixture WHERE kickoff >= ? AND kickoff < ?', day, day + DAY);
  if ((n?.n ?? 0) < 5) return false;
  const top = await all<{ kickoff: number }>(db, `
    SELECT kickoff FROM fixture WHERE league_id IN ${TOP} AND kickoff >= ? AND kickoff < ?
    UNION ALL
    SELECT kickoff FROM schedule WHERE league_id IN ${TOP} AND kickoff >= ? AND kickoff < ?`,
  day - 3 * DAY, day + 4 * DAY, day - 3 * DAY, day + 4 * DAY);
  for (let s = 0; s <= 3; s++) {
    const from = day - s * DAY;
    const to = day + (4 - s) * DAY;
    if (!top.some((r) => r.kickoff >= from && r.kickoff < to)) return true;
  }
  return false;
}

/** goodwill_credit(): credit one quiet day, once. */
export async function goodwillCredit(db: AuthDb, day: number): Promise<Rec> {
  if (!await goodwillLean(db, day)) return { lean: false };
  const t = now();
  const end = day + DAY;
  const stretchOf = async (account: string) =>
    (await first<{ stretch: number }>(db, 'SELECT stretch FROM goodwill WHERE account = ? AND day = ?', account, day - DAY))?.stretch ?? day;

  // Card memberships, paid, running the whole day.
  const cards = await all<{ user_id: string; email: string | null }>(db, `
    SELECT m.user_id, a.email FROM membership m LEFT JOIN account a ON a.id = m.user_id
     WHERE m.expires_at > ? AND m.created_at < ? AND coalesce(m.card_brand, '') <> 'complimentary'`, end, day);
  for (const c of cards) {
    const account = `u:${c.user_id}`;
    const ins = await run(db, `INSERT INTO goodwill (day, account, email, stretch, applied, created_at)
      VALUES (?, ?, ?, ?, 1, ?) ON CONFLICT (day, account) DO NOTHING`, day, account, c.email, await stretchOf(account), t);
    if (ins) await run(db, 'UPDATE membership SET expires_at = expires_at + ?, updated_at = ? WHERE user_id = ?', DAY, t, c.user_id);
  }

  // Whop: the ones nothing will bill again are extended now; the renewing ones wait for Whop.
  const ents = await all<{ email: string; renews: number }>(db, `
    SELECT email, (plan_id <> 'matchday' AND renew_stopped_at IS NULL) AS renews FROM entitlement
     WHERE status = 'active' AND expires_at > ? AND created_at < ?`, end, day);
  for (const e of ents) {
    const account = `e:${e.email}`;
    const applied = e.renews ? 0 : 1;
    const ins = await run(db, `INSERT INTO goodwill (day, account, email, stretch, applied, created_at)
      VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (day, account) DO NOTHING`, day, account, e.email, await stretchOf(account), applied, t);
    if (ins && applied) await run(db, 'UPDATE entitlement SET expires_at = expires_at + ?, updated_at = ? WHERE email = ?', DAY, t, e.email);
  }

  const pending = await all(db, `
    SELECT g.day, g.account, g.email,
           (SELECT substr(eg.ref, 1, instr(eg.ref, ':') - 1) FROM entitlement_grant eg
             WHERE eg.email = g.email AND eg.ref LIKE 'mem\\_%' ESCAPE '\\' AND instr(eg.ref, ':') > 0
             ORDER BY eg.created_at DESC LIMIT 1) AS membership
      FROM goodwill g WHERE g.applied = 0 AND g.day > ?`, day - 7 * DAY);
  const started = await all(db, `
    SELECT g.account, g.email, g.stretch,
           CASE WHEN g.account LIKE 'u:%'
                THEN (SELECT m.expires_at FROM membership m WHERE 'u:' || m.user_id = g.account)
                ELSE (SELECT e.expires_at FROM entitlement e WHERE 'e:' || e.email = g.account) END AS until,
           (g.account LIKE 'e:%') AS whop
      FROM goodwill g
     WHERE g.day = ? AND g.stretch = ? AND g.email IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM goodwill_notice n WHERE n.account = g.account AND n.stretch = g.stretch AND n.kind = 'start')`, day, day);
  return { lean: true, pending, started: started.map((s) => ({ ...s, whop: Boolean(s.whop) })) };
}

/** goodwill_whop_applied(): Whop has moved a renewal back. */
export async function goodwillWhopApplied(db: AuthDb, day: number, account: string, membership: string | null, until: number | null): Promise<Rec> {
  const g = await first<{ email: string | null }>(db, 'SELECT email FROM goodwill WHERE day = ? AND account = ?', day, account);
  if (!g?.email) return { ok: false };
  const t = now();
  await run(db, 'UPDATE goodwill SET applied = 1 WHERE day = ? AND account = ?', day, account);
  await run(db, 'UPDATE entitlement SET expires_at = max(expires_at, coalesce(?, expires_at + ?)), updated_at = ? WHERE email = ?', until, DAY, t, g.email);
  if (membership && until) {
    await run(db, `INSERT INTO entitlement_grant (ref, email, plan_id, created_at)
      VALUES (?, ?, coalesce((SELECT plan_id FROM entitlement WHERE email = ?), 'monthly'), ?) ON CONFLICT (ref) DO NOTHING`,
    `${membership}:${until}`, g.email, g.email, t);
  }
  return { ok: true };
}

/** goodwill_noted(): mark an email sent, once. False when it already had been. */
export async function goodwillNoted(db: AuthDb, account: string, stretch: number, kind: string): Promise<boolean> {
  return (await run(db, `INSERT INTO goodwill_notice (account, stretch, kind, sent_at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING`,
    account, stretch, kind, now())) > 0;
}

/** goodwill_ended(): the runs that ended the day before `day`. */
export async function goodwillEnded(db: AuthDb, day: number): Promise<Rec[]> {
  const rows = await all(db, `
    SELECT r.account, r.email, r.stretch, r.days, (r.account LIKE 'e:%') AS whop,
           CASE WHEN r.account LIKE 'u:%'
                THEN (SELECT m.expires_at FROM membership m WHERE 'u:' || m.user_id = r.account)
                ELSE (SELECT e.expires_at FROM entitlement e WHERE 'e:' || e.email = r.account) END AS until
      FROM (
        SELECT g.account, max(g.email) AS email, g.stretch, count(*) AS days, max(g.day) AS last
          FROM goodwill g
         WHERE g.stretch IN (SELECT stretch FROM goodwill WHERE day = ?)
           AND NOT EXISTS (SELECT 1 FROM goodwill x WHERE x.account = g.account AND x.day = ?)
           AND NOT EXISTS (SELECT 1 FROM goodwill_notice n WHERE n.account = g.account AND n.stretch = g.stretch AND n.kind = 'end')
         GROUP BY g.account, g.stretch) r
     WHERE r.last = ? AND r.email IS NOT NULL`, day - DAY, day, day - DAY);
  return rows.map((r) => ({ ...r, whop: Boolean(r.whop) }));
}

/* ---------------------------------------------------------- pulled calls */

/**
 * pulled_claim(): the calls pulled in the last three hours that are still to
 * kick off, the members who want to hear, a notice per pair written before
 * anything is sent, and the calls marked handled. One bundle per member.
 */
export async function pulledClaim(db: AuthDb): Promise<Rec[]> {
  const t = now();
  const calls = await all(db, `SELECT * FROM pulled_call
    WHERE alerted_at IS NULL AND restored_at IS NULL AND kickoff > ? AND pulled_at > ? ORDER BY kickoff`, t, t - 3 * 3600);
  if (!calls.length) return [];
  // Marked handled first, so a second run at the same moment finds nothing.
  const ids = calls.map((c) => c.id);
  const marked = await run(db, `UPDATE pulled_call SET alerted_at = ? WHERE alerted_at IS NULL AND id IN (${ids.map(() => '?').join(', ')})`, t, ...ids);
  if (!marked) return [];
  const members = (await all<{ email: string }>(db, `
    SELECT lower(a.email) AS email FROM membership m JOIN account a ON a.id = m.user_id
      LEFT JOIN profile p ON p.user_id = m.user_id
     WHERE m.expires_at > ? AND coalesce(p.call_alerts, 1) = 1
    UNION
    SELECT lower(e.email) FROM entitlement e
      LEFT JOIN account a ON a.email = lower(e.email)
      LEFT JOIN profile p ON p.user_id = a.id
     WHERE e.status = 'active' AND e.expires_at > ? AND coalesce(p.call_alerts, 1) = 1`, t, t)).map((m) => m.email);
  const out: Rec[] = [];
  for (const email of members) {
    const mine: Rec[] = [];
    for (const c of calls) {
      // Told about a call once, however often the slate pulls it again.
      const told = await first(db, `SELECT 1 AS x FROM pulled_notice n JOIN pulled_call o ON o.id = n.pulled_id
        WHERE n.email = ? AND o.fixture_id = ? AND o.market = ? AND o.outcome = ? AND o.line IS ?`,
      email, c.fixture_id, c.market, c.outcome, c.line);
      if (told) continue;
      if (!await run(db, 'INSERT INTO pulled_notice (pulled_id, email, sent_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING', c.id, email, t)) continue;
      mine.push({ id: c.id, fixture_id: c.fixture_id, kickoff: c.kickoff, home: c.home, away: c.away, label: c.label,
        odds: c.odds, bookmaker: c.bookmaker, reason: c.reason, replaced_by: c.replaced_by });
    }
    if (mine.length) out.push({ email, calls: mine });
  }
  return out;
}
