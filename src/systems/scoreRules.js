/**
 * Score vs spendable XP (pure).
 * - `score`: XP earned during the run. Only ever grows. This is what HUD, game over,
 *   leaderboard, validateGameRules and on-chain submission use.
 * - `totalXP`: spendable pool (e.g. XP shrine). Spending lowers it, never the score.
 */

const isAmount = (n) => typeof n === 'number' && Number.isFinite(n) && n >= 0;
const nonNeg = (n) => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0);

function ensureScore(state) {
  if (!isAmount(state.score)) state.score = nonNeg(state.totalXP);
}

export function applyXPGain(state, amount) {
  if (!state || !isAmount(amount)) return state;
  ensureScore(state);
  state.totalXP = nonNeg(state.totalXP) + amount;
  state.score += amount;
  return state;
}

export function canSpendXP(state, amount) {
  return !!state && isAmount(amount) && isAmount(state.totalXP) && state.totalXP >= amount;
}

export function spendXP(state, amount) {
  if (!canSpendXP(state, amount)) return false;
  ensureScore(state);
  state.totalXP = Math.max(0, state.totalXP - amount);
  return true;
}

export function getRunScore(state) {
  if (!state) return 0;
  const raw = isAmount(state.score) ? state.score : nonNeg(state.totalXP);
  return Math.floor(raw);
}
