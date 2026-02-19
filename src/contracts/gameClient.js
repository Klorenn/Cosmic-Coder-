/**
 * Cosmic Coder - Soroban game contract client.
 * Calls start_match(), submit_result(wave, score), get_leaderboard(limit).
 * Requires Stellar Wallets Kit for signing.
 * @see https://github.com/jamesbachini/Stellar-Game-Studio
 */

const TESTNET_RPC = 'https://soroban-testnet.stellar.org';
const TESTNET_PASSPHRASE = 'Test SDF Network ; September 2015';

export function getContractId() {
  return (typeof window !== 'undefined' && window.__VITE_CONFIG__?.VITE_COSMIC_CODER_CONTRACT_ID) ||
    (typeof import.meta !== 'undefined' && import.meta.env?.VITE_COSMIC_CODER_CONTRACT_ID) || '';
}

/** Base URL for ZK prover backend (option B: backend generates proof). */
export function getZkProverUrl() {
  return (typeof window !== 'undefined' && window.__VITE_CONFIG__?.VITE_ZK_PROVER_URL) ||
    (typeof import.meta !== 'undefined' && import.meta.env?.VITE_ZK_PROVER_URL) || 'http://localhost:3333';
}

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
  // Stellar SDK Account requires sequence as string (Horizon/RPC may return number)
  const account = new Account(publicKey, String(source.sequence ?? '0'));
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
  const contractId = getContractId();
  if (!contractId) throw new Error('VITE_COSMIC_CODER_CONTRACT_ID not set');
  return invoke(contractId, 'start_match', [await playerScVal(signerPublicKey)], signerPublicKey, signTransaction);
}

/**
 * Submit result (submit_result(player, wave, score)). Requires wallet sign.
 */
export async function submitResult(signerPublicKey, signTransaction, wave, score) {
  const contractId = getContractId();
  if (!contractId) throw new Error('VITE_COSMIC_CODER_CONTRACT_ID not set');
  const { xdr, ScInt } = await import('@stellar/stellar-sdk');
  const args = [
    await playerScVal(signerPublicKey),
    xdr.ScVal.scvU32(wave),
    new ScInt(BigInt(Math.floor(score)), { type: 'i128' }).toI128(),
  ];
  return invoke(contractId, 'submit_result', args, signerPublicKey, signTransaction);
}

/**
 * Request ZK proof from backend (option B). Backend runs fullprove and returns contract_proof format.
 * @param {string} [baseUrl] - Prover server URL (default VITE_ZK_PROVER_URL or http://localhost:3333)
 * @param {{ run_hash_hex: string, score: number, wave: number, nonce: number, season_id?: number }} payload
 * @returns {Promise<{ proof: { a, b, c }, vk: object, pub_signals: string[] }>} hex strings
 */
export async function requestZkProof(baseUrl, payload) {
  const url = (baseUrl || getZkProverUrl()).replace(/\/$/, '') + '/zk/prove';
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      run_hash_hex: payload.run_hash_hex,
      score: payload.score,
      wave: payload.wave,
      nonce: payload.nonce,
      season_id: payload.season_id != null ? payload.season_id : 1
    })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `ZK prover ${res.status}`);
  }
  return res.json();
}

/** Normalize any bytes-like value to Uint8Array (hex string, array of numbers, or object with numeric keys from JSON). */
function ensureBytes(val) {
  if (val instanceof Uint8Array) return val;
  if (Array.isArray(val)) return new Uint8Array(val);
  if (typeof val === 'object' && val !== null && !(val instanceof Uint8Array)) {
    const arr = Object.keys(val)
      .filter((k) => /^\d+$/.test(k))
      .sort((a, b) => Number(a) - Number(b))
      .map((k) => val[k] & 0xff);
    return new Uint8Array(arr);
  }
  const h = String(val).replace(/^0x/, '').slice(0, 128);
  const arr = new Uint8Array(h.length / 2);
  for (let i = 0; i < h.length; i += 2) arr[i / 2] = parseInt(h.slice(i, i + 2), 16);
  return arr;
}

/**
 * Convert contract_proof.json payload (hex or raw) to zk object for submitZk (always Uint8Array).
 * Works in browser (Uint8Array) and Node (Buffer). Tolerates API returning arrays/objects.
 */
