import crypto from 'node:crypto';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { config } from '../config.js';
import { db, newId } from '../db/connection.js';
import { hashPassword, verifyPassword, checkPasswordPolicy } from '../auth/password.js';
import { issueToken, cookieOptions } from '../auth/tokens.js';
import { authenticate } from '../middleware/authenticate.js';
import { validate } from '../middleware/validate.js';
import { badRequest, unauthorized } from '../middleware/errors.js';
import { recordAudit } from '../services/audit.js';
import { sendMail } from '../services/mailer.js';

export const authRouter = Router();

// A real bcrypt hash (of a value nobody can supply) used only to equalise timing
// on the "no such account" path.
const DUMMY_HASH = '$2b$12$C6UzMDM.H6dfI/f/IKcEe.qk2ZQyXQmXYPCvJZ0PMS4bYK0GJ7Y7C';

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many attempts. Please try again later.' } },
});

const loginSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(200),
});

authRouter.post('/login', loginLimiter, validate(loginSchema), async (req, res, next) => {
  const { email, password } = req.valid;

  try {
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);

    // Same response for unknown account, wrong password and deactivated account:
    // the login form must not confirm which email addresses exist.
    const fail = (reason) => {
      recordAudit(req, {
        action: 'LOGIN_FAILED',
        actorUserId: user?.id ?? null,
        actorEmail: email,
        entityType: 'user',
        entityId: user?.id ?? null,
        outcome: 'DENIED',
        detail: { reason },
      });
      return next(unauthorized('Email address or password is incorrect.'));
    };

    if (!user) {
      // Spend the same work factor as a real check, so a missing account is not
      // measurably faster to probe than an existing one.
      await verifyPassword(password, DUMMY_HASH).catch(() => false);
      return fail('unknown account');
    }

    if (user.locked_until && new Date(`${user.locked_until.replace(' ', 'T')}Z`) > new Date()) {
      return fail('account temporarily locked');
    }

    if (!user.is_active) return fail('account deactivated');

    const ok = await verifyPassword(password, user.password_hash);
    if (!ok) {
      const attempts = user.failed_login_count + 1;
      const lockedUntil =
        attempts >= config.loginMaxAttempts
          ? new Date(Date.now() + config.loginLockoutMinutes * 60_000)
              .toISOString().replace('T', ' ').slice(0, 19)
          : null;
      db.prepare('UPDATE users SET failed_login_count = ?, locked_until = ? WHERE id = ?')
        .run(attempts, lockedUntil, user.id);
      return fail(lockedUntil ? 'incorrect password - account now locked' : 'incorrect password');
    }

    db.prepare(
      `UPDATE users SET failed_login_count = 0, locked_until = NULL,
                        last_login_at = datetime('now'), updated_at = datetime('now')
       WHERE id = ?`,
    ).run(user.id);

    const token = issueToken({
      userId: user.id,
      email: user.email,
      tokenVersion: user.token_version,
    });
    res.cookie(config.cookieName, token, cookieOptions());

    recordAudit(req, {
      action: 'LOGIN_SUCCESS',
      actorUserId: user.id,
      actorEmail: user.email,
      entityType: 'user',
      entityId: user.id,
    });

    res.json({
      user: {
        id: user.id,
        email: user.email,
        fullName: user.full_name,
        designation: user.designation,
        mustChangePassword: Boolean(user.must_change_password),
      },
    });
  } catch (error) {
    next(error);
  }
});

authRouter.post('/logout', (req, res) => {
  res.clearCookie(config.cookieName, { ...cookieOptions(0), maxAge: undefined });
  recordAudit(req, { action: 'LOGOUT' });
  res.json({ ok: true });
});

const resetRequestSchema = z.object({ email: z.string().email().max(254) });

authRouter.post('/password-reset/request', loginLimiter, validate(resetRequestSchema), async (req, res, next) => {
  try {
    const { email } = req.valid;
    const user = db.prepare('SELECT id, email, full_name, is_active FROM users WHERE email = ?').get(email);

    if (user?.is_active) {
      const raw = crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(raw).digest('hex');
      const expires = new Date(Date.now() + 60 * 60_000).toISOString().replace('T', ' ').slice(0, 19);

      db.prepare(
        'INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)',
      ).run(newId('prt'), user.id, tokenHash, expires);

      const link = `${config.webOrigin}/reset-password?token=${raw}`;
      await sendMail({
        to: user.email,
        subject: 'Reset your Mini-Project Portfolio Portal password',
        text: `Hello ${user.full_name},\n\nUse this link within one hour to set a new password:\n${link}\n\nIf you did not request this, no action is needed.`,
      });

      recordAudit(req, {
        action: 'PASSWORD_RESET_REQUESTED',
        actorUserId: user.id,
        actorEmail: user.email,
        entityType: 'user',
        entityId: user.id,
      });
    } else {
      recordAudit(req, {
        action: 'PASSWORD_RESET_REQUESTED',
        actorEmail: email,
        outcome: 'DENIED',
        detail: { reason: 'no active account' },
      });
    }

    // Always the same answer, so the endpoint cannot be used to enumerate accounts.
    res.json({ ok: true, message: 'If that email address has an active account, a reset link has been sent.' });
  } catch (error) {
    next(error);
  }
});

