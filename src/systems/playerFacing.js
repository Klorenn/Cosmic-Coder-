/**
 * Player facing (4 directions) from the movement velocity. Pure: no Phaser.
 *
 * The dominant axis wins, but switching axis requires the other axis to beat the current one by
 * FACING_HYSTERESIS (25%), so diagonal movement (keyboard diagonals, auto-move steering, joystick
 * wobble) does not flicker between the side and the front/back walk cycles. A sign change on the
 * current axis switches immediately. Below MIN_SPEED the previous facing is kept.
 */
export const FACING_HYSTERESIS = 0.25;
const MIN_SPEED = 1e-3;
const VALID = new Set(['down', 'up', 'left', 'right']);

/**
 * @param {number} vx
 * @param {number} vy  (screen space: +y = down)
 * @param {'down'|'up'|'left'|'right'} [prev]
 * @returns {'down'|'up'|'left'|'right'}
 */
export function facingFromVelocity(vx, vy, prev) {
  const last = VALID.has(prev) ? prev : 'down';
  if (!Number.isFinite(vx) || !Number.isFinite(vy)) return last;
  const ax = Math.abs(vx);
  const ay = Math.abs(vy);
  if (ax < MIN_SPEED && ay < MIN_SPEED) return last;

  const horizontal = () => (vx < 0 ? 'left' : 'right');
  const vertical = () => (vy < 0 ? 'up' : 'down');
  const k = 1 + FACING_HYSTERESIS;
  const wasHorizontal = last === 'left' || last === 'right';

  if (!VALID.has(prev)) return ax > ay ? horizontal() : vertical();
  if (wasHorizontal) return ay > ax * k ? vertical() : ax >= MIN_SPEED ? horizontal() : vertical();
  return ax > ay * k ? horizontal() : ay >= MIN_SPEED ? vertical() : horizontal();
}
