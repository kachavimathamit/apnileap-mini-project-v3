import { Router } from 'express';
import { z } from 'zod';
import { db, newId } from '../db/connection.js';
import { config } from '../config.js';
import { hashPassword, checkPasswordPolicy } from '../auth/password.js';
import { validate } from '../middleware/validate.js';
import { badRequest, conflict, forbidden, notFoundOrDenied } from '../middleware/errors.js';
import { requirePlatformAdmin, requireAnyPermission } from '../middleware/authorize.js';
import { recordAudit } from '../services/audit.js';
import { ROLES, ROLE_LABELS, permissionsForInstitute } from '../services/accessScope.js';
import { notifyUser, runEventSweep, EVENTS } from '../services/notifications.js';

export const adminRouter = Router();

/** Institutes where this user may administer accounts and access grants. */
function manageableInstituteIds(scope) {
  if (scope.isPlatformAdmin) {
    return db.prepare('SELECT id FROM institutes').all().map((row) => row.id);
  }
  return [...scope.visibleInstituteIds].filter((id) =>
    permissionsForInstitute(scope, id).has('user:manage'));
}

/** Roles an institute administrator may grant. Platform-wide roles are excluded. */
const INSTITUTE_GRANTABLE_ROLES = [
  'INSTITUTE_ADMIN', 'DEAN', 'DEPARTMENT_HEAD', 'COORDINATOR', 'FACULTY_MENTOR', 'REVIEWER', 'READ_ONLY', 'STUDENT',
];

adminRouter.get('/meta', requireAnyPermission('user:manage'), (req, res) => {
  const instituteIds = manageableInstituteIds(req.scope);
  const placeholders = instituteIds.map(() => '?').join(', ') || "''";
  res.json({
    roles: ROLES.map((role) => ({
      value: role,
      label: ROLE_LABELS[role],
      grantable: req.scope.isPlatformAdmin || INSTITUTE_GRANTABLE_ROLES.includes(role),
    })),
    institutes: db
      .prepare(
        `SELECT id, code, short_name, name, city, is_active FROM institutes
         WHERE id IN (${placeholders}) ORDER BY short_name`,
      )
      .all(...instituteIds),
    departments: db
      .prepare(
        `SELECT id, institute_id, code, name FROM departments
         WHERE institute_id IN (${placeholders}) AND is_active = 1 ORDER BY name`,
      )
      .all(...instituteIds),
    projects: db
      .prepare(
        `SELECT id, institute_id, department_id, code, title FROM projects
         WHERE institute_id IN (${placeholders}) AND is_archived = 0 ORDER BY title`,
      )
      .all(...instituteIds),
  });
});

/** Users visible to this administrator: those holding a grant in a managed institute. */
adminRouter.get('/users', requireAnyPermission('user:manage'), (req, res) => {
  const instituteIds = manageableInstituteIds(req.scope);
  if (!instituteIds.length) return res.json({ users: [] });

  const placeholders = instituteIds.map(() => '?').join(', ');
  const scopeClause = req.scope.isPlatformAdmin
    ? '1 = 1'
    : `EXISTS (SELECT 1 FROM access_grants g WHERE g.user_id = u.id AND g.institute_id IN (${placeholders}))`;

  const users = db
    .prepare(
      `SELECT u.id, u.email, u.full_name, u.designation, u.is_active, u.last_login_at, u.created_at,
              u.must_change_password
       FROM users u WHERE ${scopeClause} ORDER BY u.full_name`,
    )
    .all(...(req.scope.isPlatformAdmin ? [] : instituteIds));

  const grantsStmt = db.prepare(
    `SELECT g.id, g.role, g.scope_type, g.institute_id, g.department_id, g.project_id, g.is_active,
            i.short_name AS institute_name, d.name AS department_name, p.title AS project_title
     FROM access_grants g
     LEFT JOIN institutes i ON i.id = g.institute_id
     LEFT JOIN departments d ON d.id = g.department_id
     LEFT JOIN projects p ON p.id = g.project_id
     WHERE g.user_id = ?
     ORDER BY g.granted_at`,
  );

  res.json({
    users: users.map((user) => ({
      ...user,
      // An institute administrator sees only the parts of a user's access that
      // fall inside their own institute - never that user's access elsewhere.
      grants: grantsStmt
        .all(user.id)
        .filter((g) => req.scope.isPlatformAdmin || instituteIds.includes(g.institute_id)),
    })),
  });
});

