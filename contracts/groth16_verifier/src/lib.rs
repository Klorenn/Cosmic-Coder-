//! Groth16 verifier contract (BN254 / CAP-0074).
//! Single responsibility: verify a Groth16 proof. No leaderboard or game logic.
//! Uses shared types from zk_types; performs BN254 pairing check.

#![no_std]

use core::ops::Neg;
use soroban_sdk::{
    contract, contractimpl,
    crypto::bn254::{Bn254G1Affine, Bn254G2Affine, Fr},
    vec, BytesN, Env, Vec,
};
use zk_types::{Groth16Error, ZkProof, ZkVerificationKey};

#[contract]
pub struct Groth16Verifier;

#[contractimpl]
impl Groth16Verifier {
    /// Verify a Groth16 proof against the given verification key and public inputs.
    /// Pairing check: e(-A, B) * e(alpha, beta) * e(vk_x, gamma) * e(C, delta) == 1
    /// where vk_x = ic[0] + sum(pub_signals[i] * ic[i+1]).
    pub fn verify_proof(
        env: Env,
        vk: ZkVerificationKey,
        proof: ZkProof,
        pub_signals: Vec<BytesN<32>>,
    ) -> Result<bool, Groth16Error> {
        let bn = env.crypto().bn254();

        if pub_signals.len() + 1 != vk.ic.len() {
            return Err(Groth16Error::MalformedVerifyingKey);
        }

        let proof_a = Bn254G1Affine::from_bytes(proof.a);
        let proof_b = Bn254G2Affine::from_bytes(proof.b);
        let proof_c = Bn254G1Affine::from_bytes(proof.c);
        let vk_alpha = Bn254G1Affine::from_bytes(vk.alpha);
        let vk_beta = Bn254G2Affine::from_bytes(vk.beta);
        let vk_gamma = Bn254G2Affine::from_bytes(vk.gamma);
        let vk_delta = Bn254G2Affine::from_bytes(vk.delta);

        let mut vk_x = Bn254G1Affine::from_bytes(vk.ic.get(0).unwrap());
        for (i, sig) in pub_signals.iter().enumerate() {
            let ic_pt = Bn254G1Affine::from_bytes(vk.ic.get((i + 1) as u32).unwrap());
            let fr = Fr::from_bytes(sig.clone());
            let prod = bn.g1_mul(&ic_pt, &fr);
            vk_x = bn.g1_add(&vk_x, &prod);
        }

        let neg_a = proof_a.neg();
        let vp1 = vec![&env, neg_a, vk_alpha, vk_x, proof_c];
        let vp2 = vec![&env, proof_b, vk_beta, vk_gamma, vk_delta];

        Ok(bn.pairing_check(vp1, vp2))
    }
}

#[cfg(test)]
mod test;
