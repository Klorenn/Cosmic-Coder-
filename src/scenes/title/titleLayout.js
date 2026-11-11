/**
 * Pure layout helpers for the title screen (no Phaser import).
 *
 * The canvas is always 1920x1080 logical (Phaser.Scale.FIT) and TitleScene zooms the camera on short
 * windows (utils/layout getCameraZoom). With zoom > 1 only the centred 1/zoom window is visible, so the
 * corner widgets must be anchored to that window, not to the canvas edges.
 */

const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : d);

export function visibleRect(width, height, zoom) {
  const w = num(width, 1920);
  const h = num(height, 1080);
  const z = Math.max(1, num(zoom, 1));
  return { x: (w - w / z) / 2, y: (h - h / z) / 2, w: w / z, h: h / z };
}

export function cornerAnchors(rect, offX, offY) {
  return {
    topLeft: { x: rect.x + offX, y: rect.y + offY },
    topRight: { x: rect.x + rect.w - offX, y: rect.y + offY },
    bottomLeft: { x: rect.x + offX, y: rect.y + rect.h - offY },
    bottomRight: { x: rect.x + rect.w - offX, y: rect.y + rect.h - offY },
    bottomCenter: { x: rect.x + rect.w / 2, y: rect.y + rect.h - offY }
  };
}

/** css px per logical px: FIT scale (displayW / width) times camera zoom. */
export function cssPerUnit(displayW, width, zoom) {
  const w = num(width, 1920);
  return (num(displayW, w) / w) * Math.max(1, num(zoom, 1));
}

/**
 * Vertical spacing for the secondary menu rows: the original 32px, grown toward a
 * `minTouchCss` touch target on small screens but never past the room available for `rows`.
 */
export function menuRowSpacing({ base = 32, rows, available, cssPerUnit: k, minTouchCss = 48 }) {
  const want = minTouchCss / num(k, 1);
  const room = num(available, base * rows) / Math.max(1, rows | 0);
  return Math.max(base, Math.min(want, room));
}
