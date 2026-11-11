//! Cosmic Coder contract tests.
//!
//! Coverage: constructor/admin, admin-gated config, exact auth trees on every
//! player-facing mutator, anti-replay keyed by (player, season, nonce), public
//! signal binding (score/wave/nonce/season/run_hash), VK pinning, bounded and
//! deterministic leaderboards, checked math / range validation, Game Hub
//! session handling and weapon unlocks.
//!
//! The "structural" Groth16 tests use all-zero (point-at-infinity) VK/proof:
//! the pairing check trivially succeeds, which lets us exercise the policy
//! logic without a real proof. `test_real_proof_verifier_and_submit_zk` uses a
//! real snarkjs proof when `circuits/build/contract_proof.json` exists.

extern crate std;

use soroban_sdk::{
    contract, contractimpl, contracttype,
    testutils::{
        storage::Persistent as _, Address as _, AuthorizedFunction, AuthorizedInvocation, Ledger as _,
        MockAuth, MockAuthInvoke,
    },
    vec, Address, Bytes, BytesN, Env, IntoVal, Symbol, Val, Vec as SorobanVec,
};
use zk_types::{Groth16Error, ZkProof, ZkVerificationKey, G1_SIZE, G2_SIZE};

use crate::{
    CosmicCoder, CosmicCoderClient, CosmicCoderError, DataKey, PlayerMilestone, MAX_LEADERBOARD_SIZE,
    RUN_PUBLIC_SIGNALS, UNLOCK_PUBLIC_SIGNALS,
};
use groth16_verifier::{Groth16Verifier, Groth16VerifierClient};
use ultrahonk_verifier::{UltraHonkVerifier, UltraHonkVerifierClient};

// ---------------------------------------------------------------------------
// Mock contracts
// ---------------------------------------------------------------------------

#[contracttype]
enum HubKey {
    Started,
    Ended,
}

/// Game Hub mock that records every start/end call.
#[contract]
struct MockHub;

#[contractimpl]
impl MockHub {
    pub fn start_game(
        env: Env,
        _game_id: Address,
        session: u32,
        _player: Address,
        _system_player: Address,
        _x: i128,
        _y: i128,
    ) {
        let mut v: soroban_sdk::Vec<u32> = env
            .storage()
            .instance()
            .get(&HubKey::Started)
            .unwrap_or(soroban_sdk::Vec::new(&env));
        v.push_back(session);
        env.storage().instance().set(&HubKey::Started, &v);
    }
    pub fn end_game(env: Env, session: u32, _success: bool) {
        let mut v: soroban_sdk::Vec<u32> = env
            .storage()
            .instance()
            .get(&HubKey::Ended)
            .unwrap_or(soroban_sdk::Vec::new(&env));
        v.push_back(session);
        env.storage().instance().set(&HubKey::Ended, &v);
    }
    pub fn started(env: Env) -> soroban_sdk::Vec<u32> {
        env.storage().instance().get(&HubKey::Started).unwrap_or(soroban_sdk::Vec::new(&env))
    }
    pub fn ended(env: Env) -> soroban_sdk::Vec<u32> {
        env.storage().instance().get(&HubKey::Ended).unwrap_or(soroban_sdk::Vec::new(&env))
    }
}

/// Game Hub that always traps.
#[contract]
struct PanicHub;

#[contractimpl]
impl PanicHub {
    pub fn start_game(
        _env: Env,
        _game_id: Address,
        _session: u32,
        _player: Address,
        _system_player: Address,
        _x: i128,
        _y: i128,
    ) {
        panic!("hub down");
    }
    pub fn end_game(_env: Env, _session: u32, _success: bool) {
        panic!("hub down");
    }
}

/// Groth16 verifier that rejects every proof (returns Ok(false)).
#[contract]
struct RejectingVerifier;

#[contractimpl]
impl RejectingVerifier {
    pub fn verify_proof(
        _env: Env,
        _vk: ZkVerificationKey,
        _proof: ZkProof,
        _pub_signals: soroban_sdk::Vec<BytesN<32>>,
    ) -> Result<bool, Groth16Error> {
        Ok(false)
    }
}

/// Groth16 verifier that returns a typed error.
#[contract]
struct ErroringVerifier;

#[contractimpl]
impl ErroringVerifier {
    pub fn verify_proof(
        _env: Env,
        _vk: ZkVerificationKey,
        _proof: ZkProof,
        _pub_signals: soroban_sdk::Vec<BytesN<32>>,
    ) -> Result<bool, Groth16Error> {
        Err(Groth16Error::InvalidProof)
    }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

fn g1(env: &Env) -> BytesN<64> {
    BytesN::from_array(env, &[0u8; G1_SIZE])
}
fn g2(env: &Env) -> BytesN<128> {
    BytesN::from_array(env, &[0u8; G2_SIZE])
}

fn vk_with_ic(env: &Env, ic_len: u32) -> ZkVerificationKey {
    let mut ic = SorobanVec::new(env);
    for _ in 0..ic_len {
        ic.push_back(g1(env));
    }
    ZkVerificationKey {
        alpha: g1(env),
        beta: g2(env),
        gamma: g2(env),
        delta: g2(env),
        ic,
    }
}

/// Run VK: ic.len() = 7 public signals + 1.
fn run_vk(env: &Env) -> ZkVerificationKey {
    vk_with_ic(env, RUN_PUBLIC_SIGNALS + 1)
}

/// Unlock VK: ic.len() = 2 public signals + 1.
fn unlock_vk(env: &Env) -> ZkVerificationKey {
    vk_with_ic(env, UNLOCK_PUBLIC_SIGNALS + 1)
}

fn zero_proof(env: &Env) -> ZkProof {
    ZkProof {
        a: g1(env),
        b: g2(env),
        c: g1(env),
    }
}

fn field(v: u64) -> [u8; 32] {
    let mut a = [0u8; 32];
    a[24..].copy_from_slice(&v.to_be_bytes());
    a
}

fn hash_bytes(seed: u8) -> [u8; 32] {
    let mut h = [0u8; 32];
    for (i, b) in h.iter_mut().enumerate() {
        *b = seed.wrapping_add(i as u8);
    }
    h
}

/// Public signals laid out like GameRun.circom:
/// [run_hash_hi, run_hash_lo, score, wave, nonce, season_id, used_zk_weapon].
fn run_signal_arrays(run_hash: &[u8; 32], score: u32, wave: u32, nonce: u64, season: u32, weapon: u8) -> [[u8; 32]; 7] {
    let mut hi = [0u8; 32];
    hi[16..].copy_from_slice(&run_hash[..16]);
    let mut lo = [0u8; 32];
    lo[16..].copy_from_slice(&run_hash[16..]);
    let mut w = [0u8; 32];
    w[31] = weapon;
    [
        hi,
        lo,
        field(score as u64),
        field(wave as u64),
        field(nonce),
        field(season as u64),
        w,
    ]
}

fn run_signals(env: &Env, run_hash: &[u8; 32], score: u32, wave: u32, nonce: u64, season: u32) -> SorobanVec<Bytes> {
    let mut v = SorobanVec::new(env);
    for s in run_signal_arrays(run_hash, score, wave, nonce, season, 0) {
        v.push_back(Bytes::from_array(env, &s));
    }
    v
}

fn bytes32(env: &Env, a: &[u8; 32]) -> Bytes {
    Bytes::from_array(env, a)
}

/// Noir proof blob: u32_be(total_fields) || 7 public input fields || proof fields.
fn noir_blob(env: &Env, run_hash: &[u8; 32], score: u32, wave: u32, nonce: u64, season: u32) -> Bytes {
    let proof_fields = 4u32;
    let mut b = Bytes::new(env);
    b.extend_from_array(&(RUN_PUBLIC_SIGNALS + proof_fields).to_be_bytes());
    for s in run_signal_arrays(run_hash, score, wave, nonce, season, 0) {
        b.extend_from_array(&s);
    }
    for i in 0..proof_fields {
        b.extend_from_array(&[i as u8 + 1; 32]);
    }
    b
}

struct Ctx {
    env: Env,
    id: Address,
    admin: Address,
    hub: Address,
}

impl Ctx {
    fn client(&self) -> CosmicCoderClient<'_> {
        CosmicCoderClient::new(&self.env, &self.id)
    }
    fn hub(&self) -> MockHubClient<'_> {
        MockHubClient::new(&self.env, &self.hub)
    }
}

