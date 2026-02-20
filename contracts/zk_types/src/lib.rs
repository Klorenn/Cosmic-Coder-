//! Shared ZK types for Groth16 BN254 verification.
//! Used by groth16_verifier and shadow_ascension. No duplicated definitions.
//! CAP-0074 (BN254); serialization: G1 = 64 bytes, G2 = 128 bytes, Fr = 32 bytes.

#![no_std]

use soroban_sdk::{contracterror, contracttype, BytesN, Vec};

/// BN254 G1 serialized size (Ethereum-compatible uncompressed).
pub const G1_SIZE: usize = 64;
/// BN254 G2 serialized size.
pub const G2_SIZE: usize = 128;
/// BN254 scalar (Fr) serialized size.
pub const FR_SIZE: usize = 32;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Groth16Error {
    InvalidProof = 0,
    InvalidVerificationKey = 1,
    InvalidPublicInputs = 2,
    /// vk.ic length must equal pub_signals.len() + 1
    MalformedVerifyingKey = 3,
}

#[derive(Clone)]
#[contracttype]
pub struct ZkProof {
    pub a: BytesN<64>,
    pub b: BytesN<128>,
    pub c: BytesN<64>,
}

#[derive(Clone)]
#[contracttype]
pub struct ZkVerificationKey {
    pub alpha: BytesN<64>,
    pub beta: BytesN<128>,
    pub gamma: BytesN<128>,
    pub delta: BytesN<128>,
    pub ic: Vec<BytesN<64>>,
}

/// Domain binding for v2 ZK proofs.
#[derive(Clone)]
#[contracttype]
pub struct DomainBinding {
    pub challenge_id: u32,
    pub player_address: soroban_sdk::Address,
    pub nonce: u64,
    pub contract_id: soroban_sdk::Address,
    pub domain_separator: BytesN<32>,
}

/// Public inputs order matching GameRunV2.circom outputs.
/// Used to map between circuit and contracts.
#[derive(Clone)]
#[contracttype]
pub struct ZkPublicInputs {
    pub run_hash_hi: BytesN<32>,
    pub run_hash_lo: BytesN<32>,
    pub score: u32,
    pub wave: u32,
    pub nonce: u64,
    pub season_id: u32,
    pub challenge_id: u32,
    pub player_address: BytesN<32>,
    pub contract_id: BytesN<32>,
    pub domain_separator: BytesN<32>,
}
