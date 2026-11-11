import { describe, it, expect } from 'vitest';
import { WEAPON_TIERS, WEAPONS, WEAPON_UNLOCK_THRESHOLDS, getWeaponThreshold, getTierById } from '../config/weapons.js';
import { CONTRACT_WEAPON_THRESHOLDS } from '../contracts/weaponClient.js';

// Mirror of WEAPON_THRESHOLDS in contracts/cosmic_coder/src/lib.rs.
const CONTRACT = [0, 1000, 5000, 10000, 20000];

describe('WEAPON_TIERS: single source of truth matching the contract', () => {
  it('tier thresholds equal the on-chain WEAPON_THRESHOLDS', () => {
    const thresholds = Object.keys(WEAPON_TIERS).sort((a, b) => a - b).map((k) => WEAPON_TIERS[k].threshold);
    expect(thresholds).toEqual(CONTRACT);
    expect([...WEAPON_UNLOCK_THRESHOLDS]).toEqual(CONTRACT);
  });

  it('weaponClient reuses the config thresholds instead of duplicating them', () => {
    expect(CONTRACT_WEAPON_THRESHOLDS).toBe(WEAPON_UNLOCK_THRESHOLDS);
  });

  it('every weapon id maps to the contract threshold through its tier (what TitleScene shows)', () => {
    for (const w of Object.values(WEAPONS)) {
      expect(getTierById(w.tier).threshold).toBe(CONTRACT[w.id - 1]);
      expect(getWeaponThreshold(w.id)).toBe(CONTRACT[w.id - 1]);
    }
  });

  it('starter is free and thresholds strictly increase', () => {
    expect(WEAPON_TIERS[1].threshold).toBe(0);
    for (let i = 1; i < CONTRACT.length; i++) {
      expect(WEAPON_UNLOCK_THRESHOLDS[i]).toBeGreaterThan(WEAPON_UNLOCK_THRESHOLDS[i - 1]);
    }
  });

  it('unknown weapon ids have no threshold', () => {
    expect(getWeaponThreshold(0)).toBeNull();
    expect(getWeaponThreshold(6)).toBeNull();
  });
});
