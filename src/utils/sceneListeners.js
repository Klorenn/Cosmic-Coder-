/**
 * Scene-scoped DOM listeners.
 * Phaser removes its own keyboard listeners on scene shutdown, but raw window/document listeners survive
 * and keep firing into destroyed GameObjects (e.g. Text.setText on a destroyed frame -> TypeError).
 * This binds a DOM listener to the scene lifecycle so it is always removed on 'shutdown' / 'destroy'.
 *
 * @param {{sys:{events:{once:Function, off:Function}}}} scene
 * @param {EventTarget} target - window / document
 * @param {string} type - DOM event type
 * @param {EventListener} handler
 * @param {() => void} [onUnbind] - extra cleanup run once when unbinding (timers, containers)
 * @returns {() => void} idempotent unbind
 */
export function bindDomListenerToScene(scene, target, type, handler, onUnbind) {
  let bound = true;
  const events = scene && scene.sys && scene.sys.events;
  const unbind = () => {
    if (!bound) return;
    bound = false;
    target.removeEventListener(type, handler);
    if (events) {
      events.off('shutdown', unbind);
      events.off('destroy', unbind);
    }
    if (typeof onUnbind === 'function') onUnbind();
  };
  target.addEventListener(type, handler);
  if (events) {
    events.once('shutdown', unbind);
    events.once('destroy', unbind);
  }
  return unbind;
}
