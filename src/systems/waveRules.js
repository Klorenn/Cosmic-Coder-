/**
 * Time-driven waves (pure), Vampire Survivors style: the wave is the run clock divided by
 * WAVE_DURATION_MS. Killing enemies never ends a wave; surviving does. Spawn pacing lives in
 * systems/spawnDirector.js. See docs/WAVES.md.
 */
import * as BALANCE from '../config/balance.js';

export const WAVE_DURATION_MS = BALANCE.WAVE_DURATION_MS;

const normWave = (w) => (typeof w === 'number' && Number.isFinite(w) && w >= 1 ? Math.floor(w) : 1);

/** 1-based wave for a run clock in ms (garbage -> wave 1). */
export function waveForTime(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return 1;
  return 1 + Math.floor(ms / WAVE_DURATION_MS);
}

/** Run-clock ms at which `wave` starts. */
export function waveStartMs(wave) {
  return (normWave(wave) - 1) * WAVE_DURATION_MS;
}

/**
 * Per-wave stat multipliers for regular enemies. Gentle on purpose: difficulty comes from the
 * population (spawnDirector.maxAlive), not from sponge enemies.
 *   health: 1 + 8% per wave, damage: 1 + 4% per wave, speed: 1 + 1% per wave (capped).
 */
export function waveStatScale(wave) {
  const k = normWave(wave) - 1;
  return {
    health: 1 + k * BALANCE.WAVE_HP_GROWTH,
    damage: 1 + k * BALANCE.WAVE_DAMAGE_GROWTH,
    speed: Math.min(BALANCE.WAVE_SPEED_CAP, 1 + k * BALANCE.WAVE_SPEED_FACTOR)
  };
}
