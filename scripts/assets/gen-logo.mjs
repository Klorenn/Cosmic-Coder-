#!/usr/bin/env node
/**
 * Pixel logotype "COSMIC CODER" (ui/arena-pixel-v3). Deterministic, no antialiasing.
 *
 *   public/assets/UI/pixel/logo.png   1x art (TitleScene shows it NEAREST at an integer css scale)
 *
 *   node scripts/assets/gen-logo.mjs           # write the PNG
 *   node scripts/assets/gen-logo.mjs --sheet   # also scripts/evil-player/reports/logo-sheet.png (4x preview)
 *
 * Letters are chunky 7x9 glyphs (2 px strokes). Each word gets: a 2-tone face (light upper half with a
 * highlight edge, dark lower half), a 2 px violet extrusion under the baseline, a 1 px ink outline and a hard ink drop
 * shadow. "COSMIC" is cyan, "CODER" is white/mist; a few white glints sit on the top-left corners.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Grid, PAL, FAM, gridToPng } from './gen-ui.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = join(ROOT, 'public/assets/UI/pixel');

/** 7x9 chunky glyphs ('#' = face). */
export const LOGO_GLYPHS = {
  C: ['.#####.', '#######', '##...##', '##.....', '##.....', '##.....', '##...##', '#######', '.#####.'],
  O: ['.#####.', '#######', '##...##', '##...##', '##...##', '##...##', '##...##', '#######', '.#####.'],
  S: ['.######', '#######', '##.....', '######.', '.######', '.....##', '.....##', '#######', '######.'],
  M: ['##...##', '###.###', '#######', '##.#.##', '##...##', '##...##', '##...##', '##...##', '##...##'],
  I: ['######', '######', '..##..', '..##..', '..##..', '..##..', '..##..', '######', '######'],
  D: ['######.', '#######', '##...##', '##...##', '##...##', '##...##', '##...##', '#######', '######.'],
  E: ['#######', '#######', '##.....', '##.....', '######.', '##.....', '##.....', '#######', '#######'],
  R: ['######.', '#######', '##...##', '##...##', '#######', '######.', '##.##..', '##..##.', '##...##']
};

const GLYPH_H = 9;
const LETTER_GAP = 1;
const WORD_GAP = 5;
const EXTRUDE = 2;
const MARGIN = 2; // outline + shadow room

const WORD_STYLES = [
  { light: FAM.cyan.l, face: PAL.cyan, dark: PAL.cyanD },
  { light: PAL.white, face: '#e6e9ff', dark: PAL.mist }
];

/** Layout of a string: [{ ch, x, word }] in glyph space (no margins). */
export function layoutLogo(text) {
  const out = [];
  let x = 0;
  let word = 0;
  for (const ch of String(text).toUpperCase()) {
    if (ch === ' ') { x += WORD_GAP - LETTER_GAP; word++; continue; }
    const g = LOGO_GLYPHS[ch];
    if (!g) continue;
    out.push({ ch, x, word });
    x += g[0].length + LETTER_GAP;
  }
  return { letters: out, width: Math.max(0, x - LETTER_GAP) };
}

export function supportsLogo(text) {
  return [...String(text).toUpperCase()].every((ch) => ch === ' ' || LOGO_GLYPHS[ch]);
}

export function renderLogo(text = 'COSMIC CODER') {
  const { letters, width } = layoutLogo(text);
  const W = width + MARGIN * 2 + 1;
  const H = GLYPH_H + EXTRUDE + MARGIN * 2 + 1;
  const face = new Grid(W, H); // word index + 1 per face pixel
  for (const l of letters) {
    LOGO_GLYPHS[l.ch].forEach((row, y) => [...row].forEach((c, x) => { if (c === '#') face.set(MARGIN + l.x + x, MARGIN + y, l.word + 1); }));
  }
  const isFace = (x, y) => !!face.get(x, y);
  const g = new Grid(W, H);
  // extrusion only below the baseline (holes stay ink so the letters read cleanly at 1x)
  const base = MARGIN + GLYPH_H;
  const body = (x, y) => isFace(x, y) || (y >= base && ((EXTRUDE >= 1 && isFace(x, y - 1)) || (EXTRUDE >= 2 && isFace(x, y - 2))));
  // hard drop shadow (ink, +1 x +1 y of the extruded body)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (body(x - 1, y - 1)) g.set(x, y, PAL.ink);
  // outline around face + extrusion
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (body(x, y)) continue;
    if (body(x - 1, y) || body(x + 1, y) || body(x, y - 1) || body(x, y + 1)) g.set(x, y, PAL.ink);
  }
  // extrusion (violet, darker on the lower row)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (isFace(x, y) || !body(x, y)) continue;
    g.set(x, y, isFace(x, y - 1) ? PAL.violet : PAL.violetD);
  }
  // face: 2-tone band (upper half light, lower half dark) + 1 px highlight on top edges, white glints
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const w = face.get(x, y);
    if (!w) continue;
    const st = WORD_STYLES[(w - 1) % WORD_STYLES.length];
    const gy = y - MARGIN; // glyph row 0..8
    let c = gy <= 4 ? st.face : st.dark;
    if (!isFace(x, y - 1) && gy <= 4) c = st.light;
    if (!isFace(x, y - 1) && !isFace(x - 1, y) && gy <= 1) c = PAL.white;
    g.set(x, y, c);
  }
  return g;
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const g = renderLogo('COSMIC CODER');
  writeFileSync(join(OUT, 'logo.png'), await gridToPng(g, 1));
  process.stdout.write(`logo ${g.w}x${g.h} -> public/assets/UI/pixel/logo.png\n`);
  if (process.argv.includes('--sheet')) {
    const dir = join(ROOT, 'scripts/evil-player/reports');
    mkdirSync(dir, { recursive: true });
    const sheet = new Grid(g.w + 4, g.h + 4);
    sheet.rect(0, 0, sheet.w, sheet.h, PAL.night);
    sheet.blit(g, 2, 2);
    writeFileSync(join(dir, 'logo-sheet.png'), await gridToPng(sheet, 6));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((e) => { process.stderr.write(`${e?.stack || e}\n`); process.exit(1); });
}
