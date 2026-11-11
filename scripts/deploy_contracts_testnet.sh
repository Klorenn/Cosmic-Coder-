#!/usr/bin/env bash
# Deploy the Cosmic Coder contract set to Stellar Testnet and wire it up.
#
#   groth16_verifier    BN254 Groth16 verifier (stateless)
#   ultrahonk_verifier  Noir/UltraHonk verifier (STRUCTURAL STUB, legacy VITE_ZK_BACKEND=noir only)
#   cosmic_coder        game policy; constructor(admin, game_hub)
#
# Order: deploy -> constructor -> set_verifier (groth16) -> set_run_vk (GameRunV3 VK, circuits/build/contract_proof_v3.json)
#        -> set_unlock_vk (SkillProof VK, UNLOCK_VK_JSON, default circuits/build/contract_proof_skill.json).
# Ranked (submit_zk, Groth16) is only verified on-chain once set_run_vk ran, so a missing
# VK file aborts the script instead of leaving the board unverifiable.
#
# Requires: stellar CLI (>= 22, constructor support), python3, SOURCE_ACCOUNT funded on testnet,
# WASM built for wasm32v1-none (see contracts/README.md).
#
# Usage:
#   SOURCE_ACCOUNT=<identity or G...> ./scripts/deploy_contracts_testnet.sh
# Optional:
#   ADMIN=G...        admin of cosmic_coder and ultrahonk_verifier (default: SOURCE_ACCOUNT's address)
#   GAME_HUB=C...     Game Hub contract (default: hackathon testnet hub below)
#   UNLOCK_VK_JSON=path  SkillProof contract-format proof whose "vk" set_unlock_vk pins (re-applied on every
#                     run; default circuits/build/contract_proof_skill.json from scripts/zk/generate_skill_proof.js).
#   ZK_CIRCUIT=v1     pin the LEGACY GameRun VK (circuits/build/contract_proof.json, no private witness:
#                     any score >= wave*5 is provable). Default v3 = GameRunV3 (scripts/zk/build_GameRunV3.sh).
#                     The frontend VITE_ZK_CIRCUIT must match, or every ranked submit fails with #8 VkMismatch.
#   VERIFIER_ID=C... NOIR_VERIFIER_ID=C... POLICY_ID=C...
#                     reuse already-deployed contracts (idempotent re-run: skips deploys whose contract
#                     still exists on testnet, re-applies the admin configuration). After a testnet reset
#                     leave them unset so everything is redeployed.
#   ENABLE_NOIR_STUB=1  ALSO wire the ultrahonk_verifier STUB into cosmic_coder (set_noir_verifier).
#                       OFF by default: the stub does not verify proofs, so wiring it makes ranked
#                       submissions (submit_zk_noir) FORGEABLE. Demo/testnet use only.
#
# The source account must be able to sign as ADMIN for the post-deploy configuration calls.
# Without SOURCE_ACCOUNT the script only prints the commands.

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CONTRACTS="$ROOT/contracts"
WASM_DIR="$CONTRACTS/target/wasm32v1-none/release"
GAME_HUB="${GAME_HUB:-CB4VZAT2U3UC6XFK3N23SKRF2NDCMP3QHJYMCHHFMZO7MRQO6DQ2EMYG}"
NETWORK="testnet"
ZK_CIRCUIT="${ZK_CIRCUIT:-v3}"
case "$ZK_CIRCUIT" in
  v3) RUN_PROOF_JSON="$ROOT/circuits/build/contract_proof_v3.json"; RUN_PROOF_HINT="bash scripts/zk/build_GameRunV3.sh" ;;
  v1) RUN_PROOF_JSON="$ROOT/circuits/build/contract_proof.json"; RUN_PROOF_HINT="npm run zk:proof"
      echo "WARNING: ZK_CIRCUIT=v1 pins the legacy GameRun VK (no private witness, scores are not bound to kills)." >&2 ;;
  *) echo "ZK_CIRCUIT must be v3 or v1 (got $ZK_CIRCUIT)" >&2; exit 1 ;;
esac
# RUN_PROOF_JSON contains the run VK (hex, contract format) that set_run_vk pins.
NOIR_VK_JSON="$ROOT/public/circuits/GameRun_vk.json"         # UltraHonk VK payload
# SkillProof VK (contract hex, ic x3) pinned with set_unlock_vk; any contract_proof_skill.json made with
# circuits/build/SkillProof_final.zkey carries it (the browser/prover must use that same zkey).
UNLOCK_VK_JSON="${UNLOCK_VK_JSON:-$ROOT/circuits/build/contract_proof_skill.json}"

