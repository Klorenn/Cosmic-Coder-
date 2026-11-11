#!/usr/bin/env node
/**
 * Weapon art screenshots (weapons v2). Opens the running dev server, starts a casual run, freezes it and
 * equips each weapon and fires it from the player (projectile / swing / orbitals + aura / AoE) plus its world drop. Writes scripts/evil-player/reports/hud-weapons-<id>-<W>x<H>.png.
 *
 * Uses the real ArenaScene wiring (autoAttack -> applyWeaponArt, createOrbitals, doAoeAttack) against a
 * dummy enemy; nothing in src/ is modified.
 *
 * Env: HUD_URL (default http://localhost:3001), WEAPONS (comma list), VIEWPORT (default 1280x720)
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPORT_DIR = path.join(__dirname, 'reports');
const GAME_URL = process.env.HUD_URL || 'http://localhost:3001';
const IDS = (process.env.WEAPONS || 'basic,spread,homing,laserbeam,chainlightning,sword,ringoffire,deathaura,aoe').split(',').map((s) => s.trim()).filter(Boolean);
const [W, H] = (process.env.VIEWPORT || '1280x720').split('x').map(Number);

const TITLE_READY = `(() => { const g = window.__VIBE_GAME__; return !!(g && g.scene && g.scene.isActive('TitleScene')); })()`;
const ARENA_READY = `(() => { const g = window.__VIBE_GAME__; const a = g && g.scene.getScene('ArenaScene'); return !!(a && g.scene.isActive('ArenaScene') && a.player && a.player.active && a.hudContainer); })()`;

/** Runs in the page: equip the weapon and fire it through the REAL ArenaScene code (autoAttack / createOrbitals). */
function stage({ id }) {
  const a = window.__VIBE_GAME__.scene.getScene('ArenaScene');
  a.__weaponStage = a.__weaponStage || [];
  a.__weaponStage.forEach((o) => o.destroy());
  a.__weaponStage = [];
  a.projectiles.clear(true, true);
  a.weaponDrops.clear(true, true);
  a.clearOrbitals();
  a.enemies.clear(true, true);
  const all = { ...a.weaponTypes };
  for (const r of Object.values(a.evolutionRecipes || {})) all[r.result] = r;
  const w = all[id] || all.basic;
  a.currentWeapon = { type: id, duration: 30000 };
  const { x, y } = a.player;
  const keep = (o) => { a.__weaponStage.push(o); return o; };
  const orbital = ['orbital', 'ringoffire', 'plasmaorb', 'deathaura'].includes(id);
  if (orbital) {
    a.createOrbitals();
  } else {
    const dummy = a.enemies.create(x + (w.melee && !w.projectiles ? 30 : 140), y - (w.melee && !w.projectiles ? 5 : 40), 'slash');
    dummy.health = 1e9; dummy.speed = 0; dummy.xpValue = 0; dummy.setAlpha(0.35);
    dummy.body.setVelocity(0, 0);
    a.lastAttackTime = -1e9;
    a.autoAttack();
  }
  const dropKey = a.textures.exists(`weapon-${id}`) ? `weapon-${id}` : 'weapon-spread';
  keep(a.add.image(x - 120, y + 70, dropKey)).setDepth(6);
  const first = a.projectiles.getChildren()[0] || (a.orbitals.getChildren()[0]) || null;
  return { orbital, texture: first && first.texture ? first.texture.key : null, tex: w.texture, aura: !!a.orbitalAura, projectiles: a.projectiles.getLength() };
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
      localStorage.setItem('vibeCoderSettings', JSON.stringify({ playerName: 'WEAPONCAM', musicEnabled: false, sfxEnabled: false }));
    }
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e?.message || e)));
  await page.goto(GAME_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(TITLE_READY, null, { timeout: 60000, polling: 250 });
  const loaded = await page.evaluate(() => {
    const t = window.__VIBE_GAME__.textures;
    return ['slash', 'proj-basic', 'weapon-spread', 'weapon-icon-basic', 'legendary-huntersWarglaive'].map((k) => [k, t.exists(k) ? t.get(k).source[0].width : null]);
  });
  console.log('[weapons] textures:', JSON.stringify(loaded));
  await page.evaluate(() => window.__VIBE_GAME__.scene.getScene('TitleScene').startCasualGame());
  await page.waitForFunction(ARENA_READY, null, { timeout: 30000, polling: 250 });
  await page.waitForTimeout(2500);
  await page.evaluate(() => {
    const a = window.__VIBE_GAME__.scene.getScene('ArenaScene');
    if (a.spawnTimer && a.spawnTimer.paused !== undefined) a.spawnTimer.paused = true;
    a.invincible = true;
    a.player.body.setVelocity(0, 0);
  });
  const shots = IDS.map((id) => [id, id]);
  for (const [label, id] of shots) {
    const info = await page.evaluate(stage, { id });
    await page.waitForTimeout(['aoe', 'sword', 'spear', 'excalibur'].includes(id) ? 90 : 220);
    const file = path.join(REPORT_DIR, `hud-weapons-${label}-${W}x${H}.png`);
    await page.screenshot({ path: file });
    console.log(`[weapons] ${label}: ${JSON.stringify(info)} -> ${path.relative(process.cwd(), file)}`);
  }
  console.log(`[weapons] page errors: ${errors.length}${errors.length ? `\n  ${errors.slice(0, 5).join('\n  ')}` : ''}`);
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
