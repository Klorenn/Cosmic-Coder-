import { describe, it, expect, vi } from 'vitest';
import { attachAbilityController, createArenaAbilityHooks } from '../systems/abilities/AbilityController.js';

/** Minimal event emitter compatible with the Phaser API used by the controller. */
function emitter() {
  const map = new Map();
  return {
    on(ev, fn) { (map.get(ev) || map.set(ev, []).get(ev)).push({ fn, once: false }); return this; },
    once(ev, fn) { (map.get(ev) || map.set(ev, []).get(ev)).push({ fn, once: true }); return this; },
    off(ev, fn) { if (!fn) map.delete(ev); else map.set(ev, (map.get(ev) || []).filter((l) => l.fn !== fn)); return this; },
    emit(ev, ...args) { for (const l of [...(map.get(ev) || [])]) { if (l.once) this.off(ev, l.fn); l.fn(...args); } },
    count(ev) { return (map.get(ev) || []).length; }
  };
}

function fakeScene() {
  const gfx = () => {
    const g = {};
    ['setDepth', 'setPosition', 'clear', 'lineStyle', 'strokeCircle', 'fillStyle', 'fillCircle', 'lineBetween',
      'beginPath', 'moveTo', 'lineTo', 'strokePath', 'destroy', 'setOrigin'].forEach((m) => { g[m] = () => g; });
    return g;
  };
  return {
    events: emitter(),
    input: { keyboard: emitter() },
    add: { graphics: gfx, text: gfx },
    tweens: { add: () => ({}) },
    time: { now: 0, addEvent: () => ({ remove() {} }) },
    cameras: { main: { shake() {} } }
  };
}

const frame = (scene, n = 1, dt = 16) => { for (let i = 0; i < n; i++) { scene.time.now += dt; scene.events.emit('postupdate', scene.time.now, dt); } };
const space = { code: 'Space', key: ' ', repeat: false };

describe('AbilityController (fake scene)', () => {
  it('RM_RF damages enemies in radius (boss 2x), knocks back, then goes on cooldown', () => {
    const scene = fakeScene();
    const player = { x: 0, y: 0, health: 100, maxHealth: 100, active: true };
    const near = { x: 100, y: 0, active: true };
    const boss = { x: 0, y: 200, active: true, isBoss: true };
    const far = { x: 400, y: 0, active: true };
    const applyDamage = vi.fn();
    const ctl = attachAbilityController(scene, {
      characterId: 'destroyer', getPlayer: () => player, getEnemies: () => [near, boss, far],
      applyDamage, getStats: () => ({ attackDamage: 10 }), autoUse: 'never'
    });
    scene.input.keyboard.emit('keydown', space);
    expect(applyDamage).toHaveBeenCalledWith(near, 40);
    expect(applyDamage).toHaveBeenCalledWith(boss, 20);
    expect(applyDamage).toHaveBeenCalledTimes(2);
    expect(near.x).toBeCloseTo(250);
    expect(far.x).toBe(400);
    expect(ctl.getHudModel()).toMatchObject({ id: 'RM_RF', ready: false, key: 'SPACE', cooldownPct: 0 });
    expect(ctl.tryActivate()).toBe(false);
    ctl.destroy();
  });

  it('cooldown freezes while blocked and resumes after', () => {
    const scene = fakeScene();
    const player = { x: 0, y: 0, health: 100, maxHealth: 100, active: true };
    let paused = false;
    const ctl = attachAbilityController(scene, {
      characterId: 'swordsman', getPlayer: () => player, isBlocked: () => paused, autoUse: 'never'
    });
    expect(ctl.tryActivate()).toBe(true);
    paused = true;
    frame(scene, 100, 100); // 10 s paused
    expect(ctl.getHudModel().remainingMs).toBe(12000);
    expect(ctl.tryActivate()).toBe(false);
    paused = false;
    frame(scene, 50, 100); // 5 s
    expect(ctl.getHudModel().remainingMs).toBe(7000);
    ctl.destroy();
  });

  it('SYNC_DASH moves the player along the dash and grants i-frames', () => {
    const scene = fakeScene();
    const player = { x: 500, y: 500, health: 100, maxHealth: 100, active: true, body: { velocity: { x: 0, y: -200 } } };
    const grantIFrames = vi.fn();
    const ctl = attachAbilityController(scene, { characterId: 'swordsman', getPlayer: () => player, grantIFrames, autoUse: 'never' });
    ctl.tryActivate();
    expect(grantIFrames).toHaveBeenCalledWith(350);
    frame(scene, 30, 16);
    expect(player.x).toBeCloseTo(500);
    expect(player.y).toBeCloseTo(280);
    expect(ctl.getHudModel().active).toBe(false);
    ctl.destroy();
  });

  it('HOT_RELOAD heals 30%, adds the attack-rate modifier and auto-fires at low HP on autopilot', () => {
    const scene = fakeScene();
    const player = { x: 0, y: 0, health: 40, maxHealth: 100, active: true };
    const heal = vi.fn((n) => { player.health += n; });
    const addTempModifier = vi.fn();
    const ctl = attachAbilityController(scene, {
      characterId: 'vibecoder', getPlayer: () => player, heal, addTempModifier, isAutoPilot: () => true
    });
    frame(scene, 2);
    expect(heal).toHaveBeenCalledWith(30);
    expect(addTempModifier).toHaveBeenCalledWith({ id: 'ability_hot_reload', type: 'attackRate', value: 1.25, durationMs: 6000 });
    expect(player.health).toBe(70);
    ctl.destroy();
  });

  it('does not auto-fire in manual mode; destroy and shutdown remove listeners', () => {
    const scene = fakeScene();
    const player = { x: 0, y: 0, health: 10, maxHealth: 100, active: true };
    const heal = vi.fn();
    attachAbilityController(scene, { characterId: 'vibecoder', getPlayer: () => player, heal, isAutoPilot: () => false });
    frame(scene, 5);
    expect(heal).not.toHaveBeenCalled();
    expect(scene.events.count('postupdate')).toBe(1);
    expect(scene.input.keyboard.count('keydown')).toBe(1);
    scene.events.emit('shutdown');
    expect(scene.events.count('postupdate')).toBe(0);
    expect(scene.input.keyboard.count('keydown')).toBe(0);
  });

  it('createArenaAbilityHooks maps onto ArenaScene members', () => {
    const scene = fakeScene();
    scene.time.now = 5000;
    const enemy = { active: true };
    scene.player = { health: 50, maxHealth: 100, active: true };
    scene.enemies = { getChildren: () => [enemy] };
    scene.hitEnemy = vi.fn();
    scene.getStats = () => ({ attackDamage: 7 });
    scene.itemState = { health: 50, maxHealth: 100, effects: [] };
    scene.lastContactHitAt = null;
    scene.hudMode = 'hunt';
    const hk = createArenaAbilityHooks(scene, 'destroyer');
    hk.applyDamage(enemy, 12);
    expect(scene.hitEnemy).toHaveBeenCalledWith({ damage: 12, pierce: true }, enemy);
    hk.heal(80);
    expect(scene.player.health).toBe(100);
    hk.grantIFrames(2000);
    expect(scene.lastContactHitAt).toBe(5000);
    hk.addTempModifier({ id: 'ability_hot_reload', type: 'attackRate', value: 1.25, durationMs: 6000 });
    expect(scene.itemState.effects).toEqual([{ id: 'ability_hot_reload', type: 'attackRate', value: 1.25, remaining: 6000 }]);
    expect(hk.isAutoPilot()).toBe(true);
    scene.isPaused = true;
    expect(hk.isBlocked()).toBe(true);
  });
});
