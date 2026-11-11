#!/usr/bin/env node
/**
 * EVIL PLAYER — adversarial Playwright bot for Cosmic Coder.
 *
 * Plays the real game headless with hostile strategies, samples internal state every ~500 ms,
 * checks invariants, tries client-side exploits and forces game over.
 * Writes scripts/evil-player/reports/<timestamp>.{json,md}; exits 1 on any violation.
 *
 * Env:
 *   EVIL_URL        connect to an already running game instead of spawning `vite` (default: spawn on :3001)
 *   EVIL_SECONDS    seconds of play per run (default 90)
 *   EVIL_MODES      comma list of: auto,idle,spam,pause-resume,resize (default all)
 *   EVIL_CHARS      comma list of: vibecoder,destroyer,swordsman (default all)
 *   EVIL_MATRIX     "full" = every mode for every character; default "rotate" = 1 run per character
 *                   (mode rotates) + every remaining mode once
 *   EVIL_EXPLOITS   0 to skip the exploit phase (default on)
 *   EVIL_MIN_FPS    sustained FPS floor (default 15)
 *   EVIL_HEADFUL    1 to watch the browser
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../..');
const REPORT_DIR = path.join(__dirname, 'reports');

const ALL_MODES = ['auto', 'idle', 'spam', 'pause-resume', 'resize'];
const ALL_CHARS = ['vibecoder', 'destroyer', 'swordsman'];
const list = (v, all) => (v ? v.split(',').map((s) => s.trim()).filter((s) => all.includes(s)) : all);

const CFG = {
  url: process.env.EVIL_URL || 'http://localhost:3001',
  spawnServer: !process.env.EVIL_URL,
  seconds: Number(process.env.EVIL_SECONDS) > 0 ? Number(process.env.EVIL_SECONDS) : 90,
  modes: list(process.env.EVIL_MODES, ALL_MODES),
  chars: list(process.env.EVIL_CHARS, ALL_CHARS),
  matrix: process.env.EVIL_MATRIX === 'full' ? 'full' : 'rotate',
  exploits: process.env.EVIL_EXPLOITS !== '0',
  minFps: Number(process.env.EVIL_MIN_FPS) > 0 ? Number(process.env.EVIL_MIN_FPS) : 15,
  headful: process.env.EVIL_HEADFUL === '1',
  sampleMs: 500,
  maxEnemies: 500
};

const SPAM_KEYS = ['w', 'a', 's', 'd', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'e', 'E', 'm', 'p', 'Escape', 'Enter', 'Tab', 'q', 'r', '1', '2', '3', '9', 'Shift', 'Backspace'];
const VIEWPORTS = [{ width: 1280, height: 720 }, { width: 375, height: 812 }, { width: 812, height: 375 }, { width: 1920, height: 1080 }, { width: 320, height: 240 }, { width: 1024, height: 1366 }];
const SENSITIVE_URL = /soroban|stellar\.org|horizon|rpc|prover|zk\/|leaderboard|onrender\.com|supabase|\/api\//i;

// ---------------------------------------------------------------- report
const report = {
  startedAt: new Date().toISOString(),
  config: { ...CFG },
  runs: [],
  violations: [],
  consoleErrors: new Map(),
  consoleWarnings: new Map(),
  pageErrors: new Map(),
  failedRequests: new Map(),
  blockedExternal: new Map(),
  exploits: [],
  fpsSamples: []
};
const bump = (map, key, extra) => {
  const cur = map.get(key) || { count: 0, ...extra };
  cur.count++;
  map.set(key, cur);
};
function violation(run, kind, detail, state) {
  const v = { run: run?.id ?? 'global', kind, detail, at: new Date().toISOString(), state: state ?? null };
  report.violations.push(v);
  if (run) run.violations.push(v);
  console.log(`  !! VIOLATION [${kind}] ${detail}`);
}

// ---------------------------------------------------------------- server
async function isUp(url) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(2000) });
    return r.ok;
  } catch (_) {
    return false;
  }
}

async function ensureServer() {
  if (await isUp(CFG.url)) return null;
  if (!CFG.spawnServer) throw new Error(`EVIL_URL ${CFG.url} is not reachable`);
  console.log('> starting vite dev server on :3001');
  const child = spawn(path.join(REPO, 'node_modules/.bin/vite'), ['--port', '3001', '--strictPort'], {
    cwd: REPO,
    env: { ...process.env, BROWSER: 'none' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    if (await isUp(CFG.url)) return child;
    if (child.exitCode !== null) throw new Error('vite exited early:\n' + out);
    await sleep(500);
  }
  child.kill('SIGTERM');
  throw new Error('vite did not come up in 60s:\n' + out);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- browser helpers
let currentPhase = 'boot';
let exploitArmed = null; // when set: any sensitive network attempt is an un-blocked exploit

async function newPage(browser, { poison = false } = {}) {
  const context = await browser.newContext({ viewport: VIEWPORTS[0] });
  if (poison) await context.addInitScript(poisonStorageScript);
  // Hermetic: only the local dev server is reachable. Nothing ever reaches testnet / prover / APIs.
  await context.route('**/*', (route) => {
    const req = route.request();
    const u = new URL(req.url());
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname) || u.protocol === 'data:' || u.protocol === 'blob:';
    if (local) return route.continue();
    bump(report.blockedExternal, `${req.method()} ${u.origin}${u.pathname}`, { phase: currentPhase });
    // Background leaderboard polling (GET) is not a submission; writes and RPC/prover traffic are.
    const isSubmission = req.method() !== 'GET' || /soroban|rpc|prover|zk\//i.test(req.url());
    if (exploitArmed && SENSITIVE_URL.test(req.url()) && isSubmission) exploitArmed.attempts.push(`${req.method()} ${req.url()}`);
    return route.abort('blockedbyclient');
  });
  const page = await context.newPage();
  page.on('console', (msg) => {
    const type = msg.type();
    const text = msg.text().slice(0, 400);
    if (type === 'error') bump(report.consoleErrors, text, { phase: currentPhase });
    else if (type === 'warning') bump(report.consoleWarnings, text, { phase: currentPhase });
  });
  page.on('pageerror', (err) => {
    // Skip Phaser/vendor frames so the first app frame (the real culprit) is part of the key.
    const lines = (err.stack || err.message || String(err)).split('\n');
    const appFrames = lines.filter((l) => l.includes('/src/')).slice(0, 3);
    const key = [lines[0], ...lines.slice(1, 3), ...appFrames].join(' | ').slice(0, 700);
    bump(report.pageErrors, key, { phase: currentPhase });
  });
  page.on('requestfailed', (req) => {
    const f = req.failure()?.errorText || '';
    if (f.includes('BLOCKED_BY_CLIENT')) return; // our own hermetic block
    // Media elements abort range requests when the track switches/seeks: not a missing asset (a 404 is reported below).
    if (f.includes('ERR_ABORTED') && req.resourceType() === 'media') return;
    bump(report.failedRequests, `${req.method()} ${req.url()} (${f})`, { phase: currentPhase });
  });
  page.on('response', (res) => {
    if (res.status() >= 400) bump(report.failedRequests, `${res.status()} ${res.request().method()} ${res.url()}`, { phase: currentPhase });
  });
  return { context, page };
}

