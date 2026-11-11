#!/usr/bin/env bash
# E2E ZK flow.
#   E2E_LOCAL=1 npm run zk:e2e   -> offline: no circuit rebuild, no testnet. Checks artifact consistency,
#                                   proves + verifies GameRun/GameRunV2/GameRunV3 with the committed artifacts, checks
#                                   that V3 rejects score=100000 with kills=1, runs the native contract tests (real
#                                   proofs through submit_zk) and the Vitest ZK tests.
#   npm run zk:e2e               -> full: rebuilds circuits first (needs circom 2.x). WARNING: a rebuild runs a new
#                                   trusted setup, so the GameRun VK changes and must be re-pinned with set_run_vk.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
B="$ROOT/circuits/build"
SNARKJS="npx --no-install snarkjs"
W="$(mktemp -d)"
trap 'rm -rf "$W"' EXIT

if [ "${E2E_LOCAL:-0}" != "1" ]; then
  echo "=== 0. Building circuits (circom 2.x) ==="
  ./scripts/zk/build_circuit.sh
  npm run zk:proof
  bash scripts/zk/build_GameRunV3.sh
fi

echo "=== 1. Artifact consistency (zkey <-> vkey, browser <-> prover) ==="
for c in GameRun GameRunV2 GameRunV3; do
  $SNARKJS zkey export verificationkey "$B/${c}_final.zkey" "$W/$c.vk.json" >/dev/null
  node -e 'const [a,b]=process.argv.slice(1).map(f=>JSON.stringify(require(f)));if(a!==b){console.error("MISMATCH "+process.argv[2]);process.exit(1)}' "$W/$c.vk.json" "$B/${c}_vkey.json"
  echo "  $c: zkey matches ${c}_vkey.json"
done
cmp -s "$B/GameRun_final.zkey" public/circuits/build/GameRun_final.zkey || { echo "public/circuits/build/GameRun_final.zkey differs from circuits/build (browser proofs would hit VkMismatch)"; exit 1; }
cmp -s "$B/GameRun_js/GameRun.wasm" public/circuits/build/GameRun_js/GameRun.wasm || { echo "browser GameRun.wasm differs"; exit 1; }
for f in GameRunV3_final.zkey GameRunV3_vkey.json GameRunV3_js/GameRunV3.wasm; do
  cmp -s "$B/$f" "public/circuits/build/$f" || { echo "public/circuits/build/$f differs from circuits/build (browser V3 proofs would hit VkMismatch)"; exit 1; }
done
echo "  browser artifacts == prover artifacts"

echo "=== 2. GameRun (submit_zk circuit): prove score=300 wave=3, verify, export ==="
$SNARKJS groth16 fullprove circuits/fixtures/gamerun_s300_w3.input.json "$B/GameRun_js/GameRun.wasm" "$B/GameRun_final.zkey" "$W/proof.json" "$W/public.json" >/dev/null
$SNARKJS groth16 verify "$B/GameRun_vkey.json" "$W/public.json" "$W/proof.json"
cp "$B/GameRun_vkey.json" "$W/vkey.json"
node scripts/zk/export_for_contract.js "$W" "$W/contract_proof.json" >/dev/null
node -e 'const a=require(process.argv[1]).vk,b=require(process.argv[2]).vk;if(JSON.stringify(a)!==JSON.stringify(b)){console.error("VK differs from the one set_run_vk pins (circuits/build/contract_proof.json)");process.exit(1)}' "$W/contract_proof.json" "$B/contract_proof.json"
echo "  exported VK == pinned run VK"

echo "=== 3. GameRunV2 (off-chain only): prove + verify ==="
echo '{"run_hash_hi":"1","run_hash_lo":"2","score":"300","wave":"3","nonce":"7","season_id":"1","challenge_id":"1","player_address_hi":"0","player_address_lo":"0","contract_id_hi":"0","contract_id_lo":"0","domain_separator":"0"}' > "$W/v2.json"
$SNARKJS groth16 fullprove "$W/v2.json" "$B/GameRunV2_js/GameRunV2.wasm" "$B/GameRunV2_final.zkey" "$W/p2.json" "$W/s2.json" >/dev/null
$SNARKJS groth16 verify "$B/GameRunV2_vkey.json" "$W/s2.json" "$W/p2.json"

echo "=== 3b. GameRunV3 (submit_zk circuit, private witness): prove, verify, export == deploy pin ==="
$SNARKJS groth16 fullprove circuits/fixtures/gamerun_v3.input.json "$B/GameRunV3_js/GameRunV3.wasm" "$B/GameRunV3_final.zkey" "$W/p3.json" "$W/s3.json" >/dev/null
$SNARKJS groth16 verify "$B/GameRunV3_vkey.json" "$W/s3.json" "$W/p3.json"
mkdir -p "$W/v3" && cp "$W/p3.json" "$W/v3/proof.json" && cp "$W/s3.json" "$W/v3/public.json" && cp "$B/GameRunV3_vkey.json" "$W/v3/vkey.json"
node scripts/zk/export_for_contract.js "$W/v3" "$W/v3/contract_proof.json" >/dev/null
node -e 'const a=require(process.argv[1]),b=require(process.argv[2]),c=require(process.argv[3]);if(JSON.stringify(a.vk)!==JSON.stringify(b.vk)||JSON.stringify(a.vk)!==JSON.stringify(c.vk)){console.error("V3 VK differs from contract_proof_v3.json / fixture");process.exit(1)}if(JSON.stringify(a.pub_signals)!==JSON.stringify(b.pub_signals)){console.error("V3 public signals differ");process.exit(1)}' "$W/v3/contract_proof.json" "$B/contract_proof_v3.json" "$ROOT/circuits/fixtures/gamerun_v3_s300_w3.json"
echo "  exported V3 VK == contract_proof_v3.json (deploy pin) == fixture"
node -e 'const i=require(process.argv[1]);i.score="100000";i.kills="1";require("fs").writeFileSync(process.argv[2],JSON.stringify(i))' "$ROOT/circuits/fixtures/gamerun_v3.input.json" "$W/forged.json"
if $SNARKJS wtns calculate "$B/GameRunV3_js/GameRunV3.wasm" "$W/forged.json" "$W/forged.wtns" >/dev/null 2>&1; then
  echo "GameRunV3 accepted score=100000 with kills=1 (score bound broken)"; exit 1
fi
echo "  score=100000 kills=1: witness rejected"

echo "=== 4. Contract tests (verifier + submit_zk with real proofs) ==="
(cd contracts && cargo test -p groth16_verifier -p cosmic_coder)

echo "=== 5. Frontend/prover ZK tests (format, ranked submit, V3) ==="
npx vitest run src/__tests__/zkProverFormat.test.js src/__tests__/zkRankedSubmit.test.js src/__tests__/zkV3.test.js

echo "=== E2E ZK: OK ==="
