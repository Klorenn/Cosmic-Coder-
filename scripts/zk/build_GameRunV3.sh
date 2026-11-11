#!/usr/bin/env bash
# Build GameRunV3 (run commitment + private witness): compile, Groth16 setup on circuits/pot12_final.ptau,
# prove the fixture input, verify, export for the contract and sync the browser artifacts.
# Requires circom 2.x (default: ~/.cargo/bin/circom if present; Homebrew's `circom` 0.5.x is circom 1),
# snarkjs (npx), node. Does NOT touch GameRun/GameRunV2 artifacts or circuits/build/contract_proof.json.
# Output: circuits/build/GameRunV3{.r1cs,.sym,_js/,_final.zkey,_vkey.json}, circuits/build/contract_proof_v3.json,
#         public/circuits/build/GameRunV3{_js/GameRunV3.wasm,_final.zkey,_vkey.json}
# TESTNET ONLY: pot12_final.ptau is a single local contribution and the phase-2 has one contribution.
# Every run is a NEW trusted setup -> new VK that must be re-pinned with set_run_vk (deploy script).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
C="$ROOT/circuits"
B="$C/build"
P="$ROOT/public/circuits/build"
PTAU="$C/pot12_final.ptau"
INPUT="${1:-$C/fixtures/gamerun_v3.input.json}"
if [ -z "${CIRCOM:-}" ]; then
  if [ -x "$HOME/.cargo/bin/circom" ]; then CIRCOM="$HOME/.cargo/bin/circom"; else CIRCOM=circom; fi
fi
SNARKJS="npx --no-install snarkjs"

if ! "$CIRCOM" --version 2>/dev/null | grep -qE '^circom compiler 2\.'; then
  echo "GameRunV3 needs circom 2.x (got: $("$CIRCOM" --version 2>&1 | head -1)). Set CIRCOM=/path/to/circom2." >&2
  exit 1
fi
mkdir -p "$B" "$P/GameRunV3_js"
cd "$C"
"$CIRCOM" GameRunV3.circom --r1cs --wasm --sym -o "$B"
$SNARKJS r1cs info "$B/GameRunV3.r1cs"
$SNARKJS groth16 setup "$B/GameRunV3.r1cs" "$PTAU" "$B/GameRunV3_0000.zkey"
$SNARKJS zkey contribute "$B/GameRunV3_0000.zkey" "$B/GameRunV3_final.zkey" --name="cosmic-v3-testnet" -e="$(openssl rand -hex 32)"
rm -f "$B/GameRunV3_0000.zkey"
$SNARKJS zkey verify "$B/GameRunV3.r1cs" "$PTAU" "$B/GameRunV3_final.zkey"
$SNARKJS zkey export verificationkey "$B/GameRunV3_final.zkey" "$B/GameRunV3_vkey.json"

node "$ROOT/scripts/zk/generate_proof_v3.js" "$INPUT"

cp "$B/GameRunV3_js/GameRunV3.wasm" "$P/GameRunV3_js/GameRunV3.wasm"
cp "$B/GameRunV3_final.zkey" "$B/GameRunV3_vkey.json" "$P/"
echo "GameRunV3 OK -> $B/contract_proof_v3.json (deploy pins it with set_run_vk; browser artifacts synced to $P)"
