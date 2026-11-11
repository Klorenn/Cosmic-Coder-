/**
 * Weapon / projectile / melee / legendary art (weapons v2 — pixel art: hard pixels, 1px dark outline,
 * 1-2 pixel glow rings, 2-4 frame silhouette animation; NEAREST filtering).
 *
 * Single source of truth for the PNGs in public/assets/sprites/weapons, written by
 * scripts/assets/gen-weapons.mjs (pixel grids, nearest-upscaled x2; icons x3; legendaries x1).
 * The generator asserts every drawing matches the sizes declared here; the manifest test
 * checks the files exist with these dimensions.
 *
 * Keys ArenaScene / TitleScene already read (kept, art replaced):
 *   slash                      40x40  every projectile + melee swing today (white, tinted at runtime)
 *   weapon-<id>                40x40  world drop crystal (also the WEAPONS menu icon)
 *   melee-<id>                 40x40  melee world drop / melee menu icon
 *   weapon-laser|plasma|chain  aliases of the evolved drops (TitleScene TEX map)
 *   legendary-<key>            orbiting legendary sprite (huntersWarglaive = original pixel PNG)
 * New keys (ready for wiring; see docs/ASSETS.md):
 *   proj-<id>    4-frame strip, pre-coloured projectile pointing +x  (anim proj-<id>-anim)
 *   swing-<id>   3-frame melee swing (anim swing-<id>-anim, plays once)
 *   orb-<id>     4-frame orbital orb (anim orb-<id>-anim)
 *   aura-<id>    4-frame aura / AoE ring (anim aura-<id>-anim)
 *   beam-<id>    horizontally tileable beam segment 128x32
 *   weapon-icon-<id>  96x96 menu/HUD icon
 *
 * Pure module: no Phaser import — every function receives the scene.
 */
import { getAssetPath } from '../../utils/assetBase.js';

const DIR = 'sprites/weapons';

/** Weapon ids that exist in src/data/weapons.js (base + evolutions). */
export const BASE_WEAPON_IDS = ['basic', 'spread', 'pierce', 'orbital', 'rapid', 'homing', 'bounce', 'aoe', 'freeze',
  'rmrf', 'sudo', 'forkbomb', 'sword', 'spear', 'boomerang', 'kunai'];
export const EVOLVED_WEAPON_IDS = ['laserbeam', 'plasmaorb', 'chainlightning', 'bullethell', 'ringoffire', 'seekingmissile',
  'chaosbounce', 'deathaura', 'icelance', 'swarm', 'blizzard', 'excalibur', 'gungnir', 'ricochetblade', 'shurikenstorm', 'frostbrand'];
export const ALL_WEAPON_IDS = [...BASE_WEAPON_IDS, ...EVOLVED_WEAPON_IDS];
export const MELEE_WEAPON_IDS = ['sword', 'spear', 'boomerang', 'kunai', 'excalibur', 'gungnir', 'ricochetblade', 'shurikenstorm', 'frostbrand'];

/** Projectile strips: id -> [frameWidth, frameHeight]. All point to +x (rotation = travel angle). */
const PROJ_SIZE = {
  basic: [48, 48], spread: [48, 48], pierce: [48, 48], rapid: [48, 48], homing: [48, 48], bounce: [48, 48],
  freeze: [48, 48], rmrf: [48, 48], sudo: [48, 48], forkbomb: [48, 48], boomerang: [48, 48], kunai: [48, 48],
  laserbeam: [96, 32], chainlightning: [64, 32], bullethell: [48, 48], seekingmissile: [64, 32], chaosbounce: [48, 48],
  icelance: [72, 24], swarm: [32, 32], gungnir: [80, 24], ricochetblade: [48, 48], shurikenstorm: [48, 48], frostbrand: [48, 48]
};
const SWING_SIZE = { sword: [80, 80], spear: [96, 32], excalibur: [112, 112] };
const ORB_SIZE = { orbital: 32, plasmaorb: 48, ringoffire: 40, deathaura: 40 };
const AURA_SIZE = { aoe: 256, blizzard: 256, ringoffire: 176, deathaura: 256 };
const BEAM_IDS = ['laserbeam', 'chainlightning'];

const PROJ_FRAMES = 4;
const SWING_FRAMES = 3;
const ORB_FRAMES = 4;
const AURA_FRAMES = 4;
export const DROP_SIZE = 40;
export const ICON_SIZE = 96;

const strip = (kind, id, [w, h], frames, frameRate, repeat = -1) => ({
  id, kind, key: `${kind}-${id}`, anim: `${kind}-${id}-anim`, file: `${DIR}/${kind}-${id}.png`,
  frameWidth: w, frameHeight: h, frames, frameRate, repeat
});

