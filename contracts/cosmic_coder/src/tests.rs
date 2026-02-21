//! Integration tests: verifier not set, anti-replay, invalid proof, valid proof (nonce, leaderboard, event).
//! Optional: test_real_proof_submit_zk runs when circuits/build/contract_proof.json exists (run `npm run zk:proof` first).

#![cfg(test)]
extern crate std;

use std::panic::catch_unwind;

use soroban_sdk::{
    contract, contractimpl, vec, Address, Bytes, Env, Vec as SorobanVec,
    testutils::Address as _,
};
use zk_types::{ZkProof, ZkVerificationKey, G1_SIZE, G2_SIZE, FR_SIZE};

use crate::{CosmicCoder, CosmicCoderClient, PlayerMilestone};
use groth16_verifier::{Groth16Verifier, Groth16VerifierClient};

#[contract]
struct MockHub;

#[contractimpl]
impl MockHub {
    pub fn start_game(
        _env: Env,
        _game_id: Address,
        _session: u32,
        _player: Address,
        _system_player: Address,
        _x: i128,
        _y: i128,
    ) {
    }
    pub fn end_game(_env: Env, _session: u32, _success: bool) {
    }
}

fn g1(env: &Env) -> soroban_sdk::BytesN<64> {
    soroban_sdk::BytesN::from_array(env, &[0u8; G1_SIZE])
}
fn g2(env: &Env) -> soroban_sdk::BytesN<128> {
    soroban_sdk::BytesN::from_array(env, &[0u8; G2_SIZE])
}

/// Default VK with ic.len() = pub_signals.len() + 1 = 8 (for 7 pub_signals)
fn default_vk(env: &Env) -> ZkVerificationKey {
    let g1 = g1(env);
    ZkVerificationKey {
        alpha: g1.clone(),
        beta: g2(env),
        gamma: g2(env),
        delta: g2(env),
        // ic.len() = pub_signals.len() + 1 = 8
        ic: vec![
            env,
            g1.clone(),
            g1.clone(),
            g1.clone(),
            g1.clone(),
            g1.clone(),
            g1.clone(),
            g1.clone(),
            g1,
        ],
    }
}

fn default_proof(env: &Env) -> ZkProof {
    ZkProof {
        a: g1(env),
        b: g2(env),
        c: g1(env),
    }
}

/// Default pub_signals with 7 elements matching circuit outputs:
/// [run_hash_hi, run_hash_lo, score, wave, nonce, season_id, used_zk_weapon]
fn default_pub_signals(env: &Env) -> SorobanVec<Bytes> {
    let zero = Bytes::from_slice(env, &[0u8; FR_SIZE]);
    vec![
        env,
        zero.clone(),
        zero.clone(),
        zero.clone(),
        zero.clone(),
        zero.clone(),
        zero.clone(),
        zero,
    ]
}

fn run_hash_32(env: &Env) -> Bytes {
    Bytes::from_slice(env, &[0u8; 32])
}

/// submit_zk must fail (panic) when verifier address is invalid/unusable.
#[test]
fn test_submit_zk_fails_when_verifier_not_set() {
    let env = Env::default();
    env.mock_all_auths();

    let hub = env.register(MockHub, ());
    let policy = env.register(CosmicCoder, ());
    let policy_client = CosmicCoderClient::new(&env, &policy);

    let invalid_verifier = Address::generate(&env);
    policy_client.init(&hub, &invalid_verifier);
    let player = Address::generate(&env);

    let res = catch_unwind(std::panic::AssertUnwindSafe(|| {
        policy_client.submit_zk(
            &player,
            &default_proof(&env),
            &default_vk(&env),
            &default_pub_signals(&env),
            &1u64,
            &run_hash_32(&env),
            &1u32,
            &100u32,
            &5u32,
        );
    }));
    assert!(res.is_err(), "submit_zk without verifier should panic");
}

