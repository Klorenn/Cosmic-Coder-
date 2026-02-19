/**
 * Rank Manager - Centralized rank system configuration
 * Maps rank IDs to display properties and gameplay bonuses
 */

// Rank definitions (0-4)
export const RANKS = {
  0: {
    id: 0,
    name: 'UNRANKED',
    color: 0x808080, // Grey
    bonus: 0,
    sprite: null, // No icon for unranked
    description: 'Play ranked matches to earn your first rank.'
  },
  1: {
    id: 1,
    name: 'BRONZE',
    color: 0xCD7F32, // Bronze
    bonus: 0,
    sprite: 'rank_bronze',
    description: 'Entry level competitor.'
  },
  2: {
    id: 2,
    name: 'SILVER',
    color: 0xC0C0C0, // Silver
    bonus: 0.20,
    sprite: 'rank_silver',
    description: 'Consistent fighter. Gains early weapon chance.'
  },
  3: {
    id: 3,
    name: 'GOLD',
    color: 0xFFD700, // Gold
    bonus: 0.40,
    sprite: 'rank_gold',
    description: 'Elite player. Strong round 1 advantage.'
  },
  4: {
    id: 4,
    name: 'DIAMOND',
    color: 0xB9F2FF, // Diamond
    bonus: 0.60,
    sprite: 'rank_diamond',
    description: 'Top-tier combatant. High early spawn probability.'
  }
};

/**
 * Get rank data by ID
 * @param {number} rankId - Rank ID (0-4)
 * @returns {object} Rank data object
 */
export function getRankById(rankId) {
  return RANKS[rankId] || RANKS[0];
}

/**
 * Get rank name
 * @param {number} rankId - Rank ID
 * @returns {string} Rank name
 */
export function getRankName(rankId) {
  return getRankById(rankId).name;
}

/**
 * Get rank color (hex)
 * @param {number} rankId - Rank ID
 * @returns {number} Color in hex format
 */
export function getRankColor(rankId) {
  return getRankById(rankId).color;
}

/**
 * Get rank color as CSS string
 * @param {number} rankId - Rank ID
 * @returns {string} Color in CSS format
 */
export function getRankColorCSS(rankId) {
  const color = getRankColor(rankId);
  return '#' + color.toString(16).padStart(6, '0');
}

/**
 * Get rank bonus percentage (0-1)
 * @param {number} rankId - Rank ID
 * @returns {number} Bonus as decimal (e.g., 0.20 for 20%)
 */
export function getRankBonus(rankId) {
  return getRankById(rankId).bonus;
}

/**
 * Get rank bonus as percentage string
 * @param {number} rankId - Rank ID
 * @returns {string} Bonus percentage (e.g., "20%")
 */
export function getRankBonusPercent(rankId) {
  return Math.round(getRankBonus(rankId) * 100) + '%';
}

/**
 * Get rank sprite key
 * @param {number} rankId - Rank ID
 * @returns {string|null} Sprite key or null for unranked
 */
export function getRankSprite(rankId) {
  return getRankById(rankId).sprite;
}

/**
 * Get rank description
 * @param {number} rankId - Rank ID
 * @returns {string} Rank description
 */
export function getRankDescription(rankId) {
  return getRankById(rankId).description;
}

/**
 * Check if rank is unranked (0)
 * @param {number} rankId - Rank ID
 * @returns {boolean} True if unranked
 */
export function isUnranked(rankId) {
  return rankId === 0;
}

/**
 * Check if rank has an icon
 * @param {number} rankId - Rank ID
 * @returns {boolean} True if rank has an icon
 */
export function hasRankIcon(rankId) {
  return rankId > 0 && getRankSprite(rankId) !== null;
}

/**
 * Get all ranks (for display in rank system screen)
 * @returns {Array} Array of rank objects (excluding unranked)
 */
export function getAllRanks() {
  return Object.values(RANKS).filter(rank => rank.id > 0);
}

/**
 * Load rank sprites into Phaser scene
 * @param {Phaser.Scene} scene - Phaser scene
 */
export function loadRankSprites(scene) {
  const basePath = 'assets/UI/Ranks/';
  
  Object.values(RANKS).forEach(rank => {
    if (rank.sprite) {
      scene.load.image(rank.sprite, basePath + rank.sprite + '.png');
    }
  });
}

/**
 * Create rank icon in scene
 * @param {Phaser.Scene} scene - Phaser scene
 * @param {number} x - X position
 * @param {number} y - Y position
 * @param {number} rankId - Rank ID
 * @param {number} size - Icon size (default 32)
 * @returns {Phaser.GameObjects.Image|null} Rank icon or null if unranked
 */
export function createRankIcon(scene, x, y, rankId, size = 32) {
  if (isUnranked(rankId)) return null;
  
  const spriteKey = getRankSprite(rankId);
  if (!spriteKey) return null;
  
  const icon = scene.add.image(x, y, spriteKey);
  icon.setDisplaySize(size, size);
  return icon;
}

/**
 * Create rank text in scene
 * @param {Phaser.Scene} scene - Phaser scene
 * @param {number} x - X position
 * @param {number} y - Y position
 * @param {number} rankId - Rank ID
 * @param {object} style - Additional text style
 * @returns {Phaser.GameObjects.Text} Rank text
 */
export function createRankText(scene, x, y, rankId, style = {}) {
  const rank = getRankById(rankId);
  const color = '#' + rank.color.toString(16).padStart(6, '0');
  
  const text = isUnranked(rankId) ? 'UNRANKED' : rank.name;
  
  return scene.add.text(x, y, text, {
    fontFamily: 'monospace',
    fontSize: '14px',
    color: color,
    ...style
  });
}
