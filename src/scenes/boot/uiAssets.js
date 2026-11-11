/**
 * Pixel UI kit v3 — runtime side (ui/pixel-kit-v3).
 *
 * Assets (written by scripts/assets/gen-ui.mjs, never hand-edited):
 *   assets/UI/pixel/ui-pixel.png + .json   atlas 'ui-pixel': 9-slice skins, sprites, icons
 *   assets/UI/pixel/pixel.png + .xml       bitmap font 'pixel' (8 px nominal, 5x7 caps, ES accents)
 *   assets/UI/pixel/ui-dither.png          2x2 checker (dithered dims, TileSprite)
 *
 * Every helper takes a scene and sizes in LOGICAL units. "px" = logical units per art pixel
 * (overlays use 2 css px per art pixel: px = 2 * overlayUnit(scene)). Pure module: no Phaser import.
 *
 *   pixelText(scene, x, y, str, { size, color, align, maxWidth, shadow })   BitmapText (+ Text-like shims)
 *   pixelPanel(scene, x, y, w, h, skin, { px })                              9-slice Container, .resize() .setSkin()
 *   uiIcon(scene, x, y, name, { px, big, tint })                             Image from the icon set
 *   ditherFill(scene, x, y, w, h, { px, color, alpha })                       TileSprite checker
 *   familyOf(color) -> 'violet' | 'cyan' | 'amber' | 'green' | 'red' | 'neutral'
 *   buttonSkin(family, state), selectedCardSkin(family), PX / PX_CSS palette
 */
import { getAssetPath } from '../../utils/assetBase.js';

export const UI_DIR = 'assets/UI/pixel';
export const UI_ATLAS = 'ui-pixel';
export const UI_FONT = 'pixel';
export const UI_DITHER = 'ui-dither';
/** Font metrics in art px: nominal size 8 (fontSize = 8 * scale), line 10, cap height 7. */
export const FONT_META = Object.freeze({ size: 8, lineHeight: 10, base: 7, capHeight: 7 });

export const PX_CSS = Object.freeze({
  ink: '#0f1228', night: '#1a1f3d', dusk: '#262d58', slate: '#3b4489',
  periw: '#7b86d9', mist: '#b5bcff', white: '#ffffff',
  cyan: '#4fe3ff', cyanD: '#1aa3c9', violet: '#a66bff', violetD: '#6b3fd1',
  amber: '#ffc14d', amberD: '#d98a1e', green: '#5df28a', greenD: '#2fa65a',
  red: '#ff5c7a', redD: '#c0304f', magenta: '#ff6be6'
});
export const PX = Object.freeze(Object.fromEntries(Object.entries(PX_CSS).map(([k, v]) => [k, parseInt(v.slice(1), 16)])));

/** 9-slice skins: art size + corner slice (art px). Must match gen-ui.mjs NINE (checked by the manifest test). */
const nine = (w, h, slice) => ({ w, h, slice });
export const NINE_SLICES = Object.freeze({
  'panel-dark': nine(48, 48, 12), 'panel-light': nine(48, 48, 12), 'panel-accent': nine(48, 48, 12),
  card: nine(24, 24, 6), 'card-hover': nine(24, 24, 6), 'card-dim': nine(24, 24, 6),
  'card-selected': nine(24, 24, 6), 'card-selected-cyan': nine(24, 24, 6), 'card-selected-amber': nine(24, 24, 6),
  tab: nine(16, 16, 5), 'tab-active': nine(16, 16, 5),
  'slider-track': nine(12, 6, 2), 'progress-track': nine(12, 6, 2),
  keycap: nine(16, 16, 5), chip: nine(16, 16, 5), bubble: nine(24, 24, 7), well: nine(16, 16, 5),
  ...Object.fromEntries(['button', 'button-primary', 'button-cyan', 'button-amber', 'button-green', 'button-red']
    .flatMap((b) => ['normal', 'hover', 'pressed'].map((s) => [`${b}-${s}`, nine(20, 20, 6)]))),
  'button-disabled': nine(20, 20, 6),
  ...Object.fromEntries(['violet', 'cyan', 'amber', 'green', 'red', 'steel'].map((f) => [`progress-fill-${f}`, nine(12, 6, 2)])),
  ...Object.fromEntries(['violet', 'cyan', 'amber', 'green', 'red', 'steel', 'neutral'].map((f) => [`tile-${f}`, nine(16, 16, 5)]))
});

