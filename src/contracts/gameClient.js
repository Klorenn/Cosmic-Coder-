/**
 * Cosmic Coder - Soroban game contract client.
 * Calls start_match(), submit_result(wave, score), submit_zk(...), get_leaderboard(limit).
 * Contract calls that return Result<_, CosmicCoderError> fail the tx on Err: invoke() throws a typed
 * ContractError (see contractErrors.js) with `.code` / `.errorName` / `.i18nKey`.
 * Requires Stellar Wallets Kit for signing.
 * @see https://github.com/jamesbachini/Stellar-Game-Studio
 */

import { StrKey, scValToNative } from '@stellar/stellar-sdk';
import { NoirService } from '../services/NoirService.js';
import { getAssetPath } from '../utils/assetBase.js';
import { getFreighterNetwork } from '../utils/stellarWallet.js';
import { getZkProverUrl as getRuntimeZkProverUrl } from '../config/runtime.js';
import { logger } from '../utils/log.js';
import { assertValidSubmit, normalizeTxResult, toContractError, ContractError } from './contractErrors.js';
import { buildRunWitness } from '../zk/gameProof.js';

const TESTNET_RPC = 'https://soroban-testnet.stellar.org';
/** Source account for read-only simulations (all-zero ed25519 key; must be a valid StrKey, it never signs). */
export const SIM_SOURCE_ACCOUNT = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
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

/** Ranked ZK backend: 'groth16' (default, submit_zk) or 'noir' (legacy submit_zk_noir, stub verifier). */
export function getZkBackend() {
  const v = typeof window !== 'undefined' ? window.__VITE_CONFIG__?.VITE_ZK_BACKEND : undefined;
  return v === 'noir' ? 'noir' : 'groth16';
}

/**
 * Ranked Groth16 circuit: 'v3' (default; GameRunV3, private seed/kills/events_hash, run_hash = Poseidon commitment)
 * or 'v1' (legacy GameRun, no private witness). Must match the VK the deploy pinned with set_run_vk.
 */
export function getZkCircuit() {
  const v = typeof window !== 'undefined' ? window.__VITE_CONFIG__?.VITE_ZK_CIRCUIT : undefined;
  return v === 'v1' ? 'v1' : 'v3';
}

/** V3 needs the private witness in the payload (seed + kills); without it the run can only be proven with V1. */
function usesV3(payload) {
  return getZkCircuit() === 'v3' && payload?.seed != null && payload?.kills != null;
}

function v3WitnessFromPayload(payload) {
  return buildRunWitness({
    score: payload.score,
    wave: payload.wave,
    kills: payload.kills,
    seed: payload.seed,
    nonce: payload.nonce,
    season: payload.season_id != null ? payload.season_id : 1,
    events: payload.events,
    eventsHash: payload.events_hash,
    usedZkWeapon: payload.used_zk_weapon
  });
}

/**
 * Whether ranked runs are verified on-chain. Groth16 backend: true when a cosmic_coder contract is configured
 * (the BN254 pairing check runs in submit_zk; it only holds if that deploy pinned the VK with set_run_vk).
 * Noir backend: the bundled UltraHonk verifier is a structural stub, so only an explicit
 * VITE_RANKED_VERIFIED="true" (real verifier wired by ops) counts.
 */
export function isRankedVerified() {
  if (getZkBackend() === 'groth16') return String(getContractId() || '').trim() !== '';
  return typeof window !== 'undefined' && window.__VITE_CONFIG__?.VITE_RANKED_VERIFIED === 'true';
}

