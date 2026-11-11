/**
 * Animated pixel space background shared by the title screen and the arena.
 *
 *   const bg = createSpaceBackground(scene, { variant: 'memory-banks', depth: -9.5 });
 *   bg.update(deltaMs);                    // every frame (MapManager drives it from scene 'postupdate')
 *   bg.setVariant('kernel-space', { fadeMs: 600 }); // stepped (retro) crossfade to another stage palette
 *   bg.setWave(7);                         // subtle per-wave mood: nebula brightness, mote density, new prop every 5 waves
 *   bg.setQuality('low');                  // no motes, no twinkle, no near layer
 *   bg.destroy();
 *
 * Modes:
 *   'viewport' (arena, default) - 3 camera-fixed tileSprites (back / stars / near) that scroll with
 *       parallax against the camera plus an autonomous drift, ≤ 6 drifting props and ≤ 40 motes (images,
 *       no per-frame Graphics). Art: scripts/assets/gen-space-bg.mjs.
 *   'title' - the title-screen composition (legacy bg-blue-* art = the DEBUG ZONE source), driven by its own
 *       tweens + timer exactly as TitleScene had it; update() is a no-op there.
 */
import { SPACE_BG, SPACE_PALETTES } from '../data/biomes.js';

export const SPACE_DIR = 'assets/backgrounds/space';
export const SPACE_VARIANTS = Object.freeze(Object.keys(SPACE_PALETTES));
export const SPACE_MOTE_KEY = 'space-mote';
export const DEFAULT_VARIANT = 'debug-zone';

/** Texture keys of one variant. */
export function spaceKeys(variant) {
  const v = SPACE_PALETTES[variant] ? variant : DEFAULT_VARIANT;
  const p = (name) => `space-${v}-${name}`;
  return {
    variant: v,
    back: p('back'),
    starsA: p('stars-a'),
    starsB: p('stars-b'),
    near: p('near'),
    props: SPACE_PALETTES[v].props.map((name) => ({ name, key: p(`prop-${name}`) }))
  };
}

/** Pure manifest of every space-background PNG (key, relative path, pixel size). */
export function spaceAssetManifest() {
  const T = SPACE_BG.tileSize;
  const out = [];
  SPACE_VARIANTS.forEach((v) => {
    const k = spaceKeys(v);
    [['back', k.back], ['stars-a', k.starsA], ['stars-b', k.starsB], ['near', k.near]].forEach(([file, key]) => {
      out.push({ key, path: `${SPACE_DIR}/${v}/${file}.png`, kind: 'image', width: T, height: T });
    });
    k.props.forEach(({ name, key }) => out.push({ key, path: `${SPACE_DIR}/${v}/prop-${name}.png`, kind: 'image', width: SPACE_BG.propSize, height: SPACE_BG.propSize }));
  });
  out.push({ key: SPACE_MOTE_KEY, path: `${SPACE_DIR}/mote.png`, kind: 'image', width: 3, height: 3 });
  return out;
}

// ------------------------------------------------------------------ pure helpers (tested)

/** Stepped fade: alpha in `steps` hard increments over `durMs` (0 → 1). */
export function fadeAlpha(elapsedMs, durMs, steps = SPACE_BG.fadeSteps) {
  if (!(durMs > 0) || elapsedMs >= durMs) return 1;
  if (!(elapsedMs > 0)) return 0;
  const n = Math.max(1, steps | 0);
  return Math.min(1, Math.floor((elapsedMs / durMs) * n + 1e-9) / n);
}

/** Twinkle frame (0 = stars-a, 1 = stars-b) for an elapsed time. */
export function twinkleFrame(elapsedMs, periodMs = SPACE_BG.twinkleMs) {
  return Math.floor(Math.max(0, elapsedMs) / Math.max(1, periodMs)) % 2;
}

/** Tile offset (texture px) for a layer: camera scroll × parallax + drift, in screen px / tileScale. */
export function layerOffset(scroll, parallax, drift, tileScale) {
  return (scroll * parallax + drift) / (tileScale > 0 ? tileScale : 1);
}

/** Layer config of a variant: SPACE_BG.layers[name] with SPACE_BG.variantLayers[variant][name] merged over it. */
export function layerConfig(variant, name) {
  const base = SPACE_BG.layers[name];
  const over = SPACE_BG.variantLayers && SPACE_BG.variantLayers[variant] && SPACE_BG.variantLayers[variant][name];
  return over ? { ...base, ...over } : base;
}

