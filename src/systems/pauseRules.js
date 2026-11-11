/**
 * Pure pause-menu gate for ArenaScene.
 * The pause menu must not open on a dead run: it used to cover the GAME OVER screen and its
 * "resume" / "restart" entries operated on a run that had already ended.
 * @param {{playerDead?: boolean, player?: {active?: boolean}|null}|null|undefined} scene
 * @returns {boolean}
 */
export function canOpenPauseMenu(scene) {
  if (!scene || scene.playerDead) return false;
  return !!(scene.player && scene.player.active);
}
