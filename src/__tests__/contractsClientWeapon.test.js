import { describe, it, expect, vi } from 'vitest';
import { xdr, Address, Keypair } from '@stellar/stellar-sdk';

vi.mock('../services/NoirService.js', () => ({ NoirService: class {} }));
vi.mock('../utils/stellarWallet.js', () => ({ getFreighterNetwork: async () => null }));

import { buildUnlockWeaponArgs, CONTRACT_WEAPON_THRESHOLDS } from '../contracts/weaponClient.js';

const hex = (n, byte) => byte.toString(16).padStart(2, '0').repeat(n);
const prover = () => ({
  proof: { a: hex(64, 1), b: hex(128, 2), c: hex(64, 3) },
  vk: {
    alpha: hex(64, 4), beta: hex(128, 5), gamma: hex(128, 6), delta: hex(128, 7),
    ic: [hex(64, 8), hex(64, 9), hex(64, 10)]
  },
  pub_signals: [hex(32, 0), hex(32, 11)]
});
const player = Keypair.random().publicKey();

describe('buildUnlockWeaponArgs', () => {
  it('builds typed ScVals matching unlock_weapon(player, weapon_id, proof, vk, pub_signals, threshold)', async () => {
    const args = await buildUnlockWeaponArgs(player, 2, prover());
    expect(args).toHaveLength(6);
    args.forEach((a) => expect(a).toBeInstanceOf(xdr.ScVal));
    expect(Address.fromScVal(args[0]).toString()).toBe(player);
    expect(args[1].switch().name).toBe('scvU32');
    expect(args[1].u32()).toBe(2);
    expect(args[2].switch().name).toBe('scvMap');
    expect(args[3].switch().name).toBe('scvMap');
    expect(args[4].switch().name).toBe('scvVec');
    expect(args[4].vec()).toHaveLength(2);
    args[4].vec().forEach((s) => expect(s.bytes().length).toBe(32));
    expect(args[5].switch().name).toBe('scvU32');
    expect(args[5].u32()).toBe(CONTRACT_WEAPON_THRESHOLDS[1]);
  });

  it('sorts map keys as Soroban requires', async () => {
    const [, , proofMap, vkMap] = await buildUnlockWeaponArgs(player, 2, prover());
    const keys = (m) => m.map().map((e) => e.key().sym().toString());
    expect(keys(proofMap)).toEqual(['a', 'b', 'c']);
    expect(keys(vkMap)).toEqual(['alpha', 'beta', 'delta', 'gamma', 'ic']);
  });

  it('uses the contract threshold table, not frontend rank thresholds', async () => {
    expect(CONTRACT_WEAPON_THRESHOLDS).toEqual([0, 1000, 5000, 10000, 20000]);
    expect((await buildUnlockWeaponArgs(player, 5, prover()))[5].u32()).toBe(20000);
  });

  it('rejects invalid weapon ids before building anything', async () => {
    await expect(buildUnlockWeaponArgs(player, 0, prover())).rejects.toThrow(/weapon/i);
    await expect(buildUnlockWeaponArgs(player, 6, prover())).rejects.toThrow(/weapon/i);
    await expect(buildUnlockWeaponArgs(player, 1.5, prover())).rejects.toThrow(/weapon/i);
  });

  it('rejects malformed prover payloads', async () => {
    const p = prover();
    await expect(buildUnlockWeaponArgs(player, 2, { ...p, pub_signals: [hex(32, 0)] })).rejects.toThrow(/pub_signals/);
    await expect(buildUnlockWeaponArgs(player, 2, { ...p, vk: undefined })).rejects.toThrow();
    await expect(buildUnlockWeaponArgs(player, 2, null)).rejects.toThrow();
  });
});
