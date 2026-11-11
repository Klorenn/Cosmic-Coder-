/**
 * Weapon on-hit effects + per-enemy status (pure, no Phaser). ArenaScene owns the objects and calls in:
 *   applyOnHit(weapon, enemyState, hit) -> { state, damage, isCrit, executed, applied[] }
 *   tickStatus(enemyState, dtMs)         -> { state, damage }  (integer DoT damage, fractional carry kept)
 * A weapon's identity lives in `weapon.power` (src/data/weapons.js); see docs/WEAPONS.md.
 */

export const DEFAULT_CRIT_MULT = 2;

/** Enemy tint per dominant status: blue frozen, orange burning, red bleeding, white marked, pale blue slowed. */
export const STATUS_TINTS = Object.freeze({
  frozen: 0x60a5fa,
  burning: 0xf97316,
  bleeding: 0xdc2626,
  marked: 0xffffff,
  slowed: 0x93c5fd
});

export function createStatus() {
  return {
    slowMs: 0, slowPct: 0,
    freezeStacks: 0, frozenMs: 0,
    burnMs: 0, burnDps: 0,
    bleedMs: 0, bleedDps: 0,
    markMs: 0, markMult: 0,
    dotCarry: 0
  };
}

export function getPower(weapon) {
  return (weapon && weapon.power) || {};
}

/** Bosses and mini-bosses drive their own speed (dashes, phases): they are immune to slow/freeze. */
export function isCcImmune(enemy) {
  return !!(enemy && (enemy.isBoss || enemy.isMiniBoss));
}

/** Effective crit chance and multiplier for a weapon given the player's base crit chance. */
export function critFor(weapon, baseChance = 0.1) {
  const p = getPower(weapon);
  if (p.alwaysCrit) return { chance: 1, mult: p.critMult || DEFAULT_CRIT_MULT };
  return {
    chance: Math.min(1, Math.max(0, baseChance + (p.critBonus || 0))),
    mult: p.critMult || DEFAULT_CRIT_MULT
  };
}

export function damageTakenMult(state) {
  return state && state.markMs > 0 ? 1 + (state.markMult || 0) : 1;
}

/** Movement multiplier: 0 frozen, 1 - slowPct slowed, 1 otherwise (always 1 for CC-immune enemies). */
export function speedMultiplier(state, ccImmune = false) {
  if (!state || ccImmune) return 1;
  if (state.frozenMs > 0) return 0;
  if (state.slowMs > 0) return Math.max(0, 1 - state.slowPct);
  return 1;
}

export function dominantStatus(state) {
  if (!state) return null;
  if (state.frozenMs > 0) return 'frozen';
  if (state.burnMs > 0) return 'burning';
  if (state.bleedMs > 0) return 'bleeding';
  if (state.markMs > 0) return 'marked';
  if (state.slowMs > 0) return 'slowed';
  return null;
}

export function hasActiveStatus(state) {
  return dominantStatus(state) !== null;
}

/**
 * Resolve one hit.
 * @param {object} weapon weapon def (with optional `power`)
 * @param {object} state enemy status (createStatus())
 * @param {object} hit { damage, critChance, rng, hpBefore, maxHp, isBoss, pierceIndex, bounceIndex, chainIndex, noCrit }
 */
export function applyOnHit(weapon, state, hit) {
  const p = getPower(weapon);
  const rng = typeof hit.rng === 'function' ? hit.rng : Math.random;
  const s = { ...(state || createStatus()) };
  const applied = [];
  const isBoss = !!hit.isBoss;

  let dmg = hit.damage;
  if (p.pierceRamp && hit.pierceIndex) dmg *= 1 + p.pierceRamp * hit.pierceIndex;
  if (p.bounceRamp && hit.bounceIndex) dmg *= 1 + p.bounceRamp * hit.bounceIndex;
  if (hit.chainIndex) dmg = chainDamage(dmg, hit.chainIndex, p.chain ? p.chain.falloff : 0.15);
  dmg *= damageTakenMult(s);

  let isCrit = false;
  if (!hit.noCrit) {
    const c = critFor(weapon, hit.critChance ?? 0.1);
    if (c.chance >= 1 || rng() < c.chance) {
      isCrit = true;
      dmg *= c.mult;
    }
  }
  dmg = Math.max(1, Math.round(dmg));

  let executed = false;
  if (p.execute && hit.maxHp > 0) {
    const thr = isBoss ? p.execute.bossThreshold : p.execute.threshold;
    const after = (hit.hpBefore ?? hit.maxHp) - dmg;
    if (after > 0 && after / hit.maxHp <= thr) {
      executed = true;
      dmg = Math.ceil(hit.hpBefore ?? hit.maxHp);
      applied.push('execute');
    }
  }

  if (p.slow && !isBoss) {
    s.slowMs = Math.max(s.slowMs, p.slow.ms);
    s.slowPct = Math.max(s.slowPct, p.slow.pct);
    applied.push('slow');
    if (p.slow.stacksToFreeze) {
      s.freezeStacks += 1;
      if (s.freezeStacks >= p.slow.stacksToFreeze) {
        s.freezeStacks = 0;
        s.frozenMs = Math.max(s.frozenMs, p.slow.freezeMs || 1000);
        applied.push('freeze');
      }
    }
  }
  if (p.burn) {
    s.burnMs = p.burn.ms;
    s.burnDps = Math.max(s.burnMs > 0 ? s.burnDps : 0, hit.damage * p.burn.mult);
    applied.push('burn');
  }
  if (p.bleed) {
    s.bleedMs = p.bleed.ms;
    s.bleedDps = Math.max(s.bleedDps, hit.damage * p.bleed.mult);
    applied.push('bleed');
  }
  if (p.mark && rng() < p.mark.chance) {
    s.markMs = p.mark.ms;
    s.markMult = p.mark.mult;
    applied.push('mark');
  }

  return { state: s, damage: dmg, isCrit, executed, applied };
}

