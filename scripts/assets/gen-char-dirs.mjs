#!/usr/bin/env node
/**
 * Cosmic Coder — front (walk-down) and back (walk-up) walk cycles for the 3 playable characters.
 *
 *   node scripts/assets/gen-char-dirs.mjs           # writes player/<char>-walk-{down,up}.png + contact sheet
 *   node scripts/assets/gen-char-dirs.mjs --sheet   # same (the 3x contact sheet is always written)
 *
 * Method (deterministic, no new palette colours):
 *  - VoidNull (destroyer) / SyncStorm (swordsman): the front pose IS the CraftPix idle (3/4 front view),
 *    so the upper body is taken from the idle frames (keeps the artist's pixels, lightning flicker
 *    included). The back pose is the same idle frame with the face / chest details repainted in the
 *    armour colours, mirrored, plus a few back details (seams, vents, spine).
 *  - VibeCoder (robot): the CraftPix sheets only have a profile view, so a front and a back pose are
 *    hand-drawn below as pixel matrices with the robot's exact palette, proportions (wedge head, red
 *    neck ring, cream shell, blue cable pack, dark blaster) and 1px #010102 outline.
 *  - Walk cycle (8 frames, 12 fps): contact / lift / passing / down for each leg. Legs are re-timed by
 *    row resampling: the thigh band is squashed or stretched (dropping/duplicating the most redundant
 *    rows) while knee + shin + foot stay rigid, so a lifted leg reads as foreshortened in a front view.
 *    The upper body bobs 1-2 px (highest on the passing frames), arms swing opposite to the legs.
 *  - A final pass closes the 1px outline wherever a leg/arm moved away from a shared outline.
 *
 * Sizes / keys come from CHARACTER_DIR_SHEETS in src/scenes/boot/characterAssets.js.
 * Contact sheet (3x): scripts/evil-player/reports/char-dirs-sheet.png
 */
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHARACTER_DIR_SHEETS } from '../../src/scenes/boot/characterAssets.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SPRITES = path.join(ROOT, 'public/assets/sprites');
const REPORTS = path.join(ROOT, 'scripts/evil-player/reports');
const FS = 128;
const OUTLINE = [1, 1, 2, 255];

// ---------------------------------------------------------------------------
// Tiny RGBA image helpers
// ---------------------------------------------------------------------------
const blank = () => ({ w: FS, h: FS, d: new Uint8ClampedArray(FS * FS * 4) });
const clone = (im) => ({ w: im.w, h: im.h, d: new Uint8ClampedArray(im.d) });
const inb = (x, y) => x >= 0 && y >= 0 && x < FS && y < FS;
const get = (im, x, y) => (inb(x, y) ? Array.from(im.d.subarray((y * FS + x) * 4, (y * FS + x) * 4 + 4)) : [0, 0, 0, 0]);
const set = (im, x, y, c) => {
  if (!inb(x, y)) return;
  im.d.set(c, (y * FS + x) * 4);
};
const solid = (c) => c[3] >= 16;
const isOutline = (c) => solid(c) && c[0] < 8 && c[1] < 8 && c[2] < 8;
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16), 255];
const sameRow = (a, b) => a.every((c, i) => c.join() === b[i].join());

async function loadFrame(file, k) {
  const src = path.join(SPRITES, file);
  const meta = await sharp(src).metadata();
  const n = Math.round(meta.width / FS);
  const left = (k % n) * FS;
  const raw = await sharp(src).extract({ left, top: 0, width: FS, height: FS }).ensureAlpha().raw().toBuffer();
  const im = blank();
  im.d.set(raw);
  return { im, n };
}

function flipX(im) {
  const out = blank();
  for (let y = 0; y < FS; y++) for (let x = 0; x < FS; x++) set(out, FS - 1 - x, y, get(im, x, y));
  return out;
}

