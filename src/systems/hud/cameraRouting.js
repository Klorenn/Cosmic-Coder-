/**
 * cameraRouting — decides which camera draws each display-list object (no Phaser import).
 *
 * The world camera is zoomed (getCameraZoom), and Phaser zooms scrollFactor-0 objects too, around
 * the camera centre, which pushed the HUD off screen. Screen-space objects (scrollFactor 0 on both
 * axes) are therefore drawn only by an un-zoomed UI camera, everything else only by the world camera.
 * Exceptions: screen-space objects with negative depth are backgrounds (parallax / grid) and stay on
 * the world camera, behind the world; `obj.renderLayer = 'ui' | 'world'` forces a camera explicitly.
 * Phaser semantics: an object is skipped by a camera when (obj.cameraFilter & camera.id) !== 0.
 */

export function isScreenSpace(obj) {
  return !!obj && obj.scrollFactorX === 0 && obj.scrollFactorY === 0;
}

/** true when the object belongs to the un-zoomed UI camera. */
export function wantsUiCamera(obj) {
  if (!obj) return false;
  if (obj.renderLayer === 'ui') return true;
  if (obj.renderLayer === 'world') return false;
  return isScreenSpace(obj) && !((obj.depth || 0) < 0);
}

/**
 * @param {Array} list display list (scene.children.list)
 * @param {number} worldCamId bit id of the world camera
 * @param {number} uiCamId bit id of the UI camera
 * @returns {number} how many objects changed filter
 */
export function routeObjectsToCameras(list, worldCamId, uiCamId) {
  if (!Array.isArray(list)) return 0;
  const both = worldCamId | uiCamId;
  let changed = 0;
  for (let i = 0; i < list.length; i++) {
    const obj = list[i];
    if (!obj) continue;
    const current = obj.cameraFilter | 0;
    const next = (current & ~both) | (wantsUiCamera(obj) ? worldCamId : uiCamId);
    if (next !== current) {
      obj.cameraFilter = next;
      changed++;
    }
  }
  return changed;
}

export default { isScreenSpace, wantsUiCamera, routeObjectsToCameras };
