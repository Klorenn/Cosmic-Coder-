/**
 * Prueba en consola: envía una entrada al leaderboard con nombre "CosmicCoder"
 * y verifica que GET /leaderboard la devuelva. Reintenta hasta que funcione.
 *
 * Uso: node scripts/test-leaderboard-cosmiccoder.js
 * (Asegúrate de tener el servidor corriendo: npm run server o similar)
 */

const BASE = process.env.LEADERBOARD_URL || 'http://localhost:3333';
const NAME = 'CosmicCoder';
const TEST_ADDRESS = 'G' + 'A'.repeat(55);
const MAX_ATTEMPTS = 15;
const DELAY_MS = 2000;

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function postLeaderboard() {
  const res = await fetch(`${BASE}/leaderboard`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      address: TEST_ADDRESS,
      name: NAME,
      wave: 5,
      score: 100
    })
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, data };
}

async function getLeaderboard() {
  const res = await fetch(`${BASE}/leaderboard`);
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, entries: Array.isArray(data.entries) ? data.entries : [] };
}

function foundCosmicCoder(entries) {
  return entries.some(
    (e) => (e.name || '').trim().toLowerCase() === NAME.toLowerCase()
  );
}

async function run() {
  console.log(`[CosmicCoder] Probando leaderboard en ${BASE} (nombre: "${NAME}")...\n`);
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      console.log(`Intento ${attempt}/${MAX_ATTEMPTS}: POST /leaderboard...`);
      const post = await postLeaderboard();
      if (!post.ok) {
        console.log('  POST falló:', post.data?.error || post.data || 'sin respuesta');
        await sleep(DELAY_MS);
        continue;
      }
      console.log('  POST OK');

      await sleep(500);
      console.log('  GET /leaderboard...');
      const get = await getLeaderboard();
      if (!get.ok) {
        console.log('  GET falló');
        await sleep(DELAY_MS);
        continue;
      }
      console.log('  Entradas recibidas:', get.entries.length);

      if (foundCosmicCoder(get.entries)) {
        console.log('\n[CosmicCoder] OK: La entrada con nombre "' + NAME + '" está en el ranking.');
        console.log('Entradas:', JSON.stringify(get.entries, null, 2));
        process.exit(0);
      }
      console.log('  Aún no aparece "' + NAME + '" en la lista, reintentando...');
    } catch (e) {
      console.log('  Error:', e.message || e);
      if (e.cause?.code === 'ECONNREFUSED') {
        console.log('  ¿Está el servidor corriendo? (ej: npm run server)');
      }
    }
    await sleep(DELAY_MS);
  }
  console.log('\n[CosmicCoder] No se pudo verificar después de ' + MAX_ATTEMPTS + ' intentos.');
  process.exit(1);
}

run();