/// Fresh contract with admin + mock hub, no verifier / VK configured.
fn bare() -> Ctx {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let hub = env.register(MockHub, ());
    let id = env.register(CosmicCoder, (admin.clone(), hub.clone()));
    Ctx { env, id, admin, hub }
}

/// Contract wired with the real Groth16 verifier and the run/unlock VKs.
fn wired() -> Ctx {
    let ctx = bare();
    let verifier = ctx.env.register(Groth16Verifier, ());
    let c = ctx.client();
    c.set_verifier(&verifier);
    c.set_run_vk(&run_vk(&ctx.env));
    c.set_unlock_vk(&unlock_vk(&ctx.env));
    ctx
}

/// Contract wired with the UltraHonk verifier (VK stored).
fn wired_noir() -> Ctx {
    let ctx = bare();
    let uh = ctx
        .env
        .register(UltraHonkVerifier, (ctx.admin.clone(),));
    UltraHonkVerifierClient::new(&ctx.env, &uh).set_vk(&Bytes::from_slice(&ctx.env, b"{\"vk\":1}"));
    ctx.client().set_noir_verifier(&uh);
    ctx
}

fn submit_ok(ctx: &Ctx, player: &Address, nonce: u64, season: u32, score: u32, wave: u32) {
    let env = &ctx.env;
    let h = hash_bytes(nonce as u8);
    ctx.client().submit_zk(
        player,
        &zero_proof(env),
        &run_vk(env),
        &run_signals(env, &h, score, wave, nonce, season),
        &nonce,
        &bytes32(env, &h),
        &season,
        &score,
        &wave,
    );
}

#[allow(clippy::too_many_arguments)]
fn try_submit(
    ctx: &Ctx,
    player: &Address,
    vk: &ZkVerificationKey,
    signals: &SorobanVec<Bytes>,
    nonce: u64,
    run_hash: &Bytes,
    season: u32,
    score: u32,
    wave: u32,
) -> Result<(), CosmicCoderError> {
    match ctx.client().try_submit_zk(
        player,
        &zero_proof(&ctx.env),
        vk,
        signals,
        &nonce,
        run_hash,
        &season,
        &score,
        &wave,
    ) {
        Ok(Ok(())) => Ok(()),
        Err(Ok(e)) => Err(e),
        other => panic!("unexpected host-level result: {:?}", other),
    }
}

fn expect_err<T: core::fmt::Debug, C: core::fmt::Debug, I: core::fmt::Debug>(
    r: Result<Result<T, C>, Result<CosmicCoderError, I>>,
) -> CosmicCoderError {
    match r {
        Err(Ok(e)) => e,
        other => panic!("expected contract error, got {:?}", other),
    }
}

/// Assert the last top-level invocation required exactly one auth: `who` for `fn_name(args)`,
/// with no sub-invocations requiring that signer.
fn assert_exact_auth(env: &Env, who: &Address, contract: &Address, fn_name: &str, args: SorobanVec<Val>) {
    assert_eq!(
        env.auths(),
        std::vec![(
            who.clone(),
            AuthorizedInvocation {
                function: AuthorizedFunction::Contract((
                    contract.clone(),
                    Symbol::new(env, fn_name),
                    args,
                )),
                sub_invocations: std::vec![],
            }
        )]
    );
}

// ---------------------------------------------------------------------------
// Constructor / admin
// ---------------------------------------------------------------------------

#[test]
fn test_constructor_sets_admin_and_hub() {
    let ctx = bare();
    assert_eq!(ctx.client().get_admin(), ctx.admin);
    assert_eq!(ctx.client().get_game_hub(), ctx.hub);
}

#[test]
fn test_set_verifier_requires_exact_admin_auth() {
    let ctx = bare();
    let v = Address::generate(&ctx.env);
    ctx.client().set_verifier(&v);
    assert_exact_auth(&ctx.env, &ctx.admin, &ctx.id, "set_verifier", (v.clone(),).into_val(&ctx.env));
}

#[test]
fn test_admin_setters_require_exact_admin_auth() {
    let ctx = bare();
    let env = &ctx.env;
    let c = ctx.client();
    let a = Address::generate(env);

    c.set_noir_verifier(&a);
    assert_exact_auth(env, &ctx.admin, &ctx.id, "set_noir_verifier", (a.clone(),).into_val(env));

    c.set_game_hub(&a);
    assert_exact_auth(env, &ctx.admin, &ctx.id, "set_game_hub", (a.clone(),).into_val(env));

    let vk = run_vk(env);
    c.set_run_vk(&vk);
    assert_exact_auth(env, &ctx.admin, &ctx.id, "set_run_vk", (vk.clone(),).into_val(env));

    let uvk = unlock_vk(env);
    c.set_unlock_vk(&uvk);
    assert_exact_auth(env, &ctx.admin, &ctx.id, "set_unlock_vk", (uvk.clone(),).into_val(env));
}

#[test]
fn test_set_verifier_rejects_non_admin() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let hub = env.register(MockHub, ());
    let id = env.register(CosmicCoder, (admin.clone(), hub));
    let c = CosmicCoderClient::new(&env, &id);
    let attacker = Address::generate(&env);
    let v = Address::generate(&env);

    // Attacker signs, but the contract demands the stored admin.
    env.mock_auths(&[MockAuth {
        address: &attacker,
        invoke: &MockAuthInvoke {
            contract: &id,
            fn_name: "set_verifier",
            args: (v.clone(),).into_val(&env),
            sub_invokes: &[],
        },
    }]);
    assert!(c.try_set_verifier(&v).is_err());
}

#[test]
fn test_admin_setters_fail_without_any_auth() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let hub = env.register(MockHub, ());
    let id = env.register(CosmicCoder, (admin, hub));
    let c = CosmicCoderClient::new(&env, &id);
    let v = Address::generate(&env);
    assert!(c.try_set_verifier(&v).is_err());
    assert!(c.try_set_noir_verifier(&v).is_err());
    assert!(c.try_set_game_hub(&v).is_err());
    assert!(c.try_set_admin(&v).is_err());
    assert!(c.try_propose_admin(&v).is_err());
    assert!(c.try_set_run_vk(&run_vk(&env)).is_err());
}

#[test]
fn test_propose_admin_exact_auth_does_not_transfer() {
    let ctx = bare();
    let env = &ctx.env;
    let new_admin = Address::generate(env);
    assert_eq!(ctx.client().get_pending_admin(), None);
    ctx.client().propose_admin(&new_admin);
    assert_exact_auth(env, &ctx.admin, &ctx.id, "propose_admin", (new_admin.clone(),).into_val(env));
    assert_eq!(ctx.client().get_admin(), ctx.admin);
    assert_eq!(ctx.client().get_pending_admin(), Some(new_admin));
}

#[test]
fn test_accept_admin_exact_auth_transfers_authority() {
    let ctx = bare();
    let env = &ctx.env;
    let new_admin = Address::generate(env);
    ctx.client().propose_admin(&new_admin);
    ctx.client().accept_admin();
    assert_exact_auth(env, &new_admin, &ctx.id, "accept_admin", SorobanVec::<Val>::new(env));
    assert_eq!(ctx.client().get_admin(), new_admin);
    assert_eq!(ctx.client().get_pending_admin(), None);

    let v = Address::generate(env);
    ctx.client().set_verifier(&v);
    assert_exact_auth(env, &new_admin, &ctx.id, "set_verifier", (v.clone(),).into_val(env));
}

#[test]
fn test_accept_admin_without_pending_is_typed_error() {
    let ctx = bare();
    assert_eq!(
        expect_err(ctx.client().try_accept_admin()),
        CosmicCoderError::NoPendingAdmin
    );
}

#[test]
fn test_accept_admin_rejects_anyone_but_pending() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let hub = env.register(MockHub, ());
    let id = env.register(CosmicCoder, (admin.clone(), hub));
    let c = CosmicCoderClient::new(&env, &id);
    let pending = Address::generate(&env);
    env.mock_auths(&[MockAuth {
        address: &admin,
        invoke: &MockAuthInvoke {
            contract: &id,
            fn_name: "propose_admin",
            args: (pending.clone(),).into_val(&env),
            sub_invokes: &[],
        },
    }]);
    c.propose_admin(&pending);

    // The current admin (or anyone else) cannot accept on behalf of the pending admin.
    for signer in [admin.clone(), Address::generate(&env)] {
        env.mock_auths(&[MockAuth {
            address: &signer,
            invoke: &MockAuthInvoke {
                contract: &id,
                fn_name: "accept_admin",
                args: ().into_val(&env),
                sub_invokes: &[],
            },
        }]);
        assert!(c.try_accept_admin().is_err());
    }
    env.set_auths(&[]);
    assert!(c.try_accept_admin().is_err());
    assert_eq!(c.get_admin(), admin);
}