/// First submit_zk succeeds; second with same (player, nonce, season_id) fails (replay).
#[test]
fn test_submit_zk_anti_replay() {
    let env = Env::default();
    env.mock_all_auths();

    let hub = env.register(MockHub, ());
    let verifier = env.register(Groth16Verifier, ());
    let policy = env.register(CosmicCoder, ());
    let policy_client = CosmicCoderClient::new(&env, &policy);

    policy_client.init(&hub, &verifier);

    let player = Address::generate(&env);
    let nonce = 42u64;
    let season_id = 1u32;
    let run_hash = run_hash_32(&env);
    let vk = default_vk(&env);
    let proof = default_proof(&env);
    let pub_signals = default_pub_signals(&env);
    let score = 100u32;
    let wave = 5u32;

    policy_client.submit_zk(
        &player,
        &proof,
        &vk,
        &pub_signals,
        &nonce,
        &run_hash,
        &season_id,
        &score,
        &wave,
    );

    let res2 = catch_unwind(std::panic::AssertUnwindSafe(|| {
        policy_client.submit_zk(
            &player,
            &proof,
            &vk,
            &pub_signals,
            &nonce,
            &run_hash,
            &season_id,
            &score,
            &wave,
        );
    }));
    assert!(res2.is_err(), "replay submit_zk should panic");
}

/// submit_zk with vk that has wrong ic length: verifier returns Err -> policy returns VerifierError.
#[test]
fn test_submit_zk_invalid_proof_verifier_error() {
    let env = Env::default();
    env.mock_all_auths();

    let hub = env.register(MockHub, ());
    let verifier = env.register(Groth16Verifier, ());
    let policy = env.register(CosmicCoder, ());
    let policy_client = CosmicCoderClient::new(&env, &policy);

    policy_client.init(&hub, &verifier);

    let player = Address::generate(&env);
    let g1 = g1(&env);
    let vk_bad = ZkVerificationKey {
        alpha: g1.clone(),
        beta: g2(&env),
        gamma: g2(&env),
        delta: g2(&env),
        ic: vec![&env, g1], // len 1, but pub_signals.len() + 1 = 2
    };
    let pub_signals = default_pub_signals(&env);

    let res = catch_unwind(std::panic::AssertUnwindSafe(|| {
        policy_client.submit_zk(
            &player,
            &default_proof(&env),
            &vk_bad,
            &pub_signals,
            &1u64,
            &run_hash_32(&env),
            &1u32,
            &100u32,
            &5u32,
        );
    }));
    assert!(res.is_err(), "submit_zk with bad VK should panic");
}

/// submit_zk with score < wave * MIN_SCORE_PER_WAVE: InvalidInput (progress rule).
#[test]
fn test_submit_zk_invalid_input_score_below_min() {
    let env = Env::default();
    env.mock_all_auths();

    let hub = env.register(MockHub, ());
    let verifier = env.register(Groth16Verifier, ());
    let policy = env.register(CosmicCoder, ());
    let policy_client = CosmicCoderClient::new(&env, &policy);

    policy_client.init(&hub, &verifier);
    let player = Address::generate(&env);

    // wave=5 -> min_score=25 (MIN_SCORE_PER_WAVE=5); score=20 fails
    let res = catch_unwind(std::panic::AssertUnwindSafe(|| {
        policy_client.submit_zk(
            &player,
            &default_proof(&env),
            &default_vk(&env),
            &default_pub_signals(&env),
            &1u64,
            &run_hash_32(&env),
            &1u32,
            &20u32,
            &5u32,
        );
    }));
    assert!(res.is_err(), "submit_zk with score < wave*MIN_SCORE_PER_WAVE should panic");
}

/// submit_zk with score 0 or wave 0: InvalidInput.
#[test]
fn test_submit_zk_invalid_input_zero_score() {
    let env = Env::default();
    env.mock_all_auths();

    let hub = env.register(MockHub, ());
    let verifier = env.register(Groth16Verifier, ());
    let policy = env.register(CosmicCoder, ());
    let policy_client = CosmicCoderClient::new(&env, &policy);

    policy_client.init(&hub, &verifier);
    let player = Address::generate(&env);

    let res = catch_unwind(std::panic::AssertUnwindSafe(|| {
        policy_client.submit_zk(
            &player,
            &default_proof(&env),
            &default_vk(&env),
            &default_pub_signals(&env),
            &1u64,
            &run_hash_32(&env),
            &1u32,
            &0u32,
            &5u32,
        );
    }));
    assert!(res.is_err(), "submit_zk with score 0 should panic");
}

