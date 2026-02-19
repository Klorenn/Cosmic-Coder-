//! Cosmic Coder - ZK-ranked survival game on Stellar.
//! Ranked leaderboard depends exclusively on Groth16 proof verification (BN254).
//! Verifier and policy are separate; shared types in zk_types.

#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracterror, contracttype, Address, Env, IntoVal, Symbol, Vec,
};
use zk_types::{Groth16Error, ZkProof, ZkVerificationKey};

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

/// Event payload: emitted only when verifier returns Ok(true).
#[contracttype]
#[derive(Clone, Debug)]
pub struct ZkRunSubmitted {
    pub player: Address,
    pub season_id: u32,
    pub score: u32,
    pub wave: u32,
    pub run_hash: soroban_sdk::BytesN<32>,
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

#[contract]
pub struct CosmicCoder;

#[contractimpl]
impl CosmicCoder {
    /// Initialize: game hub address. Verifier set via set_verifier.
    pub fn init(env: Env, game_hub: Address) {
        env.storage().persistent().set(&Symbol::new(&env, "Hub"), &game_hub);
        env.storage().persistent().set(&Symbol::new(&env, "Session"), &0u32);
    }

    /// Set Groth16 verifier contract (required for ranked submit_zk).
    pub fn set_verifier(env: Env, verifier: Address) {
        env.storage().persistent().set(&Symbol::new(&env, "Verifier"), &verifier);
    }

    /// Start a match (Game Hub start_game). Caller must pass their address and authorize.
    pub fn start_match(env: Env, player: Address) -> u32 {
        player.require_auth();
        let session: u32 = match env.storage().persistent().get::<Symbol, u32>(&Symbol::new(&env, "Session")) {
            Some(s) => s,
            None => 0,
        };
        let new_session = session.checked_add(1).unwrap();
        env.storage()
            .persistent()
            .set(&Symbol::new(&env, "Session"), &new_session);

        let hub: Address = env
            .storage()
            .persistent()
            .get(&Symbol::new(&env, "Hub"))
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

        let session: u32 = match env.storage().persistent().get::<Symbol, u32>(&Symbol::new(&env, "Session")) {
            Some(s) => s,
            None => 0,
        };
        let hub: Address = env.storage().persistent().get(&Symbol::new(&env, "Hub")).unwrap();
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

    /// Ranked ZK submit: verifier + anti-replay (player, nonce, season_id).
    /// Validates: verifier set, ic.len() == pub_signals.len() + 1, score > 0, wave > 0.
    /// On success: mark nonce used, update per-season leaderboard (update only if higher score), emit ZkRunSubmitted.
    pub fn submit_zk(
        env: Env,
        player: Address,
        proof: ZkProof,
        vk: ZkVerificationKey,
        pub_signals: Vec<soroban_sdk::BytesN<32>>,
        nonce: u64,
        run_hash: soroban_sdk::BytesN<32>,
        season_id: u32,
        score: u32,
        wave: u32,
    ) -> Result<(), CosmicCoderError> {
        player.require_auth();

        let verifier: Address = match env.storage().persistent().get::<Symbol, Address>(&Symbol::new(&env, "Verifier")) {
            Some(a) => a,
            None => return Err(CosmicCoderError::VerifierNotSet),
        };

        if vk.ic.len() != pub_signals.len() + 1 {
            return Err(CosmicCoderError::MalformedVk);
        }
        if score == 0 || wave == 0 {
            return Err(CosmicCoderError::InvalidInput);
        }
        // Regla de progresión: score >= wave * MIN_SCORE_PER_WAVE (igual que submit_result)
        let min_score = wave.saturating_mul(MIN_SCORE_PER_WAVE);
        if score < min_score {
            return Err(CosmicCoderError::InvalidInput);
        }

        let replay_key = ReplayKey {
            player: player.clone(),
            nonce,
            season_id,
        };
        let already_used = match env.storage().persistent().get::<ReplayKey, bool>(&replay_key) {
            Some(true) => true,
            _ => false,
        };
        if already_used {
            return Err(CosmicCoderError::Replay);
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

        env.storage().persistent().set(&replay_key, &true);

        let session: u32 = match env.storage().persistent().get::<Symbol, u32>(&Symbol::new(&env, "Session")) {
            Some(s) => s,
            None => 0,
        };
        let hub: Address = env.storage().persistent().get(&Symbol::new(&env, "Hub")).unwrap();
        env.invoke_contract::<()>(
            &hub,
            &Symbol::new(&env, "end_game"),
            soroban_sdk::vec![&env, session.into_val(&env), true.into_val(&env)],
        );

        let lb_key = LeaderboardKey { season_id };
        let mut entries: Vec<ScoreEntry> = match env.storage().persistent().get::<LeaderboardKey, Vec<ScoreEntry>>(&lb_key) {
            Some(v) => v,
            None => Vec::new(&env),
        };
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
        let verifier: Address = match env.storage().persistent().get::<Symbol, Address>(&Symbol::new(&env, "Verifier")) {
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
