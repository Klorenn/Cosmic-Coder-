# Contracts (Soroban, SDK 25.1)

| Crate | Role |
|-------|------|
| **zk_types** | Shared Groth16 types (`ZkProof`, `ZkVerificationKey`, `Groth16Error`). No logic. |
| **groth16_verifier** | BN254 Groth16 pairing check (CAP-0074). Stateless, no game logic. |
| **ultrahonk_verifier** | Noir/UltraHonk verifier interface. **Structural stub** (see Security notes). Admin-gated `set_vk`. |
| **cosmic_coder** | Game policy: admin config, ranked submissions (Groth16 + Noir), casual results, stats, weapon unlocks, Game Hub sessions, leaderboards. |

## Architecture decision: v0.2.0 crates removed from the workspace

`policy`, `verifier` and `application` (v0.2.0) were an abandoned split of `cosmic_coder` into
three contracts (domain-separated `submit_proof`). They were dropped from the workspace because:

- `policy` did not compile, and all three declared `mod test;` with no test file.
- No deploy script, CI job or doc deploys them; the frontend's `submitZkV2` (`submit_proof`) is
  dead code (no caller), and `ArenaScene` uses `startMatch`, `submitResult` and `submit_zk_noir`.
- They duplicated `cosmic_coder` logic (replay, leaderboard, verifier calls) with different
  semantics, which doubles the audit surface.

`zk_types::DomainBinding` / `ZkPublicInputs` (only used by those crates) were removed too.
The directories stay listed in `exclude` in `Cargo.toml` until they are deleted from disk.

## cosmic_coder

### Deploy-time configuration

`__constructor(admin, game_hub)` runs at deploy (no front-runnable `init`). Then the admin calls:

| Function | Purpose |
|----------|---------|
| `set_verifier(verifier)` | Groth16 verifier (used by `submit_zk`, `unlock_weapon`) |
| `set_noir_verifier(verifier)` | UltraHonk verifier (used by `submit_zk_noir`) |
| `set_run_vk(vk)` | Pins the GameRun VK (`ic.len() == 8`) |
| `set_unlock_vk(vk)` | Pins the SkillProof VK (`ic.len() == 3`) |
| `set_game_hub(hub)` | Rotation |
| `propose_admin(new_admin)` | Admin transfer, step 1 (current admin signs). Overwrites any previous proposal |
| `accept_admin()` | Admin transfer, step 2: the pending admin (read from storage) signs. `#17 NoPendingAdmin` if none |
| `get_pending_admin()` | Proposed admin awaiting acceptance |
| `set_admin(new_admin)` | **Deprecated** alias of `propose_admin`: it no longer transfers on its own |

Every setter loads the admin from storage and calls `require_auth()` on it, and emits `config_updated`.

### Rules enforced

- **Auth**: `player.require_auth()` on `start_match`, `submit_result`, `submit_zk`, `submit_zk_noir`,
  `submit_score`, `unlock_weapon`. Tests assert the exact auth tree (`env.auths()`).
- **Ranked binding** (`submit_zk`): `pub_signals = [run_hash_hi, run_hash_lo, score, wave, nonce,
  season_id, used_zk_weapon]` (32-byte BE). `score`, `wave`, `nonce`, `season_id` and `run_hash`
  (`hi[16..] || lo[16..]`) must equal the signals; `used_zk_weapon` must be 0/1; the caller's
  `vk` must equal the pinned run VK. `submit_zk_noir` binds score/wave/nonce/season against the
  public inputs embedded in `proof_blob` (`u32_be(total_fields) || 7 x 32 B inputs || proof`).
- **Anti-replay**: persistent key `Replay(player, season_id, nonce)`, extended to the network max
  TTL. Nonces are per player and season (no global nonce griefing). Unlock proofs are single-use
  by their public hash signal.
- **Game rules** (constants in `lib.rs`): `MIN_SCORE_PER_WAVE = 5` (matches both circuits),
  ranked `score > 0 && wave > 0`, casual `score >= 0`; checked arithmetic everywhere.
- **Leaderboards**: one best entry per player, score desc, ties keep the earlier entry first,
  hard cap `MAX_LEADERBOARD_SIZE = 100` (ranked per season and casual).
- **Game Hub**: `start_match` opens a per-player session (temporary storage, ~1 day). The next
  submission by the same player calls `end_game(session, true)` for exactly that session; with no
  open session, no hub call. Hub failures return `GameHubCrash` and revert the call.
- **Errors**: all public mutators return `Result<_, CosmicCoderError>`; codes 1-6 and 100-102 are
  unchanged, 7-16 are new (append only).

### Weapon thresholds

`WEAPON_THRESHOLDS = [0, 1000, 5000, 10000, 20000]` for weapon ids 1..=5.