/** Fixed-size sprites in the atlas: name -> [w, h] (art px). */
export const UI_SPRITES = Object.freeze({
  'slider-thumb': [8, 12], 'toggle-off': [22, 12], 'toggle-on': [22, 12], 'bubble-tail': [8, 8], cursor: [8, 11], px: [1, 1]
});

/** Icon names: frames ui-<name> (16), ui-<name>-24, and -m (greyscale, tint at runtime) variants. */
export const UI_ICON_NAMES = Object.freeze([
  'heart', 'star', 'sword', 'shield', 'bolt', 'clock', 'hourglass', 'crosshair', 'lock', 'check', 'close',
  'arrow-right', 'arrow-left', 'arrow-up', 'arrow-down', 'chevron', 'chevron-left', 'chevrons', 'gem', 'gem-amber', 'wallet', 'wave',
  'skull', 'book', 'gear', 'speaker', 'music', 'note', 'globe', 'flag', 'expand', 'fullscreen', 'user', 'gamepad',
  'crown', 'bullet', 'reload', 'burst', 'branch', 'medal-gold', 'medal-silver', 'medal-bronze',
  'magnet', 'trash', 'wrench', 'chip', 'key', 'bag'
]);

export function uiAssetManifest() {
  return [
    { type: 'atlas', key: UI_ATLAS, png: `${UI_DIR}/ui-pixel.png`, data: `${UI_DIR}/ui-pixel.json` },
    { type: 'bitmapFont', key: UI_FONT, png: `${UI_DIR}/pixel.png`, data: `${UI_DIR}/pixel.xml` },
    { type: 'image', key: UI_DITHER, png: `${UI_DIR}/ui-dither.png` }
  ];
}

/** Queue the kit. Call from BootScene.preload() (keys already in the cache are skipped). */
export function preloadUiAssets(scene) {
  for (const a of uiAssetManifest()) {
    if (scene.textures?.exists(a.key)) continue;
    if (a.type === 'atlas') scene.load.atlas(a.key, getAssetPath(a.png), getAssetPath(a.data));
    else if (a.type === 'bitmapFont') scene.load.bitmapFont(a.key, getAssetPath(a.png), getAssetPath(a.data));
    else scene.load.image(a.key, getAssetPath(a.png));
  }
}

/** Register the 9-slice sub-frames ('<skin>#0..8') on the atlas. Call from BootScene.create(); idempotent. */
export function createUiAnims(scene) {
  if (!hasUiAtlas(scene)) return false;
  Object.keys(NINE_SLICES).forEach((skin) => ensureNineFrames(scene, skin));
  return true;
}

export const hasUiAtlas = (scene) => !!scene?.textures?.exists(UI_ATLAS);
export const hasUiFont = (scene) => !!scene?.cache?.bitmapFont?.exists(UI_FONT);

function ensureNineFrames(scene, skin) {
  const tex = scene.textures.get(UI_ATLAS);
  if (tex.has(`${skin}#0`)) return true;
  const spec = NINE_SLICES[skin];
  if (!spec || !tex.has(skin)) return false;
  const f = tex.get(skin);
  const s = spec.slice;
  const xs = [0, s, f.cutWidth - s]; const ws = [s, f.cutWidth - 2 * s, s];
  const ys = [0, s, f.cutHeight - s]; const hs = [s, f.cutHeight - 2 * s, s];
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) tex.add(`${skin}#${r * 3 + c}`, f.sourceIndex, f.cutX + xs[c], f.cutY + ys[r], ws[c], hs[r]);
  }
  return true;
}

/* —— colour helpers ———————————————————————————————————————————————— */

