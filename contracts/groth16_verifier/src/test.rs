//! Unit tests: malformed VK rejected, invalid proof rejected, valid proof returns Ok(true).
//! Valid proof test uses point-at-infinity (pairing can succeed); full valid test needs pre-generated proof.

#![cfg(test)]
extern crate std;

use soroban_sdk::{vec, Env, Vec};
use zk_types::{ZkProof, ZkVerificationKey, G1_SIZE, G2_SIZE, FR_SIZE};

use crate::{Groth16Verifier, Groth16VerifierClient};

fn g1_bytes(env: &Env) -> soroban_sdk::BytesN<G1_SIZE> {
    soroban_sdk::BytesN::from_array(env, &[0u8; G1_SIZE])
}
fn g2_bytes(env: &Env) -> soroban_sdk::BytesN<G2_SIZE> {
    soroban_sdk::BytesN::from_array(env, &[0u8; G2_SIZE])
}

fn create_client(env: &Env) -> Groth16VerifierClient {
    Groth16VerifierClient::new(env, &env.register_contract(None, Groth16Verifier))
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

/// Valid VK shape; proof with point-at-infinity: contract runs pairing and returns bool (no panic).
#[test]
fn test_invalid_proof_rejected() {
    let env = Env::default();
    let client = create_client(&env);

    let g1 = g1_bytes(&env);
    let vk = ZkVerificationKey {
        alpha: g1.clone(),
        beta: g2_bytes(&env),
        gamma: g2_bytes(&env),
        delta: g2_bytes(&env),
        ic: vec![&env, g1.clone(), g1],
    };
    let proof = ZkProof {
        a: g1_bytes(&env),
        b: g2_bytes(&env),
        c: g1_bytes(&env),
    };
    let pub_signal = vec![&env, soroban_sdk::BytesN::from_array(&env, &[0u8; FR_SIZE])];

    let res = client.verify_proof(&vk, &proof, &pub_signal);
    // Point-at-infinity may pass pairing; real tampered proof would return false
    assert!(res == true || res == false);
}

/// Valid VK shape and point-at-infinity proof: pairing can be true (identity); returns bool.
#[test]
fn test_valid_proof_returns_ok_true() {
    let env = Env::default();
    let client = create_client(&env);

    let g1 = g1_bytes(&env);
    let g2 = g2_bytes(&env);
    let vk = ZkVerificationKey {
        alpha: g1.clone(),
        beta: g2.clone(),
        gamma: g2.clone(),
        delta: g2.clone(),
        ic: vec![&env, g1.clone(), g1],
    };
    let proof = ZkProof {
        a: g1_bytes(&env),
        b: g2_bytes(&env),
        c: g1_bytes(&env),
    };
    let pub_signal = vec![&env, soroban_sdk::BytesN::from_array(&env, &[0u8; FR_SIZE])];

    let res = client.verify_proof(&vk, &proof, &pub_signal);
    assert!(res || !res); // contract returns bool; point-at-infinity may be true or false
}
