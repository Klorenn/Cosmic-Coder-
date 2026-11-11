import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import * as snarkjs from 'snarkjs';

const ROOT = path.resolve(__dirname, '../..');
vi.mock('../utils/assetBase.js', () => ({ getAssetPath: (p) => path.join(ROOT, 'public', p) }));
vi.mock('../services/NoirService.js', () => ({ NoirService: class {} }));
vi.mock('../utils/stellarWallet.js', () => ({ getFreighterNetwork: async () => null }));

import { buildRunWitness, computeEventsHash, maxProvableScore } from '../zk/gameProof.js';
import * as gameClient from '../contracts/gameClient.js';
import { buildInputV3, generateProofV3 } from '../../server/zkProve.js';

const read = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
const B = path.join(ROOT, 'circuits/build');
const WASM = path.join(B, 'GameRunV3_js/GameRunV3.wasm');
const ZKEY = path.join(B, 'GameRunV3_final.zkey');
const vkey = read('circuits/build/GameRunV3_vkey.json');
const pinned = read('circuits/build/contract_proof_v3.json');
const fixtureInput = read('circuits/fixtures/gamerun_v3.input.json');

const RUN = { score: 300, wave: 3, kills: 12, seed: '123456789', nonce: '1731300000042', season: 1, eventsHash: '987654321' };
const witness = (input) => snarkjs.wtns.calculate(input, WASM, { type: 'mem' });

describe('buildRunWitness (GameRunV3 input)', () => {
  it('matches the committed fixture input', async () => {
    expect(await buildRunWitness(RUN)).toEqual(fixtureInput);
  });

  it('events_hash: 0 without events, deterministic, key-order independent, < 2^253', async () => {
    expect(await computeEventsHash([])).toBe('0');
    expect(await computeEventsHash(undefined)).toBe('0');
    const a = await computeEventsHash([{ t: 1, kind: 'kill', xp: 30 }, { t: 2, kind: 'wave', n: 2 }]);
    const b = await computeEventsHash([{ xp: 30, kind: 'kill', t: 1 }, { n: 2, kind: 'wave', t: 2 }]);
    expect(a).toBe(b);
    expect(BigInt(a)).toBeLessThan(1n << 253n);
    expect(await computeEventsHash([{ t: 1, kind: 'kill', xp: 31 }])).not.toBe(a);
    const w = await buildRunWitness({ ...RUN, eventsHash: undefined, events: [{ t: 1, kind: 'kill', xp: 30 }, { t: 2, kind: 'wave', n: 2 }] });
    expect(w.events_hash).toBe(a);
  });

  it('hex seed (generateRunSeed) is reduced to a field element', async () => {
    const w = await buildRunWitness({ ...RUN, seed: 'ff'.repeat(32) });
    expect(BigInt(w.seed)).toBe((1n << 253n) - 1n);
  });

  it('rejects runs the circuit cannot prove', async () => {
    expect(maxProvableScore(1, 3)).toBe(26250n + 9n * 875n + 3n * 5000n);
    await expect(buildRunWitness({ ...RUN, score: 100000, kills: 1 })).rejects.toThrow(/provable max/);
    await expect(buildRunWitness({ ...RUN, score: 10, wave: 3 })).rejects.toThrow(/wave \* 5/);
    await expect(buildRunWitness({ ...RUN, kills: -1 })).rejects.toThrow(/kills/);
    await expect(buildRunWitness({ ...RUN, nonce: 1n << 64n })).rejects.toThrow(/nonce/);
  });
});

