#!/usr/bin/env bash
# E2E ZK flow: build circuit, generate real proof, run contract tests.
# Use before presenting to confirm proof real + submit_zk + leaderboard work.
set -e
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "=== 1. Building circuit (with score >= wave*10 constraint) ==="
./scripts/zk/build_circuit.sh

echo ""
echo "=== 2. Generating real Groth16 proof ==="
npm run zk:proof

echo ""
echo "=== 3. Running contract tests (verifier + policy, incl. real proof) ==="
cd contracts
cargo test -p groth16_verifier -p cosmic_coder

echo ""
echo "=== E2E ZK: OK ==="