## Build (WASM)

Requires rustup with `wasm32v1-none` (Homebrew cargo cannot cross-compile):

```bash
rustup target add wasm32v1-none
cd contracts
cargo build --target wasm32v1-none --release -p groth16_verifier -p ultrahonk_verifier -p cosmic_coder
```

The workspace `[profile.release]` follows the Soroban template (`opt-level = "z"`,
`overflow-checks = true`, `panic = "abort"`, LTO).

## Deploy

```bash
SOURCE_ACCOUNT=<identity> ./scripts/deploy_contracts_testnet.sh
```

Deploys both verifiers and `cosmic_coder` (constructor args `--admin --game_hub`), wires the
Groth16 verifier, pins the GameRun VK (`ZK_CIRCUIT=v3` by default, from
`circuits/build/contract_proof_v3.json`) and pins the SkillProof unlock VK via `set_unlock_vk`
(`UNLOCK_VK_JSON`, default `circuits/build/contract_proof_skill.json`). The script is idempotent:
re-running it re-pins the VKs on the existing contracts. Current testnet IDs and transaction hashes
live in `docs/TESTNET_DEPLOYMENT.md`.

The UltraHonk **stub is NOT wired** (`set_noir_verifier` is skipped), so `submit_zk_noir` fails
with `#16 NoirVerifierNotSet`. `ENABLE_NOIR_STUB=1` wires it anyway for an insecure demo (prints a
large warning): with the stub wired anyone can forge ranked scores.

Simulate a ranked submit without sending:

```bash
stellar contract invoke --sim-only --id <POLICY_ID> --network testnet -- submit_zk \
  --player <G...> --proof '{...}' --vk '{...}' --pub_signals '[...]' \
  --nonce <u64> --run_hash <32_BYTES_HEX> --season_id 1 --score 100 --wave 5
```

## Tests

```bash
cd contracts
cargo test --workspace
cargo clippy --workspace --all-targets
```

`test_real_proof_*` use the real snarkjs proof in `circuits/build/contract_proof.json` when it
exists (`npm run zk:proof`).

## Security status (read before trusting the ranked board)

**Ranked is NOT cryptographically verified today.**

- **`ultrahonk_verifier` is a structural stub.** It accepts any well-framed blob and never checks the
  UltraHonk proof. `submit_zk_noir` (the path the frontend uses) is therefore forgeable whenever the
  stub is wired. The deploy script no longer wires it by default (`ENABLE_NOIR_STUB=1` to opt in for
  a demo). Ranked becomes trustless only after a REAL UltraHonk verifier is deployed and set with
  `set_noir_verifier`; only then set `VITE_RANKED_VERIFIED=true` in `public/config.json`
  (`isRankedVerified()` in `src/contracts/gameClient.js`, default `false`).
- **`GameRun.circom` has no private witness.** Every input is public and the only constraint is
  `score >= wave * 5` (plus `used_zk_weapon` boolean). A valid Groth16 proof only shows that the
  claimed numbers satisfy that inequality: any `score >= wave * 5` can be proven by anyone. It does
  not attest that the run happened. The Groth16 `submit_zk` path is sound as a verifier, but the
  statement it proves is weak.
- **`SkillProof.circom` keeps `wallet` private** (only `threshold` and `Poseidon(wallet, score, nonce)`
  are public) and the contract does not bind the proof to `player`. A pending `unlock_weapon` proof
  can be front-run from another account (the weapon would unlock for the front-runner and the
  `public_hash` would be burned). `score` is also self-asserted by the prover. Fixing this requires a
  circuit change (make the player address, or a hash of it, a public input checked by the contract).
- **Non-canonical scalars (fixed).** The host reduces Groth16 public signals mod r, so `s` and
  `s + r` verified identically and landed on different `UnlockProof` replay keys. `groth16_verifier`
  now rejects any signal `>= r` with `Groth16Error::NonCanonicalPublicInput` (#4).
- `submit_result` and `submit_score` are self-reported (signed, not proven); `get_player_tier`
  and `can_start_match` derive from `submit_score`.
- Noir `run_hash` limbs are not bound on-chain because the client folds large hashes to fit the
  circuit's u128 inputs.
- Leaderboards (`RankedBoard`, `CasualBoard`) have their TTL extended on every submission, even
  when the board does not change.

## ZK full stack (circuit + prover + contract)

From repo root: `npm run zk:build`, `npm run zk:e2e`, `npm run server` (prover at
`POST /zk/prove`), then set `VITE_COSMIC_CODER_CONTRACT_ID` and `VITE_ZK_PROVER_URL`.
See [groth16_verifier/README.md](groth16_verifier/README.md) for CAP-0074 details.
