import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import {
  createSpaceBackground, spaceKeys, spaceAssetManifest, fadeAlpha, twinkleFrame, layerOffset, waveMood, SPACE_VARIANTS, layerConfig
} from '../systems/spaceBackground.js';
import { SPACE_BG, BIOMES } from '../data/biomes.js';

/** Minimal chainable fake object. */
function fake(kind, args) {
  const o = { kind, args, alpha: 1, active: true, width: args[2] || 1, height: args[3] || 1, x: args[0], y: args[1], visible: true, texKey: args[4] };
  Object.assign(o, {
    setOrigin: () => o, setScrollFactor: () => o, setDepth: (d) => { o.depth = d; return o; }, setScale: () => o,
    setTint: (t) => { o.tint = t; return o; }, setAlpha: (a) => { o.alpha = a; return o; },
    setVisible: (v) => { o.visible = v; return o; }, setSize: (w, h) => { o.width = w; o.height = h; return o; },
    setPosition: (x, y) => { o.x = x; o.y = y; return o; }, setTexture: (k) => { o.texKey = k; return o; },
    destroy: () => { o.active = false; o.destroyed = true; }
  });
  return o;
}
function fakeScene(keys = new Set(spaceAssetManifest().map((a) => a.key))) {
  const created = [];
  const mk = (kind) => (...args) => { const o = fake(kind, args); created.push(o); return o; };
  return {
    created,
    textures: { exists: (k) => keys.has(k) },
    cameras: { main: { width: 1280, height: 720, zoom: 1, scrollX: 0, scrollY: 0 } },
    add: { tileSprite: mk('tileSprite'), image: mk('image') }
  };
}
const live = (scene, kind) => scene.created.filter((o) => o.kind === kind && !o.destroyed);

describe('space background helpers', () => {
  it('stepped fade goes 0 -> 1 in hard steps', () => {
    expect(fadeAlpha(0, 600)).toBe(0);
    expect(fadeAlpha(149, 600)).toBe(0);
    expect(fadeAlpha(150, 600)).toBe(0.25);
    expect(fadeAlpha(450, 600)).toBe(0.75);
    expect(fadeAlpha(600, 600)).toBe(1);
    expect(fadeAlpha(10, 0)).toBe(1);
    const seen = new Set(Array.from({ length: 61 }, (_, i) => fadeAlpha(i * 10, 600)));
    expect(seen.size).toBe(SPACE_BG.fadeSteps + 1);
  });

  it('twinkle alternates two frames', () => {
    expect(twinkleFrame(0)).toBe(0);
    expect(twinkleFrame(SPACE_BG.twinkleMs)).toBe(1);
    expect(twinkleFrame(SPACE_BG.twinkleMs * 2)).toBe(0);
  });

  it('layer offset = (scroll*parallax + drift) / tileScale', () => {
    expect(layerOffset(1000, 0.4, 20, 2)).toBeCloseTo(210, 6);
    expect(layerOffset(0, 0.4, 0, 0)).toBe(0);
  });

  it('wave mood stays within ±10% and adds a prop every 5 waves', () => {
    for (let w = 1; w <= 30; w++) {
      const m = waveMood(w);
      expect(m.brightness).toBeGreaterThanOrEqual(0.9 - 1e-9);
      expect(m.brightness).toBeLessThanOrEqual(1.1 + 1e-9);
      expect(m.backTint).toBeLessThanOrEqual(1);
      expect(m.motes).toBeLessThanOrEqual(SPACE_BG.maxMotes);
      expect(m.newProp).toBe(w % 5 === 0);
    }
    expect(waveMood(NaN).brightness).toBeCloseTo(0.9, 6);
  });

  it('every biome maps to a variant with keys', () => {
    Object.values(BIOMES).forEach((b) => {
      expect(SPACE_VARIANTS).toContain(b.bgVariant);
      expect(spaceKeys(b.bgVariant).variant).toBe(b.bgVariant);
    });
    expect(spaceKeys('nope').variant).toBe('debug-zone');
  });

  it('every manifest PNG exists with the declared size', async () => {
    const root = join(__dirname, '../../public');
    for (const a of spaceAssetManifest()) {
      const file = join(root, a.path);
      expect(existsSync(file), a.path).toBe(true);
      const meta = await sharp(file).metadata();
      expect([meta.width, meta.height], a.path).toEqual([a.width, a.height]);
    }
  });
});