export function colorToInt(c) {
  if (typeof c === 'number') return c;
  const s = String(c || '#ffffff').trim();
  if (s.startsWith('#')) {
    const h = s.length === 4 ? s.slice(1).split('').map((ch) => ch + ch).join('') : s.slice(1, 7);
    return parseInt(h, 16) || 0;
  }
  const m = s.match(/rgba?\(([^)]+)\)/);
  if (m) { const [r, g, b] = m[1].split(',').map((v) => parseFloat(v) || 0); return (r << 16) | (g << 8) | b; }
  return 0xffffff;
}

/** Hue family of a colour (for picking skins). Low saturation -> 'neutral'. */
export function familyOf(color) {
  const n = colorToInt(color);
  const r = ((n >> 16) & 255) / 255; const g = ((n >> 8) & 255) / 255; const b = (n & 255) / 255;
  const max = Math.max(r, g, b); const min = Math.min(r, g, b);
  const s = max === 0 ? 0 : (max - min) / max;
  if (s < 0.25 || max < 0.2) return 'neutral';
  let h;
  if (max === r) h = ((g - b) / (max - min)) % 6;
  else if (max === g) h = (b - r) / (max - min) + 2;
  else h = (r - g) / (max - min) + 4;
  h = (h * 60 + 360) % 360;
  if (h < 20 || h >= 320) return 'red';
  if (h < 70) return 'amber';
  if (h < 165) return 'green';
  if (h < 215) return 'cyan';
  return 'violet';
}

/** Button skin for a family + state ('normal' | 'hover' | 'pressed' | 'disabled'). */
export function buttonSkin(family = 'neutral', state = 'normal') {
  if (state === 'disabled') return 'button-disabled';
  const base = family === 'violet' ? 'button-primary' : (family === 'neutral' ? 'button' : `button-${family}`);
  return `${base}-${state}`;
}
/** Light fills (cyan / amber / green) need dark labels. */
export const familyLabelColor = (family) => (['cyan', 'amber', 'green'].includes(family) ? PX_CSS.ink : PX_CSS.white);
export const selectedCardSkin = (family = 'violet') => (family === 'cyan' ? 'card-selected-cyan' : family === 'amber' ? 'card-selected-amber' : 'card-selected');
export const progressFillSkin = (family) => `progress-fill-${['violet', 'cyan', 'amber', 'green', 'red'].includes(family) ? family : 'steel'}`;
export const tileSkin = (family) => `tile-${['violet', 'cyan', 'amber', 'green', 'red'].includes(family) ? family : 'neutral'}`;

/* —— text ——————————————————————————————————————————————————————— */

const FALLBACK_CHARS = { '’': "'", '‘': "'", '“': '"', '”': '"', '«': '"', '»': '"', '•': '·', '⚡': '', '\t': ' ' };

/** Map characters the bitmap font lacks: smart quotes, accented capitals (Á -> A), emoji (dropped). */
export function normalizeForFont(str, has) {
  const out = [];
  for (const ch of String(str ?? '')) {
    if (ch === '\n' || ch === ' ' || has(ch.codePointAt(0))) { out.push(ch); continue; }
    if (FALLBACK_CHARS[ch] !== undefined) { out.push(FALLBACK_CHARS[ch]); continue; }
    const base = ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
    if (base && base !== ch && [...base].every((c) => has(c.codePointAt(0)))) { out.push(base); continue; }
    const up = ch.toUpperCase();
    if (up !== ch && has(up.codePointAt(0))) { out.push(up); continue; }
    // Unknown symbol / emoji: drop it (BitmapText would skip it anyway, but measuring stays honest).
  }
  return out.join('');
}

/**
 * Pixel BitmapText. size = logical font size (8 * integer art scale reads crisp: 16 / 24 / 32 ...).
 * Returns the BitmapText with Text-like shims so it can replace scene.add.text in UI code:
 * setColor / setFill (tint), setShadow (hard 1 px ink drop shadow), setWordWrapWidth (maxWidth),
 * setFontStyle / setStroke / setPadding / setResolution / setBackgroundColor (no-ops).
 * Falls back to a monospace Text if the font failed to load.
 */