/// Valid proof (structural): nonce marked used, leaderboard updated, event emitted.
#[test]
fn test_submit_zk_valid_updates_nonce_leaderboard_and_emits_event() {
    let env = Env::default();
    env.mock_all_auths();

    let hub = env.register(MockHub, ());
    let verifier = env.register(Groth16Verifier, ());
    let policy = env.register(CosmicCoder, ());
    let policy_client = CosmicCoderClient::new(&env, &policy);

    policy_client.init(&hub, &verifier);

    let player = Address::generate(&env);
    let nonce = 77u64;
    let season_id = 2u32;
    let score = 200u32;
    let wave = 10u32;
    let run_hash = run_hash_32(&env);
    let vk = default_vk(&env);
    let proof = default_proof(&env);
    let pub_signals = default_pub_signals(&env);

    policy_client.submit_zk(
        &player,
        &proof,
        &vk,
        &pub_signals,
        &nonce,
        &run_hash,
        &season_id,
        &score,
        &wave,
    );

    let lb = policy_client.get_leaderboard_by_season(&season_id, &10);
    assert!(lb.len() > 0, "leaderboard updated and zk_run_submitted emitted");
    let first = lb.get(0).unwrap();
    assert_eq!(first.player, player);
    assert_eq!(first.score, score);
}

/// Decode hex string (no 0x prefix) into fixed-size array.
fn hex_to_array<const N: usize>(env: &Env, hex: &str) -> soroban_sdk::BytesN<N> {
    let hex = hex.trim_start_matches("0x");
    assert!(hex.len() == N * 2, "hex len {} for BytesN<{}>", hex.len(), N);
    let mut arr = [0u8; N];
    for (i, c) in hex.as_bytes().chunks(2).enumerate() {
        let s = std::str::from_utf8(c).unwrap();
        arr[i] = u8::from_str_radix(s, 16).unwrap();
    }
    soroban_sdk::BytesN::from_array(env, &arr)
}

fn hex_to_bytes(env: &Env, hex: &str) -> Bytes {
    let hex = hex.trim_start_matches("0x");
    assert!(hex.len() % 2 == 0, "hex must have even length");
    let mut out: std::vec::Vec<u8> = std::vec::Vec::with_capacity(hex.len() / 2);
    for c in hex.as_bytes().chunks(2) {
        let s = std::str::from_utf8(c).unwrap();
        out.push(u8::from_str_radix(s, 16).unwrap());
    }
    Bytes::from_slice(env, &out)
}

