/**
 * Cost factor for bcrypt.
 * 10 ≈ 100ms on typical hardware — slow enough to hinder brute force,
 * fast enough for interactive login. Existing seed hashes were created
 * with 10 rounds, so changing this does not affect verify (the round
 * count is stored inside each hash). Use this constant when hashing
 * new passwords (register / reset).
 */
const BCRYPT_ROUNDS = 10;

module.exports = { BCRYPT_ROUNDS };
