/**
 * SEP-10 Stellar Web Authentication configuration.
 * @see https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0010.md
 *
 * Required env:
 * - SEP10_SERVER_SECRET_KEY: Server's Stellar secret key (S...) — used to sign challenge tx.
 * - SEP10_HOME_DOMAIN: Home domain (e.g. cosmiccoder.io) — appears in Manage Data key "<home_domain> auth".
 * - SEP10_WEB_AUTH_DOMAIN: Domain that issues the challenge (e.g. api.cosmiccoder.io or your Render URL).
 * - SEP10_NETWORK_PASSPHRASE: Stellar network (e.g. "Test SDF Network ; September 2015" or "Public Global Stellar Network ; September 2015").
 * - JWT_SECRET: Secret for signing JWTs (opaque string).
 */

const NETWORK_PASSPHRASES = {
  testnet: 'Test SDF Network ; September 2015',
  public: 'Public Global Stellar Network ; September 2015'
};

function getEnv(name, defaultValue) {
  const v = process.env[name];
  if (v !== undefined && v !== '') return v;
  return defaultValue;
}

export const SEP10_HOME_DOMAIN = getEnv('SEP10_HOME_DOMAIN', 'cosmiccoder.io');
export const SEP10_WEB_AUTH_DOMAIN = getEnv('SEP10_WEB_AUTH_DOMAIN', process.env.RENDER_EXTERNAL_URL || 'http://localhost:3333');
export const SEP10_NETWORK_PASSPHRASE = getEnv('SEP10_NETWORK_PASSPHRASE', NETWORK_PASSPHRASES.testnet);
export const SEP10_CHALLENGE_TIMEOUT = Math.min(900, Math.max(60, parseInt(getEnv('SEP10_CHALLENGE_TIMEOUT', '300'), 10))); // SEP-10 recommends 15 min max
export const JWT_SECRET = process.env.JWT_SECRET;
export const JWT_EXPIRY_SEC = parseInt(getEnv('JWT_EXPIRY_SEC', '86400'), 10); // 24h

/** Server signing key (secret). Must be set for SEP-10 to work. */
export function getServerSecretKey() {
  const key = process.env.SEP10_SERVER_SECRET_KEY;
  if (!key || !key.startsWith('S')) throw new Error('SEP10_SERVER_SECRET_KEY is not set or invalid');
  return key;
}

/** Whether SEP-10 auth is configured (server key + JWT secret). */
export function isSep10Configured() {
  return !!(process.env.SEP10_SERVER_SECRET_KEY && process.env.JWT_SECRET);
}
