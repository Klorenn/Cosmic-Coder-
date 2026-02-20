/**
 * Cosmic Coder - Soroban game contract client.
 * Calls start_match(), submit_result(wave, score), get_leaderboard(limit).
 * Requires Stellar Wallets Kit for signing.
 * @see https://github.com/jamesbachini/Stellar-Game-Studio
 */

import { StrKey } from '@stellar/stellar-sdk';

const TESTNET_RPC = 'https://soroban-testnet.stellar.org';
const TESTNET_PASSPHRASE = 'Test SDF Network ; September 2015';

export function getContractId() {
  return (
    // Prefer Shadow Ascension policy contract for ZK flow.
    (typeof window !== 'undefined' && window.__VITE_CONFIG__?.VITE_SHADOW_ASCENSION_CONTRACT_ID) ||
    (typeof import.meta !== 'undefined' && import.meta.env?.VITE_SHADOW_ASCENSION_CONTRACT_ID) ||
    // Legacy fallback.
    (typeof window !== 'undefined' && window.__VITE_CONFIG__?.VITE_COSMIC_CODER_CONTRACT_ID) ||
    (typeof import.meta !== 'undefined' && import.meta.env?.VITE_COSMIC_CODER_CONTRACT_ID) ||
    ''
  );
}

/** Base URL for ZK prover backend (option B: backend generates proof). */
export function getZkProverUrl() {
  const envUrl =
    (typeof import.meta !== 'undefined' && import.meta.env?.VITE_ZK_PROVER_URL) || '';
  const runtimeUrl =
    (typeof window !== 'undefined' && window.__VITE_CONFIG__?.VITE_ZK_PROVER_URL) || '';

  // In local development, allow using a local prover, but don't force it.
  // If a remote prover is configured (runtimeUrl), use it by default to avoid
  // ERR_CONNECTION_REFUSED when localhost:3333 isn't running.
  if (
    typeof window !== 'undefined' &&
    (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
  ) {
    // Prefer runtime config.json even in dev; it avoids stale `.env` values
    // like `http://localhost:3333` when that prover isn't running.
    if (runtimeUrl) return runtimeUrl;
    if (envUrl) return envUrl;
    return 'http://localhost:3333';
  }

  return runtimeUrl || envUrl || 'https://cosmic-coder-zk-prover.onrender.com';
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
 * Start a match (calls start_game(player)). Requires wallet sign.
 */
export async function startMatch(signerPublicKey, signTransaction) {
  const contractId = getContractId();
  if (!contractId) throw new Error('VITE_COSMIC_CODER_CONTRACT_ID not set');
  return invoke(contractId, 'start_match', [await playerScVal(signerPublicKey)], signerPublicKey, signTransaction);
}

/**
 * Submit result (end_game(player, wave, score)). Requires wallet sign.
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
  return invoke(contractId, 'end_game', args, signerPublicKey, signTransaction);
}

/**
 * Request ZK proof from backend (option B). Backend runs fullprove and returns contract_proof format.
 * V2: includes challenge_id, player_address, contract_id, domain_separator.
 * @param {string} [baseUrl] - Prover server URL (default VITE_ZK_PROVER_URL or https://cosmic-coder-zk-prover.onrender.com)
 * @param {{ run_hash_hi: string, run_hash_lo: string, score: number, wave: number, nonce: number, season_id?: number, challenge_id?: number, player_address?: string, contract_id?: string, domain_separator?: string }} payload
 * @returns {Promise<{ proof: { a, b, c }, vk: object, pub_signals: string[] }>} hex strings
 */
export async function requestZkProofV2(baseUrl, payload) {
  // For submit_zk on shadow_ascension we must use GameRun (7 pub signals), not GameRunV2.
  // Keep function name for compatibility with existing callers.
  const proverBase = baseUrl || getZkProverUrl();
  const url = String(proverBase).replace(/\/$/, '') + '/zk/prove';
  console.log('[ZK] Prover URL:', url);
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      // /zk/prove expects a 64-hex run_hash; use first 64 chars from run_hash_hi.
      run_hash_hex: String(payload.run_hash_hi || '').slice(0, 64),
      score: payload.score,
      wave: payload.wave,
      nonce: payload.nonce != null ? payload.nonce.toString() : payload.nonce,
      season_id: payload.season_id != null ? payload.season_id : 1,
      used_zk_weapon: payload.used_zk_weapon != null ? payload.used_zk_weapon : 0
    })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `ZK prover V2 ${res.status}`);
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
  // Debug logging to see what we're receiving
  console.log('[contractProofToZk] Raw payload:', JSON.stringify(payload, null, 2));
  console.log('[contractProofToZk] Payload.proof:', payload.proof);
  console.log('[contractProofToZk] Payload.vk:', payload.vk);
  console.log('[contractProofToZk] Payload.pub_signals:', payload.pub_signals);
  
  // Handle proof formats:
  // - snarkjs raw: pi_a/pi_b/pi_c
  // - legacy mapped: alpha/beta/gamma
  // - contract-ready: a/b/c
  const pi_a = payload.proof.pi_a || payload.proof.alpha || payload.proof.a;
  const pi_b = payload.proof.pi_b || payload.proof.beta || payload.proof.b;
  const pi_c = payload.proof.pi_c || payload.proof.gamma || payload.proof.c;
  
  // Validate required proof fields
  if (!pi_a || !pi_b || !pi_c) {
    console.error('[contractProofToZk] Missing proof fields:', { pi_a, pi_b, pi_c });
    throw new Error('Invalid proof format received from prover: missing proof fields (expected one of pi_a/pi_b/pi_c, alpha/beta/gamma, or a/b/c)');
  }
  
  // Handle missing vk - backend might not include it
  if (!payload.vk) {
    console.warn('[contractProofToZk] ⚠️ payload.vk is undefined - backend might not include vk');
    // For now, we'll have to skip ZK submission if vk is missing
    throw new Error('Verification key (vk) not included in prover response. Backend needs to include vk in the response.');
  }
  
  // Validate verification key fields
  if (!payload.vk.alpha || !payload.vk.beta || !payload.vk.gamma || !payload.vk.delta) {
    console.error('[contractProofToZk] Missing vk fields:', {
      alpha: payload.vk.alpha,
      beta: payload.vk.beta,
      gamma: payload.vk.gamma,
      delta: payload.vk.delta
    });
    throw new Error('Invalid verification key format received from prover: missing required vk fields');
  }
  
  return {
    proof: {
      a: ensureBytes(pi_a),
      b: ensureBytes(pi_b),
      c: ensureBytes(pi_c)
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
  return sortedScMap(
    [
      { key: 'a', val: xdr.ScVal.scvBytes(ensureBytes(proof.a)) },
      { key: 'b', val: xdr.ScVal.scvBytes(ensureBytes(proof.b)) },
      { key: 'c', val: xdr.ScVal.scvBytes(ensureBytes(proof.c)) }
    ],
    xdr
  );
}

/**
 * Build xdr.ScVal for verification key (map: alpha, beta, delta, gamma, ic). Keys sorted for Soroban. ic is vec of bytes.
 */
function vkToScVal(vk, xdr) {
  const icVec = xdr.ScVal.scvVec(vk.ic.map((b) => xdr.ScVal.scvBytes(ensureBytes(b))));
  return sortedScMap(
    [
      { key: 'alpha', val: xdr.ScVal.scvBytes(ensureBytes(vk.alpha)) },
      { key: 'beta', val: xdr.ScVal.scvBytes(ensureBytes(vk.beta)) },
      { key: 'delta', val: xdr.ScVal.scvBytes(ensureBytes(vk.delta)) },
      { key: 'gamma', val: xdr.ScVal.scvBytes(ensureBytes(vk.gamma)) },
      { key: 'ic', val: icVec }
    ],
    xdr
  );
}

/** Build a Soroban ScMap sorted by symbol key (required by host object conversion). */
function sortedScMap(entries, xdr) {
  const sorted = [...entries].sort((a, b) => a.key.localeCompare(b.key));
  return xdr.ScVal.scvMap(
    sorted.map(
      ({ key, val }) =>
        new xdr.ScMapEntry({
          key: xdr.ScVal.scvSymbol(key),
          val
        })
    )
  );
}

/** Build xdr.ScVal for public signals (vec of bytes). */
function pubSignalsToScVal(pubSignals, xdr) {
  return xdr.ScVal.scvVec(pubSignals.map((b) => xdr.ScVal.scvBytes(ensureBytes(b))));
}

/** Build a u64 ScVal from number|string|bigint (prefers exact string/bigint). */
function u64ToScVal(xdr, value) {
  if (typeof value === 'bigint') {
    return xdr.ScVal.scvU64(xdr.Uint64.fromString(value.toString()));
  }
  if (typeof value === 'string') {
    const s = value.trim();
    if (s.startsWith('0x') || s.startsWith('0X')) {
      return xdr.ScVal.scvU64(xdr.Uint64.fromString(BigInt(s).toString()));
    }
    return xdr.ScVal.scvU64(xdr.Uint64.fromString(s));
  }
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) {
      console.warn('[submit_zk] nonce is not a safe JS integer; pass nonce as string or BigInt for exactness:', value);
    }
    return xdr.ScVal.scvU64(xdr.Uint64.fromString(String(Math.floor(value))));
  }
  // Fallback: try to stringify (works for e.g. { toString() }).
  return xdr.ScVal.scvU64(xdr.Uint64.fromString(String(value)));
}

