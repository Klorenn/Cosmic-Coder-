import { describe, it, expect } from 'vitest';
import {
  createDirector, tick, maxAlive, spawnIntervalMs, groupSize, pickEnemyType,
  spawnPointOutsideView, tierShares, effectiveWeight, createRng, SPAWN_RING_MIN, SPAWN_RING_MAX
} from '../systems/spawnDirector.js';
import { WAVE_DURATION_MS } from '../systems/waveRules.js';
import { ENEMIES } from '../data/enemies.js';
import * as BALANCE from '../config/balance.js';

const PLAYER = { x: 1000, y: 1000 };
const VIEW = 700;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/** Run the director for `ms` with a fixed alive count; returns all ticks. */
function runFor(d, fromMs, ms, aliveCount = 0, step = 50) {
  const out = [];
  for (let t = fromMs; t <= fromMs + ms; t += step) out.push(tick(d, { nowMs: t, aliveCount, playerPos: PLAYER, viewRadius: VIEW }));
  return out;
}

describe('spawnDirector curves', () => {
  it('maxAlive grows with the wave and is capped', () => {
    expect(maxAlive(1)).toBe(BALANCE.DIRECTOR_MAX_ALIVE_START);
    for (let w = 1; w < 60; w++) expect(maxAlive(w + 1)).toBeGreaterThanOrEqual(maxAlive(w));
    expect(maxAlive(5)).toBeGreaterThan(maxAlive(1));
    expect(maxAlive(10)).toBeGreaterThan(maxAlive(5));
    expect(maxAlive(999)).toBe(BALANCE.DIRECTOR_MAX_ALIVE_CAP);
  });

  it('spawn interval shrinks with the wave down to the floor', () => {
    expect(spawnIntervalMs(1)).toBe(BALANCE.DIRECTOR_INTERVAL_START_MS);
    for (let w = 1; w < 60; w++) expect(spawnIntervalMs(w + 1)).toBeLessThanOrEqual(spawnIntervalMs(w));
    expect(spawnIntervalMs(10)).toBeLessThan(spawnIntervalMs(1));
    expect(spawnIntervalMs(20)).toBeLessThanOrEqual(200);
    expect(spawnIntervalMs(999)).toBe(BALANCE.DIRECTOR_INTERVAL_MIN_MS);
  });

  it('group size goes 1 -> 6', () => {
    expect(groupSize(1)).toBe(1);
    for (let w = 1; w < 60; w++) expect(groupSize(w + 1)).toBeGreaterThanOrEqual(groupSize(w));
    expect(groupSize(999)).toBe(6);
  });

  it('tier shares sum to 1 and trash fades while elites grow', () => {
    for (const w of [1, 5, 10, 20, 40]) {
      const s = tierShares(w);
      expect(s.trash + s.normal + s.elite).toBeCloseTo(1, 6);
    }
    expect(tierShares(20).trash).toBeLessThan(tierShares(1).trash);
    expect(tierShares(20).elite).toBeGreaterThan(tierShares(1).elite);
  });

  it('garbage input never yields NaN', () => {
    for (const w of [NaN, -5, 0, undefined, null, 'x', Infinity, 2.7]) {
      expect(Number.isFinite(maxAlive(w))).toBe(true);
      expect(Number.isFinite(spawnIntervalMs(w))).toBe(true);
      expect(Number.isFinite(groupSize(w))).toBe(true);
    }
  });
});

describe('pickEnemyType', () => {
  it('respects waveMin', () => {
    const rng = createRng(7);
    for (let i = 0; i < 2000; i++) {
      const type = pickEnemyType(rng, 3, ENEMIES);
      expect(ENEMIES[type].waveMin ?? 1).toBeLessThanOrEqual(3);
    }
  });

  it('old enemies decay: bugs are common at wave 1 and rare by wave 15', () => {
    const share = (wave) => {
      const rng = createRng(11);
      let bugs = 0;
      for (let i = 0; i < 4000; i++) if (pickEnemyType(rng, wave, ENEMIES) === 'bug') bugs++;
      return bugs / 4000;
    };
    // Still the most common type at wave 1, but no longer the only thing on screen (early pool variety).
    expect(share(1)).toBeGreaterThan(0.3);
    expect(share(1)).toBeLessThan(0.5);
    expect(share(15)).toBeLessThan(0.3);
    expect(share(15)).toBeGreaterThan(0); // still filler
    expect(effectiveWeight(ENEMIES.bug, 15)).toBeLessThan(effectiveWeight(ENEMIES.bug, 1));
  });

  it('late waves: fully decayed types share one absolute floor (heavy base weights do not come back)', () => {
    expect(effectiveWeight(ENEMIES.bug, 60)).toBe(effectiveWeight(ENEMIES.glitch, 60));
    const rng = createRng(13);
    let bugs = 0;
    for (let i = 0; i < 6000; i++) if (pickEnemyType(rng, 40, ENEMIES) === 'bug') bugs++;
    expect(bugs / 6000).toBeLessThan(0.15);
  });

  it('newer types appear once unlocked', () => {
    const rng = createRng(3);
    const seen = new Set();
    for (let i = 0; i < 4000; i++) seen.add(pickEnemyType(rng, 15, ENEMIES));
    expect(seen.has('race-condition')).toBe(true);
    expect(seen.has('syntax-error')).toBe(true);
  });

  it('empty / garbage pools return null', () => {
    expect(pickEnemyType(createRng(1), 1, {})).toBe(null);
    expect(pickEnemyType(createRng(1), 1, null)).toBe(null);
    expect(pickEnemyType(createRng(1), 1, { x: { waveMin: 50 } })).toBe(null);
  });

  it('every regular enemy declares a tier', () => {
    for (const [k, e] of Object.entries(ENEMIES)) expect(['trash', 'normal', 'elite'], k).toContain(e.tier);
  });
});