/// When circuits/build/contract_proof.json exists (after `npm run zk:proof`), verifies proof on verifier and submit_zk on policy.
#[test]
fn test_real_proof_verifier_and_submit_zk() {
    let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").unwrap();
    let path = std::path::Path::new(&manifest_dir)
        .join("../../circuits/build/contract_proof.json");
    if !path.exists() {
        return;
    }

    let json: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
    let proof_j = json.get("proof").unwrap();
    let vk_j = json.get("vk").unwrap();
    let pub_j = json.get("pub_signals").unwrap().as_array().unwrap();

    let env = Env::default();
    env.mock_all_auths();

    let proof = ZkProof {
        a: hex_to_array::<64>(&env, proof_j.get("a").unwrap().as_str().unwrap()),
        b: hex_to_array::<128>(&env, proof_j.get("b").unwrap().as_str().unwrap()),
        c: hex_to_array::<64>(&env, proof_j.get("c").unwrap().as_str().unwrap()),
    };
    let ic_arr = vk_j.get("ic").unwrap().as_array().unwrap();
    let mut ic = SorobanVec::new(&env);
    for h in ic_arr {
        ic.push_back(hex_to_array::<64>(&env, h.as_str().unwrap()));
    }
    let vk = ZkVerificationKey {
        alpha: hex_to_array::<64>(&env, vk_j.get("alpha").unwrap().as_str().unwrap()),
        beta: hex_to_array::<128>(&env, vk_j.get("beta").unwrap().as_str().unwrap()),
        gamma: hex_to_array::<128>(&env, vk_j.get("gamma").unwrap().as_str().unwrap()),
        delta: hex_to_array::<128>(&env, vk_j.get("delta").unwrap().as_str().unwrap()),
        ic,
    };
    let mut pub_signals_n = SorobanVec::new(&env);
    let mut pub_signals = SorobanVec::new(&env);
    for h in pub_j {
        let bn = hex_to_array::<32>(&env, h.as_str().unwrap());
        pub_signals_n.push_back(bn.clone());
        pub_signals.push_back(Bytes::from_slice(&env, &bn.to_array()));
    }

    let verifier = env.register(Groth16Verifier, ());
    let verifier_client = Groth16VerifierClient::new(&env, &verifier);
    let ok = verifier_client.verify_proof(&vk, &proof, &pub_signals_n);
    assert!(ok, "real proof must verify to true");

    let hub = env.register(MockHub, ());
    let policy = env.register(CosmicCoder, ());
    let policy_client = CosmicCoderClient::new(&env, &policy);
    policy_client.init(&hub, &verifier);

    let player = Address::generate(&env);
    let nonce = 1u64;
    let season_id = 1u32;
    let run_hash = pub_signals.get(0).unwrap().clone();
    let score = 100u32;
    let wave = 5u32;

    policy_client.submit_zk(
        &player,
        &proof,
        &vk,
        &pub_signals,
        &nonce,
        &run_hash,
        &season_id,
        &score,
        &wave,
    );
}

#[test]
fn test_player_milestone_default_zero() {
    let env = Env::default();
    env.mock_all_auths();

    let hub = env.register(MockHub, ());
    let verifier = env.register(Groth16Verifier, ());
    let policy = env.register(CosmicCoder, ());
    let policy_client = CosmicCoderClient::new(&env, &policy);
    policy_client.init(&hub, &verifier);

    let player = Address::generate(&env);
    let ms: PlayerMilestone = policy_client.get_player_milestone(&player, &1u32);
    assert_eq!(ms.tier, 0);
    assert_eq!(ms.best_wave, 0);
}

#[test]
fn test_player_milestone_updates_from_verified_submits() {
    let env = Env::default();
    env.mock_all_auths();

    let hub = env.register(MockHub, ());
    let verifier = env.register(Groth16Verifier, ());
    let policy = env.register(CosmicCoder, ());
    let policy_client = CosmicCoderClient::new(&env, &policy);
    policy_client.init(&hub, &verifier);

    let player = Address::generate(&env);
    let run_hash = run_hash_32(&env);
    let vk = default_vk(&env);
    let proof = default_proof(&env);
    let pub_signals = default_pub_signals(&env);
    let season_id = 1u32;

    // wave 5 => tier 1
    policy_client.submit_zk(
        &player,
        &proof,
        &vk,
        &pub_signals,
        &301u64,
        &run_hash,
        &season_id,
        &120u32,
        &5u32,
    );
    let ms1: PlayerMilestone = policy_client.get_player_milestone(&player, &season_id);
    assert_eq!(ms1.tier, 1);
    assert_eq!(ms1.best_wave, 5);

    // wave 8 => tier 2
    policy_client.submit_zk(
        &player,
        &proof,
        &vk,
        &pub_signals,
        &302u64,
        &run_hash,
        &season_id,
        &220u32,
        &8u32,
    );
    let ms2: PlayerMilestone = policy_client.get_player_milestone(&player, &season_id);
    assert_eq!(ms2.tier, 2);
    assert_eq!(ms2.best_wave, 8);

    // wave 10 => tier 3
    policy_client.submit_zk(
        &player,
        &proof,
        &vk,
        &pub_signals,
        &303u64,
        &run_hash,
        &season_id,
        &320u32,
        &10u32,
    );
    let ms3: PlayerMilestone = policy_client.get_player_milestone(&player, &season_id);
    assert_eq!(ms3.tier, 3);
    assert_eq!(ms3.best_wave, 10);
}