/** Runs in the page before any app code: fill every known storage key with garbage. */
function poisonStorageScript() {
  if (sessionStorage.getItem('__evilPoisoned')) return;
  sessionStorage.setItem('__evilPoisoned', '1');
  const garbage = {
    vibeCoderRebirth: '{"rebirthLevel":1e9,"highestWave":-5,"totalRebirths":"x","lifetimeKills":null}',
    vibeCoderRunSave: '{"wave":"ten","player":"hacker","timestamp":"yesterday"}',
    vibeCoderSettings: '{"masterVolume":99,"sfxVolume":-3,"playerName":{"x":1},"xpPenaltyOnDeath":7,"language":"klingon", "autoMove":"yes"',
    vibeCoderModifiers: '"glass_cannon_vampiric_bullet_hell"',
    cosmicCoderLeaderboard: '[null,1,"a",{"name":null,"score":"x","wave":{}}]',
    cosmicCoderProgressLocal: '{"highWave":1e400,"highScore":-1}',
    cosmicCoderGamesPlayed: '[',
    cosmicCoderRankedHistory: '{',
    cosmicCoderHasSignedZkOnce: '{"evil":true}'
  };
  for (const [k, v] of Object.entries(garbage)) localStorage.setItem(k, v);
}

async function waitFor(page, fnSrc, timeoutMs, label) {
  try {
    await page.waitForFunction(fnSrc, null, { timeout: timeoutMs, polling: 250 });
    return true;
  } catch (_) {
    return label ? false : false;
  }
}

const TITLE_READY = `(() => { const g = window.__VIBE_GAME__; return !!(g && g.scene && g.scene.isActive('TitleScene')); })()`;
const ARENA_READY = `(() => { const g = window.__VIBE_GAME__; const a = g && g.scene.getScene('ArenaScene'); return !!(a && g.scene.isActive('ArenaScene') && a.player && a.player.active && a.enemies); })()`;

