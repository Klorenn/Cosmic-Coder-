/**
 * Weapon configuration for Web3 unlock system
 * Maps on-chain weapon IDs to game weapon types
 */

// Weapon unlock tiers. SINGLE SOURCE OF TRUTH for unlock thresholds: must equal
// WEAPON_THRESHOLDS in contracts/cosmic_coder/src/lib.rs (unlock_weapon checks `score >= threshold`).
// Tier N unlocks weapon id N. Tier 1 (Starter) is available to everyone.
export const WEAPON_TIERS = Object.freeze({
  1: Object.freeze({ name: 'Bronze', threshold: 0, round1Bonus: 0 }),
  2: Object.freeze({ name: 'Silver', threshold: 1000, round1Bonus: 0.2 }),
  3: Object.freeze({ name: 'Gold', threshold: 5000, round1Bonus: 0.5 }),
  4: Object.freeze({ name: 'Diamond', threshold: 10000, round1Bonus: 1.0 }),
  5: Object.freeze({ name: 'Quantum', threshold: 20000, round1Bonus: 1.0 })
});

/** Threshold per weapon id (index = id - 1). Re-exported by weaponClient as CONTRACT_WEAPON_THRESHOLDS. */
export const WEAPON_UNLOCK_THRESHOLDS = Object.freeze(
  Object.keys(WEAPON_TIERS).sort((a, b) => a - b).map((k) => WEAPON_TIERS[k].threshold)
);

// Weapon definitions mapping IDs to game types
export const WEAPONS = {
  1: {
    id: 1,
    name: 'Starter',
    tier: 1,
    type: 'basic',
    description: 'Basic weapon available to all players'
  },
  2: {
    id: 2,
    name: 'Shotgun',
    tier: 2,
    type: 'spread',
    description: 'Spread shot weapon'
  },
  3: {
    id: 3,
    name: 'Tactical Rifle',
    tier: 3,
    type: 'pierce',
    description: 'Piercing shots'
  },
  4: {
    id: 4,
    name: 'Plasma Rifle',
    tier: 4,
    type: 'rapid',
    description: 'Rapid fire weapon'
  },
  5: {
    id: 5,
    name: 'Quantum Destroyer',
    tier: 5,
    type: 'rmrf',
    description: 'Ultimate weapon - clears all enemies'
  }
};

// Map weapon type to game weapon configuration
export const WEAPON_TYPE_CONFIG = {
  basic: { attackRate: 0.6, damage: 1, projectiles: 1, pierce: false, color: 0x00ffff },
  spread: { attackRate: 1, damage: 0.7, projectiles: 5, pierce: false, color: 0xff9900 },
  pierce: { attackRate: 0.8, damage: 1.5, projectiles: 1, pierce: true, color: 0x0099ff },
  rapid: { attackRate: 3, damage: 0.5, projectiles: 1, pierce: false, color: 0xffcc00 },
  rmrf: { attackRate: 0, damage: 0, projectiles: 0, pierce: false, color: 0xff0000, special: 'clearAll' }
};

// Get weapon by ID
export function getWeaponById(weaponId) {
  return WEAPONS[weaponId] || null;
}

// Get tier info by tier ID
export function getTierById(tierId) {
  return WEAPON_TIERS[tierId] || WEAPON_TIERS[1];
}

// Score needed to unlock a weapon on-chain (null for unknown ids)
export function getWeaponThreshold(weaponId) {
  const weapon = getWeaponById(weaponId);
  return weapon ? getTierById(weapon.tier).threshold : null;
}

// Get weapon type config
export function getWeaponTypeConfig(type) {
  return WEAPON_TYPE_CONFIG[type] || WEAPON_TYPE_CONFIG.basic;
}

// Calculate starting weapon chance based on tier
export function getStartingWeaponChance(tierId) {
  const tier = getTierById(tierId);
  return tier.round1Bonus;
}

// Check if weapon should be available at round start
export function canStartWithWeapon(weaponId, tierId) {
  const weapon = getWeaponById(weaponId);
  if (!weapon) return false;
  
  // Starter weapon always available
  if (weaponId === 1) return true;
  
  // Check if player's tier meets weapon tier
  return tierId >= weapon.tier;
}

// Get all weapons unlockable at a given tier
export function getWeaponsForTier(tierId) {
  return Object.values(WEAPONS).filter(w => w.tier <= tierId);
}
