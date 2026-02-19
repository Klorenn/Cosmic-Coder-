/**
 * Snippet: SEP-10 login al pulsar "Start Game"
 * Copia este código en tu frontend (o importa el archivo) y enlázalo al botón Start Game.
 *
 * Requisitos: extensión Freighter instalada, backend con GET /auth y POST /auth.
 */

const API_BASE = 'https://cosmic-coder.onrender.com'; // o tu backend
const STORAGE_KEY = 'cosmicCoderJwt';
const TESTNET_PASSPHRASE = 'Test SDF Network ; September 2015';

/**
 * Obtiene la API de Freighter (window.freighterApi o window.Freighter o @stellar/freighter-api).
 */
async function getFreighter() {
  if (typeof window !== 'undefined' && window.freighterApi) return window.freighterApi;
  if (typeof window !== 'undefined' && window.Freighter) return window.Freighter;
  try {
    const mod = await import('@stellar/freighter-api');
    return mod.default || mod;
  } catch (e) {
    console.error('[SEP-10] Freighter no disponible:', e.message);
    return null;
  }
}

/**
 * Flujo completo: public key → GET /auth (challenge) → firmar con Freighter → POST /auth → JWT → localStorage → initGame().
 * Llama a esta función cuando el usuario pulse "Start Game".
 */
async function startGameWithSep10() {
  try {
    const Freighter = await getFreighter();
    if (!Freighter) {
      console.error('[SEP-10] Instala Freighter: https://www.freighter.app/');
      return;
    }

    // 1. Obtener public key de Freighter
    console.log('[SEP-10] Obteniendo public key...');
    const access = await Freighter.requestAccess();
    if (access?.error || !access?.address) {
      console.error('[SEP-10] Acceso denegado o no conectado:', access?.error?.message || 'Sin address');
      return;
    }
    const publicKey = access.address || access.publicKey;
    console.log('[SEP-10] Public key:', publicKey);

    // 2. GET /auth?account=<public_key> (challenge)
    const challengeUrl = `${API_BASE.replace(/\/$/, '')}/auth?account=${encodeURIComponent(publicKey)}`;
    console.log('[SEP-10] Solicitando challenge...');
    const challengeRes = await fetch(challengeUrl, { method: 'GET', credentials: 'omit' });
    if (!challengeRes.ok) {
      const errBody = await challengeRes.json().catch(() => ({}));
      throw new Error(errBody.error || `Challenge: ${challengeRes.status}`);
    }
    const { transaction: challengeXdr, network_passphrase: networkPassphrase } = await challengeRes.json();
    const passphrase = networkPassphrase || TESTNET_PASSPHRASE;

    // 3. Firmar con Freighter (Testnet)
    console.log('[SEP-10] Firmando con Freighter (acepta en la extensión)...');
    const signResult = await Freighter.signTransaction(challengeXdr, {
      networkPassphrase: passphrase,
      address: publicKey
    });
    if (signResult?.error || !(signResult?.signedTxXdr ?? signResult?.signedTransaction)) {
      throw new Error(signResult?.error?.message || 'Firma denegada');
    }
    const signedXdr = signResult.signedTxXdr ?? signResult.signedTransaction;

    // 4. POST /auth con transacción firmada
    const tokenUrl = `${API_BASE.replace(/\/$/, '')}/auth`;
    console.log('[SEP-10] Enviando transacción firmada...');
    const tokenRes = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transaction: signedXdr }),
      credentials: 'omit'
    });
    if (!tokenRes.ok) {
      const errBody = await tokenRes.json().catch(() => ({}));
      throw new Error(errBody.error || `Token: ${tokenRes.status}`);
    }
    const data = await tokenRes.json();

    // 5. JWT y public_key
    const token = data.token;
    const receivedPublicKey = data.public_key || publicKey;
    if (!token) throw new Error('El backend no devolvió token');

    // 6. Guardar JWT en localStorage
    try {
      localStorage.setItem(STORAGE_KEY, token);
      console.log('[SEP-10] JWT guardado en localStorage.');
    } catch (e) {
      console.warn('[SEP-10] No se pudo guardar en localStorage:', e.message);
    }

    // 7. Imprimir en consola
    console.log('[SEP-10] JWT:', token);
    console.log('[SEP-10] public_key:', receivedPublicKey);

    // 8. Iniciar el juego
    if (typeof initGame === 'function') {
      initGame();
    } else {
      console.warn('[SEP-10] initGame() no está definida; define esta función para arrancar el juego.');
    }
  } catch (e) {
    console.error('[SEP-10] Error:', e.message || e);
  }
}

// Ejemplo: enlazar al botón Start Game
// document.querySelector('#start-game-btn').addEventListener('click', () => startGameWithSep10());

// Exportar para módulos
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { startGameWithSep10, getFreighter };
}
if (typeof window !== 'undefined') {
  window.startGameWithSep10 = startGameWithSep10;
}