for w in groth16_verifier ultrahonk_verifier cosmic_coder; do
  if [ ! -f "$WASM_DIR/$w.wasm" ]; then
    echo "Missing $WASM_DIR/$w.wasm. Build first:"
    echo "  rustup target add wasm32v1-none"
    echo "  cd $CONTRACTS && cargo build --target wasm32v1-none --release -p groth16_verifier -p ultrahonk_verifier -p cosmic_coder"
    exit 1
  fi
done

if [ -z "${SOURCE_ACCOUNT:-}" ]; then
  cat <<EOF
SOURCE_ACCOUNT not set. Run with: SOURCE_ACCOUNT=<identity> ./scripts/deploy_contracts_testnet.sh

Manual steps (replace <SOURCE>, <ADMIN>):
  cd $CONTRACTS
  stellar contract deploy --source-account <SOURCE> --network $NETWORK --wasm $WASM_DIR/groth16_verifier.wasm
  stellar contract deploy --source-account <SOURCE> --network $NETWORK --wasm $WASM_DIR/ultrahonk_verifier.wasm -- --admin <ADMIN>
  stellar contract deploy --source-account <SOURCE> --network $NETWORK --wasm $WASM_DIR/cosmic_coder.wasm -- --admin <ADMIN> --game_hub $GAME_HUB
  stellar contract invoke --id <POLICY_ID> --source-account <SOURCE> --network $NETWORK -- set_verifier --verifier <VERIFIER_ID>
  stellar contract invoke --id <POLICY_ID> --source-account <SOURCE> --network $NETWORK -- set_run_vk --vk '<"vk" of $RUN_PROOF_JSON, hex without 0x: {"alpha":hex,"beta":hex,"gamma":hex,"delta":hex,"ic":[hex x8]}>'
  stellar contract invoke --id <POLICY_ID> --source-account <SOURCE> --network $NETWORK -- set_unlock_vk --vk '<"vk" of $UNLOCK_VK_JSON, same hex format, ic x3>'
  # Legacy VITE_ZK_BACKEND=noir only, with a REAL UltraHonk verifier (the bundled one is a stub => ranked forgeable):
  # stellar contract invoke --id <POLICY_ID> --source-account <SOURCE> --network $NETWORK -- set_noir_verifier --verifier <NOIR_VERIFIER_ID>
  stellar contract invoke --id <NOIR_VERIFIER_ID> --source-account <SOURCE> --network $NETWORK -- set_vk --vk_json <hex of $NOIR_VK_JSON>
Then: VITE_COSMIC_CODER_CONTRACT_ID=<POLICY_ID> (VITE_ZK_BACKEND=groth16 is the default)
EOF
  exit 0
fi

if [ -z "${ADMIN:-}" ]; then
  if [[ "$SOURCE_ACCOUNT" == G* ]]; then
    ADMIN="$SOURCE_ACCOUNT"
  else
    ADMIN="$(stellar keys address "$SOURCE_ACCOUNT")"
  fi
fi
echo "Admin: $ADMIN"
echo "Game Hub: $GAME_HUB"
if ! stellar contract info interface --id "$GAME_HUB" --network "$NETWORK" >/dev/null 2>&1; then
  echo "ERROR: Game Hub $GAME_HUB not found on $NETWORK (testnet reset?). Deploy a Game Hub exposing" >&2
  echo "  start_game(game_id, session_id: u32, player1, player2, player1_points: i128, player2_points: i128) and" >&2
  echo "  end_game(session_id: u32, player1_won: bool), then rerun with GAME_HUB=<its id>." >&2
  exit 1
fi

cd "$CONTRACTS"
deploy() { stellar contract deploy --source-account "$SOURCE_ACCOUNT" --network "$NETWORK" "$@" | tail -1; }
invoke() { local id="$1"; shift; stellar contract invoke --id "$id" --source-account "$SOURCE_ACCOUNT" --network "$NETWORK" -- "$@"; }

# Reuse an existing contract when its ID is given and it still exists (testnet resets wipe them).
exists() { [ -n "$1" ] && stellar contract info interface --id "$1" --network "$NETWORK" >/dev/null 2>&1; }

if exists "${VERIFIER_ID:-}"; then echo "Reusing groth16_verifier $VERIFIER_ID"; else
  echo "Deploying groth16_verifier..."
  VERIFIER_ID=$(deploy --wasm "$WASM_DIR/groth16_verifier.wasm")
fi
echo "VERIFIER_ID=$VERIFIER_ID"

if exists "${NOIR_VERIFIER_ID:-}"; then echo "Reusing ultrahonk_verifier $NOIR_VERIFIER_ID"; else
  echo "Deploying ultrahonk_verifier (admin=$ADMIN)..."
  NOIR_VERIFIER_ID=$(deploy --wasm "$WASM_DIR/ultrahonk_verifier.wasm" -- --admin "$ADMIN")