/** Base URL for ZK prover backend (config.json > env > localhost default). */
export function getZkProverUrl() {
  return getRuntimeZkProverUrl();
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
export async function invoke(contractId, method, args, publicKey, signTransaction) {
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
  const contract = new Contract(contractId);
  const op = contract.call(method, ...args);

  const buildSignSend = async () => {
    const source = await server.getAccount(publicKey);
    const account = new Account(publicKey, String(source.sequence ?? '0'));
    const built = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: TESTNET_PASSPHRASE,
    })
      .addOperation(op)
      .setTimeout(TX_VALIDITY_SECONDS)
      .build();
    const sim = await server.simulateTransaction(built);
    if (sim?.error) {
      // Contract errors (Error(Contract, #N)) surface here as ContractError; no fee is spent on simulation.
      throw toContractError(new Error(
        `[simulate:${method}] ${sim.error}\n` +
        `result=${safeJson(sim.result)}\n` +
        `events=${safeJson(sim.events)}`
      ));
    }
    const prepared = await server.prepareTransaction(built);
    const signedXdr = await signTransaction(prepared.toXDR(), TESTNET_PASSPHRASE);
    const tx = TransactionBuilder.fromXDR(signedXdr, TESTNET_PASSPHRASE);
    return server.sendTransaction(tx);
  };

  const throwError = async (result, authHint, seqHint) => {
    let decoded = '';
    if (result.errorResultXdr) {
      try {
        const tr = xdr.TransactionResult.fromXDR(result.errorResultXdr, 'base64');
        decoded = ` txResult=${tr.result().switch().name}`;
      } catch (e) {
        logger.debug('[send] could not decode txResult XDR:', e?.message || e);
      }
    }
    const baseMsg =
      `[send:${method}] status=ERROR` +
      decoded +
      ` hash=${result.hash || 'n/a'}\n` +
      `rpc_result=${safeJson(result)}` +
      authHint +
      seqHint;
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
          authHint +
          seqHint
        );
      }
    }
    throw new Error(baseMsg);
  };

  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await buildSignSend();

    if (result.status === 'PENDING' && result.hash) {
      const txInfo = await waitForTx(server, result.hash, 20, 1000);
      const finalStatus = String(txInfo?.status || '').toUpperCase();
      if (finalStatus === 'SUCCESS') return txInfo;
      throw toContractError(new Error(
        `[send:${method}] status=PENDING->${finalStatus || 'UNKNOWN'} hash=${result.hash}\n` +
        `rpc_result=${safeJson(result)}\n` +
        `tx_info=${safeJson(txInfo)}`
      ));
    }

    if (result.status === 'ERROR') {
      const errSwitch = result.errorResult?.result?._switch ?? result.errorResult?._attributes?.result?._switch;
      const isBadAuth = errSwitch?.name === 'txBadAuth' || String(safeJson(result)).includes('txBadAuth');
      const isBadSeq = errSwitch?.name === 'txBadSeq' || String(safeJson(result)).includes('txBadSeq');
      const authHint = isBadAuth
        ? '\n\n[Cosmic Coder] txBadAuth: Make sure Freighter is set to **Stellar Testnet** (not Mainnet) and the connected account is the one signing.'
        : '';
      const seqHint = isBadSeq
        ? '\n\n[Cosmic Coder] txBadSeq: Sequence number expired (e.g. another tx was sent). Please try submitting again.'
        : '';
      if (isBadSeq && attempt === 0) {
        logger.warn('[Cosmic Coder] txBadSeq on first attempt; retrying once with fresh sequence (you may need to sign again in Freighter).');
        continue;
      }
      await throwError(result, authHint, seqHint);
    }

    // DUPLICATE / TRY_AGAIN_LATER: the tx was not accepted, never report it as success.
    throw new Error(`[send:${method}] unexpected status=${result.status} hash=${result.hash || 'n/a'}`);
  }

  throw new Error(`[send:${method}] unexpected: no result after retry`);
}

/**
 * Build player ScVal from signer public key (G...). Contract expects player address and require_auth(player).
 */
async function playerScVal(signerPublicKey) {
  const { Address } = await import('@stellar/stellar-sdk');
  return new Address(signerPublicKey).toScVal();
}

/** Decode a ScVal return value to a native JS value (u32 -> number, Option -> value|null, () -> undefined). */
async function decodeReturn(scVal) {
  const { scValToNative } = await import('@stellar/stellar-sdk');
  return scValToNative(scVal);
}

/** Confirmed tx -> `{ ok: true, txHash, status, value, ...txInfo }`. Failures never reach here: invoke() throws. */
async function finalizeTx(txInfo) {
  let native;
  if (txInfo?.returnValue != null) {
    try { native = await decodeReturn(txInfo.returnValue); } catch (e) { logger.debug('[finalizeTx] return decode failed:', e?.message || e); }
  }
  return normalizeTxResult(txInfo, () => native);
}

/**
 * Start a match: start_match(player) -> Result<u32, CosmicCoderError>. Requires wallet sign.
 * @returns {Promise<{ ok: true, sessionId: number|undefined, txHash: string }>}
 * @throws {ContractError} e.g. #101 GameHubCrash
 */
