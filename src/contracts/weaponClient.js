/**
 * Weapon Unlock Client - Web3 integration for weapon unlock system
 * Interfaces with CosmicCoder contract for weapon unlocks and player stats
 */

import { getContractId, getZkProverUrl, invoke, contractProofToZk, snarkjsToContractProof, proofToScVal, vkToScVal, pubSignalsToScVal } from './gameClient.js';
import { getWeaponById, WEAPON_UNLOCK_THRESHOLDS } from '../config/weapons.js';
import { getRankBonus, isUnranked } from '../systems/RankManager.js';
import { logger } from '../utils/log.js';
import { ContractError } from './contractErrors.js';

const TESTNET_RPC = 'https://soroban-testnet.stellar.org';
const TESTNET_PASSPHRASE = 'Test SDF Network ; September 2015';

/** Score proven in-circuit to unlock weapon id = index + 1. Mirror of WEAPON_THRESHOLDS in cosmic_coder/src/lib.rs. */
export const CONTRACT_WEAPON_THRESHOLDS = WEAPON_UNLOCK_THRESHOLDS; // single source: src/config/weapons.js
const UNLOCK_PUBLIC_SIGNALS = 2;
const MIN_GAMES_TO_UNLOCK = 3;

/**
 * Get contract ID for CosmicCoder
 */
function getCosmicCoderContractId() {
  return getContractId();
}

/**
 * Check if weapon unlock system is configured
 */
export function isWeaponSystemConfigured() {
  return !!getCosmicCoderContractId();
}

/**
 * Get player stats from contract
 * @param {string} publicKey - Player's Stellar public key
 * @returns {Promise<{gamesPlayed: number, bestScore: number, tier: number, canStartMatch: boolean}>}
 */
export async function getPlayerStats(publicKey) {
  const contractId = getCosmicCoderContractId();
  if (!contractId) {
    throw new Error('CosmicCoder contract not configured');
  }

  const stats = { gamesPlayed: 0, bestScore: 0, tier: 1, rank: 0, canStartMatch: false };

  const simNum = async (method) => {
    const v = await simulateView(publicKey, method, [await addressScVal(publicKey)]);
    return typeof v === 'bigint' ? Number(v) : typeof v === 'number' ? v : 0;
  };

  try {
    const [gamesPlayed, bestScore, tier] = await Promise.all([
      simNum('get_games_played'),
      simNum('get_best_score'),
      simNum('get_player_tier')
    ]);
    stats.gamesPlayed = gamesPlayed;
    stats.bestScore = bestScore;
    stats.tier = tier || 1;
    stats.rank = tier || 0;
  } catch (e) {
    logger.warn('[WeaponClient] Failed to get player stats:', e);
  }

  return stats;
}

/**
 * Check if a weapon is unlocked for a player
 * @param {string} publicKey - Player's Stellar public key
 * @param {number} weaponId - Weapon ID (1-5)
 * @returns {Promise<boolean>}
 */
export async function isWeaponUnlocked(publicKey, weaponId) {
  if (!getCosmicCoderContractId()) return false;
  const { xdr } = await import('@stellar/stellar-sdk');
  const v = await simulateView(publicKey, 'is_weapon_unlocked', [await addressScVal(publicKey), xdr.ScVal.scvU32(weaponId)]);
  return v === true;
}

/**
 * Get all unlocked weapons for a player
 * @param {string} publicKey - Player's Stellar public key
 * @returns {Promise<number[]>} Array of unlocked weapon IDs
 */
export async function getUnlockedWeapons(publicKey) {
  if (!getCosmicCoderContractId()) return [1]; // Only starter weapon
  const v = await simulateView(publicKey, 'get_unlocked_weapons', [await addressScVal(publicKey)]);
  const ids = Array.isArray(v) ? v.map(Number).filter(Number.isFinite) : [];
  return ids.length > 0 ? ids : [1];
}

/**
 * Check weapon unlock eligibility
 * @param {string} publicKey - Player's Stellar public key
 * @param {number} weaponId - Weapon ID to check
 * @returns {Promise<{eligible: boolean, reason?: string, threshold?: number}>}
 */
