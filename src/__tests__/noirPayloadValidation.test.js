import { describe, it, expect, vi } from 'vitest';

vi.mock('../services/NoirService.js', () => ({ NoirService: class { generateProof() { throw new Error('prover must not run'); } } }));
vi.mock('../utils/stellarWallet.js', () => ({ getFreighterNetwork: async () => null }));

import { validateNoirSubmitPayload, MAX_RANKED_WAVE } from '../contracts/gameClient.js';
import { ContractError } from '../contracts/contractErrors.js';

const ok = { score: 500, wave: 20 };
const codeOf = (p) => {
  try { validateNoirSubmitPayload(p); return null; } catch (e) { expect(e).toBeInstanceOf(ContractError); return e.code; }
};

describe('validateNoirSubmitPayload', () => {
  it('accepts a sane ranked payload', () => {
    expect(codeOf(ok)).toBeNull();
    expect(codeOf({ score: 4294967295, wave: 10000 })).toBeNull();
  });

  it('rejects a fractional score', () => {
    expect(codeOf({ ...ok, score: 500.5 })).toBe(5);
    expect(codeOf({ ...ok, score: '7.5' })).toBe(5);
  });

  it('rejects a score above u32', () => {
    expect(codeOf({ ...ok, score: 4294967296 })).toBe(5);
  });

  it('rejects wave above 10000', () => {
    expect(MAX_RANKED_WAVE).toBe(10000);
    expect(codeOf({ score: 4294967295, wave: 10001 })).toBe(5);
  });

  it('rejects score below wave*5', () => {
    expect(codeOf({ score: 99, wave: 20 })).toBe(10);
  });
});
