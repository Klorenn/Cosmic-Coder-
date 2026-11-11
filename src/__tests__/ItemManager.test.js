import { describe, it, expect } from 'vitest';
import { ITEMS, RARITIES, DROP_TABLES, PITY_THRESHOLD, ENEMY_TIERS } from '../data/items.js';
import {
  createItemState, rollDrop, applyItem, tickEffects, getItemModifiers, absorbDamage, consumeRevive, getEnemyTier
} from '../systems/ItemManager.js';

/** Deterministic rng returning a fixed sequence (cycled). */
const seq = (...values) => { let i = 0; return () => values[i++ % values.length]; };

describe('items data', () => {
  const list = Object.values(ITEMS);

  it('defines at least 10 items with unique ids matching keys', () => {
    expect(list.length).toBeGreaterThanOrEqual(10);
    Object.entries(ITEMS).forEach(([k, v]) => expect(v.id).toBe(k));
  });

  it('each item has a valid rarity, positive weight, duration >= 0, effect and i18n key', () => {
    list.forEach((it) => {
      expect(RARITIES[it.rarity]).toBeDefined();
      expect(it.weight).toBeGreaterThan(0);
      expect(it.duration).toBeGreaterThanOrEqual(0);
      expect(typeof it.effect.type).toBe('string');
      expect(typeof it.nameKey).toBe('string');
      expect(typeof it.color).toBe('number');
    });
  });

  it('covers every rarity at least once', () => {
    Object.keys(RARITIES).forEach((r) => expect(list.some((i) => i.rarity === r)).toBe(true));
  });

  it('every drop table has chance in [0,1] and rarity weights > 0 total', () => {
    ENEMY_TIERS.forEach((tier) => {
      const t = DROP_TABLES[tier];
      expect(t).toBeDefined();
      expect(t.chance).toBeGreaterThanOrEqual(0);
      expect(t.chance).toBeLessThanOrEqual(1);
      const total = Object.values(t.rarityWeights).reduce((a, b) => a + b, 0);
      expect(total).toBeGreaterThan(0);
    });
    expect(DROP_TABLES.boss.chance).toBe(1);
    expect(PITY_THRESHOLD).toBeGreaterThan(0);
  });
});

describe('rollDrop', () => {
  it('returns no item and increments pity when roll fails', () => {
    const r = rollDrop(seq(0.99), 'trash', 3);
    expect(r.itemId).toBeNull();
    expect(r.pityCounter).toBe(4);
  });

  it('returns an item and resets pity when roll succeeds', () => {
    const r = rollDrop(seq(0, 0, 0), 'normal', 7);
    expect(r.itemId).not.toBeNull();
    expect(ITEMS[r.itemId]).toBeDefined();
    expect(r.pityCounter).toBe(0);
  });

  it('pity guarantees a drop after PITY_THRESHOLD kills without one', () => {
    const r = rollDrop(seq(0.99, 0, 0), 'trash', PITY_THRESHOLD - 1);
    expect(r.itemId).not.toBeNull();
    expect(r.pity).toBe(true);
    expect(r.pityCounter).toBe(0);
  });

  it('boss tier always drops and favours high rarities', () => {
    const counts = {};
    let x = 0;
    const rng = () => { x = (x * 9301 + 49297) % 233280; return x / 233280; };
    for (let i = 0; i < 2000; i++) {
      const r = rollDrop(rng, 'boss', 0);
      expect(r.itemId).not.toBeNull();
      const rar = ITEMS[r.itemId].rarity;
      counts[rar] = (counts[rar] || 0) + 1;
    }
    expect((counts.epic || 0) + (counts.legendary || 0)).toBeGreaterThan(counts.common || 0);
  });

  it('trash tier never drops legendary', () => {
    let x = 7;
    const rng = () => { x = (x * 9301 + 49297) % 233280; return x / 233280; };
    for (let i = 0; i < 3000; i++) {
      const r = rollDrop(rng, 'trash', 0);
      if (r.itemId) expect(ITEMS[r.itemId].rarity).not.toBe('legendary');
    }
  });

  it('unknown tier falls back to normal', () => {
    const r = rollDrop(seq(0, 0, 0), 'whatever', 0);
    expect(r.itemId).not.toBeNull();
  });
});

