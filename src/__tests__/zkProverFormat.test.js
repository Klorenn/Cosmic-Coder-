import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import * as snarkjs from 'snarkjs';

vi.mock('../services/NoirService.js', () => ({ NoirService: class {} }));
vi.mock('../utils/stellarWallet.js', () => ({ getFreighterNetwork: async () => null }));
const fullProve = vi.fn();
vi.mock('snarkjs', async (orig) => {
  const real = await orig();
  return { ...real, groth16: { ...real.groth16, fullProve: (...a) => fullProve(...a) } };
});

import { generateLocalProof, snarkjsToContractProof, contractProofToZk, pubSignalsToScVal, proofToScVal, vkToScVal } from '../contracts/gameClient.js';
import { validateGameRules } from '../zk/gameProof.js';
import { xdr } from '@stellar/stellar-sdk';

const ROOT = path.resolve(__dirname, '../..');
const read = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));

// Real artifacts (circuits/fixtures/README.md): a /zk/prove response captured from server/index.js and the
// raw snarkjs proof behind the committed contract fixture (the one cosmic_coder tests submit).
const serverResp = read('circuits/fixtures/prover_response_gamerun.json');
const serverReq = read('circuits/fixtures/prover_request_gamerun.json');
const raw = read('circuits/fixtures/gamerun_s300_w3.snarkjs.json');
const contractFixture = read('circuits/fixtures/gamerun_s300_w3.json');
const vkey = read('circuits/build/GameRun_vkey.json');
const browserVkey = read('public/circuits/build/GameRun_vkey.json');

const hexToDec = (h) => BigInt('0x' + h).toString(10);
/** Inverse of the contract encoding: G1 x||y, G2 x_c1||x_c0||y_c1||y_c0 -> snarkjs layout. */
function contractToSnarkjs(p) {
  const w = (h, i) => hexToDec(h.slice(i * 64, i * 64 + 64));
  return {
    proof: {
      pi_a: [w(p.proof.a, 0), w(p.proof.a, 1), '1'],
      pi_b: [[w(p.proof.b, 1), w(p.proof.b, 0)], [w(p.proof.b, 3), w(p.proof.b, 2)], ['1', '0']],
      pi_c: [w(p.proof.c, 0), w(p.proof.c, 1), '1'],
      protocol: 'groth16',
      curve: 'bn128'
    },
    publicSignals: p.pub_signals.map(hexToDec)
  };
}

describe('Groth16 GameRun proof formats (real proofs)', () => {
  it('browser converter (snarkjsToContractProof) matches scripts/zk/export_for_contract.js byte-for-byte', () => {
    expect(snarkjsToContractProof(raw.proof, raw.publicSignals, vkey)).toEqual(contractFixture);
  });

  it('server /zk/prove response verifies with the GameRun VK after decoding', async () => {
    const { proof, publicSignals } = contractToSnarkjs(serverResp);
    expect(await snarkjs.groth16.verify(vkey, publicSignals, proof)).toBe(true);
    publicSignals[2] = '301';
    expect(await snarkjs.groth16.verify(vkey, publicSignals, proof)).toBe(false);
  });

  it('server response carries the same VK the contract fixture pins (set_run_vk)', () => {
    expect(serverResp.vk).toEqual(contractFixture.vk);
    expect(serverResp.vk.ic).toHaveLength(8);
  });

  it('browser artifacts (public/circuits/build) use the same VK as the prover', () => {
    expect(browserVkey).toEqual(vkey);
  });

  it('public signal order is [hash_hi, hash_lo, score, wave, nonce, season, weapon] and binds the request', () => {
    const sig = serverResp.pub_signals;
    expect(sig).toHaveLength(7);
    const h = serverReq.run_hash_hex;
    // Contract checks sig[0][16..] == run_hash[..16] and sig[1][16..] == run_hash[16..].
    expect(sig[0].slice(32)).toBe(h.slice(0, 32));
    expect(sig[1].slice(32)).toBe(h.slice(32));
    expect(BigInt('0x' + sig[2])).toBe(BigInt(serverReq.score));
    expect(BigInt('0x' + sig[3])).toBe(BigInt(serverReq.wave));
    expect(BigInt('0x' + sig[4])).toBe(BigInt(serverReq.nonce));
    expect(BigInt('0x' + sig[5])).toBe(BigInt(serverReq.season_id));
    expect(BigInt('0x' + sig[6])).toBe(0n);
  });

  it('contractProofToZk + ScVal builders accept the server response', () => {
    const zk = contractProofToZk(serverResp);
    expect(zk.proof.b).toHaveLength(128);
    expect(zk.vk.ic).toHaveLength(8);
    expect(pubSignalsToScVal(zk.pubSignals, xdr).vec()).toHaveLength(7);
    expect(proofToScVal(zk.proof, xdr).map()).toHaveLength(3);
    expect(vkToScVal(zk.vk, xdr).map().map((e) => e.key().sym().toString())).toEqual(['alpha', 'beta', 'delta', 'gamma', 'ic']);
  });

  it('validateGameRules uses the circuit minimum (score >= wave*5)', () => {
    expect(validateGameRules(3, 300).valid).toBe(true);
    expect(validateGameRules(3, 15).valid).toBe(true);
    expect(validateGameRules(3, 14).valid).toBe(false);
  });

  it('generateLocalProof feeds the circuit the hex run hash as the hi/lo limbs submit_zk binds', async () => {
    const input = read('circuits/fixtures/gamerun_s300_w3.input.json');
    const hex = BigInt(input.run_hash_hi).toString(16).padStart(32, '0') + BigInt(input.run_hash_lo).toString(16).padStart(32, '0');
    fullProve.mockResolvedValueOnce(raw);
    globalThis.fetch = vi.fn(async () => ({ json: async () => vkey }));
    const out = await generateLocalProof({ run_hash_hi: hex, score: 300, wave: 3, nonce: input.nonce, season_id: 1 });
    expect(fullProve.mock.calls[0][0]).toEqual(input);
    expect(out.run_hash_hex).toBe(hex);
    expect({ proof: out.proof, vk: out.vk, pub_signals: out.pub_signals }).toEqual(contractFixture);
  });

  it('generateLocalProof rejects a run below wave*5 before proving', async () => {
    fullProve.mockClear();
    await expect(generateLocalProof({ run_hash_hi: '0'.repeat(64), score: 14, wave: 3, nonce: 1 })).rejects.toThrow();
    expect(fullProve).not.toHaveBeenCalled();
  });
});
