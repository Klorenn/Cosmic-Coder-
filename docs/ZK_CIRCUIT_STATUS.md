# ZK circuit status (2026-11-11)

## What the game uses today

| Path | Circuit | Prover | Contract entry | Real verification? |
|------|---------|--------|----------------|--------------------|
| Ranked submit, payload WITH `seed` + `kills` (`VITE_ZK_CIRCUIT` = `v3`, default) | `circuits/GameRunV3.circom` (7 public signals, private `seed, kills, events_hash`) | browser snarkjs (`generateLocalProof`, `public/circuits/build/GameRunV3_*`) then `POST /zk/prove_v3` | `submit_zk` | **Yes** once the deploy pinned the V3 VK (`scripts/deploy_contracts_testnet.sh` default) |
| Ranked submit, payload WITHOUT `seed`/`kills`, or `VITE_ZK_CIRCUIT=v1` (legacy) | `circuits/GameRun.circom` (7 public signals, no private witness) | browser snarkjs then `POST /zk/prove` (`requestZkProofV2`) | `submit_zk` | Only on a deploy that pinned the GameRun VK (`ZK_CIRCUIT=v1`); against a V3 deploy -> #8 VkMismatch |
| Legacy ranked (`VITE_ZK_BACKEND=noir`) | Noir `circuits/noir` (ACIR in `public/circuits/GameRun.json`) | browser (NoirService, UltraHonk) | `submit_zk_noir` | **No**: `ultrahonk_verifier.verify_proof` only checks the blob shape; also needs `set_noir_verifier` (#16 otherwise) |
| `POST /zk/prove_v2` | `circuits/GameRunV2.circom` (12 public signals) | server | none (`submit_zk` needs 7 signals) | off-chain only |

`requestZkProofV2` calls `/zk/prove_v3` (V3 payload) or `/zk/prove` (GameRun), never `/zk/prove_v2`; it is the fallback of the ranked submit and the ArenaScene connectivity check.
`isRankedVerified()` = groth16 backend and `VITE_COSMIC_CODER_CONTRACT_ID` set (configuration, not an on-chain probe: real verification requires the deploy to have run `set_verifier` + `set_run_vk`).

## Verified (commands below, all green)

- `GameRun_final.zkey` <-> `GameRun_vkey.json` <-> VK in `circuits/build/contract_proof.json` (the one the deploy script pins): identical.
- `GameRunV2_final.zkey` <-> `GameRunV2_vkey.json`: identical.
- Browser artifacts `public/circuits/build/GameRun_*` == `circuits/build/GameRun_*` (wasm, zkey, vkey; served by Vite at `/circuits/build/...`).
- Real proof score=300 wave=3 (`circuits/fixtures/gamerun_s300_w3*.json`): `snarkjs groth16 verify` OK; native contract test
  `test_real_proof_s300_w3_submit_mismatch_replay`: `set_run_vk` + `submit_zk` OK, claimed score 301 -> `SignalMismatch`,
  signal+claim forged to 301 -> `InvalidProof`, replay -> `Replay`.
- Server `/zk/prove` with the exact `requestZkProofV2` body returns a proof that verifies with the GameRun VK and passes
  `contractProofToZk`/ScVal builders (`src/__tests__/zkProverFormat.test.js`, real response as fixture).
- `snarkjsToContractProof` (browser) == `scripts/zk/export_for_contract.js` (server) byte-for-byte.
- Public signal order `[run_hash_hi, run_hash_lo, score, wave, nonce, season_id, used_zk_weapon]` matches the circuit
  outputs and `submit_zk` binding (`run_hash[0..16]` = low 16 bytes of signal 0, `run_hash[16..32]` = of signal 1).
- `validateGameRules` uses the same `score >= wave*5` rule as GameRun and the contract.

## Fixed in this pass

- Browser zkey/vkey came from a different trusted setup than the prover/pinned VK -> every browser Groth16 proof would hit `VkMismatch` (#8). Synced from `circuits/build`.
- `generate_proof_v2.js` exported the V2 proof with the GameRun VK (8 IC for 12 signals: unverifiable) and overwrote `contract_proof.json` (the deploy/test fixture). Now uses `GameRunV2_vkey.json` and writes `contract_proof_v2.json`.
- `server/zkProve.js`: proved via shared `circuits/build/input.json|proof.json|contract_proof.json` -> concurrent requests could return each other's proof and every request rewrote the deploy fixture. Now in-process snarkjs, per request, verified before returning; input validation (u32/u64, 64-hex run hash) answers 400.
- `/zk/prove_v2`: G.../C... strkeys crashed (`BigInt('0xG...')`); dead artifact paths and raw-body logging removed. Strkeys are decoded to 32 bytes.
- `generateLocalProof` passed hex run-hash strings as circuit inputs (snarkjs needs decimals) -> now uses the same hi/lo split `submit_zk` binds, validates the run first and returns `run_hash_hex`.
- `export_for_contract.js` refuses a VK whose IC count does not match the signals.
- `scripts/e2e_zk.sh`: `E2E_LOCAL=1` offline mode.

## Open / not done

1. **UltraHonk verifier is a stub** — only matters for the legacy `VITE_ZK_BACKEND=noir` path (`submit_zk_noir` accepts any well-formed blob). Ranked now goes through Groth16 `submit_zk` (done: `src/__tests__/zkRankedSubmit.test.js`; needs `set_verifier` + `set_run_vk` on the deployed contract, which `scripts/deploy_contracts_testnet.sh` runs and now aborts without `contract_proof.json`). A real UltraHonk verifier is optional and not viable as a quick fix (see "Noir / UltraHonk evaluation" below).
2. **GameRunV3 is built and integrated, the scene is not wired yet**: `ArenaScene` still sends the V1 payload (no `seed`/`kills`), so `generateLocalProof` falls back to GameRun. On a deploy that pinned the V3 VK (the new default) that ends in #8 VkMismatch until the scene sends the V3 payload (snippet below). Wire the scene and redeploy/`set_run_vk` together, or deploy with `ZK_CIRCUIT=v1` meanwhile.
   Even with V3, `seed`/`kills`/`events_hash` are chosen by the prover: V3 bounds the score by the claimed kills and commits to the run, it does not prove the kills happened. That needs the seed issued at `start_match` and the event log recomputed server-side.
3. **SkillProof `wallet` is private** -> proofs can be front-run by another account.
4. **Trusted setup**: `circuits/pot12_final.ptau` is a single local contribution (verifies, but not a ceremony); `GameRun_final.zkey` does not chain to it (`snarkjs zkey verify` -> "Invalid alpha1"), so its setup provenance is unknown. Fine for testnet, not for mainnet.
5. Full `npm run zk:e2e` (without `E2E_LOCAL`) rebuilds circuits -> new trusted setup -> new VK that must be re-pinned with `set_run_vk` and re-synced to `public/circuits/build`.
6. `validateGameRules` allows score up to 1e12; the contract/circuit cap is u32 (the ranked submit path already rejects > u32 in `validateNoirSubmitPayload`).

## Commands

```bash
E2E_LOCAL=1 npm run zk:e2e                 # offline: artifacts, prove/verify GameRun + V2, cargo tests, vitest
cd contracts && cargo test --workspace     # includes real-proof submit_zk tests
npx vitest run src/__tests__/zkProverFormat.test.js
# Prove + verify one run manually
npx snarkjs groth16 fullprove circuits/fixtures/gamerun_s300_w3.input.json circuits/build/GameRun_js/GameRun.wasm circuits/build/GameRun_final.zkey /tmp/p.json /tmp/s.json
npx snarkjs groth16 verify circuits/build/GameRun_vkey.json /tmp/s.json /tmp/p.json
# Prover server
PORT=3444 node server/index.js
curl -X POST localhost:3444/zk/prove -H 'content-type: application/json' --data @circuits/fixtures/prover_request_gamerun.json
# GameRunV3: full rebuild = NEW trusted setup -> new VK -> re-pin with set_run_vk, regenerate the V3 fixtures
bash scripts/zk/build_GameRunV3.sh                       # uses ~/.cargo/bin/circom (2.2.2) if present
node scripts/zk/generate_proof_v3.js [input.json] [out.json]  # prove + verify + export with the current zkey
PORT=3444 node server/index.js
curl -X POST localhost:3444/zk/prove_v3 -H 'content-type: application/json' --data @circuits/fixtures/gamerun_v3.input.json
```

## GameRunV3 (built 2026-11-11, circom 2.2.2)

- Compile: `circom circuits/GameRunV3.circom --r1cs --wasm --sym -o circuits/build` -> 1215 non-linear + 717 linear
  constraints, 1896 wires, 8 inputs (3 private), 7 public outputs. Fits `pot12_final.ptau` (2^12 = 4096).
- Trusted setup (TESTNET ONLY): `groth16 setup` on `circuits/pot12_final.ptau` (single local contribution) + one phase-2
  contribution (`cosmic-v3-testnet`, random entropy); `snarkjs zkey verify` against the ptau OK.
  Artifacts: `circuits/build/GameRunV3{.r1cs,.sym,_js/,_final.zkey,_vkey.json}`, synced to `public/circuits/build/`.
- Real proof (`circuits/fixtures/gamerun_v3.input.json`: score 300, wave 3, kills 12, seed 123456789, nonce 1731300000042,
  season 1, events_hash 987654321): `snarkjs groth16 verify` OK; exported to `circuits/build/contract_proof_v3.json`
  (the VK the deploy pins) and committed as `circuits/fixtures/gamerun_v3_s300_w3{,.snarkjs}.json`.
- Native test `test_real_proof_v3_s300_w3_submit_mismatch_replay`: `set_run_vk(V3)` + `submit_zk` OK; V1 proof+VK ->
  `VkMismatch`; claimed score 301 -> `SignalMismatch`; run_hash not equal to the Poseidon commitment -> `SignalMismatch`;
  replay -> `Replay`.
- Vitest `src/__tests__/zkV3.test.js`: `snarkjs.wtns.calculate` throws for score=100000 kills=1 (wave 3) and for
  score < wave*5 / used_zk_weapon=2; same run with kills=4 is provable; browser `generateLocalProof` V3 == pinned VK and
  signals; `/zk/prove_v3` prover output == pinned VK; `requestZkProofV2` routing.

### Constraints and constants

Public signals (unchanged layout, `submit_zk` needs no contract change):
`[run_hash_hi, run_hash_lo, score, wave, nonce, season_id, used_zk_weapon]`, where
`run_hash = Poseidon(seed, score, wave, kills, nonce, season_id, events_hash)` (circomlib Poseidon, BN254), split with
`Num2Bits_strict` into hi = bits 128..253, lo = bits 0..127. `submit_zk`'s `run_hash` (32 bytes) = big-endian hash =
`hi (16 B) || lo (16 B)`.

Range checks: score, wave, kills, season < 2^32; nonce < 2^64; used_zk_weapon in {0,1}.

```
score >= wave * 5
score <= kills * 26250 + wave^2 * 875 + wave * 5000
```

Score is the run XP (`getRunScore` = `state.score` or `totalXP`, `src/systems/scoreRules.js`), so the bound follows XP:

| Constant | Value | Derivation |
|----------|-------|------------|
| `MIN_SCORE_PER_WAVE` | 5 | contract `validate_ranked_claim`, GameRun |
| `MAX_SCORE_PER_KILL` | 26250 | max `xpValue` 3000 (`src/data/enemies.js`) x2 `DOUBLE_XP` event (`EventManager`) x1.25 run modifier `xpMult` (`RunModifiers`) x3.5 `addXP` multiplier cap (`src/main.js`, streak x upgrade x rebirth) |
| `WAVE_BONUS_QUAD` | 875 | wave-clear bonus `newWave * 100` (after a boss wave; 25 otherwise) x2 x1.25 x3.5 = 875*w per wave; summed over waves `sum 875*w <= 875*W^2` |
| `WAVE_FLAT` | 5000 | per-wave headroom: shrine jackpot 500 x3.5 = 1750, `cache_hit` item 40*(1+0.05w) x3.5, map pickups 5-15 x3.5 |

The old `6000 / 100` constants were too tight: a real run with one boss kill under DOUBLE_XP + cap, or the quadratic
wave-clear bonus, would have been unprovable. Not covered: coding XP from the XP WebSocket (`src/utils/socket.js`,
server-provided, unbounded). A run that earned a lot of coding XP with few kills can exceed the bound -> the witness
fails -> ranked submit throws (the local check in `buildRunWitness` reports `score X > provable max Y`).

### V3 payload contract

`submitZkTrustless(addr, sign, payload)` / `generateLocalProof(payload)` / `requestZkProofV2(url, payload)`:

| Field | Type | Notes |
|-------|------|-------|
| `score`, `wave` | u32 | public, bound to the claim |
| `nonce` | u64 (string/bigint) | public, replay key |
| `season_id` | u32 | default 1 |
| `used_zk_weapon` | 0/1 | public |
| `seed` | hex (`generateRunSeed()`), decimal or bigint | **private**; reduced to its low 253 bits |
| `kills` | u32 | **private**; `window.VIBE_CODER.kills` |
| `events` | array (optional) | event log; `events_hash = SHA-256(stable JSON per event, "\n"-joined)` low 253 bits, `0` if empty |
| `events_hash` | decimal string (optional) | overrides `events` |
| `run_hash_hi/lo` | ignored for V3 | the run hash is the circuit's Poseidon output, read back from public signals 0/1 (`zk.runHashHex`) and sent as `submit_zk`'s `run_hash` |

V3 is used when `VITE_ZK_CIRCUIT !== 'v1'` AND the payload has `seed` and `kills`; if the browser V3 artifacts are
missing (`GameRunV3_vkey.json` 404) the local prover falls back to GameRun. `POST /zk/prove_v3` takes the
`buildRunWitness` output (`seed, kills, events_hash, score, wave, nonce, season_id, used_zk_weapon`; `events` accepted
instead of `events_hash`), answers 400 for out-of-range / unprovable runs and 503 if the V3 artifacts are not built.
`VITE_ZK_CIRCUIT` is read from `window.__VITE_CONFIG__` like `VITE_ZK_BACKEND`; both are in `CONFIG_KEYS`
(`scripts/write_config_from_env.js`), set from GitHub repo variables in `.github/workflows/deploy.yml` and documented in
`public/config.json.example` (default `v3`). ArenaScene sends `seed: this.runSeed` + `kills` and pre-checks
`maxProvableScore(kills, wave)`: an unprovable run shows `hud.run_not_provable` and falls back to the casual submit.

Why SHA-256 and not Poseidon for `events_hash`: no JS Poseidon is installed (`circomlibjs` is not a dependency) and
the task forbids new installs. `events_hash` is an opaque private field element the circuit commits to via Poseidon,
so any collision-resistant hash works; the server can recompute it with `node:crypto`. Switching to Poseidon later only
changes `computeEventsHash` (and the server check), not the circuit.

`buildRunWitness({ score, wave, kills, seed, nonce, season, events, eventsHash, usedZkWeapon })` in
`src/zk/gameProof.js` returns the exact snarkjs input and throws early for runs the circuit cannot prove
(`maxProvableScore(kills, wave)`).

### Scene wiring (ArenaScene, for the scene owner)

In the ranked submit, where `payload` is built (after `computeGameHash`), add the private witness:

```js
const payload = {
  run_hash_hi: runHashHi,          // ignored by V3 (run hash comes from the proof), kept for the v1 fallback
  run_hash_lo: runHashLo,
  score,
  wave,
  nonce,
  season_id: seasonId,
  // GameRunV3 private witness
  seed: this.runSeed,              // generateRunSeed() hex, set at run start
  kills: window.VIBE_CODER.kills,  // same counter the game-over screen shows
  // events: this.runEventLog,     // optional; omitted -> events_hash = 0
  challenge_id: challengeId,
  player_address: addr,
  contract_id: contractId,
  domain_separator: domainSeparator,
};
```

Optional early check before proving (same rule as the circuit):

```js
import { maxProvableScore } from '../zk/gameProof.js';
if (BigInt(score) > maxProvableScore(window.VIBE_CODER.kills, wave)) { /* show "run not provable" instead of submitting */ }
```

## Noir / UltraHonk evaluation (2026-11-11, nargo 1.0.0, bb 6.0.0, soroban-sdk 25.1.1)

- `circuits/noir/src/main.nr` does **not compile** with nargo 1.0.0: `used_zk_weapon: pub u1` (type `u1` was removed).
  `public/circuits/GameRun.json` (the ACIR the legacy browser path loads) was compiled by an older nargo. Left as is
  (legacy, see below). In a scratch copy with `u1 -> bool`: `nargo compile` + `nargo execute` OK,
  `bb write_vk -t evm` (VK 1.9 KB), `bb prove -t evm` (proof 7.2 KB, 7 public inputs x 32 B) and `bb verify` -> "Proof
  verified successfully". The circuit itself has the same soundness gap as GameRun (no private witness).
- soroban-sdk 25 (CAP-74) host functions: `bn254().g1_add`, `g1_mul`, `pairing_check`, `keccak256`, `poseidon`/`poseidon2`
  permutations. There is **no Fr arithmetic** host function (`Fr` is a `U256` wrapper; `U256::mul` traps on overflow,
  no mulmod/inverse). An UltraHonk verifier needs: keccak Fiat-Shamir transcript (host OK), sumcheck over log2(n)
  rounds evaluating all UltraHonk relations (thousands of Fr mul/add + batch inversion: must be **software Fr
  arithmetic compiled into the contract wasm**), Shplemini/KZG batch opening (~40+ G1 MSM terms: host `g1_mul`/`g1_add`)
  and one pairing (host). So it is possible only with a sizeable pure-Rust Fr implementation in the contract, pinned
  to bb 6.0.0's exact proof/VK layout and transcript, and its CPU cost against the 100M-instruction tx limit is
  unmeasured. Not viable as a partial fix here.
- Decision: `contracts/ultrahonk_verifier` stays a **structural stub, legacy**: not wired by the deploy script unless
  `ENABLE_NOIR_STUB=1`, only reachable with `VITE_ZK_BACKEND=noir`. Ranked uses Groth16 (`submit_zk`), which is fully
  verified with the BN254 pairing host function.