async function gotoTitle(page, run) {
  currentPhase = `${run.id}:load`;
  await page.goto(CFG.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  const ok = await waitFor(page, TITLE_READY, 60000);
  if (!ok) violation(run, 'boot', 'TitleScene never became active within 60s');
  return ok;
}

async function startRun(page, run, character) {
  currentPhase = `${run.id}:start`;
  await page.evaluate(async (charId) => {
    const m = await import('/src/utils/walletProgressService.js');
    m.progressStore.selectedCharacter = charId;
    window.VIBE_SELECTED_CHARACTER = charId;
    // The game defaults to manual control; the bot opts into the autopilot for its runs.
    if (window.VIBE_SETTINGS) window.VIBE_SETTINGS.autoMove = true;
    const title = window.__VIBE_GAME__.scene.getScene('TitleScene');
    title.startCasualGame();
  }, character);
  const ok = await waitFor(page, ARENA_READY, 30000);
  if (!ok) violation(run, 'start', 'ArenaScene never became active after startCasualGame()');
  else {
    const playing = await page.evaluate(() => window.__VIBE_GAME__.scene.getScene('ArenaScene').playingCharacterId);
    if (playing !== character) violation(run, 'character', `selected ${character} but ArenaScene plays ${playing}`);
  }
  return ok;
}

/** Snapshot of the internal game state (runs in page). */
function snapshotInPage() {
  const g = window.__VIBE_GAME__;
  const a = g && g.scene.getScene('ArenaScene');
  const vc = window.VIBE_CODER || {};
  const scenes = g ? g.scene.getScenes(true).map((s) => s.sys.settings.key) : [];
  // Spam can legitimately leave the arena (pause menu -> quit/restart): report where we are instead of reading dead objects.
  if (!a || !a.player || !g.scene.isActive('ArenaScene') || !a.enemies || !a.enemies.children) return { ok: false, left: true, scenes };
  return {
    ok: true,
    scenes: g.scene.getScenes(true).map((s) => s.sys.settings.key),
    hidden: document.hidden,
    gameTime: a.time.now,
    frame: g.loop.frame,
    loopRunning: g.loop.running,
    fps: g.loop.actualFps,
    hp: a.player.health,
    maxHp: a.player.maxHealth,
    dead: !!a.playerDead,
    paused: !!a.isPaused,
    wave: a.waveNumber,
    runGen: a.runGeneration ?? 0,
    score: Math.floor(Number.isFinite(vc.score) ? vc.score : vc.totalXP),
    totalXP: vc.totalXP,
    xp: vc.xp,
    level: vc.level,
    kills: vc.kills,
    bits: window.VIBE_UPGRADES ? window.VIBE_UPGRADES.currency : null,
    weapon: a.currentWeapon ? a.currentWeapon.type : null,
    collected: a.collectedWeapons ? [...a.collectedWeapons] : [],
    items: a.itemState ? a.itemState.effects.map((e) => `${e.id}:${Math.round(e.remaining)}`) : [],
    shield: a.itemState ? a.itemState.shield : null,
    enemies: a.enemies ? a.enemies.countActive(true) : -1,
    stats: typeof a.getStats === 'function' ? a.getStats() : null
  };
}

function finite(n) {
  return typeof n === 'number' && Number.isFinite(n);
}

/** Invariant checks over consecutive samples. */
function makeChecker(run) {
  const st = { prev: null, lowFps: 0, frozen: 0, fired: new Set() };
  const once = (kind, detail, s) => {
    const key = kind + '|' + detail.replace(/[-\d.e+]+/g, '#');
    if (st.fired.has(key)) return;
    st.fired.add(key);
    violation(run, kind, detail, s);
  };
  return (s) => {
    if (!s.ok) return;
    run.samples++;
    if (finite(s.fps) && !s.hidden) { report.fpsSamples.push(s.fps); run.fps.push(s.fps); }
    for (const k of ['hp', 'maxHp', 'score', 'xp', 'level', 'wave', 'gameTime']) {
      if (!finite(s[k])) once('nan', `${k} is not finite (${s[k]})`, s);
    }
    if (finite(s.bits) && s.bits < 0) once('bits_negative', `bits=${s.bits}`, s);
    if (s.bits !== null && !finite(s.bits)) once('nan', `bits is not finite (${s.bits})`, s);
    if (!s.dead) {
      if (finite(s.hp) && finite(s.maxHp) && (s.hp < 0 || s.hp > s.maxHp + 1e-6)) once('hp_range', `hp=${s.hp} outside [0, ${s.maxHp}]`, s);
      if (finite(s.maxHp) && s.maxHp <= 0) once('hp_range', `maxHp=${s.maxHp} <= 0`, s);
    }
    if (s.stats) for (const [k, v] of Object.entries(s.stats)) if (!finite(v) || v <= 0) once('stats', `getStats().${k}=${v}`, s);
    if (s.enemies >= CFG.maxEnemies) once('enemy_cap', `${s.enemies} enemies alive (>= ${CFG.maxEnemies})`, s);
    const p = st.prev;
    // In-game restart (pause menu -> RESTART) starts a new run: score/wave legitimately go back to zero.
    if (p && p.ok && s.runGen === p.runGen) {
      if (finite(s.score) && finite(p.score) && s.score < p.score) once('score_decreased', `score ${p.score} -> ${s.score}`, s);
      if (finite(s.wave) && finite(p.wave) && s.wave < p.wave) once('wave_decreased', `wave ${p.wave} -> ${s.wave}`, s);
      if (!s.hidden && !p.hidden && !s.dead) {
        st.frozen = s.gameTime === p.gameTime && s.frame === p.frame ? st.frozen + 1 : 0;
        if (st.frozen >= 6) once('frozen', `game loop frozen for ${(st.frozen * CFG.sampleMs) / 1000}s (time=${s.gameTime}, frame=${s.frame})`, s);
      }
    }
    if (!s.hidden && finite(s.fps)) {
      st.lowFps = s.fps < CFG.minFps ? st.lowFps + 1 : 0;
      if (st.lowFps >= 10) once('fps', `fps < ${CFG.minFps} sustained for 5s (now ${s.fps.toFixed(1)})`, s);
    }
    run.maxWave = Math.max(run.maxWave, s.wave || 0);
    run.maxScore = Math.max(run.maxScore, s.score || 0);
    run.maxEnemies = Math.max(run.maxEnemies, s.enemies || 0);
    run.last = s;
    st.prev = s;
  };
}

// ---------------------------------------------------------------- input drivers
function makeDriver(page, mode) {
  let t = 0;
  let held = null;
  let viewportIdx = 0;
  let hidden = false;
  const setHidden = (h) => page.evaluate((hide) => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hide });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (hide ? 'hidden' : 'visible') });
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event(hide ? 'blur' : 'focus'));
  }, h);
  return {
    async tick(dtMs) {
      t += dtMs;
      if (mode === 'auto') {
        // The game's own auto-move only runs while "coding is active" (XP server events).
        // Simulate a live coding session so the built-in AI plays, exactly like a real idle player.
        await page.evaluate(() => { window.VIBE_CODER.lastCodingTime = Date.now(); });
      } else if (mode === 'spam') {
        const until = Date.now() + dtMs - 20;
        while (Date.now() < until) {
          const k = SPAM_KEYS[Math.floor(Math.random() * SPAM_KEYS.length)];
          await page.keyboard.press(k, { delay: 5 });
          if (Math.random() < 0.15) await page.mouse.click(Math.random() * 1200, Math.random() * 700);
        }
        return;
      } else if (mode === 'pause-resume') {
        if (t % 1500 < dtMs) { hidden = !hidden; await setHidden(hidden); }
      } else if (mode === 'resize') {
        if (t % 2000 < dtMs) {
          viewportIdx = (viewportIdx + 1) % VIEWPORTS.length;
          await page.setViewportSize(VIEWPORTS[viewportIdx]);
        }
      }
      await sleep(dtMs);
    },
    async stop() {
      if (held) await page.keyboard.up(held).catch(() => {});
      if (hidden) await setHidden(false).catch(() => {});
      if (mode === 'resize') await page.setViewportSize(VIEWPORTS[0]).catch(() => {});
    }
  };
}

