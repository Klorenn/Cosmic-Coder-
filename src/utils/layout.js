import Phaser from 'phaser';

/**
 * Devuelve un factor de escala UI basado en la altura lógica del juego.
 * Mantiene el diseño original pensado para ~720px de alto, y en pantallas
 * más grandes hace que los textos / UI crezcan suavemente.
 *
 * NOTA: Usa la altura LÓGICA (config del juego), no la altura CSS.
 */
export function getUIScale(scene) {
  const h = scene.scale?.height || 720;
  return Phaser.Math.Clamp(h / 720, 1, 2.4);
}

/**
 * Factor de zoom de cámara para que en ventanas bajas (por ejemplo,
 * si juegas en una pestaña pequeña o con poca altura) todo se vea
 * MÁS GRANDE en vez de minúsculo.
 *
 * Usa la altura renderizada (displaySize.height) y apunta a que
 * el área visible equivalga aproximadamente a 720px de alto.
 *
 * - Si la ventana es más alta que 720px → zoom = 1 (no acercar).
 * - Si es más baja que 720px → zoom > 1 (acerca la cámara).
 */
export function getCameraZoom(scene) {
  const displayH =
    scene.scale?.displaySize?.height ||
    scene.sys?.game?.canvas?.clientHeight ||
    window.innerHeight ||
    720;

  const targetH = 720;
  const zoom = targetH / displayH;

  // Solo acercamos (>=1) y evitamos acercar demasiado.
  return Phaser.Math.Clamp(zoom, 1, 1.8);
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

/**
 * Layout del HUD responsive: posiciones y tamaños según viewport y getUIScale.
 * Usar en createHUD y updateHUD para que el HUD se vea bien en pantalla completa.
 */
export function getHudLayout(scene) {
  const w = scene.scale?.width ?? 800;
  const h = scene.scale?.height ?? 720;
  const uiScale = getUIScale(scene);
  const pad = Math.max(12, 14 * uiScale);
  const barW = Math.min(220 * uiScale, w * 0.32);
  const barH = 18 * uiScale;
  const barHp = 14 * uiScale;
  const lineH = 18 * uiScale;
  const topY = 8;
  const xpY = topY;
  const hpY = xpY + barH + 6;
  const leftTextY = hpY + barHp + 8;
  const rightX = w - pad;
  const centerX = w / 2;
  const modeY = hpY + barHp + 6;
  const connectionY = h - 36;
  const bossBarW = Math.min(400, w * 0.6);
  const bossBarH = 22 * uiScale;
  const bossBarX = centerX - bossBarW / 2;
  const bossBarY = h - 58;
  const bossNameY = bossBarY - 18;
  const fontSize = {
    tiny: Math.round(9 * uiScale),
    small: Math.round(10 * uiScale),
    normal: Math.round(12 * uiScale),
    medium: Math.round(14 * uiScale),
    large: Math.round(16 * uiScale)
  };
  return {
    w, h, pad, uiScale,
    leftX: pad,
    rightX,
    centerX,
    barW, barH, barHp,
    xpY, hpY, leftTextY,
    rightTopY: topY,
    lineH,
    modeY,
    connectionY,
    bossBarX, bossBarY, bossBarW, bossBarH, bossNameY,
    fontSize
  };
}
