//! Cosmic Coder - ZK-ranked survival game on Stellar.
//! Ranked leaderboard depends exclusively on Groth16 proof verification (BN254).
//! Verifier and policy are separate; shared types in zk_types.
//! ZK Plasma Rifle integration: pub_signals[6] = used_zk_weapon flag.

#![no_std]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, Address, Bytes, Env, IntoVal,
    Symbol, Vec,
};
use zk_types::{Groth16Error, ZkProof, ZkVerificationKey};

// BN254 scalar field modulus (Fr) in uncompressed big-endian bytes:
// r = 21888242871839275222246405745257275088548364400416034343698204186575808495617
//   = 0x30644e72e131a029b85045b68181585d2833e84879b9709143e1f593f0000001
const BN254_FR_MODULUS_BE: [u8; 32] = [
    0x30, 0x64, 0x4e, 0x72, 0xe1, 0x31, 0xa0, 0x29, 0xb8, 0x50, 0x45, 0xb6, 0x81, 0x81,
    0x58, 0x5d, 0x28, 0x33, 0xe8, 0x48, 0x79, 0xb9, 0x70, 0x91, 0x43, 0xe1, 0xf5, 0x93,
    0xf0, 0x00, 0x00, 0x01,
];

fn is_ge_be_32(a: &[u8; 32], b: &[u8; 32]) -> bool {
    for i in 0..32 {
        if a[i] < b[i] {
            return false;
        }
        if a[i] > b[i] {
            return true;
        }
    }
    true // equal
}

/// TTL for nonce anti-replay storage (approx 1 year in ledgers, ~5 sec per ledger)
const NONCE_TTL_LEDGERS: u32 = 6_307_200;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum CosmicCoderError {
    VerifierNotSet = 1,
    Replay = 2,
    InvalidProof = 3,
    VerifierError = 4,
    InvalidInput = 5,
    MalformedVk = 6,
    VerifierCrash = 100,
    GameHubCrash = 101,
    InvalidZkProof = 102,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum UltraHonkError {
    VkParseError = 1,
    ProofParseError = 2,
    VerificationFailed = 3,
    VkNotSet = 4,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LeaderboardEntry {
    pub player: Address,
    pub wave: u32,
    pub score: i128,
}

/// Per-season ranked entry: (player, score). Sorted desc by score; deterministic.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ScoreEntry {
    pub player: Address,
    pub score: u32,
}

/// Key for ranked leaderboard storage: one vec per season.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LeaderboardKey {
    pub season_id: u32,
}

/// Anti-replay: (player, nonce, season_id) must be unique.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ReplayKey {
    pub player: Address,
    pub nonce: u64,
    pub season_id: u32,
}

/// Strict nonce key for panic-based anti-replay (nonce only, extracted from pub_signals).
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct NonceKey {
    pub nonce: u64,
}

/// Event payload: emitted only when verifier returns Ok(true).
#[contracttype]
#[derive(Clone, Debug)]
pub struct ZkRunSubmitted {
    pub player: Address,
    pub season_id: u32,
    pub score: u32,
    pub wave: u32,
    pub run_hash: Bytes,
}

/// Minimum score per wave for legacy submit_result.
const MIN_SCORE_PER_WAVE: u32 = 10;

/// Weapon unlock data structure
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WeaponUnlockKey {
    pub player: Address,
    pub weapon_id: u32,
}

/// Persistent storage keys for core contract config/state.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    GameHub,
    Session,
    ZkVerifier,
}

#[contract]
pub struct CosmicCoder;

#[contractimpl]
impl CosmicCoder {
    /// Initialize: game hub and ZK verifier addresses.
    pub fn init(env: Env, game_hub: Address, zk_verifier: Address) {
        env.storage().persistent().set(&DataKey::GameHub, &game_hub);
        env.storage().persistent().set(&DataKey::ZkVerifier, &zk_verifier);
        env.storage().persistent().set(&DataKey::Session, &0u32);
    }

