/**
 * SEP-10 Token endpoint: POST /auth/token
 * Accepts signed challenge transaction; verifies per SEP-10 and returns JWT.
 * @see https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0010.md#token
 */

import jwt from 'jsonwebtoken';
import * as WebAuth from '@stellar/stellar-sdk';
import { Keypair } from '@stellar/stellar-base';
import {
  getServerSecretKey,
  SEP10_HOME_DOMAIN,
  SEP10_WEB_AUTH_DOMAIN,
  SEP10_NETWORK_PASSPHRASE,
  JWT_SECRET,
  JWT_EXPIRY_SEC
} from '../config/sep10.js';
import { upsertUser } from '../db/users.js';

/**
 * Verify signed challenge per SEP-10:
 * - Decode XDR, verify server signature, timebounds, sequence 0, home domain, web_auth_domain.
 * - Verify client signed (we accept master key only: signers = [clientAccountID]).
 * Then issue JWT and upsert user.
 */
export async function verifyAndIssueToken(signedChallengeXdr) {
  const serverSecret = getServerSecretKey();
  const serverKeypair = Keypair.fromSecret(serverSecret);
  const serverAccountID = serverKeypair.publicKey();

  if (!JWT_SECRET) throw new Error('JWT_SECRET is not configured');

  // SEP-10: decode and validate structure, server signature, timebounds, sequence 0, home domain
  let parsed;
  try {
    parsed = WebAuth.readChallengeTx(
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

  // SEP-10: verify that the transaction is signed by the client (master key).
  // For accounts that do not exist, we require the single signature from the client's master key.
  // For existing accounts we could fetch signers from Horizon; here we accept only the master key.
  const signers = [clientAccountID];
  try {
    WebAuth.verifyChallengeTxSigners(
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

  // JWT: sub = client account (SEP-10 says sub is the Stellar account or M... or G...:memo)
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    sub: clientAccountID,
    iat: now,
    exp: now + JWT_EXPIRY_SEC,
    iss: `https://${SEP10_HOME_DOMAIN}`
  };

  const token = jwt.sign(payload, JWT_SECRET, { algorithm: 'HS256' });

  // Persist user (create if not exists)
  await upsertUser(clientAccountID);

  return { token, public_key: clientAccountID };
}
