/**
 * Pickup items dropped by enemies (pure data). Logic lives in systems/ItemManager.js.
 *
 * Fields:
 *   rarity   - key of RARITIES
 *   weight   - relative weight inside its rarity
 *   duration - ms for timed buffs (0 = instant)
 *   effect   - { type, value } interpreted by ItemManager.applyItem
 *   shape    - texture shape drawn by BootScene ('cross'|'diamond'|'circle'|'square'|'triangle'|'star'|'hex')
 *   nameKey  - i18n key (locales: items.*)
 */
export const RARITIES = {
  common: { color: 0xb0b0b0, order: 0 },
  rare: { color: 0x3399ff, order: 1 },
  epic: { color: 0xb044ff, order: 2 },
  legendary: { color: 0xffb000, order: 3 }
};

export const ITEMS = {
  health_patch: { id: 'health_patch', nameKey: 'items.health_patch', rarity: 'common', weight: 5, duration: 0, effect: { type: 'heal', value: 0.25 }, color: 0x44ff66, shape: 'cross' },
  cache_hit: { id: 'cache_hit', nameKey: 'items.cache_hit', rarity: 'common', weight: 4, duration: 0, effect: { type: 'xp', value: 40 }, color: 0x00ffff, shape: 'diamond' },
  bits_bag: { id: 'bits_bag', nameKey: 'items.bits_bag', rarity: 'common', weight: 3, duration: 0, effect: { type: 'bits', value: 5 }, color: 0x66ff99, shape: 'square' },
  // magnet: pulls pickups within `value` px AND vacuums every XP gem on the floor (systems/xpGems.js).
  magnet: { id: 'magnet', nameKey: 'items.magnet', rarity: 'rare', weight: 4, duration: 8000, effect: { type: 'magnet', value: 350, pullsGems: true }, color: 0xff3366, shape: 'circle' },
  overclock: { id: 'overclock', nameKey: 'items.overclock', rarity: 'rare', weight: 3, duration: 10000, effect: { type: 'attackRate', value: 1.5 }, color: 0xffcc00, shape: 'triangle' },
  firewall: { id: 'firewall', nameKey: 'items.firewall', rarity: 'rare', weight: 3, duration: 15000, effect: { type: 'shield', value: 60 }, color: 0xff7700, shape: 'hex' },
  root_access: { id: 'root_access', nameKey: 'items.root_access', rarity: 'epic', weight: 3, duration: 12000, effect: { type: 'damage', value: 1.5 }, color: 0xff2222, shape: 'star' },
  garbage_collector: { id: 'garbage_collector', nameKey: 'items.garbage_collector', rarity: 'epic', weight: 3, duration: 0, effect: { type: 'gc', value: 450 }, color: 0x99ff00, shape: 'square' },
  hotfix: { id: 'hotfix', nameKey: 'items.hotfix', rarity: 'legendary', weight: 2, duration: 0, effect: { type: 'revive', value: 0.5 }, color: 0xffffff, shape: 'cross' },
  stack_overflow: { id: 'stack_overflow', nameKey: 'items.stack_overflow', rarity: 'legendary', weight: 2, duration: 0, effect: { type: 'nuke', value: 5 }, color: 0xff00ff, shape: 'star' }
};

/** Enemy tiers used by drop tables. */
export const ENEMY_TIERS = ['trash', 'normal', 'elite', 'miniboss', 'boss'];

/**
 * Drop chance per kill and rarity weights per tier.
 * Trash never rolls legendary; bosses always drop and skew epic/legendary.
 */
export const DROP_TABLES = {
  trash: { chance: 0.02, rarityWeights: { common: 85, rare: 14, epic: 1, legendary: 0 } },
  normal: { chance: 0.04, rarityWeights: { common: 70, rare: 24, epic: 5, legendary: 1 } },
  elite: { chance: 0.15, rarityWeights: { common: 40, rare: 40, epic: 15, legendary: 5 } },
  miniboss: { chance: 1, rarityWeights: { common: 10, rare: 40, epic: 35, legendary: 15 } },
  boss: { chance: 1, rarityWeights: { common: 0, rare: 20, epic: 45, legendary: 35 } }
};

/** Kills without any item drop before one is guaranteed. */
export const PITY_THRESHOLD = 40;

/** Pickup lifetime on the ground (ms). */
export const ITEM_LIFETIME_MS = 12000;

/** Revive / shield caps. */
export const MAX_REVIVES = 1;
