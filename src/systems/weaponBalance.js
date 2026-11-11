/**
 * Pure DPS model for weapon balance (no Phaser). Damage is normalised to attackDamage = 1 and the
 * player's base attack delay (480 ms). Each weapon's `power` (src/data/weapons.js) drives the model the
 * same way it drives ArenaScene, so the numbers stay honest when a power changes.
 *
 * Scenarios: single (one chaser), pack5 (tight cluster), horde20 (surrounded), boss (one big CC-immune target).
 */
import { critFor, getPower } from './weaponEffects.js';

export const BASE_ATTACK_DELAY_MS = 480;
export const BASE_CRIT_CHANCE = 0.1;
/** Orbit angular speed in ArenaScene.updateOrbitals: 0.05 rad/frame @60fps -> one lap every ~2.1 s. */
export const ORBIT_PERIOD_S = (Math.PI * 2) / (0.05 * 60);

export const SCENARIOS = Object.freeze({
  single: { id: 'single', targets: 1, boss: false, line: 1, fanHit: 0.45, spiralHit: 0.2, splitHit: 0.1, melee: 0.75, orbit: 0.5, cluster: 0 },
  pack5: { id: 'pack5', targets: 5, boss: false, line: 2.5, fanHit: 0.8, spiralHit: 0.45, splitHit: 0.45, melee: 0.85, orbit: 2, cluster: 70 },
  horde20: { id: 'horde20', targets: 20, boss: false, line: 4, fanHit: 1, spiralHit: 0.9, splitHit: 0.75, melee: 1, orbit: 5, cluster: 240 },
  boss: { id: 'boss', targets: 1, boss: true, line: 1, fanHit: 0.65, spiralHit: 0.3, splitHit: 0.25, melee: 0.7, orbit: 0.8, cluster: 0 }
});
export const SCENARIO_IDS = Object.keys(SCENARIOS);

/**
 * Multi-hit efficiency: hitting N enemies per attack is worth N^0.8 single hits (overkill on low-HP
 * enemies, retarget misses, spread positions). Keeps AoE/bounce from looking 20x better than they play.
 */
export const MULTI_HIT_EXPONENT = 0.8;
export function efficiency(hits) {
  return hits <= 1 ? hits : Math.pow(hits, MULTI_HIT_EXPONENT);
}

/** Expected enemies inside a circle of radius r centred on a target/player. */
export function inRadius(r, sc) {
  if (sc.targets <= 1 || !r) return 1;
  return Math.max(1, Math.min(sc.targets, sc.targets * Math.pow(r / sc.cluster, 2)));
}

/** Expected enemies in a melee arc (deg) of radius r. */
export function inArc(deg, r, sc) {
  return Math.max(1, inRadius(r, sc) * Math.min(1, deg / 360) * (sc.targets > 1 ? 1.4 : 1));
}

function ramped(n, ramp) {
  let sum = 0;
  for (let k = 0; k < n; k++) sum += 1 + (ramp || 0) * k;
  return sum;
}

/** Expected hit-weight of one projectile/swing (sum of damage multipliers over every enemy it touches). */
export function hitsPerShot(weapon, sc) {
  const p = getPower(weapon);
  const pattern = p.pattern || 'single';
  let hits;
  if (pattern === 'arc') {
    hits = inArc(p.arcDeg || 90, weapon.range || 80, sc) * sc.melee;
    if (p.shockwave) hits += inRadius(p.shockwave.radius, sc) * p.shockwave.mult * sc.melee;
    return hits;
  }
  if (pattern === 'thrust') return Math.min(p.pierceCount || 3, sc.line + (sc.targets > 1 ? 0.5 : 0)) * sc.melee;
  if (pattern === 'beam') return sc.line * 1.25;
  if (pattern === 'pulse') return inRadius(weapon.radius || 100, sc);

  // projectiles
  let accuracy = p.homing ? 1 : 0.9;
  if (pattern === 'fan') accuracy = sc.fanHit;
  if (pattern === 'spiral') accuracy = sc.spiralHit;
  let per = 1;
  if (p.pierceCount) per = ramped(Math.min(p.pierceCount, sc.line), p.pierceRamp);
  if (p.returns) per *= 2;
  if (p.bounces) per += ramped(Math.min(p.bounces, sc.targets - 1) + 1, p.bounceRamp) - 1; // bounce k deals 1 + ramp*k
  if (p.chain) {
    const jumps = Math.min(p.chain.jumps, sc.targets - 1);
    for (let k = 1; k <= jumps; k++) per += Math.pow(1 - p.chain.falloff, k);
  }
  if (p.explode) per += p.explode.mult * inRadius(p.explode.radius, sc);
  if (p.split) {
    let gen = 1;
    for (let g = 1; g <= p.split.generations; g++) {
      gen *= p.split.children * p.split.mult * sc.splitHit;
      per += gen;
    }
  }
  return per * accuracy;
}

