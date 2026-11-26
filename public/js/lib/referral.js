/**
 * Tell a friend: the reader's side of worker/src/referral.ts.
 *
 * A friend's link is offside.win/?ref=<code>. On arrival the code is kept on
 * this device for thirty days (`ow.ref`, listed in the cookie notice as
 * strictly necessary: it is what the friend came for) and taken out of the
 * address bar, then sent with the sign-in that makes their account. The
 * Worker decides whether it counts; nothing here can give anything away.
 *
 * Sharing, for a signed-in reader: the phone's own share sheet where there is
 * one, else the link copied.
 */

const KEY = 'ow.ref';
const KEEP = 30 * 86400 * 1000;
const CODE = /^[a-hjkmnp-z2-9]{6}$/;

/** Take a friend code off the address, once, before the router runs. */
export function captureRef() {
  try {
    const url = new URL(location.href);
    const raw = (url.searchParams.get('ref') ?? '').trim().toLowerCase();
    if (!url.searchParams.has('ref')) return;
    url.searchParams.delete('ref');
    history.replaceState(null, '', url.toString());
    if (CODE.test(raw)) localStorage.setItem(KEY, JSON.stringify({ code: raw, at: Date.now() }));
  } catch { /* private mode: the link simply does not count */ }
}

/** The friend code this device arrived with, while it is fresh. */
export function storedRef() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (v && CODE.test(v.code) && Date.now() - Number(v.at) < KEEP) return v.code;
  } catch { /* none */ }
  return null;
}

/** Done with it: the account is made, and the Worker has what it needs. */
export function clearRef() {
  try { localStorage.removeItem(KEY); } catch { /* nothing to clear */ }
}

/**
 * Share a link the way this device does it best. Resolves 'shared',
 * 'copied', or 'cancelled'; throws only when neither works, so the page can
 * show the link to copy by hand.
 */
export async function shareLink(link, text) {
  if (navigator.share) {
    try {
      await navigator.share({ title: 'offside.win', text, url: link });
      return 'shared';
    } catch (err) {
      if (err?.name === 'AbortError') return 'cancelled';
    }
  }
  await navigator.clipboard.writeText(link);
  return 'copied';
}
