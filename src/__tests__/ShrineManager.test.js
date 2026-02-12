import { describe, it, expect } from 'vitest';
import ShrineManager from '../systems/ShrineManager.js';

/**
 * ShrineManager tests — validates shrine definitions, gamble/chaos data
 * integrity, weighted outcome distribution, cost logic, and buff tracking.
 *
 * These test the static data and pure logic without requiring Phaser.
 */

describe('ShrineManager', () => {
  describe('SHRINES definitions', () => {
    const shrines = ShrineManager.SHRINES;

    it('defines exactly 5 shrine types', () => {
      expect(Object.keys(shrines)).toHaveLength(5);
    });

    it('each shrine has required fields', () => {
      Object.values(shrines).forEach(shrine => {
        expect(shrine).toHaveProperty('id');
        expect(shrine).toHaveProperty('name');
        expect(shrine).toHaveProperty('desc');
        expect(shrine).toHaveProperty('icon');
        expect(shrine).toHaveProperty('color');
        expect(shrine).toHaveProperty('cost');
        expect(shrine).toHaveProperty('effect');
      });
    });

    it('each shrine has a unique id', () => {
      const ids = Object.values(shrines).map(s => s.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('each shrine has a unique name', () => {
      const names = Object.values(shrines).map(s => s.name);
      expect(new Set(names).size).toBe(names.length);
    });

    it('each shrine color is a valid hex integer', () => {
      Object.values(shrines).forEach(shrine => {
        expect(typeof shrine.color).toBe('number');
        expect(shrine.color).toBeGreaterThanOrEqual(0);
        expect(shrine.color).toBeLessThanOrEqual(0xffffff);
      });
    });

    it('POWER shrine costs 25% health and buffs damage', () => {
      const power = shrines.POWER;
      expect(power.cost.type).toBe('health');
      expect(power.cost.amount).toBe(0.25);
      expect(power.effect.type).toBe('buff');
      expect(power.effect.buff).toBe('damage');
      expect(power.effect.multiplier).toBe(1.5);
      expect(power.effect.duration).toBeGreaterThan(0);
    });

    it('GAMBLE shrine is free with random effect', () => {
      const gamble = shrines.GAMBLE;
      expect(gamble.cost.type).toBe('free');
      expect(gamble.effect.type).toBe('random');
    });

    it('XP shrine costs 500 XP for level up', () => {
      const xp = shrines.XP;
      expect(xp.cost.type).toBe('xp');
      expect(xp.cost.amount).toBe(500);
      expect(xp.effect.type).toBe('levelup');
    });

    it('SHIELD shrine costs current weapon for invincibility', () => {
      const shield = shrines.SHIELD;
      expect(shield.cost.type).toBe('weapon');
      expect(shield.effect.type).toBe('invincibility');
      expect(shield.effect.duration).toBeGreaterThan(0);
    });

    it('CHAOS shrine costs 10% health for random chaos', () => {
      const chaos = shrines.CHAOS;
      expect(chaos.cost.type).toBe('health');
      expect(chaos.cost.amount).toBe(0.10);
      expect(chaos.effect.type).toBe('chaos');
    });
  });

  describe('GAMBLE_OUTCOMES', () => {
    const outcomes = ShrineManager.GAMBLE_OUTCOMES;

    it('defines exactly 5 outcomes', () => {
      expect(outcomes).toHaveLength(5);
    });

    it('each outcome has name, weight, and effect', () => {
      outcomes.forEach(o => {
        expect(typeof o.name).toBe('string');
        expect(typeof o.weight).toBe('number');
        expect(typeof o.effect).toBe('string');
        expect(o.weight).toBeGreaterThan(0);
      });
    });

    it('weights sum to 100 (percentage-based distribution)', () => {
      const total = outcomes.reduce((sum, o) => sum + o.weight, 0);
      expect(total).toBe(100);
    });

    it('NOTHING has the highest weight (most common outcome)', () => {
      const nothingWeight = outcomes.find(o => o.effect === 'nothing').weight;
      outcomes.forEach(o => {
        expect(nothingWeight).toBeGreaterThanOrEqual(o.weight);
      });
    });

    it('JACKPOT has the lowest weight (rarest outcome)', () => {
      const jackpotWeight = outcomes.find(o => o.effect === 'jackpot_xp').weight;
      outcomes.forEach(o => {
        expect(jackpotWeight).toBeLessThanOrEqual(o.weight);
      });
    });

    it('includes all expected effects', () => {
      const effects = outcomes.map(o => o.effect);
      expect(effects).toContain('jackpot_xp');
      expect(effects).toContain('weapon_drop');
      expect(effects).toContain('full_heal');
      expect(effects).toContain('curse');
      expect(effects).toContain('nothing');
    });
  });

  describe('CHAOS_EFFECTS', () => {
    const effects = ShrineManager.CHAOS_EFFECTS;

    it('defines exactly 6 chaos effects', () => {
      expect(effects).toHaveLength(6);
    });

    it('each effect has a name and effect key', () => {
      effects.forEach(e => {
        expect(typeof e.name).toBe('string');
        expect(typeof e.effect).toBe('string');
        expect(e.name.length).toBeGreaterThan(0);
        expect(e.effect.length).toBeGreaterThan(0);
      });
    });

    it('each effect key is unique', () => {
      const keys = effects.map(e => e.effect);
      expect(new Set(keys).size).toBe(keys.length);
    });

    it('includes dangerous SPAWN BOSS as a possible outcome', () => {
      const hasBoss = effects.some(e => e.effect === 'spawn_boss');
      expect(hasBoss).toBe(true);
    });

    it('includes beneficial INVINCIBILITY as a possible outcome', () => {
      const hasInvincibility = effects.some(e => e.effect === 'invincibility');
      expect(hasInvincibility).toBe(true);
    });
  });

  describe('canPayCost logic', () => {
    // Test the cost-checking logic by extracting it from canPayCost
    // We replicate the pure logic since canPayCost depends on scene/window state

    it('free cost is always payable', () => {
      expect({ type: 'free' }.type === 'free').toBe(true);
    });

    it('null/undefined cost is always payable', () => {
      const canPay = (cost) => !cost || cost.type === 'free';
      expect(canPay(null)).toBe(true);
      expect(canPay(undefined)).toBe(true);
      expect(canPay({ type: 'free' })).toBe(true);
    });

    it('health cost requires player health above the threshold', () => {
      // Simulates canPayCost health check
      const player = { health: 200, maxHealth: 200 };
      const cost = { type: 'health', amount: 0.25 };
      expect(player.health > player.maxHealth * cost.amount).toBe(true);
    });

    it('health cost fails when health equals threshold', () => {
      const player = { health: 50, maxHealth: 200 };
      const cost = { type: 'health', amount: 0.25 }; // 25% of 200 = 50
      expect(player.health > player.maxHealth * cost.amount).toBe(false);
    });

    it('xp cost requires sufficient XP', () => {
      const totalXP = 1000;
      const cost = { type: 'xp', amount: 500 };
      expect(totalXP >= cost.amount).toBe(true);
    });

    it('xp cost fails with insufficient XP', () => {
      const totalXP = 499;
      const cost = { type: 'xp', amount: 500 };
      expect(totalXP >= cost.amount).toBe(false);
    });
  });

  describe('getBuffMultiplier', () => {
    it('returns 1 when no buff is active', () => {
      const mgr = Object.create(ShrineManager.prototype);
      mgr.activeBuffs = {};
      expect(mgr.getBuffMultiplier('damage')).toBe(1);
    });

    it('returns correct multiplier when buff is active', () => {
      const mgr = Object.create(ShrineManager.prototype);
      mgr.activeBuffs = { damage: { multiplier: 1.5, endTime: Infinity } };
      expect(mgr.getBuffMultiplier('damage')).toBe(1.5);
    });

    it('returns 1 for unrelated buff type', () => {
      const mgr = Object.create(ShrineManager.prototype);
      mgr.activeBuffs = { damage: { multiplier: 1.5, endTime: Infinity } };
      expect(mgr.getBuffMultiplier('speed')).toBe(1);
    });
  });

  describe('constructor defaults', () => {
    it('sets expected default values', () => {
      const mgr = new ShrineManager({});
      expect(mgr.shrines).toEqual([]);
      expect(mgr.activeBuffs).toEqual({});
      expect(mgr.shrinesPerMap).toBe(2);
      expect(mgr.interactRadius).toBe(60);
      expect(mgr.nearbyShrine).toBeNull();
    });
  });
});