export function pixelText(scene, x, y, str = '', { size = 16, color = PX_CSS.white, align = 'left', maxWidth = 0, shadow = true, lineSpacing = 0 } = {}) {
  if (!hasUiFont(scene)) {
    const tx = scene.add.text(x, y, String(str ?? ''), { fontFamily: 'monospace', fontSize: `${Math.round(size)}px`, color: typeof color === 'number' ? `#${color.toString(16).padStart(6, '0')}` : color, align });
    if (maxWidth > 0) tx.setWordWrapWidth(maxWidth);
    return tx;
  }
  const bt = scene.add.bitmapText(x, y, UI_FONT, '', size);
  const chars = bt.fontData?.chars || {};
  const has = (code) => !!chars[code];
  const rawSetText = bt.setText.bind(bt);
  const scale = () => bt.fontSize / FONT_META.size;
  let colour = colorToInt(color);
  let wantShadow = shadow;
  const applyShadow = () => {
    if (typeof bt.setDropShadow !== 'function') return;
    if (wantShadow) bt.setDropShadow(0, scale(), PX.ink, 1); else bt.setDropShadow(0, 0, 0, 0);
  };
  Object.assign(bt, {
    isPixelText: true,
    setText(v) { rawSetText(normalizeForFont(Array.isArray(v) ? v.join('\n') : v, has)); return bt; },
    setColor(c) { colour = colorToInt(c); bt.setTint(colour); return bt; },
    setFill(c) { if (typeof c === 'string' || typeof c === 'number') bt.setColor(c); return bt; },
    getColor() { return colour; },
    setShadow(dx = 0, dy = 0, _c, blur = 0) {
      // Soft glows have no pixel equivalent: keep the hard ink drop shadow.
      wantShadow = true; if (dx === 0 && dy === 0 && !blur) wantShadow = false;
      applyShadow(); return bt;
    },
    setPixelShadow(on = true) { wantShadow = !!on; applyShadow(); return bt; },
    setWordWrapWidth(w) { bt.setMaxWidth(Math.max(0, w || 0)); return bt; },
    setPixelSize(s) { bt.setFontSize(s); applyShadow(); return bt; },
    setFontStyle() { return bt; },
    setStroke() { return bt; },
    setPadding() { return bt; },
    setResolution() { return bt; },
    setBackgroundColor() { return bt; },
    setStyle(st = {}) { if (st.color) bt.setColor(st.color); return bt; },
    setAlign(a) {
      if (a === 'center') bt.setCenterAlign(); else if (a === 'right') bt.setRightAlign(); else bt.setLeftAlign();
      return bt;
    }
  });
  bt.setAlign(align);
  if (lineSpacing) bt.setLineSpacing(lineSpacing);
  if (maxWidth > 0) bt.setMaxWidth(maxWidth);
  bt.setText(str);
  bt.setColor(color);
  applyShadow();
  return bt;
}

/** Logical font size for a target cap height in css px (snaps to an integer art scale). */
export function pixelFontSize(cssScale, unit = 1) {
  return FONT_META.size * Math.max(1, Math.round(cssScale)) * unit;
}

/* —— panels / icons ————————————————————————————————————————————————— */

/**
 * 9-slice panel as a Container of 9 Images (works on WebGL and Canvas). (x, y) = top-left.
 * px = logical units per art pixel (corner size = slice * px). Returns the Container with
 * resize(w, h), setSkin(skin), setTintAll(color) and the current .skin / .pw / .ph.
 */
