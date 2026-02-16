// Cosmic Coder - ZK run attestation (BN254 / Groth16).
// Binds: run_hash (hi/lo), score, wave, nonce, season_id.
// Public inputs commit these values; contract enforces score/wave > 0 and replay.
pragma circom 2.1.4;

template GameRun() {
    signal input run_hash_hi;  // high 128 bits of run_hash
    signal input run_hash_lo;  // low 128 bits of run_hash
    signal input score;        // u32
    signal input wave;        // u32
    signal input nonce;       // u64
    signal input season_id;   // u32

    // One constraint so the circuit is valid; public inputs bind the run data
    signal one;
    one <== 1;
    1 === one;

    // Expose as public outputs so verifier gets 6 pub signals (run_hash_hi, run_hash_lo, score, wave, nonce, season_id)
    signal output run_hash_hi_out <== run_hash_hi;
    signal output run_hash_lo_out <== run_hash_lo;
    signal output score_out <== score;
    signal output wave_out <== wave;
    signal output nonce_out <== nonce;
    signal output season_id_out <== season_id;
}

component main = GameRun();
