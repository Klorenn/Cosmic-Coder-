/**
 * SEP-10 Token endpoint: POST /auth/token
 * Verifies signed challenge via @stellar/stellar-sdk v14 (no WebAuth in code), issues JWT.
 * @see https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0010.md#token
 */

import jwt from 'jsonwebtoken';
import * as StellarSdk from '@stellar/stellar-sdk';
import {
  getServerSecretKey,
  SEP10_HOME_DOMAIN,
  SEP10_WEB_AUTH_DOMAIN,
  SEP10_NETWORK_PASSPHRASE,
  JWT_SECRET,
  JWT_EXPIRY_SEC
} from '../config/sep10.js';
import { upsertUser, setUserToken } from '../db/users.js';

const { Keypair } = StellarSdk;
const { readChallengeTx, verifyChallengeTxSigners } = StellarSdk.WebAuth || {};

if (typeof readChallengeTx !== 'function' || typeof verifyChallengeTxSigners !== 'function') {
  throw new Error('SEP-10: readChallengeTx/verifyChallengeTxSigners not available from @stellar/stellar-sdk');
}

/**
 * Verify signed challenge per SEP-10, then issue JWT and upsert user.
 */
export async function verifyAndIssueToken(signedChallengeXdr) {
  console.log('[SEP-10] === Starting token verification ===');
  
  let serverSecret;
  try {
    serverSecret = getServerSecretKey();
    console.log('[SEP-10] Server secret key: OK (starts with S)');
  } catch (err) {
    console.error('[SEP-10] Server secret key ERROR:', err.message);
    throw err;
  }
  
  const serverKeypair = Keypair.fromSecret(serverSecret);
  const serverAccountID = serverKeypair.publicKey();
  console.log('[SEP-10] Server account ID:', serverAccountID);

  if (!JWT_SECRET) {
    console.error('[SEP-10] JWT_SECRET is not configured!');
    throw new Error('JWT_SECRET is not configured');
  }
  console.log('[SEP-10] JWT_SECRET: OK');

  console.log('[SEP-10] Config:', {
    networkPassphrase: SEP10_NETWORK_PASSPHRASE,
    homeDomain: SEP10_HOME_DOMAIN,
    webAuthDomain: SEP10_WEB_AUTH_DOMAIN
  });

  console.log('[SEP-10] Signed XDR length:', signedChallengeXdr?.length || 0);

  let parsed;
  try {
    parsed = readChallengeTx(
      signedChallengeXdr,
      serverAccountID,
      SEP10_NETWORK_PASSPHRASE,
      SEP10_HOME_DOMAIN,
      SEP10_WEB_AUTH_DOMAIN
    );
    console.log('[SEP-10] readChallengeTx: SUCCESS');
    console.log('[SEP-10] Client account:', parsed.clientAccountID);
  } catch (err) {
    console.error('[SEP-10] readChallengeTx FAILED:', err.message);
    throw new Error(`Invalid challenge: ${err.message}`);
  }

  const { clientAccountID } = parsed;

  const signers = [clientAccountID];
  try {
    verifyChallengeTxSigners(
      signedChallengeXdr,
      serverAccountID,
      SEP10_NETWORK_PASSPHRASE,
      signers,
      SEP10_HOME_DOMAIN,
      SEP10_WEB_AUTH_DOMAIN
    );
    console.log('[SEP-10] verifyChallengeTxSigners: SUCCESS');
  } catch (err) {
    console.error('[SEP-10] verifyChallengeTxSigners FAILED:', err.message);
    throw new Error(`Signature verification failed: ${err.message}`);
  }

  const now = Math.floor(Date.now() / 1000);
  const payload = {
    sub: clientAccountID,
    iat: now,
    exp: now + JWT_EXPIRY_SEC,
    iss: `https://${SEP10_HOME_DOMAIN}`
  };

  console.log('[SEP-10] Generating JWT for:', clientAccountID);
  const token = jwt.sign(payload, JWT_SECRET, { algorithm: 'HS256' });
  console.log('[SEP-10] JWT generated, length:', token.length);

  try {
    console.log('[SEP-10] Upserting user to database...');
    await upsertUser(clientAccountID);
    console.log('[SEP-10] User upserted OK');
  } catch (err) {
    console.error('[SEP-10] upsertUser FAILED:', err.message);
  }

  try {
    console.log('[SEP-10] Saving JWT to database...');
    await setUserToken(clientAccountID, token, new Date((now + JWT_EXPIRY_SEC) * 1000));
    console.log('[SEP-10] JWT saved to database OK');
  } catch (err) {
    console.error('[SEP-10] setUserToken FAILED:', err.message);
  }

  console.log('[SEP-10] === Token verification COMPLETE ===');
  return { token, public_key: clientAccountID };
}
