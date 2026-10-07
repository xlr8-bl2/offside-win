/**
 * Signing in.
 *
 * The Worker issues the sessions (worker/src/auth.ts, since the move off
 * Supabase in October 2026). Signing in ends with a session token, kept in
 * this browser under `ow.session` and sent as `Authorization: Bearer` with
 * every read, which the Worker turns into the reader's account and membership.
 *
 * Two ways in:
 *
 * EMAIL LINK. The email links to the site with `?signin=<token>`, and
 * completeSignIn() redeems it with a POST before the router runs. The link
 * itself does nothing when opened, so a mail scanner that follows every link
 * cannot spend it. The query string, not the hash: the hash router would read
 * a token there as a route.
 *
 * GOOGLE. Google hands back a signed ID token (by redirect, or from its own
 * button), which goes to the Worker with the nonce Google was asked to sign.
 *
 * NOTHING HERE DECIDES WHAT A READER MAY SEE. A made-up token buys nothing:
 * the Worker finds no session for it and answers with the free copy. Treat
 * everything below as a convenience for the person using the site rather than
 * as a control.
 */

const CONFIG_URL = '/api/config';
const KEY = 'ow.session';

let cachedConfig = null;

async function config() {
  if (!cachedConfig) {
    // Revalidated every time: a stale copy is how the Google button went missing.
    const res = await fetch(CONFIG_URL, { cache: 'no-cache' });
    if (!res.ok) throw new Error('Could not reach the sign-in service.');
    cachedConfig = await res.json();
  }
  return cachedConfig;
}

/** The site's public settings (Google's client id, Whop's public account id). */
export const siteConfig = () => config();

/*
 * Supabase's saved sessions, from before the move. They sign nobody in any
 * more, and left in place they would keep the page acting signed in. Cleared
 * once, on load. Wrapped because localStorage throws outright in some privacy
 * modes rather than returning null.
 */
try {
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const k = localStorage.key(i);
    if (k && k.startsWith('sb-') && k.endsWith('-auth-token')) localStorage.removeItem(k);
  }
} catch { /* private mode */ }

/** The saved session, if it has not run out: `{ token, expires_at, user }`. */
function stored() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (s?.token && s?.user?.id && Number(s.expires_at) * 1000 > Date.now()) return s;
  } catch { /* private mode, or a value we do not recognise */ }
  return null;
}

function save(s) {
  try {
    if (s) localStorage.setItem(KEY, JSON.stringify({ token: s.session ?? s.token, expires_at: s.expires_at, user: s.user }));
    else localStorage.removeItem(KEY);
  } catch { /* private mode: signed in for this page only */ }
  memory = s ? { token: s.session ?? s.token, expires_at: s.expires_at, user: s.user } : null;
}
/** For a browser that will not store anything: the session lives as long as the page. */
let memory = null;

/** Is there a session in this browser at all? Decided locally, without a request. */
export function hasStoredSession() {
  return Boolean(stored() ?? memory);
}

async function post(path, body, token) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body ?? {}),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(out?.error || `HTTP ${res.status}`), { status: res.status });
  return out;
}

/*
 * Once per page, after it has drawn: ask the Worker whether the session still
 * stands. It extends a session in use, and a session ended elsewhere (signed
 * out everywhere, or the account deleted) is forgotten here too.
 */
let checked = false;
function checkLater() {
  if (checked) return;
  checked = true;
  const go = async () => {
    const s = stored() ?? memory;
    if (!s) return;
    try {
      const res = await fetch('/api/auth/me', { headers: { authorization: `Bearer ${s.token}` }, cache: 'no-store' });
      if (res.status === 401) { save(null); return; }
      if (!res.ok) return;
      const me = await res.json();
      save({ token: s.token, expires_at: me.expires_at ?? s.expires_at, user: me.user ?? s.user });
    } catch { /* offline: keep what we have */ }
  };
  if ('requestIdleCallback' in window) requestIdleCallback(go, { timeout: 4000 });
  else setTimeout(go, 1500);
}

/** The current session, or null. */
export async function session() {
  const s = stored() ?? memory;
  if (s) checkLater();
  return s;
}

/** Convenience for the views: who is signed in, in the two fields they use. */
/*
 * The owner's "view as" switch.
 *
 * Set from #/dev and kept in this browser only. While it is on, every read
 * goes out without a token and every view renders as it would for someone
 * who has never signed in -- which is the only honest way to check the free
 * side of a paywall from an account that is behind it. #/dev reads the real
 * session through `real: true`, and the header shows a pill so it is never
 * left on by accident.
 */
const VIEW_AS_KEY = 'ow.viewas';
export function viewingAsFree() {
  try { return localStorage.getItem(VIEW_AS_KEY) === 'free'; } catch { return false; }
}
export function setViewAs(mode) {
  try {
    if (mode === 'free') localStorage.setItem(VIEW_AS_KEY, 'free');
    else localStorage.removeItem(VIEW_AS_KEY);
  } catch { /* private mode */ }
}

