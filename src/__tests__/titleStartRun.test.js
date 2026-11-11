import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { startRunModel, cycleStartMode, startCardLayout, START_MODES } from '../scenes/title/startRunModel.js';
import titleEn from '../locales/title.en.js';
import titleEs from '../locales/title.es.js';

const ALL = { wallet: true, contract: true, prover: true, rankedVerified: true };

describe('startRunModel', () => {
  it('enables and pre-selects ranked when the whole ZK path is configured', () => {
    const m = startRunModel(ALL);
    expect(m.rankedEnabled).toBe(true);
    expect(m.rankedBlock).toBe(null);
    expect(m.defaultMode).toBe('ranked');
  });
  it('disables ranked without a wallet (fixable: "Connect wallet")', () => {
    const m = startRunModel({ ...ALL, wallet: false });
    expect(m.rankedEnabled).toBe(false);
    expect(m.rankedBlock).toBe('wallet');
    expect(m.defaultMode).toBe('casual');
  });
  it('disables ranked without a contract, and the contract wins over the wallet', () => {
    expect(startRunModel({ ...ALL, contract: false }).rankedBlock).toBe('contract');
    expect(startRunModel({ ...ALL, contract: false, wallet: false }).rankedBlock).toBe('contract');
  });
  it('keeps ranked playable but not default when only the prover is missing', () => {
    const m = startRunModel({ ...ALL, prover: false });
    expect(m.rankedEnabled).toBe(true);
    expect(m.defaultMode).toBe('casual');
  });
  it('reports contract / prover / wallet chips in order with prover health', () => {
    const ids = (m) => m.chips.map((c) => `${c.id}:${c.state}`);
    expect(ids(startRunModel({ ...ALL, proverHealthy: null }))).toEqual(['contract:ok', 'prover:pending', 'wallet:ok']);
    expect(ids(startRunModel({ ...ALL, proverHealthy: true }))).toEqual(['contract:ok', 'prover:ok', 'wallet:ok']);
    expect(ids(startRunModel({ ...ALL, proverHealthy: false }))).toEqual(['contract:ok', 'prover:off', 'wallet:ok']);
    expect(ids(startRunModel({}))).toEqual(['contract:off', 'prover:off', 'wallet:off']);
  });
  it('carries isRankedVerified() through (amber shield when false)', () => {
    expect(startRunModel({ ...ALL, rankedVerified: false }).rankedVerified).toBe(false);
    expect(startRunModel(ALL).rankedVerified).toBe(true);
  });
});

describe('cycleStartMode', () => {
  it('wraps between casual and ranked in both directions', () => {
    expect(START_MODES).toEqual(['casual', 'ranked']);
    expect(cycleStartMode('casual', 1, true)).toBe('ranked');
    expect(cycleStartMode('ranked', 1, true)).toBe('casual');
    expect(cycleStartMode('casual', -1, true)).toBe('ranked');
  });
  it('never lands on a disabled ranked card', () => {
    expect(cycleStartMode('casual', 1, false)).toBe('casual');
    expect(cycleStartMode('ranked', -1, false)).toBe('casual');
  });
});

describe('startCardLayout', () => {
  it('puts the cards side by side on wide bodies, stacked and compact on narrow ones', () => {
    expect(startCardLayout(680, 400)).toMatchObject({ stacked: false, compact: false });
    expect(startCardLayout(680, 200)).toMatchObject({ stacked: false, compact: true });
    expect(startCardLayout(320, 600)).toMatchObject({ stacked: true, compact: true });
  });
});

describe('start run strings', () => {
  const KEYS = ['start_title', 'start_casual', 'start_ranked', 'start_casual_line', 'start_ranked_line', 'start_need_wallet',
    'start_need_contract', 'start_unverified', 'chip_contract', 'chip_prover', 'chip_wallet', 'start_unranked', 'start_rule',
    'start_play', 'start_back', 'zk_help_title', 'zk_hint'];
  it('exist in en and es, short (one line each)', () => {
    for (const k of KEYS) {
      for (const loc of [titleEn, titleEs]) {
        expect(typeof loc.title[k], k).toBe('string');
        expect(loc.title[k].length, k).toBeLessThanOrEqual(k === 'zk_hint' ? 80 : 32);
        expect(loc.title[k]).not.toMatch(/\n/);
      }
    }
    expect(titleEn.title.zk_hint).toContain('{shotgun}');
    expect(titleEs.title.zk_hint).toContain('{shotgun}');
  });
});

describe('start run modal source', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '../scenes/TitleScene.js'), 'utf8');
  const body = src.slice(src.indexOf('  showZKStartPopup() {'), src.indexOf('  startRankedGame() {'));
  it('is built on the pixel overlay kit, without the old terminal wall of text', () => {
    expect(body).toContain('createOverlay(');
    expect(body).toContain('glassCard(');
    expect(body).not.toMatch(/0xf5e6c8|zk_popup\.description|controls_auto_shoot|min_score_detail/);
  });
  it('starts runs through the unchanged entry points and checks ranked verification', () => {
    expect(body).toContain('this.startRankedGame()');
    expect(body).toContain('this.startCasualGame()');
    expect(src).toContain('gameClient.isRankedVerified()');
  });
});
