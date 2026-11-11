#!/usr/bin/env node
/**
 * PERF probe — plays a casual run against the running dev server and samples game.loop.actualFps.
 *
 * Writes scripts/evil-player/reports/perf-<label>.json and prints p10/p50/p90 fps, enemy counts and
 * (with PERF_PROFILE=1) the top self-time functions from a Chrome CPU profile.
 *
 * Env:
 *   PERF_URL       game URL (default http://localhost:3001; the dev server must already be running)
 *   PERF_SECONDS   seconds of sampling (default 30)
 *   PERF_VIEWPORT  WxH (default 1280x720)
 *   PERF_MIN_ENEMIES  spawn extra enemies so at least this many are alive (default 40, 0 = off)
 *   PERF_PROFILE   1 to record a CPU profile and print the hottest functions
 *   PERF_LABEL     report file suffix (default "run")
 *   PERF_AFTER     optional JS function body evaluated after sampling; its return value is printed
 *   PERF_AB        JSON {name: jsBody} of configurations cycled every 3 s inside ONE page (same load, same
 *                  run), so machine-load drift cancels out; prints fps p50 per configuration
 *   PERF_QUERY     query string appended to the URL, e.g. "quality=low" to pin the graphics level
 *   PERF_EVAL      optional JS expression evaluated in the page once the arena is ready (A/B experiments,
 *                  e.g. hide a layer); \`a\` is the ArenaScene
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPORT_DIR = path.join(__dirname, 'reports');
const BASE_URL = process.env.PERF_URL || 'http://localhost:3001';
const URL_ = process.env.PERF_QUERY ? `${BASE_URL}${BASE_URL.includes('?') ? '&' : '?'}${process.env.PERF_QUERY}` : BASE_URL;
const SECONDS = Number(process.env.PERF_SECONDS) > 0 ? Number(process.env.PERF_SECONDS) : 30;
const [VW, VH] = (process.env.PERF_VIEWPORT || '1280x720').split('x').map(Number);
const MIN_ENEMIES = process.env.PERF_MIN_ENEMIES === undefined ? 40 : Number(process.env.PERF_MIN_ENEMIES) || 0;
const PROFILE = process.env.PERF_PROFILE === '1';
const LABEL = process.env.PERF_LABEL || 'run';

const TITLE_READY = `(() => { const g = window.__VIBE_GAME__; return !!(g && g.scene && g.scene.isActive('TitleScene')); })()`;
const ARENA_READY = `(() => { const g = window.__VIBE_GAME__; const a = g && g.scene.getScene('ArenaScene'); return !!(a && g.scene.isActive('ArenaScene') && a.player && a.player.active && a.hudContainer); })()`;

const pct = (arr, p) => {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};

function topSelfTime(profile, n = 15) {
  const total = new Map();
  const byId = new Map(profile.nodes.map((nd) => [nd.id, nd]));
  const dt = profile.timeDeltas || [];
  (profile.samples || []).forEach((id, i) => {
    const nd = byId.get(id);
    if (!nd) return;
    const cf = nd.callFrame;
    const file = (cf.url || '').split('/').slice(-2).join('/').split('?')[0];
    const key = `${cf.functionName || '(anon)'} ${file}:${cf.lineNumber + 1}`;
    total.set(key, (total.get(key) || 0) + (dt[i] || 0));
  });
  const sum = [...total.values()].reduce((a, b) => a + b, 0) || 1;
  return [...total.entries()].sort((a, b) => b[1] - a[1]).slice(0, n)
    .map(([k, us]) => ({ fn: k, ms: Math.round(us / 1000), pct: Math.round((us / sum) * 1000) / 10 }));
}

async function main() {
  mkdirSync(REPORT_DIR, { recursive: true });
  const browser = await chromium.launch({ headless: true, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const context = await browser.newContext({ viewport: { width: VW, height: VH } });
  await context.route('**/*', (route) => {
    const u = new URL(route.request().url());
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname) || u.protocol === 'data:' || u.protocol === 'blob:';
    return local ? route.continue() : route.abort('blockedbyclient');
  });
  await context.addInitScript(() => {
    localStorage.setItem('vibeCoderSettings', JSON.stringify({ playerName: 'PERF', musicEnabled: false, sfxEnabled: false }));
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e?.message || e)));
  await page.goto(URL_, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(TITLE_READY, null, { timeout: 60000, polling: 250 });
  await page.evaluate(() => window.__VIBE_GAME__.scene.getScene('TitleScene').startCasualGame());
  await page.waitForFunction(ARENA_READY, null, { timeout: 30000, polling: 250 });
  // Keep the run alive and crowded: invulnerable player, enough enemies on screen.
  await page.evaluate((minEnemies) => {
    const a = window.__VIBE_GAME__.scene.getScene('ArenaScene');
    window.__PERF_KEEPALIVE__ = setInterval(() => {
      if (!a.player || a.playerDead) return;
      a.player.health = a.player.maxHealth;
      if (minEnemies > 0 && a.enemies && a.enemies.countActive() < minEnemies && typeof a.spawnEnemy === 'function') {
        for (let i = 0; i < 6; i++) a.spawnEnemy();
      }
    }, 250);
  }, MIN_ENEMIES);

  if (process.env.PERF_EVAL) {
    const out = await page.evaluate((code) => {
      const a = window.__VIBE_GAME__.scene.getScene('ArenaScene');
      // eslint-disable-next-line no-new-func
      return new Function('a', code)(a);
    }, process.env.PERF_EVAL);
    if (out !== undefined) process.stdout.write(`eval: ${JSON.stringify(out)}\n`);
  }

  let cdp = null;
  if (PROFILE) {
    cdp = await page.context().newCDPSession(page);
    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.setSamplingInterval', { interval: 500 });
    await cdp.send('Profiler.start');
  }

  if (process.env.PERF_AB) {
    const configs = Object.entries(JSON.parse(process.env.PERF_AB));
    const per = Object.fromEntries(configs.map(([n]) => [n, []]));
    const endAb = Date.now() + SECONDS * 1000;
    let i = 0;
    while (Date.now() < endAb) {
      const [name, code] = configs[i % configs.length];
      await page.evaluate((c) => {
        const a = window.__VIBE_GAME__.scene.getScene('ArenaScene');
        // eslint-disable-next-line no-new-func
        new Function('a', c)(a);
      }, code);
      await page.waitForTimeout(1000); // settle
      for (let k = 0; k < 4; k++) {
        await page.waitForTimeout(500);
        per[name].push(await page.evaluate(() => window.__VIBE_GAME__.loop.actualFps));
      }
      i++;
    }
    for (const [name, arr] of Object.entries(per)) {
      process.stdout.write(`AB ${name.padEnd(14)} fps p50=${pct(arr, 50).toFixed(1)} p10=${pct(arr, 10).toFixed(1)} n=${arr.length}\n`);
    }
  }

  const samples = [];
  const end = Date.now() + (process.env.PERF_AB ? 1000 : SECONDS * 1000);
  while (Date.now() < end) {
    await page.waitForTimeout(500);
    const s = await page.evaluate(() => {
      const g = window.__VIBE_GAME__;
      const a = g.scene.getScene('ArenaScene');
      return {
        fps: Math.round(g.loop.actualFps * 10) / 10,
        enemies: a.enemies ? a.enemies.countActive() : 0,
        children: a.children.list.length,
        dead: !!a.playerDead,
        quality: a.qualityState?.level ?? null
      };
    });
    samples.push(s);
  }

  if (process.env.PERF_AFTER) {
    const after = await page.evaluate((code) => {
      const a = window.__VIBE_GAME__.scene.getScene('ArenaScene');
      // eslint-disable-next-line no-new-func
      return new Function('a', code)(a);
    }, process.env.PERF_AFTER);
    process.stdout.write(`after: ${JSON.stringify(after)}\n`);
  }

  let hot = null;
  if (cdp) {
    const { profile } = await cdp.send('Profiler.stop');
    hot = topSelfTime(profile);
  }
  await context.close();
  await browser.close();

  const fps = samples.map((s) => s.fps);
  const enemies = samples.map((s) => s.enemies);
  const result = {
    label: LABEL,
    at: new Date().toISOString(),
    viewport: `${VW}x${VH}`,
    seconds: SECONDS,
    fps: { p10: pct(fps, 10), p50: pct(fps, 50), p90: pct(fps, 90), min: Math.min(...fps) },
    enemies: { p50: pct(enemies, 50), max: Math.max(...enemies) },
    children: { p50: pct(samples.map((s) => s.children), 50) },
    samples,
    hot,
    errors: errors.slice(0, 5)
  };
  const file = path.join(REPORT_DIR, `perf-${LABEL}.json`);
  writeFileSync(file, JSON.stringify(result, null, 2));
  process.stdout.write(`fps p10=${result.fps.p10} p50=${result.fps.p50} p90=${result.fps.p90} min=${result.fps.min} | enemies p50=${result.enemies.p50} max=${result.enemies.max} | children p50=${result.children.p50}\n`);
  if (hot) hot.forEach((h) => process.stdout.write(`  ${String(h.pct).padStart(5)}%  ${String(h.ms).padStart(6)}ms  ${h.fn}\n`));
  if (errors.length) process.stdout.write(`page errors: ${JSON.stringify(errors.slice(0, 3))}\n`);
  process.stdout.write(`-> ${path.relative(process.cwd(), file)}\n`);
}

main().catch((e) => {
  process.stderr.write(`${e?.stack || e}\n`);
  process.exit(1);
});
