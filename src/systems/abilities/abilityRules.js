/**
 * Character ability rules (pure, no Phaser).
 * AbilityController owns one state object and calls these functions; every function returns
 * a new object (or the same one when nothing changes) and never produces NaN.
 *
 * Clock: `now` is in ms. It may jump backwards (scene restart / reused scene instance): tick()
 * shifts readyAt so the remaining cooldown is preserved.
 */
import { getCharacterAbility, resolveCharacterId, CHARACTERS } from '../../data/characters.js';

const finite = (n) => typeof n === 'number' && Number.isFinite(n);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Length of the "active" window opened by an activation (i-frames, dash). 0 = instant. */
export function activeWindowMs(ability) {
  if (!ability) return 0;
  if (ability.id === 'HOT_RELOAD') return ability.params.iFrameMs;
  if (ability.id === 'SYNC_DASH') return ability.params.durationMs;
  return 0;
}

/** Fresh state for a character (unknown -> vibecoder). Starts ready. */
export function createAbilityState(characterId) {
  const id = resolveCharacterId(characterId);
  const ability = getCharacterAbility(id);
  return {
    characterId: id,
    abilityId: ability.id,
    cooldownMs: ability.cooldownMs,
    readyAt: 0,
    activeUntil: 0,
    lastActivatedAt: null,
    lastNow: 0,
    uses: 0
  };
}

/** Remaining cooldown in ms, always within [0, cooldownMs]. */
export function cooldownRemaining(state, now) {
  if (!state || !finite(state.cooldownMs) || state.cooldownMs <= 0) return 0;
  const t = finite(now) ? now : (finite(state.lastNow) ? state.lastNow : 0);
  const readyAt = finite(state.readyAt) ? state.readyAt : 0;
  return clamp(readyAt - t, 0, state.cooldownMs);
}

/** Progress toward ready: 0 = just used, 1 = ready. */
export function cooldownPct(state, now) {
  if (!state || !finite(state.cooldownMs) || state.cooldownMs <= 0) return 0;
  return clamp(1 - cooldownRemaining(state, now) / state.cooldownMs, 0, 1);
}

export function canActivate(state, now) {
  if (!state || !finite(now)) return false;
  return cooldownRemaining(state, now) <= 0;
}

/** Advance the clock. A backwards jump shifts readyAt/activeUntil to keep remaining times. */
export function tick(state, now) {
  if (!state || !finite(now)) return state;
  const last = finite(state.lastNow) ? state.lastNow : 0;
  if (now === last) return state;
  let { readyAt, activeUntil } = state;
  if (!finite(readyAt)) readyAt = 0;
  if (!finite(activeUntil)) activeUntil = 0;
  if (now < last) {
    const shift = now - last;
    readyAt += shift;
    activeUntil += shift;
  }
  // Never more than one full cooldown ahead.
  readyAt = Math.min(readyAt, now + state.cooldownMs);
  return { ...state, readyAt, activeUntil, lastNow: now };
}

/** Use the ability. On cooldown (or bad input) the same state is returned unchanged. */
export function activate(state, now) {
  if (!canActivate(state, now)) return state;
  const ability = getCharacterAbility(state.characterId);
  const s = tick(state, now);
  return {
    ...s,
    readyAt: now + s.cooldownMs,
    activeUntil: now + activeWindowMs(ability),
    lastActivatedAt: now,
    lastNow: now,
    uses: (finite(s.uses) ? s.uses : 0) + 1
  };
}

/** True while the activation window (i-frames / dash) is open. */
export function isActive(state, now) {
  if (!state || !finite(now) || !finite(state.lastActivatedAt)) return false;
  return now >= state.lastActivatedAt && now < state.activeUntil;
}

/**
 * Autopilot decision.
 * @param {string} characterId
 * @param {{hpPct:number, enemiesNear200:number, enemiesNear120:number, nearestDist:number, bossNear:boolean|number}} snap
 *   bossNear: boolean, or distance to the nearest boss (Infinity when none).
 */
export function shouldAutoUse(characterId, snap) {
  if (!snap || typeof snap !== 'object') return false;
  if (typeof characterId !== 'string' || !Object.prototype.hasOwnProperty.call(CHARACTERS, characterId)) return false;
  const p = CHARACTERS[characterId].ability.params;
  switch (characterId) {
    case 'vibecoder':
      return finite(snap.hpPct) && snap.hpPct <= p.autoHpPct;
    case 'destroyer': {
      const crowd = finite(snap.enemiesNear200) && snap.enemiesNear200 >= p.autoEnemyCount;
      const boss = snap.bossNear === true || (finite(snap.bossNear) && snap.bossNear < p.autoBossDist);
      return crowd || boss;
    }
    case 'swordsman': {
      const cornered = finite(snap.hpPct) && snap.hpPct <= p.autoHpPct
        && finite(snap.nearestDist) && snap.nearestDist < p.autoNearestDist;
      const swarmed = finite(snap.enemiesNear120) && snap.enemiesNear120 >= p.autoEnemyCount;
      return cornered || swarmed;
    }
    default:
      return false;
  }
}

/**
 * Summarise the battlefield for shouldAutoUse.
 * @param {{player:{x,y}, hp:number, maxHp:number, enemies:Array<{x,y,active?,isBoss?,isMiniBoss?}>}} input
 */
