/**
 * Cosmic Coder SEP-10 auth API (client).
 * Flow: getChallenge(account) → user signs with Freighter → postToken(signedXdr) → store JWT.
 * All auth is server-verified; no simulated or client-only auth.
 * @see https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0010.md
 */

const STORAGE_KEY = 'cosmicCoderJwt';

/** Default backend when no env is set (e.g. build without .env). */
const DEFAULT_API_BASE = 'https://cosmic-coder.onrender.com';

/** API base URL: build-time env, then runtime config, then window override, then default. */
function getApiBase() {
  const fromEnv = typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_URL;
  if (fromEnv) return String(import.meta.env.VITE_API_URL).replace(/\/$/, '');
  if (typeof window !== 'undefined' && window.__VITE_CONFIG__?.VITE_API_URL) {
    return String(window.__VITE_CONFIG__.VITE_API_URL).replace(/\/$/, '');
  }
  if (typeof window !== 'undefined' && window.VIBE_CODER_API_URL) {
    return String(window.VIBE_CODER_API_URL).replace(/\/$/, '');
  }
  return DEFAULT_API_BASE;
}

let inMemoryToken = null;

/**
 * Get stored JWT (memory first, then localStorage for persistence across reloads).
 * We still send this to the server on every protected request; server verifies (no localStorage-only trust).
 */
export function getStoredToken() {
  if (inMemoryToken) return inMemoryToken;
  try {
    const t = localStorage.getItem(STORAGE_KEY);
    if (t) inMemoryToken = t;
    return t;
  } catch (_) {}
  return null;
}

export function setStoredToken(token) {
  inMemoryToken = token;
  try {
    if (token) localStorage.setItem(STORAGE_KEY, token);
    else localStorage.removeItem(STORAGE_KEY);
  } catch (_) {}
}

export function clearStoredToken() {
  inMemoryToken = null;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (_) {}
}

/** Timeout for auth fetch (challenge/token) to avoid infinite loading. */
const AUTH_FETCH_TIMEOUT_MS = 15000;

function fetchWithTimeout(url, options = {}, timeoutMs = AUTH_FETCH_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), timeoutMs);
  return fetch(url, { ...options, signal: ctrl.signal }).finally(() => clearTimeout(id));
}

/**
 * 1. Request challenge from backend (SEP-10 GET challenge).
 * @param {string} account - Stellar public key (G...)
 * @param {number} [timeoutMs] - Request timeout (default 15s)
 * @returns {Promise<{ transaction: string, network_passphrase: string }>}
 */
export async function getChallenge(account, timeoutMs = AUTH_FETCH_TIMEOUT_MS) {
  const base = getApiBase();
  const standardUrl = `${base}/auth?account=${encodeURIComponent(account)}`;
  let res;
  try {
    res = await fetchWithTimeout(standardUrl, { method: 'GET', credentials: 'omit' }, timeoutMs);
  } catch (e) {
    if (e?.name === 'AbortError') throw new Error('El servidor no respondió a tiempo. Intenta de nuevo.');
    throw e;
  }
  // Backward-compat fallback for older backends
  if (res.status === 404 || res.status === 405) {
    const legacyUrl = `${base}/auth/challenge?account=${encodeURIComponent(account)}`;
    res = await fetchWithTimeout(legacyUrl, { method: 'GET', credentials: 'omit' }, timeoutMs);
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const msg = body.error || body.message || `Challenge failed: ${res.status}`;
    throw new Error(msg);
  }
  return res.json();
}

/**
 * 2. Submit signed challenge to backend (SEP-10 POST token).
 * @param {string} signedTransactionXdr - Base64 signed challenge from Freighter
 * @param {number} [timeoutMs] - Request timeout (default 15s)
 * @returns {Promise<{ token: string, public_key: string }>}
 */
export async function postToken(signedTransactionXdr, timeoutMs = AUTH_FETCH_TIMEOUT_MS) {
  const base = getApiBase();
  const standardUrl = `${base}/auth`;
  const postOpts = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transaction: signedTransactionXdr }),
    credentials: 'omit'
  };
  let res;
  try {
    res = await fetchWithTimeout(standardUrl, postOpts, timeoutMs);
  } catch (e) {
    if (e?.name === 'AbortError') throw new Error('El servidor no respondió a tiempo. Intenta de nuevo.');
    throw e;
  }
  // Backward-compat fallback for older backends
  if (res.status === 404 || res.status === 405) {
    const legacyUrl = `${base}/auth/token`;
    res = await fetchWithTimeout(legacyUrl, postOpts, timeoutMs);
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const msg = body.error || body.message || `Token exchange failed: ${res.status}`;
    throw new Error(msg);
  }
  const data = await res.json();
  if (!data || !data.token) throw new Error('Server did not return a token');
  return data;
}

/**
 * 3. Get current user (protected). Requires valid JWT.
 * @returns {Promise<{ public_key: string, username: string|null, created_at: string, updated_at: string }>}
 */
export async function getMe() {
  const token = getStoredToken();
  if (!token) throw new Error('Not authenticated');
  const base = getApiBase() || (typeof location !== 'undefined' ? location.origin.replace(/\/$/, '') : '');
  const res = await fetch(`${base}/auth/me`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
    credentials: 'omit'
  });
  if (res.status === 401) {
    clearStoredToken();
    throw new Error('Session expired');
  }
  if (!res.ok) throw new Error('Failed to load profile');
  return res.json();
}

/**
 * 4. Update username (protected).
 * @param {string} username
 */
export async function updateMeUsername(username) {
  const token = getStoredToken();
  if (!token) throw new Error('Not authenticated');
  const base = getApiBase() || (typeof location !== 'undefined' ? location.origin.replace(/\/$/, '') : '');
  const res = await fetch(`${base}/auth/me/username`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ username: username ? String(username).trim().slice(0, 64) : null }),
    credentials: 'omit'
  });
  if (res.status === 401) {
    clearStoredToken();
    throw new Error('Session expired');
  }
  if (!res.ok) throw new Error('Failed to update username');
  return res.json();
}

/**
 * Full SEP-10 login: get challenge → sign with signTransaction → post token → store JWT.
 * All steps are time-bounded so the UI never hangs indefinitely.
 * @param {string} publicKey - From Freighter (getAddress)
 * @param {function(string, string): Promise<string>} signTransaction - (xdr, networkPassphrase) => signedXdr
 * @param {object} [options] - Optional settings
 * @param {number} [options.timeoutMs=60000] - Timeout for signing in milliseconds
 * @returns {Promise<{ token: string, public_key: string }>}
 */
export async function loginWithSep10(publicKey, signTransaction, options = {}) {
  const signTimeoutMs = options.timeoutMs || 60000;

  const { transaction, network_passphrase } = await getChallenge(publicKey);

  const signWithTimeout = Promise.race([
    signTransaction(transaction, network_passphrase),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Firma cancelada o Freighter no respondió. Intenta de nuevo.')), signTimeoutMs)
    )
  ]);

  const signedXdr = await signWithTimeout;
  const result = await postToken(signedXdr);
  setStoredToken(result.token);
  return result;
}
