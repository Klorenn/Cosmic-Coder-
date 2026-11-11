import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getConfigValue, getApiUrl, getZkProverUrl, getProgressApiUrl, getLeaderboardUrl, DEFAULTS } from '../config/runtime.js';

describe('runtime config resolution', () => {
  beforeEach(() => { globalThis.window = globalThis.window || {}; delete globalThis.window.__VITE_CONFIG__; });
  afterEach(() => { delete globalThis.window.__VITE_CONFIG__; });

  it('falls back to localhost defaults, never onrender', () => {
    for (const fn of [getApiUrl, getZkProverUrl, getProgressApiUrl, getLeaderboardUrl]) {
      const v = fn();
      expect(v).toMatch(/^http:\/\/localhost:\d+$/);
      expect(v).not.toContain('onrender.com');
    }
    expect(DEFAULTS.VITE_API_URL).toContain('localhost');
  });

  it('window.__VITE_CONFIG__ wins over defaults and strips trailing slash', () => {
    window.__VITE_CONFIG__ = { VITE_API_URL: 'https://api.example.com/' };
    expect(getApiUrl()).toBe('https://api.example.com');
  });

  it('env is used when window config lacks the key', () => {
    expect(getConfigValue('VITE_API_URL', { env: { VITE_API_URL: 'https://env.example.com' }, win: {} })).toBe('https://env.example.com');
  });

  it('window config has priority over env', () => {
    expect(getConfigValue('VITE_API_URL', { env: { VITE_API_URL: 'https://env' }, win: { __VITE_CONFIG__: { VITE_API_URL: 'https://win' } } })).toBe('https://win');
  });

  it('progress URL chains to prover URL then default; leaderboard chains to API URL', () => {
    window.__VITE_CONFIG__ = { VITE_ZK_PROVER_URL: 'https://prover.example.com' };
    expect(getProgressApiUrl()).toBe('https://prover.example.com');
    window.__VITE_CONFIG__ = { VITE_API_URL: 'https://api.example.com' };
    expect(getLeaderboardUrl()).toBe('https://api.example.com');
  });
});
