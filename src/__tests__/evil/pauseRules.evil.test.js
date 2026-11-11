import { describe, it, expect } from 'vitest';
import { canOpenPauseMenu } from '../../systems/pauseRules.js';

describe('EVIL pause rules (Esc/P spam during game over)', () => {
  it('never opens the pause menu once the player is dead (it covered GAME OVER and offered resume/restart on a dead run)', () => {
    expect(canOpenPauseMenu({ playerDead: true, isPaused: false })).toBe(false);
  });

  it('never opens it while the arena is not running (no player / scene shutting down)', () => {
    expect(canOpenPauseMenu({ playerDead: false, player: null })).toBe(false);
    expect(canOpenPauseMenu(null)).toBe(false);
    expect(canOpenPauseMenu(undefined)).toBe(false);
  });

  it('allows pausing a live run', () => {
    expect(canOpenPauseMenu({ playerDead: false, player: { active: true } })).toBe(true);
  });
});