/** Animated spritesheets. */
export const WEAPON_SHEETS = [
  ...Object.entries(PROJ_SIZE).map(([id, s]) => strip('proj', id, s, PROJ_FRAMES, 14)),
  ...Object.entries(SWING_SIZE).map(([id, s]) => strip('swing', id, s, SWING_FRAMES, 14, 0)),
  ...Object.entries(ORB_SIZE).map(([id, s]) => strip('orb', id, [s, s], ORB_FRAMES, 10)),
  ...Object.entries(AURA_SIZE).map(([id, s]) => strip('aura', id, [s, s], AURA_FRAMES, 8))
];

/** Drop crystal file per weapon id; registered under weapon-<id> (+ melee-<id> for melee). */
const dropFile = (id) => `${DIR}/drop-${id}.png`;
const DROP_ALIASES = { laserbeam: 'weapon-laser', plasmaorb: 'weapon-plasma', chainlightning: 'weapon-chain' };

/** Single images: `file` may be shared by several keys (aliases). */
export const WEAPON_IMAGES = [
  { key: 'slash', id: 'slash', kind: 'slash', file: `${DIR}/slash.png`, width: 40, height: 40 },
  ...ALL_WEAPON_IDS.map((id) => ({ key: `weapon-${id}`, id, kind: 'drop', file: dropFile(id), width: DROP_SIZE, height: DROP_SIZE })),
  ...MELEE_WEAPON_IDS.map((id) => ({ key: `melee-${id}`, id, kind: 'drop', file: dropFile(id), width: DROP_SIZE, height: DROP_SIZE })),
  ...Object.entries(DROP_ALIASES).map(([id, key]) => ({ key, id, kind: 'drop', file: dropFile(id), width: DROP_SIZE, height: DROP_SIZE })),
  ...ALL_WEAPON_IDS.map((id) => ({ key: `weapon-icon-${id}`, id, kind: 'icon', file: `${DIR}/icon-${id}.png`, width: ICON_SIZE, height: ICON_SIZE })),
  ...BEAM_IDS.map((id) => ({ key: `beam-${id}`, id, kind: 'beam', file: `${DIR}/beam-${id}.png`, width: 128, height: 32 })),
  { key: 'legendary-voidReaper', id: 'voidReaper', kind: 'legendary', file: `${DIR}/legendary-voidReaper.png`, width: 56, height: 56 },
  { key: 'legendary-celestialBlade', id: 'celestialBlade', kind: 'legendary', file: `${DIR}/legendary-celestialBlade.png`, width: 48, height: 48 },
  // Hand-made pixel art (not generated).
  { key: 'legendary-huntersWarglaive', id: 'huntersWarglaive', kind: 'legendary', file: 'hunters-warglaive.png', width: 32, height: 32, pixel: true, handmade: true }
];

/** Every texture key this module owns. */
export const WEAPON_TEXTURE_KEYS = [...WEAPON_SHEETS.map((s) => s.key), ...WEAPON_IMAGES.map((i) => i.key)];

const SHEET_BY_KEY = new Map(WEAPON_SHEETS.map((s) => [s.key, s]));

/** Animation key for a weapon texture, or null when the texture is a single image. */
export function weaponAnimKey(textureKey) {
  return SHEET_BY_KEY.get(textureKey)?.anim || null;
}

/**
 * Best in-world texture for a weapon id: projectile strip, melee swing or orb; falls back to `slash`.
 * @param {string} id weapon id (base or evolved)
 * @param {'proj'|'swing'|'orb'|'aura'} [kind]
 */
export function weaponTextureKey(id, kind) {
  const kinds = kind ? [kind] : ['proj', 'swing', 'orb'];
  for (const k of kinds) if (SHEET_BY_KEY.has(`${k}-${id}`)) return `${k}-${id}`;
  return 'slash';
}

/** Queue every weapon PNG. Must run in preload(); BootScene's generators skip keys that already exist. */
export function preloadWeaponAssets(scene) {
  for (const s of WEAPON_SHEETS) {
    if (scene.textures.exists(s.key)) continue;
    scene.load.spritesheet(s.key, getAssetPath(`assets/${s.file}`), { frameWidth: s.frameWidth, frameHeight: s.frameHeight });
  }
  for (const i of WEAPON_IMAGES) {
    if (scene.textures.exists(i.key)) continue;
    scene.load.image(i.key, getAssetPath(`assets/${i.file}`));
  }
}

/**
 * Register weapon anims. Weapon art is hard-pixel (pixel art authored at 1/2 or 1/3 size and
 * nearest-upscaled), so textures keep the global NEAREST filter (pixelArt: true) — no setFilter here.
 */
export function createWeaponAnims(scene) {
  for (const s of WEAPON_SHEETS) {
    if (!scene.textures.exists(s.key) || scene.anims.exists(s.anim)) continue;
    scene.anims.create({
      key: s.anim,
      frames: scene.anims.generateFrameNumbers(s.key, { start: 0, end: s.frames - 1 }),
      frameRate: s.frameRate,
      repeat: s.repeat
    });
  }
}
