/**
 * Signing in.
 *
 * Supabase Auth, talked to directly from the browser. The Worker is not in the
 * path at all — it has 10ms of CPU and no business verifying tokens — so this
 * module's whole job is to obtain a JWT and hand it to `getJSON`, which puts it
 * in a header that the Worker forwards to Postgres unexamined.
 *
 * Three decisions worth knowing about, because each of them is load-bearing.
 *
 * PKCE, NOT THE IMPLICIT FLOW. The implicit flow returns the session in the URL
 * fragment, as `#access_token=…`. The router does `location.hash.slice(2)` and
 * would read that as a route named `ccess_token=…`, fail to match anything and
 * silently render the home page, having thrown the session away. PKCE returns
 * `?code=…` in the query string instead, which the hash router never looks at.
 *
 * THE SDK IS NOT LOADED FOR PEOPLE WHO ARE NOT SIGNED IN. Almost everyone
 * arriving here is signed out, and making them download an auth library to be
 * told so would be a tax on the page that matters most. Supabase persists its
 * session in localStorage under a predictable key, so the presence of a session
 * can be decided locally, in microseconds, without loading anything. The import
 * happens only when there is a session to restore or a sign-in to perform.
 *
 * NOTHING HERE DECIDES WHAT A READER MAY SEE. A tampered token buys nothing:
 * the Worker forwards it, Postgres rejects it, and the reply is the free copy.
 * Treat everything below as a convenience for the person using the site rather
 * than as a control.
 */

const CONFIG_URL = '/api/config';
const SDK = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

let clientPromise = null;
let cachedConfig = null;

async function config() {
  if (!cachedConfig) {
    const res = await fetch(CONFIG_URL);
    if (!res.ok) throw new Error('Could not reach the sign-in service.');
    cachedConfig = await res.json();
  }
  return cachedConfig;
}

/**
 * Is there a session in this browser at all?
 *
 * Supabase stores it under `sb-<project-ref>-auth-token`. Reading the key
 * rather than the value is deliberate — we only need to know whether loading
 * the SDK is worth it, and the token itself is the SDK's business.
 *
 * Wrapped because localStorage throws outright in some privacy modes rather
 * than returning null, and a signed-out reader hitting an exception here would
 * take the whole page down.
 */
export function hasStoredSession() {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('sb-') && k.endsWith('-auth-token')) return true;
    }
  } catch { /* private mode: treat as signed out */ }
  return false;
}

/** The Supabase client, imported on first genuine need and then reused. */
export async function client() {
  if (!clientPromise) {
    clientPromise = (async () => {
      const cfg = await config();
      const { createClient } = await import(SDK);
      return createClient(cfg.supabaseUrl, cfg.anonKey, {
        auth: {
          flowType: 'pkce',
          persistSession: true,
          autoRefreshToken: true,
          // We run the code exchange ourselves, before the router, so that a
          // half-finished sign-in cannot race a view into rendering.
          detectSessionInUrl: false,
        },
      });
    })();
  }
  return clientPromise;
}

/**
 * The current session, or null.
 *
 * Returns null without loading anything when no session is stored, which is the
 * common case and the reason this is not simply `getSession()`.
 */
export async function session() {
  if (!hasStoredSession()) return null;
  try {
    const { data } = await (await client()).auth.getSession();
    return data.session ?? null;
  } catch {
    // A failed refresh, a cleared project, a network blip. Signed out is the
    // honest answer and the safe one.
    return null;
  }
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
  const meta = s.user.user_metadata ?? {};
  return {
    id: s.user.id,
    email: s.user.email,
    name: meta.full_name || meta.name || null,
    avatar: typeof meta.avatar_url === 'string' && /^https:\/\//.test(meta.avatar_url) ? meta.avatar_url : null,
    provider: s.user.app_metadata?.provider ?? 'email',
    since: s.user.created_at ?? null,
  };
}

/**
 * The Authorization header, when there is one.
 *
 * `getJSON` spreads this into every request. It returns an empty object rather
 * than throwing so that an auth failure can never stop the board loading — the
 * worst case is a request that looks anonymous, which is exactly what it is.
 */
