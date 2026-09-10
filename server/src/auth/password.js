import bcrypt from 'bcryptjs';

const ROUNDS = 12;

export function hashPassword(plain) {
  return bcrypt.hash(plain, ROUNDS);
}

export function verifyPassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}

/**
 * Minimum password policy for the initial release. Deliberately simple and
 * explainable to non-technical faculty users, but long enough to be meaningful.
 */
export function checkPasswordPolicy(plain) {
  const problems = [];
  if (typeof plain !== 'string' || plain.length < 10) problems.push('at least 10 characters');
  if (!/[A-Za-z]/.test(plain ?? '')) problems.push('at least one letter');
  if (!/[0-9]/.test(plain ?? '')) problems.push('at least one number');
  return problems;
}