/** Resample `src` rows (arrays of pixels) to `n` rows, dropping / duplicating the most redundant rows. */
function resampleRows(rows, n) {
  if (n === rows.length || rows.length === 0) return rows.slice();
  if (n <= 0) return [];
  const out = rows.slice();
  // redundancy score: identical to the next row = 0, otherwise number of differing pixels
  const score = (arr, i) => {
    if (i <= 0 || i >= arr.length - 1) return Infinity;
    let d = 0;
    for (let x = 0; x < arr[i].length; x++) if (arr[i][x].join() !== arr[i + 1][x].join()) d++;
    return d;
  };
  while (out.length > n) {
    let best = -1;
    let bs = Infinity;
    // prefer the middle of the band when scores tie (keeps hip + knee joints)
    const mid = (out.length - 1) / 2;
    for (let i = 1; i < out.length - 1; i++) {
      const s = score(out, i) + Math.abs(i - mid) * 0.01;
      if (s < bs) {
        bs = s;
        best = i;
      }
    }
    out.splice(best === -1 ? Math.floor(out.length / 2) : best, 1);
  }
  while (out.length < n) {
    let best = -1;
    let bs = Infinity;
    const mid = (out.length - 1) / 2;
    for (let i = 1; i < out.length - 1; i++) {
      const s = score(out, i) + Math.abs(i - mid) * 0.01;
      if (s < bs) {
        bs = s;
        best = i;
      }
    }
    const i = best === -1 ? Math.floor(out.length / 2) : best;
    out.splice(i, 0, out[i].map((c) => c.slice()));
  }
  return out;
}

/**
 * Re-time a vertical limb living in columns [x0,x1], rows [y0,y1] of `src` into `dst`.
 * Rows [y0, rigidY) are elastic, [rigidY, y1] are rigid (moved up by `lift`). The limb top moves up by `top`.
 */
function retimeLimb(src, dst, { x0, x1, y0, y1, rigidY }, top, lift, filter = () => true) {
  const take = (y) => {
    const row = [];
    for (let x = x0; x <= x1; x++) {
      const c = get(src, x, y);
      row.push(filter(x, y, c) ? c : [0, 0, 0, 0]);
    }
    return row;
  };
  const elastic = [];
  for (let y = y0; y < rigidY; y++) elastic.push(take(y));
  const rigid = [];
  for (let y = rigidY; y <= y1; y++) rigid.push(take(y));
  const newTop = y0 - top;
  const newRigid = rigidY - lift;
  const el = resampleRows(elastic, Math.max(0, newRigid - newTop));
  const put = (row, y) => row.forEach((c, i) => solid(c) && set(dst, x0 + i, y, c));
  el.forEach((row, i) => put(row, newTop + i));
  rigid.forEach((row, i) => put(row, newRigid + i));
}

/** Move every pixel of `src` inside box by (dx,dy) into dst (box pixels are cleared from dst first). */
function shiftBox(src, dst, { x0, x1, y0, y1 }, dx, dy) {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (solid(get(src, x, y))) set(dst, x, y, [0, 0, 0, 0]);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const c = get(src, x, y);
    if (solid(c)) set(dst, x + dx, y + dy, c);
  }
}

/** Close the outline: transparent pixels touching a coloured (non-outline) pixel become outline. */
function closeOutline(im) {
  const add = [];
  for (let y = 0; y < FS; y++) for (let x = 0; x < FS; x++) {
    if (solid(get(im, x, y))) continue;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const c = get(im, x + dx, y + dy);
      if (solid(c) && !isOutline(c)) {
        add.push([x, y]);
        break;
      }
    }
  }
  for (const [x, y] of add) set(im, x, y, OUTLINE);
  return im;
}

/** Repaint pixels inside box. `map` keys are hex colours (or '#inner' for interior outline pixels). */
function repaint(im, { x0, x1, y0, y1 }, map) {
  const src = clone(im);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const c = get(src, x, y);
    if (!solid(c)) continue;
    const h = '#' + c.slice(0, 3).map((v) => v.toString(16).padStart(2, '0')).join('');
    if (isOutline(c)) {
      if (!map['#inner']) continue;
      const interior = [[1, 0], [-1, 0], [0, 1], [0, -1]].every(([dx, dy]) => solid(get(src, x + dx, y + dy)));
      if (interior) set(im, x, y, hex(map['#inner']));
      continue;
    }
    const to = map[h] || map['*'];
    if (to) set(im, x, y, hex(to));
  }
}