describe('applyItem / tickEffects', () => {
  const base = () => createItemState({ health: 50, maxHealth: 100 });

  it('health patch heals without exceeding max', () => {
    const s = applyItem(base(), ITEMS.health_patch);
    expect(s.health).toBeGreaterThan(50);
    expect(s.health).toBeLessThanOrEqual(100);
    const full = applyItem(createItemState({ health: 99, maxHealth: 100 }), ITEMS.health_patch);
    expect(full.health).toBe(100);
  });

  it('is immutable', () => {
    const s0 = base();
    applyItem(s0, ITEMS.overclock);
    expect(s0.effects).toHaveLength(0);
  });

  it('timed buffs refresh instead of stacking', () => {
    let s = applyItem(base(), ITEMS.overclock);
    s = tickEffects(s, 1000);
    s = applyItem(s, ITEMS.overclock);
    expect(s.effects.filter((e) => e.id === 'overclock')).toHaveLength(1);
    expect(s.effects[0].remaining).toBe(ITEMS.overclock.duration);
  });

  it('tickEffects expires buffs', () => {
    let s = applyItem(base(), ITEMS.root_access);
    expect(getItemModifiers(s).damageMult).toBeGreaterThan(1);
    s = tickEffects(s, ITEMS.root_access.duration + 1);
    expect(s.effects).toHaveLength(0);
    expect(getItemModifiers(s).damageMult).toBe(1);
  });

  it('modifiers: overclock speeds attacks, magnet enables pull', () => {
    let s = applyItem(base(), ITEMS.overclock);
    s = applyItem(s, ITEMS.magnet);
    const m = getItemModifiers(s);
    expect(m.attackRateMult).toBeGreaterThan(1);
    expect(m.magnetRadius).toBeGreaterThan(0);
    expect(m.magnetGems).toBe(true); // magnet also vacuums XP gems
    expect(getItemModifiers(applyItem(base(), ITEMS.overclock)).magnetGems).toBe(false);
  });

  it('firewall shield absorbs damage then breaks', () => {
    let s = applyItem(base(), ITEMS.firewall);
    const shield = s.shield;
    expect(shield).toBeGreaterThan(0);
    const r1 = absorbDamage(s, shield - 1);
    expect(r1.damage).toBe(0);
    const r2 = absorbDamage(r1.state, 10);
    expect(r2.damage).toBe(9);
    expect(r2.state.shield).toBe(0);
  });

  it('firewall shield expires with its duration', () => {
    let s = applyItem(base(), ITEMS.firewall);
    s = tickEffects(s, ITEMS.firewall.duration + 1);
    expect(s.shield).toBe(0);
  });

  it('hotfix grants one revive (capped) and consumeRevive restores health', () => {
    let s = applyItem(base(), ITEMS.hotfix);
    s = applyItem(s, ITEMS.hotfix);
    expect(s.revives).toBe(1);
    const r = consumeRevive({ ...s, health: 0 });
    expect(r.revived).toBe(true);
    expect(r.state.health).toBeGreaterThan(0);
    expect(r.state.revives).toBe(0);
    expect(consumeRevive(r.state).revived).toBe(false);
  });

  it('instant rewards queue actions for the scene (xp, bits, nuke, gc)', () => {
    let s = applyItem(base(), ITEMS.cache_hit);
    s = applyItem(s, ITEMS.bits_bag);
    s = applyItem(s, ITEMS.stack_overflow);
    s = applyItem(s, ITEMS.garbage_collector);
    const types = s.pendingActions.map((a) => a.type);
    expect(types).toEqual(expect.arrayContaining(['xp', 'bits', 'nuke', 'gc']));
    expect(s.bits).toBe(ITEMS.bits_bag.effect.value);
  });
});

describe('getEnemyTier', () => {
  it('classifies enemies', () => {
    expect(getEnemyTier({ isBoss: true })).toBe('boss');
    expect(getEnemyTier({ isMiniBoss: true })).toBe('miniboss');
    expect(getEnemyTier({ isElite: true })).toBe('elite');
    expect(getEnemyTier({ enemyType: 'bug' })).toBe('trash');
    expect(getEnemyTier({ enemyType: 'glitch' })).toBe('normal');
    expect(getEnemyTier(null)).toBe('trash');
  });
});

describe('i18n coverage', () => {
  it('every item and mini-boss name key exists in en and es', async () => {
    const en = (await import('../locales/en.js')).default;
    const es = (await import('../locales/es.js')).default;
    const { MINI_BOSSES } = await import('../data/enemies.js');
    const resolve = (loc, key) => key.split('.').reduce((v, p) => v?.[p], loc);
    const keys = [...Object.values(ITEMS).map((i) => i.nameKey), ...Object.values(MINI_BOSSES).map((m) => m.nameKey), 'items.revived'];
    keys.forEach((k) => {
      expect(typeof resolve(en, k)).toBe('string');
      expect(typeof resolve(es, k)).toBe('string');
    });
  });
});
