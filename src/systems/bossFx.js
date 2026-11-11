/**
 * Boss telegraphs and effects (Phaser graphics + tweens). Pixel-friendly: hard edges, integer line
 * widths, flat fills, no blur/glow. Every telegraph fills up over its duration so the player can read
 * "how long until it hits", then removes itself. All objects are tracked so clearAll() wipes them
 * (boss death, run restart, scene shutdown).
 *
 * Gameplay (damage, timings) lives in ArenaScene + systems/bossAI.js; this file only draws.
 */

export const FX_DEPTH = 2; // above the floor, below enemies/player sprites (depth >= 3 in practice)
const WARN_RED = 0xff3355;

export default class BossFx {
  constructor(scene) {
    this.scene = scene;
    this.objs = new Set();
    this.tweens = new Set();
  }

  _track(obj) {
    this.objs.add(obj);
    if (obj && obj.once) obj.once('destroy', () => this.objs.delete(obj));
    return obj;
  }

  graphics(depth = FX_DEPTH) {
    const g = this.scene.add.graphics();
    g.setDepth(depth);
    return this._track(g);
  }

  /** Counter tween 0 -> 1 over ms calling draw(p); destroys `g` at the end unless keep. */
  _fill(g, ms, draw, { keep = false, onDone } = {}) {
    draw(0);
    const tw = this.scene.tweens.addCounter({
      from: 0,
      to: 1,
      duration: Math.max(1, ms),
      onUpdate: (t) => { if (g.scene) draw(t.getValue()); },
      onComplete: () => {
        this.tweens.delete(tw);
        if (!keep && g.scene) g.destroy();
        if (onDone) onDone();
      }
    });
    this.tweens.add(tw);
    return g;
  }

  /** Blink factor: hard on/off every 100 ms (pixel-style flashing, no easing). */
  _blink() {
    return Math.floor(this.scene.time.now / 100) % 2 === 0 ? 1 : 0.55;
  }

  /** Dashed circle outline (segments) + growing flat fill. */
  warnCircle(x, y, r, color = WARN_RED, ms = 1000) {
    const g = this.graphics();
    return this._fill(g, ms, (p) => {
      g.clear();
      g.fillStyle(color, 0.14 + 0.16 * p);
      g.fillCircle(x, y, Math.max(2, r * p));
      g.lineStyle(2, color, this._blink());
      const segs = 20;
      for (let i = 0; i < segs; i += 2) {
        g.beginPath();
        g.arc(x, y, r, (i / segs) * Math.PI * 2, ((i + 1) / segs) * Math.PI * 2);
        g.strokePath();
      }
    });
  }

  /** Rectangle "shadow" (centre x,y) that darkens before a block lands. */
  warnRect(x, y, w, h, color = 0x000000, ms = 1000) {
    const g = this.graphics();
    return this._fill(g, ms, (p) => {
      g.clear();
      const s = 0.35 + 0.65 * p;
      g.fillStyle(color, 0.25 + 0.35 * p);
      g.fillRect(Math.round(x - (w * s) / 2), Math.round(y - (h * s) / 2), Math.round(w * s), Math.round(h * s));
      g.lineStyle(2, WARN_RED, this._blink());
      g.strokeRect(Math.round(x - w / 2), Math.round(y - h / 2), w, h);
    });
  }

  /** Line (thick lane) from (x1,y1) towards (x2,y2): outline + fill that sweeps along it. */
  warnLine(x1, y1, x2, y2, width, color = WARN_RED, ms = 1000) {
    const g = this.graphics();
    const ang = Math.atan2(y2 - y1, x2 - x1);
    const len = Math.hypot(x2 - x1, y2 - y1);
    const nx = -Math.sin(ang) * (width / 2);
    const ny = Math.cos(ang) * (width / 2);
    const quad = (l) => [
      { x: x1 + nx, y: y1 + ny }, { x: x1 + Math.cos(ang) * l + nx, y: y1 + Math.sin(ang) * l + ny },
      { x: x1 + Math.cos(ang) * l - nx, y: y1 + Math.sin(ang) * l - ny }, { x: x1 - nx, y: y1 - ny }
    ];
    return this._fill(g, ms, (p) => {
      g.clear();
      g.fillStyle(color, 0.3);
      g.fillPoints(quad(len * p), true);
      g.lineStyle(2, color, this._blink());
      g.strokePoints(quad(len), true);
    });
  }