// ---------------------------------------------------------------- game over
const GAME_OVER_READY = `!!window.__VIBE_GAME__.scene.getScene('ArenaScene')._gameOverKeydown`;
const FRESH_ARENA = `(() => { const g = window.__VIBE_GAME__; const a = g.scene.getScene('ArenaScene'); const vc = window.VIBE_CODER;
  return !!(g.scene.isActive('ArenaScene') && a.player && a.player.active && !a.playerDead && !a._gameOverKeydown && a.waveNumber === 1 && a.player.health > 0 && Math.floor(vc.totalXP) === 0); })()`;
const FIND_GAME_OVER = `(() => {
  const a = window.__VIBE_GAME__.scene.getScene('ArenaScene');
  const walk = (list) => list.some((o) => ((o.type === 'Text' || o.type === 'BitmapText') && o.text === 'GAME OVER' && o.visible) || (o.list && walk(o.list)));
  return !!(a && a.playerDead && walk(a.children.list));
})()`;

async function forceGameOver(page, run) {
  currentPhase = `${run.id}:gameover`;
  const res = { natural: false, gameOverShown: false, menuReachable: false, restartWorks: false };
  await page.evaluate(() => {
    const a = window.__VIBE_GAME__.scene.getScene('ArenaScene');
    if (a.isPaused && a.resumeGame) a.resumeGame();
    window.VIBE_SETTINGS.immortalMode = false;
    a.itemState = { ...a.itemState, revives: 0, shield: 0 };
    a.player.health = 1;
  });
  res.natural = await waitFor(page, `window.__VIBE_GAME__.scene.getScene('ArenaScene').playerDead === true`, 25000);
  if (!res.natural) {
    // Enemies never reached us: deliver the killing blow through the real hit path.
    await page.evaluate(() => {
      const a = window.__VIBE_GAME__.scene.getScene('ArenaScene');
      if (a.playerDead) return;
      a.player.health = 1;
      a.playerHit(a.player, { damage: 9999, active: false, x: a.player.x + 10, y: a.player.y });
    });
  }
  res.gameOverShown = await waitFor(page, FIND_GAME_OVER, 20000);
  if (!res.gameOverShown) { violation(run, 'game_over', 'GAME OVER screen did not appear within 20s of death'); return res; }
  // The menu becomes interactive once the (hermetically blocked) submit resolves.
  res.menuReachable = await waitFor(page, GAME_OVER_READY, 45000);
  if (!res.menuReachable) { violation(run, 'game_over', 'game-over menu never became interactive (submit never resolved?)'); return res; }
  // Enter = "Play again": ArenaScene must restart with a fresh, live run.
  await page.keyboard.press('Enter');
  res.playAgainWorks = await waitFor(page, FRESH_ARENA, 15000);
  if (!res.playAgainWorks) { violation(run, 'game_over', 'Enter (Play again) on game-over did not restart a fresh run'); return res; }
  // Die again, then Esc = "Menu" must return to TitleScene.
  await page.evaluate(() => {
    const a = window.__VIBE_GAME__.scene.getScene('ArenaScene');
    a.itemState = { ...a.itemState, revives: 0, shield: 0 };
    a.player.health = 1;
    a.playerHit(a.player, { damage: 9999, active: false, x: a.player.x + 10, y: a.player.y });
  });
  if (!(await waitFor(page, GAME_OVER_READY, 45000))) { violation(run, 'game_over', 'second game-over menu never became interactive'); return res; }
  await page.keyboard.press('Escape');
  res.restartWorks = await waitFor(page, TITLE_READY, 10000);
  if (!res.restartWorks) { violation(run, 'game_over', 'Esc (Menu) on game-over did not return to TitleScene'); return res; }
  // Second run from the same session must start cleanly (restart path).
  await page.evaluate(() => window.__VIBE_GAME__.scene.getScene('TitleScene').startCasualGame());
  const again = await waitFor(page, ARENA_READY, 20000);
  if (!again) violation(run, 'restart', 'could not start a new run after game over');
  else {
    const s = await page.evaluate(snapshotInPage);
    if (s.wave !== 1 || s.score !== 0 || s.dead || !(s.hp > 0)) violation(run, 'restart', `restarted run not clean: wave=${s.wave} score=${s.score} hp=${s.hp} dead=${s.dead}`, s);
    res.restartWorks = again;
  }
  return res;
}

