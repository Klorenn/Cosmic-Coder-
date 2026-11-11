#!/usr/bin/env node
/**
 * Deterministic generator for pickup / interactable art (ui/gameover-items-portals-v2):
 *
 *   public/assets/sprites/items/item-<id>.png        32x32   power-up icons: PIXEL ART (ui/pixel-kit-v3) —
 *                                                     bevelled rarity frame (1 px rarity border + 1 px
 *                                                     highlight) around a 24 px outlined, auto-shaded symbol
 *                                                     drawn with the same raster engine as the UI icons
 *   public/assets/sprites/items/fx-glow.png          128x128 white radial glow (tinted at runtime)
 *   public/assets/sprites/items/shrine-<id>.png      72x108  floating shrine crystal per shrine type
 *   public/assets/sprites/items/shrine-pedestal.png  152x76  neutral shrine pedestal
 *   public/assets/sprites/map/portal-a.png           8 x 128x128 strip (cyan teleporter)
 *   public/assets/sprites/map/portal-b.png           8 x 128x128 strip (magenta teleporter)
 *
 *   node scripts/assets/gen-items.mjs           # write every PNG
 *   node scripts/assets/gen-items.mjs --sheet   # also a contact sheet at scripts/evil-player/reports/items-sheet.png
 *
 * Item icons are hard pixels (no antialiasing; keep NEAREST). Glow / shrine / portal art below is still
 * vector (SVG) rendered by sharp at 4x and downsampled with lanczos3 (smooth map FX).
 * Portal strips loop because every time-dependent term is periodic in t = frame / FRAMES.
 */
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ITEMS } from '../../src/data/items.js';
import ShrineManager from '../../src/systems/ShrineManager.js';
import { Grid, paintBox, renderIcon, gridToPng, PAL, FAM } from './gen-ui.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const ITEM_DIR = join(ROOT, 'public/assets/sprites/items');
const MAP_DIR = join(ROOT, 'public/assets/sprites/map');
const SHEET = process.argv.includes('--sheet');
const SS = 4; // supersampling factor
const ICON = 32;
const PORTAL = 128;
const PORTAL_FRAMES = 8;
const TAU = Math.PI * 2;

// ---------------------------------------------------------------- colour helpers
const toHex = (n) => `#${n.toString(16).padStart(6, '0')}`;
const rgb = (h) => {
  const s = h.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16));
};
const mix = (a, b, k) => {
  const A = rgb(a);
  const B = rgb(b);
  return `#${A.map((v, i) => Math.round(v + (B[i] - v) * k).toString(16).padStart(2, '0')).join('')}`;
};
const f = (n) => Number(n.toFixed(2));

