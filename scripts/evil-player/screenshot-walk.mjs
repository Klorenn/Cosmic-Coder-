#!/usr/bin/env node
/**
 * 4-direction walk screenshots — for each character, starts a casual run on the running dev server,
 * holds a direction key and captures the player mid-stride.
 * Writes scripts/evil-player/reports/hud-walk-{down,up,left,right}-<char>-<WxH>.png and prints the
 * anim key / texture / flipX the scene picked for each direction (FAIL when it does not match).
 *
 * Env: HUD_URL (default http://localhost:3001), WALK_VIEWPORT (default 1280x720), WALK_CHARS (default all 3)
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPORT_DIR = path.join(__dirname, 'reports');
const GAME_URL = process.env.HUD_URL || 'http://localhost:3001';
const [W, H] = (process.env.WALK_VIEWPORT || '1280x720').split('x').map(Number);
const CHARS = (process.env.WALK_CHARS || 'vibecoder,destroyer,swordsman').split(',');
const PREFIX = { vibecoder: 'player', destroyer: 'player-destroyer', swordsman: 'player-swordsman' };
const DIRS = [
  ['down', 'KeyS', '-walk-down', false],
  ['up', 'KeyW', '-walk-up', false],
  ['left', 'KeyA', '-walk-side', true],
  ['right', 'KeyD', '-walk-side', false]
];

const TITLE_READY = `(() => { const g = window.__VIBE_GAME__; return !!(g && g.scene && g.scene.isActive('TitleScene')); })()`;
const ARENA_READY = `(() => { const g = window.__VIBE_GAME__; const a = g && g.scene.getScene('ArenaScene'); return !!(a && g.scene.isActive('ArenaScene') && a.player && a.player.active); })()`;

async function run(browser, charId) {
  const context = await browser.newContext({ viewport: { width: W, height: H } });
  await context.route('**/*', (route) => {
    const u = new URL(route.request().url());
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname) || u.protocol === 'data:' || u.protocol === 'blob:';
    return local ? route.continue() : route.abort('blockedbyclient');
  });
  await context.addInitScript(() => {
    const NativeWS = window.WebSocket;
    window.WebSocket = function HmrBlockedWebSocket(url, proto) {
      if (String(url).includes('token=') || /vite-hmr|vite-ping/.test(String(proto))) {
        return { readyState: 0, send() {}, close() {}, addEventListener() {}, removeEventListener() {} };
      }
      return new NativeWS(url, proto);
    };
    if (!localStorage.getItem('vibeCoderSettings')) {
      localStorage.setItem('vibeCoderSettings', JSON.stringify({ playerName: 'WALKCAM', musicEnabled: false, sfxEnabled: false }));
    }
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e?.message || e)));
  await page.goto(GAME_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(TITLE_READY, null, { timeout: 60000, polling: 250 });
  await page.evaluate(async (id) => {
    const { progressStore } = await import('/src/utils/walletProgressService.js');
    progressStore.selectedCharacter = id;
    window.VIBE_SELECTED_CHARACTER = id;
    window.__VIBE_GAME__.scene.getScene('TitleScene').startCasualGame();
  }, charId);
  await page.waitForFunction(ARENA_READY, null, { timeout: 30000, polling: 250 });
  await page.waitForTimeout(1500);
  const lines = [];
  for (const [dir, key, anim, flip] of DIRS) {
    // keep the player alive and the screen readable: no enemies near, full health
    await page.evaluate(() => {
      const a = window.__VIBE_GAME__.scene.getScene('ArenaScene');
      a.player.health = a.player.maxHealth;
      a.enemies?.getChildren?.().forEach((e) => e.active && e.destroy());
    });
    await page.keyboard.down(key);
    await page.waitForTimeout(450);
    const state = await page.evaluate(() => {
      const a = window.__VIBE_GAME__.scene.getScene('ArenaScene');
      const p = a.player;
      return { anim: p.anims.currentAnim?.key, tex: p.texture.key, frame: p.frame.name, flipX: p.flipX, facing: a.playerFacing, prefix: a.playerAnimPrefix };
    });
    const file = path.join(REPORT_DIR, `hud-walk-${dir}-${charId}-${W}x${H}.png`);
    await page.screenshot({ path: file });
    await page.keyboard.up(key);
    await page.waitForTimeout(150);
    const ok = state.anim === state.prefix + anim && state.flipX === flip && state.facing === dir;
    lines.push(`${ok ? 'OK  ' : 'FAIL'} ${charId} ${dir}: anim=${state.anim} tex=${state.tex}#${state.frame} flipX=${state.flipX} -> ${path.relative(process.cwd(), file)}`);
  }
  const idle = await page.evaluate(() => {
    const a = window.__VIBE_GAME__.scene.getScene('ArenaScene');
    return a.player.anims.currentAnim?.key;
  });
  lines.push(`     ${charId} stopped after right: anim=${idle}`);
  if (errors.length) lines.push(`     pageerrors: ${errors.slice(0, 3).join(' | ')}`);
  await context.close();
  return lines;
}

mkdirSync(REPORT_DIR, { recursive: true });
const browser = await chromium.launch();
let fail = false;
try {
  for (const c of CHARS) {
    const lines = await run(browser, c);
    for (const l of lines) console.log(l);
    if (lines.some((l) => l.startsWith('FAIL'))) fail = true;
  }
} finally {
  await browser.close();
}
process.exit(fail ? 1 : 0);