const createUserSchema = z.object({
  email: z.string().email().max(254),
  fullName: z.string().trim().min(2).max(160),
  designation: z.string().trim().max(120).optional(),
  temporaryPassword: z.string().min(1).max(200),
  grant: z.object({
    role: z.enum(ROLES),
    scopeType: z.enum(['PLATFORM', 'INSTITUTE', 'DEPARTMENT', 'PROJECT']),
    instituteId: z.string().max(64).nullish(),
    departmentId: z.string().max(64).nullish(),
    projectId: z.string().max(64).nullish(),
  }),
});

/** Validates that this administrator is allowed to create the requested grant. */
function assertGrantAllowed(req, grant) {
  const manageable = manageableInstituteIds(req.scope);

  if (grant.scopeType === 'PLATFORM' || grant.role === 'PLATFORM_ADMIN') {
    if (!req.scope.isPlatformAdmin) {
      throw forbidden('Only a platform administrator can grant platform-wide access.');
    }
    return { instituteId: null, departmentId: null, projectId: null };
  }

  if (!grant.instituteId) throw badRequest('An institute must be specified for this grant.');
  if (!manageable.includes(grant.instituteId)) {
    throw forbidden('You may not grant access to that institute.');
  }
  if (!req.scope.isPlatformAdmin && !INSTITUTE_GRANTABLE_ROLES.includes(grant.role)) {
    throw forbidden(`Only a platform administrator can grant the ${ROLE_LABELS[grant.role]} role.`);
  }

  if (grant.scopeType === 'DEPARTMENT') {
    const department = db
      .prepare('SELECT id FROM departments WHERE id = ? AND institute_id = ?')
      .get(grant.departmentId ?? '', grant.instituteId);
    if (!department) throw badRequest('That department does not belong to the selected institute.');
  }
  if (grant.scopeType === 'PROJECT') {
    const project = db
      .prepare('SELECT id FROM projects WHERE id = ? AND institute_id = ?')
      .get(grant.projectId ?? '', grant.instituteId);
    if (!project) throw badRequest('That project does not belong to the selected institute.');
  }

  return {
    instituteId: grant.instituteId,
    departmentId: grant.scopeType === 'DEPARTMENT' ? grant.departmentId : null,
    projectId: grant.scopeType === 'PROJECT' ? grant.projectId : null,
  };
}

