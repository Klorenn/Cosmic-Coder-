# Testnet deployment (Stellar TESTNET)

**Date:** 2026-11-11 · **Network:** `Test SDF Network ; September 2015` · **RPC:** `https://soroban-testnet.stellar.org`

> TESTNET ONLY. The Groth16 trusted setup of the ranked circuits is a **single contribution** (no multi-party
> ceremony), so whoever ran it could forge proofs. Never reuse these zkeys/VKs on mainnet.

## Contract IDs

| Contract | ID | Notes |
|----------|----|-------|
| `cosmic_coder` (policy) | `CAEE26RL4PQ3SDRRDRWY2DUWUELG7YNTXYJUQTM2QFDY6BEU5TUX3F6F` | `VITE_COSMIC_CODER_CONTRACT_ID`; run VK = GameRunV3 (`ZK_CIRCUIT=v3`) |
| `groth16_verifier` | `CAU6UVGUBSPQPVYV6ZGDVMJJLQJ364YKKEU7O2XM2CYPNISVR5D7E5JY` | wired with `set_verifier` |
| `ultrahonk_verifier` | `CCAD3BV5D4NON3ULV4MBPR7KVHJQFSPUFQP6BMSQUX4RHB2ZFEKCEA3Q` | STUB; deployed but NOT wired (`set_noir_verifier` skipped) |
| Game Hub (Stellar Game Studio) | `CB4VZAT2U3UC6XFK3N23SKRF2NDCMP3QHJYMCHHFMZO7MRQO6DQ2EMYG` | pre-existing; interface `start_game`/`end_game` checked with `stellar contract info interface` |

- Admin / deployer (public): `GBYTM7WYFHS6JGZXO2JKD3RP4DLSS3GZ6Q3G7AZRVSYEGDNRIF3YQJEY` (stellar CLI identity `cosmic-deployer`, friendbot-funded; the secret lives only in `~/.config/stellar`, never in the repo).
- Unlock VK (SkillProof) pinned with `set_unlock_vk` (see "Unlock VK" below); `unlock_weapon` verified with a real proof.
- WASM sizes (`wasm32v1-none`, release, `opt-level = "z"`): cosmic_coder 48 KB, groth16_verifier 14 KB, ultrahonk_verifier 9.1 KB.

## Deploy / configuration transactions

| Step | Tx hash |
|------|---------|
| deploy cosmic_coder (constructor admin + game_hub) | `31a7f1e833827cebb8075d3ad4bc36fc611a65e91c5fc883a2a444dc421b1911` |
| `set_verifier` | `27f2fd5a28f1b7ba4ed18a90c35c1a29251af801ab930630894b9c6c6f0c9b40` |
| `set_run_vk` (V3) | `57452dc8a7930120ddac4d45ccc7db992ebf62c1a3e15e2994623868179f5a45` |
| ultrahonk `set_vk` | `c73806b56e79577aae273eb3c083a3b10744d6acfee6ee91e85ebfa4328c9cd5` |
| `set_unlock_vk` (SkillProof) | `2e81accfc0a4b4f71d3f200561f686bfdf360ea149b2425541117de49ee7737b` |

## On-chain verification (2026-11-11)

| Check | Result |
|-------|--------|
| `get_admin` / `get_game_hub` (simulated) | deployer address / Game Hub above |
| `can_start_match` (deployer, fresh) | `false` (0 games played, expected) |
| `submit_zk` with `circuits/build/contract_proof_v3.json` (score 300, wave 3, season 1, nonce 1731300000042) | SUCCESS, tx `95ed1c2436c3b39b1596f6e1e72ba377b07d02b5daacc86b76a529487a743ef8`, event `zk_run_submitted` |
| same call again | rejected in simulation: `Error(Contract, #2)` Replay (no tx, never broadcast) |
| same proof, `--score 301` | rejected in simulation: `Error(Contract, #9)` SignalMismatch (no tx) |
| `get_leaderboard_by_season 1 10` | `[{"player":"GBYTM7…QJEY","score":300}]` |
| `is_nonce_used(deployer, 1, 1731300000042)` | `true` |

The nonce is fixed inside the proof's public signals, so the fixture proof can be accepted exactly once per
contract instance. Frontend smoke (`gameClient.js` against this deploy): `getLeaderboardBySeason`, `isNonceUsed`,
`getActiveSession` decode the live contract.

## Unlock VK (SkillProof, 2026-11-11)

Artifacts (one local trusted setup, TESTNET ONLY: fresh `pot12` with 1 contribution + 1 zkey contribution, random
entropy, `snarkjs zkey verify` OK against `circuits/build/pot12_final.ptau`, which is gitignored and kept locally):

