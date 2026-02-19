/**
 * Wallet utility functions for formatting and display
 */

/**
 * Format wallet address for display
 * Converts 0x1234567890ABCDEF1234 to 0x1234...1234
 * @param {string} wallet - Full wallet address
 * @returns {string} Formatted wallet (first 6 + ... + last 4)
 */
export function formatWallet(wallet) {
  if (!wallet || typeof wallet !== 'string') return '';
  
  // Remove any whitespace
  const cleanWallet = wallet.trim();
  
  // If too short, return as is
  if (cleanWallet.length <= 10) return cleanWallet;
  
  // Get first 6 characters (including 0x) and last 4
  const prefix = cleanWallet.slice(0, 6);
  const suffix = cleanWallet.slice(-4);
  
  return `${prefix}...${suffix}`;
}

/**
 * Format wallet with custom length
 * @param {string} wallet - Full wallet address
 * @param {number} prefixLen - Length of prefix (default 6)
 * @param {number} suffixLen - Length of suffix (default 4)
 * @returns {string} Formatted wallet
 */
export function formatWalletCustom(wallet, prefixLen = 6, suffixLen = 4) {
  if (!wallet || typeof wallet !== 'string') return '';
  
  const cleanWallet = wallet.trim();
  
  if (cleanWallet.length <= prefixLen + suffixLen) return cleanWallet;
  
  const prefix = cleanWallet.slice(0, prefixLen);
  const suffix = cleanWallet.slice(-suffixLen);
  
  return `${prefix}...${suffix}`;
}

/**
 * Validate wallet address format
 * @param {string} wallet - Wallet address to validate
 * @returns {boolean} True if valid format
 */
export function isValidWallet(wallet) {
  if (!wallet || typeof wallet !== 'string') return false;
  
  // Check if starts with 0x and has valid hex characters
  const cleanWallet = wallet.trim();
  
  // Support both Ethereum (0x...) and Stellar (G...) addresses
  if (cleanWallet.startsWith('0x')) {
    return /^0x[0-9a-fA-F]{40}$/.test(cleanWallet);
  }
  
  if (cleanWallet.startsWith('G')) {
    // Stellar address format
    return cleanWallet.length === 56 && /^G[0-9A-Z]{55}$/.test(cleanWallet);
  }
  
  return false;
}
