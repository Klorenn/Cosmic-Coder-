/**
 * Shadow Ascension - Soroban game contract client.
 * Calls start_match(), submit_result(wave, score), get_leaderboard(limit).
 * Requires Stellar Wallets Kit for signing.
 * @see https://github.com/jamesbachini/Stellar-Game-Studio
 */

const TESTNET_RPC = 'https://soroban-testnet.stellar.org';
const TESTNET_PASSPHRASE = 'Test SDF Network ; September 2015';

const CONTRACT_ID =
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_SHADOW_ASCENSION_CONTRACT_ID) || '';

/**
 * Get Soroban RPC server (SDK 14: rpc.Server).
 */
async function getServer() {
  const { rpc } = await import('@stellar/stellar-sdk');
  return new rpc.Server(TESTNET_RPC);
}

/**
 * Build, prepare, sign and send a contract invocation.
 */
async function invoke(contractId, method, args, publicKey, signTransaction) {
  const {
    Contract,
    TransactionBuilder,
    Account,
    BASE_FEE,
    xdr,
    ScInt,
  } = await import('@stellar/stellar-sdk');
  const server = await getServer();
  const source = await server.getAccount(publicKey);
  const account = new Account(publicKey, source.sequence);
  const contract = new Contract(contractId);
  const op = contract.call(method, ...args);
  const built = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: TESTNET_PASSPHRASE,
  })
    .addOperation(op)
    .setTimeout(30)
    .build();
  const prepared = await server.prepareTransaction(built);
  const signedXdr = await signTransaction(prepared.toXDR());
  const tx = TransactionBuilder.fromXDR(signedXdr, TESTNET_PASSPHRASE);
  const result = await server.sendTransaction(tx);
  if (result.status === 'ERROR') {
    throw new Error(result.errorResultXdr || result.status);
  }
  return result;
}

/**
 * Build player ScVal from signer public key (G...). Contract expects player address and require_auth(player).
 */
async function playerScVal(signerPublicKey) {
  const { Address } = await import('@stellar/stellar-sdk');
  return new Address(signerPublicKey).toScVal();
}

/**
 * Start a match (calls start_match(player)). Requires wallet sign.
 */
export async function startMatch(signerPublicKey, signTransaction) {
  if (!CONTRACT_ID) throw new Error('VITE_SHADOW_ASCENSION_CONTRACT_ID not set');
  return invoke(CONTRACT_ID, 'start_match', [await playerScVal(signerPublicKey)], signerPublicKey, signTransaction);
}

/**
 * Submit result (submit_result(player, wave, score)). Requires wallet sign.
 */
export async function submitResult(signerPublicKey, signTransaction, wave, score) {
  if (!CONTRACT_ID) throw new Error('VITE_SHADOW_ASCENSION_CONTRACT_ID not set');
  const { xdr, ScInt } = await import('@stellar/stellar-sdk');
  const args = [
    await playerScVal(signerPublicKey),
    xdr.ScVal.scvU32(wave),
    new ScInt(BigInt(Math.floor(score)), { type: 'i128' }).toI128(),
  ];
  return invoke(CONTRACT_ID, 'submit_result', args, signerPublicKey, signTransaction);
}

/**
 * Submit ZK run (submit_zk). Requires Groth16 proof + VK + pub_signals from off-chain circuit.
 * Anti-replay: nonce must be unique per player. Bind proof to run_hash and season_id.
 * @param {object} zk - { proof, vk, pubSignals } (BN254-encoded)
 * @param {number} nonce - unique per run (e.g. timestamp or counter)
 * @param {string} runHashHex - run hash binding (e.g. from gameProof.computeGameHash)
 * @param {number} seasonId - optional season
 * @param {number} score - final score (must match circuit public output)
 * @param {number} wave - wave (must match circuit)
 */
export async function submitZk(
  signerPublicKey,
  signTransaction,
  zk,
  nonce,
  runHashHex,
  seasonId,
  score,
  wave
) {
  if (!CONTRACT_ID) throw new Error('VITE_SHADOW_ASCENSION_CONTRACT_ID not set');
  if (!zk?.proof || !zk?.vk || !zk?.pubSignals) {
    throw new Error('submitZk requires zk.proof, zk.vk, zk.pubSignals (BN254 Groth16)');
  }
  const { xdr } = await import('@stellar/stellar-sdk');
  const runHashBuf = Buffer.alloc(32);
  Buffer.from(runHashHex.slice(0, 64), 'hex').copy(runHashBuf, 0, 0, 32);
  const runHashBytes = xdr.ScVal.scvBytes(runHashBuf);
  const args = [
    await playerScVal(signerPublicKey),
    zk.proof,
    zk.vk,
    zk.pubSignals,
    xdr.ScVal.scvU64(BigInt(nonce)),
    runHashBytes,
    xdr.ScVal.scvU32(seasonId),
    xdr.ScVal.scvU32(Math.max(0, Math.floor(score))),
    xdr.ScVal.scvU32(wave),
  ];
  return invoke(CONTRACT_ID, 'submit_zk', args, signerPublicKey, signTransaction);
}

/**
 * Get leaderboard (read-only). Returns [] if contract not configured or on error.
 */
export async function getLeaderboard(limit = 10) {
  if (!CONTRACT_ID) return [];
  try {
    const {
      Contract,
      TransactionBuilder,
      Account,
      BASE_FEE,
      xdr,
    } = await import('@stellar/stellar-sdk');
    const server = await getServer();
    const contract = new Contract(CONTRACT_ID);
    const dummyAccount = new Account(
      'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      '0'
    );
    const built = new TransactionBuilder(dummyAccount, {
      fee: BASE_FEE,
      networkPassphrase: TESTNET_PASSPHRASE,
    })
      .addOperation(contract.call('get_leaderboard', xdr.ScVal.scvU32(limit)))
      .setTimeout(30)
      .build();
    const sim = await server.simulateTransaction(built);
    if (sim.error) return [];
    const vec = sim.result?.retval;
    if (!vec || vec.switch().name !== 'vec') return [];
    const arr = vec.vec();
    const out = [];
    for (let i = 0; i < arr.length; i++) {
      const entry = arr[i];
      if (entry.obj().switch().name !== 'map') continue;
      const m = entry.obj().map();
      let player = '';
      let wave = 0;
      let score = 0;
      for (let j = 0; j < m.length; j++) {
        const k = m[j].key().sym().toString();
        const v = m[j].val();
        if (k === 'player') player = v.address().toScAddress().accountId().ed25519().toString();
        if (k === 'wave') wave = v.u32();
        if (k === 'score') score = Number(v.i128().toString());
      }
      out.push({ player, wave, score });
    }
    return out;
  } catch (_) {
    return [];
  }
}

export function isContractConfigured() {
  return !!CONTRACT_ID;
}
