import { describe, it, expect } from 'vitest';
import {
  rollDrop, createItemState, applyItem, tickEffects, getItemModifiers, absorbDamage, consumeRevive, drainActions
} from '../../systems/ItemManager.js';
import { ITEMS, ENEMY_TIERS } from '../../data/items.js';
import { seededRng, pick, HOSTILE_VALUES, HOSTILE_NUMBERS, isFiniteNumber, FUZZ_ITERATIONS } from './_hostile.js';

const ITEM_LIST = Object.values(ITEMS);

function assertSaneState(s) {
  expect(isFiniteNumber(s.health)).toBe(true);
  expect(isFiniteNumber(s.maxHealth)).toBe(true);
  expect(s.maxHealth).toBeGreaterThan(0);
  expect(s.health).toBeGreaterThanOrEqual(0);
  expect(s.health).toBeLessThanOrEqual(s.maxHealth);
  expect(isFiniteNumber(s.bits)).toBe(true);
  expect(s.bits).toBeGreaterThanOrEqual(0);
  expect(isFiniteNumber(s.shield)).toBe(true);
  expect(s.shield).toBeGreaterThanOrEqual(0);
  expect(Array.isArray(s.effects)).toBe(true);
  expect(Array.isArray(s.pendingActions)).toBe(true);
  for (const e of s.effects) expect(isFiniteNumber(e.remaining)).toBe(true);
}

describe('EVIL ItemManager.rollDrop', () => {
  it('never returns a NaN/negative pity counter or an unknown item id for hostile pity/tier/rng', () => {
    const rng = seededRng(1);
    for (let i = 0; i < FUZZ_ITERATIONS; i++) {
      const hostileRng = () => pick(rng, [rng(), NaN, -1, 1, 5, Infinity]);
      const tier = pick(rng, [...ENEMY_TIERS, ...HOSTILE_VALUES.filter((v) => typeof v !== 'symbol')]);
      const pity = pick(rng);
      const r = rollDrop(hostileRng, tier, pity);
      expect(Number.isInteger(r.pityCounter)).toBe(true);
      expect(r.pityCounter).toBeGreaterThanOrEqual(0);
      if (r.itemId !== null) expect(ITEMS[r.itemId]).toBeDefined();
    }
  });

  it('a NaN pity counter still reaches pity eventually (no infinite drought)', () => {
    let pity = NaN;
    let dropped = false;
    for (let i = 0; i < 100 && !dropped; i++) {
      const r = rollDrop(() => 0.999, 'trash', pity);
      pity = r.pityCounter;
      dropped = r.itemId !== null;
    }
    expect(dropped).toBe(true);
  });

  it('survives a non-function rng', () => {
    for (const bad of [null, undefined, 42, 'rng', {}]) {
      expect(() => rollDrop(bad, 'normal', 0)).not.toThrow();
    }
  });
});

describe('EVIL ItemManager.applyItem / tickEffects', () => {
  it('keeps HP in [0, maxHP], bits >= 0 and nothing NaN across random hostile sequences', () => {
    const rng = seededRng(2);
    for (let run = 0; run < 40; run++) {
      let s = createItemState({ health: pick(rng, [50, 100, NaN, -5, 1e12, 'x']), maxHealth: pick(rng, [100, NaN, 0, -10, Infinity, 250]) });
      for (let i = 0; i < 60; i++) {
        const roll = rng();
        if (roll < 0.6) s = applyItem(s, pick(rng, ITEM_LIST));
        else if (roll < 0.8) s = tickEffects(s, pick(rng, [16, 1000, ...HOSTILE_NUMBERS]));
        else s = absorbDamage(s, pick(rng, [5, 100, ...HOSTILE_NUMBERS])).state;
        s = drainActions(s).state;
        assertSaneState(s);
      }
    }
  });

  it('rejects hostile item definitions without corrupting state', () => {
    const base = createItemState();
    const evilItems = [
      { id: 'x', effect: { type: 'heal', value: -5 }, duration: 0 },
      { id: 'x', effect: { type: 'heal', value: NaN }, duration: 0 },
      { id: 'x', effect: { type: 'bits', value: -1e9 }, duration: 0 },
      { id: 'x', effect: { type: 'bits', value: NaN }, duration: 0 },
      { id: 'x', effect: { type: 'shield', value: -60 }, duration: 1000 },
      { id: 'x', effect: { type: 'shield', value: Infinity }, duration: 1000 },
      { id: 'x', effect: { type: 'damage', value: NaN }, duration: NaN },
      { id: 'x', effect: { type: 'revive', value: NaN }, duration: 0 },
      { id: 'x', effect: null },
      null, undefined, 'item', 42
    ];
    for (const item of evilItems) {
      let s;
      expect(() => { s = applyItem(base, item); }).not.toThrow();
      assertSaneState(s);
    }
  });

  it('a negative dt never extends a buff', () => {
    const s = applyItem(createItemState(), ITEMS.magnet);
    const before = s.effects[0].remaining;
    const after = tickEffects(s, -1e9);
    expect(after.effects[0].remaining).toBeLessThanOrEqual(before);
  });

  it('applyItem / tickEffects survive a null or partial state', () => {
    for (const bad of [null, undefined, {}, { effects: null }, { pendingActions: 'x' }]) {
      expect(() => applyItem(bad, ITEMS.health_patch)).not.toThrow();
      expect(() => tickEffects(bad, 16)).not.toThrow();
      expect(() => getItemModifiers(bad)).not.toThrow();
    }
  });
});

describe('EVIL ItemManager modifiers / shield / revive', () => {
  it('getItemModifiers stays finite and >= 0 for poisoned effects', () => {
    const s = { ...createItemState(), effects: [
      { id: 'a', type: 'damage', value: NaN, remaining: 100 },
      { id: 'b', type: 'attackRate', value: -2, remaining: 100 },
      { id: 'c', type: 'magnet', value: 'far', remaining: 100 }
    ] };
    const m = getItemModifiers(s);
    for (const k of ['damageMult', 'attackRateMult', 'magnetRadius', 'shield']) {
      expect(isFiniteNumber(m[k])).toBe(true);
      expect(m[k]).toBeGreaterThanOrEqual(0);
    }
    expect(m.attackRateMult).toBeGreaterThan(0);
  });

  it('absorbDamage never yields NaN damage/shield', () => {
    const s = applyItem(createItemState(), ITEMS.firewall);
    for (const dmg of HOSTILE_NUMBERS) {
      const r = absorbDamage(s, dmg);
      expect(Number.isNaN(r.damage)).toBe(false);
      expect(isFiniteNumber(r.state.shield)).toBe(true);
      expect(r.state.shield).toBeGreaterThanOrEqual(0);
    }
  });

  it('consumeRevive restores a finite HP within [1, maxHP] even with a poisoned revive %', () => {
    for (const pct of [NaN, -1, 0, 5, Infinity, 'half']) {
      const r = consumeRevive({ ...createItemState(), revives: 1, reviveHealthPct: pct, maxHealth: 120 });
      expect(r.revived).toBe(true);
      expect(isFiniteNumber(r.state.health)).toBe(true);
      expect(r.state.health).toBeGreaterThanOrEqual(1);
      expect(r.state.health).toBeLessThanOrEqual(120);
    }
  });
});
