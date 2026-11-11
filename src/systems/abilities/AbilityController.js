/**
 * AbilityController — Phaser integration of the character abilities.
 * All rules live in abilityRules.js (pure, tested). Everything that touches scene internals goes
 * through injected callbacks; createArenaAbilityHooks() builds them for ArenaScene in one place.
 *
 * Clock: the controller keeps its own ability clock advanced by `delta` only while not blocked
 * (pause, level-up, game over), so cooldowns freeze with the game and never see a backwards jump.
 */
import { getCharacterAbility, resolveCharacterId } from '../../data/characters.js';
import {
  createAbilityState, canActivate, activate, tick, cooldownPct, cooldownRemaining, isActive,
  shouldAutoUse, buildSnapshot, contactLockTimestamp, knockbackVector, dashDirection,
  dashEndpoint, distanceToSegment, abilityDamage, enemiesInRadius
} from './abilityRules.js';
import {
  playHotReloadFx, playRmRfFx, createDashTrail, playDashFx, playReadyPing, floatLabel
} from './abilityFx.js';
import { CONTACT_IFRAMES_MS } from '../../config/balance.js';
import { applyItem } from '../ItemManager.js';
import { t } from '../../utils/i18n.js';
import logger from '../../utils/log.js';

const MAX_FRAME_DT = 250;
const AUTO_CHECK_MS = 100;
const DASH_MARGIN = 16;
const noop = () => {};
const finite = (n) => typeof n === 'number' && Number.isFinite(n);

/**
 * @param {Phaser.Scene} scene
 * @param {object} hooks
 * @param {string} hooks.characterId
 * @param {() => Phaser.GameObjects.Sprite} hooks.getPlayer
 * @param {() => Array} hooks.getEnemies          active enemy sprites
 * @param {(enemy, damage:number) => void} hooks.applyDamage
 * @param {(enemy) => boolean} hooks.isBoss
 * @param {() => {attackDamage:number}} hooks.getStats
 * @param {(remainingMs:number) => void} hooks.grantIFrames  called every frame while invulnerable
 * @param {(amount:number) => void} hooks.heal
 * @param {(mod:{id:string,type:string,value:number,durationMs:number}) => void} hooks.addTempModifier
 * @param {() => boolean} [hooks.isBlocked]       true while paused / dead / level-up
 * @param {() => boolean} [hooks.isAutoPilot]     true when the autopilot is driving
 * @param {() => {x,y,width,height}} [hooks.getWorldBounds]
 * @param {(enemy, dx:number, dy:number) => void} [hooks.knockback]
 * @param {(key:string) => string} [hooks.translate]
 * @param {'autopilot'|'always'|'never'} [hooks.autoUse='autopilot']
 * @param {boolean} [hooks.autoUpdate=true]       hook scene 'postupdate' automatically
 * @param {boolean} [hooks.listenKeyboard=true]   SPACE via the generic 'keydown' event
 */
