import { describe, it, expect } from 'vitest';
import {
  CONTRACT_ERRORS,
  MIN_SCORE_PER_WAVE,
  ContractError,
  parseContractError,
  toContractError,
  validateBeforeSubmit,
  assertValidSubmit,
  normalizeTxResult
} from '../contracts/contractErrors.js';

describe('CONTRACT_ERRORS table', () => {
  it('mirrors CosmicCoderError codes', () => {
    const names = {
      1: 'VerifierNotSet', 2: 'Replay', 3: 'InvalidProof', 4: 'VerifierError', 5: 'InvalidInput',
      6: 'MalformedVk', 7: 'VkNotSet', 8: 'VkMismatch', 9: 'SignalMismatch', 10: 'ScoreBelowMinimum',
      11: 'NegativeScore', 12: 'InvalidWeapon', 13: 'ThresholdMismatch', 14: 'AlreadyUnlocked',
      15: 'Overflow', 16: 'NoirVerifierNotSet', 17: 'NoPendingAdmin', 100: 'VerifierCrash', 101: 'GameHubCrash', 102: 'InvalidZkProof'
    };
    expect(Object.keys(CONTRACT_ERRORS).map(Number).sort((a, b) => a - b)).toEqual(
      Object.keys(names).map(Number).sort((a, b) => a - b)
    );
    for (const [code, name] of Object.entries(names)) {
      expect(CONTRACT_ERRORS[code].name).toBe(name);
      expect(CONTRACT_ERRORS[code].i18nKey).toBe(`contract_error.${name}`);
    }
  });
});

describe('parseContractError', () => {
  it.each([
    ['HostError: Error(Contract, #10)', 10],
    ['[simulate:submit_result] HostError: Error(Contract, #11)\nresult=null\nevents=[]', 11],
    ['Error(Contract,#2)', 2],
    ['HostError: Error(Contract, #102)\n\nEvent log (newest first):', 102],
    ['transaction simulation failed: "HostError: Error(Contract, #16)"', 16]
  ])('extracts code from %s', (msg, code) => {
    const parsed = parseContractError(new Error(msg));
    expect(parsed.code).toBe(code);
    expect(parsed.name).toBe(CONTRACT_ERRORS[code].name);
  });

  it('accepts plain strings and already-typed errors', () => {
    expect(parseContractError('Error(Contract, #14)').code).toBe(14);
    expect(parseContractError(new ContractError('x', 3)).code).toBe(3);
  });

  it('returns null for non-contract errors and unknown codes', () => {
    expect(parseContractError(new Error('Failed to fetch'))).toBeNull();
    expect(parseContractError(new Error('Error(WasmVm, InvalidAction)'))).toBeNull();
    expect(parseContractError(null)).toBeNull();
    expect(parseContractError(undefined)).toBeNull();
    expect(parseContractError(new Error('Error(Contract, #999)'))).toBeNull();
  });
});

describe('ContractError / toContractError', () => {
  it('keeps the original message and exposes typed fields', () => {
    const e = toContractError(new Error('HostError: Error(Contract, #10)'));
    expect(e).toBeInstanceOf(ContractError);
    expect(e).toBeInstanceOf(Error);
    expect(e.code).toBe(10);
    expect(e.errorName).toBe('ScoreBelowMinimum');
    expect(e.i18nKey).toBe('contract_error.ScoreBelowMinimum');
    expect(e.message).toContain('Error(Contract, #10)');
  });

  it('returns the same error when nothing matches', () => {
    const orig = new Error('boom');
    expect(toContractError(orig)).toBe(orig);
  });

  it('does not rewrap a ContractError', () => {
    const e = new ContractError('m', 5);
    expect(toContractError(e)).toBe(e);
  });
});

describe('validateBeforeSubmit', () => {
  it('uses the same minimum as the contract', () => {
    expect(MIN_SCORE_PER_WAVE).toBe(5);
  });

  it('accepts a valid casual result, including 0/0', () => {
    expect(validateBeforeSubmit({ wave: 3, score: 15 })).toEqual({ valid: true });
    expect(validateBeforeSubmit({ wave: 0, score: 0 }).valid).toBe(true);
  });

  it('rejects score below wave*5 with code 10', () => {
    const r = validateBeforeSubmit({ wave: 3, score: 14 });
    expect(r.valid).toBe(false);
    expect(r.code).toBe(10);
    expect(r.name).toBe('ScoreBelowMinimum');
  });

  it('rejects negative score with code 11', () => {
    const r = validateBeforeSubmit({ wave: 1, score: -1 });
    expect(r).toMatchObject({ valid: false, code: 11, name: 'NegativeScore' });
  });

  it.each([
    [{ wave: NaN, score: 10 }],
    [{ wave: 2, score: NaN }],
    [{ wave: 2, score: Infinity }],
    [{ wave: 2.5, score: 20 }],
    [{ wave: -1, score: 20 }],
    [{ wave: '2', score: 20 }],
    [{ wave: 2, score: null }],
    [undefined]
  ])('rejects non-finite / non-integer input %j with code 5', (input) => {
    const r = validateBeforeSubmit(input);
    expect(r).toMatchObject({ valid: false, code: 5, name: 'InvalidInput' });
  });

  it('ranked mode requires positive score and wave', () => {
    expect(validateBeforeSubmit({ wave: 0, score: 0, ranked: true })).toMatchObject({ valid: false, code: 5 });
    expect(validateBeforeSubmit({ wave: 1, score: 0, ranked: true })).toMatchObject({ valid: false, code: 5 });
    expect(validateBeforeSubmit({ wave: 2, score: 9, ranked: true })).toMatchObject({ valid: false, code: 10 });
    expect(validateBeforeSubmit({ wave: 2, score: 10, ranked: true }).valid).toBe(true);
  });

  it('rejects values beyond u32 for ranked claims', () => {
    expect(validateBeforeSubmit({ wave: 1, score: 2 ** 32, ranked: true })).toMatchObject({ valid: false, code: 5 });
  });

  it('assertValidSubmit throws a typed ContractError', () => {
    expect(() => assertValidSubmit({ wave: 3, score: 1 })).toThrowError(ContractError);
    try { assertValidSubmit({ wave: 3, score: 1 }); } catch (e) { expect(e.code).toBe(10); }
    expect(() => assertValidSubmit({ wave: 3, score: 15 })).not.toThrow();
  });
});

describe('normalizeTxResult', () => {
  it('marks success, picks txHash and decodes the return value', () => {
    const r = normalizeTxResult({ status: 'SUCCESS', txHash: 'abc', returnValue: { fake: 1 } }, () => 7);
    expect(r).toMatchObject({ ok: true, txHash: 'abc', status: 'SUCCESS', value: 7 });
  });

  it('falls back to hash and tolerates decoder failure / missing return', () => {
    expect(normalizeTxResult({ status: 'SUCCESS', hash: 'h1' }).txHash).toBe('h1');
    const r = normalizeTxResult({ status: 'SUCCESS', returnValue: {} }, () => { throw new Error('x'); });
    expect(r.ok).toBe(true);
    expect(r.value).toBeUndefined();
  });

  it('handles null input without throwing', () => {
    expect(normalizeTxResult(null)).toMatchObject({ ok: true });
  });
});