/** Stamp an ASCII overlay at (ox,oy). '.' / ' ' = untouched. */
function stamp(im, ox, oy, rows, pal) {
  rows.forEach((r, y) => [...r].forEach((ch, x) => {
    if (ch === '.' || ch === ' ') return;
    if (ch === '_') return set(im, ox + x, oy + y, [0, 0, 0, 0]);
    set(im, ox + x, oy + y, hex(pal[ch]));
  }));
}

// ---------------------------------------------------------------------------
// VibeCoder (robot): hand-drawn front + back poses (34 px wide grid, x = 47 + col, y = 56 + row)
// ---------------------------------------------------------------------------
const ROBOT_PAL = {
  '#': '#010102',
  b: '#fff3bf', // cream shell
  c: '#ffffff', // highlight
  d: '#445363', // slate (shade / joints)
  e: '#79dc2b', // visor green
  f: '#fffc16', // visor glint
  g: '#2d363f', // backpack
  h: '#87102a', // neck ring red
  r: '#d21a26', // neck ring light
  i: '#003166', // cable blue
  j: '#001a1a', // neck core
  k: '#6a768f', // blaster light
  l: '#201c31' // blaster body
};

// prettier-ignore
const ROBOT_FRONT = [
  '..........##############..........', // 56 head plate (wide wedge seen from the front)
  '.......###cccbbbbbbbbbbbb###.......',
  '.....##cbbbbbbbbbbbbbbbbbbbbd##....',
  '....#cbbbbbbbbbbbbbbbbbbbbbbbbd#...',
  '.....##dbbbbbb########bbbbbbd##....', // 60
  '.......#dbbbb#eeeeefee#bbbbd#......',
  '........#dbbb#eeeeeeee#bbbd#.......',
  '.........#dbbb########bbbd#........',
  '..........##dbbbbbbbbbbd##.........',
  '............###bbbbbb###...........', // 65
  '..............#hhrrhh#.............',
  '..............#jjjjjj#.............',
  '.........#####hhhrrhhh#####........',
  '.......##cccbb#bbbbbbbb#bbbd##.....',
  '......#cbbbbbb#bbbbbbbb#bbbbbd#....', // 70
  '.....#cbbbbbb#cbbbbbbbbb#bbbbbd#...',
  '.....#cbbbbb#cbbbbbbbbbbb#bbbbd#...',
  '.....#bbbbb##cbbbbbbbbbbb##bbbd#...',
  '.....#cbbb#.#cbbbbbbbbbbbd#.#bbd#..',
  '.....#cbbd#.#cbbb####bbbbd#.#bbd#..', // 75
  '.....#cbbd#.#cbb#iiii#bbbd#.#bbd#..',
  '.....#cbbd#.#cbb#iffi#bbbd#.#bbd#..',
  '.....#cbbd#.#cbb#iiii#bbbd#.#bbd#..',
  '.....#cbbd#.#cbbb####bbbbd#.#bbd#..',
  '.....##bd##.#cbbbbbbbbbbbd#.##bd##.', // 80
  '.....#dddd#..#cbbbbbbbbbd#..#dddd#.',
  '.....#cbbd#..##bbbbbbbbb##..#bbbd#.',
  '....##cbbd#...#dddddddddd#..#bbbd#.',
  '...#llcbbd#...#bbbbbbbbbb#..#bbbd#.',
  '...#llcbbd#..#cbbbbbbbbbbd#.#bbbd#.', // 85
  '...#lk#bd#...#cbbbbbbbbbbd#.#bbbd#.',
  '...#lk#####..#cbbbb##bbbbd#..##d##.',
  '...#lkcbbbb#.#cbbbd##dbbbd#.#bbbbb#',
  '...#lkcbbbbb##cbbd#..#dbbd#.#bbbbd#',
  '...#lkcbbbbb##cbbd#..#dbbd#.#bbbbd#', // 90
  '...#lk#bbbb#.#cbbd#..#dbbd#..#bbd#.',
  '...#lk######.#cbbd#..#dbbd#...###..',
  '...#lkl#.....#cbbd#..#dbbd#........',
  '...#lkl#.....#cbbd#..#dbbd#........',
  '...#lkl#.....#cbbd#..#dbbd#........', // 95
  '...#lkl#.....#cbbd#..#dbbd#........',
  '....#kl#.....#cbbd#..#dbbd#........',
  '....#kl#.....#cbbd#..#dbbd#........',
  '....#ll#.....#cbbd#..#dbbd#........',
  '.....##......#cbbd#..#dbbd#........', // 100
  '.............##dd##..##dd##........',
  '.............#dddd#..#dddd#........',
  '.............##dd##..##dd##........',
  '..............#bd#....#bd#.........',
  '..............#bd#....#bd#.........', // 105
  '..............#bd#....#bd#.........',
  '..............#bd#....#bd#.........',
  '..............#bd#....#bd#.........',
  '..............#bd#....#bd#.........',
  '..............#bd#....#bd#.........', // 110
  '..............#bd#....#bd#.........',
  '..............#bd#....#bd#.........',
  '..............#bd#....#bd#.........',
  '..............#bd#....#bd#.........',
  '..............#bd#....#bd#.........', // 115
  '..............#bd#....#bd#.........',
  '..............#bd#....#bd#.........',
  '..............#bd#....#bd#.........',
  '..............#bd#....#bd#.........',
  '..............#bd#....#bd#.........', // 120
  '.............#cbbd#..#cbbd#........',
  '.............#cbbd#..#cbbd#........',
  '............#cbbbd#..#cbbbd#.......',
  '............#ddddd#..#ddddd#.......',
  '............######..#######........', // 125
  '...................................',
  '...................................'
];

