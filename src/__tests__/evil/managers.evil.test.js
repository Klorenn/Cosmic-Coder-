import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as Rank from '../../systems/RankManager.js';
import ShrineManager from '../../systems/ShrineManager.js';
import EventManager from '../../systems/EventManager.js';
import { biomeEffect, MAX_BIOME_DT_MS } from '../../systems/MapManager.js';
import { BIOMES } from '../../data/biomes.js';
import { seededRng, pick, HOSTILE_VALUES, HOSTILE_NUMBERS, isFiniteNumber, FUZZ_ITERATIONS } from './_hostile.js';

const NON_SYMBOL = HOSTILE_VALUES.filter((v) => typeof v !== 'symbol');

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

describe('EVIL RankManager', () => {
  const PROTO_KEYS = ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf', -1, 5, 1.5, NaN, '2', null, undefined, {}, []];

  it.each(PROTO_KEYS.map((k) => [String(k), k]))('rank getters never throw / return garbage for id %s', (_label, id) => {
    expect(() => Rank.getRankColorCSS(id)).not.toThrow();
    expect(Rank.getRankColorCSS(id)).toMatch(/^#[0-9a-f]{6}$/);
    expect(typeof Rank.getRankName(id)).toBe('string');
    expect(isFiniteNumber(Rank.getRankBonus(id))).toBe(true);
    expect(Rank.getRankBonusPercent(id)).toMatch(/^\d+%$/);
    expect(typeof Rank.getRankDescription(id)).toBe('string');
    expect(typeof Rank.hasRankIcon(id)).toBe('boolean');
  });

  it('getRankIdFromScore always returns an integer 0..4', () => {
    const rng = seededRng(5);
    for (let i = 0; i < FUZZ_ITERATIONS; i++) {
      const r = Rank.getRankIdFromScore(pick(rng, NON_SYMBOL), pick(rng, NON_SYMBOL));
      expect(Number.isInteger(r)).toBe(true);
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThanOrEqual(4);
    }
    expect(Rank.getRankIdFromScore(Infinity, NaN)).toBe(0);
  });
});

function shrineScene({ health = 100, maxHealth = 100, totalXP = 1000, weapon = 'spread' } = {}) {
  globalThis.window = { VIBE_CODER: { totalXP, xp: 0, level: 1 } };
  return {
    player: { health, maxHealth },
    currentWeapon: { type: weapon },
    updateHUD: vi.fn()
  };
}

describe('EVIL ShrineManager costs', () => {
  it('paying any health cost never leaves HP <= 0, NaN or above max', () => {
    const rng = seededRng(6);
    for (let i = 0; i < FUZZ_ITERATIONS; i++) {
      const maxHealth = pick(rng, [1, 2, 5, 10, 100, 1000]);
      const health = pick(rng, [0.5, 1, maxHealth * 0.1, maxHealth * 0.26, maxHealth, maxHealth * rng()]);
      const scene = shrineScene({ health, maxHealth });
      const mgr = new ShrineManager(scene);
      const cost = { type: 'health', amount: pick(rng, [0.1, 0.25, 0.99, 1, 2, ...HOSTILE_NUMBERS, 'x', null]) };
      if (mgr.canPayCost(cost)) {
        mgr.payCost(cost);
        expect(isFiniteNumber(scene.player.health)).toBe(true);
        expect(scene.player.health).toBeGreaterThan(0);
        expect(scene.player.health).toBeLessThanOrEqual(maxHealth);
      } else {
        expect(scene.player.health).toBe(health);
      }
    }
  });

  it('hostile health amounts are not payable (no free heals via negative cost)', () => {
    for (const amount of [-0.5, -Infinity, NaN, 'x', null, undefined, Infinity, 1, 1.5]) {
      const scene = shrineScene({ health: 50, maxHealth: 100 });
      const mgr = new ShrineManager(scene);
      expect(mgr.canPayCost({ type: 'health', amount })).toBe(false);
    }
  });

  it('xp costs never drive totalXP negative or NaN', () => {
    for (const amount of [500, -500, NaN, Infinity, 'x', 1e12]) {
      const scene = shrineScene({ totalXP: 600 });
      const mgr = new ShrineManager(scene);
      if (mgr.canPayCost({ type: 'xp', amount })) mgr.payCost({ type: 'xp', amount });
      expect(isFiniteNumber(window.VIBE_CODER.totalXP)).toBe(true);
      expect(window.VIBE_CODER.totalXP).toBeGreaterThanOrEqual(0);
      expect(window.VIBE_CODER.totalXP).toBeLessThanOrEqual(600);
    }
  });
});

function eventScene() {
  const pendingCompletes = [];
  const made = [];
  const mkObj = () => {
    const o = { destroyed: false, setScrollFactor() { return o; }, setDepth() { return o; }, setOrigin() { return o; }, setStrokeStyle() { return o; }, setScale() { return o; }, add() { return o; }, destroy() { o.destroyed = true; }, y: 0 };
    made.push(o);
    return o;
  };
  const scene = {
    time: { now: 0, delayedCall: vi.fn() },
    cameras: { main: {} },
    add: { container: mkObj, rectangle: mkObj, text: mkObj },
    tweens: { add: (cfg) => { if (cfg.onComplete) pendingCompletes.push(cfg.onComplete); } },
    xpEventMultiplier: 1, eventEnemySpeedMod: 1, forceRareDrops: false
  };
  return { scene, flushTweens: () => pendingCompletes.splice(0).forEach((fn) => fn()) };
}

describe('EVIL EventManager', () => {
  it('forcing an event while another is active does not leak the previous effects', () => {
    const { scene } = eventScene();
    const mgr = new EventManager(scene);
    mgr.forceEvent('double_xp');
    expect(scene.xpEventMultiplier).toBe(2);
    mgr.forceEvent('curse');
    expect(mgr.activeEvent.id).toBe('curse');
    expect(scene.xpEventMultiplier).toBe(1);
  });

  it('a late hide-tween never destroys the HUD of the event that replaced it', () => {
    const { scene, flushTweens } = eventScene();
    const mgr = new EventManager(scene);
    mgr.forceEvent('double_xp');
    mgr.forceEvent('jackpot');
    const liveHud = mgr.eventHUD;
    flushTweens();
    expect(mgr.eventHUD).toBe(liveHud);
    expect(liveHud.destroyed).toBe(false);
  });

  it('tryTriggerEvent ignores non-numeric waves', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    for (const w of [NaN, 'abc', null, undefined, {}, '99']) {
      const { scene } = eventScene();
      const mgr = new EventManager(scene);
      expect(mgr.tryTriggerEvent(w)).toBe(false);
    }
  });

  it('forceEvent with garbage ids is a no-op', () => {
    const { scene } = eventScene();
    const mgr = new EventManager(scene);
    for (const id of NON_SYMBOL) expect(() => mgr.forceEvent(id)).not.toThrow();
    expect(mgr.isEventActive()).toBe(false);
  });
});

