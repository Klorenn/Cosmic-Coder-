#!/usr/bin/env node
/**
 * HUD screenshots — opens the running dev server, starts a casual run and captures the HUD.
 * Writes scripts/evil-player/reports/hud-<viewport>.png for each viewport.
 *
 * Env:
 *   HUD_URL        game URL (default http://localhost:3001; the dev server must already be running)
 *   HUD_WAIT_MS    ms of play before the capture (default 8000)
 *   HUD_VIEWPORTS  comma list of WxH (default 1920x1080,1280x720,1024x600,375x812)
 *   HUD_DEMO       1 (default) grants a temporary weapon, buffs and a revive so every HUD widget is visible
 *   HUD_GAMEOVER   1 (default) also kills the player and captures the game over screen (hud-gameover-<viewport>.png)
 *   HUD_BANNER     1 (default) also captures a wave banner (hud-banner-<viewport>.png)
 *   HUD_PAUSE      1 (default) also captures the pause menu (hud-pause-<viewport>.png) and a level-up banner
 *                  with a floating crit / pickup text (hud-levelup-<viewport>.png)
 *   HUD_SCENES     1 (default) also captures item pickups + buff HUD (hud-items-*), a teleporter portal in
 *                  NETWORK LAYER (hud-portal-*) and a shrine with its proximity prompt (hud-shrine-*)
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPORT_DIR = path.join(__dirname, 'reports');
const GAME_URL = process.env.HUD_URL || 'http://localhost:3001';
const WAIT_MS = Number(process.env.HUD_WAIT_MS) > 0 ? Number(process.env.HUD_WAIT_MS) : 8000;
const DEMO = process.env.HUD_DEMO !== '0';
const GAMEOVER = process.env.HUD_GAMEOVER !== '0';
const BANNER = process.env.HUD_BANNER !== '0';
const PAUSE = process.env.HUD_PAUSE !== '0';
const SCENES = process.env.HUD_SCENES !== '0';
const VIEWPORTS = (process.env.HUD_VIEWPORTS || '1920x1080,1280x720,1024x600,375x812')
  .split(',')
  .map((v) => v.trim().split('x').map(Number))
  .filter(([w, h]) => w > 0 && h > 0);

const TITLE_READY = `(() => { const g = window.__VIBE_GAME__; return !!(g && g.scene && g.scene.isActive('TitleScene')); })()`;
const ARENA_READY = `(() => { const g = window.__VIBE_GAME__; const a = g && g.scene.getScene('ArenaScene'); return !!(a && g.scene.isActive('ArenaScene') && a.player && a.player.active && a.hudContainer); })()`;

async function capture(browser, width, height) {
  const context = await browser.newContext({ viewport: { width, height } });
  // Hermetic: only the local dev server is reachable.
  await context.route('**/*', (route) => {
    const u = new URL(route.request().url());
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname) || u.protocol === 'data:' || u.protocol === 'blob:';
    return local ? route.continue() : route.abort('blockedbyclient');
  });
  await context.addInitScript(() => {
    if (!localStorage.getItem('vibeCoderSettings')) {
      localStorage.setItem('vibeCoderSettings', JSON.stringify({ playerName: 'HUDCAM', musicEnabled: false, sfxEnabled: false }));
    }
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e?.message || e)));
  await page.goto(GAME_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(TITLE_READY, null, { timeout: 60000, polling: 250 });
  await page.evaluate(() => window.__VIBE_GAME__.scene.getScene('TitleScene').startCasualGame());
  await page.waitForFunction(ARENA_READY, null, { timeout: 30000, polling: 250 });
  await page.waitForTimeout(WAIT_MS);
  if (DEMO) {
    await page.evaluate(async () => {
      const a = window.__VIBE_GAME__.scene.getScene('ArenaScene');
      if (!a.player || !a.player.active || a.playerDead) return;
      const { ITEMS } = await import('/src/data/items.js');
      const { applyItem } = await import('/src/systems/ItemManager.js');
      for (const id of ['overclock', 'firewall', 'root_access', 'hotfix']) a.itemState = applyItem(a.itemState, ITEMS[id]);
      a.player.health = Math.max(1, Math.floor(a.player.maxHealth * 0.62));
      a.collectedWeapons.add('spread');
      a.currentWeapon = { type: 'spread', duration: 30000 };
      if (a.weaponExpiryTimer) a.weaponExpiryTimer.remove();
      a.weaponExpiryTimer = a.time.delayedCall(30000, () => {});
      // Stand-in mini-boss (HUD reads only these fields) so the boss bar is captured too.
      if (!a.currentBoss) a.hudMiniBoss = { active: true, health: 640, maxHealth: 1000, miniBossName: 'DEADLOCK', miniBossColor: 0xff3355 };
    });
    await page.waitForTimeout(1200);
  }
  const hud = await page.evaluate(() => {
    const a = window.__VIBE_GAME__.scene.getScene('ArenaScene');
    return {
      alive: !!(a.player && a.player.active && !a.playerDead),
      zoom: a.cameras.main.zoom,
      compact: a.hudLayout?.compact,
      hudOnUiCamera: a.hudContainer.willRender(a.uiCamera) && !a.hudContainer.willRender(a.cameras.main),
      playerOnWorldCamera: !a.player || a.player.willRender(a.cameras.main) && !a.player?.willRender(a.uiCamera)
    };
  });
  const file = path.join(REPORT_DIR, `hud-${width}x${height}.png`);
  await page.screenshot({ path: file });
  if (BANNER) {
    await page.evaluate(() => {
      const a = window.__VIBE_GAME__.scene.getScene('ArenaScene');
      a.showHudBanner(`${'WAVE'} ${a.waveNumber + 1}`, { duration: 1200 });
    });
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(REPORT_DIR, `hud-banner-${width}x${height}.png`) });
  }
  if (PAUSE) {
    await page.evaluate(() => {
      const a = window.__VIBE_GAME__.scene.getScene('ArenaScene');
      a.showLevelUp(window.VIBE_CODER.level + 1);
      a.showDamageNumber(a.player.x + 60, a.player.y - 20, 128, true);
      a.showItemText(a.player.x - 70, a.player.y - 40, 'Firewall', 0x22d3ee);
    });
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(REPORT_DIR, `hud-levelup-${width}x${height}.png`) });
    await page.evaluate(() => window.__VIBE_GAME__.scene.getScene('ArenaScene').pauseGame());
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(REPORT_DIR, `hud-pause-${width}x${height}.png`) });
    await page.evaluate(() => {
      const a = window.__VIBE_GAME__.scene.getScene('ArenaScene');
      if (a.isPaused) a.resumeGame();
    });
    await page.waitForTimeout(150);
  }
  if (SCENES) {
    // Freeze the run so the staged shots stay put (enemies cleared, spawns stopped, no autopilot drift).
    const stage = (fn, arg) => page.evaluate(fn, arg);
    await stage(() => {
      const a = window.__VIBE_GAME__.scene.getScene('ArenaScene');
      if (a.spawnTimer && a.spawnTimer.paused !== undefined) a.spawnTimer.paused = true;
      a.enemies.clear(true, true);
      a.invincible = true;
      a.physics.pause(); // no movement, no pickups collected while staging
    });
    // Items: one pickup per rarity next to the player + buff chips in the HUD.
    await stage(() => {
      const a = window.__VIBE_GAME__.scene.getScene('ArenaScene');
      a.enemies.clear(true, true);
      const { x, y } = a.player;
      [['health_patch', -210, -40], ['firewall', -80, -120], ['root_access', 80, -120], ['stack_overflow', 210, -40]]
        .forEach(([id, dx, dy]) => a.spawnItemPickup(x + dx, y + dy, id));
    });
    await page.waitForTimeout(450);
    await page.screenshot({ path: path.join(REPORT_DIR, `hud-items-${width}x${height}.png`) });
    // Portal: NETWORK LAYER (stage 2) has teleporter pads + teleport zones; park the player beside one.
    await stage(() => {
      const a = window.__VIBE_GAME__.scene.getScene('ArenaScene');
      a.itemPickups && a.itemPickups.clear(true, true);
      a.currentStage = 2;
      a.mapManager.transitionToStage(2, { fadeMs: 0 });
      a.enemies.clear(true, true);
      const pads = a.mapManager.teleporters.getChildren();
      const zones = a.mapManager.mechanicZones || [];
      const p = pads[0] ? { x: pads[0].teleporterX, y: pads[0].teleporterY } : zones[0];
      if (p) {
        a.player.setPosition(p.x + 150, p.y + 40);
        a.player.setVelocity(0, 0);
        a.cameras.main.centerOn(p.x + 75, p.y);
      }
    });
    await page.waitForTimeout(700);
    await page.screenshot({ path: path.join(REPORT_DIR, `hud-portal-${width}x${height}.png`) });
    // Shrine: stand inside the interact radius so the name + keycap prompt shows.
    await stage(() => {
      const a = window.__VIBE_GAME__.scene.getScene('ArenaScene');
      const sm = a.shrineManager;
      if (!sm) return;
      if (!sm.shrines.length) sm.spawnShrines();
      const s0 = sm.shrines.find((s) => !s.isUsed) || sm.shrines[0];
      if (!s0) return;
      a.enemies.clear(true, true);
      a.player.setPosition(s0.x + 44, s0.y + 18);
      a.player.setVelocity(0, 0);
      a.cameras.main.centerOn(s0.x, s0.y);
    });
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(REPORT_DIR, `hud-shrine-${width}x${height}.png`) });
    await stage(() => {
      const a = window.__VIBE_GAME__.scene.getScene('ArenaScene');
      a.invincible = false;
      a.physics.resume();
    });
  }
  if (GAMEOVER) {
    await page.evaluate(() => {
      const a = window.__VIBE_GAME__.scene.getScene('ArenaScene');
      if (a.player && !a.playerDead) a.playerDeath();
    });
    await page.waitForTimeout(6000);
    await page.screenshot({ path: path.join(REPORT_DIR, `hud-gameover-${width}x${height}.png`) });
  }
  await context.close();
  return { file, hud, errors };
}

async function main() {
  mkdirSync(REPORT_DIR, { recursive: true });
  const browser = await chromium.launch({ headless: true, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  let failed = false;
  try {
    for (const [w, h] of VIEWPORTS) {
      const { file, hud, errors } = await capture(browser, w, h);
      const ok = hud.hudOnUiCamera && hud.playerOnWorldCamera && errors.length === 0;
      if (!ok) failed = true;
      process.stdout.write(`${ok ? 'ok ' : 'BAD'} ${w}x${h} -> ${path.relative(process.cwd(), file)} ${JSON.stringify(hud)}${errors.length ? ` errors=${JSON.stringify(errors.slice(0, 3))}` : ''}\n`);
    }
  } finally {
    await browser.close();
  }
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  process.stderr.write(`${e?.stack || e}\n`);
  process.exit(1);
});
