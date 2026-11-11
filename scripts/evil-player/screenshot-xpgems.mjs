#!/usr/bin/env node
/**
 * XP gems + early enemy variety check (systems/xpGems.js, data/enemies.js early pool).
 *
 *  1. 30 s of a casual run in wave 1: count distinct enemy types spawned, screenshot.
 *  2. "No pickup, no level": gems dropped far from a frozen player never level it up; walking onto them does.
 *  3. Screenshot of gems on the floor + gems flying to the player.
 *  4. Clock pushed to wave 3: 30 s, count distinct types.
 *  0. (runs alongside 1) Idle autopilot levels up: no input for 45 s from the run start -> level >= 2
 *     (autoPilot 'collect' mode walks to gems when no enemy is within 160 px). Exit code 2 on failure.
 * Writes scripts/evil-player/reports/hud-xpgems-<W>x<H>.png and hud-wave1-variety-<W>x<H>.png.
 *
 * Env: HUD_URL (default http://localhost:3001), VIEWPORT (default 1280x720), PHASE_SECONDS (default 30)
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPORT_DIR = path.join(__dirname, 'reports');
const GAME_URL = process.env.HUD_URL || 'http://localhost:3001';
const [W, H] = (process.env.VIEWPORT || '1280x720').split('x').map(Number);
const PHASE_MS = (Number(process.env.PHASE_SECONDS) || 30) * 1000;
const WAVE_MS = 45000;

const TITLE_READY = `(() => { const g = window.__VIBE_GAME__; return !!(g && g.scene && g.scene.isActive('TitleScene')); })()`;
const ARENA_READY = `(() => { const g = window.__VIBE_GAME__; const a = g && g.scene.getScene('ArenaScene'); return !!(a && g.scene.isActive('ArenaScene') && a.player && a.player.active && a.hudContainer); })()`;

async function main() {
  mkdirSync(REPORT_DIR, { recursive: true });
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: W, height: H } });
  await context.route('**/*', (route) => {
    const u = new URL(route.request().url());
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname) || u.protocol === 'data:' || u.protocol === 'blob:';
    return local ? route.continue() : route.abort('blockedbyclient');
  });
  await context.addInitScript(() => {
    if (!localStorage.getItem('vibeCoderSettings')) {
      localStorage.setItem('vibeCoderSettings', JSON.stringify({ playerName: 'GEMCAM', musicEnabled: false, sfxEnabled: false }));
    }
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e?.message || e)));
  await page.goto(GAME_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(TITLE_READY, null, { timeout: 60000, polling: 250 });
  const tex = await page.evaluate(() => ['xp-gem-blue', 'xp-gem-green', 'xp-gem-red', 'enemy-typo-v2', 'enemy-cookie-v2']
    .map((k) => [k, window.__VIBE_GAME__.textures.exists(k)]));
  console.log('[xpgems] textures:', JSON.stringify(tex));
  await page.evaluate(() => window.__VIBE_GAME__.scene.getScene('TitleScene').startCasualGame());
  await page.waitForFunction(ARENA_READY, null, { timeout: 30000, polling: 250 });

  const idleStart = await page.evaluate(() => ({ level: window.VIBE_CODER.level, t: Date.now() }));
  const modes = {};
  const modeSampler = setInterval(() => {
    page.evaluate(() => window.__VIBE_GAME__.scene.getScene('ArenaScene').autoPlayMode)
      .then((m) => { if (m) modes[m] = (modes[m] || 0) + 1; }).catch(() => {});
  }, 500);

  // Count spawned types + keep the player alive (no damage path is touched).
  await page.evaluate(() => {
    const a = window.__VIBE_GAME__.scene.getScene('ArenaScene');
    a.__types = {};
    const orig = a.spawnEnemy;
    a.spawnEnemy = function spawnCounted(s) {
      const e = orig.call(this, s);
      const type = (e && e.enemyType) || (s && s.type);
      if (type) a.__types[type] = (a.__types[type] || 0) + 1;
      return e;
    };
    a.__keepAlive = setInterval(() => { if (a.player) { a.player.maxHealth = 1e6; a.player.health = 1e6; } }, 100);
  });

  // —— 1. wave 1 variety ——
  await page.waitForTimeout(PHASE_MS);
  const w1 = await page.evaluate(() => {
    const a = window.__VIBE_GAME__.scene.getScene('ArenaScene');
    return { wave: a.waveNumber, types: a.__types, gemsOnFloor: a.xpGemState.gems.length, level: window.__VIBE_GAME__ && window.VIBE_CODER.level, kills: window.VIBE_CODER.kills };
  });
  await page.screenshot({ path: path.join(REPORT_DIR, `hud-wave1-variety-${W}x${H}.png`) });
  console.log(`[xpgems] wave1 30s: wave=${w1.wave} distinct=${Object.keys(w1.types).length} ${JSON.stringify(w1.types)} gemsOnFloor=${w1.gemsOnFloor} level=${w1.level} kills=${w1.kills}`);

  // —— 0. idle autopilot levels up within 45 s ——
  const idleLeft = 45000 - (Date.now() - idleStart.t);
  if (idleLeft > 0) await page.waitForTimeout(idleLeft);
  clearInterval(modeSampler);
  const idleEnd = await page.evaluate(() => ({ level: window.VIBE_CODER.level, kills: window.VIBE_CODER.kills, gems: window.__VIBE_GAME__.scene.getScene('ArenaScene').xpGemState.gems.length }));
  const idleOk = idleEnd.level > idleStart.level;
  console.log(`[xpgems] idle autopilot 45s: level ${idleStart.level} -> ${idleEnd.level} kills=${idleEnd.kills} gemsOnFloor=${idleEnd.gems} modes=${JSON.stringify(modes)} ${idleOk ? 'PASS' : 'FAIL'}`);
  if (!idleOk) process.exitCode = 2;

  // —— 2. no pickup -> no level ——
  const noPickup = await page.evaluate(async () => {
    const a = window.__VIBE_GAME__.scene.getScene('ArenaScene');
    const vc = window.VIBE_CODER;
    a.enemies.clear(true, true);
    a.resetXpGems();
    a.__frozen = { x: a.player.x, y: a.player.y };
    a.__freeze = setInterval(() => { a.player.setPosition(a.__frozen.x, a.__frozen.y); a.player.body.setVelocity(0, 0); }, 0);
    const before = { level: vc.level, xp: vc.xp, score: vc.score };
    for (let i = 0; i < 12; i++) a.dropXpGem(a.player.x + 300 + i * 6, a.player.y + 200, 900);
    await new Promise((r) => setTimeout(r, 2500));
    const mid = { level: vc.level, xp: vc.xp, score: vc.score, gems: a.xpGemState.gems.length };
    a.__frozen = { x: a.player.x + 330, y: a.player.y + 200 };
    await new Promise((r) => setTimeout(r, 1500));
    const after = { level: vc.level, xp: vc.xp, score: vc.score, gems: a.xpGemState.gems.length };
    clearInterval(a.__freeze);
    return { before, mid, after };
  });
  console.log(`[xpgems] no-pickup: ${JSON.stringify(noPickup)}`);

  // —— 3. gems on the floor + one flying ——
  await page.evaluate(() => {
    const a = window.__VIBE_GAME__.scene.getScene('ArenaScene');
    a.enemies.clear(true, true);
    a.resetXpGems();
    const { x, y } = a.player;
    a.__frozen = { x, y };
    a.__freeze = setInterval(() => { a.player.setPosition(a.__frozen.x, a.__frozen.y); a.player.body.setVelocity(0, 0); }, 0);
    const vals = [3, 5, 8, 12, 25, 60, 4, 6, 15, 120, 2, 9];
    vals.forEach((v, i) => {
      const ang = (i / vals.length) * Math.PI * 2;
      const r = 170 + (i % 3) * 45;
      a.dropXpGem(x + Math.cos(ang) * r, y + Math.sin(ang) * r, v);
    });
    // Three gems inside a (temporarily 2x) pickup radius: they start flying to the player
    a.xpPickupRadiusMult = 2;
    a.dropXpGem(x + 105, y - 20, 7);
    a.dropXpGem(x - 100, y + 30, 30);
    a.dropXpGem(x + 15, y + 104, 4);
  });
  await page.waitForTimeout(170);
  await page.evaluate(() => window.__VIBE_GAME__.loop.sleep()); // freeze mid-flight
  await page.screenshot({ path: path.join(REPORT_DIR, `hud-xpgems-${W}x${H}.png`) });
  const flyingNow = await page.evaluate(() => {
    const a = window.__VIBE_GAME__.scene.getScene('ArenaScene');
    const r = { onFloor: a.xpGemState.gems.length, flying: a.xpGemState.gems.filter((g) => g.attracted).length };
    a.xpPickupRadiusMult = 1;
    window.__VIBE_GAME__.loop.wake();
    return r;
  });
  console.log(`[xpgems] at screenshot: ${JSON.stringify(flyingNow)}`);
  await page.evaluate(() => clearInterval(window.__VIBE_GAME__.scene.getScene('ArenaScene').__freeze));

  // —— 4. wave 3 variety ——
  const w3start = await page.evaluate((waveMs) => {
    const a = window.__VIBE_GAME__.scene.getScene('ArenaScene');
    const d = a.spawnDirector;
    const target = 3;
    d.startOffsetMs = (target - 1) * waveMs - d.lastNow + 500; // run clock lands 0.5 s into wave 3
    a.__types = {};
    return { waveBefore: a.waveNumber, gen: a.runGeneration };
  }, WAVE_MS);
  await page.waitForTimeout(PHASE_MS);
  const w3 = await page.evaluate(() => {
    const a = window.__VIBE_GAME__.scene.getScene('ArenaScene');
    clearInterval(a.__keepAlive);
    return { wave: a.waveNumber, types: a.__types || {}, gen: a.runGeneration, dead: !!a.playerDead, active: window.__VIBE_GAME__.scene.getScenes(true).map((x) => x.scene.key) };
  });
  console.log(`[xpgems] wave3 state: gen=${w3.gen} dead=${w3.dead} scenes=${w3.active}`);
  console.log(`[xpgems] wave3 30s: from=${w3start.waveBefore} wave=${w3.wave} distinct=${Object.keys(w3.types).length} ${JSON.stringify(w3.types)}`);
  console.log(`[xpgems] page errors: ${errors.length}${errors.length ? `\n  ${errors.slice(0, 5).join('\n  ')}` : ''}`);
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
