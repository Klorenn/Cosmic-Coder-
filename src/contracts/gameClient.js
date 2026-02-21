/**
 * Cosmic Coder - Soroban game contract client.
 * Calls start_match(), submit_result(wave, score), get_leaderboard(limit).
 * Requires Stellar Wallets Kit for signing.
 * @see https://github.com/jamesbachini/Stellar-Game-Studio
 */

import { StrKey } from '@stellar/stellar-sdk';
import { validateGameRules } from '../zk/gameProof.js';
import { NoirService } from '../services/NoirService.js';
import { getAssetPath } from '../utils/assetBase.js';
import { getFreighterNetwork } from '../utils/stellarWallet.js';

const TESTNET_RPC = 'https://soroban-testnet.stellar.org';
const TESTNET_PASSPHRASE = 'Test SDF Network ; September 2015';

/** Transaction validity window (seconds). 30s was causing txTooLate when user signs slowly or RPC is slow. */
const TX_VALIDITY_SECONDS = 300;

export function getContractId() {
  return (
    (typeof window !== 'undefined' && window.__VITE_CONFIG__?.VITE_COSMIC_CODER_CONTRACT_ID) ||
    (typeof import.meta !== 'undefined' && import.meta.env?.VITE_COSMIC_CODER_CONTRACT_ID) ||
    // Legacy fallback env var (removed — use VITE_COSMIC_CODER_CONTRACT_ID)
    ''
  );
}

/** Soroban contract IDs are StrKey, 56 chars, start with C. Returns false if empty or malformed. */
function isContractIdValid(contractId) {
  const id = typeof contractId === 'string' ? contractId.trim() : '';
  return id.length === 56 && id.startsWith('C') && /^C[A-Z2-7]{55}$/i.test(id);
}

/** Base URL for ZK prover backend. Only from config (deployed page) or env — no localhost fallback to avoid errors on deploy. */
export function getZkProverUrl() {
  const runtimeUrl =
    (typeof window !== 'undefined' && window.__VITE_CONFIG__?.VITE_ZK_PROVER_URL) || '';
  const envUrl =
    (typeof import.meta !== 'undefined' && import.meta.env?.VITE_ZK_PROVER_URL) || '';
  if (runtimeUrl) return runtimeUrl;
  if (envUrl) return envUrl;
  return 'https://cosmic-coder-zk-prover.onrender.com';
}

/**
 * Get Soroban RPC server (SDK 14: rpc.Server).
 */
async function getServer() {
  const { rpc } = await import('@stellar/stellar-sdk');
  return new rpc.Server(TESTNET_RPC);
}

function safeJson(value) {
  try {
    return JSON.stringify(
      value,
      (_, v) => (typeof v === 'bigint' ? v.toString() : v),
      2
    );
  } catch (_) {
    return String(value);
  }
}

