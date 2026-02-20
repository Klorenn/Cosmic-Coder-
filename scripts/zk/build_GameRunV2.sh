#!/usr/bin/env bash
# Build GameRunV2 circuit: compile R1CS + WASM, then Groth16 trusted setup.
# Requires: circom 2.x, snarkjs, node. Prefer cargo-installed circom: PATH="$HOME/.cargo/bin:$PATH"
set -e
export PATH="${HOME}/.cargo/bin:${PATH}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
CIRCUITS_DIR="$ROOT/circuits"
BUILD_DIR="$CIRCUITS_DIR/build"
PTAU_FILE="$BUILD_DIR/pot12_final.ptau"

CIRCUIT="GameRunV2"

mkdir -p "$BUILD_DIR"
cd "$CIRCUITS_DIR"

if ! command -v circom &>/dev/null; then
  echo "Install circom 2.x: https://docs.circom.io/getting-started/installation/"
  exit 1
fi

if ! command -v snarkjs &>/dev/null; then
  echo "Install snarkjs: npm install -g snarkjs"
  exit 1
fi

echo "Building $CIRCUIT circuit..."

# Compile circuit (R1CS + WASM)
circom "$CIRCUIT.circom" --r1cs --wasm --sym --c --output "$BUILD_DIR"

# Groth16 trusted setup
if [ ! -f "$PTAU_FILE" ]; then
  echo "Downloading powers of tau ceremony file..."
  curl -L https://hermez.s3-eu-west-1.amazonaws.com/powersOfTau28_hez_final.ptau -o "$BUILD_DIR/pot12_final.ptau"
fi

echo "Starting Groth16 trusted setup for $CIRCUIT..."

# Phase 1
snarkjs groth16 setup "$BUILD_DIR/$CIRCUIT.r1cs" "$PTAU_FILE" "$BUILD_DIR/${CIRCUIT}_0000.zkey"

# Phase 2
snarkjs groth16 contribute "$BUILD_DIR/${CIRCUIT}_0000.zkey" "$BUILD_DIR/${CIRCUIT}_0001.zkey" --name="1st Contribution" --entropy="$(openssl rand -hex 32)"

# Phase 3
snarkjs groth16 contribute "$BUILD_DIR/${CIRCUIT}_0001.zkey" "$BUILD_DIR/${CIRCUIT}_final.zkey" --name="2nd Contribution" --entropy="$(openssl rand -hex 32)"

# Generate verification key
snarkjs zkey contribute "$BUILD_DIR/${CIRCUIT}_final.zkey" "$BUILD_DIR/${CIRCUIT}_final.zkey" --name="Final contribution" --entropy="$(openssl rand -hex 32)"

# Export verification key
snarkjs zkey export verificationkey "$BUILD_DIR/${CIRCUIT}_final.zkey" "$BUILD_DIR/${CIRCUIT}_vkey.json"

echo "✅ $CIRCUIT circuit built successfully!"
echo "Files generated in $BUILD_DIR:"
ls -la "$BUILD_DIR/${CIRCUIT}"*
