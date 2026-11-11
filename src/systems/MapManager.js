import { BIOMES, HAZARD_DEFS, OBSTACLE_DEFS, LAYOUT_RULES, ZONE_STYLE, PORTAL_PAIR_SIDES } from '../data/biomes.js';
import { createSpaceBackground } from './spaceBackground.js';
import {
  borderKey, obstacleKey, hazardKey, hazardAnimKey, zoneKey, zoneAnimKey, CRATE_KEY, ensureBiomeAnims,
  portalKey, portalAnimKey, zoneIconKey, zoneIconAnimKey
} from '../scenes/boot/biomeAssets.js';
import { t } from '../utils/i18n.js';

/** Portal colours (ui/gameover-items-portals-v2) by texture side: one colour per pair (pair 0 cyan, pair 1 magenta). */
export const PORTAL_COLORS = Object.freeze({ a: 0x22d3ee, b: 0xe879f9 });
const GLOW_KEY = 'fx-glow';
const ADD_BLEND = 1; // Phaser.BlendModes.ADD

const NEUTRAL_EFFECT = Object.freeze({ speedMult: 1, pushX: 0, pushY: 0, damage: 0, teleportTo: null });

/** Upper bound for the frame delta used by biome damage (ms). */
export const MAX_BIOME_DT_MS = 1000;