const resetConfirmSchema = z.object({
  token: z.string().min(20).max(200),
  newPassword: z.string().min(1).max(200),
});

authRouter.post('/password-reset/confirm', loginLimiter, validate(resetConfirmSchema), async (req, res, next) => {
  try {
    const { token, newPassword } = req.valid;
    const problems = checkPasswordPolicy(newPassword);
    if (problems.length) {
      return next(badRequest(`The new password must contain ${problems.join(', ')}.`));
    }

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const record = db
      .prepare(
        `SELECT * FROM password_reset_tokens
         WHERE token_hash = ? AND used_at IS NULL AND expires_at > datetime('now')`,
      )
      .get(tokenHash);

    if (!record) {
      recordAudit(req, { action: 'PASSWORD_RESET_FAILED', outcome: 'DENIED', detail: { reason: 'invalid or expired token' } });
      return next(badRequest('That reset link is invalid or has expired. Please request a new one.'));
    }

    const hash = await hashPassword(newPassword);
    db.transaction(() => {
      // Bumping token_version invalidates every existing session for this account.
      db.prepare(
        `UPDATE users SET password_hash = ?, must_change_password = 0, token_version = token_version + 1,
                          failed_login_count = 0, locked_until = NULL, updated_at = datetime('now')
         WHERE id = ?`,
      ).run(hash, record.user_id);
      db.prepare("UPDATE password_reset_tokens SET used_at = datetime('now') WHERE id = ?").run(record.id);
    })();

    recordAudit(req, {
      action: 'PASSWORD_RESET_COMPLETED',
      actorUserId: record.user_id,
      entityType: 'user',
      entityId: record.user_id,
    });

    res.json({ ok: true, message: 'Your password has been changed. Please sign in.' });
  } catch (error) {
    next(error);
  }
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(1).max(200),
});

authRouter.post('/change-password', authenticate, validate(changePasswordSchema), async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.valid;
    const problems = checkPasswordPolicy(newPassword);
    if (problems.length) {
      return next(badRequest(`The new password must contain ${problems.join(', ')}.`));
    }

    const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
    if (!(await verifyPassword(currentPassword, row.password_hash))) {
      recordAudit(req, { action: 'PASSWORD_CHANGE_FAILED', outcome: 'DENIED', entityType: 'user', entityId: req.user.id });
      return next(badRequest('Your current password is incorrect.'));
    }

    const hash = await hashPassword(newPassword);
    db.prepare(
      `UPDATE users SET password_hash = ?, must_change_password = 0,
                        token_version = token_version + 1, updated_at = datetime('now')
       WHERE id = ?`,
    ).run(hash, req.user.id);

    recordAudit(req, { action: 'PASSWORD_CHANGED', entityType: 'user', entityId: req.user.id });

    // The old session was just revoked; issue a fresh cookie so the user stays in.
    const updated = db.prepare('SELECT token_version FROM users WHERE id = ?').get(req.user.id);
    res.cookie(
      config.cookieName,
      issueToken({ userId: req.user.id, email: req.user.email, tokenVersion: updated.token_version }),
      cookieOptions(),
    );

    res.json({ ok: true, message: 'Your password has been changed.' });
  } catch (error) {
    next(error);
  }
});

/** Public list of institutes/departments so the registration form has options. */
authRouter.get('/register-options', (req, res) => {
  const institutes = db
    .prepare('SELECT id, code, short_name AS name FROM institutes WHERE is_active = 1 ORDER BY short_name')
    .all();
  const departments = db
    .prepare('SELECT id, institute_id, code, name FROM departments WHERE is_active = 1 ORDER BY name')
    .all();
  res.json({ institutes, departments });
});

const registerSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(200),
  fullName: z.string().trim().min(2).max(160),
  designation: z.string().trim().max(120).optional(),
  instituteId: z.string().min(1).max(64),
  departmentId: z.string().min(1).max(64),
});

