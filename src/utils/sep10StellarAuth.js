/**
 * Módulo de login automático SEP-10 con Stellar y Freighter para juegos web.
 *
 * Flujo: detectar Freighter → obtener public key → challenge → firmar en Testnet → token → localStorage.
 * Proporciona getJWT() y authenticatedFetch() para usar el JWT en el resto del juego.
 *
 * Uso típico:
 *   import { sep10Login, getJWT, authenticatedFetch } from './utils/sep10StellarAuth.js';
 *   await sep10Login();  // Muestra alerta si no hay Freighter; guarda JWT en localStorage
 *   const token = getJWT();
 *   const data = await authenticatedFetch('https://cosmic-coder.onrender.com/auth/me');
 *
 * @see https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0010.md
 * @see https://www.freighter.app/
 */

// ---------------------------------------------------------------------------
// Configuración: URL base del backend (Cosmic Coder en Render)
// ---------------------------------------------------------------------------
const API_BASE = 'https://cosmic-coder.onrender.com';
const STORAGE_KEY = 'cosmicCoderJwt';

/** Red por defecto para firmar el challenge (Testnet). */
const DEFAULT_NETWORK_PASSPHRASE = 'Test SDF Network ; September 2015';

// ---------------------------------------------------------------------------
// 1. Detección de Freighter
// ---------------------------------------------------------------------------

/**
 * Comprueba si la API de Freighter está disponible (extensión instalada e inyectada).
 * @returns {Promise<object|null>} API de Freighter o null si no está disponible
 */
async function getFreighter() {
  if (typeof window === 'undefined') return null;
  if (window.freighterApi) return window.freighterApi;
  if (window.Freighter) return window.Freighter;
  try {
    const mod = await import('@stellar/freighter-api');
    return mod.default || mod;
  } catch (_) {
    return null;
  }
}

/**
 * Indica si Freighter está disponible.
 * @returns {Promise<boolean>}
 */
export async function isFreighterAvailable() {
  const api = await getFreighter();
  return !!api;
}

// ---------------------------------------------------------------------------
// 2–6. Login SEP-10 completo y guardado del JWT
// ---------------------------------------------------------------------------

/**
 * Ejecuta el login automático SEP-10: Freighter → challenge → firma → token → localStorage.
 * Si Freighter no está disponible, muestra alerta al usuario y no lanza excepción.
 *
 * @returns {Promise<{ token: string, public_key: string } | null>} Datos del login o null si falla o no hay Freighter
 */