function contractProofToZk(payload) {
  return {
    proof: {
      a: ensureBytes(payload.proof.a),
      b: ensureBytes(payload.proof.b),
      c: ensureBytes(payload.proof.c)
    },
    vk: {
      alpha: ensureBytes(payload.vk.alpha),
      beta: ensureBytes(payload.vk.beta),
      gamma: ensureBytes(payload.vk.gamma),
      delta: ensureBytes(payload.vk.delta),
      ic: payload.vk.ic.map(ensureBytes)
    },
    pubSignals: payload.pub_signals.map(ensureBytes)
  };
}

/**
 * Build xdr.ScVal for Groth16 proof (map: a, b, c -> bytes). Contract expects ScVal, not plain objects.
 */
function proofToScVal(proof, xdr) {
  const entry = (key, bytes) =>
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol(key),
      val: xdr.ScVal.scvBytes(ensureBytes(bytes))
    });
  return xdr.ScVal.scvMap([
    entry('a', proof.a),
    entry('b', proof.b),
    entry('c', proof.c)
  ]);
}

/**
 * Build xdr.ScVal for verification key (map: alpha, beta, delta, gamma, ic). Keys sorted for Soroban. ic is vec of bytes.
 */
function vkToScVal(vk, xdr) {
  const entry = (key, val) =>
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol(key),
      val
    });
  const icVec = xdr.ScVal.scvVec(vk.ic.map((b) => xdr.ScVal.scvBytes(ensureBytes(b))));
  return xdr.ScVal.scvMap([
    entry('alpha', xdr.ScVal.scvBytes(ensureBytes(vk.alpha))),
    entry('beta', xdr.ScVal.scvBytes(ensureBytes(vk.beta))),
    entry('delta', xdr.ScVal.scvBytes(ensureBytes(vk.delta))),
    entry('gamma', xdr.ScVal.scvBytes(ensureBytes(vk.gamma))),
    entry('ic', icVec)
  ]);
}

/** Build xdr.ScVal for public signals (vec of bytes). */
function pubSignalsToScVal(pubSignals, xdr) {
  return xdr.ScVal.scvVec(pubSignals.map((b) => xdr.ScVal.scvBytes(ensureBytes(b))));
}

/**
 * Submit ZK run (submit_zk). Requires Groth16 proof + VK + pub_signals from off-chain circuit.
 * Anti-replay: nonce must be unique per player. Bind proof to run_hash and season_id.
 * Contract and client enforce: score >= wave * MIN_SCORE_PER_WAVE.
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
  const contractId = getContractId();
  if (!contractId) throw new Error('VITE_COSMIC_CODER_CONTRACT_ID not set');
  if (!zk?.proof || !zk?.vk || !zk?.pubSignals) {
    throw new Error('submitZk requires zk.proof, zk.vk, zk.pubSignals (BN254 Groth16)');
  }
  const { validateGameRules } = await import('../zk/gameProof.js');
  const { valid, reason } = validateGameRules(wave, score);
  if (!valid) throw new Error(`submit_zk rules: ${reason || 'score >= wave * MIN_SCORE_PER_WAVE'}`);
  const { xdr } = await import('@stellar/stellar-sdk');
  const runHashHexClean = String(runHashHex).replace(/^0x/, '').slice(0, 64).padStart(64, '0');
  const runHashBuf = new Uint8Array(32);
  for (let i = 0; i < 32; i++) runHashBuf[i] = parseInt(runHashHexClean.slice(i * 2, i * 2 + 2), 16);
  const runHashBytes = xdr.ScVal.scvBytes(runHashBuf);
  // Contract expects xdr.ScVal; passing raw proof/vk/pubSignals causes "union name undefined, not ScVal"
  const args = [
    await playerScVal(signerPublicKey),
    proofToScVal(zk.proof, xdr),
    vkToScVal(zk.vk, xdr),
    pubSignalsToScVal(zk.pubSignals, xdr),
    xdr.ScVal.scvU64(BigInt(nonce)),
    runHashBytes,
    xdr.ScVal.scvU32(seasonId),
    xdr.ScVal.scvU32(Math.max(0, Math.floor(score))),
    xdr.ScVal.scvU32(wave),
  ];
  return invoke(contractId, 'submit_zk', args, signerPublicKey, signTransaction);
}

/**
 * Ranked submit (option B): request proof from backend, then submit_zk.
 * @param {string} signerPublicKey
 * @param {function} signTransaction
 * @param {string} [proverUrl] - default VITE_ZK_PROVER_URL
 * @param {{ run_hash_hex: string, score: number, wave: number, nonce: number, season_id?: number }} payload
 */
