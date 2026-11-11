#!/usr/bin/env node
/**
 * Boss mechanics screenshots + autopilot survival check.
 *
 * 1) For each boss (and mini-boss) id: spawn it through the REAL ArenaScene.spawnBoss / spawnMiniBoss,
 *    drop its HP into each phase, let the brain (systems/bossAI.js) pick the attack that phase unlocks and
 *    screenshot mid-telegraph -> scripts/evil-player/reports/hud-boss-<id>-phase<n>-<W>x<H>.png
 * 2) SURVIVE_MS (default 30000): fresh run, boss 1 (wave 20) spawned next to the autopilot player, no god
 *    mode; reports whether the player is alive after SURVIVE_MS and how many boss-attack hits landed.
 *
 * Env: HUD_URL (default http://localhost:3001), BOSSES (comma list), VIEWPORT (default 1280x720),
 *      SURVIVE_MS (0 to skip), SURVIVE_BOSS (default boss-stackoverflow), SURVIVE_LEVEL (default 15)
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPORT_DIR = path.join(__dirname, 'reports');
const GAME_URL = process.env.HUD_URL || 'http://localhost:3001';
const IDS = (process.env.BOSSES || 'boss-stackoverflow,boss-nullpointer,boss-memoryleakprime,boss-kernelpanic,miniboss-deadlock,miniboss-ddos')
  .split(',').map((s) => s.trim()).filter(Boolean);
const [W, H] = (process.env.VIEWPORT || '1280x720').split('x').map(Number);
const SURVIVE_MS = Number(process.env.SURVIVE_MS ?? 30000);
const SURVIVE_BOSS = process.env.SURVIVE_BOSS || 'boss-stackoverflow';
const SURVIVE_LEVEL = Number(process.env.SURVIVE_LEVEL ?? 15);

const TITLE_READY = `(() => { const g = window.__VIBE_GAME__; return !!(g && g.scene && g.scene.isActive('TitleScene')); })()`;
const ARENA_READY = `(() => { const g = window.__VIBE_GAME__; const a = g && g.scene.getScene('ArenaScene'); return !!(a && g.scene.isActive('ArenaScene') && a.player && a.player.active && a.hudContainer); })()`;

/** In page: spawn boss `id`, put it in `phase`, make the brain start that phase's attack now. */
function stage({ id, phase }) {
  const a = window.__VIBE_GAME__.scene.getScene('ArenaScene');
  a.resetBossSystems?.();
  a.enemies.clear(true, true);
  a.currentBoss = null;
  a.hudMiniBoss = null;
  a.player.maxHealth = 1e9;
  a.player.health = 1e9;
  a.player.body.setVelocity(0, 0);
  const mini = id.startsWith('miniboss');
  const boss = mini ? a.spawnMiniBoss(id) : a.spawnBoss(id);
  boss.setPosition(a.player.x + 150, a.player.y - 130);
  const thresholds = boss.bossMech.phases;
  const ratio = phase === 1 ? 1 : thresholds[phase - 1] - 0.03;
  boss.health = Math.max(1, Math.floor(boss.maxHealth * ratio));
  boss.bossHpGuard = boss.health;
  boss.bossBrain = { ...boss.bossBrain, globalReadyAt: a.time.now };
  boss.speed = 0;
  return { name: boss.bossName || boss.miniBossName, hp: boss.health, maxHp: boss.maxHealth };
}

function brainState() {
  const a = window.__VIBE_GAME__.scene.getScene('ArenaScene');
  const b = a.currentBoss?.active ? a.currentBoss : a.hudMiniBoss;
  if (!b || !b.bossBrain) return null;
  return { phase: b.bossBrain.phase, current: b.bossBrain.current && b.bossBrain.current.id, stage: b.bossBrain.current && b.bossBrain.current.stage, label: a.bossBarLabel(b) };
}

async function openArena(browser) {
  const context = await browser.newContext({ viewport: { width: W, height: H } });
  await context.route('**/*', (route) => {
    const u = new URL(route.request().url());
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname) || u.protocol === 'data:' || u.protocol === 'blob:';
    return local ? route.continue() : route.abort('blockedbyclient');
  });
  await context.addInitScript(() => {
    if (!localStorage.getItem('vibeCoderSettings')) {
      localStorage.setItem('vibeCoderSettings', JSON.stringify({ playerName: 'BOSSCAM', musicEnabled: false, sfxEnabled: false }));
    }
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e?.message || e)));
  await page.goto(GAME_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(TITLE_READY, null, { timeout: 60000, polling: 250 });
  await page.evaluate(() => window.__VIBE_GAME__.scene.getScene('TitleScene').startCasualGame());
  await page.waitForFunction(ARENA_READY, null, { timeout: 30000, polling: 250 });
  await page.waitForTimeout(2000);
  return { page, context, errors };
}

