/**
 * Biome definitions per stage index (pure data). Each biome owns its hazards, obstacles and one mechanic.
 * Mechanic logic: systems/MapManager.js -> biomeEffect().
 */
export const BIOME_MECHANICS = ['boostZone', 'slowZone', 'teleport', 'pulseDamage', 'wind', 'gravity'];

/** Hazard visuals/tuning. damageMult scales biome.hazardDamage. */
export const HAZARD_DEFS = {
  bugSwarm: { color: 0x66ff00, radiusMin: 40, radiusMax: 70, damageMult: 1 },
  nullDeref: { color: 0xffffff, radiusMin: 30, radiusMax: 50, damageMult: 1.4 },
  memoryLeak: { color: 0xaa00ff, radiusMin: 50, radiusMax: 90, damageMult: 0.9 },
  heapFragment: { color: 0xff66ff, radiusMin: 30, radiusMax: 55, damageMult: 1.2 },
  packetStorm: { color: 0x00ff66, radiusMin: 50, radiusMax: 80, damageMult: 1 },
  packetLoss: { color: 0x338833, radiusMin: 40, radiusMax: 60, damageMult: 1.1 },
  kernelPanic: { color: 0xff0000, radiusMin: 45, radiusMax: 80, damageMult: 1.2 },
  thermal: { color: 0xff8800, radiusMin: 60, radiusMax: 100, damageMult: 0.8 },
  latencySpike: { color: 0x4488ff, radiusMin: 40, radiusMax: 75, damageMult: 1 },
  coldStart: { color: 0xaaddff, radiusMin: 50, radiusMax: 90, damageMult: 0.8 },
  blackHole: { color: 0x220044, radiusMin: 50, radiusMax: 80, damageMult: 1.3 },
  entropyField: { color: 0xffd700, radiusMin: 60, radiusMax: 100, damageMult: 0.9 }
};

/** Obstacle (furniture) visuals. */
export const OBSTACLE_DEFS = {
  codeBlock: { color: 0x004455, sizeMin: 30, sizeMax: 50, shape: 'rect' },
  terminal: { color: 0x222222, sizeMin: 34, sizeMax: 46, shape: 'rect' },
  serverRack: { color: 0x2a0044, sizeMin: 36, sizeMax: 56, shape: 'rect' },
  memoryStick: { color: 0x440066, sizeMin: 24, sizeMax: 40, shape: 'rect' },
  routerBox: { color: 0x003311, sizeMin: 30, sizeMax: 46, shape: 'rect' },
  cableBundle: { color: 0x115522, sizeMin: 24, sizeMax: 40, shape: 'circle' },
  cpuCore: { color: 0x441100, sizeMin: 36, sizeMax: 54, shape: 'rect' },
  registerBlock: { color: 0x552200, sizeMin: 26, sizeMax: 40, shape: 'rect' },
  cloudServer: { color: 0x223366, sizeMin: 34, sizeMax: 54, shape: 'circle' },
  apiPortal: { color: 0x334488, sizeMin: 28, sizeMax: 42, shape: 'rect' },
  voidFragment: { color: 0x111122, sizeMin: 30, sizeMax: 50, shape: 'circle' },
  eventHorizon: { color: 0x332200, sizeMin: 36, sizeMax: 56, shape: 'circle' }
};

/**
 * Pixel sizes of generated map art (scripts/assets/gen-biomes.mjs writes them, biomeAssets.js loads them).
 * Sheets are horizontal strips of `*Frames` frames.
 */
export const MAP_ART = Object.freeze({
  bgSize: 512,
  obstacleSize: 48,
  hazardSize: 48,
  hazardFrames: 4,
  zoneSize: 64,
  zoneFrames: 4,
  borderSize: 32,
  crateSize: 32
});

/**
 * Parallax scroll factors of the animated space background (src/systems/spaceBackground.js).
 * back = nebula, stars = twinkling star field, near = alpha wisps + motes. `far` is the legacy alias of back.
 */
