import { describe, it, expect } from 'vitest';
import { resolveSelectedCharacter } from '../utils/selectedCharacter.js';

describe('resolveSelectedCharacter', () => {
  it('keeps the saved selection', () => {
    expect(resolveSelectedCharacter('swordsman', 'vibecoder')).toBe('swordsman');
  });
  it('does not overwrite an existing window value with the default', () => {
    expect(resolveSelectedCharacter(undefined, 'vibecoder', 'swordsman')).toBe('swordsman');
  });
  it('falls back to default when nothing is saved', () => {
    expect(resolveSelectedCharacter(null, 'vibecoder')).toBe('vibecoder');
  });
});
