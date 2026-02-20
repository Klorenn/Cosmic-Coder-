//! Application contract v2 — state transition gated by verifier+policy.
//! No crypto, no anti-replay. Calls policy.validate, then updates leaderboard/state.
//! Emits final event only on successful policy validation.

#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracterror, contracttype, Address, Env, IntoVal, Symbol, Vec,
};
use zk_types::Groth16Error;
use policy::{DomainBinding, PolicyError};
use zk_types::ZkPublicInputs;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum ApplicationError {
    PolicyNotSet = 1,
    PolicyRejected = 2,
    InvalidInput = 3,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LeaderboardEntry {
    pub player: Address,
    pub wave: u32,
    pub score: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LeaderboardKey {
    pub season_id: u32,
}

#[contract]
pub struct Application;

#[contractimpl]
impl Application {
    /// Set policy contract address.
    pub fn set_policy(env: Env, policy: Address) {
        env.storage().persistent().set(&Symbol::new(&env, "Policy"), &policy);
    }

    /// Submit proof: calls policy.validate, then updates leaderboard if approved.
    /// Emits ZkRunSubmitted on success.
    pub fn submit_proof(
        env: Env,
        domain: DomainBinding,
        proof: soroban_sdk::BytesN<256>,
        public_inputs: ZkPublicInputs,
        vk_hash: soroban_sdk::BytesN<32>,
        // Semantic fields
        score: u32,
        wave: u32,
        season_id: u32,
    ) -> Result<(), ApplicationError> {
        // 1) Call policy contract
        let policy: Address = match env.storage().persistent().get::<Symbol, Address>(&Symbol::new(&env, "Policy")) {
            Some(a) => a,
            None => return Err(ApplicationError::PolicyNotSet),
        };

        let raw = env.try_invoke_contract::<(), PolicyError>(
            &policy,
            &Symbol::new(&env, "validate"),
            soroban_sdk::vec![
                &env,
                domain.into_val(&env),
                proof.into_val(&env),
                public_inputs.into_val(&env),
                vk_hash.into_val(&env),
                score.into_val(&env),
                wave.into_val(&env),
            ],
        );
        match raw {
            Ok(Ok(())) => {}
            Ok(Err(e)) => {
                env.events().publish(
                    (Symbol::new(&env, "app"), Symbol::new(&env, "policy_reject")),
                    (domain.player_address, domain.challenge_id, e as u32),
                );
                return Err(ApplicationError::PolicyRejected);
            }
            Err(_) => return Err(ApplicationError::PolicyRejected),
        }

        // 2) Update leaderboard (only if higher score for this player in this season)
        let lb_key = LeaderboardKey { season_id };
        let mut entries: Vec<LeaderboardEntry> = match env.storage().persistent().get::<LeaderboardKey, Vec<LeaderboardEntry>>(&lb_key) {
            Some(v) => v,
            None => Vec::new(&env),
        };
        let mut found = false;
        let n = entries.len();
        for i in 0..n {
            let e = entries.get(i).unwrap();
            if e.player == domain.player_address {
                found = true;
                if score > e.score {
                    entries.set(i as u32, LeaderboardEntry {
                        player: domain.player_address.clone(),
                        wave,
                        score,
                    });
                }
                break;
            }
        }
        if !found {
            entries.push_back(LeaderboardEntry {
                player: domain.player_address.clone(),
                wave,
                score,
            });
        }
        env.storage().persistent().set(&lb_key, &entries);

        // 3) Emit final event
        env.events().publish(
            (Symbol::new(&env, "app"), Symbol::new(&env, "zk_run_submitted")),
            (domain.player_address, season_id, score, wave, domain.domain_separator),
        );

        Ok(())
    }

    /// Get leaderboard for a season (read-only).
    pub fn get_leaderboard(env: Env, season_id: u32) -> Vec<LeaderboardEntry> {
        let lb_key = LeaderboardKey { season_id };
        match env.storage().persistent().get::<LeaderboardKey, Vec<LeaderboardEntry>>(&lb_key) {
            Some(v) => v,
            None => Vec::new(&env),
        }
    }
}

#[cfg(test)]
mod test;