export function pixelPanel(scene, x, y, w, h, skin = 'panel-dark', { px = 2 } = {}) {
  const c = scene.add.container(x, y);
  const parts = [];
  const ok = hasUiAtlas(scene) && ensureNineFrames(scene, skin);
  if (!ok) {
    const r = scene.add.rectangle(0, 0, w, h, PX.night, 1).setOrigin(0).setStrokeStyle(Math.max(1, px), PX.slate, 1);
    c.add(r);
    Object.assign(c, { skin, pw: w, ph: h, resize(nw, nh) { r.setSize(nw, nh); c.pw = nw; c.ph = nh; return c; }, setSkin() { return c; }, setTintAll() { return c; } });
    return c;
  }
  for (let i = 0; i < 9; i++) { const im = scene.add.image(0, 0, UI_ATLAS, `${skin}#${i}`).setOrigin(0); parts.push(im); }
  c.add(parts);
  const layout = () => {
    const W = Math.max(1, Math.round(c.pw)); const H = Math.max(1, Math.round(c.ph));
    const s = NINE_SLICES[c.skin].slice;
    const cw = Math.min(Math.round(s * px), Math.floor(W / 2)); const ch = Math.min(Math.round(s * px), Math.floor(H / 2));
    const xs = [0, cw, W - cw]; const ws = [cw, W - 2 * cw, cw];
    const ys = [0, ch, H - ch]; const hs = [ch, H - 2 * ch, ch];
    for (let r = 0; r < 3; r++) {
      for (let k = 0; k < 3; k++) {
        const im = parts[r * 3 + k];
        const vis = ws[k] > 0 && hs[r] > 0;
        im.setVisible(vis);
        if (vis) im.setPosition(xs[k], ys[r]).setDisplaySize(ws[k], hs[r]);
      }
    }
  };
  Object.assign(c, {
    skin, pw: w, ph: h, isPixelPanel: true,
    resize(nw, nh) { c.pw = nw; c.ph = nh; layout(); return c; },
    setSkin(next) {
      if (!next || next === c.skin || !ensureNineFrames(scene, next)) return c;
      c.skin = next;
      parts.forEach((im, i) => im.setFrame(`${next}#${i}`));
      layout();
      return c;
    },
    setTintAll(t) { parts.forEach((im) => (t == null ? im.clearTint() : im.setTint(t))); return c; }
  });
  layout();
  return c;
}

/** Frame name for an icon: ui-<name>[-24][-m]. */
export function iconFrame(name, { big = false, mono = false } = {}) {
  const n = UI_ICON_NAMES.includes(name) ? name : 'star';
  return `ui-${n}${big ? '-24' : ''}${mono ? '-m' : ''}`;
}

/**
 * Icon Image centred on (x, y). px = logical units per art pixel; big = 24 px art (else 16).
 * tint: null = full-colour art; a colour = greyscale variant tinted (keeps the light/shade ramp).
 */
export function uiIcon(scene, x, y, name, { px = 2, big = false, tint = null } = {}) {
  if (!hasUiAtlas(scene)) return scene.add.rectangle(x, y, (big ? 24 : 16) * px, (big ? 24 : 16) * px, colorToInt(tint ?? PX.mist), 0.6);
  const im = scene.add.image(x, y, UI_ATLAS, iconFrame(name, { big, mono: tint != null })).setScale(px);
  if (tint != null) im.setTint(colorToInt(tint));
  return im;
}

/** Sprite from the atlas (slider-thumb, toggle-on/off, bubble-tail, cursor, px). */
export function uiSprite(scene, x, y, name, { px = 2 } = {}) {
  if (!hasUiAtlas(scene)) return scene.add.rectangle(x, y, (UI_SPRITES[name]?.[0] || 8) * px, (UI_SPRITES[name]?.[1] || 8) * px, PX.mist, 1);
  return scene.add.image(x, y, UI_ATLAS, name).setScale(px);
}

/** Checkerboard dither over a rect (top-left x, y). Classic pixel "dim": tint = ink, alpha ~0.5. */
export function ditherFill(scene, x, y, w, h, { px = 2, color = PX.ink, alpha = 0.5 } = {}) {
  if (!scene.textures.exists(UI_DITHER)) return scene.add.rectangle(x, y, w, h, color, alpha * 0.5).setOrigin(0);
  const t = scene.add.tileSprite(x, y, w, h, UI_DITHER).setOrigin(0).setTint(color).setAlpha(alpha);
  t.setTileScale(px, px);
  return t;
}

/** Engraved 1 art px divider (ink line + slate line below), from (x, y) to the right, w long. */
export function pixelDivider(scene, x, y, w, { px = 2, dark = PX.ink, light = PX.slate } = {}) {
  const g = scene.add.graphics();
  g.fillStyle(dark, 1); g.fillRect(x, y, w, px);
  g.fillStyle(light, 1); g.fillRect(x, y + px, w, px);
  return g;
}
