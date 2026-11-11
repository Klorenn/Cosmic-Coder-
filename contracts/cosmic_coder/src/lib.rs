//! Cosmic Coder — ZK-ranked survival game on Stellar (Soroban).
//!
//! Responsibilities (policy layer; no cryptography here):
//! - Admin-controlled configuration: Game Hub, Groth16 verifier, UltraHonk (Noir) verifier and
//!   the pinned verification keys. Set once in `__constructor`, changed only by the stored admin.
//! - Ranked submissions (`submit_zk` Groth16, `submit_zk_noir` UltraHonk): every claimed value
//!   (score, wave, nonce, season, run hash) must match the proof's public signals, the VK must
//!   be the admin-registered one, and `(player, season_id, nonce)` can be used only once.
//! - Casual submissions (`submit_result`) and self-reported stats (`submit_score`): signed by
//!   the player, never trusted for ranked data.
//! - Bounded, deterministic leaderboards (max `MAX_LEADERBOARD_SIZE`, score desc, ties keep the
//!   earlier entry first).
//! - Game Hub integration: `start_match` opens a per-player session; the next submission by
//!   the same player closes exactly that session.

#![no_std]
// The ranked entry points take 7-10 arguments: that ABI is fixed by the frontend clients.
#![allow(clippy::too_many_arguments)]

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, vec, Address, Bytes,
    BytesN, Env, IntoVal, Symbol, TryFromVal, Val, Vec,
};
use zk_types::{Groth16Error, ZkProof, ZkVerificationKey};

// ---------------------------------------------------------------------------
// Game rules
// ---------------------------------------------------------------------------

/// Minimum score per survived wave. Must match `GameRun.circom` and `circuits/noir/src/main.nr`
/// (`score >= wave * 5`) and the client-side `validateGameRules`.
pub const MIN_SCORE_PER_WAVE: u32 = 5;

/// Hard cap of entries kept per leaderboard (ranked per season, and casual). Keeps every
/// leaderboard loop bounded regardless of player count.
pub const MAX_LEADERBOARD_SIZE: u32 = 100;

/// Public signals of the GameRun circuit:
/// `[run_hash_hi, run_hash_lo, score, wave, nonce, season_id, used_zk_weapon]`.
pub const RUN_PUBLIC_SIGNALS: u32 = 7;

/// Public signals of the SkillProof (weapon unlock) circuit: `[threshold, public_hash]`.
pub const UNLOCK_PUBLIC_SIGNALS: u32 = 2;

/// Weapons are numbered 1..=MAX_WEAPON_ID.
pub const MAX_WEAPON_ID: u32 = 5;

/// Score threshold required (and proven in-circuit) to unlock weapon `id` = index + 1:
/// 1 Starter, 2 Shotgun, 3 Tactical Rifle, 4 Plasma Rifle, 5 Quantum Destroyer.
pub const WEAPON_THRESHOLDS: [u32; MAX_WEAPON_ID as usize] = [0, 1_000, 5_000, 10_000, 20_000];

/// Ranked milestone tiers by best verified wave in a season.
pub const MILESTONE_TIER1_WAVE: u32 = 5;
pub const MILESTONE_TIER2_WAVE: u32 = 8;
pub const MILESTONE_TIER3_WAVE: u32 = 10;

/// Player tier by best self-reported score (1 Bronze, 2 Silver, 3 Gold, 4 Mythic).
pub const TIER_SILVER_MIN_SCORE: u32 = 1_000;
pub const TIER_GOLD_MIN_SCORE: u32 = 5_000;
pub const TIER_MYTHIC_MIN_SCORE: u32 = 10_000;

/// `can_start_match` requires at least this many recorded games and a best score > 0.
pub const MIN_GAMES_TO_START_MATCH: u32 = 3;

// ---------------------------------------------------------------------------
// TTL policy (ledgers; ~5 s per ledger). TTL is for rent only, never for security:
// archived persistent entries are restored, not lost, so replay keys stay effective.
// ---------------------------------------------------------------------------

const DAY_IN_LEDGERS: u32 = 17_280;
const INSTANCE_BUMP: u32 = 30 * DAY_IN_LEDGERS;
const INSTANCE_THRESHOLD: u32 = INSTANCE_BUMP - DAY_IN_LEDGERS;
const PERSISTENT_BUMP: u32 = 90 * DAY_IN_LEDGERS;
const PERSISTENT_THRESHOLD: u32 = PERSISTENT_BUMP - DAY_IN_LEDGERS;
/// Open Game Hub sessions live in temporary storage; an abandoned session simply expires.
const SESSION_TTL: u32 = DAY_IN_LEDGERS;

/// Noir proof blob layout: `u32_be(total_fields) || public inputs (7 x 32 B) || proof fields`.
const NOIR_HEADER_LEN: u32 = 4;
const FIELD_LEN: u32 = 32;

