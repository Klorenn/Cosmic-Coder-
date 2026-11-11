#!/usr/bin/env node
/**
 * Weapon power check (in-game). Opens the running dev server, starts a casual run, holds the spawn
 * director and, for every weapon, equips it for WEAPON_SECONDS (default 8) against a horde kept at 20
 * enemies around the player (HP fixed, no XP so no level-up pauses). Reports kills per window and saves
 * a mid-window screenshot for the weapons in SHOTS (statuses: frozen blue, burning orange, chain, AoE).
 *
 * Env: HUD_URL (default http://localhost:3001), WEAPONS (comma list, default all), WEAPON_SECONDS,
 *      HORDE_HP (default 40), SHOTS (comma list), VIEWPORT (default 1280x720)
 * Output: scripts/evil-player/reports/weapon-power.json + weapon-power-<id>.png
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { WEAPONS, EVOLUTION_RECIPES } from '../../src/data/weapons.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPORT_DIR = path.join(__dirname, 'reports');
const GAME_URL = process.env.HUD_URL || 'http://localhost:3001';
const ALL = [...Object.keys(WEAPONS), ...Object.values(EVOLUTION_RECIPES).map((r) => r.result)];
const IDS = process.env.WEAPONS ? process.env.WEAPONS.split(',').map((s) => s.trim()).filter(Boolean) : ALL;
const SECONDS = Number(process.env.WEAPON_SECONDS || 8);
const HORDE_HP = Number(process.env.HORDE_HP || 40);
const SHOTS = new Set((process.env.SHOTS || 'freeze,ringoffire,chainlightning,aoe,kunai,blizzard,excalibur,rapid').split(','));
const [W, H] = (process.env.VIEWPORT || '1280x720').split('x').map(Number);

const TITLE_READY = `(() => { const g = window.__VIBE_GAME__; return !!(g && g.scene && g.scene.isActive('TitleScene')); })()`;
const ARENA_READY = `(() => { const g = window.__VIBE_GAME__; const a = g && g.scene.getScene('ArenaScene'); return !!(a && g.scene.isActive('ArenaScene') && a.player && a.player.active && a.hudContainer); })()`;

/** In page: clear the field, equip `id`, return the kill counter baseline. */
function equip({ id }) {
  const a = window.__VIBE_GAME__.scene.getScene('ArenaScene');
  a.projectiles.clear(true, true);
  a.enemies.clear(true, true);
  if (a.itemPickups) a.itemPickups.clear(true, true);
  if (a.weaponDrops) a.weaponDrops.clear(true, true);
  a.clearOrbitals();
  if (a.weaponExpiryTimer) { a.weaponExpiryTimer.remove(); a.weaponExpiryTimer = null; }
  a.currentWeapon = { type: id, duration: 1e9 };
  if (['orbital', 'ringoffire', 'plasmaorb', 'deathaura'].includes(id)) a.createOrbitals();
  a.lastAttackTime = -1e9;
  return window.VIBE_CODER.kills;
}

/** In page: keep the horde at 20 around the player; keep the player alive and still. */
function refill({ hp }) {
  const a = window.__VIBE_GAME__.scene.getScene('ArenaScene');
  a.waveClockHold = true;
  a.player.health = a.player.maxHealth;
  a.player.body.setVelocity(0, 0);
  let alive = a.enemies.countActive();
  let guard = 0;
  while (alive < 20 && guard++ < 40) {
    const ang = Math.random() * Math.PI * 2;
    const r = 40 + Math.random() * 200; // some spawn in melee reach: the player stands still here
    const e = a.spawnEnemy({ type: 'bug', x: a.player.x + Math.cos(ang) * r, y: a.player.y + Math.sin(ang) * r, elite: false });
    if (!e) break;
    e.health = hp;
    e.maxHealth = hp;
    e.xpValue = 0;
    e.damage = 0;
    alive++;
  }
  return alive;
}

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
      localStorage.setItem('vibeCoderSettings', JSON.stringify({ playerName: 'WEAPONPWR', musicEnabled: false, sfxEnabled: false }));
    }
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e?.message || e)));
  // Boot (and re-boot after a dev-server HMR full reload) into a casual run
  const boot = async () => {
    if (!(await page.evaluate(() => !!window.__VIBE_GAME__).catch(() => false))) {
      await page.goto(GAME_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    }
    await page.waitForFunction(TITLE_READY + ' || ' + ARENA_READY, null, { timeout: 60000, polling: 250 });
    if (!(await page.evaluate(ARENA_READY))) {
      await page.evaluate(() => window.__VIBE_GAME__.scene.getScene('TitleScene').startCasualGame());
      await page.waitForFunction(ARENA_READY, null, { timeout: 30000, polling: 250 });
      await page.waitForTimeout(1500);
    }
  };
  await boot();
  const stats = await page.evaluate(() => window.__VIBE_GAME__.scene.getScene('ArenaScene').getStats());
  console.log(`[weapon-power] player stats: ${JSON.stringify(stats)}`);

  const measure = async (id) => {
    const k0 = await page.evaluate(equip, { id });
    const t0 = Date.now();
    let shot = false;
    while (Date.now() - t0 < SECONDS * 1000) {
      await page.evaluate(refill, { hp: HORDE_HP });
      if (!shot && SHOTS.has(id) && Date.now() - t0 > 2500) {
        shot = true;
        await page.screenshot({ path: path.join(REPORT_DIR, `weapon-power-${id}.png`) });
      }
      await page.waitForTimeout(200);
    }
    return (await page.evaluate(() => window.VIBE_CODER.kills)) - k0;
  };

  const rows = [];
  for (const id of IDS) {
    let kills = null;
    for (let attempt = 0; attempt < 3 && kills === null; attempt++) {
      try {
        kills = await measure(id);
      } catch (e) {
        console.log(`[weapon-power] ${id}: retry after ${String(e.message || e).split('\n')[0]}`);
        await page.waitForTimeout(1500);
        await boot().catch(() => {});
      }
    }
    rows.push({ id, kills });
    console.log(`[weapon-power] ${id.padEnd(15)} kills/${SECONDS}s: ${kills}`);
  }
  writeFileSync(path.join(REPORT_DIR, 'weapon-power.json'), JSON.stringify({ seconds: SECONDS, hordeHp: HORDE_HP, rows, errors }, null, 2));
  console.log(`[weapon-power] page errors: ${errors.length}${errors.length ? `\n  ${errors.slice(0, 5).join('\n  ')}` : ''}`);
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