// prettier-ignore
const ROBOT_BACK = [
  '..........##############..........', // 56 back of the head plate
  '.......###cccbbbbbbbbbbbb###.......',
  '.....##cbbbbbbbbbbbbbbbbbbbbd##....',
  '....#cbbbbbbbbbbbbbbbbbbbbbbbbd#...',
  '.....##dbbbbbbbbbbbbbbbbbbbd##.....', // 60
  '.......#dbbbbbbb#bbbbbbbbbd#.......',
  '........#dbbbbbb#bbbbbbbbd#........',
  '.........#dbbbbb#bbbbbbbd#.........',
  '..........##dbbbbbbbbbbd##.........',
  '............###bbbbbb###...........', // 65
  '..............#hhrrhh#.............',
  '..............#jjjjjj#.............',
  '.........#####hhhrrhhh#####........',
  '.......##cccb######bbbb#bbbd##.....',
  '......#cbbbb#iggggggi#bbbbbbd#.....', // 70
  '.....#cbbbb#iiggggggii#bbbbbd#.....',
  '.....#cbbb#i#gggggggg#i#bbbbd#.....',
  '.....#cbbb#i#gddddddg#i#bbbbd#.....',
  '.....#cbb#i##gggggggg##i#bbd#......',
  '.....#cbb#i#cgggggggg#.i#bbd#......', // 75
  '.....#cbb#i#cgddddddg#.i#bbd#......',
  '.....#cbb#i#cgggggggg#.i#bbd#......',
  '.....#cbb#i#cgggiigggg#i#bbd#......',
  '.....#cbb##i#gggiiggg#i##bbd#......',
  '.....##bd#.#i########i#.##bd##.....', // 80
  '.....#dddd#.#iiiiiiii#..#dddd#.....',
  '.....#cbbd#.##bbbbbb##..#bbbd#.....',
  '.....#cbbd#..#dddddddd#.#bbbd##....',
  '.....#cbbd#..#bbbbbbbbb##bbbdll#...',
  '.....#cbbd#.#cbbbbbbbbbd#bbbdll#...', // 85
  '.....#cbbd#.#cbbbbbbbbbd#.#bd#kl#..',
  '.....##d##..#cbbbb##bbbd#######kl#.',
  '....#bbbbb#.#cbbbd##dbbd#.#bbbb#kl#',
  '....#bbbbb#.#cbbd#..#dbbd#bbbbb#kl#',
  '....#bbbbb#.#cbbd#..#dbbd#bbbbb#kl#', // 90
  '.....#bbd#..#cbbd#..#dbbd##bbbb#kl#',
  '......###...#cbbd#..#dbbd#.######kl#',
  '............#cbbd#..#dbbd#.....#lkl#',
  '............#cbbd#..#dbbd#.....#lkl#',
  '............#cbbd#..#dbbd#.....#lkl#', // 95
  '............#cbbd#..#dbbd#.....#lkl#',
  '............#cbbd#..#dbbd#.....#lk#.',
  '............#cbbd#..#dbbd#.....#lk#.',
  '............#cbbd#..#dbbd#.....#ll#.',
  '............#cbbd#..#dbbd#......##..', // 100
  '............##dd##..##dd##.........',
  '............#dddd#..#dddd#.........',
  '............##dd##..##dd##.........',
  '.............#bd#....#bd#..........',
  '.............#bd#....#bd#..........', // 105
  '.............#bd#....#bd#..........',
  '.............#bd#....#bd#..........',
  '.............#bd#....#bd#..........',
  '.............#bd#....#bd#..........',
  '.............#bd#....#bd#..........', // 110
  '.............#bd#....#bd#..........',
  '.............#bd#....#bd#..........',
  '.............#bd#....#bd#..........',
  '.............#bd#....#bd#..........',
  '.............#bd#....#bd#..........', // 115
  '.............#bd#....#bd#..........',
  '.............#bd#....#bd#..........',
  '.............#bd#....#bd#..........',
  '.............#bd#....#bd#..........',
  '.............#bd#....#bd#..........', // 120
  '............#cbbd#..#cbbd#.........',
  '............#cbbd#..#cbbd#.........',
  '............#cbbd#..#cbbd#.........',
  '............#dddd#..#dddd#.........',
  '............######..######.........', // 125
  '...................................',
  '...................................'
];