// ---------------------------------------------------------------- runs
async function playRun(browser, character, mode, idx) {
  const run = { id: `${idx}-${character}-${mode}`, character, mode, seconds: CFG.seconds, samples: 0, violations: [], fps: [], maxWave: 0, maxScore: 0, maxEnemies: 0, last: null, gameOver: null, error: null };
  report.runs.push(run);
  console.log(`> run ${run.id} (${CFG.seconds}s)`);
  const { context, page } = await newPage(browser);
  try {
    if (!(await gotoTitle(page, run))) return run;
    if (!(await startRun(page, run, character))) return run;
    currentPhase = `${run.id}:play`;
    let check = makeChecker(run);
    const driver = makeDriver(page, mode);
    const end = Date.now() + CFG.seconds * 1000;
    run.deaths = 0;
    run.lives = 1;
    while (Date.now() < end) {
      await driver.tick(CFG.sampleMs);
      const s = await page.evaluate(snapshotInPage).catch((e) => ({ ok: false, err: e.message }));
      if (!s.ok && s.left) {
        // Left the arena through the in-game menu (spam hits Esc/P + Enter). Must land on a working scene.
        const back = await waitFor(page, `${TITLE_READY} || ${ARENA_READY}`, 15000);
        if (!back) { violation(run, 'navigation', `left ArenaScene and got stuck (active scenes: ${s.scenes.join(',') || 'none'})`); break; }
        run.menuExits = (run.menuExits || 0) + 1;
        if (await page.evaluate(TITLE_READY)) {
          if (Date.now() > end - 5000 || !(await startRun(page, run, character))) break;
        }
        run.lives++;
        currentPhase = `${run.id}:play`;
        check = makeChecker(run);
        continue;
      }
      if (!s.ok) { violation(run, 'state', `ArenaScene state unreadable (${s.err || s.scenes?.join(',')})`); break; }
      check(s);
      if (s.dead) {
        // Natural death: the game-over flow must work, then we start a new life until the time budget is spent.
        run.deaths++;
        await driver.stop();
        const shown = await waitFor(page, FIND_GAME_OVER, 20000);
        if (!shown) { violation(run, 'game_over', 'natural death but GAME OVER never appeared', s); break; }
        const go = await finishNaturalGameOver(page, run);
        run.gameOver = go;
        if (!go.restartWorks || Date.now() > end - 5000) break;
        if (!(await startRun(page, run, character))) break;
        run.lives++;
        currentPhase = `${run.id}:play`;
        check = makeChecker(run); // score/wave restart from zero on a new life
      }
    }
    await driver.stop();
    const alive = await page.evaluate(ARENA_READY).catch(() => false);
    if (alive) {
      const a = await page.evaluate(snapshotInPage);
      if (!a.dead) run.gameOver = await forceGameOver(page, run);
    }
  } catch (e) {
    run.error = e.message;
    violation(run, 'harness', `run crashed: ${e.message.split('\n')[0]}`);
  } finally {
    await context.close().catch(() => {});
  }
  return run;
}

async function finishNaturalGameOver(page, run) {
  const res = { natural: true, gameOverShown: true, menuReachable: false, restartWorks: false };
  res.menuReachable = await waitFor(page, GAME_OVER_READY, 45000);
  if (!res.menuReachable) { violation(run, 'game_over', 'game-over menu never became interactive'); return res; }
  // Esc = "Menu" (Enter = "Play again" is verified in forceGameOver).
  await page.keyboard.press('Escape');
  res.restartWorks = await waitFor(page, TITLE_READY, 10000);
  if (!res.restartWorks) violation(run, 'game_over', 'Esc (Menu) on game-over did not return to TitleScene');
  return res;
}