export function attachAbilityController(scene, hooks = {}) {
  const characterId = resolveCharacterId(hooks.characterId);
  const ability = getCharacterAbility(characterId);
  const p = ability.params;
  const h = {
    getPlayer: () => null,
    getEnemies: () => [],
    applyDamage: noop,
    isBoss: (e) => !!(e && (e.isBoss || e.isMiniBoss)),
    getStats: () => ({ attackDamage: 0 }),
    grantIFrames: noop,
    heal: noop,
    addTempModifier: noop,
    isBlocked: () => false,
    isAutoPilot: () => true,
    getWorldBounds: () => null,
    knockback: (enemy, dx, dy) => { enemy.x += dx; enemy.y += dy; },
    translate: (k) => k,
    autoUse: 'autopilot',
    autoUpdate: true,
    listenKeyboard: true,
    ...hooks
  };

  let state = createAbilityState(characterId);
  let clock = 0;
  let lastTime = null;
  let lastAutoCheck = -Infinity;
  let wasReady = true;
  let dash = null; // { sx, sy, ex, ey, start, until }
  const trails = []; // { ax, ay, bx, by, until, nextTick, g }
  let destroyed = false;

  const safe = (fn, ...args) => {
    try { return fn(...args); } catch (err) { logger.warn('[abilities]', ability.id, err); return undefined; }
  };
  const player = () => safe(h.getPlayer);
  const enemies = () => {
    const list = safe(h.getEnemies);
    return Array.isArray(list) ? list.filter((e) => e && e.active !== false) : [];
  };
  const blocked = () => !!safe(h.isBlocked);
  const label = () => h.translate(ability.name_key);

  function snapshot(pl) {
    return buildSnapshot({
      player: pl,
      hp: pl?.health,
      maxHp: pl?.maxHealth,
      enemies: enemies().map((e) => ({ x: e.x, y: e.y, isBoss: !!safe(h.isBoss, e) }))
    });
  }

  // —— Effects ————————————————————————————————————————————————
  function doHotReload(pl) {
    const amount = Math.ceil((finite(pl.maxHealth) ? pl.maxHealth : 0) * p.healPct);
    if (amount > 0) safe(h.heal, amount);
    safe(h.addTempModifier, { id: 'ability_hot_reload', type: 'attackRate', value: p.attackRateMult, durationMs: p.buffMs });
    safe(h.grantIFrames, p.iFrameMs);
    playHotReloadFx(scene, pl, ability.color, label());
    if (amount > 0) floatLabel(scene, pl.x, pl.y + 24, `+${amount}`, 0x00ff66);
  }

  function doRmRf(pl) {
    const base = safe(h.getStats)?.attackDamage;
    const bounds = safe(h.getWorldBounds);
    const targets = enemiesInRadius(enemies(), pl.x, pl.y, p.radius);
    for (const e of targets) {
      const boss = !!safe(h.isBoss, e);
      const push = knockbackVector(pl.x, pl.y, e.x, e.y, boss ? p.bossKnockbackPx : p.knockbackPx);
      safe(h.applyDamage, e, abilityDamage(base, p.damageMult, boss, p.bossDamageMult));
      if (e.active === false) continue;
      safe(h.knockback, e, push.dx, push.dy);
      if (bounds) {
        const c = dashEndpoint({ x: e.x, y: e.y }, { dx: 0, dy: 0 }, 0, bounds, 0);
        e.x = c.x; e.y = c.y;
      }
    }
    playRmRfFx(scene, pl.x, pl.y, p.radius, ability.color, label());
  }

  function doSyncDash(pl, now) {
    const v = pl.body?.velocity;
    const snap = snapshot(pl);
    const dir = dashDirection(v ? { vx: v.x, vy: v.y } : null, pl, snap.nearest, pl.flipX ? -1 : 1);
    const end = dashEndpoint({ x: pl.x, y: pl.y }, dir, p.distance, safe(h.getWorldBounds), DASH_MARGIN);
    dash = { sx: pl.x, sy: pl.y, ex: end.x, ey: end.y, start: now, until: now + p.durationMs };
    safe(h.grantIFrames, p.durationMs);
    playDashFx(scene, pl.x, pl.y, ability.color, label());
  }

  // —— Per-frame ————————————————————————————————————————————————
  function stepDash(pl, now) {
    if (!dash) return;
    const k = Math.min(1, (now - dash.start) / Math.max(1, dash.until - dash.start));
    pl.x = dash.sx + (dash.ex - dash.sx) * k;
    pl.y = dash.sy + (dash.ey - dash.sy) * k;
    if (pl.body && typeof pl.body.setVelocity === 'function') pl.body.setVelocity(0, 0);
    if (k >= 1) {
      const g = createDashTrail(scene, dash.sx, dash.sy, dash.ex, dash.ey, ability.color, p.trailMs);
      trails.push({ ax: dash.sx, ay: dash.sy, bx: dash.ex, by: dash.ey, until: now + p.trailMs, nextTick: now, g });
      dash = null;
    }
  }

  function stepTrails(now) {
    for (let i = trails.length - 1; i >= 0; i--) {
      const tr = trails[i];
      let guard = 0;
      while (tr.nextTick <= now && tr.nextTick < tr.until && guard++ < 8) {
        const base = safe(h.getStats)?.attackDamage;
        const dmg = abilityDamage(base, p.trailDamageMult);
        for (const e of enemies()) {
          if (distanceToSegment(e.x, e.y, tr.ax, tr.ay, tr.bx, tr.by) <= p.trailWidth) safe(h.applyDamage, e, dmg);
        }
        tr.nextTick += p.trailTickMs;
      }
      if (now >= tr.until) trails.splice(i, 1);
    }
  }

  function wantsAuto() {
    if (h.autoUse === 'never') return false;
    if (h.autoUse === 'always') return true;
    return !!safe(h.isAutoPilot);
  }

  function tryActivate() {
    if (destroyed || blocked()) return false;
    const pl = player();
    if (!pl || pl.active === false || !finite(pl.x) || !finite(pl.y)) return false;
    if (!canActivate(state, clock)) return false;
    state = activate(state, clock);
    wasReady = false;
    if (ability.id === 'HOT_RELOAD') doHotReload(pl);
    else if (ability.id === 'RM_RF') doRmRf(pl);
    else if (ability.id === 'SYNC_DASH') doSyncDash(pl, clock);
    return true;
  }

  function update(time, delta) {
    if (destroyed) return;
    let dt = finite(delta) ? delta : (finite(time) && finite(lastTime) ? time - lastTime : 0);
    if (finite(time)) lastTime = time;
    if (blocked()) return;
    dt = Math.min(MAX_FRAME_DT, Math.max(0, dt));
    clock += dt;
    state = tick(state, clock);
    const pl = player();
    if (!pl || pl.active === false) return;

    if (isActive(state, clock)) safe(h.grantIFrames, state.activeUntil - clock);
    stepDash(pl, clock);
    stepTrails(clock);

    const ready = canActivate(state, clock);
    if (ready && !wasReady) playReadyPing(scene, pl, ability.color);
    wasReady = ready;

    if (ready && !dash && clock - lastAutoCheck >= AUTO_CHECK_MS && wantsAuto()) {
      lastAutoCheck = clock;
      if (shouldAutoUse(characterId, snapshot(pl))) tryActivate();
    }
  }

  function getHudModel() {
    const remainingMs = cooldownRemaining(state, clock);
    return {
      id: ability.id,
      characterId,
      name: h.translate(ability.name_key),
      desc: h.translate(ability.desc_key),
      nameKey: ability.name_key,
      descKey: ability.desc_key,
      color: ability.color,
      cooldownPct: cooldownPct(state, clock), // 0 = just used, 1 = ready
      remainingMs,
      ready: remainingMs <= 0,
      active: isActive(state, clock) || !!dash,
      key: ability.key
    };
  }

  /** Cooldown back to ready and transient effects cleared (in-place run restart). */
  function reset() {
    state = createAbilityState(characterId);
    clock = 0;
    lastTime = null;
    dash = null;
    trails.splice(0).forEach((tr) => tr.g?.destroy?.());
    wasReady = true;
  }

  // —— Wiring ——————————————————————————————————————————————————
  const onPostUpdate = (time, delta) => update(time, delta);
  // Generic 'keydown' on purpose: ArenaScene.destroyPauseMenu() calls off('keydown-SPACE') with no
  // handler, which would also remove a 'keydown-SPACE' listener registered here.
  const onKeyDown = (event) => {
    if (!event || event.repeat) return;
    if (event.code === 'Space' || event.key === ' ' || event.keyCode === 32) tryActivate();
  };
  const keyboard = scene?.input?.keyboard;
  if (h.autoUpdate && scene?.events) scene.events.on('postupdate', onPostUpdate);
  if (h.listenKeyboard && keyboard) keyboard.on('keydown', onKeyDown);

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    try { scene?.events?.off('postupdate', onPostUpdate); } catch (_) { /* scene gone */ }
    try { keyboard?.off('keydown', onKeyDown); } catch (_) { /* scene gone */ }
    try { scene?.events?.off('shutdown', destroy); scene?.events?.off('destroy', destroy); } catch (_) { /* scene gone */ }
    trails.splice(0).forEach((tr) => { try { tr.g?.destroy?.(); } catch (_) { /* already gone */ } });
    dash = null;
  }
  scene?.events?.once?.('shutdown', destroy);
  scene?.events?.once?.('destroy', destroy);

  return {
    update,
    tryActivate,
    getHudModel,
    reset,
    destroy,
    get state() { return state; }
  };
}

