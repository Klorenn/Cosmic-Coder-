import { describe, it, expect } from 'vitest';
import { BIOMES, HAZARD_DEFS, OBSTACLE_DEFS, BIOME_MECHANICS, SPACE_PALETTES, PARALLAX } from '../data/biomes.js';
import { STAGES } from '../data/stages.js';
import { biomeEffect } from '../systems/MapManager.js';

const W = 4000;
const H = 3000;
const ps = (over = {}) => ({ x: 100, y: 100, worldWidth: W, worldHeight: H, time: 0, lastTeleport: -99999, zones: [], ...over });

describe('biome data', () => {
  it('one biome per stage', () => {
    expect(Object.keys(BIOMES)).toHaveLength(STAGES.length);
  });

  it('each biome has >= 2 own hazards, >= 1 own obstacle and a known mechanic', () => {
    const hazardOwners = {};
    const obstacleOwners = {};
    Object.values(BIOMES).forEach((b) => {
      expect(b.hazardTypes.length).toBeGreaterThanOrEqual(2);
      expect(b.obstacles.length).toBeGreaterThanOrEqual(1);
      b.hazardTypes.forEach((h) => { expect(HAZARD_DEFS[h]).toBeDefined(); hazardOwners[h] = (hazardOwners[h] || 0) + 1; });
      b.obstacles.forEach((o) => { expect(OBSTACLE_DEFS[o]).toBeDefined(); obstacleOwners[o] = (obstacleOwners[o] || 0) + 1; });
      expect(BIOME_MECHANICS).toContain(b.mechanic.type);
    });
    Object.values(hazardOwners).forEach((n) => expect(n).toBe(1));
    Object.values(obstacleOwners).forEach((n) => expect(n).toBe(1));
  });

  it('each biome has its own space-background variant with a full pixel palette', () => {
    const variants = Object.values(BIOMES).map((b) => b.bgVariant);
    expect(new Set(variants).size).toBe(variants.length);
    const hex = /^[0-9a-f]{6}$/;
    variants.forEach((v) => {
      const p = SPACE_PALETTES[v];
      expect(p).toBeDefined();
      expect(p.base.length).toBeGreaterThanOrEqual(4);
      expect(p.accent.length).toBe(3);
      expect(p.near.length).toBe(3);
      [...p.base, ...p.accent, ...p.stars, ...p.near, p.mote].forEach((c) => expect(c).toMatch(hex));
      expect(p.props.length).toBeGreaterThanOrEqual(2);
    });
  });

  it('parallax layers get faster towards the camera', () => {
    expect(PARALLAX.back).toBeLessThan(PARALLAX.stars);
    expect(PARALLAX.stars).toBeLessThan(PARALLAX.near);
    expect(PARALLAX.near).toBeLessThan(1);
  });

  it('mechanics differ between biomes', () => {
    const types = Object.values(BIOMES).map((b) => b.mechanic.type);
    expect(new Set(types).size).toBe(types.length);
  });
});

describe('biomeEffect', () => {
  it('neutral outside zones / for zone mechanics', () => {
    const e = biomeEffect(BIOMES[1], ps(), 16);
    expect(e).toEqual({ speedMult: 1, pushX: 0, pushY: 0, damage: 0, teleportTo: null });
  });

  it('MEMORY BANKS slows inside zones', () => {
    const e = biomeEffect(BIOMES[1], ps({ zones: [{ x: 100, y: 100, radius: 50 }] }), 16);
    expect(e.speedMult).toBeLessThan(1);
  });

  it('DEBUG ZONE boosts speed inside breakpoint lanes', () => {
    const e = biomeEffect(BIOMES[0], ps({ zones: [{ x: 100, y: 100, radius: 50 }] }), 16);
    expect(e.speedMult).toBeGreaterThan(1);
  });

  it('NETWORK LAYER teleports to the paired zone, with cooldown', () => {
    const zones = [{ x: 100, y: 100, radius: 40 }, { x: 3000, y: 2000, radius: 40 }];
    const e = biomeEffect(BIOMES[2], ps({ zones, time: 10000 }), 16);
    expect(e.teleportTo).toEqual({ x: 3000, y: 2000 });
    const cd = biomeEffect(BIOMES[2], ps({ zones, time: 10000, lastTeleport: 9999 }), 16);
    expect(cd.teleportTo).toBeNull();
  });

  it('KERNEL SPACE pulses damage only during the active phase', () => {
    const m = BIOMES[3].mechanic;
    const zones = [{ x: 100, y: 100, radius: 50 }];
    const on = biomeEffect(BIOMES[3], ps({ zones, time: 0 }), 1000);
    expect(on.damage).toBeCloseTo(m.dps, 5);
    const off = biomeEffect(BIOMES[3], ps({ zones, time: m.activeMs + 1 }), 1000);
    expect(off.damage).toBe(0);
  });

  it('CLOUD CLUSTER wind pushes with constant magnitude', () => {
    const m = BIOMES[4].mechanic;
    const a = biomeEffect(BIOMES[4], ps({ time: 0 }), 16);
    const b = biomeEffect(BIOMES[4], ps({ time: 5000 }), 16);
    expect(Math.hypot(a.pushX, a.pushY)).toBeCloseTo(m.strength, 5);
    expect(Math.hypot(b.pushX, b.pushY)).toBeCloseTo(m.strength, 5);
  });

  it('SINGULARITY pulls towards the world centre', () => {
    const e = biomeEffect(BIOMES[5], ps({ x: 100, y: 100 }), 16);
    expect(e.pushX).toBeGreaterThan(0);
    expect(e.pushY).toBeGreaterThan(0);
    const c = biomeEffect(BIOMES[5], ps({ x: W / 2, y: H / 2 }), 16);
    expect(c.pushX).toBe(0);
    expect(c.pushY).toBe(0);
  });

  it('tolerates missing biome / state', () => {
    expect(biomeEffect(null, ps(), 16).speedMult).toBe(1);
    expect(biomeEffect(BIOMES[5], null, 16).pushX).toBe(0);
  });
});
