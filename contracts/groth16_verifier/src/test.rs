//! Unit tests: malformed VK rejected, invalid proof rejected, valid proof returns Ok(true).
//! Valid proof test uses point-at-infinity (pairing can succeed); full valid test needs pre-generated proof.

extern crate std;

use soroban_sdk::{vec, BytesN, Env, Vec};
use zk_types::{Groth16Error, ZkProof, ZkVerificationKey, G1_SIZE, G2_SIZE, FR_SIZE};

use crate::{Groth16Verifier, Groth16VerifierClient};

fn g1_bytes(env: &Env) -> soroban_sdk::BytesN<G1_SIZE> {
    soroban_sdk::BytesN::from_array(env, &[0u8; G1_SIZE])
}
fn g2_bytes(env: &Env) -> soroban_sdk::BytesN<G2_SIZE> {
    soroban_sdk::BytesN::from_array(env, &[0u8; G2_SIZE])
}

fn create_client(env: &Env) -> Groth16VerifierClient<'_> {
    Groth16VerifierClient::new(env, &env.register(Groth16Verifier, ()))
}

/// Malformed verifying key: ic length != pub_signals.len() + 1 → contract returns Err; host may panic.
#[test]
#[should_panic]
fn test_malformed_verifying_key_rejected() {
    let env = Env::default();
    let client = create_client(&env);

    let vk = ZkVerificationKey {
        alpha: g1_bytes(&env),
        beta: g2_bytes(&env),
        gamma: g2_bytes(&env),
        delta: g2_bytes(&env),
        ic: vec![&env, g1_bytes(&env)], // 1 element
    };
    let proof = ZkProof {
        a: g1_bytes(&env),
        b: g2_bytes(&env),
        c: g1_bytes(&env),
    };
    let s0 = soroban_sdk::BytesN::from_array(&env, &[0u8; FR_SIZE]);
    let s1 = soroban_sdk::BytesN::from_array(&env, &[0u8; FR_SIZE]);
    let pub_signals: Vec<soroban_sdk::BytesN<FR_SIZE>> = vec![&env, s0, s1];

    let _ = client.verify_proof(&vk, &proof, &pub_signals);
}

/// All-infinity VK/proof: every pairing term is the identity, so the check is `true`.
/// cosmic_coder's structural tests rely on this property.
#[test]
fn test_point_at_infinity_pairing_is_identity() {
    let env = Env::default();
    let client = create_client(&env);

    let g1 = g1_bytes(&env);
    let g2 = g2_bytes(&env);
    let vk = ZkVerificationKey {
        alpha: g1.clone(),
        beta: g2.clone(),
        gamma: g2.clone(),
        delta: g2,
        ic: vec![&env, g1.clone(), g1],
    };
    let proof = ZkProof {
        a: g1_bytes(&env),
        b: g2_bytes(&env),
        c: g1_bytes(&env),
    };
    let pub_signal = vec![&env, soroban_sdk::BytesN::from_array(&env, &[0u8; FR_SIZE])];
    assert!(client.verify_proof(&vk, &proof, &pub_signal));
}

fn hex_to_array<const N: usize>(hex: &str) -> [u8; N] {
    let hex = hex.trim_start_matches("0x");
    assert_eq!(hex.len(), N * 2);
    let mut arr = [0u8; N];
    for (i, c) in hex.as_bytes().chunks(2).enumerate() {
        arr[i] = u8::from_str_radix(std::str::from_utf8(c).unwrap(), 16).unwrap();
    }
    arr
}