// ---------------------------------------------------------------- render helpers
async function svgToPng(svg, w, h) {
  return sharp(Buffer.from(svg), { density: 72 * SS })
    .resize(w, h, { kernel: 'lanczos3', fit: 'fill' })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

async function writeStrip(frames, w, h, file) {
  const strip = await sharp({ create: { width: w * frames.length, height: h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(frames.map((input, i) => ({ input, left: i * w, top: 0 })))
    .png({ compressionLevel: 9 })
    .toBuffer();
  await sharp(strip).toFile(file);
}

// ---------------------------------------------------------------- pixel item icons (32x32)
/** Item id -> UI icon shape (scripts/assets/gen-ui.mjs ICONS). */
export const ITEM_SYMBOL = {
  health_patch: 'heart', cache_hit: 'chip', bits_bag: 'bag', magnet: 'magnet', overclock: 'bolt',
  firewall: 'shield', root_access: 'key', garbage_collector: 'trash', hotfix: 'wrench', stack_overflow: 'burst'
};
const RARITY_FRAME = {
  common: { l: PAL.white, b: PAL.mist, d: PAL.periw },
  rare: FAM.cyan,
  epic: FAM.violet,
  legendary: FAM.amber
};

function pixelItemIcon(id, rarity) {
  const sym = ITEM_SYMBOL[id];
  if (!sym) throw new Error(`missing pixel symbol for item ${id}`);
  const f = RARITY_FRAME[rarity] || RARITY_FRAME.common;
  const g = new Grid(ICON, ICON);
  // ink outline, 1 px rarity border (lit on top), 1 px inner highlight, dark well.
  paintBox(g, 0, 0, ICON, ICON, {
    chamfer: 3,
    rings: [PAL.ink, { t: f.l, l: f.b, b: f.d, r: f.d }, { t: f.b, l: f.d, b: PAL.ink, r: PAL.ink }],
    fill: PAL.night
  });
  // faint rarity tint in the well's lower half (2 rows, flat) so the tier reads at a glance.
  g.rect(3, ICON - 6, ICON - 6, 2, PAL.dusk);
  g.blit(renderIcon(sym, 24), 4, 4);
  return g;
}

// ---------------------------------------------------------------- fx glow
function glowSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
  <defs><radialGradient id="g" cx="50%" cy="50%" r="50%">
    <stop offset="0" stop-color="#ffffff" stop-opacity="0.95"/>
    <stop offset="0.22" stop-color="#ffffff" stop-opacity="0.62"/>
    <stop offset="0.48" stop-color="#ffffff" stop-opacity="0.24"/>
    <stop offset="0.75" stop-color="#ffffff" stop-opacity="0.06"/>
    <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
  </radialGradient></defs>
  <rect width="128" height="128" fill="url(#g)"/>
</svg>`;
}

// ---------------------------------------------------------------- shrine
function crystalSvg(color) {
  const c = toHex(color);
  const light = mix(c, '#ffffff', 0.55);
  const mid = mix(c, '#ffffff', 0.12);
  const dark = mix(c, '#0b1020', 0.45);
  const deeper = mix(c, '#0b1020', 0.7);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="72" height="108" viewBox="0 0 72 108">
  <defs>
    <filter id="b" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="3"/></filter>
    <linearGradient id="core" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${light}"/><stop offset="1" stop-color="${c}"/>
    </linearGradient>
  </defs>
  <polygon points="36,8 56,34 50,86 36,100 22,86 16,34" fill="${c}" opacity="0.55" filter="url(#b)"/>
  <polygon points="36,8 56,34 36,40" fill="${light}"/>
  <polygon points="36,8 16,34 36,40" fill="${mid}"/>
  <polygon points="16,34 36,40 36,100 22,86" fill="${dark}"/>
  <polygon points="56,34 36,40 36,100 50,86" fill="url(#core)"/>
  <polygon points="16,34 22,86 36,100 50,86 56,34 36,8" fill="none" stroke="${light}" stroke-width="1.6" stroke-linejoin="round"/>
  <path d="M36 40 V100" stroke="${deeper}" stroke-width="1" opacity="0.5"/>
  <path d="M41 46 L44 76" stroke="#ffffff" stroke-width="2.4" stroke-linecap="round" opacity="0.75"/>
  <path d="M30 18 L24 31" stroke="#ffffff" stroke-width="2" stroke-linecap="round" opacity="0.85"/>
</svg>`;
}

function pedestalSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="152" height="76" viewBox="0 0 152 76">
  <defs>
    <linearGradient id="side" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#1e293b"/><stop offset="1" stop-color="#0b1020"/>
    </linearGradient>
    <radialGradient id="top" cx="50%" cy="40%" r="60%">
      <stop offset="0" stop-color="#334155"/><stop offset="1" stop-color="#151c2e"/>
    </radialGradient>
    <filter id="s" x="-20%" y="-50%" width="140%" height="200%"><feGaussianBlur stdDeviation="3"/></filter>
  </defs>
  <ellipse cx="76" cy="60" rx="64" ry="11" fill="#000" opacity="0.5" filter="url(#s)"/>
  <path d="M18 28 V44 A58 16 0 0 0 134 44 V28 Z" fill="url(#side)"/>
  <ellipse cx="76" cy="28" rx="58" ry="16" fill="url(#top)"/>
  <ellipse cx="76" cy="28" rx="58" ry="16" fill="none" stroke="#ffffff" stroke-opacity="0.22" stroke-width="1.5"/>
  <ellipse cx="76" cy="28" rx="40" ry="10.5" fill="none" stroke="#ffffff" stroke-opacity="0.18" stroke-width="1.2" stroke-dasharray="6 5"/>
  <path d="M18 44 A58 16 0 0 0 134 44" fill="none" stroke="#ffffff" stroke-opacity="0.1" stroke-width="1"/>
</svg>`;
}

// ---------------------------------------------------------------- portal
function portalSvg(color, t) {
  const c = color;
  const light = mix(c, '#ffffff', 0.6);
  const deep = mix(c, '#0b1020', 0.75);
  const cx = 64;
  const cy = 64;
  const rot1 = f(t * 120); // 3-fold ring: loops after 120 deg
  const rot2 = f(-t * 60); // 6-fold ring
  const swirl = f(-t * 120);
  const pulse = Math.sin(t * TAU);
  const coreR = f(15 + 2.5 * pulse);

  // particles drifting inward along a spiral; phase wraps so the strip loops
  const parts = [];
  for (let i = 0; i < 12; i++) {
    const p = (t + i / 12 + (i % 3) * 0.04) % 1;
    const a = i * 2.39996 + p * 1.6; // golden-angle spread
    const r = 56 - p * 38;
    const op = f(Math.sin(Math.PI * p) * 0.95);
    const sz = f(1.3 + (i % 3) * 0.5);
    parts.push(`<circle cx="${f(cx + Math.cos(a) * r)}" cy="${f(cy + Math.sin(a) * r)}" r="${sz}" fill="${i % 2 ? '#ffffff' : light}" opacity="${op}"/>`);
  }

  const arm = (deg) => `<path d="M0 0 Q 16 -6 22 8 Q 25 18 18 26" transform="rotate(${deg})" fill="none" stroke="${light}" stroke-width="3" stroke-linecap="round" opacity="0.55"/>`;
  const C1 = TAU * 40;
  const C2 = TAU * 32;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${PORTAL}" height="${PORTAL}" viewBox="0 0 128 128">
  <defs>
    <radialGradient id="halo" cx="50%" cy="50%" r="50%">
      <stop offset="0.45" stop-color="${c}" stop-opacity="0.38"/>
      <stop offset="0.75" stop-color="${c}" stop-opacity="0.12"/>
      <stop offset="1" stop-color="${c}" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="void" cx="50%" cy="50%" r="50%">
      <stop offset="0" stop-color="${deep}" stop-opacity="0.35"/>
      <stop offset="0.8" stop-color="#0b1020" stop-opacity="0.8"/>
      <stop offset="1" stop-color="#0b1020" stop-opacity="0.9"/>
    </radialGradient>
    <radialGradient id="core" cx="50%" cy="50%" r="50%">
      <stop offset="0" stop-color="#ffffff" stop-opacity="1"/>
      <stop offset="0.35" stop-color="${light}" stop-opacity="0.85"/>
      <stop offset="1" stop-color="${c}" stop-opacity="0"/>
    </radialGradient>
    <filter id="blur" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="2.2"/></filter>
    <filter id="blur2" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="1"/></filter>
  </defs>
  <circle cx="64" cy="64" r="63" fill="url(#halo)"/>
  <circle cx="64" cy="64" r="38" fill="url(#void)"/>
  <g transform="translate(64 64) rotate(${swirl})">${arm(0)}${arm(120)}${arm(240)}</g>
  <circle cx="64" cy="64" r="${coreR}" fill="url(#core)"/>
  <circle cx="64" cy="64" r="40" fill="none" stroke="${c}" stroke-width="9" opacity="0.6" filter="url(#blur)"
    stroke-dasharray="${f(C1 / 3 * 0.7)} ${f(C1 / 3 * 0.3)}" transform="rotate(${rot1} 64 64)"/>
  <circle cx="64" cy="64" r="40" fill="none" stroke="${c}" stroke-width="5"
    stroke-dasharray="${f(C1 / 3 * 0.7)} ${f(C1 / 3 * 0.3)}" stroke-linecap="round" transform="rotate(${rot1} 64 64)"/>
  <circle cx="64" cy="64" r="40" fill="none" stroke="#ffffff" stroke-width="1.6" opacity="0.9"
    stroke-dasharray="${f(C1 / 3 * 0.45)} ${f(C1 / 3 * 0.55)}" stroke-linecap="round" transform="rotate(${f(rot1 + 12)} 64 64)"/>
  <circle cx="64" cy="64" r="32" fill="none" stroke="${light}" stroke-width="2.2" opacity="0.75"
    stroke-dasharray="${f(C2 / 6 * 0.55)} ${f(C2 / 6 * 0.45)}" stroke-linecap="round" transform="rotate(${rot2} 64 64)"/>
  <circle cx="64" cy="64" r="46" fill="none" stroke="${c}" stroke-width="1.2" opacity="0.45" filter="url(#blur2)"/>
  ${parts.join('\n  ')}
</svg>`;
}

// ---------------------------------------------------------------- main
async function main() {
  mkdirSync(ITEM_DIR, { recursive: true });
  mkdirSync(MAP_DIR, { recursive: true });
  const sheet = [];

  for (const item of Object.values(ITEMS)) {
    const png = await gridToPng(pixelItemIcon(item.id, item.rarity));
    await sharp(png).toFile(join(ITEM_DIR, `item-${item.id}.png`));
    sheet.push(png);
  }

  await sharp(await svgToPng(glowSvg(), 128, 128)).toFile(join(ITEM_DIR, 'fx-glow.png'));
  for (const s of Object.values(ShrineManager.SHRINES)) {
    await sharp(await svgToPng(crystalSvg(s.color), 72, 108)).toFile(join(ITEM_DIR, `shrine-${s.id}.png`));
  }
  await sharp(await svgToPng(pedestalSvg(), 152, 76)).toFile(join(ITEM_DIR, 'shrine-pedestal.png'));

  for (const [name, color] of [['a', '#22d3ee'], ['b', '#e879f9']]) {
    const frames = [];
    for (let i = 0; i < PORTAL_FRAMES; i++) frames.push(await svgToPng(portalSvg(color, i / PORTAL_FRAMES), PORTAL, PORTAL));
    await writeStrip(frames, PORTAL, PORTAL, join(MAP_DIR, `portal-${name}.png`));
    if (SHEET) sheet.push(...frames.slice(0, 2));
  }

  if (SHEET) {
    const cols = 6;
    const cell = 128;
    const rows = Math.ceil(sheet.length / cols);
    const out = join(ROOT, 'scripts/evil-player/reports/items-sheet.png');
    await sharp({ create: { width: cols * cell, height: rows * cell, channels: 4, background: { r: 11, g: 16, b: 32, alpha: 1 } } })
      .composite(sheet.map((input, i) => ({ input, left: (i % cols) * cell + 16 * (i < 10 ? 1 : 0), top: Math.floor(i / cols) * cell + 16 * (i < 10 ? 1 : 0) })))
      .png()
      .toFile(out);
    process.stdout.write(`sheet -> ${out}\n`);
  }
  process.stdout.write(`items: ${Object.keys(ITEMS).length}, shrines: ${Object.keys(ShrineManager.SHRINES).length}, portals: 2 x ${PORTAL_FRAMES} frames\n`);
}

main().catch((e) => {
  process.stderr.write(`${e?.stack || e}\n`);
  process.exit(1);
});