/**
 * Submit ZK run V2 (application.submit_proof). Requires Groth16 proof + public inputs (10 values) + domain binding.
 * @param {string} signerPublicKey
 * @param {function} signTransaction
 * @param {object} zk - { proof, vk, pubSignals } (BN254 Groth16)
 * @param {object} domain - { challenge_id, player_address, contract_id, domain_separator }
 * @param {object} publicInputs - { run_hash_hi, run_hash_lo, score, wave, nonce, season_id, challenge_id, player_address, contract_id, domain_separator }
 * @param {string} vkHash - verification key hash (stored in verifier contract)
 * @param {number} score - final score (must match circuit public output)
 * @param {number} wave - wave (must match circuit)
 * @param {number} seasonId - season
 */
export async function submitZkV2(
  signerPublicKey,
  signTransaction,
  zk,
  domain,
  publicInputs,
  vkHash,
  score,
  wave,
  seasonId
) {
  const contractId = getContractId();
  if (!contractId) throw new Error('VITE_COSMIC_CODER_CONTRACT_ID not set');
  if (!zk?.proof || !zk?.vk || !zk?.pubSignals) {
    throw new Error('submitZkV2 requires zk.proof, zk.vk, zk.pubSignals (BN254 Groth16)');
  }
  const { validateGameRules } = await import('../zk/gameProof.js');
  const { valid, reason } = validateGameRules(wave, score);
  if (!valid) throw new Error(`submit_zk_v2 rules: ${reason || 'score >= wave * MIN_SCORE_PER_WAVE'}`);
  const { xdr, Address } = await import('@stellar/stellar-sdk');

  const domainMap = sortedScMap(
    [
      { key: 'challenge_id', val: xdr.ScVal.scvU32(domain.challenge_id) },
      { key: 'player_address', val: new Address(domain.player_address).toScVal() },
      { key: 'nonce', val: xdr.ScVal.scvU64(toBigInt(domain.nonce)) },
      { key: 'contract_id', val: new Address(domain.contract_id).toScVal() },
      { key: 'domain_separator', val: xdr.ScVal.scvBytes(hexToBytes(domain.domain_separator)) }
    ],
    xdr
  );

  const inputsMap = sortedScMap(
    [
      { key: 'run_hash_hi', val: xdr.ScVal.scvBytes(hexToBytes(publicInputs.run_hash_hi)) },
      { key: 'run_hash_lo', val: xdr.ScVal.scvBytes(hexToBytes(publicInputs.run_hash_lo)) },
      { key: 'score', val: xdr.ScVal.scvU32(publicInputs.score) },
      { key: 'wave', val: xdr.ScVal.scvU32(publicInputs.wave) },
      { key: 'nonce', val: xdr.ScVal.scvU64(toBigInt(publicInputs.nonce)) },
      { key: 'season_id', val: xdr.ScVal.scvU32(publicInputs.season_id) },
      { key: 'challenge_id', val: xdr.ScVal.scvU32(publicInputs.challenge_id) },
      { key: 'player_address', val: xdr.ScVal.scvBytes(hexToBytes(publicInputs.player_address)) },
      { key: 'contract_id', val: xdr.ScVal.scvBytes(hexToBytes(publicInputs.contract_id)) },
      { key: 'domain_separator', val: xdr.ScVal.scvBytes(hexToBytes(publicInputs.domain_separator)) }
    ],
    xdr
  );

  const args = [
    domainMap, // domain
    proofToScVal(zk.proof, xdr),
    inputsMap, // public_inputs
    xdr.ScVal.scvBytes(hexToBytes(vkHash)),
    xdr.ScVal.scvU32(Math.max(0, Math.floor(score))),
    xdr.ScVal.scvU32(wave),
    xdr.ScVal.scvU32(seasonId)
  ];
  return invoke(contractId, 'submit_proof', args, signerPublicKey, signTransaction);
}

