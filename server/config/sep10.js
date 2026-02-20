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

/**
 * Optional SEP-10 switch (compatible with Anchor-style docs). Defaults to enabled.
 * Accepts: true/false/1/0/yes/no (case-insensitive).
 */
function parseBool(v, fallback = true) {
  if (v == null || v === '') return fallback;
  const s = String(v).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(s)) return true;
  if (['0', 'false', 'no', 'off'].includes(s)) return false;
  return fallback;
}
export const SEP10_ENABLED = parseBool(process.env.SEP10_ENABLED, true);

/**
 * Support both:
 * - SEP10_HOME_DOMAIN
 * - SEP10_HOME_DOMAINS (comma-separated, Anchor-style docs)
 */
function pickHomeDomain() {
  const single = getEnv('SEP10_HOME_DOMAIN', '');
  if (single) return single;
  const many = getEnv('SEP10_HOME_DOMAINS', '');
  if (!many) return 'cosmiccoder.io';
  return many.split(',').map((d) => d.trim()).filter(Boolean)[0] || 'cosmiccoder.io';
}
export const SEP10_HOME_DOMAIN = pickHomeDomain();

/** Domain that hosts the SEP-10 auth endpoint (hostname only per SEP-0010). Strips protocol and path. */
function normalizeWebAuthDomain(urlOrDomain) {
  const s = String(urlOrDomain || '').trim();
  if (!s) return s;
  try {
    if (/^https?:\/\//i.test(s)) {
      const u = new URL(s);
      return u.hostname || s;
    }
    return s.split('/')[0];
  } catch (_) {
    return s.split('/')[0];
  }
}

const rawWebAuthDomain = getEnv('SEP10_WEB_AUTH_DOMAIN', process.env.RENDER_EXTERNAL_URL || 'https://cosmic-coder.onrender.com');
export const SEP10_WEB_AUTH_DOMAIN = normalizeWebAuthDomain(rawWebAuthDomain) || rawWebAuthDomain;
export const SEP10_NETWORK_PASSPHRASE = getEnv('SEP10_NETWORK_PASSPHRASE', NETWORK_PASSPHRASES.testnet);
export const SEP10_CHALLENGE_TIMEOUT = Math.min(
  900,
  Math.max(60, parseInt(getEnv('SEP10_CHALLENGE_TIMEOUT', getEnv('SEP10_AUTH_TIMEOUT', '300')), 10))
); // SEP-10 recommends 15 min max
export const JWT_SECRET = process.env.JWT_SECRET || process.env.SECRET_SEP10_JWT_SECRET;
export const JWT_EXPIRY_SEC = parseInt(getEnv('JWT_EXPIRY_SEC', getEnv('SEP10_JWT_TIMEOUT', '86400')), 10); // 24h

/** Server signing key (secret). Must be set for SEP-10 to work. */
export function getServerSecretKey() {
  const key = process.env.SEP10_SERVER_SECRET_KEY || process.env.SECRET_SEP10_SIGNING_SEED;
  if (!key || !key.startsWith('S')) throw new Error('SEP10_SERVER_SECRET_KEY (or SECRET_SEP10_SIGNING_SEED) is not set or invalid');
  return key;
}

/** Whether SEP-10 auth is configured (server key + JWT secret). */
export function isSep10Configured() {
  return SEP10_ENABLED && !!((process.env.SEP10_SERVER_SECRET_KEY || process.env.SECRET_SEP10_SIGNING_SEED) && (process.env.JWT_SECRET || process.env.SECRET_SEP10_JWT_SECRET));
}
