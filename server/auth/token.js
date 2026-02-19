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
  const serverSecret = getServerSecretKey();
  const serverKeypair = Keypair.fromSecret(serverSecret);
  const serverAccountID = serverKeypair.publicKey();

  if (!JWT_SECRET) throw new Error('JWT_SECRET is not configured');

  let parsed;
  try {
    parsed = readChallengeTx(
      signedChallengeXdr,
      serverAccountID,
      SEP10_NETWORK_PASSPHRASE,
      SEP10_HOME_DOMAIN,
      SEP10_WEB_AUTH_DOMAIN
    );
  } catch (err) {
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
  } catch (err) {
    throw new Error(`Signature verification failed: ${err.message}`);
  }

  const now = Math.floor(Date.now() / 1000);
  const payload = {
    sub: clientAccountID,
    iat: now,
    exp: now + JWT_EXPIRY_SEC,
    iss: `https://${SEP10_HOME_DOMAIN}`
  };

  const token = jwt.sign(payload, JWT_SECRET, { algorithm: 'HS256' });

  await upsertUser(clientAccountID);
  await setUserToken(clientAccountID, token, new Date((now + JWT_EXPIRY_SEC) * 1000));

  return { token, public_key: clientAccountID };
}