/// `set_admin` is a deprecated alias of `propose_admin`: it never transfers on its own.
#[test]
fn test_set_admin_alias_only_proposes() {
    let ctx = bare();
    let env = &ctx.env;
    let new_admin = Address::generate(env);
    ctx.client().set_admin(&new_admin);
    assert_exact_auth(env, &ctx.admin, &ctx.id, "set_admin", (new_admin.clone(),).into_val(env));
    assert_eq!(ctx.client().get_admin(), ctx.admin);
    assert_eq!(ctx.client().get_pending_admin(), Some(new_admin.clone()));
    ctx.client().accept_admin();
    assert_eq!(ctx.client().get_admin(), new_admin);
}

#[test]
fn test_set_vk_rejects_wrong_ic_length() {
    let ctx = bare();
    let env = &ctx.env;
    assert_eq!(
        expect_err(ctx.client().try_set_run_vk(&vk_with_ic(env, 3))),
        CosmicCoderError::MalformedVk
    );
    assert_eq!(
        expect_err(ctx.client().try_set_unlock_vk(&vk_with_ic(env, 8))),
        CosmicCoderError::MalformedVk
    );
}

// ---------------------------------------------------------------------------
// start_match / Game Hub sessions
// ---------------------------------------------------------------------------

#[test]
fn test_start_match_exact_player_auth_and_hub_call() {
    let ctx = bare();
    let env = &ctx.env;
    let p = Address::generate(env);
    assert_eq!(ctx.client().start_match(&p), 1);
    assert_exact_auth(env, &p, &ctx.id, "start_match", (p.clone(),).into_val(env));
    assert_eq!(ctx.client().start_match(&p), 2);
    assert_eq!(ctx.hub().started(), vec![env, 1u32, 2u32]);
    assert_eq!(ctx.client().get_active_session(&p), Some(2));
}

#[test]
fn test_start_match_fails_without_auth() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let hub = env.register(MockHub, ());
    let id = env.register(CosmicCoder, (admin, hub));
    let p = Address::generate(&env);
    assert!(CosmicCoderClient::new(&env, &id).try_start_match(&p).is_err());
}

#[test]
fn test_start_match_hub_failure_is_typed_error() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let hub = env.register(PanicHub, ());
    let id = env.register(CosmicCoder, (admin, hub));
    let p = Address::generate(&env);
    assert_eq!(
        expect_err(CosmicCoderClient::new(&env, &id).try_start_match(&p)),
        CosmicCoderError::GameHubCrash
    );
}

#[test]
fn test_submit_ends_only_the_submitting_players_session() {
    let ctx = wired();
    let env = &ctx.env;
    let a = Address::generate(env);
    let b = Address::generate(env);
    let sa = ctx.client().start_match(&a); // 1
    let _sb = ctx.client().start_match(&b); // 2
    ctx.client().submit_result(&a, &2, &50);
    assert_eq!(ctx.hub().ended(), vec![env, sa]);
    assert_eq!(ctx.client().get_active_session(&a), None);
    assert_eq!(ctx.client().get_active_session(&b), Some(2));
}

#[test]
fn test_submit_without_session_skips_hub() {
    let ctx = wired();
    let p = Address::generate(&ctx.env);
    ctx.client().submit_result(&p, &1, &10);
    assert_eq!(ctx.hub().ended().len(), 0);
}

// ---------------------------------------------------------------------------
// submit_result (casual)
// ---------------------------------------------------------------------------

#[test]
fn test_submit_result_exact_auth() {
    let ctx = wired();
    let env = &ctx.env;
    let p = Address::generate(env);
    ctx.client().submit_result(&p, &3, &100);
    assert_exact_auth(env, &p, &ctx.id, "submit_result", (p.clone(), 3u32, 100i128).into_val(env));
}

#[test]
fn test_submit_result_fails_without_auth() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let hub = env.register(MockHub, ());
    let id = env.register(CosmicCoder, (admin, hub));
    let p = Address::generate(&env);
    assert!(CosmicCoderClient::new(&env, &id).try_submit_result(&p, &1, &10).is_err());
}

#[test]
fn test_submit_result_rejects_negative_score() {
    let ctx = wired();
    let p = Address::generate(&ctx.env);
    assert_eq!(
        expect_err(ctx.client().try_submit_result(&p, &0, &-1)),
        CosmicCoderError::NegativeScore
    );
}

#[test]
fn test_submit_result_rejects_score_below_minimum() {
    let ctx = wired();
    let p = Address::generate(&ctx.env);
    // wave 5 -> min 25
    assert_eq!(
        expect_err(ctx.client().try_submit_result(&p, &5, &24)),
        CosmicCoderError::ScoreBelowMinimum
    );
    assert_eq!(ctx.client().get_leaderboard(&10).len(), 0);
}

#[test]
fn test_submit_result_keeps_best_per_player_sorted() {
    let ctx = wired();
    let env = &ctx.env;
    let a = Address::generate(env);
    let b = Address::generate(env);
    let c = ctx.client();
    c.submit_result(&a, &2, &100);
    c.submit_result(&b, &2, &200);
    c.submit_result(&a, &3, &50); // worse: ignored
    let lb = c.get_leaderboard(&10);
    assert_eq!(lb.len(), 2);
    assert_eq!(lb.get(0).unwrap().player, b);
    assert_eq!(lb.get(1).unwrap().player, a);
    assert_eq!(lb.get(1).unwrap().score, 100);
    assert_eq!(lb.get(1).unwrap().wave, 2);

    c.submit_result(&a, &9, &300); // better: replaces and re-sorts
    let lb = c.get_leaderboard(&10);
    assert_eq!(lb.len(), 2);
    assert_eq!(lb.get(0).unwrap().player, a);
    assert_eq!(lb.get(0).unwrap().score, 300);
    assert_eq!(lb.get(0).unwrap().wave, 9);
}

#[test]
fn test_casual_leaderboard_is_capped() {
    let ctx = wired();
    let env = &ctx.env;
    env.cost_estimate().budget().reset_unlimited();
    let c = ctx.client();
    for i in 0..(MAX_LEADERBOARD_SIZE + 5) {
        let p = Address::generate(env);
        c.submit_result(&p, &0, &(i as i128));
    }
    let lb = c.get_leaderboard(&1000);
    assert_eq!(lb.len(), MAX_LEADERBOARD_SIZE);
    assert_eq!(lb.get(0).unwrap().score, (MAX_LEADERBOARD_SIZE + 4) as i128);
    for i in 1..lb.len() {
        assert!(lb.get(i - 1).unwrap().score >= lb.get(i).unwrap().score);
    }
    // Entry below the cut-off is not inserted.
    let low = Address::generate(env);
    c.submit_result(&low, &0, &0);
    assert!(c.get_leaderboard(&1000).iter().all(|e| e.player != low));
}

// ---------------------------------------------------------------------------
// submit_zk (Groth16 ranked)
// ---------------------------------------------------------------------------

#[test]
fn test_submit_zk_fails_when_verifier_not_set() {
    let ctx = bare();
    let env = &ctx.env;
    ctx.client().set_run_vk(&run_vk(env));
    let p = Address::generate(env);
    let h = hash_bytes(1);
    assert_eq!(
        try_submit(&ctx, &p, &run_vk(env), &run_signals(env, &h, 100, 5, 1, 1), 1, &bytes32(env, &h), 1, 100, 5),
        Err(CosmicCoderError::VerifierNotSet)
    );
}

#[test]
fn test_submit_zk_fails_when_vk_not_set() {
    let ctx = bare();
    let env = &ctx.env;
    let verifier = env.register(Groth16Verifier, ());
    ctx.client().set_verifier(&verifier);
    let p = Address::generate(env);
    let h = hash_bytes(1);
    assert_eq!(
        try_submit(&ctx, &p, &run_vk(env), &run_signals(env, &h, 100, 5, 1, 1), 1, &bytes32(env, &h), 1, 100, 5),
        Err(CosmicCoderError::VkNotSet)
    );
}

#[test]
fn test_submit_zk_rejects_caller_supplied_vk() {
    let ctx = wired();
    let env = &ctx.env;
    let p = Address::generate(env);
    let h = hash_bytes(1);
    let mut evil = run_vk(env);
    evil.alpha = BytesN::from_array(env, &[7u8; G1_SIZE]);
    assert_eq!(
        try_submit(&ctx, &p, &evil, &run_signals(env, &h, 100, 5, 1, 1), 1, &bytes32(env, &h), 1, 100, 5),
        Err(CosmicCoderError::VkMismatch)
    );
}