fi
echo "NOIR_VERIFIER_ID=$NOIR_VERIFIER_ID"

if exists "${POLICY_ID:-}"; then echo "Reusing cosmic_coder $POLICY_ID"; else
  echo "Deploying cosmic_coder (admin=$ADMIN, game_hub=$GAME_HUB)..."
  POLICY_ID=$(deploy --wasm "$WASM_DIR/cosmic_coder.wasm" -- --admin "$ADMIN" --game_hub "$GAME_HUB")
fi
echo "POLICY_ID=$POLICY_ID"

echo "Wiring Groth16 verifier..."
invoke "$POLICY_ID" set_verifier --verifier "$VERIFIER_ID"

if [ ! -f "$RUN_PROOF_JSON" ]; then
  echo "ERROR: $RUN_PROOF_JSON not found (run $RUN_PROOF_HINT). Without set_run_vk, submit_zk fails with VkNotSet and ranked is not verifiable." >&2
  exit 1
fi
echo "Registering run VK ($ZK_CIRCUIT) from $RUN_PROOF_JSON..."
vk_arg() { python3 -I -c 'import json,sys; vk=json.load(open(sys.argv[1]))["vk"]; n=int(sys.argv[2]); assert len(vk["ic"])==n, "%s: ic has %d points, expected %d" % (sys.argv[1], len(vk["ic"]), n); s=lambda h: h[2:] if h.startswith("0x") else h; print(json.dumps({k:(list(map(s,v)) if k=="ic" else s(v)) for k,v in vk.items()}))' "$1" "$2"; }
RUN_VK=$(vk_arg "$RUN_PROOF_JSON" 8)
invoke "$POLICY_ID" set_run_vk --vk "$RUN_VK"

if [ "${ENABLE_NOIR_STUB:-0}" = "1" ]; then
  cat >&2 <<'WARN'
################################################################################
##  WARNING: ENABLE_NOIR_STUB=1                                                ##
##  Wiring the ultrahonk_verifier STRUCTURAL STUB as the Noir verifier.        ##
##  It does NOT check the UltraHonk proof: anyone can forge scores via         ##
##  submit_zk_noir (only reachable with VITE_ZK_BACKEND=noir). Demo only.      ##
################################################################################
WARN
  invoke "$POLICY_ID" set_noir_verifier --verifier "$NOIR_VERIFIER_ID"
else
  echo "Skipping set_noir_verifier: ultrahonk_verifier is a stub (legacy noir backend only; submit_zk_noir fails with #16)."
fi

if [ -f "$NOIR_VK_JSON" ]; then
  echo "Storing UltraHonk VK from $NOIR_VK_JSON..."
  invoke "$NOIR_VERIFIER_ID" set_vk --vk_json "$(od -An -v -tx1 "$NOIR_VK_JSON" | tr -d ' \n')"
else
  echo "WARN: $NOIR_VK_JSON not found. submit_zk_noir fails (VerifierError) until set_vk is called."
fi

if [ -f "$UNLOCK_VK_JSON" ]; then
  echo "Registering unlock VK (SkillProof) from $UNLOCK_VK_JSON..."
  invoke "$POLICY_ID" set_unlock_vk --vk "$(vk_arg "$UNLOCK_VK_JSON" 3)"
else
  echo "WARN: $UNLOCK_VK_JSON not found (run node scripts/zk/generate_skill_proof.js). unlock_weapon fails with #7 VkNotSet until set_unlock_vk is called."
fi
echo ""
echo "================ Deployed contract IDs ($NETWORK) ================"
echo "  groth16_verifier   VERIFIER_ID=$VERIFIER_ID"
echo "  ultrahonk_verifier NOIR_VERIFIER_ID=$NOIR_VERIFIER_ID (stub, not wired)"
echo "  cosmic_coder       POLICY_ID=$POLICY_ID"
echo "  game hub           GAME_HUB=$GAME_HUB"
echo "  admin              $ADMIN"
echo "=================================================================="
echo "Done. Add to .env / public/config.json:"
echo "  VITE_COSMIC_CODER_CONTRACT_ID=$POLICY_ID"
echo "Add to GitHub Secrets (Settings -> Secrets and variables -> Actions):"
echo "  VITE_COSMIC_CODER_CONTRACT_ID = $POLICY_ID"
echo "  VITE_ZK_PROVER_URL = <prover URL>"
echo "  VITE_ZK_BACKEND = groth16 (default). Ranked is verified on-chain by submit_zk against the VK pinned above."
echo "VITE_RANKED_VERIFIED is only read with VITE_ZK_BACKEND=noir (keep false: the UltraHonk verifier is a stub)."
