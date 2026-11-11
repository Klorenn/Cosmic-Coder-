import { describe, it, expect, vi } from 'vitest';
import { bindDomListenerToScene } from '../../utils/sceneListeners.js';

function fakeScene() {
  const handlers = {};
  return {
    sys: { events: {
      once: (ev, fn) => { (handlers[ev] ||= []).push(fn); },
      off: (ev, fn) => { handlers[ev] = (handlers[ev] || []).filter((f) => f !== fn); }
    } },
    emit: (ev) => (handlers[ev] || []).splice(0).forEach((fn) => fn())
  };
}

function fakeTarget() {
  const listeners = new Set();
  return {
    addEventListener: (type, fn) => listeners.add(`${type}`) && listeners.add(fn),
    removeEventListener: (type, fn) => listeners.delete(fn),
    has: (fn) => listeners.has(fn)
  };
}

describe('EVIL scene-scoped DOM listeners (TitleScene name input leak)', () => {
  it('removes the window listener when the scene shuts down (no keydown into destroyed texts)', () => {
    const scene = fakeScene();
    const target = fakeTarget();
    const handler = vi.fn();
    bindDomListenerToScene(scene, target, 'keydown', handler);
    expect(target.has(handler)).toBe(true);
    scene.emit('shutdown');
    expect(target.has(handler)).toBe(false);
  });

  it('also cleans up on destroy and the returned unbind is idempotent', () => {
    const scene = fakeScene();
    const target = fakeTarget();
    const handler = vi.fn();
    const unbind = bindDomListenerToScene(scene, target, 'keydown', handler);
    unbind();
    unbind();
    expect(target.has(handler)).toBe(false);
    expect(() => scene.emit('destroy')).not.toThrow();
  });

  it('runs the optional onUnbind cleanup exactly once', () => {
    const scene = fakeScene();
    const cleanup = vi.fn();
    const unbind = bindDomListenerToScene(scene, fakeTarget(), 'keydown', () => {}, cleanup);
    scene.emit('shutdown');
    unbind();
    expect(cleanup).toHaveBeenCalledTimes(1);
  });
});