// ---------------------------------------------------------------------------
// Errors (never renumber; append only)
// ---------------------------------------------------------------------------

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum CosmicCoderError {
    /// Groth16 verifier address not configured.
    VerifierNotSet = 1,
    /// `(player, season_id, nonce)` or unlock proof already used.
    Replay = 2,
    /// Verifier ran and rejected the proof.
    InvalidProof = 3,
    /// Verifier returned an error / undecodable value.
    VerifierError = 4,
    /// Malformed argument (lengths, zero score/wave, signal count).
    InvalidInput = 5,
    /// VK has the wrong number of IC points for the circuit.
    MalformedVk = 6,
    /// No VK registered by the admin for this circuit.
    VkNotSet = 7,
    /// Caller-supplied VK differs from the admin-registered one.
    VkMismatch = 8,
    /// A claimed argument does not match the proof's public signals.
    SignalMismatch = 9,
    /// `score < wave * MIN_SCORE_PER_WAVE`.
    ScoreBelowMinimum = 10,
    /// Negative casual score.
    NegativeScore = 11,
    /// Weapon id outside 1..=MAX_WEAPON_ID.
    InvalidWeapon = 12,
    /// Threshold does not match the weapon's required threshold.
    ThresholdMismatch = 13,
    /// Weapon already unlocked for this player.
    AlreadyUnlocked = 14,
    /// Checked arithmetic overflow.
    Overflow = 15,
    /// UltraHonk (Noir) verifier address not configured.
    NoirVerifierNotSet = 16,
    /// `accept_admin` called with no admin transfer proposed.
    NoPendingAdmin = 17,
    /// Verifier invocation trapped at host level.
    VerifierCrash = 100,
    /// Game Hub invocation failed.
    GameHubCrash = 101,
    /// Public signal outside its allowed domain (e.g. `used_zk_weapon` not 0/1).
    InvalidZkProof = 102,
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/// Casual leaderboard entry (self-reported, signed by the player).
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LeaderboardEntry {
    pub player: Address,
    pub wave: u32,
    pub score: i128,
}

/// Ranked (ZK-verified) leaderboard entry for a season.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ScoreEntry {
    pub player: Address,
    pub score: u32,
}

/// Per-player ranked milestone for a season, derived only from verified submissions.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PlayerMilestone {
    /// 0 = none, 1 = wave >= 5, 2 = wave >= 8, 3 = wave >= 10.
    pub tier: u32,
    pub best_wave: u32,
}

/// Every storage key. Instance: config. Persistent: player/season data and replay guards.
/// Temporary: open Game Hub sessions.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    Admin,
    GameHub,
    Verifier,
    NoirVerifier,
    RunVk,
    UnlockVk,
    SessionCounter,
    /// Open Game Hub session of a player (temporary storage).
    ActiveSession(Address),
    /// Anti-replay guard for ranked runs: (player, season_id, nonce).
    Replay(Address, u32, u64),
    /// Anti-replay guard for weapon unlock proofs: public hash signal.
    UnlockProof(BytesN<32>),
    RankedBoard(u32),
    CasualBoard,
    Milestone(Address, u32),
    GamesPlayed(Address),
    BestScore(Address),
    WeaponUnlocked(Address, u32),
    /// Admin proposed by `propose_admin`, awaiting `accept_admin` (instance storage).
    PendingAdmin,
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ZkRunSubmitted {
    #[topic]
    pub player: Address,
    #[topic]
    pub season_id: u32,
    pub score: u32,
    pub wave: u32,
    pub run_hash: Bytes,
}

