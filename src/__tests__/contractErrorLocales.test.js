import { describe, it, expect } from 'vitest';
import { CONTRACT_ERRORS } from '../contracts/contractErrors.js';
import en from '../locales/en.js';
import es from '../locales/es.js';

const lookup = (loc, key) => key.split('.').reduce((o, k) => (o == null ? undefined : o[k]), loc);

describe('contract_error locale keys', () => {
  const entries = Object.values(CONTRACT_ERRORS);

  it('covers all 20 contract error codes', () => {
    expect(entries).toHaveLength(20);
  });

  it('maps code 17 to NoPendingAdmin', () => {
    expect(CONTRACT_ERRORS[17]).toEqual({ code: 17, name: 'NoPendingAdmin', i18nKey: 'contract_error.NoPendingAdmin' });
  });

  it.each(entries.map((e) => [e.name, e.i18nKey]))('%s has a short human message in en and es', (_n, key) => {
    for (const loc of [en, es]) {
      const v = lookup(loc, key);
      expect(typeof v).toBe('string');
      expect(v.length).toBeGreaterThan(5);
      expect(v.length).toBeLessThanOrEqual(90);
    }
  });

  it('has a generic fallback message', () => {
    expect(typeof lookup(en, 'contract_error.unknown')).toBe('string');
    expect(typeof lookup(es, 'contract_error.unknown')).toBe('string');
  });
});