describe('createSpaceBackground (viewport)', () => {
  it('builds 3 camera-fixed layers within the perf budget', () => {
    const scene = fakeScene();
    const bg = createSpaceBackground(scene, { variant: 'kernel-space' });
    expect(live(scene, 'tileSprite')).toHaveLength(3);
    expect(bg.props.length).toBeGreaterThan(0);
    expect(bg.props.length).toBeLessThanOrEqual(SPACE_BG.maxProps);
    expect(bg.motes.length).toBeLessThanOrEqual(SPACE_BG.maxMotes);
    expect(bg.layers.back.width).toBe(1280 + 64);
    expect(bg.layers.back.texKey).toBe('space-kernel-space-back');
  });

  it('drifts on its own, parallaxes with the camera and twinkles', () => {
    const scene = fakeScene();
    const bg = createSpaceBackground(scene);
    const back = bg.layers.back;
    const x0 = back.tilePositionX;
    bg.update(1000);
    expect(back.tilePositionX).toBeGreaterThan(x0); // autonomous drift
    const x1 = back.tilePositionX;
    scene.cameras.main.scrollX = 300;
    bg.update(0);
    const cfg = SPACE_BG.layers.back;
    expect(back.tilePositionX - x1).toBeCloseTo((300 * cfg.parallax) / cfg.tileScale, 6);
    bg.update(SPACE_BG.twinkleMs);
    const k1 = bg.layers.stars.texKey;
    bg.update(SPACE_BG.twinkleMs);
    expect(bg.layers.stars.texKey).not.toBe(k1);
  });

  it('setVariant crossfades in steps and destroys the old set afterwards', () => {
    const scene = fakeScene();
    const bg = createSpaceBackground(scene, { variant: 'debug-zone' });
    const oldBack = bg.layers.back;
    expect(bg.setVariant('singularity', { fadeMs: 600 })).toBe(true);
    expect(bg.variant).toBe('singularity');
    expect(bg.layers.back.alpha).toBe(0);
    bg.update(160);
    expect(bg.layers.back.alpha).toBeCloseTo(0.25, 6);
    expect(oldBack.destroyed).toBeFalsy();
    bg.update(250); // update() clamps dt to 250 ms (tab-switch spikes)
    bg.update(250);
    expect(bg.layers.back.alpha).toBe(1);
    expect(oldBack.destroyed).toBe(true);
    expect(live(scene, 'tileSprite')).toHaveLength(3);
    expect(bg.setVariant('singularity')).toBe(false);
  });

  it('low quality disables motes and twinkle', () => {
    const scene = fakeScene();
    const bg = createSpaceBackground(scene);
    expect(bg.setQuality('low')).toBe(true);
    expect(bg.motes).toHaveLength(0);
    const k = bg.layers.stars.texKey;
    bg.update(SPACE_BG.twinkleMs * 3);
    expect(bg.layers.stars.texKey).toBe(k);
    expect(bg.layers.near.visible).toBe(false);
    bg.setQuality('high');
    expect(bg.motes.length).toBeGreaterThan(0);
  });

  it('wave changes add props up to the cap and destroy() cleans everything', () => {
    const scene = fakeScene();
    const bg = createSpaceBackground(scene);
    for (let w = 1; w <= 60; w++) bg.setWave(w);
    expect(bg.props.length).toBe(SPACE_BG.maxProps);
    bg.destroy();
    expect(scene.created.every((o) => o.destroyed)).toBe(true);
    bg.update(16); // no throw after destroy
  });

  it('missing art: no layers, no crash', () => {
    const scene = fakeScene(new Set());
    const bg = createSpaceBackground(scene, { variant: 'memory-banks' });
    bg.update(16);
    bg.setVariant('kernel-space', { fadeMs: 600 });
    bg.update(700);
    expect(bg.layers.back).toBeNull();
    expect(scene.created).toHaveLength(0);
  });
});

describe('per-variant layer config (legibility)', () => {
  it('dims the bright kernel-space / network-layer nebulas more than the default', () => {
    for (const v of ['kernel-space', 'network-layer']) {
      expect(layerConfig(v, 'back').dim).toBeCloseTo(0.7, 6);
      expect(layerConfig(v, 'near').alpha).toBeCloseTo(0.35, 6);
      expect(layerConfig(v, 'back').tileScale).toBe(SPACE_BG.layers.back.tileScale);
    }
    expect(layerConfig('debug-zone', 'back').dim).toBe(SPACE_BG.layers.back.dim);
    expect(layerConfig('debug-zone', 'near').alpha).toBe(SPACE_BG.layers.near.alpha);
  });

  it('applies the variant dim as the back tint and near alpha on build', () => {
    const scene = fakeScene();
    const bg = createSpaceBackground(scene, { variant: 'kernel-space' });
    expect(bg.layers.near.baseAlpha).toBeCloseTo(0.35, 6);
    const scene2 = fakeScene();
    const bg2 = createSpaceBackground(scene2, { variant: 'debug-zone' });
    expect(bg.layers.back.tint & 0xff).toBeLessThan(bg2.layers.back.tint & 0xff);
  });
});