describe('EVIL MapManager.biomeEffect', () => {
  const biomes = Object.values(BIOMES);
  const zonesFor = () => [{ x: 100, y: 100, radius: 200 }, { x: 900, y: 900, radius: 200 }];

  it('outputs are always finite, damage >= 0 and bounded by dps * MAX_BIOME_DT_MS', () => {
    const rng = seededRng(7);
    for (let i = 0; i < FUZZ_ITERATIONS * 3; i++) {
      const b = pick(rng, biomes);
      const ps = {
        x: pick(rng, [100, 120, ...HOSTILE_NUMBERS]),
        y: pick(rng, [100, 120, ...HOSTILE_NUMBERS]),
        worldWidth: pick(rng, [4000, ...HOSTILE_NUMBERS, undefined]),
        worldHeight: pick(rng, [3000, ...HOSTILE_NUMBERS, undefined]),
        time: pick(rng, [0, 500, 1e6, ...HOSTILE_NUMBERS, undefined]),
        lastTeleport: pick(rng, [-Infinity, 0, NaN]),
        zones: pick(rng, [zonesFor(), [], null, [null], [{ x: NaN, y: 0, radius: 'big' }]])
      };
      const dt = pick(rng, [16, 33, ...HOSTILE_NUMBERS, 'x', null]);
      let out;
      expect(() => { out = biomeEffect(b, ps, dt); }).not.toThrow();
      for (const k of ['speedMult', 'pushX', 'pushY', 'damage']) expect(isFiniteNumber(out[k])).toBe(true);
      expect(out.damage).toBeGreaterThanOrEqual(0);
      if (b.mechanic.type === 'pulseDamage') expect(out.damage).toBeLessThanOrEqual(b.mechanic.dps * MAX_BIOME_DT_MS / 1000 + 1e-9);
      if (out.teleportTo) { expect(isFiniteNumber(out.teleportTo.x)).toBe(true); expect(isFiniteNumber(out.teleportTo.y)).toBe(true); }
    }
  });

  it('a negative dt never heals inside a damage zone', () => {
    const b = biomes.find((x) => x.mechanic.type === 'pulseDamage');
    const out = biomeEffect(b, { x: 100, y: 100, time: 0, zones: zonesFor() }, -5000);
    expect(out.damage).toBe(0);
  });
});
