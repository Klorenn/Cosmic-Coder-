#!/usr/bin/env bash
# Deploy groth16_verifier and cosmic_coder to Stellar Testnet, then init policy.
# Requires: stellar CLI, SOURCE_ACCOUNT with XLM on testnet, WASM built (rustup).
#
# Usage:
#   export SOURCE_ACCOUNT=YOUR_PUBLIC_KEY_OR_IDENTITY   # e.g. GXXXX... or identity from stellar keys list
#   ./scripts/deploy_contracts_testnet.sh
#
# Or one-liner: SOURCE_ACCOUNT=G... ./scripts/deploy_contracts_testnet.sh
#
# If SOURCE_ACCOUNT is not set, this script only prints the commands for you to run.

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CONTRACTS="$ROOT/contracts"
# Soroban testnet requires wasm32v1-none (wasm32-unknown-unknown can fail with "reference-types not enabled")
WASM_DIR="$CONTRACTS/target/wasm32v1-none/release"
GAME_HUB="CB4VZAT2U3UC6XFK3N23SKRF2NDCMP3QHJYMCHHFMZO7MRQO6DQ2EMYG"

if [ ! -f "$WASM_DIR/groth16_verifier.wasm" ] || [ ! -f "$WASM_DIR/shadow_ascension.wasm" ]; then
  echo "Build WASM first (use target wasm32v1-none for Soroban testnet):"
  echo "  export PATH=\"\$HOME/.cargo/bin:\$PATH\""
  echo "  rustup target add wasm32v1-none"
  echo "  cd $CONTRACTS && cargo build -p zk_types && cargo build -p groth16_verifier --target wasm32v1-none --release && cargo build -p shadow_ascension --target wasm32v1-none --release"
  exit 1
fi

if [ -z "$SOURCE_ACCOUNT" ]; then
  echo "SOURCE_ACCOUNT not set. Run with: SOURCE_ACCOUNT=YOUR_KEY ./scripts/deploy_contracts_testnet.sh"
  echo ""
  echo "Or run these manually (replace <SOURCE> with your testnet public key or identity):"
  echo ""
  echo "cd $CONTRACTS"
  echo "stellar contract deploy --source-account <SOURCE> --network testnet --wasm target/wasm32v1-none/release/groth16_verifier.wasm"
  echo "# Save the returned ID as VERIFIER_ID"
  echo "stellar contract deploy --source-account <SOURCE> --network testnet --wasm target/wasm32v1-none/release/shadow_ascension.wasm"
  echo "# Save the returned ID as POLICY_ID"
  echo "stellar contract invoke --id <POLICY_ID> --source-account <SOURCE> --network testnet -- init --game_hub $GAME_HUB"
  echo "stellar contract invoke --id <POLICY_ID> --source-account <SOURCE> --network testnet -- set_verifier --verifier <VERIFIER_ID>"
  echo ""
  echo "Then add to .env: VITE_COSMIC_CODER_CONTRACT_ID=<POLICY_ID>"
  exit 0
fi

cd "$CONTRACTS"

echo "Deploying verifier (source: $SOURCE_ACCOUNT)..."
VERIFIER_ID=$(stellar contract deploy --source-account "$SOURCE_ACCOUNT" --network testnet --wasm target/wasm32v1-none/release/groth16_verifier.wasm 2>&1 | tee /dev/stderr | tail -1)
echo "VERIFIER_ID=$VERIFIER_ID"

echo "Deploying policy..."
POLICY_ID=$(stellar contract deploy --source-account "$SOURCE_ACCOUNT" --network testnet --wasm target/wasm32v1-none/release/shadow_ascension.wasm 2>&1 | tee /dev/stderr | tail -1)
echo "POLICY_ID=$POLICY_ID"

echo "Initing policy with Game Hub..."
stellar contract invoke --id "$POLICY_ID" --source-account "$SOURCE_ACCOUNT" --network testnet -- init --game_hub "$GAME_HUB"

echo "Setting verifier..."
stellar contract invoke --id "$POLICY_ID" --source-account "$SOURCE_ACCOUNT" --network testnet -- set_verifier --verifier "$VERIFIER_ID"

echo ""
echo "Done. Add to .env:"
echo "  VITE_COSMIC_CODER_CONTRACT_ID=$POLICY_ID"
echo ""
echo "Add to GitHub repo Secrets (Settings → Secrets and variables → Actions):"
echo "  VITE_COSMIC_CODER_CONTRACT_ID = $POLICY_ID"
echo "  VITE_ZK_PROVER_URL = <your prover URL after deploying to Render/Railway>"
echo ""