function robotPose(rows) {
  const im = blank();
  stamp(im, 47, 58, rows, ROBOT_PAL);
  return closeOutline(im);
}

// ---------------------------------------------------------------------------
// Character rigs
// ---------------------------------------------------------------------------
// 8-frame cycle: 0 contact(L fwd) 1 lift R 2 pass R 3 down R 4 contact(R fwd) 5 lift L 6 pass L 7 down L
const LIFT_A = [0, 2, 3, 1, 0, 0, 0, 0];
const LIFT_B = [0, 0, 0, 0, 0, 2, 3, 1];
const BOB = [0, 1, 2, 1, 0, 1, 2, 1];
const SWING = [0, -1, -1, 0, 0, 1, 1, 0]; // arm A hand rise (B uses the opposite)

/** Mirror a rig (for back poses built by flipping the front art). */
const mx = (x) => FS - 1 - x;
function mirrorRig(rig) {
  const box = (b) => ({ ...b, x0: mx(b.x1), x1: mx(b.x0) });
  return {
    ...rig,
    legA: box(rig.legB),
    legB: box(rig.legA),
    armA: rig.armB && box(rig.armB),
    armB: rig.armA && box(rig.armA)
  };
}

const RIGS = {
  robot: {
    hipY: 92,
    legA: { x0: 59, x1: 65, y0: 92, y1: 127, rigidY: 103 },
    legB: { x0: 66, x1: 74, y0: 92, y1: 127, rigidY: 103 },
    armA: { x0: 48, x1: 58, y0: 84, y1: 102, rigidY: 88, mode: 'limb' },
    armB: { x0: 74, x1: 83, y0: 84, y1: 102, rigidY: 88, mode: 'limb' }
  },
  destroyer: {
    hipY: 104,
    legA: { x0: 54, x1: 66, y0: 104, y1: 127, rigidY: 114 },
    legB: { x0: 67, x1: 78, y0: 104, y1: 127, rigidY: 114 },
    armA: { x0: 44, x1: 56, y0: 82, y1: 103, rigidY: 88, mode: 'limb' },
    armB: { x0: 76, x1: 83, y0: 84, y1: 103, mode: 'shift' }
  },
  swordsman: {
    hipY: 100,
    legA: { x0: 55, x1: 64, y0: 100, y1: 127, rigidY: 112 },
    legB: { x0: 65, x1: 75, y0: 100, y1: 127, rigidY: 112 },
    armA: { x0: 16, x1: 56, y0: 88, y1: 112, mode: 'shift' },
    armB: { x0: 75, x1: 104, y0: 88, y1: 112, mode: 'shift' }
  }
};

