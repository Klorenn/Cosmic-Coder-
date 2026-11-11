#!/usr/bin/env node
/**
 * Title screen screenshots — opens the running dev server and captures the TitleScene.
 * Writes scripts/evil-player/reports/title-<viewport>.png for each viewport, plus
 * title-bubble-<viewport>.png (speech bubble + ranked tooltip), title-character-<viewport>.png (CHARACTER overlay after changing character) and
 * title-after-change-<viewport>.png (showcase after closing it) for the first viewport in TITLE_FLOW_VIEWPORT,
 * and title-upgrades|weapons|character-<viewport>.png (submenu overlays opened with the keyboard) for every
 * viewport in TITLE_OVERLAY_VIEWPORTS, plus title-main|leaderboard|leaderboard-ranked|settings|settings-es|controls|credits-<viewport>.png.
 *
 * Env:
 *   TITLE_URL        game URL (default http://localhost:3001; the dev server must already be running)
 *   TITLE_VIEWPORTS  comma list of WxH (default 1920x1080,1280x720,375x812,812x375)
 *   TITLE_FLOW_VIEWPORT viewport for the CHARACTER flow capture (default 1280x720)
 *   TITLE_OVERLAY_VIEWPORTS comma list of WxH for the submenu captures (default 1280x720,812x375)
 *   TITLE_PREFIX     file name prefix (default title)
 *   TITLE_WAIT_MS    settle time after the title is active (default 2200)
 *   TITLE_ONLY_B     '1' = only the LEADERBOARD / SETTINGS / CONTROLS / CREDITS + title-main captures
 *   TITLE_ONLY_ZK    '1' = only the START GAME modal captures (title-zkstart-<viewport>.png for every overlay viewport,
 *                    plus title-zkstart-ranked-<viewport>.png with a mocked wallet + contract on the first one)
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPORT_DIR = path.join(__dirname, 'reports');
const GAME_URL = process.env.TITLE_URL || 'http://localhost:3001';
const WAIT_MS = Number(process.env.TITLE_WAIT_MS) > 0 ? Number(process.env.TITLE_WAIT_MS) : 2200;
const parse = (v) => v.trim().split('x').map(Number);
const VIEWPORTS = (process.env.TITLE_VIEWPORTS || '1920x1080,1280x720,375x812,812x375').split(',').map(parse).filter(([w, h]) => w > 0 && h > 0);
const FLOW = parse(process.env.TITLE_FLOW_VIEWPORT || '1280x720');
const OVERLAY_VIEWPORTS = (process.env.TITLE_OVERLAY_VIEWPORTS || '1280x720,812x375').split(',').map(parse).filter(([w, h]) => w > 0 && h > 0);
const PREFIX = process.env.TITLE_PREFIX || 'title';

const TITLE_READY = `(() => { const g = window.__VIBE_GAME__; const s = g && g.scene && g.scene.getScene('TitleScene'); return !!(s && g.scene.isActive('TitleScene') && s.menuTexts && s.menuTexts.length && s.idlePlayer); })()`;

async function open(browser, width, height) {
  const context = await browser.newContext({ viewport: { width, height } });
  await context.route('**/*', (route) => {
    const u = new URL(route.request().url());
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname) || u.protocol === 'data:' || u.protocol === 'blob:';
    return local ? route.continue() : route.abort('blockedbyclient');
  });
  await context.addInitScript(() => {
    if (!localStorage.getItem('vibeCoderSettings')) {
      localStorage.setItem('vibeCoderSettings', JSON.stringify({ playerName: 'TITLECAM', musicEnabled: false, sfxEnabled: false }));
    }
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e?.message || e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/ERR_BLOCKED_BY_CLIENT/.test(m.text())) errors.push(`console: ${m.text()}`); });
  await page.goto(GAME_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(TITLE_READY, null, { timeout: 60000, polling: 250 });
  await page.waitForTimeout(WAIT_MS);
  return { context, page, errors };
}

const info = (page) => page.evaluate(() => {
  const s = window.__VIBE_GAME__.scene.getScene('TitleScene');
  const charId = window.__VIBE_PROGRESS_CHAR__ || s.getActiveCharacterMeta?.().charId;
  return { zoom: s.cameras.main.zoom, selected: s.menuOptions[s.selectedOption], character: charId, zk: s.zkBadge?.text, };
});

const menuState = (page) => page.evaluate(() => {
  const s = window.__VIBE_GAME__.scene.getScene('TitleScene');
  return {
    upgrades: !!s.upgradeMenuOpen, weapons: !!s.weaponMenuOpen, character: !!s.characterMenuOpen,
    leaderboard: !!s.leaderboardOpen, settings: !!s.settingsMenuOpen, controls: !!s.controlsOpen, credits: !!s.creditsOpen,
    overlays: (s.__titleOverlayStack || []).length
  };
});