async function waitForTx(server, hash, tries = 12, delayMs = 1000) {
  let lastSeen = null;
  for (let i = 0; i < tries; i++) {
    try {
      const tx = await server.getTransaction(hash);
      const status = String(tx?.status || '').toUpperCase();
      if (status) {
        lastSeen = tx;
        if (status === 'SUCCESS' || status === 'FAILED') return tx;
      }
    } catch (_) {
      // keep polling
    }
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return lastSeen;
}

/**
 * Build, prepare, sign and send a contract invocation.
 */
async function invoke(contractId, method, args, publicKey, signTransaction) {
  // Fail fast with a clear message if Freighter is on Mainnet (avoids txBadAuth)
  if (typeof window !== 'undefined') {
    try {
      const net = await getFreighterNetwork();
      if (net && net.networkPassphrase && net.networkPassphrase !== TESTNET_PASSPHRASE) {
        const name = (net.network || 'other').toUpperCase();
        throw new Error(
          `[Cosmic Coder] Freighter is on "${name}". This app uses **Stellar Testnet**. ` +
          'In Freighter, click the network name and switch to "Testnet", then try again.'
        );
      }
    } catch (e) {
      if (e?.message?.includes('Freighter is on')) throw e;
      // getFreighterNetwork can fail if extension not ready; continue
    }
  }

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
    .setTimeout(TX_VALIDITY_SECONDS)
    .build();

  // Surface detailed host/contract errors early (before signing/sending).
  const sim = await server.simulateTransaction(built);
  if (sim?.error) {
    throw new Error(
      `[simulate:${method}] ${sim.error}\n` +
      `result=${safeJson(sim.result)}\n` +
      `events=${safeJson(sim.events)}`
    );
  }

  const prepared = await server.prepareTransaction(built);
  // Always pass network so Freighter signs for Testnet (avoids txBadAuth when user has Mainnet selected)
  const signedXdr = await signTransaction(prepared.toXDR(), TESTNET_PASSPHRASE);
  const tx = TransactionBuilder.fromXDR(signedXdr, TESTNET_PASSPHRASE);
  const result = await server.sendTransaction(tx);
  if (result.status === 'PENDING' && result.hash) {
    const txInfo = await waitForTx(server, result.hash, 20, 1000);
    const finalStatus = String(txInfo?.status || '').toUpperCase();
    if (finalStatus === 'SUCCESS') {
      return txInfo;
    }
    throw new Error(
      `[send:${method}] status=PENDING->${finalStatus || 'UNKNOWN'} hash=${result.hash}\n` +
      `rpc_result=${safeJson(result)}\n` +
      `tx_info=${safeJson(txInfo)}`
    );
  }
  if (result.status === 'ERROR') {
    const errSwitch = result.errorResult?.result?._switch ?? result.errorResult?._attributes?.result?._switch;
    const isBadAuth = errSwitch?.name === 'txBadAuth' || String(safeJson(result)).includes('txBadAuth');
    const authHint = isBadAuth
      ? '\n\n[Cosmic Coder] txBadAuth: Make sure Freighter is set to **Stellar Testnet** (not Mainnet) and the connected account is the one signing.'
      : '';
    if (result.hash) {
      const txInfo = await waitForTx(server, result.hash, 20, 1000);
      if (txInfo) {
        throw new Error(
          `[send:${method}] status=ERROR hash=${result.hash}\n` +
          `rpc_result=${safeJson(result)}\n` +
          `tx_status=${txInfo.status || 'unknown'}\n` +
          `tx_result=${txInfo.resultXdr || 'n/a'}\n` +
          `tx_result_meta=${txInfo.resultMetaXdr || 'n/a'}\n` +
          `tx_envelope=${txInfo.envelopeXdr || 'n/a'}` +
          authHint
        );
      }
    }
    let decoded = '';
    if (result.errorResultXdr) {
      try {
        const tr = xdr.TransactionResult.fromXDR(result.errorResultXdr, 'base64');
        decoded = ` txResult=${tr.result().switch().name}`;
      } catch (_) {
        decoded = '';
      }
    }
    throw new Error(
      `[send:${method}] status=ERROR` +
      `${decoded}` +
      ` hash=${result.hash || 'n/a'}` +
      ` errorResultXdr=${result.errorResultXdr || 'n/a'}\n` +
      `rpc_result=${safeJson(result)}` +
      authHint
    );
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
  // For submit_zk on Cosmic Coder contract we must use GameRun (7 pub signals), not GameRunV2.
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

/**
 * Normalize any bytes-like value to Uint8Array.
 * If `expectedLen` is provided, throws if the decoded length doesn't match.
 */
function ensureBytes(val, expectedLen) {
  let out;
  if (val instanceof Uint8Array) {
    out = val;
  } else if (Array.isArray(val)) {
    out = new Uint8Array(val);
  } else if (typeof val === 'object' && val !== null && !(val instanceof Uint8Array)) {
    const arr = Object.keys(val)
      .filter((k) => /^\d+$/.test(k))
      .sort((a, b) => Number(a) - Number(b))
      .map((k) => val[k] & 0xff);
    out = new Uint8Array(arr);
  } else {
    let h = String(val).trim().replace(/^0x/i, '');
    // Treat as hex if it contains only hex chars. This includes "all-digit hex" like "000...01".
    if (!/^[0-9a-fA-F]+$/.test(h)) {
      throw new Error(`Expected hex string for bytes, got "${h}"`);
    }
    if (h.length % 2 === 1) h = '0' + h;
    out = new Uint8Array(h.length / 2);
    for (let i = 0; i < h.length; i += 2) out[i / 2] = parseInt(h.slice(i, i + 2), 16);
  }

  if (expectedLen != null && out.length !== expectedLen) {
    throw new Error(`Invalid bytes length: expected ${expectedLen}, got ${out.length}`);
  }
  return out;
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
      a: ensureBytes(pi_a, 64),
      b: ensureBytes(pi_b, 128),
      c: ensureBytes(pi_c, 64)
    },
    vk: {
      alpha: ensureBytes(payload.vk.alpha, 64),
      beta: ensureBytes(payload.vk.beta, 128),
      gamma: ensureBytes(payload.vk.gamma, 128),
      delta: ensureBytes(payload.vk.delta, 128),
      ic: payload.vk.ic.map((x) => ensureBytes(x, 64))
    },
    pubSignals: payload.pub_signals.map((x) => ensureBytes(x, 32))
  };
}

/**
 * Build xdr.ScVal for Groth16 proof (map: a, b, c -> bytes). Contract expects ScVal, not plain objects.
 */
function proofToScVal(proof, xdr) {
  return sortedScMap(
    [
      { key: 'a', val: xdr.ScVal.scvBytes(ensureBytes(proof.a, 64)) },
      { key: 'b', val: xdr.ScVal.scvBytes(ensureBytes(proof.b, 128)) },
      { key: 'c', val: xdr.ScVal.scvBytes(ensureBytes(proof.c, 64)) }
    ],
    xdr
  );
}

/**
 * Build xdr.ScVal for verification key (map: alpha, beta, delta, gamma, ic). Keys sorted for Soroban. ic is vec of bytes.
 */
function vkToScVal(vk, xdr) {
  const icVec = xdr.ScVal.scvVec(vk.ic.map((b) => xdr.ScVal.scvBytes(ensureBytes(b, 64))));
  return sortedScMap(
    [
      { key: 'alpha', val: xdr.ScVal.scvBytes(ensureBytes(vk.alpha, 64)) },
      { key: 'beta', val: xdr.ScVal.scvBytes(ensureBytes(vk.beta, 128)) },
      { key: 'delta', val: xdr.ScVal.scvBytes(ensureBytes(vk.delta, 128)) },
      { key: 'gamma', val: xdr.ScVal.scvBytes(ensureBytes(vk.gamma, 128)) },
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
  return xdr.ScVal.scvVec(
    pubSignals.map((signal) => {
      // Ensure 32-byte padding. If it's a decimal-string signal, convert via BigInt -> hex.
      if (typeof signal === 'string' && /^\d+$/.test(signal.trim())) {
        const hex = BigInt(signal.trim()).toString(16).padStart(64, '0');
        // Buffer isn't guaranteed in the browser; use Uint8Array path.
        const bytes = ensureBytes(hex, 32);
        return xdr.ScVal.scvBytes(bytes);
      }
      return xdr.ScVal.scvBytes(ensureBytes(signal, 32));
    })
  );
}

function hexToFieldDecimal(hexLike) {
  const h = String(hexLike || '').replace(/^0x/i, '') || '0';
  return BigInt('0x' + h).toString(10);
}

function normalizeRunHashParts(payload) {
  const hiRaw = String(payload?.run_hash_hi || '').replace(/^0x/i, '').toLowerCase();
  const loRaw = String(payload?.run_hash_lo || '').replace(/^0x/i, '').toLowerCase();

  let hash64;
  if (hiRaw.length === 64 && loRaw.length === 0) {
    // Common case from frontend: full 32-byte hash provided in run_hash_hi only.
    hash64 = hiRaw;
  } else if (hiRaw.length === 32 && loRaw.length === 32) {
    hash64 = hiRaw + loRaw;
  } else {
    const merged = (hiRaw + loRaw).replace(/[^0-9a-f]/g, '');
    hash64 = merged.padStart(64, '0').slice(-64);
  }

  return {
    fullHex64: hash64,
    hiHex32: hash64.slice(0, 32),
    loHex32: hash64.slice(32, 64)
  };
}

function computeSafeNoirHashInputs(payload) {
  const { fullHex64, hiHex32, loHex32 } = normalizeRunHashParts(payload);
  const maxU128 = (1n << 128n) - 1n;

  const rawHi = BigInt('0x' + hiHex32);
  const rawLo = BigInt('0x' + loHex32);

  const nonce = BigInt(payload?.nonce || 0);
  const score = BigInt(payload?.score || 0);
  const wave = BigInt(payload?.wave || 0);
  const season = BigInt(payload?.season_id != null ? payload.season_id : 1);
  const weapon = BigInt(payload?.used_zk_weapon || 0);
  const reserve = nonce + score + wave + season + weapon;
  const safeLimit = maxU128 > reserve ? maxU128 - reserve : 0n;

  if (rawHi + rawLo <= safeLimit) {
    return {
      runHashHiDec: rawHi.toString(10),
      runHashLoDec: rawLo.toString(10)
    };
  }

  // Circuit uses u128 additions; fold into a guaranteed-safe representation (proof remains valid).
  const folded = BigInt('0x' + fullHex64) % (safeLimit + 1n);
  if (typeof console !== 'undefined' && console.debug) {
    console.debug('[Noir] Folding run_hash to fit u128 in circuit (expected when hash is large)', { safeLimit: safeLimit.toString(10) });
  }
  return {
    runHashHiDec: folded.toString(10),
    runHashLoDec: '0'
  };
}

function validateNoirSubmitPayload(payload) {
  const score = Number(payload?.score || 0);
  const wave = Number(payload?.wave || 0);
  if (!Number.isFinite(score) || !Number.isFinite(wave) || score <= 0 || wave <= 0) {
    throw new Error(`[submit_zk_noir] invalid payload: score=${payload?.score} wave=${payload?.wave}`);
  }
  const MIN_SCORE_PER_WAVE = 5;
  const minScore = wave * MIN_SCORE_PER_WAVE;
  if (score < minScore) {
    throw new Error(`[submit_zk_noir] invalid score: score=${score} wave=${wave} requires score>=${minScore} (min ${MIN_SCORE_PER_WAVE} per wave)`);
  }
}

/** Clamp to u32 range for Noir (0 .. 2^32-1). */
function toU32Safe(v) {
  const n = BigInt(v ?? 0);
  if (n <= 0n) return '0';
  const max = (1n << 32n) - 1n;
  return (n > max ? max : n).toString(10);
}

/** Clamp to u64 range for Noir. */
function toU64Safe(v) {
  const n = BigInt(v ?? 0);
  if (n < 0n) return '0';
  const max = (1n << 64n) - 1n;
  return (n > max ? max : n).toString(10);
}

/** Circuit expects u1 (0 or 1 only); any other value causes "Cannot satisfy constraint". */
function toU1Safe(v) {
  return (v && Number(v) !== 0) ? '1' : '0';
}

function noirInputsFromPayload(payload) {
  const { runHashHiDec, runHashLoDec } = computeSafeNoirHashInputs(payload);
  return {
    run_hash_hi: runHashHiDec,
    run_hash_lo: runHashLoDec,
    score: toU32Safe(payload.score),
    wave: toU32Safe(payload.wave),
    nonce: toU64Safe(payload.nonce),
    season_id: toU32Safe(payload.season_id != null ? payload.season_id : 1),
    used_zk_weapon: toU1Safe(payload.used_zk_weapon)
  };
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
 * Requires snarkjs loaded and circuit artifacts in public/circuits/build/
 * 
 * @param {{ run_hash_hi: string, run_hash_lo: string, score: number, wave: number, nonce: number, season_id?: number, used_zk_weapon?: number }} payload
 * @returns {Promise<{ proof: object, vk: object, pub_signals: string[] }>}
 */
export async function generateLocalProof(payload) {
  // Dynamically import snarkjs for browser
  const snarkjs = await import('snarkjs');
  
  // Circuit artifacts paths (use asset base for GitHub Pages deploy)
  const wasmPath = getAssetPath('circuits/build/GameRun_js/GameRun.wasm');
  const zkeyPath = getAssetPath('circuits/build/GameRun_final.zkey');
  const vkeyPath = getAssetPath('circuits/build/GameRun_vkey.json');
  
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
  validateNoirSubmitPayload(payload);
  console.log('[Trustless] Generating Noir + UltraHonk proof in browser...');
  const noir = new NoirService();
  const { proofBlob } = await noir.generateProof('GameRun', noirInputsFromPayload(payload));
  const { fullHex64 } = normalizeRunHashParts(payload);

  // Submit to contract: verifier uses stored VK (no vk_json in tx to avoid size limit)
  const contractId = getContractId();
  if (!contractId) throw new Error('Contract ID not configured');
  
  const { xdr, Address } = await import('@stellar/stellar-sdk');

  const args = [
    new Address(signerPublicKey).toScVal(),
    xdr.ScVal.scvBytes(proofBlob),
    u64ToScVal(xdr, payload.nonce),
    xdr.ScVal.scvBytes(hexToBytes(fullHex64)),
    xdr.ScVal.scvU32(payload.season_id || 1),
    xdr.ScVal.scvU32(payload.score),
    xdr.ScVal.scvU32(payload.wave)
  ];
  
  console.log('[Trustless] Submitting Noir proof to contract...');
  return invoke(contractId, 'submit_zk_noir', args, signerPublicKey, signTransaction);
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
  validateNoirSubmitPayload(payload);
  const noir = new NoirService();
  const { proofBlob } = await noir.generateProof('GameRun', noirInputsFromPayload(payload));
  const { fullHex64 } = normalizeRunHashParts(payload);
  const contractId = getContractId();
  if (!contractId) throw new Error('Cosmic Coder contract not configured');
  const { xdr, Address } = await import('@stellar/stellar-sdk');

  const args = [
    new Address(signerPublicKey).toScVal(),
    xdr.ScVal.scvBytes(proofBlob),
    u64ToScVal(xdr, payload.nonce),
    xdr.ScVal.scvBytes(hexToBytes(fullHex64)),
    xdr.ScVal.scvU32(payload.season_id != null ? payload.season_id : 1),
    xdr.ScVal.scvU32(payload.score),
    xdr.ScVal.scvU32(payload.wave)
  ];
  return invoke(contractId, 'submit_zk_noir', args, signerPublicKey, signTransaction);
}

/**
 * Get leaderboard (read-only). Returns [] if contract not configured or on error.
 */
export async function getLeaderboard(limit = 10) {
  const contractId = getContractId();
  if (!contractId || !isContractIdValid(contractId)) return [];
  try {
    const {
      Contract,
      TransactionBuilder,
      Account,
      BASE_FEE,
      xdr,
    } = await import('@stellar/stellar-sdk');
    const server = await getServer();
    const contract = new Contract(contractId);
    const dummyAccount = new Account(
      'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      '0'
    );
    const built = new TransactionBuilder(dummyAccount, {
      fee: BASE_FEE,
      networkPassphrase: TESTNET_PASSPHRASE,
    })
      .addOperation(contract.call('get_leaderboard', xdr.ScVal.scvU32(limit)))
      .setTimeout(TX_VALIDITY_SECONDS)
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
  const contractId = getContractId();
  if (!contractId || !isContractIdValid(contractId)) return [];
  try {
    const {
      Contract,
      TransactionBuilder,
      Account,
      BASE_FEE,
      xdr,
      Address,
    } = await import('@stellar/stellar-sdk');
    const { scValToNative } = await import('@stellar/stellar-base');
    const server = await getServer();
    const contract = new Contract(contractId);
    const dummyAccount = new Account(
      'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      '0'
    );
    const built = new TransactionBuilder(dummyAccount, {
      fee: BASE_FEE,
      networkPassphrase: TESTNET_PASSPHRASE,
    })
      .addOperation(contract.call('get_leaderboard_by_season', xdr.ScVal.scvU32(seasonId), xdr.ScVal.scvU32(limit)))
      .setTimeout(TX_VALIDITY_SECONDS)
      .build();
    const sim = await server.simulateTransaction(built);
    if (sim.error) {
      console.warn('[Cosmic Coder] get_leaderboard_by_season simulate error:', sim.error);
      return [];
    }
    const retval = sim.result?.retval;
    if (!retval) return [];

    try {
      const native = scValToNative(retval);
      if (Array.isArray(native) && native.length > 0) {
        const out = [];
        for (const entry of native) {
          try {
            const o = entry && typeof entry === 'object' ? entry : {};
            let player = '';
            if (typeof o.player === 'string') player = o.player;
            else if (o.player != null && typeof o.player === 'object') player = String(o.player);
            let score = 0;
            const raw = o.score ?? o.best_score;
            if (typeof raw === 'number' && !Number.isNaN(raw)) score = Math.max(0, raw);
            else if (typeof raw === 'bigint') score = Math.max(0, Number(raw));
            else if (raw != null) score = Math.max(0, Number(raw));
            const wave = Number(o.wave) || 0;
            out.push({ player, wave, score });
          } catch (_) {}
        }
        out.sort((a, b) => (b.score - a.score) || 0);
        return out;
      }
      if (Array.isArray(native)) return [];
    } catch (nativeErr) {
      console.warn('[Cosmic Coder] getLeaderboardBySeason decode:', nativeErr?.message || nativeErr);
    }

    // Fallback: manual XDR parsing (ScVal vec -> map entries)
    if (retval.switch().name !== 'vec') return [];
    const vecOpt = retval.vec();
    const arr = vecOpt && (typeof vecOpt.length === 'number' ? vecOpt : Array.from(vecOpt || []));
    if (!arr || !arr.length) return [];
    const out = [];
    for (let i = 0; i < arr.length; i++) {
      const entry = arr[i];
      if (!entry || entry.switch?.()?.name !== 'map') continue;
      const m = entry.map?.() ?? [];
      if (!m.length) continue;
      let player = '';
      let score = 0;
      let wave = 0;
      for (let j = 0; j < m.length; j++) {
        const pair = m[j];
        const key = pair.key?.() ?? pair.key;
        const val = pair.val?.() ?? pair.val;
        const k = (key?.sym?.() ?? key)?.toString?.() ?? '';
        if (k === 'player') {
          try {
            if (val && Address && typeof Address.fromScVal === 'function') {
              player = Address.fromScVal(val).toString();
            }
          } catch (_) {}
        }
        if (k === 'score') {
          try {
            if (val && typeof val.u32 === 'function') score = val.u32();
            else if (val && typeof val.i128 === 'function') score = Number(val.i128().toString());
            else score = Math.max(0, Number(val?.toString?.() ?? val ?? 0));
          } catch (_) {}
        }
        if (k === 'wave') {
          try {
            wave = val && typeof val.u32 === 'function' ? val.u32() : Math.max(0, Number(val ?? 0));
          } catch (_) {}
        }
      }
      out.push({ player, wave, score });
    }
    out.sort((a, b) => (b.score - a.score) || (b.wave - a.wave) || 0);
    return out;
  } catch (e) {
    const msg = e?.message || String(e);
    if (msg && !/accountId is invalid|invalid.*contract/i.test(msg)) {
      console.warn('[Cosmic Coder] getLeaderboardBySeason failed:', msg);
    }
    return [];
  }
}

/**
 * Get player's verified milestone tier for a season.
 * Returns { tier, bestWave } with zeros if missing/unavailable.
 */
export async function getPlayerMilestone(playerAddress, seasonId = 1) {
  if (!getContractId() || !playerAddress) return { tier: 0, bestWave: 0 };
  try {
    const {
      Contract,
      TransactionBuilder,
      Account,
      BASE_FEE,
      xdr,
      Address,
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
      .addOperation(
        contract.call(
          'get_player_milestone',
          new Address(playerAddress).toScVal(),
          xdr.ScVal.scvU32(seasonId)
        )
      )
      .setTimeout(TX_VALIDITY_SECONDS)
      .build();
    const sim = await server.simulateTransaction(built);
    if (sim.error) return { tier: 0, bestWave: 0 };
    const rv = sim.result?.retval;
    if (!rv || rv.switch().name !== 'map') return { tier: 0, bestWave: 0 };
    const m = rv.map();
    let tier = 0;
    let bestWave = 0;
    for (let i = 0; i < m.length; i++) {
      const k = m[i].key().sym().toString();
      const v = m[i].val();
      if (k === 'tier') tier = v.u32();
      if (k === 'best_wave') bestWave = v.u32();
    }
    return { tier, bestWave };
  } catch (_) {
    return { tier: 0, bestWave: 0 };
  }
}

export function isContractConfigured() {
  return isContractIdValid(getContractId());
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