    /// Set Groth16 verifier contract (required for ranked submit_zk).
    pub fn set_verifier(env: Env, verifier: Address) {
        env.storage().persistent().set(&DataKey::ZkVerifier, &verifier);
    }

    /// Start a match (Game Hub start_game). Caller must pass their address and authorize.
    pub fn start_match(env: Env, player: Address) -> u32 {
        player.require_auth();
        let session: u32 = match env.storage().persistent().get::<DataKey, u32>(&DataKey::Session) {
            Some(s) => s,
            None => 0,
        };
        let new_session = session.checked_add(1).unwrap();
        env.storage()
            .persistent()
            .set(&DataKey::Session, &new_session);

        let hub: Address = env
            .storage()
            .persistent()
            .get(&DataKey::GameHub)
            .unwrap();
        let game_id = env.current_contract_address();
        let system_player = game_id.clone();
        env.invoke_contract::<()>(
            &hub,
            &Symbol::new(&env, "start_game"),
            soroban_sdk::vec![
                &env,
                game_id.into_val(&env),
                (new_session as u32).into_val(&env),
                player.into_val(&env),
                system_player.into_val(&env),
                0i128.into_val(&env),
                0i128.into_val(&env),
            ],
        );
        new_session
    }

    /// Legacy casual submit: auth + rule only. Caller passes player address and authorizes.
    pub fn submit_result(env: Env, player: Address, wave: u32, score: i128) -> bool {
        player.require_auth();

        let min_score = (wave as i128).saturating_mul(MIN_SCORE_PER_WAVE as i128);
        if score < min_score {
            return false;
        }

        let session: u32 = match env.storage().persistent().get::<DataKey, u32>(&DataKey::Session) {
            Some(s) => s,
            None => 0,
        };
        let hub: Address = env.storage().persistent().get(&DataKey::GameHub).unwrap();
        env.invoke_contract::<()>(
            &hub,
            &Symbol::new(&env, "end_game"),
            soroban_sdk::vec![&env, (session as u32).into_val(&env), true.into_val(&env)],
        );

        let entry = LeaderboardEntry {
            player: player.clone(),
            wave,
            score,
        };
        let key = Symbol::new(&env, "Leaderboard");
        let mut entries: Vec<LeaderboardEntry> = match env.storage().persistent().get::<Symbol, Vec<LeaderboardEntry>>(&key) {
            Some(v) => v,
            None => Vec::new(&env),
        };
        entries.push_back(entry);
        env.storage().persistent().set(&key, &entries);
        true
    }