  /** Ring that will expand to maxR, with a safe gap (green) centred on gapAngle. */
  warnRing(x, y, maxR, gapAngle, gapRad, color = WARN_RED, ms = 1000) {
    const g = this.graphics();
    return this._fill(g, ms, (p) => {
      g.clear();
      const a0 = gapAngle + gapRad / 2;
      const a1 = gapAngle - gapRad / 2 + Math.PI * 2;
      for (const r of [maxR * 0.35, maxR * 0.7, maxR]) {
        g.lineStyle(r === maxR ? 3 : 2, color, this._blink() * (r === maxR ? 1 : 0.6));
        g.beginPath();
        g.arc(x, y, r * (0.6 + 0.4 * p), a0, a1);
        g.strokePath();
      }
      // safe lane
      g.fillStyle(0x34d399, 0.18 + 0.12 * p);
      g.slice(x, y, maxR, gapAngle - gapRad / 2, gapAngle + gapRad / 2);
      g.fillPath();
      g.lineStyle(2, 0x34d399, 0.9);
      g.beginPath();
      g.arc(x, y, maxR, gapAngle - gapRad / 2, gapAngle + gapRad / 2);
      g.strokePath();
    });
  }

  /** Pixel "X" marker (spawn points, teleport destinations). */
  warnMarker(x, y, color = WARN_RED, ms = 900, size = 12) {
    const g = this.graphics();
    return this._fill(g, ms, (p) => {
      g.clear();
      const s = Math.round(size * (1.4 - 0.4 * p));
      g.lineStyle(3, color, this._blink());
      g.lineBetween(x - s, y - s, x + s, y + s);
      g.lineBetween(x - s, y + s, x + s, y - s);
      g.strokeRect(x - s - 4, y - s - 4, 2 * s + 8, 2 * s + 8);
    });
  }

  /** Hard tint blink on a sprite (boss wind-up). */
  warnSprite(sprite, color = 0xffffff, ms = 900) {
    if (!sprite || !sprite.setTint) return;
    const g = this.graphics(); // invisible carrier so clearAll() also stops the blink
    this._fill(g, ms, () => {
      if (!sprite.active) return;
      if (this._blink() === 1) sprite.setTintFill(color); else sprite.clearTint();
    }, { onDone: () => { if (sprite.active) sprite.clearTint(); } });
  }

  /** Persistent zone (caller redraws via drawZone and destroys it). */
  zone() {
    return this.graphics(FX_DEPTH);
  }

  drawZone(g, x, y, r, color, { alpha = 0.22, pulse = 0, glyph = null } = {}) {
    if (!g || !g.scene) return;
    g.clear();
    g.fillStyle(color, alpha + 0.25 * pulse);
    g.fillCircle(x, y, r);
    g.lineStyle(pulse > 0 ? 4 : 2, color, 1);
    g.strokeCircle(x, y, r);
    if (glyph === 'null') { // Ø
      g.lineStyle(3, color, 0.9);
      g.strokeCircle(x, y, r * 0.3);
      g.lineBetween(x - r * 0.4, y + r * 0.4, x + r * 0.4, y - r * 0.4);
    }
  }

  /** Active shockwave ring (arc with a gap) into g. */
  drawRing(g, x, y, r, width, gapAngle, gapRad, color = WARN_RED) {
    if (!g || !g.scene) return;
    g.clear();
    if (r <= 0) return;
    g.lineStyle(Math.max(2, Math.round(width)), color, 0.85);
    g.beginPath();
    g.arc(x, y, r, gapAngle + gapRad / 2, gapAngle - gapRad / 2 + Math.PI * 2);
    g.strokePath();
    g.lineStyle(2, 0xffffff, 0.9);
    g.beginPath();
    g.arc(x, y, r, gapAngle + gapRad / 2, gapAngle - gapRad / 2 + Math.PI * 2);
    g.strokePath();
  }

  /** Solid beam flash along a lane. */
  beam(x1, y1, ang, len, width, color = 0xffffff, ms = 260) {
    const g = this.graphics(FX_DEPTH + 10);
    const x2 = x1 + Math.cos(ang) * len;
    const y2 = y1 + Math.sin(ang) * len;
    return this._fill(g, ms, (p) => {
      g.clear();
      g.lineStyle(Math.max(2, Math.round(width * (1 - p * 0.6))), color, 1 - p);
      g.lineBetween(x1, y1, x2, y2);
      g.lineStyle(Math.max(2, Math.round(width * 0.35)), 0xffffff, 1 - p);
      g.lineBetween(x1, y1, x2, y2);
    });
  }

  /** Square pixel debris burst. */
  burst(x, y, color, count = 8, spread = 60) {
    for (let i = 0; i < count; i++) {
      const s = 4 + (i % 3) * 2;
      const r = this._track(this.scene.add.rectangle(x, y, s, s, color).setDepth(FX_DEPTH + 10));
      const a = (Math.PI * 2 * i) / count;
      this.scene.tweens.add({
        targets: r,
        x: x + Math.cos(a) * spread,
        y: y + Math.sin(a) * spread,
        alpha: 0,
        duration: 420,
        onComplete: () => r.destroy()
      });
    }
  }

  clearAll() {
    for (const tw of this.tweens) { try { tw.remove(); } catch (_) { /* already gone */ } }
    this.tweens.clear();
    for (const o of [...this.objs]) { try { o.destroy(); } catch (_) { /* already destroyed */ } }
    this.objs.clear();
  }
}