/** Helper: convert hex string to Uint8Array (32 bytes) */
function hexToBytes(hex) {
  const h = String(hex).replace(/^0x/, '').slice(0, 64).padStart(64, '0');
  const arr = new Uint8Array(32);
  for (let i = 0; i < 32; i++) arr[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return arr;
}

/** Helper: safely convert hex string to BigInt with 0x prefix */
const toBigInt = (str) => {
  if (typeof str !== 'string') return BigInt(str);
  return BigInt(str.startsWith('0x') ? str : '0x' + str);
};

/**
 * TRUSTLESS LOCAL PROVER (like xray-games)
 * Generate ZK proof locally in browser without server dependency.
 * Requires snarkjs loaded and circuit artifacts in /circuits/build/
 * 
 * @param {{ run_hash_hi: string, run_hash_lo: string, score: number, wave: number, nonce: number, season_id?: number, used_zk_weapon?: number }} payload
 * @returns {Promise<{ proof: object, vk: object, pub_signals: string[] }>}
 */
export async function generateLocalProof(payload) {
  // Dynamically import snarkjs for browser
  const snarkjs = await import('snarkjs');
  
  // Circuit artifacts paths (served from /circuits/build/)
  const wasmPath = '/circuits/build/GameRun_js/GameRun.wasm';
  const zkeyPath = '/circuits/build/GameRun_final.zkey';
  const vkeyPath = '/circuits/build/GameRun_vkey.json';
  
  // Build circuit input
  const input = {
    run_hash_hi: String(payload.run_hash_hi || '0'),
    run_hash_lo: String(payload.run_hash_lo || '0'),
    score: String(payload.score),
    wave: String(payload.wave),
    nonce: String(payload.nonce),
    season_id: String(payload.season_id || 1),
    used_zk_weapon: String(payload.used_zk_weapon || 0)
  };
  
  console.log('[LocalProver] Generating proof with input:', input);
  
  // Generate proof using snarkjs in browser
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, wasmPath, zkeyPath);
  
  // Load verification key
  const vkResponse = await fetch(vkeyPath);
  const vk = await vkResponse.json();
  
  // Convert proof to contract format (hex strings)
  const toHex = (arr) => {
    const bn = BigInt(arr[0]) * (1n << 256n) + BigInt(arr[1]);
    return bn.toString(16).padStart(64, '0');
  };
  
  const contractProof = {
    proof: {
      a: toHex(proof.pi_a.slice(0, 2)),
      b: toHex([proof.pi_b[0][1], proof.pi_b[0][0]]) + toHex([proof.pi_b[1][1], proof.pi_b[1][0]]),
      c: toHex(proof.pi_c.slice(0, 2))
    },
    vk: {
      alpha: toHex(vk.vk_alpha_1.slice(0, 2)),
      beta: toHex([vk.vk_beta_2[0][1], vk.vk_beta_2[0][0]]) + toHex([vk.vk_beta_2[1][1], vk.vk_beta_2[1][0]]),
      gamma: toHex([vk.vk_gamma_2[0][1], vk.vk_gamma_2[0][0]]) + toHex([vk.vk_gamma_2[1][1], vk.vk_gamma_2[1][0]]),
      delta: toHex([vk.vk_delta_2[0][1], vk.vk_delta_2[0][0]]) + toHex([vk.vk_delta_2[1][1], vk.vk_delta_2[1][0]]),
      ic: vk.IC.map(ic => toHex(ic.slice(0, 2)))
    },
    pub_signals: publicSignals.map(s => BigInt(s).toString(16).padStart(64, '0'))
  };
  
  console.log('[LocalProver] Proof generated successfully');
  return contractProof;
}

