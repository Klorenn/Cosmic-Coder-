import { describe, it, expect } from 'vitest';
import {
  XP_PICKUP_RADIUS, XP_GEMS_MAX, gemTier, createGemState, dropGem, tickGems, mergeIfOverflow, totalGemValue
} from '../systems/xpGems.js';

const player = (x = 0, y = 0) => ({ x, y });
const finiteGem = (g) => Number.isFinite(g.x) && Number.isFinite(g.y) && Number.isFinite(g.value) && g.value > 0;

/** Advance the state for `ms` in 16 ms frames, collecting everything picked up. */
function run(state, p, ms, opts) {
  const collected = [];
  for (let t = 0; t < ms; t += 16) collected.push(...tickGems(state, p, 16, opts).collected);
  return collected;
}

describe('xpGems constants', () => {
  it('pickup radius and cap are sane', () => {
    expect(XP_PICKUP_RADIUS).toBeGreaterThan(30);
    expect(XP_PICKUP_RADIUS).toBeLessThan(120);
    expect(XP_GEMS_MAX).toBeGreaterThanOrEqual(100);
  });
});

describe('gemTier', () => {
  it('maps value to blue / green / red', () => {
    expect(gemTier(1)).toBe('blue');
    expect(gemTier(9)).toBe('blue');
    expect(gemTier(10)).toBe('green');
    expect(gemTier(49)).toBe('green');
    expect(gemTier(50)).toBe('red');
    expect(gemTier(5000)).toBe('red');
  });
  it('garbage -> blue', () => {
    for (const v of [NaN, -3, undefined, null, Infinity, 'x']) expect(gemTier(v)).toBe('blue');
  });
});

describe('dropGem', () => {
  it('adds a gem with tier, integer value and a stable id', () => {
    const s = createGemState();
    const g = dropGem(s, { x: 10, y: 20, value: 12.7 });
    expect(g).toMatchObject({ x: 10, y: 20, value: 12, tier: 'green', attracted: false });
    expect(s.gems).toHaveLength(1);
    const g2 = dropGem(s, { x: 0, y: 0, value: 3 });
    expect(g2.id).not.toBe(g.id);
  });
  it('rejects garbage positions/values (no NaN gems)', () => {
    const s = createGemState();
    expect(dropGem(s, { x: NaN, y: 0, value: 5 })).toBeNull();
    expect(dropGem(s, { x: 0, y: Infinity, value: 5 })).toBeNull();
    expect(dropGem(s, { x: 0, y: 0, value: 0 })).toBeNull();
    expect(dropGem(s, { x: 0, y: 0, value: NaN })).toBeNull();
    expect(dropGem(s, null)).toBeNull();
    expect(dropGem(null, { x: 0, y: 0, value: 5 })).toBeNull();
    expect(s.gems).toHaveLength(0);
  });
  it('rounds tiny positive values up to 1 XP', () => {
    const s = createGemState();
    expect(dropGem(s, { x: 0, y: 0, value: 0.4 }).value).toBe(1);
  });
});

