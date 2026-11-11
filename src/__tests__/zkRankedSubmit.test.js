import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const noirGenerate = vi.fn(async () => ({ proofBlob: new Uint8Array([1, 2, 3, 4]) }));
vi.mock('../services/NoirService.js', () => ({ NoirService: class { generateProof(...a) { return noirGenerate(...a); } } }));
vi.mock('../utils/stellarWallet.js', () => ({ getFreighterNetwork: async () => null }));

const fullProve = vi.fn();
vi.mock('snarkjs', async (orig) => {
  const real = await orig();
  return { ...real, groth16: { ...real.groth16, fullProve: (...a) => fullProve(...a) } };
});

// Fake Soroban RPC: no network. `rpcState.simError` makes simulateTransaction fail like a contract revert.
const rpcState = { simError: null, built: [] };
vi.mock('@stellar/stellar-sdk', async (orig) => {
  const real = await orig();
  class Server {
    async getAccount() { return { sequence: '1' }; }
    async simulateTransaction(tx) { rpcState.built.push(tx); return rpcState.simError ? { error: rpcState.simError } : {}; }
    async prepareTransaction(tx) { return tx; }
    async sendTransaction() { return { status: 'PENDING', hash: 'abc123' }; }
    async getTransaction() { return { status: 'SUCCESS', txHash: 'abc123' }; }
  }
  return { ...real, rpc: { ...real.rpc, Server } };
});

import * as gameClient from '../contracts/gameClient.js';
import { ContractError } from '../contracts/contractErrors.js';
import { Keypair, StrKey } from '@stellar/stellar-sdk';

const ROOT = path.resolve(__dirname, '../..');
const read = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
const raw = read('circuits/fixtures/gamerun_s300_w3.snarkjs.json');
const contractFixture = read('circuits/fixtures/gamerun_s300_w3.json');
const input = read('circuits/fixtures/gamerun_s300_w3.input.json');
const vkey = read('circuits/build/GameRun_vkey.json');

const HEX = BigInt(input.run_hash_hi).toString(16).padStart(32, '0') + BigInt(input.run_hash_lo).toString(16).padStart(32, '0');
const payload = { run_hash_hi: HEX, run_hash_lo: '', score: 300, wave: 3, nonce: input.nonce, season_id: 1 };
const CONTRACT = StrKey.encodeContract(Buffer.alloc(32, 7));
const PLAYER = Keypair.random().publicKey();
const sign = vi.fn(async (xdrStr) => xdrStr);
const PROVER = 'https://prover.test';

const proverCalls = () => globalThis.fetch.mock.calls.filter(([u]) => String(u).includes('/zk/prove'));
const invokedMethod = () => rpcState.built.at(-1).operations[0].func.invokeContract().functionName().toString();
const invokedArgCount = () => rpcState.built.at(-1).operations[0].func.invokeContract().args().length;

function mockFetch({ prover = contractFixture } = {}) {
  globalThis.fetch = vi.fn(async (url) => {
    if (String(url).includes('/zk/prove')) {
      if (prover instanceof Error) throw prover;
      return { ok: true, json: async () => prover };
    }
    return { ok: true, json: async () => vkey };
  });
}

