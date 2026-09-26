/**
 * The ground a match is played at, by name.
 *
 * The provider puts only a venue id on each event; the name, city and
 * capacity sit behind /api/v2/venues/{id}/. The match page used to title the
 * photograph "The ground", which says nothing a reader did not already know.
 * So each ground is looked up once, stored, and read back through get_fixture.
 *
 * A ground the provider cannot describe is stored with an empty name, so it
 * is tried once rather than on every slate.
 */

import { bsdOrNull, num, str } from '../bsd.ts';
import { exec, select } from '../store.ts';

export interface Venue { name: string; city: string; capacity: number | null }

/** The provider's venue record, read defensively: its fields are not typed. */
export function parseVenue(raw: unknown): Venue | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const name = (str(r['name']) || str(r['venue_name']) || str(r['stadium']) || '').trim();
  if (!name) return null;
  const cityRaw = r['city'];
  const city = ((typeof cityRaw === 'object' && cityRaw ? str((cityRaw as Record<string, unknown>)['name']) : str(cityRaw)) || '').trim();
  const cap = num(r['capacity']);
  return { name, city, capacity: cap && cap > 0 ? Math.round(cap) : null };
}

/** Look up the grounds in `ids` that have not been tried yet. Bounded per run. */
export async function fillVenues(ids: Iterable<number>, { limit = 60 } = {}): Promise<number> {
  const wanted = [...new Set([...ids].filter((id) => Number.isFinite(id) && id > 0))];
  if (!wanted.length) return 0;
  const known = new Set(
    (await select<{ id: number | string }>(
      `SELECT id FROM venue WHERE id IN (${wanted.map(() => '?').join(',')})`, wanted,
    )).map((r) => Number(r.id)),
  );
  const now = Math.floor(Date.now() / 1000);
  let done = 0;
  for (const id of wanted.filter((v) => !known.has(v)).slice(0, limit)) {
    const v = parseVenue(await bsdOrNull(`/api/v2/venues/${id}/`));
    await exec(
      `INSERT INTO venue (id, name, city, capacity, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET name = excluded.name, city = excluded.city,
         capacity = excluded.capacity, updated_at = excluded.updated_at`,
      [id, v?.name ?? '', v?.city ?? '', v?.capacity ?? null, now],
    );
    if (v) done++;
  }
  return done;
}
