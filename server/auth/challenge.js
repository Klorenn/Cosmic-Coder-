/**
 * SEP-10 Challenge: build challenge transaction for GET /auth/challenge?account=G...
 * Uses @stellar/stellar-base only (no WebAuth), compatible with SDK v14 and Render.
 * @see https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0010.md#challenge
 */

import { randomBytes } from 'crypto';
import {
  Keypair,
  Account,
  TransactionBuilder,
  Operation,
  BASE_FEE
} from '@stellar/stellar-base';
import {
  getServerSecretKey,
  SEP10_HOME_DOMAIN,
  SEP10_WEB_AUTH_DOMAIN,
  SEP10_NETWORK_PASSPHRASE,
  SEP10_CHALLENGE_TIMEOUT
} from '../config/sep10.js';

/**
 * Build a SEP-10 challenge transaction (server signs, client must sign too).
 * Returns base64 XDR of the transaction envelope.
 */
function buildChallengeTx(serverKeypair, clientAccountID, homeDomain, timeout, networkPassphrase, webAuthDomain) {
  const account = new Account(serverKeypair.publicKey(), '-1');
  const now = Math.floor(Date.now() / 1000);
  const nonce = randomBytes(48).toString('base64');

  const builder = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase,
    timebounds: {
      minTime: now,
      maxTime: now + timeout
    }
  })
    .addOperation(
      Operation.manageData({
        name: `${homeDomain} auth`,
        value: nonce,
        source: clientAccountID
      })
    )
    .addOperation(
      Operation.manageData({
        name: 'web_auth_domain',
        value: webAuthDomain,
        source: account.accountId()
      })
    );

  const transaction = builder.build();
  transaction.sign(serverKeypair);
  return transaction.toEnvelope().toXDR('base64').toString();
}

/**
 * Build and return SEP-10 challenge for GET /auth/challenge?account=G...
 * Response: { transaction: "<base64 XDR>", network_passphrase: "..." }.
 */
export function buildChallenge(accountParam) {
  const clientAccountID = String(accountParam || '').trim();
  if (!clientAccountID || (clientAccountID[0] !== 'G' && clientAccountID[0] !== 'M')) {
    throw new Error('account must be a Stellar public key (G...) or muxed account (M...)');
  }

  const serverSecret = getServerSecretKey();
  const serverKeypair = Keypair.fromSecret(serverSecret);

  const transactionXdr = buildChallengeTx(
    serverKeypair,
    clientAccountID,
    SEP10_HOME_DOMAIN,
    SEP10_CHALLENGE_TIMEOUT,
    SEP10_NETWORK_PASSPHRASE,
    SEP10_WEB_AUTH_DOMAIN
  );

  return {
    transaction: transactionXdr,
    network_passphrase: SEP10_NETWORK_PASSPHRASE
  };
}
