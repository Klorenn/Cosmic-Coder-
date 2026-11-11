import { describe, it, expect, vi, afterEach } from 'vitest';
import { xdr, Address, Keypair, nativeToScVal } from '@stellar/stellar-sdk';

vi.mock('../services/NoirService.js', () => ({ NoirService: class {} }));
vi.mock('../utils/stellarWallet.js', () => ({ getFreighterNetwork: async () => null }));

import { isRankedVerified, decodeCasualLeaderboard, snarkjsToContractProof } from '../contracts/gameClient.js';
import { buildUnlockWeaponArgs } from '../contracts/weaponClient.js';

const h32 = (n) => BigInt(n).toString(16).padStart(64, '0');
const toHex = (u8) => Buffer.from(u8).toString('hex');

describe('isRankedVerified', () => {
  afterEach(() => { if (globalThis.window) delete window.__VITE_CONFIG__; });

  it('defaults to false when nothing is configured', () => {
    globalThis.window = globalThis.window || {};
    delete window.__VITE_CONFIG__;
    expect(isRankedVerified()).toBe(false);
  });

  it('noir backend: true only for the exact string "true"', () => {
    globalThis.window = globalThis.window || {};
    window.__VITE_CONFIG__ = { VITE_ZK_BACKEND: 'noir', VITE_RANKED_VERIFIED: 'true' };
    expect(isRankedVerified()).toBe(true);
    for (const v of ['false', 'TRUE', '1', '', true, undefined]) {
      window.__VITE_CONFIG__ = { VITE_ZK_BACKEND: 'noir', VITE_RANKED_VERIFIED: v };
      expect(isRankedVerified()).toBe(false);
    }
  });
});

describe('decodeCasualLeaderboard', () => {
  const entry = (player, wave, score) => xdr.ScVal.scvMap([
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol('player'), val: new Address(player).toScVal() }),
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol('score'), val: nativeToScVal(BigInt(score), { type: 'i128' }) }),
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol('wave'), val: xdr.ScVal.scvU32(wave) })
  ]);

  it('decodes Vec<LeaderboardEntry> with G-address players and numeric score/wave', () => {
    const a = Keypair.random().publicKey();
    const b = Keypair.random().publicKey();
    const retval = xdr.ScVal.scvVec([entry(a, 9, 300), entry(b, 2, 100)]);
    expect(decodeCasualLeaderboard(retval)).toEqual([
      { player: a, wave: 9, score: 300 },
      { player: b, wave: 2, score: 100 }
    ]);
  });

  it('returns [] for empty / missing / non-vec values', () => {
    expect(decodeCasualLeaderboard(xdr.ScVal.scvVec([]))).toEqual([]);
    expect(decodeCasualLeaderboard(null)).toEqual([]);
    expect(decodeCasualLeaderboard(xdr.ScVal.scvU32(1))).toEqual([]);
  });
});

describe('snarkjsToContractProof', () => {
  // snarkjs layout: pi_b = [[x_c0, x_c1], [y_c0, y_c1], [1, 0]]; contract expects x_c1||x_c0||y_c1||y_c0.
  const snark = {
    pi_a: ['1', '2', '1'],
    pi_b: [['3', '4'], ['5', '6'], ['1', '0']],
    pi_c: ['7', '8', '1'],
    protocol: 'groth16'
  };
  const vkey = {
    vk_alpha_1: ['9', '10', '1'],
    vk_beta_2: [['11', '12'], ['13', '14'], ['1', '0']],
    vk_gamma_2: [['15', '16'], ['17', '18'], ['1', '0']],
    vk_delta_2: [['19', '20'], ['21', '22'], ['1', '0']],
    IC: [['23', '24', '1'], ['25', '26', '1'], ['27', '28', '1']]
  };

  it('converts decimal snarkjs proof/vk/signals to 32-byte big-endian hex', () => {
    const out = snarkjsToContractProof(snark, ['1000', '123456789012345678901234567890'], vkey);
    expect(out.proof.a).toBe(h32(1) + h32(2));
    expect(out.proof.b).toBe(h32(4) + h32(3) + h32(6) + h32(5));
    expect(out.proof.c).toBe(h32(7) + h32(8));
    expect(out.vk.alpha).toBe(h32(9) + h32(10));
    expect(out.vk.beta).toBe(h32(12) + h32(11) + h32(14) + h32(13));
    expect(out.vk.ic).toEqual([h32(23) + h32(24), h32(25) + h32(26), h32(27) + h32(28)]);
    expect(out.pub_signals).toEqual([h32(1000), h32('123456789012345678901234567890')]);
  });

  it('accepts the legacy prover layout (a/b/c arrays, G2 limbs already swapped) without re-swapping', () => {
    const legacy = { a: ['1', '2'], b: [['4', '3'], ['6', '5']], c: ['7', '8'] };
    const legacyVk = {
      alpha: ['9', '10'], beta: [['12', '11'], ['14', '13']], gamma: [['16', '15'], ['18', '17']],
      delta: [['20', '19'], ['22', '21']], ic: [['23', '24'], ['25', '26'], ['27', '28']]
    };
    const out = snarkjsToContractProof(legacy, ['5'], legacyVk);
    expect(out.proof.b).toBe(h32(4) + h32(3) + h32(6) + h32(5));
    expect(out.vk.beta).toBe(h32(12) + h32(11) + h32(14) + h32(13));
    expect(out.pub_signals).toEqual([h32(5)]);
  });

  it('rejects non-decimal or out-of-range signals', () => {
    expect(() => snarkjsToContractProof(snark, ['0xzz'], vkey)).toThrow();
    expect(() => snarkjsToContractProof(snark, [(1n << 256n).toString()], vkey)).toThrow();
  });
});

describe('buildUnlockWeaponArgs with the /skill-proof (snarkjs decimal) payload', () => {
  it('builds 32-byte signals carrying the decimal values', async () => {
    const player = Keypair.random().publicKey();
    const payload = {
      proof: { a: ['1', '2'], b: [['4', '3'], ['6', '5']], c: ['7', '8'] },
      vk: {
        alpha: ['9', '10'], beta: [['12', '11'], ['14', '13']], gamma: [['16', '15'], ['18', '17']],
        delta: [['20', '19'], ['22', '21']], ic: [['23', '24'], ['25', '26'], ['27', '28']]
      },
      pub_signals: ['1000', '987654321']
    };
    const args = await buildUnlockWeaponArgs(player, 2, payload);
    const sigs = args[4].vec().map((s) => toHex(s.bytes()));
    expect(sigs).toEqual([h32(1000), h32(987654321)]);
    const proofMap = args[2].map();
    expect(toHex(proofMap[0].val().bytes())).toBe(h32(1) + h32(2));
  });
});