/**
 * TRUSTLESS SUBMIT (like xray-games)
 * Generate proof locally and submit directly to contract - no server needed!
 * 
 * @param {string} signerPublicKey
 * @param {function} signTransaction
 * @param {{ run_hash_hi: string, run_hash_lo: string, score: number, wave: number, nonce: number, season_id?: number, used_zk_weapon?: number }} payload
 */
export async function submitZkTrustless(signerPublicKey, signTransaction, payload) {
  console.log('[Trustless] Generating local proof...');
  const raw = await generateLocalProof(payload);
  const zk = contractProofToZk(raw);
  
  // Submit to contract
  const contractId = getContractId();
  if (!contractId) throw new Error('Contract ID not configured');
  
  const { xdr, Address } = await import('@stellar/stellar-sdk');
  
  // Build proof ScVal
  const proofMap = [
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol('a'), val: xdr.ScVal.scvBytes(zk.proof.a) }),
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol('b'), val: xdr.ScVal.scvBytes(zk.proof.b) }),
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol('c'), val: xdr.ScVal.scvBytes(zk.proof.c) })
  ];
  
  // Build VK ScVal
  const vkMap = [
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol('alpha'), val: xdr.ScVal.scvBytes(zk.vk.alpha) }),
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol('beta'), val: xdr.ScVal.scvBytes(zk.vk.beta) }),
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol('gamma'), val: xdr.ScVal.scvBytes(zk.vk.gamma) }),
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol('delta'), val: xdr.ScVal.scvBytes(zk.vk.delta) }),
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol('ic'), val: xdr.ScVal.scvVec(zk.vk.ic.map(b => xdr.ScVal.scvBytes(b))) })
  ];
  
  // Build pub_signals ScVal
  const pubSignalsVec = zk.pubSignals.map(b => xdr.ScVal.scvBytes(b));
  
  const args = [
    new Address(signerPublicKey).toScVal(),
    xdr.ScVal.scvMap(proofMap),
    xdr.ScVal.scvMap(vkMap),
    xdr.ScVal.scvVec(pubSignalsVec),
    u64ToScVal(xdr, payload.nonce),
    xdr.ScVal.scvBytes(new Uint8Array(32)), // run_hash placeholder
    xdr.ScVal.scvU32(payload.season_id || 1),
    xdr.ScVal.scvU32(payload.score),
    xdr.ScVal.scvU32(payload.wave)
  ];
  
  console.log('[Trustless] Submitting to contract...');
  return invoke(contractId, 'submit_zk', args, signerPublicKey, signTransaction);
}