export function buildSnapshot({ player, hp, maxHp, enemies } = {}) {
  const hpPct = finite(hp) && finite(maxHp) && maxHp > 0 ? clamp(hp / maxHp, 0, 1) : 1;
  const snap = { hpPct, enemiesNear200: 0, enemiesNear120: 0, nearestDist: Infinity, bossNear: Infinity, nearest: null };
  if (!player || !finite(player.x) || !finite(player.y) || !Array.isArray(enemies)) return snap;
  for (const e of enemies) {
    if (!e || e.active === false || !finite(e.x) || !finite(e.y)) continue;
    const d = Math.hypot(e.x - player.x, e.y - player.y);
    if (d < 200) snap.enemiesNear200++;
    if (d < 120) snap.enemiesNear120++;
    if (d < snap.nearestDist) { snap.nearestDist = d; snap.nearest = { x: e.x, y: e.y }; }
    if ((e.isBoss || e.isMiniBoss) && d < snap.bossNear) snap.bossNear = d;
  }
  return snap;
}

/**
 * Value for scene.lastContactHitAt that blocks contact damage until `until` (damageRules uses a
 * sliding window of `windowMs` after the last hit). Never in the future: damageRules treats a
 * future timestamp as a clock reset. Call every frame while the i-frames last.
 */
export function contactLockTimestamp(now, until, windowMs) {
  if (!finite(now) || !finite(until) || !finite(windowMs)) return null;
  return Math.min(now, until - windowMs);
}

/** Displacement that pushes an enemy `dist` px away from the player. */
export function knockbackVector(px, py, ex, ey, dist) {
  if (![px, py, ex, ey, dist].every(finite)) return { dx: 0, dy: 0 };
  const d = Math.hypot(ex - px, ey - py);
  if (d === 0) return { dx: dist, dy: 0 };
  return { dx: ((ex - px) / d) * dist, dy: ((ey - py) / d) * dist };
}

/** Unit dash direction: movement velocity > away from nearest enemy > facing (flipX -> -1). */
export function dashDirection(vel, player, nearest, facing) {
  const vx = vel?.vx;
  const vy = vel?.vy;
  if (finite(vx) && finite(vy)) {
    const m = Math.hypot(vx, vy);
    if (m > 1) return { dx: vx / m, dy: vy / m };
  }
  if (player && nearest && [player.x, player.y, nearest.x, nearest.y].every(finite)) {
    const ax = player.x - nearest.x;
    const ay = player.y - nearest.y;
    const m = Math.hypot(ax, ay);
    if (m > 0) return { dx: ax / m, dy: ay / m };
  }
  return { dx: facing === -1 ? -1 : 1, dy: 0 };
}

/** Dash end point, clamped into `bounds` ({x,y,width,height}) minus `margin`. */
export function dashEndpoint(start, dir, distance, bounds, margin = 0) {
  const sx = finite(start?.x) ? start.x : 0;
  const sy = finite(start?.y) ? start.y : 0;
  const dx = finite(dir?.dx) ? dir.dx : 0;
  const dy = finite(dir?.dy) ? dir.dy : 0;
  const dist = finite(distance) ? distance : 0;
  let x = sx + dx * dist;
  let y = sy + dy * dist;
  if (bounds && [bounds.x, bounds.y, bounds.width, bounds.height].every(finite)) {
    const m = finite(margin) ? margin : 0;
    x = clamp(x, bounds.x + m, bounds.x + bounds.width - m);
    y = clamp(y, bounds.y + m, bounds.y + bounds.height - m);
  }
  return { x, y };
}

/** Distance from point P to segment AB (Infinity on bad input). */
export function distanceToSegment(px, py, ax, ay, bx, by) {
  if (![px, py, ax, ay, bx, by].every(finite)) return Infinity;
  const abx = bx - ax;
  const aby = by - ay;
  const len2 = abx * abx + aby * aby;
  const t = len2 === 0 ? 0 : clamp(((px - ax) * abx + (py - ay) * aby) / len2, 0, 1);
  return Math.hypot(px - (ax + t * abx), py - (ay + t * aby));
}

/** Ability damage: floor(base * mult), bossMult replaces mult vs bosses; minimum 1, never NaN. */
export function abilityDamage(baseDamage, mult, isBoss = false, bossMult) {
  const m = isBoss && finite(bossMult) ? bossMult : mult;
  if (!finite(baseDamage) || !finite(m)) return 1;
  return Math.max(1, Math.floor(baseDamage * m));
}

/** Active enemies with finite coords within `radius` of (x, y). */
export function enemiesInRadius(enemies, x, y, radius) {
  if (!Array.isArray(enemies) || ![x, y, radius].every(finite)) return [];
  return enemies.filter((e) => e && e.active !== false && finite(e.x) && finite(e.y)
    && Math.hypot(e.x - x, e.y - y) <= radius);
}

export default {
  createAbilityState, canActivate, activate, tick, cooldownPct, cooldownRemaining, isActive,
  shouldAutoUse, buildSnapshot, contactLockTimestamp, knockbackVector, dashDirection,
  dashEndpoint, distanceToSegment, abilityDamage, enemiesInRadius, activeWindowMs
};