export async function startMatch(signerPublicKey, signTransaction) {
  const contractId = getContractId();
  if (!contractId) throw new Error('VITE_COSMIC_CODER_CONTRACT_ID not set');
  const r = await finalizeTx(
    await invoke(contractId, 'start_match', [await playerScVal(signerPublicKey)], signerPublicKey, signTransaction)
  );
  return { ...r, sessionId: typeof r.value === 'number' ? r.value : undefined };
}

/**
 * Casual result: submit_result(player, wave, score) -> Result<(), CosmicCoderError>. Requires wallet sign.
 * Success = tx confirmed (`{ ok: true, txHash }`). Failure throws ContractError (#10 ScoreBelowMinimum, #11 NegativeScore, ...);
 * invalid values are rejected locally before simulating, so no fee is spent.
 */
export async function submitResult(signerPublicKey, signTransaction, wave, score) {
  const contractId = getContractId();
  if (!contractId) throw new Error('VITE_COSMIC_CODER_CONTRACT_ID not set');
  // Scenes may hand over fractional scores; the contract takes an integer i128.
  if (typeof score === 'number' && Number.isFinite(score)) score = Math.floor(score);
  assertValidSubmit({ wave, score });
  const { xdr, ScInt } = await import('@stellar/stellar-sdk');
  const args = [
    await playerScVal(signerPublicKey),
    xdr.ScVal.scvU32(wave),
    new ScInt(BigInt(score), { type: 'i128' }).toI128(),
  ];
  return finalizeTx(await invoke(contractId, 'submit_result', args, signerPublicKey, signTransaction));
}

/** Read-only simulation of a view method. Returns the native value, or `fallback` on any failure. */
async function simulateRead(method, scArgs, fallback) {
  const contractId = getContractId();
  if (!contractId || !isContractIdValid(contractId)) return fallback;
  try {
    const { Contract, TransactionBuilder, Account, BASE_FEE, scValToNative } = await import('@stellar/stellar-sdk');
    const server = await getServer();
    const built = new TransactionBuilder(
      new Account(SIM_SOURCE_ACCOUNT, '0'),
      { fee: BASE_FEE, networkPassphrase: TESTNET_PASSPHRASE }
    )
      .addOperation(new Contract(contractId).call(method, ...scArgs))
      .setTimeout(TX_VALIDITY_SECONDS)
      .build();
    const sim = await server.simulateTransaction(built);
    if (sim.error || !sim.result?.retval) return fallback;
    return scValToNative(sim.result.retval);
  } catch (e) {
    logger.debug(`[simulateRead:${method}] failed:`, e?.message || e);
    return fallback;
  }
}

/** Open Game Hub session of the player (get_active_session). Returns the session id or null. */
export async function getActiveSession(playerAddress) {
  if (!playerAddress) return null;
  const { Address } = await import('@stellar/stellar-sdk');
  const v = await simulateRead('get_active_session', [new Address(playerAddress).toScVal()], null);
  return typeof v === 'number' ? v : null;
}

/** True if (player, season, nonce) was already consumed by a ranked submit (is_nonce_used). Returns false on read failure. */
export async function isNonceUsed(playerAddress, seasonId, nonce) {
  if (!playerAddress) return false;
  const { Address } = await import('@stellar/stellar-sdk');
  const { xdr } = await import('@stellar/stellar-sdk');
  const v = await simulateRead(
    'is_nonce_used',
    [new Address(playerAddress).toScVal(), xdr.ScVal.scvU32(seasonId), u64ToScVal(xdr, nonce)],
    false
  );
  return v === true;
}

/**
 * Request ZK proof from backend (option B). Backend runs fullprove and returns contract_proof format.
 * V2: includes challenge_id, player_address, contract_id, domain_separator.
 * @param {string} [baseUrl] - Prover server URL (default VITE_ZK_PROVER_URL or localhost default)
 * @param {{ run_hash_hi: string, run_hash_lo: string, score: number, wave: number, nonce: number, season_id?: number, challenge_id?: number, player_address?: string, contract_id?: string, domain_separator?: string }} payload
 * @returns {Promise<{ proof: { a, b, c }, vk: object, pub_signals: string[] }>} hex strings
 */
