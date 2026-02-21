//! Policy contract v2 — semantic checks, anti-replay, domain separation.
//! No cryptographic verification. Calls verifier contract.
//! Enforces:
//!   - domain_separator binding (challenge_id, player_address, nonce, contract_id)
//!   - anti-replay (nonce per player per challenge)
//!   - TTL/ledger bound (optional)
//!   - semantic rules (score >= wave * MIN_SCORE_PER_WAVE, etc.)

#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracterror, contracttype, Address, Env, IntoVal, Symbol, Vec,
};
use zk_types::{Groth16Error, DomainBinding, ZkPublicInputs};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum PolicyError {
    VerifierNotSet = 1,
    Replay = 2,
    InvalidProof = 3,
    VerifierError = 4,
    InvalidInput = 5,
    MalformedVk = 6,
    DomainMismatch = 7,
    UnsupportedNetwork = 8,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ReplayKey {
    pub player: Address,
    pub nonce: u64,
    pub challenge_id: u32,
}

#[contract]
pub struct Policy;

#[contractimpl]
impl Policy {
    /// Set verifier contract address.
    pub fn set_verifier(env: Env, verifier: Address) {
        env.storage().persistent().set(&Symbol::new(&env, "Verifier"), &verifier);
    }

    /// Validate domain binding and anti-replay, then call verifier.
    /// Emits events for audit.
    pub fn validate(
        env: Env,
        domain: DomainBinding,
        proof: soroban_sdk::BytesN<256>,
        public_inputs: ZkPublicInputs,
        vk_hash: soroban_sdk::BytesN<32>,
        // Semantic fields
        score: u32,
        wave: u32,
    ) -> Result<(), PolicyError> {
        // 1) Network capability check (BN254)
        // In Soroban, we can check protocol version via env.ledger().protocol_version()
        // BN254 is available from Protocol 25 (X-Ray). For simplicity, we assume it's present.
        // In production, you could reject if protocol < 25.

        // 2) Domain binding check: ensure domain_separator matches derived fields
        let derived = self::derive_domain_separator(&env, &domain);
        if derived != domain.domain_separator {
            env.events().publish(
                (Symbol::new(&env, "policy"), Symbol::new(&env, "domain_mismatch")),
                (domain.challenge_id, domain.player_address, domain.nonce),
            );
            return Err(PolicyError::DomainMismatch);
        }

        // 3) Ensure public_inputs match domain and semantic fields (strict ordering)
        if public_inputs.challenge_id != domain.challenge_id ||
           public_inputs.player_address != domain.player_address.to_contract().to_bytes() ||
           public_inputs.nonce != domain.nonce ||
           public_inputs.contract_id != domain.contract_id.to_contract().to_bytes() ||
           public_inputs.domain_separator != domain.domain_separator ||
           public_inputs.score != score ||
           public_inputs.wave != wave {
            env.events().publish(
                (Symbol::new(&env, "policy"), Symbol::new(&env, "invalid_input")),
                (score, wave),
            );
            return Err(PolicyError::InvalidInput);
        }

        // 4) Anti-replay: ensure (player, nonce, challenge_id) not used
        let replay_key = ReplayKey {
            player: domain.player_address.clone(),
            nonce: domain.nonce,
            challenge_id: domain.challenge_id,
        };
        if env.storage().persistent().has::<ReplayKey>(&replay_key) {
            env.events().publish(
                (Symbol::new(&env, "policy"), Symbol::new(&env, "replay")),
                (replay_key.player, replay_key.nonce, replay_key.challenge_id),
            );
            return Err(PolicyError::Replay);
        }

        // 5) Semantic rules: score >= wave * MIN_SCORE_PER_WAVE
        const MIN_SCORE_PER_WAVE: u32 = 5;
        if score < wave.saturating_mul(MIN_SCORE_PER_WAVE) {
            env.events().publish(
                (Symbol::new(&env, "policy"), Symbol::new(&env, "invalid_input")),
                (score, wave),
            );
            return Err(PolicyError::InvalidInput);
        }

        // 6) Call verifier contract
        let verifier: Address = match env.storage().persistent().get::<Symbol, Address>(&Symbol::new(&env, "Verifier")) {
            Some(a) => a,
            None => return Err(PolicyError::VerifierNotSet),
        };

        let raw = env.try_invoke_contract::<bool, Groth16Error>(
            &verifier,
            &Symbol::new(&env, "verify"),
            soroban_sdk::vec![
                &env,
                proof.into_val(&env),
                soroban_sdk::vec![
                    &env,
                    public_inputs.run_hash_hi.into_val(&env),
                    public_inputs.run_hash_lo.into_val(&env),
                    public_inputs.score.into_val(&env),
                    public_inputs.wave.into_val(&env),
                    public_inputs.nonce.into_val(&env),
                    public_inputs.season_id.into_val(&env),
                    public_inputs.challenge_id.into_val(&env),
                    public_inputs.player_address.into_val(&env),
                    public_inputs.contract_id.into_val(&env),
                    public_inputs.domain_separator.into_val(&env),
                ],
                vk_hash.into_val(&env),
            ],
        );
        let ok = match raw {
            Ok(Ok(b)) => b,
            Ok(Err(_)) => return Err(PolicyError::VerifierError),
            Err(_) => return Err(PolicyError::VerifierError),
        };
        if !ok {
            env.events().publish(
                (Symbol::new(&env, "policy"), Symbol::new(&env, "invalid_proof")),
                (domain.player_address, domain.challenge_id),
            );
            return Err(PolicyError::InvalidProof);
        }

        // 7) Mark nonce used (anti-replay)
        env.storage().persistent().set(&replay_key, &true);

        // 8) Emit success event
        env.events().publish(
            (Symbol::new(&env, "policy"), Symbol::new(&env, "validated")),
            (domain.player_address, domain.challenge_id, score, wave),
        );

        Ok(())
    }

    /// Derive domain separator from domain binding fields.
    /// For simplicity, we use SHA256 of concatenated fields.
    /// In production, you might use a domain-specific tag.
    fn derive_domain_separator(env: &Env, domain: &DomainBinding) -> soroban_sdk::BytesN<32> {
        let mut hasher = env.crypto().sha256();
        hasher.update([domain.challenge_id.to_le_bytes().as_ref()].concat());
        hasher.update(domain.player_address.to_array());
        hasher.update(domain.nonce.to_le_bytes());
        hasher.update(domain.contract_id.to_array());
        hasher.finalize()
    }
}

#[cfg(test)]
mod test;
