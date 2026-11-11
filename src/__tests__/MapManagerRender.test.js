import { describe, it, expect, beforeAll } from 'vitest';
import MapManager from '../systems/MapManager.js';
import { biomeAssetManifest } from '../scenes/boot/biomeAssets.js';
import { BIOMES, SPACE_BG } from '../data/biomes.js';

/** Chainable fake game object: every setter returns itself, destroy() flags it. */
function fakeObj(kind, props = {}) {
  const o = { kind, alpha: 1, active: true, width: 2, height: 2, ...props };
  return new Proxy(o, {
    get(t, k) {
      if (k in t) return t[k];
      if (k === 'destroy') return () => { t.active = false; t.destroyed = true; };
      if (k === 'setAlpha') return (a) => { t.alpha = a; return o.__self; };
      if (k === 'setSize') return (w, h) => { t.width = w; t.height = h; return o.__self; };
      if (typeof k === 'string' && /^(set|play|clear|line|stroke|fill)/.test(k)) return () => o.__self;
      return undefined;
    },
    set(t, k, v) { t[k] = v; return true; }
  });
}
const make = (kind) => (...args) => { const p = fakeObj(kind, { args }); p.__self = p; return p; };

function fakeGroup() {
  const children = [];
  return {
    add: (c) => children.push(c),
    getChildren: () => children,
    children: { each: (fn) => children.forEach(fn) },
    clear: (_a, destroy) => { if (destroy) children.forEach((c) => c.destroy()); children.length = 0; }
  };
}

function fakeScene(textureKeys) {
  const listeners = {};
  const colliders = [];
  const tweens = [];
  return {
    worldWidth: 4000,
    worldHeight: 3000,
    player: { x: 2000, y: 1500 },
    colliders,
    tweens: { add: (cfg) => { const t = { cfg, stop() { t.stopped = true; }, isPlaying: () => !t.stopped }; tweens.push(t); return t; }, list: tweens },
    textures: { exists: (k) => textureKeys.has(k) },
    anims: { exists: () => true, create: () => {}, generateFrameNumbers: () => [] },
    cameras: { main: { width: 800, height: 600, zoom: 1, scrollX: 100, scrollY: 50 } },
    events: { on: (e, fn, ctx) => { listeners[e] = fn.bind(ctx); }, once: () => {}, off: (e) => { delete listeners[e]; }, listeners },
    time: { now: 0, delayedCall: () => {} },
    add: {
      tileSprite: make('tileSprite'), image: make('image'), sprite: make('sprite'), rectangle: make('rect'),
      circle: make('circle'), text: make('text'), container: make('container'), zone: make('zone'), graphics: make('graphics'),
      group: fakeGroup
    },
    physics: {
      add: {
        staticGroup: fakeGroup, group: fakeGroup,
        existing: (o) => { o.body = { setCircle() {}, setImmovable() {} }; return o; },
        collider: (a, b) => { const c = { object1: a, object2: b, destroy() { c.dead = true; } }; colliders.push(c); return c; },
        overlap: (a, b) => { const c = { object1: a, object2: b, destroy() { c.dead = true; } }; colliders.push(c); return c; }
      }
    }
  };
}

beforeAll(() => {
  globalThis.Phaser = { Display: { Color: { IntegerToColor: () => ({ rgba: '#fff' }) } } };
});

describe.each([
  ['with textures', true],
  ['fallback graphics', false]
])('MapManager rendering (%s)', (_label, withTextures) => {
  const keys = new Set(withTextures ? biomeAssetManifest().map((a) => a.key) : []);

  it('generates every stage, transitions, and re-wires collisions without leaking', () => {
    const scene = fakeScene(keys);
    const mm = new MapManager(scene);
    mm.init();
    mm.generateMap(0, { seed: 1 });
    mm.setupCollisions({}, fakeGroup(), fakeGroup());
    const firstWave = scene.colliders.length;
    expect(firstWave).toBeGreaterThan(0);

    for (let stage = 1; stage < Object.keys(BIOMES).length; stage++) {
      mm.transitionToStage(stage, { seed: stage });
      expect(mm.currentStage).toBe(stage);
      expect(mm.walls.getChildren().length).toBe(mm.layout.walls.length);
      expect(mm.hazards.getChildren().length).toBe(mm.layout.hazards.length);
      expect(mm.mechanicZones).toHaveLength(mm.layout.zones.length);
      expect(mm.borderTiles.length).toBeGreaterThan(0);
    }
    // Old colliders are destroyed on every re-wire: only the tracked set is alive.
    const live = scene.colliders.filter((c) => !c.dead).length;
    expect(live).toBe(mm.colliders.length);
    expect(mm.colliders.every((c) => !c.dead)).toBe(true);

    if (withTextures) {
      expect(mm.bgFar).toBeTruthy();
      expect(mm.bgNear).toBeTruthy();
      scene.cameras.main.scrollX = 1000;
      scene.events.listeners.postupdate();
      const back = SPACE_BG.layers.back;
      expect(mm.bgFar.tilePositionX).toBeCloseTo((1000 * back.parallax) / back.tileScale, 5);
      // The space background persists across stages and ends on the last stage's variant.
      expect(mm.space.variant).toBe(BIOMES[Object.keys(BIOMES).length - 1].bgVariant);
    } else {
      expect(mm.bgFar).toBeNull();
    }

    mm.clearMap();
    expect(mm.bgFar).toBeNull();
    expect(mm.walls.getChildren()).toHaveLength(0);
    expect(mm.teleporterZones).toHaveLength(0);
    mm.destroy();
    expect(scene.events.listeners.postupdate).toBeUndefined();
  });

  it('same seed gives the same layout', () => {
    const mm = new MapManager(fakeScene(keys));
    mm.init();
    mm.generateMap(3, { seed: 99 });
    const a = mm.layout;
    mm.generateMap(3, { seed: 99 });
    expect(mm.layout).toEqual(a);
    expect(mm.layoutSeed).toBe(99);
  });
});

