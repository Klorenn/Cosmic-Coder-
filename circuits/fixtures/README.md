# ZK fixtures (real, committed)

All proven with `circuits/build/GameRun_final.zkey` (VK = `circuits/build/GameRun_vkey.json`, the one
`scripts/deploy_contracts_testnet.sh` pins with `set_run_vk`). Regenerate only together with that zkey.

| File | What |
|------|------|
| `gamerun_s300_w3.input.json` | GameRun witness input: score 300, wave 3, nonce 1731300000042, season 1 |
| `gamerun_s300_w3.snarkjs.json` | raw snarkjs `{ proof, publicSignals }` for that input |
| `gamerun_s300_w3.json` | same proof in contract format (`export_for_contract.js`); used by `cosmic_coder` tests via `include_str!` |
| `prover_request_gamerun.json` / `prover_response_gamerun.json` | real `POST /zk/prove` body (as sent by `requestZkProofV2`) and response from `server/index.js` |
| `gamerun_v3.input.json` | GameRunV3 witness input: score 300, wave 3, kills 12, seed 123456789, events_hash 987654321, nonce 1731300000042, season 1 (== `buildRunWitness` output, tested) |
| `gamerun_v3_s300_w3.snarkjs.json` / `gamerun_v3_s300_w3.json` | real V3 proof (raw / contract format) with `circuits/build/GameRunV3_final.zkey`; VK == `circuits/build/contract_proof_v3.json` (deploy pin); used by `test_real_proof_v3_s300_w3_submit_mismatch_replay` |

V3 fixtures belong to `GameRunV3_final.zkey`: re-running `scripts/zk/build_GameRunV3.sh` makes a new setup, so copy
`circuits/build/contract_proof_v3{,.snarkjs}.json` over the two V3 fixtures afterwards.