export const PARALLAX = Object.freeze({ far: 0.15, back: 0.15, stars: 0.4, near: 0.7, props: 0.25 });

/**
 * Animated space background (the title-screen look, one palette per stage).
 * Art: scripts/assets/gen-space-bg.mjs -> public/assets/backgrounds/space/<variant>/*.png (512x512 tiles).
 * tileScale = screen px per texel; drift = autonomous scroll in screen px/s (keeps it alive when the player stands still);
 * back.dim = tint multiplier so the arena nebula stays behind gameplay (the title preset is not dimmed).
 */
export const SPACE_BG = Object.freeze({
  tileSize: 512,
  propSize: 64,
  layers: Object.freeze({
    back: Object.freeze({ parallax: PARALLAX.back, tileScale: 3, drift: [2, 1], alpha: 1, dim: 0.82 }),
    stars: Object.freeze({ parallax: PARALLAX.stars, tileScale: 2, drift: [3, 1.5], alpha: 0.9 }),
    near: Object.freeze({ parallax: PARALLAX.near, tileScale: 3, drift: [5, 2.5], alpha: 0.45 })
  }),
  /** Per-variant overrides merged over `layers` (brighter palettes are dimmed further for legibility). */
  variantLayers: Object.freeze({
    'kernel-space': Object.freeze({ back: Object.freeze({ dim: 0.7 }), near: Object.freeze({ alpha: 0.35 }) }),
    'network-layer': Object.freeze({ back: Object.freeze({ dim: 0.7 }), near: Object.freeze({ alpha: 0.35 }) })
  }),
  twinkleMs: 520,
  maxMotes: 40,
  maxProps: 6,
  fadeSteps: 4,
  fadeMs: 600
});

/**
 * Pixel palettes of the space background per variant (hex, dark -> light). Consumed by the generator only.
 * base: nebula ramp; accent: second hue patches; stars; near: wisps; mote: particle tint.
 */
export const SPACE_PALETTES = Object.freeze({
  'debug-zone': { base: ['000418', '080c41', '082862', '10508b', '1079a4', '2095bd'], accent: ['290e4d', '492277', '7537ac'], stars: ['cdd6de', '2095bd', '1079a4'], near: ['1079a4', '2095bd', '5fc8e0'], mote: '8fe3ff', props: ['planet', 'asteroid', 'ring'] },
  'memory-banks': { base: ['07020f', '1a0730', '2e0d52', '4a1475', '6f1f9a', '9a3fc0'], accent: ['3a0838', '6e1460', 'b02a8a'], stars: ['f0d8ff', 'd070ff', '9a3fc0'], near: ['8a1f7a', 'c040a8', 'f08ad8'], mote: 'ff9af0', props: ['planet', 'asteroid', 'ring'] },
  'network-layer': { base: ['00030f', '001338', '00266e', '003fa8', '0a66d6', '20a8f0'], accent: ['00353f', '00666e', '10a8a8'], stars: ['d8f6ff', '40e0ff', '20a8f0'], near: ['1880d0', '40c8f8', 'b0f4ff'], mote: '60f0ff', props: ['planet', 'asteroid', 'ring'] },
  'kernel-space': { base: ['0a0203', '240608', '420b0c', '681510', '8f2a12', 'b84a14'], accent: ['2e1404', '5c2a06', 'a05a0a'], stars: ['ffe2c0', 'ffb050', 'e06030'], near: ['a03a10', 'e07a20', 'ffb040'], mote: 'ffb060', props: ['planet', 'asteroid', 'ring'] },
  'cloud-cluster': { base: ['060a1a', '121a3a', '1e2d5e', '34508a', '5a7fb8', '8ab0dc'], accent: ['2a2350', '4c3f80', '8676c0'], stars: ['ffffff', 'c8dcff', 'b0a0e8'], near: ['6a8cc8', 'a8c8ec', 'd8ccf8'], mote: 'd8e8ff', props: ['planet', 'asteroid', 'ring'] },
  singularity: { base: ['000000', '07020c', '120621', '1f0b38', '331257', '4e1d7d'], accent: ['2a0626', '4d0b45', '80207a'], stars: ['ffffff', 'e0c8ff', 'ffd700'], near: ['4e1d7d', '8040c0', 'ffd76a'], mote: 'ffd76a', props: ['vortex', 'asteroid', 'ring'] }
});