export async function checkWeaponUnlockEligibility(publicKey, weaponId) {
  const threshold = CONTRACT_WEAPON_THRESHOLDS[weaponId - 1];
  if (!getWeaponById(weaponId) || threshold === undefined) {
    return { eligible: false, reason: 'Invalid weapon ID' };
  }

  // Check if already unlocked
  const isUnlocked = await isWeaponUnlocked(publicKey, weaponId);
  if (isUnlocked) {
    return { eligible: false, reason: 'Weapon already unlocked' };
  }

  // Get player stats
  const stats = await getPlayerStats(publicKey);
  
  // Check minimum games played
  if (stats.gamesPlayed < MIN_GAMES_TO_UNLOCK) {
    return {
      eligible: false,
      reason: `Play ${MIN_GAMES_TO_UNLOCK - stats.gamesPlayed} more games to unlock weapons`,
      threshold
    };
  }

  // Contract proves score >= threshold in-circuit; best score is the local pre-check
  if (stats.bestScore < threshold) {
    return {
      eligible: false,
      reason: `Need ${threshold} best score (current: ${stats.bestScore})`,
      threshold
    };
  }

  return { eligible: true, threshold };
}

/**
 * Generate ZK proof for weapon unlock
 * This would call the ZK prover to generate a proof that score >= threshold
 * @param {number} score - Player's score (private)
 * @param {string} wallet - Wallet address (private)
 * @param {number} nonce - Unique nonce (private)
 * @param {number} threshold - Threshold to prove (public)
 * @returns {Promise<{proof: object, publicHash: string}>}
 */
export async function generateUnlockProof(score, wallet, nonce, threshold) {
  const proverUrl = getZkProverUrl();
  
  try {
    const response = await fetch(`${proverUrl}/skill-proof`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        score,
        wallet,
        nonce,
        threshold
      })
    });

    if (!response.ok) {
      throw new Error(`Prover error: ${response.status}`);
    }

    return await response.json();
  } catch (e) {
    logger.error('[WeaponClient] Failed to generate proof:', e);
    throw e;
  }
}

/**
 * Build the typed ScVal args of unlock_weapon(player, weapon_id: u32, proof: ZkProof, vk: ZkVerificationKey,
 * pub_signals: Vec<BytesN<32>>, threshold: u32). The threshold comes from the contract table: the contract
 * rejects any other value with #13 ThresholdMismatch.
 * @param {string} publicKey
 * @param {number} weaponId 1..5
 * @param {{ proof: object, vk: object, pub_signals: string[] }} proverPayload response of generateUnlockProof:
 *   contract-ready hex (proof.a is a hex string) or snarkjs decimal (proof.a / pi_a is an array, decimal signals)
 */
export async function buildUnlockWeaponArgs(publicKey, weaponId, proverPayload) {
  if (!Number.isInteger(weaponId) || weaponId < 1 || weaponId > CONTRACT_WEAPON_THRESHOLDS.length) {
    throw new Error(`Invalid weapon ID: ${weaponId}`);
  }
  if (!proverPayload || !Array.isArray(proverPayload.pub_signals) || proverPayload.pub_signals.length !== UNLOCK_PUBLIC_SIGNALS) {
    throw new Error(`Invalid unlock proof: pub_signals must have ${UNLOCK_PUBLIC_SIGNALS} entries`);
  }
  const isDecimalSnarkjs = Array.isArray(proverPayload.proof?.a) || Array.isArray(proverPayload.proof?.pi_a);
  const contractPayload = isDecimalSnarkjs
    ? snarkjsToContractProof(proverPayload.proof, proverPayload.pub_signals, proverPayload.vk)
    : proverPayload;
  const zk = contractProofToZk(contractPayload);
  const { xdr, Address } = await import('@stellar/stellar-sdk');
  return [
    new Address(publicKey).toScVal(),
    xdr.ScVal.scvU32(weaponId),
    proofToScVal(zk.proof, xdr),
    vkToScVal(zk.vk, xdr),
    pubSignalsToScVal(zk.pubSignals, xdr),
    xdr.ScVal.scvU32(CONTRACT_WEAPON_THRESHOLDS[weaponId - 1])
  ];
}