export async function currentUser({ real = false } = {}) {
  if (!real && viewingAsFree()) return null;
  const s = await session();
  if (!s) return null;
  // What the account page shows about the person: the name and picture
  // Google hands over (nothing, for an email sign-in), how they signed in,
  // and since when.
  const u = s.user;
  return {
    id: u.id,
    email: u.email,
    name: u.name || null,
    avatar: typeof u.avatar === 'string' && /^https:\/\//.test(u.avatar) ? u.avatar : null,
    provider: u.provider ?? 'email',
    since: u.since ?? null,
  };
}

/**
 * The Authorization header, when there is one.
 *
 * `getJSON` spreads this into every request. It returns an empty object rather
 * than throwing so that an auth failure can never stop the board loading — the
 * worst case is a request that looks anonymous, which is exactly what it is.
 */
export async function authHeaders({ real = false } = {}) {
  if (!real && viewingAsFree()) return {};
  const s = await session();
  return s?.token ? { authorization: `Bearer ${s.token}` } : {};
}

/** Where a sign-in should land. Absolute, and without any existing query. */
function redirectTo() {
  return `${location.origin}${location.pathname}`;
}

export async function signInWithEmail(email) {
  await post('/api/auth/link', { email, redirect: redirectTo() });
}

/** Google by redirect is the only Google there is now; kept under the old name for the sign-in page. */
export async function signInWithGoogle() {
  return signInWithGoogleRedirect();
}

/** Google's ID token for a session. `nonce` is the original, whose hash Google signed. */
async function googleSession(token, nonce) {
  save(await post('/api/auth/google', { id_token: token, nonce }));
}

/*
 * Google's own "Sign in with Google" button.
 *
 * Used only while the redirect (GOOGLE_REDIRECT) is switched off. It runs on
 * offside.win itself and hands back a signed ID token, which goes to the
 * Worker (worker/src/auth.ts) to be checked and turned into a session.
 *
 * The nonce: Google is given its SHA-256 and signs that into the token; the
 * Worker is given the original and checks the two match, so a token lifted
 * from somewhere else cannot be replayed here.
 *
 * Google's script is loaded only when the sign-in page asks for the button.
 */
const GSI = 'https://accounts.google.com/gsi/client';
let gsiPromise = null;
function loadGsi() {
  gsiPromise ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = GSI;
    s.async = true;
    s.onload = () => (window.google?.accounts?.id ? resolve(window.google.accounts.id) : reject(new Error('Google sign-in did not start')));
    s.onerror = () => reject(new Error('Google sign-in could not load'));
    setTimeout(() => reject(new Error('Google sign-in took too long to load')), 8000);
    document.head.append(s);
  });
  return gsiPromise;
}
async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Start fetching what sign-in needs, on the tap that heads for the sign-in
 * page rather than once it has drawn. Only then: loading Google's script on
 * every page would tell Google about every visit.
 */
export function warmSignIn() {
  config().then((cfg) => {
    if (cfg.googleRedirect) prepareGoogleRedirect();
    else loadGsi().catch(() => { gsiPromise = null; });
  }).catch(() => {});
}

/*
 * Google by redirect: the page goes to Google and Google sends it back.
 *
 * On a phone this is what reads as native. Google's own button is a frame its
 * script draws after the page has loaded, and on iOS it opens a second tab
 * for the account picker and closes it again; both showed as a button that
 * arrived late, flickered, and hung after the tap. Here the button is ours,
 * drawn with the page, and the tap is an ordinary page load.
 *
 * Google returns a signed ID token in the address fragment; the Worker checks
 * it, exactly as for the frame's token. The nonce works the same way (Google
 * signs its hash; the Worker is given the original), and the state value ties
 * the answer to the tab that asked.
 */
const GOOGLE_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const PENDING = 'offside-google-pending';
const randomHex = (n) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, '0')).join('');

export async function googleRedirectReady() {
  try { const cfg = await config(); return Boolean(cfg.googleClientId && cfg.googleRedirect); } catch { return false; }
}

/*
 * Google's address is worked out while the sign-in page draws (the config, a
 * nonce and its hash), not after the tap. Done after, it was a network round
 * trip and a hash between the tap and anything happening, which on a phone
 * read as a dead button.
 */
let preparedGoogle = null;
export function prepareGoogleRedirect() {
  preparedGoogle ??= (async () => {
    const cfg = await config();
    if (!cfg.googleClientId || !cfg.googleRedirect) return null;
    const raw = randomHex(24);
    const state = randomHex(16);
    const url = new URL(GOOGLE_AUTH);
    url.search = new URLSearchParams({
      client_id: cfg.googleClientId,
      redirect_uri: `${location.origin}/`,
      response_type: 'id_token',
      scope: 'openid email profile',
      nonce: await sha256Hex(raw),
      state,
      prompt: 'select_account',
    }).toString();
    return { url: url.toString(), raw, state };
  })().catch(() => { preparedGoogle = null; return null; });
  return preparedGoogle;
}

