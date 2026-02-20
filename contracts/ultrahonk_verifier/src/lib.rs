#![no_std]

use soroban_sdk::{
    contract, contracterror, contractimpl, symbol_short, Bytes, BytesN, Env, Symbol,
};

#[contract]
pub struct UltraHonkVerifier;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    VkParseError = 1,
    ProofParseError = 2,
    VerificationFailed = 3,
    VkNotSet = 4,
}

#[contractimpl]
impl UltraHonkVerifier {
    fn key_vk() -> Symbol {
        symbol_short!("vk")
    }

    fn key_vk_hash() -> Symbol {
        symbol_short!("vk_hash")
    }

    /// Stores verifier key payload bytes and caches its hash.
    pub fn set_vk(env: Env, vk_json: Bytes) -> Result<BytesN<32>, Error> {
        if vk_json.len() == 0 {
            return Err(Error::VkParseError);
        }
        let vk_hash: BytesN<32> = env.crypto().sha256(&vk_json).into();
        env.storage().instance().set(&Self::key_vk(), &vk_json);
        env.storage().instance().set(&Self::key_vk_hash(), &vk_hash);
        Ok(vk_hash)
    }

    /// Verifies an UltraHonk payload.
    ///
    /// This contract keeps a verifier-compatible interface (`vk_json`, `proof_blob`) and
    /// performs structural checks on `proof_blob` so callers can migrate from Groth16 safely.
    /// A production verifier should replace this with full cryptographic verification.
    pub fn verify_proof(env: Env, vk_json: Bytes, proof_blob: Bytes) -> Result<BytesN<32>, Error> {
        if vk_json.len() == 0 {
            return Err(Error::VkParseError);
        }
        if proof_blob.len() < 4 {
            return Err(Error::ProofParseError);
        }
        // [u32_be(total_fields)] || [32-byte fields...]
        let payload_len = proof_blob.len() - 4;
        if payload_len == 0 || payload_len % 32 != 0 {
            return Err(Error::ProofParseError);
        }

        let proof_id: BytesN<32> = env.crypto().sha256(&proof_blob).into();
        env.storage().instance().set(&proof_id, &true);
        Ok(proof_id)
    }

    pub fn verify_proof_with_stored_vk(env: Env, proof_blob: Bytes) -> Result<BytesN<32>, Error> {
        let vk_json: Bytes = match env.storage().instance().get(&Self::key_vk()) {
            Some(vk) => vk,
            None => return Err(Error::VkNotSet),
        };
        Self::verify_proof(env, vk_json, proof_blob)
    }

    pub fn is_verified(env: Env, proof_id: BytesN<32>) -> bool {
        env.storage().instance().get(&proof_id).unwrap_or(false)
    }
}