describe('tickGems pickup', () => {
  it('does NOT collect gems outside the pickup radius (no XP without pickup)', () => {
    const s = createGemState();
    dropGem(s, { x: 300, y: 0, value: 5 });
    dropGem(s, { x: 0, y: -XP_PICKUP_RADIUS - 5, value: 5 });
    const got = run(s, player(), 5000, { pickupRadius: XP_PICKUP_RADIUS });
    expect(got).toHaveLength(0);
    expect(s.gems).toHaveLength(2);
    expect(s.gems.every((g) => !g.attracted)).toBe(true);
  });
  it('a gem inside the radius flies to the player and is collected', () => {
    const s = createGemState();
    dropGem(s, { x: XP_PICKUP_RADIUS - 4, y: 0, value: 7 });
    const first = tickGems(s, player(), 16, { pickupRadius: XP_PICKUP_RADIUS });
    expect(s.gems[0]?.attracted ?? true).toBe(true);
    expect(first.moved).toBeGreaterThanOrEqual(0);
    const got = [...first.collected, ...run(s, player(), 2000, { pickupRadius: XP_PICKUP_RADIUS })];
    expect(got.map((g) => g.value)).toEqual([7]);
    expect(s.gems).toHaveLength(0);
  });
  it('attraction accelerates (gem speeds up over time)', () => {
    const s = createGemState();
    dropGem(s, { x: XP_PICKUP_RADIUS - 1, y: 0, value: 1 });
    tickGems(s, player(), 16, { pickupRadius: XP_PICKUP_RADIUS });
    const x1 = s.gems[0].x;
    tickGems(s, player(), 16, { pickupRadius: XP_PICKUP_RADIUS });
    const d1 = x1 - s.gems[0].x;
    const x2 = s.gems[0].x;
    tickGems(s, player(), 16, { pickupRadius: XP_PICKUP_RADIUS });
    expect(x2 - (s.gems[0]?.x ?? 0)).toBeGreaterThan(d1);
  });
  it('once attracted a gem keeps chasing even if the player walks away', () => {
    const s = createGemState();
    dropGem(s, { x: 40, y: 0, value: 4 });
    tickGems(s, player(), 16, { pickupRadius: XP_PICKUP_RADIUS });
    const got = run(s, player(-200, 0), 4000, { pickupRadius: XP_PICKUP_RADIUS });
    expect(got).toHaveLength(1);
  });
  it('a bigger pickupRadius reaches farther gems', () => {
    const s = createGemState();
    dropGem(s, { x: 150, y: 0, value: 4 });
    expect(run(s, player(), 1000, { pickupRadius: XP_PICKUP_RADIUS })).toHaveLength(0);
    expect(run(s, player(), 3000, { pickupRadius: 200 })).toHaveLength(1);
  });
  it('magnet attracts every gem regardless of distance', () => {
    const s = createGemState();
    for (let i = 0; i < 20; i++) dropGem(s, { x: 1500 * Math.cos(i), y: 1500 * Math.sin(i), value: 3 });
    tickGems(s, player(), 16, { pickupRadius: XP_PICKUP_RADIUS, magnetActive: true });
    expect(s.gems.every((g) => g.attracted)).toBe(true);
    const got = run(s, player(), 8000, { pickupRadius: XP_PICKUP_RADIUS });
    expect(got).toHaveLength(20);
    expect(got.reduce((a, g) => a + g.value, 0)).toBe(60);
  });
  it('never produces NaN with hostile inputs', () => {
    const s = createGemState();
    dropGem(s, { x: 5, y: 5, value: 5 });
    dropGem(s, { x: 500, y: 5, value: 5 });
    for (const p of [null, {}, { x: NaN, y: 0 }, { x: Infinity, y: -Infinity }]) {
      for (const dt of [NaN, -5, 0, 1e9, undefined]) {
        expect(() => tickGems(s, p, dt, { pickupRadius: NaN, magnetActive: 'yes' })).not.toThrow();
        expect(s.gems.every(finiteGem)).toBe(true);
      }
    }
    expect(() => tickGems(null, player(), 16)).not.toThrow();
    expect(tickGems(null, player(), 16)).toEqual({ collected: [], moved: 0 });
  });
  it('gem sitting exactly on the player is collected immediately', () => {
    const s = createGemState();
    dropGem(s, { x: 0, y: 0, value: 2 });
    expect(tickGems(s, player(), 16, {}).collected).toHaveLength(1);
  });
});

describe('mergeIfOverflow', () => {
  it('no-op under the cap', () => {
    const s = createGemState();
    for (let i = 0; i < 10; i++) dropGem(s, { x: i, y: 0, value: 1 });
    expect(mergeIfOverflow(s, 20)).toEqual({ removed: [], gem: null });
    expect(s.gems).toHaveLength(10);
  });
  it('merges the oldest gems into one big gem, keeping the total XP', () => {
    const s = createGemState();
    for (let i = 0; i < 30; i++) dropGem(s, { x: i * 10, y: i * 5, value: (i % 7) + 1 });
    const before = totalGemValue(s);
    const oldestIds = s.gems.slice(0, 11).map((g) => g.id);
    const res = mergeIfOverflow(s, 20);
    expect(s.gems.length).toBeLessThanOrEqual(20);
    expect(totalGemValue(s)).toBe(before);
    expect(res.removed.sort()).toEqual(oldestIds.sort());
    expect(res.gem).toBeTruthy();
    expect(finiteGem(res.gem)).toBe(true);
    expect(s.gems.includes(res.gem)).toBe(true);
    expect(res.gem.value).toBeGreaterThan(1);
  });
  it('merged gem sits at the centre of mass of the merged gems', () => {
    const s = createGemState();
    dropGem(s, { x: 0, y: 0, value: 1 });
    dropGem(s, { x: 100, y: 0, value: 1 });
    dropGem(s, { x: 500, y: 500, value: 1 });
    const res = mergeIfOverflow(s, 2);
    expect(res.gem.x).toBeCloseTo(50);
    expect(res.gem.y).toBeCloseTo(0);
  });
  it('stays at the cap after many drops and keeps total XP', () => {
    const s = createGemState();
    let dropped = 0;
    for (let i = 0; i < 1000; i++) {
      dropGem(s, { x: (i * 37) % 900, y: (i * 53) % 700, value: 5 });
      dropped += 5;
      mergeIfOverflow(s);
    }
    expect(s.gems.length).toBeLessThanOrEqual(XP_GEMS_MAX);
    expect(totalGemValue(s)).toBe(dropped);
    expect(s.gems.every(finiteGem)).toBe(true);
  });
  it('tolerates garbage', () => {
    expect(mergeIfOverflow(null)).toEqual({ removed: [], gem: null });
    expect(mergeIfOverflow({})).toEqual({ removed: [], gem: null });
  });
});
