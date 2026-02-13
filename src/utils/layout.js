import Phaser from 'phaser';

/**
 * Devuelve un factor de escala UI basado en la altura actual.
 * Pensado para que en pantallas grandes (1080p, 1440p, 4K)
 * todo se vea más GRANDE que en el diseño original de 800x600.
 *
 * 720p ≈ 1.0, 1080p ≈ 1.5, 1440p ≈ 2.0, 4K ≈ 2.4 (clamp).
 */
export function getUIScale(scene) {
  const h = scene.scale?.height || 720;
  return Phaser.Math.Clamp(h / 720, 1, 2.4);
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