/**
 * Per-wave mood inside a stage: brightness cycles 0.9 → 1.1 over 5 waves (±10%), motes grow with it,
 * and every 5th wave announces a new prop.
 */
export function waveMood(wave) {
  const w = Math.max(1, Math.floor(Number.isFinite(wave) ? wave : 1));
  const phase = ((w - 1) % 5) / 4;
  const brightness = 0.9 + 0.2 * phase;
  return {
    brightness,
    backTint: Math.min(1, brightness),
    nearAlpha: brightness,
    motes: Math.min(SPACE_BG.maxMotes, Math.round(16 + 24 * phase)),
    newProp: w % 5 === 0
  };
}

const grey = (k) => {
  const c = Math.max(0, Math.min(255, Math.round(255 * k)));
  return (c << 16) | (c << 8) | c;
};
const hexInt = (h) => parseInt(h, 16);

/** Deterministic PRNG for prop / mote placement. */
function rng(seed) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}
const wrap = (v, lo, span) => lo + ((((v - lo) % span) + span) % span);

// ------------------------------------------------------------------ factory

/**
 * @param {Phaser.Scene} scene
 * @param {{variant?:string, mode?:'viewport'|'title', depth?:number, quality?:'high'|'low', seed?:number, parallax?:boolean}} [opts]
 */
export function createSpaceBackground(scene, opts = {}) {
  if ((opts.mode || 'viewport') === 'title') return createTitleBackground(scene, opts);
  return new ViewportSpaceBackground(scene, opts);
}

class ViewportSpaceBackground {
  constructor(scene, opts) {
    this.scene = scene;
    this.depth = Number.isFinite(opts.depth) ? opts.depth : -9.5;
    this.quality = opts.quality === 'low' ? 'low' : 'high';
    this.parallax = opts.parallax !== false;
    this.rand = rng(Number.isFinite(opts.seed) ? opts.seed : 0x5eed);
    this.elapsed = 0;
    this.drift = 0; // seconds of autonomous drift
    this.mood = waveMood(1);
    this.wave = 1;
    this.current = null;
    this.outgoing = [];
    this.motes = [];
    this.fade = null;
    this.destroyed = false;
    this.current = this.buildSet(opts.variant || DEFAULT_VARIANT);
    this.applyAlpha(this.current, 1);
    this.syncMotes();
    this.layout();
  }

  get variant() { return this.current ? this.current.variant : null; }
  /** Back / stars / near tileSprites of the active variant (null when the art is missing). */
  get layers() { return this.current ? this.current.layers : {}; }
  get props() { return this.current ? this.current.props : []; }

  has(key) { return !!(this.scene.textures && this.scene.textures.exists(key)); }

  view() {
    const cam = this.scene.cameras && this.scene.cameras.main;
    const cw = cam ? cam.width : (this.scene.scale ? this.scene.scale.width : 800);
    const ch = cam ? cam.height : (this.scene.scale ? this.scene.scale.height : 600);
    const zoom = cam && cam.zoom > 0 ? cam.zoom : 1;
    const w = Math.ceil(cw / zoom) + 64;
    const h = Math.ceil(ch / zoom) + 64;
    return { cx: cw / 2, cy: ch / 2, w, h, sx: this.parallax && cam ? cam.scrollX || 0 : 0, sy: this.parallax && cam ? cam.scrollY || 0 : 0 };
  }

  buildSet(variant) {
    const keys = spaceKeys(variant);
    const set = { variant: keys.variant, keys, layers: {}, props: [], alpha: 0 };
    const v = this.view();
    const order = [['back', keys.back], ['stars', keys.starsA], ['near', keys.near]];
    order.forEach(([name, key], i) => {
      if (!this.has(key)) { set.layers[name] = null; return; }
      const cfg = layerConfig(keys.variant, name);
      const ts = this.scene.add.tileSprite(v.cx, v.cy, v.w, v.h, key)
        .setOrigin(0.5).setScrollFactor(0).setDepth(this.depth + i * 0.02);
      ts.tileScaleX = cfg.tileScale;
      ts.tileScaleY = cfg.tileScale;
      ts.baseAlpha = cfg.alpha;
      set.layers[name] = ts;
    });
    set.twinkle = 0;
    // Starting props: one of each kind the variant owns, spread over the view.
    keys.props.forEach((p, i) => this.addProp(set, p, { index: i, total: keys.props.length }));
    this.applyMood(set);
    return set;
  }

