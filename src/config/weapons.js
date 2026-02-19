/**
 * Weapon configuration for Web3 unlock system
 * Maps on-chain weapon IDs to game weapon types
 */

// Weapon tiers with thresholds and round 1 bonuses
export const WEAPON_TIERS = {
  1: { name: 'Bronze', threshold: 0, round1Bonus: 0 },
  2: { name: 'Silver', threshold: 1000, round1Bonus: 0.2 },
  3: { name: 'Gold', threshold: 5000, round1Bonus: 0.5 },
  4: { name: 'Mythic', threshold: 10000, round1Bonus: 1.0 }
};

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
    tier: 4,
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
