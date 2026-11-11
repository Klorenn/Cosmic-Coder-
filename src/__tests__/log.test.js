import { describe, it, expect, vi } from 'vitest';
import { createLogger } from '../utils/log.js';

describe('log helper', () => {
  it('debug is silent when disabled, warn always emits', () => {
    const sink = { log: vi.fn(), warn: vi.fn(), debug: vi.fn() };
    const l = createLogger(false, sink);
    l.debug('x'); l.log('y');
    expect(sink.log).not.toHaveBeenCalled();
    l.warn('w');
    expect(sink.warn).toHaveBeenCalledWith('w');
  });
  it('emits when enabled', () => {
    const sink = { log: vi.fn(), warn: vi.fn(), debug: vi.fn() };
    createLogger(true, sink).log('a');
    expect(sink.log).toHaveBeenCalledWith('a');
  });
});
