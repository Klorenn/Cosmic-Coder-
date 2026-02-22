/**
 * Freighter only – connect and sign with the Freighter extension.
 * @see https://docs.freighter.app/docs/
 * Install: npm install @stellar/freighter-api
 */

import Freighter from '@stellar/freighter-api';

let cachedAddress = null;

const STORAGE_KEY = 'cosmicCoderWalletAddress';
const TESTNET_PASSPHRASE = 'Test SDF Network ; September 2015';

function loadCached() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) cachedAddress = saved;
  } catch (_) {}
}
loadCached();

/**
 * Check if Freighter extension is available.
 * @returns {Promise<boolean>}
 */
export async function isFreighterAvailable() {
  try {
    const { isConnected: connected, error } = await Freighter.isConnected();
    return !error && !!connected;
  } catch (_) {
    return false;
  }
}

/** Default timeout for connect (ms) – avoids infinite hang if extension is slow. */
const CONNECT_TIMEOUT_MS = 20000;

/**
 * Connect wallet: asks Freighter for access and returns the address.
 * Does NOT persist: call confirmConnection(addr) only after the user has signed (e.g. SEP-10 login).
 * @param {object} [options]
 * @param {number} [options.timeoutMs=20000] - Max wait for Freighter; after this, returns null.
 * @returns {Promise<string|null>} address or null if user denied / closed popup / not installed / timeout
 */
export async function connect(options = {}) {
  const timeoutMs = options.timeoutMs ?? CONNECT_TIMEOUT_MS;
  try {
    const accessPromise = Freighter.requestAccess();
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('FREIGHTER_TIMEOUT')), timeoutMs)
    );
    const res = await Promise.race([accessPromise, timeoutPromise]);
    const address = res?.address || res?.publicKey;
    if (res?.error || !address) return null;
    // Do NOT set cachedAddress here – only after user has signed (confirmConnection).
    return address;
  } catch (e) {
    console.warn('Freighter requestAccess failed:', e);
    return null;
  }
}

/**
 * Mark wallet as connected and persist address. Call this only after the user has signed
 * (e.g. after SEP-10 login succeeds). Until then, connect() only returns an address.
 */
export function confirmConnection(address) {
  if (!address) return;
  cachedAddress = address;
  try {
    localStorage.setItem(STORAGE_KEY, address);
  } catch (_) {}
}

/**
 * Get current wallet address from app cache / localStorage only.
 * NO auto-reconnect to Freighter here — connect() is the only place
 * that is allowed to ask the extension for access.
 * @returns {Promise<string|null>}
 */
export async function getAddress() {
  if (cachedAddress) return cachedAddress;
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      cachedAddress = saved;
      return cachedAddress;
    }
  } catch (_) {}
  return null;
}

/**
 * Disconnect: clear cache and storage.
 */
export function disconnect() {
  cachedAddress = null;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (_) {}
}

/**
 * Whether we have an address (connected).
 */
export function isConnected() {
  return !!cachedAddress;
}

/**
 * Short address for UI (e.g. GABC...xyz).
 */
export function shortAddress(address, chars = 6) {
  if (!address || address.length <= chars * 2) return address || '';
  return `${address.slice(0, chars)}...${address.slice(-chars)}`;
}

/**
 * Short wallet format for leaderboard (first 4 + last 4 chars).
 * Converts 0x1234567890ABCDEF1234 to 0x1234...1234
 * @param {string} address - Full wallet address
 * @returns {string} Shortened address
 */
export function shortWalletForLeaderboard(address) {
  if (!address || address.length <= 10) return address || '';
  const prefix = address.slice(0, 6); // includes 0x + 4 chars
  const suffix = address.slice(-4);
  return `${prefix}...${suffix}`;
}

/**
 * Get current network from Freighter (to detect Mainnet vs Testnet).
 * @returns {Promise<{ network: string, networkPassphrase: string }|null>}
 */
export async function getFreighterNetwork() {
  try {
    const res = await Freighter.getNetwork();
    if (res?.error) return null;
    if (res?.networkPassphrase) return { network: res.network || '', networkPassphrase: res.networkPassphrase };
    return null;
  } catch (_) {
    return null;
  }
}

/** Stellar Testnet passphrase (contracts are on Testnet). */
export const STELLAR_TESTNET_PASSPHRASE = TESTNET_PASSPHRASE;

/**
 * Sign a transaction XDR (for Soroban / Game Hub).
 * @param {string} xdr - base64 transaction XDR
 * @param {string} [networkPassphrase] - default testnet
 * @param {string} [address] - optional; use this address to sign (e.g. from connect() before confirmConnection)
 * @returns {Promise<string>} signed XDR base64
 */
export async function signTransaction(xdr, networkPassphrase = TESTNET_PASSPHRASE, address) {
  const addr = address || (await getAddress());
  if (!addr) throw new Error('Wallet not connected');
  const result = await Freighter.signTransaction(xdr, {
    networkPassphrase,
    address: addr
  });
  const signedTxXdr = result?.signedTxXdr ?? result?.signedTransaction;
  if (result?.error || !signedTxXdr) throw new Error(result?.error?.message || 'Freighter sign failed');
  return signedTxXdr;
}
