import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../services/NoirService.js', () => ({ NoirService: class { generateProof() { throw new Error('prover must not run'); } } }));
vi.mock('../utils/stellarWallet.js', () => ({ getFreighterNetwork: async () => null }));

import * as gameClient from '../contracts/gameClient.js';
import { ContractError } from '../contracts/contractErrors.js';

const CONTRACT = 'C' + 'A'.repeat(55);
const sign = vi.fn();

describe('gameClient local validation (no network, no fees)', () => {
  beforeEach(() => {
    globalThis.window = globalThis.window || {};
    window.__VITE_CONFIG__ = { VITE_COSMIC_CODER_CONTRACT_ID: CONTRACT };
    sign.mockReset();
  });
  afterEach(() => { delete window.__VITE_CONFIG__; });

  it('submitResult rejects score below wave*5 with ContractError #10 before signing', async () => {
    const err = await gameClient.submitResult('GABC', sign, 3, 14).catch((e) => e);
    expect(err).toBeInstanceOf(ContractError);
    expect(err.code).toBe(10);
    expect(sign).not.toHaveBeenCalled();
  });

  it('submitResult rejects negative and NaN scores', async () => {
    expect((await gameClient.submitResult('GABC', sign, 1, -1).catch((e) => e)).code).toBe(11);
    expect((await gameClient.submitResult('GABC', sign, 1, NaN).catch((e) => e)).code).toBe(5);
  });

  it('submitZkTrustless and submitZkFromProverV2 validate before proving', async () => {
    const bad = { run_hash_hi: '00'.repeat(32), run_hash_lo: '', score: 4, wave: 1, nonce: '1', season_id: 1 };
    expect((await gameClient.submitZkTrustless('GABC', sign, bad).catch((e) => e)).code).toBe(10);
    expect((await gameClient.submitZkFromProverV2('GABC', sign, undefined, bad, '00').catch((e) => e)).code).toBe(10);
    expect((await gameClient.submitZkTrustless('GABC', sign, { ...bad, score: 0 }).catch((e) => e)).code).toBe(5);
  });

  it('exposes the new reads and no longer exposes the v0.2.0 submit_proof flow', () => {
    expect(typeof gameClient.getActiveSession).toBe('function');
    expect(typeof gameClient.isNonceUsed).toBe('function');
    expect(gameClient.submitZkV2).toBeUndefined();
  });

  it('read helpers fall back safely without a player', async () => {
    expect(await gameClient.getActiveSession('')).toBeNull();
    expect(await gameClient.isNonceUsed('', 1, 1)).toBe(false);
  });
});