adminRouter.post('/users', requireAnyPermission('user:manage'), validate(createUserSchema), async (req, res, next) => {
  try {
    const v = req.valid;
    const problems = checkPasswordPolicy(v.temporaryPassword);
    if (problems.length) return next(badRequest(`The temporary password must contain ${problems.join(', ')}.`));

    const target = assertGrantAllowed(req, v.grant);

    if (db.prepare('SELECT id FROM users WHERE email = ?').get(v.email)) {
      return next(conflict('An account with that email address already exists.'));
    }

    const userId = newId('usr');
    const grantId = newId('grt');
    const hash = await hashPassword(v.temporaryPassword);

    db.transaction(() => {
      db.prepare(
        `INSERT INTO users (id, email, password_hash, full_name, designation, must_change_password)
         VALUES (?, ?, ?, ?, ?, 1)`,
      ).run(userId, v.email, hash, v.fullName, v.designation ?? null);

      db.prepare(
        `INSERT INTO access_grants (id, user_id, role, scope_type, institute_id, department_id, project_id, granted_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(grantId, userId, v.grant.role, v.grant.scopeType, target.instituteId,
            target.departmentId, target.projectId, req.user.id);
    })();

    recordAudit(req, {
      action: 'USER_CREATED',
      entityType: 'user',
      entityId: userId,
      instituteId: target.instituteId,
      detail: { email: v.email, role: v.grant.role, scopeType: v.grant.scopeType },
    });

    res.status(201).json({
      user: db.prepare('SELECT id, email, full_name, designation, is_active FROM users WHERE id = ?').get(userId),
    });
  } catch (error) {
    next(error);
  }
});

/** Loads a user this administrator is allowed to act on. */
function loadManagedUser(req, userId) {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user) throw notFoundOrDenied();
  if (req.scope.isPlatformAdmin) return user;

  const manageable = manageableInstituteIds(req.scope);
  const placeholders = manageable.map(() => '?').join(', ') || "''";
  const shared = db
    .prepare(`SELECT 1 FROM access_grants WHERE user_id = ? AND institute_id IN (${placeholders}) LIMIT 1`)
    .get(userId, ...manageable);
  if (!shared) throw notFoundOrDenied();
  return user;
}

const userPatchSchema = z.object({
  isActive: z.boolean().optional(),
  fullName: z.string().trim().min(2).max(160).optional(),
  designation: z.string().trim().max(120).optional(),
  resetPassword: z.string().min(1).max(200).optional(),
});

adminRouter.patch('/users/:userId', requireAnyPermission('user:manage'), validate(userPatchSchema), async (req, res, next) => {
  try {
    const user = loadManagedUser(req, req.params.userId);
    const v = req.valid;

    if (user.id === req.user.id && v.isActive === false) {
      return next(badRequest('You cannot deactivate your own account.'));
    }

    const updates = [];
    const params = [];
    if (v.fullName !== undefined) { updates.push('full_name = ?'); params.push(v.fullName); }
    if (v.designation !== undefined) { updates.push('designation = ?'); params.push(v.designation || null); }
    if (v.isActive !== undefined) {
      updates.push('is_active = ?');
      params.push(v.isActive ? 1 : 0);
      // Deactivation must take effect immediately, including for live sessions.
      if (!v.isActive) updates.push('token_version = token_version + 1');
    }
    if (v.resetPassword !== undefined) {
      const problems = checkPasswordPolicy(v.resetPassword);
      if (problems.length) return next(badRequest(`The new password must contain ${problems.join(', ')}.`));
      updates.push('password_hash = ?', 'must_change_password = 1', 'token_version = token_version + 1');
      params.push(await hashPassword(v.resetPassword));
    }
    if (!updates.length) return res.json({ ok: true });

    updates.push("updated_at = datetime('now')");
    params.push(user.id);
    db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...params);

    recordAudit(req, {
      action: v.isActive === false ? 'USER_DEACTIVATED' : 'USER_UPDATED',
      entityType: 'user',
      entityId: user.id,
      detail: { fields: Object.keys(v).filter((k) => k !== 'resetPassword'), passwordReset: v.resetPassword !== undefined },
    });

    res.json({
      user: db.prepare('SELECT id, email, full_name, designation, is_active FROM users WHERE id = ?').get(user.id),
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Removes a user account entirely. Deactivation (PATCH isActive: false) is the
 * tool for revoking access immediately while keeping the person's name on every
 * record they touched; this is for the smaller case of an account that should
 * never have existed - a mistyped email, a duplicate registration.
 *
 * An institute administrator may delete a user only when every one of that
 * user's active grants sits inside an institute the administrator manages -
 * otherwise deleting the account would silently remove that person's access
 * somewhere the administrator has no authority over. A platform-scoped grant,
 * or a grant in an institute outside the administrator's reach, blocks the
 * deletion and names the reason.
 */
adminRouter.delete('/users/:userId', requireAnyPermission('user:manage'), (req, res, next) => {
  try {
    const user = loadManagedUser(req, req.params.userId);

    if (user.id === req.user.id) {
      return next(badRequest('You cannot delete your own account.'));
    }

    const activeGrants = db
      .prepare("SELECT * FROM access_grants WHERE user_id = ? AND is_active = 1")
      .all(user.id);

    if (!req.scope.isPlatformAdmin) {
      const manageable = manageableInstituteIds(req.scope);
      const outOfReach = activeGrants.some(
        (grant) => grant.scope_type === 'PLATFORM' || !manageable.includes(grant.institute_id),
      );
      if (outOfReach) {
        return next(forbidden(
          'This account holds access outside the institutes you administer. Only a platform ' +
          'administrator can delete it.',
        ));
      }
    }

    const isLastPlatformAdmin =
      activeGrants.some((grant) => grant.role === 'PLATFORM_ADMIN') &&
      db.prepare(
        `SELECT COUNT(*) AS n FROM access_grants
         WHERE role = 'PLATFORM_ADMIN' AND is_active = 1 AND user_id <> ?`,
      ).get(user.id).n === 0;
    if (isLastPlatformAdmin) {
      return next(badRequest('This is the only remaining platform administrator and cannot be deleted.'));
    }

    db.prepare('DELETE FROM users WHERE id = ?').run(user.id);

    recordAudit(req, {
      action: 'USER_DELETED',
      entityType: 'user',
      entityId: user.id,
      detail: { email: user.email },
    });

    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

const grantSchema = z.object({
  role: z.enum(ROLES),
  scopeType: z.enum(['PLATFORM', 'INSTITUTE', 'DEPARTMENT', 'PROJECT']),
  instituteId: z.string().max(64).nullish(),
  departmentId: z.string().max(64).nullish(),
  projectId: z.string().max(64).nullish(),
});

adminRouter.post('/users/:userId/grants', requireAnyPermission('user:manage'), validate(grantSchema), (req, res, next) => {
  try {
    const user = loadManagedUser(req, req.params.userId);
    const target = assertGrantAllowed(req, req.valid);

    const id = newId('grt');
    db.prepare(
      `INSERT INTO access_grants (id, user_id, role, scope_type, institute_id, department_id, project_id, granted_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, user.id, req.valid.role, req.valid.scopeType, target.instituteId,
          target.departmentId, target.projectId, req.user.id);

    recordAudit(req, {
      action: 'ACCESS_GRANTED',
      entityType: 'access_grant',
      entityId: id,
      instituteId: target.instituteId,
      detail: { userId: user.id, role: req.valid.role, scopeType: req.valid.scopeType },
    });

    // Requirement 9.1: the user is told when their access rights change.
    notifyUser({
      userId: user.id,
      eventType: EVENTS.ACCESS_CHANGED,
      title: 'Your access has been updated',
      body: `${req.user.full_name} granted you the ${ROLE_LABELS[req.valid.role]} role.`,
      instituteId: target.instituteId,
    });

    res.status(201).json({ grant: db.prepare('SELECT * FROM access_grants WHERE id = ?').get(id) });
  } catch (error) {
    next(error);
  }
});

adminRouter.delete('/grants/:grantId', requireAnyPermission('user:manage'), (req, res, next) => {
  try {
    const grant = db.prepare('SELECT * FROM access_grants WHERE id = ?').get(req.params.grantId);
    if (!grant) return next(notFoundOrDenied());

    if (!req.scope.isPlatformAdmin) {
      const manageable = manageableInstituteIds(req.scope);
      if (!grant.institute_id || !manageable.includes(grant.institute_id)) {
        return next(notFoundOrDenied());
      }
    }
    if (grant.user_id === req.user.id) {
      return next(badRequest('You cannot revoke your own access grant.'));
    }

    db.prepare('UPDATE access_grants SET is_active = 0 WHERE id = ?').run(grant.id);

    recordAudit(req, {
      action: 'ACCESS_REVOKED',
      entityType: 'access_grant',
      entityId: grant.id,
      instituteId: grant.institute_id,
      detail: { userId: grant.user_id, role: grant.role },
    });

    notifyUser({
      userId: grant.user_id,
      eventType: EVENTS.ACCESS_CHANGED,
      title: 'Your access has been updated',
      body: `${req.user.full_name} removed your ${ROLE_LABELS[grant.role]} access.`,
      instituteId: grant.institute_id,
    });

    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

/** Audit trail, restricted to the institutes the caller administers. */
adminRouter.get('/audit', requireAnyPermission('audit:view'), (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 200, 1000);
  const filters = [];
  const params = [];

  if (!req.scope.isPlatformAdmin) {
    const ids = [...req.scope.visibleInstituteIds];
    if (!ids.length) return res.json({ entries: [] });
    filters.push(`(institute_id IN (${ids.map(() => '?').join(', ')}) OR actor_user_id = ?)`);
    params.push(...ids, req.user.id);
  }
  if (req.query.outcome && ['SUCCESS', 'DENIED', 'FAILURE'].includes(req.query.outcome)) {
    filters.push('outcome = ?');
    params.push(req.query.outcome);
  }
  if (typeof req.query.action === 'string' && req.query.action.trim()) {
    filters.push('action LIKE ?');
    params.push(`%${req.query.action.trim().slice(0, 60)}%`);
  }

  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  const entries = db
    .prepare(`SELECT * FROM audit_log ${where} ORDER BY occurred_at DESC, rowid DESC LIMIT ?`)
    .all(...params, limit);

  res.json({ entries: entries.map((e) => ({ ...e, detail: e.detail ? JSON.parse(e.detail) : null })) });
});

const instituteSchema = z.object({
  code: z.string().trim().min(2).max(20),
  name: z.string().trim().min(3).max(200),
  shortName: z.string().trim().min(2).max(60),
  city: z.string().trim().max(80).optional(),
});

adminRouter.post('/institutes', requirePlatformAdmin, validate(instituteSchema), (req, res, next) => {
  try {
    const v = req.valid;
    if (db.prepare('SELECT id FROM institutes WHERE code = ?').get(v.code)) {
      return next(conflict('An institute with that code already exists.'));
    }
    const id = newId('ins');
    db.prepare('INSERT INTO institutes (id, code, name, short_name, city) VALUES (?, ?, ?, ?, ?)')
      .run(id, v.code, v.name, v.shortName, v.city ?? null);

    recordAudit(req, {
      action: 'INSTITUTE_CREATED', entityType: 'institute', entityId: id,
      instituteId: id, detail: { code: v.code, name: v.name },
    });
    res.status(201).json({ institute: db.prepare('SELECT * FROM institutes WHERE id = ?').get(id) });
  } catch (error) {
    next(error);
  }
});

const institutePatchSchema = z.object({
  name: z.string().trim().min(3).max(200).optional(),
  shortName: z.string().trim().min(2).max(60).optional(),
  city: z.string().trim().max(80).optional(),
  isActive: z.boolean().optional(),
});

adminRouter.patch('/institutes/:instituteId', requirePlatformAdmin, validate(institutePatchSchema), (req, res, next) => {
  try {
    const institute = db.prepare('SELECT * FROM institutes WHERE id = ?').get(req.params.instituteId);
    if (!institute) return next(notFoundOrDenied());

    const v = req.valid;
    const updates = [];
    const params = [];
    if (v.name !== undefined) { updates.push('name = ?'); params.push(v.name); }
    if (v.shortName !== undefined) { updates.push('short_name = ?'); params.push(v.shortName); }
    if (v.city !== undefined) { updates.push('city = ?'); params.push(v.city || null); }
    if (v.isActive !== undefined) { updates.push('is_active = ?'); params.push(v.isActive ? 1 : 0); }
    if (!updates.length) return res.json({ institute });

    params.push(institute.id);
    db.prepare(`UPDATE institutes SET ${updates.join(', ')} WHERE id = ?`).run(...params);

    recordAudit(req, {
      action: 'INSTITUTE_UPDATED', entityType: 'institute', entityId: institute.id,
      instituteId: institute.id, detail: v,
    });

    res.json({ institute: db.prepare('SELECT * FROM institutes WHERE id = ?').get(institute.id) });
  } catch (error) {
    next(error);
  }
});

/**
 * Removes an institute. One that has never held a department is a genuine
 * mistake and is hard-deleted outright. One that has departments - even
 * inactive ones - is deactivated instead, so every department and project
 * beneath it stays intact and reachable to anyone still authorized for it.
 */
adminRouter.delete('/institutes/:instituteId', requirePlatformAdmin, (req, res, next) => {
  try {
    const institute = db.prepare('SELECT * FROM institutes WHERE id = ?').get(req.params.instituteId);
    if (!institute) return next(notFoundOrDenied());

    const departmentCount = db
      .prepare('SELECT COUNT(*) AS n FROM departments WHERE institute_id = ?')
      .get(institute.id).n;

    if (departmentCount === 0) {
      db.prepare('DELETE FROM institutes WHERE id = ?').run(institute.id);
      recordAudit(req, {
        action: 'INSTITUTE_DELETED', entityType: 'institute', entityId: institute.id,
        instituteId: institute.id, detail: { code: institute.code },
      });
      return res.json({ ok: true, deleted: true });
    }

    db.prepare('UPDATE institutes SET is_active = 0 WHERE id = ?').run(institute.id);
    recordAudit(req, {
      action: 'INSTITUTE_DEACTIVATED', entityType: 'institute', entityId: institute.id,
      instituteId: institute.id, detail: { code: institute.code, departmentCount },
    });
    res.json({
      ok: true,
      deleted: false,
      message: `This institute holds ${departmentCount} department(s), so it has been deactivated ` +
        'rather than deleted. Its departments and projects remain intact.',
    });
  } catch (error) {
    next(error);
  }
});

/** Runs the time-based notification sweep on demand. */
adminRouter.post('/sweep', requirePlatformAdmin, (req, res) => {
  const created = runEventSweep({ staleDays: config.staleProjectDays });
  recordAudit(req, { action: 'EVENT_SWEEP_RUN', entityType: 'system', detail: created });
  res.json({ ok: true, created });
});

// ---------------------------------------------------------------------------
// Role requests: Faculty Mentor / Guide self-registration, approved by a
// Department Head (or Institute Administrator / Platform Administrator).
// ---------------------------------------------------------------------------

/** True when this reviewer's grants reach the request's institute or department. */
function canDecideRoleRequest(scope, request) {
  if (scope.isPlatformAdmin) return true;
  if (scope.instituteIds.has(request.institute_id)) return true;
  if (scope.departmentIds.has(request.department_id)) return true;
  return false;
}

adminRouter.get('/role-requests', requireAnyPermission('mentor:approve'), (req, res) => {
  const all = db
    .prepare(
      `SELECT r.*, u.email, u.full_name, i.short_name AS institute_name, d.name AS department_name
       FROM role_requests r
       JOIN users u ON u.id = r.user_id
       JOIN institutes i ON i.id = r.institute_id
       JOIN departments d ON d.id = r.department_id
       WHERE r.status = 'PENDING'
       ORDER BY r.created_at ASC`,
    )
    .all();

  const visible = all.filter((request) => canDecideRoleRequest(req.scope, request));
  res.json({ requests: visible });
});

const roleRequestDecisionSchema = z.object({
  decision: z.enum(['APPROVED', 'REJECTED']),
  comment: z.string().trim().max(2000).optional(),
});

adminRouter.post(
  '/role-requests/:requestId/decision',
  requireAnyPermission('mentor:approve'),
  validate(roleRequestDecisionSchema),
  (req, res, next) => {
    try {
      const request = db.prepare('SELECT * FROM role_requests WHERE id = ?').get(req.params.requestId);
      if (!request || !canDecideRoleRequest(req.scope, request)) return next(notFoundOrDenied());
      if (request.status !== 'PENDING') {
        return next(conflict('This registration has already been decided.'));
      }

      const { decision, comment } = req.valid;
      if (decision === 'REJECTED' && (!comment || comment.trim().length < 5)) {
        return next(badRequest('A comment explaining the rejection is required.'));
      }

      db.transaction(() => {
        db.prepare(
          `UPDATE role_requests
             SET status = ?, reviewed_by = ?, reviewed_by_name = ?, review_comment = ?, reviewed_at = datetime('now')
           WHERE id = ?`,
        ).run(decision, req.user.id, req.user.full_name, comment?.trim() || null, request.id);

        if (decision === 'APPROVED') {
          db.prepare(
            `INSERT INTO access_grants (id, user_id, role, scope_type, institute_id, department_id, granted_by)
             VALUES (?, ?, 'FACULTY_MENTOR', 'DEPARTMENT', ?, ?, ?)`,
          ).run(newId('grt'), request.user_id, request.institute_id, request.department_id, req.user.id);
        }
      })();

      recordAudit(req, {
        action: `MENTOR_REGISTRATION_${decision}`,
        entityType: 'role_request',
        entityId: request.id,
        instituteId: request.institute_id,
        detail: { userId: request.user_id, decision },
      });

      notifyUser({
        userId: request.user_id,
        eventType: decision === 'APPROVED' ? EVENTS.ACCESS_CHANGED : EVENTS.ACCESS_CHANGED,
        title: decision === 'APPROVED' ? 'Your mentor registration was approved' : 'Your mentor registration was declined',
        body: decision === 'APPROVED'
          ? `${req.user.full_name} approved your Faculty Mentor registration. You can now access your department's projects.`
          : `${req.user.full_name}: ${comment?.trim()}`,
        instituteId: request.institute_id,
      });

      res.json({ ok: true, decision });
    } catch (error) {
      next(error);
    }
  },
);