function finiteOr(v, fallback) {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function zoneIndexAt(zones, x, y) {
  if (!Array.isArray(zones)) return -1;
  for (let i = 0; i < zones.length; i++) {
    const z = zones[i];
    if (!z) continue;
    const dx = x - z.x;
    const dy = y - z.y;
    if (dx * dx + dy * dy <= z.radius * z.radius) return i;
  }
  return -1;
}

/**
 * Pure biome mechanic evaluation (no Phaser).
 * @param {object} biome - BIOMES entry
 * @param {{x:number,y:number,worldWidth:number,worldHeight:number,time:number,lastTeleport:number,zones:Array<{x:number,y:number,radius:number}>}} playerState
 * @param {number} dt - ms since last frame
 * @returns {{speedMult:number,pushX:number,pushY:number,damage:number,teleportTo:{x:number,y:number}|null}}
 *   pushX/pushY are px/s added to player velocity; damage is HP to subtract this frame.
 */
export function biomeEffect(biome, playerState, dt) {
  const m = biome && biome.mechanic;
  if (!m || !playerState) return { ...NEUTRAL_EFFECT };
  const out = { ...NEUTRAL_EFFECT };
  const { x, y, zones } = playerState;
  // Hostile frame deltas: negative/NaN never heal, a huge spike (tab resumed) cannot one-shot the player.
  dt = finiteOr(dt, 0);
  dt = Math.max(0, Math.min(MAX_BIOME_DT_MS, dt));
  const time = finiteOr(playerState.time, 0);
  switch (m.type) {
    case 'boostZone':
    case 'slowZone':
      if (zoneIndexAt(zones, x, y) >= 0) out.speedMult = m.speedMult;
      break;
    case 'teleport': {
      const i = zoneIndexAt(zones, x, y);
      const pair = i >= 0 ? zones[i ^ 1] : null;
      const last = typeof playerState.lastTeleport === 'number' && !Number.isNaN(playerState.lastTeleport) ? playerState.lastTeleport : -Infinity;
      if (pair && Number.isFinite(pair.x) && Number.isFinite(pair.y) && time - last >= m.cooldownMs) {
        out.teleportTo = { x: pair.x, y: pair.y };
      }
      break;
    }
    case 'pulseDamage':
      if (zoneIndexAt(zones, x, y) >= 0 && (time % m.periodMs) < m.activeMs) {
        out.damage = m.dps * (dt / 1000);
      }
      break;
    case 'wind': {
      const angle = (time / m.periodMs) * Math.PI * 2;
      out.pushX = Math.cos(angle) * m.strength;
      out.pushY = Math.sin(angle) * m.strength;
      break;
    }
    case 'gravity': {
      const dx = playerState.worldWidth / 2 - x;
      const dy = playerState.worldHeight / 2 - y;
      const dist = Math.hypot(dx, dy);
      if (Number.isFinite(dist) && dist >= 1) {
        const k = m.strength * Math.min(1, dist / (m.falloffDist || 1000));
        out.pushX = (dx / dist) * k;
        out.pushY = (dy / dist) * k;
      }
      break;
    }
    default:
      break;
  }
  return out;
}

// ------------------------------------------------------------------ map composition (pure)

/** Small seeded PRNG (mulberry32) -> () => float in [0, 1). */
export function mulberry32(seed) {
  let t = (Number(seed) >>> 0) || 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

const TELEPORTER_RADIUS = 40;
const CRATE_SIZE = [24, 40];
const WALL_TILE = 32;

function emptyLayout() {
  return { walls: [], obstacles: [], hazards: [], zones: [], crates: [], teleporters: [] };
}

/**
 * Pure, seeded map composition for one biome (no Phaser).
 * Every item is kept >= LAYOUT_RULES.spawnClearance px (edge to spawn) away from the spawn point,
 * inside the world minus edgeMargin, and never overlaps another item (bounding circles + gap).
 * Item counts scale with biome.density and grow with the stage index.
 *
 * @param {number} seed
 * @param {object} biome - BIOMES entry
 * @param {number} w - world width
 * @param {number} h - world height
 * @param {{stage?:number, spawn?:{x:number,y:number}, teleporterPairs?:number, rules?:object}} [options]
 * @returns {{walls:Array<{x,y,w,h}>, obstacles:Array<{x,y,type,size,shape}>, hazards:Array<{x,y,type,radius,damage}>,
 *   zones:Array<{x,y,radius}>, crates:Array<{x,y,size}>, teleporters:Array<{x,y,radius,pair,quadrant}>}}
 */
export function layoutBiome(seed, biome, w, h, options = {}) {
  const out = emptyLayout();
  if (!biome || !(w > 0) || !(h > 0)) return out;
  const rules = { ...LAYOUT_RULES, ...(options.rules || {}) };
  const counts = { ...LAYOUT_RULES.counts, ...((options.rules && options.rules.counts) || {}) };
  const stage = Math.max(0, finiteOr(options.stage, 0));
  const sp = options.spawn;
  const spawn = sp && Number.isFinite(sp.x) && Number.isFinite(sp.y) ? sp : { x: w / 2, y: h / 2 };

  const rng = mulberry32(seed);
  const between = (a, b) => a + Math.floor(rng() * (b - a + 1));
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];
  const scale = finiteOr(biome.density, 0.3) * (1 + stage * rules.stageGrowth);
  const count = (n) => Math.max(0, Math.round(n * scale));

  const placed = [];
  const tryPlace = (r, region = null, attempts = 40) => {
    const m = rules.edgeMargin;
    const minX = Math.max(region ? region.x0 : 0, m) + r;
    const maxX = Math.min(region ? region.x1 : w, w - m) - r;
    const minY = Math.max(region ? region.y0 : 0, m) + r;
    const maxY = Math.min(region ? region.y1 : h, h - m) - r;
    if (minX > maxX || minY > maxY) return null;
    for (let i = 0; i < attempts; i++) {
      const x = Math.round(minX + rng() * (maxX - minX));
      const y = Math.round(minY + rng() * (maxY - minY));
      if (Math.hypot(x - spawn.x, y - spawn.y) - r < rules.spawnClearance) continue;
      if (placed.some((p) => Math.hypot(p.x - x, p.y - y) < p.r + r + rules.gap)) continue;
      const entry = { x, y, r };
      placed.push(entry);
      return entry;
    }
    return null;
  };
  const unplace = (entry) => {
    const i = placed.indexOf(entry);
    if (i >= 0) placed.splice(i, 1);
  };

  // 0. mechanic zones first (few, small landmarks; teleport mechanic needs complete pairs), so they always fit
  const m = biome.mechanic;
  const zr = rules.zones || LAYOUT_RULES.zones;
  if (m && m.zoneCount > 0) {
    const n = Math.max(zr.min, Math.min(zr.max, Math.round(m.zoneCount)));
    const radius = m.type === 'teleport' ? m.zoneRadius : Math.max(zr.radiusMin, Math.min(zr.radiusMax, finiteOr(m.zoneRadius, zr.radiusMax)));
    const zoneEntries = [];
    for (let i = 0; i < n; i++) {
      const p = tryPlace(radius, null, 80);
      if (p) { zoneEntries.push(p); out.zones.push({ x: p.x, y: p.y, radius }); }
    }
    if (m.type === 'teleport' && out.zones.length % 2 === 1) {
      out.zones.pop();
      unplace(zoneEntries.pop());
    }
  }

  // 1. walls (tile-aligned sizes so the wall texture repeats cleanly)
  for (let i = 0; i < count(counts.walls); i++) {
    const ww = between(2, 4) * WALL_TILE;
    const wh = between(2, 4) * WALL_TILE;
    const p = tryPlace(Math.hypot(ww, wh) / 2);
    if (p) out.walls.push({ x: p.x, y: p.y, w: ww, h: wh });
  }

  // 2. teleporter pads: linked pairs in two different quadrants
  const quads = [
    { x0: 0, y0: 0, x1: w / 2, y1: h / 2 }, { x0: w / 2, y0: 0, x1: w, y1: h / 2 },
    { x0: 0, y0: h / 2, x1: w / 2, y1: h }, { x0: w / 2, y0: h / 2, x1: w, y1: h }
  ];
  const pairs = Math.max(0, Math.floor(finiteOr(options.teleporterPairs, 2)));
  for (let i = 0; i < pairs; i++) {
    const qa = Math.floor(rng() * 4);
    const qb = (qa + 1 + Math.floor(rng() * 3)) % 4;
    const a = tryPlace(TELEPORTER_RADIUS, quads[qa]);
    const b = a ? tryPlace(TELEPORTER_RADIUS, quads[qb]) : null;
    if (a && b) {
      out.teleporters.push({ x: a.x, y: a.y, radius: TELEPORTER_RADIUS, pair: i, quadrant: qa });
      out.teleporters.push({ x: b.x, y: b.y, radius: TELEPORTER_RADIUS, pair: i, quadrant: qb });
    } else if (a) {
      unplace(a);
    }
  }

  // 4. hazards
  const hazardTypes = (biome.hazardTypes || []).filter((t) => HAZARD_DEFS[t]);
  if (hazardTypes.length) {
    for (let i = 0; i < count(counts.hazards); i++) {
      const type = pick(hazardTypes);
      const def = HAZARD_DEFS[type];
      const radius = between(def.radiusMin, def.radiusMax);
      const p = tryPlace(radius);
      if (p) {
        out.hazards.push({ x: p.x, y: p.y, type, radius, damage: Math.max(1, Math.round(finiteOr(biome.hazardDamage, 10) * def.damageMult)) });
      }
    }
  }

  // 5. obstacles (furniture)
  const obstacleTypes = (biome.obstacles || []).filter((t) => OBSTACLE_DEFS[t]);
  if (obstacleTypes.length) {
    for (let i = 0; i < count(counts.furniture); i++) {
      const type = pick(obstacleTypes);
      const def = OBSTACLE_DEFS[type];
      const size = between(def.sizeMin, def.sizeMax);
      const p = tryPlace((size * Math.SQRT2) / 2);
      if (p) out.obstacles.push({ x: p.x, y: p.y, type, size, shape: def.shape });
    }
  }

  // 6. destructible crates
  for (let i = 0; i < count(counts.crates); i++) {
    const size = between(CRATE_SIZE[0], CRATE_SIZE[1]);
    const p = tryPlace((size * Math.SQRT2) / 2);
    if (p) out.crates.push({ x: p.x, y: p.y, size });
  }

  return out;
}

// ------------------------------------------------------------------ Phaser side

const DEPTH = Object.freeze({ far: -9.5, near: -9, border: -2, zone: -1 });

/**
 * MapManager - animated space background (spaceBackground.js, one variant per stage), map borders, obstacles, hazards, mechanic zones,
 * destructibles and teleporters. Placement comes from layoutBiome(); art from biomeAssets.js with a
 * graphics fallback for any texture that is missing.
 */
export default class MapManager {
  constructor(scene) {
    this.scene = scene;

    // Physics groups for different collision types
    this.walls = null;      // Block movement + projectiles
    this.furniture = null;  // Block movement only
    this.hazards = null;    // Damage zones
    this.destructibles = null; // Can be destroyed
    this.teleporters = null;   // Paired teleport pads
    this.spawners = null;      // Pickup spawn points

    // Biome definitions (data: src/data/biomes.js)
    this.biomes = BIOMES;
    this.currentStage = 0;
    this.layoutSeed = 0;
    this.layout = emptyLayout();

    // Biome mechanic zones ({x, y, radius}) + their visuals
    this.mechanicZones = [];
    this.mechanicVisuals = [];
    // Readability: per-zone visuals ({disc, icon}), the wind/gravity indicator next to the player,
    // the zone type the player stands in (tint) and the types already announced this run.
    this.zoneVisuals = [];
    this.globalIndicator = null;
    this.zoneInside = null;
    this.zoneTint = null;
    this.seenZoneTypes = new Set();
    this.portalPairCount = 0;

    // Teleporter pairs (for connecting distant areas)
    this.teleporterPairs = [];
    this.teleportCooldown = 2000; // ms

    // Animated space background (src/systems/spaceBackground.js) persists across stages and crossfades;
    // bgFar / bgNear alias its back / near tileSprites. Borders / loose decor are per map.
    this.space = null;
    this.bgFar = null;
    this.bgNear = null;
    this.borderTiles = [];
    this.decor = [];
    // 'high' = full animated background; 'low' = no motes, no star twinkle, no near layer (see setQuality)
    this.quality = 'high';
    this.wave = 1;

    // Colliders + teleporter overlap zones (recreated idempotently by setupCollisions)
    this.colliders = [];
    this.teleporterZones = [];
    this.collisionTargets = null;

    // Track infinite tweens so we can stop them on clearMap()
    this.activeTweens = [];
    this.bgTweens = [];
  }

  /** Create a tween and track it for cleanup on clearMap(). */
  addTrackedTween(config) {
    const tween = this.scene.tweens.add(config);
    this.activeTweens.push(tween);
    return tween;
  }

  hasTexture(key) {
    return !!(this.scene.textures && this.scene.textures.exists(key));
  }

  /** Initialize physics groups and hook the per-frame parallax update. */
  init() {
    this.walls = this.scene.physics.add.staticGroup();
    this.furniture = this.scene.physics.add.staticGroup();
    this.hazards = this.scene.physics.add.staticGroup();
    this.destructibles = this.scene.physics.add.group();
    this.teleporters = this.scene.add.group();
    this.spawners = this.scene.add.group();

    const events = this.scene.events;
    if (events && typeof events.on === 'function') {
      events.on('postupdate', this.syncParallax, this);
      events.once('shutdown', this.destroy, this);
    }
  }

  /**
   * Scene shutdown: detach listeners and drop references. Phaser has already torn down the display
   * list, tweens and physics world by the time this runs, so nothing is destroyed here.
   */
  destroy() {
    const events = this.scene && this.scene.events;
    if (events && typeof events.off === 'function') events.off('postupdate', this.syncParallax, this);
    if (this.space) this.space.destroy();
    this.space = null;
    this.bgFar = null;
    this.bgNear = null;
    this.borderTiles = [];
    this.decor = [];
    this.colliders = [];
    this.teleporterZones = [];
    this.activeTweens = [];
    this.bgTweens = [];
    this.collisionTargets = null;
  }

  /**
   * Generate the map for a stage.
   * @param {number} stage - stage index (0-5)
   * @param {{seed?:number, spawn?:{x:number,y:number}}} [options] - seed for a reproducible layout; spawn defaults to the player
   */
  generateMap(stage, options = {}) {
    this.clearMap({ keepSpace: true });
    ensureBiomeAnims(this.scene);

    this.currentStage = stage;
    const biome = this.biomes[stage] || this.biomes[0];
    const worldWidth = this.scene.worldWidth;
    const worldHeight = this.scene.worldHeight;
    const player = this.scene.player;
    const spawn = options.spawn || (player && Number.isFinite(player.x) ? { x: player.x, y: player.y } : { x: worldWidth / 2, y: worldHeight / 2 });
    this.layoutSeed = Number.isFinite(options.seed) ? options.seed >>> 0 : (Math.random() * 0x100000000) >>> 0;
    const teleporterPairs = biome.mechanic && biome.mechanic.type === 'teleport' ? LAYOUT_RULES.teleporterPairsTeleportBiome : LAYOUT_RULES.teleporterPairs;
    this.layout = layoutBiome(this.layoutSeed, biome, worldWidth, worldHeight, { stage, spawn, teleporterPairs });

    this.createBiomeBackground(biome, options);
    this.layout.walls.forEach((w) => this.createWall(w, biome));
    this.layout.obstacles.forEach((o) => this.createFurniture(o, biome));
    this.layout.hazards.forEach((hz) => this.createHazard(hz));
    this.layout.crates.forEach((c) => this.createDestructible(c));
    this.portalPairCount = 0;
    for (let i = 0; i + 1 < this.layout.teleporters.length; i += 2) {
      this.createTeleporterPair(this.layout.teleporters[i], this.layout.teleporters[i + 1]);
    }
    this.createMechanicZones(biome, this.layout.zones);
  }

  /**
   * Stage change: fade the old biome out, build the new one around the player and fade it in.
   * Re-wires collisions (teleporter zones are per-map) when setupCollisions() was called before.
   */
  transitionToStage(stage, options = {}) {
    const fadeMs = finiteOr(options.fadeMs, 600);
    const old = [...this.borderTiles].filter(Boolean);
    // Detach old borders so generateMap() does not destroy them before the fade finishes. The space
    // background is kept and crossfades to the new stage variant (stepped alpha, see spaceBackground.js).
    this.borderTiles = [];
    old.forEach((o) => {
      this.scene.tweens.add({ targets: o, alpha: 0, duration: fadeMs, onComplete: () => o.destroy() });
    });

    this.generateMap(stage, { ...options, fadeMs });
    if (this.collisionTargets) {
      const { player, enemies, projectiles } = this.collisionTargets;
      this.setupCollisions(player, enemies, projectiles);
    }

    const fresh = [...this.borderTiles, ...this.mapObjects()].filter(Boolean);
    fresh.forEach((o) => {
      const target = o.alpha;
      o.setAlpha(0);
      this.scene.tweens.add({ targets: o, alpha: target, duration: fadeMs });
    });
  }

  /**
   * Wave change inside a stage: subtle background mood (nebula brightness ±10%, mote density) and a new
   * prop floating in every 5 waves. ArenaScene calls this when waveNumber changes.
   */
  onWaveChanged(wave) {
    this.wave = wave;
    if (this.space) this.space.setWave(wave);
  }

  /** All display objects owned by the current map (for fades). */
  mapObjects() {
    const kids = (g) => (g && g.getChildren ? g.getChildren() : []);
    return [
      ...kids(this.walls), ...kids(this.furniture), ...kids(this.hazards), ...kids(this.destructibles),
      ...kids(this.teleporters), ...this.mechanicVisuals, ...this.decor
    ];
  }

  // ------------------------------------------------------------ background + borders

  /** Animated space background (stage variant) + visible world border for the biome. */
  createBiomeBackground(biome, options = {}) {
    this.destroyBackground({ keepSpace: true });
    this.createBackgroundLayers(biome, options);
    this.createBorders(biome, this.scene.worldWidth, this.scene.worldHeight);
  }

  /**
   * Graphics quality. 'low' drops the background motes, the star twinkle and the near wisp layer
   * (one full-screen fill less); 'high' restores them.
   * @returns {boolean} true when the level changed
   */
  setQuality(level) {
    const next = level === 'low' ? 'low' : 'high';
    if (next === this.quality) return false;
    this.quality = next;
    if (this.space) this.space.setQuality(next);
    return true;
  }

  /** Create the space background on first use, otherwise crossfade it to the biome's variant. */
  createBackgroundLayers(biome, options = {}) {
    const variant = biome.bgVariant || biome.id;
    if (!this.space) {
      this.space = createSpaceBackground(this.scene, { variant, depth: DEPTH.far, quality: this.quality, seed: (this.layoutSeed ^ 0x5eed) >>> 0 });
      if (this.wave > 1) this.space.setWave(this.wave);
    } else {
      this.space.setVariant(variant, { fadeMs: finiteOr(options.fadeMs, 0) });
    }
    const layers = this.space.layers;
    this.bgFar = layers.back || null;
    this.bgNear = layers.near || null;
  }

  /** Per-frame background step (scene 'postupdate' gives (time, delta)): parallax, drift, twinkle, fades. */
  syncParallax(_time, delta) {
    if (!this.space) return;
    this.space.update(delta);
    const layers = this.space.layers;
    this.bgFar = layers.back || null;
    this.bgNear = layers.near || null;
  }

  createBorders(biome, W, H) {
    const key = borderKey(biome.id);
    const t = 32;
    const strips = [[0, 0, W, t], [0, H - t, W, t], [0, t, t, H - 2 * t], [W - t, t, t, H - 2 * t]];
    if (this.hasTexture(key)) {
      strips.forEach(([x, y, w, h]) => {
        this.borderTiles.push(this.scene.add.tileSprite(x, y, w, h, key).setOrigin(0, 0).setDepth(DEPTH.border));
      });
    } else {
      const g = this.scene.add.graphics().setDepth(DEPTH.border);
      g.lineStyle(4, biome.wallTint, 0.8);
      g.strokeRect(2, 2, W - 4, H - 4);
      this.borderTiles.push(g);
    }
  }

  destroyBackground({ keepSpace = false } = {}) {
    this.stopTweens(this.bgTweens);
    this.bgTweens = [];
    if (!keepSpace && this.space) {
      this.space.destroy();
      this.space = null;
    }
    this.borderTiles.forEach((b) => b && b.destroy && b.destroy());
    if (!this.space) {
      this.bgFar = null;
      this.bgNear = null;
    }
    this.borderTiles = [];
  }

  // ------------------------------------------------------------ map objects

  /** Wall obstacle (blocks movement + projectiles). */
  createWall({ x, y, w, h }, biome) {
    const key = borderKey(biome.id);
    let wall;
    if (this.hasTexture(key)) {
      wall = this.scene.add.tileSprite(x, y, w, h, key);
    } else {
      wall = this.scene.add.rectangle(x, y, w, h, biome.wallTint, 0.6);
      wall.setStrokeStyle(2, biome.wallTint, 1);
      const innerGlow = this.scene.add.rectangle(x, y, w - 8, h - 8, 0x000000, 0.3);
      innerGlow.setStrokeStyle(1, biome.wallTint, 0.3);
      this.decor.push(innerGlow);
      this.addTrackedTween({ targets: wall, alpha: 0.4, duration: 2000, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    }
    this.scene.physics.add.existing(wall, true);
    this.walls.add(wall);
    return wall;
  }

  /** Furniture (blocks movement only). */
  createFurniture({ x, y, type, size }, biome) {
    const key = obstacleKey(type);
    let furniture;
    if (this.hasTexture(key)) {
      furniture = this.scene.add.image(x, y, key).setDisplaySize(size, size);
    } else {
      const def = OBSTACLE_DEFS[type] || { color: 0x333333, shape: 'rect' };
      furniture = def.shape === 'circle'
        ? this.scene.add.circle(x, y, size / 2, def.color, 0.75)
        : this.scene.add.rectangle(x, y, size, size, def.color, 0.75);
      furniture.setStrokeStyle(1, biome.wallTint, 0.6);
    }
    furniture.obstacleType = type;
    this.scene.physics.add.existing(furniture, true);
    this.furniture.add(furniture);
    return furniture;
  }

  /**
   * Visuals for the biome mechanic zones (positions come from the layout): a dotted pixel disc in the
   * effect colour + a 16x16 icon saying what it does (docs/MAPS.md). Teleport zones are portal pairs
   * (one colour per pair, A/B letters). Wind / gravity are global: an icon next to the player shows the
   * push direction, gravity also marks its centre.
   */
  createMechanicZones(biome, zones) {
    const m = biome.mechanic;
    if (!m) return;
    if (m.type === 'wind' || m.type === 'gravity') {
      this.createGlobalIndicator(m);
      return;
    }
    if (!zones || !zones.length) return;
    const key = zoneKey(m.type);
    const useSprite = this.hasTexture(key);
    const iconKey = zoneIconKey(m.type);
    zones.forEach((z, i) => {
      this.mechanicZones.push({ x: z.x, y: z.y, radius: z.radius });
      // Teleport zones pair up as (0,1), (2,3)...: one colour per pair, letter A on even, B on odd.
      if (m.type === 'teleport' && this.hasTexture(portalKey('a'))) {
        if (i % 2 === 0) this.portalPairCount++;
        const side = this.pairSide(this.portalPairCount - 1);
        const portal = this.createPortalVisual(z.x, z.y, z.radius, side, i % 2 === 0 ? 'A' : 'B');
        portal.setDepth(DEPTH.zone);
        this.mechanicVisuals.push(portal);
        return;
      }
      let disc;
      if (useSprite) {
        disc = this.scene.add.sprite(z.x, z.y, key).setDisplaySize(z.radius * 2, z.radius * 2);
        const anim = zoneAnimKey(m.type);
        if (m.type !== 'pulseDamage' && this.scene.anims && this.scene.anims.exists(anim)) disc.play(anim);
      } else {
        disc = this.scene.add.circle(z.x, z.y, z.radius, m.color, 0.14);
        disc.setStrokeStyle(2, m.color, 0.8);
      }
      disc.setDepth(DEPTH.zone);
      this.mechanicVisuals.push(disc);
      const icon = this.createZoneIcon(z.x, z.y, m.type, iconKey);
      this.zoneVisuals.push({ disc, icon, type: m.type, frame: -1 });
    });
  }

  /** 16x16 pixel icon at 4x (falls back to nothing: the disc colour still reads). */
  createZoneIcon(x, y, type, key = zoneIconKey(type)) {
    if (!this.hasTexture(key)) return null;
    const icon = this.scene.add.sprite(x, y, key).setScale(4).setDepth(DEPTH.zone + 0.2);
    const anim = zoneIconAnimKey(type);
    if (type !== 'pulseDamage' && this.scene.anims && this.scene.anims.exists(anim)) icon.play(anim);
    this.mechanicVisuals.push(icon);
    return icon;
  }

  /** Portal texture side for the n-th pair on this map (both ends share it). */
  pairSide(n) {
    return PORTAL_PAIR_SIDES[Math.max(0, n) % PORTAL_PAIR_SIDES.length];
  }

  /** Wind / gravity: small icon beside the player pointing where it pushes; gravity marks its centre. */
  createGlobalIndicator(m) {
    const key = zoneIconKey(m.type);
    if (m.type === 'gravity') {
      const cx = this.scene.worldWidth / 2;
      const cy = this.scene.worldHeight / 2;
      const r = LAYOUT_RULES.zones.radiusMax;
      const discKey = zoneKey('gravity');
      const disc = this.hasTexture(discKey)
        ? this.scene.add.sprite(cx, cy, discKey).setDisplaySize(r * 2, r * 2)
        : this.scene.add.circle(cx, cy, r, m.color, 0.14).setStrokeStyle(2, m.color, 0.8);
      if (disc.play && this.scene.anims && this.scene.anims.exists(zoneAnimKey('gravity'))) disc.play(zoneAnimKey('gravity'));
      disc.setDepth(DEPTH.zone);
      this.mechanicVisuals.push(disc);
      this.createZoneIcon(cx, cy, 'gravity');
    }
    if (!this.hasTexture(key)) return;
    const ind = this.scene.add.sprite(0, 0, key).setScale(3).setDepth(1).setAlpha(0.9).setVisible(false);
    const anim = zoneIconAnimKey(m.type);
    if (this.scene.anims && this.scene.anims.exists(anim)) ind.play(anim);
    this.globalIndicator = ind;
    this.mechanicVisuals.push(ind);
  }

  /** Evaluate the current biome mechanic for the player. */
  getBiomeEffect(stage, player, time, delta, lastTeleport) {
    const biome = this.biomes[stage] || this.biomes[0];
    const effect = biomeEffect(biome, {
      x: player.x,
      y: player.y,
      worldWidth: this.scene.worldWidth,
      worldHeight: this.scene.worldHeight,
      time,
      lastTeleport,
      zones: this.mechanicZones
    }, delta);
    this.updateZoneFeedback(biome, player, time, effect);
    return effect;
  }

  /**
   * Per-frame readability feedback (cheap: a few property writes):
   * - pulseDamage discs/icons switch to their red frames while the pulse hurts;
   * - wind/gravity indicator sits beside the player, rotated to the push;
   * - the player gets a light tint while inside a zone (restored on exit, never over another tint);
   * - the first time each zone type is felt this run, a 1-2 word pixel label floats over the player.
   */
  updateZoneFeedback(biome, player, time, effect) {
    const m = biome && biome.mechanic;
    if (!m || !player) return;
    const now = finiteOr(time, 0);
    if (m.type === 'pulseDamage' && this.zoneVisuals.length) {
      const active = (now % m.periodMs) < m.activeMs;
      const frame = active ? 2 + (Math.floor(now / 160) % 2) : Math.floor(now / 500) % 2;
      for (const v of this.zoneVisuals) {
        if (v.frame === frame) continue;
        v.frame = frame;
        if (v.disc && v.disc.setFrame) v.disc.setFrame(frame);
        if (v.icon && v.icon.setFrame) v.icon.setFrame(frame);
      }
    }
    let inside = null;
    if (m.type === 'wind' || m.type === 'gravity') {
      const mag = Math.hypot(effect.pushX, effect.pushY);
      if (mag > 1) inside = m.type;
      const ind = this.globalIndicator;
      if (ind) {
        ind.setVisible(mag > 1);
        if (mag > 1) {
          const ang = Math.atan2(effect.pushY, effect.pushX);
          ind.setPosition(Math.round(player.x + Math.cos(ang) * 44), Math.round(player.y + Math.sin(ang) * 44));
          if (m.type === 'wind') ind.setRotation(ang);
        }
      }
    } else if (zoneIndexAt(this.mechanicZones, player.x, player.y) >= 0) {
      inside = m.type;
    }
    this.setZoneTint(player, inside ? (ZONE_STYLE[inside] || {}).tint : null);
    if (inside !== this.zoneInside) {
      this.zoneInside = inside;
      if (inside) this.announceZone(inside, player);
    }
  }

  /** Light tint on the player while inside a zone; only clears a tint this manager set. */
  setZoneTint(player, tint) {
    if (!player || typeof player.setTint !== 'function') return;
    if (tint) {
      if (this.zoneTint === tint && player.isTinted) return;
      if (player.isTinted && this.zoneTint == null) return; // someone else's tint (sudo, shrine): leave it
      player.setTint(tint);
      this.zoneTint = tint;
    } else if (this.zoneTint != null) {
      if (player.tintTopLeft === this.zoneTint && typeof player.clearTint === 'function') player.clearTint();
      this.zoneTint = null;
    }
  }

  /** First entry into a zone type this run: floating pixel label + 'zone:enter' event (every entry). */
  announceZone(type, player) {
    const scene = this.scene;
    if (scene.events && typeof scene.events.emit === 'function') scene.events.emit('zone:enter', { type });
    if (this.seenZoneTypes.has(type)) return;
    this.seenZoneTypes.add(type);
    const style = ZONE_STYLE[type];
    if (!style || typeof scene.floatText !== 'function') return;
    scene.floatText(player.x, player.y - 56, t(style.label), style.css, { size: 16, duration: 1200, rise: 22 });
  }

  /** Hazard zone (damages player and enemies). */
  createHazard({ x, y, type, radius, damage }) {
    const key = hazardKey(type);
    let hazard;
    if (this.hasTexture(key)) {
      hazard = this.scene.add.sprite(x, y, key).setDisplaySize(radius * 2, radius * 2).setAlpha(0.9);
      const anim = hazardAnimKey(type);
      if (this.scene.anims && this.scene.anims.exists(anim)) hazard.play(anim);
    } else {
      const def = HAZARD_DEFS[type] || { color: 0xff0000 };
      hazard = this.scene.add.circle(x, y, radius, def.color, 0.3);
      hazard.setStrokeStyle(2, def.color, 0.6);
      this.addTrackedTween({
        targets: hazard,
        alpha: { from: 0.2, to: 0.4 },
        duration: 800,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut'
      });
    }
    this.scene.physics.add.existing(hazard, true);
    hazard.body.setCircle(radius);
    hazard.hazardType = type;
    hazard.damage = damage;
    hazard.lastDamageTime = 0;
    hazard.damageCooldown = 500; // Damage every 500ms
    this.hazards.add(hazard);
    return hazard;
  }

  /** Destructible crate (can be destroyed for drops). */
  createDestructible({ x, y, size }) {
    let crate;
    if (this.hasTexture(CRATE_KEY)) {
      crate = this.scene.add.image(x, y, CRATE_KEY).setDisplaySize(size, size);
    } else {
      crate = this.scene.add.rectangle(x, y, size, size, 0x8b4513, 0.8);
      crate.setStrokeStyle(2, 0xdaa520, 1);
    }
    this.scene.physics.add.existing(crate);
    crate.body.setImmovable(true);

    crate.health = 20;
    crate.maxHealth = 20;
    crate.isDestructible = true;
    crate.dropType = Math.random() < 0.3 ? 'weapon' : 'xp';

    this.destructibles.add(crate);
    return crate;
  }

  /** Linked teleporter pair at two layout pads. */
  createTeleporterPair(padA, padB) {
    // Both ends share the pair colour; letters A/B mark the two ends.
    const side = this.pairSide(this.portalPairCount++);
    const teleA = this.createTeleporter(padA.x, padA.y, PORTAL_COLORS[side], 'A');
    const teleB = this.createTeleporter(padB.x, padB.y, PORTAL_COLORS[side], 'B');
    teleA.linkedTeleporter = teleB;
    teleB.linkedTeleporter = teleA;
    this.teleporterPairs.push({ a: teleA, b: teleB });
  }

  /**
   * Animated portal: soft tinted glow + 8-frame energy ring + drifting sparks.
   * Returns a container (world space); sparks live in this.decor so clearMap() removes them.
   */
  createPortalVisual(x, y, radius, side = 'a', letter = null) {
    const color = PORTAL_COLORS[side] || PORTAL_COLORS.a;
    const parts = [];
    const size = radius * 2;
    if (this.hasTexture(GLOW_KEY)) {
      const glow = this.scene.add.image(0, 0, GLOW_KEY).setDisplaySize(size * 2.3, size * 2.3).setTint(color).setAlpha(0.5);
      glow.setBlendMode(ADD_BLEND);
      parts.push(glow);
      this.addTrackedTween({ targets: glow, alpha: { from: 0.32, to: 0.6 }, duration: 1400, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    }
    const key = portalKey(side);
    if (this.hasTexture(key)) {
      const ring = this.scene.add.sprite(0, 0, key).setDisplaySize(size * 1.6, size * 1.6);
      const anim = portalAnimKey(side);
      if (this.scene.anims && this.scene.anims.exists(anim)) ring.play(anim);
      parts.push(ring);
    } else {
      const outer = this.scene.add.circle(0, 0, radius, 0x0b1020, 0.6);
      outer.setStrokeStyle(3, color, 0.9);
      parts.push(outer);
    }
    // Pixel A/B letter (zone-icon-teleport frames 0/1) so the two ends of a pair read as a pair.
    const letterKey = zoneIconKey('teleport');
    if (letter && this.hasTexture(letterKey)) {
      parts.push(this.scene.add.sprite(0, 0, letterKey, letter === 'B' ? 1 : 0).setScale(2));
    }
    const container = this.scene.add.container(x, y, parts);

    // Sparks drifting up out of the portal (skipped on low graphics or when particles are unavailable).
    if (this.quality !== 'low' && this.hasTexture(GLOW_KEY) && typeof this.scene.add.particles === 'function') {
      try {
        const sparks = this.scene.add.particles(x, y, GLOW_KEY, {
          lifespan: { min: 700, max: 1300 },
          speed: { min: 6, max: 22 },
          angle: { min: 0, max: 360 },
          gravityY: -18,
          scale: { start: 0.09, end: 0 },
          alpha: { start: 0.9, end: 0 },
          tint: [color, 0xffffff],
          blendMode: ADD_BLEND,
          frequency: 140,
          emitZone: { type: 'random', source: { getRandomPoint: (p) => {
            const a = Math.random() * Math.PI * 2;
            const r = radius * (0.35 + Math.random() * 0.6);
            p.x = Math.cos(a) * r;
            p.y = Math.sin(a) * r;
            return p;
          } } }
        });
        if (sparks && sparks.setDepth) sparks.setDepth(DEPTH.zone + 0.5);
        if (sparks) this.decor.push(sparks);
      } catch (_) { /* particles are decoration only */ }
    }
    return container;
  }

  /** Single teleporter pad (animated portal; pair colour comes from createTeleporterPair). */
  createTeleporter(x, y, color, letter = null) {
    const radius = 38;
    const side = color === PORTAL_COLORS.b || color === 0xff00ff ? 'b' : 'a';
    const container = this.createPortalVisual(x, y, radius, side, letter);
    container.setDepth(DEPTH.zone);
    container.teleporterX = x;
    container.teleporterY = y;
    container.portalColor = PORTAL_COLORS[side];
    container.lastUsedTime = 0;
    container.cooldown = this.teleportCooldown;
    container.isReady = true;
    this.teleporters.add(container);
    return container;
  }

  /**
   * Handle teleporter usage
   * @param {Phaser.GameObjects.Sprite} player - Player sprite
   * @param {Phaser.GameObjects.Container} teleporter - Teleporter container
   */
  useTeleporter(player, teleporter) {
    const now = this.scene.time.now;

    // Check cooldown
    if (now - teleporter.lastUsedTime < teleporter.cooldown) {
      return false;
    }

    const linked = teleporter.linkedTeleporter;
    if (!linked) return false;

    // Teleport!
    teleporter.lastUsedTime = now;
    linked.lastUsedTime = now;

    // Visual effect at origin
    this.createTeleportEffect(player.x, player.y, teleporter.portalColor || PORTAL_COLORS.a);

    // Move player
    player.x = linked.teleporterX;
    player.y = linked.teleporterY;

    // Both ends dim while recharging
    [teleporter, linked].forEach((t) => { if (t && t.setAlpha) t.setAlpha(0.45); });
    if (this.scene.time && this.scene.time.delayedCall) {
      this.scene.time.delayedCall(teleporter.cooldown, () => {
        [teleporter, linked].forEach((t) => { if (t && t.active !== false && t.setAlpha) t.setAlpha(1); });
      });
    }

    // Visual effect at destination
    this.createTeleportEffect(player.x, player.y, linked.portalColor || PORTAL_COLORS.b);

    return true;
  }

  /**
   * Teleport burst: expanding ring + glow flash + a ring of sparks, and a brief soft camera flash.
   */
  createTeleportEffect(x, y, color = PORTAL_COLORS.a) {
    const add = this.scene.add;
    if (this.hasTexture(GLOW_KEY)) {
      const flash = add.image(x, y, GLOW_KEY).setTint(color).setBlendMode(ADD_BLEND).setDepth(60).setScale(0.6).setAlpha(1);
      this.scene.tweens.add({ targets: flash, scale: 2.4, alpha: 0, duration: 380, ease: 'Cubic.easeOut', onComplete: () => flash.destroy() });
    }
    const ring = add.circle(x, y, 18, color, 0);
    ring.setStrokeStyle(3, color, 0.95);
    ring.setDepth(60);
    this.scene.tweens.add({ targets: ring, scale: 3.2, alpha: 0, duration: 420, ease: 'Cubic.easeOut', onComplete: () => ring.destroy() });
    for (let i = 0; i < 12; i++) {
      const angle = (i / 12) * Math.PI * 2;
      const particle = add.circle(x + Math.cos(angle) * 14, y + Math.sin(angle) * 14, i % 2 ? 2.5 : 3.5, i % 3 ? color : 0xffffff, 0.95);
      particle.setDepth(60);
      this.scene.tweens.add({
        targets: particle,
        x: x + Math.cos(angle) * 70,
        y: y + Math.sin(angle) * 70,
        alpha: 0,
        scale: 0.2,
        duration: 460,
        ease: 'Cubic.easeOut',
        onComplete: () => particle.destroy()
      });
    }
    const cam = this.scene.cameras && this.scene.cameras.main;
    if (cam && cam.flash) {
      const r = (color >> 16) & 0xff;
      const g = (color >> 8) & 0xff;
      const b = color & 0xff;
      cam.flash(140, Math.round(r * 0.5), Math.round(g * 0.5), Math.round(b * 0.5), false);
    }
  }

  /**
   * Handle hazard damage
   * @param {Phaser.GameObjects.Sprite} entity - Player or enemy
   * @param {Phaser.GameObjects.Circle} hazard - Hazard zone
   */
  handleHazardDamage(entity, hazard) {
    const now = this.scene.time.now;

    if (now - hazard.lastDamageTime < hazard.damageCooldown) {
      return 0;
    }

    hazard.lastDamageTime = now;

    // Return damage amount — caller is responsible for applying it.
    // This prevents double-damage when both handleHazardDamage and the
    // overlap callback subtract health independently.

    // Visual feedback
    entity.setTint(0xff0000);
    this.scene.time.delayedCall(100, () => {
      if (entity.active) entity.clearTint();
    });

    return hazard.damage;
  }

  /**
   * Handle destructible hit
   * @param {Phaser.GameObjects.Rectangle} destructible - Destructible object
   * @param {number} damage - Damage dealt
   */
  hitDestructible(destructible, damage) {
    destructible.health -= damage;

    // Flash white (sprite crates tint, fallback rectangles refill)
    if (typeof destructible.setTintFill === 'function') {
      destructible.setTintFill(0xffffff);
      this.scene.time.delayedCall(50, () => {
        if (destructible.active) destructible.clearTint();
      });
    } else {
      destructible.setFillStyle(0xffffff, 1);
      this.scene.time.delayedCall(50, () => {
        if (destructible.active) destructible.setFillStyle(0x8b4513, 0.8);
      });
    }

    // Destroy if dead
    if (destructible.health <= 0) {
      this.destroyDestructible(destructible);
    }
  }

  /**
   * Destroy a destructible and spawn drops
   */
  destroyDestructible(destructible) {
    const x = destructible.x;
    const y = destructible.y;

    // Particles
    for (let i = 0; i < 6; i++) {
      const particle = this.scene.add.rectangle(
        x + Phaser.Math.Between(-10, 10),
        y + Phaser.Math.Between(-10, 10),
        8, 8,
        0x8b4513
      );
      this.scene.tweens.add({
        targets: particle,
        x: x + Phaser.Math.Between(-40, 40),
        y: y + Phaser.Math.Between(-40, 40),
        alpha: 0,
        rotation: Math.random() * Math.PI * 2,
        duration: 400,
        onComplete: () => particle.destroy()
      });
    }

    // Spawn drop
    if (destructible.dropType === 'weapon') {
      // Let ArenaScene handle weapon drop
      if (this.scene.spawnWeaponDrop) {
        this.scene.spawnWeaponDrop(x, y);
      }
    } else {
      // XP burst
      window.VIBE_CODER.addXP(Phaser.Math.Between(5, 15));
    }

    destructible.destroy();
  }

  /**
   * Setup all collision handlers
   * @param {Phaser.GameObjects.Sprite} player - Player sprite
   * @param {Phaser.GameObjects.Group} enemies - Enemy group
   * @param {Phaser.GameObjects.Group} projectiles - Projectile group
   */
  setupCollisions(player, enemies, projectiles) {
    // Idempotent: calling again (restart / stage transition) replaces the previous colliders.
    this.destroyColliders();
    this.collisionTargets = { player, enemies, projectiles };
    const physics = this.scene.physics;
    const track = (c) => { if (c) this.colliders.push(c); return c; };

    // Walls block everything
    track(physics.add.collider(player, this.walls));
    track(physics.add.collider(enemies, this.walls));
    track(physics.add.collider(projectiles, this.walls, (proj) => {
      proj.destroy();
    }));

    // Furniture blocks movement only
    track(physics.add.collider(player, this.furniture));
    track(physics.add.collider(enemies, this.furniture));

    // Hazards damage on overlap
    track(physics.add.overlap(player, this.hazards, (p, hazard) => {
      const damage = this.handleHazardDamage(p, hazard);
      if (damage > 0 && !this.scene.invincible) {
        p.health = Math.max(0, p.health - damage);
        this.scene.updateHUD();
      }
    }));

    track(physics.add.overlap(enemies, this.hazards, (enemy, hazard) => {
      const damage = this.handleHazardDamage(enemy, hazard);
      if (damage > 0 && enemy.health !== undefined) {
        enemy.health = Math.max(0, enemy.health - damage);
      }
    }));

    // Destructibles can be hit by projectiles
    track(physics.add.overlap(projectiles, this.destructibles, (proj, dest) => {
      this.hitDestructible(dest, proj.damage || 10);
      if (!proj.pierce) {
        proj.destroy();
      }
    }));

    // Teleporter overlap zones (per map: destroyed by clearMap)
    this.teleporters.children.each((teleporter) => {
      const zone = this.scene.add.zone(teleporter.teleporterX, teleporter.teleporterY, 50, 50);
      physics.add.existing(zone, true);
      this.teleporterZones.push(zone);
      track(physics.add.overlap(player, zone, () => {
        this.useTeleporter(player, teleporter);
      }));
    });
  }

  destroyColliders() {
    for (const c of this.colliders) {
      if (c && typeof c.destroy === 'function') c.destroy();
    }
    this.colliders = [];
  }

  stopTweens(list) {
    for (const tween of list) {
      if (tween && typeof tween.stop === 'function') tween.stop();
    }
  }

  /**
   * Clear all map elements
   */
  clearMap({ keepSpace = false } = {}) {
    // Stop all infinite tweens before destroying their targets
    for (const tween of this.activeTweens) {
      if (tween && tween.isPlaying && tween.isPlaying()) {
        tween.stop();
      }
    }
    this.activeTweens = [];

    if (this.walls) this.walls.clear(true, true);
    if (this.furniture) this.furniture.clear(true, true);
    if (this.hazards) this.hazards.clear(true, true);
    if (this.destructibles) this.destructibles.clear(true, true);
    if (this.teleporters) this.teleporters.clear(true, true);
    if (this.spawners) this.spawners.clear(true, true);
    this.teleporterPairs = [];
    // Overlap colliders on per-map teleporter zones die with their zones
    this.colliders = this.colliders.filter((c) => {
      const dead = c && this.teleporterZones.includes(c.object2);
      if (dead && typeof c.destroy === 'function') c.destroy();
      return !dead;
    });
    this.teleporterZones.forEach((z) => z && z.destroy && z.destroy());
    this.teleporterZones = [];
    this.decor.forEach((d) => d && d.destroy && d.destroy());
    this.decor = [];
    this.destroyBackground({ keepSpace });
    for (const v of this.mechanicVisuals) {
      if (v && v.destroy) v.destroy();
    }
    this.mechanicVisuals = [];
    this.mechanicZones = [];
    this.zoneVisuals = [];
    this.globalIndicator = null;
    this.zoneInside = null;
    const player = this.scene && this.scene.player;
    if (player) this.setZoneTint(player, null);
    this.zoneTint = null;
  }

  /**
   * Update loop (optional; parallax already runs on the scene 'postupdate' event)
   */
  update(time, delta) {
    if (!this.teleporters) return;
    // Update teleporter ready states
    this.teleporters.children.each((teleporter) => {
      const isReady = time - teleporter.lastUsedTime >= teleporter.cooldown;
      if (teleporter.isReady !== isReady) {
        teleporter.isReady = isReady;
        // Visual feedback for cooldown state could go here
      }
    });
  }
}