describe('spawnPointOutsideView', () => {
  it('always lands in the ring outside the view', () => {
    const rng = createRng(99);
    for (let i = 0; i < 2000; i++) {
      const p = spawnPointOutsideView(rng, PLAYER, VIEW);
      const d = dist(p, PLAYER);
      expect(d).toBeGreaterThan(VIEW);
      expect(d).toBeGreaterThanOrEqual(VIEW * SPAWN_RING_MIN - 1e-6);
      expect(d).toBeLessThanOrEqual(VIEW * SPAWN_RING_MAX + 1e-6);
    }
  });

  it('rectangular view {halfW, halfH}: always just outside the screen rectangle', () => {
    const rng = createRng(21);
    const view = { halfW: 640, halfH: 360 };
    let near = 0;
    for (let i = 0; i < 2000; i++) {
      const p = spawnPointOutsideView(rng, PLAYER, view);
      const dx = Math.abs(p.x - PLAYER.x);
      const dy = Math.abs(p.y - PLAYER.y);
      expect(dx > view.halfW || dy > view.halfH).toBe(true);
      expect(dx).toBeLessThanOrEqual(view.halfW * SPAWN_RING_MAX + 1e-6);
      expect(dy).toBeLessThanOrEqual(view.halfH * SPAWN_RING_MAX + 1e-6);
      if (Math.hypot(dx, dy) < 600) near++;
    }
    expect(near).toBeGreaterThan(200); // top/bottom spawns are close, not a half-diagonal away
  });

  it('rectangular view: regular and event spawns stay off-screen', () => {
    const view = { halfW: 640, halfH: 360 };
    const outside = (s) => Math.abs(s.x - PLAYER.x) > view.halfW || Math.abs(s.y - PLAYER.y) > view.halfH;
    const d = createDirector({}, 8);
    for (let t = 0; t <= 12 * WAVE_DURATION_MS; t += 250) {
      const r = tick(d, { nowMs: t, aliveCount: 0, playerPos: PLAYER, viewRadius: view });
      for (const s of r.spawns) expect(outside(s)).toBe(true);
      if (r.event) for (const s of r.event.spawns) expect(outside(s)).toBe(true);
    }
    for (const kind of ['swarm', 'horde', 'elitePack']) {
      for (const s of d.buildEvent(kind, 8, PLAYER, view, 0).spawns) expect(outside(s), kind).toBe(true);
    }
  });

  it('garbage input gives finite coordinates', () => {
    const p = spawnPointOutsideView(createRng(1), { x: NaN, y: undefined }, NaN);
    const q = spawnPointOutsideView(createRng(1), PLAYER, { halfW: -1, halfH: 'x' });
    expect(Number.isFinite(q.x) && Number.isFinite(q.y)).toBe(true);
    expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
  });
});