    /// Ranked ZK submit: verifier + strict anti-replay from pub_signals.
    /// 
    /// pub_signals order (7 elements): [run_hash_hi, run_hash_lo, score, wave, nonce, season_id, used_zk_weapon]
    /// 
    /// Security features:
    /// - Validates public signals are in BN254 Fr field (no host traps)
    /// - Anti-replay: rejects reused (player, nonce, season_id)
    /// - TTL extension for nonce storage (~1 year)
    /// - Emits "zk_wpn" event when used_zk_weapon == 1 (ZK Plasma Rifle)
    /// - Calls end_game() on Game Hub after successful verification
    pub fn submit_zk(
        env: Env,
        player: Address,
        proof: ZkProof,
        vk: ZkVerificationKey,
        pub_signals: Vec<Bytes>,
        nonce: u64,
        run_hash: Bytes,
        season_id: u32,
        score: u32,
        wave: u32,
    ) -> Result<(), CosmicCoderError> {
        player.require_auth();

        // Diagnostic breadcrumb: submit_zk entered
        env.events()
            .publish((symbol_short!("debug"),), symbol_short!("zk_start"));

        // === 1. Get verifier contract (explicit crash reason if missing) ===
        let verifier_addr: Address = match env
            .storage()
            .persistent()
            .get::<DataKey, Address>(&DataKey::ZkVerifier)
        {
            Some(a) => a,
            None => return Err(CosmicCoderError::VerifierNotSet),
        };

        // === 2. Validate pub_signals structure (expect 7 elements for new circuit) ===
        // Strict: circuit expects exactly 7 public signals.
        if pub_signals.len() != 7 {
            env.events().publish(
                (Symbol::new(&env, "debug"), Symbol::new(&env, "submit_zk")),
                Symbol::new(&env, "bad_pub_signals_len"),
            );
            return Err(CosmicCoderError::InvalidInput);
        }
        let has_weapon_flag = true;
        if vk.ic.len() != pub_signals.len() + 1 {
            return Err(CosmicCoderError::MalformedVk);
        }

        // === 3b. Convert pub_signals (Bytes) -> BytesN<32> for verifier contract ===
        // Frontend encodes public signals as Vec<Bytes>. The verifier contract expects Vec<BytesN<32>>.
        // Validate each element is exactly 32 bytes, then convert.
        let mut pub_signals_n: Vec<soroban_sdk::BytesN<32>> = Vec::new(&env);
        let n = pub_signals.len();
        for i in 0..n {
            let b = pub_signals.get(i).unwrap();
            if b.len() != 32 {
                env.events()
                    .publish((symbol_short!("debug"),), symbol_short!("sig_len"));
                return Err(CosmicCoderError::InvalidInput);
            }
            let mut arr = [0u8; 32];
            for j in 0..32u32 {
                arr[j as usize] = b.get(j).unwrap();
            }
            // Prevent BN254 host traps: reject scalars outside Fr (>= modulus).
            // Public inputs are interpreted as big-endian field elements.
            if is_ge_be_32(&arr, &BN254_FR_MODULUS_BE) {
                env.events().publish(
                    (Symbol::new(&env, "debug"), Symbol::new(&env, "submit_zk")),
                    Symbol::new(&env, "bad_pub_signal_out_of_field"),
                );
                return Err(CosmicCoderError::InvalidZkProof);
            }
            pub_signals_n.push_back(soroban_sdk::BytesN::from_array(&env, &arr));
        }

        // === 3. Validate inputs ===
        if score == 0 || wave == 0 {
            return Err(CosmicCoderError::InvalidInput);
        }
        let min_score = wave.saturating_mul(MIN_SCORE_PER_WAVE);
        if score < min_score {
            return Err(CosmicCoderError::InvalidInput);
        }

        // === 4. STRICT ANTI-REPLAY: Check nonce BEFORE calling verifier ===
        // Extract nonce from pub_signals[4] for additional validation
        let nonce_key = NonceKey { nonce };
        if env.storage().persistent().has(&nonce_key) {
            return Err(CosmicCoderError::Replay);
        }
        
        // Also check the full replay key
        let replay_key = ReplayKey {
            player: player.clone(),
            nonce,
            season_id,
        };
        if env.storage().persistent().has(&replay_key) {
            return Err(CosmicCoderError::Replay);
        }

        // === 5. Call Groth16 verifier ===
        let verifier_result = env.try_invoke_contract::<bool, Groth16Error>(
            &verifier_addr,
            &Symbol::new(&env, "verify_proof"),
            soroban_sdk::vec![
                &env,
                vk.into_val(&env),
                proof.into_val(&env),
                pub_signals_n.clone().into_val(&env),
            ],
        );
        let is_valid = match verifier_result {
            Ok(Ok(val)) => val,
            Ok(Err(_e)) => {
                env.events().publish(
                    (Symbol::new(&env, "debug"), Symbol::new(&env, "host_call")),
                    Symbol::new(&env, "verifier_returned_err"),
                );
                return Err(CosmicCoderError::VerifierError);
            }
            Err(_host) => {
                env.events().publish(
                    (Symbol::new(&env, "debug"), Symbol::new(&env, "host_call")),
                    Symbol::new(&env, "verifier_host_call_failed"),
                );
                return Err(CosmicCoderError::VerifierCrash);
            }
        };
        if !is_valid {
            env.events()
                .publish((symbol_short!("debug"),), symbol_short!("err_math"));
            return Err(CosmicCoderError::InvalidProof);
        }

        // === 6. Mark nonce as used with TTL extension ===
        env.storage().persistent().set(&nonce_key, &true);
        env.storage().persistent().extend_ttl(&nonce_key, NONCE_TTL_LEDGERS, NONCE_TTL_LEDGERS);
        
        env.storage().persistent().set(&replay_key, &true);
        env.storage().persistent().extend_ttl(&replay_key, NONCE_TTL_LEDGERS, NONCE_TTL_LEDGERS);

        // === 7. Extract used_zk_weapon from pub_signals[6] and emit event ===
        if has_weapon_flag {
            let weapon_bytes = match pub_signals.get(6) {
                Some(b) => b,
                None => return Err(CosmicCoderError::InvalidInput),
            };
            // Check if last byte is 1 (used_zk_weapon = true).
            // Frontend sends each pub_signal as 32-byte ScVal::Bytes (not BytesN),
            // so we validate length and read the last byte.
            if weapon_bytes.len() != 32 {
                return Err(CosmicCoderError::InvalidInput);
            }
            let used_weapon = weapon_bytes.get(31) == Some(1);
            
            if used_weapon {
                // Emit distinct ZK weapon event for frontend/Stellar Expert tracking
                env.events().publish((symbol_short!("zk_wpn"), player.clone()), true);
            }
        }

        // === 8. Call end_game() on Game Hub ===
        let session: u32 = match env.storage().persistent().get::<DataKey, u32>(&DataKey::Session) {
            Some(s) => s,
            None => return Err(CosmicCoderError::GameHubCrash),
        };
        let hub_addr: Address = match env
            .storage()
            .persistent()
            .get::<DataKey, Address>(&DataKey::GameHub)
        {
            Some(a) => a,
            None => return Err(CosmicCoderError::GameHubCrash),
        };

        // end_game() on the hub returns () (not Result), so we must use invoke_contract
        // (try_invoke_contract expects the callee to return Result<_, E> and can trap on decode).
        // Breadcrumb before hub call: if a trap happens inside the hub, you'll still see this.
        env.events()
            .publish((symbol_short!("debug"),), symbol_short!("hub_call"));
        env.invoke_contract::<()>(
            &hub_addr,
            &Symbol::new(&env, "end_game"),
            // Must match mock hub signature exactly: (env, session_id_u32, true)
            soroban_sdk::vec![&env, session.into_val(&env), true.into_val(&env)],
        );

        // === 9. Update leaderboard ===
        let lb_key = LeaderboardKey { season_id };
        let mut entries: Vec<ScoreEntry> = env.storage().persistent().get::<LeaderboardKey, Vec<ScoreEntry>>(&lb_key).unwrap_or(Vec::new(&env));
        
        let mut found = false;
        let n = entries.len();
        for i in 0..n {
            let e = entries.get(i).unwrap();
            if e.player == player {
                found = true;
                if score > e.score {
                    entries.set(i as u32, ScoreEntry { player: player.clone(), score });
                }
                break;
            }
        }
        if !found {
            entries.push_back(ScoreEntry { player: player.clone(), score });
        }
        sort_leaderboard_desc(&env, &mut entries);
        env.storage().persistent().set(&lb_key, &entries);

        // === 10. Emit main ZK run event ===
        env.events().publish(
            (Symbol::new(&env, "zk_run_submitted"), player.clone(), season_id, score, wave, run_hash),
            (),
        );

        Ok(())
    }

