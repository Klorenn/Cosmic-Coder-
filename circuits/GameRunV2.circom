// Cosmic Coder - ZK run attestation v2 (BN254 / Groth16).
// Binds: run_hash (hi/lo), score, wave, nonce, season_id, challenge_id, player_address, contract_id, domain_separator.
// Enforces: score >= wave * MIN_SCORE_PER_WAVE (10).
pragma circom 2.1.4;

include "../node_modules/circomlib/circuits/comparators.circom";

template GameRunV2() {
    // Private inputs (if any) — currently all inputs are public for simplicity
    signal input run_hash_hi;        // high 128 bits of run_hash (field)
    signal input run_hash_lo;        // low 128 bits of run_hash (field)
    signal input score;              // u32
    signal input wave;               // u32
    signal input nonce;              // u64
    signal input season_id;          // u32
    signal input challenge_id;      // u32
    signal input player_address;    // 32 bytes (field element, e.g., keccak256(address) or raw bytes)
    signal input contract_id;        // 32 bytes (field element, contract address)
    signal input domain_separator;   // 32 bytes (field element, derived from domain binding)

    // Enforce game rule: score >= wave * 10 (MIN_SCORE_PER_WAVE)
    signal minScore;
    minScore <== wave * 10;
    component gte = GreaterEqThan(32);
    gte.in[0] <== score;
    gte.in[1] <== minScore;
    gte.out === 1;

    // Expose all as public outputs (order matters!)
    signal output run_hash_hi_out <== run_hash_hi;
    signal output run_hash_lo_out <== run_hash_lo;
    signal output score_out <== score;
    signal output wave_out <== wave;
    signal output nonce_out <== nonce;
    signal output season_id_out <== season_id;
    signal output challenge_id_out <== challenge_id;
    signal output player_address_out <== player_address;
    signal output contract_id_out <== contract_id;
    signal output domain_separator_out <== domain_separator;
}

component main = GameRunV2();