  addProp(set, prop, { index = 0, total = 1, entering = false } = {}) {
    if (!this.has(prop.key)) return null;
    const v = this.view();
    const r = this.rand;
    const big = prop.name === 'vortex' || prop.name === 'planet';
    const scale = big ? 3 : 2;
    const par = SPACE_BG.layers.back.parallax + 0.06 + r() * 0.14;
    const img = this.scene.add.image(0, 0, prop.key).setScrollFactor(0).setDepth(this.depth + 0.03).setScale(scale);
    const spanX = v.w + 400;
    const spanY = v.h + 300;
    const p = {
      img,
      name: prop.name,
      par,
      // Base position in "parallax space"; screen = base - scroll*par + drift*t, wrapped around the view.
      bx: entering ? v.sx * par + v.w / 2 + 120 : (v.w * (index + 0.5 + (r() - 0.5) * 0.5)) / Math.max(1, total) - v.w / 2,
      by: entering ? v.sy * par + (r() - 0.5) * v.h * 0.6 : (r() - 0.5) * v.h * 0.8,
      vx: entering ? -(8 + r() * 6) : (r() - 0.5) * 6,
      vy: (r() - 0.5) * 3,
      spin: prop.name === 'asteroid' ? (r() - 0.5) * 0.3 : 0,
      spanX,
      spanY,
      t0: this.drift,
      alpha: big ? 0.85 : 0.9
    };
    set.props.push(p);
    if (set.props.length > SPACE_BG.maxProps) {
      const old = set.props.shift();
      if (old && old.img) old.img.destroy();
    }
    return p;
  }

  applyMood(set) {
    if (!set) return;
    const { back, near } = set.layers;
    if (back && typeof back.setTint === 'function') back.setTint(grey(this.mood.backTint * (layerConfig(set.variant, 'back').dim || 1)));
    if (near) near.moodAlpha = this.mood.nearAlpha;
  }

  applyAlpha(set, a) {
    if (!set) return;
    set.alpha = a;
    const { back, stars, near } = set.layers;
    if (back) back.setAlpha(back.baseAlpha * a);
    if (stars) stars.setAlpha(stars.baseAlpha * a);
    if (near) {
      near.setAlpha(Math.min(1, near.baseAlpha * (near.moodAlpha || 1)) * a);
      if (typeof near.setVisible === 'function') near.setVisible(this.quality !== 'low');
    }
    set.props.forEach((p) => p.img.setAlpha(p.alpha * a));
  }

  destroySet(set) {
    if (!set) return;
    Object.values(set.layers).forEach((l) => l && l.destroy());
    set.props.forEach((p) => p.img && p.img.destroy());
    set.layers = {};
    set.props = [];
  }

  /** Crossfade (stepped alpha) to another variant; same variant = no-op. */
  setVariant(variant, { fadeMs = SPACE_BG.fadeMs } = {}) {
    if (this.destroyed) return false;
    const next = spaceKeys(variant).variant;
    if (this.current && this.current.variant === next && !this.fade) return false;
    if (this.fade) this.finishFade();
    const old = this.current;
    this.current = this.buildSet(next);
    if (old) {
      // New set on top: bump depth so it draws over the old one during the fade.
      this.outgoing.push(old);
    }
    if (fadeMs > 0 && old) {
      this.fade = { t: 0, dur: fadeMs };
      this.applyAlpha(this.current, 0);
    } else {
      this.applyAlpha(this.current, 1);
      this.outgoing.forEach((s) => this.destroySet(s));
      this.outgoing = [];
    }
    this.retintMotes();
    this.layout();
    return true;
  }

  finishFade() {
    this.fade = null;
    this.outgoing.forEach((s) => this.destroySet(s));
    this.outgoing = [];
    this.applyAlpha(this.current, 1);
  }

  /** Subtle per-wave change (no variant switch); every 5th wave a prop floats in. */
  setWave(wave) {
    if (this.destroyed) return;
    const mood = waveMood(wave);
    this.wave = wave;
    this.mood = mood;
    this.applyMood(this.current);
    if (!this.fade) this.applyAlpha(this.current, this.current ? this.current.alpha : 1);
    if (mood.newProp && this.current && this.current.keys.props.length) {
      const list = this.current.keys.props;
      const pick = list[Math.floor(this.rand() * list.length)];
      const p = this.addProp(this.current, pick, { entering: true });
      if (p) p.img.setAlpha(p.alpha * this.current.alpha);
    }
    this.syncMotes();
  }