    /// Ranked submit (Noir + UltraHonk): verifier takes vk_json + proof_blob.
    pub fn submit_zk_noir(
        env: Env,
        player: Address,
        vk_json: Bytes,
        proof_blob: Bytes,
        nonce: u64,
        run_hash: Bytes,
        season_id: u32,
        score: u32,
        wave: u32,
    ) -> Result<(), CosmicCoderError> {
        player.require_auth();

        let verifier_addr: Address = match env
            .storage()
            .persistent()
            .get::<DataKey, Address>(&DataKey::ZkVerifier)
        {
            Some(a) => a,
            None => return Err(CosmicCoderError::VerifierNotSet),
        };

        if score == 0 || wave == 0 {
            return Err(CosmicCoderError::InvalidInput);
        }
        let min_score = wave.saturating_mul(MIN_SCORE_PER_WAVE);
        if score < min_score {
            return Err(CosmicCoderError::InvalidInput);
        }
        if run_hash.len() != 32 || vk_json.len() == 0 || proof_blob.len() == 0 {
            return Err(CosmicCoderError::InvalidInput);
        }

        let nonce_key = NonceKey { nonce };
        if env.storage().persistent().has(&nonce_key) {
            return Err(CosmicCoderError::Replay);
        }
        let replay_key = ReplayKey {
            player: player.clone(),
            nonce,
            season_id,
        };
        if env.storage().persistent().has(&replay_key) {
            return Err(CosmicCoderError::Replay);
        }

        let verifier_result = env.try_invoke_contract::<soroban_sdk::BytesN<32>, UltraHonkError>(
            &verifier_addr,
            &Symbol::new(&env, "verify_proof"),
            soroban_sdk::vec![&env, vk_json.into_val(&env), proof_blob.into_val(&env)],
        );
        let _proof_id = match verifier_result {
            Ok(Ok(pid)) => pid,
            Ok(Err(_)) => return Err(CosmicCoderError::VerifierError),
            Err(_) => return Err(CosmicCoderError::VerifierCrash),
        };

        env.storage().persistent().set(&nonce_key, &true);
        env.storage().persistent().extend_ttl(&nonce_key, NONCE_TTL_LEDGERS, NONCE_TTL_LEDGERS);
        env.storage().persistent().set(&replay_key, &true);
        env.storage().persistent().extend_ttl(&replay_key, NONCE_TTL_LEDGERS, NONCE_TTL_LEDGERS);

        let session: u32 = match env.storage().persistent().get::<DataKey, u32>(&DataKey::Session) {
            Some(s) => s,
            None => return Err(CosmicCoderError::GameHubCrash),
        };
        let hub_addr: Address = match env
            .storage()
            .persistent()
            .get::<DataKey, Address>(&DataKey::GameHub)
        {
            Some(a) => a,
            None => return Err(CosmicCoderError::GameHubCrash),
        };
        env.invoke_contract::<()>(
            &hub_addr,
            &Symbol::new(&env, "end_game"),
            soroban_sdk::vec![&env, session.into_val(&env), true.into_val(&env)],
        );

        let lb_key = LeaderboardKey { season_id };
        let mut entries: Vec<ScoreEntry> = env
            .storage()
            .persistent()
            .get::<LeaderboardKey, Vec<ScoreEntry>>(&lb_key)
            .unwrap_or(Vec::new(&env));
        let mut found = false;
        let n = entries.len();
        for i in 0..n {
            let e = entries.get(i).unwrap();
            if e.player == player {
                found = true;
                if score > e.score {
                    entries.set(i as u32, ScoreEntry { player: player.clone(), score });
                }
                break;
            }
        }
        if !found {
            entries.push_back(ScoreEntry { player: player.clone(), score });
        }
        sort_leaderboard_desc(&env, &mut entries);
        env.storage().persistent().set(&lb_key, &entries);

        env.events().publish(
            (Symbol::new(&env, "zk_run_submitted"), player.clone(), season_id, score, wave, run_hash),
            (),
        );

        Ok(())
    }

