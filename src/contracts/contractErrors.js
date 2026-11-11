/**
 * Pure helpers for the cosmic_coder contract: error table, error parsing, local pre-validation
 * and tx-result normalisation. No SDK / network imports so they stay trivially testable.
 * Source of truth: contracts/cosmic_coder/src/lib.rs (CosmicCoderError, MIN_SCORE_PER_WAVE).
 */

export const MIN_SCORE_PER_WAVE = 5;
const U32_MAX = 4294967295;

const NAMES = {
  1: 'VerifierNotSet',
  2: 'Replay',
  3: 'InvalidProof',
  4: 'VerifierError',
  5: 'InvalidInput',
  6: 'MalformedVk',
  7: 'VkNotSet',
  8: 'VkMismatch',
  9: 'SignalMismatch',
  10: 'ScoreBelowMinimum',
  11: 'NegativeScore',
  12: 'InvalidWeapon',
  13: 'ThresholdMismatch',
  14: 'AlreadyUnlocked',
  15: 'Overflow',
  16: 'NoirVerifierNotSet',
  17: 'NoPendingAdmin',
  100: 'VerifierCrash',
  101: 'GameHubCrash',
  102: 'InvalidZkProof'
};

/** code -> { code, name, i18nKey }. i18n keys live under `contract_error.*` in src/locales. */
export const CONTRACT_ERRORS = Object.freeze(
  Object.fromEntries(
    Object.entries(NAMES).map(([code, name]) => [
      code,
      Object.freeze({ code: Number(code), name, i18nKey: `contract_error.${name}` })
    ])
  )
);

export class ContractError extends Error {
  constructor(message, code = null) {
    super(message);
    this.name = 'ContractError';
    const info = code != null ? CONTRACT_ERRORS[code] : null;
    this.code = info ? info.code : null;
    this.errorName = info ? info.name : null;
    this.i18nKey = info ? info.i18nKey : null;
  }
}

// Soroban host errors look like `HostError: Error(Contract, #10)`; spacing varies between RPC versions.
const CONTRACT_CODE_RE = /Error\(\s*Contract\s*,\s*#(\d+)\s*\)/;

/**
 * Extract the contract error code from a simulation/submission error (Error, string or ContractError).
 * @returns {{ code: number, name: string, i18nKey: string } | null} null when it is not a known contract error
 */
export function parseContractError(err) {
  if (err == null) return null;
  if (err instanceof ContractError && err.code != null) return CONTRACT_ERRORS[err.code] || null;
  const text = typeof err === 'string' ? err : String(err.message ?? err);
  const m = CONTRACT_CODE_RE.exec(text);
  if (!m) return null;
  return CONTRACT_ERRORS[Number(m[1])] || null;
}

/** Wrap an error as ContractError when it carries a known contract code; otherwise return it untouched. */
export function toContractError(err) {
  if (err instanceof ContractError) return err;
  const parsed = parseContractError(err);
  if (!parsed) return err;
  const wrapped = new ContractError(typeof err === 'string' ? err : err.message, parsed.code);
  if (err && err.stack) wrapped.stack = err.stack;
  return wrapped;
}

const invalid = (code, reason) => ({ valid: false, code, name: NAMES[code], reason });

/**
 * Mirror of the on-chain checks so we never pay fees for a tx that will fail.
 * Casual (`submit_result`): score >= 0 and score >= wave * 5. Ranked: additionally wave > 0, score > 0, u32 range.
 * @param {{ wave: number, score: number, ranked?: boolean }} input
 * @returns {{ valid: true } | { valid: false, code: number, name: string, reason: string }}
 */
export function validateBeforeSubmit(input) {
  const { wave, score, ranked = false } = input || {};
  if (typeof wave !== 'number' || !Number.isInteger(wave) || wave < 0) {
    return invalid(5, `wave must be a non-negative integer, got ${String(wave)}`);
  }
  if (typeof score !== 'number' || !Number.isFinite(score) || !Number.isInteger(score)) {
    return invalid(5, `score must be a finite integer, got ${String(score)}`);
  }
  if (score < 0) return invalid(11, `score must be >= 0, got ${score}`);
  if (ranked) {
    if (wave === 0 || score === 0) return invalid(5, 'ranked claims need wave > 0 and score > 0');
    if (wave > U32_MAX || score > U32_MAX) return invalid(5, 'wave/score exceed u32');
  }
  const min = wave * MIN_SCORE_PER_WAVE;
  if (score < min) {
    return invalid(10, `score ${score} < wave * ${MIN_SCORE_PER_WAVE} = ${min}`);
  }
  return { valid: true };
}

/** Throws a typed ContractError when `validateBeforeSubmit` fails. */
export function assertValidSubmit(input) {
  const r = validateBeforeSubmit(input);
  if (!r.valid) throw new ContractError(`[local-validation] ${r.name}: ${r.reason}`, r.code);
}

/**
 * Normalise a confirmed tx (getTransaction / sendTransaction result) into `{ ok: true, txHash, status, value }`.
 * Original fields are preserved. `decodeReturn` converts the ScVal return value (optional, failures ignored).
 */
export function normalizeTxResult(txInfo, decodeReturn) {
  const info = txInfo && typeof txInfo === 'object' ? txInfo : {};
  let value;
  if (typeof decodeReturn === 'function' && info.returnValue != null) {
    try { value = decodeReturn(info.returnValue); } catch (_) { value = undefined; }
  }
  return { ...info, ok: true, txHash: info.txHash || info.hash, value };
}
