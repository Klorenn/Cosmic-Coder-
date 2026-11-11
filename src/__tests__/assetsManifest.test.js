import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ENEMIES, MINI_BOSSES, BOSSES } from '../data/enemies.js';
import { ITEMS } from '../data/items.js';
import { ENEMY_SPRITES, ITEM_ICONS, ITEM_FX_IMAGES, PROCEDURAL_TEXTURES, XP_GEM_SPRITES, getEnemySprite } from '../scenes/boot/enemyAssets.js';
import { CHARACTER_HIT_SHEETS, CHARACTER_DIR_SHEETS } from '../scenes/boot/characterAssets.js';
import { WEAPONS, EVOLUTION_RECIPES } from '../data/weapons.js';
import { WEAPON_SHEETS, WEAPON_IMAGES, WEAPON_TEXTURE_KEYS, ALL_WEAPON_IDS, weaponTextureKey, weaponAnimKey } from '../scenes/boot/weaponAssets.js';

const SPRITES = path.resolve(__dirname, '../../public/assets/sprites');
const ASSETS = path.resolve(__dirname, '../../public/assets');

/** Width/height from the PNG IHDR chunk (no image lib needed). */
function pngSize(file) {
  const buf = fs.readFileSync(file);
  expect(buf.subarray(1, 4).toString('ascii')).toBe('PNG');
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

const fileForTexture = new Map(ENEMY_SPRITES.map((s) => [s.key, s]));
const allEnemyDefs = { ...ENEMIES, ...MINI_BOSSES, ...BOSSES };

describe('asset manifest', () => {
  it.each(Object.entries(allEnemyDefs))('%s texture is a v2 sheet or a declared procedural texture', (id, def) => {
    const texture = def.texture || id;
    const sprite = fileForTexture.get(texture);
    if (!sprite) {
      expect(PROCEDURAL_TEXTURES).toContain(texture);
      return;
    }
    expect(sprite.id).toBe(id);
    expect(def.anim).toBe(sprite.anim);
    expect(def.frameWidth).toBe(sprite.frameWidth);
    expect(def.frameHeight).toBe(sprite.frameHeight);
  });

  it.each(ENEMY_SPRITES.map((s) => [s.key, s]))('%s PNG exists with manifest dimensions', (_key, s) => {
    const file = path.join(SPRITES, s.file);
    expect(fs.existsSync(file)).toBe(true);
    expect(pngSize(file)).toEqual({ width: s.frameWidth * s.frames, height: s.frameHeight });
    expect(allEnemyDefs[s.id]).toBeDefined();
    expect(getEnemySprite(s.id)).toBe(s);
  });

  it('every item has a 32x32 pixel-art icon under item-<id>', () => {
    expect(ITEM_ICONS.map((i) => i.id).sort()).toEqual(Object.keys(ITEMS).sort());
    for (const icon of ITEM_ICONS) {
      expect(icon.key).toBe(`item-${icon.id}`);
      const file = path.join(SPRITES, icon.file);
      expect(fs.existsSync(file)).toBe(true);
      expect(pngSize(file)).toEqual({ width: 32, height: 32 });
      expect(icon.frameWidth).toBe(32);
    }
  });

  it.each(XP_GEM_SPRITES.map((s) => [s.key, s]))('%s XP gem strip exists (2 frames, square)', (_key, s) => {
    const file = path.join(SPRITES, s.file);
    expect(fs.existsSync(file)).toBe(true);
    expect(pngSize(file)).toEqual({ width: s.frameWidth * s.frames, height: s.frameHeight });
    expect(s.frameWidth).toBe(s.frameHeight);
  });

  it('glow and shrine art PNGs exist', () => {
    for (const fx of ITEM_FX_IMAGES) expect(fs.existsSync(path.join(SPRITES, fx.file)), fx.file).toBe(true);
  });

  it.each(CHARACTER_HIT_SHEETS.map((s) => [s.key, s]))('%s hit-flash sheet matches its source layout', (_key, s) => {
    const file = path.join(SPRITES, s.file);
    expect(fs.existsSync(file)).toBe(true);
    expect(pngSize(file)).toEqual({ width: s.frameSize * s.frames, height: s.frameSize });
    for (const part of s.compose) expect(fs.existsSync(path.join(SPRITES, part.file))).toBe(true);
  });

  it.each(CHARACTER_DIR_SHEETS.map((s) => [s.key, s]))('%s front/back walk sheet exists with a hit-flash twin', (_key, s) => {
    const file = path.join(SPRITES, s.file);
    expect(fs.existsSync(file)).toBe(true);
    expect(pngSize(file)).toEqual({ width: s.frameSize * s.frames, height: s.frameSize });
    expect(s.frames).toBeGreaterThanOrEqual(6);
    expect(s.frames).toBeLessThanOrEqual(8);
    expect(['down', 'up']).toContain(s.dir);
    const hit = CHARACTER_HIT_SHEETS.find((h) => h.texKey === s.key);
    expect(hit, `${s.key}-hit-v2`).toBeDefined();
    expect(hit.frames).toBe(s.frames);
  });

  it('every character has both a walk-down and a walk-up sheet', () => {
    for (const prefix of ['player', 'player-destroyer', 'player-swordsman']) {
      const dirs = CHARACTER_DIR_SHEETS.filter((s) => s.prefix === prefix).map((s) => s.dir).sort();
      expect(dirs, prefix).toEqual(['down', 'up']);
    }
  });

  it('texture and anim keys are unique', () => {
    const keys = [...ENEMY_SPRITES.map((s) => s.key), ...ENEMY_SPRITES.map((s) => s.anim), ...XP_GEM_SPRITES.map((s) => s.key), ...XP_GEM_SPRITES.map((s) => s.anim), ...ITEM_ICONS.map((i) => i.key), ...ITEM_FX_IMAGES.map((i) => i.key), ...CHARACTER_HIT_SHEETS.map((s) => s.key), ...CHARACTER_DIR_SHEETS.map((s) => s.key)];
    expect(new Set(keys).size).toBe(keys.length);
  });

  describe('weapons v2 art', () => {
    const allWeapons = { ...WEAPONS, ...Object.fromEntries(Object.values(EVOLUTION_RECIPES).map((r) => [r.result, r])) };

    it('manifest covers every base + evolved weapon id', () => {
      expect([...ALL_WEAPON_IDS].sort()).toEqual(Object.keys(allWeapons).sort());
    });

    it.each(WEAPON_SHEETS.map((s) => [s.key, s]))('%s strip exists with manifest dimensions', (_key, s) => {
      const file = path.join(ASSETS, s.file);
      expect(fs.existsSync(file)).toBe(true);
      expect(pngSize(file)).toEqual({ width: s.frameWidth * s.frames, height: s.frameHeight });
      expect(weaponAnimKey(s.key)).toBe(s.anim);
    });

    it.each(WEAPON_IMAGES.map((i) => [i.key, i]))('%s image exists with manifest dimensions', (_key, i) => {
      const file = path.join(ASSETS, i.file);
      expect(fs.existsSync(file)).toBe(true);
      expect(pngSize(file)).toEqual({ width: i.width, height: i.height });
    });

    it('keeps the keys ArenaScene / TitleScene already read', () => {
      const keys = new Set(WEAPON_TEXTURE_KEYS);
      ['slash', 'weapon-laser', 'weapon-plasma', 'weapon-chain', 'legendary-huntersWarglaive', 'legendary-voidReaper', 'legendary-celestialBlade']
        .forEach((k) => expect(keys.has(k), k).toBe(true));
      ALL_WEAPON_IDS.forEach((id) => expect(keys.has(`weapon-${id}`), id).toBe(true));
      ['sword', 'spear', 'boomerang', 'kunai'].forEach((id) => expect(keys.has(`melee-${id}`), id).toBe(true));
    });

    it.each(Object.entries(allWeapons))('%s visual fields point at real textures', (id, w) => {
      const keys = new Set(WEAPON_TEXTURE_KEYS);
      expect(keys.has(w.texture), w.texture).toBe(true);
      expect(w.icon).toBe(`weapon-icon-${id}`);
      expect(keys.has(w.icon)).toBe(true);
      if (w.aura) expect(keys.has(w.aura)).toBe(true);
      expect(weaponTextureKey(id)).not.toBe('');
    });

    it('weapon texture keys are unique', () => {
      expect(new Set(WEAPON_TEXTURE_KEYS).size).toBe(WEAPON_TEXTURE_KEYS.length);
      const anims = WEAPON_SHEETS.map((s) => s.anim);
      expect(new Set(anims).size).toBe(anims.length);
    });
  });
});
