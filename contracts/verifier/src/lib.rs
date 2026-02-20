//! Verifier contract v2 (BN254/Groth16) — crypto-only.
//! Responsibilities:
//!   - Load verification key from storage (by vk_hash)
//!   - Verify Groth16 proof against public inputs
//!   - Emit structured event on success/failure
//!   - Return bool (no game logic, no policy)

#![no_std]

use core::ops::Neg;
use soroban_sdk::{
    contract, contractimpl,
    crypto::bn254::{Bn254G1Affine, Bn254G2Affine, Fr},
    vec, BytesN, Env, Vec, Symbol,
};
use zk_types::{Groth16Error, ZkProof, ZkVerificationKey};

#[contract]
pub struct Verifier;

#[contractimpl]
impl Verifier {
    /// Store a verification key under its hash.
    /// vk_hash = sha256(serialize(vk)).
    pub fn store_vk(env: Env, vk_hash: BytesN<32>, vk: ZkVerificationKey) {
        env.storage().persistent().set(&vk_hash, &vk);
    }

    /// Verify a Groth16 proof.
    /// Parameters:
    ///   proof: BytesN<256> packed A(64) || B(128) || C(64)
    ///   public_inputs: Vec<BytesN<32>>
    ///   vk_hash: BytesN<32>
    /// Returns bool and emits event.
    pub fn verify(
        env: Env,
        proof: BytesN<256>,
        public_inputs: Vec<BytesN<32>>,
        vk_hash: BytesN<32>,
    ) -> Result<bool, Groth16Error> {
        // Load verification key
        let vk: ZkVerificationKey = match env.storage().persistent().get::<BytesN<32>, ZkVerificationKey>(&vk_hash) {
            Some(v) => v,
            None => {
                env.events().publish(
                    (Symbol::new(&env, "zk"), Symbol::new(&env, "verify_error")),
                    (vk_hash, "vk_not_found"),
                );
                return Err(Groth16Error::InvalidVerificationKey);
            }
        };

        if public_inputs.len() + 1 != vk.ic.len() {
            env.events().publish(
                (Symbol::new(&env, "zk"), Symbol::new(&env, "verify_error")),
                (vk_hash, "malformed_vk"),
            );
            return Err(Groth16Error::MalformedVerifyingKey);
        }

        // Unpack proof bytes
        let proof_arr = proof.to_array();
        let mut a = [0u8; 64];
        a.copy_from_slice(&proof_arr[0..64]);
        let mut b = [0u8; 128];
        b.copy_from_slice(&proof_arr[64..192]);
        let mut c = [0u8; 64];
        c.copy_from_slice(&proof_arr[192..256]);
        let proof_a_bytes = BytesN::<64>::from_array(&env, &a);
        let proof_b_bytes = BytesN::<128>::from_array(&env, &b);
        let proof_c_bytes = BytesN::<64>::from_array(&env, &c);

        let proof_a = Bn254G1Affine::from_bytes(proof_a_bytes);
        let proof_b = Bn254G2Affine::from_bytes(proof_b_bytes);
        let proof_c = Bn254G1Affine::from_bytes(proof_c_bytes);
        let vk_alpha = Bn254G1Affine::from_bytes(vk.alpha);
        let vk_beta = Bn254G2Affine::from_bytes(vk.beta);
        let vk_gamma = Bn254G2Affine::from_bytes(vk.gamma);
        let vk_delta = Bn254G2Affine::from_bytes(vk.delta);

        let bn = env.crypto().bn254();

        // Compute vk_x = ic[0] + sum(pub_signals[i] * ic[i+1])
        let mut vk_x = Bn254G1Affine::from_bytes(vk.ic.get(0).unwrap());
        for (i, sig) in public_inputs.iter().enumerate() {
            let ic_pt = Bn254G1Affine::from_bytes(vk.ic.get((i + 1) as u32).unwrap());
            let fr = Fr::from_bytes(sig.clone());
            let prod = bn.g1_mul(&ic_pt, &fr);
            vk_x = bn.g1_add(&vk_x, &prod);
        }

        // Pairing check: e(-A, B) * e(alpha, beta) * e(vk_x, gamma) * e(C, delta) == 1
        let neg_a = proof_a.neg();
        let vp1 = vec![&env, neg_a, vk_alpha, vk_x, proof_c];
        let vp2 = vec![&env, proof_b, vk_beta, vk_gamma, vk_delta];
        let ok = bn.pairing_check(vp1, vp2);

        if ok {
            env.events().publish(
                (Symbol::new(&env, "zk"), Symbol::new(&env, "verified")),
                (vk_hash, true),
            );
        } else {
            env.events().publish(
                (Symbol::new(&env, "zk"), Symbol::new(&env, "verify_error")),
                (vk_hash, "pairing_failed"),
            );
        }

        Ok(ok)
    }
}

#[cfg(test)]
mod test;
