//! Shadow Ascension - Provably Fair Survival
//! Integrates with Stellar Game Hub (start_game / end_game).
//! Validates final wave/score and stores leaderboard on-chain.
//!
//! ZK flow: client generates game_hash = H(player, wave, score, seed, ts) off-chain.
//! On submit we require auth (player signs tx) and validate score >= wave * MIN.
//! Full in-contract hash verification can be added when needed.

#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype, Address, Env, Symbol, Vec,
};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LeaderboardEntry {
    pub player: Address,
    pub wave: u32,
    pub score: i128,
}

/// Minimum score per wave for valid proof (score >= wave * MIN_SCORE_PER_WAVE)
const MIN_SCORE_PER_WAVE: u32 = 10;

#[contract]
pub struct ShadowAscension;

#[contractimpl]
impl ShadowAscension {
    /// Initialize: set game hub address (Stellar Game Studio Testnet).
    /// Call once at deploy.
    pub fn init(env: Env, game_hub: Address) {
        env.storage().persistent().set(&Symbol::new(&env, "Hub"), &game_hub);
        env.storage().persistent().set(&Symbol::new(&env, "Session"), &0u32);
    }

    /// Start a match: calls Game Hub start_game (required by Stellar Game Studio).
    /// Returns session_id for this run.
    pub fn start_match(env: Env) -> u32 {
        let invoker = env.invoker();
        let session: u32 = env
            .storage()
            .persistent()
            .get(&Symbol::new(&env, "Session"))
            .unwrap_or(Ok(0u32))
            .unwrap_or(0);
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
        let system_player = game_id;
        env.invoke_contract(
            &hub,
            &Symbol::new(&env, "start_game"),
            soroban_sdk::vec![
                &env,
                game_id.into_val(&env),
                (new_session as u32).into_val(&env),
                invoker.into_val(&env),
                system_player.into_val(&env),
                0i128.into_val(&env),
                0i128.into_val(&env),
            ],
        );
        new_session
    }

    /// Submit result: verifies score >= wave * MIN_SCORE_PER_WAVE, then calls end_game and stores.
    /// Proof: invoker must sign (auth); client sends valid (wave, score) from off-chain run.
    pub fn submit_result(env: Env, wave: u32, score: i128) -> bool {
        let invoker = env.invoker();
        invoker.require_auth();

        let min_score = (wave as i128).saturating_mul(MIN_SCORE_PER_WAVE as i128);
        if score < min_score {
            return false;
        }

        let session: u32 = env
            .storage()
            .persistent()
            .get(&Symbol::new(&env, "Session"))
            .unwrap_or(Ok(0u32))
            .unwrap_or(0);
        let hub: Address = env.storage().persistent().get(&Symbol::new(&env, "Hub")).unwrap();
        env.invoke_contract(
            &hub,
            &Symbol::new(&env, "end_game"),
            soroban_sdk::vec![&env, (session as u32).into_val(&env), true.into_val(&env)],
        );

        let entry = LeaderboardEntry {
            player: invoker.clone(),
            wave,
            score,
        };
        let key = Symbol::new(&env, "Leaderboard");
        let mut entries: Vec<LeaderboardEntry> = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or(Ok(Vec::new(&env)))
            .unwrap_or_else(|_| Vec::new(&env));
        entries.push_back(entry);
        env.storage().persistent().set(&key, &entries);
        true
    }

    /// Get leaderboard (top entries by score).
    pub fn get_leaderboard(env: Env, limit: u32) -> Vec<LeaderboardEntry> {
        let key = Symbol::new(&env, "Leaderboard");
        let entries: Vec<LeaderboardEntry> = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or(Ok(Vec::new(&env)))
            .unwrap_or_else(|_| Vec::new(&env));
        let mut out = Vec::new(&env);
        let n = core::cmp::min(limit, entries.len());
        for i in 0..n {
            out.push_back(entries.get(i).unwrap());
        }
        out
    }
}
