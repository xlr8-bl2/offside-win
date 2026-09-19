/**
 * Supabase Storage, as the public home for re-hosted photography.
 *
 * Why here and not the repository: the images are agency-licensed, this
 * repository is public, and a git history is forever. A storage bucket can be
 * emptied when a licence ends; a commit cannot. It also keeps a few hundred
 * megabytes of JPEG out of every clone and every deploy.
 *
 * Why not Cloudflare, given the Worker is there: the bucket needs a writer, and
 * the only credential this project already holds with write access is the
 * Supabase service key. Adding an R2 token would be a fourth secret and a
 * second thing to rotate for no gain a reader would notice.
 */

import { config } from '../config.ts';

function must(): { url: string; key: string } {
  const { url, key } = config.storage;
  if (!url) throw new Error('SUPABASE_URL is required to store images.');
  if (!key) throw new Error('SUPABASE_SERVICE_KEY is required to store images.');
  return { url, key };
}

/**
 * Create the bucket if it is not there, public-read.
 *
 * Public is the point: the whole reason for copying these out of Sportradar is
 * that a browser cannot send the API key. A signed URL per image would work and
 * would expire, which means every page load re-signing every crest through a
 * Worker that has a ten-millisecond CPU budget.
 */
export async function ensureBucket(): Promise<void> {
  const { url, key } = must();
  const res = await fetch(`${url}/storage/v1/bucket`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${key}`,
      apikey: key,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      id: config.storage.bucket,
      name: config.storage.bucket,
      public: true,
      file_size_limit: 8 * 1024 * 1024,
      allowed_mime_types: ['image/jpeg', 'image/png', 'image/webp'],
    }),
  });
  if (res.ok) return;

  /*
   * "Already there" is the answer on every run after the first, and Supabase
   * does not say it with a 409. It returns 400 with a `Duplicate` error in the
   * body, so checking the status alone failed the second run of this job and
   * every run after it. Rather than collect status codes by trial, ask whether
   * the bucket exists and only fail when it genuinely does not.
   */
  const body = await res.text();
  const head = await fetch(`${url}/storage/v1/bucket/${config.storage.bucket}`, {
    headers: { authorization: `Bearer ${key}`, apikey: key },
  });
  if (head.ok) return;

  throw new Error(
    `could not create bucket "${config.storage.bucket}": ${res.status} ${body} `
    + `(and it does not already exist: ${head.status})`,
  );
}

/** Upload, overwriting whatever was at that path. Returns the public URL. */
export async function put(path: string, body: Uint8Array, contentType: string): Promise<string> {
  const { url, key } = must();
  const res = await fetch(`${url}/storage/v1/object/${config.storage.bucket}/${path}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${key}`,
      apikey: key,
      'content-type': contentType,
      'cache-control': 'public, max-age=604800',
      'x-upsert': 'true',
    },
    body,
  });
  if (!res.ok) throw new Error(`upload failed for ${path}: ${res.status} ${await res.text()}`);
  return publicUrl(path);
}

export function publicUrl(path: string): string {
  return `${config.storage.url}/storage/v1/object/public/${config.storage.bucket}/${path}`;
}