describe('ranked submit via Groth16 (submit_zk)', () => {
  beforeEach(() => {
    globalThis.window = globalThis.window || {};
    window.__VITE_CONFIG__ = { VITE_COSMIC_CODER_CONTRACT_ID: CONTRACT, VITE_ZK_PROVER_URL: PROVER };
    rpcState.simError = null;
    rpcState.built = [];
    sign.mockClear();
    fullProve.mockReset();
    noirGenerate.mockClear();
    mockFetch();
  });
  afterEach(() => { vi.useRealTimers(); delete window.__VITE_CONFIG__; });

  it('local proof OK: submit_zk with 9 args, prover server never called', async () => {
    fullProve.mockResolvedValueOnce(raw);
    const r = await gameClient.submitZkTrustless(PLAYER, sign, payload);
    expect(r).toMatchObject({ ok: true, txHash: 'abc123' });
    expect(invokedMethod()).toBe('submit_zk');
    expect(invokedArgCount()).toBe(9);
    expect(fullProve.mock.calls[0][0]).toEqual(input);
    expect(proverCalls()).toHaveLength(0);
    expect(noirGenerate).not.toHaveBeenCalled();
  });

  it('falls back to the prover when the local proof throws', async () => {
    fullProve.mockRejectedValueOnce(new Error('wasm load failed'));
    const r = await gameClient.submitZkTrustless(PLAYER, sign, payload);
    expect(r.ok).toBe(true);
    expect(invokedMethod()).toBe('submit_zk');
    expect(proverCalls()).toHaveLength(1);
    const [url, init] = proverCalls()[0];
    expect(url).toBe(`${PROVER}/zk/prove`);
    expect(JSON.parse(init.body)).toMatchObject({ run_hash_hex: HEX, score: 300, wave: 3, nonce: String(input.nonce), season_id: 1 });
  });

  it('falls back to the prover after ZK_LOCAL_TIMEOUT_MS', async () => {
    vi.useFakeTimers();
    fullProve.mockReturnValueOnce(new Promise(() => {}));
    const p = gameClient.submitZkTrustless(PLAYER, sign, payload);
    await vi.advanceTimersByTimeAsync(gameClient.ZK_LOCAL_TIMEOUT_MS - 1);
    expect(proverCalls()).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(2);
    expect((await p).ok).toBe(true);
    expect(proverCalls()).toHaveLength(1);
    expect(gameClient.ZK_LOCAL_TIMEOUT_MS).toBe(20000);
  });

  it('submitZkFromProverV2 forces the prover and never proves locally', async () => {
    const r = await gameClient.submitZkFromProverV2(PLAYER, sign, undefined, payload, '00');
    expect(r.ok).toBe(true);
    expect(fullProve).not.toHaveBeenCalled();
    expect(proverCalls()).toHaveLength(1);
    expect(invokedMethod()).toBe('submit_zk');
  });

  it('surfaces the prover error when local and prover both fail', async () => {
    fullProve.mockRejectedValueOnce(new Error('local boom'));
    mockFetch({ prover: new Error('prover down') });
    await expect(gameClient.submitZkTrustless(PLAYER, sign, payload)).rejects.toThrow('prover down');
    expect(sign).not.toHaveBeenCalled();
  });

  it('maps contract error #8 VkMismatch', async () => {
    fullProve.mockResolvedValueOnce(raw);
    rpcState.simError = 'HostError: Error(Contract, #8)';
    const err = await gameClient.submitZkTrustless(PLAYER, sign, payload).catch((e) => e);
    expect(err).toBeInstanceOf(ContractError);
    expect([err.code, err.errorName]).toEqual([8, 'VkMismatch']);
    expect(sign).not.toHaveBeenCalled();
  });

  it('maps contract error #2 Replay', async () => {
    fullProve.mockResolvedValueOnce(raw);
    rpcState.simError = 'HostError: Error(Contract, #2)';
    const err = await gameClient.submitZkTrustless(PLAYER, sign, payload).catch((e) => e);
    expect([err.code, err.errorName]).toEqual([2, 'Replay']);
  });

  it('maps contract error #9 SignalMismatch from the chain', async () => {
    fullProve.mockResolvedValueOnce(raw);
    rpcState.simError = 'HostError: Error(Contract, #9)';
    const err = await gameClient.submitZkTrustless(PLAYER, sign, payload).catch((e) => e);
    expect([err.code, err.errorName]).toEqual([9, 'SignalMismatch']);
  });

  it('rejects locally with #9 when the prover returns signals for a different claim (no fee, no signing)', async () => {
    fullProve.mockRejectedValueOnce(new Error('local boom'));
    const forged = { ...contractFixture, pub_signals: contractFixture.pub_signals.map((s, i) => (i === 2 ? (301).toString(16).padStart(64, '0') : s)) };
    mockFetch({ prover: forged });
    const err = await gameClient.submitZkTrustless(PLAYER, sign, payload).catch((e) => e);
    expect([err.code, err.errorName]).toEqual([9, 'SignalMismatch']);
    expect(rpcState.built).toHaveLength(0);
    expect(sign).not.toHaveBeenCalled();
  });

  it('rejects locally with #9 when the proof does not carry 7 public signals', async () => {
    fullProve.mockRejectedValueOnce(new Error('local boom'));
    mockFetch({ prover: { ...contractFixture, pub_signals: contractFixture.pub_signals.slice(0, 6) } });
    const err = await gameClient.submitZkTrustless(PLAYER, sign, payload).catch((e) => e);
    expect(err.code).toBe(9);
    expect(sign).not.toHaveBeenCalled();
  });

  it('validates before proving (#10) and without a configured contract', async () => {
    const bad = await gameClient.submitZkTrustless(PLAYER, sign, { ...payload, score: 14 }).catch((e) => e);
    expect(bad.code).toBe(10);
    expect(fullProve).not.toHaveBeenCalled();
    delete window.__VITE_CONFIG__.VITE_COSMIC_CODER_CONTRACT_ID;
    await expect(gameClient.submitZkTrustless(PLAYER, sign, payload)).rejects.toThrow('Contract ID not configured');
  });

  it("VITE_ZK_BACKEND='noir' keeps the legacy submit_zk_noir path", async () => {
    window.__VITE_CONFIG__.VITE_ZK_BACKEND = 'noir';
    const r = await gameClient.submitZkTrustless(PLAYER, sign, payload);
    expect(r.ok).toBe(true);
    expect(noirGenerate).toHaveBeenCalledTimes(1);
    expect(invokedMethod()).toBe('submit_zk_noir');
    expect(fullProve).not.toHaveBeenCalled();
  });
});

describe('getZkBackend / isRankedVerified', () => {
  beforeEach(() => { globalThis.window = globalThis.window || {}; });
  afterEach(() => { delete window.__VITE_CONFIG__; });

  it('defaults to groth16 and only "noir" switches', () => {
    delete window.__VITE_CONFIG__;
    expect(gameClient.getZkBackend()).toBe('groth16');
    window.__VITE_CONFIG__ = { VITE_ZK_BACKEND: 'noir' };
    expect(gameClient.getZkBackend()).toBe('noir');
    window.__VITE_CONFIG__ = { VITE_ZK_BACKEND: 'garbage' };
    expect(gameClient.getZkBackend()).toBe('groth16');
  });

  it('groth16: verified iff a contract id is configured', () => {
    window.__VITE_CONFIG__ = {};
    expect(gameClient.isRankedVerified()).toBe(false);
    window.__VITE_CONFIG__ = { VITE_COSMIC_CODER_CONTRACT_ID: CONTRACT };
    expect(gameClient.isRankedVerified()).toBe(true);
  });

  it('noir: stays unverified unless VITE_RANKED_VERIFIED is "true", even with a contract id', () => {
    window.__VITE_CONFIG__ = { VITE_ZK_BACKEND: 'noir', VITE_COSMIC_CODER_CONTRACT_ID: CONTRACT };
    expect(gameClient.isRankedVerified()).toBe(false);
    window.__VITE_CONFIG__.VITE_RANKED_VERIFIED = 'true';
    expect(gameClient.isRankedVerified()).toBe(true);
  });
});