describe('MapManager graphics quality', () => {
  const keys = new Set(biomeAssetManifest().map((a) => a.key));

  it("'low' drops motes, twinkle and the near layer; 'high' restores them; stage changes keep the level", () => {
    const scene = fakeScene(keys);
    const mm = new MapManager(scene);
    mm.init();
    mm.generateMap(1, { seed: 5 });
    expect(mm.bgFar && mm.bgNear).toBeTruthy();
    expect(mm.space.motes.length).toBeGreaterThan(0);

    expect(mm.setQuality('low')).toBe(true);
    expect(mm.space.motes).toHaveLength(0);
    expect(mm.space.quality).toBe('low');
    expect(mm.setQuality('low')).toBe(false);

    mm.transitionToStage(2, { seed: 6 });
    expect(mm.space.quality).toBe('low');
    expect(mm.space.motes).toHaveLength(0);

    expect(mm.setQuality('high')).toBe(true);
    expect(mm.space.motes.length).toBeGreaterThan(0);
  });

  it('onWaveChanged forwards the wave mood to the background', () => {
    const mm = new MapManager(fakeScene(keys));
    mm.init();
    mm.generateMap(0, { seed: 1 });
    const before = mm.space.props.length;
    mm.onWaveChanged(5);
    expect(mm.space.wave).toBe(5);
    expect(mm.space.props.length).toBe(before + 1);
  });
});

describe('MapManager zone readability', () => {
  const keys = new Set(biomeAssetManifest().map((a) => a.key));
  const fakePlayer = (x, y) => {
    const p = { x, y, isTinted: false, tintTopLeft: 0xffffff };
    p.setTint = (c) => { p.isTinted = true; p.tintTopLeft = c; return p; };
    p.clearTint = () => { p.isTinted = false; p.tintTopLeft = 0xffffff; return p; };
    return p;
  };
  const setup = (stage) => {
    const scene = fakeScene(keys);
    const texts = [];
    const emitted = [];
    scene.floatText = (x, y, str, color) => texts.push({ str, color });
    scene.events.emit = (e, data) => emitted.push([e, data]);
    const mm = new MapManager(scene);
    mm.init();
    mm.generateMap(stage, { seed: 3 });
    return { scene, mm, texts, emitted };
  };

  it('each zone gets a disc + icon; the player is tinted inside and the label floats only the first time', () => {
    const { mm, texts, emitted } = setup(0);
    expect(mm.zoneVisuals.length).toBe(mm.mechanicZones.length);
    mm.zoneVisuals.forEach((v) => { expect(v.disc).toBeTruthy(); expect(v.icon).toBeTruthy(); });
    const z = mm.mechanicZones[0];
    const p = fakePlayer(z.x, z.y);
    const e = mm.getBiomeEffect(0, p, 0, 16, -1e9);
    expect(e.speedMult).toBeGreaterThan(1);
    expect(p.isTinted).toBe(true);
    expect(texts).toEqual([{ str: 'SPEED UP', color: '#22d3ee' }]);
    p.x = 5; p.y = 5;
    mm.getBiomeEffect(0, p, 16, 16, -1e9);
    expect(p.isTinted).toBe(false);
    p.x = z.x; p.y = z.y;
    mm.getBiomeEffect(0, p, 32, 16, -1e9);
    expect(texts).toHaveLength(1); // once per run
    expect(emitted.filter(([ev]) => ev === 'zone:enter')).toHaveLength(2);
  });

  it('never clears a tint it did not set (sudo / shrine)', () => {
    const { mm } = setup(1);
    const z = mm.mechanicZones[0];
    const p = fakePlayer(z.x, z.y);
    p.setTint(0xffd700);
    mm.getBiomeEffect(1, p, 0, 16, -1e9);
    expect(p.tintTopLeft).toBe(0xffd700);
    p.x = 5;
    mm.getBiomeEffect(1, p, 16, 16, -1e9);
    expect(p.tintTopLeft).toBe(0xffd700);
  });

  it('pulse zones switch to the red frames only while the pulse hurts', () => {
    const { mm } = setup(3);
    const m = BIOMES[3].mechanic;
    const p = fakePlayer(5, 5);
    mm.getBiomeEffect(3, p, 0, 16, -1e9);
    expect(mm.zoneVisuals[0].frame).toBeGreaterThanOrEqual(2);
    mm.getBiomeEffect(3, p, m.activeMs + 10, 16, -1e9);
    expect(mm.zoneVisuals[0].frame).toBeLessThan(2);
  });

  it('wind shows a directional icon beside the player; gravity also marks its centre', () => {
    const { mm, texts } = setup(4);
    expect(mm.globalIndicator).toBeTruthy();
    const p = fakePlayer(1000, 1000);
    mm.getBiomeEffect(4, p, 0, 16, -1e9);
    expect(texts.map((t) => t.str)).toEqual(['WIND']);
    const g = setup(5);
    expect(g.mm.mechanicVisuals.length).toBeGreaterThanOrEqual(3); // centre disc + icon + indicator
  });

  it('both ends of a portal pair share one colour, pairs differ', () => {
    const { mm } = setup(2);
    const pads = mm.teleporters.getChildren();
    expect(pads.length).toBe(2);
    expect(pads[0].portalColor).toBe(pads[1].portalColor);
    // the teleport zones are the second pair (other colour)
    expect(mm.mechanicZones.length).toBe(2);
    expect(mm.portalPairCount).toBe(2);
  });
});
