// PoseidonHash - Helper circuit to calculate Poseidon hash
// Computes: hash = Poseidon(wallet, score, nonce)
pragma circom 2.1.4;

include "../node_modules/circomlib/circuits/poseidon.circom";

template PoseidonHash() {
    // Inputs
    signal input wallet;       // field element - wallet address hash
    signal input score;        // field element - score
    signal input nonce;        // field element - nonce
    
    // Output
    signal output hash;
    
    // Compute Poseidon(wallet, score, nonce)
    component poseidon = Poseidon(3);
    poseidon.inputs[0] <== wallet;
    poseidon.inputs[1] <== score;
    poseidon.inputs[2] <== nonce;
    
    hash <== poseidon.out;
}

component main = PoseidonHash();
