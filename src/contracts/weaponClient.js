/**
 * Weapon Unlock Client - Web3 integration for weapon unlock system
 * Interfaces with CosmicCoder contract for weapon unlocks and player stats
 */

import { getContractId, getZkProverUrl } from './gameClient.js';
import { WEAPONS, getWeaponById, getTierById } from '../config/weapons.js';
import { getRankBonus, isUnranked } from '../systems/RankManager.js';

const TESTNET_RPC = 'https://soroban-testnet.stellar.org';
const TESTNET_PASSPHRASE = 'Test SDF Network ; September 2015';

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

  // Helper to extract a number from simulateTransaction result
  const simNum = async (method) => {
    try {
      const { rpc } = await import('@stellar/stellar-sdk');
      const server = new rpc.Server(TESTNET_RPC);
      const sim = await server.simulateTransaction(
        await buildQueryTx(publicKey, method, [publicKey])
      );
      if (sim.error) return 0;
      const retval = sim.result?.retval;
      if (!retval) return 0;
      const name = retval.switch?.()?.name;
      if (name === 'scvU32') return retval.u32();
      if (name === 'scvU64') return Number(retval.u64());
      if (name === 'scvI128') {
        const lo = retval.i128().lo().toBigInt?.() ?? BigInt(retval.i128().lo());
        return Number(lo);
      }
      return parseInt(String(retval.value?.())) || 0;
    } catch (_) { return 0; }
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
    console.warn('[WeaponClient] Failed to get player stats:', e);
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
  const contractId = getCosmicCoderContractId();
  if (!contractId) return false;

  try {
    const { rpc, Contract } = await import('@stellar/stellar-sdk');
    const server = new rpc.Server(TESTNET_RPC);
    
    const result = await server.simulateTransaction(
      await buildQueryTx(publicKey, 'is_weapon_unlocked', [publicKey, weaponId.toString()])
    );
    
    return result.results[0] === 'true';
  } catch (e) {
    console.warn('[WeaponClient] Failed to check weapon unlock:', e);
    return false;
  }
}

/**
 * Get all unlocked weapons for a player
 * @param {string} publicKey - Player's Stellar public key
 * @returns {Promise<number[]>} Array of unlocked weapon IDs
 */
export async function getUnlockedWeapons(publicKey) {
  const contractId = getCosmicCoderContractId();
  if (!contractId) return [1]; // Only starter weapon

  try {
    const { rpc, Contract } = await import('@stellar/stellar-sdk');
    const server = new rpc.Server(TESTNET_RPC);
    
    const result = await server.simulateTransaction(
      await buildQueryTx(publicKey, 'get_unlocked_weapons', [publicKey])
    );
    
    // Parse result as array of weapon IDs
    const rawResult = result.results?.[0];
    const weaponIds = rawResult ? JSON.parse(rawResult) : [];
    return Array.isArray(weaponIds) && weaponIds.length > 0 ? weaponIds : [1];
  } catch (e) {
    console.warn('[WeaponClient] Failed to get unlocked weapons:', e);
    return [1]; // Default to starter weapon
  }
}

/**
 * Check weapon unlock eligibility
 * @param {string} publicKey - Player's Stellar public key
 * @param {number} weaponId - Weapon ID to check
 * @returns {Promise<{eligible: boolean, reason?: string, threshold?: number}>}
 */
export async function checkWeaponUnlockEligibility(publicKey, weaponId) {
  const weapon = getWeaponById(weaponId);
  if (!weapon) {
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
  if (stats.gamesPlayed < 3) {
    return { 
      eligible: false, 
      reason: `Play ${3 - stats.gamesPlayed} more games to unlock weapons`,
      threshold: weapon.tier.threshold
    };
  }

  // Check if best score meets threshold
  const tier = getTierById(weapon.tier);
  if (stats.bestScore < tier.threshold) {
    return { 
      eligible: false, 
      reason: `Need ${tier.threshold} best score (current: ${stats.bestScore})`,
      threshold: tier.threshold
    };
  }

  return { 
    eligible: true, 
    threshold: tier.threshold 
  };
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
    console.error('[WeaponClient] Failed to generate proof:', e);
    throw e;
  }
}

/**
 * Unlock weapon on-chain with ZK proof
 * @param {string} publicKey - Player's Stellar public key
 * @param {function} signTransaction - Function to sign transaction
 * @param {number} weaponId - Weapon ID to unlock
 * @param {object} proof - ZK proof from generateUnlockProof
 * @returns {Promise<boolean>}
 */
export async function unlockWeapon(publicKey, signTransaction, weaponId, proof) {
  const contractId = getCosmicCoderContractId();
  if (!contractId) {
    throw new Error('CosmicCoder contract not configured');
  }

  const weapon = getWeaponById(weaponId);
  if (!weapon) {
    throw new Error('Invalid weapon ID');
  }

  try {
    const { Contract, TransactionBuilder, Account, BASE_FEE, xdr } = await import('@stellar/stellar-sdk');
    const { rpc } = await import('@stellar/stellar-sdk');
    
    const server = new rpc.Server(TESTNET_RPC);
    const source = await server.getAccount(publicKey);
    const account = new Account(publicKey, String(source.sequence ?? '0'));
    const contract = new Contract(contractId);

    // Build unlock_weapon transaction
    const op = contract.call(
      'unlock_weapon',
      publicKey,
      weaponId.toString(),
      proof.proof,
      proof.vk,
      proof.pub_signals,
      weapon.tier.threshold.toString()
    );

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: TESTNET_PASSPHRASE,
    })
      .addOperation(op)
      .setTimeout(30)
      .build();

    const signedXdr = await signTransaction(tx.toXDR());
    const signedTx = xdr.TransactionEnvelope.fromXDR(signedXdr, 'base64');
    
    const result = await server.sendTransaction(signedTx);
    return result.status === 'SUCCESS';
  } catch (e) {
    console.error('[WeaponClient] Failed to unlock weapon:', e);
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

// Helper function to build query transactions
async function buildQueryTx(publicKey, method, args) {
  const { Contract, TransactionBuilder, Account, BASE_FEE, Address } = await import('@stellar/stellar-sdk');
  const { rpc } = await import('@stellar/stellar-sdk');
  
  const server = new rpc.Server(TESTNET_RPC);
  const source = await server.getAccount(publicKey);
  const account = new Account(publicKey, String(source.sequence ?? '0'));
  const contract = new Contract(getCosmicCoderContractId());
  
  // Convert string args to proper ScVal (Address for public keys)
  const scArgs = args.map(arg => {
    if (typeof arg === 'string' && arg.startsWith('G') && arg.length === 56) {
      return new Address(arg).toScVal();
    }
    return arg;
  });
  
  const op = contract.call(method, ...scArgs);
  
  return new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: TESTNET_PASSPHRASE,
  })
    .addOperation(op)
    .setTimeout(0)
    .build();
}
