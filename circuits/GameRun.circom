// Cosmic Coder - ZK run attestation (BN254 / Groth16).
// Binds: run_hash (hi/lo), score, wave, nonce, season_id.
// Enforces: score >= wave * MIN_SCORE_PER_WAVE (10).
pragma circom 2.1.4;

include "../node_modules/circomlib/circuits/comparators.circom";

template GameRun() {
    signal input run_hash_hi;  // high 128 bits of run_hash
    signal input run_hash_lo;  // low 128 bits of run_hash
    signal input score;        // u32
    signal input wave;        // u32
    signal input nonce;       // u64
    signal input season_id;   // u32

    // Enforce game rule: score >= wave * 10 (MIN_SCORE_PER_WAVE)
    signal minScore;
    minScore <== wave * 10;
    component gte = GreaterEqThan(32);
    gte.in[0] <== score;
    gte.in[1] <== minScore;
    gte.out === 1;

    // Expose as public outputs so verifier gets 6 pub signals (run_hash_hi, run_hash_lo, score, wave, nonce, season_id)
    signal output run_hash_hi_out <== run_hash_hi;
    signal output run_hash_lo_out <== run_hash_lo;
    signal output score_out <== score;
    signal output wave_out <== wave;
    signal output nonce_out <== nonce;
    signal output season_id_out <== season_id;
}

component main = GameRun();
