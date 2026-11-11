import { describe, it, expect } from 'vitest';
import { WEAPON_TEXTURE_KEYS, weaponAnimKey } from '../scenes/boot/weaponAssets.js';
import { WEAPONS, EVOLUTION_RECIPES } from '../data/weapons.js';

const all = [...Object.values(WEAPONS), ...Object.values(EVOLUTION_RECIPES)];

describe('weapon art wiring data', () => {
  it('every weapon texture is a loaded key', () => {
    for (const w of all) expect(WEAPON_TEXTURE_KEYS).toContain(w.texture);
  });
  it('animated skins (proj/swing/orb/aura) resolve an anim key', () => {
    for (const w of all) expect(weaponAnimKey(w.texture)).toBe(`${w.texture}-anim`);
  });
  it('weapon.aura keys are loaded', () => {
    for (const w of all.filter((x) => x.aura)) expect(WEAPON_TEXTURE_KEYS).toContain(w.aura);
  });
});