  setQuality(level) {
    const next = level === 'low' ? 'low' : 'high';
    if (next === this.quality) return false;
    this.quality = next;
    if (this.current) this.applyAlpha(this.current, this.current.alpha);
    const stars = this.current && this.current.layers.stars;
    if (stars && next === 'low') { stars.setTexture(this.current.keys.starsA); this.current.twinkle = 0; }
    this.syncMotes();
    return true;
  }

  // ---------------------------------------------------------------- motes
  syncMotes() {
    const want = this.quality === 'low' || !this.has(SPACE_MOTE_KEY) ? 0 : this.mood.motes;
    const v = this.view();
    const tint = this.current ? hexInt(SPACE_PALETTES[this.current.variant].mote) : 0xffffff;
    while (this.motes.length < want) {
      const r = this.rand;
      const img = this.scene.add.image(0, 0, SPACE_MOTE_KEY).setScrollFactor(0).setDepth(this.depth + 0.05).setTint(tint);
      img.setScale(r() < 0.3 ? 2 : 1);
      this.motes.push({
        img,
        bx: (r() - 0.5) * v.w,
        by: (r() - 0.5) * v.h,
        vx: (r() - 0.5) * 10,
        vy: -2 - r() * 6,
        par: SPACE_BG.layers.near.parallax,
        a: 0.35 + r() * 0.5,
        ph: r() * Math.PI * 2
      });
    }
    while (this.motes.length > want) {
      const m = this.motes.pop();
      if (m && m.img) m.img.destroy();
    }
  }

  retintMotes() {
    if (!this.current) return;
    const tint = hexInt(SPACE_PALETTES[this.current.variant].mote);
    this.motes.forEach((m) => m.img.setTint(tint));
  }

  // ---------------------------------------------------------------- per frame
  update(dtMs) {
    if (this.destroyed) return;
    const dt = Number.isFinite(dtMs) && dtMs > 0 ? Math.min(dtMs, 250) : 0;
    this.elapsed += dt;
    this.drift += dt / 1000;

    if (this.fade) {
      this.fade.t += dt;
      const a = fadeAlpha(this.fade.t, this.fade.dur);
      if (a >= 1) this.finishFade();
      else this.applyAlpha(this.current, a);
    }

    if (this.quality !== 'low' && this.current) {
      const f = twinkleFrame(this.elapsed);
      const stars = this.current.layers.stars;
      if (stars && f !== this.current.twinkle) {
        this.current.twinkle = f;
        stars.setTexture(f ? this.current.keys.starsB : this.current.keys.starsA);
      }
    }
    this.layout();
  }

  /** Size/position the layers to the camera view and apply parallax + drift offsets. */
  layout() {
    const v = this.view();
    const t = this.drift;
    const place = (set) => {
      if (!set) return;
      Object.entries(set.layers).forEach(([name, l]) => {
        if (!l || l.active === false) return;
        const cfg = SPACE_BG.layers[name];
        if (l.width !== v.w || l.height !== v.h) l.setSize(v.w, v.h);
        l.setPosition(v.cx, v.cy);
        l.tilePositionX = layerOffset(v.sx, cfg.parallax, cfg.drift[0] * t, cfg.tileScale);
        l.tilePositionY = layerOffset(v.sy, cfg.parallax, cfg.drift[1] * t, cfg.tileScale);
      });
      set.props.forEach((p) => {
        const dtp = t - p.t0;
        const x = wrap(p.bx + p.vx * dtp - v.sx * p.par, -p.spanX / 2, p.spanX);
        const y = wrap(p.by + p.vy * dtp - v.sy * p.par, -p.spanY / 2, p.spanY);
        p.img.setPosition(v.cx + x, v.cy + y);
        if (p.spin) p.img.rotation = Math.round((p.spin * dtp) / (Math.PI / 8)) * (Math.PI / 8);
      });
    };
    place(this.current);
    this.outgoing.forEach(place);

    for (const m of this.motes) {
      const x = wrap(m.bx + m.vx * t - v.sx * m.par, -v.w / 2, v.w);
      const y = wrap(m.by + m.vy * t - v.sy * m.par, -v.h / 2, v.h);
      m.img.setPosition(Math.round(v.cx + x), Math.round(v.cy + y));
      // 3-step pulse (no smooth gradient)
      const s = Math.sin(t * 1.3 + m.ph);
      m.img.setAlpha(m.a * (s > 0.4 ? 1 : s > -0.4 ? 0.7 : 0.4));
    }
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.destroySet(this.current);
    this.outgoing.forEach((s) => this.destroySet(s));
    this.outgoing = [];
    this.current = null;
    this.motes.forEach((m) => m.img && m.img.destroy());
    this.motes = [];
  }
}

