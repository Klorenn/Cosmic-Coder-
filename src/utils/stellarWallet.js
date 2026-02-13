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

/**
 * Connect wallet: asks Freighter for access and returns the address.
 * @returns {Promise<string|null>} address or null if user denied / not installed
 */
export async function connect() {
  try {
    const res = await Freighter.requestAccess();
    const address = res?.address || res?.publicKey;
    if (res?.error || !address) return null;
    cachedAddress = address;
    try {
      localStorage.setItem(STORAGE_KEY, address);
    } catch (_) {}
    return address;
  } catch (e) {
    console.warn('Freighter requestAccess failed:', e);
    return null;
  }
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
 * Sign a transaction XDR (for Soroban / Game Hub).
 * @param {string} xdr - base64 transaction XDR
 * @param {string} [networkPassphrase] - default testnet
 * @returns {Promise<string>} signed XDR base64
 */
export async function signTransaction(xdr, networkPassphrase = TESTNET_PASSPHRASE) {
  const addr = await getAddress();
  if (!addr) throw new Error('Wallet not connected');
  const result = await Freighter.signTransaction(xdr, {
    networkPassphrase,
    address: addr
  });
  const signedTxXdr = result?.signedTxXdr ?? result?.signedTransaction;
  if (result?.error || !signedTxXdr) throw new Error(result?.error?.message || 'Freighter sign failed');
  return signedTxXdr;
}
