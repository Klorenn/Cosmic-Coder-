/**
 * Minimal logger. log/debug only emit in dev (or when window.__VITE_CONFIG__.VITE_DEBUG is truthy);
 * warn/error always emit.
 */
export function isDebugEnabled() {
  try {
    if (typeof import.meta !== 'undefined' && import.meta.env?.DEV) return true;
    if (typeof window !== 'undefined' && window.__VITE_CONFIG__?.VITE_DEBUG) return true;
  } catch (_) { /* env not available: stay silent */ }
  return false;
}

export function createLogger(enabled, sink = console) {
  const on = typeof enabled === 'function' ? enabled : () => enabled;
  return {
    log: (...a) => { if (on()) sink.log(...a); },
    debug: (...a) => { if (on()) (sink.debug || sink.log)(...a); },
    warn: (...a) => sink.warn(...a),
    error: (...a) => (sink.error || sink.warn)(...a)
  };
}

export const logger = createLogger(isDebugEnabled);
export default logger;