#[test]
fn test_submit_zk_exact_player_auth() {
    let ctx = wired();
    let env = &ctx.env;
    let p = Address::generate(env);
    let h = hash_bytes(9);
    let sig = run_signals(env, &h, 100, 5, 9, 1);
    let vk = run_vk(env);
    let proof = zero_proof(env);
    let rh = bytes32(env, &h);
    ctx.client()
        .submit_zk(&p, &proof, &vk, &sig, &9u64, &rh, &1u32, &100u32, &5u32);
    let args: SorobanVec<Val> = vec![
        env,
        p.into_val(env),
        proof.into_val(env),
        vk.into_val(env),
        sig.into_val(env),
        9u64.into_val(env),
        rh.into_val(env),
        1u32.into_val(env),
        100u32.into_val(env),
        5u32.into_val(env),
    ];
    assert_exact_auth(env, &p, &ctx.id, "submit_zk", args);
}

#[test]
fn test_submit_zk_fails_without_auth() {
    let ctx = wired();
    let env = &ctx.env;
    env.set_auths(&[]);
    let p = Address::generate(env);
    let h = hash_bytes(1);
    let r = ctx.client().try_submit_zk(
        &p,
        &zero_proof(env),
        &run_vk(env),
        &run_signals(env, &h, 100, 5, 1, 1),
        &1u64,
        &bytes32(env, &h),
        &1u32,
        &100u32,
        &5u32,
    );
    assert!(r.is_err());
}

#[test]
fn test_submit_zk_anti_replay() {
    let ctx = wired();
    let env = &ctx.env;
    let p = Address::generate(env);
    submit_ok(&ctx, &p, 42, 1, 100, 5);
    assert!(ctx.client().is_nonce_used(&p, &1, &42));
    let h = hash_bytes(42);
    assert_eq!(
        try_submit(&ctx, &p, &run_vk(env), &run_signals(env, &h, 100, 5, 42, 1), 42, &bytes32(env, &h), 1, 100, 5),
        Err(CosmicCoderError::Replay)
    );
}

#[test]
fn test_submit_zk_nonce_scoped_per_player_and_season() {
    let ctx = wired();
    let env = &ctx.env;
    let a = Address::generate(env);
    let b = Address::generate(env);
    submit_ok(&ctx, &a, 7, 1, 100, 5);
    // Same nonce, different player: allowed (no global nonce griefing).
    submit_ok(&ctx, &b, 7, 1, 100, 5);
    // Same player + nonce, different season: allowed.
    submit_ok(&ctx, &a, 7, 2, 100, 5);
    assert!(!ctx.client().is_nonce_used(&a, &3, &7));
}

#[test]
fn test_submit_zk_signal_binding() {
    let ctx = wired();
    let env = &ctx.env;
    let p = Address::generate(env);
    let h = hash_bytes(3);
    let rh = bytes32(env, &h);
    let vk = run_vk(env);
    // Claimed score differs from the proven one.
    assert_eq!(
        try_submit(&ctx, &p, &vk, &run_signals(env, &h, 100, 5, 3, 1), 3, &rh, 1, 999, 5),
        Err(CosmicCoderError::SignalMismatch)
    );
    // Wave.
    assert_eq!(
        try_submit(&ctx, &p, &vk, &run_signals(env, &h, 100, 5, 3, 1), 3, &rh, 1, 100, 6),
        Err(CosmicCoderError::SignalMismatch)
    );
    // Nonce.
    assert_eq!(
        try_submit(&ctx, &p, &vk, &run_signals(env, &h, 100, 5, 3, 1), 4, &rh, 1, 100, 5),
        Err(CosmicCoderError::SignalMismatch)
    );
    // Season.
    assert_eq!(
        try_submit(&ctx, &p, &vk, &run_signals(env, &h, 100, 5, 3, 1), 3, &rh, 2, 100, 5),
        Err(CosmicCoderError::SignalMismatch)
    );
    // Run hash.
    let other = bytes32(env, &hash_bytes(4));
    assert_eq!(
        try_submit(&ctx, &p, &vk, &run_signals(env, &h, 100, 5, 3, 1), 3, &other, 1, 100, 5),
        Err(CosmicCoderError::SignalMismatch)
    );
    // Nothing was recorded by the failed attempts.
    assert!(!ctx.client().is_nonce_used(&p, &1, &3));
}

#[test]
fn test_submit_zk_rejects_bad_signal_shapes() {
    let ctx = wired();
    let env = &ctx.env;
    let p = Address::generate(env);
    let h = hash_bytes(5);
    let rh = bytes32(env, &h);
    let vk = run_vk(env);

    let mut short = run_signals(env, &h, 100, 5, 5, 1);
    short.pop_back();
    assert_eq!(
        try_submit(&ctx, &p, &vk, &short, 5, &rh, 1, 100, 5),
        Err(CosmicCoderError::InvalidInput)
    );

    let mut bad_len = run_signals(env, &h, 100, 5, 5, 1);
    bad_len.set(2, Bytes::from_array(env, &[1u8; 31]));
    assert_eq!(
        try_submit(&ctx, &p, &vk, &bad_len, 5, &rh, 1, 100, 5),
        Err(CosmicCoderError::InvalidInput)
    );

    // used_zk_weapon must be 0 or 1.
    let mut bad_flag = run_signals(env, &h, 100, 5, 5, 1);
    let mut w = [0u8; 32];
    w[31] = 2;
    bad_flag.set(6, Bytes::from_array(env, &w));
    assert_eq!(
        try_submit(&ctx, &p, &vk, &bad_flag, 5, &rh, 1, 100, 5),
        Err(CosmicCoderError::InvalidZkProof)
    );

    // run_hash must be 32 bytes.
    assert_eq!(
        try_submit(&ctx, &p, &vk, &run_signals(env, &h, 100, 5, 5, 1), 5, &Bytes::from_array(env, &[0u8; 31]), 1, 100, 5),
        Err(CosmicCoderError::InvalidInput)
    );
}

#[test]
fn test_submit_zk_invalid_input_zero_score_or_wave() {
    let ctx = wired();
    let env = &ctx.env;
    let p = Address::generate(env);
    let h = hash_bytes(1);
    let rh = bytes32(env, &h);
    assert_eq!(
        try_submit(&ctx, &p, &run_vk(env), &run_signals(env, &h, 0, 5, 1, 1), 1, &rh, 1, 0, 5),
        Err(CosmicCoderError::InvalidInput)
    );
    assert_eq!(
        try_submit(&ctx, &p, &run_vk(env), &run_signals(env, &h, 10, 0, 1, 1), 1, &rh, 1, 10, 0),
        Err(CosmicCoderError::InvalidInput)
    );
}

#[test]
fn test_submit_zk_score_below_min() {
    let ctx = wired();
    let env = &ctx.env;
    let p = Address::generate(env);
    let h = hash_bytes(1);
    // wave=5 -> min_score=25; score=20 fails
    assert_eq!(
        try_submit(&ctx, &p, &run_vk(env), &run_signals(env, &h, 20, 5, 1, 1), 1, &bytes32(env, &h), 1, 20, 5),
        Err(CosmicCoderError::ScoreBelowMinimum)
    );
}

#[test]
fn test_submit_zk_verifier_rejects_proof() {
    let ctx = bare();
    let env = &ctx.env;
    let v = env.register(RejectingVerifier, ());
    ctx.client().set_verifier(&v);
    ctx.client().set_run_vk(&run_vk(env));
    let p = Address::generate(env);
    let h = hash_bytes(1);
    assert_eq!(
        try_submit(&ctx, &p, &run_vk(env), &run_signals(env, &h, 100, 5, 1, 1), 1, &bytes32(env, &h), 1, 100, 5),
        Err(CosmicCoderError::InvalidProof)
    );
    assert!(!ctx.client().is_nonce_used(&p, &1, &1));
}

#[test]
fn test_submit_zk_verifier_error_is_typed() {
    let ctx = bare();
    let env = &ctx.env;
    let v = env.register(ErroringVerifier, ());
    ctx.client().set_verifier(&v);
    ctx.client().set_run_vk(&run_vk(env));
    let p = Address::generate(env);
    let h = hash_bytes(1);
    assert_eq!(
        try_submit(&ctx, &p, &run_vk(env), &run_signals(env, &h, 100, 5, 1, 1), 1, &bytes32(env, &h), 1, 100, 5),
        Err(CosmicCoderError::VerifierError)
    );
}