/// Emitted when a verified run reports `used_zk_weapon == 1` (ZK Plasma Rifle).
#[contractevent(topics = ["zk_wpn"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ZkWeaponUsed {
    #[topic]
    pub player: Address,
    pub season_id: u32,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ResultSubmitted {
    #[topic]
    pub player: Address,
    pub wave: u32,
    pub score: i128,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ScoreSubmitted {
    #[topic]
    pub player: Address,
    pub score: u32,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WeaponUnlocked {
    #[topic]
    pub player: Address,
    pub weapon_id: u32,
    pub threshold: u32,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MatchStarted {
    #[topic]
    pub player: Address,
    pub session: u32,
}

/// Admin configuration change. `field` is one of: admin, pending_admin, game_hub, verifier,
/// noir_verifier, run_vk, unlock_vk.
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ConfigUpdated {
    #[topic]
    pub field: Symbol,
    pub admin: Address,
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

fn bump_instance(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(INSTANCE_THRESHOLD, INSTANCE_BUMP);
}

fn read_admin(env: &Env) -> Address {
    env.storage()
        .instance()
        .get(&DataKey::Admin)
        .expect("admin set in constructor")
}

/// Loads the admin from storage and requires its signature. Returns it for event payloads.
fn require_admin(env: &Env) -> Address {
    let admin = read_admin(env);
    admin.require_auth();
    bump_instance(env);
    admin
}

fn config_updated(env: &Env, field: &str, admin: Address) {
    ConfigUpdated {
        field: Symbol::new(env, field),
        admin,
    }
    .publish(env);
}

fn set_persistent<V: IntoVal<Env, Val>>(env: &Env, key: &DataKey, val: &V) {
    let s = env.storage().persistent();
    s.set(key, val);
    s.extend_ttl(key, PERSISTENT_THRESHOLD, PERSISTENT_BUMP);
}

/// Writes the board when it changed, otherwise only extends its TTL: boards are read by every
/// client, so each submission keeps them alive even if the entry did not make the cut.
fn persist_board<V: IntoVal<Env, Val>>(env: &Env, key: &DataKey, board: &V, changed: bool) {
    if changed {
        set_persistent(env, key, board);
    } else if env.storage().persistent().has(key) {
        env.storage()
            .persistent()
            .extend_ttl(key, PERSISTENT_THRESHOLD, PERSISTENT_BUMP);
    }
}

/// Replay guards are extended to the network maximum on write.
fn set_replay_guard(env: &Env, key: &DataKey) {
    let s = env.storage().persistent();
    s.set(key, &true);
    let max = env.storage().max_ttl();
    s.extend_ttl(key, max, max);
}

/// Big-endian 32-byte field element encoding of a small unsigned integer.
fn field_from_u64(v: u64) -> [u8; 32] {
    let mut a = [0u8; 32];
    a[24..].copy_from_slice(&v.to_be_bytes());
    a
}

/// Field element whose low 16 bytes are `half` (a u128 limb of the run hash).
fn field_from_u128_half(half: &[u8]) -> [u8; 32] {
    let mut a = [0u8; 32];
    a[16..].copy_from_slice(half);
    a
}

fn bytes_to_array32(b: &Bytes) -> Result<[u8; 32], CosmicCoderError> {
    if b.len() != FIELD_LEN {
        return Err(CosmicCoderError::InvalidInput);
    }
    let mut a = [0u8; 32];
    b.copy_into_slice(&mut a);
    Ok(a)
}

/// Decodes the `used_zk_weapon` boolean signal.
fn weapon_flag(sig: &[u8; 32]) -> Result<bool, CosmicCoderError> {
    if *sig == field_from_u64(0) {
        Ok(false)
    } else if *sig == field_from_u64(1) {
        Ok(true)
    } else {
        Err(CosmicCoderError::InvalidZkProof)
    }
}

/// Shared ranked claim rules: positive values and `score >= wave * MIN_SCORE_PER_WAVE`.
fn validate_ranked_claim(score: u32, wave: u32) -> Result<(), CosmicCoderError> {
    if score == 0 || wave == 0 {
        return Err(CosmicCoderError::InvalidInput);
    }
    let min = wave
        .checked_mul(MIN_SCORE_PER_WAVE)
        .ok_or(CosmicCoderError::Overflow)?;
    if score < min {
        return Err(CosmicCoderError::ScoreBelowMinimum);
    }
    Ok(())
}

/// Checks the GameRun signals at indices 2..=5 against the claimed values.
fn bind_run_signals(
    signals: &[[u8; 32]; RUN_PUBLIC_SIGNALS as usize],
    score: u32,
    wave: u32,
    nonce: u64,
    season_id: u32,
) -> Result<(), CosmicCoderError> {
    if signals[2] != field_from_u64(score as u64)
        || signals[3] != field_from_u64(wave as u64)
        || signals[4] != field_from_u64(nonce)
        || signals[5] != field_from_u64(season_id as u64)
    {
        return Err(CosmicCoderError::SignalMismatch);
    }
    Ok(())
}

fn require_not_replayed(env: &Env, key: &DataKey) -> Result<(), CosmicCoderError> {
    if env.storage().persistent().has(key) {
        return Err(CosmicCoderError::Replay);
    }
    Ok(())
}

fn read_vk(env: &Env, key: &DataKey) -> Result<ZkVerificationKey, CosmicCoderError> {
    env.storage()
        .instance()
        .get(key)
        .ok_or(CosmicCoderError::VkNotSet)
}

/// Invokes the admin-registered Groth16 verifier. Only `Ok(true)` passes.
fn groth16_verify(
    env: &Env,
    verifier: &Address,
    vk: ZkVerificationKey,
    proof: ZkProof,
    signals: Vec<BytesN<32>>,
) -> Result<(), CosmicCoderError> {
    let res = env.try_invoke_contract::<bool, Groth16Error>(
        verifier,
        &Symbol::new(env, "verify_proof"),
        vec![env, vk.into_val(env), proof.into_val(env), signals.into_val(env)],
    );
    match res {
        Ok(Ok(true)) => Ok(()),
        Ok(Ok(false)) => Err(CosmicCoderError::InvalidProof),
        Ok(Err(_)) | Err(Ok(_)) => Err(CosmicCoderError::VerifierError),
        Err(Err(_)) => Err(CosmicCoderError::VerifierCrash),
    }
}

fn game_hub(env: &Env) -> Address {
    env.storage()
        .instance()
        .get(&DataKey::GameHub)
        .expect("game hub set in constructor")
}

/// Closes the player's open Game Hub session, if any. Never touches other players' sessions.
fn end_player_session(env: &Env, player: &Address) -> Result<(), CosmicCoderError> {
    let key = DataKey::ActiveSession(player.clone());
    let session: Option<u32> = env.storage().temporary().get(&key);
    if let Some(session) = session {
        env.storage().temporary().remove(&key);
        let res = env.try_invoke_contract::<(), soroban_sdk::Error>(
            &game_hub(env),
            &Symbol::new(env, "end_game"),
            vec![env, session.into_val(env), true.into_val(env)],
        );
        if !matches!(res, Ok(Ok(()))) {
            return Err(CosmicCoderError::GameHubCrash);
        }
    }
    Ok(())
}

/// Entry types that can live on a bounded leaderboard.
trait Ranked {
    fn who(&self) -> &Address;
    fn rank(&self) -> i128;
}

impl Ranked for ScoreEntry {
    fn who(&self) -> &Address {
        &self.player
    }
    fn rank(&self) -> i128 {
        self.score as i128
    }
}

impl Ranked for LeaderboardEntry {
    fn who(&self) -> &Address {
        &self.player
    }
    fn rank(&self) -> i128 {
        self.score
    }
}

/// Keeps one entry per player (their best), sorted by rank desc; ties keep the earlier entry
/// first. Never grows beyond `MAX_LEADERBOARD_SIZE`. Returns whether the board changed.
/// All loops are bounded by `MAX_LEADERBOARD_SIZE + 1`.
fn upsert_bounded<T>(entries: &mut Vec<T>, entry: T) -> bool
where
    T: Ranked + Clone + IntoVal<Env, Val> + TryFromVal<Env, Val>,
{
    let score = entry.rank();
    for i in 0..entries.len() {
        let e = entries.get_unchecked(i);
        if e.who() == entry.who() {
            if e.rank() >= score {
                return false;
            }
            entries.remove(i);
            break;
        }
    }
    let mut pos = entries.len();
    for i in 0..entries.len() {
        if entries.get_unchecked(i).rank() < score {
            pos = i;
            break;
        }
    }
    // If the player's old entry was removed above, its index was < MAX and the new score is
    // strictly higher, so `pos` is < MAX as well: no entry can be lost here.
    if pos >= MAX_LEADERBOARD_SIZE {
        return false;
    }
    entries.insert(pos, entry);
    while entries.len() > MAX_LEADERBOARD_SIZE {
        entries.pop_back();
    }
    true
}

fn take<T>(env: &Env, entries: Vec<T>, limit: u32) -> Vec<T>
where
    T: Clone + IntoVal<Env, Val> + TryFromVal<Env, Val>,
{
    let n = core::cmp::min(limit, entries.len());
    let mut out = Vec::new(env);
    for i in 0..n {
        out.push_back(entries.get_unchecked(i));
    }
    out
}

fn milestone_tier_from_wave(wave: u32) -> u32 {
    if wave >= MILESTONE_TIER3_WAVE {
        3
    } else if wave >= MILESTONE_TIER2_WAVE {
        2
    } else if wave >= MILESTONE_TIER1_WAVE {
        1
    } else {
        0
    }
}

fn update_player_milestone(env: &Env, player: &Address, season_id: u32, wave: u32) {
    let new_tier = milestone_tier_from_wave(wave);
    if new_tier == 0 {
        return;
    }
    let key = DataKey::Milestone(player.clone(), season_id);
    let prev: Option<PlayerMilestone> = env.storage().persistent().get(&key);
    let next = match prev {
        None => PlayerMilestone {
            tier: new_tier,
            best_wave: wave,
        },
        Some(p) if wave > p.best_wave => PlayerMilestone {
            tier: core::cmp::max(p.tier, new_tier),
            best_wave: wave,
        },
        Some(_) => return,
    };
    set_persistent(env, &key, &next);
}

/// Shared tail of every verified ranked submission: closes the hub session, burns the nonce,
/// updates leaderboard + milestone and emits events.
fn record_ranked_run(
    env: &Env,
    player: &Address,
    replay_key: &DataKey,
    season_id: u32,
    score: u32,
    wave: u32,
    run_hash: Bytes,
    used_zk_weapon: bool,
) -> Result<(), CosmicCoderError> {
    end_player_session(env, player)?;
    set_replay_guard(env, replay_key);

    let board_key = DataKey::RankedBoard(season_id);
    let mut board: Vec<ScoreEntry> = env
        .storage()
        .persistent()
        .get(&board_key)
        .unwrap_or(Vec::new(env));
    let changed = upsert_bounded(
        &mut board,
        ScoreEntry {
            player: player.clone(),
            score,
        },
    );
    persist_board(env, &board_key, &board, changed);
    update_player_milestone(env, player, season_id, wave);

    if used_zk_weapon {
        ZkWeaponUsed {
            player: player.clone(),
            season_id,
        }
        .publish(env);
    }
    ZkRunSubmitted {
        player: player.clone(),
        season_id,
        score,
        wave,
        run_hash,
    }
    .publish(env);
    Ok(())
}

fn read_u32(env: &Env, key: &DataKey) -> u32 {
    env.storage().persistent().get(key).unwrap_or(0)
}

// ---------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------

#[contract]
pub struct CosmicCoder;

#[contractimpl]
impl CosmicCoder {
    /// Runs once at deploy time (no front-runnable `init`). Verifiers and VKs are configured
    /// afterwards by the admin.
    pub fn __constructor(env: Env, admin: Address, game_hub: Address) {
        let s = env.storage().instance();
        s.set(&DataKey::Admin, &admin);
        s.set(&DataKey::GameHub, &game_hub);
        s.set(&DataKey::SessionCounter, &0u32);
        bump_instance(&env);
    }

    // ----- admin -----

    pub fn get_admin(env: Env) -> Address {
        read_admin(&env)
    }

    pub fn get_game_hub(env: Env) -> Address {
        game_hub(&env)
    }

    /// Step 1 of the admin transfer: the current admin nominates `new_admin`. Nothing changes
    /// until `new_admin` calls `accept_admin`, so a typo cannot brick the contract. Proposing
    /// again overwrites the previous nomination.
    pub fn propose_admin(env: Env, new_admin: Address) {
        let admin = require_admin(&env);
        env.storage().instance().set(&DataKey::PendingAdmin, &new_admin);
        config_updated(&env, "pending_admin", admin);
    }

    /// Step 2 of the admin transfer: the pending admin (read from storage) signs and takes over.
    pub fn accept_admin(env: Env) -> Result<(), CosmicCoderError> {
        let s = env.storage().instance();
        let pending: Address = s
            .get(&DataKey::PendingAdmin)
            .ok_or(CosmicCoderError::NoPendingAdmin)?;
        pending.require_auth();
        s.set(&DataKey::Admin, &pending);
        s.remove(&DataKey::PendingAdmin);
        bump_instance(&env);
        config_updated(&env, "admin", pending);
        Ok(())
    }

    /// Admin nominated by `propose_admin` that has not accepted yet.
    pub fn get_pending_admin(env: Env) -> Option<Address> {
        env.storage().instance().get(&DataKey::PendingAdmin)
    }

    /// Deprecated alias of `propose_admin` (kept for ABI compatibility). It does NOT transfer
    /// admin rights: `new_admin` must still call `accept_admin`.
    pub fn set_admin(env: Env, new_admin: Address) {
        Self::propose_admin(env, new_admin)
    }

    pub fn set_game_hub(env: Env, game_hub: Address) {
        let admin = require_admin(&env);
        env.storage().instance().set(&DataKey::GameHub, &game_hub);
        config_updated(&env, "game_hub", admin);
    }

    /// Groth16 verifier used by `submit_zk` and `unlock_weapon`.
    pub fn set_verifier(env: Env, verifier: Address) {
        let admin = require_admin(&env);
        env.storage().instance().set(&DataKey::Verifier, &verifier);
        config_updated(&env, "verifier", admin);
    }

    /// UltraHonk verifier used by `submit_zk_noir`.
    pub fn set_noir_verifier(env: Env, verifier: Address) {
        let admin = require_admin(&env);
        env.storage().instance().set(&DataKey::NoirVerifier, &verifier);
        config_updated(&env, "noir_verifier", admin);
    }

    /// Pins the GameRun VK (`ic.len() == RUN_PUBLIC_SIGNALS + 1`).
    pub fn set_run_vk(env: Env, vk: ZkVerificationKey) -> Result<(), CosmicCoderError> {
        let admin = require_admin(&env);
        if vk.ic.len() != RUN_PUBLIC_SIGNALS + 1 {
            return Err(CosmicCoderError::MalformedVk);
        }
        env.storage().instance().set(&DataKey::RunVk, &vk);
        config_updated(&env, "run_vk", admin);
        Ok(())
    }

    /// Pins the SkillProof VK (`ic.len() == UNLOCK_PUBLIC_SIGNALS + 1`).
    pub fn set_unlock_vk(env: Env, vk: ZkVerificationKey) -> Result<(), CosmicCoderError> {
        let admin = require_admin(&env);
        if vk.ic.len() != UNLOCK_PUBLIC_SIGNALS + 1 {
            return Err(CosmicCoderError::MalformedVk);
        }
        env.storage().instance().set(&DataKey::UnlockVk, &vk);
        config_updated(&env, "unlock_vk", admin);
        Ok(())
    }

    // ----- matches -----

    /// Opens a Game Hub session for `player` (overwrites any previous open session of that
    /// player). Returns the session id.
    pub fn start_match(env: Env, player: Address) -> Result<u32, CosmicCoderError> {
        player.require_auth();
        bump_instance(&env);
        let s = env.storage().instance();
        let session = s
            .get::<DataKey, u32>(&DataKey::SessionCounter)
            .unwrap_or(0)
            .checked_add(1)
            .ok_or(CosmicCoderError::Overflow)?;
        s.set(&DataKey::SessionCounter, &session);

        let key = DataKey::ActiveSession(player.clone());
        env.storage().temporary().set(&key, &session);
        env.storage()
            .temporary()
            .extend_ttl(&key, SESSION_TTL, SESSION_TTL);

        let game_id = env.current_contract_address();
        let res = env.try_invoke_contract::<(), soroban_sdk::Error>(
            &game_hub(&env),
            &Symbol::new(&env, "start_game"),
            vec![
                &env,
                game_id.into_val(&env),
                session.into_val(&env),
                player.into_val(&env),
                game_id.into_val(&env),
                0i128.into_val(&env),
                0i128.into_val(&env),
            ],
        );
        if !matches!(res, Ok(Ok(()))) {
            return Err(CosmicCoderError::GameHubCrash);
        }
        MatchStarted {
            player: player.clone(),
            session,
        }
        .publish(&env);
        Ok(session)
    }

    /// Open session id of `player`, if any.
    pub fn get_active_session(env: Env, player: Address) -> Option<u32> {
        env.storage()
            .temporary()
            .get(&DataKey::ActiveSession(player))
    }

    /// Casual (unverified) result. Requires `score >= 0` and `score >= wave * MIN_SCORE_PER_WAVE`.
    pub fn submit_result(
        env: Env,
        player: Address,
        wave: u32,
        score: i128,
    ) -> Result<(), CosmicCoderError> {
        player.require_auth();
        bump_instance(&env);
        if score < 0 {
            return Err(CosmicCoderError::NegativeScore);
        }
        let min = (wave as i128)
            .checked_mul(MIN_SCORE_PER_WAVE as i128)
            .ok_or(CosmicCoderError::Overflow)?;
        if score < min {
            return Err(CosmicCoderError::ScoreBelowMinimum);
        }
        end_player_session(&env, &player)?;

        let key = DataKey::CasualBoard;
        let mut board: Vec<LeaderboardEntry> = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or(Vec::new(&env));
        let changed = upsert_bounded(
            &mut board,
            LeaderboardEntry {
                player: player.clone(),
                wave,
                score,
            },
        );
        persist_board(&env, &key, &board, changed);
        ResultSubmitted {
            player,
            wave,
            score,
        }
        .publish(&env);
        Ok(())
    }

    /// Ranked submit (Groth16 / GameRun circuit).
    ///
    /// `pub_signals` (7 x 32-byte big-endian field elements):
    /// `[run_hash_hi, run_hash_lo, score, wave, nonce, season_id, used_zk_weapon]`.
    /// `run_hash` (32 bytes) must equal `hi[16..] || lo[16..]`; `score`, `wave`, `nonce` and
    /// `season_id` must equal their signals; `vk` must equal the admin-registered run VK.
    pub fn submit_zk(
        env: Env,
        player: Address,
        proof: ZkProof,
        vk: ZkVerificationKey,
        pub_signals: Vec<Bytes>,
        nonce: u64,
        run_hash: Bytes,
        season_id: u32,
        score: u32,
        wave: u32,
    ) -> Result<(), CosmicCoderError> {
        player.require_auth();
        bump_instance(&env);
        validate_ranked_claim(score, wave)?;
        let run_hash_arr = bytes_to_array32(&run_hash)?;

        let verifier: Address = env
            .storage()
            .instance()
            .get(&DataKey::Verifier)
            .ok_or(CosmicCoderError::VerifierNotSet)?;
        let stored_vk = read_vk(&env, &DataKey::RunVk)?;
        if vk != stored_vk {
            return Err(CosmicCoderError::VkMismatch);
        }

        if pub_signals.len() != RUN_PUBLIC_SIGNALS {
            return Err(CosmicCoderError::InvalidInput);
        }
        let mut sig = [[0u8; 32]; RUN_PUBLIC_SIGNALS as usize];
        let mut sig_n: Vec<BytesN<32>> = Vec::new(&env);
        for (i, slot) in sig.iter_mut().enumerate() {
            *slot = bytes_to_array32(&pub_signals.get_unchecked(i as u32))?;
            sig_n.push_back(BytesN::from_array(&env, slot));
        }
        if sig[0] != field_from_u128_half(&run_hash_arr[..16])
            || sig[1] != field_from_u128_half(&run_hash_arr[16..])
        {
            return Err(CosmicCoderError::SignalMismatch);
        }
        bind_run_signals(&sig, score, wave, nonce, season_id)?;
        let used_zk_weapon = weapon_flag(&sig[6])?;

        let replay_key = DataKey::Replay(player.clone(), season_id, nonce);
        require_not_replayed(&env, &replay_key)?;

        groth16_verify(&env, &verifier, stored_vk, proof, sig_n)?;

        record_ranked_run(
            &env,
            &player,
            &replay_key,
            season_id,
            score,
            wave,
            run_hash,
            used_zk_weapon,
        )
    }

    /// Ranked submit (Noir / UltraHonk). The verifier uses its stored VK.
    ///
    /// `proof_blob` = `u32_be(total_fields) || public inputs (7 x 32 B, GameRun order) || proof`.
    /// `score`, `wave`, `nonce` and `season_id` must equal the blob's public inputs. The run hash
    /// limbs are not bound because the client may fold large hashes to fit the circuit's u128s.
    pub fn submit_zk_noir(
        env: Env,
        player: Address,
        proof_blob: Bytes,
        nonce: u64,
        run_hash: Bytes,
        season_id: u32,
        score: u32,
        wave: u32,
    ) -> Result<(), CosmicCoderError> {
        player.require_auth();
        bump_instance(&env);
        validate_ranked_claim(score, wave)?;
        if run_hash.len() != FIELD_LEN {
            return Err(CosmicCoderError::InvalidInput);
        }
        let verifier: Address = env
            .storage()
            .instance()
            .get(&DataKey::NoirVerifier)
            .ok_or(CosmicCoderError::NoirVerifierNotSet)?;

        // Header + public inputs + at least one proof field, field-aligned.
        let min_len = NOIR_HEADER_LEN + (RUN_PUBLIC_SIGNALS + 1) * FIELD_LEN;
        // FIELD_LEN is a power of two: alignment check without `%` (is_multiple_of needs Rust 1.87).
        if proof_blob.len() < min_len || (proof_blob.len() - NOIR_HEADER_LEN) & (FIELD_LEN - 1) != 0 {
            return Err(CosmicCoderError::InvalidInput);
        }
        let mut sig = [[0u8; 32]; RUN_PUBLIC_SIGNALS as usize];
        for (i, slot) in sig.iter_mut().enumerate() {
            let start = NOIR_HEADER_LEN + (i as u32) * FIELD_LEN;
            *slot = bytes_to_array32(&proof_blob.slice(start..start + FIELD_LEN))?;
        }
        bind_run_signals(&sig, score, wave, nonce, season_id)?;
        let used_zk_weapon = weapon_flag(&sig[6])?;

        let replay_key = DataKey::Replay(player.clone(), season_id, nonce);
        require_not_replayed(&env, &replay_key)?;

        let res = env.try_invoke_contract::<BytesN<32>, soroban_sdk::Error>(
            &verifier,
            &Symbol::new(&env, "verify_proof_with_stored_vk"),
            vec![&env, proof_blob.into_val(&env)],
        );
        match res {
            Ok(Ok(_proof_id)) => {}
            Ok(Err(_)) | Err(Ok(_)) => return Err(CosmicCoderError::VerifierError),
            Err(Err(_)) => return Err(CosmicCoderError::VerifierCrash),
        }

        record_ranked_run(
            &env,
            &player,
            &replay_key,
            season_id,
            score,
            wave,
            run_hash,
            used_zk_weapon,
        )
    }

    /// Whether `(player, season_id, nonce)` has already been used by a ranked submission.
    pub fn is_nonce_used(env: Env, player: Address, season_id: u32, nonce: u64) -> bool {
        env.storage()
            .persistent()
            .has(&DataKey::Replay(player, season_id, nonce))
    }

    /// Ranked leaderboard of a season, best first (at most `MAX_LEADERBOARD_SIZE`).
    pub fn get_leaderboard_by_season(env: Env, season_id: u32, limit: u32) -> Vec<ScoreEntry> {
        let board: Vec<ScoreEntry> = env
            .storage()
            .persistent()
            .get(&DataKey::RankedBoard(season_id))
            .unwrap_or(Vec::new(&env));
        take(&env, board, limit)
    }

    pub fn get_player_milestone(env: Env, player: Address, season_id: u32) -> PlayerMilestone {
        env.storage()
            .persistent()
            .get(&DataKey::Milestone(player, season_id))
            .unwrap_or(PlayerMilestone {
                tier: 0,
                best_wave: 0,
            })
    }

    /// Casual leaderboard, best first (at most `MAX_LEADERBOARD_SIZE`).
    pub fn get_leaderboard(env: Env, limit: u32) -> Vec<LeaderboardEntry> {
        let board: Vec<LeaderboardEntry> = env
            .storage()
            .persistent()
            .get(&DataKey::CasualBoard)
            .unwrap_or(Vec::new(&env));
        take(&env, board, limit)
    }

    // ----- stats / weapons -----

    /// Self-reported stats (games played, best score). Signed by the player; not ranked.
    pub fn submit_score(env: Env, player: Address, score: u32) -> Result<(), CosmicCoderError> {
        player.require_auth();
        bump_instance(&env);
        let games_key = DataKey::GamesPlayed(player.clone());
        let games = read_u32(&env, &games_key)
            .checked_add(1)
            .ok_or(CosmicCoderError::Overflow)?;
        set_persistent(&env, &games_key, &games);

        let best_key = DataKey::BestScore(player.clone());
        if score > read_u32(&env, &best_key) {
            set_persistent(&env, &best_key, &score);
        }
        ScoreSubmitted { player, score }.publish(&env);
        Ok(())
    }

    pub fn get_games_played(env: Env, player: Address) -> u32 {
        read_u32(&env, &DataKey::GamesPlayed(player))
    }

    pub fn get_best_score(env: Env, player: Address) -> u32 {
        read_u32(&env, &DataKey::BestScore(player))
    }

    /// 1 = Bronze, 2 = Silver, 3 = Gold, 4 = Mythic (by best self-reported score).
    pub fn get_player_tier(env: Env, player: Address) -> u32 {
        let best = Self::get_best_score(env, player);
        if best >= TIER_MYTHIC_MIN_SCORE {
            4
        } else if best >= TIER_GOLD_MIN_SCORE {
            3
        } else if best >= TIER_SILVER_MIN_SCORE {
            2
        } else {
            1
        }
    }

    /// `games_played >= MIN_GAMES_TO_START_MATCH && best_score > 0`.
    pub fn can_start_match(env: Env, player: Address) -> bool {
        Self::get_games_played(env.clone(), player.clone()) >= MIN_GAMES_TO_START_MATCH
            && Self::get_best_score(env, player) > 0
    }

    /// Unlocks `weapon_id` with a SkillProof (score >= threshold) Groth16 proof.
    /// `pub_signals = [threshold, public_hash]`; `threshold` must equal the weapon's threshold
    /// and the proof's threshold signal; each `public_hash` can be used once (any player).
    pub fn unlock_weapon(
        env: Env,
        player: Address,
        weapon_id: u32,
        proof: ZkProof,
        vk: ZkVerificationKey,
        pub_signals: Vec<BytesN<32>>,
        threshold: u32,
    ) -> Result<(), CosmicCoderError> {
        player.require_auth();
        bump_instance(&env);
        if weapon_id == 0 || weapon_id > MAX_WEAPON_ID {
            return Err(CosmicCoderError::InvalidWeapon);
        }
        if threshold != WEAPON_THRESHOLDS[(weapon_id - 1) as usize] {
            return Err(CosmicCoderError::ThresholdMismatch);
        }
        let unlock_key = DataKey::WeaponUnlocked(player.clone(), weapon_id);
        if env.storage().persistent().has(&unlock_key) {
            return Err(CosmicCoderError::AlreadyUnlocked);
        }
        let verifier: Address = env
            .storage()
            .instance()
            .get(&DataKey::Verifier)
            .ok_or(CosmicCoderError::VerifierNotSet)?;
        let stored_vk = read_vk(&env, &DataKey::UnlockVk)?;
        if vk != stored_vk {
            return Err(CosmicCoderError::VkMismatch);
        }
        if pub_signals.len() != UNLOCK_PUBLIC_SIGNALS {
            return Err(CosmicCoderError::InvalidInput);
        }
        if pub_signals.get_unchecked(0).to_array() != field_from_u64(threshold as u64) {
            return Err(CosmicCoderError::SignalMismatch);
        }
        let proof_key = DataKey::UnlockProof(pub_signals.get_unchecked(1));
        require_not_replayed(&env, &proof_key)?;

        groth16_verify(&env, &verifier, stored_vk, proof, pub_signals)?;

        set_persistent(&env, &unlock_key, &true);
        set_replay_guard(&env, &proof_key);
        WeaponUnlocked {
            player,
            weapon_id,
            threshold,
        }
        .publish(&env);
        Ok(())
    }

    pub fn is_weapon_unlocked(env: Env, player: Address, weapon_id: u32) -> bool {
        env.storage()
            .persistent()
            .has(&DataKey::WeaponUnlocked(player, weapon_id))
    }

    pub fn get_unlocked_weapons(env: Env, player: Address) -> Vec<u32> {
        let mut out = Vec::new(&env);
        for weapon_id in 1..=MAX_WEAPON_ID {
            if Self::is_weapon_unlocked(env.clone(), player.clone(), weapon_id) {
                out.push_back(weapon_id);
            }
        }
        out
    }
}

#[cfg(test)]
mod tests;