    /// Get ranked leaderboard for a season (top by score, deterministic).
    pub fn get_leaderboard_by_season(env: Env, season_id: u32, limit: u32) -> Vec<ScoreEntry> {
        let key = LeaderboardKey { season_id };
        let entries: Vec<ScoreEntry> = match env.storage().persistent().get::<LeaderboardKey, Vec<ScoreEntry>>(&key) {
            Some(v) => v,
            None => return Vec::new(&env),
        };
        let mut out = Vec::new(&env);
        let n = core::cmp::min(limit, entries.len());
        for i in 0..n {
            out.push_back(entries.get(i).unwrap());
        }
        out
    }

    /// Get legacy leaderboard (casual mode, top by score).
    pub fn get_leaderboard(env: Env, limit: u32) -> Vec<LeaderboardEntry> {
        let key = Symbol::new(&env, "Leaderboard");
        let entries: Vec<LeaderboardEntry> = match env.storage().persistent().get::<Symbol, Vec<LeaderboardEntry>>(&key) {
            Some(v) => v,
            None => Vec::new(&env),
        };
        let mut out = Vec::new(&env);
        let n = core::cmp::min(limit, entries.len());
        for i in 0..n {
            out.push_back(entries.get(i).unwrap());
        }
        out
    }

    // ========== WEAPON UNLOCK SYSTEM ==========

