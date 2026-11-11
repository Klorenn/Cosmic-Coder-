//! UltraHonk stub tests: admin-gated VK, framing checks, proof id bookkeeping.

extern crate std;

use soroban_sdk::{
    testutils::{Address as _, AuthorizedFunction, AuthorizedInvocation},
    Address, Bytes, Env, IntoVal, Symbol,
};

use crate::{Error, UltraHonkVerifier, UltraHonkVerifierClient};

fn blob(env: &Env, fields: u32, header: u32) -> Bytes {
    let mut b = Bytes::new(env);
    b.extend_from_array(&header.to_be_bytes());
    for i in 0..fields {
        b.extend_from_array(&[i as u8; 32]);
    }
    b
}

fn setup() -> (Env, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let id = env.register(UltraHonkVerifier, (admin.clone(),));
    (env, id, admin)
}

#[test]
fn test_set_vk_requires_exact_admin_auth() {
    let (env, id, admin) = setup();
    let c = UltraHonkVerifierClient::new(&env, &id);
    let vk = Bytes::from_slice(&env, b"{}");
    let hash = c.set_vk(&vk);
    assert_eq!(
        env.auths(),
        std::vec![(
            admin.clone(),
            AuthorizedInvocation {
                function: AuthorizedFunction::Contract((
                    id.clone(),
                    Symbol::new(&env, "set_vk"),
                    (vk.clone(),).into_val(&env),
                )),
                sub_invocations: std::vec![],
            }
        )]
    );
    assert_eq!(c.get_vk_hash(), Some(hash));
    assert_eq!(c.get_admin(), admin);
}

#[test]
fn test_set_vk_fails_without_auth() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let id = env.register(UltraHonkVerifier, (admin,));
    let c = UltraHonkVerifierClient::new(&env, &id);
    assert!(c.try_set_vk(&Bytes::from_slice(&env, b"{}")).is_err());
}

#[test]
fn test_set_vk_rejects_empty() {
    let (env, id, _) = setup();
    let c = UltraHonkVerifierClient::new(&env, &id);
    assert_eq!(c.try_set_vk(&Bytes::new(&env)), Err(Ok(Error::VkParseError)));
}

#[test]
fn test_verify_with_stored_vk_requires_vk() {
    let (env, id, _) = setup();
    let c = UltraHonkVerifierClient::new(&env, &id);
    assert_eq!(
        c.try_verify_proof_with_stored_vk(&blob(&env, 2, 2)),
        Err(Ok(Error::VkNotSet))
    );
}

#[test]
fn test_framing_checks() {
    let (env, id, _) = setup();
    let c = UltraHonkVerifierClient::new(&env, &id);
    c.set_vk(&Bytes::from_slice(&env, b"{}"));
    // too short
    assert_eq!(
        c.try_verify_proof_with_stored_vk(&Bytes::from_array(&env, &[0u8; 3])),
        Err(Ok(Error::ProofParseError))
    );
    // header only
    assert_eq!(
        c.try_verify_proof_with_stored_vk(&blob(&env, 0, 0)),
        Err(Ok(Error::ProofParseError))
    );
    // misaligned payload
    let mut odd = blob(&env, 2, 2);
    odd.push_back(1);
    assert_eq!(
        c.try_verify_proof_with_stored_vk(&odd),
        Err(Ok(Error::ProofParseError))
    );
    // header disagrees with field count
    assert_eq!(
        c.try_verify_proof_with_stored_vk(&blob(&env, 2, 3)),
        Err(Ok(Error::ProofParseError))
    );
}

#[test]
fn test_well_formed_blob_records_proof_id() {
    let (env, id, _) = setup();
    let c = UltraHonkVerifierClient::new(&env, &id);
    c.set_vk(&Bytes::from_slice(&env, b"{}"));
    let b = blob(&env, 3, 3);
    let pid = c.verify_proof_with_stored_vk(&b);
    let expected: soroban_sdk::BytesN<32> = env.crypto().sha256(&b).into();
    assert_eq!(pid, expected);
    assert!(c.is_verified(&pid));
    assert!(!c.is_verified(&soroban_sdk::BytesN::from_array(&env, &[0u8; 32])));
}

#[test]
fn test_verify_proof_rejects_empty_vk() {
    let (env, id, _) = setup();
    let c = UltraHonkVerifierClient::new(&env, &id);
    assert_eq!(
        c.try_verify_proof(&Bytes::new(&env), &blob(&env, 1, 1)),
        Err(Ok(Error::VkParseError))
    );
}
