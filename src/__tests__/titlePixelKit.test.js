import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  NINE_SLICES, UI_SPRITES, UI_ICON_NAMES, FONT_META, PX, PX_CSS, uiAssetManifest, familyOf, buttonSkin,
  familyLabelColor, selectedCardSkin, progressFillSkin, tileSkin, normalizeForFont, colorToInt, iconFrame
} from '../scenes/boot/uiAssets.js';
import { PIXEL_ICONS } from '../scenes/title/overlayModel.js';
import titleEn from '../locales/title.en.js';
import titleEs from '../locales/title.es.js';

const PUBLIC = path.resolve(__dirname, '../../public');
const read = (p) => fs.readFileSync(path.join(PUBLIC, p));
const pngSize = (buf) => ({ width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) });

describe('pixel UI kit assets (gen-ui.mjs)', () => {
  const atlas = JSON.parse(read('assets/UI/pixel/ui-pixel.json').toString());
  const manifest = JSON.parse(read('assets/UI/pixel/ui-manifest.json').toString());
  const frames = atlas.frames;

  it('every manifest file exists', () => {
    for (const a of uiAssetManifest()) {
      expect(fs.existsSync(path.join(PUBLIC, a.png)), a.png).toBe(true);
      if (a.data) expect(fs.existsSync(path.join(PUBLIC, a.data)), a.data).toBe(true);
    }
  });

  it('atlas PNG matches the JSON size', () => {
    expect(pngSize(read('assets/UI/pixel/ui-pixel.png'))).toEqual({ width: atlas.meta.size.w, height: atlas.meta.size.h });
  });

  it.each(Object.entries(NINE_SLICES))('9-slice %s is in the atlas with the runtime size and a valid slice', (key, n) => {
    expect(frames[key], key).toBeDefined();
    expect(frames[key].frame.w).toBe(n.w);
    expect(frames[key].frame.h).toBe(n.h);
    expect(n.slice * 2).toBeLessThan(Math.min(n.w, n.h) + 1);
    expect(manifest.nine[key]).toEqual({ w: n.w, h: n.h, slice: n.slice });
  });

  it('runtime 9-slice table and generator table list the same skins', () => {
    expect(Object.keys(NINE_SLICES).sort()).toEqual(Object.keys(manifest.nine).sort());
  });

  it.each(Object.entries(UI_SPRITES))('sprite %s is in the atlas', (key, [w, h]) => {
    expect(frames[key].frame).toMatchObject({ w, h });
  });

  it('every icon ships 16 / 24 px in colour and greyscale', () => {
    expect([...UI_ICON_NAMES].sort()).toEqual([...manifest.icons].sort());
    for (const name of UI_ICON_NAMES) {
      expect(frames[`ui-${name}`].frame).toMatchObject({ w: 16, h: 16 });
      expect(frames[`ui-${name}-m`].frame).toMatchObject({ w: 16, h: 16 });
      expect(frames[`ui-${name}-24`].frame).toMatchObject({ w: 24, h: 24 });
      expect(frames[`ui-${name}-24-m`].frame).toMatchObject({ w: 24, h: 24 });
    }
  });

  it('covers the legacy 9x9 glyph names, so pixelIcon() never falls back', () => {
    Object.keys(PIXEL_ICONS).forEach((n) => expect(UI_ICON_NAMES, n).toContain(n));
    expect(iconFrame('nope')).toBe('ui-star');
    expect(iconFrame('heart', { big: true, mono: true })).toBe('ui-heart-24-m');
  });

  it('bitmap font declares the metrics the kit assumes', () => {
    const xml = read('assets/UI/pixel/pixel.xml').toString();
    expect(xml).toMatch(new RegExp(`<info face="pixel" size="${FONT_META.size}"`));
    expect(xml).toMatch(new RegExp(`lineHeight="${FONT_META.lineHeight}"`));
    const ids = new Set([...xml.matchAll(/<char id="(\d+)"/g)].map((m) => Number(m[1])));
    const need = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 .,:;!?-+/%#()\'"áéíóúüñ¿¡…·×';
    for (const ch of need) expect(ids.has(ch.codePointAt(0)), ch).toBe(true);
  });

  it('every EN / ES title string renders with the font (after accent folding)', () => {
    const xml = read('assets/UI/pixel/pixel.xml').toString();
    const ids = new Set([...xml.matchAll(/<char id="(\d+)"/g)].map((m) => Number(m[1])));
    const has = (c) => ids.has(c);
    const walk = (o, out = []) => { Object.values(o || {}).forEach((v) => (typeof v === 'string' ? out.push(v) : walk(v, out))); return out; };
    const missing = new Set();
    [...walk(titleEn), ...walk(titleEs)].forEach((str) => {
      const norm = normalizeForFont(str, has);
      for (const ch of norm) if (ch !== '\n' && !has(ch.codePointAt(0))) missing.add(ch);
    });
    expect([...missing]).toEqual([]);
  });
});

describe('pixel UI kit helpers', () => {
  it('palette ints mirror the css palette', () => {
    expect(PX.ink).toBe(0x0f1228);
    expect(colorToInt(PX_CSS.violet)).toBe(PX.violet);
    expect(colorToInt('#fff')).toBe(0xffffff);
    expect(colorToInt('rgba(26,31,61,0.5)')).toBe(0x1a1f3d);
  });

  it('familyOf buckets colours by hue and greys to neutral', () => {
    expect(familyOf(PX.violet)).toBe('violet');
    expect(familyOf(0x8b5cf6)).toBe('violet');
    expect(familyOf(PX.cyan)).toBe('cyan');
    expect(familyOf(0x22d3ee)).toBe('cyan');
    expect(familyOf(PX.amber)).toBe('amber');
    expect(familyOf(PX.green)).toBe('green');
    expect(familyOf(PX.red)).toBe('red');
    expect(familyOf(0x94a3b8)).toBe('neutral');
    expect(familyOf('#ffffff')).toBe('neutral');
  });

  it('skin pickers return skins that exist', () => {
    const fams = ['violet', 'cyan', 'amber', 'green', 'red', 'neutral'];
    fams.forEach((f) => {
      ['normal', 'hover', 'pressed', 'disabled'].forEach((st) => expect(NINE_SLICES[buttonSkin(f, st)], `${f}/${st}`).toBeDefined());
      expect(NINE_SLICES[selectedCardSkin(f)]).toBeDefined();
      expect(NINE_SLICES[progressFillSkin(f)]).toBeDefined();
      expect(NINE_SLICES[tileSkin(f)]).toBeDefined();
    });
    expect(familyLabelColor('amber')).toBe(PX_CSS.ink);
    expect(familyLabelColor('violet')).toBe(PX_CSS.white);
  });

  it('normalizeForFont folds accents on capitals, smart quotes and drops emoji', () => {
    const has = (c) => c < 127 || 'áéíóúñ'.includes(String.fromCodePoint(c));
    expect(normalizeForFont('CONFIGURACIÓN', has)).toBe('CONFIGURACION');
    expect(normalizeForFont('canción', has)).toBe('canción');
    expect(normalizeForFont('it’s ⚡ ok', has)).toBe("it's  ok");
    expect(normalizeForFont('a\nb', has)).toBe('a\nb');
  });
});
