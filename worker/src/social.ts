/**
 * The site's own social accounts, set by the owner in the dashboard
 * (#/admin, Overview) rather than typed into the page.
 *
 * The footer used to carry @offsidewin on four networks, guessed, with no
 * account behind any of them known to be ours: a reader who tapped one could
 * land on a stranger. Now an icon shows only once its account is saved here,
 * and the same addresses go into the Organization's `sameAs` on every page
 * the Worker writes, which is how a search engine ties the site to them.
 *
 * Stored in `kv` under one key; read with the service key, which only this
 * Worker holds, and kept for five minutes per instance.
 */

export interface SocialEnv {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  SUPABASE_SERVICE_KEY?: string;
}

export const NETWORKS = ['x', 'instagram', 'telegram', 'youtube'] as const;
export type Network = (typeof NETWORKS)[number];
export type Socials = Partial<Record<Network, string>>;

const KEY = 'site:social';

const RULES: Record<Network, { hosts: RegExp; handle: RegExp; url: (h: string) => string }> = {
  x: { hosts: /^(?:www\.|mobile\.)?(?:x|twitter)\.com$/i, handle: /^[A-Za-z0-9_]{1,15}$/, url: (h) => `https://x.com/${h}` },
  instagram: { hosts: /^(?:www\.)?instagram\.com$/i, handle: /^[A-Za-z0-9._]{1,30}$/, url: (h) => `https://instagram.com/${h}` },
  telegram: { hosts: /^(?:www\.)?(?:t\.me|telegram\.me)$/i, handle: /^[A-Za-z0-9_]{5,32}$/, url: (h) => `https://t.me/${h}` },
  youtube: { hosts: /^(?:www\.|m\.)?youtube\.com$/i, handle: /^[A-Za-z0-9._-]{3,30}$/, url: (h) => `https://youtube.com/@${h}` },
};

/**
 * What the owner typed, as the account's address: a handle with or without
 * its @, or a link to the profile. '' clears it; anything else is undefined,
 * which the dashboard reports rather than saving something that goes nowhere.
 */
export function profileUrl(network: Network, input: unknown): string | null | undefined {
  const raw = String(input ?? '').trim();
  if (!raw) return null;
  const rule = RULES[network];
  let handle = raw;
  // A link has a slash or starts with the network's own address; a handle
  // (Instagram's may contain dots) has neither.
  if (/\//.test(raw) || /^(?:https?:)?(?:www\.|mobile\.|m\.)?(?:x|twitter|instagram|youtube)\.com\b|^(?:t|telegram)\.me\b/i.test(raw)) {
    let u: URL;
    try { u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`); } catch { return undefined; }
    if (!rule.hosts.test(u.hostname)) return undefined;
    handle = u.pathname.split('/').filter(Boolean)[0] ?? '';
  }
  handle = handle.replace(/^@/, '');
  return rule.handle.test(handle) ? rule.url(handle) : undefined;
}

let cached: { at: number; value: Socials } | null = null;

export async function socials(env: SocialEnv): Promise<Socials> {
  if (cached && Date.now() - cached.at < 300_000) return cached.value;
  let value: Socials = {};
  if (env.SUPABASE_SERVICE_KEY) {
    try {
      const res = await fetch(new URL(`/rest/v1/kv?k=eq.${encodeURIComponent(KEY)}&select=v`, env.SUPABASE_URL), {
        headers: { apikey: env.SUPABASE_ANON_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`, accept: 'application/json' },
      });
      const rows = res.ok ? await res.json() as Array<{ v: string }> : [];
      const stored = rows[0] ? JSON.parse(rows[0].v) as Record<string, unknown> : {};
      // Re-checked on the way out: only well-formed addresses reach a page.
      for (const n of NETWORKS) { const u = profileUrl(n, stored[n]); if (u) value[n] = u; }
    } catch { value = {}; }
  }
  cached = { at: Date.now(), value };
  return value;
}

export async function saveSocials(env: SocialEnv, next: Socials): Promise<boolean> {
  if (!env.SUPABASE_SERVICE_KEY) return false;
  const now = Math.floor(Date.now() / 1000);
  const res = await fetch(new URL('/rest/v1/kv', env.SUPABASE_URL), {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_ANON_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      'content-type': 'application/json', prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify({ k: KEY, v: JSON.stringify(next), updated_at: now }),
  });
  if (res.ok) cached = { at: Date.now(), value: next };
  return res.ok;
}

/** The written page with its Organization tied to these accounts, and its footer showing only them. */
export function withSocials(html: string, links: Socials): string {
  const urls = NETWORKS.map((n) => links[n]).filter((u): u is string => Boolean(u));
  let out = html;
  if (urls.length) {
    out = out.replace(/("@id":"https:\/\/offside\.win\/#org","name":"Offside\.win",)/, `$1"sameAs":${JSON.stringify(urls).replace(/</g, '\\u003c')},`);
  }
  if (urls.length) out = out.replace('<div class="foot-follow" data-socials hidden>', '<div class="foot-follow" data-socials>');
  // Each footer icon carries data-social="<network>" and starts hidden.
  return out.replace(/<a data-social="(x|instagram|telegram|youtube)" href="[^"]*" hidden/g, (all, n: Network) => {
    const u = links[n];
    return u ? `<a data-social="${n}" href="${u}"` : all;
  });
}
