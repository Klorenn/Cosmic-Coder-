import { describe, it, expect } from 'vitest';
import { facingFromVelocity, FACING_HYSTERESIS } from '../systems/playerFacing.js';

describe('facingFromVelocity', () => {
  it('picks the dominant axis for clear movement', () => {
    expect(facingFromVelocity(0, 200, 'left')).toBe('down');
    expect(facingFromVelocity(0, -200, 'left')).toBe('up');
    expect(facingFromVelocity(200, 0, 'up')).toBe('right');
    expect(facingFromVelocity(-200, 0, 'down')).toBe('left');
    expect(facingFromVelocity(150, 40, 'up')).toBe('right');
    expect(facingFromVelocity(-30, -150, 'right')).toBe('up');
  });

  it('keeps the previous facing when stopped', () => {
    expect(facingFromVelocity(0, 0, 'up')).toBe('up');
    expect(facingFromVelocity(0, 0, 'left')).toBe('left');
    expect(facingFromVelocity(0.0001, -0.0001, 'right')).toBe('right');
  });

  it('defaults to down without a valid previous facing', () => {
    expect(facingFromVelocity(0, 0)).toBe('down');
    expect(facingFromVelocity(0, 0, 'bogus')).toBe('down');
    expect(facingFromVelocity(Number.NaN, 5, undefined)).toBe('down');
  });

  it('does not flicker on near-perfect diagonals (hysteresis)', () => {
    // exact diagonal: stay on whatever axis we were already on
    expect(facingFromVelocity(100, 100, 'right')).toBe('right');
    expect(facingFromVelocity(100, 100, 'down')).toBe('down');
    // slightly vertical-dominant, but within the hysteresis band -> keep horizontal
    const inBand = 100 * (1 + FACING_HYSTERESIS / 2);
    expect(facingFromVelocity(100, inBand, 'right')).toBe('right');
    expect(facingFromVelocity(inBand, 100, 'down')).toBe('down');
    // clearly beyond the band -> switch axis
    const beyond = 100 * (1 + FACING_HYSTERESIS * 2);
    expect(facingFromVelocity(100, beyond, 'right')).toBe('down');
    expect(facingFromVelocity(beyond, 100, 'down')).toBe('right');
  });

  it('flips sign on the current axis immediately (no hysteresis needed)', () => {
    expect(facingFromVelocity(-100, 100, 'right')).toBe('left');
    expect(facingFromVelocity(100, -100, 'down')).toBe('up');
  });

  it('a diagonal from a stop picks the dominant axis, ties go vertical', () => {
    expect(facingFromVelocity(100, 100, 'down')).toBe('down');
    expect(facingFromVelocity(100, -100, 'up')).toBe('up');
  });
});