describe('director tick', () => {
  it('wave advances by time, not by kills', () => {
    const d = createDirector({}, 42);
    expect(tick(d, { nowMs: 0, aliveCount: 0, playerPos: PLAYER, viewRadius: VIEW }).wave).toBe(1);
    expect(tick(d, { nowMs: WAVE_DURATION_MS - 1, aliveCount: 999, playerPos: PLAYER, viewRadius: VIEW }).wave).toBe(1);
    const r = tick(d, { nowMs: WAVE_DURATION_MS, aliveCount: 999, playerPos: PLAYER, viewRadius: VIEW });
    expect(r.wave).toBe(2);
    expect(r.waveChanged).toBe(true);
    expect(tick(d, { nowMs: WAVE_DURATION_MS + 10, aliveCount: 0, playerPos: PLAYER, viewRadius: VIEW }).waveChanged).toBe(false);
  });

  it('startWave offsets the clock (continue from save)', () => {
    const d = createDirector({ startWave: 7 }, 1);
    expect(tick(d, { nowMs: 0, aliveCount: 0, playerPos: PLAYER, viewRadius: VIEW }).wave).toBe(7);
    expect(tick(d, { nowMs: WAVE_DURATION_MS, aliveCount: 0, playerPos: PLAYER, viewRadius: VIEW }).wave).toBe(8);
  });

  it('spawns continuously and never inside the view', () => {
    const d = createDirector({}, 5);
    const ticks = runFor(d, 0, 20000, 0);
    const spawns = ticks.flatMap((t) => t.spawns);
    expect(spawns.length).toBeGreaterThan(5);
    for (const s of spawns) {
      expect(dist(s, PLAYER)).toBeGreaterThan(VIEW);
      expect(typeof s.type).toBe('string');
      expect(typeof s.elite).toBe('boolean');
    }
  });

  it('pauses when the population target is met', () => {
    const d = createDirector({}, 5);
    const spawns = runFor(d, 0, 10000, maxAlive(1)).flatMap((t) => t.spawns);
    expect(spawns.length).toBe(0);
  });

  it('bursts when far below the target', () => {
    const count = (alive) => {
      const d = createDirector({ startWave: 5 }, 9);
      return runFor(d, 0, 10000, alive).flatMap((t) => t.spawns).length;
    };
    expect(count(0)).toBeGreaterThan(count(Math.ceil(maxAlive(5) * 0.8)));
  });

  it('later waves spawn more per second than early waves', () => {
    const rate = (wave) => {
      const d = createDirector({ startWave: wave, events: false }, 4);
      return runFor(d, 0, 10000, Math.ceil(maxAlive(wave) * 0.75)).flatMap((t) => t.spawns).length;
    };
    expect(rate(10)).toBeGreaterThan(rate(1));
    expect(rate(20)).toBeGreaterThan(rate(10));
  });

  it('is deterministic per seed', () => {
    const a = runFor(createDirector({}, 1234), 0, 5 * WAVE_DURATION_MS, 3, 100);
    const b = runFor(createDirector({}, 1234), 0, 5 * WAVE_DURATION_MS, 3, 100);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    const c = runFor(createDirector({}, 4321), 0, 5 * WAVE_DURATION_MS, 3, 100);
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(c));
  });

  it('fires wave events every 3-5 waves', () => {
    const d = createDirector({}, 77);
    const events = [];
    for (let w = 0; w < 30; w++) {
      const r = tick(d, { nowMs: w * WAVE_DURATION_MS, aliveCount: 0, playerPos: PLAYER, viewRadius: VIEW });
      if (r.event) events.push({ wave: r.wave, ...r.event });
    }
    expect(events.length).toBeGreaterThanOrEqual(5);
    for (let i = 1; i < events.length; i++) {
      const gap = events[i].wave - events[i - 1].wave;
      expect(gap).toBeGreaterThanOrEqual(3);
      expect(gap).toBeLessThanOrEqual(5);
    }
    for (const e of events) {
      expect(['swarm', 'horde', 'elitePack']).toContain(e.kind);
      expect(e.spawns.length).toBeGreaterThan(0);
      for (const s of e.spawns) expect(dist(s, PLAYER)).toBeGreaterThan(VIEW);
    }
  });

  it('swarm is a 30-60 ring of trash; elite pack is 4-6 elites', () => {
    const rng = createRng(5);
    const d = createDirector({}, 5);
    const swarm = d.buildEvent('swarm', 6, PLAYER, VIEW, 0);
    expect(swarm.spawns.length).toBeGreaterThanOrEqual(30);
    expect(swarm.spawns.length).toBeLessThanOrEqual(60);
    for (const s of swarm.spawns) expect(ENEMIES[s.type].tier).toBe('trash');
    const pack = d.buildEvent('elitePack', 6, PLAYER, VIEW, 0);
    expect(pack.spawns.length).toBeGreaterThanOrEqual(4);
    expect(pack.spawns.length).toBeLessThanOrEqual(6);
    expect(pack.spawns.every((s) => s.elite)).toBe(true);
    expect(rng).toBeTruthy();
  });

  it('event spawns respect the hard cap', () => {
    const d = createDirector({}, 77);
    const r = d.buildEvent('swarm', 10, PLAYER, VIEW, BALANCE.DIRECTOR_HARD_CAP - 5);
    expect(r.spawns.length).toBeLessThanOrEqual(5);
  });

  it('survives garbage tick input', () => {
    const d = createDirector(null, NaN);
    for (const input of [{}, { nowMs: NaN }, { nowMs: 'x', aliveCount: -4, playerPos: null, viewRadius: -1 }, undefined]) {
      const r = tick(d, input);
      expect(Number.isFinite(r.wave)).toBe(true);
      for (const s of r.spawns) expect(Number.isFinite(s.x) && Number.isFinite(s.y)).toBe(true);
    }
  });
});
