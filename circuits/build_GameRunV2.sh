#!/bin/bash
set -euo pipefail

# Build GameRunV2.circom for ZK v2
# Prerequisites: circom, snarkjs, node
# Outputs: GameRunV2.wasm, GameRunV2.zkey, GameRunV2.vkey, GameRunV2.sol

CIRCOM="circom"
NODE="node"
WASM_DIR="build/GameRunV2_js"
PTAU="pot12_final.ptau"

echo "[+] Building GameRunV2.circom..."
$CIRCOM GameRunV2.circom --r1cs --wasm --sym -o $WASM_DIR

echo "[+] Generating zkey (powers of tau must exist: $PTAU)..."
if [ ! -f "$PTAU" ]; then
    echo "[-] Powers of tau file $PTAU not found. Download it or run snarkjs powersoftau new bn128 12 pot12_0000.ptau && snarkjs powersoftau contribute pot12_0000.ptau pot12_0001.ptau --name=\"First contribution\" --entropy=\"random text\" && snarkjs powersoftau prepare phase2 pot12_0001.ptau pot12_final.ptau"
    exit 1
fi

$NODE -e "
const snarkjs = require('snarkjs');
async function main() {
  await snarkjs.zKey.newZKey('build/GameRunV2_js/GameRunV2.r1cs', 'pot12_final.ptau', 'build/GameRunV2_js/GameRunV2_0000.zkey');
  await snarkjs.zKey.contribute('build/GameRunV2_js/GameRunV2_0000.zkey', 'build/GameRunV2_js/GameRunV2.zkey', 'random entropy');
  await snarkjs.zKey.exportVerificationKey('build/GameRunV2_js/GameRunV2.zkey', 'build/GameRunV2_js/GameRunV2.vkey');
  console.log('Verification key written to build/GameRunV2_js/GameRunV2.vkey');
}
main();
"

echo "[+] Exporting Solidity verifier (optional)..."
$NODE -e "
const snarkjs = require('snarkjs');
async function main() {
  await snarkjs.zKey.exportSolidityVerifier('build/GameRunV2_js/GameRunV2.zkey', 'build/GameRunV2_js/GameRunV2.sol');
  console.log('Solidity verifier written to build/GameRunV2_js/GameRunV2.sol');
}
main();
"

echo "[+] Done. Artifacts in $WASM_DIR/"
echo "    - GameRunV2.wasm (witness generator)"
echo "    - GameRunV2.zkey (proving key)"
echo "    - GameRunV2.vkey (verification key)"
echo "    - GameRunV2.sol (Solidity verifier, optional)"