#[test]
fn test_submit_zk_verifier_crash_is_typed() {
    let ctx = bare();
    let env = &ctx.env;
    // Not a contract at all: host-level invoke failure.
    let v = Address::generate(env);
    ctx.client().set_verifier(&v);
    ctx.client().set_run_vk(&run_vk(env));
    let p = Address::generate(env);
    let h = hash_bytes(1);
    assert_eq!(
        try_submit(&ctx, &p, &run_vk(env), &run_signals(env, &h, 100, 5, 1, 1), 1, &bytes32(env, &h), 1, 100, 5),
        Err(CosmicCoderError::VerifierCrash)
    );
}

#[test]
fn test_submit_zk_hub_failure_rolls_back() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let good_hub = env.register(MockHub, ());
    let id = env.register(CosmicCoder, (admin.clone(), good_hub));
    let c = CosmicCoderClient::new(&env, &id);
    let verifier = env.register(Groth16Verifier, ());
    c.set_verifier(&verifier);
    c.set_run_vk(&run_vk(&env));
    let p = Address::generate(&env);
    c.start_match(&p);
    // Swap in a broken hub after the session started.
    let bad_hub = env.register(PanicHub, ());
    c.set_game_hub(&bad_hub);
    let h = hash_bytes(1);
    let r = c.try_submit_zk(
        &p,
        &zero_proof(&env),
        &run_vk(&env),
        &run_signals(&env, &h, 100, 5, 1, 1),
        &1u64,
        &bytes32(&env, &h),
        &1u32,
        &100u32,
        &5u32,
    );
    assert_eq!(expect_err(r), CosmicCoderError::GameHubCrash);
    assert!(!c.is_nonce_used(&p, &1, &1));
    assert_eq!(c.get_leaderboard_by_season(&1, &10).len(), 0);
}

#[test]
fn test_submit_zk_valid_updates_leaderboard_and_session() {
    let ctx = wired();
    let env = &ctx.env;
    let p = Address::generate(env);
    let s = ctx.client().start_match(&p);
    submit_ok(&ctx, &p, 77, 2, 200, 10);
    let lb = ctx.client().get_leaderboard_by_season(&2, &10);
    assert_eq!(lb.len(), 1);
    assert_eq!(lb.get(0).unwrap().player, p);
    assert_eq!(lb.get(0).unwrap().score, 200);
    assert_eq!(ctx.hub().ended(), vec![env, s]);
    assert!(ctx.client().is_nonce_used(&p, &2, &77));
}

#[test]
fn test_ranked_leaderboard_best_score_sorted_and_tie_order() {
    let ctx = wired();
    let env = &ctx.env;
    let a = Address::generate(env);
    let b = Address::generate(env);
    let c = Address::generate(env);
    submit_ok(&ctx, &a, 1, 1, 100, 5);
    submit_ok(&ctx, &b, 2, 1, 100, 5); // tie: a stays first (earlier)
    submit_ok(&ctx, &c, 3, 1, 300, 5);
    submit_ok(&ctx, &a, 4, 1, 50, 5); // worse: ignored
    let lb = ctx.client().get_leaderboard_by_season(&1, &10);
    assert_eq!(lb.len(), 3);
    assert_eq!(lb.get(0).unwrap().player, c);
    assert_eq!(lb.get(1).unwrap().player, a);
    assert_eq!(lb.get(1).unwrap().score, 100);
    assert_eq!(lb.get(2).unwrap().player, b);
    // limit honoured
    assert_eq!(ctx.client().get_leaderboard_by_season(&1, &2).len(), 2);
    // other seasons isolated
    assert_eq!(ctx.client().get_leaderboard_by_season(&9, &10).len(), 0);
}

#[test]
fn test_ranked_leaderboard_is_capped() {
    let ctx = wired();
    let env = &ctx.env;
    env.cost_estimate().budget().reset_unlimited();
    for i in 0..(MAX_LEADERBOARD_SIZE + 3) {
        let p = Address::generate(env);
        let score = 100 + i;
        submit_ok(&ctx, &p, i as u64 + 1, 1, score, 5);
    }
    let lb = ctx.client().get_leaderboard_by_season(&1, &u32::MAX);
    assert_eq!(lb.len(), MAX_LEADERBOARD_SIZE);
    assert_eq!(lb.get(0).unwrap().score, 100 + MAX_LEADERBOARD_SIZE + 2);
    for i in 1..lb.len() {
        assert!(lb.get(i - 1).unwrap().score >= lb.get(i).unwrap().score);
    }
}

#[test]
fn test_player_milestone_default_zero() {
    let ctx = wired();
    let p = Address::generate(&ctx.env);
    let ms: PlayerMilestone = ctx.client().get_player_milestone(&p, &1u32);
    assert_eq!(ms.tier, 0);
    assert_eq!(ms.best_wave, 0);
}

#[test]
fn test_player_milestone_updates_from_verified_submits() {
    let ctx = wired();
    let p = Address::generate(&ctx.env);
    submit_ok(&ctx, &p, 301, 1, 120, 5);
    let ms = ctx.client().get_player_milestone(&p, &1);
    assert_eq!((ms.tier, ms.best_wave), (1, 5));
    submit_ok(&ctx, &p, 302, 1, 220, 8);
    let ms = ctx.client().get_player_milestone(&p, &1);
    assert_eq!((ms.tier, ms.best_wave), (2, 8));
    submit_ok(&ctx, &p, 303, 1, 320, 10);
    let ms = ctx.client().get_player_milestone(&p, &1);
    assert_eq!((ms.tier, ms.best_wave), (3, 10));
    // Lower wave never downgrades.
    submit_ok(&ctx, &p, 304, 1, 320, 6);
    let ms = ctx.client().get_player_milestone(&p, &1);
    assert_eq!((ms.tier, ms.best_wave), (3, 10));
}

// ---------------------------------------------------------------------------
// submit_zk_noir (UltraHonk)
// ---------------------------------------------------------------------------

#[test]
fn test_submit_zk_noir_requires_noir_verifier() {
    let ctx = wired(); // Groth16 only
    let env = &ctx.env;
    let p = Address::generate(env);
    let h = hash_bytes(1);
    let r = ctx.client().try_submit_zk_noir(
        &p,
        &noir_blob(env, &h, 100, 5, 1, 1),
        &1u64,
        &bytes32(env, &h),
        &1u32,
        &100u32,
        &5u32,
    );
    assert_eq!(expect_err(r), CosmicCoderError::NoirVerifierNotSet);
}

#[test]
fn test_submit_zk_noir_success_exact_auth_and_replay() {
    let ctx = wired_noir();
    let env = &ctx.env;
    let p = Address::generate(env);
    let h = hash_bytes(1);
    let blob = noir_blob(env, &h, 100, 5, 11, 1);
    let rh = bytes32(env, &h);
    ctx.client()
        .submit_zk_noir(&p, &blob, &11u64, &rh, &1u32, &100u32, &5u32);
    assert_exact_auth(
        env,
        &p,
        &ctx.id,
        "submit_zk_noir",
        (p.clone(), blob.clone(), 11u64, rh.clone(), 1u32, 100u32, 5u32).into_val(env),
    );
    let lb = ctx.client().get_leaderboard_by_season(&1, &10);
    assert_eq!(lb.get(0).unwrap().player, p);
    assert_eq!(
        expect_err(ctx.client().try_submit_zk_noir(&p, &blob, &11u64, &rh, &1u32, &100u32, &5u32)),
        CosmicCoderError::Replay
    );
}

#[test]
fn test_submit_zk_noir_signal_binding() {
    let ctx = wired_noir();
    let env = &ctx.env;
    let p = Address::generate(env);
    let h = hash_bytes(1);
    let rh = bytes32(env, &h);
    let blob = noir_blob(env, &h, 100, 5, 11, 1);
    let c = ctx.client();
    assert_eq!(
        expect_err(c.try_submit_zk_noir(&p, &blob, &11u64, &rh, &1u32, &999u32, &5u32)),
        CosmicCoderError::SignalMismatch
    );
    assert_eq!(
        expect_err(c.try_submit_zk_noir(&p, &blob, &12u64, &rh, &1u32, &100u32, &5u32)),
        CosmicCoderError::SignalMismatch
    );
    assert_eq!(
        expect_err(c.try_submit_zk_noir(&p, &blob, &11u64, &rh, &2u32, &100u32, &5u32)),
        CosmicCoderError::SignalMismatch
    );
    assert_eq!(
        expect_err(c.try_submit_zk_noir(&p, &blob, &11u64, &rh, &1u32, &100u32, &6u32)),
        CosmicCoderError::SignalMismatch
    );
}