/**
 * Self-registration for a Faculty Mentor / Guide. The account is created and
 * can sign in immediately, but it holds no access_grants row - so, exactly
 * like any ungranted account, every project read returns nothing until a
 * Department Head, Institute Administrator or Platform Administrator
 * approves the request in role_requests and that approval creates the real
 * grant. There is no separate "pending" flag to check: deny-by-default
 * already covers it.
 */
authRouter.post('/register', validate(registerSchema), async (req, res, next) => {
  try {
    const v = req.valid;
    const problems = checkPasswordPolicy(v.password);
    if (problems.length) return next(badRequest(`Your password must contain ${problems.join(', ')}.`));

    if (db.prepare('SELECT id FROM users WHERE email = ?').get(v.email)) {
      return next(badRequest('An account with that email address already exists. Try signing in instead.'));
    }

    const department = db
      .prepare('SELECT id, institute_id FROM departments WHERE id = ? AND institute_id = ? AND is_active = 1')
      .get(v.departmentId, v.instituteId);
    if (!department) {
      return next(badRequest('That department does not belong to the selected institute.'));
    }

    const userId = newId('usr');
    const requestId = newId('rrq');
    const hash = await hashPassword(v.password);

    db.transaction(() => {
      db.prepare(
        'INSERT INTO users (id, email, password_hash, full_name, designation) VALUES (?, ?, ?, ?, ?)',
      ).run(userId, v.email, hash, v.fullName, v.designation ?? null);

      db.prepare(
        `INSERT INTO role_requests (id, user_id, requested_role, institute_id, department_id, designation)
         VALUES (?, ?, 'FACULTY_MENTOR', ?, ?, ?)`,
      ).run(requestId, userId, v.instituteId, v.departmentId, v.designation ?? null);
    })();

    recordAudit(req, {
      action: 'MENTOR_REGISTERED',
      actorUserId: userId,
      actorEmail: v.email,
      entityType: 'role_request',
      entityId: requestId,
      instituteId: v.instituteId,
      detail: { departmentId: v.departmentId },
    });

    res.status(201).json({
      ok: true,
      message: 'Your registration has been submitted. You can sign in now, but you will not see any ' +
        'projects until your department head approves your request.',
    });
  } catch (error) {
    next(error);
  }
});

const registerStudentSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(200),
  fullName: z.string().trim().min(2).max(160),
  projectCode: z.string().trim().min(2).max(40),
  teamIdentifier: z.string().trim().max(80).optional(),
});

/**
 * Self-registration for a student, joining a project by its code (given to
 * them by their guide). The account is created immediately and can sign in,
 * but - exactly like the mentor registration path - it holds no access grant
 * until the guide (or coordinator / department head / admin) approves the
 * team entry this creates, from the project's Team card. Knowing a project
 * code only lets someone ask to join it; it never grants access by itself.
 */
authRouter.post('/register-student', validate(registerStudentSchema), async (req, res, next) => {
  try {
    const v = req.valid;
    const problems = checkPasswordPolicy(v.password);
    if (problems.length) return next(badRequest(`Your password must contain ${problems.join(', ')}.`));

    if (db.prepare('SELECT id FROM users WHERE email = ?').get(v.email)) {
      return next(badRequest('An account with that email address already exists. Try signing in instead.'));
    }

    const project = db
      .prepare('SELECT id, institute_id, title FROM projects WHERE code = ? AND is_archived = 0')
      .get(v.projectCode);
    if (!project) {
      return next(badRequest('No active project has that code. Check it with your guide and try again.'));
    }

    const userId = newId('usr');
    const memberId = newId('mem');
    const hash = await hashPassword(v.password);

    db.transaction(() => {
      db.prepare(
        'INSERT INTO users (id, email, password_hash, full_name) VALUES (?, ?, ?, ?)',
      ).run(userId, v.email, hash, v.fullName);

      db.prepare(
        `INSERT INTO project_members
           (id, project_id, institute_id, user_id, member_role, team_identifier, display_name, status)
         VALUES (?, ?, ?, ?, 'STUDENT', ?, ?, 'PENDING')`,
      ).run(memberId, project.id, project.institute_id, userId, v.teamIdentifier ?? null, v.fullName);
    })();

    recordAudit(req, {
      action: 'STUDENT_REGISTERED',
      actorUserId: userId,
      actorEmail: v.email,
      entityType: 'project_member',
      entityId: memberId,
      instituteId: project.institute_id,
      detail: { projectId: project.id, projectCode: v.projectCode },
    });

    res.status(201).json({
      ok: true,
      message: `Your registration for "${project.title}" has been submitted. You can sign in now, but ` +
        'you will not see the project until your guide approves you.',
    });
  } catch (error) {
    next(error);
  }
});
