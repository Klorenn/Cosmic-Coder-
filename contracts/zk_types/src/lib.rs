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