describe('GameRunV3 circuit (real wasm/zkey)', () => {
  it('cannot build a witness for score=100000 with kills=1 (score bound)', async () => {
    const forged = { ...fixtureInput, score: '100000', kills: '1' };
    await expect(witness(forged)).rejects.toThrow();
    // Same run with enough kills is provable: the failure is the bound, not the input shape.
    await expect(witness({ ...forged, kills: '4' })).resolves.toBeUndefined();
  });

  it('rejects score below wave*5 and non-boolean used_zk_weapon', async () => {
    await expect(witness({ ...fixtureInput, score: '14' })).rejects.toThrow();
    await expect(witness({ ...fixtureInput, used_zk_weapon: '2' })).rejects.toThrow();
  });

  it('proves + verifies; public signals = [hash_hi, hash_lo, score, wave, nonce, season, weapon]', async () => {
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(await buildRunWitness(RUN), WASM, ZKEY);
    expect(await snarkjs.groth16.verify(vkey, publicSignals, proof)).toBe(true);
    expect(publicSignals.slice(2)).toEqual(['300', '3', '1731300000042', '1', '0']);
    expect(BigInt(publicSignals[0])).toBeLessThan(1n << 126n);
    expect(BigInt(publicSignals[1])).toBeLessThan(1n << 128n);
    // Different private witness -> different run commitment.
    const other = await snarkjs.groth16.fullProve(await buildRunWitness({ ...RUN, kills: 13 }), WASM, ZKEY);
    expect(other.publicSignals.slice(0, 2)).not.toEqual(publicSignals.slice(0, 2));
  }, 30000);
});

describe('server /zk/prove_v3 prover', () => {
  it('returns a contract-format proof with the pinned V3 VK and the committed run hash', async () => {
    const out = await generateProofV3({ ...fixtureInput });
    expect(out.vk).toEqual(pinned.vk);
    expect(out.pub_signals).toEqual(pinned.pub_signals);
  }, 30000);

  it('rejects an unprovable run before proving', async () => {
    await expect(buildInputV3({ ...fixtureInput, score: '100000', kills: '1' })).rejects.toThrow(/provable max/);
  });
});

describe('gameClient V3 wiring', () => {
  const payload = { score: 300, wave: 3, kills: 12, seed: '123456789', events_hash: '987654321', nonce: '1731300000042', season_id: 1, run_hash_hi: '00'.repeat(32), run_hash_lo: '' };
  beforeEach(() => {
    globalThis.window = globalThis.window || {};
    window.__VITE_CONFIG__ = {};
  });
  afterEach(() => { delete window.__VITE_CONFIG__; vi.restoreAllMocks(); });

  it('getZkCircuit defaults to v3, v1 opt-out', () => {
    expect(gameClient.getZkCircuit()).toBe('v3');
    window.__VITE_CONFIG__.VITE_ZK_CIRCUIT = 'v1';
    expect(gameClient.getZkCircuit()).toBe('v1');
  });

  it('generateLocalProof uses the browser V3 artifacts; run_hash comes from the proof', async () => {
    globalThis.fetch = vi.fn(async (u) => ({ ok: fs.existsSync(u), json: async () => JSON.parse(fs.readFileSync(u, 'utf8')) }));
    const r = await gameClient.generateLocalProof(payload);
    expect(r.circuit).toBe('v3');
    expect(r.vk).toEqual(pinned.vk); // public/circuits/build == circuits/build == deploy pin
    expect(r.pub_signals).toEqual(pinned.pub_signals);
    expect(r.run_hash_hex).toBe(pinned.pub_signals[0].slice(32) + pinned.pub_signals[1].slice(32));
  }, 30000);

  it('requestZkProofV2 posts the V3 witness to /zk/prove_v3 (v1 payloads keep /zk/prove)', async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => pinned }));
    await gameClient.requestZkProofV2('https://prover.test', payload);
    const [url, init] = globalThis.fetch.mock.calls[0];
    expect(url).toBe('https://prover.test/zk/prove_v3');
    expect(JSON.parse(init.body)).toEqual(fixtureInput);
    const { kills, seed, ...v1Payload } = payload;
    await gameClient.requestZkProofV2('https://prover.test', v1Payload);
    expect(globalThis.fetch.mock.calls[1][0]).toBe('https://prover.test/zk/prove');
  });
});