// ---------------------------------------------------------------- exploits
async function exploitPhase(browser) {
  const run = { id: 'exploits', character: 'vibecoder', mode: 'exploits', seconds: 20, samples: 0, violations: [], fps: [], maxWave: 0, maxScore: 0, maxEnemies: 0, last: null };
  report.runs.push(run);
  console.log('> exploit phase (poisoned localStorage + forged submissions)');
  const { context, page } = await newPage(browser, { poison: true });
  const record = (name, blocked, detail) => {
    report.exploits.push({ name, blocked, detail });
    console.log(`  ${blocked ? 'BLOCKED  ' : 'NOT BLOCKED'} ${name} — ${detail}`);
    if (!blocked) violation(run, 'exploit', `${name}: ${detail}`);
  };
  try {
    if (!(await gotoTitle(page, run))) {
      record('poisoned localStorage boot', false, 'game did not reach TitleScene with garbage storage');
      return;
    }
    // 1) Storage sanitization
    const sane = await page.evaluate(async () => {
      const Rebirth = (await import('/src/systems/RebirthManager.js')).default;
      const Save = (await import('/src/systems/SaveManager.js')).default;
      const Mods = (await import('/src/systems/RunModifiers.js')).default;
      const LB = (await import('/src/systems/LeaderboardManager.js')).default;
      const s = window.VIBE_SETTINGS;
      return {
        statsMult: Rebirth.getAllStatsMultiplier(),
        xpMult: Rebirth.getXPMultiplier(),
        weapons: Rebirth.getStartingWeaponCount(),
        hasSave: Save.hasSave(),
        mods: Mods.load().map((m) => m.id),
        top: LB.getTop(),
        volumes: [s.masterVolume, s.sfxVolume, s.menuMusicVolume, s.gameplayMusicVolume, s.xpPenaltyOnDeath],
        playerName: s.playerName,
        language: s.language
      };
    });
    record('rebirth level 1e9', sane.statsMult <= 1.25 + 1e-9 && sane.xpMult <= 1.5 + 1e-9 && sane.weapons <= 3, `statsMult=${sane.statsMult} xpMult=${sane.xpMult} startWeapons=${sane.weapons}`);
    record('corrupt run save', sane.hasSave === false, `hasSave=${sane.hasSave}`);
    record('modifier substring injection', sane.mods.length === 0, `mods=${JSON.stringify(sane.mods)}`);
    record('corrupt local leaderboard', sane.top.every((e) => Number.isFinite(e.score) && Number.isFinite(e.wave) && typeof e.name === 'string'), `top=${JSON.stringify(sane.top).slice(0, 120)}`);
    record('corrupt settings JSON', sane.volumes.every((v) => Number.isFinite(v) && v >= 0 && v <= 1) && typeof sane.playerName === 'string' && ['en', 'es'].includes(sane.language), `volumes=${sane.volumes} name=${JSON.stringify(sane.playerName)} lang=${sane.language}`);

    // 2) Play briefly on poisoned storage: stats must stay sane
    if (await startRun(page, run, 'vibecoder')) {
      currentPhase = 'exploits:play';
      const check = makeChecker(run);
      for (let i = 0; i < 40; i++) {
        await sleep(CFG.sampleMs);
        const s = await page.evaluate(snapshotInPage);
        check(s);
        if (s.dead) break;
      }
      const st = run.last?.stats;
      record('poisoned storage gameplay stats', !!st && st.maxHealth < 1000 && st.attackDamage < 1000, `stats=${JSON.stringify(st)}`);
    }

    // 3) Forged submissions: must be rejected locally BEFORE any network request
    currentPhase = 'exploits:forge';
    const forged = [
      ['validateGameRules(NaN, 100)', `(m) => m.gp.validateGameRules(NaN, 100).valid === false`],
      ['validateGameRules(10, 49)', `(m) => m.gp.validateGameRules(10, 49).valid === false`],
      ['validateGameRules(0, 0)', `(m) => m.gp.validateGameRules(0, 0).valid === false`],
      ['validateGameRules(1, -5)', `(m) => m.gp.validateGameRules(1, -5).valid === false`],
      ['validateGameRules(1, 1e13)', `(m) => m.gp.validateGameRules(1, 1e13).valid === false`],
      ['validateGameRules("5", "100")', `(m) => m.gp.validateGameRules('5', '100').valid === false`],
      ['LeaderboardManager.submitOnChain(NaN, 1e15)', `async (m) => (await m.LB.submitOnChain('GEVILPLAYER', NaN, 1e15, 'evil')).success === false`],
      ['LeaderboardManager.submitOnChain(10, 1)', `async (m) => (await m.LB.submitOnChain('GEVILPLAYER', 10, 1, 'evil')).success === false`],
      // Only a ContractError or a `[local-validation]` message counts as BLOCKED; any other throw (TypeError,
      // missing export, network) is a harness/client bug and must FAIL instead of passing silently.
      ['gameClient.submitResult(wave=10, score=1)', `async (m) => { try { await m.gc.submitResult(m.addr, m.sign, 10, 1); return false; } catch (e) { return m.verdict(e); } }`],
      ['gameClient.submitResult(wave=NaN, score=-1)', `async (m) => { try { await m.gc.submitResult(m.addr, m.sign, NaN, -1); return false; } catch (e) { return m.verdict(e); } }`],
      ['gameClient.submitZkTrustless(score<wave*5)', `async (m) => { try { await m.gc.submitZkTrustless(m.addr, m.sign, { run_hash_hi: '0'.repeat(64), run_hash_lo: '0'.repeat(64), score: 1, wave: 10, nonce: 1, season_id: 1 }); return false; } catch (e) { return m.verdict(e); } }`],
      ['gameClient.submitZkTrustless(NaN wave)', `async (m) => { try { await m.gc.submitZkTrustless(m.addr, m.sign, { run_hash_hi: '0'.repeat(64), run_hash_lo: '0'.repeat(64), score: 100, wave: NaN, nonce: 1, season_id: 1 }); return false; } catch (e) { return m.verdict(e); } }`],
      ['gameClient.submitZkFromProverV2(score=7.5, wave=1)', `async (m) => { try { await m.gc.submitZkFromProverV2(m.addr, m.sign, undefined, { run_hash_hi: '0'.repeat(64), run_hash_lo: '0'.repeat(64), score: 7.5, wave: 1, nonce: 1, season_id: 1 }, '00'); return false; } catch (e) { return m.verdict(e); } }`]
    ];
    for (const [name, fnSrc] of forged) {
      exploitArmed = { attempts: [] };
      let rejected = false;
      let err = '';
      try {
        rejected = await page.evaluate(async (src) => {
          const m = {
            gp: await import('/src/zk/gameProof.js'),
            LB: (await import('/src/systems/LeaderboardManager.js')).default,
            gc: await import('/src/contracts/gameClient.js'),
            addr: 'GAKUNFN7MQYZRWGQ5627RLES3F4LG4AB7KLYI4I7WCV5J5WUH4IWCZBG', // valid random StrKey (no secret exists for it): reach the real guards
            sign: async () => { throw new Error('evil-player refuses to sign'); },
            verdict: (e) => {
              const msg = String((e && e.message) || e);
              const local = !!e && (e.name === 'ContractError' || msg.includes('[local-validation]'));
              return (local ? 'rejected: ' : 'unexpected: ') + msg.slice(0, 160);
            }
          };
          const fn = (0, eval)(src);
          return await Promise.race([fn(m), new Promise((r) => setTimeout(() => r('timeout'), 20000))]);
        }, fnSrc);
      } catch (e) {
        err = e.message.split('\n')[0];
      }
      await sleep(300);
      const attempts = exploitArmed.attempts;
      exploitArmed = null;
      const why = typeof rejected === 'string' && rejected.startsWith('rejected: ') ? rejected.slice(10) : '';
      const unexpected = typeof rejected === 'string' && rejected.startsWith('unexpected: ') ? rejected.slice(12) : '';
      if (why) rejected = true;
      if (unexpected) { rejected = false; err = `unexpected error, not a local contract rejection: ${unexpected}`; }
      const blocked = rejected === true && attempts.length === 0;
      record(name, blocked, attempts.length
        ? `network attempted before rejection: ${attempts.slice(0, 2).join(', ')}`
        : rejected === 'timeout' ? 'hung > 20s' : rejected ? `rejected locally${why ? ' (' + why + ')' : ''}` : unexpected ? err : `accepted${err ? ' / ' + err : ''}`);
    }
  } catch (e) {
    violation(run, 'harness', `exploit phase crashed: ${e.message.split('\n')[0]}`);
  } finally {
    exploitArmed = null;
    await context.close().catch(() => {});
  }
}

