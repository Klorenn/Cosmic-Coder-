#!/usr/bin/env node
/**
 * Genera SEP10_SERVER_SECRET_KEY (Stellar) y JWT_SECRET para Render.
 * Escribe en .render.env.local (no commitear). Copia esas vars al dashboard de Render.
 */

import { writeFileSync } from 'fs';
import { Keypair } from '@stellar/stellar-base';
import { randomBytes } from 'crypto';

const keypair = Keypair.random();
const jwtSecret = randomBytes(32).toString('hex');

const internalDbUrl = 'postgresql://cosmic_coder_user:sWRwCB4Xhiz3hVMiLfHfKqltmhYnTkz8@dpg-d6b4c0khncsc7386o3fg-a/cosmic_coder';

const content = `# Copia estas variables al Environment del backend en Render (Dashboard → Service → Environment).
# NO subas este archivo a git (está en .gitignore).

DATABASE_URL=${internalDbUrl}
SEP10_SERVER_SECRET_KEY=${keypair.secret()}
JWT_SECRET=${jwtSecret}
SEP10_NETWORK_PASSPHRASE=Test SDF Network ; September 2015
SEP10_HOME_DOMAIN=cosmiccoder.app
# Cuando despliegues, cambia a la URL real del backend, ej: https://cosmic-coder-api.onrender.com
SEP10_WEB_AUTH_DOMAIN=cosmiccoder.app
`;

const path = '.render.env.local';
writeFileSync(path, content, 'utf8');
console.log('Generado:', path);
console.log('');
console.log('Clave pública del servidor (para stellar.toml SIGNING_KEY si lo usas):');
console.log(keypair.publicKey());
console.log('');
console.log('Añade las variables de .render.env.local al backend en Render.');
console.log('Luego borra o no subas .render.env.local.');