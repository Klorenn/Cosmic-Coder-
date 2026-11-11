//! Shared ZK types for Groth16 BN254 verification.
//! Used by groth16_verifier and cosmic_coder. No duplicated definitions.
//! `PartialEq` on the VK lets cosmic_coder pin the caller-supplied VK to the admin-registered one.
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
    /// A public signal is >= the BN254 scalar modulus r (non-canonical encoding).
    NonCanonicalPublicInput = 4,
}

/// BN254 scalar field modulus r, big-endian (32 bytes).
pub const BN254_FR_MODULUS: [u8; FR_SIZE] = [
    0x30, 0x64, 0x4e, 0x72, 0xe1, 0x31, 0xa0, 0x29, 0xb8, 0x50, 0x45, 0xb6, 0x81, 0x81, 0x58, 0x5d,
    0x28, 0x33, 0xe8, 0x48, 0x79, 0xb9, 0x70, 0x91, 0x43, 0xe1, 0xf5, 0x93, 0xf0, 0x00, 0x00, 0x01,
];

/// True when the big-endian 32-byte value is a canonical BN254 scalar (strictly below r).
/// Byte arrays of equal length compare lexicographically, i.e. as big-endian integers.
pub fn is_canonical_fr(be: &[u8; FR_SIZE]) -> bool {
    *be < BN254_FR_MODULUS
}

#[derive(Clone, Debug, Eq, PartialEq)]
#[contracttype]
pub struct ZkProof {
    pub a: BytesN<64>,
    pub b: BytesN<128>,
    pub c: BytesN<64>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
#[contracttype]
pub struct ZkVerificationKey {
    pub alpha: BytesN<64>,
    pub beta: BytesN<128>,
    pub gamma: BytesN<128>,
    pub delta: BytesN<128>,
    pub ic: Vec<BytesN<64>>,
}