async function screenshots(browser) {
  const { page, context, errors } = await openArena(browser);
  for (const id of IDS) {
    const phases = id.startsWith('miniboss') ? 2 : 3;
    for (let phase = 1; phase <= phases; phase++) {
      const info = await page.evaluate(stage, { id, phase });
      // wait until the brain is mid-telegraph (or give up after 2.5 s)
      let st = null;
      for (let i = 0; i < 25; i++) {
        await page.waitForTimeout(100);
        st = await page.evaluate(brainState);
        if (st && st.stage === 'telegraph') break;
      }
      await page.waitForTimeout(350);
      st = await page.evaluate(brainState);
      const file = path.join(REPORT_DIR, `hud-boss-${id}-phase${phase}-${W}x${H}.png`);
      await page.screenshot({ path: file });
      console.log(`[bosses] ${id} p${phase}: ${JSON.stringify({ ...info, ...st })} -> ${path.relative(process.cwd(), file)}`);
    }
  }
  console.log(`[bosses] page errors: ${errors.length}${errors.length ? `\n  ${errors.slice(0, 5).join('\n  ')}` : ''}`);
  await context.close();
  return errors.length;
}

async function survive(browser) {
  const { page, context, errors } = await openArena(browser);
  const start = await page.evaluate(({ bossId, level, baseline }) => {
    const a = window.__VIBE_GAME__.scene.getScene('ArenaScene');
    // Emulate a player who actually reached wave 20 (level ~SURVIVE_LEVEL) instead of a fresh level-1 run.
    a.waveNumber = 20;
    window.VIBE_CODER.level = level;
    const st = a.getStats();
    a.player.maxHealth = st.maxHealth;
    a.player.health = st.maxHealth;
    window.__bossHits = 0;
    const orig = a.bossDamagePlayer.bind(a);
    a.bossDamagePlayer = (o, m) => { window.__bossHits++; return orig(o, m); };
    const boss = a.spawnBoss(bossId);
    boss.setPosition(a.player.x, a.player.y - 220);
    if (baseline) boss.bossMech = { ...boss.bossMech, attacks: {} }; // BASELINE=1: same boss, no mechanics
    return { hp: a.player.health, maxHp: a.player.maxHealth, bossHp: boss.health, bossDmg: boss.damage };
  }, { bossId: SURVIVE_BOSS, level: SURVIVE_LEVEL, baseline: process.env.BASELINE === '1' });
  const samples = [];
  const t0 = Date.now();
  while (Date.now() - t0 < SURVIVE_MS) {
    await page.waitForTimeout(2000);
    const s = await page.evaluate(() => {
      const a = window.__VIBE_GAME__.scene.getScene('ArenaScene');
      if (!a.player || window.__bossHits === undefined) return { reloaded: true, dead: false, hits: window.__bossHits };
      const b = a.currentBoss;
      return {
        t: Math.round(a.time.now / 1000), hp: Math.round(a.player.health), dead: !!a.playerDead, hits: window.__bossHits,
        bossHp: b?.active ? b.health : 0, phase: b?.bossBrain?.phase ?? null, atk: b?.bossBrain?.current?.id ?? null
      };
    });
    samples.push(s);
    if (s.dead || s.reloaded) break; // reloaded = dev-server HMR restarted the page (parallel edits)
  }
  const last = samples[samples.length - 1] || {};
  const elapsed = Math.round((Date.now() - t0) / 1000);
  console.log(`[bosses] survive ${SURVIVE_BOSS}: start ${JSON.stringify(start)}`);
  for (const s of samples) console.log(`  ${JSON.stringify(s)}`);
  console.log(`[bosses] survive result: ${last.dead ? 'DIED' : 'ALIVE'} after ~${elapsed}s, boss-attack hits ${last.hits}, page errors ${errors.length}${errors.length ? `\n  ${errors.slice(0, 5).join('\n  ')}` : ''}`);
  await context.close();
  return last.dead ? 1 : 0;
}

async function main() {
  mkdirSync(REPORT_DIR, { recursive: true });
  const browser = await chromium.launch();
  let bad = 0;
  if (IDS.length) bad += await screenshots(browser);
  if (SURVIVE_MS > 0) bad += await survive(browser);
  await browser.close();
  process.exit(bad ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