export async function requestZkProofV2(baseUrl, payload) {
  // submit_zk takes the 7-signal layout: GameRunV3 (/zk/prove_v3) when the payload carries the private witness
  // and VITE_ZK_CIRCUIT is not 'v1', else GameRun (/zk/prove). Never GameRunV2 (12 signals).
  const proverBase = baseUrl || getZkProverUrl();
  const v3 = usesV3(payload);
  const url = String(proverBase).replace(/\/$/, '') + (v3 ? '/zk/prove_v3' : '/zk/prove');
  logger.log('[ZK] Prover URL:', url);
  const body = v3
    ? await v3WitnessFromPayload(payload)
    : {
      // /zk/prove expects a 64-hex run_hash; use first 64 chars from run_hash_hi.
      run_hash_hex: String(payload.run_hash_hi || '').slice(0, 64),
      score: payload.score,
      wave: payload.wave,
      nonce: payload.nonce != null ? payload.nonce.toString() : payload.nonce,
      season_id: payload.season_id != null ? payload.season_id : 1,
      used_zk_weapon: payload.used_zk_weapon != null ? payload.used_zk_weapon : 0
    };
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
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

/** BN254 field element (decimal string / number / bigint) -> 32-byte big-endian hex (64 chars). */
function fieldToHex32(v) {
  const s = typeof v === 'bigint' ? v.toString() : String(v).trim();
  if (!/^[0-9]+$/.test(s)) throw new Error(`Expected decimal field element, got "${s}"`);
  const n = BigInt(s);
  if (n >= 1n << 256n) throw new Error(`Field element does not fit in 32 bytes: ${s}`);
  return n.toString(16).padStart(64, '0');
}

const g1ToHex = (pt) => fieldToHex32(pt[0]) + fieldToHex32(pt[1]);
/** G2 limbs already in contract order: [[x_c1, x_c0], [y_c1, y_c0]] -> x_c1||x_c0||y_c1||y_c0. */
const g2OrderedToHex = (pt) => fieldToHex32(pt[0][0]) + fieldToHex32(pt[0][1]) + fieldToHex32(pt[1][0]) + fieldToHex32(pt[1][1]);
/** Raw snarkjs G2 [[x_c0, x_c1], [y_c0, y_c1], ...] -> contract order (same as scripts/zk/export_for_contract.js). */
const g2SnarkjsToHex = (pt) => g2OrderedToHex([[pt[0][1], pt[0][0]], [pt[1][1], pt[1][0]]]);

/**
 * Convert a snarkjs Groth16 proof (decimal strings) to the contract-ready hex payload accepted by
 * contractProofToZk: G1 = x||y (64 B), G2 = x_c1||x_c0||y_c1||y_c0 (128 B), signals = 32-byte big-endian.
 * Accepts the raw snarkjs layout (`pi_a/pi_b/pi_c`, `vk_alpha_1/...`, G2 limbs swapped here) and the legacy
 * prover layout (`a/b/c`, `alpha/beta/...` arrays whose G2 limbs are already swapped).
 * @param {object} proof
 * @param {Array<string|number|bigint>} pubSignals decimal public signals
 * @param {object} [vk] snarkjs vkey or legacy mapped vk; omitted -> result has no vk
 * @returns {{ proof: { a: string, b: string, c: string }, vk?: object, pub_signals: string[] }}
 */
export function snarkjsToContractProof(proof, pubSignals, vk) {
  if (!proof || !Array.isArray(pubSignals)) throw new Error('snarkjsToContractProof: proof and pubSignals required');
  const raw = Array.isArray(proof.pi_a);
  const g2 = raw ? g2SnarkjsToHex : g2OrderedToHex;
  const out = {
    proof: {
      a: g1ToHex(raw ? proof.pi_a : proof.a),
      b: g2(raw ? proof.pi_b : proof.b),
      c: g1ToHex(raw ? proof.pi_c : proof.c)
    },
    pub_signals: pubSignals.map(fieldToHex32)
  };
  if (vk) {
    const rawVk = Array.isArray(vk.vk_alpha_1);
    const vg2 = rawVk ? g2SnarkjsToHex : g2OrderedToHex;
    out.vk = {
      alpha: g1ToHex(rawVk ? vk.vk_alpha_1 : vk.alpha),
      beta: vg2(rawVk ? vk.vk_beta_2 : vk.beta),
      gamma: vg2(rawVk ? vk.vk_gamma_2 : vk.gamma),
      delta: vg2(rawVk ? vk.vk_delta_2 : vk.delta),
      ic: (rawVk ? vk.IC : vk.ic).map(g1ToHex)
    };
  }
  return out;
}

/**
 * Convert contract_proof.json payload (hex or raw) to zk object for submitZk (always Uint8Array).
 * Works in browser (Uint8Array) and Node (Buffer). Tolerates API returning arrays/objects.
 */
export function contractProofToZk(payload) {
  if (!payload || !payload.proof) {
    throw new Error('Invalid proof format received from prover: missing proof object');
  }
  
  // Handle proof formats:
  // - snarkjs raw: pi_a/pi_b/pi_c
  // - legacy mapped: alpha/beta/gamma
  // - contract-ready: a/b/c
  const pi_a = payload.proof.pi_a || payload.proof.alpha || payload.proof.a;
  const pi_b = payload.proof.pi_b || payload.proof.beta || payload.proof.b;
  const pi_c = payload.proof.pi_c || payload.proof.gamma || payload.proof.c;
  
  // Validate required proof fields
  if (!pi_a || !pi_b || !pi_c) {
    logger.error('[contractProofToZk] Missing proof fields:', { pi_a, pi_b, pi_c });
    throw new Error('Invalid proof format received from prover: missing proof fields (expected one of pi_a/pi_b/pi_c, alpha/beta/gamma, or a/b/c)');
  }
  
  // Handle missing vk - backend might not include it
  if (!payload.vk) {
    logger.warn('[contractProofToZk] ⚠️ payload.vk is undefined - backend might not include vk');
    // For now, we'll have to skip ZK submission if vk is missing
    throw new Error('Verification key (vk) not included in prover response. Backend needs to include vk in the response.');
  }
  
  // Validate verification key fields
  if (!payload.vk.alpha || !payload.vk.beta || !payload.vk.gamma || !payload.vk.delta) {
    logger.error('[contractProofToZk] Missing vk fields:', {
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
export function proofToScVal(proof, xdr) {
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
export function vkToScVal(vk, xdr) {
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
export function pubSignalsToScVal(pubSignals, xdr) {
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
  logger.debug('[Noir] Folding run_hash to fit u128 in circuit (expected when hash is large)', { safeLimit: safeLimit.toString(10) });
  return {
    runHashHiDec: folded.toString(10),
    runHashLoDec: '0'
  };
}

/** Highest wave accepted for a ranked Noir submit (sanity cap; no real run gets close). */
export const MAX_RANKED_WAVE = 10000;
const U32_MAX = 4294967295;

/**
 * Local mirror of the contract's ranked checks (#5 InvalidInput, #10 ScoreBelowMinimum): fails before proving/simulating.
 * Rejects fractional scores (toU32Safe would silently truncate them), score > u32 and wave > MAX_RANKED_WAVE.
 */
export function validateNoirSubmitPayload(payload) {
  const score = Number(payload?.score);
  const wave = Number(payload?.wave);
  if (!Number.isInteger(score)) throw new ContractError(`[local-validation] InvalidInput: score must be an integer, got ${String(payload?.score)}`, 5);
  if (score > U32_MAX) throw new ContractError(`[local-validation] InvalidInput: score ${score} exceeds u32`, 5);
  if (Number.isFinite(wave) && wave > MAX_RANKED_WAVE) throw new ContractError(`[local-validation] InvalidInput: wave ${wave} > ${MAX_RANKED_WAVE}`, 5);
  assertValidSubmit({ wave, score, ranked: true });
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
      logger.warn('[submit_zk] nonce is not a safe JS integer; pass nonce as string or BigInt for exactness:', value);
    }
    return xdr.ScVal.scvU64(xdr.Uint64.fromString(String(Math.floor(value))));
  }
  // Fallback: try to stringify (works for e.g. { toString() }).
  return xdr.ScVal.scvU64(xdr.Uint64.fromString(String(value)));
}

/** Helper: convert hex string to Uint8Array (32 bytes) */
function hexToBytes(hex) {
  const h = String(hex).replace(/^0x/, '').slice(0, 64).padStart(64, '0');
  const arr = new Uint8Array(32);
  for (let i = 0; i < 32; i++) arr[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return arr;
}

/**
 * TRUSTLESS LOCAL PROVER (like xray-games)
 * Generate ZK proof locally in browser without server dependency.
 * Requires snarkjs loaded and circuit artifacts in public/circuits/build/
 * 
 * @param {{ run_hash_hi: string, run_hash_lo: string, score: number, wave: number, nonce: number, season_id?: number, used_zk_weapon?: number }} payload
 * @returns {Promise<{ proof: object, vk: object, pub_signals: string[] }>}
 */
export async function generateLocalProof(payload) {
  validateNoirSubmitPayload(payload);
  const snarkjs = await import('snarkjs');

  if (usesV3(payload)) {
    const vkRes = await fetch(getAssetPath('circuits/build/GameRunV3_vkey.json'));
    if (vkRes?.ok) {
      // run_hash is the circuit's Poseidon commitment: read it back from public signals 0 (hi) and 1 (lo).
      const input = await v3WitnessFromPayload(payload);
      const { proof, publicSignals } = await snarkjs.groth16.fullProve(
        input,
        getAssetPath('circuits/build/GameRunV3_js/GameRunV3.wasm'),
        getAssetPath('circuits/build/GameRunV3_final.zkey')
      );
      const contractProof = snarkjsToContractProof(proof, publicSignals, await vkRes.json());
      return { ...contractProof, run_hash_hex: contractProof.pub_signals[0].slice(32) + contractProof.pub_signals[1].slice(32), circuit: 'v3' };
    }
    logger.warn('[LocalProver] GameRunV3 artifacts missing, falling back to GameRun (v1)');
  }

  // Same artifacts (and VK) as the server prover and the set_run_vk deploy step.
  const wasmPath = getAssetPath('circuits/build/GameRun_js/GameRun.wasm');
  const zkeyPath = getAssetPath('circuits/build/GameRun_final.zkey');
  const vkeyPath = getAssetPath('circuits/build/GameRun_vkey.json');

  // run_hash is 32 bytes of hex; submit_zk binds signal[0] = run_hash[0..16], signal[1] = run_hash[16..32].
  const { fullHex64, hiHex32, loHex32 } = normalizeRunHashParts(payload);
  const input = {
    run_hash_hi: hexToFieldDecimal(hiHex32),
    run_hash_lo: hexToFieldDecimal(loHex32),
    score: String(payload.score),
    wave: String(payload.wave),
    nonce: BigInt(payload.nonce).toString(),
    season_id: String(payload.season_id != null ? payload.season_id : 1),
    used_zk_weapon: toU1Safe(payload.used_zk_weapon)
  };

  logger.log('[LocalProver] Generating proof with input:', input);
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, wasmPath, zkeyPath);
  const vk = await (await fetch(vkeyPath)).json();
  const contractProof = snarkjsToContractProof(proof, publicSignals, vk);
  logger.log('[LocalProver] Proof generated successfully');
  return { ...contractProof, run_hash_hex: fullHex64 };
}

/** Max time the in-browser Groth16 prover may take before falling back to the prover server. */
export const ZK_LOCAL_TIMEOUT_MS = 20000;
const RUN_PUBLIC_SIGNALS = 7;

const withTimeout = (promise, ms) => {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`local prover timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
};

/**
 * Normalise a local/prover result to contractProofToZk's input and check that the public signals bind the
 * claimed run exactly like submit_zk does ([hash_hi, hash_lo, score, wave, nonce, season, used_zk_weapon]).
 * Anything else throws ContractError #9 SignalMismatch before a fee is spent (never trust a remote prover blindly).
 */
function toBoundZk(result, payload, fullHex64) {
  const snarkjsLayout = Array.isArray(result?.proof?.a) || Array.isArray(result?.proof?.pi_a);
  const zk = contractProofToZk(snarkjsLayout ? snarkjsToContractProof(result.proof, result.pub_signals, result.vk) : result);
  const hex = (u8) => Array.from(u8, (b) => b.toString(16).padStart(2, '0')).join('');
  const sig = zk.pubSignals.map((u8) => BigInt('0x' + hex(u8)));
  const mismatch = () => new ContractError('[local-validation] SignalMismatch: proof public signals do not match the claimed run', 9);
  if (sig.length !== RUN_PUBLIC_SIGNALS) throw mismatch();
  // V3: run_hash is the in-circuit Poseidon commitment, so it comes from the proof (signals 0/1, 128-bit limbs)
  // and is returned as zk.runHashHex for the submit_zk run_hash argument.
  const runHashHex = usesV3(payload) && sig[0] < (1n << 128n) && sig[1] < (1n << 128n)
    ? sig[0].toString(16).padStart(32, '0') + sig[1].toString(16).padStart(32, '0')
    : fullHex64;
  const season = BigInt(payload.season_id != null ? payload.season_id : 1);
  const expected = [
    BigInt('0x' + runHashHex.slice(0, 32)), BigInt('0x' + runHashHex.slice(32)),
    BigInt(payload.score), BigInt(payload.wave), BigInt(payload.nonce), season
  ];
  if (expected.some((v, i) => sig[i] !== v) || (result?.run_hash_hex && result.run_hash_hex !== runHashHex)) throw mismatch();
  zk.runHashHex = runHashHex;
  return zk;
}

/**
 * Ranked submit (Groth16): validate -> prove (browser snarkjs, falls back to the prover server on error or
 * after ZK_LOCAL_TIMEOUT_MS) -> submit_zk(player, proof, vk, pub_signals, nonce, run_hash, season_id, score, wave).
 * The contract pins the VK (set_run_vk) and binds the signals to the claim.
 * Failures throw ContractError (#2 Replay, #3 InvalidProof, #7 VkNotSet, #8 VkMismatch, #9 SignalMismatch,
 * #10 ScoreBelowMinimum, #101 GameHubCrash, ...). Needs an open session (startMatch) for the Game Hub end_game.
 * With window.__VITE_CONFIG__.VITE_ZK_BACKEND === 'noir' it uses the legacy Noir path (stub verifier).
 *
 * @param {string} signerPublicKey
 * @param {function} signTransaction
 * @param {{ run_hash_hi: string, run_hash_lo: string, score: number, wave: number, nonce: number|string|bigint, season_id?: number, used_zk_weapon?: number }} payload
 * @param {{ forceProver?: boolean, proverUrl?: string }} [opts]
 * @returns {Promise<{ ok: true, txHash: string }>}
 */
export async function submitZkTrustless(signerPublicKey, signTransaction, payload, opts = {}) {
  validateNoirSubmitPayload(payload);
  const contractId = getContractId();
  if (!contractId) throw new Error('Contract ID not configured');
  if (getZkBackend() === 'noir') return submitZkNoir(contractId, signerPublicKey, signTransaction, payload);

  const { fullHex64 } = normalizeRunHashParts(payload);
  const viaProver = async () =>
    toBoundZk(await requestZkProofV2(opts.proverUrl, { ...payload, run_hash_hi: fullHex64, run_hash_lo: '' }), payload, fullHex64);

  let zk;
  if (opts.forceProver) {
    zk = await viaProver();
  } else {
    try {
      zk = toBoundZk(await withTimeout(generateLocalProof(payload), ZK_LOCAL_TIMEOUT_MS), payload, fullHex64);
    } catch (e) {
      logger.warn('[ZK] local Groth16 proof failed, falling back to prover:', e?.message || e);
      zk = await viaProver();
    }
  }

  const { xdr, Address } = await import('@stellar/stellar-sdk');
  const args = [
    new Address(signerPublicKey).toScVal(),
    proofToScVal(zk.proof, xdr),
    vkToScVal(zk.vk, xdr),
    pubSignalsToScVal(zk.pubSignals, xdr),
    u64ToScVal(xdr, payload.nonce),
    xdr.ScVal.scvBytes(hexToBytes(zk.runHashHex)),
    xdr.ScVal.scvU32(payload.season_id != null ? payload.season_id : 1),
    xdr.ScVal.scvU32(payload.score),
    xdr.ScVal.scvU32(payload.wave)
  ];
  logger.log('[ZK] Submitting Groth16 proof to contract...');
  return finalizeTx(await invoke(contractId, 'submit_zk', args, signerPublicKey, signTransaction));
}

/** Legacy Noir/UltraHonk ranked submit (VITE_ZK_BACKEND=noir): submit_zk_noir needs set_noir_verifier (#16 otherwise). */
async function submitZkNoir(contractId, signerPublicKey, signTransaction, payload) {
  logger.log('[Trustless] Generating Noir + UltraHonk proof in browser...');
  const noir = new NoirService();
  const { proofBlob } = await noir.generateProof('GameRun', noirInputsFromPayload(payload));
  const { fullHex64 } = normalizeRunHashParts(payload);
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

  logger.log('[Trustless] Submitting Noir proof to contract...');
  return finalizeTx(await invoke(contractId, 'submit_zk_noir', args, signerPublicKey, signTransaction));
}

/** Same flow as submitZkTrustless but skips the in-browser prover and uses the prover server (`proverUrl` or config). `vkHash` is ignored: the contract pins the VK. */
export async function submitZkFromProverV2(signerPublicKey, signTransaction, proverUrl, payload, _vkHash) {
  return submitZkTrustless(signerPublicKey, signTransaction, payload, { forceProver: true, proverUrl });
}

/**
 * Decode `get_leaderboard` -> Vec<LeaderboardEntry { player, score: i128, wave: u32 }>.
 * `player` is returned as a G-address string. Returns [] for anything that is not a vec.
 * @param {import('@stellar/stellar-sdk').xdr.ScVal|null|undefined} retval
 * @returns {{ player: string, wave: number, score: number }[]}
 */
export function decodeCasualLeaderboard(retval) {
  if (!retval || typeof retval.switch !== 'function' || retval.switch().name !== 'scvVec') return [];
  const native = scValToNative(retval);
  if (!Array.isArray(native)) return [];
  return native
    .filter((e) => e && typeof e === 'object')
    .map((e) => ({
      player: typeof e.player === 'string' ? e.player : String(e.player ?? ''),
      wave: Number(e.wave) || 0,
      score: Math.max(0, Number(e.score) || 0)
    }));
}

/**
 * Get the casual leaderboard (read-only). Returns [] if the contract is not configured or on error.
 */
export async function getLeaderboard(limit = 10) {
  const contractId = getContractId();
  if (!contractId || !isContractIdValid(contractId)) return [];
  try {
    const { Contract, TransactionBuilder, Account, BASE_FEE, xdr } = await import('@stellar/stellar-sdk');
    const server = await getServer();
    const built = new TransactionBuilder(
      new Account(SIM_SOURCE_ACCOUNT, '0'),
      { fee: BASE_FEE, networkPassphrase: TESTNET_PASSPHRASE }
    )
      .addOperation(new Contract(contractId).call('get_leaderboard', xdr.ScVal.scvU32(limit)))
      .setTimeout(TX_VALIDITY_SECONDS)
      .build();
    const sim = await server.simulateTransaction(built);
    if (sim.error) {
      logger.warn('[Cosmic Coder] get_leaderboard simulate error:', sim.error);
      return [];
    }
    return decodeCasualLeaderboard(sim.result?.retval);
  } catch (e) {
    logger.warn('[Cosmic Coder] get_leaderboard failed:', e?.message || e);
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
      SIM_SOURCE_ACCOUNT,
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
      logger.warn('[Cosmic Coder] get_leaderboard_by_season simulate error:', sim.error);
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
          } catch (e) { logger.debug('[getLeaderboardBySeason] skipping undecodable leaderboard entry (native decode):', e?.message || e); }
        }
        out.sort((a, b) => (b.score - a.score) || 0);
        return out;
      }
      if (Array.isArray(native)) return [];
    } catch (nativeErr) {
      logger.warn('[Cosmic Coder] getLeaderboardBySeason decode:', nativeErr?.message || nativeErr);
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
          } catch (e) { logger.debug('[getLeaderboardBySeason] could not decode player address (manual parse):', e?.message || e); }
        }
        if (k === 'score') {
          try {
            if (val && typeof val.u32 === 'function') score = val.u32();
            else if (val && typeof val.i128 === 'function') score = Number(val.i128().toString());
            else score = Math.max(0, Number(val?.toString?.() ?? val ?? 0));
          } catch (e) { logger.debug('[getLeaderboardBySeason] could not decode score (manual parse):', e?.message || e); }
        }
        if (k === 'wave') {
          try {
            wave = val && typeof val.u32 === 'function' ? val.u32() : Math.max(0, Number(val ?? 0));
          } catch (e) { logger.debug('[getLeaderboardBySeason] could not decode wave (manual parse):', e?.message || e); }
        }
      }
      out.push({ player, wave, score });
    }
    out.sort((a, b) => (b.score - a.score) || (b.wave - a.wave) || 0);
    return out;
  } catch (e) {
    const msg = e?.message || String(e);
    if (msg && !/accountId is invalid|invalid.*contract/i.test(msg)) {
      logger.warn('[Cosmic Coder] getLeaderboardBySeason failed:', msg);
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
      SIM_SOURCE_ACCOUNT,
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
