//! UltraHonk (Noir) verifier — STRUCTURAL STUB.
//!
//! WARNING: this contract does NOT perform cryptographic UltraHonk verification. It only
//! checks the proof blob framing (`u32_be(total_fields) || fields`, each field 32 bytes, field
//! count matching the header) and records the blob's sha256 as a proof id. Any well-formed blob
//! passes. It keeps the verifier interface stable (`verify_proof_with_stored_vk`) so a real
//! verifier can be swapped in by the policy admin (`cosmic_coder::set_noir_verifier`).
//! Ranked results routed through this stub are NOT trustless.

#![no_std]

use soroban_sdk::{contract, contracterror, contractimpl, contracttype, Address, Bytes, BytesN, Env};

/// Ledger counts (~5 s per ledger).
const DAY_IN_LEDGERS: u32 = 17_280;
const INSTANCE_BUMP: u32 = 30 * DAY_IN_LEDGERS;
const INSTANCE_THRESHOLD: u32 = INSTANCE_BUMP - DAY_IN_LEDGERS;
/// Proof ids are informational (`is_verified`); they live in persistent storage so the
/// instance entry never grows with usage.
const PROOF_ID_BUMP: u32 = 30 * DAY_IN_LEDGERS;

const HEADER_LEN: u32 = 4;
const FIELD_LEN: u32 = 32;

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

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    Admin,
    Vk,
    VkHash,
    Proof(BytesN<32>),
}

/// Structural framing check shared by both entry points.
fn check_blob(proof_blob: &Bytes) -> Result<(), Error> {
    if proof_blob.len() < HEADER_LEN {
        return Err(Error::ProofParseError);
    }
    let payload_len = proof_blob.len() - HEADER_LEN;
    // FIELD_LEN is a power of two: alignment check without `%` (is_multiple_of needs Rust 1.87).
    if payload_len == 0 || payload_len & (FIELD_LEN - 1) != 0 {
        return Err(Error::ProofParseError);
    }
    let mut header = [0u8; 4];
    proof_blob.slice(0..HEADER_LEN).copy_into_slice(&mut header);
    if u32::from_be_bytes(header) != payload_len / FIELD_LEN {
        return Err(Error::ProofParseError);
    }
    Ok(())
}

#[contractimpl]
impl UltraHonkVerifier {
    pub fn __constructor(env: Env, admin: Address) {
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage()
            .instance()
            .extend_ttl(INSTANCE_THRESHOLD, INSTANCE_BUMP);
    }

    pub fn get_admin(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("admin set in constructor")
    }

    /// Stores the VK payload and caches its sha256. Admin only.
    pub fn set_vk(env: Env, vk_json: Bytes) -> Result<BytesN<32>, Error> {
        Self::get_admin(env.clone()).require_auth();
        if vk_json.is_empty() {
            return Err(Error::VkParseError);
        }
        let vk_hash: BytesN<32> = env.crypto().sha256(&vk_json).into();
        let s = env.storage().instance();
        s.set(&DataKey::Vk, &vk_json);
        s.set(&DataKey::VkHash, &vk_hash);
        s.extend_ttl(INSTANCE_THRESHOLD, INSTANCE_BUMP);
        Ok(vk_hash)
    }

    pub fn get_vk_hash(env: Env) -> Option<BytesN<32>> {
        env.storage().instance().get(&DataKey::VkHash)
    }

    /// Structural check only (see module docs). Returns sha256(proof_blob) as proof id.
    pub fn verify_proof(env: Env, vk_json: Bytes, proof_blob: Bytes) -> Result<BytesN<32>, Error> {
        if vk_json.is_empty() {
            return Err(Error::VkParseError);
        }
        check_blob(&proof_blob)?;
        let proof_id: BytesN<32> = env.crypto().sha256(&proof_blob).into();
        let key = DataKey::Proof(proof_id.clone());
        env.storage().persistent().set(&key, &true);
        env.storage()
            .persistent()
            .extend_ttl(&key, PROOF_ID_BUMP, PROOF_ID_BUMP);
        Ok(proof_id)
    }

    pub fn verify_proof_with_stored_vk(env: Env, proof_blob: Bytes) -> Result<BytesN<32>, Error> {
        let vk_json: Bytes = env
            .storage()
            .instance()
            .get(&DataKey::Vk)
            .ok_or(Error::VkNotSet)?;
        env.storage()
            .instance()
            .extend_ttl(INSTANCE_THRESHOLD, INSTANCE_BUMP);
        Self::verify_proof(env, vk_json, proof_blob)
    }

    pub fn is_verified(env: Env, proof_id: BytesN<32>) -> bool {
        env.storage().persistent().has(&DataKey::Proof(proof_id))
    }
}

#[cfg(test)]
mod test;
