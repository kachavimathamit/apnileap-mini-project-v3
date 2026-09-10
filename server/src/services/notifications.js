import { db, newId } from '../db/connection.js';

/**
 * Requirement 9.1. Recipients are resolved from the same grant table that governs
 * data access, so a notification can never carry information to someone who is not
 * authorized to see the underlying project.
 */

const NOTIFIABLE_ROLES = [
  'PLATFORM_ADMIN',
  'GLOBAL_PROGRAMME_LEADER',
  'INSTITUTE_ADMIN',
  'DEAN',
  'DEPARTMENT_HEAD',
  'FACULTY_MENTOR',
  'REVIEWER',
];

export const EVENTS = {
  PROJECT_TURNED_RED: 'PROJECT_TURNED_RED',
  PROJECT_RECOVERED: 'PROJECT_RECOVERED',
  ACTION_OVERDUE: 'ACTION_OVERDUE',
  REVIEW_APPROACHING: 'REVIEW_APPROACHING',
  PROJECT_STALE: 'PROJECT_STALE',
  SUPPORT_REQUESTED: 'SUPPORT_REQUESTED',
  ACCESS_CHANGED: 'ACCESS_CHANGED',
  PROGRESS_SUBMITTED: 'PROGRESS_SUBMITTED',
  PROGRESS_DECIDED: 'PROGRESS_DECIDED',
};

/** Users whose grants cover this project and who hold a role that should be told. */
export function recipientsForProject(projectId, { excludeUserId } = {}) {
  return db
    .prepare(
      `SELECT DISTINCT u.id, u.email, u.full_name
       FROM users u
       JOIN access_grants g ON g.user_id = u.id AND g.is_active = 1
         AND (g.expires_at IS NULL OR g.expires_at > datetime('now'))
       JOIN projects p ON p.id = @projectId
       WHERE u.is_active = 1
         AND u.id <> COALESCE(@excludeUserId, '')
         AND g.role IN (${NOTIFIABLE_ROLES.map((r) => `'${r}'`).join(', ')})
         AND (
              g.scope_type = 'PLATFORM'
           OR (g.scope_type = 'INSTITUTE'  AND g.institute_id  = p.institute_id)
           OR (g.scope_type = 'DEPARTMENT' AND g.department_id = p.department_id)
           OR (g.scope_type = 'PROJECT'    AND g.project_id    = p.id)
         )`,
    )
    .all({ projectId, excludeUserId: excludeUserId ?? null });
}

export function notifyProjectEvent({ projectId, eventType, title, body, excludeUserId }) {
  const project = db
    .prepare('SELECT id, institute_id FROM projects WHERE id = ?')
    .get(projectId);
  if (!project) return 0;

  const recipients = recipientsForProject(projectId, { excludeUserId });
  const insert = db.prepare(`
    INSERT INTO notifications (id, user_id, institute_id, project_id, event_type, title, body, channel)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'IN_APP')
  `);

  const writeAll = db.transaction((rows) => {
    for (const person of rows) {
      insert.run(newId('ntf'), person.id, project.institute_id, project.id, eventType, title, body);
    }
  });
  writeAll(recipients);

  return recipients.length;
}

export function notifyUser({ userId, eventType, title, body, instituteId = null, projectId = null }) {
  db.prepare(`
    INSERT INTO notifications (id, user_id, institute_id, project_id, event_type, title, body, channel)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'IN_APP')
  `).run(newId('ntf'), userId, instituteId, projectId, eventType, title, body);
}

export function listNotifications(userId, { unreadOnly = false, limit = 50 } = {}) {
  return db
    .prepare(
      `SELECT n.*, p.title AS project_title, p.code AS project_code
       FROM notifications n
       LEFT JOIN projects p ON p.id = n.project_id
       WHERE n.user_id = ? ${unreadOnly ? 'AND n.is_read = 0' : ''}
       ORDER BY n.created_at DESC
       LIMIT ?`,
    )
    .all(userId, limit);
}

export function markNotificationsRead(userId, ids) {
  if (!ids?.length) {
    return db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').run(userId).changes;
  }
  const placeholders = ids.map(() => '?').join(', ');
  return db
    .prepare(`UPDATE notifications SET is_read = 1 WHERE user_id = ? AND id IN (${placeholders})`)
    .run(userId, ...ids).changes;
}

/**
 * Sweep for time-based events (overdue actions, approaching reviews, stale
 * projects). Called on a timer by the API process and exposed to administrators
 * so it can also be triggered on demand.
 */
export function runEventSweep({ staleDays = 14, reviewWindowDays = 7 } = {}) {
  const created = { overdueActions: 0, approachingReviews: 0, staleProjects: 0 };

  const overdue = db
    .prepare(
      `SELECT a.id, a.project_id, a.description, a.due_date, p.title AS project_title
       FROM corrective_actions a
       JOIN projects p ON p.id = a.project_id
       WHERE a.status IN ('OPEN', 'IN_PROGRESS')
         AND date(a.due_date) < date('now')
         AND p.is_archived = 0
         AND NOT EXISTS (
           SELECT 1 FROM notifications n
           WHERE n.event_type = 'ACTION_OVERDUE' AND n.project_id = a.project_id
             AND n.body LIKE '%' || a.id || '%'
         )`,
    )
    .all();

  for (const action of overdue) {
    notifyProjectEvent({
      projectId: action.project_id,
      eventType: EVENTS.ACTION_OVERDUE,
      title: `Corrective action overdue - ${action.project_title}`,
      body: `Action "${action.description}" was due on ${action.due_date}. [${action.id}]`,
    });
    created.overdueActions += 1;
  }

  const approaching = db
    .prepare(
      `SELECT p.id, p.title, p.next_review_date
       FROM projects p
       WHERE p.is_archived = 0
         AND p.next_review_date IS NOT NULL
         AND date(p.next_review_date) BETWEEN date('now') AND date('now', '+' || ? || ' days')
         AND NOT EXISTS (
           SELECT 1 FROM notifications n
           WHERE n.event_type = 'REVIEW_APPROACHING' AND n.project_id = p.id
             AND n.body LIKE '%' || p.next_review_date || '%'
         )`,
    )
    .all(reviewWindowDays);

  for (const project of approaching) {
    notifyProjectEvent({
      projectId: project.id,
      eventType: EVENTS.REVIEW_APPROACHING,
      title: `Review approaching - ${project.title}`,
      body: `A review is scheduled for ${project.next_review_date}.`,
    });
    created.approachingReviews += 1;
  }

  const stale = db
    .prepare(
      `SELECT p.id, p.title, p.last_update_at
       FROM projects p
       WHERE p.is_archived = 0
         AND julianday('now') - julianday(p.last_update_at) > ?
         AND NOT EXISTS (
           SELECT 1 FROM notifications n
           WHERE n.event_type = 'PROJECT_STALE' AND n.project_id = p.id
             AND n.created_at > datetime('now', '-7 days')
         )`,
    )
    .all(staleDays);

  for (const project of stale) {
    notifyProjectEvent({
      projectId: project.id,
      eventType: EVENTS.PROJECT_STALE,
      title: `Project not updated - ${project.title}`,
      body: `The last update was recorded on ${project.last_update_at}.`,
    });
    created.staleProjects += 1;
  }

  return created;
}
