/**
 * ItemManager — pure logic for pickup items (no Phaser).
 * ArenaScene owns an `itemState` and calls these functions; all functions return new objects.
 */
import { ITEMS, RARITIES, DROP_TABLES, PITY_THRESHOLD, MAX_REVIVES } from '../data/items.js';

const TRASH_ENEMIES = new Set(['bug', 'hallucination']);
const TIMED_TYPES = new Set(['magnet', 'attackRate', 'damage', 'shield']);
const DEFAULT_MAX_HEALTH = 100;

/** Finite number or fallback (rejects NaN, ±Infinity, strings, objects). */
function num(v, fallback = 0) {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/** Finite, non-negative number or fallback. */
function nonNeg(v, fallback = 0) {
  const n = num(v, fallback);
  return n < 0 ? fallback : n;
}

/**
 * Coerce any (possibly corrupted) item state into a sane one:
 * maxHealth > 0, health in [0, maxHealth], bits/shield/revives >= 0, arrays present.
 */
function normalizeState(state) {
  const src = state && typeof state === 'object' ? state : {};
  const maxHealth = num(src.maxHealth) > 0 ? src.maxHealth : DEFAULT_MAX_HEALTH;
  const health = Math.min(maxHealth, nonNeg(src.health, 0));
  return {
    ...src,
    health,
    maxHealth,
    shield: nonNeg(src.shield, 0),
    revives: Math.min(MAX_REVIVES, Math.floor(nonNeg(src.revives, 0))),
    reviveHealthPct: Math.min(1, nonNeg(src.reviveHealthPct, 0.5)),
    bits: nonNeg(src.bits, 0),
    effects: Array.isArray(src.effects) ? src.effects.filter((e) => e && typeof e === 'object' && Number.isFinite(e.remaining)) : [],
    pendingActions: Array.isArray(src.pendingActions) ? src.pendingActions : []
  };
}

/** Classify a spawned enemy (or plain object) into a drop tier. */
export function getEnemyTier(enemy) {
  if (!enemy) return 'trash';
  if (enemy.isBoss) return 'boss';
  if (enemy.isMiniBoss) return 'miniboss';
  if (enemy.isElite) return 'elite';
  if (TRASH_ENEMIES.has(enemy.enemyType)) return 'trash';
  return 'normal';
}

function pickWeighted(entries, r) {
  const total = entries.reduce((sum, [, w]) => sum + w, 0);
  if (total <= 0) return null;
  let target = r * total;
  for (const [key, w] of entries) {
    if (w <= 0) continue;
    if (target < w) return key;
    target -= w;
  }
  const last = entries.filter(([, w]) => w > 0).pop();
  return last ? last[0] : null;
}

/**
 * Roll an item drop for a kill.
 * @param {() => number} rng - returns [0, 1)
 * @param {string} enemyTier - one of ENEMY_TIERS (unknown -> 'normal')
 * @param {number} pityCounter - kills since the last item drop
 * @returns {{itemId: string|null, pityCounter: number, pity: boolean}}
 */
export function rollDrop(rng, enemyTier, pityCounter = 0) {
  const roll = typeof rng === 'function' ? () => num(rng(), 0.5) : Math.random;
  pityCounter = Math.floor(nonNeg(pityCounter, 0));
  const table = (typeof enemyTier === 'string' && Object.prototype.hasOwnProperty.call(DROP_TABLES, enemyTier))
    ? DROP_TABLES[enemyTier]
    : DROP_TABLES.normal;
  const dropped = roll() < table.chance;
  const pity = !dropped && pityCounter + 1 >= PITY_THRESHOLD;
  if (!dropped && !pity) return { itemId: null, pityCounter: pityCounter + 1, pity: false };

  const rarityOrder = Object.keys(RARITIES).sort((a, b) => RARITIES[a].order - RARITIES[b].order);
  const rarity = pickWeighted(rarityOrder.map((r) => [r, table.rarityWeights[r] || 0]), roll()) || 'common';
  const candidates = Object.values(ITEMS).filter((it) => it.rarity === rarity);
  const pool = candidates.length ? candidates : Object.values(ITEMS).filter((it) => it.rarity === 'common');
  const itemId = pickWeighted(pool.map((it) => [it.id, it.weight]), roll());
  return { itemId, pityCounter: 0, pity };
}

/** Fresh per-run item state. */
export function createItemState({ health = 100, maxHealth = 100 } = {}) {
  return { health, maxHealth, shield: 0, revives: 0, reviveHealthPct: 0.5, bits: 0, effects: [], pendingActions: [] };
}

function upsertEffect(effects, item, value) {
  const next = effects.filter((e) => e.id !== item.id);
  const entry = { id: item.id, type: item.effect.type, value, remaining: item.duration };
  if (item.effect.pullsGems === true) entry.pullsGems = true;
  next.push(entry);
  return next;
}

/**
 * Apply a picked-up item. Instant scene-side effects (xp, bits, nuke, gc) are queued in pendingActions.
 * @param {object} state - from createItemState
 * @param {object} item - ITEMS entry
 */
export function applyItem(state, item) {
  const s = normalizeState(state);
  if (!item || typeof item !== 'object' || !item.effect || typeof item.effect !== 'object') return s;
  const { type } = item.effect;
  // Hostile/corrupt effect values are clamped to finite, non-negative numbers.
  const value = nonNeg(item.effect.value, 0);
  switch (type) {
    case 'heal':
      s.health = Math.min(s.maxHealth, s.health + Math.ceil(s.maxHealth * value));
      break;
    case 'bits':
      s.bits += value;
      if (value > 0) s.pendingActions.push({ type: 'bits', value });
      break;
    case 'revive':
      s.revives = Math.min(MAX_REVIVES, s.revives + 1);
      s.reviveHealthPct = Math.min(1, value);
      break;
    case 'shield':
      s.shield = value;
      break;
    case 'xp':
    case 'nuke':
    case 'gc':
      s.pendingActions.push({ type, value });
      break;
    default:
      break;
  }
  if (TIMED_TYPES.has(type) && num(item.duration) > 0) s.effects = upsertEffect(s.effects, item, value);
  return s;
}

/** Advance timed effects by dt ms; expired effects are removed (shield expiry clears the shield). */
export function tickEffects(state, dt) {
  const s = normalizeState(state);
  // A negative / NaN dt must never extend a buff.
  const step = nonNeg(dt, 0);
  const effects = s.effects
    .map((e) => ({ ...e, remaining: e.remaining - step }))
    .filter((e) => e.remaining > 0);
  const shieldAlive = effects.some((e) => e.type === 'shield');
  return { ...s, effects, shield: shieldAlive ? s.shield : 0 };
}

/** Aggregate stat modifiers from active effects. */
export function getItemModifiers(state) {
  const s = normalizeState(state);
  const mods = { damageMult: 1, attackRateMult: 1, magnetRadius: 0, magnetGems: false, shield: s.shield };
  for (const e of s.effects) {
    // Ignore poisoned values: multipliers must be finite and > 0.
    const v = num(e.value, 0);
    if (v <= 0) continue;
    if (e.type === 'damage') mods.damageMult *= v;
    else if (e.type === 'attackRate') mods.attackRateMult *= v;
    else if (e.type === 'magnet') {
      mods.magnetRadius = Math.max(mods.magnetRadius, v);
      if (e.pullsGems === true) mods.magnetGems = true; // vacuum every XP gem (systems/xpGems.js)
    }
  }
  return mods;
}

/**
 * Absorb incoming damage with the shield.
 * @returns {{state: object, damage: number}} remaining damage to apply to the player
 */
export function absorbDamage(state, damage) {
  if (typeof damage !== 'number' || Number.isNaN(damage) || damage <= 0) return { state, damage: 0 };
  if (!state || !(num(state.shield) > 0)) return { state, damage };
  const absorbed = Math.min(state.shield, damage);
  const shield = state.shield - absorbed;
  const effects = shield > 0 ? state.effects : state.effects.filter((e) => e.type !== 'shield');
  return { state: { ...state, shield, effects }, damage: damage - absorbed };
}

/** Consume a revive if available; restores health to reviveHealthPct of max. */
export function consumeRevive(state) {
  if (!state || !(num(state.revives) > 0)) return { revived: false, state };
  const s = normalizeState(state);
  const health = Math.min(s.maxHealth, Math.max(1, Math.ceil(s.maxHealth * s.reviveHealthPct)));
  return { revived: true, state: { ...s, revives: Math.max(0, s.revives - 1), health } };
}

/** Take queued scene actions and clear the queue. */
export function drainActions(state) {
  const s = normalizeState(state);
  return { actions: s.pendingActions, state: { ...s, pendingActions: [] } };
}

export default { getEnemyTier, rollDrop, createItemState, applyItem, tickEffects, getItemModifiers, absorbDamage, consumeRevive, drainActions };
