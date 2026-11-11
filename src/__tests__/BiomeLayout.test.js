import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { BIOMES, LAYOUT_RULES, OBSTACLE_DEFS, HAZARD_DEFS } from '../data/biomes.js';
import { layoutBiome } from '../systems/MapManager.js';
import { biomeAssetManifest } from '../scenes/boot/biomeAssets.js';

const W = 4000;
const H = 3000;
const SPAWN = { x: W / 2, y: H / 2 };

const all = (l) => [
  ...l.walls.map((o) => ({ ...o, r: Math.hypot(o.w, o.h) / 2 })),
  ...l.obstacles.map((o) => ({ ...o, r: (o.size * Math.SQRT2) / 2 })),
  ...l.hazards.map((o) => ({ ...o, r: o.radius })),
  ...l.zones.map((o) => ({ ...o, r: o.radius })),
  ...l.crates.map((o) => ({ ...o, r: (o.size * Math.SQRT2) / 2 })),
  ...l.teleporters.map((o) => ({ ...o, r: o.radius }))
];
const total = (l) => l.walls.length + l.obstacles.length + l.hazards.length + l.crates.length;

describe('layoutBiome', () => {
  it('is deterministic for the same seed and differs for another seed', () => {
    const a = layoutBiome(42, BIOMES[0], W, H, { stage: 0 });
    const b = layoutBiome(42, BIOMES[0], W, H, { stage: 0 });
    const c = layoutBiome(43, BIOMES[0], W, H, { stage: 0 });
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });

  it.each(Object.keys(BIOMES))('biome %s: nothing within clearance of spawn, no overlaps, inside the world', (k) => {
    for (let seed = 1; seed <= 20; seed++) {
      const l = layoutBiome(seed, BIOMES[k], W, H, { stage: Number(k), spawn: SPAWN });
      const items = all(l);
      items.forEach((it) => {
        expect(Math.hypot(it.x - SPAWN.x, it.y - SPAWN.y) - it.r).toBeGreaterThanOrEqual(LAYOUT_RULES.spawnClearance);
        expect(it.x - it.r).toBeGreaterThanOrEqual(0);
        expect(it.y - it.r).toBeGreaterThanOrEqual(0);
        expect(it.x + it.r).toBeLessThanOrEqual(W);
        expect(it.y + it.r).toBeLessThanOrEqual(H);
      });
      for (let i = 0; i < items.length; i++) {
        for (let j = i + 1; j < items.length; j++) {
          expect(Math.hypot(items[i].x - items[j].x, items[i].y - items[j].y)).toBeGreaterThanOrEqual(items[i].r + items[j].r);
        }
      }
    }
  });

  it('uses only the biome own obstacle / hazard types', () => {
    Object.values(BIOMES).forEach((b) => {
      const l = layoutBiome(7, b, W, H);
      l.obstacles.forEach((o) => {
        expect(b.obstacles).toContain(o.type);
        const d = OBSTACLE_DEFS[o.type];
        expect(o.size).toBeGreaterThanOrEqual(d.sizeMin);
        expect(o.size).toBeLessThanOrEqual(d.sizeMax);
      });
      l.hazards.forEach((h) => {
        expect(b.hazardTypes).toContain(h.type);
        expect(h.radius).toBeGreaterThanOrEqual(HAZARD_DEFS[h.type].radiusMin);
        expect(h.radius).toBeLessThanOrEqual(HAZARD_DEFS[h.type].radiusMax);
        expect(h.damage).toBeGreaterThanOrEqual(1);
      });
    });
  });

  it('density grows with stage for the same biome', () => {
    const sum = (stage) => {
      let n = 0;
      for (let seed = 1; seed <= 10; seed++) n += total(layoutBiome(seed, BIOMES[1], W, H, { stage }));
      return n;
    };
    expect(sum(5)).toBeGreaterThan(sum(0));
  });

  it('places the mechanic zones (complete pairs for teleport, none for global mechanics)', () => {
    expect(layoutBiome(3, BIOMES[1], W, H).zones.length).toBe(BIOMES[1].mechanic.zoneCount);
    expect(layoutBiome(3, BIOMES[2], W, H).zones.length % 2).toBe(0);
    expect(layoutBiome(3, BIOMES[4], W, H).zones).toHaveLength(0);
    expect(layoutBiome(3, BIOMES[5], W, H).zones).toHaveLength(0);
  });

  it('teleporter pads come in linked pairs in different quadrants', () => {
    const l = layoutBiome(9, BIOMES[0], W, H);
    expect(l.teleporters.length % 2).toBe(0);
    expect(l.teleporters.length).toBeGreaterThan(0);
    for (let i = 0; i < l.teleporters.length; i += 2) {
      const a = l.teleporters[i];
      const b = l.teleporters[i + 1];
      expect(a.pair).toBe(b.pair);
      expect(a.quadrant).not.toBe(b.quadrant);
    }
  });

  it('respects a custom spawn point and tolerates bad input', () => {
    const spawn = { x: 500, y: 400 };
    const l = layoutBiome(5, BIOMES[3], W, H, { stage: 3, spawn });
    all(l).forEach((it) => expect(Math.hypot(it.x - spawn.x, it.y - spawn.y) - it.r).toBeGreaterThanOrEqual(LAYOUT_RULES.spawnClearance));
    const empty = layoutBiome(1, null, W, H);
    expect(empty.obstacles).toEqual([]);
    expect(layoutBiome(1, BIOMES[0], 0, 0).obstacles).toEqual([]);
  });
});

describe('biome asset manifest', () => {
  const PUBLIC = resolve(__dirname, '../../public');
  const pngSize = (file) => {
    const buf = readFileSync(file);
    expect(buf.subarray(1, 4).toString('ascii')).toBe('PNG');
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  };

  it('has unique keys and every file exists with the declared size', () => {
    const m = biomeAssetManifest();
    expect(new Set(m.map((a) => a.key)).size).toBe(m.length);
    m.forEach((a) => {
      const file = resolve(PUBLIC, a.path);
      expect(existsSync(file), a.path).toBe(true);
      expect(pngSize(file)).toEqual({ w: a.width, h: a.height });
    });
  });

  it('covers every biome background layer, obstacle, hazard and mechanic', () => {
    const keys = new Set(biomeAssetManifest().map((a) => a.key));
    Object.values(BIOMES).forEach((b) => {
      expect(keys.has(`biome-${b.id}-far`)).toBe(true);
      expect(keys.has(`biome-${b.id}-near`)).toBe(true);
      expect(keys.has(`map-border-${b.id}`)).toBe(true);
      b.obstacles.forEach((o) => expect(keys.has(`map-obs-${o}`)).toBe(true));
      b.hazardTypes.forEach((h) => expect(keys.has(`map-haz-${h}`)).toBe(true));
      expect(keys.has(`map-zone-${b.mechanic.type}`)).toBe(true);
    });
  });
});
