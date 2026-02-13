import Phaser from 'phaser';

/**
 * Devuelve un factor de escala UI basado en la altura actual.
 * 1080p = 1.0, 4K ≈ 2.0 (clamp para no romper en móviles pequeños).
 */
export function getUIScale(scene) {
  const h = scene.scale?.height || 1080;
  return Phaser.Math.Clamp(h / 1080, 0.85, 2.1);
}

export function anchorTopLeft(scene, offsetX, offsetY) {
  return { x: offsetX, y: offsetY };
}

export function anchorTopRight(scene, offsetX, offsetY) {
  return { x: scene.scale.width - offsetX, y: offsetY };
}

export function anchorBottomLeft(scene, offsetX, offsetY) {
  return { x: offsetX, y: scene.scale.height - offsetY };
}

export function anchorBottomRight(scene, offsetX, offsetY) {
  return { x: scene.scale.width - offsetX, y: scene.scale.height - offsetY };
}

export function anchorBottomCenter(scene, offsetY) {
  return { x: scene.scale.width / 2, y: scene.scale.height - offsetY };
}