export async function authHeaders() {
  if (viewingAsFree()) return {};
  const s = await session();
  return s?.access_token ? { authorization: `Bearer ${s.access_token}` } : {};
}

/** Where a sign-in should land. Absolute, and without any existing query. */
function redirectTo() {
  return `${location.origin}${location.pathname}`;
}

export async function signInWithEmail(email) {
  const { error } = await (await client()).auth.signInWithOtp({
    email,
    options: { emailRedirectTo: redirectTo() },
  });
  if (error) throw new Error(error.message);
}

export async function signInWithGoogle() {
  const { error } = await (await client()).auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: redirectTo() },
  });
  if (error) throw new Error(error.message);
}

/*
 * Google's own "Sign in with Google" button.
 *
 * The redirect flow (signInWithGoogle below) sends the reader through
 * Supabase's address, so Google's window says "continue to
 * <project>.supabase.co". This button runs on offside.win itself and hands
 * back a signed ID token, so the window says "Sign in to offside.win"; the
 * token goes to Supabase, which checks it against the same Google client and
 * starts the session. Nothing about the account changes, only what the reader
 * is shown.
 *
 * The nonce: Google is given its SHA-256 and signs that into the token;
 * Supabase is given the original and checks the two match, so a token
 * lifted from somewhere else cannot be replayed here.
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
 * Draw Google's button into `el`. Resolves true once it is drawn, false when
 * it cannot be (no client ID configured, script blocked), so the page can
 * fall back to the redirect button.
 */
export async function renderGoogleButton(el, { onSignedIn, onError } = {}) {
  let cfg;
  try { cfg = await config(); } catch { return false; }
  if (!cfg.googleClientId) return false;
  let gsi;
  try { gsi = await loadGsi(); } catch { gsiPromise = null; return false; }
  const raw = [...crypto.getRandomValues(new Uint8Array(24))].map((b) => b.toString(16).padStart(2, '0')).join('');
  gsi.initialize({
    client_id: cfg.googleClientId,
    nonce: await sha256Hex(raw),
    ux_mode: 'popup',
    use_fedcm_for_button: true,
    callback: async ({ credential }) => {
      try {
        const { error } = await (await client()).auth.signInWithIdToken({ provider: 'google', token: credential, nonce: raw });
        if (error) throw new Error(error.message);
        await onSignedIn?.();
      } catch (err) {
        onError?.(err);
      }
    },
  });
  gsi.renderButton(el, {
    type: 'standard', theme: 'filled_black', size: 'large', text: 'continue_with', shape: 'pill',
    logo_alignment: 'left', width: Math.max(200, Math.min(400, Math.round(el.clientWidth || 320))),
  });
  return true;
}

/**
 * Sign out. `everywhere` ends every session this account holds, on every
 * device, which is what someone wants after using a shared computer.
 */
export async function signOut({ everywhere = false } = {}) {
  if (!hasStoredSession()) return;
  try { await (await client()).auth.signOut({ scope: everywhere ? 'global' : 'local' }); } catch { /* already gone */ }
}

/** Call one of the account's own database functions with the reader's session. */
export async function accountRpc(fn, args) {
  const { data, error } = await (await client()).rpc(fn, args);
  if (error) throw new Error(error.message);
  return data;
}

/**
 * Finish a sign-in that is arriving back from a magic link or from Google.
 *
 * Called once, before the router runs. The `?code=` is removed from the address
 * bar afterwards whatever the outcome: a code is single-use, so leaving it
 * there means a refresh trying to redeem it again and failing, which would look
 * to a reader like being signed out for no reason.
 *
 * Returns true when a session was established, so the caller can re-render.
 */
export async function completeSignIn() {
  const url = new URL(location.href);
  const code = url.searchParams.get('code');
  const failed = url.searchParams.get('error_description') ?? url.searchParams.get('error');
  if (!code && !failed) return false;

  url.searchParams.delete('code');
  url.searchParams.delete('error');
  url.searchParams.delete('error_description');
  url.searchParams.delete('state');
  history.replaceState(null, '', url.toString());

  if (failed) throw new Error(failed);

  const { error } = await (await client()).auth.exchangeCodeForSession(code);
  if (error) throw new Error(error.message);
  return true;
}
