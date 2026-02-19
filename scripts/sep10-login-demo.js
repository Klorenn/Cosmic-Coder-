/**
 * SEP-10 Login con Stellar y Freighter – script de demostración
 *
 * Flujo: obtener public key → pedir challenge al backend → firmar con Freighter → enviar al backend → JWT
 *
 * Uso en navegador:
 *   1. Instala la extensión Freighter (https://www.freighter.app/)
 *   2. Abre scripts/sep10-login-demo.html en el navegador (o sirve el proyecto y abre esa ruta)
 *   3. Abre la consola (F12) y ejecuta: window.runSep10Login()
 *
 * Si ves "POST /auth/token 400": en consola aparecerá "❌ ... – Mensaje del servidor: ..."
 * con el motivo. También: DevTools → Network → request "token" → pestaña Response.
 */

// ---------------------------------------------------------------------------
// Configuración: URL base del backend que expone /auth/challenge y /auth/token
// ---------------------------------------------------------------------------
const API_BASE = 'https://cosmic-coder.onrender.com';

/**
 * Ejecuta el flujo completo de login SEP-10 y muestra el JWT en consola.
 * @returns {Promise<{ token: string, public_key: string }>}
 */
async function runSep10Login() {
  // Necesitamos Freighter en el navegador (extensión)
  const Freighter = await getFreighter();
  if (!Freighter) {
    console.error('Freighter no está disponible. Instala la extensión: https://www.freighter.app/');
    return null;
  }

  try {
    // -----------------------------------------------------------------------
    // PASO 1: Obtener la public key de Freighter
    // -----------------------------------------------------------------------
    // Pedimos acceso al usuario; Freighter devuelve la dirección (G...) que usamos como cuenta Stellar
    console.log('Paso 1: Obteniendo public key de Freighter...');
    const access = await Freighter.requestAccess();
    if (access?.error || !access?.address) {
      const msg = access?.error?.message || 'Usuario denegó acceso o Freighter no conectado';
      console.error('Paso 1 fallido:', msg);
      return null;
    }
    const publicKey = access.address || access.publicKey;
    console.log('Public key:', publicKey);

    // -----------------------------------------------------------------------
    // PASO 2: Pedir un challenge al backend
    // -----------------------------------------------------------------------
    // El backend (SEP-10) genera una transacción de desafío firmable solo por esta cuenta
    console.log('Paso 2: Solicitando challenge al backend...');
    const challengeUrl = `${API_BASE.replace(/\/$/, '')}/auth/challenge?account=${encodeURIComponent(publicKey)}`;
    const challengeRes = await fetch(challengeUrl, { method: 'GET', credentials: 'omit' });
    if (!challengeRes.ok) {
      const errBody = await challengeRes.json().catch(() => ({}));
      throw new Error(errBody.error || `Challenge falló: ${challengeRes.status}`);
    }
    const { transaction: challengeXdr, network_passphrase: networkPassphrase } = await challengeRes.json();
    console.log('Challenge recibido (XDR), red:', networkPassphrase || 'Test SDF Network');

    // -----------------------------------------------------------------------
    // PASO 3: Firmar el challenge con Freighter
    // -----------------------------------------------------------------------
    // El usuario firma la transacción en la extensión; así demostramos que controla la clave privada
    console.log('Paso 3: Firmando challenge con Freighter (revisa la extensión)...');
    const signResult = await Freighter.signTransaction(challengeXdr, {
      networkPassphrase: networkPassphrase || 'Test SDF Network ; September 2015',
      address: publicKey
    });
    if (signResult?.error || !signResult?.signedTxXdr) {
      const msg = signResult?.error?.message || 'Firma denegada o error';
      throw new Error(msg);
    }
    const signedXdr = signResult.signedTxXdr ?? signResult.signedTransaction;
    console.log('Transacción firmada correctamente');

    // -----------------------------------------------------------------------
    // PASO 4: Enviar la transacción firmada al backend
    // -----------------------------------------------------------------------
    // El backend verifica la firma (SEP-10) y, si es válida, emite un JWT
    console.log('Paso 4: Enviando transacción firmada al backend...');
    const tokenUrl = `${API_BASE.replace(/\/$/, '')}/auth/token`;
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
      const msg = errBody.error || `Token falló: ${tokenRes.status}`;
      console.error('❌ POST /auth/token 400 – Mensaje del servidor:', msg);
      console.error('   Respuesta completa:', errBody);
      throw new Error(msg);
    }
    const data = await tokenRes.json();
    const token = data.token;
    if (!token) throw new Error('El backend no devolvió token');

    // -----------------------------------------------------------------------
    // PASO 5: Mostrar el JWT en consola
    // -----------------------------------------------------------------------
    console.log('Paso 5: Login SEP-10 correcto.');
    console.log('JWT (guárdalo para Authorization: Bearer <token>):');
    console.log(token);
    console.log('Public key asociada:', data.public_key || publicKey);
    return { token, public_key: data.public_key || publicKey };
  } catch (e) {
    console.error('Error en login SEP-10:', e?.message || e);
    throw e;
  }
}

/**
 * Obtiene la API de Freighter: global (ventana) o import dinámico de @stellar/freighter-api.
 * @returns {Promise<object|null>}
 */
async function getFreighter() {
  if (typeof window !== 'undefined' && window.freighterApi) return window.freighterApi;
  if (typeof window !== 'undefined' && window.Freighter) return window.Freighter;
  try {
    const mod = await import('@stellar/freighter-api');
    return mod.default || mod;
  } catch (_) {
    return null;
  }
}

// Exponer en global para poder llamar desde consola: runSep10Login()
if (typeof window !== 'undefined') {
  window.runSep10Login = runSep10Login;
}

export { runSep10Login, API_BASE };