/// Real snarkjs proof (circuits/build/contract_proof.json, from `npm run zk:proof`) verifies,
/// and the same proof with one tampered public signal is rejected. Skipped if the file is absent.
#[test]
fn test_real_proof_accepts_and_tampered_signal_rejects() {
    let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").unwrap();
    let path = std::path::Path::new(&manifest_dir).join("../../circuits/build/contract_proof.json");
    if !path.exists() {
        return;
    }
    let json: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
    let p = json.get("proof").unwrap();
    let v = json.get("vk").unwrap();
    let s = |o: &serde_json::Value, k: &str| std::string::String::from(o.get(k).unwrap().as_str().unwrap());

    let env = Env::default();
    let client = create_client(&env);
    let proof = ZkProof {
        a: BytesN::from_array(&env, &hex_to_array::<64>(&s(p, "a"))),
        b: BytesN::from_array(&env, &hex_to_array::<128>(&s(p, "b"))),
        c: BytesN::from_array(&env, &hex_to_array::<64>(&s(p, "c"))),
    };
    let mut ic = Vec::new(&env);
    for h in v.get("ic").unwrap().as_array().unwrap() {
        ic.push_back(BytesN::from_array(&env, &hex_to_array::<64>(h.as_str().unwrap())));
    }
    let vk = ZkVerificationKey {
        alpha: BytesN::from_array(&env, &hex_to_array::<64>(&s(v, "alpha"))),
        beta: BytesN::from_array(&env, &hex_to_array::<128>(&s(v, "beta"))),
        gamma: BytesN::from_array(&env, &hex_to_array::<128>(&s(v, "gamma"))),
        delta: BytesN::from_array(&env, &hex_to_array::<128>(&s(v, "delta"))),
        ic,
    };
    let mut signals = Vec::new(&env);
    for h in json.get("pub_signals").unwrap().as_array().unwrap() {
        signals.push_back(BytesN::from_array(&env, &hex_to_array::<32>(h.as_str().unwrap())));
    }
    assert!(client.verify_proof(&vk, &proof, &signals));

    // Claim a higher score (signal index 2) with the same proof.
    let mut score = signals.get(2).unwrap().to_array();
    score[31] = score[31].wrapping_add(1);
    signals.set(2, BytesN::from_array(&env, &score));
    assert!(!client.verify_proof(&vk, &proof, &signals));
}

/// BN254 scalar field modulus r, big-endian.
const BN254_R: [u8; 32] = [
    0x30, 0x64, 0x4e, 0x72, 0xe1, 0x31, 0xa0, 0x29, 0xb8, 0x50, 0x45, 0xb6, 0x81, 0x81, 0x58, 0x5d,
    0x28, 0x33, 0xe8, 0x48, 0x79, 0xb9, 0x70, 0x91, 0x43, 0xe1, 0xf5, 0x93, 0xf0, 0x00, 0x00, 0x01,
];

fn infinity_vk_and_proof(env: &Env) -> (ZkVerificationKey, ZkProof) {
    let vk = ZkVerificationKey {
        alpha: g1_bytes(env),
        beta: g2_bytes(env),
        gamma: g2_bytes(env),
        delta: g2_bytes(env),
        ic: vec![env, g1_bytes(env), g1_bytes(env)],
    };
    let proof = ZkProof {
        a: g1_bytes(env),
        b: g2_bytes(env),
        c: g1_bytes(env),
    };
    (vk, proof)
}

/// A public signal >= r is the same field element as `signal - r` for the host, so accepting it
/// lets a caller mint a second encoding of one proof (anti-replay bypass). It must be rejected.
#[test]
fn test_public_signal_equal_to_r_is_rejected() {
    let env = Env::default();
    let client = create_client(&env);
    let (vk, proof) = infinity_vk_and_proof(&env);
    let signals = vec![&env, BytesN::from_array(&env, &BN254_R)];
    assert_eq!(
        client.try_verify_proof(&vk, &proof, &signals),
        Err(Ok(Groth16Error::NonCanonicalPublicInput))
    );
}

#[test]
fn test_public_signal_above_r_is_rejected() {
    let env = Env::default();
    let client = create_client(&env);
    let (vk, proof) = infinity_vk_and_proof(&env);
    let signals = vec![&env, BytesN::from_array(&env, &[0xffu8; FR_SIZE])];
    assert_eq!(
        client.try_verify_proof(&vk, &proof, &signals),
        Err(Ok(Groth16Error::NonCanonicalPublicInput))
    );
}

/// r - 1 is the largest canonical scalar: it passes the range check (and the infinity pairing).
#[test]
fn test_public_signal_r_minus_one_passes_range_check() {
    let env = Env::default();
    let client = create_client(&env);
    let (vk, proof) = infinity_vk_and_proof(&env);
    let mut r_minus_one = BN254_R;
    r_minus_one[31] -= 1;
    let signals = vec![&env, BytesN::from_array(&env, &r_minus_one)];
    assert!(client.verify_proof(&vk, &proof, &signals));
}
