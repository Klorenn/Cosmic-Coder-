/**
 * Helpers para detectar dispositivo / entrada.
 */

export function isTouchDevice() {
  return (
    'ontouchstart' in window ||
    (navigator.maxTouchPoints && navigator.maxTouchPoints > 0) ||
    (navigator.msMaxTouchPoints && navigator.msMaxTouchPoints > 0)
  );
}

export function isMobileDevice() {
  const ua = navigator.userAgent || navigator.vendor || window.opera;
  const mobileRegex = /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i;
  return mobileRegex.test(ua.toLowerCase());
}

export function isTabletDevice() {
  const ua = navigator.userAgent || navigator.vendor || window.opera;
  const tabletRegex = /ipad|tablet|xoom|sch-i800|playbook|silk/i;
  return tabletRegex.test(ua.toLowerCase());
}