/** Number of distinct enemies a weapon keeps engaged (used to spread DoT/mark application). */
function engagedTargets(weapon, sc) {
  const p = getPower(weapon);
  if (sc.targets <= 1) return 1;
  if (p.orbit) return Math.max(1, sc.orbit);
  return Math.max(1, Math.min(sc.targets, hitsPerShot(weapon, sc) * Math.max(1, weapon.projectiles || 1) * 0.6));
}

/**
 * Expected DPS of a weapon (attackDamage = 1) in a scenario.
 * @param {object} weapon def with `power`
 * @param {string|object} scenario id or SCENARIOS entry
 */
export function expectedDps(weapon, scenario) {
  const sc = typeof scenario === 'string' ? SCENARIOS[scenario] : scenario;
  const p = getPower(weapon);
  const crit = critFor(weapon, BASE_CRIT_CHANCE);
  const critFactor = 1 + crit.chance * (crit.mult - 1);
  const dmg = (weapon.damage || 0) * critFactor;

  let direct = 0;
  let hitRatePerTarget = 0;
  if (p.orbit) {
    const count = p.orbit.count;
    const perEnemy = Math.min(count / ORBIT_PERIOD_S, 1000 / p.orbit.hitCooldownMs);
    direct += dmg * perEnemy * efficiency(sc.orbit);
    hitRatePerTarget = perEnemy;
  } else {
    const shotsPerSec = (weapon.attackRate || 0) * 1000 / BASE_ATTACK_DELAY_MS;
    const projectiles = p.pattern === 'arc' || p.pattern === 'thrust' || p.pattern === 'beam' || p.pattern === 'pulse'
      ? 1 : Math.max(1, weapon.projectiles || 1);
    const hits = hitsPerShot(weapon, sc) * projectiles;
    direct += dmg * shotsPerSec * efficiency(hits);
    hitRatePerTarget = (shotsPerSec * hits) / engagedTargets(weapon, sc);
  }
  if (p.pulse) {
    const perSec = 1000 / p.pulse.everyMs;
    const sources = p.pulse.fromOrbs && p.orbit ? p.orbit.count * 0.35 : 1;
    direct += (weapon.damage || 0) * p.pulse.mult * perSec * efficiency(inRadius(p.pulse.radius, sc) * sources);
  }

  let dps = direct;
  const engaged = engagedTargets(weapon, sc);
  for (const dot of [p.burn, p.bleed]) {
    if (!dot) continue;
    const uptime = Math.min(1, hitRatePerTarget * dot.ms / 1000);
    dps += (weapon.damage || 0) * dot.mult * uptime * engaged;
  }
  if (p.mark) {
    const uptime = Math.min(1, hitRatePerTarget * p.mark.chance * p.mark.ms / 1000);
    dps *= 1 + p.mark.mult * uptime;
  }
  if (p.execute) {
    const thr = sc.boss ? p.execute.bossThreshold : p.execute.threshold;
    dps *= 1 / (1 - thr);
  }
  return dps;
}

/** DPS in every scenario plus the best one. */
export function dpsProfile(weapon) {
  const out = {};
  for (const id of SCENARIO_IDS) out[id] = expectedDps(weapon, id);
  const bestId = SCENARIO_IDS.reduce((a, b) => (out[b] > out[a] ? b : a));
  return { ...out, best: out[bestId], bestScenario: bestId };
}

export function median(values) {
  const v = [...values].sort((a, b) => a - b);
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

/** Table rows { id, best, bestScenario, single, pack5, horde20, boss } for a { id: weapon } map. */
export function balanceTable(weaponsById) {
  return Object.entries(weaponsById).map(([id, w]) => ({ id, ...dpsProfile(w) }));
}

/** Drop tiers (ArenaScene.spawnWeaponDrop pools; basic is the starter). Balance is compared inside a tier. */
export const WEAPON_TIERS = Object.freeze({
  common: ['basic', 'spread', 'pierce', 'rapid', 'homing', 'bounce', 'sword', 'spear', 'boomerang', 'kunai'],
  uncommon: ['orbital', 'aoe', 'freeze'],
  rare: ['rmrf', 'sudo', 'forkbomb']
});

/** Per-scenario median DPS over the base weapons (the "par" a weapon is measured against). */
export function baseMedians(baseWeapons) {
  const profs = Object.values(baseWeapons).map(dpsProfile);
  return Object.fromEntries(SCENARIO_IDS.map((s) => [s, median(profs.map((p) => p[s]))]));
}

/**
 * Niche index: DPS in the weapon's best scenario relative to that scenario's par (base median).
 * Raw DPS is not comparable across scenarios (a horde has 20x the HP on screen), so "as good in its
 * niche" means as far above par in its best scenario.
 */
export function nicheIndex(weapon, medians) {
  const p = dpsProfile(weapon);
  return Math.max(...SCENARIO_IDS.map((s) => p[s] / medians[s]));
}
