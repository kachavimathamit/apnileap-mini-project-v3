import jwt from 'jsonwebtoken';
import { config } from '../config.js';

/**
 * Sessions are stateless JWTs carried in an httpOnly cookie.
 *
 *  - `iat` drives the sliding idle timeout (SESSION_IDLE_MINUTES): the cookie is
 *    reissued on activity, so an idle session dies on schedule (FR 5.1).
 *  - `sessionStart` caps the absolute lifetime regardless of activity.
 *  - `tokenVersion` is compared against the user row, so deactivating an account
 *    or forcing a password change revokes every outstanding session immediately.
 */
export function issueToken({ userId, email, tokenVersion, sessionStart }) {
  const start = sessionStart ?? Math.floor(Date.now() / 1000);
  return jwt.sign(
    { sub: userId, email, tokenVersion, sessionStart: start },
    config.jwtSecret,
    { expiresIn: `${config.sessionIdleMinutes}m` },
  );
}

export function verifyToken(token) {
  return jwt.verify(token, config.jwtSecret);
}

export function sessionExceedsAbsoluteLifetime(sessionStart) {
  if (!sessionStart) return false;
  const ageSeconds = Math.floor(Date.now() / 1000) - sessionStart;
  return ageSeconds > config.sessionAbsoluteHours * 3600;
}

export function cookieOptions(maxAgeMs = config.sessionIdleMinutes * 60 * 1000) {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.cookieSecure,
    path: '/',
    maxAge: maxAgeMs,
  };
}