/** Arrow-key the main menu to `option` and press Enter. */
async function openOption(page, option) {
  for (let i = 0; i < 12 && (await info(page)).selected !== option; i++) {
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(150);
  }
  await page.keyboard.press('Enter');
  await page.waitForTimeout(600);
}

/** UPGRADES / WEAPONS / CHARACTER overlays, opened and navigated with the keyboard only. */
async function captureOverlays(browser, w, h) {
  const { context, page, errors } = await open(browser, w, h);
  const files = [];
  const states = {};
  const shot = async (name) => { const f = path.join(REPORT_DIR, `${PREFIX}-${name}-${w}x${h}.png`); await page.screenshot({ path: f }); files.push(f); };
  await openOption(page, 'UPGRADES');
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(250);
  await shot('upgrades');
  states.upgradesOpen = await menuState(page);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  states.upgradesClosed = await menuState(page);
  await openOption(page, 'WEAPONS');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(300);
  await shot('weapons');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await page.waitForTimeout(400);
  await shot('weapons-tab2');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  states.weaponsClosed = await menuState(page);
  await openOption(page, 'CHARACTER');
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(500);
  await shot('character');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  states.characterClosed = await menuState(page);
  await context.close();
  return { viewport: `${w}x${h} overlays`, files, states, errors };
}

/** LEADERBOARD / SETTINGS / CONTROLS / CREDITS overlays + the bare title (corner check), keyboard only. */
async function captureOverlaysB(browser, w, h) {
  const { context, page, errors } = await open(browser, w, h);
  const files = [];
  const states = {};
  const shot = async (name) => { const f = path.join(REPORT_DIR, `${PREFIX}-${name}-${w}x${h}.png`); await page.screenshot({ path: f }); files.push(f); };
  await shot('main');
  states.corner = await page.evaluate(() => {
    const s = window.__VIBE_GAME__.scene.getScene('TitleScene');
    return { fullscreenBtn: !!s.fullscreenBtn, langBtn: !!s.langBtn, shield: !!s.zkBadge };
  });
  // Mock leaderboard API (all external hosts are blocked) + fake "you" identity, so the table renders.
  const addr = (c) => `G${c.repeat(51)}${String(Math.abs(c.charCodeAt(0) * 7919) % 10000).padStart(4, '0')}`;
  const ME = addr('M');
  const NAMES = ['Nebula', 'kL0REN', 'GBADC...QX2P', 'stack_smasher', '', 'TITLECAM', 'segfault', 'null_ptr', 'heap_hero', 'rustacean', 'byte_me', 'git_gud'];
  const entries = NAMES.map((name, i) => ({ address: name === 'TITLECAM' ? ME : addr(String.fromCharCode(65 + i)), name, wave: 30 - i * 2, score: Math.round(184000 / (i + 1)) }));
  await context.route(/\/leaderboard(\?.*)?$/, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ entries }) }));
  await page.evaluate((me) => {
    const s = window.__VIBE_GAME__.scene.getScene('TitleScene');
    s.getLeaderboardIdentity = async () => ({ addr: me, name: 'TITLECAM' });
  }, ME);
  await openOption(page, 'LEADERBOARD');
  await page.waitForTimeout(2500); // wait for the loaded state
  await shot('leaderboard');
  await page.keyboard.press('Tab');
  await page.waitForTimeout(1500);
  await shot('leaderboard-ranked');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  states.leaderboardClosed = await menuState(page);
  await openOption(page, 'SETTINGS');
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(250);
  await shot('settings');
  states.settingsOpen = await menuState(page);
  // ES via the segmented control (keyboard right): the scene restarts and SETTINGS comes back.
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(1500);
  states.afterLanguage = await page.evaluate(() => ({ lang: window.VIBE_SETTINGS.language, settings: !!window.__VIBE_GAME__.scene.getScene('TitleScene').settingsMenuOpen }));
  await page.waitForTimeout(400);
  await shot('settings-es');
  await page.keyboard.press('ArrowLeft');
  await page.waitForTimeout(1800);
  states.backToEn = await page.evaluate(() => window.VIBE_SETTINGS.language);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  states.settingsClosed = await menuState(page);
  await openOption(page, 'CONTROLS');
  await shot('controls');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  states.controlsClosed = await menuState(page);
  await openOption(page, 'CREDITS');
  await shot('credits');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  states.creditsClosed = await menuState(page);
  await context.close();
  return { viewport: `${w}x${h} overlays-b`, files, states, errors };
}