export async function submitZkFromProver(signerPublicKey, signTransaction, proverUrl, payload) {
  const raw = await requestZkProof(proverUrl, payload);
  const zk = contractProofToZk(raw);
  const runHashHex = payload.run_hash_hex.slice(0, 64);
  const seasonId = payload.season_id != null ? payload.season_id : 1;
  return submitZk(
    signerPublicKey,
    signTransaction,
    zk,
    payload.nonce,
    runHashHex,
    seasonId,
    payload.score,
    payload.wave
  );
}

/**
 * Get leaderboard (read-only). Returns [] if contract not configured or on error.
 */
export async function getLeaderboard(limit = 10) {
  if (!getContractId()) return [];
  try {
    const {
      Contract,
      TransactionBuilder,
      Account,
      BASE_FEE,
      xdr,
    } = await import('@stellar/stellar-sdk');
    const server = await getServer();
    const contract = new Contract(getContractId());
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

/**
 * Get ranked leaderboard by season (ZK runs). Returns [] if contract not configured or on error.
 * ScoreEntry has { player, score } (no wave).
 */
export async function getLeaderboardBySeason(seasonId = 1, limit = 10) {
  if (!getContractId()) return [];
  try {
    const {
      Contract,
      TransactionBuilder,
      Account,
      BASE_FEE,
      xdr,
    } = await import('@stellar/stellar-sdk');
    const server = await getServer();
    const contract = new Contract(getContractId());
    const dummyAccount = new Account(
      'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      '0'
    );
    const built = new TransactionBuilder(dummyAccount, {
      fee: BASE_FEE,
      networkPassphrase: TESTNET_PASSPHRASE,
    })
      .addOperation(contract.call('get_leaderboard_by_season', xdr.ScVal.scvU32(seasonId), xdr.ScVal.scvU32(limit)))
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
      let score = 0;
      for (let j = 0; j < m.length; j++) {
        const k = m[j].key().sym().toString();
        const v = m[j].val();
        if (k === 'player') player = v.address().toScAddress().accountId().ed25519().toString();
        if (k === 'score') {
          try {
            score = typeof v.i128 === 'function' ? Number(v.i128().toString()) : v.u32();
          } catch (_) {
            try {
              score = v.u32();
            } catch (__) {
              score = 0;
            }
          }
        }
      }
      out.push({ player, wave: 0, score });
    }
    return out;
  } catch (_) {
    return [];
  }
}

export function isContractConfigured() {
  return !!getContractId();
}

/** True if ranked (ZK) submit is available: contract + prover URL. */
export function isZkProverConfigured() {
  const url = getZkProverUrl();
  return !!getContractId() && !!(url && url.startsWith('http'));
}

/**
 * Check ZK prover health by making a ping request.
 * @returns {Promise<{ok: boolean, status: string, error?: string}>}
 */
export async function checkZkProverHealth() {
  const url = getZkProverUrl();
  if (!url || !url.startsWith('http')) {
    return { ok: false, status: 'not_configured', error: 'ZK prover URL not configured' };
  }
  try {
    const res = await fetch(url.replace(/\/$/, '') + '/health', {
      method: 'GET',
      headers: { 'Accept': 'application/json' }
    });
    if (res.ok) {
      const data = await res.json().catch(() => ({}));
      return { ok: true, status: data.status || 'healthy', data };
    }
    return { ok: false, status: 'error', error: `HTTP ${res.status}: ${res.statusText}` };
  } catch (e) {
    return { ok: false, status: 'unreachable', error: e?.message || 'Network error' };
  }
}

/**
 * Get detailed ZK status for UI display.
 * @returns {Promise<{configured: boolean, proverHealthy: boolean, contractSet: boolean, message: string}>}
 */
export async function getZkStatus() {
  const contractSet = isContractConfigured();
  const proverConfigured = isZkProverConfigured();
  
  if (!contractSet) {
    return { configured: false, proverHealthy: false, contractSet: false, message: 'Contract not configured' };
  }
  if (!proverConfigured) {
    return { configured: false, proverHealthy: false, contractSet: true, message: 'ZK prover not configured' };
  }
  
  const health = await checkZkProverHealth();
  return {
    configured: true,
    proverHealthy: health.ok,
    contractSet: true,
    message: health.ok ? 'ZK ready' : `ZK prover ${health.status}: ${health.error || 'Unknown error'}`
  };
}
