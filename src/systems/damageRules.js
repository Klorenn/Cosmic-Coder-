/**
 * Contact-damage rules (pure). Phaser overlap fires every frame; without i-frames a single
 * touch drains HP at 60 hits/s. One hit opens a CONTACT_IFRAMES_MS invulnerability window.
 */
import { CONTACT_IFRAMES_MS } from '../config/balance.js';

/**
 * @param {number|null|undefined} lastHitAt time (ms) of the last accepted contact hit
 * @param {number} now current scene time (ms)
 * @param {number} [windowMs]
 */
export function canTakeContactDamage(lastHitAt, now, windowMs = CONTACT_IFRAMES_MS) {
  if (typeof lastHitAt !== 'number' || !Number.isFinite(lastHitAt)) return true;
  if (typeof now !== 'number' || !Number.isFinite(now)) return true;
  if (now < lastHitAt) return true; // clock reset (scene restart)
  return now - lastHitAt >= windowMs;
}

export function isInvulnerable(lastHitAt, now, windowMs = CONTACT_IFRAMES_MS) {
  return !canTakeContactDamage(lastHitAt, now, windowMs);
}

const safe = (n) => (typeof n === 'number' && Number.isFinite(n) ? n : 0);

/**
 * Apply incoming damage (pure). Shield absorbs first; health is clamped to >= 0 and never NaN.
 * @param {number} health current health
 * @param {number} damage incoming damage
 * @param {{shield?: number}} [opts]
 * @returns {{health: number, shieldLeft: number, died: boolean}}
 */
export function applyDamage(health, damage, { shield = 0 } = {}) {
  const hp = Math.max(0, safe(health));
  const dmg = Math.max(0, safe(damage));
  const sh = Math.max(0, safe(shield));
  const absorbed = Math.min(sh, dmg);
  const newHealth = Math.max(0, hp - (dmg - absorbed));
  return { health: newHealth, shieldLeft: sh - absorbed, died: newHealth <= 0 };
}
