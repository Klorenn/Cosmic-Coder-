/**
 * Weapon + evolution definitions (pure data, no Phaser).
 * Base weapon ids are referenced by TitleScene/main.js/contracts — do NOT rename them.
 *
 * Fields: attackRate (x multiplier over player attackRate; 0 = passive), damage (x attackDamage),
 * projectiles, pierce, color, optional special ('homing'|'bounce'|'aoe'|'aura'|'freeze'|'freezeAoe'|...),
 * melee weapons: melee, meleeType, range.
 * Visual-only fields (weapons v2 art, see src/scenes/boot/weaponAssets.js + docs/ASSETS.md): color (palette tint),
 * texture (in-world key: proj-/swing-/orb-/aura-<id>), icon (weapon-icon-<id>), aura (ring texture for orbital evolutions).
 */
export const WEAPONS = {
  basic: { attackRate: 0.6, damage: 1, projectiles: 1, pierce: false, color: 0x22d3ee, texture: 'proj-basic', icon: 'weapon-icon-basic', power: { desc: 'Reliable bolt, +10% crit', critBonus: 0.1 } },
  spread: { attackRate: 0.68, damage: 0.36, projectiles: 5, pierce: false, color: 0xe879f9, texture: 'proj-spread', icon: 'weapon-icon-spread', power: { desc: '5-pellet short-range fan', pattern: 'fan', fanStepDeg: 14, rangePx: 190 } },
  pierce: { attackRate: 0.75, damage: 0.36, projectiles: 1, pierce: true, color: 0x38bdf8, texture: 'proj-pierce', icon: 'weapon-icon-pierce', power: { desc: 'Passes through 4 enemies, +15% damage per enemy pierced', pierceCount: 4, pierceRamp: 0.15 } },
  orbital: { attackRate: 0, damage: 0.4, projectiles: 0, pierce: true, color: 0x8b5cf6, texture: 'orb-orbital', icon: 'weapon-icon-orbital', power: { desc: '3 orbs circle you, continuous damage + light knockback', orbit: { count: 3, hitCooldownMs: 250 }, knockback: 15 } },
  rapid: { attackRate: 1.4, damage: 0.39, projectiles: 1, pierce: false, color: 0xf59e0b, texture: 'proj-rapid', icon: 'weapon-icon-rapid', power: { desc: 'High fire rate; 20% chance to mark (+20% damage taken, 3 s)', mark: { chance: 0.2, mult: 0.2, ms: 3000 } } },
  homing: { attackRate: 0.7, damage: 0.84, projectiles: 1, pierce: false, color: 0xfb923c, special: 'homing', texture: 'proj-homing', icon: 'weapon-icon-homing', power: { desc: 'Seeks targets, prioritises elites and bosses', homing: true, preferElite: true } },
  bounce: { attackRate: 0.59, damage: 0.36, projectiles: 1, pierce: false, color: 0x34d399, special: 'bounce', bounces: 3, texture: 'proj-bounce', icon: 'weapon-icon-bounce', power: { desc: 'Ricochets between 4 enemies, +10% per bounce', bounces: 4, bounceRamp: 0.1 } },
  aoe: { attackRate: 0.5, damage: 0.51, projectiles: 0, pierce: true, color: 0xf472b6, special: 'aoe', radius: 100, texture: 'aura-aoe', icon: 'weapon-icon-aoe', power: { desc: 'Blast centred on the nearest enemy', pattern: 'pulse', targeted: true } },
  freeze: { attackRate: 0.8, damage: 0.92, projectiles: 1, pierce: false, color: 0xa5f3fc, special: 'freeze', slowDuration: 2000, texture: 'proj-freeze', icon: 'weapon-icon-freeze', power: { desc: 'Slows 50% for 2 s; 3 stacks freeze for 1 s', slow: { pct: 0.5, ms: 2000, stacksToFreeze: 3, freezeMs: 1000 } } },
  // Rare weapons - special effects
  rmrf: { attackRate: 0.4, damage: 1.28, projectiles: 1, pierce: false, color: 0xf43f5e, special: 'clearAll', texture: 'proj-rmrf', icon: 'weapon-icon-rmrf', power: { desc: 'Executes enemies under 20% HP (bosses under 8%)', execute: { threshold: 0.2, bossThreshold: 0.08 }, pierceCount: 2 } },
  sudo: { attackRate: 0.3, damage: 1.21, projectiles: 1, pierce: false, color: 0xfcd34d, special: 'godMode', texture: 'proj-sudo', icon: 'weapon-icon-sudo', power: { desc: 'Guaranteed crits x2.5 at half fire rate', alwaysCrit: true, critMult: 2.5 } },
  forkbomb: { attackRate: 0.63, damage: 0.36, projectiles: 3, pierce: false, color: 0xa78bfa, special: 'fork', texture: 'proj-forkbomb', icon: 'weapon-icon-forkbomb', power: { desc: 'Splits into 2 on hit, up to 2 generations', split: { children: 2, generations: 2, mult: 0.6 } } },
  // Melee weapons
  sword: { attackRate: 1.04, damage: 0.36, projectiles: 0, pierce: false, color: 0xfff4e6, melee: true, meleeType: 'slash', range: 100, texture: 'swing-sword', icon: 'weapon-icon-sword', power: { desc: 'Wide 160 degree slash with knockback', pattern: 'arc', arcDeg: 160, knockback: 30 } },
  spear: { attackRate: 0.74, damage: 0.36, projectiles: 0, pierce: true, color: 0x2dd4bf, melee: true, meleeType: 'thrust', range: 130, pierces: 3, texture: 'swing-spear', icon: 'weapon-icon-spear', power: { desc: 'Long thrust that skewers a line of enemies', pattern: 'thrust', pierceCount: 5, knockback: 50 } },
  boomerang: { attackRate: 0.59, damage: 0.36, projectiles: 1, pierce: false, color: 0xfbbf24, melee: true, meleeType: 'return', range: 150, texture: 'proj-boomerang', icon: 'weapon-icon-boomerang', power: { desc: 'Flies out and returns, hitting everything twice', returns: true, pierceCount: 3 } },
  kunai: { attackRate: 0.66, damage: 0.36, projectiles: 3, pierce: false, color: 0xc084fc, melee: true, meleeType: 'throw', range: 120, texture: 'proj-kunai', icon: 'weapon-icon-kunai', power: { desc: '3 fast kunai that bleed for 3 s', bleed: { mult: 0.4, ms: 3000 }, speed: 560 } }
};