function animateFrame(base, rig, f) {
  const bob = BOB[f];
  const legCols = (x) => (x >= rig.legA.x0 && x <= rig.legA.x1) || (x >= rig.legB.x0 && x <= rig.legB.x1);
  // 1. upper body (everything that is not a leg) bobs up
  const body = blank();
  for (let y = 0; y < FS; y++) for (let x = 0; x < FS; x++) {
    const c = get(base, x, y);
    if (!solid(c)) continue;
    if (y >= rig.hipY && legCols(x)) continue;
    set(body, x, y - bob, c);
  }
  // 2. arms swing opposite to the legs (hand rises = forward / foreshortened)
  const out = clone(body);
  const swing = SWING[f];
  for (const [arm, s] of [[rig.armA, swing], [rig.armB, -swing]]) {
    if (!arm || !s) continue;
    const box = { ...arm, y0: arm.y0 - bob, y1: arm.y1 - bob, rigidY: (arm.rigidY ?? arm.y0) - bob };
    if (arm.mode === 'shift') {
      shiftBox(body, out, box, 0, s < 0 ? -1 : 1);
    } else {
      for (let y = box.y0; y <= box.y1; y++) for (let x = box.x0; x <= box.x1; x++) set(out, x, y, [0, 0, 0, 0]);
      // s<0: hand rises (shorter forearm); s>0: hand drops 1px (longer)
      retimeLimb(body, out, box, 0, s < 0 ? 1 : -1);
    }
  }
  // 3. legs
  retimeLimb(base, out, { ...rig.legA }, bob, LIFT_A[f], (x, y) => y >= rig.hipY);
  retimeLimb(base, out, { ...rig.legB }, bob, LIFT_B[f], (x, y) => y >= rig.hipY);
  return closeOutline(out);
}

// ---------------------------------------------------------------------------
// Back poses for the CraftPix characters: repaint face/chest, mirror, add back details
// ---------------------------------------------------------------------------
const DESTROYER_BACK_PAINT = [
  // helmet: whole faceplate (visor, eye, stripes, cheek lights) -> helmet shell, keep the highlight
  { box: { x0: 61, x1: 75, y0: 51, y1: 60 }, map: { '*': '#b8c0fd', '#d9e1eb': '#d9e1eb', '#inner': '#b8c0fd' } },
  // neck under the helmet -> dark armoured collar
  { box: { x0: 62, x1: 74, y0: 61, y1: 65 }, map: { '*': '#433053' } },
  // chest highlight lines -> flat back plate
  { box: { x0: 50, x1: 74, y0: 63, y1: 100 }, map: { '#d9e1eb': '#b2bad3' } }
];
const SWORDSMAN_BACK_PAINT = [
  // eye + visor on the crescent head
  { box: { x0: 62, x1: 68, y0: 64, y1: 69 }, map: { '#00a0e1': '#b8c0fd', '#6efcda': '#b8c0fd', '#00d7c8': '#b8c0fd', '#inner': '#b8c0fd' } },
  // chest core (amber / orange) -> back plate with a dark spine
  { box: { x0: 58, x1: 76, y0: 84, y1: 96 }, map: { '#ffd62a': '#b8c0fd', '#ff6a00': '#6a768f', '#ffa500': '#6a768f' } },
  { box: { x0: 52, x1: 60, y0: 94, y1: 101 }, map: { '#ffd62a': '#b8c0fd', '#ff6a00': '#6a768f' } }
];

