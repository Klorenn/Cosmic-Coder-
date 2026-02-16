/**
 * Provably Fair Survival - ZK-style game proof.
 *
 * Current: game_hash binding (player, wave, score, run_seed, timestamp) and rule check.
 *
 * For full Groth16 on-chain verification (contracts/groth16_verifier + submit_zk):
 * - Circuit public inputs: player_address, run_hash, final_score, nonce (and optionally season_id).
 * - Constraints: kills <= time * MAX_KILLS_PER_SECOND, damage == kills * BASE_DAMAGE, time <= MAX_ALLOWED_TIME, score >= wave * MIN_SCORE_PER_WAVE.
 * - Use computeGameHash() for run_hash; generateRunSeed() for run binding; nonce must be unique per submit.
 *
 * Validation rules (must hold for valid proof):
 * - score >= wave * MIN_SCORE_PER_WAVE (base progression)
 * - score and wave within sane bounds
 */
const MIN_SCORE_PER_WAVE = 10;
const MAX_WAVE = 10000;
const MAX_SCORE = 1e12;

/**
 * Compute game hash: H(player || wave || score || seed || timestamp)
 * Used as commitment to the run result; contract or backend can verify consistency.
 * @param {string} playerAddress - Stellar public key
 * @param {number} wave
 * @param {number} score
 * @param {string} runSeed - hex or base64 seed from run start
 * @param {number} timestamp - ms
 * @returns {Promise<string>} hex hash
 */
export async function computeGameHash(playerAddress, wave, score, runSeed, timestamp) {
  const payload = [
    playerAddress,
    String(wave),
    String(score),
    String(runSeed),
    String(timestamp),
  ].join('|');
  const encoder = new TextEncoder();
  const data = encoder.encode(payload);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Validate that (wave, score) satisfy game rules (for client-side proof).
 * Contract enforces score >= wave * MIN_SCORE_PER_WAVE.
 * @param {number} wave
 * @param {number} score
 * @returns {{ valid: boolean, reason?: string }}
 */
export function validateGameRules(wave, score) {
  if (wave <= 0 || wave > MAX_WAVE) {
    return { valid: false, reason: 'wave out of range' };
  }
  if (score < 0 || score > MAX_SCORE) {
    return { valid: false, reason: 'score out of range' };
  }
  const minScore = wave * MIN_SCORE_PER_WAVE;
  if (score < minScore) {
    return { valid: false, reason: `score ${score} < wave * ${MIN_SCORE_PER_WAVE} = ${minScore}` };
  }
  return { valid: true };
}

/**
 * Generate a random run seed (store at game start, use in game_hash at end).
 * @returns {string} hex string
 */
export function generateRunSeed() {
  const arr = new Uint8Array(32);
  crypto.getRandomValues(arr);
  return Array.from(arr)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export { MIN_SCORE_PER_WAVE };
