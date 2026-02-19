/**
 * Auth routes: SEP-10 challenge + token, and protected user/me endpoints.
 * Compliant with Stellar SEP-10: https://developers.stellar.org/docs/platforms/anchor-platform/sep-guide/sep10
 * and SEP-0010 spec: https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0010.md
 *
 * WEB_AUTH_ENDPOINT can be https://your-server/auth (GET = challenge, POST = token).
 * We also expose GET /auth/challenge and POST /auth/token for backward compatibility.
 */

import { Router } from 'express';
import { buildChallenge } from '../auth/challenge.js';
import { verifyAndIssueToken } from '../auth/token.js';
import { jwtAuth } from '../middleware/jwtAuth.js';
import { findUserByPublicKey, updateUsername } from '../db/users.js';
import { isSep10Configured, SEP10_HOME_DOMAIN, SEP10_WEB_AUTH_DOMAIN, SEP10_NETWORK_PASSPHRASE, getServerSecretKey } from '../config/sep10.js';
import { getSupabase, USERS_TABLE } from '../db/supabase.js';
import { Keypair } from '@stellar/stellar-base';

const router = Router();

// --- Diagnostic endpoint: GET /auth/debug (check SEP-10 config without secrets) ---
router.get('/debug', async (req, res) => {
  const config = {
    sep10Configured: isSep10Configured(),
    homeDomain: SEP10_HOME_DOMAIN,
    webAuthDomain: SEP10_WEB_AUTH_DOMAIN,
    networkPassphrase: SEP10_NETWORK_PASSPHRASE,
    serverKeyConfigured: false,
    serverPublicKey: null,
    jwtSecretConfigured: !!(process.env.JWT_SECRET || process.env.SECRET_SEP10_JWT_SECRET),
    supabaseConfigured: !!getSupabase(),
    supabaseTable: USERS_TABLE
  };
  
  try {
    const secret = getServerSecretKey();
    config.serverKeyConfigured = true;
    config.serverPublicKey = Keypair.fromSecret(secret).publicKey();
  } catch (e) {
    config.serverKeyError = e.message;
  }
  
  // Test Supabase connection
  if (getSupabase()) {
    try {
      const { count, error } = await getSupabase()
        .from(USERS_TABLE)
        .select('*', { count: 'exact', head: true });
      config.supabaseConnected = !error;
      config.supabaseUserCount = count;
      if (error) config.supabaseError = error.message;
    } catch (e) {
      config.supabaseConnected = false;
      config.supabaseError = e.message;
    }
  }
  
  return res.status(200).json(config);
});

function handleGetChallenge(req, res) {
  if (!isSep10Configured()) {
    return res.status(503).json({ error: 'SEP-10 auth is not configured' });
  }
  const account = req.query.account;
  if (!account) {
    return res.status(400).json({ error: 'account query parameter is required' });
  }
  try {
    const result = buildChallenge(account);
    return res.status(200).json(result);
  } catch (err) {
    return res.status(400).json({ error: err.message || 'Invalid request' });
  }
}

async function handlePostToken(req, res) {
  if (!isSep10Configured()) {
    return res.status(503).json({ error: 'SEP-10 auth is not configured' });
  }
  const raw = req.body?.transaction ?? req.body?.transaction_xdr ?? (typeof req.body === 'string' ? req.body : null);
  const signedXdr = typeof raw === 'string' ? raw.trim().replace(/\s/g, '') : null;
  if (!signedXdr || signedXdr.length < 50) {
    return res.status(400).json({
      error: 'transaction (signed challenge XDR) is required',
      hint: 'Send JSON body: { "transaction": "<base64_signed_xdr>" } with Content-Type: application/json'
    });
  }
  try {
    const result = await verifyAndIssueToken(signedXdr);
    return res.status(200).json(result);
  } catch (err) {
    const message = err.message || 'Invalid transaction';
    console.warn('[auth/token]', message);
    return res.status(400).json({ error: message });
  }
}

// --- SEP-10 standard: GET /auth and POST /auth (same path as per Stellar doc) ---
// GET /auth?account=G... → challenge; POST /auth with { transaction } → JWT
router.get('/', (req, res, next) => handleGetChallenge(req, res));
router.post('/', async (req, res, next) => {
  try {
    await handlePostToken(req, res);
  } catch (e) {
    next(e);
  }
});

// --- Same handlers under /challenge and /token (backward compatibility) ---
router.get('/challenge', (req, res, next) => handleGetChallenge(req, res));
router.post('/token', async (req, res, next) => {
  try {
    await handlePostToken(req, res);
  } catch (e) {
    next(e);
  }
});

// --- Protected: current user (GET /auth/me) ---
router.get('/me', jwtAuth, async (req, res, next) => {
  try {
    const user = await findUserByPublicKey(req.auth.publicKey);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    return res.status(200).json({
      public_key: user.public_key,
      username: user.username,
      created_at: user.created_at,
      updated_at: user.updated_at
    });
  } catch (err) {
    return res.status(500).json({ error: 'Server error' });
  }
});

// --- Protected: set/update username (PATCH /auth/me/username) ---
router.patch('/me/username', jwtAuth, async (req, res, next) => {
  const username = req.body?.username != null ? String(req.body.username).trim().slice(0, 64) : null;
  try {
    const user = await updateUsername(req.auth.publicKey, username || null);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    return res.status(200).json({
      public_key: user.public_key,
      username: user.username,
      updated_at: user.updated_at
    });
  } catch (err) {
    return res.status(500).json({ error: 'Server error' });
  }
});

export default router;
