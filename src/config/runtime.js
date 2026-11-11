/**
 * Runtime config resolution: window.__VITE_CONFIG__ (config.json) > import.meta.env.VITE_* > localhost defaults.
 * No production URLs are hardcoded; deployments inject them via config.json / env.
 */
export const DEFAULTS = {
  VITE_API_URL: 'http://localhost:3333',
  VITE_ZK_PROVER_URL: 'http://localhost:3333',
  VITE_PROGRESS_API_URL: 'http://localhost:3333',
  VITE_LEADERBOARD_URL: 'http://localhost:3333'
};

function viteEnv() {
  try { return (typeof import.meta !== 'undefined' && import.meta.env) || {}; } catch (_) { return {}; }
}

/** Returns the configured string for key, or '' if unset. `env`/`win` injectable for tests. */
export function getConfigValue(key, { env = viteEnv(), win = typeof window !== 'undefined' ? window : {} } = {}) {
  const fromWin = win?.__VITE_CONFIG__?.[key];
  if (fromWin) return String(fromWin);
  const fromEnv = env?.[key];
  if (fromEnv) return String(fromEnv);
  return '';
}

const strip = (u) => String(u).replace(/\/$/, '');

export function getApiUrl() {
  return strip(getConfigValue('VITE_API_URL') || DEFAULTS.VITE_API_URL);
}
export function getZkProverUrl() {
  return strip(getConfigValue('VITE_ZK_PROVER_URL') || DEFAULTS.VITE_ZK_PROVER_URL);
}
export function getProgressApiUrl() {
  return strip(getConfigValue('VITE_PROGRESS_API_URL') || getConfigValue('VITE_ZK_PROVER_URL') || DEFAULTS.VITE_PROGRESS_API_URL);
}
export function getLeaderboardUrl() {
  return strip(getConfigValue('VITE_LEADERBOARD_URL') || getConfigValue('VITE_API_URL') || DEFAULTS.VITE_LEADERBOARD_URL);
}