export async function signInWithGoogleRedirect() {
  const p = await prepareGoogleRedirect();
  if (!p) throw new Error('Google sign-in is not available at the moment.');
  // One use: a nonce is never sent to Google twice.
  preparedGoogle = null;
  sessionStorage.setItem(PENDING, JSON.stringify({ raw: p.raw, state: p.state }));
  location.assign(p.url);
}

/** Is this page load Google handing back an answer? */
export function isGoogleReturn() {
  if (!location.hash.includes('state=')) return false;
  const back = new URLSearchParams(location.hash.slice(1));
  return back.has('state') && (back.has('id_token') || back.has('error'));
}

async function completeGoogleReturn() {
  const back = new URLSearchParams(location.hash.slice(1));
  history.replaceState(null, '', `${location.pathname}${location.search}`);
  let pending = null;
  try { pending = JSON.parse(sessionStorage.getItem(PENDING) ?? 'null'); sessionStorage.removeItem(PENDING); } catch { /* private mode */ }
  const fail = (message) => Object.assign(new Error(message), { google: true });
  if (back.get('error')) throw fail(back.get('error') === 'access_denied' ? 'cancelled' : back.get('error'));
  if (!pending || pending.state !== back.get('state')) throw fail('state');
  const token = back.get('id_token');
  if (!token) throw fail('no token');
  try { await googleSession(token, pending.raw); } catch (err) { throw fail(err.message); }
  return true;
}


/**
 * Draw Google's button into `el`. Resolves true once it is drawn, false when
 * it cannot be (no client ID configured, script blocked), so the page can
 * fall back to the redirect button.
 */
export async function renderGoogleButton(el, { onSignedIn, onError, onWorking } = {}) {
  // The config and Google's script are fetched side by side, not one after
  // the other: in a row they were most of a second on a phone.
  let cfg, gsi;
  try { [cfg, gsi] = await Promise.all([config(), loadGsi()]); } catch { gsiPromise = null; return false; }
  if (!cfg.googleClientId) return false;
  const raw = [...crypto.getRandomValues(new Uint8Array(24))].map((b) => b.toString(16).padStart(2, '0')).join('');
  gsi.initialize({
    client_id: cfg.googleClientId,
    nonce: await sha256Hex(raw),
    ux_mode: 'popup',
    use_fedcm_for_button: true,
    callback: async ({ credential }) => {
      onWorking?.();
      try {
        await googleSession(credential, raw);
        await onSignedIn?.();
      } catch (err) {
        onError?.(err);
      }
    },
  });
  // The site is in English, so the button is too, whatever the phone's language.
  gsi.renderButton(el, {
    type: 'standard', theme: 'filled_black', size: 'large', text: 'continue_with', shape: 'pill',
    logo_alignment: 'left', locale: 'en-GB', width: googleButtonWidth(el),
  });
  return true;
}

/** Google draws its button between 200 and 400px wide. */
function googleButtonWidth(el) {
  return Math.max(200, Math.min(400, Math.round(el.clientWidth || 320)));
}

/**
 * Sign out. `everywhere` ends every session this account holds, on every
 * device, which is what someone wants after using a shared computer.
 */
export async function signOut({ everywhere = false } = {}) {
  const s = stored() ?? memory;
  save(null);
  if (!s) return;
  try { await post('/api/auth/signout', { everywhere }, s.token); } catch { /* already gone */ }
}

/** One of the account's own settings, written with the reader's session (worker/src/profile.ts). */
export async function accountRpc(fn, args) {
  const s = stored() ?? memory;
  if (!s) throw new Error('sign in first');
  return post(`/api/account/${encodeURIComponent(fn)}`, args, s.token);
}

/**
 * Finish a sign-in that is arriving back from an email link or from Google.
 *
 * Called once, before the router runs. The token is removed from the address
 * bar afterwards whatever the outcome: it is single-use, so leaving it there
 * means a refresh trying to redeem it again and failing, which would look to
 * a reader like being signed out for no reason.
 *
 * Returns true when a session was established, so the caller can re-render.
 */
export async function completeSignIn() {
  if (isGoogleReturn()) return completeGoogleReturn();
  const url = new URL(location.href);
  const token = url.searchParams.get('signin');
  // Links sent by Supabase before the move: they can no longer be redeemed.
  const old = url.searchParams.get('token_hash') || url.searchParams.get('code');
  if (!token && !old) return false;
  for (const k of ['signin', 'token_hash', 'type', 'code', 'error', 'error_description', 'state']) url.searchParams.delete(k);
  history.replaceState(null, '', url.toString());
  if (!token) throw new Error('expired');
  try {
    save(await post('/api/auth/verify', { token }));
  } catch (err) {
    throw new Error(err.status === 401 ? 'expired' : err.message);
  }
  return true;
}
