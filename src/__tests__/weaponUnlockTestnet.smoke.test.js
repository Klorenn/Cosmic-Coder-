import { describe, it, expect, vi, beforeAll } from 'vitest';
import acceptedTx from '../../circuits/fixtures/skillproof_w2_t1000.unlock_tx.json';

vi.mock('../services/NoirService.js', () => ({ NoirService: class {} }));
vi.mock('../utils/stellarWallet.js', () => ({ getFreighterNetwork: async () => null }));

// Live testnet read: TESTNET_SMOKE=1 npx vitest run src/__tests__/weaponUnlockTestnet.smoke.test.js
// Player = cosmic-deployer, which unlocked weapon 2 with the real SkillProof (tx in the fixture).
describe.skipIf(!process.env.TESTNET_SMOKE)('weaponClient against the testnet contract', () => {
  let client;
  beforeAll(async () => {
    vi.stubEnv('VITE_COSMIC_CODER_CONTRACT_ID', acceptedTx.contract);
    client = await import('../contracts/weaponClient.js');
  });

  it('isWeaponUnlocked decodes the on-chain bool', async () => {
    expect(await client.isWeaponUnlocked(acceptedTx.player, 2)).toBe(true);
    expect(await client.isWeaponUnlocked(acceptedTx.player, 5)).toBe(false);
  }, 30000);

  it('getUnlockedWeapons decodes Vec<u32> and includes the unlocked id', async () => {
    expect(await client.getUnlockedWeapons(acceptedTx.player)).toContain(2);
  }, 30000);
});