// ---------------------------------------------------------------- report
function pct(arr, p) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  return +s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))].toFixed(1);
}

function writeReport() {
  mkdirSync(REPORT_DIR, { recursive: true });
  const stamp = report.startedAt.replace(/[:.]/g, '-');
  const toList = (m) => [...m.entries()].map(([msg, v]) => ({ msg, ...v })).sort((a, b) => b.count - a.count);
  const json = {
    ...report,
    finishedAt: new Date().toISOString(),
    fps: { p50: pct(report.fpsSamples, 50), p95: pct(report.fpsSamples, 95), p5: pct(report.fpsSamples, 5), samples: report.fpsSamples.length },
    consoleErrors: toList(report.consoleErrors),
    consoleWarnings: toList(report.consoleWarnings),
    pageErrors: toList(report.pageErrors),
    failedRequests: toList(report.failedRequests),
    blockedExternal: toList(report.blockedExternal),
    runs: report.runs.map(({ fps, ...r }) => ({ ...r, fpsP50: pct(fps, 50), fpsP95: pct(fps, 95) }))
  };
  delete json.fpsSamples;
  writeFileSync(path.join(REPORT_DIR, `${stamp}.json`), JSON.stringify(json, null, 2));

  const L = [];
  L.push(`# Evil Player report — ${json.startedAt}`, '');
  L.push(`**Verdict:** ${json.violations.length ? `FAIL — ${json.violations.length} violation(s)` : 'PASS — no violations'}`, '');
  L.push(`Config: ${CFG.seconds}s/run, modes=${CFG.modes.join(',')}, chars=${CFG.chars.join(',')}, matrix=${CFG.matrix}, minFps=${CFG.minFps}`, '');
  L.push(`FPS (visible samples): p50=${json.fps.p50} p95=${json.fps.p95} p5=${json.fps.p5} (n=${json.fps.samples})`, '');
  L.push('## Runs', '', '| run | samples | max wave | max score | max enemies | fps p50 | game over | violations |', '|---|---|---|---|---|---|---|---|');
  for (const r of json.runs) {
    const go = r.gameOver ? `${r.gameOver.natural ? 'natural' : 'forced'}, screen=${r.gameOver.gameOverShown}${r.gameOver.playAgainWorks !== undefined ? `, enter=playAgain:${r.gameOver.playAgainWorks}` : ''}, esc=menu:${r.gameOver.restartWorks}` : '-';
    const lives = r.lives ? ` (${r.deaths} deaths/${r.lives} lives${r.menuExits ? `, ${r.menuExits} menu exits` : ''})` : '';
    L.push(`| ${r.id} | ${r.samples} | ${r.maxWave} | ${r.maxScore} | ${r.maxEnemies} | ${r.fpsP50 ?? '-'} | ${go}${lives} | ${r.violations.length} |`);
  }
  L.push('', '## Invariant violations', '');
  if (!json.violations.length) L.push('_none_');
  for (const v of json.violations) {
    const s = v.state ? ` — state: wave=${v.state.wave} hp=${v.state.hp}/${v.state.maxHp} score=${v.state.score} enemies=${v.state.enemies} fps=${v.state.fps?.toFixed?.(1)}` : '';
    L.push(`- \`${v.run}\` **${v.kind}** ${v.detail} (${v.at})${s}`);
  }
  L.push('', '## Exploits', '', '| exploit | result | detail |', '|---|---|---|');
  for (const e of json.exploits) L.push(`| ${e.name} | ${e.blocked ? 'blocked' : '**NOT blocked**'} | ${e.detail.replace(/\|/g, '/')} |`);
  const section = (title, items) => {
    L.push('', `## ${title} (${items.length} unique)`, '');
    if (!items.length) L.push('_none_');
    for (const i of items.slice(0, 40)) L.push(`- (${i.count}x, ${i.phase}) \`${i.msg.replace(/`/g, "'").slice(0, 300)}\``);
  };
  section('Uncaught page errors', json.pageErrors);
  section('Console errors', json.consoleErrors);
  section('Console warnings', json.consoleWarnings);
  section('Failed requests (local)', json.failedRequests);
  section('External requests blocked (hermetic mode)', json.blockedExternal);
  writeFileSync(path.join(REPORT_DIR, `${stamp}.md`), L.join('\n') + '\n');
  return { json, mdPath: path.join(REPORT_DIR, `${stamp}.md`) };
}

