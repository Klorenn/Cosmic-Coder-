// SkillProof - ZK circuit for weapon unlock verification
// Proves: score >= threshold without revealing exact score
// Uses Poseidon hash to bind wallet + score + nonce
// Public inputs: threshold, publicHash (in order)
pragma circom 2.1.4;

include "../node_modules/circomlib/circuits/comparators.circom";
include "../node_modules/circomlib/circuits/poseidon.circom";

template SkillProof() {
    // Private inputs
    signal input score;        // u32 - player's actual score (private)
    signal input wallet;       // field element - wallet address hash (private)
    signal input nonce;        // field element - unique nonce (private)
    
    // Public inputs (declared as outputs for Groth16 public signals)
    signal input threshold;    // u32 - minimum score required (public)
    signal input publicHash;   // field element - Poseidon(wallet, score, nonce) (public)
    
    // 1. Verify score >= threshold
    component gte = GreaterEqThan(32);
    gte.in[0] <== score;
    gte.in[1] <== threshold;
    gte.out === 1;
    
    // 2. Compute Poseidon(wallet, score, nonce)
    component poseidon = Poseidon(3);
    poseidon.inputs[0] <== wallet;
    poseidon.inputs[1] <== score;
    poseidon.inputs[2] <== nonce;
    
    // 3. Verify computed hash matches publicHash
    poseidon.out === publicHash;
}

// Public inputs: threshold, publicHash
component main {public [threshold, publicHash]} = SkillProof();