#[test]
fn test_submit_zk_noir_rejects_short_blob_and_bad_inputs() {
    let ctx = wired_noir();
    let env = &ctx.env;
    let p = Address::generate(env);
    let h = hash_bytes(1);
    let rh = bytes32(env, &h);
    let c = ctx.client();
    let short = Bytes::from_array(env, &[0u8; 36]);
    assert_eq!(
        expect_err(c.try_submit_zk_noir(&p, &short, &1u64, &rh, &1u32, &100u32, &5u32)),
        CosmicCoderError::InvalidInput
    );
    let blob = noir_blob(env, &h, 20, 5, 1, 1);
    assert_eq!(
        expect_err(c.try_submit_zk_noir(&p, &blob, &1u64, &rh, &1u32, &20u32, &5u32)),
        CosmicCoderError::ScoreBelowMinimum
    );
    let blob = noir_blob(env, &h, 100, 5, 1, 1);
    assert_eq!(
        expect_err(c.try_submit_zk_noir(&p, &blob, &1u64, &Bytes::new(env), &1u32, &100u32, &5u32)),
        CosmicCoderError::InvalidInput
    );
}

// ---------------------------------------------------------------------------
// submit_score / stats
// ---------------------------------------------------------------------------

#[test]
fn test_submit_score_stats_tiers_and_exact_auth() {
    let ctx = wired();
    let env = &ctx.env;
    let p = Address::generate(env);
    let c = ctx.client();
    assert_eq!(c.get_player_tier(&p), 1);
    assert!(!c.can_start_match(&p));

    c.submit_score(&p, &500);
    assert_exact_auth(env, &p, &ctx.id, "submit_score", (p.clone(), 500u32).into_val(env));
    c.submit_score(&p, &1200);
    c.submit_score(&p, &10);
    assert_eq!(c.get_games_played(&p), 3);
    assert_eq!(c.get_best_score(&p), 1200);
    assert_eq!(c.get_player_tier(&p), 2);
    assert!(c.can_start_match(&p));

    c.submit_score(&p, &5000);
    assert_eq!(c.get_player_tier(&p), 3);
    c.submit_score(&p, &10_000);
    assert_eq!(c.get_player_tier(&p), 4);
}

#[test]
fn test_submit_score_fails_without_auth() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let hub = env.register(MockHub, ());
    let id = env.register(CosmicCoder, (admin, hub));
    let p = Address::generate(&env);
    assert!(CosmicCoderClient::new(&env, &id).try_submit_score(&p, &10).is_err());
}

// ---------------------------------------------------------------------------
// unlock_weapon
// ---------------------------------------------------------------------------

fn unlock_signals(env: &Env, threshold: u32, public_hash: u8) -> SorobanVec<BytesN<32>> {
    let mut h = [0u8; 32];
    h[31] = public_hash;
    h[0] = 0x01;
    vec![env, BytesN::from_array(env, &field(threshold as u64)), BytesN::from_array(env, &h)]
}

#[test]
fn test_unlock_weapon_success_exact_auth() {
    let ctx = wired();
    let env = &ctx.env;
    let p = Address::generate(env);
    let sig = unlock_signals(env, 1000, 1);
    let vk = unlock_vk(env);
    let proof = zero_proof(env);
    ctx.client().unlock_weapon(&p, &2, &proof, &vk, &sig, &1000);
    assert_exact_auth(
        env,
        &p,
        &ctx.id,
        "unlock_weapon",
        (p.clone(), 2u32, proof.clone(), vk.clone(), sig.clone(), 1000u32).into_val(env),
    );
    assert!(ctx.client().is_weapon_unlocked(&p, &2));
    assert!(!ctx.client().is_weapon_unlocked(&p, &3));
    assert_eq!(ctx.client().get_unlocked_weapons(&p), vec![env, 2u32]);
}

#[test]
fn test_unlock_weapon_negative_paths() {
    let ctx = wired();
    let env = &ctx.env;
    let p = Address::generate(env);
    let c = ctx.client();
    let vk = unlock_vk(env);
    let proof = zero_proof(env);

    assert_eq!(
        expect_err(c.try_unlock_weapon(&p, &0, &proof, &vk, &unlock_signals(env, 0, 1), &0)),
        CosmicCoderError::InvalidWeapon
    );
    assert_eq!(
        expect_err(c.try_unlock_weapon(&p, &6, &proof, &vk, &unlock_signals(env, 0, 1), &0)),
        CosmicCoderError::InvalidWeapon
    );
    assert_eq!(
        expect_err(c.try_unlock_weapon(&p, &2, &proof, &vk, &unlock_signals(env, 5, 1), &5)),
        CosmicCoderError::ThresholdMismatch
    );
    // Proof was generated for a lower threshold than claimed.
    assert_eq!(
        expect_err(c.try_unlock_weapon(&p, &3, &proof, &vk, &unlock_signals(env, 1000, 1), &5000)),
        CosmicCoderError::SignalMismatch
    );
    let mut wrong_vk = vk.clone();
    wrong_vk.alpha = BytesN::from_array(env, &[9u8; G1_SIZE]);
    assert_eq!(
        expect_err(c.try_unlock_weapon(&p, &2, &proof, &wrong_vk, &unlock_signals(env, 1000, 1), &1000)),
        CosmicCoderError::VkMismatch
    );
    let mut three = unlock_signals(env, 1000, 1);
    three.push_back(BytesN::from_array(env, &[0u8; 32]));
    assert_eq!(
        expect_err(c.try_unlock_weapon(&p, &2, &proof, &vk, &three, &1000)),
        CosmicCoderError::InvalidInput
    );

    c.unlock_weapon(&p, &2, &proof, &vk, &unlock_signals(env, 1000, 1), &1000);
    assert_eq!(
        expect_err(c.try_unlock_weapon(&p, &2, &proof, &vk, &unlock_signals(env, 1000, 2), &1000)),
        CosmicCoderError::AlreadyUnlocked
    );
    // Another player replaying the same proof (same public hash) is rejected.
    let q = Address::generate(env);
    assert_eq!(
        expect_err(c.try_unlock_weapon(&q, &2, &proof, &vk, &unlock_signals(env, 1000, 1), &1000)),
        CosmicCoderError::Replay
    );
}

#[test]
fn test_unlock_weapon_requires_unlock_vk() {
    let ctx = bare();
    let env = &ctx.env;
    let verifier = env.register(Groth16Verifier, ());
    ctx.client().set_verifier(&verifier);
    let p = Address::generate(env);
    assert_eq!(
        expect_err(ctx.client().try_unlock_weapon(
            &p,
            &2,
            &zero_proof(env),
            &unlock_vk(env),
            &unlock_signals(env, 1000, 1),
            &1000
        )),
        CosmicCoderError::VkNotSet
    );
}

#[test]
fn test_unlock_weapon_fails_without_auth() {
    let ctx = wired();
    let env = &ctx.env;
    env.set_auths(&[]);
    let p = Address::generate(env);
    assert!(ctx
        .client()
        .try_unlock_weapon(&p, &2, &zero_proof(env), &unlock_vk(env), &unlock_signals(env, 1000, 1), &1000)
        .is_err());
}

// ---------------------------------------------------------------------------
// Real proof (optional; needs `npm run zk:proof`)
// ---------------------------------------------------------------------------

fn hex_to_array<const N: usize>(hex: &str) -> [u8; N] {
    let hex = hex.trim_start_matches("0x");
    assert!(hex.len() == N * 2, "hex len {} for [u8; {}]", hex.len(), N);
    let mut arr = [0u8; N];
    for (i, c) in hex.as_bytes().chunks(2).enumerate() {
        arr[i] = u8::from_str_radix(std::str::from_utf8(c).unwrap(), 16).unwrap();
    }
    arr
}

fn be_u64(a: &[u8; 32]) -> u64 {
    let mut b = [0u8; 8];
    b.copy_from_slice(&a[24..]);
    u64::from_be_bytes(b)
}