    /// Submit score and update player stats (games played, best score)
    pub fn submit_score(env: Env, player: Address, score: u32) {
        player.require_auth();

        // Increment games played
        let games_key = (Symbol::new(&env, "GamesPlayed"), player.clone());
        let games_played: u32 = env.storage().persistent().get(&games_key).unwrap_or(0);
        env.storage().persistent().set(&games_key, &(games_played + 1));

        // Update best score if higher
        let best_key = (Symbol::new(&env, "BestScore"), player.clone());
        let best_score: u32 = env.storage().persistent().get(&best_key).unwrap_or(0);
        if score > best_score {
            env.storage().persistent().set(&best_key, &score);
        }

        // Update player tier based on best score
        Self::update_player_tier(env.clone(), player.clone());

        // Emit event
        env.events().publish(
            (Symbol::new(&env, "score_submitted"), player, score),
            (),
        );
    }

    /// Get games played by player
    pub fn get_games_played(env: Env, player: Address) -> u32 {
        let key = (Symbol::new(&env, "GamesPlayed"), player);
        env.storage().persistent().get(&key).unwrap_or(0)
    }

    /// Get best score by player
    pub fn get_best_score(env: Env, player: Address) -> u32 {
        let key = (Symbol::new(&env, "BestScore"), player);
        env.storage().persistent().get(&key).unwrap_or(0)
    }

    /// Update player tier based on best score
    fn update_player_tier(env: Env, player: Address) {
        let best_score = Self::get_best_score(env.clone(), player.clone());
        let tier = if best_score >= 10000 {
            4 // Mythic
        } else if best_score >= 5000 {
            3 // Gold
        } else if best_score >= 1000 {
            2 // Silver
        } else {
            1 // Bronze
        };
        let tier_key = (Symbol::new(&env, "PlayerTier"), player);
        env.storage().persistent().set(&tier_key, &tier);
    }

    /// Get player tier (1=Bronze, 2=Silver, 3=Gold, 4=Mythic)
    pub fn get_player_tier(env: Env, player: Address) -> u32 {
        let key = (Symbol::new(&env, "PlayerTier"), player);
        env.storage().persistent().get(&key).unwrap_or(1)
    }

    /// Check if player can start a match (gamesPlayed >= 3 and bestScore > 0)
    pub fn can_start_match(env: Env, player: Address) -> bool {
        let games = Self::get_games_played(env.clone(), player.clone());
        let best = Self::get_best_score(env.clone(), player.clone());
        games >= 3 && best > 0
    }