// ------------------------------------------------------------------ title composition

/**
 * Title screen: the original layered composition (cover nebula drifting, breathing mid layer,
 * two scrolling star tileSprites, planet + asteroids), moved verbatim from TitleScene.createBackground().
 */
function createTitleBackground(scene, opts = {}) {
  const width = scene.scale.width;
  const height = scene.scale.height;
  const objects = [];
  const tweens = [];
  const parallaxLayers = [];
  let scrollEvent = null;

  const pickKey = (...keys) => {
    for (const key of keys) if (key && scene.textures.exists(key)) return key;
    return null;
  };
  const placeCover = (key, depth = 0, alpha = 1) => {
    if (!scene.textures.exists(key)) return null;
    const img = scene.add.image(width / 2, height / 2, key);
    img.setScale(Math.max(width / img.width, height / img.height));
    img.setDepth(depth);
    img.setAlpha(alpha);
    objects.push(img);
    return img;
  };

  // Depth 0: base nebula (cover image, no tiling to avoid mosaic) with a very slow drift.
  const bgBaseKey = pickKey('bg-blue-back', spaceKeys(opts.variant || DEFAULT_VARIANT).back);
  let base = bgBaseKey ? placeCover(bgBaseKey, 0, 1) : null;
  if (!base) {
    base = scene.add.graphics();
    base.fillStyle(0x050913, 1);
    base.fillRect(0, 0, width, height);
    base.setDepth(0);
    objects.push(base);
  } else {
    tweens.push(scene.tweens.add({ targets: base, x: width / 2 + 56, y: height / 2 - 30, duration: 10000, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' }));
  }

  // Depth 1: breathing mid layer.
  const midKey = pickKey('bg-blue-with-stars');
  if (midKey) {
    const mid = placeCover(midKey, 1, 0.35);
    if (mid) {
      tweens.push(scene.tweens.add({ targets: mid, scaleX: mid.scaleX * 1.14, scaleY: mid.scaleY * 1.14, angle: 3.8, duration: 7000, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' }));
      tweens.push(scene.tweens.add({ targets: mid, alpha: { from: 0.24, to: 0.62 }, duration: 4200, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' }));
    }
  }

  // Two scrolling star fields.
  const starsKey = pickKey('bg-blue-stars');
  if (starsKey) {
    const far = scene.add.tileSprite(width / 2, height / 2, width, height, starsKey).setDepth(1).setAlpha(0.25);
    const near = scene.add.tileSprite(width / 2, height / 2, width, height, starsKey).setDepth(2).setAlpha(0.48);
    objects.push(far, near);
    parallaxLayers.push({ layer: far, speedX: 0.18, speedY: 0.24 }, { layer: near, speedX: 0.45, speedY: 0.68 });
    scrollEvent = scene.time.addEvent({
      delay: 33,
      loop: true,
      callback: () => {
        for (const e of parallaxLayers) {
          if (!e.layer || !e.layer.scene) continue;
          e.layer.tilePositionX += e.speedX;
          e.layer.tilePositionY += e.speedY;
        }
      }
    });
  }

  // Planet + asteroids.
  const planetKey = pickKey('bg-planet-big');
  if (planetKey) {
    const planet = scene.add.image(width - 200, height - 180, planetKey).setDepth(3).setScale(0.8).setAlpha(0.9);
    objects.push(planet);
    tweens.push(scene.tweens.add({ targets: planet, x: planet.x - 34, y: planet.y + 20, duration: 4200, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' }));
  }
  const addAsteroid = (key, x, y, scale, dx, dy) => {
    const k = pickKey(key);
    if (!k) return;
    const a = scene.add.image(x, y, k).setDepth(3).setScale(scale).setAlpha(0.82);
    objects.push(a);
    tweens.push(scene.tweens.add({ targets: a, x: x + dx, y: y + dy, duration: 8000, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' }));
  };
  addAsteroid('bg-asteroid-1', width * 0.18, height * 0.22, 0.75, 10, -8);
  addAsteroid('bg-asteroid-2', width * 0.78, height * 0.32, 0.85, -12, 8);

  let destroyed = false;
  return {
    mode: 'title',
    variant: opts.variant || DEFAULT_VARIANT,
    objects,
    update() {},
    setVariant() { return false; },
    setWave() {},
    setQuality() { return false; },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      tweens.forEach((t) => t && t.stop && t.stop());
      if (scrollEvent) scrollEvent.remove(false);
      objects.forEach((o) => o && o.destroy && o.destroy());
    }
  };
}