/**
 * Layout rules for layoutBiome(): spawn clearance and per-stage density growth.
 * counts are at density 1; actual = round(count * biome.density * (1 + stage * stageGrowth)).
 */
export const LAYOUT_RULES = Object.freeze({
  spawnClearance: 200,
  edgeMargin: 96,
  gap: 24,
  stageGrowth: 0.15,
  counts: { walls: 8, furniture: 14, hazards: 6, crates: 15 }
});

export const BIOMES = {
  0: {
    id: 'debug-zone', bgVariant: 'debug-zone', name: 'DEBUG ZONE', wallTint: 0x00ffff, hazardDamage: 8,
    obstacles: ['codeBlock', 'terminal'], hazardTypes: ['bugSwarm', 'nullDeref'],
    interactives: ['crate', 'monitor'], density: 0.3,
    mechanic: { type: 'boostZone', speedMult: 1.25, zoneCount: 3, zoneRadius: 90, color: 0x00ffff }
  },
  1: {
    id: 'memory-banks', bgVariant: 'memory-banks', name: 'MEMORY BANKS', wallTint: 0xaa00ff, hazardDamage: 12,
    obstacles: ['serverRack', 'memoryStick'], hazardTypes: ['memoryLeak', 'heapFragment'],
    interactives: ['crate', 'dataCore'], density: 0.4,
    mechanic: { type: 'slowZone', speedMult: 0.55, zoneCount: 5, zoneRadius: 120, color: 0x8800cc }
  },
  2: {
    id: 'network-layer', bgVariant: 'network-layer', name: 'NETWORK LAYER', wallTint: 0x00ff00, hazardDamage: 15,
    obstacles: ['routerBox', 'cableBundle'], hazardTypes: ['packetStorm', 'packetLoss'],
    interactives: ['crate', 'signalBoost'], density: 0.35,
    mechanic: { type: 'teleport', cooldownMs: 2500, zoneCount: 4, zoneRadius: 40, color: 0x00ff88 }
  },
  3: {
    id: 'kernel-space', bgVariant: 'kernel-space', name: 'KERNEL SPACE', wallTint: 0xff4400, hazardDamage: 22,
    obstacles: ['cpuCore', 'registerBlock'], hazardTypes: ['kernelPanic', 'thermal'],
    interactives: ['crate', 'processNode'], density: 0.45,
    mechanic: { type: 'pulseDamage', dps: 12, periodMs: 3000, activeMs: 1000, zoneCount: 4, zoneRadius: 110, color: 0xff2200 }
  },
  4: {
    id: 'cloud-cluster', bgVariant: 'cloud-cluster', name: 'CLOUD CLUSTER', wallTint: 0x4488ff, hazardDamage: 18,
    obstacles: ['cloudServer', 'apiPortal'], hazardTypes: ['latencySpike', 'coldStart'],
    interactives: ['crate', 'containerPod'], density: 0.4,
    mechanic: { type: 'wind', strength: 60, periodMs: 20000, zoneCount: 0, color: 0x88aaff }
  },
  5: {
    id: 'singularity', bgVariant: 'singularity', name: 'SINGULARITY', wallTint: 0xffd700, hazardDamage: 28,
    obstacles: ['voidFragment', 'eventHorizon'], hazardTypes: ['blackHole', 'entropyField'],
    interactives: ['crate', 'quantumCache'], density: 0.5,
    mechanic: { type: 'gravity', strength: 70, falloffDist: 1000, zoneCount: 0, color: 0xffd700 }
  }
};
