/**
 * SEP-10 Challenge endpoint: GET /auth/challenge?account=G...
 * Returns a challenge transaction (XDR) signed by the server for the client to sign.
 * @see https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0010.md#challenge
 */

import { Keypair } from '@stellar/stellar-base';
import * as WebAuth from '@stellar/stellar-sdk';
import {
  getServerSecretKey,
  SEP10_HOME_DOMAIN,
  SEP10_WEB_AUTH_DOMAIN,
  SEP10_NETWORK_PASSPHRASE,
  SEP10_CHALLENGE_TIMEOUT
} from '../config/sep10.js';

/**
 * Build and return SEP-10 challenge transaction.
 * Compliant with SEP-10: server account as source, sequence 0 (invalid), timebounds,
 * first op Manage Data (client account, "<home_domain> auth", 64-byte nonce),
 * second op Manage Data (server, "web_auth_domain", webAuthDomain). Server signs.
 */
export function buildChallenge(accountParam) {
  const clientAccountID = String(accountParam || '').trim();
  if (!clientAccountID || (clientAccountID[0] !== 'G' && clientAccountID[0] !== 'M')) {
    throw new Error('account must be a Stellar public key (G...) or muxed account (M...)');
  }

  const serverSecret = getServerSecretKey();
  const serverKeypair = Keypair.fromSecret(serverSecret);

  // buildChallengeTx(serverKeypair, clientAccountID, homeDomain, timeout, networkPassphrase, webAuthDomain, memo?, clientDomain?, clientSigningKey?)
  const transactionXdr = WebAuth.buildChallengeTx(
    serverKeypair,
    clientAccountID,
    SEP10_HOME_DOMAIN,
    SEP10_CHALLENGE_TIMEOUT,
    SEP10_NETWORK_PASSPHRASE,
    SEP10_WEB_AUTH_DOMAIN,
    null, // memo
    null, // client_domain
    null  // clientSigningKey
  );

  return {
    transaction: transactionXdr,
    network_passphrase: SEP10_NETWORK_PASSPHRASE
  };
}
