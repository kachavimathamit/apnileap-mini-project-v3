import { config } from '../config.js';
import { db } from '../db/connection.js';
import { issueToken, verifyToken, sessionExceedsAbsoluteLifetime, cookieOptions } from '../auth/tokens.js';
import { loadScope, describeScope } from '../services/accessScope.js';
import { recordAudit } from '../services/audit.js';
import { unauthorized, forbidden } from './errors.js';

/**
 * Establishes req.user and req.scope for every protected route. Runs before any
 * handler, so no endpoint can accidentally serve data without an evaluated scope.
 */
export function authenticate(req, _res, next) {
  const token = req.cookies?.[config.cookieName];
  if (!token) return next(unauthorized());

  let payload;
  try {
    payload = verifyToken(token);
  } catch {
    return next(unauthorized('Your session has expired. Please sign in again.'));
  }

  if (sessionExceedsAbsoluteLifetime(payload.sessionStart)) {
    return next(unauthorized('Your session has reached its maximum length. Please sign in again.'));
  }

  const user = db
    .prepare('SELECT id, email, full_name, designation, is_active, token_version, must_change_password FROM users WHERE id = ?')
    .get(payload.sub);

  // A deactivated account loses access immediately (FR 5.1), even mid-session.
  if (!user || !user.is_active || user.token_version !== payload.tokenVersion) {
    recordAudit(req, {
      action: 'SESSION_REJECTED',
      actorUserId: payload.sub,
      actorEmail: payload.email,
      outcome: 'DENIED',
      detail: { reason: !user ? 'unknown user' : !user.is_active ? 'account deactivated' : 'session revoked' },
    });
    return next(unauthorized('Your account is no longer active. Please contact your administrator.'));
  }

  req.user = user;
  req.sessionStart = payload.sessionStart;
  req.scope = loadScope(user.id);
  req.scopeDescription = describeScope(req.scope);
  next();
}

/** Slides the idle timeout forward on each authenticated request. */
export function refreshSession(req, res, next) {
  if (req.user) {
    const token = issueToken({
      userId: req.user.id,
      email: req.user.email,
      tokenVersion: req.user.token_version,
      sessionStart: req.sessionStart,
    });
    res.cookie(config.cookieName, token, cookieOptions());
  }
  next();
}

/**
 * Blocks everything except the password-change endpoint while a forced password
 * change is outstanding.
 */
export function requirePasswordSettled(req, _res, next) {
  if (req.user?.must_change_password) {
    return next(forbidden('You must change your password before continuing.'));
  }
  next();
}
