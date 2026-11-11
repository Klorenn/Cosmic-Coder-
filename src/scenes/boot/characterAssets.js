/**
 * Character (VibeCoder / VoidNull / SyncStorm) asset additions (v2).
 *
 * - White "hit flash" silhouette sheets that mirror the exact frame layout of each player
 *   texture, so an overlay can flash the *current* frame during contact i-frames.
 * - Animation fixes: VoidNull/SyncStorm idle sources have 5 frames (BootScene pads to 6 by
 *   repeating the last one) and their walk sources have 8 frames (BootScene keeps 6, so the
 *   cycle snaps). createCharacterAnims() re-registers those anims with the full cycles.
 *
 * Pure module: no Phaser import — every function receives the scene.
 */
import { getAssetPath } from '../../utils/assetBase.js';

const range = (n) => Array.from({ length: n }, (_, i) => i);

const HIT = (texKey, compose) => ({
  texKey,
  key: `${texKey}-hit-v2`,
  file: `player/hit/${texKey}-hit-v2.png`,
  frameSize: 128,
  frames: compose.reduce((n, p) => n + p.frames.length, 0),
  compose
});

/**
 * One silhouette sheet per texture a player sprite can show while alive.
 * `compose` replicates how BootScene builds the composite (idle 0-5 clamped + walk 0-5).
 */
export const CHARACTER_HIT_SHEETS = [
  HIT('player', [{ file: 'player/robot-idle.png', frames: range(6) }, { file: 'player/robot-walk.png', frames: range(6) }]),
  HIT('player-destroyer', [{ file: 'player/destroyer-idle.png', frames: range(6) }, { file: 'player/destroyer-walk.png', frames: range(6) }]),
  HIT('player-swordsman', [{ file: 'player/swordsman-idle.png', frames: range(6) }, { file: 'player/swordsman-walk.png', frames: range(6) }]),
  HIT('destroyer-walk', [{ file: 'player/destroyer-walk.png', frames: range(8) }]),
  HIT('swordsman-walk', [{ file: 'player/swordsman-walk.png', frames: range(8) }]),
  HIT('robot-hurt', [{ file: 'player/robot-hurt.png', frames: range(4) }]),
  HIT('destroyer-hurt', [{ file: 'player/destroyer-hurt.png', frames: range(3) }]),
  HIT('swordsman-hurt', [{ file: 'player/swordsman-hurt.png', frames: range(3) }])
];

/** Queue hit-flash sheets. Call from BootScene.preload(). */
export function preloadCharacterAssets(scene) {
  for (const s of CHARACTER_HIT_SHEETS) {
    if (scene.textures.exists(s.key)) continue;
    scene.load.spritesheet(s.key, getAssetPath(`assets/sprites/${s.file}`), {
      frameWidth: s.frameSize,
      frameHeight: s.frameSize
    });
  }
}

function recreate(scene, config) {
  if (scene.anims.exists(config.key)) scene.anims.remove(config.key);
  scene.anims.create(config);
}

/**
 * Fix inconsistent character cycles. Call from BootScene.create() AFTER registerAnimations().
 *  - player-{destroyer,swordsman}-idle: frames 0-4 ping-pong (no duplicated 6th frame).
 *  - player-{destroyer,swordsman}-walk-*: full 8-frame source sheet instead of 6 of 8.
 */
export function createCharacterAnims(scene) {
  for (const id of ['destroyer', 'swordsman']) {
    const tex = `player-${id}`;
    if (scene.textures.exists(tex)) {
      recreate(scene, {
        key: `${tex}-idle`,
        frames: scene.anims.generateFrameNumbers(tex, { start: 0, end: 4 }),
        frameRate: 8,
        yoyo: true,
        repeat: -1
      });
    }
    const walkTex = `${id}-walk`;
    if (scene.textures.exists(walkTex) && (scene.textures.get(walkTex).frameTotal || 0) > 8) {
      for (const dir of ['down', 'up', 'side']) {
        recreate(scene, {
          key: `${tex}-walk-${dir}`,
          frames: scene.anims.generateFrameNumbers(walkTex, { start: 0, end: 7 }),
          frameRate: 12,
          repeat: -1
        });
      }
    }
  }
}

/**
 * White flash overlay that tracks the sprite's current frame for `durationMs`, blinking every
 * `blinkMs`. No-op when there is no silhouette sheet for the sprite's current texture.
 * @returns {Phaser.GameObjects.Sprite|null}
 */
export function playHitFlash(scene, sprite, durationMs = 600, blinkMs = 75) {
  if (!scene || !sprite || !sprite.active || !sprite.texture) return null;
  const hitKeyFor = () => `${sprite.texture.key}-hit-v2`;
  if (!scene.textures.exists(hitKeyFor())) return null;
  if (sprite._hitFlash) sprite._hitFlash.cleanup();

  const overlay = scene.add.sprite(sprite.x, sprite.y, hitKeyFor(), sprite.frame.name);
  overlay.setOrigin(sprite.originX, sprite.originY).setDepth((sprite.depth || 0) + 1);

  const sync = () => {
    if (!overlay.active || !sprite.active) return;
    const key = hitKeyFor();
    if (scene.textures.exists(key)) {
      if (overlay.texture.key !== key || overlay.frame.name !== sprite.frame.name) overlay.setTexture(key, sprite.frame.name);
      overlay.setAlpha(1);
    } else {
      overlay.setAlpha(0);
    }
    overlay.setPosition(sprite.x, sprite.y).setScale(sprite.scaleX, sprite.scaleY).setFlipX(sprite.flipX).setRotation(sprite.rotation);
  };
  sync();
  scene.events.on('postupdate', sync);

  const blink = scene.time.addEvent({ delay: blinkMs, loop: true, callback: () => overlay.setVisible(!overlay.visible) });
  let done = false;
  const cleanup = () => {
    if (done) return;
    done = true;
    scene.events.off('postupdate', sync);
    blink.remove(false);
    overlay.destroy();
    if (sprite._hitFlash && sprite._hitFlash.overlay === overlay) sprite._hitFlash = null;
  };
  scene.time.delayedCall(durationMs, cleanup);
  sprite._hitFlash = { overlay, cleanup };
  return overlay;
}
