/**
 * Auth routes: SEP-10 challenge + token, and protected user/me endpoints.
 * CORS is applied by the main app; no need to set headers here.
 */

import { Router } from 'express';
import { buildChallenge } from '../auth/challenge.js';
import { verifyAndIssueToken } from '../auth/token.js';
import { jwtAuth } from '../middleware/jwtAuth.js';
import { findUserByPublicKey, updateUsername } from '../db/users.js';
import { isSep10Configured } from '../config/sep10.js';

const router = Router();

// --- SEP-10 Challenge (GET) ---
// Compliant with SEP-10: GET WEB_AUTH_ENDPOINT?account=G...
router.get('/challenge', (req, res, next) => {
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
});

// --- SEP-10 Token (POST) ---
// Compliant with SEP-10: POST WEB_AUTH_ENDPOINT with transaction=<signed_xdr>
router.post('/token', async (req, res, next) => {
  if (!isSep10Configured()) {
    return res.status(503).json({ error: 'SEP-10 auth is not configured' });
  }
  const transaction = (req.body && req.body.transaction) || req.body?.transaction;
  const signedXdr = typeof transaction === 'string' ? transaction.trim() : null;
  if (!signedXdr) {
    return res.status(400).json({ error: 'transaction (signed challenge XDR) is required' });
  }
  try {
    const result = await verifyAndIssueToken(signedXdr);
    return res.status(200).json(result);
  } catch (err) {
    return res.status(400).json({ error: err.message || 'Invalid transaction' });
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