// ---------------------------------------------------------------- main
function plan() {
  const runs = [];
  if (CFG.matrix === 'full') {
    for (const c of CFG.chars) for (const m of CFG.modes) runs.push([c, m]);
    return runs;
  }
  // rotate: each character gets one run; leftover modes are spread across characters.
  CFG.chars.forEach((c, i) => runs.push([c, CFG.modes[i % CFG.modes.length]]));
  CFG.modes.slice(CFG.chars.length).forEach((m, i) => runs.push([CFG.chars[i % CFG.chars.length], m]));
  return runs;
}

async function main() {
  const server = await ensureServer();
  const browser = await chromium.launch({ headless: !CFG.headful, args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'] });
  let exitCode = 0;
  try {
    const runs = plan();
    for (let i = 0; i < runs.length; i++) await playRun(browser, runs[i][0], runs[i][1], i + 1);
    if (CFG.exploits) await exploitPhase(browser);
    for (const [msg, v] of report.pageErrors) violation(null, 'pageerror', `${msg} (${v.count}x, ${v.phase})`);
    for (const [msg, v] of report.failedRequests) violation(null, 'failed_request', `${msg} (${v.count}x, ${v.phase})`);
    const { json, mdPath } = writeReport();
    console.log(`\nreport: ${mdPath}`);
    console.log(`violations: ${json.violations.length} | fps p50=${json.fps.p50} p95=${json.fps.p95} | exploits blocked ${json.exploits.filter((e) => e.blocked).length}/${json.exploits.length}`);
    exitCode = json.violations.length ? 1 : 0;
  } finally {
    await browser.close().catch(() => {});
    if (server) server.kill('SIGTERM');
  }
  process.exit(exitCode);
}

main().catch((e) => {
  console.error('evil-player crashed:', e);
  process.exit(2);
});