export async function sep10Login() {
  // --- Paso 1: Detectar Freighter ---
  const Freighter = await getFreighter();
  if (!Freighter) {
    const msg =
      'Freighter no está disponible. Instala la extensión para iniciar sesión con Stellar:\nhttps://www.freighter.app/';
    console.warn('[SEP-10]', msg);
    if (typeof window !== 'undefined' && window.alert) window.alert(msg);
    return null;
  }

  try {
    // --- Paso 2: Obtener la public key de Freighter ---
    console.log('[SEP-10] Obteniendo public key de Freighter...');
    const access = await Freighter.requestAccess();
    if (access?.error || !access?.address) {
      const errMsg = access?.error?.message || 'Acceso denegado o Freighter no conectado';
      console.error('[SEP-10] Error al obtener public key:', errMsg);
      if (typeof window !== 'undefined' && window.alert) window.alert(errMsg);
      return null;
    }
    const publicKey = access.address || access.publicKey;
    console.log('[SEP-10] Public key:', publicKey);

    // --- Paso 3: Solicitar challenge al backend ---
    const challengeUrl = `${API_BASE.replace(/\/$/, '')}/auth/challenge?account=${encodeURIComponent(publicKey)}`;
    console.log('[SEP-10] Solicitando challenge al backend...');
    const challengeRes = await fetch(challengeUrl, { method: 'GET', credentials: 'omit' });
    if (!challengeRes.ok) {
      const errBody = await challengeRes.json().catch(() => ({}));
      const errMsg = errBody.error || `Challenge falló: ${challengeRes.status}`;
      console.error('[SEP-10] Challenge:', errMsg);
      if (typeof window !== 'undefined' && window.alert) window.alert(errMsg);
      return null;
    }
    const { transaction: challengeXdr, network_passphrase: networkPassphrase } = await challengeRes.json();
    const passphrase = networkPassphrase || DEFAULT_NETWORK_PASSPHRASE;
    console.log('[SEP-10] Challenge recibido (red Testnet)');

    // --- Paso 4: Firmar el challenge con Freighter (Testnet) ---
    console.log('[SEP-10] Firmando challenge con Freighter (acepta en la extensión)...');
    const signResult = await Freighter.signTransaction(challengeXdr, {
      networkPassphrase: passphrase,
      address: publicKey
    });
    if (signResult?.error || !(signResult?.signedTxXdr ?? signResult?.signedTransaction)) {
      const errMsg = signResult?.error?.message || 'Firma denegada o error en Freighter';
      console.error('[SEP-10] Firma:', errMsg);
      if (typeof window !== 'undefined' && window.alert) window.alert(errMsg);
      return null;
    }
    const signedXdr = signResult.signedTxXdr ?? signResult.signedTransaction;
    console.log('[SEP-10] Transacción firmada correctamente');

    // --- Paso 5: Enviar transacción firmada al backend y obtener JWT ---
    const tokenUrl = `${API_BASE.replace(/\/$/, '')}/auth/token`;
    console.log('[SEP-10] Enviando transacción al backend...');
    const tokenRes = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transaction: signedXdr }),
      credentials: 'omit'
    });
    if (!tokenRes.ok) {
      const text = await tokenRes.text();
      let errBody = {};
      try {
        errBody = JSON.parse(text);
      } catch (_) {
        errBody = { error: text || `HTTP ${tokenRes.status}` };
      }
      const errMsg = errBody.error || `Error al obtener token: ${tokenRes.status}`;
      console.error('[SEP-10] Token:', errMsg);
      if (typeof window !== 'undefined' && window.alert) window.alert(errMsg);
      return null;
    }
    const data = await tokenRes.json();
    const token = data.token;
    if (!token) {
      console.error('[SEP-10] El backend no devolvió token');
      return null;
    }

    // --- Paso 6: Guardar JWT en localStorage ---
    try {
      localStorage.setItem(STORAGE_KEY, token);
      console.log('[SEP-10] Login correcto. JWT guardado en localStorage.');
    } catch (e) {
      console.warn('[SEP-10] No se pudo guardar en localStorage:', e?.message);
      // Aún así devolvemos el token; el juego puede guardarlo en memoria
    }

    return { token, public_key: data.public_key || publicKey };
  } catch (e) {
    const msg = e?.message || String(e);
    console.error('[SEP-10] Error en login:', msg);
    if (typeof window !== 'undefined' && window.alert) window.alert(`Error en login: ${msg}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// 7. getJWT() – token guardado o null
// ---------------------------------------------------------------------------

/**
 * Devuelve el JWT guardado en localStorage (o null si no hay sesión).
 * Útil para comprobar si el usuario ya hizo login y para enviar en cabeceras.
 *
 * @returns {string|null}
 */
export function getJWT() {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch (_) {
    return null;
  }
}

/**
 * Elimina el JWT guardado (logout local).
 */
export function clearJWT() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (_) {}
}

// ---------------------------------------------------------------------------
// 8. authenticatedFetch() – fetch con Authorization: Bearer <JWT>
// ---------------------------------------------------------------------------

/**
 * Realiza fetch al backend añadiendo automáticamente el header Authorization: Bearer <JWT>.
 * Si no hay JWT guardado, hace el fetch sin ese header (el servidor responderá 401 si la ruta lo requiere).
 *
 * @param {string} url - URL del recurso (puede ser absoluta o relativa al backend)
 * @param {RequestInit} [options] - Opciones estándar de fetch (method, body, headers, etc.)
 * @returns {Promise<Response>}
 */
export function authenticatedFetch(url, options = {}) {
  const token = getJWT();
  const headers = new Headers(options.headers || {});
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  return fetch(url, { ...options, headers });
}

// ---------------------------------------------------------------------------
// Export adicional para integración
// ---------------------------------------------------------------------------

export { API_BASE };