/** START GAME modal: Enter on START GAME opens it (casual state as configured), then a mocked ranked-ready state. */
async function captureZkStart(browser, w, h, withRanked) {
  const { context, page, errors } = await open(browser, w, h);
  const files = [];
  const states = {};
  const shot = async (name) => { const f = path.join(REPORT_DIR, `${PREFIX}-${name}-${w}x${h}.png`); await page.screenshot({ path: f }); files.push(f); };
  const zkState = () => page.evaluate(() => {
    const s = window.__VIBE_GAME__.scene.getScene('TitleScene');
    return { open: !!s.startRunOpen, blocked: !!s.menuBlocked, overlays: (s.__titleOverlayStack || []).length, arena: window.__VIBE_GAME__.scene.isActive('ArenaScene') };
  });
  await openOption(page, 'START_GAME');
  await page.waitForTimeout(400);
  await shot('zkstart');
  states.open = await zkState();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  states.closed = await zkState();
  if (withRanked) {
    // Mock a connected wallet + configured contract/prover (all external hosts are blocked), rank Gold, unverified.
    await page.evaluate(() => {
      const s = window.__VIBE_GAME__.scene.getScene('TitleScene');
      s.getStartRunState = () => ({ wallet: true, contract: true, prover: true, rankedVerified: false });
      s.loadStartRunExtras = async () => ({ rank: 3, proverHealthy: true });
    });
    await page.keyboard.press('Enter');
    await page.waitForTimeout(700);
    await shot('zkstart-ranked');
    states.ranked = await zkState();
    await page.keyboard.press('?');
    await page.waitForTimeout(400);
    await shot('zkstart-help');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    states.helpClosed = await zkState();
    await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(200);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    states.closedAgain = await zkState();
  }
  await context.close();
  return { viewport: `${w}x${h} zkstart`, files, states, errors };
}

async function main() {
  mkdirSync(REPORT_DIR, { recursive: true });
  const browser = await chromium.launch();
  const results = [];
  try {
    if (process.env.TITLE_ONLY_ZK === '1') {
      for (const [i, [ow, oh]] of OVERLAY_VIEWPORTS.entries()) results.push(await captureZkStart(browser, ow, oh, i === 0));
      console.log(JSON.stringify(results, null, 2)); // eslint-disable-line no-console
      if (results.some((r) => r.errors.length)) process.exitCode = 1;
      return;
    }
    for (const [w, h] of (process.env.TITLE_ONLY_B === '1' ? [] : VIEWPORTS)) {
      const { context, page, errors } = await open(browser, w, h);
      const file = path.join(REPORT_DIR, `${PREFIX}-${w}x${h}.png`);
      await page.screenshot({ path: file });
      results.push({ viewport: `${w}x${h}`, file, ...(await info(page)), errors });
      await context.close();
    }
    // CHARACTER flow: navigate to CHARACTER, open it, change character, capture, close, capture showcase.
    if (process.env.TITLE_ONLY_B !== '1') {
    const [w, h] = FLOW;
    const { context, page, errors } = await open(browser, w, h);
    // Speech bubble + ranked tooltip capture.
    await page.evaluate(() => {
      const s = window.__VIBE_GAME__.scene.getScene('TitleScene');
      s.sceneSpeechAllowedAt = 0;
      s.sayQuote('git push --force\norigin testnet!');
      s.zkTooltip?.setVisible(true);
    });
    await page.waitForTimeout(500);
    const bubble = path.join(REPORT_DIR, `${PREFIX}-bubble-${w}x${h}.png`);
    await page.screenshot({ path: bubble });
    await page.evaluate(() => window.__VIBE_GAME__.scene.getScene('TitleScene').zkTooltip?.setVisible(false));
    for (let i = 0; i < 12 && (await info(page)).selected !== 'CHARACTER'; i++) {
      await page.keyboard.press('ArrowDown');
      await page.waitForTimeout(200);
    }
    const sel = await info(page);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(600);
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Enter'); // arrows highlight, Enter selects
    await page.waitForTimeout(900);
    const overlay = path.join(REPORT_DIR, `${PREFIX}-character-selected-${w}x${h}.png`);
    await page.screenshot({ path: overlay });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(900);
    const after = path.join(REPORT_DIR, `${PREFIX}-after-change-${w}x${h}.png`);
    await page.screenshot({ path: after });
    results.push({ viewport: `${w}x${h} flow`, selectedBeforeEnter: sel.selected, files: [bubble, overlay, after], ...(await info(page)), errors });
    await context.close();
    }
    if (process.env.TITLE_ONLY_B !== '1') for (const [ow, oh] of OVERLAY_VIEWPORTS) results.push(await captureOverlays(browser, ow, oh));
    for (const [ow, oh] of OVERLAY_VIEWPORTS) results.push(await captureOverlaysB(browser, ow, oh));
    for (const [i, [ow, oh]] of OVERLAY_VIEWPORTS.entries()) results.push(await captureZkStart(browser, ow, oh, i === 0));
  } finally {
    await browser.close();
  }
  console.log(JSON.stringify(results, null, 2)); // eslint-disable-line no-console
  if (results.some((r) => r.errors.length)) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); }); // eslint-disable-line no-console
