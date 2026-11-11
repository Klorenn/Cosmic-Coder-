/** Pure status labels for the title screen corners. */

/**
 * Honest ranked/ZK label. While ranked runs are not cryptographically verified on-chain
 * (gameClient.isRankedVerified() === false) the title must say so instead of a ZK "ready" badge.
 * @param {{configured?:boolean, proverHealthy?:boolean}|null} status gameClient.getZkStatus() result (null = pending)
 * @param {boolean} rankedVerified gameClient.isRankedVerified()
 * @returns {{text:string, tone:'ok'|'warn'|'muted'}}
 */
export function zkStatusLabel(status, rankedVerified) {
  if (!rankedVerified) return { text: 'RANKED: UNVERIFIED', tone: 'warn' };
  if (!status) return { text: 'ZK: ...', tone: 'muted' };
  if (!status.configured) return { text: 'ZK: OFF', tone: 'muted' };
  if (status.proverHealthy) return { text: 'ZK: READY', tone: 'ok' };
  return { text: 'ZK: SLEEPING', tone: 'warn' };
}

export function formatVersion(v) {
  return typeof v === 'string' && v.trim() ? `v${v.trim()}` : '';
}

export function shortWallet(addr) {
  if (typeof addr !== 'string' || addr.length < 10) return typeof addr === 'string' ? addr : '';
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}
