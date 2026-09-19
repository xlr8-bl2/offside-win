/**
 * Find a photograph for every team we cover, and re-host it.
 *
 * The shape of the job is decided by constraint 2 in sportradar.ts: their IDs
 * are UUIDs and ours are the odds provider's integers, so nothing can be looked
 * up directly. What we do instead is sweep the last few days of action-shot
 * manifests for the competitions we cover, read the club names Getty tagged
 * each photograph with, and match those to our teams by normalised name.
 *
 * That inverts the obvious design — rather than asking "what is the photo for
 * this team", it asks "which of our teams is this photo of" — and it is better
 * for the thing we actually want. Sweeping by date returns what was shot at the
 * weekend, so the photograph of a side is from their most recent match rather
 * than from whenever an archive happens to peak.
 *
 * It is deliberately incremental. A team with a shot from three days ago is
 * left alone; the trial key has a request budget and re-downloading four
 * hundred photographs every night would spend it on nothing.
 */

import { config } from '../config.ts';
import { normalise } from '../occasion.ts';
import { exec, select } from '../store.ts';
import {
  actionShotsByDate,
  type Asset,
  assetUrl,
  bestLink,
  coveredSlugs,
  creditOf,
  describe,
  fetchImage,
  clubCandidates,
} from './sportradar.ts';
import { ensureBucket, put } from './store.ts';

/** How long a photograph stays fresh before we look for a newer one. */
const STALE_DAYS = 10;

export interface SyncReport {
  leagues: number;
  manifests: number;
  assets: number;
  matched: number;
  stored: number;
  skipped: number;
  failed: number;
}

interface TeamRow {
  id: number;
  name: string;
}

/**
 * Our teams, keyed by normalised name.
 *
 * A name can collide — there is more than one "Arsenal" in world football, and
 * several more than one "Atletico". Where it does, every id under that name is
 * kept and none of them is written, because guessing which club a photograph
 * belongs to is exactly the error nobody notices until Arsenal de Sarandí is on
 * the Premier League page.
 */
async function teamsByName(): Promise<Map<string, number[]>> {
  const rows = await select<TeamRow>('SELECT id, name FROM team');
  const out = new Map<string, number[]>();
  for (const t of rows) {
    const k = normalise(t.name);
    if (!k) continue;
    out.set(k, [...(out.get(k) ?? []), Number(t.id)]);
  }
  return out;
}

/** Teams whose photograph is recent enough to leave alone. */
async function fresh(): Promise<Set<number>> {
  const cutoff = Math.floor(Date.now() / 1000) - STALE_DAYS * 86_400;
  const rows = await select<{ team_id: number }>(
    'SELECT team_id FROM team_shot WHERE updated_at > $1',
    [cutoff],
  );
  return new Set(rows.map((r) => Number(r.team_id)));
}

function takenAt(asset: Asset): number | null {
  const t = Date.parse(asset.created ?? '');
  return Number.isFinite(t) ? Math.floor(t / 1000) : null;
}

export async function syncTeamShots(now = new Date()): Promise<SyncReport> {
  const report: SyncReport = {
    leagues: 0, manifests: 0, assets: 0, matched: 0, stored: 0, skipped: 0, failed: 0,
  };
  if (!config.images.key) {
    console.log('SPORTRADAR_GETTY_KEY is not set — no photography to fetch.');
    return report;
  }

  await ensureBucket();
  const byName = await teamsByName();
  const unmatched = new Map<string, number>();
  const done = await fresh();
  const slugs = coveredSlugs();
  report.leagues = slugs.length;

  // Newest day first, so the first photograph a team gets is its most recent.
  const days = Array.from({ length: config.images.days }, (_, i) => {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() - i);
    return d;
  });

  for (const day of days) {
    for (const slug of slugs) {
      let list: Asset[];
      try {
        const m = await actionShotsByDate(slug, day);
        if (!m) continue;
        report.manifests++;
        list = m.assetlist;
        // Where the photographs actually are. A sweep that saw 436 assets one
        // run and 3 the next needs this to tell a quiet day from a lost call.
        if (list.length) console.log(`  ${slug} ${day.toISOString().slice(0, 10)}: ${list.length} assets`);
      } catch (err) {
        // One competition failing is not the sweep failing. A key problem will
        // show up on every league and be obvious in the count; a single 500
        // from one manifest should not cost us the other nineteen.
        report.failed++;
        console.warn(`  ${slug} ${day.toISOString().slice(0, 10)}: ${(err as Error).message}`);
        continue;
      }

      for (const asset of list) {
        report.assets++;
        if (config.images.debug && report.assets <= 5) console.log(`  DEBUG ${describe(asset)}`);
        const link = bestLink(asset.links);
        if (!link) continue;

        // Longest leading group first, and stop at the first one we know.
        let hit = false;
        for (const name of clubCandidates(asset)) {
          if (!byName.has(name)) continue;
          hit = true;
          const ids = byName.get(name);
          if (!ids) continue;
          if (ids.length > 1) { report.skipped++; continue; }
          const teamId = ids[0];
          if (teamId === undefined || done.has(teamId)) continue;

          report.matched++;
          try {
            const { body, type } = await fetchImage(assetUrl(slug, link.href));
            const ext = type.includes('png') ? 'png' : type.includes('webp') ? 'webp' : 'jpg';
            const url = await put(`team/${teamId}.${ext}`, body, type);
            await exec(
              `INSERT INTO team_shot (team_id, url, credit, title, asset_id, width, height, taken_at, updated_at)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
               ON CONFLICT (team_id) DO UPDATE SET
                 url = EXCLUDED.url, credit = EXCLUDED.credit, title = EXCLUDED.title,
                 asset_id = EXCLUDED.asset_id, width = EXCLUDED.width, height = EXCLUDED.height,
                 taken_at = EXCLUDED.taken_at, updated_at = EXCLUDED.updated_at`,
              [
                teamId, url, creditOf(asset), asset.title ?? null, asset.id,
                link.width, link.height, takenAt(asset), Math.floor(Date.now() / 1000),
              ],
            );
            done.add(teamId);
            report.stored++;
            break;
          } catch (err) {
            report.failed++;
            console.warn(`  team ${teamId}: ${(err as Error).message}`);
          }
        }
        // Names Getty used that we have no team for. Capped, because a sweep
        // that matches nothing would otherwise print four hundred lines and
        // bury the one fact worth having: what they call the clubs.
        if (!hit) {
          const guess = clubCandidates(asset)[0];
          if (guess) unmatched.set(guess, (unmatched.get(guess) ?? 0) + 1);
        }
      }
    }
  }

  // The diagnostic that matters when the numbers look wrong. A sweep that sees
  // four hundred assets and matches none of them is a naming problem, and this
  // is the line that says so instead of leaving it to be guessed at.
  if (unmatched.size) {
    const top = [...unmatched.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40);
    console.log(`  no team of ours for ${unmatched.size} names; commonest: ${top.map(([n, c]) => `${n} (${c})`).join(', ')}`);
  }
  return report;
}
