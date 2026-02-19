/**
 * Cosmic Coder SEP-10 auth API (client).
 * Flow: getChallenge(account) → user signs with Freighter → postToken(signedXdr) → store JWT.
 * All auth is server-verified; no simulated or client-only auth.
 * @see https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0010.md
 */

const STORAGE_KEY = 'cosmicCoderJwt';

/** API base URL: build-time env, then runtime config.json (__VITE_CONFIG__), then window override. */
function getApiBase() {
  const fromEnv = typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_URL;
  if (fromEnv) return import.meta.env.VITE_API_URL.replace(/\/$/, '');
  if (typeof window !== 'undefined' && window.__VITE_CONFIG__?.VITE_API_URL) {
    return String(window.__VITE_CONFIG__.VITE_API_URL).replace(/\/$/, '');
  }
  if (typeof window !== 'undefined' && window.VIBE_CODER_API_URL) return window.VIBE_CODER_API_URL.replace(/\/$/, '');
  return '';
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

/**
 * 1. Request challenge from backend (SEP-10 GET challenge).
 * @param {string} account - Stellar public key (G...)
 * @returns {Promise<{ transaction: string, network_passphrase: string }>}
 */
export async function getChallenge(account) {
  const base = getApiBase() || (typeof location !== 'undefined' ? location.origin.replace(/\/$/, '') : '');
  const url = `${base}/auth/challenge?account=${encodeURIComponent(account)}`;
  const res = await fetch(url, { method: 'GET', credentials: 'omit' });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Challenge failed: ${res.status}`);
  }
  return res.json();
}

/**
 * 2. Submit signed challenge to backend (SEP-10 POST token).
 * @param {string} signedTransactionXdr - Base64 signed challenge from Freighter
 * @returns {Promise<{ token: string, public_key: string }>}
 */
export async function postToken(signedTransactionXdr) {
  const base = getApiBase() || (typeof location !== 'undefined' ? location.origin.replace(/\/$/, '') : '');
  const url = `${base}/auth/token`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transaction: signedTransactionXdr }),
    credentials: 'omit'
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Token exchange failed: ${res.status}`);
  }
  return res.json();
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
 * @param {string} publicKey - From Freighter (getAddress)
 * @param {function(string, string): Promise<string>} signTransaction - (xdr, networkPassphrase) => signedXdr
 * @returns {Promise<{ token: string, public_key: string }>}
 */
export async function loginWithSep10(publicKey, signTransaction) {
  const { transaction, network_passphrase } = await getChallenge(publicKey);
  const signedXdr = await signTransaction(transaction, network_passphrase);
  const result = await postToken(signedXdr);
  setStoredToken(result.token);
  return result;
}
