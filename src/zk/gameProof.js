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
const MIN_SCORE_PER_WAVE = 5;
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
  // Strict types: NaN, Infinity, numeric strings, objects with valueOf and fractions are all rejected
  // (NaN used to slip through every comparison below and validate as true).
  if (typeof wave !== 'number' || !Number.isInteger(wave)) {
    return { valid: false, reason: 'wave must be an integer' };
  }
  if (typeof score !== 'number' || !Number.isInteger(score)) {
    return { valid: false, reason: 'score must be an integer' };
  }
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

/**
 * GameRunV3 score bound (circuits/GameRunV3.circom; derivation in docs/ZK_CIRCUIT_STATUS.md):
 * score <= kills*MAX_SCORE_PER_KILL + wave^2*WAVE_BONUS_QUAD + wave*WAVE_FLAT.
 */
export const V3_MAX_SCORE_PER_KILL = 26250;
export const V3_WAVE_BONUS_QUAD = 875;
export const V3_WAVE_FLAT = 5000;

/** Highest score GameRunV3 can prove for (kills, wave). Beyond it the witness cannot be generated. */
export function maxProvableScore(kills, wave) {
  const k = BigInt(kills);
  const w = BigInt(wave);
  return k * BigInt(V3_MAX_SCORE_PER_KILL) + w * w * BigInt(V3_WAVE_BONUS_QUAD) + w * BigInt(V3_WAVE_FLAT);
}

const FIELD_MASK = (1n << 253n) - 1n; // < BN254 r: every masked value is a canonical field element
const U32_MAX = (1n << 32n) - 1n;
const U64_MAX = (1n << 64n) - 1n;

function toUint(v, max, name) {
  let n;
  try {
    n = typeof v === 'bigint' ? v : BigInt(typeof v === 'number' && !Number.isSafeInteger(v) ? NaN : String(v).trim());
  } catch {
    throw new Error(`${name} must be an integer`);
  }
  if (n < 0n || n > max) throw new Error(`${name} out of range`);
  return n;
}

/** Seed: bigint, decimal string or hex (0x or bare, e.g. generateRunSeed()) -> low 253 bits as a field element. */
function seedToField(seed) {
  if (seed == null || seed === '') throw new Error('seed is required');
  if (typeof seed === 'bigint' || typeof seed === 'number') return toUint(seed, (1n << 256n) - 1n, 'seed') & FIELD_MASK;
  const s = String(seed).trim();
  const hex = /^0x[0-9a-f]+$/i.test(s) || (!/^\d+$/.test(s) && /^[0-9a-f]+$/i.test(s));
  if (!hex && !/^\d+$/.test(s)) throw new Error('seed must be decimal or hex');
  return BigInt(hex ? (s.startsWith('0x') || s.startsWith('0X') ? s : `0x${s}`) : s) & FIELD_MASK;
}

const stable = (v) => {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`;
  return JSON.stringify(v ?? null);
};

/**
 * events_hash for GameRunV3: SHA-256 over the canonical event log (one stable-key JSON value per event,
 * joined by "\n"), truncated to its low 253 bits (big-endian). No events -> "0".
 * The server can recompute it from the same log with node:crypto.
 * @param {Array<unknown>|null|undefined} events
 * @returns {Promise<string>} decimal field element
 */
export async function computeEventsHash(events) {
  if (!Array.isArray(events) || events.length === 0) return '0';
  const data = new TextEncoder().encode(events.map(stable).join('\n'));
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
  const n = BigInt('0x' + Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join(''));
  return (n & FIELD_MASK).toString();
}

/**
 * GameRunV3 witness input (the exact object snarkjs fullProve / wtns.calculate take).
 * Private: seed, kills, events_hash. Public outputs: [run_hash_hi, run_hash_lo, score, wave, nonce, season_id, used_zk_weapon].
 * `eventsHash` (decimal) overrides `events` when the caller already committed to the log.
 * Throws when the run cannot be proven (score below wave*5 or above maxProvableScore(kills, wave)).
 * @param {{ score: number|string|bigint, wave: number|string|bigint, kills: number|string|bigint, seed: string|bigint,
 *   nonce: number|string|bigint, season?: number|string|bigint, events?: Array<unknown>, eventsHash?: string, usedZkWeapon?: boolean|number }} run
 * @returns {Promise<{ seed: string, kills: string, events_hash: string, score: string, wave: string, nonce: string, season_id: string, used_zk_weapon: string }>}
 */
export async function buildRunWitness({ score, wave, kills, seed, nonce, season = 1, events, eventsHash, usedZkWeapon = 0 }) {
  const sc = toUint(score, U32_MAX, 'score');
  const wv = toUint(wave, U32_MAX, 'wave');
  const kl = toUint(kills, U32_MAX, 'kills');
  if (sc < wv * BigInt(MIN_SCORE_PER_WAVE)) throw new Error(`score ${sc} < wave * ${MIN_SCORE_PER_WAVE}`);
  const max = maxProvableScore(kl, wv);
  if (sc > max) throw new Error(`score ${sc} > provable max ${max} for kills=${kl} wave=${wv}`);
  const eh = eventsHash != null && eventsHash !== '' ? toUint(eventsHash, FIELD_MASK, 'eventsHash').toString() : await computeEventsHash(events);
  return {
    seed: seedToField(seed).toString(),
    kills: kl.toString(),
    events_hash: eh,
    score: sc.toString(),
    wave: wv.toString(),
    nonce: toUint(nonce, U64_MAX, 'nonce').toString(),
    season_id: toUint(season, U32_MAX, 'season').toString(),
    used_zk_weapon: usedZkWeapon && Number(usedZkWeapon) !== 0 ? '1' : '0'
  };
}

export { MIN_SCORE_PER_WAVE };