/** Advance statuses by dtMs; returns integer DoT damage for this tick (fraction carried in state). */
export function tickStatus(state, dtMs) {
  const s = { ...(state || createStatus()) };
  let dot = 0;
  if (s.burnMs > 0) {
    dot += s.burnDps * Math.min(dtMs, s.burnMs) / 1000;
    s.burnMs = Math.max(0, s.burnMs - dtMs);
    if (s.burnMs === 0) s.burnDps = 0;
  }
  if (s.bleedMs > 0) {
    dot += s.bleedDps * Math.min(dtMs, s.bleedMs) / 1000;
    s.bleedMs = Math.max(0, s.bleedMs - dtMs);
    if (s.bleedMs === 0) s.bleedDps = 0;
  }
  s.slowMs = Math.max(0, s.slowMs - dtMs);
  if (s.slowMs === 0) { s.slowPct = 0; s.freezeStacks = 0; }
  s.frozenMs = Math.max(0, s.frozenMs - dtMs);
  s.markMs = Math.max(0, s.markMs - dtMs);
  if (s.markMs === 0) s.markMult = 0;

  const total = dot + s.dotCarry;
  const damage = Math.floor(total);
  s.dotCarry = s.burnMs > 0 || s.bleedMs > 0 ? total - damage : 0;
  return { state: s, damage };
}

export function hitReady(lastAt, now, cooldownMs) {
  return lastAt == null || now - lastAt >= cooldownMs;
}

/** Damage of the n-th chain jump (0 = primary target). */
export function chainDamage(base, index, falloff = 0.15) {
  return Math.round(base * Math.pow(1 - falloff, index));
}

/** Can a projectile at `depth` generation split again? */
export function canSplit(weapon, depth = 0) {
  const p = getPower(weapon);
  return !!p.split && depth < p.split.generations;
}

/** Evenly spaced full-circle angles rotated by `volley * step` (bullet-hell spiral). */
export function spiralAngles(count, volley = 0, step = 0.35) {
  const off = volley * step;
  return Array.from({ length: count }, (_, i) => off + (i * Math.PI * 2) / count);
}

/** Fan of `count` angles `stepRad` apart centred on `base`. */
export function fanAngles(base, count, stepRad) {
  if (count <= 1) return [base];
  return Array.from({ length: count }, (_, i) => base + (i - (count - 1) / 2) * stepRad);
}

/** Choose a target from [{dist, elite, ...}]: elites/bosses in range first when preferElite, else nearest. */
export function pickTarget(candidates, { preferElite = false, range = Infinity } = {}) {
  let best = null;
  let bestElite = null;
  for (const c of candidates || []) {
    if (c.dist > range) continue;
    if (!best || c.dist < best.dist) best = c;
    if (c.elite && (!bestElite || c.dist < bestElite.dist)) bestElite = c;
  }
  return (preferElite && bestElite) || best;
}

/** Is (ex,ey) inside a melee arc of `deg` degrees and `range` px facing `facing` radians from (px,py)? */
export function inArc(px, py, facing, deg, range, ex, ey) {
  const dx = ex - px;
  const dy = ey - py;
  if (dx * dx + dy * dy > range * range) return false;
  if (deg >= 360) return true;
  let diff = Math.atan2(dy, dx) - facing;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return Math.abs(diff) <= (deg * Math.PI) / 360;
}

/** Is (ex,ey) on the segment from (px,py) along `angle` for `length` px, within `halfWidth` px? */
export function onLine(px, py, angle, length, halfWidth, ex, ey) {
  const dx = ex - px;
  const dy = ey - py;
  const along = dx * Math.cos(angle) + dy * Math.sin(angle);
  if (along < 0 || along > length) return false;
  const across = Math.abs(-dx * Math.sin(angle) + dy * Math.cos(angle));
  return across <= halfWidth;
}