/**
 * Callbacks for ArenaScene, built from its existing members:
 * player sprite, enemies group, hitEnemy(), getStats(), itemState (ItemManager timed effects),
 * lastContactHitAt (damageRules contact i-frames), isPaused / playerDead, hudMode.
 */
export function createArenaAbilityHooks(scene, characterId) {
  return {
    characterId: characterId ?? scene.playingCharacterId ?? 'vibecoder',
    getPlayer: () => scene.player,
    getEnemies: () => (scene.enemies?.getChildren ? scene.enemies.getChildren() : []),
    applyDamage: (enemy, damage) => {
      if (enemy && enemy.active) scene.hitEnemy({ damage, pierce: true }, enemy);
    },
    isBoss: (e) => !!(e && (e.isBoss || e.isMiniBoss)),
    getStats: () => scene.getStats(),
    grantIFrames: (remainingMs) => {
      const now = scene.time?.now;
      const lock = contactLockTimestamp(now, now + remainingMs, CONTACT_IFRAMES_MS);
      if (lock !== null && (scene.lastContactHitAt == null || lock > scene.lastContactHitAt || scene.lastContactHitAt > now)) {
        scene.lastContactHitAt = lock;
      }
    },
    heal: (amount) => {
      const pl = scene.player;
      if (!pl || !finite(pl.health) || !finite(pl.maxHealth)) return;
      pl.health = Math.min(pl.maxHealth, pl.health + amount);
      if (typeof scene.updateHUD === 'function') scene.updateHUD();
    },
    addTempModifier: ({ id, type, value, durationMs }) => {
      if (!scene.itemState) return;
      scene.itemState = applyItem(scene.itemState, { id, effect: { type, value }, duration: durationMs });
    },
    isBlocked: () => !!(scene.isPaused || scene.playerDead || !scene.player || !scene.player.active),
    isAutoPilot: () => scene.hudMode !== 'manual',
    getWorldBounds: () => scene.physics?.world?.bounds ?? null,
    translate: t
  };
}

export default attachAbilityController;