/**
 * Evolution recipes: key 'a+b' (both base weapon ids). Triggered when the player holds
 * both and picks up one of them. `result` must never collide with a base id.
 */
export const EVOLUTION_RECIPES = {
  'spread+pierce': { result: 'laserbeam', name: 'LASER BEAM', attackRate: 4.12, damage: 0.12, projectiles: 1, pierce: true, color: 0xff3ec8, texture: 'proj-laserbeam', icon: 'weapon-icon-laserbeam', power: { desc: 'Continuous beam through everything, ticks every 100 ms', pattern: 'beam', beamLength: 420 } },
  'orbital+rapid': { result: 'plasmaorb', name: 'PLASMA ORB', attackRate: 0, damage: 0.5, projectiles: 0, pierce: true, color: 0x67e8f9, orbitalCount: 4, texture: 'orb-plasmaorb', icon: 'weapon-icon-plasmaorb', power: { desc: 'Orbs detonate in an AoE burst every 2 s', orbit: { count: 4, hitCooldownMs: 250 }, pulse: { everyMs: 2000, radius: 70, mult: 1.5, fromOrbs: true } } },
  'pierce+rapid': { result: 'chainlightning', name: 'CHAIN LIGHTNING', attackRate: 2.06, damage: 0.3, projectiles: 1, pierce: false, color: 0x7dd3fc, chains: 3, texture: 'proj-chainlightning', icon: 'weapon-icon-chainlightning', power: { desc: 'Arcs to 5 more enemies, -15% per jump', chain: { jumps: 5, falloff: 0.15, range: 180 } } },
  'spread+rapid': { result: 'bullethell', name: 'BULLET HELL', attackRate: 1.23, damage: 0.3, projectiles: 8, pierce: false, color: 0xff8a3d, texture: 'proj-bullethell', icon: 'weapon-icon-bullethell', power: { desc: '8-shot rotating spiral', pattern: 'spiral', spiralStep: 0.35 } },
  'orbital+spread': { result: 'ringoffire', name: 'RING OF FIRE', attackRate: 0, damage: 0.29, projectiles: 0, pierce: true, color: 0xf97316, orbitalCount: 8, texture: 'orb-ringoffire', icon: 'weapon-icon-ringoffire', aura: 'aura-ringoffire', power: { desc: 'Ring of 8 flames that burn for 4 s', orbit: { count: 8, hitCooldownMs: 300 }, burn: { mult: 0.5, ms: 4000 } } },
  'homing+pierce': { result: 'seekingmissile', name: 'SEEKING MISSILE', attackRate: 0.5, damage: 0.97, projectiles: 1, pierce: false, color: 0xff5a6e, special: 'homing', texture: 'proj-seekingmissile', icon: 'weapon-icon-seekingmissile', power: { desc: 'Homing missile that explodes on impact', homing: true, preferElite: true, explode: { radius: 80, mult: 0.7 } } },
  'bounce+spread': { result: 'chaosbounce', name: 'CHAOS BOUNCE', attackRate: 0.33, damage: 0.3, projectiles: 3, pierce: false, color: 0xa3e635, special: 'bounce', bounces: 5, texture: 'proj-chaosbounce', icon: 'weapon-icon-chaosbounce', power: { desc: 'Bounces up to 10 times over 4 s', bounces: 10, bounceRamp: 0.05, bounceMs: 4000 } },
  'aoe+orbital': { result: 'deathaura', name: 'DEATH AURA', attackRate: 0, damage: 0.43, projectiles: 0, pierce: true, color: 0xd946ef, special: 'aura', radius: 150, texture: 'orb-deathaura', icon: 'weapon-icon-deathaura', aura: 'aura-deathaura', power: { desc: 'Aura that damages and slows everything near you', orbit: { count: 3, hitCooldownMs: 300 }, pulse: { everyMs: 500, radius: 150, mult: 0.5 }, slow: { pct: 0.4, ms: 800 } } },
  'freeze+pierce': { result: 'icelance', name: 'ICE LANCE', attackRate: 0.6, damage: 1.08, projectiles: 1, pierce: true, color: 0x99f6ff, special: 'freeze', slowDuration: 3000, texture: 'proj-icelance', icon: 'weapon-icon-icelance', power: { desc: 'Piercing lance; 2 stacks freeze', pierceCount: 8, pierceRamp: 0.1, slow: { pct: 0.5, ms: 3000, stacksToFreeze: 2, freezeMs: 1200 } } },
  'homing+rapid': { result: 'swarm', name: 'SWARM', attackRate: 0.93, damage: 0.3, projectiles: 6, pierce: false, color: 0x6ee7b7, special: 'homing', texture: 'proj-swarm', icon: 'weapon-icon-swarm', power: { desc: '6 mini homing darts', homing: true, preferElite: false } },
  'freeze+aoe': { result: 'blizzard', name: 'BLIZZARD', attackRate: 0.35, damage: 1.46, projectiles: 0, pierce: true, color: 0xe0f2fe, special: 'freezeAoe', radius: 120, texture: 'aura-blizzard', icon: 'weapon-icon-blizzard', power: { desc: 'Icy nova that freezes on 2 stacks', pattern: 'pulse', slow: { pct: 0.6, ms: 2500, stacksToFreeze: 2, freezeMs: 1500 } } },
  // Melee evolutions (reuse existing render paths: melee slash, bounce, homing, freeze)
  'sword+spear': { result: 'excalibur', name: 'EXCALIBUR', attackRate: 0.76, damage: 0.3, projectiles: 0, pierce: true, color: 0xfde68a, melee: true, meleeType: 'slash', range: 130, texture: 'swing-excalibur', icon: 'weapon-icon-excalibur', power: { desc: '360 degree slash plus a shockwave', pattern: 'arc', arcDeg: 360, knockback: 80, shockwave: { radius: 170, mult: 0.5 } } },
  'spear+pierce': { result: 'gungnir', name: 'GUNGNIR', attackRate: 0.7, damage: 0.49, projectiles: 1, pierce: true, color: 0xf59e0b, melee: true, meleeType: 'thrust', range: 160, texture: 'proj-gungnir', icon: 'weapon-icon-gungnir', power: { desc: 'Spear that pierces everything and returns', returns: true, pierceCount: 99, pierceRamp: 0.05, speed: 520 } },
  'boomerang+bounce': { result: 'ricochetblade', name: 'RICOCHET BLADE', attackRate: 0.68, damage: 0.3, projectiles: 2, pierce: false, color: 0xfacc15, melee: true, meleeType: 'return', range: 180, special: 'bounce', bounces: 5, texture: 'proj-ricochetblade', icon: 'weapon-icon-ricochetblade', power: { desc: 'Returning blade that ricochets between enemies', returns: true, bounces: 5, bounceRamp: 0.1 } },
  'kunai+homing': { result: 'shurikenstorm', name: 'SHURIKEN STORM', attackRate: 0.9, damage: 0.3, projectiles: 6, pierce: false, color: 0x9f7aea, melee: true, meleeType: 'throw', range: 160, special: 'homing', texture: 'proj-shurikenstorm', icon: 'weapon-icon-shurikenstorm', power: { desc: '6 homing shuriken that bleed', homing: true, bleed: { mult: 0.4, ms: 3000 } } },
  'sword+freeze': { result: 'frostbrand', name: 'FROSTBRAND', attackRate: 1.2, damage: 0.58, projectiles: 0, pierce: true, color: 0xbae6fd, melee: true, meleeType: 'slash', range: 110, special: 'freeze', slowDuration: 2500, texture: 'proj-frostbrand', icon: 'weapon-icon-frostbrand', power: { desc: 'Freezing 200 degree slash', pattern: 'arc', arcDeg: 200, knockback: 40, slow: { pct: 0.5, ms: 2500, stacksToFreeze: 2, freezeMs: 1200 } } }
};

const EVOLVED_BY_RESULT = Object.fromEntries(Object.values(EVOLUTION_RECIPES).map((r) => [r.result, r]));

/** Resolve a base or evolved weapon definition; falls back to basic. */
export function getWeaponDef(type) {
  return WEAPONS[type] || EVOLVED_BY_RESULT[type] || WEAPONS.basic;
}

/**
 * Find the evolution triggered by picking up `newWeapon` given the collected set.
 * @param {Set<string>} collected
 * @param {string} newWeapon
 * @returns {object|null} recipe
 */
export function findEvolution(collected, newWeapon) {
  for (const [combo, recipe] of Object.entries(EVOLUTION_RECIPES)) {
    const [a, b] = combo.split('+');
    if ((newWeapon === a || newWeapon === b) && collected.has(a) && collected.has(b)) return recipe;
  }
  return null;
}

/** Independent copy for scenes that mutate the table (evolutions get registered at runtime). */
export function cloneWeapons() {
  return Object.fromEntries(Object.entries(WEAPONS).map(([k, v]) => [k, { ...v }]));
}
