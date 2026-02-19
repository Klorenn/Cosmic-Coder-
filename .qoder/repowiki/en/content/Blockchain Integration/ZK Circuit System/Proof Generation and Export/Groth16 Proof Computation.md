# Groth16 Proof Computation

<cite>
**Referenced Files in This Document**
- [generate_proof.js](file://scripts/zk/generate_proof.js)
- [export_for_contract.js](file://scripts/zk/export_for_contract.js)
- [build_circuit.sh](file://scripts/zk/build_circuit.sh)
- [GameRun.circom](file://circuits/GameRun.circom)
- [input.json](file://circuits/input.json)
- [proof.json](file://circuits/build/proof.json)
- [public.json](file://circuits/build/public.json)
- [vkey.json](file://circuits/build/vkey.json)
- [lib.rs](file://contracts/groth16_verifier/src/lib.rs)
- [zkProve.js](file://server/zkProve.js)
- [package.json](file://package.json)
- [E2E_VERIFICATION.md](file://docs/E2E_VERIFICATION.md)
- [witness_calculator.js](file://circuits/build/GameRun_js/witness_calculator.js)
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
10. [Appendices](#appendices)

## Introduction
This document explains how Groth16 proofs are computed and verified in this project using snarkjs. It covers the fullprove command execution, the role of final zkey files, WASM circuit execution, and the mathematical foundations of Groth16. It documents the proof.json and public.json outputs, their structure, and how they are transformed for on-chain verification. It also includes performance considerations, memory requirements, and troubleshooting steps for common proof computation errors.

## Project Structure
The Groth16 workflow spans three stages:
- Trusted setup and circuit compilation
- Proof generation via fullprove
- Contract-ready export and verification

```mermaid
graph TB
subgraph "Circuit Definition"
A["GameRun.circom"]
end
subgraph "Build Pipeline"
B["build_circuit.sh"]
C["GameRun.r1cs"]
D["GameRun_js/ (WASM)"]
E["GameRun_0000.zkey"]
F["GameRun_final.zkey"]
G["vkey.json"]
end
subgraph "Proving"
H["input.json"]
I["generate_proof.js"]
J["proof.json"]
K["public.json"]
end
subgraph "Contract Export"
L["export_for_contract.js"]
M["contract_proof.json"]
end
subgraph "On-chain Verification"
N["lib.rs (Groth16 Verifier)"]
end
A --> B --> C --> D --> F
B --> E --> F --> G
H --> I --> J
I --> K
J --> L --> M
K --> L
G --> L
M --> N
```

**Diagram sources**
- [build_circuit.sh](file://scripts/zk/build_circuit.sh#L1-L57)
- [GameRun.circom](file://circuits/GameRun.circom#L1-L34)
- [generate_proof.js](file://scripts/zk/generate_proof.js#L1-L46)
- [export_for_contract.js](file://scripts/zk/export_for_contract.js#L1-L95)
- [lib.rs](file://contracts/groth16_verifier/src/lib.rs#L1-L61)

**Section sources**
- [build_circuit.sh](file://scripts/zk/build_circuit.sh#L1-L57)
- [GameRun.circom](file://circuits/GameRun.circom#L1-L34)
- [generate_proof.js](file://scripts/zk/generate_proof.js#L1-L46)
- [export_for_contract.js](file://scripts/zk/export_for_contract.js#L1-L95)
- [lib.rs](file://contracts/groth16_verifier/src/lib.rs#L1-L61)

## Core Components
- Circuit definition: GameRun.circom defines the constraints and public outputs used in the Groth16 proof.
- Trusted setup: build_circuit.sh compiles the circuit, generates powers-of-tau, and produces the final zkey and verification key.
- Prover: generate_proof.js executes snarkjs fullprove to compute the proof and public signals.
- Exporter: export_for_contract.js converts snarkjs outputs into contract-ready hex-encoded buffers.
- Verifier: lib.rs implements the BN254 pairing check for Groth16 verification.

**Section sources**
- [GameRun.circom](file://circuits/GameRun.circom#L1-L34)
- [build_circuit.sh](file://scripts/zk/build_circuit.sh#L1-L57)
- [generate_proof.js](file://scripts/zk/generate_proof.js#L1-L46)
- [export_for_contract.js](file://scripts/zk/export_for_contract.js#L1-L95)
- [lib.rs](file://contracts/groth16_verifier/src/lib.rs#L1-L61)

## Architecture Overview
The end-to-end flow from input to on-chain verification:

```mermaid
sequenceDiagram
participant Client as "Client"
participant Server as "server/zkProve.js"
participant Script as "scripts/zk/generate_proof.js"
participant SnarkJS as "snarkjs fullprove"
participant Export as "scripts/zk/export_for_contract.js"
participant Contract as "contracts/groth16_verifier/src/lib.rs"
Client->>Server : Submit run_hash, score, wave, nonce, season_id
Server->>Server : Build input.json
Server->>Script : Invoke generate_proof.js
Script->>SnarkJS : fullprove input.json wasm zkey proof.json public.json
SnarkJS-->>Script : proof.json, public.json
Script->>Export : exportAll(buildDir)
Export-->>Server : contract_proof.json
Server-->>Client : contract_proof.json
Client->>Contract : verify_proof(vk, proof, pub_signals)
Contract-->>Client : true/false
```

**Diagram sources**
- [zkProve.js](file://server/zkProve.js#L1-L68)
- [generate_proof.js](file://scripts/zk/generate_proof.js#L1-L46)
- [export_for_contract.js](file://scripts/zk/export_for_contract.js#L1-L95)
- [lib.rs](file://contracts/groth16_verifier/src/lib.rs#L1-L61)

## Detailed Component Analysis

### Trusted Setup and Final ZKey Role
- The build pipeline compiles the circuit to R1CS and WASM, then performs Groth16 setup using a powers-of-tau file. A final zkey is produced by contributing to the initial zkey, enabling proof generation with the circuit’s parameters.
- The final zkey is required by fullprove and is paired with the exported verification key (vkey.json) for on-chain verification.

```mermaid
flowchart TD
Start(["Start Trusted Setup"]) --> Compile["Compile GameRun.circom<br/>R1CS + WASM"]
Compile --> POTAU["Ensure pot12_final.ptau"]
POTAU --> Setup["snarkjs groth16 setup<br/>GameRun.r1cs pot12_final.ptau GameRun_0000.zkey"]
Setup --> Contribute["snarkjs zkey contribute<br/>GameRun_0000.zkey -> GameRun_final.zkey"]
Contribute --> ExportVK["snarkjs zkey export verificationkey<br/>GameRun_final.zkey -> vkey.json"]
ExportVK --> Done(["Artifacts Ready"])
```

**Diagram sources**
- [build_circuit.sh](file://scripts/zk/build_circuit.sh#L1-L57)

**Section sources**
- [build_circuit.sh](file://scripts/zk/build_circuit.sh#L1-L57)
- [vkey.json](file://circuits/build/vkey.json)

### Fullprove Command Execution and WASM Circuit
- The prover script invokes snarkjs groth16 fullprove with input.json, the compiled WASM circuit, and the final zkey. This computes the Groth16 proof and writes proof.json and public.json.
- The WASM witness calculator is used internally by snarkjs to evaluate the circuit for the given inputs.

```mermaid
sequenceDiagram
participant GP as "generate_proof.js"
participant SN as "snarkjs"
participant WASM as "GameRun_js/GameRun.wasm"
participant ZK as "GameRun_final.zkey"
participant OUT as "proof.json/public.json"
GP->>SN : groth16 fullprove input.json WASM ZKEY proof.json public.json
SN->>WASM : calculateWitness(input)
WASM-->>SN : witness
SN->>ZK : compute Groth16 proof
ZK-->>OUT : proof.json, public.json
```

**Diagram sources**
- [generate_proof.js](file://scripts/zk/generate_proof.js#L36-L40)
- [witness_calculator.js](file://circuits/build/GameRun_js/witness_calculator.js#L176-L212)

**Section sources**
- [generate_proof.js](file://scripts/zk/generate_proof.js#L36-L40)
- [witness_calculator.js](file://circuits/build/GameRun_js/witness_calculator.js#L176-L212)

### Proof Generation Parameters and Mathematical Foundations
- Groth16 is a polynomial commitment scheme over BN254 (BN128 in some contexts). The proof consists of three elements in the underlying groups:
  - pi_a: G1 element
  - pi_b: G2 element
  - pi_c: G1 element
- The verification equation uses a pairing check involving the verification key (vk_alpha_1, vk_beta_2, vk_gamma_2, vk_delta_2) and the public inputs mapped via vk.ic.
- Public inputs are exposed by the circuit and included in public.json. The circuit GameRun exposes run identifiers, score, wave, nonce, and season_id.

```mermaid
flowchart TD
A["Public Inputs (public.json)"] --> B["Compute vk_x = ic[0] + Σ(pub_signal_i * ic[i+1])"]
B --> C["Pairing Check:<br/>e(-A, B) * e(alpha, beta) * e(vk_x, gamma) * e(C, delta) == 1"]
C --> D{"Accept?"}
D --> |Yes| E["Valid Proof"]
D --> |No| F["Invalid Proof"]
```

**Diagram sources**
- [lib.rs](file://contracts/groth16_verifier/src/lib.rs#L20-L56)
- [public.json](file://circuits/build/public.json#L1-L8)
- [vkey.json](file://circuits/build/vkey.json)

**Section sources**
- [lib.rs](file://contracts/groth16_verifier/src/lib.rs#L18-L56)
- [GameRun.circom](file://circuits/GameRun.circom#L24-L31)
- [public.json](file://circuits/build/public.json#L1-L8)

### Output Files: proof.json and public.json
- proof.json contains the Groth16 proof with group elements encoded as big-endian decimal strings. It includes:
  - pi_a: G1 affine coordinates
  - pi_b: G2 matrix representation
  - pi_c: G1 affine coordinates
  - protocol and curve metadata
- public.json contains the circuit’s public signals as decimal strings. For GameRun, these correspond to run identifiers, score, wave, nonce, and season_id.

```mermaid
classDiagram
class ProofJSON {
+string[][] pi_a
+string[][][] pi_b
+string[][] pi_c
+string protocol
+string curve
}
class PublicJSON {
+string[] values
}
ProofJSON <.. PublicJSON : "paired with"
```

**Diagram sources**
- [proof.json](file://circuits/build/proof.json#L1-L28)
- [public.json](file://circuits/build/public.json#L1-L8)

**Section sources**
- [proof.json](file://circuits/build/proof.json#L1-L28)
- [public.json](file://circuits/build/public.json#L1-L8)

### Contract-Ready Export and On-chain Verification
- export_for_contract.js transforms snarkjs outputs into contract-friendly hex-encoded buffers:
  - Proof: a (64 bytes), b (128 bytes), c (64 bytes)
  - Verification key: alpha (64 bytes), beta (128 bytes), gamma (128 bytes), delta (128 bytes), ic[] (each 64 bytes)
  - Public signals: array of 32-byte big-endian field elements
- The Rust verifier performs the BN254 pairing check using these values.

```mermaid
sequenceDiagram
participant EXP as "export_for_contract.js"
participant PJ as "proof.json"
participant PV as "public.json"
participant VK as "vkey.json"
participant CP as "contract_proof.json"
EXP->>PJ : Parse pi_a/pi_b/pi_c
EXP->>PV : Parse public signals
EXP->>VK : Parse vk_alpha_1, vk_beta_2, vk_gamma_2, vk_delta_2, ic[]
EXP-->>CP : Write {proof, vk, pub_signals} as hex
```

**Diagram sources**
- [export_for_contract.js](file://scripts/zk/export_for_contract.js#L38-L86)
- [proof.json](file://circuits/build/proof.json#L1-L28)
- [public.json](file://circuits/build/public.json#L1-L8)
- [vkey.json](file://circuits/build/vkey.json)

**Section sources**
- [export_for_contract.js](file://scripts/zk/export_for_contract.js#L1-L95)
- [lib.rs](file://contracts/groth16_verifier/src/lib.rs#L18-L56)

### Server Integration for Proof Generation
- server/zkProve.js builds input.json from request data, validates prerequisites, executes the prover script, and returns the contract-ready proof payload.

```mermaid
flowchart TD
S["Request Body"] --> B["Build input.json"]
B --> V["Validate build artifacts"]
V --> E["Execute generate_proof.js"]
E --> O["Read contract_proof.json"]
O --> R["Return payload to client"]
```

**Diagram sources**
- [zkProve.js](file://server/zkProve.js#L15-L67)

**Section sources**
- [zkProve.js](file://server/zkProve.js#L1-L68)

## Dependency Analysis
- The prover depends on:
  - The compiled WASM circuit (GameRun_js/GameRun.wasm)
  - The final zkey (GameRun_final.zkey)
  - The input.json file
- The exporter depends on:
  - proof.json, public.json, and vkey.json
- The verifier depends on:
  - contract_proof.json (or equivalent) and the on-chain verification key

```mermaid
graph LR
GP["generate_proof.js"] --> W["GameRun_js/GameRun.wasm"]
GP --> ZK["GameRun_final.zkey"]
GP --> IN["input.json"]
GP --> PJ["proof.json"]
GP --> PV["public.json"]
EXP["export_for_contract.js"] --> PJ
EXP --> PV
EXP --> VK["vkey.json"]
EXP --> CP["contract_proof.json"]
VER["lib.rs (verifier)"] --> CP
```

**Diagram sources**
- [generate_proof.js](file://scripts/zk/generate_proof.js#L1-L46)
- [export_for_contract.js](file://scripts/zk/export_for_contract.js#L1-L95)
- [lib.rs](file://contracts/groth16_verifier/src/lib.rs#L1-L61)

**Section sources**
- [generate_proof.js](file://scripts/zk/generate_proof.js#L1-L46)
- [export_for_contract.js](file://scripts/zk/export_for_contract.js#L1-L95)
- [lib.rs](file://contracts/groth16_verifier/src/lib.rs#L1-L61)

## Performance Considerations
- Memory and CPU:
  - WASM witness calculation and Groth16 proving are memory-intensive. Ensure sufficient RAM during fullprove.
  - The witness calculator reads and writes large arrays; performance scales with circuit size.
- Disk I/O:
  - The build pipeline downloads or generates large powers-of-tau files. Ensure disk space for .ptau and build artifacts.
- Network:
  - The server-side prover sets a timeout for the prover script execution to prevent hanging.
- Recommendations:
  - Precompile and cache artifacts (R1CS, WASM, zkeys) to avoid repeated setup.
  - Use optimized Node.js runtime and limit concurrent proof generations.

[No sources needed since this section provides general guidance]

## Troubleshooting Guide
Common issues and resolutions:
- Missing prerequisites:
  - Ensure the circuit is built and final zkey exists before invoking the prover.
  - Verify snarkjs and circom are installed and in PATH.
- Invalid input:
  - The prover script checks for the presence of input.json and the compiled R1CS. Ensure input.json conforms to the circuit’s expected fields.
- Proof generation failures:
  - Confirm the WASM circuit and final zkey match the input and circuit.
  - Check that the input values satisfy circuit constraints (e.g., score vs wave relationship).
- Export mismatches:
  - The exporter validates byte lengths for proof and verification key components. If mismatches occur, re-run fullprove and regenerate vkey.
- Verification failures:
  - Ensure the on-chain verification key matches the exported vkey.
  - Confirm public signals align with the verification key’s IC count.

**Section sources**
- [generate_proof.js](file://scripts/zk/generate_proof.js#L23-L30)
- [export_for_contract.js](file://scripts/zk/export_for_contract.js#L38-L58)
- [zkProve.js](file://server/zkProve.js#L46-L67)
- [E2E_VERIFICATION.md](file://docs/E2E_VERIFICATION.md#L18-L36)

## Conclusion
This project demonstrates a complete Groth16 pipeline: compiling the circuit, performing a trusted setup, generating a proof via fullprove, exporting contract-ready artifacts, and verifying on-chain. The design emphasizes correctness through strict input validation, clear separation of concerns, and robust error handling. Following the documented procedures ensures reliable proof computation and verification.

[No sources needed since this section summarizes without analyzing specific files]

## Appendices

### Appendix A: End-to-End Verification Checklist
- Automated end-to-end test:
  - Run the provided script to build the circuit, generate a real proof, and execute verifier tests.
- Manual verification:
  - Generate a contract-ready proof and run Rust contract tests for the verifier and policy.

**Section sources**
- [E2E_VERIFICATION.md](file://docs/E2E_VERIFICATION.md#L18-L36)

### Appendix B: Scripts and Commands
- Build circuit and setup:
  - Use the build script to compile the circuit and perform trusted setup.
- Generate proof:
  - Use the prover script to run fullprove and export contract-ready artifacts.
- Server-side generation:
  - Use the server module to accept request data, write input.json, and return contract_proof.json.

**Section sources**
- [build_circuit.sh](file://scripts/zk/build_circuit.sh#L1-L57)
- [generate_proof.js](file://scripts/zk/generate_proof.js#L1-L46)
- [zkProve.js](file://server/zkProve.js#L1-L68)
- [package.json](file://package.json#L18-L21)