    /// Unlock weapon with ZK proof
    /// weapon_id: 1=Starter, 2=Shotgun, 3=Tactical Rifle, 4=Plasma Rifle, 5=Quantum Destroyer
    pub fn unlock_weapon(
        env: Env,
        player: Address,
        weapon_id: u32,
        proof: ZkProof,
        vk: ZkVerificationKey,
        pub_signals: Vec<soroban_sdk::BytesN<32>>,
        threshold: u32,
    ) -> Result<(), CosmicCoderError> {
        player.require_auth();

        // Verify weapon_id is valid (1-5)
        if weapon_id < 1 || weapon_id > 5 {
            return Err(CosmicCoderError::InvalidInput);
        }

        // Verify threshold matches weapon_id
        let expected_threshold = match weapon_id {
            1 => 0u32,
            2 => 1000u32,
            3 => 5000u32,
            4 => 10000u32,
            5 => 20000u32,
            _ => return Err(CosmicCoderError::InvalidInput),
        };
        if threshold != expected_threshold {
            return Err(CosmicCoderError::InvalidInput);
        }

        // Check if already unlocked
        let unlock_key = WeaponUnlockKey { player: player.clone(), weapon_id };
        let already_unlocked: bool = env.storage().persistent().get(&unlock_key).unwrap_or(false);
        if already_unlocked {
            return Err(CosmicCoderError::InvalidInput);
        }

        // Get verifier
        let verifier: Address = match env.storage().persistent().get::<DataKey, Address>(&DataKey::ZkVerifier) {
            Some(a) => a,
            None => return Err(CosmicCoderError::VerifierNotSet),
        };

        // Verify ZK proof
        if vk.ic.len() != pub_signals.len() + 1 {
            return Err(CosmicCoderError::MalformedVk);
        }

        let raw = env.try_invoke_contract::<bool, Groth16Error>(
            &verifier,
            &Symbol::new(&env, "verify_proof"),
            soroban_sdk::vec![
                &env,
                vk.into_val(&env),
                proof.into_val(&env),
                pub_signals.into_val(&env),
            ],
        );
        let ok = match raw {
            Ok(Ok(b)) => b,
            Ok(Err(_)) => return Err(CosmicCoderError::VerifierError),
            Err(_) => return Err(CosmicCoderError::VerifierError),
        };
        if !ok {
            return Err(CosmicCoderError::InvalidProof);
        }

        // Mark weapon as unlocked
        env.storage().persistent().set(&unlock_key, &true);

        // Emit event
        env.events().publish(
            (Symbol::new(&env, "weapon_unlocked"), player.clone(), weapon_id, threshold),
            (),
        );

        Ok(())
    }

    /// Check if weapon is unlocked for player
    pub fn is_weapon_unlocked(env: Env, player: Address, weapon_id: u32) -> bool {
        let key = WeaponUnlockKey { player, weapon_id };
        env.storage().persistent().get(&key).unwrap_or(false)
    }

    /// Get all unlocked weapons for player
    pub fn get_unlocked_weapons(env: Env, player: Address) -> Vec<u32> {
        let mut unlocked = Vec::new(&env);
        for weapon_id in 1..=5u32 {
            if Self::is_weapon_unlocked(env.clone(), player.clone(), weapon_id) {
                unlocked.push_back(weapon_id);
            }
        }
        unlocked
    }
}

/// Sort by score desc (deterministic; equal scores keep relative order).
fn sort_leaderboard_desc(_env: &Env, entries: &mut Vec<ScoreEntry>) {
    let n = entries.len();
    for i in 0..n {
        for j in (i + 1)..n {
            let a = entries.get(i).unwrap().clone();
            let b = entries.get(j).unwrap().clone();
            if b.score > a.score {
                entries.set(i as u32, b);
                entries.set(j as u32, a);
            }
        }
    }
}

#[cfg(test)]
mod tests;
