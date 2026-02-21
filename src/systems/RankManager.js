/**
 * Rank Manager - Centralized rank system configuration
 * Maps rank IDs to display properties and gameplay bonuses
 */

// Rank definitions (0-4). emoji = clean symbol without number (no 🥉🥈🥇 numbers)
export const RANKS = {
  0: {
    id: 0,
    name: 'UNRANKED',
    color: 0x808080,
    bonus: 0,
    sprite: null,
    emoji: '',
    description: 'Play ranked matches to earn your first rank.',
    minScore: 0,
    minWave: 0
  },
  1: {
    id: 1,
    name: 'BRONZE',
    color: 0xCD7F32,
    bonus: 0,
    sprite: 'rank_bronze',
    emoji: '🟤',
    description: 'Entry level competitor.',
    minScore: 50,
    minWave: 3
  },
  2: {
    id: 2,
    name: 'SILVER',
    color: 0xC0C0C0,
    bonus: 0.20,
    sprite: 'rank_silver',
    emoji: '⚪',
    description: 'Consistent fighter. Gains early weapon chance.',
    minScore: 500,
    minWave: 10
  },
  3: {
    id: 3,
    name: 'GOLD',
    color: 0xFFD700,
    bonus: 0.40,
    sprite: 'rank_gold',
    emoji: '🟡',
    description: 'Elite player. Strong round 1 advantage.',
    minScore: 2000,
    minWave: 25
  },
  4: {
    id: 4,
    name: 'DIAMOND',
    color: 0xB9F2FF,
    bonus: 0.60,
    sprite: 'rank_diamond',
    emoji: '💎',
    description: 'Top-tier combatant. High early spawn probability.',
    minScore: 10000,
    minWave: 50
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
 * Get rank emoji (clean symbol, no number in middle). Use this for display instead of sprite.
 * @param {number} rankId - Rank ID
 * @returns {string} Emoji or '' for unranked
 */
export function getRankEmoji(rankId) {
  return getRankById(rankId).emoji || '';
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
 * Get rank ID from score/wave when API doesn't return rank (e.g. 0 or undefined).
 * Returns highest rank the player qualifies for (1=Bronze, 2=Silver, 3=Gold, 4=Diamond, 0=Unranked).
 * @param {number} score - Best score
 * @param {number} wave - Best wave reached
 * @returns {number} Rank ID (0-4)
 */
export function getRankIdFromScore(score, wave = 0) {
  const s = Number(score) || 0;
  const w = Number(wave) || 0;
  if (s >= (RANKS[4].minScore || 0) && w >= (RANKS[4].minWave || 0)) return 4;
  if (s >= (RANKS[3].minScore || 0) && w >= (RANKS[3].minWave || 0)) return 3;
  if (s >= (RANKS[2].minScore || 0) && w >= (RANKS[2].minWave || 0)) return 2;
  if (s >= (RANKS[1].minScore || 0) && w >= (RANKS[1].minWave || 0)) return 1;
  return 0;
}

/**
 * Check if rank is unranked (0)
 * @param {number} rankId - Rank ID
 * @returns {boolean} True if unranked
 */
export function isUnranked(rankId) {
  return rankId == null || rankId === 0;
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
  const basePath = '/assets/UI/Ranks/';
  
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
