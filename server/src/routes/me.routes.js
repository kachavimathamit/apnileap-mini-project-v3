import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db/connection.js';
import { config } from '../config.js';
import { validate } from '../middleware/validate.js';
import { ROLE_LABELS, projectScopeSql } from '../services/accessScope.js';
import { listNotifications, markNotificationsRead } from '../services/notifications.js';
import { RAG_DEFINITIONS } from '../services/rag.js';

export const meRouter = Router();

/**
 * FR 5.2: the landing page shows the user's active role, access scope and the
 * last data refresh.
 */
meRouter.get('/', (req, res) => {
  const grants = req.scope.grants.map((grant) => {
    const institute = grant.institute_id
      ? db.prepare('SELECT short_name FROM institutes WHERE id = ?').get(grant.institute_id)
      : null;
    const department = grant.department_id
      ? db.prepare('SELECT name FROM departments WHERE id = ?').get(grant.department_id)
      : null;
    const project = grant.project_id
      ? db.prepare('SELECT title FROM projects WHERE id = ?').get(grant.project_id)
      : null;
    return {
      role: grant.role,
      roleLabel: ROLE_LABELS[grant.role],
      scopeType: grant.scope_type,
      instituteId: grant.institute_id,
      instituteName: institute?.short_name ?? null,
      departmentId: grant.department_id,
      departmentName: department?.name ?? null,
      projectId: grant.project_id,
      projectTitle: project?.title ?? null,
    };
  });

  const lastRefresh = db
    .prepare('SELECT MAX(last_update_at) AS at FROM projects')
    .get().at;

  const unread = db
    .prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND is_read = 0')
    .get(req.user.id).n;

  const pendingReviewCount = req.scope.permissions.has('progress:review')
    ? db
        .prepare(
          `SELECT COUNT(*) AS n FROM progress_submissions s
           JOIN projects p ON p.id = s.project_id
           WHERE s.status = 'PENDING_REVIEW' AND ${projectScopeSql(req.scope, 'p').sql}`,
        )
        .get(...projectScopeSql(req.scope, 'p').params).n
    : 0;

  res.json({
    user: {
      id: req.user.id,
      email: req.user.email,
      fullName: req.user.full_name,
      designation: req.user.designation,
      mustChangePassword: Boolean(req.user.must_change_password),
    },
    access: {
      isPlatformAdmin: req.scope.isPlatformAdmin,
      roles: [...req.scope.roles],
      roleLabels: [...req.scope.roles].map((role) => ROLE_LABELS[role]),
      permissions: [...req.scope.permissions],
      scopeDescription: req.scopeDescription,
      grants,
      instituteCount: req.scope.visibleInstituteIds.size,
    },
    system: {
      lastDataRefresh: lastRefresh,
      staleProjectDays: config.staleProjectDays,
      sessionIdleMinutes: config.sessionIdleMinutes,
      ragDefinitions: RAG_DEFINITIONS,
    },
    notifications: { unread },
    pendingReviews: { count: pendingReviewCount },
  });
});

/**
 * Cross-project queue of submissions waiting on this user's decision - the
 * guide/coordinator/head "Pending Reviews" list. Scoped exactly like every
 * other project read: a submission from a project outside the caller's
 * access never appears here, regardless of role.
 */
meRouter.get('/pending-reviews', (req, res) => {
  if (!req.scope.permissions.has('progress:review')) {
    return res.json({ submissions: [] });
  }
  const ps = projectScopeSql(req.scope, 'p');
  const submissions = db
    .prepare(
      `SELECT s.id, s.project_id, s.version, s.completion_percentage, s.status,
              s.submitted_by_name, s.submitted_at,
              p.code AS project_code, p.title AS project_title,
              i.short_name AS institute_short_name, d.name AS department_name
       FROM progress_submissions s
       JOIN projects p ON p.id = s.project_id
       JOIN institutes i ON i.id = p.institute_id
       JOIN departments d ON d.id = p.department_id
       WHERE s.status = 'PENDING_REVIEW' AND ${ps.sql}
       ORDER BY s.submitted_at ASC`,
    )
    .all(...ps.params);
  res.json({ submissions });
});

meRouter.get('/notifications', (req, res) => {
  const unreadOnly = req.query.unread === 'true';
  res.json({ notifications: listNotifications(req.user.id, { unreadOnly }) });
});

const markReadSchema = z.object({ ids: z.array(z.string().max(64)).max(200).optional() });

meRouter.post('/notifications/read', validate(markReadSchema), (req, res) => {
  const changed = markNotificationsRead(req.user.id, req.valid.ids);
  res.json({ ok: true, updated: changed });
});
