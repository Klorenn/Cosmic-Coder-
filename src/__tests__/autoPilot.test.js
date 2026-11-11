import { describe, it, expect } from 'vitest';
import { decideMove, pickGem, AUTOPILOT } from '../systems/autoPilot.js';

const base = (over = {}) => ({
  player: { x: 0, y: 0 },
  hp: 100,
  maxHp: 100,
  enemies: [],
  ...over
});

describe('autoPilot.decideMove', () => {
  it('idles when there are no enemies', () => {
    const r = decideMove(base());
    expect(r.mode).toBe('idle');
  });

  it('ignores inactive enemies', () => {
    const r = decideMove(base({ enemies: [{ x: 300, y: 0, active: false }] }));
    expect(r.mode).toBe('idle');
  });

  it('hunts the nearest enemy when HP > 50%', () => {
    const near = { x: 300, y: 0 };
    const far = { x: -900, y: 0 };
    const r = decideMove(base({ hp: 80, enemies: [far, near] }));
    expect(r.mode).toBe('hunt');
    expect(r.target).toBe(near);
    expect(r.dx).toBeCloseTo(1);
    expect(r.dy).toBeCloseTo(0);
  });

  it('holds position when the hunt target is already in weapon range', () => {
    const r = decideMove(base({ enemies: [{ x: AUTOPILOT.HUNT_RANGE - 10, y: 0 }] }));
    expect(r.mode).toBe('hunt');
    expect(r.dx).toBe(0);
    expect(r.dy).toBe(0);
  });

  it('never hunts deadly enemy types', () => {
    const r = decideMove(base({ enemies: [{ x: 400, y: 0, type: 'segfault' }] }));
    expect(r.mode).not.toBe('hunt');
  });

  it('evades when HP <= 50%', () => {
    const r = decideMove(base({ hp: 50, enemies: [{ x: 100, y: 0 }] }));
    expect(r.mode).toBe('evade');
    expect(r.dx).toBeLessThan(0); // moves away from the threat on the right
  });

  it('evades when too many enemies are nearby even at full HP', () => {
    const enemies = Array.from({ length: AUTOPILOT.EVADE_NEARBY_COUNT + 1 }, (_, i) => ({ x: 40 + i, y: 10 }));
    const r = decideMove(base({ enemies }));
    expect(r.mode).toBe('evade');
  });

  it('returns a unit (or zero) direction vector', () => {
    const r = decideMove(base({ hp: 10, enemies: [{ x: 30, y: 40 }, { x: 60, y: -20 }] }));
    const mag = Math.hypot(r.dx, r.dy);
    expect(mag === 0 || Math.abs(mag - 1) < 1e-9).toBe(true);
  });

  it('survives garbage input', () => {
    expect(decideMove(null).mode).toBe('idle');
    expect(decideMove({ player: { x: NaN, y: 0 }, hp: NaN, maxHp: 0, enemies: 'x' }).mode).toBe('idle');
  });
});

describe('autoPilot collect mode (XP gems)', () => {
  const gem = { x: 0, y: 300, dist: 300 };

  it('walks to the nearest gem when no enemy is within the safe radius', () => {
    const r = decideMove(base({ enemies: [{ x: 1000, y: 0 }], nearestGem: gem }));
    expect(r.mode).toBe('collect');
    expect(r.dx).toBeCloseTo(0);
    expect(r.dy).toBeCloseTo(1);
    expect(r.target).toBe(gem);
  });

  it('collects even when there are no enemies at all', () => {
    const r = decideMove(base({ nearestGem: gem }));
    expect(r.mode).toBe('collect');
  });

  it('does not collect when an enemy is closer than COLLECT_SAFE_RADIUS (160)', () => {
    expect(AUTOPILOT.COLLECT_SAFE_RADIUS).toBe(160);
    const r = decideMove(base({ enemies: [{ x: 150, y: 0 }], nearestGem: gem }));
    expect(r.mode).toBe('hunt');
  });

  it('keeps evading at HP <= 50% instead of collecting', () => {
    const r = decideMove(base({ hp: 50, enemies: [{ x: 1000, y: 0 }, { x: 180, y: 0 }], nearestGem: gem }));
    expect(r.mode).toBe('evade');
  });

  it('ignores a missing or malformed gem', () => {
    expect(decideMove(base({ nearestGem: null })).mode).toBe('idle');
    expect(decideMove(base({ nearestGem: { x: NaN, y: 0, dist: 1 } })).mode).toBe('idle');
  });

  it('holds still when already on top of the gem', () => {
    const r = decideMove(base({ nearestGem: { x: 1, y: 0, dist: 1 } }));
    expect(r.mode).toBe('collect');
    expect(r.dx).toBe(0);
    expect(r.dy).toBe(0);
  });
});

describe('autoPilot.pickGem', () => {
  const player = { x: 0, y: 0 };

  it('returns null without gems', () => {
    expect(pickGem([], player)).toBeNull();
    expect(pickGem(undefined, player)).toBeNull();
  });

  it('picks the nearest gem as {x,y,dist,value}', () => {
    const r = pickGem([{ x: 400, y: 0, value: 1 }, { x: 0, y: 100, value: 1 }], player);
    expect(r).toEqual({ x: 0, y: 100, dist: 100, value: 1 });
  });

  it('prefers a more valuable gem at a similar distance', () => {
    const r = pickGem([{ x: 100, y: 0, value: 1 }, { x: 0, y: 115, value: 50 }], player);
    expect(r.value).toBe(50);
  });

  it('does not detour far for value', () => {
    const r = pickGem([{ x: 100, y: 0, value: 1 }, { x: 0, y: 600, value: 50 }], player);
    expect(r.value).toBe(1);
  });

  it('skips gems without finite coordinates', () => {
    const r = pickGem([{ x: NaN, y: 0, value: 5 }, { x: 10, y: 0, value: 1 }], player);
    expect(r.x).toBe(10);
  });
});