/// When circuits/build/contract_proof.json exists, verifies the real proof on the
/// verifier and submits it through the policy with arguments bound to its signals.
#[test]
fn test_real_proof_verifier_and_submit_zk() {
    let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").unwrap();
    let path = std::path::Path::new(&manifest_dir).join("../../circuits/build/contract_proof.json");
    if !path.exists() {
        return;
    }
    let json: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
    let proof_j = json.get("proof").unwrap();
    let vk_j = json.get("vk").unwrap();
    let pub_j = json.get("pub_signals").unwrap().as_array().unwrap();

    let ctx = bare();
    let env = &ctx.env;
    let s = |v: &serde_json::Value, k: &str| std::string::String::from(v.get(k).unwrap().as_str().unwrap());

    let proof = ZkProof {
        a: BytesN::from_array(env, &hex_to_array::<64>(&s(proof_j, "a"))),
        b: BytesN::from_array(env, &hex_to_array::<128>(&s(proof_j, "b"))),
        c: BytesN::from_array(env, &hex_to_array::<64>(&s(proof_j, "c"))),
    };
    let mut ic = SorobanVec::new(env);
    for h in vk_j.get("ic").unwrap().as_array().unwrap() {
        ic.push_back(BytesN::from_array(env, &hex_to_array::<64>(h.as_str().unwrap())));
    }
    let vk = ZkVerificationKey {
        alpha: BytesN::from_array(env, &hex_to_array::<64>(&s(vk_j, "alpha"))),
        beta: BytesN::from_array(env, &hex_to_array::<128>(&s(vk_j, "beta"))),
        gamma: BytesN::from_array(env, &hex_to_array::<128>(&s(vk_j, "gamma"))),
        delta: BytesN::from_array(env, &hex_to_array::<128>(&s(vk_j, "delta"))),
        ic,
    };
    let raw: std::vec::Vec<[u8; 32]> = pub_j.iter().map(|h| hex_to_array::<32>(h.as_str().unwrap())).collect();
    let mut pub_n = SorobanVec::new(env);
    let mut pub_b = SorobanVec::new(env);
    for a in &raw {
        pub_n.push_back(BytesN::from_array(env, a));
        pub_b.push_back(Bytes::from_array(env, a));
    }

    let verifier = env.register(Groth16Verifier, ());
    assert!(Groth16VerifierClient::new(env, &verifier).verify_proof(&vk, &proof, &pub_n));

    let c = ctx.client();
    c.set_verifier(&verifier);
    c.set_run_vk(&vk);

    let mut run_hash = [0u8; 32];
    run_hash[..16].copy_from_slice(&raw[0][16..]);
    run_hash[16..].copy_from_slice(&raw[1][16..]);
    let score = be_u64(&raw[2]) as u32;
    let wave = be_u64(&raw[3]) as u32;
    let nonce = be_u64(&raw[4]);
    let season = be_u64(&raw[5]) as u32;

    let p = Address::generate(env);
    c.submit_zk(&p, &proof, &vk, &pub_b, &nonce, &Bytes::from_array(env, &run_hash), &season, &score, &wave);
    assert!(c.is_nonce_used(&p, &season, &nonce));
}

/// Committed fixture: real GameRun proof for score=300, wave=3 (circuits/fixtures/gamerun_s300_w3.json,
/// proven with circuits/build/GameRun_final.zkey, the same VK the deploy script pins via set_run_vk).
const S300_W3_PROOF: &str = include_str!("../../../circuits/fixtures/gamerun_s300_w3.json");

fn parse_real_proof(env: &Env, json: &str) -> (ZkProof, ZkVerificationKey, std::vec::Vec<[u8; 32]>) {
    let json: serde_json::Value = serde_json::from_str(json).unwrap();
    let s = |v: &serde_json::Value, k: &str| std::string::String::from(v.get(k).unwrap().as_str().unwrap());
    let p = json.get("proof").unwrap();
    let v = json.get("vk").unwrap();
    let proof = ZkProof {
        a: BytesN::from_array(env, &hex_to_array::<64>(&s(p, "a"))),
        b: BytesN::from_array(env, &hex_to_array::<128>(&s(p, "b"))),
        c: BytesN::from_array(env, &hex_to_array::<64>(&s(p, "c"))),
    };
    let mut ic = SorobanVec::new(env);
    for h in v.get("ic").unwrap().as_array().unwrap() {
        ic.push_back(BytesN::from_array(env, &hex_to_array::<64>(h.as_str().unwrap())));
    }
    let vk = ZkVerificationKey {
        alpha: BytesN::from_array(env, &hex_to_array::<64>(&s(v, "alpha"))),
        beta: BytesN::from_array(env, &hex_to_array::<128>(&s(v, "beta"))),
        gamma: BytesN::from_array(env, &hex_to_array::<128>(&s(v, "gamma"))),
        delta: BytesN::from_array(env, &hex_to_array::<128>(&s(v, "delta"))),
        ic,
    };
    let raw = json
        .get("pub_signals")
        .unwrap()
        .as_array()
        .unwrap()
        .iter()
        .map(|h| hex_to_array::<32>(h.as_str().unwrap()))
        .collect();
    (proof, vk, raw)
}

fn signals_bytes(env: &Env, raw: &[[u8; 32]]) -> SorobanVec<Bytes> {
    let mut v = SorobanVec::new(env);
    for a in raw {
        v.push_back(Bytes::from_array(env, a));
    }
    v
}

/// Real score=300/wave=3 proof: accepted once, rejected on a claimed-score change (SignalMismatch),
/// on a signal tampered consistently with the claim (InvalidProof) and on replay (Replay).
#[test]
fn test_real_proof_s300_w3_submit_mismatch_replay() {
    let ctx = bare();
    let env = &ctx.env;
    let (proof, vk, raw) = parse_real_proof(env, S300_W3_PROOF);
    assert_eq!(raw.len(), 7);

    let c = ctx.client();
    c.set_verifier(&env.register(Groth16Verifier, ()));
    c.set_run_vk(&vk);

    let mut rh = [0u8; 32];
    rh[..16].copy_from_slice(&raw[0][16..]);
    rh[16..].copy_from_slice(&raw[1][16..]);
    let run_hash = Bytes::from_array(env, &rh);
    let (score, wave, nonce, season) = (be_u64(&raw[2]) as u32, be_u64(&raw[3]) as u32, be_u64(&raw[4]), be_u64(&raw[5]) as u32);
    assert_eq!((score, wave), (300, 3));
    let sig = signals_bytes(env, &raw);
    let p = Address::generate(env);

    let submit = |sig: &SorobanVec<Bytes>, score: u32| match c.try_submit_zk(&p, &proof, &vk, sig, &nonce, &run_hash, &season, &score, &wave) {
        Ok(Ok(())) => Ok(()),
        Err(Ok(e)) => Err(e),
        other => panic!("unexpected host-level result: {:?}", other),
    };

    // Claimed score != proven score.
    assert_eq!(submit(&sig, 301), Err(CosmicCoderError::SignalMismatch));
    // Signal and claim both changed to 301: the binding passes but the pairing fails.
    let mut forged = raw.clone();
    forged[2] = {
        let mut a = [0u8; 32];
        a[24..].copy_from_slice(&301u64.to_be_bytes());
        a
    };
    assert_eq!(submit(&signals_bytes(env, &forged), 301), Err(CosmicCoderError::InvalidProof));
    assert!(!c.is_nonce_used(&p, &season, &nonce));

    assert_eq!(submit(&sig, score), Ok(()));
    assert!(c.is_nonce_used(&p, &season, &nonce));
    assert_eq!(submit(&sig, score), Err(CosmicCoderError::Replay));
}

const V3_S300_W3_PROOF: &str = include_str!("../../../circuits/fixtures/gamerun_v3_s300_w3.json");