| File | What |
|------|------|
| `circuits/build/SkillProof.r1cs`, `SkillProof_js/` | circom 2.2.2 build of `circuits/SkillProof.circom` (642 constraints, public `[threshold, publicHash]`) |
| `circuits/build/SkillProof_final.zkey` / `SkillProof_vkey.json` | prover key / VK (== `zkey export verificationkey`) |
| `public/circuits/build/SkillProof_*` | same wasm/zkey/vkey for the browser |
| `circuits/build/contract_proof_skill.json` | contract-format proof+VK from `scripts/zk/generate_skill_proof.js` (the deploy script's `UNLOCK_VK_JSON`) |
| `circuits/fixtures/skillproof_w2_t1000{,.snarkjs,.unlock_tx}.json` | the real proof below (contract / raw snarkjs + input / accepted tx args) |

Proof: weapon 2 (Shotgun), `threshold = WEAPON_THRESHOLDS[1] = 1000`, private score 1500, wallet = field of the
deployer address (`server/skillProof.js` `walletToField`), nonce 20261111. `pub_signals = [0x03e8, publicHash]`.

| Check (player = deployer) | Result |
|-------|--------|
| `unlock_weapon` before the pin | rejected in simulation: `Error(Contract, #7)` VkNotSet |
| `set_unlock_vk` | SUCCESS, tx `2e81accfc0a4b4f71d3f200561f686bfdf360ea149b2425541117de49ee7737b`, event `config_updated` field `unlock_vk` |
| `unlock_weapon` weapon 2, threshold 5000 | rejected in simulation: `Error(Contract, #13)` ThresholdMismatch (no tx) |
| `unlock_weapon` weapon 2, threshold 1000 | SUCCESS, tx `9dc8f259a0f11a3f040098461ab65c1c03e52dcab06830e9c14a9522aeec763d` (ledger 5680037), event `weapon_unlocked` |
| `is_weapon_unlocked(deployer, 2)` / `get_unlocked_weapons(deployer)` | `true` / `[2]` |
| same proof again | rejected in simulation: `Error(Contract, #14)` AlreadyUnlocked (no tx, never broadcast) |

The `public_hash` is now burned (`UnlockProof` replay key): the same proof from any other account fails with `#2`
Replay (native test). Because `wallet` is a PRIVATE input and the contract does not bind the proof to `player`, a
pending unlock tx can be front-run from another account (see `contracts/README.md`, known limitations).

```bash
node scripts/zk/generate_skill_proof.js circuits/build/skill_input.json  # fullprove + snarkjs verify + contract_proof_skill.json
# or through the prover: generateSkillProof({ score, wallet, nonce, threshold }) in server/skillProof.js
P=CAEE26RL4PQ3SDRRDRWY2DUWUELG7YNTXYJUQTM2QFDY6BEU5TUX3F6F
V=$(python3 -I -c 'import json;print(json.dumps(json.load(open("circuits/build/contract_proof_skill.json"))["vk"]))')
stellar contract invoke --id $P --source-account cosmic-deployer --network testnet -- set_unlock_vk --vk "$V"
TESTNET_SMOKE=1 npx vitest run src/__tests__/weaponUnlockTestnet.smoke.test.js   # isWeaponUnlocked / getUnlockedWeapons live
```

The deploy script re-applies `set_unlock_vk` on every run from `UNLOCK_VK_JSON` (default
`circuits/build/contract_proof_skill.json`). Rebuilding SkillProof = new setup = new VK: re-pin it, re-sync
`public/circuits/build/SkillProof_*` and regenerate the fixtures.

## Exact commands

```bash
export PATH="$HOME/.cargo/bin:$PATH"; . "$HOME/.cargo/env"
cd contracts && cargo build --target wasm32v1-none --release -p groth16_verifier -p ultrahonk_verifier -p cosmic_coder && cd ..
stellar keys generate cosmic-deployer --network testnet --fund     # or reuse: stellar keys address cosmic-deployer
SOURCE_ACCOUNT=cosmic-deployer ZK_CIRCUIT=v3 bash scripts/deploy_contracts_testnet.sh
```

Idempotent re-run (reuses contracts that still exist, re-applies `set_verifier` / `set_run_vk` / `set_unlock_vk`):

```bash
SOURCE_ACCOUNT=cosmic-deployer ZK_CIRCUIT=v3 \
  VERIFIER_ID=CAU6UVGUBSPQPVYV6ZGDVMJJLQJ364YKKEU7O2XM2CYPNISVR5D7E5JY \
  NOIR_VERIFIER_ID=CCAD3BV5D4NON3ULV4MBPR7KVHJQFSPUFQP6BMSQUX4RHB2ZFEKCEA3Q \
  POLICY_ID=CAEE26RL4PQ3SDRRDRWY2DUWUELG7YNTXYJUQTM2QFDY6BEU5TUX3F6F \
  bash scripts/deploy_contracts_testnet.sh
```

Smoke checks:

```bash
P=CAEE26RL4PQ3SDRRDRWY2DUWUELG7YNTXYJUQTM2QFDY6BEU5TUX3F6F
stellar contract invoke --id $P --source-account cosmic-deployer --network testnet --send=no -- get_admin
stellar contract invoke --id $P --source-account cosmic-deployer --network testnet --send=no -- get_leaderboard_by_season --season_id 1 --limit 10
```

## After a testnet reset (roughly quarterly)

Testnet resets wipe accounts and contracts. To redeploy:

1. `stellar keys fund cosmic-deployer --network testnet` (the key survives locally; the account must be re-funded).
2. Check the Game Hub: `stellar contract info interface --id CB4VZAT2… --network testnet`. The script aborts if it is
   gone; deploy a hub exposing `start_game(game_id, session_id: u32, player1, player2, player1_points: i128, player2_points: i128)`
   and `end_game(session_id: u32, player1_won: bool)` and pass `GAME_HUB=<id>`.
3. Run the deploy script **without** `VERIFIER_ID` / `NOIR_VERIFIER_ID` / `POLICY_ID`.
4. Put the new `POLICY_ID` (and `GAME_HUB` if changed) in `public/config.json`
   (`VITE_COSMIC_CODER_CONTRACT_ID`, `VITE_GAME_HUB_CONTRACT_ID`), keep `VITE_ZK_CIRCUIT` equal to the deployed `ZK_CIRCUIT`,
   update this file, commit and push (GitHub Pages serves the committed `public/config.json`; secrets with the same
   name would override it in CI).
