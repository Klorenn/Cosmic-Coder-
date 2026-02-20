fn main(
    run_hash_hi: pub u128,
    run_hash_lo: pub u128,
    score: pub u32,
    wave: pub u32,
    nonce: pub u64,
    season_id: pub u32,
    used_zk_weapon: pub u1,
) {
    // Keep constraints aligned with the on-chain business rule.
    assert(wave > 0);
    assert(score > 0);
    assert(score >= wave * 10);
    assert(season_id > 0);

    // Inputs must be wired so they can't be optimized away.
    let hash_mix: u128 = run_hash_hi + run_hash_lo;
    let nonce_128: u128 = nonce as u128;
    let score_128: u128 = score as u128;
    let wave_128: u128 = wave as u128;
    let season_128: u128 = season_id as u128;
    let weapon_128: u128 = used_zk_weapon as u128;
    let witness_mix: u128 = hash_mix + nonce_128 + score_128 + wave_128 + season_128 + weapon_128;
    assert(witness_mix >= hash_mix);
}