/// GameRunV3 (private seed/kills/events_hash, run_hash = Poseidon commitment): same 7-signal layout, so
/// submit_zk accepts it once its VK is pinned. Claimed score != proven -> SignalMismatch; replay -> Replay;
/// the GameRun (V1) VK no longer matches -> VkMismatch.
#[test]
fn test_real_proof_v3_s300_w3_submit_mismatch_replay() {
    let ctx = bare();
    let env = &ctx.env;
    let (proof, vk, raw) = parse_real_proof(env, V3_S300_W3_PROOF);
    assert_eq!(raw.len(), 7);
    let (v1_proof, v1_vk, v1_raw) = parse_real_proof(env, S300_W3_PROOF);
    assert!(vk != v1_vk);

    let c = ctx.client();
    c.set_verifier(&env.register(Groth16Verifier, ()));
    c.set_run_vk(&vk);

    let mut rh = [0u8; 32];
    rh[..16].copy_from_slice(&raw[0][16..]);
    rh[16..].copy_from_slice(&raw[1][16..]);
    let run_hash = Bytes::from_array(env, &rh);
    let (score, wave, nonce, season) = (be_u64(&raw[2]) as u32, be_u64(&raw[3]) as u32, be_u64(&raw[4]), be_u64(&raw[5]) as u32);
    assert_eq!((score, wave), (300, 3));
    let sig = signals_bytes(env, &raw);
    let p = Address::generate(env);

    let submit = |proof: &ZkProof, vk: &ZkVerificationKey, sig: &SorobanVec<Bytes>, run_hash: &Bytes, score: u32| {
        match c.try_submit_zk(&p, proof, vk, sig, &nonce, run_hash, &season, &score, &wave) {
            Ok(Ok(())) => Ok(()),
            Err(Ok(e)) => Err(e),
            other => panic!("unexpected host-level result: {:?}", other),
        }
    };

    // A V1 (GameRun) proof is rejected once the V3 VK is pinned.
    let mut v1_rh = [0u8; 32];
    v1_rh[..16].copy_from_slice(&v1_raw[0][16..]);
    v1_rh[16..].copy_from_slice(&v1_raw[1][16..]);
    assert_eq!(
        submit(&v1_proof, &v1_vk, &signals_bytes(env, &v1_raw), &Bytes::from_array(env, &v1_rh), 300),
        Err(CosmicCoderError::VkMismatch)
    );
    // Claimed score != proven score.
    assert_eq!(submit(&proof, &vk, &sig, &run_hash, 301), Err(CosmicCoderError::SignalMismatch));
    // run_hash that is not the circuit's Poseidon commitment.
    let mut bad_rh = rh;
    bad_rh[31] ^= 1;
    assert_eq!(submit(&proof, &vk, &sig, &Bytes::from_array(env, &bad_rh), score), Err(CosmicCoderError::SignalMismatch));
    assert!(!c.is_nonce_used(&p, &season, &nonce));

    assert_eq!(submit(&proof, &vk, &sig, &run_hash, score), Ok(()));
    assert!(c.is_nonce_used(&p, &season, &nonce));
    assert_eq!(submit(&proof, &vk, &sig, &run_hash, score), Err(CosmicCoderError::Replay));
}

// ---------------------------------------------------------------------------
// Leaderboard TTL
// ---------------------------------------------------------------------------

const DAY: u32 = 17_280;

fn board_ttl(ctx: &Ctx, key: &DataKey) -> u32 {
    ctx.env
        .as_contract(&ctx.id, || ctx.env.storage().persistent().get_ttl(key))
}

fn advance_ledgers(env: &Env, n: u32) {
    env.ledger().with_mut(|l| l.sequence_number += n);
}

/// A submit that does not change the casual board still extends its TTL.
#[test]
fn test_casual_board_ttl_extended_on_unchanged_submit() {
    let ctx = wired();
    let env = &ctx.env;
    let p = Address::generate(env);
    ctx.client().submit_result(&p, &2, &100);
    let full = board_ttl(&ctx, &DataKey::CasualBoard);
    advance_ledgers(env, 2 * DAY);
    assert_eq!(board_ttl(&ctx, &DataKey::CasualBoard), full - 2 * DAY);

    ctx.client().submit_result(&p, &1, &10); // worse score: board unchanged
    assert_eq!(board_ttl(&ctx, &DataKey::CasualBoard), full);
}

/// A verified ranked run that does not change the season board still extends its TTL.
#[test]
fn test_ranked_board_ttl_extended_on_unchanged_submit() {
    let ctx = wired();
    let env = &ctx.env;
    let p = Address::generate(env);
    submit_ok(&ctx, &p, 1, 7, 500, 10);
    let key = DataKey::RankedBoard(7);
    let full = board_ttl(&ctx, &key);
    advance_ledgers(env, 2 * DAY);
    assert_eq!(board_ttl(&ctx, &key), full - 2 * DAY);

    submit_ok(&ctx, &p, 2, 7, 60, 10); // worse score: board unchanged
    assert_eq!(board_ttl(&ctx, &key), full);
}

// ---------------------------------------------------------------------------
// Non-canonical scalar replay (unlock)
// ---------------------------------------------------------------------------

/// `public_hash + r` is the same field element for the pairing; the verifier must reject it so
/// the same proof cannot be replayed under a second `UnlockProof` key.
#[test]
fn test_unlock_replay_with_non_canonical_hash_is_rejected() {
    let ctx = wired();
    let env = &ctx.env;
    let c = ctx.client();
    let vk = unlock_vk(env);
    let proof = zero_proof(env);
    let p = Address::generate(env);
    // public_hash = 1 (canonical).
    let mut h = [0u8; 32];
    h[31] = 1;
    let sig = vec![env, BytesN::from_array(env, &field(1000)), BytesN::from_array(env, &h)];
    c.unlock_weapon(&p, &2, &proof, &vk, &sig, &1000);

    // public_hash = 1 + r (non-canonical alias of the same scalar).
    let alias: [u8; 32] = [
        0x30, 0x64, 0x4e, 0x72, 0xe1, 0x31, 0xa0, 0x29, 0xb8, 0x50, 0x45, 0xb6, 0x81, 0x81, 0x58,
        0x5d, 0x28, 0x33, 0xe8, 0x48, 0x79, 0xb9, 0x70, 0x91, 0x43, 0xe1, 0xf5, 0x93, 0xf0, 0x00,
        0x00, 0x02,
    ];
    let q = Address::generate(env);
    let sig2 = vec![env, BytesN::from_array(env, &field(1000)), BytesN::from_array(env, &alias)];
    assert_eq!(
        expect_err(c.try_unlock_weapon(&q, &2, &proof, &vk, &sig2, &1000)),
        CosmicCoderError::VerifierError
    );
    assert!(!c.is_weapon_unlocked(&q, &2));
}

/// Real SkillProof for weapon 2 (threshold 1000, score 1500 private) proven with
/// circuits/build/SkillProof_final.zkey; its VK is the one pinned on testnet with set_unlock_vk.
const SKILL_W2_T1000_PROOF: &str = include_str!("../../../circuits/fixtures/skillproof_w2_t1000.json");

/// Real unlock proof: threshold mismatch -> ThresholdMismatch, tampered public_hash -> InvalidProof,
/// accepted once, then AlreadyUnlocked for the same player and Replay for any other player.
#[test]
fn test_real_skill_proof_w2_unlock_mismatch_replay() {
    let ctx = bare();
    let env = &ctx.env;
    let (proof, vk, raw) = parse_real_proof(env, SKILL_W2_T1000_PROOF);
    assert_eq!(raw.len() as u32, UNLOCK_PUBLIC_SIGNALS);
    assert_eq!(be_u64(&raw[0]), 1000);

    let c = ctx.client();
    c.set_verifier(&env.register(Groth16Verifier, ()));
    c.set_unlock_vk(&vk);

    let signals = |raw: &[[u8; 32]]| {
        let mut v = SorobanVec::new(env);
        for a in raw {
            v.push_back(BytesN::from_array(env, a));
        }
        v
    };
    let sig = signals(&raw);
    let unlock = |p: &Address, weapon: u32, sig: &SorobanVec<BytesN<32>>, threshold: u32| {
        match c.try_unlock_weapon(p, &weapon, &proof, &vk, sig, &threshold) {
            Ok(Ok(())) => Ok(()),
            Err(Ok(e)) => Err(e),
            other => panic!("unexpected host-level result: {:?}", other),
        }
    };
    let p = Address::generate(env);

    assert_eq!(unlock(&p, 2, &sig, 5000), Err(CosmicCoderError::ThresholdMismatch));
    assert_eq!(unlock(&p, 3, &sig, 5000), Err(CosmicCoderError::SignalMismatch));
    let mut forged = raw.clone();
    forged[1][31] ^= 1;
    assert_eq!(unlock(&p, 2, &signals(&forged), 1000), Err(CosmicCoderError::InvalidProof));
    assert!(!c.is_weapon_unlocked(&p, &2));

    assert_eq!(unlock(&p, 2, &sig, 1000), Ok(()));
    assert!(c.is_weapon_unlocked(&p, &2));
    assert_eq!(c.get_unlocked_weapons(&p), vec![env, 2u32]);
    assert_eq!(unlock(&p, 2, &sig, 1000), Err(CosmicCoderError::AlreadyUnlocked));
    assert_eq!(unlock(&Address::generate(env), 2, &sig, 1000), Err(CosmicCoderError::Replay));
}