/**
 * Unlock weapon on-chain with ZK proof (simulate -> prepare -> sign -> send -> confirm via gameClient.invoke).
 * Failures throw ContractError: #12 InvalidWeapon, #13 ThresholdMismatch, #14 AlreadyUnlocked, #8 VkMismatch,
 * #2 Replay, #3 InvalidProof.
 * @param {string} publicKey - Player's Stellar public key
 * @param {function} signTransaction - Function to sign transaction
 * @param {number} weaponId - Weapon ID to unlock
 * @param {object} proof - prover payload from generateUnlockProof
 * @returns {Promise<true>}
 */
export async function unlockWeapon(publicKey, signTransaction, weaponId, proof) {
  const contractId = getCosmicCoderContractId();
  if (!contractId) {
    throw new Error('CosmicCoder contract not configured');
  }
  const args = await buildUnlockWeaponArgs(publicKey, weaponId, proof);
  try {
    await invoke(contractId, 'unlock_weapon', args, publicKey, signTransaction);
    return true;
  } catch (e) {
    logger.error('[WeaponClient] Failed to unlock weapon:', e instanceof ContractError ? `#${e.code} ${e.errorName}` : e);
    throw e;
  }
}

/**
 * Get starting weapon bonus chance based on player rank
 * @param {string} publicKey - Player's Stellar public key
 * @returns {Promise<number>} Chance 0-1 for starting with bonus weapon
 */
export async function getStartingWeaponBonus(publicKey) {
  const stats = await getPlayerStats(publicKey);
  // Use rank from stats if available, otherwise fall back to tier
  const playerRank = stats.rank !== undefined ? stats.rank : stats.tier;
  return getRankBonus(playerRank);
}

/**
 * Select starting weapon based on rank bonus
 * @param {string} publicKey - Player's Stellar public key
 * @returns {Promise<{weaponId: number, weaponType: string}>}
 */
export async function selectStartingWeapon(publicKey) {
  const unlockedWeapons = await getUnlockedWeapons(publicKey);
  const stats = await getPlayerStats(publicKey);
  // Use rank from stats if available, otherwise fall back to tier
  const playerRank = stats.rank !== undefined ? stats.rank : stats.tier;
  const bonusChance = getRankBonus(playerRank);
  
  // Skip if unranked or no bonus
  if (isUnranked(playerRank) || bonusChance <= 0) {
    return { weaponId: 1, weaponType: 'basic' };
  }
  
  // Roll for bonus weapon
  if (Math.random() < bonusChance && unlockedWeapons.length > 1) {
    // Select random unlocked weapon (excluding starter)
    const bonusWeapons = unlockedWeapons.filter(id => id !== 1);
    if (bonusWeapons.length > 0) {
      const selectedId = bonusWeapons[Math.floor(Math.random() * bonusWeapons.length)];
      const weapon = getWeaponById(selectedId);
      return { weaponId: selectedId, weaponType: weapon.type };
    }
  }
  
  // Default to starter weapon
  return { weaponId: 1, weaponType: 'basic' };
}

async function addressScVal(publicKey) {
  const { Address } = await import('@stellar/stellar-sdk');
  return new Address(publicKey).toScVal();
}

/** Simulate a read-only call (args are ScVals). Returns the native value or undefined on any failure. */
async function simulateView(publicKey, method, scArgs) {
  try {
    const { Contract, TransactionBuilder, Account, BASE_FEE, rpc, scValToNative } = await import('@stellar/stellar-sdk');
    const server = new rpc.Server(TESTNET_RPC);
    const source = await server.getAccount(publicKey);
    const account = new Account(publicKey, String(source.sequence ?? '0'));
    const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: TESTNET_PASSPHRASE })
      .addOperation(new Contract(getCosmicCoderContractId()).call(method, ...scArgs))
      .setTimeout(0)
      .build();
    const sim = await server.simulateTransaction(tx);
    if (sim.error || !sim.result?.retval) return undefined;
    return scValToNative(sim.result.retval);
  } catch (e) {
    logger.debug(`[WeaponClient] ${method} failed:`, e?.message || e);
    return undefined;
  }
}
