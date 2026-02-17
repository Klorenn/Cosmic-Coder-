#!/usr/bin/env bash
# Build GameRun circuit: compile R1CS + WASM, then Groth16 trusted setup.
# Requires: circom 2.x, snarkjs, node. Prefer cargo-installed circom: PATH="$HOME/.cargo/bin:$PATH"
set -e
export PATH="${HOME}/.cargo/bin:${PATH}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
CIRCUITS_DIR="$ROOT/circuits"
BUILD_DIR="$CIRCUITS_DIR/build"
PTAU_FILE="$BUILD_DIR/pot12_final.ptau"
CIRCUIT_NAME="GameRun"

mkdir -p "$BUILD_DIR"
cd "$CIRCUITS_DIR"

if ! command -v circom &>/dev/null; then
  echo "Install circom 2.x: https://docs.circom.io/getting-started/installation/"
  exit 1
fi
# GameRun.circom requires circom 2.x (pragma circom 2.1.4). circom 0.5.x will fail with parse errors.
if circom --version 2>/dev/null | head -1 | grep -qE '^0\.'; then
  echo "This circuit requires circom 2.x. You have circom 0.x. Install from: https://docs.circom.io/getting-started/installation/"
  exit 1
fi
if ! command -v snarkjs &>/dev/null; then
  echo "Install snarkjs: npm i -g snarkjs"
  exit 1
fi

echo "Compiling ${CIRCUIT_NAME}.circom..."
circom "$CIRCUIT_NAME.circom" --r1cs --wasm --sym -o "$BUILD_DIR"

# Ensure we have a valid powers of tau file (real .ptau is large; failed download is tiny)
if [ ! -f "$PTAU_FILE" ] || [ "$(stat -f%z "$PTAU_FILE" 2>/dev/null || stat -c%s "$PTAU_FILE" 2>/dev/null)" -lt 10000 ]; then
  rm -f "$PTAU_FILE"
  echo "Downloading powers of tau (small, for demo)..."
  curl -L -o "$PTAU_FILE" \
    "https://hermez.s3-eu-west-1.amazonaws.com/powersOfTau28_hez_final_12.ptau" 2>/dev/null || true
fi
if [ ! -f "$PTAU_FILE" ] || [ "$(stat -f%z "$PTAU_FILE" 2>/dev/null || stat -c%s "$PTAU_FILE" 2>/dev/null)" -lt 10000 ]; then
  echo "Download failed or invalid; generating powers of tau locally (this may take a minute)..."
  rm -f "$PTAU_FILE" "$BUILD_DIR/pot12_0000.ptau" "$BUILD_DIR/pot12_0001.ptau"
  snarkjs powersoftau new bn128 12 "$BUILD_DIR/pot12_0000.ptau"
  echo "random" | snarkjs powersoftau contribute "$BUILD_DIR/pot12_0000.ptau" "$BUILD_DIR/pot12_0001.ptau" --name="cosmic"
  snarkjs powersoftau prepare phase2 "$BUILD_DIR/pot12_0001.ptau" "$PTAU_FILE"
fi

echo "Groth16 setup..."
snarkjs groth16 setup "$BUILD_DIR/${CIRCUIT_NAME}.r1cs" "$PTAU_FILE" "$BUILD_DIR/${CIRCUIT_NAME}_0000.zkey"
echo "random" | snarkjs zkey contribute "$BUILD_DIR/${CIRCUIT_NAME}_0000.zkey" "$BUILD_DIR/${CIRCUIT_NAME}_final.zkey" --name="cosmic"
snarkjs zkey export verificationkey "$BUILD_DIR/${CIRCUIT_NAME}_final.zkey" "$BUILD_DIR/vkey.json"

echo "Done. Artifacts in $BUILD_DIR"
echo "  - ${CIRCUIT_NAME}_js/${CIRCUIT_NAME}.wasm (prover)"
echo "  - ${CIRCUIT_NAME}_final.zkey"
echo "  - vkey.json"
