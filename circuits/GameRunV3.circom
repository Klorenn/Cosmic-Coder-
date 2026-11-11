// Cosmic Coder - ZK run attestation v3 (BN254 / Groth16).
//
// Fixes the GameRun soundness gap (no private witness: any score >= wave*5 was provable) with a
// minimal run commitment:
//   private: seed, kills, events_hash
//   public : run_hash = Poseidon(seed, score, wave, kills, nonce, season_id, events_hash)
//   rules  : wave*MIN_SCORE_PER_WAVE <= score
//            score <= kills*MAX_SCORE_PER_KILL + wave*wave*WAVE_BONUS_QUAD + wave*WAVE_FLAT
//
// Public signal layout is IDENTICAL to GameRun (7 signals), so cosmic_coder.submit_zk accepts it
// after `set_run_vk(<GameRunV3 VK>)`, with no contract change:
//   [run_hash_hi, run_hash_lo, score, wave, nonce, season_id, used_zk_weapon]
// run_hash (32 bytes, big-endian Poseidon output) = run_hash_hi (16 B) || run_hash_lo (16 B).
//
// Constants (derivation in docs/ZK_CIRCUIT_STATUS.md; score = run XP, src/systems/scoreRules.js):
//   MIN_SCORE_PER_WAVE = 5      same rule as GameRun and the contract
//   MAX_SCORE_PER_KILL = 26250  max xpValue 3000 (src/data/enemies.js) x2 DOUBLE_XP event x1.25 run
//                               modifier xpMult x3.5 addXP multiplier cap (src/main.js)
//   WAVE_BONUS_QUAD    = 875    wave-clear bonus newWave*100 (boss) x2 x1.25 x3.5; summed over waves
//                               sum_{w<=W} 875*w <= 875*W^2
//   WAVE_FLAT          = 5000   per-wave headroom for shrine jackpot (500 x3.5), item/map XP pickups
//
// Limits: kills/seed/events_hash are still chosen by the prover. The bound only becomes a real
// anti-cheat once `seed` is issued by the contract/server at start_match and `events_hash` is
// recomputed from a server-side event log.
pragma circom 2.1.4;

include "../node_modules/circomlib/circuits/poseidon.circom";
include "../node_modules/circomlib/circuits/comparators.circom";
include "../node_modules/circomlib/circuits/bitify.circom";

template GameRunV3(MIN_SCORE_PER_WAVE, MAX_SCORE_PER_KILL, WAVE_BONUS_QUAD, WAVE_FLAT) {
    signal input seed;          // private
    signal input kills;         // private
    signal input events_hash;   // private
    signal input score;
    signal input wave;
    signal input nonce;
    signal input season_id;
    signal input used_zk_weapon;

    // Range checks: comparators below are only sound for inputs < 2^n.
    component scoreBits = Num2Bits(32);
    scoreBits.in <== score;
    component waveBits = Num2Bits(32);
    waveBits.in <== wave;
    component killsBits = Num2Bits(32);
    killsBits.in <== kills;
    component nonceBits = Num2Bits(64);
    nonceBits.in <== nonce;
    component seasonBits = Num2Bits(32);
    seasonBits.in <== season_id;
    used_zk_weapon * (used_zk_weapon - 1) === 0;

    // score >= wave * MIN_SCORE_PER_WAVE  (both < 2^40)
    component minRule = GreaterEqThan(40);
    minRule.in[0] <== score;
    minRule.in[1] <== wave * MIN_SCORE_PER_WAVE;
    minRule.out === 1;

    // score <= kills*MAX_SCORE_PER_KILL + wave^2*WAVE_BONUS_QUAD + wave*WAVE_FLAT
    // kills, wave < 2^32 -> rhs < 2^47 + 2^74 + 2^45 < 2^76
    signal waveSq <== wave * wave;
    component maxRule = LessEqThan(80);
    maxRule.in[0] <== score;
    maxRule.in[1] <== kills * MAX_SCORE_PER_KILL + waveSq * WAVE_BONUS_QUAD + wave * WAVE_FLAT;
    maxRule.out === 1;

    component h = Poseidon(7);
    h.inputs[0] <== seed;
    h.inputs[1] <== score;
    h.inputs[2] <== wave;
    h.inputs[3] <== kills;
    h.inputs[4] <== nonce;
    h.inputs[5] <== season_id;
    h.inputs[6] <== events_hash;

    // Split the hash into 128-bit limbs (strict: unique canonical decomposition).
    component hb = Num2Bits_strict();
    hb.in <== h.out;
    var hi = 0;
    var lo = 0;
    for (var i = 0; i < 128; i++) {
        lo += hb.out[i] * (1 << i);
    }
    for (var i = 128; i < 254; i++) {
        hi += hb.out[i] * (1 << (i - 128));
    }

    signal output run_hash_hi_out <== hi;
    signal output run_hash_lo_out <== lo;
    signal output score_out <== score;
    signal output wave_out <== wave;
    signal output nonce_out <== nonce;
    signal output season_id_out <== season_id;
    signal output used_zk_weapon_out <== used_zk_weapon;
}

component main = GameRunV3(5, 26250, 875, 5000);