/**
 * Ranked submit V2 (option B): request proof from backend, then submit_proof (v2 contracts).
 * @param {string} signerPublicKey
 * @param {function} signTransaction
 * @param {string} [proverUrl] - default VITE_ZK_PROVER_URL
 * @param {{ run_hash_hi: string, run_hash_lo: string, score: number, wave: number, nonce: number, season_id?: number, challenge_id?: number, player_address?: string, contract_id?: string, domain_separator?: string }} payload
 * @param {string} vkHash - verification key hash (stored in verifier contract)
 */
export async function submitZkFromProverV2(signerPublicKey, signTransaction, proverUrl, payload, vkHash) {
  const raw = await requestZkProofV2(proverUrl, payload);
  const zk = contractProofToZk(raw);
  const contractId = getContractId();
  if (!contractId) throw new Error('VITE_SHADOW_ASCENSION_CONTRACT_ID not set');
  const { xdr, Address } = await import('@stellar/stellar-sdk');

  const args = [
    new Address(signerPublicKey).toScVal(),
    proofToScVal(zk.proof, xdr),
    vkToScVal(zk.vk, xdr),
    pubSignalsToScVal(zk.pubSignals, xdr),
    u64ToScVal(xdr, payload.nonce),
    xdr.ScVal.scvBytes(hexToBytes((payload.run_hash_hi || '').toString() + (payload.run_hash_lo || '').toString())),
    xdr.ScVal.scvU32(payload.season_id != null ? payload.season_id : 1),
    xdr.ScVal.scvU32(payload.score),
    xdr.ScVal.scvU32(payload.wave)
  ];
  return invoke(contractId, 'submit_zk', args, signerPublicKey, signTransaction);
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