function backFromFront(front, char) {
  const im = clone(front);
  for (const p of char === 'destroyer' ? DESTROYER_BACK_PAINT : SWORDSMAN_BACK_PAINT) repaint(im, p.box, p.map);
  const back = flipX(im);
  if (char === 'destroyer') {
    // helmet: rear seam + vent slits; back: dark reactor pack with orange exhaust vents, spine seam
    stamp(back, 56, 59, ['##########'], { '#': '#433053' });
    stamp(back, 58, 67, [
      '..##########..',
      '.#ffffffffff#.',
      '#ffffffffffff#',
      '#f##########f#',
      '#f#gggggggg#f#',
      '#f##########f#',
      '#f#gggggggg#f#',
      '#f##########f#',
      '.#ffffffffff#.',
      '..#ffffffff#..',
      '...########...',
      '......#.......',
      '......#.......',
      '......#.......',
      '......#.......'
    ], { '#': '#010102', f: '#433053', g: '#ffa500' });
  } else {
    // spine with amber power nodes down the back
    stamp(back, 63, 79, ['#', 'l', '#', 'l', '#', 'l', '#'], { '#': '#010102', l: '#ffa500' });
  }
  return back;
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------
async function basePose(char, dir, f) {
  if (char === 'robot') return robotPose(dir === 'down' ? ROBOT_FRONT : ROBOT_BACK);
  const { im } = await loadFrame(`player/${char}-idle.png`, f % 5);
  return dir === 'down' ? im : backFromFront(im, char);
}

async function buildSheet(entry) {
  const baseRig = RIGS[entry.char];
  const rig = entry.dir === 'up' && entry.char !== 'robot' ? mirrorRig(baseRig) : baseRig;
  const frames = [];
  for (let f = 0; f < entry.frames; f++) {
    // idle frames advance every other walk frame so the lightning / breathing keeps flickering
    const base = await basePose(entry.char, entry.dir, Math.floor(f / 2));
    frames.push(animateFrame(base, rig, f));
  }
  const W = FS * frames.length;
  const out = Buffer.alloc(W * FS * 4);
  frames.forEach((im, k) => {
    for (let y = 0; y < FS; y++) for (let x = 0; x < FS; x++) {
      const c = get(im, x, y);
      if (!solid(c)) continue;
      out.set(c, (y * W + k * FS + x) * 4);
    }
  });
  const file = path.join(SPRITES, entry.file);
  await sharp(out, { raw: { width: W, height: FS, channels: 4 } }).png({ compressionLevel: 9 }).toFile(file);
  return { file, frames };
}

async function contactSheet(results) {
  const S = 3;
  const cw = 96;
  const ch = 80; // crop x 32..96, y 48..128
  const cols = 8;
  const W = cols * cw * S;
  const H = results.length * ch * S;
  const comp = [];
  for (let r = 0; r < results.length; r++) {
    for (let k = 0; k < results[r].frames.length; k++) {
      const im = results[r].frames[k];
      const crop = Buffer.alloc(cw * ch * 4);
      for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) crop.set(get(im, 16 + x, 48 + y), (y * cw + x) * 4);
      const buf = await sharp(crop, { raw: { width: cw, height: ch, channels: 4 } }).resize(cw * S, ch * S, { kernel: 'nearest' }).png().toBuffer();
      comp.push({ input: buf, left: k * cw * S, top: r * ch * S });
    }
  }
  fs.mkdirSync(REPORTS, { recursive: true });
  const file = path.join(REPORTS, 'char-dirs-sheet.png');
  await sharp({ create: { width: W, height: H, channels: 4, background: { r: 52, g: 58, b: 74, alpha: 1 } } })
    .composite(comp)
    .png()
    .toFile(file);
  return file;
}

async function main() {
  const results = [];
  for (const entry of CHARACTER_DIR_SHEETS) {
    const r = await buildSheet(entry);
    results.push(r);
    console.log(`${entry.file}  128x128 x${r.frames.length}`);
  }
  console.log('contact sheet:', path.relative(ROOT, await contactSheet(results)));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
