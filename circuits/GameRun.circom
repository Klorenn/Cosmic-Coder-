// Cosmic Coder - ZK run attestation (BN254 / Groth16).
// Binds: run_hash (hi/lo), score, wave, nonce, season_id, used_zk_weapon.
// Enforces: score >= wave * MIN_SCORE_PER_WAVE (5).
// used_zk_weapon: 0 = no ZK weapon used, 1 = ZK Plasma Rifle used.
pragma circom 2.1.4;

include "../node_modules/circomlib/circuits/comparators.circom";

template GameRun() {
    signal input run_hash_hi;      // high 128 bits of run_hash
    signal input run_hash_lo;      // low 128 bits of run_hash
    signal input score;            // u32
    signal input wave;             // u32
    signal input nonce;            // u64
    signal input season_id;        // u32
    signal input used_zk_weapon;   // 0 or 1 (boolean flag for ZK Plasma Rifle)

    // Enforce game rule: score >= wave * 5 (MIN_SCORE_PER_WAVE)
    signal minScore;
    minScore <== wave * 5;
    component gte = GreaterEqThan(32);
    gte.in[0] <== score;
    gte.in[1] <== minScore;
    gte.out === 1;

    // Enforce used_zk_weapon is boolean (0 or 1)
    signal weaponCheck;
    weaponCheck <== used_zk_weapon * (used_zk_weapon - 1);
    weaponCheck === 0;

    // Expose as public outputs so verifier gets 7 pub signals
    // Order: [run_hash_hi, run_hash_lo, score, wave, nonce, season_id, used_zk_weapon]
    signal output run_hash_hi_out <== run_hash_hi;
    signal output run_hash_lo_out <== run_hash_lo;
    signal output score_out <== score;
    signal output wave_out <== wave;
    signal output nonce_out <== nonce;
    signal output season_id_out <== season_id;
    signal output used_zk_weapon_out <== used_zk_weapon;
}

component main = GameRun();
