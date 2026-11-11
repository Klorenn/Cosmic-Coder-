/**
 * Pure state for the "Start run" modal (TitleScene.showZKStartPopup): which modes are playable,
 * which one is pre-selected, the status chips and the card layout. No Phaser here (unit-tested).
 */

export const START_MODES = Object.freeze(['casual', 'ranked']);

/**
 * @param {{ wallet: boolean, contract: boolean, prover: boolean, proverHealthy?: boolean|null, rankedVerified: boolean }} s
 *   prover = prover URL configured; proverHealthy = health check result (null while pending).
 */
export function startRunModel({ wallet = false, contract = false, prover = false, proverHealthy = null, rankedVerified = false } = {}) {
  // Ranked needs a contract to submit to and a wallet to sign with; contract missing wins (nothing the player can fix).
  const rankedBlock = !contract ? 'contract' : !wallet ? 'wallet' : null;
  const rankedEnabled = rankedBlock === null;
  // Same rule as the old ZK terminal: ranked is the default only when the whole ZK path is configured.
  const defaultMode = rankedEnabled && prover ? 'ranked' : 'casual';
  const proverState = !prover ? 'off' : proverHealthy == null ? 'pending' : proverHealthy ? 'ok' : 'off';
  return {
    rankedEnabled,
    rankedBlock,
    defaultMode,
    rankedVerified: !!rankedVerified,
    chips: [
      { id: 'contract', state: contract ? 'ok' : 'off' },
      { id: 'prover', state: proverState },
      { id: 'wallet', state: wallet ? 'ok' : 'off' }
    ]
  };
}

/** Move the selection left/right (wraps); a disabled ranked card can't be selected. */
export function cycleStartMode(current, dir, rankedEnabled) {
  if (!rankedEnabled) return 'casual';
  const i = START_MODES.indexOf(current);
  const n = START_MODES.length;
  return START_MODES[(((i < 0 ? 0 : i) + (dir < 0 ? -1 : 1)) % n + n) % n];
}

/** Cards side by side unless the body is narrower than `minRowW` css; compact (icon left) when short. */
export function startCardLayout(bodyWcss, bodyHcss) {
  const stacked = bodyWcss < 460;
  const compact = stacked || bodyHcss < 300;
  return { stacked, compact, cardH: compact ? 76 : 148 };
}
