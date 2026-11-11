/**
 * Ability visual effects. Only scene.add.graphics / scene.add.text / tweens / camera:
 * no new assets. Every function is defensive (a missing scene part means "no fx", never a crash).
 */

const FX_DEPTH = 60;
const TRAIL_DEPTH = 4;

function canDraw(scene) {
  return !!(scene && scene.add && typeof scene.add.graphics === 'function' && scene.tweens);
}

/** Expanding stroked ring that fades out. */
export function ringBurst(scene, x, y, { color = 0xffffff, from = 10, to = 120, width = 4, duration = 450, alpha = 0.9 } = {}) {
  if (!canDraw(scene)) return null;
  const g = scene.add.graphics();
  g.setDepth(FX_DEPTH);
  g.setPosition(x, y);
  const state = { r: from, a: alpha };
  const draw = () => {
    g.clear();
    g.lineStyle(width, color, state.a);
    g.strokeCircle(0, 0, state.r);
  };
  draw();
  scene.tweens.add({
    targets: state,
    r: to,
    a: 0,
    duration,
    ease: 'Cubic.easeOut',
    onUpdate: draw,
    onComplete: () => g.destroy()
  });
  return g;
}

/** Floating label (ability name) above the player. */
export function floatLabel(scene, x, y, text, color = 0xffffff) {
  if (!canDraw(scene) || typeof scene.add.text !== 'function') return null;
  const hex = `#${color.toString(16).padStart(6, '0')}`;
  const label = scene.add.text(x, y - 36, text, {
    fontFamily: '"JetBrains Mono", "Fira Code", monospace',
    fontSize: '14px',
    fontStyle: 'bold',
    color: hex,
    stroke: '#000000',
    strokeThickness: 4
  }).setOrigin(0.5).setDepth(FX_DEPTH + 1);
  scene.tweens.add({ targets: label, y: y - 70, alpha: 0, duration: 900, ease: 'Cubic.easeOut', onComplete: () => label.destroy() });
  return label;
}

/** HOT_RELOAD: double green-cyan ring + label. */
export function playHotReloadFx(scene, player, color, label) {
  if (!player) return;
  ringBurst(scene, player.x, player.y, { color, from: 60, to: 8, width: 3, duration: 300 });
  ringBurst(scene, player.x, player.y, { color, from: 12, to: 90, width: 5, duration: 500 });
  if (label) floatLabel(scene, player.x, player.y, label, color);
}

/** RM_RF: shockwave to `radius`, filled flash and a short camera shake. */
export function playRmRfFx(scene, x, y, radius, color, label) {
  ringBurst(scene, x, y, { color, from: 16, to: radius, width: 8, duration: 380 });
  ringBurst(scene, x, y, { color: 0xffffff, from: 8, to: radius * 0.7, width: 2, duration: 300, alpha: 0.6 });
  if (canDraw(scene)) {
    const g = scene.add.graphics().setDepth(FX_DEPTH - 1).setPosition(x, y);
    g.fillStyle(color, 0.25);
    g.fillCircle(0, 0, radius);
    scene.tweens.add({ targets: g, alpha: 0, duration: 350, onComplete: () => g.destroy() });
  }
  try { scene.cameras?.main?.shake(180, 0.008); } catch (_) { /* no camera: skip */ }
  if (label) floatLabel(scene, x, y, label, color);
}

/**
 * SYNC_DASH trail: jagged electric line from A to B that flickers and fades over `durationMs`.
 * Returns the graphics object (destroyed automatically).
 */
export function createDashTrail(scene, ax, ay, bx, by, color, durationMs, rng = Math.random) {
  if (!canDraw(scene)) return null;
  const g = scene.add.graphics().setDepth(TRAIL_DEPTH);
  const len = Math.hypot(bx - ax, by - ay);
  const nx = len > 0 ? -(by - ay) / len : 0;
  const ny = len > 0 ? (bx - ax) / len : 0;
  const steps = Math.max(2, Math.round(len / 18));
  const draw = () => {
    g.clear();
    g.lineStyle(10, color, 0.18);
    g.lineBetween(ax, ay, bx, by);
    g.lineStyle(3, color, 0.95);
    g.beginPath();
    g.moveTo(ax, ay);
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const j = (rng() - 0.5) * 16;
      g.lineTo(ax + (bx - ax) * t + nx * j, ay + (by - ay) * t + ny * j);
    }
    g.lineTo(bx, by);
    g.strokePath();
  };
  draw();
  const flicker = scene.time?.addEvent ? scene.time.addEvent({ delay: 70, loop: true, callback: draw }) : null;
  scene.tweens.add({
    targets: g,
    alpha: 0,
    delay: Math.max(0, durationMs - 400),
    duration: 400,
    onComplete: () => { if (flicker) flicker.remove(false); g.destroy(); }
  });
  return g;
}

/** SYNC_DASH start: afterimage ring + label. */
export function playDashFx(scene, x, y, color, label) {
  ringBurst(scene, x, y, { color, from: 6, to: 44, width: 3, duration: 260 });
  if (label) floatLabel(scene, x, y, label, color);
}

/** Small ping when the ability comes off cooldown. */
export function playReadyPing(scene, player, color) {
  if (!player) return;
  ringBurst(scene, player.x, player.y, { color, from: 34, to: 22, width: 2, duration: 280, alpha: 0.7 });
}

export default { ringBurst, floatLabel, playHotReloadFx, playRmRfFx, createDashTrail, playDashFx, playReadyPing };
