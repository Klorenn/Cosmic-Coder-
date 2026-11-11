import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { StrKey } from '@stellar/stellar-sdk';
import { SIM_SOURCE_ACCOUNT } from '../contracts/gameClient.js';

describe('gameClient read-only simulation source account', () => {
  it('is a valid ed25519 StrKey (an invalid checksum makes every simulateRead fail silently)', () => {
    expect(StrKey.isValidEd25519PublicKey(SIM_SOURCE_ACCOUNT)).toBe(true);
  });

  it('every hardcoded G... account literal in gameClient.js is a valid StrKey', () => {
    const src = readFileSync(new URL('../contracts/gameClient.js', import.meta.url), 'utf8');
    const literals = src.match(/'G[A-Z2-7]{55}'/g) || [];
    for (const lit of literals) expect(StrKey.isValidEd25519PublicKey(lit.slice(1, -1))).toBe(true);
  });
});
