# ZK Proof Generation

<cite>
**Referenced Files in This Document**
- [server/index.js](file://server/index.js)
- [server/zkProve.js](file://server/zkProve.js)
- [scripts/zk/generate_proof.js](file://scripts/zk/generate_proof.js)
- [scripts/zk/export_for_contract.js](file://scripts/zk/export_for_contract.js)
- [scripts/zk/build_circuit.sh](file://scripts/zk/build_circuit.sh)
- [src/contracts/gameClient.js](file://src/contracts/gameClient.js)
- [src/zk/gameProof.js](file://src/zk/gameProof.js)
- [circuits/GameRun.circom](file://circuits/GameRun.circom)
- [circuits/input.json.example](file://circuits/input.json.example)
- [contracts/shadow_ascension/src/lib.rs](file://contracts/shadow_ascension/src/lib.rs)
</cite>

## Table of Contents
1. [Introduction](#introduction)
2. [Project Structure](#project-structure)
3. [Core Components](#core-components)
4. [Architecture Overview](#architecture-overview)
5. [Detailed Component Analysis](#detailed-component-analysis)
6. [Dependency Analysis](#dependency-analysis)
7. [Performance Considerations](#performance-considerations)
8. [Troubleshooting Guide](#troubleshooting-guide)
9. [Conclusion](#conclusion)

## Introduction
This document explains Vibe-Coder’s ZK proof generation service that produces Groth16 proofs from Circom circuits for ranked gameplay. It covers the generateProof function, the /zk/prove endpoint, input validation, witness generation, and proof creation via snarkjs. It also documents the end-to-end workflow from frontend request through backend prover to on-chain verification, including error handling and integration with the frontend ZK system.

## Project Structure
The ZK pipeline spans three layers:
- Frontend client integrates with the backend prover and submits ZK proofs to the on-chain contract.
- Backend server exposes /zk/prove and orchestrates proof generation.
- Scripts and circuits implement the Groth16 prover workflow and export a contract-ready format.

```mermaid
graph TB
subgraph "Frontend"
FE["src/contracts/gameClient.js<br/>requestZkProof(), submitZk()"]
FP["src/zk/gameProof.js<br/>computeGameHash(), validateGameRules()"]
end
subgraph "Backend"
API["server/index.js<br/>POST /zk/prove"]
PROVE["server/zkProve.js<br/>generateProof()"]
GEN["scripts/zk/generate_proof.js<br/>fullprove + export"]
EXPORT["scripts/zk/export_for_contract.js<br/>contract_proof.json"]
end
subgraph "Circuits"
CIR["circuits/GameRun.circom"]
BUILD["scripts/zk/build_circuit.sh"]
INPUT["circuits/input.json.example"]
end
subgraph "On-chain"
SA["contracts/shadow_ascension/src/lib.rs<br/>submit_zk()"]
end
FE --> API
API --> PROVE
PROVE --> GEN
GEN --> EXPORT
FE --> FP
FE --> SA
BUILD --> CIR
INPUT --> GEN
```

**Diagram sources**
- [server/index.js](file://server/index.js#L196-L216)
- [server/zkProve.js](file://server/zkProve.js#L46-L67)
- [scripts/zk/generate_proof.js](file://scripts/zk/generate_proof.js#L1-L46)
- [scripts/zk/export_for_contract.js](file://scripts/zk/export_for_contract.js#L65-L86)
- [scripts/zk/build_circuit.sh](file://scripts/zk/build_circuit.sh#L1-L57)
- [src/contracts/gameClient.js](file://src/contracts/gameClient.js#L97-L273)
- [src/zk/gameProof.js](file://src/zk/gameProof.js#L1-L78)
- [circuits/GameRun.circom](file://circuits/GameRun.circom#L1-L34)
- [circuits/input.json.example](file://circuits/input.json.example#L1-L9)
- [contracts/shadow_ascension/src/lib.rs](file://contracts/shadow_ascension/src/lib.rs#L156-L264)

**Section sources**
- [server/index.js](file://server/index.js#L196-L216)
- [server/zkProve.js](file://server/zkProve.js#L1-L68)
- [scripts/zk/generate_proof.js](file://scripts/zk/generate_proof.js#L1-L46)
- [scripts/zk/export_for_contract.js](file://scripts/zk/export_for_contract.js#L1-L95)
- [scripts/zk/build_circuit.sh](file://scripts/zk/build_circuit.sh#L1-L57)
- [src/contracts/gameClient.js](file://src/contracts/gameClient.js#L1-L401)
- [src/zk/gameProof.js](file://src/zk/gameProof.js#L1-L78)
- [circuits/GameRun.circom](file://circuits/GameRun.circom#L1-L34)
- [circuits/input.json.example](file://circuits/input.json.example#L1-L9)
- [contracts/shadow_ascension/src/lib.rs](file://contracts/shadow_ascension/src/lib.rs#L156-L264)

## Core Components
- Backend endpoint: POST /zk/prove validates inputs and delegates to generateProof.
- Prover orchestration: generateProof writes input.json, invokes the Groth16 pipeline, and returns contract_proof.json.
- Groth16 pipeline: generate_proof.js executes snarkjs fullprove and exports contract-ready artifacts.
- Exporter: export_for_contract.js converts snarkjs outputs to BN254-encoded hex blobs for on-chain verification.
- Frontend integration: gameClient.js requests proofs and submits ZK runs to the contract.
- Circuit definition: GameRun.circom binds run_hash and game stats, enforcing score vs wave constraints.
- Contract logic: submit_zk verifies the proof against the verifier, prevents replays, and updates leaderboards.

**Section sources**
- [server/index.js](file://server/index.js#L196-L216)
- [server/zkProve.js](file://server/zkProve.js#L46-L67)
- [scripts/zk/generate_proof.js](file://scripts/zk/generate_proof.js#L36-L45)
- [scripts/zk/export_for_contract.js](file://scripts/zk/export_for_contract.js#L65-L86)
- [src/contracts/gameClient.js](file://src/contracts/gameClient.js#L97-L273)
- [circuits/GameRun.circom](file://circuits/GameRun.circom#L8-L31)
- [contracts/shadow_ascension/src/lib.rs](file://contracts/shadow_ascension/src/lib.rs#L156-L264)

## Architecture Overview
The ZK workflow is a request-response flow between the frontend and backend, followed by on-chain verification.

```mermaid
sequenceDiagram
participant Client as "Frontend Client"
participant API as "Express Server /zk/prove"
participant Prover as "generateProof()"
participant Snark as "generate_proof.js"
participant Export as "export_for_contract.js"
participant Contract as "submit_zk()"
Client->>API : POST /zk/prove {run_hash_hex, score, wave, nonce, season_id}
API->>Prover : generateProof(payload)
Prover->>Snark : execSync("node generate_proof.js input.json build")
Snark-->>Prover : contract_proof.json
Prover-->>API : {proof, vk, pub_signals}
API-->>Client : {proof, vk, pub_signals}
Client->>Contract : submit_zk(proof, vk, pub_signals, nonce, run_hash, season_id, score, wave)
Contract-->>Client : success or error
```

**Diagram sources**
- [server/index.js](file://server/index.js#L196-L216)
- [server/zkProve.js](file://server/zkProve.js#L46-L67)
- [scripts/zk/generate_proof.js](file://scripts/zk/generate_proof.js#L36-L45)
- [scripts/zk/export_for_contract.js](file://scripts/zk/export_for_contract.js#L65-L86)
- [src/contracts/gameClient.js](file://src/contracts/gameClient.js#L251-L273)
- [contracts/shadow_ascension/src/lib.rs](file://contracts/shadow_ascension/src/lib.rs#L156-L264)

## Detailed Component Analysis

### Backend Endpoint: /zk/prove
- Validates presence of run_hash_hex, score, wave, and nonce; season_id is optional.
- Delegates to generateProof with numeric conversions and defaults.
- Returns contract_proof.json payload on success; logs and returns 500 on error.

```mermaid
flowchart TD
Start(["POST /zk/prove"]) --> Validate["Validate required fields"]
Validate --> Valid{"All present?"}
Valid --> |No| Err400["Return 400 with error"]
Valid --> |Yes| CallGen["Call generateProof()"]
CallGen --> TryExec["Try block"]
TryExec --> Success["Return {proof, vk, pub_signals}"]
TryExec --> CatchErr["Catch error"]
CatchErr --> LogErr["Log error message"]
LogErr --> Err500["Return 500 with error"]
```

**Diagram sources**
- [server/index.js](file://server/index.js#L196-L216)

**Section sources**
- [server/index.js](file://server/index.js#L196-L216)

### Backend Prover Orchestration: generateProof
- Builds circuit input from request body, normalizing run_hash_hex to two 128-bit halves, clamping score and wave to non-negative integers, converting nonce and season_id to integers.
- Ensures circuits/build exists and contains the final proving key.
- Writes input.json and executes generate_proof.js synchronously with a timeout.
- Reads contract_proof.json and returns it.

```mermaid
flowchart TD
A["buildInput(body)"] --> B["Write input.json"]
B --> C["Check build dir and final zkey"]
C --> D["execSync(generate_proof.js)"]
D --> E["Read contract_proof.json"]
E --> F["Return payload"]
```

**Diagram sources**
- [server/zkProve.js](file://server/zkProve.js#L20-L67)

**Section sources**
- [server/zkProve.js](file://server/zkProve.js#L1-L68)

### Groth16 Pipeline: generate_proof.js
- Accepts input.json and build directory paths.
- Copies input.json into build for snarkjs.
- Executes snarkjs groth16 fullprove to produce proof.json and public.json.
- Invokes export_for_contract.js to write contract_proof.json.

```mermaid
flowchart TD
S["Start"] --> P1["Copy input.json to build"]
P1 --> P2["snarkjs groth16 fullprove"]
P2 --> P3["export_for_contract.js"]
P3 --> O["Write contract_proof.json"]
```

**Diagram sources**
- [scripts/zk/generate_proof.js](file://scripts/zk/generate_proof.js#L32-L45)

**Section sources**
- [scripts/zk/generate_proof.js](file://scripts/zk/generate_proof.js#L1-L46)

### Exporter: export_for_contract.js
- Converts snarkjs proof (G1/G2) and verification key (BN254) into big-endian hex blobs.
- Encodes public signals as 32-byte hex strings.
- Produces a contract-ready object with proof, vk, and pub_signals.

```mermaid
flowchart TD
X["Load proof.json, vkey.json, public.json"] --> Y["Convert G1/G2 to hex"]
Y --> Z["Convert IC to hex"]
Z --> W["Encode pub_signals to bytes32 hex"]
W --> R["Write contract_proof.json"]
```

**Diagram sources**
- [scripts/zk/export_for_contract.js](file://scripts/zk/export_for_contract.js#L38-L86)

**Section sources**
- [scripts/zk/export_for_contract.js](file://scripts/zk/export_for_contract.js#L1-L95)

### Frontend Integration: gameClient.js
- requestZkProof sends {run_hash_hex, score, wave, nonce, season_id} to /zk/prove and returns contract_proof.json.
- submitZkFromProver performs a full ranked submission by requesting a proof and then invoking submit_zk on-chain.
- submitZk validates inputs, converts run_hash to BytesN<32>, builds ScVal arguments, and signs/invokes the contract.

```mermaid
sequenceDiagram
participant FE as "Frontend"
participant API as "/zk/prove"
participant PROV as "generateProof()"
participant EXP as "export_for_contract.js"
participant CT as "submit_zk()"
FE->>API : POST /zk/prove
API->>PROV : generateProof()
PROV-->>FE : {proof, vk, pub_signals}
FE->>CT : submit_zk(...)
CT-->>FE : success or error
```

**Diagram sources**
- [src/contracts/gameClient.js](file://src/contracts/gameClient.js#L97-L273)
- [server/zkProve.js](file://server/zkProve.js#L46-L67)
- [scripts/zk/export_for_contract.js](file://scripts/zk/export_for_contract.js#L65-L86)
- [contracts/shadow_ascension/src/lib.rs](file://contracts/shadow_ascension/src/lib.rs#L156-L264)

**Section sources**
- [src/contracts/gameClient.js](file://src/contracts/gameClient.js#L97-L273)

### Circuit Definition: GameRun.circom
- Inputs: run_hash_hi, run_hash_lo, score, wave, nonce, season_id.
- Enforces score >= wave * 10 via a comparator template.
- Exposes all inputs as public outputs for verification.

```mermaid
classDiagram
class GameRun {
+input run_hash_hi
+input run_hash_lo
+input score
+input wave
+input nonce
+input season_id
+output run_hash_hi_out
+output run_hash_lo_out
+output score_out
+output wave_out
+output nonce_out
+output season_id_out
}
```

**Diagram sources**
- [circuits/GameRun.circom](file://circuits/GameRun.circom#L8-L31)

**Section sources**
- [circuits/GameRun.circom](file://circuits/GameRun.circom#L1-L34)

### Frontend ZK Utilities: gameProof.js
- computeGameHash: hashes player, wave, score, runSeed, timestamp to derive run_hash.
- validateGameRules: client-side validation ensuring sane wave/score and score >= wave * 10.
- generateRunSeed: creates a random 32-byte seed for run binding.

**Section sources**
- [src/zk/gameProof.js](file://src/zk/gameProof.js#L1-L78)

### On-chain Verification: submit_zk
- Verifies that verifier is set, vk/ic lengths match, inputs are valid, and score >= wave * 10.
- Checks anti-replay using (player, nonce, season_id).
- Invokes the verifier contract to validate proof and pub_signals.
- Updates per-season leaderboard and emits an event upon success.

```mermaid
flowchart TD
S0["Inputs: player, proof, vk, pub_signals, nonce, run_hash, season_id, score, wave"] --> S1["Check verifier set"]
S1 --> S2["Validate vk.ic length and inputs"]
S2 --> S3["Anti-replay lookup"]
S3 --> S4["Call verifier.verify_proof()"]
S4 --> S5{"Verified?"}
S5 --> |No| E1["Return InvalidProof"]
S5 --> |Yes| U1["Mark nonce used"]
U1 --> U2["Update leaderboard (higher score only)"]
U2 --> Evt["Emit zk_run_submitted"]
Evt --> Done["Success"]
```

**Diagram sources**
- [contracts/shadow_ascension/src/lib.rs](file://contracts/shadow_ascension/src/lib.rs#L156-L264)

**Section sources**
- [contracts/shadow_ascension/src/lib.rs](file://contracts/shadow_ascension/src/lib.rs#L156-L264)

## Dependency Analysis
- server/index.js depends on server/zkProve.js for proof generation.
- server/zkProve.js depends on scripts/zk/generate_proof.js and reads circuits/build artifacts.
- scripts/zk/generate_proof.js depends on snarkjs and scripts/zk/export_for_contract.js.
- scripts/zk/export_for_contract.js depends on snarkjs outputs (proof.json, vkey.json, public.json).
- src/contracts/gameClient.js depends on server/zkProve.js indirectly via /zk/prove and on-chain contract methods.
- contracts/shadow_ascension/src/lib.rs depends on the verifier contract and on-chain storage.

```mermaid
graph LR
IDX["server/index.js"] --> ZKP["server/zkProve.js"]
ZKP --> GEN["scripts/zk/generate_proof.js"]
GEN --> EXP["scripts/zk/export_for_contract.js"]
FE["src/contracts/gameClient.js"] --> IDX
FE --> SA["contracts/shadow_ascension/src/lib.rs"]
CIR["circuits/GameRun.circom"] --> GEN
```

**Diagram sources**
- [server/index.js](file://server/index.js#L196-L216)
- [server/zkProve.js](file://server/zkProve.js#L46-L67)
- [scripts/zk/generate_proof.js](file://scripts/zk/generate_proof.js#L36-L45)
- [scripts/zk/export_for_contract.js](file://scripts/zk/export_for_contract.js#L65-L86)
- [src/contracts/gameClient.js](file://src/contracts/gameClient.js#L97-L273)
- [contracts/shadow_ascension/src/lib.rs](file://contracts/shadow_ascension/src/lib.rs#L156-L264)
- [circuits/GameRun.circom](file://circuits/GameRun.circom#L1-L34)

**Section sources**
- [server/index.js](file://server/index.js#L196-L216)
- [server/zkProve.js](file://server/zkProve.js#L1-L68)
- [scripts/zk/generate_proof.js](file://scripts/zk/generate_proof.js#L1-L46)
- [scripts/zk/export_for_contract.js](file://scripts/zk/export_for_contract.js#L1-L95)
- [src/contracts/gameClient.js](file://src/contracts/gameClient.js#L1-L401)
- [contracts/shadow_ascension/src/lib.rs](file://contracts/shadow_ascension/src/lib.rs#L156-L264)
- [circuits/GameRun.circom](file://circuits/GameRun.circom#L1-L34)

## Performance Considerations
- Proof generation is CPU-intensive and synchronous; a 60-second timeout is enforced to prevent hanging.
- The prover relies on snarkjs and the WASM circuit; ensure sufficient memory and disk space for witness computation.
- Minimizing input sizes and avoiding unnecessary re-runs improves throughput.
- Circuit compilation and trusted setup are offline tasks handled by build_circuit.sh.

[No sources needed since this section provides general guidance]

## Troubleshooting Guide
Common issues and resolutions:
- Missing or invalid run_hash_hex: must be exactly 64 hex characters; otherwise, input normalization throws an error.
- Missing required fields: /zk/prove returns 400 if run_hash_hex, score, wave, or nonce are absent.
- Circuits not built: generateProof checks for circuits/build and GameRun_final.zkey; missing artifacts cause errors.
- snarkjs or circom not installed: build_circuit.sh validates PATH for circom and snarkjs; install prerequisites if commands are not found.
- Export mismatches: export_for_contract.js enforces strict byte lengths for G1/G2 and IC vectors; mismatches indicate corrupted snarkjs outputs.
- On-chain verification failures: submit_zk rejects invalid inputs, malformed VK, replay attempts, or verifier errors.

**Section sources**
- [server/zkProve.js](file://server/zkProve.js#L49-L54)
- [server/index.js](file://server/index.js#L196-L216)
- [scripts/zk/build_circuit.sh](file://scripts/zk/build_circuit.sh#L16-L28)
- [scripts/zk/export_for_contract.js](file://scripts/zk/export_for_contract.js#L38-L58)
- [contracts/shadow_ascension/src/lib.rs](file://contracts/shadow_ascension/src/lib.rs#L173-L220)

## Conclusion
The ZK proof generation service integrates frontend requests, backend orchestration, and on-chain verification seamlessly. The generateProof function and /zk/prove endpoint provide a robust interface for producing contract-ready Groth16 proofs from Circom circuits. Frontend utilities compute run hashes, validate game rules, and submit ZK runs to the contract, which enforces replay protection and updates leaderboards. Proper setup of prerequisites and adherence to input constraints ensure reliable operation.